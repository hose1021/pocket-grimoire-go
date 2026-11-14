// Each sheet scenario shows the Travellers printed for its own edition, and
// the all-roles sheet shows all of them. The previous sheet always showed the
// five Trouble Brewing Travellers.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ALL_TRAVELLER_IDS, SCENARIO_TRAVELLERS } from "./sheet-scenarios.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const official = JSON.parse(readFileSync(ROOT + "docs/official/roles.json", "utf8")) as Array<{
  id: string;
  team: string;
  edition: string;
}>;

const travellersOf = (edition: string) =>
  official
    .filter((role) => role.team === "traveller" && role.edition === edition)
    .map((role) => role.id)
    .sort();

test("every scenario lists exactly its own edition's Travellers", () => {
  for (const edition of ["tb", "bmr", "snv"] as const) {
    assert.deepEqual([...SCENARIO_TRAVELLERS[edition]].sort(), travellersOf(edition), edition);
  }
});

test("the all-roles sheet lists every Traveller once", () => {
  const expected = travellersOf("tb").concat(travellersOf("bmr"), travellersOf("snv")).sort();
  assert.deepEqual([...ALL_TRAVELLER_IDS].sort(), expected);
  assert.equal(new Set(ALL_TRAVELLER_IDS).size, ALL_TRAVELLER_IDS.length);
  assert.deepEqual([...SCENARIO_TRAVELLERS.all].sort(), expected);
});

test("a scenario never mixes another edition's Travellers in", () => {
  assert.equal(SCENARIO_TRAVELLERS.bmr.includes("scapegoat"), false);
  assert.equal(SCENARIO_TRAVELLERS.snv.includes("apprentice"), false);
  assert.equal(SCENARIO_TRAVELLERS.tb.includes("voudon"), false);
});
