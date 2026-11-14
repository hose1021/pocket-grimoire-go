import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESET_POOLS,
  presetBag,
  customSuggestions,
  repairBag,
  resizeBag,
  deriveBagExtras,
} from "./presets.ts";
import {
  COMPOSITION,
  TEAMS,
  bagCounts,
  bagErrors,
  compositionFor,
  isMixedEdition,
  roleTeam,
} from "./rules.ts";

const COUNTS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

test("all 99 official presets pass bag validation", () => {
  let checked = 0;
  for (const scriptId of ["tb", "bmr", "snv"]) {
    for (const count of COUNTS) {
      for (let variant = 0; variant < 3; variant += 1) {
        const bag = presetBag(scriptId, count, variant);
        assert.ok(bag, `${scriptId} ${count} variant ${variant} is missing`);
        assert.deepEqual(
          bag.errors,
          [],
          `${scriptId} ${count} variant ${variant}: ${bag.errors.map((error) => error.message).join(", ")}`,
        );
        assert.equal(bag.valid, true);
        checked += 1;
      }
    }
  }
  assert.equal(checked, 99);
});

test("every official preset has the exact count, pool membership and team composition", () => {
  for (const scriptId of ["tb", "bmr", "snv"]) {
    const pool = new Set(PRESET_POOLS[scriptId]);
    for (const count of COUNTS) {
      const seen = new Set();
      for (let variant = 0; variant < 3; variant += 1) {
        const bag = presetBag(scriptId, count, variant);
        assert.ok(bag, `${scriptId} ${count} variant ${variant} is missing`);
        assert.equal(bag.roles.length, count);
        assert.equal(
          new Set(bag.roles).size,
          count,
          `${scriptId} ${count}/${variant} repeats a role`,
        );
        for (const id of bag.roles) assert.ok(pool.has(id), `${id} is outside ${scriptId}`);
        assert.deepEqual(
          bagCounts(bag.roles),
          compositionFor(count, bag.roles),
          `${scriptId} ${count}/${variant}`,
        );
        assert.equal(bag.bluffs.length, count >= 7 ? 3 : 0);
        for (const bluff of bag.bluffs) {
          assert.ok(pool.has(bluff));
          assert.ok(!bag.roles.includes(bluff));
        }
        assert.notEqual(
          seen.has(bag.roles.slice().sort().join(",")),
          true,
          `${scriptId} ${count} variants must differ`,
        );
        seen.add(bag.roles.slice().sort().join(","));
      }
    }
  }
});

test("official presets derive the Drunk, Lunatic and Evil Twin secrets", () => {
  const drunkBag = presetBag("tb", 12, 2);
  assert.ok(drunkBag);
  assert.ok(drunkBag.roles.includes("drunk"));
  assert.ok(drunkBag.drunkShownId);
  assert.ok(!drunkBag.roles.includes(drunkBag.drunkShownId!));
  assert.equal(roleTeam(drunkBag.drunkShownId!), "townsfolk");

  const lunaticBag = presetBag("bmr", 8, 2);
  assert.ok(lunaticBag);
  assert.ok(lunaticBag.roles.includes("lunatic"));
  assert.equal(roleTeam(lunaticBag.lunaticShownId!), "demon");

  const twinBag = presetBag("snv", 7, 2);
  assert.ok(twinBag);
  assert.ok(twinBag.roles.includes("eviltwin"));
  assert.ok(twinBag.evilTwinGoodId);
  assert.ok(twinBag.roles.includes(twinBag.evilTwinGoodId!));
  assert.equal(roleTeam(twinBag.evilTwinGoodId!), "townsfolk");
});

test("custom suggestions produce three distinct legal bags at every count for every edition pool", () => {
  for (const scriptId of ["tb", "bmr", "snv"]) {
    const pool = PRESET_POOLS[scriptId];
    for (const count of COUNTS) {
      const { suggestions, problems } = customSuggestions(count, pool);
      assert.deepEqual(problems, [], `${scriptId} ${count}: ${JSON.stringify(problems)}`);
      assert.equal(suggestions.length, 3, `${scriptId} ${count}`);
      const seen = new Set();
      for (const bag of suggestions) {
        assert.equal(bag.roles.length, count);
        assert.equal(new Set(bag.roles).size, count);
        assert.deepEqual(bagCounts(bag.roles), compositionFor(count, bag.roles));
        assert.deepEqual(
          bagErrors({
            count,
            roles: bag.roles,
            bluffs: bag.bluffs,
            drunkShownId: bag.drunkShownId,
            lunaticShownId: bag.lunaticShownId,
            pool,
          }),
          [],
        );
        seen.add(bag.roles.slice().sort().join(","));
      }
      assert.equal(seen.size, 3, `${scriptId} ${count} bags must differ`);
    }
  }
});

test("custom suggestions are deterministic", () => {
  const pool = PRESET_POOLS.tb;
  const first = customSuggestions(9, pool);
  const second = customSuggestions(9, pool);
  assert.deepEqual(
    first.suggestions.map((bag) => bag.roles),
    second.suggestions.map((bag) => bag.roles),
  );
});

test("a pool that cannot fill three distinct bags explains the shortfall", () => {
  const tiny = ["chef", "empath", "monk", "poisoner", "imp"];
  const five = customSuggestions(5, tiny);
  assert.equal(five.suggestions.length, 1);
  assert.ok(
    five.problems.every((problem) => typeof problem !== "string" && problem.code === "duplicate"),
  );

  const six = customSuggestions(6, tiny);
  assert.equal(six.suggestions.length, 0);
  assert.ok(
    six.problems.every((problem) => typeof problem !== "string" && problem.code === "no-outsiders"),
  );
});

test("a mixed-edition pool never generates a dealable suggestion", () => {
  const mixed = ["chef", "empath", "monk", "poisoner", "imp", "chambermaid"];
  assert.equal(isMixedEdition(mixed), true);
  const result = customSuggestions(5, mixed);
  assert.equal(result.suggestions.length, 0);
  assert.deepEqual(result.problems, ["mixed-edition"]);
});

test("repair keeps chosen roles and fills the missing teams", () => {
  const repaired = repairBag({ count: 7, roles: ["chef", "empath"], pool: PRESET_POOLS.tb });
  assert.ok(repaired);
  assert.equal(repaired.roles.length, 7);
  assert.ok(repaired.roles.includes("chef"));
  assert.ok(repaired.roles.includes("empath"));
  assert.deepEqual(repaired.errors, []);
  assert.equal(repairBag({ count: 6, roles: ["chef"], pool: ["chef", "empath"] }), null);
});

test("count changes preserve manual choices and only trim what no longer fits", () => {
  const kept = ["chef", "empath", "fortuneteller", "undertaker", "washerwoman", "poisoner", "imp"];
  const shrunk = resizeBag({ count: 5, roles: kept, pool: PRESET_POOLS.tb });
  assert.equal(shrunk.length, 5);
  assert.ok(shrunk.includes("chef"));
  assert.ok(shrunk.includes("poisoner"));
  assert.ok(shrunk.includes("imp"));

  const grown = resizeBag({
    count: 9,
    roles: ["chef", "empath", "poisoner", "imp"],
    pool: PRESET_POOLS.tb,
  });
  assert.deepEqual(grown, ["chef", "empath", "poisoner", "imp"], "growing never invents choices");
});

test("derived extras use only unused good roles for bluffs", () => {
  const roles = ["chef", "empath", "monk", "poisoner", "imp"];
  const extras = deriveBagExtras(7, roles, PRESET_POOLS.tb);
  assert.equal(extras.bluffs.length, 3);
  assert.ok(extras.bluffs.every((id) => !roles.includes(id)));
  assert.equal(extras.drunkShownId, null);
});

test("official presets do not change the count table", () => {
  for (const count of COUNTS) {
    const [townsfolk, outsider, minion, demon] = COMPOSITION[count];
    assert.equal(townsfolk + outsider + minion + demon, count);
    assert.equal(demon, 1);
    for (const team of TEAMS) assert.ok(Number.isInteger(COMPOSITION[count][TEAMS.indexOf(team)]));
  }
});
