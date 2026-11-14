// The public seat view: a name and a seat number, nothing else. The seat route
// is readable by anyone at the table, so it renders this projection instead of
// the saved players. `SPEC.md` `/seat` says "names only".

export interface PublicSeat {
  id: string;
  seat: number;
  name: string;
}

export interface SeatSourcePlayers {
  [id: string]: { name?: string } | undefined;
}

export function publicSeats(order: readonly string[], players: SeatSourcePlayers): PublicSeat[] {
  const seats: PublicSeat[] = [];
  for (const id of order) {
    if (!players[id]) continue;
    seats.push({ id, seat: seats.length + 1, name: players[id]?.name ?? "" });
  }
  return seats;
}
