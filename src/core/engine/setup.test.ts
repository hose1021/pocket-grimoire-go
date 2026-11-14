import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_ROLES,
  BMR_ALL,
  COMPOSITION,
  ROLE_REMINDERS_RU,
  SNV_ALL,
  SUPPORTED_ROLES,
  bagErrors,
  compositionFor,
  isGoodRole,
  randomBag,
  requiredBluffs,
  roleTeam,
} from "../model/rules.ts";
import { presetBag } from "../model/presets.ts";
import { createGame, publicGameView, validateState } from "../model/state.ts";
import { dealGame, secretsErrors, setupErrors } from "./index.ts";
import { parseScript } from "../model/scripts.ts";
import type { RandomBag } from "../model/rules.ts";
import type { Role, RoleId, ScriptEdition } from "../model/types.ts";

// Setup table: every supported player count, every scenario modifier, the
// Drunk and Lunatic masks, and the script limits. The sources are the pinned
// wiki revisions named in openspec/specs/game/setup/spec.md.

const COUNTS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const POOLS: Record<string, string[]> = { tb: ALL_ROLES, bmr: BMR_ALL, snv: SNV_ALL };
const CATALOG: Role[] = [...new Set([...ALL_ROLES, ...BMR_ALL, ...SNV_ALL])].flatMap((id) => {
  const team = roleTeam(id);
  return team ? [{ id, name: id, team, edition: "tb" }] : [];
});

function preset(scriptId: string, count: number, variant = 0) {
  const bag = presetBag(scriptId, count, variant);
  assert.ok(bag, `${scriptId} ${count}/${variant} has no preset`);
  return bag;
}

function codes(errors: { code: string }[]) {
  return errors.map((error) => error.code);
}

function presetSetup(scriptId: string, count: number, variant = 0) {
  const bag = preset(scriptId, count, variant);
  const state = createGame(count);
  state.script = {
    id: scriptId,
    name: scriptId,
    edition: scriptId as ScriptEdition,
    source: "official",
    roles: POOLS[scriptId].slice(),
  };
  state.scriptId = scriptId;
  state.setup.count = count;
  state.setup.roles = bag.roles.slice();
  state.setup.bluffs = bag.bluffs.slice();
  state.setup.drunkShownId = bag.drunkShownId;
  state.setup.lunaticShownId = bag.lunaticShownId;
  state.setup.evilTwinGoodId = bag.evilTwinGoodId;
  const assignment: Record<string, string> = {};
  state.order.forEach((id, index) => {
    assignment[id] = bag.roles[index];
    state.players[id].name = "P" + id;
  });
  return { state, bag, assignment };
}

function dealPreset(scriptId: string, count: number, variant = 0) {
  const { state, bag, assignment } = presetSetup(scriptId, count, variant);
  assert.deepEqual(setupErrors(state), [], `${scriptId} ${count}/${variant}`);
  const result = dealGame(state, { assignment });
  assert.equal(result.ok, true, JSON.stringify(result));
  return { state, bag };
}

// A Trouble Brewing bag built from explicit roles, so a test can force the
// exact seats a Storyteller question needs.
function tbSetup(roles: RoleId[], masks: { drunkShownId?: RoleId } = {}) {
  const count = roles.length;
  const state = createGame(count);
  state.script = {
    id: "tb",
    name: "Trouble Brewing",
    edition: "tb",
    source: "official",
    roles: ALL_ROLES.slice(),
  };
  state.scriptId = "tb";
  state.setup.count = count;
  state.setup.roles = roles.slice();
  state.setup.drunkShownId = masks.drunkShownId ?? null;
  state.setup.bluffs = ALL_ROLES.filter(
    (id) => isGoodRole(id) && !roles.includes(id) && id !== masks.drunkShownId,
  ).slice(0, requiredBluffs(count));
  const assignment: Record<string, string> = {};
  state.order.forEach((id, index) => {
    assignment[id] = roles[index]!;
    state.players[id].name = "P" + id;
  });
  return { state, assignment };
}

function tbGame(roles: RoleId[], masks: { drunkShownId?: RoleId } = {}) {
  const { state, assignment } = tbSetup(roles, masks);
  assert.deepEqual(setupErrors(state), [], JSON.stringify(setupErrors(state)));
  const result = dealGame(state, { assignment });
  assert.equal(result.ok, true, JSON.stringify(result));
  return state;
}

test("every player count from 5 to 15 has a legal bag in every official scenario", () => {
  for (const scriptId of ["tb", "bmr", "snv"]) {
    for (const count of COUNTS) {
      for (let variant = 0; variant < 3; variant += 1) {
        const bag = preset(scriptId, count, variant);
        assert.deepEqual(bag.errors, [], `${scriptId} ${count}/${variant}`);
        assert.equal(bag.roles.length, count);
        assert.equal(new Set(bag.roles).size, count);
        assert.equal(bag.bluffs.length, requiredBluffs(count));
        const got = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
        for (const id of bag.roles) got[roleTeam(id)!] += 1;
        assert.deepEqual(got, compositionFor(count, bag.roles), `${scriptId} ${count}/${variant}`);
      }
    }
  }
});

test("the official composition table covers 5 to 15 players exactly", () => {
  for (const count of COUNTS) {
    const rows = COMPOSITION[count];
    assert.ok(rows, "missing composition row " + count);
    assert.equal(
      rows.reduce((sum, value) => sum + value, 0),
      count,
      "composition " + count,
    );
    assert.equal(rows[3], 1, "one Demon at " + count);
    assert.deepEqual(compositionFor(count), {
      townsfolk: rows[0],
      outsider: rows[1],
      minion: rows[2],
      demon: rows[3],
    });
  }
});

test("each setup modifier shifts the composition like its official source", () => {
  const cases = [
    {
      role: "baron",
      count: 5,
      expected: { townsfolk: 1, outsider: 2, minion: 1, demon: 1 },
    },
    {
      role: "godfather",
      count: 8,
      expected: { townsfolk: 4, outsider: 2, minion: 1, demon: 1 },
    },
    {
      role: "fanggu",
      count: 8,
      expected: { townsfolk: 4, outsider: 2, minion: 1, demon: 1 },
    },
    {
      role: "vigormortis",
      count: 8,
      expected: { townsfolk: 6, outsider: 0, minion: 1, demon: 1 },
    },
  ];
  for (const { role, count, expected } of cases) {
    assert.deepEqual(compositionFor(count, [role]), expected, role + " at " + count);
    const total = Object.values(expected).reduce((sum, value) => sum + value, 0);
    assert.equal(total, count, role + " keeps the player count");
  }
  assert.deepEqual(compositionFor(8, ["godfather"], -1), {
    townsfolk: 6,
    outsider: 0,
    minion: 1,
    demon: 1,
  });
});

test("an impossible modifier choice is rejected with its reason", () => {
  const bmr = preset("bmr", 7, 2);
  assert.ok(bmr.roles.includes("godfather"));
  assert.equal(COMPOSITION[7][1], 0);
  const godfather = bagErrors({
    count: 7,
    roles: bmr.roles,
    bluffs: bmr.bluffs,
    drunkShownId: bmr.drunkShownId,
    lunaticShownId: bmr.lunaticShownId,
    pool: BMR_ALL,
    godfatherOutsider: -1,
  });
  assert.ok(codes(godfather).includes("godfather-minus"), JSON.stringify(godfather));

  // The Vigormortis removes an Outsider only when the base composition has
  // one: at eight players it removes one, at seven it changes nothing.
  const vigormortis = bagErrors({
    count: 8,
    roles: [
      "vigormortis",
      "cerenovus",
      "artist",
      "clockmaker",
      "dreamer",
      "flowergirl",
      "sage",
      "juggler",
    ],
    bluffs: ["oracle", "philosopher", "seamstress"],
    pool: SNV_ALL,
  });
  assert.deepEqual(vigormortis, [], JSON.stringify(codes(vigormortis)));
});

test("illegal bags are rejected with a stable reason", () => {
  const tb7 = preset("tb", 7, 2);
  const tb8 = preset("tb", 8, 2);
  assert.ok(tb8.roles.includes("drunk"));
  const base = { count: 7, roles: tb7.roles, bluffs: tb7.bluffs, pool: ALL_ROLES };
  const check = (overrides: Partial<Parameters<typeof bagErrors>[0]>, code: string) => {
    const errors = bagErrors({ ...base, ...overrides });
    assert.ok(codes(errors).includes(code), `${code}: ${JSON.stringify(codes(errors))}`);
  };

  check({ count: 4 }, "count");
  check({ count: 16 }, "count");
  check({ roles: tb7.roles.slice(0, -1) }, "size");
  check({ roles: [tb7.roles[0], tb7.roles[0], ...tb7.roles.slice(2)] }, "duplicate");
  check({ roles: [...tb7.roles.slice(0, -1), "vanggu"] }, "unknown");
  check({ roles: [...tb7.roles.slice(0, -1), "godfather"] }, "outside-script");
  check(
    {
      count: 5,
      roles: ["chef", "empath", "monk", "poisoner", "imp"],
      bluffs: ["mayor"],
      pool: ALL_ROLES,
    },
    "bluffs-count",
  );
  check({ bluffs: ["mayor", "mayor", "virgin"] }, "bluffs-duplicate");
  check({ bluffs: ["imp", "mayor", "virgin"] }, "bluffs-team");
  check({ bluffs: [tb7.roles[0], "mayor", "virgin"] }, "bluffs-inplay");

  const drunkBase = {
    count: 8,
    roles: tb8.roles,
    bluffs: tb8.bluffs,
    pool: ALL_ROLES,
  };
  const drunkCheck = (overrides: Partial<Parameters<typeof bagErrors>[0]>, code: string) => {
    const errors = bagErrors({ ...drunkBase, ...overrides });
    assert.ok(codes(errors).includes(code), `${code}: ${JSON.stringify(codes(errors))}`);
  };
  drunkCheck({ drunkShownId: null }, "drunk-shown");
  drunkCheck({ drunkShownId: "butler" }, "drunk-team");
  drunkCheck({ drunkShownId: "chef" }, "drunk-inplay");
  drunkCheck(
    { drunkShownId: tb8.drunkShownId, bluffs: [tb8.drunkShownId!, "mayor", "virgin"] },
    "bluffs-drunk",
  );

  const bmr7 = preset("bmr", 7, 2);
  assert.ok(bmr7.roles.includes("lunatic"));
  const lunaticBase = {
    count: 7,
    roles: bmr7.roles,
    bluffs: bmr7.bluffs,
    drunkShownId: bmr7.drunkShownId,
    pool: BMR_ALL,
  };
  const lunaticCheck = (overrides: Partial<Parameters<typeof bagErrors>[0]>, code: string) => {
    const errors = bagErrors({ ...lunaticBase, ...overrides });
    assert.ok(codes(errors).includes(code), `${code}: ${JSON.stringify(codes(errors))}`);
  };
  lunaticCheck({ lunaticShownId: null }, "lunatic-shown");
  lunaticCheck({ lunaticShownId: "chambermaid" }, "lunatic-team");
  lunaticCheck(
    { lunaticShownId: "zombuul", pool: BMR_ALL.filter((id) => id !== "zombuul") },
    "lunatic-outside-script",
  );
  assert.ok(
    codes(
      bagErrors({
        count: 7,
        roles: tb7.roles,
        bluffs: tb7.bluffs,
        lunaticShownId: "imp",
        pool: ALL_ROLES,
      }),
    ).includes("lunatic-unused"),
  );
});

test("the Drunk and Lunatic masks never become bluffs or public information", () => {
  const tb = preset("tb", 8, 2);
  assert.equal(roleTeam(tb.drunkShownId!), "townsfolk");
  const drunkBluff = bagErrors({
    count: 8,
    roles: tb.roles,
    bluffs: [tb.drunkShownId!, ...tb.bluffs.slice(1)],
    drunkShownId: tb.drunkShownId,
    pool: ALL_ROLES,
  });
  assert.ok(codes(drunkBluff).includes("bluffs-drunk"));

  const bmr = preset("bmr", 7, 2);
  assert.equal(roleTeam(bmr.lunaticShownId!), "demon");
  const lunaticBluff = bagErrors({
    count: 7,
    roles: bmr.roles,
    bluffs: [bmr.lunaticShownId!, ...bmr.bluffs.slice(1)],
    lunaticShownId: bmr.lunaticShownId,
    pool: BMR_ALL,
  });
  assert.ok(codes(lunaticBluff).includes("bluffs-lunatic"), JSON.stringify(lunaticBluff));

  const drunkGame = dealPreset("tb", 8, 2);
  const drunk = drunkGame.state.order.find((id) => drunkGame.state.players[id].roleId === "drunk");
  assert.ok(drunk);
  assert.equal(drunkGame.state.players[drunk].shownRoleId, drunkGame.bag.drunkShownId);
  assert.notEqual(drunkGame.state.players[drunk].roleId, drunkGame.bag.drunkShownId);
  const drunkPublic = JSON.stringify(publicGameView(drunkGame.state));
  assert.equal(drunkPublic.includes("drunk"), false);
  assert.equal(drunkPublic.includes(drunkGame.bag.drunkShownId!), false);

  const lunaticGame = dealPreset("bmr", 7, 2);
  const lunatic = lunaticGame.state.order.find(
    (id) => lunaticGame.state.players[id].roleId === "lunatic",
  );
  assert.ok(lunatic);
  assert.equal(lunaticGame.state.players[lunatic].shownRoleId, lunaticGame.bag.lunaticShownId);
  const lunaticPublic = JSON.stringify(publicGameView(lunaticGame.state));
  assert.equal(lunaticPublic.includes("lunatic"), false);
  assert.equal(lunaticPublic.includes(lunaticGame.bag.lunaticShownId!), false);
  assert.equal(lunaticPublic.includes('"bluffs"'), false);
});

test("script limits reject mixed editions, unknown roles and short rosters", () => {
  const mixed = parseScript(
    JSON.stringify(["chef", "empath", "imp", "poisoner", "godfather"]),
    CATALOG,
  );
  assert.equal(mixed.ok, false);
  assert.match(mixed.error, /Смешивать/);

  const unknown = parseScript(
    JSON.stringify(["chef", "empath", "imp", "poisoner", "vanggu"]),
    CATALOG,
  );
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /vanggu/);

  const short = parseScript(JSON.stringify(["chef", "empath", "imp"]), CATALOG);
  assert.equal(short.ok, false);
  assert.match(short.error, /пяти/);

  const sameEdition = parseScript(JSON.stringify(ALL_ROLES), CATALOG);
  assert.equal(sameEdition.ok, true, JSON.stringify(sameEdition));
  const outside = bagErrors({
    count: 5,
    roles: ["chef", "empath", "monk", "poisoner", "imp"],
    bluffs: [],
    pool: ["chef", "empath", "imp", "poisoner", "soldier"],
  });
  assert.ok(codes(outside).includes("outside-script"), JSON.stringify(outside));

  const manual = createGame(5);
  manual.script = {
    id: "custom-mixed",
    name: "Mixed",
    edition: "custom",
    source: "manual",
    roles: ["fortuneteller", "chambermaid", "monk", "poisoner", "imp"],
    manualOnly: false,
  };
  manual.scriptId = manual.script.id;
  manual.setup.roles = manual.script.roles.slice();
  assert.ok(
    codes(setupErrors(manual)).includes("mixed-edition"),
    JSON.stringify(setupErrors(manual)),
  );
});

// Issue #171, TB1. The official Librarian example: the only Outsider is the
// Recluse and the Storyteller makes the Recluse register as a Minion, so the
// Librarian's zero is true.
test("a Librarian may learn zero when every Outsider in play is a Recluse", () => {
  const recluse = tbGame([
    "librarian",
    "chef",
    "empath",
    "monk",
    "soldier",
    "recluse",
    "poisoner",
    "imp",
  ]);
  recluse.setup.info.librarian = { zero: true, pair: [] };
  assert.deepEqual(secretsErrors(recluse), [], JSON.stringify(secretsErrors(recluse)));

  const saint = tbGame([
    "librarian",
    "chef",
    "empath",
    "monk",
    "soldier",
    "saint",
    "poisoner",
    "imp",
  ]);
  saint.setup.info.librarian = { zero: true, pair: [] };
  assert.ok(codes(secretsErrors(saint)).includes("librarian-zero"));
});

// Issue #171, TB2. A Spy may register as a not-in-play Townsfolk and a Recluse
// as a not-in-play Minion, so the shown character need not be in the bag.
test("a first-night pair may show a character held by a registering Spy or Recluse", () => {
  const spy = tbGame(["washerwoman", "chef", "empath", "monk", "soldier", "butler", "spy", "imp"]);
  spy.setup.info.washerwoman = {
    roleId: "ravenkeeper",
    pair: [spy.order[6]!, spy.order[1]!],
  };
  assert.deepEqual(secretsErrors(spy), [], JSON.stringify(secretsErrors(spy)));

  const recluse = tbGame([
    "investigator",
    "chef",
    "empath",
    "monk",
    "soldier",
    "recluse",
    "poisoner",
    "imp",
  ]);
  recluse.setup.info.investigator = {
    roleId: "scarletwoman",
    pair: [recluse.order[5]!, recluse.order[1]!],
  };
  assert.deepEqual(secretsErrors(recluse), [], JSON.stringify(secretsErrors(recluse)));

  // Without the registering character the shown role must still be in play.
  const plain = tbGame([
    "washerwoman",
    "chef",
    "empath",
    "monk",
    "soldier",
    "butler",
    "poisoner",
    "imp",
  ]);
  plain.setup.info.washerwoman = {
    roleId: "ravenkeeper",
    pair: [plain.order[1]!, plain.order[2]!],
  };
  assert.ok(codes(secretsErrors(plain)).includes("info-inplay-washerwoman"));
});

// Issue #171, TB8. The Drunk's information is false, so a Drunk shown the
// Librarian may be told that zero Outsiders are in play.
test("a Drunk shown the Librarian may record the zero Outsiders answer", () => {
  const state = tbGame(
    ["drunk", "chef", "empath", "monk", "soldier", "undertaker", "poisoner", "imp"],
    { drunkShownId: "librarian" },
  );
  state.setup.info.librarian = { zero: true, pair: [] };
  assert.deepEqual(secretsErrors(state), [], JSON.stringify(secretsErrors(state)));
});

// Issue #171, SET2. A second modifier may already account for the Outsider a
// modifier removes, so legality is the count against compositionFor.
test("mixed setup modifiers are legal when the counts match the composition", () => {
  const pool = [...ALL_ROLES, ...BMR_ALL, ...SNV_ALL];
  const cases: { count: number; roles: RoleId[]; godfatherOutsider?: 1 | -1 }[] = [
    {
      count: 7,
      roles: [
        "godfather",
        "fanggu",
        "chambermaid",
        "courtier",
        "exorcist",
        "clockmaker",
        "dreamer",
      ],
      godfatherOutsider: -1,
    },
    {
      count: 7,
      roles: ["baron", "vigormortis", "chambermaid", "courtier", "exorcist", "clockmaker", "goon"],
    },
    {
      count: 10,
      roles: [
        "baron",
        "godfather",
        "po",
        "chambermaid",
        "courtier",
        "exorcist",
        "fool",
        "gambler",
        "gossip",
        "goon",
      ],
      godfatherOutsider: -1,
    },
    {
      count: 7,
      roles: ["godfather", "vigormortis", "chambermaid", "courtier", "exorcist", "fool", "gambler"],
    },
  ];
  for (const { count, roles, godfatherOutsider = 1 } of cases) {
    const errors = bagErrors({
      count,
      roles,
      bluffs: pool.filter((id) => isGoodRole(id) && !roles.includes(id)).slice(0, 3),
      pool,
      godfatherOutsider,
    });
    assert.deepEqual(errors, [], `${count}: ${JSON.stringify(codes(errors))}`);
  }
});

// Issue #171, SET12. Modifiers can ask for more roles than the table has, and
// the host must see that instead of an "0 of -1" counter.
test("an impossible modifier combination reports a clear reason", () => {
  const pool = [...ALL_ROLES, ...BMR_ALL, ...SNV_ALL];
  // Baron +2 and Fang Gu +1 and Godfather +1 at five players need more
  // Townsfolk than the base row has.
  const roles: RoleId[] = ["baron", "godfather", "fanggu", "chambermaid", "courtier"];
  const errors = bagErrors({
    count: 5,
    roles,
    bluffs: [],
    pool,
  });
  assert.ok(codes(errors).includes("composition-impossible"), JSON.stringify(codes(errors)));
  assert.equal(
    errors.some((error) => error.message.includes("-1")),
    false,
    JSON.stringify(errors),
  );
});

// Issue #171, SET3. The deal is a permutation of the bag over the seat order.
test("a deal rejects an assignment that is not a permutation of the bag", () => {
  const roles: RoleId[] = ["chef", "empath", "monk", "poisoner", "imp"];
  const { state, assignment } = tbSetup(roles);
  assert.equal(dealGame(state, { assignment }).ok, true);

  const duplicate = { ...assignment, [state.order[1]!]: "chef" };
  assert.equal(dealGame(state, { assignment: duplicate }).ok, false);

  const missing = { ...assignment };
  delete missing[state.order[4]!];
  assert.equal(dealGame(state, { assignment: missing }).ok, false);

  const notInBag = { ...assignment, [state.order[0]!]: "soldier" };
  assert.equal(dealGame(state, { assignment: notInBag }).ok, false);
});

// Issue #171, SET4. A new deal starts from a clean slate.
test("a re-deal clears the old gossip, grandchild, corrections and notes", () => {
  const { state, bag } = dealPreset("bmr", 7, 2);
  state.gossip = { truth: true, day: 1 };
  state.setup.grandmotherId = state.order[1]!;
  state.corrections.push({ at: "2026-11-14T00:00:00.000Z", reason: "old" });
  state.notes = "old notes";
  const assignment: Record<string, string> = {};
  state.order.forEach((id, index) => {
    assignment[id] = bag.roles[index]!;
  });
  const result = dealGame(state, { assignment });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(state.gossip, null);
  assert.equal(state.setup.grandmotherId, null);
  assert.deepEqual(state.corrections, []);
  assert.equal(state.notes, "");
});

// Issue #171, SET5. The bag screen applies the direction the bag was composed
// for, so the random bag must return it.
test("a random bag returns the Godfather direction it was composed for", () => {
  let composed: RandomBag | null = null;
  for (let step = 1; step < 100 && !composed; step += 1) {
    const bag = randomBag(8, () => step / 100, BMR_ALL, { godfatherOutsider: -1 });
    if (bag.roles.includes("godfather")) composed = bag;
  }
  assert.ok(composed, "a random Bad Moon Rising bag with the Godfather");
  assert.equal(composed.godfatherOutsider, -1);

  const withoutGodfather = randomBag(
    8,
    Math.random,
    BMR_ALL.filter((id) => id !== "godfather"),
    {
      godfatherOutsider: -1,
    },
  );
  assert.equal(withoutGodfather.godfatherOutsider, 1);
});

// Issue #171, SET10. The Secrets screen lists the host reminder checklist for
// every role in the bag, so each official role needs its tokens.
test("every official role has a host reminder for the secrets screen", () => {
  for (const id of SUPPORTED_ROLES) {
    assert.ok(Array.isArray(ROLE_REMINDERS_RU[id]), id + " has no reminder list");
  }
  for (const id of [...BMR_ALL, ...SNV_ALL]) {
    assert.ok(ROLE_REMINDERS_RU[id]!.length > 0, id + " has no reminder token");
  }
});

// Issue #171, SET6. A missing Lunatic mask cannot be shown at the table.
test("a Lunatic without a shown Demon mask is illegal", () => {
  const bmr7 = preset("bmr", 7, 2);
  assert.ok(bmr7.roles.includes("lunatic"));
  const errors = bagErrors({
    count: 7,
    roles: bmr7.roles,
    bluffs: bmr7.bluffs,
    drunkShownId: bmr7.drunkShownId,
    pool: BMR_ALL,
  });
  assert.ok(codes(errors).includes("lunatic-shown"), JSON.stringify(codes(errors)));

  const { state, assignment } = presetSetup("bmr", 7, 2);
  state.setup.lunaticShownId = null;
  assert.ok(
    validateState(state).some((error) => /Lunatic/.test(error)),
    JSON.stringify(validateState(state)),
  );
  const result = dealGame(state, { assignment });
  assert.equal(result.ok, false, JSON.stringify(result));
});
