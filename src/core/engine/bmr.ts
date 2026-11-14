import type { DeadAt, Effect, GameState, NightStep, Player, RoleId } from "../model/types.ts";

type StepSpec = {
  targetMode?: string;
  minTargets?: number;
  maxTargets?: number;
  infoKind?: string;
  optional?: boolean;
  canKill?: boolean;
  canResurrect?: boolean;
  note?: string | null;
  noteKey?: string | null;
  roleChoices?: RoleId[];
  previousTarget?: string;
  [key: string]: unknown;
};
type BmrOptions = {
  targetIds?: string[];
  given?: Record<string, unknown>;
  redirectId?: string | null;
  registrations?: Record<string, string>;
  roleId?: RoleId | null;
  resurrectId?: string | null;
  drunkId?: string | null;
  deathIds?: string[];
  deaths?: Array<{ playerId: string }>;
};
type BmrInfoOptions = { targetIds?: string[]; registrations?: Record<string, string> };

// Bad Moon Rising scenario support. The Storyteller runs the printed
// abilities; the engine owns the official night order, conditional wakes,
// death/resurrection bookkeeping, and the Mastermind win condition.
import { roleTeam, nightSequence, roleLabel } from "../model/rules.ts";

import {
  effectiveRoleId,
  livingPlayers,
  orderedPlayers,
  playerById,
  realTeamOf,
} from "../model/state.ts";

import { addLog, nightAt, currentAt, cycleOf, insertStepInto } from "./context.ts";
import { kill, checkWin } from "./death.ts";
import { effectActive, isImpaired } from "./effects.ts";
import { setStepNote } from "./night.ts";

const DEMON_ROLES = new Set(["po", "pukka", "shabaloth", "zombuul"]);

// A step whose target is a Storyteller or simulated choice, not the actor's
// own working ability. The Lunatic only pretends to be a Demon and the
// Grandmother's grandchild is picked by the host, so neither can trigger the
// Goon (Goon r2977: "choose you with their ability").
const NO_GOON_CHOICE: Record<string, true> = { lunatic: true, grandmother: true };

function livingLunatic(state: GameState): Player | null {
  return (
    orderedPlayers(state).find((player) => player.roleId === "lunatic" && player.alive) || null
  );
}

// The Pukka's poison and its delayed death are two effects from one ability:
// the poison impairs the target from the moment it is chosen, and the pending
// death resolves at the next Pukka step (or an Exorcist skip). A dead or
// impaired Pukka keeps the pending death on hold until the source is healthy
// again (wiki r3074).
function pendingOrder(effect: Effect): number {
  return effect.resolve ? cycleOf(effect.resolve) : -Infinity;
}

function sortPendings(left: Effect, right: Effect): number {
  return (
    pendingOrder(left) - pendingOrder(right) || String(left.id).localeCompare(String(right.id))
  );
}

function pukkaPendings(state: GameState, sourceId: string): Effect[] {
  return state.effects
    .filter(
      (effect) =>
        effect.kind === "pukka-death" && effect.sourceId === sourceId && effect.active !== false,
    )
    .sort(sortPendings);
}

function resolvePukkaDeath(
  state: GameState,
  pending: Effect | null,
  at: DeadAt,
  { allowResume = false }: { allowResume?: boolean } = {},
) {
  if (!pending) return null;
  if (pending.resumeOnHealthy && !allowResume) return null;
  if (!effectActive(state, pending, at)) return null;
  if (pending.resolve && cycleOf(at) < cycleOf(pending.resolve)) return null;
  const target = pending.targetId == null ? null : playerById(state, pending.targetId);
  const wasAlive = Boolean(target && target.alive);
  // Kill while the poison is still active so the death record keeps the
  // impaired state; then the victim becomes healthy.
  const death =
    wasAlive && target
      ? kill(state, target.id, "ability", at, { demon: true, ability: "pukka" })
      : null;
  // Choosing the same player twice leaves two Pukka poisons on the victim.
  // Clearing every Pukka effect for this source and target restores health
  // without touching poison from another source.
  for (const effect of state.effects) {
    if (effect.sourceId !== pending.sourceId || effect.targetId !== pending.targetId) continue;
    if (effect.kind === "pukka-death" || (effect.kind === "poison" && effect.pukka === true)) {
      effect.active = false;
    }
  }
  return { targetId: pending.targetId, death, skipped: !wasAlive, prevented: wasAlive && !death };
}

// A self-target suspension waits for the Pukka to become healthy; resolve it
// inside the command that removes the impairment, not on a later Pukka step.
export function resolveSuspendedPukkaDeaths(state: GameState, at: DeadAt = currentAt(state)) {
  const pendings = state.effects
    .filter(
      (effect) =>
        effect.kind === "pukka-death" && effect.active !== false && effect.resumeOnHealthy === true,
    )
    .sort(sortPendings);
  const resolved = [];
  for (const pending of pendings) {
    const result = resolvePukkaDeath(state, pending, at, { allowResume: true });
    if (result) resolved.push(result);
  }
  if (resolved.some((result) => result.death)) checkWin(state);
  return resolved;
}

function poisonPukkaTarget(
  state: GameState,
  actor: Player,
  targetId: string,
  at: DeadAt,
): Effect | null {
  const target = playerById(state, targetId);
  if (!target) return null;
  const poison = {
    id: "eff-pukka-poison-" + actor.id + "-" + at.number,
    kind: "poison",
    pukka: true,
    sourceId: actor.id,
    targetId: target.id,
    start: at,
    expires: null,
    active: true,
  };
  const pending = {
    id: "eff-pukka-death-" + actor.id + "-" + at.number,
    kind: "pukka-death",
    sourceId: actor.id,
    targetId: target.id,
    start: at,
    resolve: { phase: "night", number: at.number + 1 } as DeadAt,
    expires: null,
    active: true,
  };
  state.effects.push(poison, pending);
  return poison;
}

function outsiderDiedToday(state: GameState, night: number): boolean {
  return state.deaths.some(
    (death) =>
      !death.fake &&
      death.phase === "day" &&
      death.number === night - 1 &&
      roleTeam(death.roleId || "") === "outsider",
  );
}

function anyoneDiedToday(state: GameState, night: number): boolean {
  return state.deaths.some(
    (death) => !death.fake && death.phase === "day" && death.number === night - 1,
  );
}

function gossipWasTrue(state: GameState, night: number): boolean {
  return Boolean(state.gossip && state.gossip.truth && state.gossip.day === night - 1);
}

function bmrStepSpec(roleId: RoleId, night: number): StepSpec | null {
  if (night === 1) {
    return (
      {
        sailor: {
          targetMode: "one-any",
          noteKey: "note.bmr.sailor",
        },
        courtier: {
          targetMode: "none",
          optional: true,
          noteKey: "note.bmr.courtier",
        },
        godfather: { targetMode: "none", infoKind: "note" },
        devilsadvocate: {
          targetMode: "one-any",
          noteKey: "note.bmr.devilAdvocateFirst",
        },
        pukka: {
          targetMode: "one-any",
          canKill: true,
          noteKey: "note.bmr.pukka",
        },
        grandmother: { targetMode: "one-any", infoKind: "character" },
        chambermaid: { targetMode: "two", infoKind: "number" },
        lunatic: { targetMode: "none", infoKind: "note" },
      }[roleId] || null
    );
  }
  return (
    {
      sailor: {
        targetMode: "one-any",
        noteKey: "note.bmr.sailor",
      },
      courtier: {
        targetMode: "none",
        optional: true,
        noteKey: "note.bmr.courtier",
      },
      innkeeper: {
        targetMode: "two",
        noteKey: "note.bmr.innkeeper",
      },
      gambler: {
        targetMode: "one-any",
        canKill: true,
        noteKey: "note.bmr.gambler",
      },
      devilsadvocate: {
        targetMode: "one-any",
        noteKey: "note.bmr.devilAdvocateOther",
      },
      lunatic: {
        targetMode: "one-any",
        noteKey: "note.bmr.lunatic",
      },
      exorcist: {
        targetMode: "one-any",
        noteKey: "note.bmr.exorcist",
      },
      zombuul: {
        targetMode: "one-any",
        canKill: true,
        noteKey: "note.bmr.zombuul",
      },
      pukka: {
        targetMode: "one-any",
        canKill: true,
        noteKey: "note.bmr.pukka",
      },
      shabaloth: {
        targetMode: "two",
        canKill: true,
        canResurrect: true,
        noteKey: "note.bmr.shabaloth",
      },
      po: {
        targetMode: "po",
        minTargets: 0,
        maxTargets: 3,
        canKill: true,
        noteKey: "note.bmr.po",
      },
      assassin: {
        targetMode: "one-any",
        optional: true,
        canKill: true,
        noteKey: "note.bmr.assassin",
      },
      godfather: {
        targetMode: "one-any",
        canKill: true,
        noteKey: "note.bmr.godfather",
      },
      gossip: {
        targetMode: "one-any",
        canKill: true,
        noteKey: "note.bmr.gossip",
      },
      professor: {
        targetMode: "one-any",
        optional: true,
        canResurrect: true,
        noteKey: "note.bmr.professor",
      },
      tinker: {
        targetMode: "none",
        canKill: true,
        noteKey: "note.bmr.tinker",
      },
      moonchild: {
        targetMode: "one-any",
        canKill: true,
        noteKey: "note.bmr.moonchild",
      },
      grandmother: {
        targetMode: "none",
        canKill: true,
        noteKey: "note.bmr.grandmotherDeath",
      },
      chambermaid: { targetMode: "two", infoKind: "number" },
    }[roleId] || null
  );
}

function stepAllowed(
  state: GameState,
  roleId: RoleId,
  actor: Player | null,
  night: number,
): boolean {
  if (!actor) return false;
  if (roleId === "moonchild") {
    return (
      !actor.alive &&
      Boolean(actor.used && actor.used.moonchildTarget) &&
      !(actor.used && actor.used.moonchildResolved)
    );
  }
  if (!actor.alive) return false;
  if (roleId === "zombuul") return !anyoneDiedToday(state, night);
  if (roleId === "godfather") return night === 1 || outsiderDiedToday(state, night);
  if (roleId === "gossip") return gossipWasTrue(state, night);
  if (roleId === "professor") return !(actor.used && actor.used.professor);
  if (roleId === "assassin") return !(actor.used && actor.used.assassin);
  if (roleId === "courtier") return !(actor.used && actor.used.courtier);
  if (roleId === "grandmother") return night === 1;
  return true;
}

function bmrStepKey(
  state: GameState,
  index: number,
  roleId: RoleId | null,
  actorId: string | null,
): string {
  return ["n" + nightAt(state).number, index, roleId || "system", actorId || "all"].join("-");
}

function makeBmrStep(
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
  const specExtra: Record<string, unknown> = {};
  if (Array.isArray(spec.targetIds)) specExtra.targetIds = spec.targetIds.slice();
  if (roleId === "courtier" || roleId === "gambler") {
    specExtra.roleChoices = (state.script && state.script.roles ? state.script.roles : []).slice();
  }
  if (roleId === "exorcist" || roleId === "devilsadvocate") {
    // "Different to last night" compares with the immediately previous night,
    // not with the last night the ability happened to be used.
    const used = actor && actor.used;
    const target = used && (used[roleId + "Target"] as string | undefined);
    const targetNight = used && (used[roleId + "TargetNight"] as number | undefined);
    if (target && targetNight === nightAt(state).number - 1) {
      specExtra.previousTarget = target;
    }
  }
  return {
    key: bmrStepKey(state, index, roleId, actor ? actor.id : null),
    kind: "role",
    bmr: true,
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
    canResurrect: Boolean(spec.canResurrect),
    note: spec.note || null,
    noteKey: spec.noteKey || null,
    targetIds: [],
    registrations: {},
    given: null,
    result: null,
    pending: null,
    done: false,
    skipped: false,
    completedAt: null,
    ...specExtra,
  };
}

function minionInfoStep(state: GameState, index: number): NightStep | null {
  const size = orderedPlayers(state).length;
  const night = nightAt(state).number;
  if (night !== 1 || size < 7) return null;
  const living = livingPlayers(state);
  const minions = living.filter((p) => roleTeam(p.roleId || "") === "minion");
  const demon = living.find((p) => roleTeam(p.roleId || "") === "demon");
  if (!minions.length || !demon) return null;
  return {
    key: bmrStepKey(state, index, "minioninfo", null),
    kind: "system",
    system: "minioninfo",
    roleId: null,
    actorId: null,
    actorIds: minions.map((p) => p.id),
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

function demonInfoStep(state: GameState, index: number): NightStep | null {
  const size = orderedPlayers(state).length;
  const night = nightAt(state).number;
  if (night !== 1 || size < 7) return null;
  const demon = livingPlayers(state).find((p) => roleTeam(p.roleId || "") === "demon");
  if (!demon) return null;
  const lunatic = livingLunatic(state);
  return {
    key: bmrStepKey(state, index, "demoninfo", null),
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
    lunaticId: lunatic ? lunatic.id : null,
    given: null,
    result: null,
    note: null,
    pending: null,
    done: false,
    skipped: false,
    completedAt: null,
  };
}

export function buildBmrNightQueue(state: GameState): NightStep[] {
  const night = nightAt(state).number;
  const sequence = nightSequence(night, "bmr");
  const steps: NightStep[] = [];
  sequence.forEach((roleId, index) => {
    if (roleId === "info") {
      if (night !== 1) return;
      const minion = minionInfoStep(state, index);
      if (minion) steps.push(minion);
      const demon = demonInfoStep(state, index + 0.1);
      if (demon) steps.push(demon);
      return;
    }
    if (roleId === "minioninfo") {
      const step = minionInfoStep(state, index);
      if (step) steps.push(step);
      return;
    }
    if (roleId === "demoninfo") {
      const step = demonInfoStep(state, index);
      if (step) steps.push(step);
      return;
    }
    const actor = orderedPlayers(state).find((player) => effectiveRoleId(player) === roleId);
    if (!actor) return;
    if (roleId === "grandmother" && night !== 1) return;
    const spec = bmrStepSpec(roleId, night);
    if (!spec) return;
    if (DEMON_ROLES.has(roleId) && bmrDemonHasLunatic(state)) spec.infoKind = "note";
    if (!stepAllowed(state, roleId, actor, night)) return;
    if (roleId === "po") {
      const three = Boolean(actor.used && actor.used.poNoOne);
      spec.minTargets = three ? 3 : 0;
      spec.maxTargets = three ? 3 : 1;
    }
    if (roleId === "moonchild") {
      const chosen = actor.used && actor.used.moonchildTarget;
      if (!chosen) return;
      spec.targetIds = [chosen];
    }
    steps.push(makeBmrStep(state, index, roleId, actor, spec));
  });
  return steps;
}

export function appendBmrConditionalSteps(state: GameState) {
  const night = nightAt(state).number;
  const grandmother = orderedPlayers(state).find(
    (player) => player.roleId === "grandmother" && player.alive,
  );
  const grandchildId = state.setup && state.setup.grandmotherId;
  if (!grandmother || !grandchildId) return;
  const grandchildDeath = state.deaths.find(
    (death) =>
      death.playerId === grandchildId &&
      death.phase === "night" &&
      death.number === night &&
      death.demon === true,
  );
  if (!grandchildDeath) return;
  if (
    state.night.queue.some(
      (step) =>
        step.roleId === "grandmother" &&
        (step.noteKey === "note.bmr.grandmotherDeath" ||
          Boolean(step.note && step.note.includes("Demon"))),
    )
  )
    return;
  // The queue orders by the compressed sequence index, not the printed 0-99
  // sheet number; the Grandmother sits before the Chambermaid on every night.
  const sequence = nightSequence(night, "bmr");
  const slot = sequence.indexOf("grandmother");
  const step = makeBmrStep(state, slot < 0 ? sequence.length : slot, "grandmother", grandmother, {
    targetMode: "none",
    canKill: true,
    noteKey: "note.bmr.grandmotherDeath",
  });
  insertStepInto(state.night.queue, step);
  addLog(state, {
    secret: true,
    kind: "night",
    title: "Бабушка: внук убит Демоном",
    detail: grandmother.name + " должна умереть.",
  });
}

export function completeBmrStep(state: GameState, step: NightStep, options: BmrOptions) {
  const role = step.roleId;
  const actor = step.actorId ? playerById(state, step.actorId) : null;
  const targets = options.targetIds || [];
  const at = currentAt(state);
  if (actor) actor.used = actor.used || {};
  if (role === "pukka" && actor) {
    const pendings = pukkaPendings(state, actor.id);
    if (isImpaired(state, actor.id, at)) {
      for (const pending of pendings) {
        if (pending.resumeOnHealthy) continue;
        if (!pending.resolve || cycleOf(at) >= cycleOf(pending.resolve)) {
          pending.suspended = "impaired";
        }
      }
      setStepNote(
        step,
        "note.pukkaSuspended",
        null,
        "Способность не сработала: Пукка отравлен или пьян. Яд на прежней цели приостановлен.",
      );
      step.result = { deaths: [], poisonedId: null, suspended: true };
      return;
    }
    const previous = pendings.find((pending) => !pending.resumeOnHealthy) || null;
    const targetId = targets[0];
    const selfTarget = targetId != null && String(targetId) === String(actor.id);
    // The new poison lands first: it can impair a protector (for example the
    // Tea Lady) before the previous victim's death is resolved.
    const poison = poisonPukkaTarget(state, actor, targetId!, at);
    if (selfTarget) {
      if (previous) {
        previous.suspended = "self-target";
        previous.resumeOnHealthy = true;
      }
      // The previous victim becomes healthy, but its death stays on hold.
      for (const effect of state.effects) {
        if (effect.kind !== "poison" || effect.pukka !== true) continue;
        if (effect.sourceId !== actor.id) continue;
        if (String(effect.targetId) === String(actor.id)) continue;
        effect.active = false;
      }
      step.result = {
        deaths: [],
        resolved: null,
        poisonedId: poison ? poison.targetId : null,
        suspended: true,
      };
      return;
    }
    const resolved = resolvePukkaDeath(state, previous, at);
    step.result = {
      deaths: resolved && resolved.death ? [resolved.death] : [],
      resolved: resolved || null,
      poisonedId: poison ? poison.targetId : null,
    };
    return;
  }
  if (role === "po" && actor) actor.used.poNoOne = targets.length === 0;
  if (role === "sailor" && actor) {
    const drunkId = options.drunkId || targets[0] || null;
    if (drunkId) {
      state.effects.forEach((effect) => {
        if (effect.kind === "drunk" && effect.sourceId === actor.id && effect.bmr !== "goon")
          effect.active = false;
      });
      state.effects.push({
        id: "eff-" + (state.effects.length + 1) + "-" + Math.random().toString(36).slice(2, 6),
        kind: "drunk",
        sourceId: actor.id,
        targetId: drunkId || null,
        start: at,
        expires: { phase: "night", number: at.number + 1 },
        active: true,
      });
    }
    return;
  }
  if (role === "innkeeper" && actor && targets.length === 2) {
    state.effects.forEach((effect) => {
      if (
        (effect.kind === "protected" && effect.sourceId === actor.id) ||
        (effect.kind === "drunk" && effect.sourceId === actor.id && effect.bmr !== "goon")
      )
        effect.active = false;
    });
    for (const targetId of targets) {
      state.effects.push({
        id: "eff-" + (state.effects.length + 1) + "-" + Math.random().toString(36).slice(2, 6),
        kind: "protected",
        bmr: "innkeeper",
        sourceId: actor.id,
        targetId,
        start: at,
        expires: { phase: "day", number: at.number },
        active: true,
      });
    }
    const drunkId = options.drunkId || targets[0];
    state.effects.push({
      id: "eff-" + (state.effects.length + 1) + "-" + Math.random().toString(36).slice(2, 6),
      kind: "drunk",
      sourceId: actor.id,
      targetId: drunkId || null,
      start: at,
      expires: { phase: "night", number: at.number + 1 },
      active: true,
    });
    return;
  }
  if (role === "devilsadvocate" && actor && targets[0]) {
    actor.used.devilsadvocateTarget = targets[0];
    actor.used.devilsadvocateTargetNight = at.number;
    state.effects.forEach((effect) => {
      if (effect.kind === "devilsadvocate" && effect.sourceId === actor.id) effect.active = false;
    });
    state.effects.push({
      id: "eff-" + (state.effects.length + 1) + "-" + Math.random().toString(36).slice(2, 6),
      kind: "devilsadvocate",
      sourceId: actor.id,
      targetId: targets[0],
      start: at,
      day: at.number,
      expires: { phase: "night", number: at.number + 1 },
      active: true,
    });
    return;
  }
  if (role === "courtier" && actor) {
    actor.used.courtier = true;
    const roleId = options.roleId;
    if (roleId) {
      for (const player of orderedPlayers(state)) {
        if (player.roleId !== roleId) continue;
        state.effects.push({
          id: "eff-" + (state.effects.length + 1) + "-" + Math.random().toString(36).slice(2, 6),
          kind: "drunk",
          sourceId: actor.id,
          targetId: player.id,
          start: at,
          expires: { phase: "night", number: at.number + 3 },
          active: true,
        });
      }
    }
    return;
  }
  if (role === "professor" && actor && targets[0]) {
    actor.used.professor = true;
    const target = playerById(state, targets[0]);
    if (
      !isImpaired(state, actor.id, at) &&
      target &&
      !target.alive &&
      roleTeam(target.roleId || "") === "townsfolk"
    ) {
      resurrectPlayer(state, target.id);
    }
    return;
  }
  if (role === "assassin" && actor && targets[0]) {
    actor.used.assassin = true;
    // The protection bypass is not an exception to being drunk or poisoned.
    // The one exception is the Goon's granted drunk: r2977 says the Assassin's
    // victim (the Goon) still dies and the Goon still turns evil.
    const goonException = Boolean(step.goonImpaired && step.goonImpairedOnly);
    if (isImpaired(state, actor.id, at) && !goonException) {
      setStepNote(
        step,
        "note.abilityFailed",
        null,
        "Способность не сработала: игрок отравлен или пьян.",
      );
      return;
    }
    const target = playerById(state, targets[0]);
    if (target && target.alive) {
      kill(state, target.id, "ability", at, {
        demon: false,
        ability: "assassin",
        bmr: true,
        bypassProtection: true,
      });
    }
    return;
  }
  if (role === "gambler" && actor && targets[0]) {
    if (isImpaired(state, actor.id, at)) {
      setStepNote(
        step,
        "note.abilityFailed",
        null,
        "Способность не сработала: игрок отравлен или пьян.",
      );
      return;
    }
    const target = playerById(state, targets[0]);
    if (
      target &&
      options.roleId &&
      target.roleId !== options.roleId &&
      !(target.roleId === "recluse" && options.roleId === "demon")
    ) {
      kill(state, actor.id, "ability", at, { ability: "gambler", bmr: true });
    }
    return;
  }
  if (role === "moonchild" && actor && targets[0]) {
    const target = playerById(state, targets[0]);
    actor.used.moonchildResolved = true;
    // The Moonchild chooses when they die; the Goon's granted drunk at this
    // bookkeeping wake cannot suppress the already-made choice.
    const goonException = Boolean(step.goonImpaired && step.goonImpairedOnly);
    if (isImpaired(state, actor.id, at) && !goonException) {
      setStepNote(
        step,
        "note.abilityFailed",
        null,
        "Способность не сработала: игрок отравлен или пьян.",
      );
      return;
    }
    if (target && target.alive && (target.team === "good" || target.team == null)) {
      kill(state, target.id, "ability", at, { ability: "moonchild", bmr: true });
    }
    return;
  }
  if (role === "tinker" && actor) {
    // The host decides whether the Tinker dies; the outcome controls record it.
    return;
  }
  if (role === "exorcist" && actor) {
    if (isImpaired(state, actor.id, at)) {
      setStepNote(
        step,
        "note.abilityFailed",
        null,
        "Способность не сработала: игрок отравлен или пьян.",
      );
      return;
    }
    const targetId = targets[0];
    actor.used.exorcistTarget = targetId || null;
    actor.used.exorcistTargetNight = targetId ? at.number : null;
    const target = targetId ? playerById(state, targetId) : null;
    if (target && roleTeam(target.roleId || "") === "demon") {
      const demonStep = state.night.queue.find(
        (candidate) =>
          candidate.kind === "role" && candidate.roleId === target.roleId && !candidate.done,
      );
      if (demonStep) {
        demonStep.done = true;
        demonStep.skipped = true;
        setStepNote(
          demonStep,
          "note.exorcistBlocked",
          null,
          "Экзорцист выбрал Демона. Демон узнаёт Экзорциста и не просыпается.",
        );
      }
      addLog(state, {
        secret: true,
        kind: "night",
        title: "Экзорцист выбрал Демона",
        detail: target.name + " узнаёт Экзорциста и не действует этой ночью.",
      });
      if (target.roleId === "pukka") {
        const pending =
          pukkaPendings(state, target.id).find((candidate) => !candidate.resumeOnHealthy) || null;
        const resolved = resolvePukkaDeath(state, pending, at);
        if (resolved) step.result = { ...step.result, pukkaDeath: resolved };
      }
    }
    return;
  }
  if (role === "grandmother" && actor && step.note && step.note.includes("Demon")) {
    addLog(state, {
      secret: true,
      kind: "night",
      title: "Бабушка умирает",
      detail: "Демон убил её внука.",
    });
  }
}

// The Goon's trigger resolves before the chooser's ability and is granted as a
// drunk sourced by that same player, so the chooser's own effects (including a
// poison or drunk aimed at the Goon) depend on it and stay inactive. That also
// keeps the effect graph acyclic. "Until dusk" is the next night, and the
// granted effect keeps its lifetime even if the chooser is impaired again.
type GoonTrigger = { goonId: string; actorId: string; alignment: "good" | "evil" | null };

function goonTriggerFor(
  state: GameState,
  step: NightStep,
  targets: string[],
  at: DeadAt,
): GoonTrigger | null {
  if (step.kind !== "role" || !step.actorId || !step.roleId) return null;
  if (step.roleId === "goon" || NO_GOON_CHOICE[step.roleId]) return null;
  const actor = playerById(state, step.actorId);
  const goon = orderedPlayers(state).find((player) => player.roleId === "goon" && player.alive);
  if (!actor || !goon || !targets.map(String).includes(goon.id)) return null;
  // A drunk or poisoned Goon has no ability. A drunk or poisoned chooser still
  // chooses; their ability fails, but the Goon still changes alignment.
  if (isImpaired(state, goon.id, at)) return null;
  const chosenThisNight = state.effects.some(
    (effect) =>
      effect.bmr === "goon" &&
      effect.start &&
      effect.start.phase === "night" &&
      Number(effect.start.number) === at.number,
  );
  if (chosenThisNight) return null;
  return { goonId: goon.id, actorId: actor.id, alignment: realTeamOf(actor) };
}

/** True while the chosen targets would trigger the Goon on this step. */
export function bmrGoonWouldTrigger(state: GameState, step: NightStep, targets: string[]): boolean {
  return Boolean(goonTriggerFor(state, step, targets, nightAt(state)));
}

/**
 * Applies the Goon trigger before the chooser's ability resolves: the chooser
 * is drunk immediately, so their ability does not work tonight or the next day.
 */
export function applyBmrGoonTrigger(state: GameState, step: NightStep, targets: string[]): boolean {
  const at = currentAt(state);
  const trigger = goonTriggerFor(state, step, targets, at);
  if (!trigger) return false;
  const goon = playerById(state, trigger.goonId);
  const actor = playerById(state, trigger.actorId);
  if (!goon || !actor) return false;
  const wasImpaired = isImpaired(state, actor.id, at);
  state.effects.push({
    id: "eff-goon-" + at.number + "-" + goon.id,
    kind: "drunk",
    bmr: "goon",
    sourceId: actor.id,
    targetId: actor.id,
    start: at,
    expires: { phase: "night", number: at.number + 1 },
    active: true,
    // The granted drunk keeps its printed lifetime even if its source is
    // impaired again or dies later.
    permanent: true,
  });
  if (trigger.alignment) goon.team = trigger.alignment;
  step.goonImpaired = true;
  // True when the Goon's drunk is the only impairment: the Assassin and the
  // Moonchild still resolve their printed effect (Goon r2977: the Assassin's
  // victim is the Goon; the Moonchild's choice was made before this wake).
  step.goonImpairedOnly = !wasImpaired;
  addLog(state, {
    secret: true,
    kind: "effect",
    title: "Наёмник выбран: " + actor.name,
    detail:
      actor.name +
      " пьян до заката. Наёмник теперь " +
      (trigger.alignment === "evil" ? "злой" : "добрый") +
      ".",
    playerId: goon.id,
  });
  return true;
}

export function bmrInfoForStep(state: GameState, step: NightStep, options: BmrInfoOptions = {}) {
  const actor = step.actorId ? playerById(state, step.actorId) : null;
  const role = step.roleId;
  const at = nightAt(state);
  const targetIds = options.targetIds || step.targetIds || [];
  // The preview runs before completion, so the Goon trigger is still pending.
  // Treat it as impairment now so the false information matches the stored one.
  const impaired = Boolean(
    actor && (isImpaired(state, actor.id, at) || bmrGoonWouldTrigger(state, step, targetIds)),
  );
  if (role === "chambermaid") {
    const count = targetIds.filter((id) =>
      state.night.queue.some(
        (candidate) =>
          candidate.kind === "role" &&
          candidate.actorId === id &&
          candidate.bmr &&
          !candidate.skipped &&
          (candidate.done || candidate.key === step.key),
      ),
    ).length;
    return {
      kind: "number",
      value: count,
      impaired,
      needsChoice: impaired,
      options: impaired ? [0, 1, 2] : [],
    };
  }
  if (role === "grandmother") {
    const target = targetIds[0] ? playerById(state, targetIds[0]) : null;
    return {
      kind: "character",
      roleId: target ? target.roleId : null,
      playerId: target ? target.id : null,
      impaired,
      needsChoice: impaired,
      options: impaired ? orderedPlayers(state).map((player) => player.roleId) : [],
    };
  }
  if (role === "godfather" && step.kind === "role" && state.night.number === 1) {
    const outsiders = livingPlayers(state)
      .filter((player) => roleTeam(player.roleId || "") === "outsider")
      .map((player) => player.name || "Игрок " + player.seat);
    return { kind: "note", text: "Изгои в игре: " + (outsiders.join(", ") || "—") + "." };
  }
  if (role === "lunatic") {
    return {
      kind: "note",
      text:
        state.night.number === 1
          ? "Покажите 3 добрые роли не в игре и укажите на любых игроков как на Приспешников. Настоящий Демон узнаёт Безумца."
          : "Безумец выбирает как Демон. Смертей нет; покажите выбор настоящему Демону.",
    };
  }
  if (role && DEMON_ROLES.has(role)) {
    const lunatic = livingLunatic(state);
    if (lunatic) {
      const choseTonight =
        Number(lunatic.used && lunatic.used.lunaticTargetNight) === nightAt(state).number;
      const target =
        choseTonight && lunatic.used && lunatic.used.lunaticTarget
          ? playerById(state, lunatic.used.lunaticTarget)
          : null;
      return {
        kind: "note",
        text:
          "Безумец: " +
          lunatic.name +
          (target ? "; выбрал " + target.name : "") +
          ". Сообщите это Демону.",
      };
    }
  }
  if (role === "exorcist") {
    if (impaired) {
      return { kind: "note", text: "Способность не сработала: игрок отравлен или пьян." };
    }
    const target = targetIds[0] ? playerById(state, targetIds[0]) : null;
    if (target && roleTeam(target.roleId || "") === "demon") {
      return { kind: "note", text: "Демон узнаёт Экзорциста и не просыпается этой ночью." };
    }
    return { kind: "note", text: "Цель не Демон: способность не сработала." };
  }
  return { kind: "none" };
}

export function recordBmrOutcome(state: GameState, stepKey: string, options: BmrOptions = {}) {
  const step = state.night.queue.find((candidate) => candidate.key === stepKey);
  if (!step || !step.bmr) return { ok: false, errorCode: "error.36", error: "Шаг не найден." };
  if (step.roleId === "pukka") {
    // The Pukka's deaths are resolved by the ability itself; outcome controls
    // must not add a second, host-computed death.
    return { ok: true, deaths: (step.result && step.result.deaths) || [], resurrected: null };
  }
  const goonException = Boolean(
    step.goonImpaired &&
    step.goonImpairedOnly &&
    (step.roleId === "assassin" || step.roleId === "moonchild"),
  );
  if (step.goonImpaired && !goonException) {
    // The chooser was drunk before the ability resolved, so no death or
    // resurrection may be recorded for this step.
    return {
      ok: false,
      errorCode: "error.52",
      error: "Способность не сработала: Наёмник сделал игрока пьяным.",
    };
  }
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  const at = currentAt(state);
  const deathIds = Array.isArray(options.deathIds)
    ? options.deathIds.map(String).filter((id) => playerById(state, id))
    : [];
  const resurrectId = options.resurrectId || null;
  const actor = step.actorId ? playerById(state, step.actorId) : null;
  if (resurrectId) {
    const target = playerById(state, resurrectId);
    if (step.roleId === "professor") {
      // The step owns the ability: the outcome may only repeat the chosen
      // target, after the step completed under a working ability. The step
      // already resurrects that target, so a matching call is idempotent and
      // a second, different resurrection is rejected.
      const chosen = Array.isArray(step.targetIds) ? String(step.targetIds[0] ?? "") : "";
      const usable = Boolean(actor && actor.used && actor.used.professor);
      const unimpaired = actor ? !isImpaired(state, actor.id, at) : false;
      const alreadyAlive = Boolean(target && target.alive);
      const allowed = Boolean(
        step.done &&
        usable &&
        unimpaired &&
        chosen !== "" &&
        String(resurrectId) === chosen &&
        target &&
        (alreadyAlive || (!target.alive && roleTeam(target.roleId || "") === "townsfolk")),
      );
      if (!allowed) {
        return {
          ok: false,
          errorCode: "error.51",
          error: "Профессор может вернуть только выбранную цель.",
        };
      }
    }
    if (step.roleId === "shabaloth") {
      // "A dead player you chose last night": only the immediately preceding
      // night's chosen targets. The night stamp clears the record after a gap.
      const previousNight =
        actor && actor.used ? Number(actor.used.shabalothTargetsNight) : Number.NaN;
      const previous =
        actor && actor.used && Array.isArray(actor.used.shabalothTargets)
          ? actor.used.shabalothTargets.map(String)
          : [];
      if (previousNight !== nightAt(state).number - 1 || !previous.includes(String(resurrectId))) {
        return {
          ok: false,
          errorCode: "error.51",
          error: "Шабало может поднять только цель прошлой ночи.",
        };
      }
    }
  }
  const demon = DEMON_ROLES.has(step.roleId || "");
  const deaths = [];
  for (const id of deathIds) {
    const death = kill(state, id, "ability", at, {
      demon,
      ability: step.roleId || "",
      bmr: true,
      bypassProtection: step.roleId === "assassin",
    });
    if (death) deaths.push(death);
  }
  let resurrected = null;
  if (resurrectId) {
    resurrected = resurrectPlayer(state, resurrectId);
  }
  const chosenTargets = Array.isArray(step.targetIds) ? step.targetIds.map(String) : [];
  if (step.roleId === "shabaloth" && chosenTargets.length) {
    if (actor) {
      actor.used = actor.used || {};
      actor.used.shabalothTargets = chosenTargets.slice();
      actor.used.shabalothTargetsNight = nightAt(state).number;
    }
  }
  appendBmrConditionalSteps(state);
  checkWin(state);
  addLog(state, {
    secret: true,
    kind: "night",
    title: "Итог: " + roleLabel(step.roleId),
    detail: deaths.length
      ? "Погибли: " +
        deaths.map((death) => (playerById(state, death.playerId) || {}).name).join(", ") +
        "."
      : "Смертей нет.",
  });
  return { ok: true, deaths, resurrected };
}

export function resurrectPlayer(state: GameState, playerId: string): Player | null {
  const player = playerById(state, playerId);
  if (!player || player.alive) return null;
  player.alive = true;
  player.deadAt = null;
  player.registeredDead = false;
  player.voteToken = true;
  addLog(state, {
    secret: true,
    kind: "death",
    title: player.name + " возвращается",
    detail: "Роль: " + roleLabel(player.roleId) + ".",
    playerId: player.id,
    consequence: "revived",
  });
  return player;
}

export function bmrDemonHasLunatic(state: GameState): boolean {
  return Boolean(livingLunatic(state));
}
