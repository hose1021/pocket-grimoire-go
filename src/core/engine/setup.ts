import type { GameState, InfoPair, Player, RoleId } from "../model/types.ts";

// Trouble Brewing domain: setup. No DOM or persistence.
import {
  bagErrors,
  isBmrScript,
  isManualScript,
  isMixedEdition,
  isSnvScript,
  isSupportedRole,
  roleTeam,
} from "../model/rules.ts";
import type { SetupProblem } from "../model/rules.ts";
import { orderedPlayers, playerById, realTeamOf } from "../model/state.ts";

import { addLog } from "./context.ts";

export function setupErrors(state: GameState): SetupProblem[] {
  const errors = bagErrors({
    count: state.setup.count,
    roles: state.setup.roles,
    bluffs: state.setup.bluffs,
    drunkShownId: state.setup.drunkShownId,
    lunaticShownId: state.setup.lunaticShownId,
    pool: state.script.roles,
    godfatherOutsider: state.setup.godfatherOutsider || 1,
  });
  if (isMixedEdition(state.script.roles) && !isManualScript(state.script)) {
    errors.push({
      code: "mixed-edition",
      message: "Смешанные редакции требуют ручного режима ведущего.",
    });
  }
  if (state.setup.roles.includes("eviltwin")) {
    const twin = state.setup.evilTwinGoodId;
    const twinTeam = twin ? roleTeam(twin) : null;
    if (
      !twin ||
      !state.setup.roles.includes(twin) ||
      twin === "eviltwin" ||
      (twinTeam !== "townsfolk" && twinTeam !== "outsider")
    ) {
      errors.push({
        code: "evil-twin-good",
        message: "Выберите доброго игрока — второго Близнеца.",
      });
    }
  }
  return errors;
}

export function secretsErrors(state: GameState): SetupProblem[] {
  const errors = setupErrors(state);
  if (errors.length) return errors;
  if (state.phase === "setup") {
    errors.push({ code: "not-dealt", message: "Сначала раздайте роли." });
    return errors;
  }
  // Bad Moon Rising has no setup secrets like the Fortune Teller herring or
  // the one-of-two pairs; its setup choice is the Godfather composition.
  // Manual-only games also need no automatic setup secrets: the host resolves
  // every ability at the table.
  if (isManualScript(state.script) || isBmrScript(state.script) || isSnvScript(state.script))
    return errors;

  const players = orderedPlayers(state);
  // Setup secrets are needed only for the real role. A Drunk who was shown
  // this role wakes and receives false information; no real red herring is due.
  const has = (roleId: string) => players.some((player): boolean => player.roleId === roleId);

  if (has("fortuneteller")) {
    const herring = state.setup.herringId ? playerById(state, state.setup.herringId) : null;
    if (!herring) {
      errors.push({ code: "herring", message: "Выберите красную селёдку Гадалки." });
    } else if (realTeamOf(herring) !== "good") {
      errors.push({ code: "herring-team", message: "Красная селёдка должна быть добрым игроком." });
    }
  }

  const infoChecks: [string, string, string][] = [
    ["washerwoman", "townsfolk", "Прачка"],
    ["librarian", "outsider", "Библиотекарь"],
    ["investigator", "minion", "Сыщик"],
  ];
  for (const [roleId, team, label] of infoChecks) {
    if (!has(roleId)) continue;
    const info = state.setup.info[roleId];
    if (roleId === "librarian" && info && "zero" in info && info.zero) {
      // The zero is true while every Outsider in play can register as
      // something else: the Recluse may register as a Minion or a Demon.
      const fixedOutsider = players.some(
        (player) => roleTeam(player.roleId || "") === "outsider" && player.roleId !== "recluse",
      );
      if (fixedOutsider) {
        errors.push({
          code: "librarian-zero",
          message: "Библиотекарь не может узнать «ноль», если в игре есть Изгой, кроме Отшельника.",
        });
      }
      continue;
    }
    const pairInfo = info ? (info as InfoPair) : null;
    if (
      !pairInfo ||
      !pairInfo.roleId ||
      !Array.isArray(pairInfo.pair) ||
      pairInfo.pair.length !== 2
    ) {
      errors.push({ code: "info-" + roleId, message: label + ": выберите роль и двух игроков." });
      continue;
    }
    if (pairInfo.pair[0] === pairInfo.pair[1]) {
      errors.push({ code: "info-pair-" + roleId, message: label + ": нужны два разных игрока." });
    }
    if (
      !players.some((player) => player.id === pairInfo.pair[0]) ||
      !players.some((player) => player.id === pairInfo.pair[1])
    ) {
      errors.push({
        code: "info-missing-" + roleId,
        message: label + ": один из игроков не найден.",
      });
    }
    if (roleTeam(pairInfo.roleId) !== team) {
      errors.push({
        code: "info-team-" + roleId,
        message: label + ": выбранная роль не того типа.",
      });
    }
    const infoTeam = roleTeam(pairInfo.roleId);
    const pairPlayers = pairInfo.pair.map((id) => playerById(state, id));
    // A shown character that is not in play is legal when a Spy registers as
    // it (Townsfolk or Outsider) or a Recluse registers as a Minion.
    const registering = pairPlayers.some(
      (player) =>
        player &&
        (infoTeam === "townsfolk" || infoTeam === "outsider"
          ? player.roleId === "spy"
          : infoTeam === "minion"
            ? player.roleId === "recluse"
            : false),
    );
    if (!state.setup.roles.includes(pairInfo.roleId) && !registering) {
      errors.push({
        code: "info-inplay-" + roleId,
        message: label + ": выбранная роль должна быть в игре.",
      });
    }
    const includesTrue = pairPlayers.some(
      (player) =>
        player &&
        (player.roleId === pairInfo.roleId ||
          ((infoTeam === "townsfolk" || infoTeam === "outsider") && player.roleId === "spy") ||
          (infoTeam === "minion" && player.roleId === "recluse")),
    );
    if (!includesTrue) {
      errors.push({
        code: "info-true-" + roleId,
        message:
          label + ": хотя бы один из двух должен быть этой ролью или подходящей регистрацией.",
      });
    }
  }

  const drunk = players.find((player) => player.roleId === "drunk");
  const mask = drunk && drunk.shownRoleId;
  const maskCheck = mask && infoChecks.find(([id]) => id === mask);
  if (maskCheck) {
    const info = state.setup.info[mask];
    const pairInfo = info ? (info as InfoPair) : null;
    // False information may be anything, including the Librarian's zero.
    const zeroInfo = mask === "librarian" && info !== null && info !== undefined && "zero" in info;
    const expectedTeam = maskCheck[1];
    const validPair =
      pairInfo &&
      Array.isArray(pairInfo.pair) &&
      pairInfo.pair.length === 2 &&
      pairInfo.pair[0] &&
      pairInfo.pair[1] &&
      pairInfo.pair[0] !== pairInfo.pair[1] &&
      players.some((player) => player.id === pairInfo.pair[0]) &&
      players.some((player) => player.id === pairInfo.pair[1]);
    if (!zeroInfo) {
      if (!pairInfo || !pairInfo.forDrunk || !pairInfo.roleId || !validPair) {
        errors.push({
          code: "drunk-info",
          message: "Пьяница: выберите ложную роль и двух игроков.",
        });
      } else if (roleTeam(pairInfo.roleId) !== expectedTeam) {
        errors.push({
          code: "drunk-info-team",
          message: "Пьяница: ложная роль должна быть того же типа, что показанная роль.",
        });
      }
    }
  }
  return errors;
}

export function autoSecrets(state: GameState, options: { onlyMissing?: boolean } = {}): GameState {
  const onlyMissing = options.onlyMissing === true;
  const players = orderedPlayers(state);
  const byTeam = (team: string) =>
    players.filter((player) => roleTeam(player.roleId || "") === team);

  if (state.setup.roles.includes("fortuneteller") && (!onlyMissing || !state.setup.herringId)) {
    const good = players.filter(
      (player) => realTeamOf(player) === "good" && player.roleId !== "fortuneteller",
    );
    if (good.length) state.setup.herringId = good[0]!.id;
  }

  const pickPair = (truePlayer: Player): InfoPair | null => {
    const decoy = players.find((player) => player.id !== truePlayer.id);
    if (!decoy) return null;
    return {
      roleId: truePlayer.roleId as RoleId,
      pair: [truePlayer.id, decoy.id] as [string, string],
      matchIndex: 0,
    };
  };

  if (
    state.setup.roles.includes("washerwoman") &&
    (!onlyMissing || !state.setup.info.washerwoman)
  ) {
    const actor = players.find((player) => player.roleId === "washerwoman");
    const truePlayer =
      byTeam("townsfolk").find((player) => !actor || player.id !== actor.id) ||
      byTeam("townsfolk")[0];
    if (truePlayer) state.setup.info.washerwoman = pickPair(truePlayer);
  }
  if (state.setup.roles.includes("librarian") && (!onlyMissing || !state.setup.info.librarian)) {
    const outsiders = byTeam("outsider");
    if (!outsiders.length) {
      state.setup.info.librarian = { zero: true, pair: [] };
    } else {
      state.setup.info.librarian = pickPair(outsiders[0]!);
    }
  }
  if (
    state.setup.roles.includes("investigator") &&
    (!onlyMissing || !state.setup.info.investigator)
  ) {
    const minions = byTeam("minion");
    if (minions.length) state.setup.info.investigator = pickPair(minions[0]!);
  }
  return state;
}

export function dealGame(
  state: GameState,
  options: { assignment?: Record<string, string>; random?: () => number } = {},
) {
  const errors = setupErrors(state);
  if (errors.length) return { ok: false, errors };
  const roles = state.setup.roles.slice();
  const assignment = options.assignment || null;
  if (assignment) {
    for (const [id, roleId] of Object.entries(assignment)) {
      if (!state.players[id]) return { ok: false, error: "Место " + id + " не найдено." };
      if (!isSupportedRole(roleId) || !state.script.roles.includes(roleId)) {
        return { ok: false, error: "Роль не входит в сценарий: " + roleId };
      }
    }
    // The assignment must place every bag role once over the seat order. A
    // duplicate, a role outside the bag or a seat without a role would deal a
    // character the table does not have.
    const placed: string[] = [];
    for (const player of orderedPlayers(state)) {
      const roleId = assignment[player.id];
      if (!roleId) {
        return {
          ok: false,
          error: "Раздача не совпадает с составом: у места " + player.seat + " нет роли.",
        };
      }
      placed.push(roleId);
    }
    const bag: string[] = roles.slice().sort();
    const dealt: string[] = placed.sort();
    if (bag.length !== dealt.length || bag.some((id, at) => id !== dealt[at])) {
      return { ok: false, error: "Раздача не совпадает с составом мешка." };
    }
  }

  const shuffled = roles.slice();
  if (!assignment) {
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor((options.random || Math.random)() * (i + 1));
      const tmp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = tmp;
    }
  }

  orderedPlayers(state).forEach((player, index) => {
    const roleId = assignment ? assignment[player.id] : shuffled[index];
    const shown =
      roleId === "drunk"
        ? state.setup.drunkShownId
        : roleId === "lunatic"
          ? state.setup.lunaticShownId
          : roleId;
    player.roleId = roleId || null;
    player.shownRoleId = shown || null;
    player.team = roleId
      ? roleTeam(roleId) === "minion" || roleTeam(roleId) === "demon"
        ? "evil"
        : "good"
      : null;
    player.alive = true;
    player.claimed = false;
    player.reminders = [];
    player.used = {};
    player.voteToken = true;
    player.butlerMasterId = null;
    player.changedFrom = null;
    player.deadAt = null;
    player.notes = "";
  });

  state.bluffs = (state.setup.count >= 7 ? state.setup.bluffs : []).slice();
  // The Evil Twin pair is a pair of players, not a pair of roles: a later
  // character change must not move the win to whoever inherits the character.
  const evilTwin = orderedPlayers(state).find((player) => player.roleId === "eviltwin");
  const goodTwin = state.setup.evilTwinGoodId
    ? orderedPlayers(state).find((player) => player.roleId === state.setup.evilTwinGoodId)
    : null;
  state.setup.evilTwinPlayerId = evilTwin ? evilTwin.id : null;
  state.setup.evilTwinGoodPlayerId =
    evilTwin && goodTwin && goodTwin.id !== evilTwin.id ? goodTwin.id : null;
  state.herringId = null;
  state.setup.herringId = null;
  state.setup.info = { washerwoman: null, librarian: null, investigator: null };
  state.phase = "deal";
  state.night = { number: 1, queue: [], currentIndex: 0, demonChanged: false };
  state.day = {
    number: 1,
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
  state.juggler = null;
  state.lastDay = null;
  state.fangguJumped = false;
  // A new deal starts from a clean slate: the old gossip, grandchild choice,
  // manual corrections and host notes belong to the previous game.
  state.gossip = null;
  state.setup.grandmotherId = null;
  state.corrections = [];
  state.notes = "";
  state.winner = null;
  state.reviewOpen = false;
  state.publicRevealed = false;
  state.setup.ready = false;
  state.log = [];
  addLog(state, {
    kind: "setup",
    title: "Роли разданы",
    detail: "Передайте устройство по кругу. Не обсуждайте роли до конца первой ночи.",
  });
  return { ok: true };
}

export function claimSeat(state: GameState, playerId: string, name: string) {
  const player = playerById(state, playerId);
  if (!player) return { ok: false, errorCode: "error.1", error: "Игрок не найден." };
  if (!player.roleId) return { ok: false, errorCode: "error.48", error: "Роль ещё не раздана." };
  if (player.claimed) return { ok: false, errorCode: "error.49", error: "Этот номер уже занят." };
  player.name =
    String(name || "")
      .trim()
      .slice(0, 24) || player.name;
  player.claimed = true;
  addLog(state, {
    secret: true,
    kind: "deal",
    title: "Место " + player.seat + " занято",
    detail: player.name,
    playerId: player.id,
  });
  return { ok: true, player };
}

// ---------------------------------------------------------------------------
// Manual correction
