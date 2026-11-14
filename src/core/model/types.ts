export type Phase = "setup" | "deal" | "seat" | "night" | "day" | "over";

export type CommandType =
  | "startNight"
  | "completeStep"
  | "completeNightStep"
  | "endNight"
  | "skipStep"
  | "chooseDemonHeir"
  | "openNominations"
  | "nominate"
  | "recordVirginNomination"
  | "recordVotes"
  | "cancelNomination"
  | "resetVotes"
  | "execute"
  | "executeByDecision"
  | "madnessPenalty"
  | "endDay"
  | "useSlayer"
  | "gossipStatement"
  | "jugglerGuess"
  | "moonchildChoice"
  | "recordKlutzChoice"
  | "tinkerDeath"
  | "recoverClaim"
  | "dealGame"
  | "startGame"
  | "claimSeat"
  | "autoSecrets"
  | "manualCorrection"
  | "recordBmrOutcome"
  | "recordSvOutcome"
  | "resurrectPlayer"
  | "setWinner"
  | "bagUpdate"
  | "setOrder"
  | "setHerring"
  | "setSetupInfo"
  | "setSetupInfoZero"
  | "normalizeSecrets"
  | "setNotes"
  | "setReviewOpen"
  | "newGame"
  | "importGame";

export type CommandStatus = "allowed" | "rejected" | "requires-storyteller-choice";

export interface Command {
  id: string;
  type: CommandType | string;
  payload?: Record<string, unknown>;
  at?: string | number;
  rulesetVersion?: string;
}

export interface DomainEvent {
  id: string;
  type: string;
  commandId: string;
  commandType: string;
  at: string;
  phase: string | null;
  payload: Record<string, unknown>;
}

export interface AllowedResult {
  status: "allowed";
  id: string;
  type: string;
  result?: Record<string, unknown> | null;
  followUp?: Record<string, unknown> | null;
  events?: DomainEvent[];
  changes?: Record<string, unknown> | null;
  future?: Record<string, unknown> | null;
  idempotent?: boolean;
  at?: string | null;
  undoable?: boolean;
  persisted?: boolean;
  resetHistory?: boolean;
}

export interface RejectedResult {
  status: "rejected";
  ok?: false;
  id?: string | null;
  type?: string | null;
  reason: string;
  errorCode?: string | null;
  errors?: string[] | null;
  persisted?: boolean;
}

export interface ChoiceResult {
  status: "requires-storyteller-choice";
  choice: { kind: string; options: unknown[]; context: unknown };
  reason: string;
  errorCode?: string | null;
}

export type CommandResult = AllowedResult | RejectedResult | ChoiceResult;
export type Team = "townsfolk" | "outsider" | "minion" | "demon" | "traveller";
export type Alignment = "good" | "evil";
export type ScriptEdition = "tb" | "bmr" | "snv" | "custom";
export type RoleId = string;

export interface Role {
  id: RoleId;
  name: string;
  ability?: string;
  team: Team;
  edition: "tb" | "bmr" | "snv" | "traveller";
  image?: string | string[];
  firstNight?: number | null;
  otherNight?: number | null;
  [key: string]: unknown;
}

export interface Script {
  id: string;
  name: string;
  edition: ScriptEdition;
  roles: RoleId[];
  source?: string;
  author?: string;
  manualOnly?: boolean;
  [key: string]: unknown;
}

export interface DeadAt {
  phase: Phase;
  number: number;
  cause?: string;
  [key: string]: unknown;
}

export interface Used {
  assassin?: boolean;
  courtier?: boolean;
  exorcistTarget?: string | null;
  fanggu?: boolean;
  fool?: boolean;
  juggler?: boolean;
  jugglerGuesses?: string[];
  lunaticTarget?: string;
  moonchildResolved?: boolean;
  moonchildTarget?: string;
  philosopher?: boolean;
  poNoOne?: boolean;
  professor?: boolean;
  seamstress?: boolean;
  shabalothTargets?: string[];
  slayer?: boolean;
  virgin?: boolean;
  zombuul?: boolean;
  [key: string]: boolean | string | string[] | number | null | undefined;
}

export interface Player {
  id: string;
  seat: number;
  name: string;
  roleId: RoleId | null;
  shownRoleId: RoleId | null;
  team: Alignment | null;
  alive: boolean;
  claimed: boolean;
  reminders: string[];
  used: Used;
  voteToken: boolean;
  butlerMasterId: string | null;
  changedFrom: RoleId | null;
  deadAt: DeadAt | null;
  notes: string;
  registeredDead?: boolean;
  [key: string]: unknown;
}

export interface InfoPair {
  roleId: RoleId;
  pair: [string, string];
  matchIndex?: number;
  forDrunk?: boolean;
}

export interface ZeroInfo {
  zero: true;
  pair: [];
}

export type SetupInfo = InfoPair | ZeroInfo | null;

export interface SetupInfoMap {
  washerwoman: SetupInfo;
  librarian: SetupInfo;
  investigator: SetupInfo;
  [key: string]: SetupInfo;
}

export interface Setup {
  count: number;
  roles: RoleId[];
  bluffs: RoleId[];
  drunkShownId: RoleId | null;
  lunaticShownId: RoleId | null;
  godfatherOutsider: 1 | -1 | null;
  grandmotherId: string | null;
  evilTwinGoodId: RoleId | null;
  evilTwinGoodPlayerId: string | null;
  evilTwinPlayerId: string | null;
  herringId: string | null;
  info: SetupInfoMap;
  ready: boolean;
  [key: string]: unknown;
}

export interface LogEntry {
  id: string;
  at: string;
  phase: string;
  kind: string;
  title: string;
  detail: string;
  playerId: string | null;
  secret: boolean;
  /** Written when the line records a death, a prevention or a resurrection. */
  consequence?: "death" | "prevented" | "revived";
  /** The host-choice case this line records, when the line is a choice. */
  case?: string | null;
  [key: string]: unknown;
}

export interface PendingStep {
  kind: string;
  options?: unknown[];
  [key: string]: unknown;
}

export interface NightStep {
  key: string;
  kind: string;
  roleId?: RoleId | null;
  actorId?: string | null;
  actorName?: string;
  actorAlive?: boolean;
  order?: number;
  targetMode?: string;
  minTargets?: number;
  maxTargets?: number;
  infoKind?: string;
  optional?: boolean;
  canKill?: boolean;
  canResurrect?: boolean;
  note?: string | null;
  /** Locale-neutral console key; `note` stays the persisted fallback. */
  noteKey?: string | null;
  noteVars?: Record<string, string | number> | null;
  targetIds?: string[];
  done?: boolean;
  pending?: PendingStep | null;
  bmr?: boolean;
  sv?: boolean;
  legacy?: boolean;
  title?: string;
  instruction?: string;
  system?: string;
  demonId?: string | null;
  bluffs?: string[];
  registrations?: Record<string, string>;
  previousTarget?: string;
  given?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface NightState {
  number: number;
  queue: NightStep[];
  currentIndex: number;
  demonChanged: boolean;
}

export interface Nomination {
  id: string;
  nominatorId: string;
  nomineeId: string;
  at: string;
  votes: string[];
  deadVoters?: string[];
  count: number;
  threshold: number;
  recorded: boolean;
  [key: string]: unknown;
}

export interface Death {
  id: string;
  playerId: string;
  roleId: RoleId | null;
  cause: string;
  phase: Phase;
  number: number;
  at: string;
  impaired?: boolean;
  livingBefore?: number;
  fake?: boolean;
  demon?: boolean;
  [key: string]: unknown;
}

export interface Execution {
  playerId: string;
  cause: string;
  at: string;
  deathId?: string | null;
  nominationId?: string | null;
  [key: string]: unknown;
}

export interface DayState {
  number: number;
  morning: Array<{ playerId: string; [key: string]: unknown }>;
  nominations: Nomination[];
  activeNominationId: string | null;
  execution: Execution | null;
  ended: boolean;
  open: boolean;
}

export interface Effect {
  id: string;
  kind: string;
  sourceId: string | null;
  targetId: string | null;
  start: DeadAt;
  expires?: DeadAt | null;
  active: boolean;
  bmr?: string;
  suz?: string;
  suspended?: string;
  resumeOnHealthy?: boolean;
  createdAt?: string;
  resolve?: DeadAt;
  pukka?: boolean;
  day?: number;
  deathIds?: string[];
  demon?: boolean;
  [key: string]: unknown;
}

export interface Correction {
  id?: string;
  at: string;
  change?: Record<string, unknown>;
  kind?: string;
  playerId?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface Winner {
  team: Alignment;
  reason: string;
  title?: string;
  detail?: string;
  at?: string;
  [key: string]: unknown;
}

export type EffectGraphResult =
  | { ok: true; activePoison: Set<string>; activeDrunk: Set<string>; impaired: Set<string> }
  | { ok: false; errorCode: string; effectIds: string[] };

export interface AppliedEntry {
  type: string;
  at: string;
  rulesetVersion: string;
  fingerprint: string;
  followUp: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  undoable?: boolean;
}

/** One replayable command: the boundaries it crossed, not the state it made. */
export interface JournalEntry {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  at: string;
  rulesetVersion: string;
  fingerprint: string;
  undoable: boolean;
}

/** The deterministic command history: one base state plus ordered commands. */
export interface GameJournal {
  base: GameState | null;
  entries: JournalEntry[];
}

export interface Gossip {
  truth: boolean;
  day: number;
  [key: string]: unknown;
}

// The Juggler's public first-day guesses. The current shape is a list because
// the same player may be guessed more than once; a saved game may still carry
// the legacy player-id map, which both the engine and the validator read.
export interface JugglerGuess {
  playerId: string;
  roleId: RoleId;
}

export interface Juggler {
  day: number;
  guesses: JugglerGuess[] | Record<string, RoleId>;
  [key: string]: unknown;
}

// The day that just ended, kept for the next night's "today" questions.
export interface LastDay {
  number: number;
  nominations: Nomination[];
  execution: Execution | null;
  [key: string]: unknown;
}

export interface Mastermind {
  [key: string]: unknown;
}

declare global {
  interface Window {
    PG?: { roles?: Role[] };
  }
  interface ImportMeta {
    readonly env?: { readonly BASE_URL?: string };
  }
}

export interface GameState {
  v: number;
  scriptId: string;
  script: Script;
  createdAt: string;
  updatedAt: string;
  phase: Phase;
  setup: Setup;
  order: string[];
  players: Record<string, Player>;
  bluffs: RoleId[];
  herringId: string | null;
  gossip: Gossip | null;
  juggler: Juggler | null;
  lastDay: LastDay | null;
  mastermind: Mastermind | null;
  fangguJumped: boolean;
  night: NightState;
  day: DayState;
  deaths: Death[];
  executions: Execution[];
  effects: Effect[];
  corrections: Correction[];
  log: LogEntry[];
  notes: string;
  winner: Winner | null;
  reviewOpen: boolean;
  publicRevealed: boolean;
  applied: Record<string, AppliedEntry>;
  journal: GameJournal;
  storageError: string | null;
  migratedFrom: string | null;
  revision?: number;
}
