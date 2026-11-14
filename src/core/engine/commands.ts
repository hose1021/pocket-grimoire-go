import type {
  Command,
  CommandResult,
  DomainEvent,
  GameState,
  InfoPair,
  JournalEntry,
  RejectedResult,
  ScriptEdition,
} from "../model/types.ts";
import type { CommandPayloads } from "../commands/contracts.ts";
import { legacyRecord } from "../model/validated.ts";

interface DomainOutcome {
  [key: string]: unknown;
  ok?: boolean;
  status?: string;
  choice?: unknown;
  errorCode?: string | null;
  reason?: string;
  error?: string;
  errors?: string[] | null;
  result?: unknown;
  followUp?: unknown;
}

// Command API: the only path for game-state changes.
//
// A command expresses intent: { id, type, payload, at?, rulesetVersion? }.
// An event describes a fact that happened: { id, type, commandId, ... }.
// An id is bound to a canonical fingerprint of type, payload and
// rulesetVersion; reusing it with different content is a conflict. Execution
// uses a seeded PRNG and a controlled clock. Preview captures the timestamp
// once per id, fingerprint and initial state; Apply reuses it (`command.at`
// pins it explicitly), so both agree for the same initial state.
//
// Every command runs on a draft. A rejected command or a failed invariant
// check discards the draft, so the real state is never partially changed.
// A successful command is recorded in `state.applied` by command id, so a
// repeated apply is a no-op. Event derivation is the domain diff used by
// preview and by the future replay log.
import {
  clone,
  createGame,
  importGame as importState,
  playerById,
  realTeamOf,
  setRoster,
  withClock,
} from "../model/state.ts";
import { effectGraph } from "../model/effect-graph.ts";
import { isMixedEdition, isSupportedRole, requiredBluffs, roleTeam } from "../model/rules.ts";

import { currentAt } from "./context.ts";
import { defaultRuntime, hashString } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";

import { completeStep, endNight, skipStep, startNight } from "./night.ts";
import {
  applyMadnessPenalty,
  cancelNomination,
  endDay,
  execute,
  executeByDecision,
  gossipStatement,
  jugglerGuess,
  moonchildChoice,
  nominate,
  openNominations,
  recordVirginNomination,
  recordVotes,
  recoverClaim,
  reportJugglerGuesses,
  resetVotes,
  tinkerDeath,
  useSlayer,
} from "./day.ts";
import { autoSecrets, claimSeat, dealGame } from "./setup.ts";
import { manualCorrection } from "./corrections.ts";
import { recordBmrOutcome, resolveSuspendedPukkaDeaths, resurrectPlayer } from "./bmr.ts";
import { recordKlutzChoice, recordSvOutcome } from "./sv.ts";
import { chooseDemonHeir, setWinner } from "./death.ts";

export const RULESET_VERSION = "tb-bmr-snv-2026-11-10";
export const SUPPORTED_RULESET_VERSIONS = new Set([RULESET_VERSION]);
export const COMMAND_STATUS = {
  ALLOWED: "allowed",
  REJECTED: "rejected",
  CHOICE: "requires-storyteller-choice",
} as const;

export function newCommandId() {
  const source = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (source && typeof source.randomUUID === "function") {
    return source.randomUUID();
  }
  return "cmd-" + Math.random().toString(36).slice(2, 12);
}

// ---------------------------------------------------------------------------
// Command handlers

const asRecordOrNull = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asOutcome = (value: unknown): RawOutcome => asRecordOrNull(value) || {};

// Engine handlers return a loose result; these fields are the ones the wrapper reads.
interface RawOutcome {
  ok?: boolean;
  status?: string;
  choice?: unknown;
  needsChoice?: boolean;
  needsRedirect?: boolean;
  needsSetup?: boolean;
  info?: { options?: unknown[] } | null;
  options?: unknown[];
  errorCode?: string | null;
  error?: string;
  errors?: string[] | null;
  reason?: string;
  result?: unknown;
  followUp?: unknown;
  pendingInheritance?: { options?: unknown[] } | null;
}

function commandResult(raw: unknown): DomainOutcome {
  const view = asOutcome(raw);
  if (!raw || typeof raw !== "object") return { ok: true, result: raw || null };
  if (view.ok === false) {
    if (view.needsChoice) {
      return {
        status: COMMAND_STATUS.CHOICE,
        choice: {
          kind: "info",
          options: (view.info && view.info.options) || [],
          context: view.info || null,
        },
        errorCode: view.errorCode || null,
        reason: view.error || "Требуется решение ведущего.",
      };
    }
    if (view.needsRedirect) {
      return {
        status: COMMAND_STATUS.CHOICE,
        choice: { kind: "redirect", options: view.options || [], context: raw },
        errorCode: view.errorCode || null,
        reason: view.error || "Выберите перенаправление.",
      };
    }
    if (view.needsSetup) {
      return {
        status: COMMAND_STATUS.CHOICE,
        choice: {
          kind: "setup",
          options: (view.info && view.info.options) || [],
          context: view.info || null,
        },
        errorCode: view.errorCode || null,
        reason: view.error || "Сначала настройте секретную информацию.",
      };
    }
    return {
      ok: false,
      errorCode: view.errorCode || null,
      error: view.error || "Команда отклонена.",
      errors: Array.isArray(view.errors) ? view.errors : null,
    };
  }
  return { ok: true, result: raw };
}

function finish(raw: unknown): DomainOutcome {
  const normalized = commandResult(raw);
  if (normalized.status === COMMAND_STATUS.CHOICE) return normalized;
  if (normalized.ok === false) return normalized;
  const result = asRecordOrNull(normalized.result);
  const pending = result ? asRecordOrNull(result.pendingInheritance) : null;
  const followUp = pending
    ? {
        type: "chooseDemonHeir",
        options: Array.isArray(pending.options) ? pending.options : [],
        context: pending,
      }
    : null;
  return { ok: true, result, followUp };
}

function completeNightStep(state: GameState, payload: CommandPayloads["completeNightStep"]) {
  const step = state.night.queue.find((candidate) => candidate.key === payload.key);
  if (!step) return { ok: false, errorCode: "error.36", error: "Шаг не найден." };
  const options: Parameters<typeof completeStep>[2] = {
    targetIds: payload.targetIds || [],
    redirectId: payload.redirectId ?? null,
    registrations: payload.registrations || {},
    resurrectId: payload.resurrectId ?? null,
    roleId: payload.roleId ?? null,
    drunkId: payload.drunkId ?? null,
  };
  if (payload.given != null) options.given = payload.given;
  const result = completeStep(state, payload.key, options);
  if (!result || result.ok === false) return result;
  if (step.bmr || step.sv) {
    const deathIds = payload.deathIds || [];
    if (deathIds.length || payload.resurrectId) {
      const outcome = step.sv
        ? recordSvOutcome(state, step.key, {
            deathIds,
            poisonId: payload.poisonId ?? null,
          })
        : recordBmrOutcome(state, step.key, {
            deathIds,
            resurrectId: payload.resurrectId || null,
          });
      if (!outcome.ok) return outcome;
    }
  }
  return result;
}

function applyJugglerGuess(state: GameState, payload: CommandPayloads["jugglerGuess"]) {
  if (Array.isArray(payload.guesses)) return reportJugglerGuesses(state, payload.guesses);
  if (typeof payload.playerId !== "string" || typeof payload.roleId !== "string") {
    return { ok: false, errorCode: "error.39", error: "Передайте список догадок Жонглёра." };
  }
  return jugglerGuess(state, payload.playerId, payload.roleId);
}

const INFO_ROLES = new Set(["washerwoman", "librarian", "investigator"]);

/**
 * Takes a prepared bag into the first night in one host action: deal the
 * roles, seal the seat order and fill the setup secrets, then start night 1.
 * A bag that still needs a host choice (the Drunk's false information) stays
 * rejected by `startNight` and the host records it with `setSetupInfo`.
 */
export function startGame(
  state: GameState,
  options: { assignment?: Record<string, string>; secrets?: boolean } = {},
) {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  if (state.phase !== "setup" && state.phase !== "deal" && state.phase !== "seat") {
    return { ok: false, errorCode: "error.47", error: "Игра уже началась." };
  }
  if (!state.setup.roles.length) {
    return { ok: false, errorCode: "error.34", error: "Сначала соберите мешок." };
  }
  if (state.phase === "setup") {
    const dealt = dealGame(state, options.assignment ? { assignment: options.assignment } : {});
    if (!dealt.ok) return dealt;
  }
  state.order.forEach((id, index) => {
    const player = state.players[id];
    if (player) player.seat = index + 1;
  });
  if (state.phase === "deal") state.phase = "seat";
  if (options.secrets !== false) autoSecrets(state, { onlyMissing: true });
  return startNight(state);
}

function normalizeScript(script: unknown) {
  if (!script || typeof script !== "object")
    return { ok: false, errorCode: "error.script", error: "Некорректный сценарий." };
  const value = script as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id)
    return { ok: false, errorCode: "error.script", error: "У сценария нет id." };
  if (typeof value.name !== "string" || !value.name)
    return { ok: false, errorCode: "error.script", error: "У сценария нет названия." };
  if (!Array.isArray(value.roles)) {
    return { ok: false, errorCode: "error.roles", error: "В сценарии нет списка ролей." };
  }
  if (!value.roles.length && value.edition !== "custom") {
    return { ok: false, errorCode: "error.roles", error: "В сценарии нет ролей." };
  }
  const unique: string[] = [];
  for (const id of value.roles) {
    if (
      typeof id !== "string" ||
      !isSupportedRole(id) ||
      (roleTeam(id) as string) === "traveller"
    ) {
      return {
        ok: false,
        errorCode: "error.unknown",
        error: "Неподдерживаемая роль в сценарии: " + id,
      };
    }
    if (!unique.includes(id)) unique.push(id);
  }
  return {
    ok: true,
    script: {
      id: value.id.slice(0, 80),
      name: value.name.slice(0, 80),
      edition: (typeof value.edition === "string" ? value.edition : "custom") as ScriptEdition,
      source: typeof value.source === "string" ? value.source : "manual",
      author: String(value.author || "").slice(0, 80),
      roles: unique,
      manualOnly: typeof value.manualOnly === "boolean" ? value.manualOnly : isMixedEdition(unique),
    },
  };
}

function normalizeBag(state: GameState) {
  const roles = state.setup.roles || [];
  const scriptRoles = (state.script && state.script.roles) || [];

  if (!roles.includes("godfather")) state.setup.godfatherOutsider = 1;
  else if (
    state.setup.godfatherOutsider == null ||
    ![1, -1].includes(state.setup.godfatherOutsider)
  )
    state.setup.godfatherOutsider = 1;

  if (!roles.includes("eviltwin")) {
    state.setup.evilTwinGoodId = null;
  } else {
    const good = roles.filter(
      (id) => id !== "eviltwin" && (roleTeam(id) === "townsfolk" || roleTeam(id) === "outsider"),
    );
    if (!state.setup.evilTwinGoodId || !good.includes(state.setup.evilTwinGoodId))
      state.setup.evilTwinGoodId = good[0] || null;
  }

  if (!roles.includes("lunatic")) {
    state.setup.lunaticShownId = null;
  } else {
    const demons = scriptRoles.filter((id) => roleTeam(id) === "demon");
    const inPlay = roles.find((id) => roleTeam(id) === "demon");
    if (!state.setup.lunaticShownId || !demons.includes(state.setup.lunaticShownId)) {
      state.setup.lunaticShownId = inPlay || demons[0] || null;
    }
  }

  if (!roles.includes("drunk")) {
    state.setup.drunkShownId = null;
  } else {
    const current = state.setup.drunkShownId;
    const valid =
      current &&
      scriptRoles.includes(current) &&
      roleTeam(current) === "townsfolk" &&
      !roles.includes(current);
    if (!valid) {
      const unused = scriptRoles.filter(
        (id) => roleTeam(id) === "townsfolk" && !roles.includes(id),
      );
      state.setup.drunkShownId = unused[0] || null;
    }
  }

  const needed = requiredBluffs(state.setup.count);
  if (!needed) {
    state.setup.bluffs = [];
  } else {
    const seen = new Set();
    state.setup.bluffs = (Array.isArray(state.setup.bluffs) ? state.setup.bluffs : [])
      .filter((id) => {
        if (!id || seen.has(id) || roles.includes(id) || id === state.setup.drunkShownId)
          return false;
        if (!scriptRoles.includes(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, 3);
  }
}

function resetGameForSetup(state: GameState) {
  state.night = { number: 0, queue: [], currentIndex: 0, demonChanged: false };
  state.day = {
    number: 0,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: false,
  };
  state.deaths = [];
  state.executions = [];
  state.effects = [];
  state.corrections = [];
  state.gossip = null;
  state.mastermind = null;
  state.fangguJumped = false;
  state.winner = null;
  state.reviewOpen = false;
  state.publicRevealed = false;
  state.bluffs = [];
  state.herringId = null;
  state.setup.ready = false;
  state.log = [];
}

function bagUpdate(state: GameState, payload: CommandPayloads["bagUpdate"]) {
  const patch = payload.patch || {};
  if (patch.script) {
    const normalized = normalizeScript(patch.script);
    if (!normalized.ok) return normalized;
    if (!normalized.script)
      return { ok: false, errorCode: "error.script", error: "Некорректный сценарий." };
    state.script = normalized.script;
    state.scriptId = normalized.script.id;
  }

  const count = patch.count != null ? Number(patch.count) : state.setup.count;
  if (!Number.isInteger(count) || count < 5 || count > 15) {
    return { ok: false, errorCode: "error.bag-count", error: "Игроков должно быть от 5 до 15." };
  }

  if (patch.resetRoster) {
    setRoster(state, count);
    resetGameForSetup(state);
    state.phase = patch.phase || "setup";
  } else if (patch.count != null) {
    setRoster(state, count);
    resetGameForSetup(state);
  } else if (patch.phase) {
    state.phase = patch.phase;
  }

  const scriptRoles = (state.script && state.script.roles) || [];
  if (patch.roles != null) {
    if (!Array.isArray(patch.roles))
      return { ok: false, errorCode: "error.roles", error: "Некорректный список ролей." };
    for (const id of patch.roles) {
      if (!isSupportedRole(id)) {
        return { ok: false, errorCode: "error.unknown", error: "Неизвестная роль: " + id };
      }
      if (!scriptRoles.includes(id)) {
        return {
          ok: false,
          errorCode: "error.outside-script",
          error: "Роль не входит в сценарий: " + id,
        };
      }
    }
    state.setup.roles = patch.roles.slice();
  }
  if (patch.bluffs != null) {
    if (!Array.isArray(patch.bluffs))
      return { ok: false, errorCode: "error.roles", error: "Некорректный список блефов." };
    for (const id of patch.bluffs) {
      if (!isSupportedRole(id)) {
        return { ok: false, errorCode: "error.unknown", error: "Неизвестная роль: " + id };
      }
      if (!scriptRoles.includes(id)) {
        return {
          ok: false,
          errorCode: "error.bluffs-outside-script",
          error: "Блеф не входит в сценарий: " + id,
        };
      }
    }
    state.setup.bluffs = patch.bluffs.slice();
  }
  if (patch.drunkShownId !== undefined) state.setup.drunkShownId = patch.drunkShownId;
  if (patch.lunaticShownId !== undefined) state.setup.lunaticShownId = patch.lunaticShownId;
  if (patch.godfatherOutsider !== undefined)
    state.setup.godfatherOutsider = patch.godfatherOutsider;
  if (patch.evilTwinGoodId !== undefined) state.setup.evilTwinGoodId = patch.evilTwinGoodId;

  normalizeBag(state);
  return { ok: true };
}

function setOrder(state: GameState, payload: CommandPayloads["setOrder"]) {
  const order = Array.isArray(payload.order) ? payload.order.map(String) : null;
  if (!order) return { ok: false, errorCode: "error.order", error: "Некорректный порядок мест." };
  const ids = Object.keys(state.players);
  if (
    order.length !== ids.length ||
    new Set(order).size !== order.length ||
    order.some((id) => !state.players[id])
  ) {
    return {
      ok: false,
      errorCode: "error.order",
      error: "Порядок мест должен содержать каждого игрока один раз.",
    };
  }
  state.order = order;
  // `seat` mirrors the order: validateState and importGame require it, so an
  // unsynced reorder would save a game that cannot be loaded back.
  order.forEach((id, index) => {
    const player = state.players[id];
    if (player) player.seat = index + 1;
  });
  if (state.phase === "deal") state.phase = "seat";
  return { ok: true };
}

function setHerring(state: GameState, payload: CommandPayloads["setHerring"]) {
  if (payload.playerId == null || payload.playerId === "") {
    state.setup.herringId = null;
    return { ok: true };
  }
  const player = playerById(state, payload.playerId);
  if (!player) return { ok: false, errorCode: "error.1", error: "Игрок не найден." };
  if (realTeamOf(player) !== "good")
    return {
      ok: false,
      errorCode: "error.herring-team",
      error: "Красная селёдка должна быть добрым игроком.",
    };
  state.setup.herringId = player.id;
  return { ok: true };
}

function setupInfo(
  state: GameState,
  payload: {
    roleId: CommandPayloads["setSetupInfo"]["roleId"];
    info?: unknown;
  },
) {
  const roleId = payload.roleId;
  if (!INFO_ROLES.has(roleId)) return { ok: false, error: "Неизвестная информационная роль." };
  const patch = (
    payload.info !== null && typeof payload.info === "object" ? payload.info : null
  ) as Record<string, unknown> | null;
  if (!patch) return { ok: false, error: "Некорректная информация." };
  if (patch.zero === true) {
    state.setup.info[roleId] = { zero: true, pair: [] };
    return { ok: true };
  }
  const current = state.setup.info[roleId];
  const basePair: [string, string] = current && "roleId" in current ? current.pair : ["", ""];
  const pair =
    Array.isArray(patch.pair) &&
    patch.pair.length === 2 &&
    typeof patch.pair[0] === "string" &&
    typeof patch.pair[1] === "string"
      ? ([patch.pair[0], patch.pair[1]] as [string, string])
      : basePair;
  // An explicit string is the host's choice: a supported role, or "" to clear
  // it. Anything else keeps the stored role, so a pair edit cannot drop it.
  const chosenRole =
    typeof patch.roleId === "string" && (patch.roleId === "" || isSupportedRole(patch.roleId))
      ? (patch.roleId as InfoPair["roleId"])
      : current && "roleId" in current
        ? current.roleId
        : ("" as InfoPair["roleId"]);
  const next: InfoPair = {
    roleId: chosenRole,
    pair,
    ...(typeof patch.matchIndex === "number" ? { matchIndex: patch.matchIndex } : {}),
    ...(typeof patch.forDrunk === "boolean" ? { forDrunk: patch.forDrunk } : {}),
  };
  state.setup.info[roleId] = next;
  return { ok: true };
}

function normalizeSecrets(state: GameState) {
  const players = Object.values(state.players || {});
  const has = (roleId: string) => players.some((player): boolean => player.roleId === roleId);
  if (has("librarian") && !players.some((player) => roleTeam(player.roleId || "") === "outsider")) {
    state.setup.info.librarian = { zero: true, pair: [] };
  }
  return { ok: true };
}

function setNotes(state: GameState, payload: CommandPayloads["setNotes"]) {
  state.notes = String(payload.notes || "");
  return { ok: true };
}

function setReviewOpen(state: GameState, payload: CommandPayloads["setReviewOpen"]) {
  state.reviewOpen = Boolean(payload.open);
  return { ok: true };
}

function newGame(state: GameState, payload: CommandPayloads["newGame"]) {
  const count = payload.count == null ? 8 : Number(payload.count);
  if (!Number.isInteger(count) || count < 5 || count > 15) {
    return { ok: false, error: "Игроков должно быть от 5 до 15." };
  }
  replaceContents(state, createGame(count));
  return { ok: true };
}

function importGame(state: GameState, payload: CommandPayloads["importGame"]) {
  const imported = importState(String(payload.text == null ? "" : payload.text));
  if (!imported.ok) return { ok: false, error: imported.error };
  replaceContents(state, imported.state);
  return { ok: true };
}

interface CommandSpec<K extends keyof CommandPayloads> {
  apply: (state: GameState, payload: CommandPayloads[K]) => unknown;
  undoable?: boolean;
  record?: boolean;
  resetHistory?: boolean;
}

const COMMANDS = {
  startNight: { apply: (state) => startNight(state) },
  completeStep: {
    apply: (state, payload) =>
      completeStep(state, payload.key, payload.options as Parameters<typeof completeStep>[2]),
  },
  completeNightStep: { apply: (state, payload) => completeNightStep(state, payload) },
  endNight: { apply: (state) => endNight(state) },
  skipStep: { apply: (state, payload) => skipStep(state, payload.key, payload.reason) },
  chooseDemonHeir: {
    apply: (state, payload) => chooseDemonHeir(state, payload.stepKey, payload.heirId),
  },
  openNominations: { apply: (state) => openNominations(state) },
  nominate: {
    apply: (state, payload) =>
      nominate(
        state,
        payload.nominatorId,
        payload.nomineeId,
        payload.options as Parameters<typeof nominate>[3],
      ),
  },
  recordVirginNomination: {
    apply: (state, payload) =>
      recordVirginNomination(
        state,
        payload.nominatorId,
        payload.virginId,
        payload.options as Parameters<typeof recordVirginNomination>[3],
      ),
  },
  recordVotes: {
    apply: (state, payload) => recordVotes(state, payload.nominationId, payload.voterIds),
  },
  cancelNomination: { apply: (state, payload) => cancelNomination(state, payload.nominationId) },
  resetVotes: {
    apply: (state, payload) => resetVotes(state, payload.nominationId, payload.reason),
  },
  execute: {
    apply: (state, payload) =>
      execute(state, payload.nominationId, payload.options as Parameters<typeof execute>[2]),
  },
  executeByDecision: {
    apply: (state, payload) =>
      executeByDecision(
        state,
        payload.playerId,
        payload.options as Parameters<typeof executeByDecision>[2],
      ),
  },
  madnessPenalty: {
    apply: (state, payload) =>
      applyMadnessPenalty(
        state,
        payload.playerId,
        payload.penalty,
        payload.reason,
        payload.effectId,
      ),
  },
  endDay: { apply: (state) => endDay(state) },
  useSlayer: {
    apply: (state, payload) =>
      useSlayer(
        state,
        payload.slayerId,
        payload.targetId,
        payload.options as Parameters<typeof useSlayer>[3],
      ),
  },
  gossipStatement: { apply: (state, payload) => gossipStatement(state, Boolean(payload.truth)) },
  jugglerGuess: { apply: (state, payload) => applyJugglerGuess(state, payload) },
  moonchildChoice: { apply: (state, payload) => moonchildChoice(state, payload.targetId) },
  recordKlutzChoice: {
    apply: (state, payload) => recordKlutzChoice(state, payload.targetId),
  },
  tinkerDeath: { apply: (state, payload) => tinkerDeath(state, payload.playerId) },
  recoverClaim: {
    apply: (state, payload) => recoverClaim(state, payload.playerId, payload.reason),
  },
  dealGame: {
    apply: (state, payload) => dealGame(state, payload.options as Parameters<typeof dealGame>[1]),
  },
  startGame: {
    apply: (state, payload) => {
      const options = asRecordOrNull(payload.options) || {};
      const assignment = asRecordOrNull(options.assignment);
      return startGame(state, {
        ...(assignment ? { assignment: assignment as Record<string, string> } : {}),
        secrets: options.secrets !== false,
      });
    },
  },
  claimSeat: { apply: (state, payload) => claimSeat(state, payload.playerId, payload.name) },
  autoSecrets: {
    apply: (state, payload) =>
      autoSecrets(state, payload.options as Parameters<typeof autoSecrets>[1]),
  },
  manualCorrection: { apply: (state, payload) => manualCorrection(state, payload.change) },
  recordBmrOutcome: {
    apply: (state, payload) =>
      recordBmrOutcome(
        state,
        payload.stepKey,
        payload.options as Parameters<typeof recordBmrOutcome>[2],
      ),
  },
  recordSvOutcome: {
    apply: (state, payload) => recordSvOutcome(state, payload.stepKey, payload.options || {}),
  },
  resurrectPlayer: {
    apply: (state, payload) => {
      const player = resurrectPlayer(state, payload.playerId);
      return player
        ? { ok: true, playerId: player.id }
        : { ok: false, error: "Игрок не может вернуться." };
    },
  },
  setWinner: { apply: (state, payload) => setWinner(state, payload.team, payload.reason) },
  bagUpdate: { apply: (state, payload) => bagUpdate(state, payload) },
  setOrder: { apply: (state, payload) => setOrder(state, payload) },
  setHerring: { apply: (state, payload) => setHerring(state, payload) },
  setSetupInfo: { apply: (state, payload) => setupInfo(state, payload) },
  setSetupInfoZero: {
    apply: (state, payload) =>
      setupInfo(state, { roleId: payload.roleId, info: { zero: true as const, pair: [] as [] } }),
  },
  normalizeSecrets: { apply: (state) => normalizeSecrets(state), undoable: false, record: false },
  setNotes: { apply: (state, payload) => setNotes(state, payload), undoable: false, record: false },
  setReviewOpen: {
    apply: (state, payload) => setReviewOpen(state, payload),
    undoable: false,
    record: false,
  },
  newGame: { apply: (state, payload) => newGame(state, payload), resetHistory: true },
  importGame: { apply: (state, payload) => importGame(state, payload), resetHistory: true },
} satisfies { [K in keyof CommandPayloads]: CommandSpec<K> };

type CommandName = keyof typeof COMMANDS;

interface CommandMeta {
  undoable?: boolean;
  record?: boolean;
  resetHistory?: boolean;
}

function commandMeta(type: string): CommandMeta {
  return COMMANDS[type as CommandName] as CommandMeta;
}

// The payload union is narrowed by the caller's `type` at compile time; the
// runtime gate is validatePayload (contracts), which prepareCommand runs.
function runCommand(type: string, state: GameState, payload: Record<string, unknown>): unknown {
  const spec = COMMANDS[type as CommandName] as {
    apply: (s: GameState, p: Record<string, unknown>) => unknown;
  };
  return spec.apply(state, payload);
}

// ---------------------------------------------------------------------------
// Invariants and canonical comparison

export function checkInvariants(state: GameState): string[] {
  const errors = [];
  if (!state || typeof state !== "object") return ["Состояние отсутствует."];
  const players = state.players || {};
  const order = state.order || [];
  const scriptRoles = (state.script && state.script.roles) || [];

  if (!["setup", "deal", "seat", "night", "day", "over"].includes(state.phase)) {
    errors.push("Неизвестная фаза: " + state.phase);
  }
  if (new Set(order).size !== order.length) errors.push("Порядок мест содержит повторы.");
  for (const id of order) if (!players[id]) errors.push("Место без игрока: " + id);
  if (Object.keys(players).length !== order.length)
    errors.push("Игроки не совпадают с порядком мест.");
  for (const [id, player] of Object.entries(players)) {
    if (!player || player.id !== id) errors.push("Некорректный игрок: " + id);
    if (player && player.roleId != null && !scriptRoles.includes(player.roleId)) {
      errors.push("Роль вне сценария: " + id);
    }
    if (player && player.shownRoleId != null && !isSupportedRole(player.shownRoleId)) {
      errors.push("Показанная роль неизвестна: " + id);
    }
    if (player && player.butlerMasterId != null && !players[player.butlerMasterId]) {
      errors.push("Мастер Дворецкого не найден: " + id);
    }
  }

  const seenEffects = new Set();
  for (const effect of state.effects || []) {
    if (!effect || typeof effect.id !== "string") {
      errors.push("Эффект без id.");
      continue;
    }
    if (seenEffects.has(effect.id)) errors.push("Повтор эффекта: " + effect.id);
    seenEffects.add(effect.id);
    if (effect.sourceId != null && !players[effect.sourceId])
      errors.push("Источник эффекта не найден: " + effect.id);
    if (effect.targetId != null && !players[effect.targetId])
      errors.push("Цель эффекта не найдена: " + effect.id);
  }
  for (const death of state.deaths || []) {
    if (!death || !players[death.playerId]) errors.push("Смерть без игрока.");
  }
  for (const execution of state.executions || []) {
    if (!execution || !players[execution.playerId]) errors.push("Казнь без игрока.");
  }
  if (state.day) {
    for (const nomination of state.day.nominations || []) {
      if (!nomination || !players[nomination.nominatorId] || !players[nomination.nomineeId]) {
        errors.push("Номинация ссылается на отсутствующего игрока.");
      }
    }
    for (const death of state.day.morning || []) {
      if (!death || !players[death.playerId]) errors.push("Утренняя смерть без игрока.");
    }
    if (state.day.execution && !players[state.day.execution.playerId])
      errors.push("Казнь без игрока.");
  }
  if (state.setup) {
    const setupRefs = [
      state.setup.grandmotherId,
      state.setup.evilTwinGoodPlayerId,
      state.setup.evilTwinPlayerId,
      state.setup.herringId,
    ];
    if (setupRefs.some((id) => id != null && !players[id]))
      errors.push("Ссылка настройки не найдена.");
  }
  if (
    state.mastermind &&
    typeof state.mastermind.playerId === "string" &&
    !players[state.mastermind.playerId]
  ) {
    errors.push("Кукловод не найден.");
  }

  const keys = new Set();
  for (const step of (state.night && state.night.queue) || []) {
    if (!step || typeof step.key !== "string") {
      errors.push("Ночной шаг без ключа.");
      continue;
    }
    if (keys.has(step.key)) errors.push("Повтор ночного шага: " + step.key);
    keys.add(step.key);
    if (step.actorId != null && !players[step.actorId])
      errors.push("Ночной актёр не найден: " + step.actorId);
  }

  if (state.winner && state.phase !== "over")
    errors.push("Победитель объявлен вне фазы завершения.");
  if (
    state.winner &&
    ((state.night && state.night.queue) || []).some(
      (step) => step.pending && step.pending.kind === "demon-inheritance",
    )
  ) {
    errors.push("Победитель объявлен до выбора наследника Демона.");
  }
  if (state.day && state.day.activeNominationId) {
    const found = (state.day.nominations || []).some(
      (nomination) => nomination.id === state.day.activeNominationId,
    );
    if (!found) errors.push("Активная номинация не найдена.");
  }
  return errors;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort())
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

// Domain equality ignores volatile persistence and audit fields. It keeps the
// rule state: phase, players, effects, queue, day, deaths, winner and setup.
export function canonicalState(state: GameState): Record<string, unknown> {
  const copy = { ...state } as Record<string, unknown>;
  delete copy.storageError;
  delete copy.revision;
  delete copy.updatedAt;
  delete copy.createdAt;
  delete copy.applied;
  delete copy.journal;
  delete copy.migratedFrom;
  delete copy.log;
  delete copy.corrections;
  return canonicalize(copy) as Record<string, unknown>;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

function fingerprintOf(command: Command, version: string): string {
  return JSON.stringify(
    canonicalize({
      type: command.type,
      payload: command.payload == null ? {} : command.payload,
      rulesetVersion: version,
    }),
  );
}

// `state.applied` is the idempotency ledger: one id bound to the canonical
// fingerprint of its input. The journal contains the same accepted commands
// (before the current call), so a repeated id is found here.
interface StoredCommand {
  type: string;
  fingerprint: string | null;
  at: string | null;
  result: Record<string, unknown> | null;
  followUp: Record<string, unknown> | null;
  undoable: boolean;
}

function storedCommand(state: GameState, id: string): StoredCommand | null {
  const applied = state.applied && state.applied[id];
  if (applied) {
    return {
      type: applied.type,
      fingerprint: applied.fingerprint || null,
      at: applied.at || null,
      result: applied.result || null,
      followUp: applied.followUp || null,
      undoable: applied.undoable !== false,
    };
  }
  // Record-only commands skip `state.applied`; the journal is their ledger.
  const entries =
    state.journal && Array.isArray(state.journal.entries) ? state.journal.entries : [];
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) return null;
  return {
    type: entry.type,
    fingerprint: entry.fingerprint || null,
    at: entry.at || null,
    result: null,
    followUp: null,
    undoable: entry.undoable !== false,
  };
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return function random() {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withDeterminism<T>(seedText: string, at: Date, fn: () => T, runtime: Runtime): T {
  const original = Math.random;
  Math.random = seededRandom(runtime.random.seed(seedText));
  try {
    return withClock(at, fn);
  } finally {
    Math.random = original;
  }
}

// Capture the command timestamp once per (id, fingerprint, initial state).
// The capture lives in the runtime: a store owns one, and direct engine callers
// share the default runtime until the store is the only caller.
const PREVIEW_TIMESTAMP_LIMIT = 100;

function timestampKey(command: Command, fingerprint: string, state: GameState): string {
  return command.id + "|" + fingerprint + "|" + hashString(JSON.stringify(canonicalState(state)));
}

function resolveTimestamp(
  command: Command,
  fingerprint: string,
  state: GameState,
  capture: boolean,
  runtime: Runtime,
): Date {
  if (command.at != null) return new Date(command.at);
  const key = timestampKey(command, fingerprint, state);
  const saved = runtime.timestamps.get(key);
  if (saved) return new Date(saved);
  const now = runtime.now();
  if (capture) {
    runtime.timestamps.set(key, now.toISOString());
    if (runtime.timestamps.size > PREVIEW_TIMESTAMP_LIMIT) {
      const oldest = runtime.timestamps.keys().next().value;
      if (oldest !== undefined) runtime.timestamps.delete(oldest);
    }
  }
  return now;
}

// ---------------------------------------------------------------------------
// Domain events

function eventSink(
  command: Command,
  at: string,
): { events: DomainEvent[]; push: (type: string, payload?: Record<string, unknown>) => void } {
  const events: DomainEvent[] = [];
  const push = (type: string, payload?: Record<string, unknown>) => {
    events.push({
      id: command.id + ":" + (events.length + 1),
      type,
      commandId: command.id,
      commandType: command.type,
      at,
      phase: null,
      payload: payload || {},
    });
  };
  return { events, push };
}

function deriveEvents(
  before: GameState,
  after: GameState,
  command: Command,
  at: string,
): DomainEvent[] {
  const sink = eventSink(command, at);
  const push = sink.push;
  const inPhase = (event: DomainEvent): DomainEvent => {
    event.phase = before.phase;
    return event;
  };

  const beforePlayers = before.players || {};
  const afterPlayers = after.players || {};
  for (const id of new Set([...Object.keys(beforePlayers), ...Object.keys(afterPlayers)])) {
    const a = beforePlayers[id];
    const b = afterPlayers[id];
    if (!a || !b) {
      push(a ? "player.removed" : "player.added", { playerId: id });
      continue;
    }
    if (a.alive !== b.alive)
      push("player.alive_changed", {
        playerId: id,
        alive: b.alive,
        cause: b.deadAt && b.deadAt.cause,
      });
    if (a.roleId !== b.roleId)
      push("player.role_changed", { playerId: id, from: a.roleId, to: b.roleId });
    if (a.shownRoleId !== b.shownRoleId)
      push("player.shown_role_changed", { playerId: id, from: a.shownRoleId, to: b.shownRoleId });
    if (a.team !== b.team) push("player.team_changed", { playerId: id, from: a.team, to: b.team });
    if (a.registeredDead !== b.registeredDead)
      push("player.registered_dead_changed", {
        playerId: id,
        registeredDead: Boolean(b.registeredDead),
      });
    if (a.voteToken !== b.voteToken)
      push("player.vote_token_changed", { playerId: id, voteToken: b.voteToken });
    if (a.butlerMasterId !== b.butlerMasterId)
      push("player.butler_master_changed", { playerId: id, masterId: b.butlerMasterId || null });
    if (!sameValue(a.used || {}, b.used || {}))
      push("player.used_changed", { playerId: id, used: b.used || {} });
    if (!sameValue(a.reminders || [], b.reminders || []))
      push("player.reminders_changed", { playerId: id, reminders: b.reminders || [] });
    if (!sameValue(a.deadAt || null, b.deadAt || null))
      push("player.dead_at_changed", { playerId: id, deadAt: b.deadAt || null });
  }

  const beforeEffects = new Map((before.effects || []).map((effect) => [effect.id, effect]));
  const afterEffects = new Map((after.effects || []).map((effect) => [effect.id, effect]));
  for (const id of new Set([...beforeEffects.keys(), ...afterEffects.keys()])) {
    const a = beforeEffects.get(id);
    const b = afterEffects.get(id);
    if (!a) push("effect.added", { effect: b });
    else if (!b) push("effect.removed", { effect: a });
    else {
      if (a.active !== b.active) push("effect.active_changed", { effectId: id, active: b.active });
      if (!sameValue(a.expires || null, b.expires || null) || a.kind !== b.kind) {
        push("effect.updated", { effectId: id, effect: b });
      }
    }
  }

  const beforeDeaths = new Set((before.deaths || []).map((death) => death.id));
  for (const death of after.deaths || []) {
    if (!beforeDeaths.has(death.id)) push("death.recorded", { death });
  }
  const beforeExecutions = new Set(
    (before.executions || []).map((execution) => execution.at + ":" + execution.playerId),
  );
  for (const execution of after.executions || []) {
    if (!beforeExecutions.has(execution.at + ":" + execution.playerId))
      push("execution.recorded", { execution });
  }

  const beforeNominations = new Map(
    ((before.day && before.day.nominations) || []).map((nomination) => [nomination.id, nomination]),
  );
  const afterNominations = new Map(
    ((after.day && after.day.nominations) || []).map((nomination) => [nomination.id, nomination]),
  );
  for (const id of new Set([...beforeNominations.keys(), ...afterNominations.keys()])) {
    const a = beforeNominations.get(id);
    const b = afterNominations.get(id);
    if (!a) push("nomination.added", { nomination: b });
    else if (!b) push("nomination.cancelled", { nominationId: id });
    else if (!sameValue(a.votes || [], b.votes || []) || a.count !== b.count) {
      push("votes.recorded", {
        nominationId: id,
        count: b.count,
        threshold: b.threshold,
        votes: b.votes,
      });
    }
  }

  const beforeSteps = new Map(
    ((before.night && before.night.queue) || []).map((step) => [step.key, step]),
  );
  const afterSteps = new Map(
    ((after.night && after.night.queue) || []).map((step) => [step.key, step]),
  );
  for (const key of new Set([...beforeSteps.keys(), ...afterSteps.keys()])) {
    const a = beforeSteps.get(key);
    const b = afterSteps.get(key);
    if (!a) push("step.added", { step: b });
    else if (!b) push("step.removed", { stepKey: key });
    else {
      if (!a.done && b.done && !a.skipped && b.skipped)
        push("step.skipped", { stepKey: key, roleId: b.roleId || null });
      if (!a.done && b.done && !b.skipped)
        push("step.completed", { stepKey: key, roleId: b.roleId || null });
      if (
        !sameValue(a.targetIds || [], b.targetIds || []) ||
        !sameValue(a.given || null, b.given || null) ||
        !sameValue(a.pending || null, b.pending || null) ||
        a.note !== b.note
      ) {
        push("step.updated", { stepKey: key, roleId: b.roleId || null });
      }
    }
  }

  if (before.phase !== after.phase) push("phase.changed", { from: before.phase, to: after.phase });
  if (!before.winner && after.winner) push("winner.declared", { winner: after.winner });
  if (before.winner && !after.winner) push("winner.cleared", {});
  if (
    !sameValue(before.script || null, after.script || null) ||
    before.scriptId !== after.scriptId
  ) {
    push("script.changed", { scriptId: after.scriptId });
  }
  if (!sameValue(before.order || [], after.order || []))
    push("order.changed", { order: after.order || [] });
  if (!sameValue(before.setup || null, after.setup || null))
    push("setup.changed", { setup: after.setup });
  if (before.notes !== after.notes) push("notes.changed", { notes: after.notes });
  if (before.reviewOpen !== after.reviewOpen) push("review.changed", { open: after.reviewOpen });

  for (const event of sink.events) {
    if (event.phase === null) inPhase(event);
  }
  return sink.events;
}

function summarize(before: GameState, after: GameState, events: DomainEvent[]) {
  const deaths = (after.deaths || []).filter(
    (death) => !(before.deaths || []).some((old) => old.id === death.id),
  );
  const phase = before.phase !== after.phase ? { from: before.phase, to: after.phase } : null;
  return {
    events: events.length,
    deaths: deaths.map((death) => death.playerId),
    phase,
    winner: after.winner ? { team: after.winner.team, reason: after.winner.reason } : null,
    effects: {
      added: (after.effects || [])
        .filter((effect) => !(before.effects || []).some((old) => old.id === effect.id))
        .map((effect) => effect.id),
      deactivated: (after.effects || [])
        .filter(
          (effect) =>
            effect.active === false &&
            (before.effects || []).some((old) => old.id === effect.id && old.active !== false),
        )
        .map((effect) => effect.id),
    },
    queue: {
      added: ((after.night && after.night.queue) || [])
        .filter(
          (step) =>
            !((before.night && before.night.queue) || []).some((old) => old.key === step.key),
        )
        .map((step) => step.key),
      completed: ((after.night && after.night.queue) || [])
        .filter(
          (step) =>
            step.done &&
            !step.skipped &&
            !((before.night && before.night.queue) || []).some(
              (old) => old.key === step.key && old.done,
            ),
        )
        .map((step) => step.key),
      skipped: ((after.night && after.night.queue) || [])
        .filter(
          (step) =>
            step.skipped &&
            !((before.night && before.night.queue) || []).some(
              (old) => old.key === step.key && old.skipped,
            ),
        )
        .map((step) => step.key),
    },
  };
}

function futureOf(after: GameState, followUp: Record<string, unknown> | null) {
  const effects = (after.effects || []).filter((effect) => effect.active !== false);
  const queue = (after.night && after.night.queue) || [];
  return {
    phase: after.phase,
    winner: after.winner ? { team: after.winner.team, reason: after.winner.reason } : null,
    followUp: followUp || null,
    pendingSteps: queue
      .filter((step) => !step.done && !step.skipped)
      .map((step) => ({
        key: step.key,
        roleId: step.roleId || null,
        system: step.system || null,
        actorId: step.actorId || null,
      })),
    activeEffects: effects.map((effect) => ({
      id: effect.id,
      kind: effect.kind,
      sourceId: effect.sourceId,
      targetId: effect.targetId,
      expires: effect.expires || null,
      resolve: effect.resolve || null,
      suspended: effect.suspended || null,
      resumeOnHealthy: effect.resumeOnHealthy === true,
    })),
    delayedEffects: effects
      .filter((effect) => effect.expires || effect.resolve)
      .map((effect) => ({
        id: effect.id,
        kind: effect.kind,
        targetId: effect.targetId,
        expires: effect.expires || null,
        resolve: effect.resolve || null,
        suspended: effect.suspended || null,
        resumeOnHealthy: effect.resumeOnHealthy === true,
      })),
    pendingInheritance:
      queue.find((step) => step.pending && step.pending.kind === "demon-inheritance") || null,
  };
}

// ---------------------------------------------------------------------------
// Public API

function commandVersion(command: Command): string {
  return command.rulesetVersion == null ? RULESET_VERSION : String(command.rulesetVersion);
}

function recordJournalEntry(
  state: GameState,
  command: Command,
  meta: CommandMeta,
  version: string,
  fingerprint: string,
  at: string,
  undoable: boolean,
  base: GameState | null,
): void {
  if (meta.resetHistory) {
    // A reset command (new game, import) starts a new history: the state it
    // produced is the base and nothing before it can be undone or replayed.
    const resetBase = clone(state);
    delete (resetBase as Partial<GameState>).journal;
    state.journal = { base: resetBase, entries: [] };
    return;
  }
  const journal =
    state.journal && Array.isArray(state.journal.entries)
      ? state.journal
      : { base: null, entries: [] };
  if (!journal.base) journal.base = base;
  const entry: JournalEntry = {
    id: command.id,
    type: command.type,
    payload: clone(command.payload || {}),
    at,
    rulesetVersion: version,
    fingerprint,
    undoable,
  };
  // A record-only command (notes, review, secret normalization) changes the
  // state but does not need its own history step. Coalesce a trailing entry of
  // the same type so 300 keystrokes stay one replayable command.
  const last = journal.entries[journal.entries.length - 1];
  if (!undoable && last && last.undoable === false && last.type === command.type) {
    journal.entries[journal.entries.length - 1] = entry;
  } else {
    journal.entries.push(entry);
  }
  state.journal = journal;
}

function normalizeCommand(
  command: Command,
): { ok: true; version: string } | { ok: false; error: string; errorCode?: string } {
  if (!command || typeof command !== "object") return { ok: false, error: "Команда отсутствует." };
  if (typeof command.id !== "string" || !command.id.trim()) {
    return { ok: false, errorCode: "command-missing-id", error: "У команды нет id." };
  }
  if (typeof command.type !== "string" || !COMMANDS[command.type as CommandName]) {
    return {
      ok: false,
      errorCode: "command-unknown",
      error: "Неизвестная команда: " + command.type,
    };
  }
  if (command.payload != null && typeof command.payload !== "object") {
    return { ok: false, errorCode: "command-payload", error: "Некорректные данные команды." };
  }
  const version = commandVersion(command);
  if (!SUPPORTED_RULESET_VERSIONS.has(version)) {
    return {
      ok: false,
      errorCode: "ruleset-version-unsupported",
      error: "Версия правил не поддерживается: " + version,
    };
  }
  if (command.at != null) {
    const at = new Date(command.at);
    if (Number.isNaN(at.getTime())) {
      return { ok: false, errorCode: "command-at", error: "Некорректная отметка времени команды." };
    }
  }
  return { ok: true, version };
}

function rejected(
  command: Command,
  reason: string,
  extra: Record<string, unknown> = {},
): RejectedResult {
  return {
    status: COMMAND_STATUS.REJECTED,
    id: (command && command.id) || null,
    type: (command && command.type) || null,
    reason,
    ...extra,
  };
}

function runDraft(
  state: GameState,
  command: Command,
  fingerprint: string,
  at: Date,
  runtime: Runtime,
) {
  const draft = clone(state);
  const atIso = at.toISOString();
  const seedText =
    command.id + "|" + fingerprint + "|" + hashString(JSON.stringify(canonicalState(state)));
  let outcome: DomainOutcome;
  try {
    outcome = withDeterminism(
      seedText,
      at,
      () => finish(runCommand(command.type, draft, command.payload || {})),
      runtime,
    );
  } catch (error) {
    return {
      outcome: {
        ok: false,
        error:
          "Команда завершилась ошибкой: " +
          (error instanceof Error ? error.message : String(error)),
      },
      draft,
      at: atIso,
    };
  }
  if (!outcome.ok) {
    if (outcome.status === COMMAND_STATUS.CHOICE) {
      return {
        outcome: {
          status: COMMAND_STATUS.CHOICE,
          id: command.id,
          type: command.type,
          choice: outcome.choice,
          errorCode: outcome.errorCode || null,
          reason: outcome.reason,
        },
        draft,
        at: atIso,
      };
    }
    return {
      outcome: rejected(command, outcome.error || "Команда отклонена.", {
        errorCode: outcome.errorCode || null,
        errors: outcome.errors || null,
      }),
      draft,
      at: atIso,
    };
  }
  const gameAt = currentAt(draft);
  const graph = effectGraph(draft, gameAt);
  if (!graph.ok) {
    return {
      outcome: rejected(command, "Циклическая зависимость эффектов.", {
        errorCode: graph.errorCode,
        errors: graph.effectIds,
      }),
      draft: state,
      at: atIso,
    };
  }
  resolveSuspendedPukkaDeaths(draft, gameAt);
  const violations = checkInvariants(draft);
  if (violations.length) {
    return {
      outcome: rejected(command, "Нарушены инварианты состояния.", {
        errorCode: "invariant-violation",
        errors: violations,
      }),
      draft: state,
      at: atIso,
    };
  }
  return {
    outcome: { ok: true, result: outcome.result, followUp: asRecordOrNull(outcome.followUp) },
    draft,
    at: atIso,
  };
}

export function validateCommand(
  state: GameState,
  command: Command,
  runtime = defaultRuntime,
): CommandResult {
  const normalized = normalizeCommand(command);
  if (!normalized.ok)
    return rejected(command, normalized.error, { errorCode: normalized.errorCode });
  const fingerprint = fingerprintOf(command, normalized.version);
  const stored = storedCommand(state, command.id);
  if (stored) {
    const same = stored.fingerprint
      ? stored.fingerprint === fingerprint
      : stored.type === command.type;
    if (!same) {
      return rejected(command, "Id команды уже использован для другого действия.", {
        errorCode: "command-id-conflict",
      });
    }
    return { status: COMMAND_STATUS.ALLOWED, id: command.id, type: command.type, idempotent: true };
  }
  const at = resolveTimestamp(command, fingerprint, state, false, runtime);
  const { outcome } = runDraft(state, command, fingerprint, at, runtime);
  if (outcome.ok) {
    return {
      status: COMMAND_STATUS.ALLOWED,
      id: command.id,
      type: command.type,
      result: asRecordOrNull(outcome.result),
      followUp: asRecordOrNull(outcome.followUp),
    };
  }
  if (outcome.status === COMMAND_STATUS.CHOICE) return outcome as CommandResult;
  return outcome as CommandResult;
}

export function previewCommand(
  state: GameState,
  command: Command,
  runtime = defaultRuntime,
): CommandResult {
  const normalized = normalizeCommand(command);
  if (!normalized.ok)
    return rejected(command, normalized.error, { errorCode: normalized.errorCode });
  const fingerprint = fingerprintOf(command, normalized.version);
  const stored = storedCommand(state, command.id);
  if (stored) {
    const same = stored.fingerprint
      ? stored.fingerprint === fingerprint
      : stored.type === command.type;
    if (!same) {
      return rejected(command, "Id команды уже использован для другого действия.", {
        errorCode: "command-id-conflict",
      });
    }
    return {
      status: COMMAND_STATUS.ALLOWED,
      id: command.id,
      type: command.type,
      idempotent: true,
      at: stored.at || null,
      events: [],
      changes: null,
      future: futureOf(state, asRecordOrNull(stored.followUp)),
    };
  }
  const at = resolveTimestamp(command, fingerprint, state, true, runtime);
  const { outcome, draft } = runDraft(state, command, fingerprint, at, runtime);
  if (!outcome.ok) {
    if (outcome.status === COMMAND_STATUS.CHOICE) return outcome as CommandResult;
    return outcome as CommandResult;
  }
  const events = deriveEvents(state, draft, command, at.toISOString());
  return {
    status: COMMAND_STATUS.ALLOWED,
    id: command.id,
    type: command.type,
    at: at.toISOString(),
    result: asRecordOrNull(outcome.result),
    followUp: asRecordOrNull(outcome.followUp),
    events,
    changes: summarize(state, draft, events),
    future: futureOf(draft, asRecordOrNull(outcome.followUp)),
  };
}

export function applyCommand(
  state: GameState,
  command: Command,
  runtime = defaultRuntime,
): CommandResult {
  const normalized = normalizeCommand(command);
  if (!normalized.ok)
    return rejected(command, normalized.error, { errorCode: normalized.errorCode });
  const fingerprint = fingerprintOf(command, normalized.version);
  const stored = storedCommand(state, command.id);
  if (stored) {
    const same = stored.fingerprint
      ? stored.fingerprint === fingerprint
      : stored.type === command.type;
    if (!same) {
      return rejected(command, "Id команды уже использован для другого действия.", {
        errorCode: "command-id-conflict",
      });
    }
    return {
      status: COMMAND_STATUS.ALLOWED,
      id: command.id,
      type: command.type,
      idempotent: true,
      at: stored.at || null,
      events: [],
      result: stored.result || null,
      followUp: stored.followUp || null,
      undoable: stored.undoable !== false,
    };
  }

  const at = resolveTimestamp(command, fingerprint, state, false, runtime);
  const { outcome, draft } = runDraft(state, command, fingerprint, at, runtime);
  if (!outcome.ok) {
    if (outcome.status === COMMAND_STATUS.CHOICE) return outcome as CommandResult;
    return outcome as CommandResult;
  }

  const events = deriveEvents(state, draft, command, at.toISOString());
  const changes = summarize(state, draft, events);
  const entry = commandMeta(command.type);
  const undoable = entry.undoable !== false;
  // The base is the state before the first recorded command of this history.
  let base: GameState | null = null;
  if (!state.journal || !state.journal.base) {
    base = clone(state);
    delete (base as Partial<GameState>).journal;
  }
  replaceContents(state, draft);
  state.applied = state.applied || {};
  if (entry.record !== false) {
    state.applied[command.id] = {
      type: command.type,
      at: at.toISOString(),
      rulesetVersion: normalized.version,
      fingerprint,
      followUp: asRecordOrNull(outcome.followUp),
      result: null,
      undoable,
    };
  }
  recordJournalEntry(
    state,
    command,
    entry,
    normalized.version,
    fingerprint,
    at.toISOString(),
    undoable,
    base,
  );
  return {
    status: COMMAND_STATUS.ALLOWED,
    id: command.id,
    type: command.type,
    at: at.toISOString(),
    result: asRecordOrNull(outcome.result),
    followUp: asRecordOrNull(outcome.followUp),
    events,
    changes,
    undoable,
    resetHistory: Boolean(entry.resetHistory),
  };
}

function replaceContents(target: object, source: object) {
  for (const key of Object.keys(target)) delete (target as Record<string, unknown>)[key];
  Object.assign(target, clone(legacyRecord(source)));
}
