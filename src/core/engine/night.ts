import type { DeadAt, Death, GameState, NightStep, Player, RoleId } from "../model/types.ts";
import {
  caseForStep,
  describeGiven,
  describeRegistrations,
  givenIsLegal,
  recordHostChoice,
  registrationError,
} from "./host-choice.ts";

type NightOptions = {
  given?: Record<string, unknown>;
  redirectId?: string | null;
  registrations?: Record<string, string>;
  targetIds?: string[];
  resurrectId?: string | null;
  roleId?: RoleId | null;
  drunkId?: string | null;
  deathIds?: string[];
};

const givenRejected = (info: unknown) => ({
  ok: false as const,
  needsChoice: true,
  info,
  errorCode: "error.66",
  error: "Выберите один из предложенных вариантов.",
});

type PendingChoice = { caseId: Parameters<typeof recordHostChoice>[1]; detail: string };

// The host answer must be one of the offered options. Validation happens before
// any mutation; the journal line is written only after the step succeeds.
function validateGiven(
  step: NightStep,
  info: { needsChoice?: boolean; options?: unknown[]; impaired?: boolean },
  options: NightOptions,
): { rejection: Record<string, unknown> } | { pending: PendingChoice | null } {
  const hasOptions = Array.isArray(info.options) && info.options.length > 0;
  if (info.needsChoice && !options.given) {
    return { rejection: { ok: false as const, needsChoice: true, info } };
  }
  if (hasOptions && options.given && !givenIsLegal(info, options.given)) {
    return { rejection: givenRejected(info) };
  }
  step.given = options.given || info;
  if (hasOptions && options.given) {
    return {
      pending: {
        caseId: caseForStep(step, info),
        detail: describeGiven(options.given),
      },
    };
  }
  return { pending: null };
}

function recordPending(state: GameState, pending: PendingChoice | null, step: NightStep): void {
  if (pending) recordHostChoice(state, pending.caseId, pending.detail, step.actorId || null);
}

// Trouble Brewing domain: night. No DOM or persistence.
import {
  isBmrScript,
  isManualScript,
  isSnvScript,
  nightSequence,
  roleLabel,
  roleTeam,
} from "../model/rules.ts";
import {
  effectiveRoleId,
  livingPlayers,
  nowIso,
  orderedPlayers,
  playerById,
  registersAlive,
  seatName,
} from "../model/state.ts";

import { nightAt, addLog, insertStepInto } from "./context.ts";
import { isImpaired } from "./effects.ts";

import { infoForStep } from "./information.ts";
import { resolveAttack, checkWin } from "./death.ts";
import { secretsErrors, setupErrors } from "./setup.ts";
import {
  appendBmrConditionalSteps,
  applyBmrGoonTrigger,
  buildBmrNightQueue,
  completeBmrStep,
} from "./bmr.ts";
import { appendSvConditionalSteps, buildSvNightQueue, completeSvStep } from "./sv.ts";
import { minionRetainsAbility } from "./retention.ts";

// Steps kept when their owner dies: the dead actor may still complete them.
const DEATH_TRIGGERED: Record<string, true> = {
  ravenkeeper: true,
  grandmother: true,
  moonchild: true,
  barber: true,
  sweetheart: true,
  sage: true,
  klutz: true,
};

export function stepKey(
  state: GameState,
  sequenceIndex: number,
  roleId: RoleId | null,
  actorId: string | null,
): string {
  return ["n" + nightAt(state).number, sequenceIndex, roleId || "system", actorId || "all"].join(
    "-",
  );
}

export function targetModeFor(roleId: RoleId | null): string {
  if (roleId === "poisoner" || roleId === "imp" || roleId === "ravenkeeper") return "one-any";
  if (roleId === "monk" || roleId === "butler") return "one-other";
  if (roleId === "fortuneteller") return "two";
  return "none";
}

/** The target count a step takes; mirrors the bounds the completion check enforces. */
export interface TargetBounds {
  min: number;
  max: number;
}

export function targetBounds(step: NightStep): TargetBounds {
  const min =
    step.bmr || step.sv
      ? step.minTargets || 0
      : step.targetMode === "none"
        ? 0
        : step.targetMode === "two"
          ? 2
          : 1;
  return { min, max: step.bmr || step.sv ? step.maxTargets || 0 : min };
}

export function infoKindFor(roleId: RoleId | null): string {
  return (
    {
      washerwoman: "one-of-two",
      librarian: "one-of-two",
      investigator: "one-of-two",
      chef: "number",
      empath: "number",
      fortuneteller: "yes-no",
      undertaker: "character",
      ravenkeeper: "character",
      spy: "grimoire",
    }[roleId || ""] || "none"
  );
}

/** Sets the console key and the persisted fallback for one step note. */
export function setStepNote(
  step: NightStep,
  key: string,
  vars: Record<string, string | number> | null,
  fallback: string,
): void {
  step.noteKey = key;
  step.noteVars = vars;
  step.note = fallback;
}

export function makeRoleStep(
  state: GameState,
  sequenceIndex: number,
  roleId: RoleId,
  actor: Player | null,
  extra: Record<string, unknown> = {},
): NightStep {
  return {
    key: stepKey(state, sequenceIndex, roleId, actor ? actor.id : null),
    kind: "role",
    roleId,
    actorId: actor ? actor.id : null,
    actorName: actor ? actor.name : "",
    actorAlive: actor ? actor.alive : false,
    order: sequenceIndex,
    targetMode: targetModeFor(roleId),
    infoKind: infoKindFor(roleId),
    targetIds: [],
    redirectId: null,
    registrations: {},
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

export function makeSystemStep(
  state: GameState,
  sequenceIndex: number,
  system: string,
  extra: Record<string, unknown> = {},
): NightStep {
  return {
    key: stepKey(state, sequenceIndex, system, null),
    kind: "system",
    system,
    roleId: null,
    actorId: null,
    actorIds: [],
    order: sequenceIndex,
    targetMode: "none",
    infoKind:
      system === "demonchange"
        ? "note"
        : system === "minioninfo"
          ? "minion-info"
          : system === "demoninfo"
            ? "demon-info"
            : "none",
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

export function executionDeathForDay(state: GameState, dayNumber: number): Death | null {
  const deaths = state.deaths.filter(
    (death) => death.cause === "execution" && death.phase === "day" && death.number === dayNumber,
  );
  return deaths.length ? deaths[deaths.length - 1]! : null;
}

export function demonChangePending(state: GameState): NightStep | null {
  return (
    state.night.queue.find((step) => step.pending && step.pending.kind === "demon-inheritance") ||
    null
  );
}

export function buildNightQueue(state: GameState): NightStep[] {
  // Manual-only games have no automatic night steps. The host resolves every
  // ability and records deaths and changes through corrections.
  if (isManualScript(state.script)) return [];
  if (isBmrScript(state.script)) return buildBmrNightQueue(state);
  if (isSnvScript(state.script)) return buildSvNightQueue(state);
  const night = nightAt(state).number;
  const sequence = nightSequence(night);
  const steps: NightStep[] = [];
  const size = orderedPlayers(state).length;
  const living = livingPlayers(state);

  sequence.forEach((roleId, index) => {
    if (roleId === "scarletwoman") return; // passive; resolved at Demon death

    if (roleId === "minioninfo") {
      if (night !== 1 || size < 7) return;
      const minions = living.filter((p) => roleTeam(p.roleId || "") === "minion");
      const demon = living.find((p) => roleTeam(p.roleId || "") === "demon");
      if (!minions.length || !demon) return;
      steps.push(
        makeSystemStep(state, index, "minioninfo", {
          actorIds: minions.map((p) => p.id),
          demonId: demon.id,
        }),
      );
      return;
    }

    if (roleId === "demoninfo") {
      if (night !== 1 || size < 7) return;
      const demon = living.find((p) => roleTeam(p.roleId || "") === "demon");
      if (!demon) return;
      steps.push(
        makeSystemStep(state, index, "demoninfo", {
          actorIds: [demon.id],
          demonId: demon.id,
          bluffs: (state.bluffs || []).slice(),
        }),
      );
      return;
    }

    if (roleId === "ravenkeeper") {
      const dead = orderedPlayers(state).find(
        (p) =>
          effectiveRoleId(p) === "ravenkeeper" &&
          !p.alive &&
          p.deadAt &&
          p.deadAt.phase === "night" &&
          p.deadAt.number === night,
      );
      if (!dead) return;
      steps.push(
        makeRoleStep(state, index, "ravenkeeper", dead, {
          actorAlive: false,
          deadTonight: true,
        }),
      );
      return;
    }

    if (roleId === "undertaker") {
      const actor = living.find((p) => effectiveRoleId(p) === "undertaker");
      if (!actor) return;
      const death = executionDeathForDay(state, night - 1);
      if (!death) return;
      steps.push(
        makeRoleStep(state, index, "undertaker", actor, {
          executedId: death.playerId,
          executedRoleId: death.roleId || null,
        }),
      );
      return;
    }

    const actor = living.find((p) => effectiveRoleId(p) === roleId);
    if (!actor) return;
    steps.push(makeRoleStep(state, index, roleId, actor));
  });

  return steps;
}

export function insertStepByOrder(state: GameState, step: NightStep) {
  insertStepInto(state.night.queue, step);
}

export function pruneDeadSteps(state: GameState) {
  for (const step of state.night.queue) {
    if (step.done || step.skipped) continue;
    if (!step.actorId) continue;
    if (DEATH_TRIGGERED[step.roleId || ""]) continue;
    const actor = playerById(state, step.actorId);
    if (!actor || actor.alive) continue;
    if (minionRetainsAbility(state, actor.id)) continue;
    step.done = true;
    step.skipped = true;
    setStepNote(step, "note.actorDied", null, "Игрок погиб до своего шага.");
    addLog(state, {
      secret: true,
      kind: "night",
      title: "Шаг пропущен: " + (step.roleId ? roleLabel(step.roleId) : "система"),
      detail: (actor ? actor.name : "Игрок") + " погиб до пробуждения.",
    });
  }
}

export function appendConditionalSteps(state: GameState) {
  if (isBmrScript(state.script)) {
    appendBmrConditionalSteps(state);
    pruneDeadSteps(state);
    return;
  }
  if (isSnvScript(state.script)) {
    appendSvConditionalSteps(state);
    pruneDeadSteps(state);
    return;
  }
  const night = nightAt(state).number;
  const queue = state.night.queue;

  const ravenkeeper = orderedPlayers(state).find(
    (p) =>
      effectiveRoleId(p) === "ravenkeeper" &&
      !p.alive &&
      p.deadAt &&
      p.deadAt.phase === "night" &&
      p.deadAt.number === night,
  );
  if (
    ravenkeeper &&
    !queue.some((step) => step.roleId === "ravenkeeper" && step.actorId === ravenkeeper.id)
  ) {
    const sequence = nightSequence(night);
    const order = sequence.indexOf("ravenkeeper");
    const step = makeRoleStep(state, order, "ravenkeeper", ravenkeeper, {
      actorAlive: false,
      deadTonight: true,
    });
    insertStepByOrder(state, step);
  }

  if (state.night.demonChanged && !queue.some((step) => step.system === "demonchange")) {
    const impIndex = queue.findIndex((step) => step.roleId === "imp");
    const order = impIndex === -1 ? 100 : (queue[impIndex]!.order || 0) + 0.5;
    insertStepByOrder(
      state,
      makeSystemStep(state, order, "demonchange", {
        note: "Демон сменился. Разбудите нового Демона и покажите жетон Чёрта. Новый Демон не действует этой ночью повторно.",
        noteKey: "note.demonChanged",
      }),
    );
  }
  pruneDeadSteps(state);
}

export function startNight(state: GameState) {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  // A stale tab must not turn an active day back into a night.
  if (state.phase === "day")
    return { ok: false, errorCode: "error.68", error: "Сейчас день: сначала завершите день." };
  if (state.phase === "night" && state.night.queue.length) {
    return { ok: true, queue: state.night.queue, resumed: true };
  }
  const errors = isManualScript(state.script) ? setupErrors(state) : secretsErrors(state);
  if (errors.length) return { ok: false, errors };
  if (!state.setup.roles.length)
    return { ok: false, errorCode: "error.34", error: "Сначала раздайте роли." };
  if (!orderedPlayers(state).every((player) => player.roleId)) {
    return { ok: false, errorCode: "error.35", error: "Раздайте роли всем игрокам." };
  }

  if (state.phase !== "deal" && state.phase !== "seat" && state.phase !== "night") {
    // Night can restart after a reload; only block clearly wrong phases.
    state.phase = "deal";
  }
  if (!state.night.number || state.night.number < 1) state.night.number = 1;
  state.phase = "night";
  state.day.number = state.night.number;
  state.night.demonChanged = false;
  state.night.queue = buildNightQueue(state);
  state.night.currentIndex = 0;
  state.setup.ready = true;
  addLog(state, {
    kind: "phase",
    title: "Ночь " + state.night.number,
    detail: "Разбудите роли по порядку. Не называйте роли вслух.",
  });
  return { ok: true, queue: state.night.queue };
}

export function completeStep(state: GameState, key: string, options: NightOptions = {}) {
  const step = state.night.queue.find((candidate) => candidate.key === key);
  if (!step) return { ok: false, errorCode: "error.36", error: "Шаг не найден." };
  if (step.done) return { ok: false, errorCode: "error.37", error: "Этот шаг уже выполнен." };
  const badRegistration = registrationError(state, options.registrations);
  if (badRegistration) {
    return { ok: false, errorCode: "error.67", error: badRegistration };
  }
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };

  const at = nightAt(state);
  const actor = (step.actorId ? playerById(state, step.actorId) : null) as Player;
  let targets = Array.isArray(options.targetIds) ? options.targetIds.map(String) : [];
  if (step.roleId === "moonchild") {
    // The public choice made when the Moonchild died is the only legal target.
    // A missing target reuses the record; a different one is a rejection.
    const recorded = Array.isArray(step.targetIds) ? step.targetIds.map(String) : [];
    if (recorded.length) {
      if (!targets.length) {
        targets = recorded.slice();
        options = { ...options, targetIds: targets.slice() };
      } else if (
        targets.length !== recorded.length ||
        targets.some((id, index) => id !== recorded[index])
      ) {
        return {
          ok: false,
          errorCode: "error.51",
          error: "Цель не совпадает с публичным выбором Дитя Луны.",
        };
      }
    }
  }
  if (
    actor &&
    !actor.alive &&
    !DEATH_TRIGGERED[step.roleId || ""] &&
    !minionRetainsAbility(state, actor.id)
  ) {
    step.done = true;
    step.skipped = true;
    setStepNote(step, "note.actorDied", null, "Игрок погиб до своего шага.");
    return { ok: false, errorCode: "error.38", error: "Игрок погиб до своего шага." };
  }

  if (step.bmr || step.sv) {
    if (targets.length < (step.minTargets || 0) || targets.length > (step.maxTargets || 0)) {
      return {
        ok: false,
        errorCode: "error.39",
        error:
          "Нужно выбрать от " +
          (step.minTargets || 0) +
          " до " +
          (step.maxTargets || 0) +
          " целей.",
      };
    }
    if (
      step.sv &&
      step.roleId != null &&
      ["dreamer", "seamstress"].includes(step.roleId) &&
      step.actorId != null &&
      targets.includes(step.actorId)
    ) {
      return { ok: false, errorCode: "error.40", error: "Нельзя выбрать себя." };
    }
  } else if (!step.sv && step.targetMode === "one-any" && targets.length !== 1) {
    return { ok: false, errorCode: "error.39", error: "Выберите одну цель." };
  }
  if (!step.bmr && step.targetMode === "one-other" && targets.length !== 1) {
    return { ok: false, errorCode: "error.39", error: "Выберите одну цель." };
  }
  if (!step.bmr && !step.sv && step.targetMode === "one-other" && targets[0]! === step.actorId) {
    return { ok: false, errorCode: "error.40", error: "Нельзя выбрать себя." };
  }
  for (const id of targets) {
    if (!playerById(state, id))
      return { ok: false, errorCode: "error.31", error: "Цель не найдена." };
  }
  // Bad Moon Rising target text: Sailor r1768 and Devil's Advocate r2594 choose
  // an alive/living player, Chambermaid r2966 chooses 2 alive players (not
  // themself). A registered-dead Zombuul counts as dead for the ability.
  const registeredLiving = (id: string): boolean => registersAlive(playerById(state, id));
  if (
    step.bmr &&
    (step.roleId === "sailor" || step.roleId === "devilsadvocate") &&
    targets.some((id) => !registeredLiving(id))
  ) {
    return { ok: false, errorCode: "error.55", error: "Нельзя выбрать мёртвого игрока." };
  }
  if (step.bmr && step.roleId === "chambermaid") {
    if (step.actorId != null && targets.includes(step.actorId)) {
      return { ok: false, errorCode: "error.40", error: "Нельзя выбрать себя." };
    }
    if (targets.some((id) => !registeredLiving(id))) {
      return { ok: false, errorCode: "error.55", error: "Нельзя выбрать мёртвого игрока." };
    }
  }
  if (step.previousTarget && targets.includes(step.previousTarget)) {
    return {
      ok: false,
      errorCode: "error.50",
      error: "Нельзя выбрать ту же цель, что в прошлую ночь.",
    };
  }
  if (!step.bmr && !step.sv && step.targetMode === "two") {
    if (targets.length !== 2)
      return { ok: false, errorCode: "error.41", error: "Выберите двух разных игроков." };
    if (targets[0]! === targets[1])
      return { ok: false, errorCode: "error.42", error: "Нужны два разных игрока." };
  }

  if (step.kind === "system") {
    return completeSystemStep(state, step, options);
  }

  if (step.sv) {
    let pending: PendingChoice | null = null;
    if (step.infoKind !== "none") {
      const checked = validateGiven(step, infoForStep(state, step, options), options);
      if ("rejection" in checked) return checked.rejection;
      pending = checked.pending;
    }
    const result = completeSvStep(state, step, options);
    if (result && result.ok === false) return result;
    const finished = finishStep(state, step, options, targets, at);
    recordPending(state, pending, step);
    return finished;
  }

  if (step.bmr) {
    let pending: PendingChoice | null = null;
    if (step.infoKind !== "none") {
      // A note-only Bad Moon Rising answer is free-form narration; a step that
      // computes options is held to them like every other information step.
      const checked = validateGiven(step, infoForStep(state, step, options), options);
      if ("rejection" in checked) return checked.rejection;
      pending = checked.pending;
    }
    const actor = step.actorId ? playerById(state, step.actorId) : null;
    // The Goon makes its first chooser drunk immediately, before the ability
    // resolves. Apply it after the information gate so a rejected completion
    // does not leave a half-applied effect.
    applyBmrGoonTrigger(state, step, targets);
    if (step.roleId === "grandmother" && step.kind === "role" && nightAt(state).number === 1) {
      state.setup.grandmotherId = targets[0]! || null;
    }
    if (step.roleId === "lunatic" && actor && targets[0]!) {
      actor.used = actor.used || {};
      actor.used.lunaticTarget = targets[0]!;
      actor.used.lunaticTargetNight = nightAt(state).number;
    }
    completeBmrStep(state, step, options);
    const finished = finishStep(state, step, options, targets, at);
    recordPending(state, pending, step);
    return finished;
  }

  const role = step.roleId;

  if (role === "poisoner") {
    if (isImpaired(state, actor.id, at)) {
      setStepNote(
        step,
        "note.abilityFailed",
        null,
        "Способность не сработала: игрок отравлен или пьян.",
      );
    } else {
      state.effects.forEach((effect) => {
        if (effect.kind === "poison" && effect.sourceId === actor.id) effect.active = false;
      });
      state.effects.push({
        id: "eff-" + (state.effects.length + 1) + "-" + Math.random().toString(36).slice(2, 6),
        kind: "poison",
        sourceId: actor.id,
        targetId: targets[0]!,
        start: at,
        expires: { phase: "night", number: at.number + 1 },
        active: true,
      });
      setStepNote(
        step,
        "note.poisoned",
        { name: seatName(state, targets[0]!) },
        "Отравлен: " + seatName(state, targets[0]!) + ".",
      );
    }
    return finishStep(state, step, options, targets, at);
  }

  if (role === "monk") {
    if (isImpaired(state, actor.id, at)) {
      setStepNote(
        step,
        "note.abilityFailed",
        null,
        "Способность не сработала: игрок отравлен или пьян.",
      );
    } else {
      state.effects.forEach((effect) => {
        if (effect.kind === "protected" && effect.sourceId === actor.id) effect.active = false;
      });
      state.effects.push({
        id: "eff-" + (state.effects.length + 1) + "-" + Math.random().toString(36).slice(2, 6),
        kind: "protected",
        sourceId: actor.id,
        targetId: targets[0]!,
        start: at,
        expires: { phase: "day", number: at.number },
        active: true,
      });
      setStepNote(
        step,
        "note.protected",
        { name: seatName(state, targets[0]!) },
        "Защищён этой ночью: " + seatName(state, targets[0]!) + ".",
      );
    }
    return finishStep(state, step, options, targets, at);
  }

  if (role === "butler") {
    const impaired = isImpaired(state, actor.id, at);
    actor.butlerMasterId = targets[0]!;
    state.effects.push({
      id: "eff-" + (state.effects.length + 1) + "-" + Math.random().toString(36).slice(2, 6),
      kind: "butler",
      sourceId: actor.id,
      targetId: targets[0]!,
      start: at,
      expires: { phase: "night", number: at.number + 1 },
      active: !impaired,
    });
    if (impaired) {
      setStepNote(
        step,
        "note.abilityFailed",
        null,
        "Способность не сработала: игрок отравлен или пьян.",
      );
    } else {
      setStepNote(
        step,
        "note.butlerMaster",
        { name: seatName(state, targets[0]!) },
        "Завтра голосует только вместе с: " + seatName(state, targets[0]!) + ".",
      );
    }
    return finishStep(state, step, options, targets, at);
  }

  if (role === "imp") {
    const attack = resolveAttack(state, {
      attackerId: actor.id,
      targetId: targets[0]!,
      at,
      redirectId: options.redirectId || null,
    });
    if (attack.needsRedirect) {
      return {
        ok: false,
        needsRedirect: true,
        options: attack.options,
        errorCode: "error.43",
        error: "Выберите, умирает Мэр, кто-то вместо него или никто.",
      };
    }
    step.result = attack;
    // The redirect is a Storyteller decision: it belongs in the secret journal
    // even though this branch completes the step itself.
    if (options.redirectId) {
      recordHostChoice(
        state,
        "mayor-redirect",
        seatName(state, String(options.redirectId)),
        actor.id,
      );
    }
    if (attack.noDeath) {
      step.note = attack.reason || "";
    } else {
      setStepNote(
        step,
        "note.impKilled",
        { name: seatName(state, attack.deathId || "") },
        "Погиб: " + seatName(state, attack.deathId || "") + ".",
      );
    }
    step.done = true;
    step.completedAt = nowIso();
    step.given = null;
    addLog(state, {
      secret: true,
      kind: "night",
      title: "Имп атакует",
      detail: step.note || "",
      ...(attack.noDeath ? { consequence: "prevented" as const } : {}),
    });
    appendConditionalSteps(state);
    if (attack.pendingInheritance) {
      step.pending = attack.pendingInheritance;
    }
    checkWin(state);
    return { ok: true, step, result: step.result };
  }

  if (role === "ravenkeeper") {
    const checked = validateGiven(step, infoForStep(state, step, options), options);
    if ("rejection" in checked) return checked.rejection;
    const finished = finishStep(state, step, options, targets, at);
    recordPending(state, checked.pending, step);
    return finished;
  }

  if (role === "undertaker") {
    const checked = validateGiven(step, infoForStep(state, step, options), options);
    if ("rejection" in checked) return checked.rejection;
    const finished = finishStep(state, step, options, targets, at);
    recordPending(state, checked.pending, step);
    return finished;
  }

  if (
    role === "chef" ||
    role === "empath" ||
    role === "fortuneteller" ||
    role === "washerwoman" ||
    role === "librarian" ||
    role === "investigator"
  ) {
    const info = infoForStep(state, step, options);
    if (info.missing) {
      return {
        ok: false,
        needsSetup: true,
        info,
        errorCode: "error.44",
        error: "Секретная информация ещё не настроена.",
      };
    }
    const checked = validateGiven(step, info, options);
    if ("rejection" in checked) return checked.rejection;
    const finished = finishStep(state, step, options, targets, at);
    recordPending(state, checked.pending, step);
    return finished;
  }

  if (role === "spy") {
    step.given = { kind: "grimoire" };
    return finishStep(state, step, options, targets, at);
  }

  return finishStep(state, step, options, targets, at);
}

export function finishStep(
  state: GameState,
  step: NightStep,
  options: NightOptions,
  targets: string[],
  at: DeadAt,
) {
  step.targetIds = targets.slice();
  step.registrations = options.registrations || {};
  if (Object.keys(step.registrations).length) {
    recordHostChoice(
      state,
      "registration",
      describeRegistrations(state, step.registrations),
      step.actorId || null,
    );
  }
  if (options.redirectId) {
    recordHostChoice(
      state,
      "mayor-redirect",
      seatName(state, String(options.redirectId)),
      step.actorId || null,
    );
  }
  step.impaired = step.actorId ? isImpaired(state, step.actorId, at) : false;
  step.done = true;
  step.completedAt = nowIso();
  if (!step.note) setStepNote(step, "note.finished", null, "Шаг выполнен.");
  const line = addLog(state, {
    secret: true,
    kind: "night",
    title: (step.roleId ? roleLabel(step.roleId) : step.system) || "Ночной шаг",
    detail: step.note ?? "",
  });
  // The console renders the localized note instead of the Russian detail.
  if (step.noteKey) {
    line.noteKey = step.noteKey;
    line.noteVars = step.noteVars ?? null;
  }
  appendConditionalSteps(state);
  checkWin(state);
  return { ok: true, step };
}

export function completeSystemStep(state: GameState, step: NightStep, _options: NightOptions) {
  if (step.system === "demonchange") {
    step.done = true;
    step.completedAt = nowIso();
    step.given = { kind: "note", text: step.note || "Демон сменился." };
    addLog(state, {
      secret: true,
      kind: "night",
      title: "Смена Демона",
      detail: step.note || "Демон сменился.",
    });
    return { ok: true, step };
  }
  step.done = true;
  step.completedAt = nowIso();
  if (step.system === "minioninfo") {
    step.given = { kind: "minion-info", demonId: step.demonId, actorIds: step.actorIds };
  } else if (step.system === "demoninfo") {
    step.given = {
      kind: "demon-info",
      bluffs: step.bluffs,
      lunaticId: step.lunaticId ?? null,
      actorIds: step.actorIds,
    };
  } else {
    step.given = { kind: "note", text: step.note || "Шаг выполнен." };
  }
  addLog(state, {
    secret: true,
    kind: "night",
    title: step.system === "minioninfo" ? "Знакомство Приспешников" : "Знакомство Демона",
    detail: "Информация показана.",
  });
  return { ok: true, step };
}

// ---------------------------------------------------------------------------
// Information

export function endNight(state: GameState) {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  const pending = demonChangePending(state);
  if (pending)
    return { ok: false, errorCode: "error.45", error: "Сначала выберите наследника Демона." };
  const unfinished = state.night.queue.filter((step) => !step.done && !step.skipped);
  if (unfinished.length) {
    return { ok: false, error: "Остались ночные шаги: " + unfinished.length + "." };
  }

  const night = nightAt(state).number;
  const morning = state.deaths
    .filter((death) => death.phase === "night" && death.number === night)
    .map((death) => ({ playerId: death.playerId }));
  state.phase = "day";
  state.day = {
    number: night,
    morning,
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: false,
  };
  addLog(state, {
    kind: "phase",
    title: "Утро " + night,
    detail: morning.length
      ? "Погибли: " + morning.map((death) => seatName(state, death.playerId)).join(", ") + "."
      : "Ночью никто не погиб.",
  });
  if (!isManualScript(state.script)) checkWin(state);
  return { ok: true, day: state.day };
}

export function skipStep(state: GameState, key: string, reason: string = "") {
  const step = state.night.queue.find((candidate) => candidate.key === key);
  if (!step) return { ok: false, errorCode: "error.36", error: "Шаг не найден." };
  if (step.done) return { ok: false, errorCode: "error.46", error: "Шаг уже выполнен." };
  const note = String(reason || "").trim();
  step.skipped = true;
  step.done = true;
  if (note) {
    setStepNote(step, "note.skipped", { reason: note }, "Пропущено: " + note);
  } else {
    setStepNote(step, "note.skippedNone", null, "Пропущено");
  }
  addLog(state, {
    secret: true,
    kind: "night",
    title: "Шаг пропущен",
    detail: note
      ? (step.roleId || step.system || "") + ": " + note
      : step.roleId || step.system || "",
  });
  appendConditionalSteps(state);
  checkWin(state);
  return { ok: true, step };
}

export function currentStep(state: GameState): NightStep | null {
  return state.night.queue.find((step) => !step.done && !step.skipped) || null;
}

export function stepProgress(state: GameState): { done: number; total: number } {
  const total = state.night.queue.length;
  const done = state.night.queue.filter((step) => step.done || step.skipped).length;
  return { done, total };
}
