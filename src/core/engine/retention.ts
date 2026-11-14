import type { GameState } from "../model/types.ts";

// Vigormortis r3015: "Minions you kill keep their ability". The predicate is
// shared by the step builders, the dead-actor guards and the Evil Twin pair so
// they cannot disagree about whether a dead Minion still acts.
import { roleTeam } from "../model/rules.ts";
import { orderedPlayers, playerById } from "../model/state.ts";

import { currentAt } from "./context.ts";
import { isImpaired } from "./effects.ts";

export function vigormortisActive(state: GameState): boolean {
  return orderedPlayers(state).some(
    (player) =>
      player.roleId === "vigormortis" &&
      player.alive &&
      !isImpaired(state, player.id, currentAt(state)),
  );
}

export function minionRetainsAbility(state: GameState, playerId: string): boolean {
  const player = playerById(state, playerId);
  if (!player || player.alive) return false;
  if (roleTeam(player.roleId || "") !== "minion") return false;
  // The dead Minion keeps the ability only while it is sober and healthy: a
  // drunk or poisoned Minion loses the retained ability until it recovers.
  if (isImpaired(state, playerId, currentAt(state))) return false;
  const killedByVigormortis = state.deaths.some(
    (death) =>
      !death.fake &&
      death.playerId === playerId &&
      death.demon === true &&
      death.ability === "vigormortis",
  );
  return killedByVigormortis && vigormortisActive(state);
}
