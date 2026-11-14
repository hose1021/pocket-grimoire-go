import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ROLES, BMR_ALL, SNV_ALL, bagErrors } from "./rules.ts";
import type { SetupProblem } from "./rules.ts";

// The bag validator's problems are localized by `error.<code>`, so every
// parameterised problem carries the values the catalog interpolates. Roles
// stay role ids: the screen maps them through the catalog and never falls back
// to the Russian message. Sources: openspec/specs/game/setup/spec.md, issue
// #171.

function problem(problems: SetupProblem[], code: string): SetupProblem {
  const found = problems.find((entry) => entry.code === code);
  assert.ok(found, `${code} missing from ${JSON.stringify(problems.map((entry) => entry.code))}`);
  return found;
}

test("bag problems carry the values the localized reason interpolates", () => {
  const size = problem(
    bagErrors({ count: 7, roles: ["chef"], bluffs: [], pool: ALL_ROLES }),
    "size",
  );
  assert.deepEqual(size.vars, { count: 1, required: 7 });

  const outside = problem(
    bagErrors({
      count: 5,
      roles: ["chef", "empath", "monk", "poisoner", "imp"],
      bluffs: [],
      pool: ["chef", "empath", "imp", "poisoner", "soldier"],
    }),
    "outside-script",
  );
  assert.deepEqual(outside.vars, { role: "monk" });

  const unknown = problem(
    bagErrors({ count: 5, roles: ["chef", "empath", "monk", "poisoner", "vanggu"], bluffs: [] }),
    "unknown",
  );
  assert.deepEqual(unknown.vars, { role: "vanggu" });

  const team = problem(
    bagErrors({
      count: 7,
      roles: ["chef", "empath", "monk", "soldier", "poisoner", "imp"],
      bluffs: [],
      pool: ALL_ROLES,
    }),
    "team-townsfolk",
  );
  assert.deepEqual(team.vars, { team: "townsfolk", count: 4, required: 5 });

  const bluffs = problem(
    bagErrors({
      count: 7,
      roles: ["chef", "empath", "monk", "soldier", "undertaker", "poisoner", "imp"],
      bluffs: [],
      pool: ALL_ROLES,
    }),
    "bluffs-count",
  );
  assert.deepEqual(bluffs.vars, { needed: 3, count: 0 });

  const inPlay = problem(
    bagErrors({
      count: 7,
      roles: ["chef", "empath", "monk", "soldier", "undertaker", "poisoner", "imp"],
      bluffs: ["chef", "mayor", "virgin"],
      pool: ALL_ROLES,
    }),
    "bluffs-inplay",
  );
  assert.deepEqual(inPlay.vars, { role: "chef" });
});

test("modifier and mask problems name the count and the shown role", () => {
  const godfather = problem(
    bagErrors({
      count: 7,
      roles: [
        "godfather",
        "chambermaid",
        "courtier",
        "exorcist",
        "clockmaker",
        "dreamer",
        "sailor",
      ],
      bluffs: ["gossip", "gambler", "grandmother"],
      pool: BMR_ALL,
      godfatherOutsider: -1,
    }),
    "godfather-minus",
  );
  assert.deepEqual(godfather.vars, { count: 7 });

  const impossible = problem(
    bagErrors({
      count: 5,
      roles: ["baron", "godfather", "fanggu", "chambermaid", "courtier"],
      bluffs: [],
      pool: [...ALL_ROLES, ...BMR_ALL, ...SNV_ALL],
    }),
    "composition-impossible",
  );
  assert.deepEqual(impossible.vars, { count: 5 });

  const drunk = problem(
    bagErrors({
      count: 6,
      roles: ["drunk", "chef", "empath", "monk", "poisoner", "imp"],
      bluffs: [],
      pool: ALL_ROLES,
      drunkShownId: "butler",
    }),
    "drunk-team",
  );
  assert.deepEqual(drunk.vars, { shown: "butler" });

  const lunatic = problem(
    bagErrors({
      count: 7,
      roles: ["lunatic", "chambermaid", "courtier", "exorcist", "clockmaker", "dreamer", "sailor"],
      bluffs: ["gossip", "gambler", "grandmother"],
      pool: BMR_ALL,
      lunaticShownId: "chambermaid",
    }),
    "lunatic-team",
  );
  assert.deepEqual(lunatic.vars, { shown: "chambermaid" });
});
