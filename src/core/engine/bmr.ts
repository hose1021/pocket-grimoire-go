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
// own working ability. The Lunatic only pretends to be a Demon, the
// Grandmother's grandchild is picked by the host, the Gossip's victim is a
// Storyteller consequence and the Moonchild's player already chose in public,
// so none of them can trigger the Goon (Goon r2977: "choose you with their
// ability"; the Gossip and the Moonchild choose no one at night).
const NO_GOON_CHOICE: Record<string, true> = {
  lunatic: true,
  grandmother: true,
  gossip: true,
  moonchild: true,
};

// Once-per-game and first-death abilities. A regurgitated player regains every
// one of them (Shabaloth r1790: "regains their ability, even a 'once per game'
// ability already used").
const RESTORED_ON_RESURRECTION = ["professor", "assassin", "courtier", "fool", "zombuul"];

// A step that is printed as a choice without a wake: the Gossip's victim is a
// Storyteller consequence and the Tinker and the Moonchild do not wake at all,
// so the Chambermaid must not count them (Chambermaid r1784: "how many woke
// tonight due to their ability").
const NOT_A_WAKE: Record<string, true> = { gossip: true, tinker: true, moonchild: true };

// Roles whose deaths are recorded through the outcome panel; their ability must
// work for a death to land (Goon r2977, Godfather r2394, Po r3104).
const IMPAIRABLE_DEATH: Record<string, true> = {
  po: true,
  pukka: true,
  zombuul: true,
  shabaloth: true,
  godfather: true,
  gossip: true,
};

// "Alive"/"living" appears in the printed ability of these roles.
const ALIVE_TARGET_ROLES: Record<string, true> = {
  sailor: true,
  devilsadvocate: true,
  godfather: true,
};

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
  // A Lunatic who believes they are the Zombuul does not wake after a death
  // today either (Lunatic r3112: "The Lunatic, thinking they are the Zombuul,
  // does not wake often at night").
  if (roleId === "lunatic")
    return state.setup.lunaticShownId !== "zombuul" || !anyoneDiedToday(state, night);
  // Two alive players, not herself (Chambermaid r1784).
  if (roleId === "chambermaid")
    return livingPlayers(state).filter((player) => player.id !== actor.id).length >= 2;
  if (roleId === "godfather") return night === 1 || outsiderDiedToday(state, night);
  if (roleId === "gossip") return gossipWasTrue(state, night);
  if (roleId === "professor") return !(actor.used && actor.used.professor);
  if (roleId === "assassin") return !(actor.used && actor.used.assassin);
  if (roleId === "courtier") return !(actor.used && actor.used.courtier);
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
      // Official order: Minion info, then the Lunatic, then Demon info. The
      // Demon information is inserted after the Lunatic below.
      if (night !== 1) return;
      const minion = minionInfoStep(state, index);
      if (minion) steps.push(minion);
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
    if (roleId === "lunatic" && night !== 1) {
      // The Lunatic attacks as the Demon they were shown (Lunatic r3112).
      const mask = state.setup.lunaticShownId;
      const maskSpec = mask ? bmrStepSpec(mask, night) : null;
      if (maskSpec && mask !== "po") {
        if (maskSpec.targetMode != null) spec.targetMode = maskSpec.targetMode;
        if (maskSpec.minTargets != null) spec.minTargets = maskSpec.minTargets;
        if (maskSpec.maxTargets != null) spec.maxTargets = maskSpec.maxTargets;
      }
      if (mask === "po") {
        const three = Boolean(actor.used && actor.used.poNoOne);
        spec.targetMode = "po";
        spec.minTargets = three ? 3 : 0;
        spec.maxTargets = three ? 3 : 1;
      }
    }
    if (roleId === "moonchild") {
      const chosen = actor.used && actor.used.moonchildTarget;
      if (!chosen) return;
      spec.targetIds = [chosen];
    }
    const step = makeBmrStep(state, index, roleId, actor, spec);
    if (roleId === "lunatic" && night === 1) {
      // "Learn three bluffs and the appropriate number of Minions, but this
      // information may be wrong" (Lunatic r3112). The bluffs may be in play.
      const minions = livingPlayers(state).filter(
        (player) => roleTeam(player.roleId || "") === "minion",
      ).length;
      const bluffs = (state.bluffs || state.setup.bluffs || []).map((id) => roleLabel(id));
      setStepNote(
        step,
        "note.bmr.lunaticFirst",
        { minions, bluffs: bluffs.join(", ") },
        "Покажите Безумцу " +
          minions +
          " указаний на Приспешников и 3 добрые роли (они могут быть и в игре): " +
          (bluffs.join(", ") || "—") +
          ".",
      );
    }
    if (roleId === "godfather" && night === 1) {
      const outsiders = outsiderCharacters(state);
      setStepNote(
        step,
        "note.bmr.godfatherOutsiders",
        { outsiders: outsiders.join(", ") || "—" },
        "Изгои в игре: " + (outsiders.join(", ") || "—") + ".",
      );
    }
    steps.push(step);
  });
  if (night === 1) {
    const demon = demonInfoStep(state, sequence.indexOf("lunatic") + 0.5);
    if (demon) insertStepInto(steps, demon);
  }
  return steps;
}

/** The Outsider character tokens in play, without naming their seats. */
function outsiderCharacters(state: GameState): string[] {
  return [
    ...new Set(
      livingPlayers(state)
        .filter((player) => roleTeam(player.roleId || "") === "outsider")
        .map((player) => roleLabel(player.roleId!)),
    ),
  ];
}

export function appendBmrConditionalSteps(state: GameState) {
  const night = nightAt(state).number;
  const grandmother = orderedPlayers(state).find(
    (player) => player.roleId === "grandmother" && player.alive,
  );
  const grandchildId = state.setup && state.setup.grandmotherId;
  if (!grandmother || !grandchildId) return;
  // "If the Demon kills them, you die too": a drunk or poisoned Grandmother has
  // no ability (Grandmother r1777).
  if (isImpaired(state, grandmother.id, currentAt(state))) return;
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
      (step) => step.roleId === "grandmother" && step.noteKey === "note.bmr.grandmotherDeath",
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
  if (role === "lunatic" && actor) {
    // The first night is not a night where the pretended Po chose no one
    // (Po r3104), and the Lunatic's own choice is only a report.
    if (state.setup.lunaticShownId === "po" && at.number > 1)
      actor.used.poNoOne = targets.length === 0;
    reportLunaticChoice(state, step, actor, targets);
    return;
  }
  if (role === "sailor" && actor) {
    // The Storyteller chooses who is drunk: the Sailor or the target. An empty
    // choice means "nobody", never a silent fallback (Sailor r1768).
    const drunkId = options.drunkId || null;
    state.effects.forEach((effect) => {
      if (effect.kind === "drunk" && effect.sourceId === actor.id && effect.bmr !== "goon")
        effect.active = false;
    });
    if (drunkId) {
      state.effects.push({
        id: "eff-" + (state.effects.length + 1) + "-" + Math.random().toString(36).slice(2, 6),
        kind: "drunk",
        sourceId: actor.id,
        targetId: drunkId,
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
    // One of the two targets is drunk, chosen by the Storyteller (r1774).
    const drunkId = options.drunkId || null;
    if (drunkId) {
      state.effects.push({
        id: "eff-" + (state.effects.length + 1) + "-" + Math.random().toString(36).slice(2, 6),
        kind: "drunk",
        sourceId: actor.id,
        targetId: drunkId,
        start: at,
        expires: { phase: "night", number: at.number + 1 },
        active: true,
      });
    }
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
    const roleId = options.roleId;
    // The once-per-game is spent only after a character is chosen (Courtier
    // r1797). An empty choice costs nothing.
    if (!roleId) return;
    actor.used.courtier = true;
    // Choosing the Goon character triggers the Goon before the Courtier's own
    // effect resolves, so the Courtier is drunk and the three-night drunk does
    // not land (Courtier r1797 example, Goon r2977).
    if (roleId === "goon") {
      const goon = orderedPlayers(state).find((player) => player.roleId === "goon" && player.alive);
      if (goon) applyGoonTrigger(state, goon, actor, at, step);
    }
    if (isImpaired(state, actor.id, at)) {
      setStepNote(
        step,
        "note.abilityFailed",
        null,
        "Способность не сработала: игрок отравлен или пьян.",
      );
      return;
    }
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
      resurrectPlayer(state, target.id, { afterOrder: step.order || 0 });
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
    // The guess names a character, so the Recluse's registration as a Demon
    // does not make a Demon guess correct.
    if (target && options.roleId && target.roleId !== options.roleId) {
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
    const targetId = targets[0];
    // The choice is recorded even while impaired: "different to last night" is
    // about the choice, not about whether the ability worked (Exorcist r1769).
    actor.used.exorcistTarget = targetId || null;
    actor.used.exorcistTargetNight = targetId ? at.number : null;
    if (isImpaired(state, actor.id, at)) {
      setStepNote(
        step,
        "note.abilityFailed",
        null,
        "Способность не сработала: игрок отравлен или пьян.",
      );
      return;
    }
    const target = targetId ? playerById(state, targetId) : null;
    if (target && roleTeam(target.roleId || "") === "demon") {
      const demonStep = state.night.queue.find(
        (candidate) =>
          candidate.kind === "role" && candidate.roleId === target.roleId && !candidate.done,
      );
      if (demonStep) {
        if (target.roleId === "shabaloth") {
          // The Demon does not wake, but its other abilities still resolve: the
          // Storyteller may still regurgitate last night's target
          // (Exorcist r1769, Shabaloth r1790).
          demonStep.canKill = false;
          demonStep.canResurrect = true;
          demonStep.blocked = true;
          demonStep.targetMode = "none";
          demonStep.minTargets = 0;
          demonStep.maxTargets = 0;
        } else {
          demonStep.done = true;
          demonStep.skipped = true;
        }
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
  if (role === "shabaloth" && actor) {
    // The chosen targets persist even when both survive, so next night's
    // regurgitation has a legal source (Shabaloth r1790). The previous night's
    // choice stays available for the outcome validation, which runs after this
    // step is completed.
    if (targets.length && !isImpaired(state, actor.id, at)) {
      actor.used.shabalothPreviousTargets = Array.isArray(actor.used.shabalothTargets)
        ? actor.used.shabalothTargets.slice()
        : [];
      actor.used.shabalothPreviousNight = actor.used.shabalothTargetsNight;
      actor.used.shabalothTargets = targets.slice(0, 2);
      actor.used.shabalothTargetsNight = at.number;
    }
    return;
  }
  if (role === "grandmother" && actor && step.noteKey === "note.bmr.grandmotherDeath") {
    addLog(state, {
      secret: true,
      kind: "night",
      title: "Бабушка умирает",
      detail: "Демон убил её внука.",
    });
  }
}

/** Records the Lunatic's choice on its own step and on the real Demon's. */
function reportLunaticChoice(
  state: GameState,
  step: NightStep,
  lunatic: Player,
  targets: string[],
) {
  const demon = orderedPlayers(state).find((player) => roleTeam(player.roleId || "") === "demon");
  if (!demon) return;
  const chosen = targets
    .map((id) => playerById(state, id))
    .filter((player): player is Player => Boolean(player));
  const vars = {
    name: lunatic.name,
    target: chosen.map((player) => player.name).join(", ") || "—",
  };
  const text =
    "Безумец: " +
    lunatic.name +
    (chosen.length ? "; выбрал " + vars.target : "") +
    ". Сообщите это Демону.";
  // The report lives on the Lunatic step too: the Demon may not wake tonight
  // (a Zombuul after a death today, an Exorcist block), so a report attached
  // only to the Demon step would be lost (Lunatic r3112).
  setStepNote(step, "note.bmr.lunaticReport", vars, text);
  const demonStep = state.night.queue.find(
    (candidate) =>
      candidate.kind === "role" &&
      DEMON_ROLES.has(String(candidate.roleId)) &&
      !candidate.done &&
      !candidate.skipped,
  );
  if (!demonStep) return;
  demonStep.noteKey = "note.bmr.lunaticReport";
  demonStep.noteVars = vars;
  demonStep.note = text;
}

// The Goon's trigger resolves before the chooser's ability and is granted as a
// drunk sourced by that same player, so the chooser's own effects (including a
// poison or drunk aimed at the Goon) depend on it and stay inactive. That also
// keeps the effect graph acyclic. "Until dusk" is the next night, and the
// granted effect keeps its lifetime even if the chooser is impaired again.
type GoonTrigger = { goonId: string; actorId: string; alignment: "good" | "evil" | null };

function livingGoon(state: GameState): Player | null {
  return orderedPlayers(state).find((player) => player.roleId === "goon" && player.alive) || null;
}

function goonChosenThisNight(state: GameState, at: DeadAt): boolean {
  return state.effects.some(
    (effect) =>
      effect.bmr === "goon" &&
      effect.start &&
      effect.start.phase === "night" &&
      Number(effect.start.number) === at.number,
  );
}

/**
 * Makes the chooser drunk until dusk and turns the Goon to their alignment. The
 * trigger resolves before the chooser's ability, so an ability that would fire
 * later tonight does not fire at all.
 */
function applyGoonTrigger(
  state: GameState,
  goon: Player,
  actor: Player,
  at: DeadAt,
  step: NightStep,
): boolean {
  // A drunk or poisoned Goon has no ability. A drunk or poisoned chooser still
  // chooses; their ability fails, but the Goon still changes alignment.
  if (isImpaired(state, goon.id, at)) return false;
  if (goonChosenThisNight(state, at)) return false;
  const wasImpaired = isImpaired(state, actor.id, at);
  const alignment = realTeamOf(actor);
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
  if (alignment) goon.team = alignment;
  step.goonImpaired = true;
  step.goonId = goon.id;
  // True when the Goon's drunk is the only impairment: the Assassin still
  // resolves its printed effect (Goon r2977: the Assassin's victim is the Goon).
  step.goonImpairedOnly = !wasImpaired;
  addLog(state, {
    secret: true,
    kind: "effect",
    title: "Наёмник выбран: " + actor.name,
    detail:
      actor.name +
      " пьян до заката. Наёмник теперь " +
      (alignment === "evil" ? "злой" : "добрый") +
      ".",
    playerId: goon.id,
  });
  return true;
}

function goonTriggerFor(
  state: GameState,
  step: NightStep,
  targets: string[],
  at: DeadAt,
): GoonTrigger | null {
  if (step.kind !== "role" || !step.actorId || !step.roleId) return null;
  if (step.roleId === "goon" || NO_GOON_CHOICE[step.roleId]) return null;
  const actor = playerById(state, step.actorId);
  const goon = livingGoon(state);
  if (!actor || !goon || !targets.map(String).includes(goon.id)) return null;
  if (isImpaired(state, goon.id, at)) return null;
  if (goonChosenThisNight(state, at)) return null;
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
  return applyGoonTrigger(state, goon, actor, at, step);
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
    // Only characters who woke due to their ability count: the Gossip's victim
    // is a Storyteller consequence and the Tinker and the Moonchild do not wake.
    const count = targetIds.filter((id) => {
      const woke = state.night.queue.filter(
        (candidate) =>
          candidate.kind === "role" &&
          candidate.actorId === id &&
          candidate.bmr &&
          !candidate.skipped &&
          (candidate.done || candidate.key === step.key),
      );
      return woke.some(
        (candidate) =>
          !NOT_A_WAKE[String(candidate.roleId)] &&
          candidate.noteKey !== "note.bmr.grandmotherDeath",
      );
    }).length;
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
    const outsiders = outsiderCharacters(state);
    return { kind: "note", text: "Изгои в игре: " + (outsiders.join(", ") || "—") + "." };
  }
  if (role === "lunatic") {
    if (state.night.number === 1) {
      const bluffs = (state.bluffs || state.setup.bluffs || []).map((id) => roleLabel(id));
      const minions = livingPlayers(state).filter(
        (player) => roleTeam(player.roleId || "") === "minion",
      ).length;
      return {
        kind: "note",
        text:
          "Покажите Безумцу " +
          minions +
          " указаний на Приспешников и 3 добрые роли (они могут быть и в игре): " +
          (bluffs.join(", ") || "—") +
          ".",
      };
    }
    return {
      kind: "note",
      text: "Безумец выбирает как Демон. Смертей нет; покажите выбор настоящему Демону.",
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
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  const at = currentAt(state);
  const deathIds = Array.isArray(options.deathIds)
    ? options.deathIds.map(String).filter((id) => playerById(state, id))
    : [];
  const resurrectId = options.resurrectId || null;
  const actor = step.actorId ? playerById(state, step.actorId) : null;
  const chosenTargets = Array.isArray(step.targetIds) ? step.targetIds.map(String) : [];
  // An Exorcist-blocked Demon does not wake: only its regurgitation resolves.
  if (step.blocked && deathIds.length) {
    return {
      ok: false,
      errorCode: "error.52",
      error: "Демон не проснулся этой ночью: смерти невозможны.",
    };
  }
  const goonException = Boolean(
    step.goonImpaired &&
    step.goonImpairedOnly &&
    (step.roleId === "assassin" || step.roleId === "moonchild"),
  );
  if (step.goonImpaired && !goonException) {
    // The chooser was drunk as soon as it chose the Goon, so every target that
    // comes after the Goon does not die. Targets chosen before it still do
    // (Po r3104: "Only the Moonchild dies, because the Po became drunk when
    // they attacked the Goon").
    const goonIndex = chosenTargets.indexOf(String(step.goonId));
    const blocked = deathIds.filter((id) => {
      const index = chosenTargets.indexOf(id);
      return goonIndex < 0 || index < 0 || index >= goonIndex;
    });
    if (blocked.length) {
      return {
        ok: false,
        errorCode: "error.52",
        error: "Способность не сработала: Наёмник сделал игрока пьяным.",
      };
    }
  }
  // A drunk or poisoned ability that records deaths does nothing, so no marked
  // death may land. The Assassin, the Moonchild and the Professor check their
  // own impairment, and the Tinker is a Storyteller decision, not an ability.
  if (
    actor &&
    IMPAIRABLE_DEATH[String(step.roleId)] &&
    !goonException &&
    !step.goonImpaired &&
    isImpaired(state, actor.id, at)
  ) {
    return {
      ok: false,
      errorCode: "error.52",
      error: "Способность не сработала: игрок отравлен или пьян.",
    };
  }
  // A death must be one of the step's chosen targets and must not exceed the
  // ability's maximum (Shabaloth 2, Po 1 or 3, the others 1).
  if (deathIds.length && step.roleId !== "tinker") {
    if (!chosenTargets.length || deathIds.some((id) => !chosenTargets.includes(id))) {
      return {
        ok: false,
        errorCode: "error.51",
        error: "Смерть должна совпадать с выбранными целями.",
      };
    }
    const maximum = Number(step.maxTargets || 0);
    if (maximum && deathIds.length > maximum) {
      return {
        ok: false,
        errorCode: "error.51",
        error: "Смертей больше, чем позволяет способность.",
      };
    }
  }
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
      // night's chosen targets. The completion already moved this night's
      // choice into the current record, so prefer the previous one.
      const used = (actor && actor.used) || {};
      const hasPrevious = used.shabalothPreviousNight != null;
      const previousNight = Number(
        hasPrevious ? used.shabalothPreviousNight : used.shabalothTargetsNight,
      );
      const stored =
        hasPrevious && Array.isArray(used.shabalothPreviousTargets)
          ? used.shabalothPreviousTargets
          : used.shabalothTargets;
      const previous = Array.isArray(stored) ? stored.map(String) : [];
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
  let resurrected = null;
  // The Shabaloth's regurgitation happens "just before waking the Shabaloth",
  // so the resurrected player's protection is already active for the new kills
  // (Shabaloth r1790).
  if (resurrectId && step.roleId === "shabaloth") {
    resurrected = resurrectPlayer(state, resurrectId, { afterOrder: step.order || 0 });
  }
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
  if (resurrectId && step.roleId !== "shabaloth") {
    resurrected = resurrectPlayer(state, resurrectId, { afterOrder: step.order || 0 });
  }
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

/**
 * The printed target restriction for one Bad Moon Rising step. The counts are
 * checked by the night flow; this function owns "alive", "not yourself" and the
 * Grandmother's good Townsfolk/Outsider grandchild (r1768 Sailor, r1784
 * Chambermaid, r3013 Devil's Advocate, r1777 Grandmother).
 */
export function bmrTargetError(
  state: GameState,
  step: NightStep,
  targets: string[],
): string | null {
  const ids = targets.map(String);
  const role = step.roleId || "";
  if (ids.some((id) => !playerById(state, id))) return "Цель не найдена.";
  const deadId = ids.find((id) => !playerById(state, id)!.alive);
  if (deadId && ALIVE_TARGET_ROLES[role]) return "Цель должна быть жива.";
  if (role === "chambermaid") {
    if (ids.length === 2 && ids[0] === ids[1]) return "Нужны два разных игрока.";
    if (step.actorId && ids.includes(step.actorId)) return "Нельзя выбрать себя.";
    if (deadId) return "Обе цели должны быть живы.";
  }
  if (role === "grandmother" && ids.length === 1) {
    const team = roleTeam(playerById(state, ids[0]!)!.roleId || "");
    if (team !== "townsfolk" && team !== "outsider")
      return "Внук должен быть добрым Горожанином или Изгоем.";
  }
  return null;
}

/**
 * Brings a dead player back. The resurrected player regains every ability,
 * including a used once-per-game one, and wakes later tonight if their step is
 * still to come (Shabaloth r1790: "The regurgitated player regains their
 * ability, even a 'once per game' ability already used ... They wake later
 * tonight if they normally would").
 */
export function resurrectPlayer(
  state: GameState,
  playerId: string,
  { afterOrder = Infinity }: { afterOrder?: number } = {},
): Player | null {
  const player = playerById(state, playerId);
  if (!player || player.alive) return null;
  player.alive = true;
  player.deadAt = null;
  player.registeredDead = false;
  player.voteToken = true;
  if (player.used) {
    for (const flag of RESTORED_ON_RESURRECTION) delete player.used[flag];
  }
  restoreResurrectedSteps(state, player, afterOrder);
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

/**
 * Re-opens the resurrected player's wake when it is still to come tonight. A
 * "first night only" or "start knowing" ability (the Grandmother) wakes at once
 * to use the ability again; a step that already passed does not.
 */
function restoreResurrectedSteps(state: GameState, player: Player, afterOrder: number) {
  const roleId = player.roleId;
  if (!roleId) return;
  const night = nightAt(state).number;
  const sequence = nightSequence(night, "bmr");
  const slot = sequence.indexOf(roleId);
  if (slot < 0 || slot <= afterOrder) return;
  const queue = state.night.queue;
  const pruned = queue.find(
    (step) =>
      step.kind === "role" &&
      step.actorId === player.id &&
      (step.done || step.skipped) &&
      step.noteKey !== "note.bmr.grandmotherDeath",
  );
  if (pruned) {
    pruned.done = false;
    pruned.skipped = false;
    pruned.completedAt = null;
    pruned.note = null;
    pruned.noteKey = null;
    pruned.noteVars = null;
    return;
  }
  if (queue.some((step) => step.kind === "role" && step.actorId === player.id)) return;
  const spec =
    roleId === "grandmother" && night !== 1 ? bmrStepSpec(roleId, 1) : bmrStepSpec(roleId, night);
  if (!spec || !stepAllowed(state, roleId, player, night)) return;
  insertStepInto(queue, makeBmrStep(state, slot, roleId, player, spec));
}

export function bmrDemonHasLunatic(state: GameState): boolean {
  return Boolean(livingLunatic(state));
}
