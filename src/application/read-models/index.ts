// Read models exposed to the UI. They are pure functions of the saved state:
// the public model carries no role, bluff, note or effect, and the player model
// carries only the shown role of one seat.
import type { GameState } from "../../core/model/types.ts";

export interface PublicSnapshot {
  phase: string;
  day: number;
  night: number;
  living: number;
  total: number;
  deaths: string[];
  winner: { team: string; reason: string } | null;
}

export interface PlayerSnapshot {
  id: string;
  seat: number;
  name: string;
  claimed: boolean;
  hasRole: boolean;
  shownRoleId: string | null;
}

function seatName(state: GameState, id: string): string {
  const player = state.players[id];
  return player ? player.name : "—";
}

export function publicSnapshot(state: GameState): PublicSnapshot {
  const order = state.order || [];
  const living = order
    .map((id) => state.players[id])
    .filter((player) => player && player.alive && !player.registeredDead).length;
  const announced = (state.day && state.day.morning ? state.day.morning : []).map(
    (death) => death.playerId,
  );
  const registered = order.filter((id) => state.players[id] && state.players[id].registeredDead);
  const executed =
    state.day && state.day.execution && state.day.execution.deathId
      ? [state.day.execution.playerId]
      : [];
  const deaths = [...new Set([...announced, ...executed, ...registered])]
    .map((id) => seatName(state, id))
    .filter((name) => name.length > 0);
  return {
    phase: state.phase,
    day: state.day ? state.day.number : 0,
    night: state.night ? state.night.number : 0,
    living,
    total: order.length,
    deaths,
    winner: state.winner ? { team: state.winner.team, reason: state.winner.reason } : null,
  };
}

/** @param seat 0-based position in `state.order`. */
export function playerSnapshot(state: GameState, seat: number): PlayerSnapshot | null {
  const id = (state.order || [])[seat];
  if (!id) return null;
  const player = state.players[id];
  if (!player) return null;
  return {
    id,
    seat: seat + 1,
    name: player.name,
    claimed: Boolean(player.claimed),
    hasRole: Boolean(player.shownRoleId),
    shownRoleId: player.shownRoleId || null,
  };
}
