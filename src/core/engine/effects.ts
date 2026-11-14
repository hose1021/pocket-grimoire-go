import type { DeadAt, Effect, EffectGraphResult, GameState } from "../model/types.ts";

type Graph = EffectGraphResult;

// Trouble Brewing domain: effects. No DOM or persistence.

import { playerById, registersAlive } from "../model/state.ts";
import { effectGraph } from "../model/effect-graph.ts";

import { currentAt, cycleOf } from "./context.ts";

export function effectActive(
  state: GameState,
  effect: Effect,
  at: DeadAt = currentAt(state),
  graph: Graph | null = null,
): boolean {
  if (!effect || effect.active === false) return false;
  if (effect.start && cycleOf(at) < cycleOf(effect.start)) return false;
  if (effect.expires && cycleOf(at) >= cycleOf(effect.expires)) return false;
  if (effect.kind === "role-change") return true;
  // A placed Witch curse stays until it resolves or three players live; the
  // source's later death or impairment does not remove it (Witch r3013).
  if (effect.kind === "witch") return true;
  // The Cerenovus already chose at night: the player stays mad during that day
  // even if the source is executed or dies before the day begins.
  if (effect.kind === "madness" && effect.madness === "cerenovus") return true;

  const resolved = graph || effectGraph(state, at);
  if (!resolved.ok) return false;
  if (effect.kind === "drunk") return resolved.activeDrunk.has(effect.id);
  if (effect.kind === "poison") return resolved.activePoison.has(effect.id);

  const source = effect.sourceId == null ? null : playerById(state, effect.sourceId);
  if (!source || !source.alive) return false;
  return !resolved.impaired.has(String(source.id));
}

export function activeEffects(
  state: GameState,
  kind: string | null,
  at: DeadAt = currentAt(state),
): Effect[] {
  const graph = effectGraph(state, at);
  return state.effects.filter(
    (effect) => (!kind || effect.kind === kind) && effectActive(state, effect, at, graph),
  );
}

export function isImpaired(
  state: GameState,
  playerId: string,
  at: DeadAt = currentAt(state),
): boolean {
  if (!playerById(state, playerId)) return false;
  const graph = effectGraph(state, at);
  return graph.ok && graph.impaired.has(String(playerId));
}

export function protectionFor(
  state: GameState,
  targetId: string,
  at: DeadAt = currentAt(state),
): Effect | null {
  return (
    activeEffects(state, "protected", at).find((effect) => effect.targetId === targetId) || null
  );
}

export function soldierSafe(
  state: GameState,
  playerId: string,
  at: DeadAt = currentAt(state),
): boolean {
  const player = playerById(state, playerId);
  return Boolean(player && player.roleId === "soldier" && !isImpaired(state, playerId, at));
}

export function mayorRedirects(
  state: GameState,
  playerId: string,
  at: DeadAt = currentAt(state),
): boolean {
  const player = playerById(state, playerId);
  return Boolean(player && player.roleId === "mayor" && !isImpaired(state, playerId, at));
}

export function butlerMaster(
  state: GameState,
  playerId: string,
  at: DeadAt = currentAt(state),
): string | null {
  const player = playerById(state, playerId);
  if (!player || player.roleId !== "butler" || isImpaired(state, playerId, at)) return null;
  const effect = activeEffects(state, "butler", at).find(
    (candidate) => candidate.sourceId === playerId,
  );
  return effect ? effect.targetId : null;
}

// ---------------------------------------------------------------------------
// Registration choices. Only Spy and Recluse can change how they register.

// ---------------------------------------------------------------------------
// Bad Moon Rising protection and drunk effects

export function bmrDrunkEffect(
  state: GameState,
  playerId: string,
  at: DeadAt = currentAt(state),
): Effect | null {
  return (
    state.effects.find(
      (effect) =>
        effect.kind === "drunk" && effect.targetId === playerId && effectActive(state, effect, at),
    ) || null
  );
}

// The Tea Lady's neighbours are the nearest living players on each side of
// her seat, not necessarily the adjacent seats: dead players are skipped.
function neighbourPair(state: GameState, playerId: string): string[] {
  const ids = (state.order || []).map(String);
  const seat = ids.indexOf(String(playerId));
  if (seat === -1) return [];
  const nearest = (direction: number): string | null => {
    for (let step = 1; step < ids.length; step += 1) {
      const id = ids[(seat + direction * step + ids.length * step) % ids.length]!;
      const player = playerById(state, id);
      if (player && registersAlive(player)) return id;
    }
    return null;
  };
  const before = nearest(-1);
  const after = nearest(1);
  return [...new Set([before, after].filter((id) => id !== null))];
}

function teaLadyProtects(state: GameState, targetId: string, at: DeadAt): string | null {
  if (
    !state.script ||
    !Array.isArray(state.script.roles) ||
    !state.script.roles.includes("tealady")
  )
    return null;
  const players = Object.values(state.players || {});
  const teaLady = players.find(
    (player) => player.roleId === "tealady" && player.alive && !isImpaired(state, player.id, at),
  );
  if (!teaLady) return null;
  const neighbours = neighbourPair(state, teaLady.id);
  if (!neighbours.includes(String(targetId))) return null;
  // A drunk or poisoned neighbour still counts as good: only their alignment
  // matters for the Tea Lady. The Tea Lady herself must not be impaired.
  const bothGood = neighbours.every((id) => {
    const player = playerById(state, id);
    return player !== null && registersAlive(player) && player.team === "good";
  });
  if (!bothGood) return null;
  return "tea-lady";
}

export function bmrCannotDie(
  state: GameState,
  playerId: string,
  at: DeadAt = currentAt(state),
  context: { cause?: string; bypassProtection?: boolean } = {},
): string | null {
  const player = playerById(state, playerId);
  if (!player) return null;
  const cause = context.cause || "";
  const bypass = context.bypassProtection === true;
  const sober = !isImpaired(state, playerId, at);
  // The Zombuul's first death is replaced, not prevented, so even an Assassin
  // cannot take it while the ability works. Every other protection is bypassed
  // by the Assassin.
  if (player.roleId === "zombuul" && sober && !(player.used && player.used.zombuul))
    return "zombuul";
  if (bypass) return null;
  if (cause === "execution") {
    const advocate = state.effects.find(
      (effect) =>
        effect.kind === "devilsadvocate" &&
        effect.targetId === playerId &&
        effectActive(state, effect, at) &&
        effect.day === at.number,
    );
    if (advocate) return "devilsadvocate";
  }
  if (player.roleId === "soldier" && sober && (cause === "demon" || cause === "ability"))
    return "soldier";
  // Sailor r1768: "You can't die." The sober Sailor survives any cause,
  // including an execution; only a bypassing ability (the Assassin) kills.
  if (player.roleId === "sailor" && sober) return "sailor";
  if (teaLadyProtects(state, playerId, at)) return "tea-lady";
  const innkeeper = state.effects.find(
    (effect) =>
      effect.kind === "protected" &&
      effect.targetId === playerId &&
      effectActive(state, effect, at) &&
      effect.bmr === "innkeeper" &&
      (cause === "demon" || cause === "ability"),
  );
  if (innkeeper) return "innkeeper";
  // Fool r2636: the ability is spent only when it was the reason the death was
  // prevented, so the Tea Lady and Innkeeper protections resolve first.
  if (player.roleId === "fool" && sober && !(player.used && player.used.fool)) return "fool";
  return null;
}
