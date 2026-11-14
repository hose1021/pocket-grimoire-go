import type { Alignment, DeadAt, Death, GameState, Player, Winner } from "../model/types.ts";

// Trouble Brewing domain: death. No DOM or persistence.
import { isBmrScript, isManualScript, isSnvScript, roleLabel, roleTeam } from "../model/rules.ts";
import { livingPlayers, nowIso, orderedPlayers, playerById, realTeamOf } from "../model/state.ts";

import { dayAt, currentAt, addLog } from "./context.ts";
import { isImpaired, protectionFor, soldierSafe, mayorRedirects, bmrCannotDie } from "./effects.ts";
import { HOST_CHOICE_REASONS } from "./host-choice.ts";

import { demonChangePending } from "./night.ts";
import { minionRetainsAbility } from "./retention.ts";

const DEMON_REASONS = {
  "demon-dead": "Демон мёртв, и никто не унаследовал его роль.",
  saint: "Святой казнён, и его способность действовала.",
  mayor: "Мэр жив, в городе ровно три игрока и казни не было.",
  "two-alive": "В живых осталось двое.",
  mastermind: "Кукловод продлил игру на один день.",
  vortox: "Вортокс: день закончился без казни.",
  "evil-twin": "Злой Близнец: добрый Близнец казнён.",
  klutz: "Растяпа выбрал противника, и его команда проигрывает.",
};

export function kill(
  state: GameState,
  playerId: string,
  cause: string,
  at: DeadAt = currentAt(state),
  extra: {
    demon?: boolean;
    bypassProtection?: boolean;
    ability?: string;
    bmr?: string | boolean;
  } = {},
): Death | null {
  const player = playerById(state, playerId);
  if (!player || !player.alive) return null;
  if (!isManualScript(state.script) && isBmrScript(state.script)) {
    const prevented = bmrCannotDie(state, playerId, at, {
      cause: cause === "demon" ? "demon" : extra.demon ? "demon" : cause,
      bypassProtection: extra.bypassProtection === true,
    });
    if (prevented) {
      if (prevented === "fool") {
        player.used = player.used || {};
        player.used.fool = true;
      }
      if (prevented === "zombuul") {
        player.used = player.used || {};
        player.used.zombuul = true;
        player.registeredDead = true;
        addLog(state, {
          secret: true,
          kind: "death",
          title: player.name + ": первая смерть Зомбула",
          detail: "Зомбул остаётся жив, но регистрируется как мёртвый.",
          playerId,
          consequence: "prevented",
        });
        checkWin(state);
        return null;
      }
      addLog(state, {
        secret: true,
        kind: "death",
        title: player.name + ": смерть предотвращена",
        detail: "Причина: " + cause + ". Защита: " + prevented + ".",
        playerId,
        consequence: "prevented",
      });
      return null;
    }
  }
  const livingBefore = livingPlayers(state).length;
  const impaired = isImpaired(state, playerId, at);
  player.alive = false;
  player.deadAt = { phase: at.phase, number: at.number, cause };
  player.voteToken = true;
  const death = {
    id: "death-" + (state.deaths.length + 1) + "-" + Math.random().toString(36).slice(2, 6),
    playerId,
    roleId: player.roleId,
    cause,
    phase: at.phase,
    number: at.number,
    at: nowIso(),
    impaired,
    livingBefore,
    ...extra,
  };
  state.deaths.push(death);
  addLog(state, {
    secret: true,
    kind: "death",
    title: player.name + " погибает",
    detail: "Причина: " + cause + ". Роль: " + roleLabel(player.roleId) + ".",
    playerId,
    consequence: "death",
  });
  return death;
}

export function becomeDemon(
  state: GameState,
  player: Player,
  via: string,
  _at: DeadAt = currentAt(state),
): Player {
  const previous = player.roleId;
  player.changedFrom = previous;
  player.roleId = "imp";
  player.shownRoleId = "imp";
  player.team = "evil";
  for (const step of state.night.queue) {
    if (step.done || step.skipped) continue;
    if (step.actorId !== player.id) continue;
    if (!step.roleId || step.roleId === "imp") continue;
    step.done = true;
    step.skipped = true;
    step.note = "Роль изменилась до шага: теперь это Демон.";
    step.noteKey = "note.roleChangedDemon";
  }
  player.reminders = Array.isArray(player.reminders) ? player.reminders : [];
  if (!player.reminders.includes("Демон")) player.reminders.push("Демон");
  state.night.demonChanged = true;
  addLog(state, {
    secret: true,
    kind: "role-change",
    title: "Новый Демон: " + player.name,
    detail:
      via === "scarletwoman"
        ? "Алая женщина становится Демоном. Порог живых соблюдён."
        : "Приспешник получает роль Демона после самоубийства Чёрта.",
    playerId: player.id,
  });
  return player;
}

export function resolveDemonDeath(
  state: GameState,
  {
    cause,
    livingBefore,
    at = currentAt(state),
  }: { cause: string; livingBefore: number; at?: DeadAt },
) {
  const living = livingPlayers(state);
  const scarlet = living.find(
    (player) => player.roleId === "scarletwoman" && !isImpaired(state, player.id, at),
  );
  if (scarlet && livingBefore >= 5) {
    becomeDemon(state, scarlet, "scarletwoman", at);
    return { inherited: true, playerId: scarlet.id, via: "scarletwoman" };
  }

  if (cause === "imp-self-kill") {
    const minions = living.filter((player) => roleTeam(player.roleId || "") === "minion");
    if (minions.length === 1) {
      becomeDemon(state, minions[0]!, "imp", at);
      return { inherited: true, playerId: minions[0]!.id, via: "imp" };
    }
    if (minions.length > 1) {
      return {
        inherited: false,
        pendingInheritance: {
          kind: "demon-inheritance",
          options: minions.map((player) => ({
            id: player.id,
            name: player.name,
            roleId: player.roleId,
          })),
        },
      };
    }
  }
  return { inherited: false };
}

export function chooseDemonHeir(state: GameState, stepKey: string, heirId: string) {
  const step = state.night.queue.find((candidate) => candidate.key === stepKey);
  if (!step || !step.pending || step.pending.kind !== "demon-inheritance") {
    return { ok: false, errorCode: "error.32", error: "Здесь нет выбора наследника." };
  }
  const heir = playerById(state, heirId);
  if (!heir || !heir.alive || roleTeam(heir.roleId || "") !== "minion") {
    return {
      ok: false,
      errorCode: "error.33",
      error: "Наследником может стать только живой Приспешник.",
    };
  }
  becomeDemon(state, heir, "imp", currentAt(state));
  step.pending = null;
  checkWin(state);
  addLog(state, {
    secret: true,
    kind: "choice",
    title: HOST_CHOICE_REASONS["demon-heir"],
    detail: heir.name || "Игрок " + heir.seat,
    playerId: heir.id,
    case: "demon-heir",
  });
  return { ok: true, heir };
}

// Reasons an attack produces no death at all. Shared with the table so the
// host is never asked to resolve a redirection that cannot happen.
export function attackBlockReason(
  state: GameState,
  { attackerId, targetId, at }: { attackerId: string; targetId: string; at?: DeadAt },
): string | null {
  const attacker = playerById(state, attackerId);
  const target = playerById(state, targetId);
  if (!attacker || !target) return "Цель не найдена.";
  if (isImpaired(state, attackerId, at)) return "Демон отравлен или пьян: смерти нет.";
  if (!target.alive) return "Игрок уже мёртв: повторной смерти нет.";
  if (protectionFor(state, targetId, at)) return "Цель защищена Монахом.";
  if (soldierSafe(state, targetId, at)) return "Солдат не может умереть от Демона.";
  return null;
}

// Only a living, unimpaired Mayor who would actually die forces a host choice.
export function attackNeedsRedirect(
  state: GameState,
  {
    attackerId,
    targetId,
    at = currentAt(state),
  }: { attackerId: string; targetId: string; at?: DeadAt },
): boolean {
  if (!targetId) return false;
  if (attackBlockReason(state, { attackerId, targetId, at })) return false;
  return mayorRedirects(state, targetId, at);
}

export function resolveAttack(
  state: GameState,
  {
    attackerId,
    targetId,
    at,
    redirectId = null,
  }: { attackerId: string; targetId: string; at: DeadAt; redirectId?: string | null },
) {
  const blocked = attackBlockReason(state, { attackerId, targetId, at });
  if (blocked) return { noDeath: true, reason: blocked };

  let victimId = targetId;
  let redirected = false;
  if (mayorRedirects(state, targetId, at)) {
    if (!redirectId) {
      return {
        needsRedirect: true,
        options: orderedPlayers(state)
          .filter((player) => player.id !== targetId)
          .map((player) => ({ id: player.id, name: player.name, alive: player.alive })),
      };
    }
    if (redirectId !== "none") {
      const victim = playerById(state, redirectId);
      if (!victim || victim.id === targetId) {
        return { noDeath: true, reason: "Перенаправление отменено." };
      }
      // The Storyteller may pick a dead player, a healthy Soldier, or a
      // Monk-protected player. The attack then kills nobody and the Mayor
      // stays alive (official Mayor examples).
      if (!victim.alive) {
        return {
          noDeath: true,
          reason: "Перенаправленная цель уже мертва: дополнительной смерти нет.",
        };
      }
      if (protectionFor(state, victim.id, at) || soldierSafe(state, victim.id, at)) {
        return { noDeath: true, reason: "Перенаправленная смерть предотвращена защитой." };
      }
      victimId = victim.id;
      redirected = true;
    }
  }

  const victim = playerById(state, victimId) as Player;
  const wasDemon = roleTeam(victim.roleId || "") === "demon";
  const livingBefore = livingPlayers(state).length;
  const selfKill = victimId === attackerId;
  const death = kill(state, victimId, selfKill ? "imp-self-kill" : "demon", at);

  let inheritance = null;
  if (wasDemon && death) {
    inheritance = resolveDemonDeath(state, {
      cause: death.cause,
      livingBefore,
      at,
    });
  }

  return {
    noDeath: false,
    deathId: victimId,
    redirected,
    wasDemon,
    inheritance,
    pendingInheritance:
      inheritance && inheritance.pendingInheritance ? inheritance.pendingInheritance : null,
  };
}

// The Evil Twin pair is the two players stored at the deal, regardless of which
// character each holds: swapping the two twins keeps the pair. The ability
// holder is the player currently holding the `eviltwin` character (it may be
// either pair member), and it must be alive and unimpaired. The execution is
// resolved before its death: the holder may be the player being executed (the
// two twins swapped characters). A pair without such a holder has no ability.
// Legacy saves store only the roles, so resolve the pair by role as a fallback.
export function evilTwinPair(
  state: GameState,
  { executingId = null }: { executingId?: string | null } = {},
): { good: Player; evil: Player } | null {
  const good =
    typeof state.setup.evilTwinGoodPlayerId === "string"
      ? playerById(state, state.setup.evilTwinGoodPlayerId)
      : state.setup.evilTwinGoodId
        ? orderedPlayers(state).find((player) => player.roleId === state.setup.evilTwinGoodId) ||
          null
        : null;
  const evil =
    typeof state.setup.evilTwinPlayerId === "string"
      ? playerById(state, state.setup.evilTwinPlayerId)
      : orderedPlayers(state).find((player) => player.roleId === "eviltwin") || null;
  if (!good || !evil || good.id === evil.id) return null;
  const holder = orderedPlayers(state).find((player) => player.roleId === "eviltwin") || null;
  // A Minion killed by the Vigormortis keeps its ability, including the Evil
  // Twin's execution win (r3015).
  if (
    !holder ||
    (!holder.alive && holder.id !== executingId && !minionRetainsAbility(state, holder.id))
  ) {
    return null;
  }
  if (holder.id !== good.id && holder.id !== evil.id) return null;
  if (isImpaired(state, holder.id, currentAt(state))) return null;
  return { good, evil };
}

export function checkWin(
  state: GameState,
  { endOfDay = false }: { endOfDay?: boolean } = {},
): Winner | null {
  if (state.winner) return state.winner;
  // Manual-only games never claim an automatic rule outcome. The host declares
  // the winner after resolving the roles at the table.
  if (isManualScript(state.script)) return null;
  if (demonChangePending(state)) return null;
  if (isBmrScript(state.script) && state.mastermind && state.mastermind.active) return null;
  if (isSnvScript(state.script)) {
    // "If the good player is executed, evil wins." Alignment decides: the good
    // twin is the stored pair member, even after a character change. The pair is
    // null while the Evil Twin character has no living, unimpaired holder inside
    // the pair; the execution resolves before its own death.
    const twins = evilTwinPair(state, {
      executingId: state.day && state.day.execution ? state.day.execution.playerId : null,
    });
    if (
      state.day &&
      state.day.execution &&
      twins &&
      realTeamOf(twins.good) === "good" &&
      state.day.execution.playerId === twins.good.id
    ) {
      return setWinner(state, "evil", "evil-twin");
    }
    if (endOfDay && state.day && !state.day.execution) {
      const living = livingPlayers(state);
      if (
        living.some(
          (player) => player.roleId === "vortox" && !isImpaired(state, player.id, dayAt(state)),
        )
      ) {
        return setWinner(state, "evil", "vortox");
      }
    }
  }
  if (isBmrScript(state.script) && state.day && state.day.execution) {
    const execution = state.day.execution;
    const death = execution.deathId
      ? state.deaths.find((candidate) => candidate.id === execution.deathId)
      : null;
    if (death && !death.fake && roleTeam(death.roleId || "") === "demon") {
      const mastermind = livingPlayers(state).find(
        (player) => player.roleId === "mastermind" && !isImpaired(state, player.id, dayAt(state)),
      );
      if (mastermind) {
        state.mastermind = {
          active: true,
          extraDay: false,
          triggerDay: state.day.number,
          playerId: mastermind.id,
        };
        addLog(state, {
          secret: true,
          kind: "phase",
          title: "Кукловод продлевает игру",
          detail: "Демон казнён, но игра продолжается ещё один день.",
        });
        return null;
      }
    }
  }

  const saintDeath = state.deaths.find(
    (death) => death.cause === "execution" && !death.impaired && death.roleId === "saint",
  );
  if (saintDeath) return setWinner(state, "evil", "saint");

  const living = livingPlayers(state);
  if (endOfDay && state.day && !state.day.execution && living.length === 3) {
    const mayor = living.find((player) => mayorRedirects(state, player.id, dayAt(state)));
    if (mayor) return setWinner(state, "good", "mayor");
  }

  const demon = living.find((player) => roleTeam(player.roleId || "") === "demon");
  if (!demon) {
    const twins = isSnvScript(state.script) ? evilTwinPair(state) : null;
    if (twins && twins.evil.alive && twins.good.alive) return null;
    return setWinner(state, "good", "demon-dead");
  }
  if (living.length <= 2) return setWinner(state, "evil", "two-alive");
  return null;
}

export function setWinner(state: GameState, team: Alignment, reason: string): Winner {
  state.winner = {
    team,
    reason,
    title: team === "good" ? "Победа добра" : "Победа зла",
    detail: (DEMON_REASONS as Record<string, string>)[reason] || "",
    at: nowIso(),
  };
  state.phase = "over";
  state.reviewOpen = false;
  addLog(state, {
    kind: "winner",
    title: state.winner.title || "",
    detail: state.winner.detail || "",
  });
  return state.winner;
}

// ---------------------------------------------------------------------------
// Night end and day
