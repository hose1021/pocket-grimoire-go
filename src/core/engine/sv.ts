import type { DeadAt, GameState, JugglerGuess, NightStep, Player, RoleId } from "../model/types.ts";

type StepSpec = {
  targetMode?: string;
  minTargets?: number;
  maxTargets?: number;
  infoKind?: string;
  optional?: boolean;
  canKill?: boolean;
  canResurrect?: boolean;
  note?: string | null;
  roleChoices?: RoleId[];
  [key: string]: unknown;
};
type SvOptions = {
  targetIds?: string[];
  given?: Record<string, unknown>;
  redirectId?: string | null;
  registrations?: Record<string, string>;
  roleId?: RoleId | null;
  targetId?: string | null;
  deathIds?: string[];
  poisonId?: string | null;
  resurrectId?: string | null;
};
type SvInfoOptions = { targetIds?: string[]; registrations?: Record<string, string> };

// Sects and Violets scenario support. Host-adjudicated: the Storyteller runs
// the printed abilities; the engine owns the official night order, setup
// prompts, death bookkeeping, No Dashii poison, Fang Gu succession and the
// Vortox/Evil Twin/Witch win conditions.
import { isSupportedRole, nightSequence, roleLabel, roleTeam } from "../model/rules.ts";

import { livingPlayers, nowIso, orderedPlayers, playerById, realTeamOf } from "../model/state.ts";

import { addLog, currentAt, dayAt, insertStepInto, nightAt } from "./context.ts";
import { checkWin, evilTwinPair, kill, setWinner } from "./death.ts";
import { activeEffects, isImpaired } from "./effects.ts";
import { setStepNote } from "./night.ts";
import { minionRetainsAbility, vigormortisActive } from "./retention.ts";

const DEMON_ROLES = new Set(["fanggu", "nodashii", "vigormortis", "vortox"]);

// The Fang Gu's ONCE reminder stays in the centre for the whole game, even
// after the Demon changes character (wiki r2974). Older saves recorded it only
// on the acting Demon, so honour that marker too.
function fangguJumpUsed(state: GameState): boolean {
  if (state.fangguJumped) return true;
  return Object.values(state.players || {}).some(
    (player) => player && player.used && player.used.fanggu === true,
  );
}

const GOOD_ROLES = (state: GameState): RoleId[] =>
  (state.script && state.script.roles ? state.script.roles : []).filter(
    (/** @type {RoleId} */ id) => roleTeam(id) === "townsfolk" || roleTeam(id) === "outsider",
  );

export const MADNESS_PENALTIES = ["execute", "none"] as const;

// Madness is a stored requirement, not a table note: an effect names its
// source, the mad player, the character (or the Outsider condition) and its
// expiry. The Cerenovus token lasts until the next night; the Mutant's standing
// requirement lasts while the holder is a living Mutant. The penalty stays a
// Storyteller decision and is recorded through the `madnessPenalty` command.
export function madnessEffects(state: GameState, at: DeadAt = currentAt(state)) {
  return activeEffects(state, "madness", at);
}

export function activeMadness(
  state: GameState,
  playerId: string,
  at: DeadAt = currentAt(state),
): (typeof state.effects)[number] | null {
  return madnessEffects(state, at).find((effect) => effect.targetId === playerId) || null;
}

/** Active madness that still needs a Storyteller decision before this day ends. */
export function madnessReviewsDue(state: GameState) {
  const at = dayAt(state);
  return madnessEffects(state, at).filter((effect) => effect.decidedDay !== at.number);
}

export function reconcileMutantMadness(state: GameState) {
  for (const effect of state.effects) {
    if (effect.kind !== "madness" || effect.madness !== "mutant") continue;
    const holder = effect.targetId == null ? null : playerById(state, effect.targetId);
    const remains = Boolean(holder && holder.alive && holder.roleId === "mutant");
    if (effect.active !== remains) effect.active = remains;
  }
  for (const player of orderedPlayers(state)) {
    if (player.roleId !== "mutant" || !player.alive) continue;
    const id = "eff-madness-mutant-" + player.id;
    if (state.effects.some((effect) => effect.id === id)) continue;
    state.effects.push({
      id,
      kind: "madness",
      madness: "mutant",
      roleId: null,
      sourceId: player.id,
      targetId: player.id,
      start: currentAt(state),
      expires: null,
      active: true,
    });
  }
}

// "Townsfolk abilities yield false info" (Vortox r3017). Only a living,
// unimpaired Vortox does so; an impaired actor also gets no true information.
function vortoxFalsifies(state: GameState, roleId: RoleId | null): boolean {
  if (!roleId || roleTeam(roleId) !== "townsfolk") return false;
  return orderedPlayers(state).some(
    (player) =>
      player.roleId === "vortox" && player.alive && !isImpaired(state, player.id, currentAt(state)),
  );
}

function numberChoices(max: number): number[] {
  const out: number[] = [];
  for (let index = 0; index <= Math.max(0, max); index += 1) out.push(index);
  return out;
}

// The day that just ended, read by the next night's "today" questions.
function lastDayFor(state: GameState) {
  const night = nightAt(state).number;
  const day = state.lastDay;
  return day &&
    typeof day.number === "number" &&
    Array.isArray(day.nominations) &&
    day.number === night - 1
    ? day
    : null;
}

// The nearest Townsfolk on each side of a seat, clockwise first. The official
// ability says "1 Townsfolk neighbor" without naming one, so the first entry is
// the deterministic default and every entry is a legal host choice.
function nearestTownsfolkIds(state: GameState, playerId: string): string[] {
  const ids = state.order.map(String);
  const seat = ids.indexOf(playerId);
  if (seat === -1) return [];
  const found: string[] = [];
  for (const direction of [1, -1]) {
    for (let step = 1; step < ids.length; step += 1) {
      const id = ids[(seat + direction * step + ids.length * step) % ids.length]!;
      const player = playerById(state, id);
      if (player && roleTeam(player.roleId || "") === "townsfolk") {
        found.push(id);
        break;
      }
    }
  }
  return found;
}

// The legal poison neighbours of a Minion the Vigormortis killed (r3015). The
// console offers these and `recordSvOutcome` validates the host's choice with
// the same list, so the screen and the engine cannot disagree.
export function vigormortisPoisonChoices(
  state: GameState,
  deathId: string | null | undefined,
): string[] {
  if (!deathId) return [];
  const player = playerById(state, deathId);
  if (!player || roleTeam(player.roleId || "") !== "minion") return [];
  return nearestTownsfolkIds(state, player.id);
}

function svStepKey(
  state: GameState,
  index: number,
  roleId: RoleId | null,
  actorId: string | null,
): string {
  return ["n" + nightAt(state).number, index, roleId || "system", actorId || "all"].join("-");
}

function stepSpec(roleId: RoleId, night: number): StepSpec | null {
  if (night === 1) {
    return (
      {
        philosopher: { targetMode: "none", optional: true, infoKind: "note" },
        snakecharmer: { targetMode: "one-any", infoKind: "note" },
        eviltwin: { targetMode: "none", infoKind: "note" },
        witch: { targetMode: "one-any", infoKind: "note" },
        cerenovus: { targetMode: "one-any", infoKind: "note" },
        clockmaker: { targetMode: "none", infoKind: "number" },
        dreamer: { targetMode: "one-any", infoKind: "note" },
        seamstress: { targetMode: "two", optional: true, infoKind: "note" },
        mathematician: { targetMode: "none", infoKind: "number" },
      }[roleId] || null
    );
  }
  return (
    {
      philosopher: { targetMode: "none", optional: true, infoKind: "note" },
      snakecharmer: { targetMode: "one-any", infoKind: "note" },
      witch: { targetMode: "one-any", infoKind: "note" },
      cerenovus: { targetMode: "one-any", infoKind: "note" },
      pithag: { targetMode: "one-any", infoKind: "note", canKill: true },
      fanggu: { targetMode: "one-any", canKill: true },
      nodashii: { targetMode: "one-any", canKill: true },
      vortox: { targetMode: "one-any", canKill: true },
      vigormortis: { targetMode: "one-any", canKill: true },
      barber: { targetMode: "two", optional: true, infoKind: "note" },
      sweetheart: { targetMode: "one-any", infoKind: "note" },
      sage: { targetMode: "none", infoKind: "note" },
      dreamer: { targetMode: "one-any", infoKind: "note" },
      flowergirl: { targetMode: "none", infoKind: "yes-no" },
      towncrier: { targetMode: "none", infoKind: "yes-no" },
      oracle: { targetMode: "none", infoKind: "number" },
      seamstress: { targetMode: "two", optional: true, infoKind: "note" },
      juggler: { targetMode: "none", infoKind: "number" },
      mathematician: { targetMode: "none", infoKind: "number" },
    }[roleId] || null
  );
}

// Death-triggered wakes. They are not in the printed night order, so their
// steps are built from these specs when the death happens.
const DEATH_WAKE_SPECS: Record<string, StepSpec> = {
  barber: { targetMode: "two", optional: true, infoKind: "note" },
  sweetheart: { targetMode: "one-any", infoKind: "note" },
  sage: { targetMode: "none", infoKind: "note" },
  klutz: { targetMode: "one-any", infoKind: "note" },
};

function diedRecently(state: GameState, playerId: string): boolean {
  const night = nightAt(state).number;
  return state.deaths.some(
    (death) =>
      !death.fake &&
      death.playerId === playerId &&
      ((death.phase === "night" && death.number === night) ||
        (death.phase === "day" && death.number === night - 1)),
  );
}

function diedByDemon(state: GameState, playerId: string): boolean {
  const night = nightAt(state).number;
  return state.deaths.some(
    (death) =>
      !death.fake &&
      death.playerId === playerId &&
      death.demon === true &&
      ((death.phase === "night" && death.number === night) ||
        (death.phase === "day" && death.number === night - 1)),
  );
}

// The Juggler's public guesses. The command stores a list of pairs because the
// same player may be guessed more than once with different characters; a saved
// game may still carry the legacy player-id map, which both shapes are read for.
function jugglerGuesses(state: GameState): JugglerGuess[] {
  const stored = state.juggler ? state.juggler.guesses : null;
  if (!stored) return [];
  if (Array.isArray(stored)) {
    return stored
      .filter(
        (entry) => entry && typeof entry.playerId === "string" && typeof entry.roleId === "string",
      )
      .map((entry) => ({ playerId: String(entry.playerId), roleId: String(entry.roleId) }));
  }
  return Object.entries(stored).map(([playerId, roleId]) => ({ playerId, roleId: String(roleId) }));
}

function stepAllowed(
  state: GameState,
  roleId: RoleId,
  actor: Player | null,
  _night: number,
): boolean {
  if (!actor) return false;
  if (roleId === "barber") return !actor.alive && diedRecently(state, actor.id);
  if (roleId === "sweetheart") return !actor.alive && diedRecently(state, actor.id);
  if (roleId === "sage") return !actor.alive && diedByDemon(state, actor.id);
  if (roleId === "klutz")
    return !actor.alive && diedRecently(state, actor.id) && !(actor.used && actor.used.klutz);
  if (!actor.alive && !minionRetainsAbility(state, actor.id)) return false;
  if (roleId === "philosopher") return !(actor.used && actor.used.philosopher);
  if (roleId === "seamstress") return !(actor.used && actor.used.seamstress);
  if (roleId === "juggler") {
    // "On your 1st day": the step follows the day the guesses were made, and
    // zero guesses is a legal answer.
    const guessingDay =
      state.juggler && typeof state.juggler.day === "number" ? state.juggler.day : null;
    return !(actor.used && actor.used.juggler) && guessingDay === nightAt(state).number - 1;
  }
  if (roleId === "witch") return livingPlayers(state).length > 3;
  return true;
}

function makeStep(
  state: GameState,
  index: number,
  roleId: RoleId,
  actor: Player | null,
  spec: StepSpec,
): NightStep {
  const targetMode = spec.targetMode || "none";
  const minTargets =
    spec.minTargets != null
      ? spec.minTargets
      : targetMode === "none"
        ? 0
        : targetMode === "two"
          ? 2
          : 1;
  const maxTargets =
    spec.maxTargets != null
      ? spec.maxTargets
      : targetMode === "none"
        ? 0
        : targetMode === "two"
          ? 2
          : 1;
  const extra: Record<string, unknown> = {};
  if (roleId === "philosopher" || roleId === "cerenovus") {
    extra.roleChoices = GOOD_ROLES(state);
  }
  if (roleId === "pithag") {
    // The Storyteller may name a character already in play: the rule says
    // nothing happens, so every script character stays selectable.
    extra.roleChoices = (state.script && state.script.roles ? state.script.roles : []).slice();
  }
  return {
    key: svStepKey(state, index, roleId, actor ? actor.id : null),
    kind: "role",
    sv: true,
    roleId,
    actorId: actor ? actor.id : null,
    actorName: actor ? actor.name : "",
    actorAlive: actor ? actor.alive : false,
    order: index,
    targetMode,
    minTargets,
    maxTargets,
    infoKind: spec.infoKind || "none",
    optional: Boolean(spec.optional),
    canKill: Boolean(spec.canKill),
    targetIds: [],
    given: null,
    result: null,
    note: null,
    pending: null,
    done: false,
    skipped: false,
    completedAt: null,
    ...extra,
  };
}

function infoStep(state: GameState, index: number, system: string): NightStep | null {
  const size = orderedPlayers(state).length;
  if (nightAt(state).number !== 1 || size < 7) return null;
  const living = livingPlayers(state);
  const minions = living.filter((player) => roleTeam(player.roleId || "") === "minion");
  const demon = living.find((player) => roleTeam(player.roleId || "") === "demon");
  if (!minions.length || !demon) return null;
  if (system === "minioninfo") {
    return {
      key: svStepKey(state, index, "minioninfo", null),
      kind: "system",
      system: "minioninfo",
      roleId: null,
      actorId: null,
      actorIds: minions.map((player) => player.id),
      order: index,
      targetMode: "none",
      minTargets: 0,
      maxTargets: 0,
      infoKind: "minion-info",
      targetIds: [],
      demonId: demon.id,
      given: null,
      result: null,
      note: null,
      pending: null,
      done: false,
      skipped: false,
      completedAt: null,
    };
  }
  return {
    key: svStepKey(state, index, "demoninfo", null),
    kind: "system",
    system: "demoninfo",
    roleId: null,
    actorId: null,
    actorIds: [demon.id],
    order: index,
    targetMode: "none",
    minTargets: 0,
    maxTargets: 0,
    infoKind: "demon-info",
    targetIds: [],
    demonId: demon.id,
    bluffs: (state.bluffs || []).slice(),
    given: null,
    result: null,
    note: null,
    pending: null,
    done: false,
    skipped: false,
    completedAt: null,
  };
}

type SvStepResult = { ok: true } | { ok: false; errorCode: string; error: string };

function holderOf(state: GameState, roleId: RoleId): Player | null {
  return orderedPlayers(state).find((player) => player.roleId === roleId) || null;
}

// The Philosopher's drunk follows the chosen character: it exists while that
// character is in play and its owner is a different seat only when the
// Philosopher chose their own character. The effect ends when the Philosopher
// dies or is impaired; effectGraph enforces that for philosopher effects.
function reconcilePhilosopherDrunk(state: GameState) {
  const wanted = new Map<string, { sourceId: string; targetId: string }>();
  for (const player of orderedPlayers(state)) {
    if (player.roleId !== "philosopher") continue;
    const ability = player.used ? player.used.philosopherAbility : null;
    if (typeof ability !== "string") continue;
    const owner = holderOf(state, ability as RoleId);
    if (!owner) continue;
    wanted.set("eff-philosopher-" + player.id + "-" + owner.id, {
      sourceId: player.id,
      targetId: owner.id,
    });
  }
  for (const effect of state.effects) {
    if (effect.philosopher !== true) continue;
    const want = wanted.get(effect.id);
    if (want && want.targetId === effect.targetId && effect.active !== false) continue;
    effect.active = false;
  }
  for (const [id, want] of wanted) {
    const existing = state.effects.find((effect) => effect.id === id);
    if (existing && existing.active !== false) continue;
    const at = currentAt(state);
    if (existing) {
      existing.active = true;
      existing.targetId = want.targetId;
      existing.start = at;
      continue;
    }
    state.effects.push({
      id,
      kind: "drunk",
      philosopher: true,
      sourceId: want.sourceId,
      targetId: want.targetId,
      start: at,
      expires: null,
      active: true,
    });
  }
}

// Recalculate the current night after a character change: the changed player
// loses their unfinished step of the old character and gains one for the new
// character when its official wake time is still ahead. A wake whose slot has
// already passed is not retroactively added.
function requeueForCharacter(
  state: GameState,
  player: Player,
  order: number,
  currentKey: string | null,
  suppressWake: boolean = false,
) {
  for (const step of state.night.queue) {
    if (step.done || step.skipped || step.key === currentKey) continue;
    if (step.actorId !== player.id) continue;
    step.done = true;
    step.skipped = true;
    setStepNote(step, "note.characterChanged", null, "Персонаж сменился до пробуждения.");
  }
  if (state.phase !== "night" || !player.roleId) return;
  // Pit-Hag r2998: "if a Demon is made, deaths tonight are arbitrary". The
  // created Demon does not take the normal Demon turn, so its slot is not
  // added; the host records the arbitrary deaths on the Pit-Hag step.
  if (suppressWake && roleTeam(player.roleId) === "demon") return;
  const night = nightAt(state).number;
  const roleId = player.roleId;
  const spec = stepSpec(roleId, night);
  const index = nightSequence(night, "snv").indexOf(roleId);
  if (!spec || index === -1 || index <= order) return;
  if (!player.alive || !stepAllowed(state, roleId, player, night)) return;
  const step = makeStep(state, index, roleId, player, spec);
  if (state.night.queue.some((candidate) => candidate.key === step.key)) return;
  insertStepInto(state.night.queue, step);
}

// Atomically replace one player's character: the character, the shown
// character, the Evil Twin reference, the demon bluffs and the current night's
// queue. The alignment is not part of the change (Pit-Hag r2998: "The
// character changes, but the alignment does not"). Callers must reject a
// character already in play first.
export function replaceCharacter(
  state: GameState,
  playerId: string,
  roleId: RoleId,
  options: { order?: number; currentKey?: string | null; suppressWake?: boolean } = {},
): SvStepResult {
  const player = playerById(state, playerId);
  if (!player) return { ok: false, errorCode: "error.1", error: "Игрок не найден." };
  if (player.roleId === roleId) return { ok: true };
  const previous = player.roleId;
  // Pin the current alignment first: a character change never changes it, even
  // when the saved team is still null.
  player.team = realTeamOf(player);
  player.changedFrom = previous;
  player.roleId = roleId;
  player.shownRoleId = roleId;
  if (player.used) {
    if (previous === "philosopher") delete player.used.philosopherAbility;
    // A player who gains the character again has a fresh once-per-game ability.
    if (roleId === "philosopher") delete player.used.philosopher;
  }
  if (Array.isArray(state.bluffs)) state.bluffs = state.bluffs.filter((id) => id !== roleId);
  // Evil Twin r2964: "You & an opposing player know each other." A twin created
  // mid-game still needs a partner, otherwise both the execution win and the
  // "good can't win" block disappear.
  if (roleId === "eviltwin") {
    state.setup.evilTwinPlayerId = player.id;
    const stored = state.setup.evilTwinGoodPlayerId;
    const current = typeof stored === "string" ? playerById(state, stored) : null;
    const goodTwin =
      current && current.alive && current.id !== player.id && realTeamOf(current) === "good"
        ? current
        : orderedPlayers(state).find(
            (candidate) =>
              candidate.alive && candidate.id !== player.id && realTeamOf(candidate) === "good",
          ) || null;
    state.setup.evilTwinGoodPlayerId = goodTwin ? goodTwin.id : null;
  }
  requeueForCharacter(
    state,
    player,
    options.order || 0,
    options.currentKey ?? null,
    options.suppressWake === true,
  );
  reconcileNoDashiiPoison(state);
  reconcileVigormortisPoison(state);
  reconcilePhilosopherDrunk(state);
  return { ok: true };
}

// Swap two characters without changing who is seated. The Evil Twin pair is
// tracked by the `evilTwinGoodPlayerId`/`evilTwinPlayerId` player ids, so a swap
// needs no reference rewrite. `alignments` exchanges the current teams instead
// of following the characters: the Snake Charmer swaps alignments (r2905), the
// Barber does not (r1757).
function swapCharacters(
  state: GameState,
  first: Player,
  second: Player,
  options: { order?: number; currentKey?: string | null; alignments?: boolean } = {},
) {
  const firstRole = first.roleId;
  const secondRole = second.roleId;
  if (!firstRole || !secondRole || firstRole === secondRole) return;
  const firstTeam = realTeamOf(first);
  const secondTeam = realTeamOf(second);
  for (const [player, roleId, team] of [
    [first, secondRole, secondTeam],
    [second, firstRole, firstTeam],
  ] as Array<[Player, RoleId, "good" | "evil" | null]>) {
    player.changedFrom = player.roleId;
    player.roleId = roleId;
    player.shownRoleId = roleId;
    if (options.alignments) player.team = team;
    if (player.used) {
      if (roleId !== "philosopher") delete player.used.philosopherAbility;
      else delete player.used.philosopher;
    }
  }
  requeueForCharacter(state, first, options.order || 0, options.currentKey ?? null);
  requeueForCharacter(state, second, options.order || 0, options.currentKey ?? null);
  reconcileNoDashiiPoison(state);
  reconcileVigormortisPoison(state);
  reconcilePhilosopherDrunk(state);
}

// A Philosopher keeps using the borrowed ability on later nights, including a
// death-triggered ability after their own death. The step belongs to the
// Philosopher, not to the character they borrowed.
function philosopherAbilityStep(state: GameState, player: Player): NightStep | null {
  if (player.roleId !== "philosopher") return null;
  const ability = player.used ? player.used.philosopherAbility : null;
  if (typeof ability !== "string") return null;
  const roleId = ability as RoleId;
  const night = nightAt(state).number;
  const spec = stepSpec(roleId, night);
  const index = nightSequence(night, "snv").indexOf(roleId);
  if (!spec || index === -1 || !stepAllowed(state, roleId, player, night)) return null;
  return makeStep(state, index, roleId, player, spec);
}

export function buildSvNightQueue(state: GameState): NightStep[] {
  const night = nightAt(state).number;
  const sequence = nightSequence(night, "snv");
  const steps: NightStep[] = [];
  sequence.forEach((roleId, index) => {
    if (roleId === "info") {
      const minion = infoStep(state, index, "minioninfo");
      if (minion) steps.push(minion);
      const demon = infoStep(state, index + 0.1, "demoninfo");
      if (demon) steps.push(demon);
      return;
    }
    const spec = stepSpec(roleId, night);
    if (!spec) return;
    // A Demon role can have two holders after a Fang Gu jump or a Pit-Hag
    // change: the dead old Demon and the living new one. The living holder is
    // the one that wakes.
    const holders = orderedPlayers(state).filter((player) => player.roleId === roleId);
    const actor =
      roleTeam(roleId) === "demon"
        ? holders.find((player) => player.alive) || holders[0]
        : holders[0];
    if (!actor || !stepAllowed(state, roleId, actor, night)) return;
    steps.push(makeStep(state, index, roleId, actor, spec));
  });
  for (const player of orderedPlayers(state)) {
    const step = philosopherAbilityStep(state, player);
    if (step && !steps.some((candidate) => candidate.key === step.key)) {
      insertStepInto(steps, step);
    }
  }
  reconcileNoDashiiPoison(state);
  reconcileVigormortisPoison(state);
  return steps;
}

// The No Dashii poisons the nearest Townsfolk on each side by role, not by
// living status: a dead Townsfolk is still the nearest Townsfolk. Recompute and
// reconcile the active effects after role changes, deaths and source loss.
export function reconcileNoDashiiPoison(state: GameState) {
  const sources = orderedPlayers(state).filter(
    (player) =>
      player.roleId === "nodashii" &&
      player.alive &&
      !isImpaired(state, player.id, currentAt(state)),
  );
  const targets = new Map();
  for (const source of sources) {
    const ids = state.order.map(String);
    const seat = ids.indexOf(source.id);
    if (seat === -1) {
      targets.set(source.id, new Set());
      continue;
    }
    const nearestTownsfolk = (direction: number): string | null => {
      for (let step = 1; step < ids.length; step += 1) {
        const id = ids[(seat + direction * step + ids.length * step) % ids.length]!;
        const player = playerById(state, id);
        if (player && roleTeam(player.roleId || "") === "townsfolk") return id;
      }
      return null;
    };
    targets.set(source.id, new Set([nearestTownsfolk(-1), nearestTownsfolk(1)].filter(Boolean)));
  }
  for (const effect of state.effects) {
    // A permanent poison (the Snake Charmer's) is not a No Dashii poison, even
    // when its source later becomes the No Dashii.
    if (effect.kind !== "poison" || effect.permanent === true) continue;
    const source = effect.sourceId == null ? null : playerById(state, effect.sourceId);
    const isNoDashii = effect.nodashii === true || (source && source.roleId === "nodashii");
    if (!isNoDashii) continue;
    const allowed = targets.get(effect.sourceId);
    if (!allowed || effect.targetId == null || !allowed.has(effect.targetId)) effect.active = false;
  }
  for (const [sourceId, wanted] of targets) {
    for (const targetId of wanted) {
      const exists = state.effects.some(
        (effect) =>
          effect.kind === "poison" &&
          effect.nodashii === true &&
          effect.sourceId === sourceId &&
          effect.targetId === targetId &&
          effect.active,
      );
      if (exists) continue;
      state.effects.push({
        id: "eff-nodashii-" + sourceId + "-" + targetId,
        kind: "poison",
        nodashii: true,
        sourceId,
        targetId,
        start: currentAt(state),
        expires: null,
        active: true,
      });
    }
  }
  // The Mutant's madness is a standing condition, not a nightly choice: it
  // follows the character holder and ends with its life or its impairment.
  reconcileMutantMadness(state);
}

// The killed Minion's poison holds while a living, unimpaired Vigormortis
// exists and the dead source is still a Minion (r3015). Recompute after
// deaths, character changes and source loss.
export function reconcileVigormortisPoison(state: GameState) {
  const active = vigormortisActive(state);
  for (const effect of state.effects) {
    if (effect.vigormortis !== true) continue;
    const source = effect.sourceId == null ? null : playerById(state, effect.sourceId);
    // The permanent poison outlives its dead source, but not the source's own
    // impairment: a drunk or poisoned dead Minion's ability does nothing, so
    // the neighbour is healthy until the Minion is sober and healthy again.
    const shouldBeActive = Boolean(
      active &&
      source &&
      roleTeam(source.roleId || "") === "minion" &&
      !isImpaired(state, source.id, currentAt(state)),
    );
    if (effect.active !== shouldBeActive) effect.active = shouldBeActive;
  }
}

export function svInfoForStep(state: GameState, step: NightStep, options: SvInfoOptions = {}) {
  const actor = step.actorId ? playerById(state, step.actorId) : null;
  const role = step.roleId;
  const impaired = actor ? isImpaired(state, actor.id, currentAt(state)) : false;
  const targetIds = options.targetIds || step.targetIds || [];
  const target = targetIds[0] ? playerById(state, targetIds[0]) : null;

  if (role === "eviltwin") {
    const twin = evilTwinPair(state)?.good ?? null;
    return {
      kind: "note",
      textKey: "note.sv.evilTwin",
      textVars: {
        actor: actor ? actor.name : "—",
        twin: twin ? twin.name + " (" + roleLabel(twin.roleId) + ")" : "—",
      },
      text:
        "Покажите Близнецам друг друга: " +
        (actor ? actor.name : "—") +
        " и " +
        (twin ? twin.name + " (" + roleLabel(twin.roleId) + ")" : "—") +
        ".",
    };
  }
  if (role === "clockmaker") {
    const demon = livingPlayers(state).find((player) => roleTeam(player.roleId || "") === "demon");
    const minions = livingPlayers(state).filter(
      (player) => roleTeam(player.roleId || "") === "minion",
    );
    const ids = state.order;
    let distance = null;
    if (demon && minions.length) {
      const seat = ids.indexOf(demon.id);
      distance = Math.min(
        ...minions.map((minion) => {
          const atSeat = ids.indexOf(minion.id);
          const raw = Math.abs(atSeat - seat);
          return Math.min(raw, ids.length - raw);
        }),
      );
    }
    const value = distance == null ? 0 : distance;
    const falsified = impaired || vortoxFalsifies(state, role);
    return {
      kind: "number",
      value,
      impaired,
      needsChoice: falsified,
      options: falsified
        ? numberChoices(orderedPlayers(state).length).filter((choice) => choice !== value)
        : [],
      textKey: "note.sv.clockmaker",
      textVars: { value },
      falsifiedSuffix: falsified,
      text:
        "Расстояние от Демона до ближайшего Приспешника: " +
        value +
        (falsified ? ". Ведущий даёт ложную информацию: выберите число." : "."),
    };
  }
  if (role === "oracle") {
    const value = orderedPlayers(state).filter(
      (player) => !player.alive && realTeamOf(player) === "evil",
    ).length;
    const falsified = impaired || vortoxFalsifies(state, role);
    return {
      kind: "number",
      value,
      impaired,
      needsChoice: falsified,
      options: falsified
        ? numberChoices(orderedPlayers(state).length).filter((choice) => choice !== value)
        : [],
      textKey: "note.sv.oracle",
      textVars: { value },
      falsifiedSuffix: falsified,
      text:
        "Мёртвых злых игроков: " +
        value +
        (falsified ? ". Ведущий даёт ложную информацию: выберите число." : "."),
    };
  }
  if (role === "dreamer") {
    const falsified = impaired || vortoxFalsifies(state, role);
    return {
      kind: "note",
      impaired,
      needsChoice: falsified,
      textKey: target ? "note.sv.dreamer" : "note.sv.dreamerChoose",
      textVars: target ? { target: target.name } : {},
      falsifiedSuffix: falsified,
      text: target
        ? "Сон о " +
          target.name +
          ": покажите 1 добрую и 1 злую роль; одна из них — роль " +
          target.name +
          "." +
          (falsified
            ? " Ведущий даёт ложную информацию: ни одна из ролей не обязана быть верной."
            : "")
        : "Выберите игрока: покажите 1 добрую и 1 злую роль.",
    };
  }
  if (role === "seamstress") {
    const [a, b] = targetIds.map((id) => playerById(state, id));
    if (!a || !b) {
      return {
        kind: "yes-no",
        needsChoice: true,
        options: [true, false],
        textKey: "note.sv.seamstressChoose",
        text: "Выберите двух игроков.",
      };
    }
    const same = realTeamOf(a) === realTeamOf(b);
    const falsified = impaired || vortoxFalsifies(state, role);
    return {
      kind: "yes-no",
      value: same,
      impaired,
      needsChoice: falsified,
      options: falsified ? [true, false].filter((choice) => choice !== same) : [],
      textKey: same ? "note.sv.seamstressSame" : "note.sv.seamstressDifferent",
      textVars: { a: a.name, b: b.name },
      falsifiedSuffix: falsified,
      text:
        a.name +
        " и " +
        b.name +
        ": " +
        (same ? "на одной стороне." : "на разных сторонах.") +
        (falsified ? " Ведущий даёт ложную информацию." : ""),
    };
  }
  if (role === "sage") {
    const falsified = impaired || vortoxFalsifies(state, role);
    return {
      kind: "note",
      impaired,
      needsChoice: falsified,
      textKey: "note.sv.sage",
      falsifiedSuffix: falsified,
      text:
        "Демон убил Мудреца. Покажите 2 игроков, один из которых — Демон." +
        (falsified
          ? " Ведущий даёт ложную информацию: ни один из них не обязан быть Демоном."
          : ""),
    };
  }
  if (role === "sweetheart") {
    return {
      kind: "note",
      textKey: "note.sv.sweetheart",
      text: "Выберите игрока: он пьян до конца игры.",
    };
  }
  if (role === "barber") {
    return {
      kind: "note",
      textKey: "note.sv.barber",
      text: "Демон может выбрать двух игроков (не Демона) и поменять их роли.",
    };
  }
  if (role === "philosopher") {
    return {
      kind: "note",
      textKey: "note.sv.philosopher",
      text: "Выберите добрую роль; Философ получает её способность, а её владелец пьян.",
    };
  }
  if (role === "cerenovus") {
    return {
      kind: "note",
      textKey: "note.sv.cerenovus",
      text: "Выберите игрока и добрую роль: завтра он должен быть «помешан» на этой роли.",
    };
  }
  if (role === "pithag") {
    return {
      kind: "note",
      textKey: "note.sv.pithag",
      text: "Выберите игрока и роль: если роли нет в игре, он становится ею. Новый Демон убивает по решению ведущего.",
    };
  }
  if (role === "snakecharmer") {
    return {
      kind: "note",
      textKey: "note.sv.snakecharmer",
      text: "Если выбрали Демона, поменяйте роли и стороны; Демон становится отравлен.",
    };
  }
  if (role === "flowergirl" || role === "towncrier") {
    const day = lastDayFor(state);
    if (!day) {
      return {
        kind: "yes-no",
        impaired,
        needsChoice: true,
        hostAnswer: true,
        options: [true, false],
        textKey: "note.sv.noDay",
        text: "Нет данных о прошедшем дне: ведущий отвечает вручную.",
      };
    }
    const falsified = impaired || vortoxFalsifies(state, role);
    const value = Boolean(
      day.nominations.some((nomination) => {
        if (role === "towncrier") {
          const nominator = playerById(state, nomination.nominatorId);
          return Boolean(nominator && roleTeam(nominator.roleId || "") === "minion");
        }
        return (nomination.votes || []).some((id) => {
          const voter = playerById(state, String(id));
          return Boolean(voter && roleTeam(voter.roleId || "") === "demon");
        });
      }),
    );
    return {
      kind: "yes-no",
      value,
      impaired,
      needsChoice: falsified,
      options: falsified ? [true, false].filter((choice) => choice !== value) : [],
      textKey:
        role === "flowergirl"
          ? value
            ? "note.sv.flowergirlYes"
            : "note.sv.flowergirlNo"
          : value
            ? "note.sv.towncrierYes"
            : "note.sv.towncrierNo",
      falsifiedSuffix: falsified,
      text:
        (role === "flowergirl" ? "Демон голосовал сегодня: " : "Приспешник выдвигал сегодня: ") +
        (value ? "да." : "нет.") +
        (falsified ? " Ведущий даёт ложную информацию." : ""),
    };
  }
  if (role === "juggler") {
    const guesses = jugglerGuesses(state);
    const value = guesses.filter((guess) => {
      const player = playerById(state, guess.playerId);
      return Boolean(player && player.roleId === guess.roleId);
    }).length;
    const falsified = impaired || vortoxFalsifies(state, role);
    return {
      kind: "number",
      value,
      impaired,
      needsChoice: falsified,
      options: falsified ? numberChoices(5).filter((choice) => choice !== value) : [],
      textKey: "note.sv.juggler",
      textVars: { value, total: guesses.length },
      falsifiedSuffix: falsified,
      text:
        "Жонглёр угадал верно: " +
        value +
        " из " +
        guesses.length +
        "." +
        (falsified ? " Ведущий даёт ложную информацию: выберите число." : ""),
    };
  }
  if (role === "mathematician") {
    const falsified = impaired || vortoxFalsifies(state, role);
    return {
      kind: "note",
      impaired,
      needsChoice: falsified,
      textKey: "note.sv.mathematician",
      falsifiedSuffix: falsified,
      text:
        "Ведущий считает, у скольких игроков способность сработала некорректно." +
        (falsified ? " Ведущий даёт ложное число." : ""),
    };
  }
  return { kind: "none" };
}

// Klutz r1758: "When you learn that you died, publicly choose 1 alive player:
// if they are evil, your team loses." The choice happens at the death, so the
// host records it as soon as the player is told instead of waiting for a night
// wake; a player who dies before the choice is replaced, never a strand.
function resolveKlutzChoice(
  state: GameState,
  klutz: Player,
  step: NightStep | null,
  target: Player,
) {
  const at = currentAt(state);
  klutz.used = klutz.used || {};
  klutz.used.klutz = true;
  klutz.used.klutzTarget = target.id;
  let noteKey = "note.klutzNotEvil";
  let note = target.name + " не злой: команда Растяпы не проигрывает.";
  if (isImpaired(state, klutz.id, at)) {
    noteKey = "note.abilityFailed";
    note = "Способность не сработала: игрок отравлен или пьян.";
  } else if (realTeamOf(target) === "evil") {
    // The trigger is the target's evil alignment, not a comparison with the
    // Klutz's own team. An evil Klutz therefore loses for evil and good wins.
    const klutzTeam = realTeamOf(klutz) === "evil" ? "evil" : "good";
    noteKey = "note.klutzEvil";
    note = target.name + " злой: команда Растяпы проигрывает.";
    setWinner(state, klutzTeam === "evil" ? "good" : "evil", "klutz");
  }
  if (step) {
    step.targetIds = [target.id];
    setStepNote(step, noteKey, { name: target.name }, note);
    step.done = true;
    step.completedAt = nowIso();
  }
  addLog(state, {
    secret: true,
    kind: "ability",
    title: "Растяпа выбирает " + target.name,
    detail: note,
    playerId: klutz.id,
  });
}

/** Record the Klutz's public choice at the moment the player learns of the death. */
export function recordKlutzChoice(state: GameState, targetId: string): SvStepResult {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  const klutz = orderedPlayers(state).find(
    (player) => player.roleId === "klutz" && !player.alive && !(player.used && player.used.klutz),
  );
  if (!klutz) return { ok: false, errorCode: "error.29", error: "Растяпа не может выбрать." };
  const target = playerById(state, targetId);
  if (!target || !target.alive) {
    return { ok: false, errorCode: "error.55", error: "Нельзя выбрать мёртвого игрока." };
  }
  const step =
    state.night.queue.find(
      (candidate) =>
        candidate.roleId === "klutz" && candidate.actorId === klutz.id && !candidate.done,
    ) || null;
  resolveKlutzChoice(state, klutz, step, target);
  return { ok: true };
}

export function completeSvStep(
  state: GameState,
  step: NightStep,
  options: SvOptions = {},
): SvStepResult {
  const actor = step.actorId ? playerById(state, step.actorId) : null;
  if (!actor) return { ok: false, errorCode: "error.1", error: "Игрок не найден." };
  actor.used = actor.used || {};
  const targets = options.targetIds || [];
  const at = currentAt(state);
  const order = Number(step.order) || 0;
  const impaired = isImpaired(state, actor.id, at);

  if (step.roleId === "philosopher") {
    const roleId = options.roleId || null;
    if (!roleId) {
      setStepNote(step, "note.abilityUnused", null, "Способность не использована.");
      return { ok: true };
    }
    if (!GOOD_ROLES(state).includes(roleId)) {
      return { ok: false, errorCode: "error.2", error: "Выберите добрую роль из сценария." };
    }
    actor.used.philosopher = true;
    if (impaired) {
      setStepNote(
        step,
        "note.abilityFailed",
        null,
        "Способность не сработала: игрок отравлен или пьян.",
      );
      return { ok: true };
    }
    actor.used.philosopherAbility = roleId;
    const owner = holderOf(state, roleId);
    reconcilePhilosopherDrunk(state);
    if (owner) {
      setStepNote(
        step,
        "note.philosopherOwner",
        { owner: owner.name, role: roleLabel(roleId) },
        owner.name + " (" + roleLabel(roleId) + ") пьян: способность у Философа.",
      );
    } else {
      setStepNote(
        step,
        "note.philosopherAbility",
        { role: roleLabel(roleId) },
        "Философ получает способность: " + roleLabel(roleId) + ".",
      );
    }
    const borrowed = philosopherAbilityStep(state, actor);
    if (borrowed && !state.night.queue.some((candidate) => candidate.key === borrowed.key)) {
      insertStepInto(state.night.queue, borrowed);
    }
    return { ok: true };
  }

  if (step.roleId === "pithag") {
    const target = targets[0] ? playerById(state, targets[0]) : null;
    if (!target) return { ok: false, errorCode: "error.31", error: "Цель не найдена." };
    if (impaired) {
      setStepNote(
        step,
        "note.abilityFailed",
        null,
        "Способность не сработала: игрок отравлен или пьян.",
      );
      return { ok: true };
    }
    const roleId = options.roleId || null;
    if (
      !roleId ||
      !isSupportedRole(roleId) ||
      !(state.script && state.script.roles.includes(roleId))
    ) {
      return { ok: false, errorCode: "error.2", error: "Выберите роль из сценария." };
    }
    if (holderOf(state, roleId)) {
      // Pit-Hag r2988: the change happens only "if that character is not in
      // play". Choosing a character already in play is a legal outcome in
      // which nothing happens, not an error.
      setStepNote(
        step,
        "note.pithagInPlay",
        { role: roleLabel(roleId) },
        roleLabel(roleId) + " уже в игре: ничего не происходит.",
      );
      return { ok: true };
    }
    // "If a Demon is made, deaths tonight are arbitrary": the created Demon
    // does not wake in its own slot and the host records the deaths here.
    const createsDemon = roleTeam(roleId) === "demon";
    replaceCharacter(state, target.id, roleId, {
      order,
      currentKey: step.key,
      suppressWake: createsDemon,
    });
    if (createsDemon) step.canKill = true;
    setStepNote(
      step,
      "note.characterBecame",
      { name: target.name, role: roleLabel(roleId) },
      target.name +
        " становится: " +
        roleLabel(roleId) +
        (createsDemon ? ". Смерти этой ночью выбирает ведущий." : "."),
    );
    return { ok: true };
  }

  if (step.roleId === "snakecharmer") {
    const target = targets[0] ? playerById(state, targets[0]) : null;
    if (target && !target.alive) {
      return { ok: false, errorCode: "error.55", error: "Нельзя выбрать мёртвого игрока." };
    }
    if (target && !impaired && roleTeam(target.roleId || "") === "demon") {
      swapCharacters(state, actor, target, {
        order,
        currentKey: step.key,
        alignments: true,
      });
      const id = "eff-snakecharmer-" + actor.id + "-" + target.id;
      if (!state.effects.some((effect) => effect.id === id)) {
        state.effects.push({
          id,
          kind: "poison",
          // The poison outlives its source: the new Demon may die or be
          // impaired and the new Snake Charmer stays poisoned.
          permanent: true,
          sourceId: actor.id,
          targetId: target.id,
          start: at,
          expires: null,
          active: true,
        });
      }
      setStepNote(
        step,
        "note.characterSwapPoisoned",
        { actor: actor.name, target: target.name },
        actor.name + " и " + target.name + " меняются персонажами; " + target.name + " отравлен.",
      );
    }
    return { ok: true };
  }

  if (step.roleId === "barber") {
    const [first, second] = targets.map((id) => playerById(state, id));
    if (!first || !second || first.id === second.id) return { ok: true };
    const demon = orderedPlayers(state).find(
      (player) => roleTeam(player.roleId || "") === "demon" && player.alive,
    );
    const differentDemon = [first, second].find(
      (player) => roleTeam(player.roleId || "") === "demon" && (!demon || player.id !== demon.id),
    );
    if (differentDemon) {
      return { ok: false, errorCode: "error.53", error: "Нельзя выбрать другого Демона." };
    }
    swapCharacters(state, first, second, { order, currentKey: step.key });
    setStepNote(
      step,
      "note.characterSwap",
      { first: first.name, second: second.name },
      first.name + " и " + second.name + " меняются персонажами.",
    );
    return { ok: true };
  }

  if (step.roleId === "klutz") {
    const recordedId = typeof actor.used.klutzTarget === "string" ? actor.used.klutzTarget : null;
    const targetId = targets[0] || recordedId;
    const target = targetId ? playerById(state, targetId) : null;
    if (!target) return { ok: false, errorCode: "error.31", error: "Цель не найдена." };
    // The public choice is made when the Klutz learns of the death, so a new
    // choice must be a living player. A choice recorded at the death stands
    // even if that player dies before the queued step resolves.
    if (!recordedId && !target.alive) {
      return { ok: false, errorCode: "error.55", error: "Нельзя выбрать мёртвого игрока." };
    }
    resolveKlutzChoice(state, actor, step, target);
    return { ok: true };
  }

  if (step.roleId === "seamstress") {
    const [first, second] = targets.map((id) => playerById(state, id));
    if (!first || !second) {
      return { ok: false, errorCode: "error.41", error: "Выберите двух разных игроков." };
    }
    if (first.id === second.id) {
      return { ok: false, errorCode: "error.42", error: "Нужны два разных игрока." };
    }
    if (first.id === actor.id || second.id === actor.id) {
      return { ok: false, errorCode: "error.40", error: "Нельзя выбрать себя." };
    }
    actor.used.seamstress = true;
  }
  if (step.roleId === "juggler") actor.used.juggler = true;
  if (step.roleId === "witch" && targets[0] && !impaired && livingPlayers(state).length > 3) {
    state.effects.forEach((effect) => {
      if (effect.kind === "witch" && effect.sourceId === actor.id) effect.active = false;
    });
    state.effects.push({
      id: "eff-witch-" + actor.id + "-" + targets[0],
      kind: "witch",
      sourceId: actor.id,
      targetId: targets[0],
      day: at.number,
      start: at,
      expires: { phase: "night", number: at.number + 1 },
      active: true,
    });
  }
  if (step.roleId === "cerenovus" && targets[0]) {
    const target = playerById(state, targets[0]);
    const roleId = options.roleId || null;
    if (target && roleId && !GOOD_ROLES(state).includes(roleId)) {
      return { ok: false, errorCode: "error.2", error: "Выберите добрую роль из сценария." };
    }
    if (target && roleId && !impaired) {
      state.effects.push({
        id: "eff-madness-cerenovus-" + actor.id + "-" + target.id + "-" + at.number,
        kind: "madness",
        madness: "cerenovus",
        roleId,
        sourceId: actor.id,
        targetId: target.id,
        start: at,
        expires: { phase: "night", number: at.number + 1 },
        active: true,
      });
      setStepNote(
        step,
        "note.madness",
        { name: target.name, role: roleLabel(roleId) },
        target.name + " должен быть «помешан» на роли " + roleLabel(roleId) + " до следующей ночи.",
      );
    }
  }
  if (step.roleId === "sweetheart" && targets[0] && !impaired) {
    state.effects.push({
      id: "eff-sweetheart-" + targets[0],
      kind: "drunk",
      sourceId: actor.id,
      targetId: targets[0],
      // Sweetheart r3016: "1 player is drunk from now on". The window starts
      // at the death, not at the Sweetheart's night slot.
      start: actor.deadAt || at,
      expires: null,
      active: true,
    });
  }
  return { ok: true };
}

export function recordSvOutcome(state: GameState, stepKey: string, options: SvOptions = {}) {
  const step = state.night.queue.find((candidate) => candidate.key === stepKey);
  if (!step || !step.sv) return { ok: false, errorCode: "error.36", error: "Шаг не найден." };
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  const at = currentAt(state);
  const deathIds = Array.isArray(options.deathIds)
    ? options.deathIds.map(String).filter((id) => playerById(state, id))
    : [];
  // "Minions you kill ... poison 1 Townsfolk neighbor" (Vigormortis r3015).
  // The legal neighbours are the nearest Townsfolk on each side; the host may
  // name either one, otherwise the clockwise nearest is the default.
  let poisonId: string | null = null;
  let poisonedMinionId: string | null = null;
  if (step.roleId === "vigormortis") {
    const target = deathIds[0] ? playerById(state, deathIds[0]) : null;
    if (target && roleTeam(target.roleId || "") === "minion") {
      const legal = vigormortisPoisonChoices(state, target.id);
      if (options.poisonId != null) {
        if (!legal.includes(String(options.poisonId))) {
          return { ok: false, errorCode: "error.56", error: "Выберите Горожанина-соседа." };
        }
        poisonId = String(options.poisonId);
      } else {
        poisonId = legal[0] || null;
      }
      poisonedMinionId = target.id;
    }
  }
  const demon = DEMON_ROLES.has(step.roleId || "");
  const deaths = [];
  let jumped = false;
  if (step.roleId === "fanggu") {
    const oldDemon = step.actorId ? playerById(state, step.actorId) : null;
    const target = deathIds[0] ? playerById(state, deathIds[0]) : null;
    if (
      oldDemon &&
      target &&
      roleTeam(target.roleId || "") === "outsider" &&
      !isImpaired(state, oldDemon.id, at) &&
      !fangguJumpUsed(state)
    ) {
      jumped = true;
      state.fangguJumped = true;
      oldDemon.used = oldDemon.used || {};
      oldDemon.used.fanggu = true;
      target.changedFrom = target.roleId;
      target.roleId = "fanggu";
      target.shownRoleId = "fanggu";
      target.team = "evil";
      target.used = target.used || {};
      addLog(state, {
        secret: true,
        kind: "ability",
        title: "Фань Гу переселяется",
        detail: target.name + " становится злым Фань Гу; прежний Демон умирает.",
      });
      if (oldDemon.alive) {
        const death = kill(state, oldDemon.id, "ability", at, { demon: false, ability: "fanggu" });
        if (death) deaths.push(death);
      }
    }
  }
  if (!jumped) {
    for (const id of deathIds) {
      const death = kill(state, id, "ability", at, { demon, ability: step.roleId || "" });
      if (death) deaths.push(death);
    }
  }
  const poisonedDeath = deaths.find(
    (death) => death.playerId === poisonedMinionId && roleTeam(death.roleId || "") === "minion",
  );
  if (poisonId && poisonedMinionId && poisonedDeath) {
    state.effects.push({
      id: "eff-vigormortis-" + poisonedMinionId + "-" + poisonId,
      kind: "poison",
      vigormortis: true,
      // The source is the dead Minion; the poison persists while the
      // Vigormortis lives, so the generic dead-source rule must not drop it.
      permanent: true,
      sourceId: poisonedMinionId,
      targetId: poisonId,
      start: at,
      expires: null,
      active: true,
    });
  }
  reconcileNoDashiiPoison(state);
  reconcileVigormortisPoison(state);
  appendSvConditionalSteps(state);
  checkWin(state);
  return { ok: true, deaths };
}

// Adds Sects and Violets steps that only exist after a death: the Sweetheart's
// drunk choice, the Barber's swap and the Sage's information.
export function appendSvConditionalSteps(state: GameState) {
  const night = nightAt(state).number;
  const queue = state.night.queue;
  const sequence = nightSequence(night, "snv");
  const add = (roleId: RoleId, spec: StepSpec, actorOverride: Player | null = null) => {
    const actor =
      actorOverride || orderedPlayers(state).find((player) => player.roleId === roleId) || null;
    if (!actor || !stepAllowed(state, roleId, actor, night)) return;
    // The queue orders by the compressed sequence index, not the printed
    // 0-99 sheet number. A role without a slot wakes after the last step.
    const slot = sequence.indexOf(roleId);
    const step = makeStep(state, slot < 0 ? sequence.length : slot, roleId, actor, spec);
    if (queue.some((candidate) => candidate.key === step.key)) return;
    insertStepInto(queue, step);
  };
  const sweetheart = orderedPlayers(state).find((player) => player.roleId === "sweetheart");
  if (sweetheart && !sweetheart.alive && diedRecently(state, sweetheart.id)) {
    add("sweetheart", DEATH_WAKE_SPECS.sweetheart!);
  }
  const barber = orderedPlayers(state).find((player) => player.roleId === "barber");
  if (barber && !barber.alive && diedRecently(state, barber.id)) {
    add("barber", DEATH_WAKE_SPECS.barber!);
  }
  const sage = orderedPlayers(state).find((player) => player.roleId === "sage");
  if (sage && !sage.alive && diedByDemon(state, sage.id)) {
    add("sage", DEATH_WAKE_SPECS.sage!);
  }
  const klutz = orderedPlayers(state).find((player) => player.roleId === "klutz");
  if (klutz && !klutz.alive && diedRecently(state, klutz.id) && !(klutz.used && klutz.used.klutz)) {
    add("klutz", DEATH_WAKE_SPECS.klutz!);
  }
  // A Philosopher who borrowed a death-triggered ability wakes for it after
  // their own death, because their character is still the Philosopher. The
  // borrowed character has no wake slot of its own, so the step is built here.
  for (const player of orderedPlayers(state)) {
    if (player.roleId !== "philosopher") continue;
    const ability = player.used ? player.used.philosopherAbility : null;
    if (typeof ability !== "string") continue;
    const spec = DEATH_WAKE_SPECS[ability];
    if (!spec) continue;
    add(ability as RoleId, spec, player);
  }
}

export { DEMON_ROLES };
