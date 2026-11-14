import type { GameState, InfoPair, NightStep, Player, RoleId } from "../model/types.ts";

type Registrations = Record<string, string>;
type InfoOptions = { targetIds?: string[]; registrations?: Registrations };
/** What a night step hands the Storyteller: computed, chosen or missing. */
export type InfoResult = {
  kind: string;
  value?: unknown;
  roleId?: RoleId | null;
  pair?: string[];
  matchIndex?: number;
  impaired?: boolean;
  needsChoice?: boolean;
  options?: unknown[];
  text?: string;
  missing?: boolean;
  zero?: boolean;
  bluffs?: string[];
  demonId?: string | null;
  lunaticId?: string | null;
  playerId?: string | null;
};

// Trouble Brewing domain: information. No DOM or persistence.
import { ALL_ROLES, roleTeam } from "../model/rules.ts";
import { orderedPlayers, playerById, realTeamOf } from "../model/state.ts";

import { nightAt, aliveNeighbors } from "./context.ts";
import { isImpaired } from "./effects.ts";
import { executionDeathForDay } from "./night.ts";
import { bmrInfoForStep } from "./bmr.ts";
import { svInfoForStep } from "./sv.ts";

// Registration is an ability (Spy r3118, Recluse r3007): a drunk or poisoned
// registrant has no ability, so the override never reaches an information path.
function registrationApplies(state: GameState, player: Player | null): boolean {
  return player ? !isImpaired(state, player.id) : false;
}

export function alignmentOf(
  state: GameState,
  player: Player | null,
  registrations: Registrations = {},
): "good" | "evil" | null {
  if (!player) return null;
  const override = registrationApplies(state, player) ? registrations[player.id] : undefined;
  if (override === "good" || override === "evil") return override;
  return realTeamOf(player) === "evil" ? "evil" : "good";
}

export function registersAsDemon(
  state: GameState,
  player: Player | null,
  registrations: Registrations = {},
): boolean {
  if (!player) return false;
  if (roleTeam(player.roleId || "") === "demon") return true;
  if (player.roleId === "recluse") {
    return registrationApplies(state, player) && registrations[player.id] === "demon";
  }
  return false;
}

export function registersAsTownsfolk(
  state: GameState,
  player: Player | null,
  registrations: Registrations = {},
): boolean {
  if (!player) return false;
  if (roleTeam(player.roleId || "") === "townsfolk") return true;
  return (
    player.roleId === "spy" &&
    registrationApplies(state, player) &&
    registrations[player.id] === "townsfolk"
  );
}

export function registersAsMinion(
  state: GameState,
  player: Player | null,
  registrations: Registrations = {},
): boolean {
  if (!player) return false;
  if (roleTeam(player.roleId || "") === "minion") return true;
  return (
    player.roleId === "recluse" &&
    registrationApplies(state, player) &&
    registrations[player.id] === "minion"
  );
}

export function registersAsOutsider(
  state: GameState,
  player: Player | null,
  registrations: Registrations = {},
): boolean {
  if (!player) return false;
  if (roleTeam(player.roleId || "") === "outsider") return true;
  return (
    player.roleId === "spy" &&
    registrationApplies(state, player) &&
    registrations[player.id] === "outsider"
  );
}

export function chefCount(state: GameState, registrations: Registrations = {}): number {
  const ids = state.order;
  let pairs = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const a = playerById(state, ids[i]!);
    const b = playerById(state, ids[(i + 1) % ids.length]!);
    if (
      alignmentOf(state, a, registrations) === "evil" &&
      alignmentOf(state, b, registrations) === "evil"
    )
      pairs += 1;
  }
  return pairs;
}

export function empathCount(
  state: GameState,
  playerId: string,
  registrations: Registrations = {},
): number {
  return aliveNeighbors(state, playerId)
    .map((id) => playerById(state, id))
    .filter((player) => alignmentOf(state, player, registrations) === "evil").length;
}

export function fortuneTellerYes(
  state: GameState,
  targetIds: string[] | undefined,
  registrations: Registrations = {},
): boolean {
  const herringId = state.setup && state.setup.herringId ? state.setup.herringId : state.herringId;
  return (targetIds || []).some((id) => {
    const player = playerById(state, id);
    if (!player) return false;
    if (id === herringId) return true;
    return registersAsDemon(state, player, registrations);
  });
}

export function characterChoices(
  state: GameState,
  targetId: string,
  actorImpaired: boolean = false,
): RoleId[] {
  if (actorImpaired) return ALL_ROLES.slice();
  const player = playerById(state, targetId);
  if (!player) return [];
  // A drunk or poisoned Spy or Recluse has no registration to show.
  if (isImpaired(state, targetId)) return [player.roleId as RoleId];
  if (player.roleId === "recluse") {
    return [player.roleId].concat(
      ALL_ROLES.filter((id) => roleTeam(id) === "minion" || roleTeam(id) === "demon"),
    );
  }
  if (player.roleId === "spy") {
    return [player.roleId].concat(
      ALL_ROLES.filter((id) => roleTeam(id) === "townsfolk" || roleTeam(id) === "outsider"),
    );
  }
  return [player.roleId as RoleId];
}

// ---------------------------------------------------------------------------
// Night queue

export function infoForStep(
  state: GameState,
  step: NightStep,
  options: InfoOptions = {},
): InfoResult {
  if (step.bmr) return bmrInfoForStep(state, step, options);
  if (step.sv) return svInfoForStep(state, step, options);
  const actor = step.actorId ? playerById(state, step.actorId) : null;
  const at = nightAt(state);
  const impaired = actor ? isImpaired(state, actor.id, at) : false;
  const registrations = options.registrations || step.registrations || {};
  const role = step.roleId;

  if (step.kind === "system") {
    if (step.system === "demoninfo") {
      return {
        kind: "demon-info",
        bluffs: step.bluffs || [],
        lunaticId: (step.lunaticId as string | null | undefined) ?? null,
      };
    }
    if (step.system === "minioninfo") {
      return { kind: "minion-info", demonId: step.demonId ?? null };
    }
    return { kind: "note", text: step.note || "" };
  }

  if (role === "washerwoman" || role === "librarian" || role === "investigator") {
    const setup = state.setup.info[role];
    if (!setup) {
      if (actor && actor.roleId === "drunk") {
        const team =
          role === "washerwoman" ? "townsfolk" : role === "librarian" ? "outsider" : "minion";
        const options = ALL_ROLES.filter((id) => roleTeam(id) === team);
        const others = orderedPlayers(state)
          .filter((player) => player.id !== actor.id)
          .map((player) => player.id);
        return {
          kind: "one-of-two",
          missing: false,
          roleId: options[0] || null,
          pair: others.slice(0, 2),
          matchIndex: 0,
          impaired: true,
          needsChoice: true,
          options,
          text: "Пьяница: предложена ложная информация.",
        };
      }
      return { kind: "one-of-two", missing: true, needsChoice: true };
    }
    if ("zero" in setup && setup.zero) {
      if (impaired) {
        const options = ALL_ROLES.filter((id) => roleTeam(id) === "outsider");
        const others = orderedPlayers(state)
          .filter((player) => !actor || player.id !== actor.id)
          .map((player) => player.id);
        return {
          kind: "one-of-two",
          roleId: options[0] || null,
          pair: others.slice(0, 2),
          matchIndex: 0,
          impaired,
          needsChoice: true,
          options,
          text: "Игрок отравлен или пьян: предложена ложная информация.",
        };
      }
      return { kind: "one-of-two", zero: true, text: "В игре нет Изгоев." };
    }
    const pairInfo = setup as InfoPair;
    if (!pairInfo.roleId || !Array.isArray(pairInfo.pair) || pairInfo.pair.length !== 2) {
      return { kind: "one-of-two", missing: true, needsChoice: true };
    }
    return {
      kind: "one-of-two",
      roleId: pairInfo.roleId,
      pair: pairInfo.pair.slice(),
      matchIndex: pairInfo.matchIndex || 0,
      impaired,
      needsChoice: impaired,
      options: impaired
        ? ALL_ROLES.filter(
            (id) =>
              roleTeam(id) ===
              (role === "washerwoman" ? "townsfolk" : role === "librarian" ? "outsider" : "minion"),
          )
        : [],
    };
  }

  if (role === "chef") {
    const value = chefCount(state, registrations);
    return {
      kind: "number",
      value,
      impaired,
      needsChoice: impaired,
      options: impaired ? uniqueNumbers(0, orderedPlayers(state).length) : [],
    };
  }

  if (role === "empath") {
    const value = empathCount(state, actor ? actor.id : "", registrations);
    return {
      kind: "number",
      value,
      impaired,
      needsChoice: impaired,
      options: impaired ? uniqueNumbers(0, 2) : [],
    };
  }

  if (role === "fortuneteller") {
    const value = fortuneTellerYes(state, options.targetIds || step.targetIds, registrations);
    return {
      kind: "yes-no",
      value,
      impaired,
      needsChoice: impaired,
      options: impaired ? [true, false] : [],
    };
  }

  if (role === "undertaker") {
    const death = executionDeathForDay(state, nightAt(state).number - 1);
    if (!death) return { kind: "none", text: "Сегодня казни со смертью не было." };
    const choices = characterChoices(state, death.playerId, impaired);
    return {
      kind: "character",
      roleId: death.roleId,
      playerId: death.playerId,
      impaired,
      needsChoice: impaired || choices.length > 1,
      options: choices,
    };
  }

  if (role === "spy") {
    return { kind: "grimoire" };
  }

  if (role === "ravenkeeper") {
    const targetId = (options.targetIds || step.targetIds || [])[0];
    const target = targetId ? playerById(state, targetId) : null;
    if (!target)
      return { kind: "character", roleId: null, needsChoice: true, options: ALL_ROLES.slice() };
    const choices = characterChoices(state, target.id, impaired);
    return {
      kind: "character",
      roleId: target.roleId,
      playerId: target.id,
      impaired,
      needsChoice: impaired || choices.length > 1,
      options: choices,
    };
  }

  return { kind: "none" };
}

export function uniqueNumbers(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i += 1) out.push(i);
  return out;
}

// ---------------------------------------------------------------------------
// Death, inheritance and win
