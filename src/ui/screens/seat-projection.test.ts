// The seat route is readable by everyone at the table: names and seat numbers
// only. A real role, the shown role, a team or a claimed flag must not appear.
import test from "node:test";
import assert from "node:assert/strict";

import { publicSeats } from "./seat-projection.ts";

const players = {
  "1": { name: "Ada", roleId: "imp", shownRoleId: "imp", team: "demon", alive: true },
  "2": { name: "Bo", roleId: "drunk", shownRoleId: "chef", team: "townsfolk", alive: false },
};

test("the seat projection carries a name and a seat number only", () => {
  const seats = publicSeats(["1", "2"], players);
  assert.deepEqual(seats, [
    { id: "1", seat: 1, name: "Ada" },
    { id: "2", seat: 2, name: "Bo" },
  ]);
  const text = JSON.stringify(seats);
  for (const secret of ["imp", "drunk", "chef", "demon", "townsfolk", "alive", "roleId"]) {
    assert.equal(text.includes(secret), false, `the projection leaks ${secret}`);
  }
});

test("the seat projection follows the given order and skips an unseated id", () => {
  const seats = publicSeats(["2", "missing", "1"], players);
  assert.deepEqual(
    seats.map((seat) => [seat.seat, seat.name]),
    [
      [1, "Bo"],
      [2, "Ada"],
    ],
  );
});

test("a player without a name still occupies a seat", () => {
  const seats = publicSeats(["1"], { "1": {} });
  assert.deepEqual(seats, [{ id: "1", seat: 1, name: "" }]);
});
