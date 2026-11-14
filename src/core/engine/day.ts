import type { DeadAt, GameState, JugglerGuess, Player, RoleId } from "../model/types.ts";

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
  registersAlive,
  seatOf,
} from "../model/state.ts";

import { executionThreshold, dayAt, currentAt, addLog } from "./context.ts";
import { isImpaired, butlerMaster } from "./effects.ts";
import { buildNightQueue, executionDeathForDay } from "./night.ts";
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
  const spyTownsfolk =
    nominator.roleId === "spy" &&
    options.spyRegistersTownsfolk === true &&
    !isImpaired(state, nominator.id, dayAt(state));
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
    curse.active = false;
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

// A placed Witch curse resolves on the cursed player's next nomination. Losing
// the ability later does not remove it; the only removal is three living
// players (Witch r3013).
function activeWitchCurse(state: GameState, nominator: Player) {
  if (!isSnvScript(state.script) || livingPlayers(state).length <= 3) return null;
  return (
    state.effects.find(
      (candidate) =>
        candidate.kind === "witch" &&
        candidate.targetId === nominator.id &&
        candidate.day === state.day.number &&
        candidate.active,
    ) || null
  );
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
  const nominator = playerById(state, nominatorId);
  if (!nominator || !nominator.alive)
    return { ok: false, errorCode: "error.11", error: "Номинировать может только живой." };
  // Virgin r1729: the first nomination spends the ability even when it does not
  // trigger or the Virgin is impaired. When the day already recorded an
  // execution the vote ledger cannot open, so the table records the first
  // nomination and the spent ability directly.
  if (state.day.ended || state.day.execution) {
    if (virginTriggers(state, virgin, nominator, options)) {
      return { ok: false, errorCode: "error.23", error: "Сегодня уже была казнь." };
    }
    virgin.used.virgin = true;
    const nomination = {
      id: "nom-" + state.day.number + "-" + (state.day.nominations.length + 1),
      nominatorId: nominator.id,
      nomineeId: virgin.id,
      at: nowIso(),
      votes: [],
      count: 0,
      threshold: executionThreshold(livingPlayers(state).length),
      recorded: true,
      result: "external",
      butlerWarning: [],
    };
    state.day.nominations.push(nomination);
    addLog(state, {
      kind: "nomination",
      title: nominator.name + " номинирует " + virgin.name,
      detail: "Первый выдвиг Девственницы записан после казни дня.",
      playerId: virgin.id,
    });
    return { ok: true, virgin: false, nomination };
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
  const livingBefore = livingPlayers(state).filter(registersAlive).length;
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

function jugglerDayGuard(state: GameState) {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  if (state.phase !== "day") return { ok: false, errorCode: "error.7", error: "Сейчас не день." };
  const juggler = orderedPlayers(state).find(
    (player) => player.roleId === "juggler" && player.alive,
  );
  if (!juggler) return { ok: false, errorCode: "error.29", error: "Жонглёра нет в игре." };
  const current = state.juggler;
  if (current && typeof current.day === "number" && current.day !== state.day.number) {
    return { ok: false, errorCode: "error.7", error: "Жонглёр угадывает в свой первый день." };
  }
  return { ok: true as const };
}

// Juggler r3079: up to five public guesses on their first day; characters and
// players may repeat, and zero guesses is a legal record.
export function reportJugglerGuesses(
  state: GameState,
  guesses: Array<{ playerId: string; roleId: string }>,
) {
  const guard = jugglerDayGuard(state);
  if (guard.ok === false) return guard;
  if (!Array.isArray(guesses)) {
    return { ok: false, errorCode: "error.39", error: "Передайте список догадок Жонглёра." };
  }
  if (guesses.length > 5) {
    return { ok: false, errorCode: "error.39", error: "Можно угадать не больше пяти игроков." };
  }
  const clean: JugglerGuess[] = [];
  for (const guess of guesses) {
    const target = playerById(state, String(guess.playerId));
    if (!target) return { ok: false, errorCode: "error.31", error: "Цель не найдена." };
    const roleId = guess.roleId as RoleId;
    if (!isSupportedRole(roleId) || !(state.script && state.script.roles.includes(roleId))) {
      return { ok: false, errorCode: "error.2", error: "Выберите роль из сценария." };
    }
    clean.push({ playerId: target.id, roleId });
  }
  state.juggler = { day: state.day.number, guesses: clean };
  addLog(state, {
    secret: true,
    kind: "ability",
    title: "Жонглёр угадывает",
    detail: clean.length ? "Записано догадок: " + clean.length + "." : "Догадок нет.",
  });
  return { ok: true, juggler: state.juggler };
}

export function jugglerGuess(state: GameState, playerId: string, roleId: string) {
  const guard = jugglerDayGuard(state);
  if (guard.ok === false) return guard;
  const target = playerById(state, playerId);
  if (!target) return { ok: false, errorCode: "error.31", error: "Цель не найдена." };
  const stored = state.juggler && state.juggler.guesses;
  const guesses: JugglerGuess[] = Array.isArray(stored)
    ? stored.map((entry) => ({ playerId: String(entry.playerId), roleId: entry.roleId }))
    : stored && typeof stored === "object"
      ? Object.entries(stored).map(([id, role]) => ({ playerId: id, roleId: role }))
      : [];
  return reportJugglerGuesses(state, [
    ...guesses,
    { playerId: target.id, roleId: roleId as RoleId },
  ]);
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

// Tinker r1782: "You might die at any time." The Storyteller records a real
// ability death for a sober Tinker during the day or the night.
export function tinkerDeath(state: GameState, playerId: string) {
  if (state.winner) return { ok: false, errorCode: "error.6", error: "Игра уже окончена." };
  if (state.phase !== "day" && state.phase !== "night") {
    return { ok: false, errorCode: "error.7", error: "Сейчас не день." };
  }
  const player = playerById(state, playerId);
  if (!player) return { ok: false, errorCode: "error.1", error: "Игрок не найден." };
  if (!player.alive || player.roleId !== "tinker") {
    return { ok: false, errorCode: "error.58", error: "Тинкер не в игре или уже мёртв." };
  }
  const at = currentAt(state);
  if (isImpaired(state, player.id, at)) {
    return {
      ok: false,
      errorCode: "error.59",
      error: "Тинкер отравлен или пьян: способность не работает.",
    };
  }
  const death = kill(state, player.id, "ability", at, { ability: "tinker", bmr: "tinker" });
  checkWin(state);
  return { ok: true, death };
}

// Pacifist r2601: only a living, unimpaired Pacifist can spare an executed good
// player, and only for an execution the day decides.
function survivalAllowed(state: GameState, playerId: string, at: DeadAt): boolean {
  const player = playerById(state, playerId);
  if (!player || realTeamOf(player) === "evil") return false;
  return livingPlayers(state).some(
    (candidate) => candidate.roleId === "pacifist" && !isImpaired(state, candidate.id, at),
  );
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
  const at = dayAt(state);
  if (options.survives && !survivalAllowed(state, nomination.nomineeId, at)) {
    return {
      ok: false,
      errorCode: "error.57",
      error: "Выжить при казни может только добрый игрок при живом и здоровом Пацифисте.",
    };
  }
  state.day.execution = {
    playerId: nomination.nomineeId,
    cause: "vote",
    at: nowIso(),
    nominationId: nomination.id,
  };
  state.day.ended = true;
  state.day.open = false;
  state.day.activeNominationId = null;

  const livingBefore = livingPlayers(state).length;
  const death = executePlayer(state, nomination.nomineeId, "vote", at, options);
  // Link the death before the win check: the Mastermind and the Demon-dead
  // result both read the recorded execution death.
  state.day.execution.deathId = death ? death.id : null;
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
  const cause = options.cause || "vote";
  // A madness execution during the day is the day's execution. Only a madness
  // execution at night is outside the day's single execution.
  const nightMadness = state.phase === "night" && cause === "madness";
  if (state.phase !== "day" && !nightMadness) {
    return { ok: false, errorCode: "error.7", error: "Сейчас не день." };
  }
  if (state.day.execution && !nightMadness) {
    return { ok: false, errorCode: "error.23", error: "Сегодня уже была казнь." };
  }
  if (state.day.ended && !nightMadness) {
    return { ok: false, errorCode: "error.8", error: "День уже завершён." };
  }
  const player = playerById(state, playerId);
  if (!player) return { ok: false, errorCode: "error.1", error: "Игрок не найден." };
  // A dead player cannot be executed, so the day records no execution event.
  if (!player.alive)
    return { ok: false, errorCode: "error.55", error: "Нельзя казнить мёртвого игрока." };
  const at = nightMadness ? currentAt(state) : dayAt(state);
  if (options.survives && (nightMadness || !survivalAllowed(state, playerId, at))) {
    return {
      ok: false,
      errorCode: "error.57",
      error: "Выжить при казни может только добрый игрок при живом и здоровом Пацифисте.",
    };
  }
  if (!nightMadness) {
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
  }
  const death = executePlayer(state, playerId, cause, at, options);
  if (!nightMadness && state.day.execution) state.day.execution.deathId = death ? death.id : null;
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
  if (state.phase !== "day" && state.phase !== "night") {
    return { ok: false, errorCode: "error.7", error: "Сейчас не день." };
  }
  const at = currentAt(state);
  const effect = effectId
    ? madnessEffects(state, at).find(
        (candidate) => candidate.id === effectId && candidate.targetId === playerId,
      )
    : activeMadness(state, playerId, at);
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
  const number = state.day.number;
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
  }
  // A day whose execution produced no death is still a day without an
  // execution event for the Mayor and the Vortox, even when the execution
  // record already closed the day.
  if (!executionDeathForDay(state, state.day.number) && !isManualScript(state.script)) {
    checkWin(state, { endOfDay: true });
  }
  if (state.winner) return { ok: true, winner: state.winner };

  // A Juggler that entered play (dealt or created) without guessing still
  // answers on the night after their first day, so the day is persisted before
  // the next night queue is built.
  if (
    !state.juggler &&
    orderedPlayers(state).some((player) => player.alive && player.roleId === "juggler")
  ) {
    state.juggler = { day: state.day.number, guesses: [] };
  }

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
    (target.roleId === "recluse" &&
      options.recluseRegistersDemon === true &&
      !isImpaired(state, target.id, at));
  if (!isDemon || !target.alive) {
    addLog(state, {
      kind: "ability",
      title: "Истребитель промахивается",
      detail: target.name + " не Демон (или уже мёртв).",
    });
    return { ok: true, hit: false };
  }

  const livingBefore = livingPlayers(state).filter(registersAlive).length;
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
