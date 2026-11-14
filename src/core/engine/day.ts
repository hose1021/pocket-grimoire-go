import type { DeadAt, GameState, Player, RoleId } from "../model/types.ts";

type DayOptions = {
  spyRegistersTownsfolk?: boolean;
  recluseRegistersDemon?: boolean;
  survives?: boolean;
  cause?: string;
};

// Trouble Brewing domain: day. No DOM or persistence.
import {
  isBmrScript,
  isManualScript,
  isSnvScript,
  isSupportedRole,
  roleTeam,
} from "../model/rules.ts";
import {
  livingPlayers,
  nowIso,
  orderedPlayers,
  playerById,
  realTeamOf,
  seatOf,
} from "../model/state.ts";

import { executionThreshold, dayAt, addLog } from "./context.ts";
import { isImpaired, butlerMaster } from "./effects.ts";
import { buildNightQueue } from "./night.ts";
import {
  MADNESS_PENALTIES,
  activeMadness,
  madnessEffects,
  madnessReviewsDue,
  reconcileNoDashiiPoison,
} from "./sv.ts";
import { kill, resolveDemonDeath, checkWin, setWinner } from "./death.ts";

export function openNominations(state: GameState) {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  if (state.phase !== "day") return { ok: false, errorCode: "error.7", error: "Сейчас не день." };
  if (state.day.ended) return { ok: false, errorCode: "error.8", error: "День уже завершён." };
  state.day.open = true;
  addLog(state, {
    kind: "phase",
    title: "Номинации открыты",
    detail: "Номинировать может только живой игрок, один раз за день.",
  });
  return { ok: true };
}

export function virginTriggers(
  state: GameState,
  nominee: Player | null,
  nominator: Player,
  options: DayOptions = {},
): boolean {
  if (!nominee || nominee.roleId !== "virgin" || !nominee.alive) return false;
  if (nominee.used.virgin) return false;
  if (isImpaired(state, nominee.id, dayAt(state))) return false;
  const realTownsfolk = roleTeam(nominator.roleId || "") === "townsfolk";
  const spyTownsfolk = nominator.roleId === "spy" && options.spyRegistersTownsfolk === true;
  return realTownsfolk || spyTownsfolk;
}

export function nominate(
  state: GameState,
  nominatorId: string,
  nomineeId: string,
  options: DayOptions = {},
) {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  if (state.phase !== "day" || !state.day.open)
    return { ok: false, errorCode: "error.9", error: "Номинации не открыты." };
  if (state.day.ended) return { ok: false, errorCode: "error.8", error: "День уже завершён." };
  if (state.day.activeNominationId) {
    return { ok: false, errorCode: "error.10", error: "Сначала завершите текущее голосование." };
  }
  const nominator = playerById(state, nominatorId);
  const nominee = playerById(state, nomineeId);
  if (!nominator || !nominator.alive)
    return { ok: false, errorCode: "error.11", error: "Номинировать может только живой." };
  if (!nominee) return { ok: false, errorCode: "error.12", error: "Номинант не найден." };
  if (state.day.nominations.some((nomination) => nomination.nominatorId === nominator.id)) {
    return { ok: false, errorCode: "error.13", error: "Этот игрок уже номинировал сегодня." };
  }
  if (state.day.nominations.some((nomination) => nomination.nomineeId === nominee.id)) {
    return { ok: false, errorCode: "error.14", error: "Этого игрока уже номинировали сегодня." };
  }

  // The Witch's curse kills the nominator when they nominate, but does not
  // cancel the nomination: it still proceeds to a vote.
  const curse = activeWitchCurse(state, nominator);
  const witchDeath = (deathCause: string) => {
    if (!curse) return null;
    curse.effect.active = false;
    const death = kill(state, nominator.id, deathCause, dayAt(state), {
      demon: false,
      ability: "witch",
    });
    addLog(state, {
      secret: true,
      kind: "ability",
      title: "Ведьма: проклятие срабатывает",
      detail: nominator.name + " выдвинул игрока и умирает.",
      playerId: nominator.id,
    });
    return death;
  };

  const virgin = nominee.roleId === "virgin" ? nominee : null;
  if (virgin && virgin.alive && !virgin.used.virgin) {
    const triggers = virginTriggers(state, virgin, nominator, options);
    virgin.used.virgin = true;
    if (triggers) {
      state.day.execution = {
        playerId: nominator.id,
        cause: "virgin",
        at: nowIso(),
        nominationId: null,
      };
      state.day.ended = true;
      state.day.open = false;
      const death = kill(state, nominator.id, "execution", dayAt(state));
      state.day.execution.deathId = death ? death.id : null;
      state.executions.push({
        playerId: nominator.id,
        cause: "virgin",
        at: nowIso(),
        deathId: death ? death.id : null,
      });
      if (death && roleTeam(nominator.roleId || "") === "demon") {
        resolveDemonDeath(state, {
          cause: "execution",
          livingBefore: death.livingBefore || 0,
          at: dayAt(state),
        });
      }
      // The curse also triggers, but the nominator is already dead.
      witchDeath("execution");
      checkWin(state);
      addLog(state, {
        kind: "execution",
        title: "Девственница срабатывает",
        detail: nominator.name + " казнён сразу. День завершён.",
        consequence: death ? "death" : "prevented",
      });
      return { ok: true, virgin: true, execution: state.day.execution };
    }
  }

  const nomination = {
    id: "nom-" + state.day.number + "-" + (state.day.nominations.length + 1),
    nominatorId: nominator.id,
    nomineeId: nominee.id,
    at: nowIso(),
    votes: [],
    count: 0,
    threshold: executionThreshold(livingPlayers(state).length),
    recorded: false,
    result: "pending",
    butlerWarning: [],
  };
  state.day.nominations.push(nomination);
  state.day.activeNominationId = nomination.id;
  addLog(state, {
    kind: "nomination",
    title: nominator.name + " номинирует " + nominee.name,
    detail: "Порог: " + nomination.threshold + ".",
    playerId: nominee.id,
  });

  // The curse kills the nominator after the nomination is recorded, so the
  // nomination and its vote still stand. A game-ending death ends the day.
  const curseDeath = witchDeath("ability");
  if (curseDeath) {
    // The nominator died before the vote, so the threshold follows the new
    // living count while the nomination itself stays open.
    nomination.threshold = executionThreshold(livingPlayers(state).length);
    checkWin(state);
    if (state.winner) {
      state.day.ended = true;
      state.day.open = false;
      state.day.activeNominationId = null;
    }
  }
  return {
    ok: true,
    nomination,
    curse: Boolean(curseDeath),
    deathId: curseDeath ? curseDeath.id : null,
    winner: state.winner || null,
  };
}

// An active Witch curse applies only while more than three players live and the
// Witch is alive and sober/healthy.
function activeWitchCurse(state: GameState, nominator: Player) {
  if (!isSnvScript(state.script) || livingPlayers(state).length <= 3) return null;
  const effect = state.effects.find(
    (candidate) =>
      candidate.kind === "witch" &&
      candidate.targetId === nominator.id &&
      candidate.day === state.day.number &&
      candidate.active,
  );
  if (!effect) return null;
  const witch = effect.sourceId == null ? null : playerById(state, effect.sourceId);
  if (!witch || !witch.alive) return null;
  if (isImpaired(state, witch.id, dayAt(state))) return null;
  return { effect, witch };
}

// Record this ability at an in-person table without requiring a vote ledger.

export function recordVirginNomination(
  state: GameState,
  nominatorId: string,
  virginId: string,
  options: DayOptions = {},
) {
  const virgin = playerById(state, virginId);
  if (!virgin || virgin.roleId !== "virgin" || !virgin.alive || virgin.used.virgin) {
    return { ok: false, errorCode: "error.15", error: "Virgin ability is unavailable." };
  }
  const wasOpen = state.day.open;
  state.day.open = true;
  const result = nominate(state, nominatorId, virginId, options);
  if (!result.ok) {
    state.day.open = wasOpen;
    return result;
  }
  if (result.nomination) {
    result.nomination.recorded = true;
    result.nomination.result = "external";
    state.day.activeNominationId = null;
    state.day.open = wasOpen;
  }
  return result;
}

export function recoverClaim(state: GameState, playerId: string, reason: string = "") {
  const player = playerById(state, playerId);
  if (!player || !String(reason || "").trim())
    return { ok: false, errorCode: "error.16", error: "A player and reason are required." };
  player.claimed = false;
  player.name = "";
  state.corrections.push({ kind: "claim", playerId, reason, at: nowIso() });
  addLog(state, {
    secret: true,
    kind: "correction",
    title: "Role handoff reopened",
    detail: reason,
    playerId,
  });
  return { ok: true };
}

export function recordVotes(state: GameState, nominationId: string, voterIds: string[]) {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  if (state.phase !== "day") return { ok: false, errorCode: "error.7", error: "Сейчас не день." };
  const nomination = state.day.nominations.find((item) => item.id === nominationId);
  if (!nomination) return { ok: false, errorCode: "error.17", error: "Номинация не найдена." };
  if (nomination.recorded)
    return { ok: false, errorCode: "error.18", error: "Голоса уже записаны." };
  if (state.day.ended) return { ok: false, errorCode: "error.8", error: "День уже завершён." };

  const at = dayAt(state);
  const valid = new Set<string>();
  const warnings = [];
  for (const rawId of voterIds || []) {
    const id = String(rawId);
    const player = playerById(state, id);
    if (!player) continue;
    if (player.alive) {
      valid.add(id);
      continue;
    }
    if (player.voteToken) {
      valid.add(id);
      player.voteToken = false;
    } else {
      warnings.push(player.name + ": голос мёртвого уже использован.");
    }
  }

  for (const player of livingPlayers(state)) {
    if (player.roleId !== "butler") continue;
    if (!valid.has(player.id)) continue;
    const master = butlerMaster(state, player.id, at);
    if (master && !valid.has(master)) {
      // Official Storyteller guidance: count the vote that was actually cast.
      // Removing it would reveal the Butler, so only record a private warning.
      warnings.push(
        "Дворецкий голосует без своего хозяина: голос учтён, нарушение видит только ведущий.",
      );
    }
  }

  const ordered = Array.from(valid).sort((a, b) => {
    if (a === nomination.nomineeId) return 1;
    if (b === nomination.nomineeId) return -1;
    return seatOf(state, a) - seatOf(state, b);
  });
  nomination.votes = ordered;
  nomination.count = ordered.length;
  nomination.threshold = executionThreshold(livingPlayers(state).length);
  nomination.recorded = true;
  nomination.result = ordered.length >= nomination.threshold ? "qualified" : "failed";
  nomination.butlerWarning = warnings;
  nomination.deadVoters = ordered.filter((id) => {
    const player = playerById(state, id);
    return player && !player.alive;
  });
  state.day.activeNominationId = null;
  addLog(state, {
    kind: "vote",
    title: "Голосование: " + nomination.count + " из " + nomination.threshold,
    detail: warnings.join(" "),
    playerId: nomination.nomineeId,
  });
  return { ok: true, nomination };
}

export function cancelNomination(state: GameState, nominationId: string) {
  const nomination = state.day.nominations.find((item) => item.id === nominationId);
  if (!nomination) return { ok: false, errorCode: "error.17", error: "Номинация не найдена." };
  if (nomination.recorded)
    return {
      ok: false,
      errorCode: "error.19",
      error: "Голоса уже записаны. Используйте ручную правку.",
    };
  state.day.nominations = state.day.nominations.filter((item) => item.id !== nominationId);
  if (state.day.activeNominationId === nominationId) state.day.activeNominationId = null;
  addLog(state, {
    secret: true,
    kind: "nomination",
    title: "Номинация отменена",
    detail: nomination.id,
  });
  return { ok: true };
}

export function resetVotes(state: GameState, nominationId: string, reason: string) {
  if (!String(reason || "").trim())
    return { ok: false, errorCode: "error.20", error: "Укажите причину." };
  const nomination = state.day.nominations.find((item) => item.id === nominationId);
  if (!nomination) return { ok: false, errorCode: "error.17", error: "Номинация не найдена." };
  if (!nomination.recorded)
    return { ok: false, errorCode: "error.21", error: "Голоса ещё не записаны." };
  if (state.day.execution)
    return { ok: false, errorCode: "error.22", error: "Казнь уже состоялась." };
  for (const id of nomination.deadVoters || ([] as string[])) {
    const player = playerById(state, id);
    if (player && !player.alive) player.voteToken = true;
  }
  nomination.votes = [];
  nomination.deadVoters = [];
  nomination.count = 0;
  nomination.recorded = false;
  nomination.result = "pending";
  nomination.butlerWarning = [];
  state.day.activeNominationId = nomination.id;
  addLog(state, {
    secret: true,
    kind: "correction",
    title: "Голоса возвращены на пересчёт",
    detail: reason,
  });
  return { ok: true };
}

export function leader(state: GameState) {
  const recorded = state.day.nominations.filter((nomination) => nomination.recorded);
  if (!recorded.length) return { nomination: null };
  const max = Math.max(...recorded.map((nomination) => nomination.count));
  const top = recorded.filter((nomination) => nomination.count === max);
  if (top.length !== 1) {
    return { tie: true, count: max, nominations: top };
  }
  const nomination = top[0]!;
  if (nomination.count < nomination.threshold) {
    return {
      nomination,
      belowThreshold: true,
      count: nomination.count,
      threshold: nomination.threshold,
    };
  }
  return { nomination, count: nomination.count, threshold: nomination.threshold };
}

export function executePlayer(
  state: GameState,
  playerId: string,
  cause: string,
  at: DeadAt,
  options: DayOptions = {},
) {
  const player = playerById(state, playerId);
  if (!player) return null;
  const livingBefore = livingPlayers(state).length;
  const death = options.survives ? null : kill(state, playerId, "execution", at);
  state.executions.push({
    playerId,
    cause,
    at: nowIso(),
    deathId: death ? death.id : null,
  });
  if (!isManualScript(state.script) && death && roleTeam(player.roleId || "") === "demon") {
    resolveDemonDeath(state, { cause: "execution", livingBefore, at });
  }
  if (!isManualScript(state.script) && isSnvScript(state.script)) reconcileNoDashiiPoison(state);
  if (
    !isManualScript(state.script) &&
    death &&
    isBmrScript(state.script) &&
    roleTeam(player.roleId || "") === "minion"
  ) {
    const minstrel = livingPlayers(state).find(
      (candidate) => candidate.roleId === "minstrel" && !isImpaired(state, candidate.id, at),
    );
    if (minstrel) {
      const expires: DeadAt = { phase: "night", number: state.day.number + 2 };
      const targets = livingPlayers(state).filter((candidate) => candidate.id !== minstrel.id);
      for (const target of targets) {
        state.effects.push({
          id: "eff-" + (state.effects.length + 1) + "-" + Math.random().toString(36).slice(2, 6),
          kind: "drunk",
          sourceId: minstrel.id,
          targetId: target.id,
          start: { phase: "day", number: state.day.number },
          expires,
          active: true,
        });
      }
      addLog(state, {
        secret: true,
        kind: "ability",
        title: "Менестрель: все пьяны",
        detail: "Приспешник казнён. Все остальные игроки пьяны до заката завтрашнего дня.",
      });
    }
  }
  return death;
}

export function moonchildChoice(state: GameState, targetId: string) {
  if (!state.day || state.phase !== "day")
    return { ok: false, errorCode: "error.7", error: "Сейчас не день." };
  const moonchild = orderedPlayers(state).find(
    (player) =>
      player.roleId === "moonchild" &&
      !player.alive &&
      !(player.used && player.used.moonchildTarget),
  );
  if (!moonchild) return { ok: false, errorCode: "error.29", error: "Дитя Луны не может выбрать." };
  const target = playerById(state, targetId);
  if (!target || !target.alive)
    return { ok: false, errorCode: "error.31", error: "Цель должна быть живой." };
  moonchild.used = moonchild.used || {};
  moonchild.used.moonchildTarget = target.id;
  addLog(state, {
    secret: true,
    kind: "ability",
    title: "Дитя Луны выбирает " + target.name,
    detail: "Если цель добрая, она умрёт следующей ночью.",
  });
  return { ok: true, targetId: target.id };
}

export function jugglerGuess(state: GameState, playerId: string, roleId: string) {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  if (state.phase !== "day") return { ok: false, errorCode: "error.7", error: "Сейчас не день." };
  if (state.day.number !== 1) {
    return { ok: false, errorCode: "error.7", error: "Жонглёр угадывает в первый день." };
  }
  const juggler = orderedPlayers(state).find(
    (player) => player.roleId === "juggler" && player.alive,
  );
  if (!juggler) return { ok: false, errorCode: "error.29", error: "Жонглёра нет в игре." };
  const target = playerById(state, playerId);
  if (!target) return { ok: false, errorCode: "error.31", error: "Цель не найдена." };
  const guess = roleId as RoleId;
  if (!isSupportedRole(guess) || !(state.script && state.script.roles.includes(guess))) {
    return { ok: false, errorCode: "error.2", error: "Выберите роль из сценария." };
  }
  const guesses =
    state.juggler && state.juggler.day === 1 && state.juggler.guesses
      ? { ...state.juggler.guesses }
      : {};
  if (!guesses[target.id] && Object.keys(guesses).length >= 5) {
    return { ok: false, errorCode: "error.39", error: "Можно угадать не больше пяти игроков." };
  }
  guesses[target.id] = guess;
  state.juggler = { day: 1, guesses };
  addLog(state, {
    secret: true,
    kind: "ability",
    title: "Жонглёр угадывает",
    detail: target.name + ": " + roleId + ".",
  });
  return { ok: true, juggler: state.juggler };
}

export function gossipStatement(state: GameState, truth: boolean) {
  if (!state.day || state.phase !== "day")
    return { ok: false, errorCode: "error.7", error: "Сейчас не день." };
  const gossip = orderedPlayers(state).find((player) => player.roleId === "gossip" && player.alive);
  if (!gossip) return { ok: false, errorCode: "error.29", error: "Сплетницы нет в игре." };
  if (state.gossip && state.gossip.day === state.day.number) {
    return { ok: false, errorCode: "error.29", error: "Заявление уже записано на этот день." };
  }
  state.gossip = { day: state.day.number, truth: Boolean(truth), playerId: gossip.id };
  addLog(state, {
    secret: true,
    kind: "ability",
    title: "Сплетница делает заявление",
    detail: "Заявление " + (truth ? "истинно" : "ложно") + ". Ночью ведущий разрешает последствие.",
  });
  return { ok: true, gossip: state.gossip };
}

export function execute(state: GameState, nominationId: string, options: DayOptions = {}) {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  if (state.phase !== "day") return { ok: false, errorCode: "error.7", error: "Сейчас не день." };
  if (state.day.execution)
    return { ok: false, errorCode: "error.23", error: "Сегодня уже была казнь." };
  if (state.day.ended) return { ok: false, errorCode: "error.8", error: "День уже завершён." };
  const current = leader(state);
  if (!current.nomination)
    return { ok: false, errorCode: "error.24", error: "Нет номинации с голосами." };
  if (current.tie)
    return { ok: false, errorCode: "error.25", error: "Ничья на максимуме: казни нет." };
  if (current.belowThreshold)
    return { ok: false, errorCode: "error.26", error: "Голосов меньше порога." };
  if (nominationId && current.nomination.id !== nominationId) {
    return { ok: false, errorCode: "error.27", error: "Казнить можно только единоличного лидера." };
  }

  const nomination = current.nomination;
  const nominee = playerById(state, nomination.nomineeId);
  state.day.execution = {
    playerId: nomination.nomineeId,
    cause: "vote",
    at: nowIso(),
    nominationId: nomination.id,
  };
  state.day.ended = true;
  state.day.open = false;
  state.day.activeNominationId = null;

  const at = dayAt(state);
  const livingBefore = livingPlayers(state).length;
  const death = executePlayer(state, nomination.nomineeId, "vote", at, options);
  if (death && nominee && roleTeam(nominee.roleId || "") === "demon") {
    // executePlayer already resolved inheritance.
  }
  checkWin(state);
  addLog(state, {
    kind: "execution",
    title: "Казнь: " + (nominee ? nominee.name : "—"),
    detail: death ? "Казнён и умер." : "Игрок был уже мёртв: смерть не наступила.",
    playerId: nomination.nomineeId,
    consequence: death ? "death" : "prevented",
  });
  return { ok: true, execution: state.day.execution, death, livingBefore };
}

export function executeByDecision(state: GameState, playerId: string, options: DayOptions = {}) {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  if (state.phase !== "day") return { ok: false, errorCode: "error.7", error: "Сейчас не день." };
  if (state.day.execution)
    return { ok: false, errorCode: "error.23", error: "Сегодня уже была казнь." };
  if (state.day.ended) return { ok: false, errorCode: "error.8", error: "День уже завершён." };
  const player = playerById(state, playerId);
  if (!player) return { ok: false, errorCode: "error.1", error: "Игрок не найден." };
  const at = dayAt(state);
  const cause = options.cause || "vote";
  state.day.execution = {
    playerId,
    cause,
    at: nowIso(),
    nominationId: null,
    deathId: null,
  };
  state.day.ended = true;
  state.day.open = false;
  state.day.activeNominationId = null;
  const death = executePlayer(state, playerId, cause, at, options);
  state.day.execution.deathId = death ? death.id : null;
  checkWin(state);
  if (
    !state.winner &&
    isBmrScript(state.script) &&
    state.mastermind?.active &&
    state.mastermind.extraDay
  ) {
    const good = realTeamOf(player) !== "evil";
    setWinner(state, good ? "evil" : "good", "mastermind");
  }
  addLog(state, {
    kind: "execution",
    title: "Казнь: " + (player.name || "Игрок " + player.seat),
    detail: death ? "Казнён и умер." : "Игрок был уже мёртв: смерть не наступила.",
    playerId,
    consequence: death ? "death" : "prevented",
  });
  return { ok: true, execution: state.day.execution, death };
}

// The madness penalty is a Storyteller decision, never an automatic effect of
// a failed madness. The command records the chosen legal option and its reason
// on the token, and an execution goes through the normal day execution path.
export function applyMadnessPenalty(
  state: GameState,
  playerId: string,
  penalty: string,
  reason: string,
  effectId?: string,
) {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  if (state.phase !== "day") return { ok: false, errorCode: "error.7", error: "Сейчас не день." };
  const effect = effectId
    ? madnessEffects(state).find(
        (candidate) => candidate.id === effectId && candidate.targetId === playerId,
      )
    : activeMadness(state, playerId);
  if (!effect)
    return { ok: false, errorCode: "error.62", error: "У игрока нет активного безумия." };
  if (!(MADNESS_PENALTIES as readonly string[]).includes(penalty)) {
    return {
      ok: false,
      errorCode: "error.63",
      error: "Выберите законный штраф за безумие: казнь или без последствий.",
      needsChoice: true,
      info: { options: MADNESS_PENALTIES.slice() },
    };
  }
  const text = String(reason == null ? "" : reason).trim();
  if (!text)
    return { ok: false, errorCode: "error.64", error: "Укажите причину решения ведущего." };
  const number = dayAt(state).number;
  const canUpgradeReview =
    effect.decidedDay === number && effect.decidedPenalty === "none" && penalty === "execute";
  if (effect.decidedDay === number && !canUpgradeReview) {
    return {
      ok: false,
      errorCode: "error.65",
      error: "Решение по этому безумию уже записано сегодня.",
    };
  }
  let death = null;
  if (penalty === "execute") {
    const result = executeByDecision(state, playerId, { cause: "madness" });
    if (result.ok === false) return result;
    death = result.death || null;
  }
  effect.decidedDay = number;
  effect.decidedPenalty = penalty;
  effect.decidedReason = text;
  const player = playerById(state, playerId);
  addLog(state, {
    secret: true,
    kind: "ability",
    title: "Безумие: " + (player ? player.name : playerId),
    detail:
      (penalty === "execute" ? "Ведущий казнил игрока. " : "Ведущий не стал казнить. ") + text,
    playerId,
    case: "madness-penalty",
  });
  return { ok: true, penalty, reason: text, death };
}

export function endDay(state: GameState) {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  if (state.phase !== "day") return { ok: false, errorCode: "error.7", error: "Сейчас не день." };

  const madnessDue = madnessReviewsDue(state);
  if (madnessDue.length) {
    return {
      ok: false,
      errorCode: "error.66",
      error: "Проверьте безумие у игроков: " + madnessDue.length + ".",
      info: { playerIds: madnessDue.map((effect) => effect.targetId).filter(Boolean) },
    };
  }

  if (
    !isManualScript(state.script) &&
    isBmrScript(state.script) &&
    state.mastermind &&
    state.mastermind.active
  ) {
    if (!state.mastermind.extraDay) {
      state.mastermind.extraDay = true;
      state.day = {
        number: state.day.number + 1,
        morning: [],
        nominations: [],
        activeNominationId: null,
        execution: null,
        ended: false,
        open: false,
      };
      state.phase = "day";
      addLog(state, {
        kind: "phase",
        title: "День " + state.day.number,
        detail: "Кукловод продлил игру. Казнь сегодня решит исход.",
      });
      return { ok: true, day: state.day, mastermind: true };
    }
    const execution = state.day.execution;
    if (execution) {
      const player = playerById(state, execution.playerId);
      const good = player ? realTeamOf(player) !== "evil" : false;
      setWinner(state, good ? "evil" : "good", "mastermind");
    } else {
      setWinner(state, "good", "demon-dead");
    }
    return { ok: true, winner: state.winner };
  }

  if (!state.day.ended) {
    state.day.ended = true;
    state.day.open = false;
    state.day.activeNominationId = null;
    if (!state.day.execution && !isManualScript(state.script)) {
      checkWin(state, { endOfDay: true });
    }
  }
  if (state.winner) return { ok: true, winner: state.winner };

  state.lastDay = {
    number: state.day.number,
    nominations: state.day.nominations.slice(),
    execution: state.day.execution ? { ...state.day.execution } : null,
  };
  const nextNight = Math.max(1, (state.night.number || state.day.number) + 1);
  state.night = { number: nextNight, queue: [], currentIndex: 0, demonChanged: false };
  state.day = {
    number: nextNight,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: false,
  };
  state.phase = "night";
  state.night.queue = buildNightQueue(state);
  addLog(state, {
    kind: "phase",
    title: "Ночь " + nextNight,
    detail: "Город засыпает. Разбудите роли по порядку.",
  });
  return { ok: true, night: state.night };
}

export function useSlayer(
  state: GameState,
  slayerId: string,
  targetId: string,
  options: DayOptions = {},
) {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  if (state.phase !== "day")
    return { ok: false, errorCode: "error.28", error: "Способность работает днём." };
  if (state.day.ended) return { ok: false, errorCode: "error.8", error: "День уже завершён." };
  const slayer = playerById(state, slayerId);
  if (!slayer || !slayer.alive || slayer.roleId !== "slayer") {
    return { ok: false, errorCode: "error.29", error: "Истребитель не может действовать." };
  }
  if (slayer.used.slayer)
    return { ok: false, errorCode: "error.30", error: "Истребитель уже использовал способность." };
  const target = playerById(state, targetId);
  if (!target) return { ok: false, errorCode: "error.31", error: "Цель не найдена." };

  slayer.used.slayer = true;
  const at = dayAt(state);
  addLog(state, {
    kind: "ability",
    title: "Истребитель выбирает " + target.name,
    detail: "Публичная попытка. Способность одноразовая.",
  });

  if (isImpaired(state, slayerId, at)) {
    addLog(state, {
      secret: true,
      kind: "ability",
      title: "Истребитель: способность не сработала",
      detail: "Игрок был отравлен или пьян.",
    });
    return { ok: true, hit: false, impaired: true };
  }

  const isDemon =
    roleTeam(target.roleId || "") === "demon" ||
    (target.roleId === "recluse" && options.recluseRegistersDemon === true);
  if (!isDemon || !target.alive) {
    addLog(state, {
      kind: "ability",
      title: "Истребитель промахивается",
      detail: target.name + " не Демон (или уже мёртв).",
    });
    return { ok: true, hit: false };
  }

  const livingBefore = livingPlayers(state).length;
  const death = kill(state, target.id, "slayer", at);
  let inheritance = null;
  if (death && roleTeam(target.roleId || "") === "demon") {
    inheritance = resolveDemonDeath(state, {
      cause: "slayer",
      livingBefore,
      at,
    });
  }
  checkWin(state);
  return { ok: true, hit: true, death, inheritance };
}

// ---------------------------------------------------------------------------
// Setup and secrets
