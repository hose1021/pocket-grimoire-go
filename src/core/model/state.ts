import type { Alignment, GameJournal, GameState, LogEntry, Player, Role, RoleId } from "./types.js";

// Game state schema v4. Pure functions: no DOM, no localStorage.
import {
  ALL_ROLES,
  BMR_ALL,
  SNV_ALL,
  SUPPORTED_ROLES,
  isMixedEdition,
  isSupportedRole,
  isTbRole,
  roleTeam,
} from "./rules.ts";
import { troubleBrewingScript } from "./scripts.ts";
import { effectGraph } from "./effect-graph.ts";
import { cloneValidated, legacyArray, legacyRecord, validatedFromUnknown } from "./validated.ts";

// Saved data is an untyped external boundary; every read is validated here.
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isInt = (v: unknown): v is number => Number.isInteger(v);
const PHASES: readonly string[] = ["setup", "deal", "seat", "night", "day", "over"];
// A `DeadAt` cycle marker: an effect interval needs a phase and a number.
const isCycle = (v: unknown): boolean =>
  object(v) && isString(v.phase) && PHASES.includes(v.phase) && isInt(v.number);

export const SCHEMA_VERSION = 4;
export const STORAGE_KEY = "pg.game.v4";
export const LEGACY_KEY = "pg.game.v3";
export const LEGACY_V2_KEY = "pg.game.v2";

let clockOverride: (() => Date) | null = null;

export function nowIso() {
  return (clockOverride ? clockOverride() : new Date()).toISOString();
}

// Deterministic clock for command execution. The override is synchronous and
// restored in `finally`; it never survives a command.
export function withClock<T>(date: Date | string | number, fn: () => T): T {
  const previous = clockOverride;
  const fixed = date instanceof Date ? date : new Date(date);
  clockOverride = () => fixed;
  try {
    return fn();
  } finally {
    clockOverride = previous;
  }
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function emptyPlayer(id: string | number, index: number): Player {
  return {
    id: String(id),
    seat: Number(index) + 1,
    name: "",
    roleId: null,
    shownRoleId: null,
    team: null,
    alive: true,
    claimed: false,
    reminders: [],
    used: {},
    voteToken: true,
    butlerMasterId: null,
    changedFrom: null,
    deadAt: null,
    notes: "",
  };
}

export function emptyLog(): LogEntry[] {
  return [];
}

export function emptyJournal(): GameJournal {
  return { base: null, entries: [] };
}

/**
 * Puts `journal` right after `applied`, the position `createGame` declares, so
 * a state built by a migration or an import serialises with the same key order
 * as a fresh game.
 */
export function placeJournal(state: GameState, journal: GameJournal): void {
  const values = Object.entries(state).filter(([key]) => key !== "journal");
  for (const key of Object.keys(state)) Reflect.deleteProperty(state, key);
  let placed = false;
  for (const [key, value] of values) {
    Reflect.set(state, key, value);
    if (key === "applied") {
      Reflect.set(state, "journal", journal);
      placed = true;
    }
  }
  if (!placed) Reflect.set(state, "journal", journal);
}

export function createGame(count: number = 8): GameState {
  const size = Math.max(5, Math.min(15, Number(count) || 8));
  const players: Record<string, Player> = {};
  const order = [];
  for (let i = 0; i < size; i += 1) {
    const id = String(i + 1);
    order.push(id);
    players[id] = emptyPlayer(id, i);
  }
  return {
    v: SCHEMA_VERSION,
    scriptId: "tb",
    script: troubleBrewingScript(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    phase: "setup",
    setup: {
      count: size,
      roles: [],
      bluffs: [],
      drunkShownId: null,
      lunaticShownId: null,
      godfatherOutsider: 1,
      grandmotherId: null,
      evilTwinGoodId: null,
      evilTwinGoodPlayerId: null,
      evilTwinPlayerId: null,
      herringId: null,
      info: {
        washerwoman: null,
        librarian: null,
        investigator: null,
      },
      ready: false,
    },
    order,
    players,
    bluffs: [],
    herringId: null,
    gossip: null,
    juggler: null,
    lastDay: null,
    mastermind: null,
    fangguJumped: false,
    night: {
      number: 0,
      queue: [],
      currentIndex: 0,
      demonChanged: false,
    },
    day: {
      number: 0,
      morning: [],
      nominations: [],
      activeNominationId: null,
      execution: null,
      ended: false,
      open: false,
    },
    deaths: [],
    executions: [],
    effects: [],
    corrections: [],
    log: emptyLog(),
    notes: "",
    winner: null,
    reviewOpen: false,
    publicRevealed: false,
    applied: {},
    journal: emptyJournal(),
    storageError: null,
    migratedFrom: null,
  };
}

export function setRoster(state: GameState, count: number): GameState {
  const size = Math.max(5, Math.min(15, Number(count) || 8));
  const kept: Record<string, Player> = {};
  const order = [];
  for (let i = 0; i < size; i += 1) {
    const id = String(i + 1);
    order.push(id);
    kept[id] = emptyPlayer(id, i);
  }
  state.players = kept;
  state.order = order;
  state.setup.count = size;
  state.setup.roles = [];
  state.setup.bluffs = [];
  state.setup.drunkShownId = null;
  state.setup.lunaticShownId = null;
  state.setup.godfatherOutsider = 1;
  state.setup.grandmotherId = null;
  state.setup.evilTwinGoodId = null;
  state.setup.evilTwinGoodPlayerId = null;
  state.setup.evilTwinPlayerId = null;
  state.setup.herringId = null;
  state.setup.info = { washerwoman: null, librarian: null, investigator: null };
  state.bluffs = [];
  state.herringId = null;
  for (const player of Object.values(state.players)) {
    player.roleId = null;
    player.shownRoleId = null;
    player.team = null;
    player.alive = true;
    player.claimed = false;
    player.reminders = [];
    player.used = {};
    player.voteToken = true;
    player.butlerMasterId = null;
    player.changedFrom = null;
    player.deadAt = null;
  }
  state.phase = "setup";
  state.winner = null;
  state.reviewOpen = false;
  state.deaths = [];
  state.executions = [];
  state.effects = [];
  state.corrections = [];
  state.log = [];
  state.notes = "";
  state.applied = {};
  state.gossip = null;
  state.juggler = null;
  state.lastDay = null;
  state.mastermind = null;
  state.fangguJumped = false;
  state.day = {
    number: 0,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: false,
  };
  state.night = { number: 0, queue: [], currentIndex: 0, demonChanged: false };
  return state;
}

export function playerById(state: GameState, id: string): Player | null {
  return (state.players && state.players[id]) || null;
}

export function orderedPlayers(state: GameState): Player[] {
  return (state.order || []).map((id) => playerById(state, id)).filter((p) => p !== null);
}

export function livingPlayers(state: GameState): Player[] {
  return orderedPlayers(state).filter((p) => p.alive);
}

/** A player another ability sees as alive; a registered-dead Zombuul is not. */
export function registersAlive(player: Player | null | undefined): boolean {
  return Boolean(player && player.alive && !player.registeredDead);
}

export function livingIds(state: GameState): string[] {
  return livingPlayers(state).map((p) => p.id);
}

export function seatOf(state: GameState, id: string): number {
  const at = (state.order || []).indexOf(String(id));
  return at === -1 ? 0 : at + 1;
}

export function seatName(state: GameState, id: string): string {
  const p = playerById(state, id);
  return p ? p.name : "—";
}

export function realTeamOf(player: Player | null | undefined): Alignment | null {
  if (!player) return null;
  if (player.team) return player.team;
  const team = roleTeam(player.roleId || "");
  return team === "minion" || team === "demon" ? "evil" : team ? "good" : null;
}

export function effectiveRoleId(player: Player | null | undefined): RoleId | null {
  if (!player) return null;
  if (player.roleId === "drunk") return player.shownRoleId;
  return player.roleId;
}

export function publicRoleView(player: Player, role: Role) {
  if (!player || !role) return null;
  return {
    seat: player.seat,
    name: player.name,
    role: role.name,
    team: role.team === "minion" || role.team === "demon" ? "evil" : "good",
    teamLabel: role.team,
    ability: role.ability || "",
    image: role.image,
  };
}

export function publicGameView(state: GameState) {
  const living = livingPlayers(state).filter((player) => !player.registeredDead).length;
  const announced = (state.day && state.day.morning ? state.day.morning : []).map(
    (death) => death.playerId,
  );
  const registered = orderedPlayers(state)
    .filter((player) => player.registeredDead)
    .map((player) => player.id);
  // An execution is public: the town saw it, so the public page names the
  // player once the death is real (a prevented execution kills nobody).
  const execution = state.day && state.day.execution && state.day.execution.deathId
    ? [state.day.execution.playerId]
    : [];
  const deathNames = [...new Set([...announced, ...execution, ...registered])]
    .map((id) => seatName(state, id))
    .filter(Boolean);
  return {
    phase: state.phase,
    day: state.day ? state.day.number : 0,
    night: state.night ? state.night.number : 0,
    living,
    total: (state.order || []).length,
    deaths: deathNames,
    winner: state.winner ? { team: state.winner.team, reason: state.winner.reason } : null,
  };
}

// ---------------------------------------------------------------------------
// Migration and validation

// Legacy saves are an untyped external boundary; the migration normalizes them.
export function migrateV2(old: Record<string, unknown>): GameState {
  const oldPlayers = object(old.players) ? old.players : {};
  const count =
    Array.isArray(old.order) && old.order.length
      ? old.order.length
      : Object.keys(oldPlayers).length || 8;
  const state = createGame(count);
  state.migratedFrom = "v2";
  state.createdAt = typeof old.updatedAt === "string" ? old.updatedAt : state.createdAt;
  state.notes = typeof old.notes === "string" ? old.notes : "";
  state.order = Array.isArray(old.order) && old.order.length ? old.order.map(String) : state.order;
  if (state.order.length !== count) {
    state.order = state.order.slice(0, count);
    while (state.order.length < count) state.order.push(String(state.order.length + 1));
  }

  for (const id of state.order) {
    const raw = object(oldPlayers[id]) ? oldPlayers[id] : {};
    const base = state.players[id] || emptyPlayer(id, Number(id) - 1);
    const roleId = typeof raw.roleId === "string" && isTbRole(raw.roleId) ? raw.roleId : null;
    const shownRoleId =
      typeof raw.shownRoleId === "string" && isTbRole(raw.shownRoleId) ? raw.shownRoleId : roleId;
    const alive = raw.alive !== false;
    state.players[id] = {
      ...base,
      id,
      seat: Number(id),
      name: String(raw.name || "").trim(),
      roleId,
      shownRoleId,
      team: roleId
        ? roleTeam(roleId) === "minion" || roleTeam(roleId) === "demon"
          ? "evil"
          : "good"
        : null,
      alive,
      claimed: Boolean(raw.claimed),
      reminders: Array.isArray(raw.reminders) ? raw.reminders.filter(isString) : [],
      used: {},
      voteToken: true,
      deadAt: alive ? null : { phase: "night", number: Number(old.night) || 1, cause: "legacy" },
    };
    if (!alive) {
      state.deaths.push({
        id: "legacy-" + id,
        playerId: id,
        roleId,
        cause: "legacy",
        phase: "night",
        number: Number(old.night) || 1,
        at: state.createdAt,
        impaired: false,
        livingBefore: count,
      });
    }
  }

  const roles: RoleId[] = [];
  for (const p of orderedPlayers(state)) {
    if (p.roleId && !roles.includes(p.roleId)) roles.push(p.roleId);
  }
  state.setup.count = count;
  state.setup.roles = roles;
  state.setup.bluffs = (Array.isArray(old.bluffs) ? old.bluffs.filter(Boolean) : []) as RoleId[];
  state.setup.drunkShownId =
    (orderedPlayers(state).find((p) => p.roleId === "drunk") || { shownRoleId: null })
      .shownRoleId || null;
  state.bluffs = state.setup.bluffs.slice();
  state.night.number = Number(old.night) || 1;
  state.day.number = Math.max(1, state.night.number);
  state.phase = roles.length ? "night" : "setup";
  state.log = Array.isArray(old.log) ? legacyArray<LogEntry>(old.log.filter(object)) : [];
  state.night.queue = (Array.isArray(old.nightOrder) ? old.nightOrder : []).map((value, i) => {
    // A v2 save with a null step is malformed; reject it instead of inventing a step.
    if (!object(value)) throw new Error("Invalid legacy night step.");
    const row = value;
    return {
      key: "legacy-" + i,
      kind: "legacy",
      roleId: typeof row.roleId === "string" ? (row.roleId as RoleId) : null,
      actorId: null,
      title: String(row.role || row.roleId || "Шаг"),
      instruction: typeof row.step === "string" ? row.step : "",
      done: Boolean(row.done),
      legacy: true,
    };
  });
  state.setup.ready = roles.length === count;
  // The saved order is authoritative; validateState requires `seat` to mirror it.
  state.order.forEach((id, index) => {
    const player = state.players[id];
    if (player) player.seat = index + 1;
  });
  return state;
}

// Legacy saves are an untyped external boundary; the migration normalizes them.
export function migrateV3(old: Record<string, unknown>): GameState {
  const state = clone(legacyRecord(old));
  state.v = SCHEMA_VERSION;
  state.scriptId = "tb";
  state.script = troubleBrewingScript();
  state.migratedFrom = "v3";
  if (!state.journal) state.journal = emptyJournal();
  placeJournal(state, state.journal);
  // The v3 seat screen saved a reordered `order`; validateState requires each
  // `seat` to match its position, so renumber before the caller validates.
  const players = object(state.players) ? state.players : null;
  if (players) {
    (Array.isArray(state.order) ? state.order : []).forEach((id, index) => {
      const player = players[String(id)];
      if (object(player)) player.seat = index + 1;
    });
  }
  return state;
}

// Recover drafts and mixed pools produced before the manual-only flag and the
// custom- ID prefix existed. The caller validates the normalized state.
export function normalizeScriptState(value: unknown): unknown {
  if (!object(value)) return value;
  const script = value.script;
  if (!object(script)) return value;
  if (script.edition !== "custom") return value;
  if (script.id === "custom") {
    script.id = "custom-draft";
    value.scriptId = "custom-draft";
  }
  if (
    script.manualOnly === undefined &&
    Array.isArray(script.roles) &&
    isMixedEdition(script.roles.filter(isString) as RoleId[])
  ) {
    script.manualOnly = true;
  }
  return value;
}

// Save files are an untyped boundary; every field is checked here.
export function validateState(value: unknown): string[] {
  const errors: string[] = [];
  const check = (ok: boolean, message: string) => {
    if (!ok) errors.push(message);
  };
  if (!object(value)) return ["Invalid game object."];
  check(value.v === SCHEMA_VERSION, "Unsupported schema version.");
  check(isString(value.phase) && PHASES.includes(value.phase), "Invalid phase.");
  const script = object(value.script) ? value.script : null;
  const scriptRoles = script && Array.isArray(script.roles) ? (script.roles as RoleId[]) : [];
  check(script !== null, "Missing script.");
  if (script) {
    check(typeof script.id === "string" && script.id.length > 0, "Invalid script ID.");
    check(value.scriptId === script.id, "Script mismatch.");
    check(typeof script.name === "string" && script.name.trim().length > 0, "Invalid script name.");
    check(
      isString(script.edition) && ["tb", "bmr", "snv", "custom"].includes(script.edition),
      "Invalid script edition.",
    );
    check(
      script.source === undefined || typeof script.source === "string",
      "Invalid script source.",
    );
    check(
      script.author === undefined || typeof script.author === "string",
      "Invalid script author.",
    );
    check(
      script.manualOnly === undefined || typeof script.manualOnly === "boolean",
      "Invalid manual-only flag.",
    );
    check(scriptRoles.length >= 5 || value.phase === "setup", "Invalid script roster.");
    check(scriptRoles.length <= SUPPORTED_ROLES.length, "Invalid script roster.");
    check(new Set(scriptRoles).size === scriptRoles.length, "Duplicate script roles.");
    for (const roleId of scriptRoles)
      check(isSupportedRole(roleId), "Unsupported script role: " + roleId);
    if (script.id === "tb") {
      check(script.edition === "tb", "Invalid Trouble Brewing edition.");
      check(
        scriptRoles.length === ALL_ROLES.length &&
          ALL_ROLES.every((id) => scriptRoles.includes(id)),
        "Invalid Trouble Brewing roster.",
      );
    } else if (script.id === "bmr") {
      check(script.edition === "bmr", "Invalid Bad Moon Rising edition.");
      check(
        scriptRoles.length === BMR_ALL.length && BMR_ALL.every((id) => scriptRoles.includes(id)),
        "Invalid Bad Moon Rising roster.",
      );
    } else if (script.id === "snv") {
      check(script.edition === "snv", "Invalid Sects and Violets edition.");
      check(
        scriptRoles.length === SNV_ALL.length && SNV_ALL.every((id) => scriptRoles.includes(id)),
        "Invalid Sects and Violets roster.",
      );
    } else {
      check(
        isString(script.id) && (script.id === "custom" || script.id.startsWith("custom-")),
        "Invalid custom script ID.",
      );
      check(script.edition === "custom", "Invalid custom script edition.");
      const fromTb = scriptRoles.every((id) => ALL_ROLES.includes(id));
      const fromBmr = scriptRoles.every((id) => BMR_ALL.includes(id));
      const fromSnv = scriptRoles.every((id) => SNV_ALL.includes(id));
      const mixed = !(fromTb || fromBmr || fromSnv);
      check(
        !mixed || script.manualOnly === true,
        "Custom scripts cannot mix editions without manual-only mode.",
      );
    }
  }
  const inScript = (id: unknown): boolean =>
    typeof id === "string" && isSupportedRole(id) && scriptRoles.includes(id);
  const players = object(value.players) ? value.players : {};
  const order = Array.isArray(value.order) ? value.order : [];
  const ref = (id: unknown): boolean => typeof id === "string" && Object.hasOwn(players, id);
  check(object(value.players), "Missing players.");
  check(
    order.length >= 5 && order.length <= 15 && new Set(order).size === order.length,
    "Invalid seat order.",
  );
  check(Object.keys(players).length === order.length, "Roster does not match seats.");
  for (const id of order) check(ref(id), "Unknown seat: " + id);
  for (const [id, player] of Object.entries(players)) {
    if (!object(player)) {
      errors.push("Invalid player: " + id);
      continue;
    }
    check(player.id === id && order.includes(id), "Invalid player ID: " + id);
    check(
      Number.isInteger(player.seat) && player.seat === order.indexOf(id) + 1,
      "Invalid seat: " + id,
    );
    check(
      typeof player.name === "string" && typeof player.notes === "string",
      "Invalid player text: " + id,
    );
    for (const key of ["alive", "claimed", "voteToken"])
      check(typeof player[key] === "boolean", "Invalid " + key + ": " + id);
    check(
      player.registeredDead === undefined || typeof player.registeredDead === "boolean",
      "Invalid registered death: " + id,
    );
    check(
      Array.isArray(player.reminders) &&
        player.reminders.every((r: unknown) => typeof r === "string"),
      "Invalid reminders: " + id,
    );
    check(object(player.used), "Invalid used abilities: " + id);
    for (const key of ["roleId", "shownRoleId"]) {
      check(player[key] === null || inScript(player[key]), "Invalid role: " + id);
    }
    check(player.butlerMasterId == null || ref(player.butlerMasterId), "Invalid Butler master.");
  }
  for (const key of ["log", "deaths", "executions", "effects", "corrections"]) {
    check(Array.isArray(value[key]) && value[key].every(object), "Invalid " + key + ".");
  }
  check(
    typeof value.notes === "string" && object(value.applied),
    "Invalid notes or action ledger.",
  );
  if (value.journal !== undefined) {
    check(object(value.journal), "Invalid command journal.");
    if (object(value.journal)) {
      check(
        Array.isArray(value.journal.entries) && (value.journal.entries as unknown[]).every(object),
        "Invalid command journal entries.",
      );
      check(
        value.journal.base === null || object(value.journal.base),
        "Invalid command journal base.",
      );
    }
  }
  check(value.gossip == null || object(value.gossip), "Invalid gossip.");
  const juggler = object(value.juggler) ? value.juggler : null;
  check(value.juggler == null || juggler !== null, "Invalid Juggler state.");
  if (juggler) {
    check(typeof juggler.day === "number", "Invalid Juggler day.");
    const guesses = juggler.guesses;
    const valid = Array.isArray(guesses)
      ? guesses.every(
          (entry) =>
            object(entry) && typeof entry.playerId === "string" && typeof entry.roleId === "string",
        )
      : object(guesses);
    check(valid, "Invalid Juggler guesses.");
  }
  const lastDay = object(value.lastDay) ? value.lastDay : null;
  check(value.lastDay == null || lastDay !== null, "Invalid last-day state.");
  if (lastDay) {
    check(typeof lastDay.number === "number", "Invalid last-day number.");
    check(Array.isArray(lastDay.nominations), "Invalid last-day nominations.");
    check(
      lastDay.execution == null || (object(lastDay.execution) && ref(lastDay.execution.playerId)),
      "Invalid last-day execution.",
    );
    if (Array.isArray(lastDay.nominations))
      for (const nomination of lastDay.nominations)
        check(
          object(nomination) && ref(nomination.nominatorId) && ref(nomination.nomineeId),
          "Invalid last-day nomination players.",
        );
  }
  check(value.mastermind == null || object(value.mastermind), "Invalid Mastermind state.");
  if (object(value.mastermind))
    check(
      value.mastermind.playerId == null || ref(value.mastermind.playerId),
      "Invalid Mastermind player.",
    );
  check(
    value.fangguJumped === undefined || typeof value.fangguJumped === "boolean",
    "Invalid Fang Gu once flag.",
  );
  check(Array.isArray(value.bluffs) && value.bluffs.every(inScript), "Invalid bluffs.");
  const setup = value.setup;
  if (!object(setup)) errors.push("Missing setup.");
  else {
    check(setup.count === order.length, "Invalid player count.");
    for (const key of ["roles", "bluffs"])
      check(Array.isArray(setup[key]) && setup[key].every(inScript), "Invalid setup " + key + ".");
    check(object(setup.info), "Invalid setup information.");
    if (object(setup.info))
      for (const info of Object.values(setup.info)) {
        check(
          info === null || (object(info) && Array.isArray(info.pair) && info.pair.every(ref)),
          "Invalid information pair.",
        );
      }
    check(setup.herringId == null || ref(setup.herringId), "Invalid red herring.");
    check(setup.drunkShownId == null || inScript(setup.drunkShownId), "Invalid Drunk mask.");
    check(
      !(Array.isArray(setup.roles) && setup.roles.includes("lunatic")) ||
        (setup.lunaticShownId != null && inScript(setup.lunaticShownId)),
      "Invalid Lunatic mask.",
    );
    check(
      setup.godfatherOutsider == null ||
        (isInt(setup.godfatherOutsider) && [1, -1].includes(setup.godfatherOutsider)),
      "Invalid Godfather setup.",
    );
    check(setup.grandmotherId == null || ref(setup.grandmotherId), "Invalid grandchild.");
    check(
      setup.evilTwinGoodId == null || inScript(setup.evilTwinGoodId),
      "Invalid Evil Twin twin.",
    );
    check(
      setup.evilTwinGoodPlayerId == null || ref(setup.evilTwinGoodPlayerId),
      "Invalid Evil Twin good player.",
    );
    check(
      setup.evilTwinPlayerId == null || ref(setup.evilTwinPlayerId),
      "Invalid Evil Twin player.",
    );
  }
  const night = value.night;
  if (!object(night)) errors.push("Missing night.");
  else {
    check(isInt(night.number) && night.number >= 0, "Invalid night number.");
    check(Array.isArray(night.queue), "Invalid night queue.");
    if (Array.isArray(night.queue)) {
      check(
        isInt(night.currentIndex) &&
          night.currentIndex >= 0 &&
          night.currentIndex <= night.queue.length,
        "Invalid night position.",
      );
      const keys = new Set();
      for (const step of night.queue) {
        if (!object(step)) {
          errors.push("Invalid night step.");
          continue;
        }
        check(typeof step.key === "string" && !keys.has(step.key), "Invalid step key.");
        keys.add(step.key);
        check(step.actorId == null || ref(step.actorId), "Unknown night actor.");
        check(step.roleId == null || inScript(step.roleId), "Unknown night role.");
      }
    }
  }
  const day = value.day;
  if (!object(day)) errors.push("Missing day.");
  else {
    check(isInt(day.number) && day.number >= 0, "Invalid day number.");
    for (const key of ["morning", "nominations"])
      check(Array.isArray(day[key]) && day[key].every(object), "Invalid day " + key + ".");
    check(typeof day.open === "boolean" && typeof day.ended === "boolean", "Invalid day status.");
    check(
      day.execution === null || (object(day.execution) && ref(day.execution.playerId)),
      "Invalid execution.",
    );
    if (Array.isArray(day.morning))
      for (const death of day.morning)
        check(object(death) && ref(death.playerId), "Invalid morning death.");
    if (Array.isArray(day.nominations))
      for (const nomination of day.nominations)
        check(
          object(nomination) && ref(nomination.nominatorId) && ref(nomination.nomineeId),
          "Invalid nomination players.",
        );
  }
  for (const key of ["deaths", "executions"])
    if (Array.isArray(value[key])) {
      for (const event of value[key])
        check(object(event) && ref(event.playerId), "Unknown " + key + " player.");
    }
  if (Array.isArray(value.effects))
    for (const effect of value.effects) {
      if (!object(effect)) {
        errors.push("Invalid effect.");
        continue;
      }
      check(ref(effect.sourceId), "Invalid effect source.");
      check(ref(effect.targetId), "Invalid effect target.");
      check(typeof effect.active === "boolean", "Invalid effect status.");
      check(isCycle(effect.start), "Invalid effect interval.");
      check(effect.expires == null || isCycle(effect.expires), "Invalid effect interval.");
    }
  check(
    value.winner === null ||
      (object(value.winner) &&
        isString(value.winner.team) &&
        ["good", "evil"].includes(value.winner.team)),
    "Invalid winner.",
  );
  if (!errors.length) {
    // Every field above was checked, so the object now has the game shape.
    const graph = effectGraph(legacyRecord(value));
    if (!graph.ok) errors.push("Cyclic effect dependency: " + graph.effectIds.join(", "));
  }
  return errors;
}

// Saves written before the twin player ids existed store only the good twin
// role. Resolve the ids once at import, before any character change can move
// the roles, so the pair stays with these players.
function resolveEvilTwinPlayers(state: GameState) {
  if (state.setup.evilTwinGoodPlayerId != null || state.setup.evilTwinPlayerId != null) return;
  const goodRole = state.setup.evilTwinGoodId;
  if (!goodRole) return;
  const players = Object.values(state.players || {}) as Player[];
  const evil = players.find((player) => player && player.roleId === "eviltwin");
  const good = players.find((player) => player && player.roleId === goodRole);
  if (!evil || !good || evil.id === good.id) return;
  state.setup.evilTwinPlayerId = evil.id;
  state.setup.evilTwinGoodPlayerId = good.id;
}

// Imported files are an untyped external boundary; every field is validated.
export function importGame(
  value: unknown,
):
  | { ok: true; state: GameState }
  | { ok: false; error: string; errorCode?: string; errors?: string[] } {
  let candidate: unknown = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch (error) {
      return {
        ok: false,
        error: "Файл не является JSON: " + (error instanceof Error ? error.message : String(error)),
      };
    }
  }
  if (object(candidate) && candidate.format === "pocket-grimoire" && object(candidate.game)) {
    candidate = candidate.game;
  }
  if (!object(candidate)) {
    return { ok: false, error: "Файл не содержит состояния игры." };
  }
  if (candidate.v === 2 || candidate.v === 3) {
    try {
      const migrated = candidate.v === 2 ? migrateV2(candidate) : migrateV3(candidate);
      const graph = effectGraph(migrated);
      if (!graph.ok) {
        return {
          ok: false,
          error: "Циклическая зависимость эффектов.",
          errorCode: graph.errorCode,
          errors: graph.effectIds,
        };
      }
      const errors = validateState(migrated);
      if (errors.length) return { ok: false, error: errors.join(" ") };
      resolveEvilTwinPlayers(migrated);
      return { ok: true, state: migrated };
    } catch (error) {
      return {
        ok: false,
        error: "Invalid legacy save: " + (error instanceof Error ? error.message : String(error)),
      };
    }
  }
  normalizeScriptState(candidate);
  const graph = effectGraph(legacyRecord(candidate));
  if (!graph.ok) {
    return {
      ok: false,
      error: "Циклическая зависимость эффектов.",
      errorCode: graph.errorCode,
      errors: graph.effectIds,
    };
  }
  const outcome = validatedFromUnknown(candidate, validateState);
  if (!outcome.ok) {
    return { ok: false, error: outcome.errors.map((problem) => problem.message).join(" ") };
  }
  const state = cloneValidated(outcome.state);
  if (!state.journal) state.journal = emptyJournal();
  placeJournal(state, state.journal);
  state.storageError = null;
  state.migratedFrom = typeof candidate.migratedFrom === "string" ? candidate.migratedFrom : null;
  resolveEvilTwinPlayers(state);
  return { ok: true, state };
}

export function exportGame(state: GameState): string {
  return JSON.stringify(
    {
      format: "pocket-grimoire",
      version: SCHEMA_VERSION,
      exportedAt: nowIso(),
      warning: "Файл содержит секретные роли, эффекты и заметки Рассказчика.",
      game: state,
    },
    null,
    2,
  );
}
