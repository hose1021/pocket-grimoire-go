// The one place the current night step is turned into a draft payload and the
// unanswered decisions that block it. The step sheet and the fixed dock both
// read this shape, so the two surfaces cannot disagree about a target list.
import {
  mayorRedirectNeeded,
  poisonChoicesProjection,
  stepProjection,
  targetBounds,
} from "../../../application/read-models/table.ts";
import type { InfoResult, StepProjection } from "../../../application/read-models/table.ts";
import type { CommandPayloads } from "../../../core/commands/contracts.ts";
import { playerById } from "../../../core/model/state.ts";
import type { GameState, NightStep, Player } from "../../../core/model/types.ts";
import type { StepInfo } from "./helpers.ts";
import { infoPayload, stepBlockers } from "./helpers.ts";
import type { StepBlocker } from "./helpers.ts";
import type { TableDrafts } from "./drafts.ts";

export interface StepContext {
  draftKey: string;
  registrations: Record<string, string>;
  selected: string[];
  given: StepInfo | undefined;
  redirect: string | null | undefined;
  derived: StepProjection;
  info: InfoResult;
  minTargets: number;
  maxTargets: number;
  targetsIncomplete: boolean;
  selectedPlayer: Player | null;
  deadImpTarget: boolean;
  targetsMayor: boolean;
  blockers: StepBlocker[];
  poisonChoices: string[];
  /** The command payload; preview and apply both read it. */
  payload: CommandPayloads["completeNightStep"];
}

export function stepContext(state: GameState, drafts: TableDrafts, step: NightStep): StepContext {
  const draftKey = `${state.createdAt}:${state.night.number}:${step.key}`;
  const registrations = drafts.registrations.get(draftKey) || {};
  const selected = drafts.targets.get(draftKey) || [];
  const derived = stepProjection(state, step, { targetIds: selected, registrations });
  const info = derived.info;
  const given = drafts.givens.get(draftKey);
  const { min: minTargets, max: maxTargets } = targetBounds(step);
  const targetsIncomplete = selected.length < minTargets || selected.length > maxTargets;
  const selectedPlayer = selected[0] ? playerById(state, selected[0]) : null;
  const redirect = drafts.redirects.get(draftKey);
  const targetsMayor = Boolean(mayorRedirectNeeded(state, step, selected[0] || "") && selected[0]);
  const needsRedirect = targetsMayor && !redirect;
  // A Courtier, Gambler, Cerenovus, Philosopher or Pit-Hag names a character;
  // completing empty would spend the ability or create no token.
  const needsRole =
    Array.isArray(step.roleChoices) &&
    step.roleChoices.length > 0 &&
    !drafts.bmrRoles.get(draftKey);
  // The Sailor and the Innkeeper always make one player drunk; an empty pick
  // must not silently become the first target.
  const needsDrunk =
    (step.roleId === "sailor" || step.roleId === "innkeeper") &&
    !targetsIncomplete &&
    !drafts.bmrDrunk.get(draftKey);
  const poisonChoices =
    step.roleId === "vigormortis"
      ? poisonChoicesProjection(state, drafts.bmrDeaths.get(draftKey) || [])
      : [];
  const payload = {
    key: step.key,
    targetIds: selected,
    redirectId: redirect || null,
    registrations,
    given: infoPayload(drafts.givens.get(draftKey) || null),
    resurrectId: drafts.bmrResurrect.get(draftKey) || null,
    roleId: drafts.bmrRoles.get(draftKey) || null,
    drunkId: drafts.bmrDrunk.get(draftKey) || null,
    poisonId: drafts.bmrPoison.get(draftKey) || poisonChoices[0] || null,
    deathIds: drafts.bmrDeaths.get(draftKey) || [],
  };
  return {
    draftKey,
    registrations,
    selected,
    given,
    redirect,
    derived,
    info,
    minTargets,
    maxTargets,
    targetsIncomplete,
    selectedPlayer,
    deadImpTarget: step.roleId === "imp" && selectedPlayer !== null && !selectedPlayer.alive,
    targetsMayor,
    blockers: stepBlockers({
      needsSetup: Boolean(info.missing),
      targetsIncomplete,
      needsRole,
      needsDrunk,
      needsGiven: Boolean(info.needsChoice && !given && !targetsIncomplete),
      needsRedirect,
    }),
    poisonChoices,
    payload,
  };
}
