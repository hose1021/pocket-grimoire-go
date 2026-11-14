// Core command surface: what a caller composes, what the engine receives, and
// the runtime shadow of both. Pure: no DOM, no storage, no React.

export const COMMAND_TYPES = [
  "startNight",
  "completeStep",
  "completeNightStep",
  "endNight",
  "skipStep",
  "chooseDemonHeir",
  "openNominations",
  "nominate",
  "recordVirginNomination",
  "recordVotes",
  "cancelNomination",
  "resetVotes",
  "execute",
  "executeByDecision",
  "madnessPenalty",
  "endDay",
  "useSlayer",
  "gossipStatement",
  "jugglerGuess",
  "moonchildChoice",
  "recordKlutzChoice",
  "tinkerDeath",
  "recoverClaim",
  "dealGame",
  "startGame",
  "claimSeat",
  "autoSecrets",
  "manualCorrection",
  "recordBmrOutcome",
  "recordSvOutcome",
  "resurrectPlayer",
  "setWinner",
  "bagUpdate",
  "setOrder",
  "setHerring",
  "setSetupInfo",
  "setSetupInfoZero",
  "normalizeSecrets",
  "setNotes",
  "setReviewOpen",
  "newGame",
  "importGame",
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

export type Phase = "setup" | "deal" | "seat" | "night" | "day" | "over";
export type Alignment = "good" | "evil";
export type InfoRoleId = "washerwoman" | "librarian" | "investigator";

export interface StepOptions {
  targetIds?: string[];
  redirectId?: string | null;
  registrations?: Record<string, string>;
  given?: Record<string, unknown> | null;
  resurrectId?: string | null;
  roleId?: string | null;
  drunkId?: string | null;
}

export interface NominationOptions {
  spyRegistersTownsfolk?: boolean;
}

export interface ExecutionOptions {
  survives?: boolean;
  recluseRegistersDemon?: boolean;
}

export interface SlayerOptions {
  recluseRegistersDemon?: boolean;
}

export interface ScriptInput {
  id: string;
  name: string;
  edition?: string;
  source?: string;
  author?: string;
  roles: string[];
  manualOnly?: boolean;
}

export interface BagPatch {
  script?: ScriptInput;
  count?: number;
  resetRoster?: boolean;
  phase?: Phase;
  roles?: string[];
  bluffs?: string[];
  drunkShownId?: string | null;
  lunaticShownId?: string | null;
  godfatherOutsider?: 1 | -1;
  evilTwinGoodId?: string | null;
}

export interface DealOptions {
  assignment?: Record<string, string>;
  random?: boolean;
}

/** The host's one action that takes a prepared bag into the first night. */
export interface StartGameOptions {
  assignment?: Record<string, string>;
  secrets?: boolean;
}

export interface AutoSecretsOptions {
  onlyMissing?: boolean;
}

export interface SetupInfoPatch {
  roleId?: string;
  pair?: [string, string];
  matchIndex?: number;
  forDrunk?: boolean;
  zero?: true;
}

export type CorrectionChange =
  | { kind: "alive"; playerId: string; value: boolean; reason: string }
  | { kind: "role"; playerId: string; value: string; reason: string }
  | { kind: "shown"; playerId: string; value: string | null; reason: string }
  | { kind: "reminder"; playerId: string; value: string; remove?: boolean; reason: string }
  | { kind: "effect"; effectId: string; value: boolean; reason: string }
  | { kind: "clear-winner"; reason: string };

export interface BmrOutcomeOptions {
  deathIds?: string[];
  resurrectId?: string | null;
}

export interface SvOutcomeOptions {
  deathIds?: string[];
  poisonId?: string | null;
}

export interface CommandPayloads {
  startNight: Record<string, never>;
  completeStep: { key: string; options?: StepOptions };
  completeNightStep: {
    key: string;
    targetIds?: string[];
    redirectId?: string | null;
    registrations?: Record<string, string>;
    given?: Record<string, unknown> | null;
    resurrectId?: string | null;
    roleId?: string | null;
    drunkId?: string | null;
    deathIds?: string[];
    poisonId?: string | null;
  };
  endNight: Record<string, never>;
  skipStep: { key: string; reason?: string };
  chooseDemonHeir: { stepKey: string; heirId: string };
  openNominations: Record<string, never>;
  nominate: { nominatorId: string; nomineeId: string; options?: NominationOptions };
  recordVirginNomination: { nominatorId: string; virginId: string; options?: NominationOptions };
  recordVotes: { nominationId: string; voterIds: string[] };
  cancelNomination: { nominationId: string };
  resetVotes: { nominationId: string; reason: string };
  execute: { nominationId: string; options?: ExecutionOptions };
  executeByDecision: { playerId: string; options?: ExecutionOptions };
  madnessPenalty: { playerId: string; effectId?: string; penalty: string; reason: string };
  endDay: Record<string, never>;
  useSlayer: { slayerId: string; targetId: string; options?: SlayerOptions };
  gossipStatement: { truth: boolean };
  jugglerGuess: {
    guesses?: Array<{ playerId: string; roleId: string }>;
    playerId?: string;
    roleId?: string;
  };
  moonchildChoice: { targetId: string };
  recordKlutzChoice: { targetId: string };
  tinkerDeath: { playerId: string };
  recoverClaim: { playerId: string; reason?: string };
  dealGame: { options?: DealOptions };
  startGame: { options?: StartGameOptions };
  claimSeat: { playerId: string; name: string };
  autoSecrets: { options?: AutoSecretsOptions };
  manualCorrection: { change: CorrectionChange };
  recordBmrOutcome: { stepKey: string; options?: BmrOutcomeOptions };
  recordSvOutcome: { stepKey: string; options?: SvOutcomeOptions };
  resurrectPlayer: { playerId: string };
  setWinner: { team: Alignment; reason: string };
  bagUpdate: { patch: BagPatch };
  setOrder: { order: string[] };
  setHerring: { playerId: string | null };
  setSetupInfo: { roleId: InfoRoleId; info: SetupInfoPatch };
  setSetupInfoZero: { roleId: InfoRoleId };
  normalizeSecrets: Record<string, never>;
  setNotes: { notes?: string };
  setReviewOpen: { open?: boolean };
  newGame: { count?: number };
  importGame: { text: string };
}

// A proposal, not an identity. `id`, `at` and `rulesetVersion` are boundary
// inputs: a legacy caller, a test or an imported action may supply them, and
// prepareCommand preserves them.
export type CommandInput = {
  [K in CommandType]: {
    type: K;
    payload: CommandPayloads[K];
    id?: string;
    at?: string;
    rulesetVersion?: string;
  };
}[CommandType];

// The one normalized envelope. Produced by prepareCommand or adoptPrepared.
export type PreparedCommand<K extends CommandType = CommandType> = {
  readonly id: string;
  readonly type: K;
  readonly payload: CommandPayloads[K];
  readonly at: string;
  readonly rulesetVersion: string;
  readonly fingerprint: string;
};

export type PrepareRejectionCode =
  | "command-missing-id"
  | "command-unknown"
  | "command-payload"
  | "command-payload-unknown-field"
  | "command-payload-type"
  | "command-at"
  | "command-fingerprint"
  | "ruleset-version-unsupported";

export type PrepareResult =
  | { ok: true; command: PreparedCommand }
  | { ok: false; errorCode: PrepareRejectionCode; reason: string };

// ---------------------------------------------------------------------------
// Runtime shadow of the payload union. A command with a field missing or extra
// is rejected before any state is read.

type FieldRule =
  | "string"
  | "nullable-string"
  | "string-array"
  | "boolean"
  | "number"
  | "object"
  | "nullable-object"
  | "alignment"
  | "shift"
  | "phase"
  | "guess-array";

type FieldSpec = readonly [rule: FieldRule, required?: true];

const string: FieldSpec = ["string"];
const requiredString: FieldSpec = ["string", true];
const nullableString: FieldSpec = ["nullable-string"];
const requiredNullableString: FieldSpec = ["nullable-string", true];
const stringArray: FieldSpec = ["string-array"];
const boolean: FieldSpec = ["boolean"];
const number: FieldSpec = ["number"];
const object: FieldSpec = ["object"];
const nullableObject: FieldSpec = ["nullable-object"];
const requiredObject: FieldSpec = ["object", true];

export const PAYLOAD_SCHEMA = {
  startNight: {},
  completeStep: { key: requiredString, options: object },
  completeNightStep: {
    key: requiredString,
    targetIds: stringArray,
    redirectId: nullableString,
    registrations: object,
    given: nullableObject,
    resurrectId: nullableString,
    roleId: nullableString,
    drunkId: nullableString,
    deathIds: stringArray,
    poisonId: nullableString,
  },
  endNight: {},
  skipStep: { key: requiredString, reason: string },
  chooseDemonHeir: { stepKey: requiredString, heirId: requiredString },
  openNominations: {},
  nominate: { nominatorId: requiredString, nomineeId: requiredString, options: object },
  recordVirginNomination: {
    nominatorId: requiredString,
    virginId: requiredString,
    options: object,
  },
  recordVotes: { nominationId: requiredString, voterIds: ["string-array", true] },
  cancelNomination: { nominationId: requiredString },
  resetVotes: { nominationId: requiredString, reason: requiredString },
  execute: { nominationId: requiredString, options: object },
  executeByDecision: { playerId: requiredString, options: object },
  madnessPenalty: {
    playerId: requiredString,
    effectId: string,
    penalty: requiredString,
    reason: requiredString,
  },
  endDay: {},
  useSlayer: { slayerId: requiredString, targetId: requiredString, options: object },
  gossipStatement: { truth: ["boolean", true] },
  jugglerGuess: { guesses: ["guess-array"], playerId: string, roleId: string },
  moonchildChoice: { targetId: requiredString },
  recordKlutzChoice: { targetId: requiredString },
  tinkerDeath: { playerId: requiredString },
  recoverClaim: { playerId: requiredString, reason: string },
  dealGame: { options: object },
  startGame: { options: object },
  claimSeat: { playerId: requiredString, name: requiredString },
  autoSecrets: { options: object },
  manualCorrection: { change: requiredObject },
  recordBmrOutcome: { stepKey: requiredString, options: object },
  recordSvOutcome: { stepKey: requiredString, options: object },
  resurrectPlayer: { playerId: requiredString },
  setWinner: { team: ["alignment", true], reason: requiredString },
  bagUpdate: { patch: requiredObject },
  setOrder: { order: ["string-array", true] },
  setHerring: { playerId: requiredNullableString },
  setSetupInfo: { roleId: requiredString, info: requiredObject },
  setSetupInfoZero: { roleId: requiredString },
  normalizeSecrets: {},
  setNotes: { notes: string },
  setReviewOpen: { open: boolean },
  newGame: { count: number },
  importGame: { text: requiredString },
} as const satisfies Record<CommandType, Record<string, FieldSpec>>;

export const PHASES: readonly Phase[] = ["setup", "deal", "seat", "night", "day", "over"];

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesRule(value: unknown, rule: FieldRule): boolean {
  switch (rule) {
    case "string":
      return typeof value === "string";
    case "nullable-string":
      return value === null || typeof value === "string";
    case "string-array":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isPlainObject(value);
    case "nullable-object":
      return value === null || isPlainObject(value);
    case "guess-array":
      return (
        Array.isArray(value) &&
        value.every(
          (entry) =>
            isPlainObject(entry) &&
            typeof entry.playerId === "string" &&
            typeof entry.roleId === "string",
        )
      );
    case "alignment":
      return value === "good" || value === "evil";
    case "shift":
      return value === 1 || value === -1;
    case "phase":
      return typeof value === "string" && (PHASES as readonly string[]).includes(value);
  }
}

export interface PayloadProblem {
  field: string;
  reason: "unknown" | "type" | "missing";
}

/** Validates the payload shape for one command type. Unknown fields are errors. */
export function validatePayload(
  type: CommandType,
  payload: Record<string, unknown>,
): PayloadProblem[] {
  const schema: Record<string, FieldSpec> = PAYLOAD_SCHEMA[type];
  const problems: PayloadProblem[] = [];
  for (const field of Object.keys(payload)) {
    const spec = schema[field];
    if (!spec) {
      problems.push({ field, reason: "unknown" });
      continue;
    }
    if (!matchesRule(payload[field], spec[0])) problems.push({ field, reason: "type" });
  }
  for (const [field, spec] of Object.entries(schema)) {
    if (spec[1] && !(field in payload)) problems.push({ field, reason: "missing" });
  }
  return problems;
}

export function describePayloadProblem(type: CommandType, problem: PayloadProblem): string {
  const field = problem.field ? `'${problem.field}'` : "";
  if (problem.reason === "unknown") return `Unknown field ${field} in ${type}.`;
  if (problem.reason === "missing") return `Missing field ${field} in ${type}.`;
  return `Wrong type for field ${field} in ${type}.`;
}
