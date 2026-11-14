// Screen projections for the storyteller console. The screens render these
// derived values; they never call the engine to compute a rule themselves.
import {
  activeEffects,
  attackNeedsRedirect,
  bmrDrunkEffect,
  butlerMaster,
  characterChoices,
  currentStep,
  demonChangePending,
  executionThreshold,
  infoForStep,
  isImpaired,
  madnessEffects,
  madnessReviewsDue,
  protectionFor,
  secretsErrors,
  setupErrors,
  soldierSafe,
  stepProgress,
  vigormortisPoisonChoices,
} from "../../core/engine/index.ts";
import { livingPlayers, orderedPlayers, playerById } from "../../core/model/state.ts";
import type { Effect, GameState, NightStep, RoleId } from "../../core/model/types.ts";
import type { InfoResult } from "../../core/engine/index.ts";

export interface SetupProblem {
  code: string;
  message: string;
}

/** How many night steps are done and how many the queue holds. */
export function progressProjection(state: GameState): { done: number; total: number } {
  return stepProgress(state);
}

/** The phase-level facts the night, day and deal cards render. */
export interface TableProjection {
  step: NightStep | null;
  progress: { done: number; total: number };
  pendingDemonChange: NightStep | null;
  living: number;
  threshold: number;
}

export function tableProjection(state: GameState): TableProjection {
  const living = livingPlayers(state).length;
  return {
    step: currentStep(state),
    progress: progressProjection(state),
    pendingDemonChange: demonChangePending(state),
    living,
    threshold: executionThreshold(living),
  };
}

export interface MadnessReviewProjection {
  effect: Effect;
  playerId: string;
  pending: boolean;
}

/** Active host-only madness and whether it still needs today's review. */
export function madnessReviewProjection(state: GameState): MadnessReviewProjection[] {
  const due = new Set(madnessReviewsDue(state).map((effect) => effect.id));
  const seatOrder = new Map(orderedPlayers(state).map((player, index) => [player.id, index]));
  return madnessEffects(state)
    .map((effect) => ({
      effect,
      playerId: String(effect.targetId || ""),
      pending: due.has(effect.id),
    }))
    .sort(
      (left, right) =>
        (seatOrder.get(left.playerId) ?? Infinity) - (seatOrder.get(right.playerId) ?? Infinity),
    );
}

export interface StepProjectionInput {
  targetIds?: string[];
  registrations?: Record<string, string>;
}

/** Everything the step card derives for one draft, computed once. */
export interface StepProjection {
  info: InfoResult;
  effects: Effect[];
  needsRedirect: boolean;
  actorImpaired: boolean;
}

export function stepProjection(
  state: GameState,
  step: NightStep,
  input: StepProjectionInput = {},
): StepProjection {
  const targetIds = input.targetIds || [];
  const ids = [step.actorId || "", ...targetIds];
  const options = input.registrations
    ? { targetIds, registrations: input.registrations }
    : { targetIds };
  return {
    info: infoForStep(state, step, options),
    effects: activeEffects(state, null).filter(
      (effect) =>
        (effect.sourceId != null && ids.includes(String(effect.sourceId))) ||
        (effect.targetId != null && ids.includes(String(effect.targetId))),
    ),
    needsRedirect: mayorRedirectNeeded(state, step, targetIds[0] || ""),
    actorImpaired: step.actorId ? isImpaired(state, step.actorId) : false,
  };
}

/** The host must redirect only a demon attack that would kill a Mayor. */
export function mayorRedirectNeeded(state: GameState, step: NightStep, targetId: string): boolean {
  if (step.roleId !== "imp") return false;
  return attackNeedsRedirect(state, { attackerId: step.actorId || "", targetId });
}

/** The effect, poison, protection and butler facts of one seat. */
export interface SeatProjection {
  impaired: boolean;
  drunk: boolean;
  poisoned: boolean;
  protected: boolean;
  safeFromAttack: boolean;
  butlerMasterId: string | null;
  registeredDead: boolean;
  scheduledDeath: boolean;
  drunkSourceRoleId: RoleId | null;
  poisonSourceRoleId: RoleId | null;
  protectionSourceRoleId: RoleId | null;
}

function sourceRoleOf(state: GameState, sourceId: string | null | undefined): RoleId | null {
  if (!sourceId) return null;
  const player = playerById(state, String(sourceId));
  return player && player.roleId ? player.roleId : null;
}

export function seatProjection(state: GameState, playerId: string): SeatProjection {
  const protection = protectionFor(state, playerId);
  const drunkEffect = bmrDrunkEffect(state, playerId);
  const effects = activeEffects(state, null).filter(
    (effect) => effect.targetId != null && String(effect.targetId) === playerId,
  );
  const poisonEffect = effects.find((effect) => effect.kind === "poison");
  const player = playerById(state, playerId);
  return {
    impaired: isImpaired(state, playerId),
    drunk: Boolean(drunkEffect),
    poisoned: !drunkEffect && isImpaired(state, playerId),
    protected: Boolean(protection),
    safeFromAttack: Boolean(protection) || soldierSafe(state, playerId),
    butlerMasterId: butlerMaster(state, playerId),
    registeredDead: Boolean(player && player.registeredDead),
    scheduledDeath: effects.some((effect) => effect.kind === "pukka-death"),
    drunkSourceRoleId: sourceRoleOf(state, drunkEffect && drunkEffect.sourceId),
    poisonSourceRoleId: sourceRoleOf(state, poisonEffect && poisonEffect.sourceId),
    protectionSourceRoleId: sourceRoleOf(state, protection && protection.sourceId),
  };
}

/** The legal Vigormortis poison neighbours for the first chosen death. */
export function poisonChoicesProjection(state: GameState, deathIds: string[]): string[] {
  return vigormortisPoisonChoices(state, deathIds[0]);
}

/**
 * The dead players the engine accepts for the resurrect select. The Professor
 * may only raise the target the step chose; the Shabaloth only a player it
 * chose last night. A role without that restriction offers every dead player.
 */
export function resurrectChoices(state: GameState, step: NightStep, targetIds: string[]): string[] {
  const dead = orderedPlayers(state)
    .filter((player) => !player.alive)
    .map((player) => player.id);
  if (step.roleId === "professor") {
    return dead.filter((id) => targetIds.includes(id));
  }
  if (step.roleId === "shabaloth") {
    const used = (step.actorId ? playerById(state, step.actorId) : null)?.used;
    if (!used || Number(used.shabalothTargetsNight) !== state.night.number - 1) return [];
    const previous = Array.isArray(used.shabalothTargets) ? used.shabalothTargets.map(String) : [];
    return dead.filter((id) => previous.includes(id));
  }
  return dead;
}

/** The role options the host may hand out as false information. */
export function shownRoleChoices(state: GameState, playerId: string): RoleId[] {
  return characterChoices(state, playerId, true);
}

export type { InfoResult } from "../../core/engine/index.ts";
export { targetBounds } from "../../core/engine/index.ts";
export type { TargetBounds } from "../../core/engine/index.ts";

export function setupProjection(state: GameState): { errors: SetupProblem[] } {
  return { errors: setupErrors(state) };
}

export function secretsProjection(state: GameState): { errors: SetupProblem[] } {
  return { errors: secretsErrors(state) };
}
