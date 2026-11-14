import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_ROLES,
  BMR,
  BMR_ALL,
  COMPOSITION,
  SNV,
  SNV_ALL,
  compositionFor,
  isGoodRole,
  bagErrors,
  randomBag,
  requiredBluffs,
  NIGHT_FIRST,
  NIGHT_OTHER,
  roleTeam,
} from "../model/rules.ts";
import { presetBag } from "../model/presets.ts";
import { badMoonRisingScript, sectsAndVioletsScript } from "../model/scripts.ts";
import {
  createGame,
  importGame,
  exportGame,
  migrateV2,
  publicGameView,
  publicRoleView,
  orderedPlayers,
  livingPlayers,
} from "../model/state.ts";
import {
  autoSecrets,
  cancelNomination,
  checkWin,
  completeStep,
  currentStep,
  dayAt,
  dealGame,
  endDay,
  endNight,
  execute,
  infoForStep,
  isImpaired,
  kill,
  leader,
  chefCount,
  chooseDemonHeir,
  executeByDecision,
  executionThreshold,
  fortuneTellerYes,
  nominate,
  openNominations,
  recordVotes,
  resetVotes,
  secretsErrors,
  skipStep,
  startNight,
  useSlayer,
  recordVirginNomination,
  recoverClaim,
  attackNeedsRedirect,
  alignmentOf,
  registersAsDemon,
  registersAsMinion,
  registersAsOutsider,
  registersAsTownsfolk,
  registrationError,
  applyCommand,
} from "./index.ts";
import type { InfoResult } from "./index.ts";
import type { GameState, NightStep, Nomination, Role, RoleId } from "../model/types.ts";

type StepOptions = {
  targetIds?: string[];
  given?: Record<string, unknown>;
  redirectId?: string | null;
};

type StepResult = {
  ok: boolean;
  errorCode?: string | null;
  error?: string;
  needsRedirect?: boolean;
  options?: Array<{ id: string; alive?: boolean }>;
  result?: { noDeath?: boolean; deathId?: string | null; [key: string]: unknown };
  step?: NightStep;
};

type TestNomination = Nomination & { butlerWarning: string[]; result?: string };

function make(
  assignment: Record<string, string>,
  options: { count?: number; drunkShownId?: string | null } = {},
): GameState {
  const count = options.count || Object.keys(assignment).length;
  const state = createGame(count);
  Object.entries(assignment).forEach(([id]) => {
    state.players[id].name = "P" + id;
  });
  const roles = [...new Set(Object.values(assignment))];
  state.setup.count = count;
  state.setup.roles = roles;
  const bluffPool = ALL_ROLES.filter(
    (id) => isGoodRole(id) && !roles.includes(id) && id !== options.drunkShownId,
  );
  state.setup.bluffs = count >= 7 ? bluffPool.slice(0, 3) : [];
  state.setup.drunkShownId = options.drunkShownId || null;
  const result = dealGame(state, { assignment });
  assert.equal(result.ok, true, JSON.stringify(result));
  autoSecrets(state);
  const drunk = orderedPlayers(state).find((player) => player.roleId === "drunk");
  const mask = drunk && drunk.shownRoleId;
  if (mask && ["washerwoman", "librarian", "investigator"].includes(mask)) {
    const team =
      mask === "washerwoman" ? "townsfolk" : mask === "librarian" ? "outsider" : "minion";
    const pool = orderedPlayers(state).filter((player) => player.id !== drunk!.id);
    state.setup.info[mask] = {
      forDrunk: true,
      roleId: team === "townsfolk" ? "chef" : team === "outsider" ? "saint" : "spy",
      pair: [pool[0].id, pool[1].id],
    };
  }
  return state;
}

// Builds a legal Bad Moon Rising bag that contains the requested roles, fills
// the remaining seats from the same teams and deals the requested assignment.
function makeBmr(assignment: Record<string, RoleId>, options: { count?: number } = {}): GameState {
  const count = options.count || Object.keys(assignment).length;
  const state = createGame(count);
  state.script = badMoonRisingScript();
  state.scriptId = "bmr";
  state.setup.count = count;
  const required = [...new Set(Object.values(assignment))];
  const target = compositionFor(count, required)!;
  const counts: Record<string, number> = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const id of required) counts[roleTeam(id)!] += 1;
  const roles = [...required];
  for (const team of ["outsider", "townsfolk", "minion", "demon"] as const) {
    const need = target[team] - counts[team];
    assert.ok(need >= 0, "too many " + team + " in fixture");
    roles.push(...BMR[team].filter((id) => !roles.includes(id)).slice(0, need));
  }
  assert.equal(roles.length, count, "fixture bag size");
  state.setup.roles = roles;
  state.setup.bluffs = count >= 7 ? BMR_ALL.filter((id) => !roles.includes(id)).slice(0, 3) : [];
  const full: Record<string, string> = { ...assignment };
  const spare = roles.filter((id) => !required.includes(id));
  for (const id of state.order) {
    if (full[id]) continue;
    full[id] = spare.shift()!;
  }
  const result = dealGame(state, { assignment: full });
  assert.equal(result.ok, true, JSON.stringify(result));
  for (const id of state.order) state.players[id].name = "P" + id;
  return state;
}

// Builds a legal Sects & Violets bag with the requested roles, exactly like the
// Bad Moon Rising fixture.
function makeSnv(assignment: Record<string, RoleId>, options: { count?: number } = {}): GameState {
  const count = options.count || Object.keys(assignment).length;
  const state = createGame(count);
  state.script = sectsAndVioletsScript();
  state.scriptId = "snv";
  state.setup.count = count;
  const required = [...new Set(Object.values(assignment))];
  const target = compositionFor(count, required)!;
  const counts: Record<string, number> = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const id of required) counts[roleTeam(id)!] += 1;
  const roles = [...required];
  for (const team of ["outsider", "townsfolk", "minion", "demon"] as const) {
    const need = target[team] - counts[team];
    assert.ok(need >= 0, "too many " + team + " in fixture");
    roles.push(...SNV[team].filter((id) => !roles.includes(id)).slice(0, need));
  }
  assert.equal(roles.length, count, "fixture bag size");
  state.setup.roles = roles;
  state.setup.bluffs = count >= 7 ? SNV_ALL.filter((id) => !roles.includes(id)).slice(0, 3) : [];
  const full: Record<string, string> = { ...assignment };
  const spare = roles.filter((id) => !required.includes(id));
  for (const id of state.order) {
    if (full[id]) continue;
    full[id] = spare.shift()!;
  }
  const result = dealGame(state, { assignment: full });
  assert.equal(result.ok, true, JSON.stringify(result));
  for (const id of state.order) state.players[id].name = "P" + id;
  return state;
}

function roleStep(state: GameState, roleId: string): NightStep {
  return state.night.queue.find((step) => step.roleId === roleId && !step.done)!;
}

function systemStep(state: GameState, system: string): NightStep {
  return state.night.queue.find((step) => step.system === system && !step.done)!;
}

function completeSystem(state: GameState, system: string): StepResult {
  const step = systemStep(state, system);
  assert.ok(step, "no system step " + system);
  const result = completeStep(state, step.key, {});
  assert.equal(result.ok, true, JSON.stringify(result));
  return result as StepResult;
}

function completeRole(state: GameState, roleId: string, options: StepOptions = {}): StepResult {
  const step = roleStep(state, roleId);
  assert.ok(step, "no step for " + roleId);
  const result = completeStep(state, step.key, options);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result as StepResult;
}

function skipNight(state: GameState): void {
  while (currentStep(state)) {
    skipStep(state, currentStep(state)!.key, "test");
  }
  const result = endNight(state);
  assert.equal(result.ok, true, JSON.stringify(result));
}

function toDay(state: GameState): GameState {
  const result = startNight(state);
  assert.equal(result.ok, true, JSON.stringify(result));
  skipNight(state);
  return state;
}

function appoint(
  state: GameState,
  nominatorId: string,
  nomineeId: string,
  voters: string[],
): TestNomination {
  const result = nominate(state, nominatorId, nomineeId);
  assert.equal(result.ok, true, JSON.stringify(result));
  const nomination = state.day.nominations[state.day.nominations.length - 1]!;
  const votes = recordVotes(state, nomination.id, voters);
  assert.equal(votes.ok, true, JSON.stringify(votes));
  return nomination as TestNomination;
}

test("composition table is exact and Baron shifts two Townsfolk to Outsiders", () => {
  const expected = {
    5: [3, 0, 1, 1],
    6: [3, 1, 1, 1],
    7: [5, 0, 1, 1],
    8: [5, 1, 1, 1],
    9: [5, 2, 1, 1],
    10: [7, 0, 2, 1],
    11: [7, 1, 2, 1],
    12: [7, 2, 2, 1],
    13: [9, 0, 3, 1],
    14: [9, 1, 3, 1],
    15: [9, 2, 3, 1],
  };
  for (const [count, rows] of Object.entries(expected)) {
    const got = COMPOSITION[Number(count)];
    assert.deepEqual(got, rows, "table " + count);
    const sum = got.reduce((a, b) => a + b, 0);
    assert.equal(sum, Number(count));
    assert.equal(got[3], 1);
  }
  assert.deepEqual(compositionFor(5), { townsfolk: 3, outsider: 0, minion: 1, demon: 1 });
  assert.deepEqual(compositionFor(5, ["baron"]), {
    townsfolk: 1,
    outsider: 2,
    minion: 1,
    demon: 1,
  });
  assert.deepEqual(compositionFor(12, ["baron"]), {
    townsfolk: 5,
    outsider: 4,
    minion: 2,
    demon: 1,
  });
});

test("bag validation rejects duplicates, wrong counts, and Drunk mask leaks", () => {
  assert.ok(bagErrors({ count: 5, roles: ["chef", "chef", "empath", "poisoner", "imp"] }).length);
  assert.ok(
    bagErrors({ count: 5, roles: ["chef", "empath", "monk", "poisoner", "imp"], bluffs: ["mayor"] })
      .length,
  );
  assert.equal(
    bagErrors({
      count: 5,
      roles: ["chef", "empath", "monk", "poisoner", "imp"],
      bluffs: [],
    }).length,
    0,
  );
  const drunkErrors = bagErrors({
    count: 6,
    roles: ["drunk", "chef", "empath", "monk", "poisoner", "imp"],
    bluffs: [],
    drunkShownId: "empath",
  });
  assert.ok(drunkErrors.some((error) => error.code === "drunk-inplay"));
  const bluffErrors = bagErrors({
    count: 7,
    roles: ["drunk", "chef", "empath", "monk", "undertaker", "poisoner", "imp"],
    bluffs: ["washerwoman", "librarian", "mayor"],
    drunkShownId: "washerwoman",
  });
  assert.ok(bluffErrors.some((error) => error.code === "bluffs-drunk"));
});

test("random bags are legal for every supported size", () => {
  for (let count = 5; count <= 15; count += 1) {
    const bag = randomBag(count);
    const errors = bagErrors({ count, ...bag });
    assert.equal(errors.length, 0, count + ": " + errors.map((e) => e.message).join(", "));
    assert.equal(bag.bluffs.length, requiredBluffs(count));
  }
});

test("Drunk keeps the real role and the shown role apart", () => {
  const state = make(
    {
      1: "drunk",
      2: "empath",
      3: "chef",
      4: "monk",
      5: "poisoner",
      6: "imp",
    },
    { drunkShownId: "washerwoman" },
  );
  assert.equal(state.players["1"].roleId, "drunk");
  assert.equal(state.players["1"].shownRoleId, "washerwoman");
  assert.equal(state.players["2"].roleId, "empath");
  const view = publicRoleView(state.players["1"], {
    name: "Washerwoman",
    team: "townsfolk",
    ability: "One of two.",
  } as Role)!;
  assert.equal(view.role, "Washerwoman");
  assert.equal(Object.hasOwn(view, "roleId"), false);
  const result = startNight(state);
  assert.equal(result.ok, true);
  assert.ok(
    state.night.queue.some((step) => step.roleId === "washerwoman" && step.actorId === "1"),
  );
  assert.equal(
    state.night.queue.some((step) => step.roleId === "imp"),
    false,
  );
  const step = roleStep(state, "washerwoman");
  const info = infoForStep(state, step, {});
  assert.equal(info.needsChoice, true);
  assert.equal(Boolean(info.missing), false);
});

test("5–6 player first night has no evil introduction and no bluffs", () => {
  const five = make({
    1: "chef",
    2: "empath",
    3: "monk",
    4: "poisoner",
    5: "imp",
  });
  assert.equal(five.bluffs.length, 0);
  startNight(five);
  assert.equal(
    five.night.queue.some((step) => step.system === "minioninfo"),
    false,
  );
  assert.equal(
    five.night.queue.some((step) => step.system === "demoninfo"),
    false,
  );

  const seven = make({
    1: "washerwoman",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "undertaker",
    6: "poisoner",
    7: "imp",
  });
  assert.equal(seven.bluffs.length, 3);
  startNight(seven);
  assert.ok(systemStep(seven, "minioninfo"));
  assert.ok(systemStep(seven, "demoninfo"));
  assert.deepEqual(
    seven.night.queue
      .map((step) => step.system || step.roleId)
      .filter(Boolean)
      .slice(0, 4),
    ["minioninfo", "demoninfo", "poisoner", "washerwoman"],
  );
});

test("first-night information is computed from real players and seats", () => {
  const state = make({
    1: "washerwoman",
    2: "chef",
    3: "empath",
    4: "fortuneteller",
    5: "undertaker",
    6: "poisoner",
    7: "imp",
  });
  startNight(state);
  completeSystem(state, "minioninfo");
  completeSystem(state, "demoninfo");
  completeRole(state, "poisoner", { targetIds: ["3"] });
  const washer = roleStep(state, "washerwoman");
  const washerInfo = infoForStep(state, washer, {});
  assert.equal(washerInfo.kind, "one-of-two");
  assert.equal(washerInfo.roleId, "chef");
  assert.equal(washerInfo.pair!.length, 2);
  completeRole(state, "washerwoman");
  const chefInfo = infoForStep(state, roleStep(state, "chef"), {});
  assert.equal(chefInfo.kind, "number");
  assert.equal(typeof chefInfo.value, "number");
  const empath = roleStep(state, "empath");
  assert.equal(isImpaired(state, "3", { phase: "night", number: 1 }), true);
  const empathInfo = infoForStep(state, empath, {});
  assert.equal(empathInfo.needsChoice, true);
  completeRole(state, "empath", { given: { kind: "number", value: 1 } });
  assert.equal(state.night.queue.find((step) => step.roleId === "empath")!.given!.value, 1);
});

test("poison lasts the night and the next day, then expires", () => {
  const state = make({
    1: "empath",
    2: "chef",
    3: "monk",
    4: "undertaker",
    5: "mayor",
    6: "poisoner",
    7: "imp",
  });
  startNight(state);
  completeSystem(state, "minioninfo");
  completeSystem(state, "demoninfo");
  completeRole(state, "poisoner", { targetIds: ["1"] });
  assert.equal(isImpaired(state, "1", { phase: "night", number: 1 }), true);
  assert.equal(isImpaired(state, "1", { phase: "day", number: 1 }), true);
  assert.equal(isImpaired(state, "1", { phase: "night", number: 2 }), false);
  // Killing the source ends the persistent effect immediately.
  kill(state, "6", "test", { phase: "night", number: 1 });
  assert.equal(isImpaired(state, "1", { phase: "night", number: 1 }), false);
});

test("Monk protection and Soldier safety stop the Imp", () => {
  const state = make({
    1: "monk",
    2: "soldier",
    3: "empath",
    4: "chef",
    5: "mayor",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  assert.equal(state.phase, "night");
  assert.equal(state.night.number, 2);
  completeRole(state, "poisoner", { targetIds: ["3"] });
  completeRole(state, "monk", { targetIds: ["4"] });
  completeRole(state, "imp", { targetIds: ["4"] });
  assert.equal(state.players["4"].alive, true);

  const soldier = make({
    1: "monk",
    2: "soldier",
    3: "empath",
    4: "chef",
    5: "mayor",
    6: "poisoner",
    7: "imp",
  });
  toDay(soldier);
  assert.equal(endDay(soldier).ok, true);
  completeRole(soldier, "poisoner", { targetIds: ["3"] });
  completeRole(soldier, "monk", { targetIds: ["4"] });
  completeRole(soldier, "imp", { targetIds: ["2"] });
  assert.equal(soldier.players["2"].alive, true);
});

test("poisoned protection fails and the target dies", () => {
  const state = make({
    1: "monk",
    2: "soldier",
    3: "empath",
    4: "chef",
    5: "mayor",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  completeRole(state, "poisoner", { targetIds: ["1"] });
  completeRole(state, "monk", { targetIds: ["4"] });
  completeRole(state, "imp", { targetIds: ["4"] });
  assert.equal(state.players["4"].alive, false);
});

test("Ravenkeeper wakes after a night death and learns a character", () => {
  const state = make({
    1: "ravenkeeper",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "undertaker",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  completeRole(state, "poisoner", { targetIds: ["2"] });
  completeRole(state, "imp", { targetIds: ["1"] });
  const rk = roleStep(state, "ravenkeeper");
  assert.ok(rk, "ravenkeeper step inserted");
  assert.equal(rk.actorId, "1");
  assert.equal(rk.actorAlive, false);
  completeRole(state, "ravenkeeper", { targetIds: ["2"] });
  const step = state.night.queue.find((candidate) => candidate.roleId === "ravenkeeper")!;
  assert.equal(step.done, true);
  assert.ok(step.given);
});

test("Undertaker learns an execution death, not a night death", () => {
  const state = make({
    1: "undertaker",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "soldier",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  openNominations(state);
  appoint(state, "1", "2", ["1", "2", "3", "4", "5"]);
  const execution = execute(state, state.day.nominations[0].id);
  assert.equal(execution.ok, true);
  endDay(state);
  startNight(state);
  const step = roleStep(state, "undertaker");
  assert.ok(step, "undertaker step on the next night");
  completeRole(state, "undertaker");
  const done = state.night.queue.find((candidate) => candidate.roleId === "undertaker")!;
  assert.equal(done.given!.roleId, "chef");
});

test("Scarlet Woman inherits only with five living before the Demon dies", () => {
  const five = make({
    1: "chef",
    2: "monk",
    3: "mayor",
    4: "scarletwoman",
    5: "imp",
  });
  five.phase = "day";
  five.day = {
    number: 1,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  appoint(five, "2", "5", ["2", "3", "4"]);
  const result = execute(five, five.day.nominations[0].id);
  assert.equal(result.ok, true);
  assert.equal(five.players["5"].alive, false);
  assert.equal(five.players["4"].roleId, "imp");
  assert.equal(five.winner, null, "the new Demon keeps the game alive");
});

test("Scarlet Woman does not inherit below the threshold", () => {
  const state = make({
    1: "chef",
    2: "monk",
    3: "mayor",
    4: "scarletwoman",
    5: "imp",
  });
  kill(state, "1", "test", dayAt(state));
  state.phase = "day";
  state.day = {
    number: 1,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  const result = execute(
    state,
    (() => {
      appoint(state, "2", "5", ["2", "3", "4"]);
      return state.day.nominations[0].id;
    })(),
  );
  assert.equal(result.ok, true);
  assert.equal(state.players["4"].roleId, "scarletwoman");
  assert.equal(state.winner && state.winner.team, "good");
});

test("Imp self-kill passes the role and the new Demon does not act again", () => {
  const state = make({
    1: "chef",
    2: "monk",
    3: "mayor",
    4: "soldier",
    5: "empath",
    6: "scarletwoman",
    7: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  completeRole(state, "monk", { targetIds: ["3"] });
  completeRole(state, "imp", { targetIds: ["7"] });
  assert.equal(state.players["7"].alive, false);
  assert.equal(state.players["6"].roleId, "imp");
  assert.equal(state.night.queue.filter((step) => step.roleId === "imp" && !step.done).length, 0);
});

test("Virgin executes only the first eligible Townsfolk nominator", () => {
  const state = make({
    1: "virgin",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "soldier",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  openNominations(state);
  const result = nominate(state, "2", "1");
  assert.equal(result.ok, true);
  assert.equal(result.virgin, true);
  assert.equal(state.players["2"].alive, false);
  assert.equal(state.players["1"].alive, true);
  assert.equal(state.day.nominations.length, 0);
  assert.equal(state.day.execution!.cause, "virgin");
});

test("Drunk nominator does not trigger the Virgin", () => {
  const state = make(
    {
      1: "virgin",
      2: "drunk",
      3: "chef",
      4: "empath",
      5: "monk",
      6: "poisoner",
      7: "imp",
      8: "soldier",
    },
    { drunkShownId: "washerwoman" },
  );
  toDay(state);
  openNominations(state);
  const result = nominate(state, "2", "1");
  assert.equal(result.ok, true);
  assert.equal(Boolean(result.virgin), false);
  assert.equal(state.day.nominations.length, 1);
  assert.equal(state.players["2"].alive, true);
});

test("a poisoned Slayer spends the ability without killing", () => {
  const state = make({
    1: "slayer",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "soldier",
    6: "poisoner",
    7: "imp",
  });
  startNight(state);
  completeSystem(state, "minioninfo");
  completeSystem(state, "demoninfo");
  completeRole(state, "poisoner", { targetIds: ["1"] });
  skipNight(state);
  const result = useSlayer(state, "1", "7");
  assert.equal(result.ok, true);
  assert.equal(result.hit, false);
  assert.equal(state.players["7"].alive, true);
  assert.equal(state.players["1"].used.slayer, true);
});

test("a healthy Slayer kills the Demon and good wins", () => {
  const state = make({
    1: "slayer",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "soldier",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  const result = useSlayer(state, "1", "7");
  assert.equal(result.ok, true);
  assert.equal(result.hit, true);
  assert.equal(state.players["7"].alive, false);
  assert.equal(state.winner && state.winner.team, "good");
});

test("dead votes count once, are spent on a failed nomination, and cannot repeat", () => {
  const state = make({
    1: "chef",
    2: "empath",
    3: "monk",
    4: "soldier",
    5: "mayor",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  openNominations(state);
  appoint(state, "1", "2", ["1", "2", "3", "4", "5"]);
  execute(state, state.day.nominations[0].id);
  endDay(state);
  skipNight(state);
  openNominations(state);
  const nomination = appoint(state, "3", "4", ["2"]);
  assert.equal(nomination.count, 1);
  assert.equal(state.players["2"].voteToken, false);
  assert.equal(nomination.result, "failed");
  const second = nominate(state, "5", "1");
  assert.equal(second.ok, true);
  const votes = recordVotes(state, second.nomination!.id, ["2"]);
  assert.equal(votes.ok, true);
  const counted = votes.nomination as TestNomination;
  assert.equal(counted.count, 0);
  assert.ok(counted.butlerWarning.length >= 0);
});

test("ties on the maximum block execution, and a lower tie does not dethrone the leader", () => {
  const state = make({
    1: "chef",
    2: "empath",
    3: "monk",
    4: "soldier",
    5: "mayor",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  openNominations(state);
  appoint(state, "1", "2", ["1", "2", "3", "4"]);
  appoint(state, "2", "3", ["1", "2", "3", "4"]);
  let result = leader(state);
  assert.equal(result.tie, true);
  const third = appoint(state, "3", "4", ["1", "2", "3", "4", "5"]);
  result = leader(state);
  assert.equal(result.nomination!.id, third.id);
  assert.equal(result.count, 5);
  appoint(state, "4", "5", ["1", "2"]);
  result = leader(state);
  assert.equal(result.nomination!.id, third.id);
});

test("execution is an execution event, not automatically a death", () => {
  const state = make({
    1: "chef",
    2: "empath",
    3: "monk",
    4: "soldier",
    5: "mayor",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  kill(state, "4", "test", dayAt(state));
  openNominations(state);
  const beforeDeaths = state.deaths.length;
  appoint(state, "1", "4", ["1", "2", "3", "5"]);
  const result = execute(state, state.day.nominations[0].id);
  assert.equal(result.ok, true);
  assert.equal(state.deaths.length, beforeDeaths);
  assert.equal(state.executions.length, 1);
  assert.equal(state.day.execution!.playerId, "4");
  const executionLog = state.log.filter((entry) => entry.kind === "execution").at(-1);
  assert.equal(executionLog?.consequence, "prevented");
});

test("Saint loses on execution and Mayor wins at three alive without execution", () => {
  const saint = make({
    1: "saint",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "soldier",
    6: "virgin",
    7: "poisoner",
    8: "imp",
  });
  toDay(saint);
  openNominations(saint);
  appoint(saint, "1", "1", ["1", "2", "3", "4", "5"]);
  execute(saint, saint.day.nominations[0].id);
  assert.equal(saint.winner && saint.winner.team, "evil");
  assert.equal(saint.winner!.reason, "saint");

  const mayor = make({
    1: "mayor",
    2: "chef",
    3: "monk",
    4: "poisoner",
    5: "imp",
  });
  toDay(mayor);
  kill(mayor, "2", "test", dayAt(mayor));
  kill(mayor, "3", "test", dayAt(mayor));
  const result = endDay(mayor);
  assert.equal(result.ok, true);
  assert.equal(mayor.winner && mayor.winner.team, "good");
  assert.equal(mayor.winner!.reason, "mayor");
});

test("a corpse execution is not an execution event, so the Mayor still wins", () => {
  const state = make({
    1: "mayor",
    2: "chef",
    3: "monk",
    4: "poisoner",
    5: "imp",
  });
  toDay(state);
  kill(state, "2", "test", dayAt(state));
  kill(state, "3", "test", dayAt(state));
  openNominations(state);
  appoint(state, "1", "2", ["1", "4"]);
  execute(state, state.day.nominations[0].id);
  endDay(state);
  assert.equal(state.winner && state.winner.team, "good");
  assert.equal(state.winner!.reason, "mayor");
});

test("win priorities: no living Demon is checked before the two-alive evil win", () => {
  const state = make({
    1: "chef",
    2: "monk",
    3: "mayor",
    4: "scarletwoman",
    5: "imp",
  });
  kill(state, "4", "test", dayAt(state));
  kill(state, "1", "test", dayAt(state));
  kill(state, "5", "test", dayAt(state));
  const winner = checkWin(state);
  assert.equal(winner && winner.team, "good");
  assert.equal(winner!.reason, "demon-dead");
});

test("execution requires at least half the living players", () => {
  assert.equal(executionThreshold(5), 3);
  assert.equal(executionThreshold(6), 3);
  assert.equal(executionThreshold(7), 4);
  assert.equal(executionThreshold(8), 4);
  const state = make({
    1: "chef",
    2: "empath",
    3: "monk",
    4: "saint",
    5: "poisoner",
    6: "imp",
  });
  toDay(state);
  openNominations(state);
  const nomination = nominate(state, "1", "2").nomination!;
  const three = recordVotes(state, nomination.id, ["1", "3", "4"]);
  assert.equal(three.ok, true);
  assert.equal(three.nomination!.threshold, 3);
  assert.equal(three.nomination!.result, "qualified");
  const reset = resetVotes(state, nomination.id, "test");
  assert.equal(reset.ok, true);
  const four = recordVotes(state, nomination.id, ["1", "3", "4", "5"]);
  assert.equal(four.ok, true);
  assert.equal(four.nomination!.result, "qualified");
});

test("completed night steps and recorded votes cannot be applied twice", () => {
  const state = make({
    1: "chef",
    2: "empath",
    3: "monk",
    4: "soldier",
    5: "mayor",
    6: "poisoner",
    7: "imp",
  });
  startNight(state);
  completeSystem(state, "minioninfo");
  completeSystem(state, "demoninfo");
  completeRole(state, "poisoner", { targetIds: ["1"] });
  const step = state.night.queue.find((candidate) => candidate.roleId === "poisoner")!;
  const again = completeStep(state, step.key, { targetIds: ["2"] });
  assert.equal(again.ok, false);
  skipNight(state);
  openNominations(state);
  const nomination = appoint(state, "1", "2", ["1", "2"]);
  const repeat = recordVotes(state, nomination.id, ["3"]);
  assert.equal(repeat.ok, false);
  const cancel = cancelNomination(state, nomination.id);
  assert.equal(cancel.ok, false);
});

test("migration, export/import and public projection keep secrets out of public data", () => {
  const legacy = {
    v: 2,
    scriptId: "tb",
    night: 1,
    order: ["1", "2", "3", "4", "5"],
    players: {
      1: {
        name: "A",
        alive: true,
        claimed: true,
        roleId: "empath",
        shownRoleId: "empath",
        reminders: [],
      },
      2: {
        name: "B",
        alive: true,
        claimed: true,
        roleId: "imp",
        shownRoleId: "imp",
        reminders: [],
      },
      3: {
        name: "C",
        alive: false,
        claimed: true,
        roleId: "chef",
        shownRoleId: "chef",
        reminders: [],
      },
      4: {
        name: "D",
        alive: true,
        claimed: true,
        roleId: "monk",
        shownRoleId: "monk",
        reminders: [],
      },
      5: {
        name: "E",
        alive: true,
        claimed: true,
        roleId: "poisoner",
        shownRoleId: "poisoner",
        reminders: [],
      },
    },
    bluffs: [],
    nightOrder: [],
    log: [],
    notes: "secret",
  };
  const migrated = migrateV2(legacy);
  assert.equal(migrated.v, 4);
  assert.equal(migrated.players["3"].alive, false);
  assert.equal(migrated.deaths.length, 1);
  const exported = exportGame(migrated);
  const imported = importGame(exported);
  assert.equal(imported.ok, true);
  assert.equal(imported.state.players["1"].roleId, "empath");
  const bad = importGame({ format: "pocket-grimoire", version: 3, game: { v: 3, players: {} } });
  assert.equal(bad.ok, false);

  const role = { name: "Empath", team: "townsfolk", ability: "Learn a number." } as Role;
  const publicRole = publicRoleView(migrated.players["1"], role);
  assert.equal(JSON.stringify(publicRole).includes("roleId"), false);
  const publicGame = publicGameView(migrated);
  const text = JSON.stringify(publicGame);
  assert.equal(text.includes("empath"), false);
  assert.equal(text.includes("poisoner"), false);
  assert.equal(text.includes("secret"), false);
});

test("Imp attack on the Mayor can be redirected to another player", () => {
  const state = make({
    1: "mayor",
    2: "chef",
    3: "monk",
    4: "soldier",
    5: "empath",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  completeRole(state, "poisoner", { targetIds: ["5"] });
  const imp = roleStep(state, "imp");
  const first = completeStep(state, imp.key, { targetIds: ["1"] }) as StepResult;
  assert.equal(first.ok, false);
  assert.equal(first.needsRedirect, true);
  const second = completeStep(state, imp.key, { targetIds: ["1"], redirectId: "2" });
  assert.equal(second.ok, true);
  assert.equal(state.players["1"].alive, true);
  assert.equal(state.players["2"].alive, false);
});

test("a Mayor redirect to a dead player kills nobody and keeps the Mayor alive", () => {
  const state = make({
    1: "mayor",
    2: "chef",
    3: "monk",
    4: "soldier",
    5: "empath",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  completeRole(state, "poisoner", { targetIds: ["5"] });
  kill(state, "2", "test");
  const deathsBefore = state.deaths.length;
  const imp = roleStep(state, "imp");
  const prompt = completeStep(state, imp.key, { targetIds: ["1"] }) as StepResult;
  assert.equal(prompt.ok, false);
  assert.equal(prompt.needsRedirect, true);
  assert.ok(
    prompt.options!.some((option) => option.id === "2" && option.alive === false),
    "the Storyteller may name a dead player",
  );
  const attack = completeStep(state, imp.key, {
    targetIds: ["1"],
    redirectId: "2",
  }) as StepResult;
  assert.equal(attack.ok, true);
  assert.equal(attack.result!.noDeath, true);
  assert.equal(attack.result!.deathId, undefined);
  assert.equal(state.players["1"].alive, true, "the Mayor survives");
  assert.equal(state.players["2"].alive, false);
  assert.equal(state.deaths.length, deathsBefore, "a dead replacement produces no extra death");
});

test("a Mayor redirect to a healthy Soldier kills nobody and keeps the Mayor alive", () => {
  const state = make({
    1: "mayor",
    2: "chef",
    3: "monk",
    4: "soldier",
    5: "empath",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  completeRole(state, "poisoner", { targetIds: ["5"] });
  const imp = roleStep(state, "imp");
  const attack = completeStep(state, imp.key, {
    targetIds: ["1"],
    redirectId: "4",
  }) as StepResult;
  assert.equal(attack.ok, true);
  assert.equal(attack.result!.noDeath, true);
  assert.equal(state.players["1"].alive, true, "the Mayor survives a Soldier replacement");
  assert.equal(state.players["4"].alive, true, "the Soldier is safe from the Demon");
});

test("a Mayor redirect to a Monk-protected player kills nobody and keeps the Mayor alive", () => {
  const state = make({
    1: "mayor",
    2: "chef",
    3: "monk",
    4: "soldier",
    5: "empath",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  completeRole(state, "poisoner", { targetIds: ["4"] });
  completeRole(state, "monk", { targetIds: ["5"] });
  const imp = roleStep(state, "imp");
  const attack = completeStep(state, imp.key, {
    targetIds: ["1"],
    redirectId: "5",
  }) as StepResult;
  assert.equal(attack.ok, true);
  assert.equal(attack.result!.noDeath, true);
  assert.equal(state.players["1"].alive, true, "the Mayor survives");
  assert.equal(state.players["5"].alive, true, "the Monk-protected replacement survives");
});

test("a poisoned Mayor dies to the Demon with no redirection and no host prompt", () => {
  const state = make({
    1: "mayor",
    2: "chef",
    3: "empath",
    4: "poisoner",
    5: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  completeRole(state, "poisoner", { targetIds: ["1"] });
  const imp = roleStep(state, "imp");
  // The Poisoner's own step must never look like a redirect decision.
  const poisonStep = state.night.queue.find((step) => step.roleId === "poisoner")!;
  assert.equal(
    attackNeedsRedirect(state, {
      attackerId: poisonStep.actorId!,
      targetId: poisonStep.targetIds![0],
    }),
    false,
  );
  assert.equal(attackNeedsRedirect(state, { attackerId: "5", targetId: "1" }), false);
  const attack = completeStep(state, imp.key, { targetIds: ["1"] }) as StepResult;
  assert.equal(attack.ok, true);
  assert.equal(attack.needsRedirect, undefined);
  assert.equal(state.players["1"].alive, false);
  assert.equal(state.deaths.at(-1)!.roleId, "mayor");
  assert.equal(state.deaths.at(-1)!.impaired, true);
});

test("a poisoned Mayor does not win for good at three alive without execution", () => {
  const state = make({
    1: "mayor",
    2: "chef",
    3: "empath",
    4: "poisoner",
    5: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  completeRole(state, "poisoner", { targetIds: ["1"] });
  skipStep(state, roleStep(state, "imp").key, "test");
  skipNight(state);
  assert.equal(state.phase, "day");
  kill(state, "2", "test", dayAt(state));
  kill(state, "3", "test", dayAt(state));
  endDay(state);
  // Three living, no execution, but the poisoned Mayor has no ability.
  assert.equal(state.winner, null);
});

test("a Monk-protected or Soldier Mayor target never asks for a redirection", () => {
  const state = make({
    1: "mayor",
    2: "chef",
    3: "monk",
    4: "soldier",
    5: "empath",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  assert.equal(attackNeedsRedirect(state, { attackerId: "7", targetId: "1" }), true);
  completeRole(state, "monk", { targetIds: ["1"] });
  assert.equal(attackNeedsRedirect(state, { attackerId: "7", targetId: "1" }), false);
  assert.equal(attackNeedsRedirect(state, { attackerId: "7", targetId: "4" }), false);
  kill(state, "5", "test", dayAt(state));
  assert.equal(attackNeedsRedirect(state, { attackerId: "7", targetId: "5" }), false);
  state.players["1"].alive = false;
  assert.equal(attackNeedsRedirect(state, { attackerId: "7", targetId: "1" }), false);
});

test("a poisoned Demon attacking a healthy Mayor asks for no redirection", () => {
  const state = make({
    1: "mayor",
    2: "chef",
    3: "monk",
    4: "soldier",
    5: "empath",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  completeRole(state, "poisoner", { targetIds: ["7"] });
  assert.equal(isImpaired(state, "7", { phase: "night", number: 2 }), true);
  assert.equal(attackNeedsRedirect(state, { attackerId: "7", targetId: "1" }), false);
  const attack = completeRole(state, "imp", { targetIds: ["1"] });
  assert.equal(attack.result!.noDeath, true);
  assert.equal(state.players["1"].alive, true);
});

test("a poisoned Scarlet Woman cannot inherit the Demon role", () => {
  const state = make({
    1: "chef",
    2: "empath",
    3: "monk",
    4: "soldier",
    5: "mayor",
    6: "virgin",
    7: "slayer",
    8: "poisoner",
    9: "scarletwoman",
    10: "imp",
  });
  startNight(state);
  completeSystem(state, "minioninfo");
  completeSystem(state, "demoninfo");
  completeRole(state, "poisoner", { targetIds: ["9"] });
  skipNight(state);
  openNominations(state);
  appoint(state, "1", "10", ["1", "2", "3", "4", "5", "6"]);
  execute(state, state.day.nominations[0].id);
  assert.equal(state.players["9"].roleId, "scarletwoman");
  assert.equal(state.winner && state.winner.team, "good");
});

test("Spy and Recluse registrations are explicit host choices", () => {
  const state = make({
    1: "recluse",
    2: "imp",
    3: "chef",
    4: "empath",
    5: "monk",
    6: "soldier",
    7: "mayor",
    8: "poisoner",
  });
  assert.equal(chefCount(state, {}), 0);
  assert.equal(chefCount(state, { 1: "evil" }), 2);

  const fortune = make({
    1: "recluse",
    2: "imp",
    3: "chef",
    4: "empath",
    5: "monk",
    6: "soldier",
    7: "mayor",
    8: "poisoner",
  });
  fortune.setup.herringId = "3";
  assert.equal(fortuneTellerYes(fortune, ["1"], {}), false);
  assert.equal(fortuneTellerYes(fortune, ["1"], { 1: "demon" }), true);
});

test("Fortune Teller may choose themself and dead players", () => {
  const state = make({
    1: "fortuneteller",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "soldier",
    6: "poisoner",
    7: "imp",
  });
  state.setup.herringId = "3";
  startNight(state);
  const step = roleStep(state, "fortuneteller");
  assert.equal(step.targetMode, "two");
  const selfAndChef = completeStep(state, step.key, {
    targetIds: ["1", "2"],
  }) as StepResult;
  assert.equal(selfAndChef.ok, true, "selecting themself is allowed");
  assert.equal(selfAndChef.step!.given!.value, false);
  assert.equal(step.impaired, false);
});

test("the Fortune Teller may be their own red herring", () => {
  const state = make({
    1: "fortuneteller",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "soldier",
    6: "poisoner",
    7: "imp",
  });
  state.setup.herringId = "1";
  assert.equal(
    secretsErrors(state).some((error) => error.code === "herring-self"),
    false,
    "self red herring is a legal setup",
  );
  assert.equal(
    fortuneTellerYes(state, ["1", "2"], {}),
    true,
    "choosing themself reads the herring",
  );
});

test("Fortune Teller may pair a dead player with themself", () => {
  const state = make({
    1: "fortuneteller",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "soldier",
    6: "poisoner",
    7: "imp",
  });
  state.setup.herringId = "3";
  startNight(state);
  kill(state, "2", "test");
  const step = roleStep(state, "fortuneteller");
  const result = completeStep(state, step.key, {
    targetIds: ["1", "2"],
  }) as StepResult;
  assert.equal(result.ok, true);
  assert.equal(result.step!.given!.value, false);
  assert.equal(fortuneTellerYes(state, ["1", "3"], {}), true, "the red herring still answers yes");
});

test("one-of-two setup rejects a pair without the real role", () => {
  const state = make({
    1: "washerwoman",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "undertaker",
    6: "poisoner",
    7: "imp",
  });
  state.setup.info.washerwoman = { roleId: "chef", pair: ["1", "3"], matchIndex: 0 };
  assert.ok(secretsErrors(state).some((error) => error.code === "info-true-washerwoman"));
});

test("an illegal Butler vote is counted and only warned about privately", () => {
  const state = make({
    1: "butler",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "soldier",
    6: "virgin",
    7: "poisoner",
    8: "imp",
  });
  startNight(state);
  completeSystem(state, "minioninfo");
  completeSystem(state, "demoninfo");
  completeRole(state, "poisoner", { targetIds: ["5"] });
  completeRole(state, "chef");
  completeRole(state, "empath");
  completeRole(state, "butler", { targetIds: ["2"] });
  skipNight(state);
  openNominations(state);
  const nomination = appoint(state, "1", "2", ["1"]);
  assert.equal(nomination.count, 1, "the vote that was cast still counts");
  assert.deepEqual(nomination.votes, ["1"]);
  assert.ok(
    nomination.butlerWarning.some((warning) => warning.includes("Дворецкий")),
    "the host still gets a private warning",
  );
});

test("a Butler vote counts normally when the master votes too", () => {
  const state = make({
    1: "butler",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "soldier",
    6: "virgin",
    7: "poisoner",
    8: "imp",
  });
  startNight(state);
  completeSystem(state, "minioninfo");
  completeSystem(state, "demoninfo");
  completeRole(state, "poisoner", { targetIds: ["5"] });
  completeRole(state, "chef");
  completeRole(state, "empath");
  completeRole(state, "butler", { targetIds: ["2"] });
  skipNight(state);
  openNominations(state);
  const nomination = appoint(state, "1", "2", ["1", "2"]);
  assert.equal(nomination.count, 2);
  assert.deepEqual(nomination.votes, ["1", "2"]);
  assert.equal(nomination.butlerWarning.length, 0);
});

test("a player killed before their night wake is skipped", () => {
  const state = make({
    1: "empath",
    2: "chef",
    3: "monk",
    4: "soldier",
    5: "mayor",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  completeRole(state, "poisoner", { targetIds: ["5"] });
  completeRole(state, "imp", { targetIds: ["1"] });
  const empath = state.night.queue.find((step) => step.roleId === "empath")!;
  assert.equal(empath.skipped, true);
  assert.notEqual(currentStep(state)?.roleId, "empath");
});

test("a minion promoted to Demon loses their old night step", () => {
  const state = make({
    1: "chef",
    2: "empath",
    3: "monk",
    4: "soldier",
    5: "mayor",
    6: "virgin",
    7: "slayer",
    8: "spy",
    9: "poisoner",
    10: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  const imp = roleStep(state, "imp");
  const attack = completeStep(state, imp.key, { targetIds: ["10"] });
  assert.equal(attack.ok, true);
  assert.ok(state.night.queue.find((step) => step.roleId === "imp")!.pending);
  const heir = chooseDemonHeir(state, imp.key, "8");
  assert.equal(heir.ok, true);
  assert.equal(state.players["8"].roleId, "imp");
  assert.equal(state.night.queue.find((step) => step.roleId === "spy")!.skipped, true);
});

test("the host execution result needs no nomination ledger", () => {
  const state = make({
    1: "chef",
    2: "empath",
    3: "monk",
    4: "soldier",
    5: "mayor",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  const before = state.deaths.length;
  const result = executeByDecision(state, "2");
  assert.equal(result.ok, true);
  assert.equal(state.deaths.length, before + 1);
  assert.equal(state.day.execution!.playerId, "2");
  assert.equal(state.day.execution!.deathId, result.death!.id);
  assert.equal(state.day.ended, true);
  assert.equal(state.winner, null);
});

test("table Virgin control spends a non-triggering nomination without opening a vote ledger", () => {
  const state = make(
    {
      1: "virgin",
      2: "drunk",
      3: "chef",
      4: "empath",
      5: "monk",
      6: "poisoner",
      7: "imp",
      8: "undertaker",
    },
    { drunkShownId: "soldier" },
  );
  toDay(state);
  const result = recordVirginNomination(state, "2", "1");
  assert.equal(result.ok, true);
  assert.equal(state.players["1"].used.virgin, true);
  assert.equal(state.day.execution, null);
  assert.equal(state.day.activeNominationId, null);
  assert.equal(recordVirginNomination(state, "3", "1").ok, false);
  const roundtrip = importGame(exportGame(state));
  const roundtripError = roundtrip.ok ? undefined : roundtrip.error;
  assert.equal(roundtrip.ok, true, roundtripError);
  assert.equal(roundtrip.state.players["1"].used.virgin, true);
});

test("table Virgin control executes a qualifying nominator and persists the death reference", () => {
  const state = make({
    1: "virgin",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "undertaker",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  const result = recordVirginNomination(state, "2", "1");
  assert.equal(result.virgin, true);
  assert.equal(state.day.ended, true);
  assert.equal(state.players["2"].alive, false);
  assert.ok(state.day.execution!.deathId);
  assert.equal(importGame(exportGame(state)).ok, true);
});

test("claim recovery clears only the selected claim and records a reason", () => {
  const state = make({
    1: "virgin",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "undertaker",
    6: "poisoner",
    7: "imp",
  });
  state.players["1"].claimed = true;
  state.players["2"].claimed = true;
  const role = state.players["1"].roleId;
  assert.equal(recoverClaim(state, "1", "Mistaken number").ok, true);
  assert.equal(state.players["1"].claimed, false);
  assert.equal(state.players["1"].name, "");
  assert.equal(state.players["1"].roleId, role);
  assert.equal(state.players["2"].claimed, true);
  assert.equal(state.corrections.at(-1)!.reason, "Mistaken number");
});

test("Librarian learns one of two players is a particular Outsider or that zero are in play", () => {
  const withOutsider = make({
    1: "librarian",
    2: "saint",
    3: "chef",
    4: "empath",
    5: "poisoner",
    6: "imp",
  });
  startNight(withOutsider);
  const info = infoForStep(withOutsider, roleStep(withOutsider, "librarian"), {});
  assert.equal(info.kind, "one-of-two");
  assert.equal(info.roleId, "saint");
  assert.equal(info.pair!.length, 2);
  assert.equal(info.pair!.includes("2"), true);
  assert.equal(info.zero, undefined);
  assert.equal(info.needsChoice, false);
  withOutsider.setup.info.librarian = { zero: true, pair: [] };
  assert.equal(
    secretsErrors(withOutsider).some((error) => error.code === "librarian-zero"),
    true,
    "zero is illegal when an Outsider is in play",
  );

  const zero = make({ 1: "librarian", 2: "chef", 3: "empath", 4: "poisoner", 5: "imp" });
  startNight(zero);
  const zeroInfo = infoForStep(zero, roleStep(zero, "librarian"), {});
  assert.equal(zeroInfo.kind, "one-of-two");
  assert.equal(zeroInfo.zero, true);
  assert.ok(!zeroInfo.needsChoice);
  assert.deepEqual(secretsErrors(zero), []);
});

test("Investigator learns one of two players is a particular Minion", () => {
  const state = make({
    1: "investigator",
    2: "chef",
    3: "empath",
    4: "saint",
    5: "poisoner",
    6: "imp",
  });
  startNight(state);
  const info = infoForStep(state, roleStep(state, "investigator"), {});
  assert.equal(info.kind, "one-of-two");
  assert.equal(info.roleId, "poisoner");
  assert.equal(info.pair!.length, 2);
  assert.equal(info.pair!.includes("5"), true);
  assert.equal(info.needsChoice, false);
  state.setup.info.investigator = { roleId: "poisoner", pair: ["2", "3"], matchIndex: 0 };
  assert.equal(
    secretsErrors(state).some((error) => error.code === "info-true-investigator"),
    true,
    "a pair without the real Minion is rejected",
  );
});

test("a Librarian impaired with no Outsider in play still offers allowed false information", () => {
  const state = make({ 1: "librarian", 2: "chef", 3: "empath", 4: "poisoner", 5: "imp" });
  startNight(state);
  completeRole(state, "poisoner", { targetIds: ["1"] });
  const step = roleStep(state, "librarian");
  const info = infoForStep(state, step, {});
  assert.equal(info.impaired, true);
  assert.equal(info.needsChoice, true);
  assert.equal(info.zero, undefined, "false information must not claim that zero are in play");
  assert.ok(info.options!.length > 0);
  assert.equal(
    info.options!.every((id) => roleTeam(id as string) === "outsider"),
    true,
    "only Outsider roles are legal false answers",
  );
  assert.equal(info.pair!.length, 2);
  assert.equal(info.pair!.includes("1"), false);
  const result = completeStep(state, step.key, { given: info });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(
    state.night.queue.find((candidate) => candidate.roleId === "librarian")!.given!.roleId,
    info.roleId,
  );
});

test("a Recluse registers as evil, a Minion or a Demon and a Spy as good, a Townsfolk or an Outsider even when dead", () => {
  const state = make({
    1: "recluse",
    2: "spy",
    3: "chef",
    4: "empath",
    5: "monk",
    6: "imp",
  });
  kill(state, "1", "demon");
  kill(state, "2", "demon");
  const recluse = state.players["1"];
  const spy = state.players["2"];
  assert.equal(recluse.alive, false);
  assert.equal(spy.alive, false);

  assert.equal(alignmentOf(state, recluse, {}), "good");
  assert.equal(alignmentOf(state, recluse, { 1: "evil" }), "evil");
  assert.equal(registersAsMinion(state, recluse, { 1: "minion" }), true);
  assert.equal(registersAsDemon(state, recluse, { 1: "demon" }), true);
  assert.equal(registersAsDemon(state, recluse, { 1: "evil" }), false);
  assert.equal(registersAsDemon(state, recluse, {}), false);
  assert.equal(registersAsMinion(state, recluse, {}), false);

  assert.equal(alignmentOf(state, spy, {}), "evil");
  assert.equal(alignmentOf(state, spy, { 2: "good" }), "good");
  assert.equal(registersAsTownsfolk(state, spy, { 2: "townsfolk" }), true);
  assert.equal(registersAsOutsider(state, spy, { 2: "outsider" }), true);
  assert.equal(registersAsTownsfolk(state, spy, {}), false);
  assert.equal(registersAsOutsider(state, spy, {}), false);
});

test("a poisoned Saint executed by the town does not lose the game for good", () => {
  const state = make({
    1: "saint",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "poisoner",
    6: "imp",
  });
  startNight(state);
  completeRole(state, "poisoner", { targetIds: ["1"] });
  skipNight(state);
  openNominations(state);
  const nomination = nominate(state, "2", "1").nomination!;
  assert.equal(recordVotes(state, nomination.id, ["2", "3", "4"]).ok, true);
  const result = execute(state, nomination.id);
  assert.equal(result.ok, true, JSON.stringify(result));
  const death = state.deaths.find((candidate) => candidate.playerId === "1");
  assert.ok(death);
  assert.equal(death.impaired, true);
  assert.equal(state.winner, null);
});

test("the Spy sees the grimoire on their night step and may register as good, a Townsfolk or an Outsider", () => {
  const state = make({
    1: "spy",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "saint",
    6: "imp",
  });
  startNight(state);
  const step = roleStep(state, "spy");
  assert.ok(step);
  assert.equal(step.infoKind, "grimoire");
  const info = infoForStep(state, step, {});
  assert.equal(info.kind, "grimoire");
  assert.equal(registersAsTownsfolk(state, state.players["1"], { 1: "townsfolk" }), true);
  assert.equal(registersAsOutsider(state, state.players["1"], { 1: "outsider" }), true);
  assert.equal(alignmentOf(state, state.players["1"], { 1: "good" }), "good");
});

test("Trouble Brewing uses the official first-night and other-night order", () => {
  assert.deepEqual(NIGHT_FIRST, [
    "minioninfo",
    "demoninfo",
    "poisoner",
    "washerwoman",
    "librarian",
    "investigator",
    "chef",
    "empath",
    "fortuneteller",
    "butler",
    "spy",
  ]);
  assert.deepEqual(NIGHT_OTHER, [
    "poisoner",
    "monk",
    "scarletwoman",
    "imp",
    "ravenkeeper",
    "empath",
    "fortuneteller",
    "undertaker",
    "butler",
    "spy",
  ]);

  const state = make({
    1: "washerwoman",
    2: "librarian",
    3: "investigator",
    4: "chef",
    5: "empath",
    6: "fortuneteller",
    7: "undertaker",
    8: "ravenkeeper",
    9: "monk",
    10: "saint",
    11: "recluse",
    12: "poisoner",
    13: "spy",
    14: "scarletwoman",
    15: "imp",
  });
  startNight(state);
  assert.deepEqual(
    state.night.queue.map((step) => step.system || step.roleId),
    [
      "minioninfo",
      "demoninfo",
      "poisoner",
      "washerwoman",
      "librarian",
      "investigator",
      "chef",
      "empath",
      "fortuneteller",
      "spy",
    ],
    "the queue matches the official first-night sequence",
  );
  assert.equal(
    state.night.queue.at(-1)!.roleId,
    "spy",
    "the Spy wakes last and sees the final grimoire",
  );
});

test("every Trouble Brewing first-night information role offers allowed false information while impaired", () => {
  const state = make({
    1: "washerwoman",
    2: "librarian",
    3: "investigator",
    4: "chef",
    5: "empath",
    6: "fortuneteller",
    7: "undertaker",
    8: "ravenkeeper",
    9: "monk",
    10: "saint",
    11: "recluse",
    12: "poisoner",
    13: "spy",
    14: "scarletwoman",
    15: "imp",
  });
  startNight(state);
  const source = state.players["12"];
  for (const targetId of ["1", "2", "3", "4", "5", "6"]) {
    state.effects.push({
      id: "test-poison-" + targetId,
      kind: "poison",
      sourceId: source.id,
      targetId,
      start: { phase: "night", number: 1 },
      expires: { phase: "night", number: 2 },
      active: true,
    });
  }
  assert.equal(isImpaired(state, "1", { phase: "night", number: 1 }), true);

  const expected = {
    washerwoman: "townsfolk",
    librarian: "outsider",
    investigator: "minion",
  };
  for (const [roleId, team] of Object.entries(expected)) {
    const info = infoForStep(state, roleStep(state, roleId), {});
    assert.equal(info.impaired, true, roleId);
    assert.equal(info.needsChoice, true, roleId);
    assert.ok(info.options!.length > 0, roleId);
    assert.equal(
      info.options!.every((id) => roleTeam(id as string) === team),
      true,
      roleId,
    );
  }

  const chef = infoForStep(state, roleStep(state, "chef"), {});
  assert.equal(chef.needsChoice, true);
  assert.equal(chef.options![0], 0);
  assert.equal(chef.options!.includes(chef.value), true, "the true count is an allowed answer");

  const empath = infoForStep(state, roleStep(state, "empath"), {});
  assert.equal(empath.needsChoice, true);
  assert.deepEqual(empath.options, [0, 1, 2]);

  const fortune = infoForStep(state, roleStep(state, "fortuneteller"), {});
  assert.equal(fortune.needsChoice, true);
  assert.deepEqual(fortune.options, [true, false]);
});

test("an impaired Undertaker collects an execution today and then offers any character", () => {
  const state = make({
    1: "undertaker",
    2: "chef",
    3: "empath",
    4: "saint",
    5: "poisoner",
    6: "imp",
  });
  startNight(state);
  skipNight(state);
  openNominations(state);
  const nomination = nominate(state, "2", "3").nomination!;
  assert.equal(recordVotes(state, nomination.id, ["2", "3", "4"]).ok, true);
  assert.equal(execute(state, nomination.id).ok, true);
  assert.equal(endDay(state).ok, true);
  assert.equal(state.night.number, 2);
  completeRole(state, "poisoner", { targetIds: ["1"] });
  const step = roleStep(state, "undertaker");
  assert.ok(step, "the Undertaker wakes after an execution death");
  const info = infoForStep(state, step, {});
  assert.equal(info.impaired, true);
  assert.equal(info.needsChoice, true);
  assert.equal(info.options!.length, ALL_ROLES.length);
  assert.equal(info.options!.includes("imp"), true);
});

test("an impaired Ravenkeeper killed tonight offers any character for the false answer", () => {
  const state = make({
    1: "ravenkeeper",
    2: "chef",
    3: "empath",
    4: "saint",
    5: "poisoner",
    6: "imp",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  assert.equal(state.night.number, 2);
  state.effects.push({
    id: "test-poison-1",
    kind: "poison",
    sourceId: "5",
    targetId: "1",
    start: { phase: "night", number: 2 },
    expires: { phase: "night", number: 3 },
    active: true,
  });
  const attack = completeStep(state, roleStep(state, "imp").key, { targetIds: ["1"] });
  assert.equal(attack.ok, true, JSON.stringify(attack));
  const step = roleStep(state, "ravenkeeper");
  assert.ok(step, "the Ravenkeeper wakes after dying tonight");
  const info = infoForStep(state, step, { targetIds: ["2"] });
  assert.equal(info.impaired, true);
  assert.equal(info.needsChoice, true);
  assert.equal(info.options!.length, ALL_ROLES.length);
});

test("a living player may nominate only once per day and a player may be nominated only once per day", () => {
  const state = make({
    1: "chef",
    2: "empath",
    3: "monk",
    4: "saint",
    5: "poisoner",
    6: "imp",
  });
  toDay(state);
  openNominations(state);
  const first = nominate(state, "1", "2");
  assert.equal(first.ok, true);
  assert.equal(nominate(state, "1", "3").errorCode, "error.10");
  assert.equal(recordVotes(state, first.nomination!.id, ["1"]).ok, true);
  assert.equal(nominate(state, "1", "3").errorCode, "error.13");
  assert.equal(nominate(state, "3", "2").errorCode, "error.14");
  kill(state, "4", "manual");
  assert.equal(nominate(state, "4", "5").errorCode, "error.11");
});

test("a Trouble Brewing game runs from deal through a night and a day at every player count from five to fifteen", () => {
  for (let count = 5; count <= 15; count += 1) {
    const bag = presetBag("tb", count, 0);
    assert.ok(bag && bag.valid, "preset " + count);
    const state = createGame(count);
    state.setup.roles = bag.roles.slice();
    state.setup.bluffs = bag.bluffs.slice();
    state.setup.drunkShownId = bag.drunkShownId;
    const dealt = dealGame(state);
    assert.equal(dealt.ok, true, count + ": " + JSON.stringify(dealt));
    autoSecrets(state);
    assert.deepEqual(secretsErrors(state), [], String(count));
    assert.equal(startNight(state).ok, true, "night starts at " + count);

    for (let guard = 0; guard < 40; guard += 1) {
      const step = currentStep(state);
      if (!step) break;
      if (step.kind === "system") {
        assert.equal(completeStep(state, step.key, {}).ok, true, step.system);
        continue;
      }
      const living = state.order.filter((id) => state.players[id].alive);
      const options: { targetIds?: string[]; given?: InfoResult } = {};
      if (step.targetMode === "one-any" || step.targetMode === "one-other") {
        options.targetIds = [living.find((id) => id !== step.actorId) || living[0]];
      } else if (step.targetMode === "two") {
        options.targetIds = living.filter((id) => id !== step.actorId).slice(0, 2);
      }
      const info = infoForStep(state, step, options);
      if (info.needsChoice) options.given = info;
      const done = completeStep(state, step.key, options);
      assert.equal(
        done.ok,
        true,
        count + " " + (step.roleId || step.system) + ": " + JSON.stringify(done),
      );
    }
    assert.equal(endNight(state).ok, true, "night ends at " + count);

    openNominations(state);
    const nominee = state.order
      .map((id) => state.players[id])
      .find((player) =>
        [
          "chef",
          "empath",
          "fortuneteller",
          "undertaker",
          "monk",
          "soldier",
          "butler",
          "librarian",
          "investigator",
        ].includes(player.roleId!),
      )!;
    const nominator = state.order.find((id) => id !== nominee.id)!;
    const nomination = nominate(state, nominator, nominee.id).nomination!;
    const living = state.order.filter((id) => state.players[id].alive);
    assert.equal(recordVotes(state, nomination.id, living).ok, true, "votes at " + count);
    assert.equal(execute(state, nomination.id).ok, true, "execution at " + count);
    assert.equal(state.winner, null, "the Demon survives the first execution at " + count);
    assert.equal(endDay(state).ok, true, "the day ends at " + count);
    assert.equal(state.phase, "night");
    assert.equal(state.night.number, 2);
    assert.equal(state.day.number, 2);
  }
});

test("a drunk or poisoned Spy or Recluse registration never applies to an ability", () => {
  const spyState = make({
    1: "virgin",
    2: "spy",
    3: "chef",
    4: "empath",
    5: "mayor",
    6: "slayer",
    7: "imp",
  });
  toDay(spyState);
  spyState.effects.push({
    id: "poison-spy",
    kind: "poison",
    sourceId: "3",
    targetId: "2",
    start: { phase: "night", number: 1 },
    expires: { phase: "night", number: 2 },
    active: true,
  });
  assert.equal(isImpaired(spyState, "2", dayAt(spyState)), true);
  assert.ok(
    registrationError(spyState, { 2: "townsfolk" }),
    "an impaired registrant cannot record a registration",
  );
  assert.equal(alignmentOf(spyState, spyState.players["2"], { 2: "good" }), "evil");
  assert.equal(registersAsTownsfolk(spyState, spyState.players["2"], { 2: "townsfolk" }), false);
  openNominations(spyState);
  const nomination = nominate(spyState, "2", "1", { spyRegistersTownsfolk: true });
  assert.equal(nomination.ok, true, JSON.stringify(nomination));
  assert.equal(Boolean(nomination.virgin), false, "the impaired Spy does not trigger the Virgin");
  assert.equal(spyState.players["1"].used.virgin, true);
  assert.equal(spyState.players["2"].alive, true);

  const recluseState = make({
    1: "slayer",
    2: "recluse",
    3: "chef",
    4: "empath",
    5: "mayor",
    6: "monk",
    7: "saint",
    8: "imp",
    9: "spy",
  });
  toDay(recluseState);
  recluseState.effects.push({
    id: "poison-recluse",
    kind: "poison",
    sourceId: "3",
    targetId: "2",
    start: { phase: "night", number: 1 },
    expires: { phase: "night", number: 2 },
    active: true,
  });
  assert.equal(isImpaired(recluseState, "2", dayAt(recluseState)), true);
  assert.equal(registersAsDemon(recluseState, recluseState.players["2"], { 2: "demon" }), false);
  recluseState.setup.herringId = "5";
  assert.equal(fortuneTellerYes(recluseState, ["2"], { 2: "demon" }), false);
  const slayer = useSlayer(recluseState, "1", "2", { recluseRegistersDemon: true });
  assert.equal(slayer.ok, true);
  assert.equal(slayer.hit, false, "the impaired Recluse does not register as the Demon");
  assert.equal(recluseState.players["2"].alive, true);
});

test("a Poisoner who becomes the Imp ends the poison it sourced", () => {
  const state = make({
    1: "poisoner",
    2: "mayor",
    3: "chef",
    4: "imp",
    5: "empath",
    6: "monk",
    7: "soldier",
  });
  toDay(state);
  assert.equal(endDay(state).ok, true);
  completeRole(state, "poisoner", { targetIds: ["2"] });
  assert.equal(isImpaired(state, "2"), true, "the Mayor is poisoned tonight");
  const imp = roleStep(state, "imp");
  const attack = completeStep(state, imp.key, { targetIds: [imp.actorId!] });
  assert.equal(attack.ok, true, JSON.stringify(attack));
  assert.equal(state.players["1"].roleId, "imp", "the Poisoner inherited the Demon role");
  assert.equal(isImpaired(state, "2"), false, "the poison ended with the role change");
  assert.ok(
    state.effects
      .filter((effect) => effect.kind === "poison")
      .every((effect) => effect.active === false),
  );
});

test("a Mayor redirect onto the Imp is not the Imp's self-kill", () => {
  const state = make({
    1: "mayor",
    2: "chef",
    3: "scarletwoman",
    4: "imp",
    5: "empath",
  });
  toDay(state);
  kill(state, "5", "test", dayAt(state));
  assert.equal(endDay(state).ok, true);
  const imp = roleStep(state, "imp");
  const prompt = completeStep(state, imp.key, { targetIds: ["1"] }) as StepResult;
  assert.equal(prompt.ok, false);
  assert.equal(prompt.needsRedirect, true);
  const attack = completeStep(state, imp.key, {
    targetIds: ["1"],
    redirectId: "4",
  }) as StepResult;
  assert.equal(attack.ok, true, JSON.stringify(attack));
  assert.equal(attack.result!.redirected, true);
  assert.equal(state.players["4"].alive, false, "the redirected Imp dies");
  assert.equal(state.deaths.at(-1)!.cause, "demon", "the redirected death is a normal Demon death");
  assert.equal(state.players["3"].roleId, "scarletwoman", "below five living, nobody inherits");
  assert.equal(state.winner?.team, "good");
  assert.equal(state.winner?.reason, "demon-dead");
});

test("the Virgin's first nomination is recorded after a day execution", () => {
  const state = make({
    1: "virgin",
    2: "butler",
    3: "chef",
    4: "empath",
    5: "monk",
    6: "poisoner",
    7: "imp",
    8: "soldier",
  });
  toDay(state);
  const executed = executeByDecision(state, "3") as { ok: boolean };
  assert.equal(executed.ok, true, JSON.stringify(executed));
  assert.ok(state.day.execution, "the day already carries an execution");
  const recorded = recordVirginNomination(state, "2", "1");
  assert.equal(recorded.ok, true, JSON.stringify(recorded));
  assert.equal(state.players["1"].used.virgin, true, "the first nomination spends the ability");
  assert.equal(state.day.nominations.length, 1);
  assert.equal(state.day.nominations[0]!.recorded, true);
});

test("an impaired Virgin's first nomination still spends the ability", () => {
  const state = make({
    1: "virgin",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "soldier",
    6: "poisoner",
    7: "imp",
  });
  toDay(state);
  state.effects.push({
    id: "poison-virgin",
    kind: "poison",
    sourceId: "6",
    targetId: "1",
    start: { phase: "night", number: 1 },
    expires: { phase: "night", number: 2 },
    active: true,
  });
  openNominations(state);
  const result = nominate(state, "2", "1");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(Boolean(result.virgin), false);
  assert.equal(state.players["1"].used.virgin, true);
  assert.equal(state.players["2"].alive, true);
});

test("a dead player cannot be executed", () => {
  const state = make({
    1: "mayor",
    2: "chef",
    3: "monk",
    4: "poisoner",
    5: "imp",
  });
  toDay(state);
  kill(state, "2", "test", dayAt(state));
  kill(state, "3", "test", dayAt(state));
  const rejected = executeByDecision(state, "2") as { ok: boolean; errorCode?: string };
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errorCode, "error.55");
  assert.equal(state.day.execution, null);
});

test("the Saint loss is scoped to the day of the execution", () => {
  const state = make({
    1: "saint",
    2: "chef",
    3: "empath",
    4: "monk",
    5: "soldier",
    6: "poisoner",
    7: "imp",
    8: "virgin",
  });
  toDay(state);
  openNominations(state);
  appoint(state, "2", "1", ["1", "2", "3", "4"]);
  execute(state, state.day.nominations[0]!.id);
  assert.equal(state.winner?.reason, "saint");
  state.winner = null;
  state.phase = "day";
  state.day = {
    number: 2,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: false,
  };
  assert.equal(checkWin(state), null, "yesterday's Saint execution does not re-fire");
});

test("startNight rejects the day phase", () => {
  const state = make({
    1: "chef",
    2: "empath",
    3: "monk",
    4: "saint",
    5: "poisoner",
    6: "imp",
  });
  toDay(state);
  const result = startNight(state);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "error.68");
  assert.equal(state.phase, "day");
});

test("a sober Sailor survives execution and only a bypassing kill lands", () => {
  const state = makeBmr(
    {
      1: "sailor",
      2: "chambermaid",
      3: "courtier",
      4: "gossip",
      5: "fool",
      6: "assassin",
      7: "po",
    },
    { count: 8 },
  );
  state.phase = "day";
  state.day = {
    number: 1,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  const executed = executeByDecision(state, "1") as { ok: boolean; death?: unknown };
  assert.equal(executed.ok, true, JSON.stringify(executed));
  assert.equal(executed.death ?? null, null);
  assert.equal(state.players["1"].alive, true, "the Sailor is executed but remains alive");
  const bypass = kill(
    state,
    "1",
    "demon",
    { phase: "night", number: 1 },
    { bypassProtection: true },
  );
  assert.ok(bypass, "the Assassin's bypass still kills the Sailor");
  assert.equal(state.players["1"].alive, false);
});

test("the Zombuul's first death is recorded and keeps it from waking that night", () => {
  const state = makeBmr(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "gossip",
      5: "devilsadvocate",
      6: "zombuul",
      7: "fool",
    },
    { count: 8 },
  );
  state.phase = "day";
  state.day = {
    number: 1,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  const executed = executeByDecision(state, "6") as { ok: boolean };
  assert.equal(executed.ok, true);
  assert.equal(state.players["6"].alive, true);
  assert.equal(state.players["6"].registeredDead, true);
  const death = state.deaths.find((entry) => entry.playerId === "6");
  assert.ok(death, "the replaced death is recorded for the day");
  assert.equal(death!.cause, "execution");
  assert.equal(death!.number, 1);
  assert.equal(endDay(state).ok, true);
  assert.equal(state.night.number, 2);
  assert.equal(
    state.night.queue.some((step) => step.roleId === "zombuul"),
    false,
    "the Zombuul does not wake after the day it registered dead",
  );
});

test("the Fool is not spent when Tea Lady or Innkeeper protection prevents the death", () => {
  const tea = makeBmr(
    {
      1: "fool",
      2: "tealady",
      3: "chambermaid",
      4: "courtier",
      5: "gossip",
      6: "assassin",
      7: "po",
    },
    { count: 8 },
  );
  const at = { phase: "night" as const, number: 1 };
  assert.equal(kill(tea, "1", "demon", at), null);
  assert.equal(tea.players["1"].used.fool, undefined, "the Tea Lady was the reason");
  assert.equal(tea.players["1"].alive, true);

  const inn = makeBmr(
    {
      1: "fool",
      2: "chambermaid",
      3: "courtier",
      4: "gossip",
      5: "devilsadvocate",
      6: "po",
    },
    { count: 8 },
  );
  inn.effects.push({
    id: "innkeeper-protect",
    kind: "protected",
    bmr: "innkeeper",
    sourceId: "2",
    targetId: "1",
    start: at,
    active: true,
  });
  assert.equal(kill(inn, "1", "demon", at), null);
  assert.equal(inn.players["1"].used.fool, undefined, "the Innkeeper was the reason");
  assert.equal(inn.players["1"].alive, true);
});

function rejectionCode(result: unknown): string | undefined {
  return (result as { errorCode?: string }).errorCode;
}

test("Bad Moon Rising target modes reject dead, self and invalid targets", () => {
  const state = makeBmr(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "gossip",
      5: "devilsadvocate",
      6: "po",
    },
    { count: 8 },
  );
  startNight(state);
  kill(state, "7", "test", { phase: "night", number: 1 });
  const sailor = roleStep(state, "sailor");
  const deadSailor = completeStep(state, sailor.key, { targetIds: ["7"] });
  assert.equal(deadSailor.ok, false);
  assert.equal(rejectionCode(deadSailor), "error.55");
  assert.equal(
    completeStep(state, sailor.key, { targetIds: ["3"] }).ok,
    true,
    "the Sailor may choose themself",
  );

  const advocate = roleStep(state, "devilsadvocate");
  const deadAdvocate = completeStep(state, advocate.key, { targetIds: ["7"] });
  assert.equal(deadAdvocate.ok, false);
  assert.equal(rejectionCode(deadAdvocate), "error.55");

  const maid = roleStep(state, "chambermaid");
  const selfMaid = completeStep(state, maid.key, { targetIds: ["1", "2"] });
  assert.equal(selfMaid.ok, false);
  assert.equal(rejectionCode(selfMaid), "error.40");
  const deadMaid = completeStep(state, maid.key, { targetIds: ["7", "2"] });
  assert.equal(deadMaid.ok, false);
  assert.equal(rejectionCode(deadMaid), "error.55");
});

test("a registered-dead Zombuul is not a Tea Lady neighbour but still counts as alive", () => {
  const state = makeBmr(
    {
      1: "zombuul",
      2: "tealady",
      3: "chambermaid",
      4: "courtier",
      5: "assassin",
    },
    { count: 8 },
  );
  state.players["1"].registeredDead = true;
  const at = { phase: "night" as const, number: 1 };
  assert.equal(
    kill(state, "3", "demon", at),
    null,
    "the Tea Lady protects her real living neighbours",
  );
  assert.equal(state.players["3"].alive, true);
  assert.equal(state.players["1"].alive, true, "the Zombuul itself stays alive");
  assert.equal(livingPlayers(state).length, 8, "the game's alive count keeps the real state");
});

test("a registered-dead player does not count toward the Scarlet Woman's five", () => {
  const state = make({
    1: "scarletwoman",
    2: "imp",
    3: "chef",
    4: "empath",
    5: "monk",
  });
  // A player other abilities see as dead (the Zombuul's registered-dead state).
  state.players["3"].registeredDead = true;
  state.phase = "day";
  state.day = {
    number: 1,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  const executed = executeByDecision(state, "2") as { ok: boolean };
  assert.equal(executed.ok, true);
  assert.equal(state.players["2"].alive, false, "the Imp dies");
  assert.equal(
    state.players["1"].roleId,
    "scarletwoman",
    "five real living but four registered alive is below the threshold",
  );
  assert.equal(state.winner?.team, "good");
});

test("the Pacifist survival flag is legal only for a good target with a sober Pacifist", () => {
  const dayState = () => {
    const state = makeBmr(
      {
        1: "pacifist",
        2: "chambermaid",
        3: "courtier",
        4: "gossip",
        5: "assassin",
        6: "po",
      },
      { count: 8 },
    );
    state.phase = "day";
    state.day = {
      number: 1,
      morning: [],
      nominations: [],
      activeNominationId: null,
      execution: null,
      ended: false,
      open: true,
    };
    return state;
  };

  const evil = dayState();
  const evilResult = executeByDecision(evil, "6", { survives: true }) as {
    ok: boolean;
    errorCode?: string;
  };
  assert.equal(evilResult.ok, false);
  assert.equal(evilResult.errorCode, "error.57");
  assert.equal(evil.players["6"].alive, true);
  assert.equal(evil.day.execution, null);

  const good = dayState();
  const goodResult = executeByDecision(good, "2", { survives: true });
  assert.equal(goodResult.ok, true, JSON.stringify(goodResult));
  assert.equal(good.players["2"].alive, true);

  const poisoned = dayState();
  poisoned.effects.push({
    id: "poison-pacifist",
    kind: "poison",
    sourceId: "5",
    targetId: "1",
    start: { phase: "night", number: 1 },
    expires: { phase: "night", number: 2 },
    active: true,
  });
  const impaired = executeByDecision(poisoned, "2", { survives: true }) as {
    ok: boolean;
    errorCode?: string;
  };
  assert.equal(impaired.ok, false);
  assert.equal(impaired.errorCode, "error.57");

  const noPacifist = makeBmr(
    { 1: "fool", 2: "chambermaid", 3: "courtier", 4: "gossip", 5: "assassin", 6: "po" },
    { count: 8 },
  );
  noPacifist.phase = "day";
  noPacifist.day = {
    number: 1,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  const foolResult = executeByDecision(noPacifist, "1", { survives: true }) as {
    ok: boolean;
    errorCode?: string;
  };
  assert.equal(foolResult.ok, false, "without a Pacifist the flag cannot spare a role");
  assert.equal(foolResult.errorCode, "error.57");
  assert.equal(noPacifist.players["1"].used.fool, undefined, "the Fool's ability is not spent");
  assert.equal(noPacifist.players["1"].alive, true);
});

test("a sober Tinker dies from an ability death during the day and the night", () => {
  const state = makeBmr(
    {
      1: "tinker",
      2: "chambermaid",
      3: "courtier",
      4: "gossip",
      5: "assassin",
      6: "po",
    },
    { count: 8 },
  );
  toDay(state);
  const result = applyCommand(state, {
    id: "tinker-day",
    type: "tinkerDeath",
    payload: { playerId: "1" },
  });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["1"].alive, false);
  const death = state.deaths.at(-1)!;
  assert.equal(death.playerId, "1");
  assert.equal(death.cause, "ability");
  assert.equal(death.bmr, "tinker");

  const night = makeBmr(
    { 1: "tinker", 2: "chambermaid", 3: "courtier", 4: "gossip", 5: "assassin", 6: "po" },
    { count: 8 },
  );
  assert.equal(startNight(night).ok, true);
  const nightResult = applyCommand(night, {
    id: "tinker-night",
    type: "tinkerDeath",
    payload: { playerId: "1" },
  });
  assert.equal(nightResult.status, "allowed", JSON.stringify(nightResult));
  assert.equal(night.players["1"].alive, false);

  const other = makeBmr(
    { 1: "chambermaid", 2: "tinker", 3: "courtier", 4: "gossip", 5: "assassin", 6: "po" },
    { count: 8 },
  );
  assert.equal(startNight(other).ok, true);
  const wrong = applyCommand(other, {
    id: "tinker-wrong",
    type: "tinkerDeath",
    payload: { playerId: "1" },
  });
  assert.equal(wrong.status, "rejected");
  assert.equal(wrong.errorCode, "error.58");
});

test("the Klutz public choice runs through the command surface", () => {
  const state = makeSnv({ 1: "klutz", 2: "clockmaker", 3: "witch", 7: "fanggu" }, { count: 7 });
  state.players["1"].alive = false;
  const result = applyCommand(state, {
    id: "klutz-choice",
    type: "recordKlutzChoice",
    payload: { targetId: "2" },
  });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["1"].used.klutz, true);
  assert.equal(state.players["1"].used.klutzTarget, "2");
  const missing = applyCommand(state, {
    id: "klutz-missing",
    type: "recordKlutzChoice",
    payload: {},
  });
  assert.equal(missing.status, "rejected");
});

test("a Juggler with zero guesses still answers on the night after their first day", () => {
  const state = makeSnv({ 1: "juggler", 2: "clockmaker", 3: "witch", 7: "fanggu" }, { count: 7 });
  toDay(state);
  const empty = applyCommand(state, {
    id: "juggler-empty",
    type: "jugglerGuess",
    payload: { guesses: [] },
  });
  assert.equal(empty.status, "allowed", JSON.stringify(empty));
  assert.equal(state.juggler?.day, 1);
  assert.deepEqual(state.juggler?.guesses, []);
  assert.equal(endDay(state).ok, true);
  assert.equal(state.phase, "night");
  const step = state.night.queue.find((candidate) => candidate.roleId === "juggler");
  assert.ok(step, "the Juggler answers on the night after their first day");
  const info = infoForStep(state, step);
  assert.equal(info.kind, "number");
  assert.equal(info.value, 0);

  const noGuesses = makeSnv(
    { 1: "juggler", 2: "clockmaker", 3: "witch", 7: "fanggu" },
    { count: 7 },
  );
  toDay(noGuesses);
  assert.equal(endDay(noGuesses).ok, true);
  assert.deepEqual(noGuesses.juggler, { day: 1, guesses: [] });
  const zeroStep = noGuesses.night.queue.find((candidate) => candidate.roleId === "juggler");
  assert.ok(zeroStep, "a Juggler who never guessed still wakes");
});

test("a nomination execution of the Demon arms the Mastermind", () => {
  const state = makeBmr(
    {
      1: "mastermind",
      2: "sailor",
      3: "chambermaid",
      4: "exorcist",
      5: "pacifist",
      6: "innkeeper",
      7: "tinker",
      8: "po",
    },
    { count: 8 },
  );
  startNight(state);
  skipNight(state);
  openNominations(state);
  const nomination = nominate(state, "2", "8").nomination!;
  assert.equal(recordVotes(state, nomination.id, ["2", "3", "4", "5"]).ok, true);
  const result = execute(state, nomination.id);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(state.winner, null, "the Mastermind suppresses the Demon-dead win");
  assert.equal(state.mastermind?.active, true, "the Mastermind arms the extra day");
});
