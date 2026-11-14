// Stable public domain API. Implementation is organized by responsibility.
export {
  nightAt,
  executionThreshold,
  dayAt,
  currentAt,
  cycleOf,
  addLog,
  playerName,
  actorForRole,
  playersWithEffectiveRole,
  aliveNeighbors,
  allNeighbors,
} from "./context.ts";
export {
  effectActive,
  activeEffects,
  isImpaired,
  protectionFor,
  soldierSafe,
  mayorRedirects,
  butlerMaster,
  bmrDrunkEffect,
} from "./effects.ts";
export type { InfoResult } from "./information.ts";
export {
  alignmentOf,
  registersAsDemon,
  registersAsTownsfolk,
  registersAsMinion,
  registersAsOutsider,
  chefCount,
  empathCount,
  fortuneTellerYes,
  characterChoices,
  infoForStep,
} from "./information.ts";
export {
  executionDeathForDay,
  demonChangePending,
  buildNightQueue,
  insertStepByOrder,
  pruneDeadSteps,
  appendConditionalSteps,
  startNight,
  completeStep,
  endNight,
  skipStep,
  currentStep,
  stepProgress,
  targetBounds,
} from "./night.ts";
export type { TargetBounds } from "./night.ts";
export {
  kill,
  becomeDemon,
  resolveDemonDeath,
  chooseDemonHeir,
  attackBlockReason,
  attackNeedsRedirect,
  resolveAttack,
  checkWin,
  setWinner,
} from "./death.ts";
export {
  openNominations,
  nominate,
  recordVirginNomination,
  recoverClaim,
  recordVotes,
  cancelNomination,
  resetVotes,
  leader,
  execute,
  executeByDecision,
  applyMadnessPenalty,
  endDay,
  useSlayer,
  gossipStatement,
  jugglerGuess,
  moonchildChoice,
} from "./day.ts";
export { setupErrors, secretsErrors, autoSecrets, dealGame, claimSeat } from "./setup.ts";
export { manualCorrection, bagSummary } from "./corrections.ts";
export { bmrInfoForStep, recordBmrOutcome, resurrectPlayer } from "./bmr.ts";
export {
  recordSvOutcome,
  buildSvNightQueue,
  replaceCharacter,
  vigormortisPoisonChoices,
  reconcileNoDashiiPoison,
  reconcileVigormortisPoison,
  reconcileMutantMadness,
  madnessEffects,
  activeMadness,
  madnessReviewsDue,
  MADNESS_PENALTIES,
} from "./sv.ts";
export {
  HOST_CHOICE_CASES,
  HOST_CHOICE_REASONS,
  caseForStep,
  describeGiven,
  describeRegistrations,
  givenIsLegal,
  legalRegistrations,
  recordHostChoice,
  registrationError,
} from "./host-choice.ts";
export type { HostChoiceCase } from "./host-choice.ts";
export { createRuntime, defaultRuntime, hashString } from "./runtime.ts";
export {
  RULESET_VERSION,
  SUPPORTED_RULESET_VERSIONS,
  COMMAND_STATUS,
  validateCommand,
  previewCommand,
  applyCommand,
  checkInvariants,
  canonicalState,
  startGame,
} from "./commands.ts";
export { replay } from "./replay.ts";
export type { ReplayResult } from "./replay.ts";
