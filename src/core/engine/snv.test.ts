import test from "node:test";
import assert from "node:assert/strict";
import {
  SNV,
  SNV_ALL,
  SV_NIGHT_FIRST,
  SV_NIGHT_OTHER,
  bagErrors,
  compositionFor,
  isSnvRole,
  isSupportedRole,
  randomBag,
  roleTeam,
} from "../model/rules.ts";
import {
  createGame,
  exportGame,
  importGame,
  publicGameView,
  publicRoleView,
  realTeamOf,
  setRoster,
  validateState,
} from "../model/state.ts";
import {
  applyCommand,
  appendConditionalSteps,
  buildSvNightQueue,
  checkWin,
  completeStep,
  currentStep,
  dealGame,
  endDay,
  endNight,
  executeByDecision,
  infoForStep,
  isImpaired,
  madnessEffects,
  activeMadness,
  madnessReviewsDue,
  MADNESS_PENALTIES,
  jugglerGuess,
  kill,
  nominate,
  openNominations,
  reconcileVigormortisPoison,
  recordKlutzChoice,
  recordSvOutcome,
  recordVotes,
  replaceCharacter,
  setupErrors,
  startNight,
} from "./index.ts";
import { reconcileNoDashiiPoison } from "./index.ts";
import { minionRetainsAbility } from "./retention.ts";
import { parseScript, sectsAndVioletsScript } from "../model/scripts.ts";
import type { GameState, NightStep, RoleId, Role } from "../model/types.ts";
import type { InfoResult } from "./index.ts";

type MakeOptions = { count?: number };

// completeStep returns several structural shapes; this view names the fields
// the tests read after an ok/needsChoice assertion.
type StepOutcome = {
  ok: boolean;
  errorCode?: string;
  error?: string;
  needsChoice?: boolean;
  step?: NightStep;
};

function stepOutcome(value: unknown): StepOutcome {
  return value as StepOutcome;
}

function make(assignment: Record<string, RoleId>, options: MakeOptions = {}): GameState {
  const count = options.count || Object.keys(assignment).length;
  const state = createGame(count);
  state.script = sectsAndVioletsScript();
  state.scriptId = "snv";
  state.setup.count = count;
  const required = [...new Set(Object.values(assignment))];
  const counts: Record<string, number> = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const id of required) counts[roleTeam(id)!] += 1;
  const target = compositionFor(count, required)!;
  const roles = [...required];
  for (const team of ["outsider", "townsfolk", "minion", "demon"] as const) {
    const need = target[team] - counts[team];
    assert.ok(need >= 0, "too many " + team + " in fixture");
    const pool = SNV[team].filter((id) => !roles.includes(id));
    assert.ok(pool.length >= need, "not enough " + team + " roles for fixture");
    roles.push(...pool.slice(0, need));
  }
  state.setup.roles = roles;
  state.setup.bluffs = SNV_ALL.filter((id) => !roles.includes(id)).slice(0, count >= 7 ? 3 : 0);
  state.setup.evilTwinGoodId = roles.includes("eviltwin")
    ? roles.find((id) => roleTeam(id) === "townsfolk" || roleTeam(id) === "outsider")!
    : null;
  const full = { ...assignment };
  const spare = roles.filter((id) => !required.includes(id));
  for (const id of state.order) {
    if (!full[id]) full[id] = spare.shift()!;
  }
  const result = dealGame(state, { assignment: full });
  assert.equal(result.ok, true, JSON.stringify(result));
  for (const id of state.order) state.players[id].name = "P" + id;
  return state;
}

function finishNight(state: GameState): void {
  for (let guard = 0; guard < 40; guard += 1) {
    const step = currentStep(state);
    if (!step) return;
    const pool = state.order.filter((id) => state.players[id].alive && id !== step.actorId);
    const targets = pool.slice(0, step.minTargets || 0);
    const options: { targetIds: string[]; given?: Record<string, unknown> } = {
      targetIds: targets,
    };
    const info = infoForStep(state, step, { targetIds: targets });
    if (info.needsChoice) options.given = falseInfo(info);
    completeStep(state, step.key, options);
  }
  throw new Error("night did not finish");
}

test("Sects and Violets roster and composition follow the official data", () => {
  assert.equal(SNV_ALL.length, 25);
  assert.deepEqual(
    [SNV.townsfolk.length, SNV.outsider.length, SNV.minion.length, SNV.demon.length],
    [13, 4, 4, 4],
  );
  for (const id of SNV_ALL) assert.equal(isSnvRole(id), true);
  assert.equal(isSupportedRole("vanggu"), false);
  assert.equal(isSupportedRole("fanggu"), true);
  assert.deepEqual(compositionFor(8, ["fanggu"]), {
    townsfolk: 4,
    outsider: 2,
    minion: 1,
    demon: 1,
  });
  assert.deepEqual(compositionFor(8, ["vigormortis"]), {
    townsfolk: 6,
    outsider: 0,
    minion: 1,
    demon: 1,
  });
  assert.deepEqual(SV_NIGHT_FIRST, [
    "philosopher",
    "info",
    "snakecharmer",
    "eviltwin",
    "witch",
    "cerenovus",
    "clockmaker",
    "dreamer",
    "seamstress",
    "mathematician",
  ]);
  assert.equal(SV_NIGHT_OTHER.length, 19);
  assert.equal(SV_NIGHT_OTHER.at(-1), "mathematician");
});

test("random Sects and Violets bags are legal at every player count", () => {
  for (const count of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
    const bag = randomBag(count, Math.random, SNV_ALL);
    const errors = bagErrors({ count, roles: bag.roles, bluffs: bag.bluffs, pool: SNV_ALL });
    assert.deepEqual(errors, [], count + ": " + JSON.stringify(errors));
  }
});

test("a seven-player Vigormortis bag is legal with no Outsider to remove", () => {
  // Vigormortis r3015: "if there are no Outsider tokens to remove, do not add
  // a Townsfolk token". The base composition at seven players has no Outsider,
  // so the -1 Outsider changes nothing and the bag stays legal.
  assert.deepEqual(compositionFor(7, ["vigormortis"]), {
    townsfolk: 5,
    outsider: 0,
    minion: 1,
    demon: 1,
  });
  const roles: RoleId[] = [...SNV.townsfolk.slice(0, 5), SNV.minion[0]!, "vigormortis"];
  assert.equal(roles.length, 7);
  const bluffs = SNV_ALL.filter((id) => !roles.includes(id)).slice(0, 3);
  const errors = bagErrors({ count: 7, roles, bluffs, pool: SNV_ALL });
  assert.equal(
    errors.some((error) => error.code === "vigormortis-minus"),
    false,
    "the Vigormortis is not blamed for an Outsider it never removes",
  );
  assert.deepEqual(errors, []);
});

test("an Sects and Violets game deals, validates and builds the first night", () => {
  const state = make({ 1: "clockmaker", 6: "eviltwin", 7: "vortox" }, { count: 7 });
  assert.deepEqual(setupErrors(state), []);
  assert.deepEqual(validateState(state), []);
  assert.equal(startNight(state).ok, true);
  const queue = state.night.queue.map((step) => step.roleId || step.system);
  assert.ok(queue.includes("minioninfo"));
  assert.ok(queue.includes("demoninfo"));
  assert.ok(queue.includes("eviltwin"));
  assert.ok(queue.includes("clockmaker"));
  assert.equal(queue.includes("witch"), false);
  assert.equal(
    infoForStep(
      state,
      state.night.queue.find((step) => step.roleId === "clockmaker")!,
    ).kind,
    "number",
  );
});

test("the Clockmaker learns the distance from the Demon to its nearest Minion", () => {
  const state = make({ 1: "clockmaker", 7: "eviltwin", 6: "vortox" }, { count: 7 });
  startNight(state);
  const step = state.night.queue.find((candidate) => candidate.roleId === "clockmaker")!;
  const info = infoForStep(state, step);
  assert.equal(info.kind, "number");
  assert.equal(info.value, 1);
});

test("executing the good Evil Twin wins the game for evil", () => {
  const state = make({ 1: "clockmaker", 6: "eviltwin", 7: "vortox" }, { count: 7 });
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
  executeByDecision(state, "1");
  assert.equal(state.winner!.team, "evil");
  assert.equal(state.winner!.reason, "evil-twin");
});

test("the Vortox wins when the day ends without an execution", () => {
  const state = make({ 1: "clockmaker", 7: "vortox" }, { count: 7 });
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
  checkWin(state, { endOfDay: true });
  assert.equal(state.winner!.team, "evil");
  assert.equal(state.winner!.reason, "vortox");
});

test("the Witch curse kills the nominator but keeps the nomination", () => {
  const state = make({ 1: "clockmaker", 6: "witch", 7: "fanggu" }, { count: 7 });
  startNight(state);
  const witch = state.night.queue.find((step) => step.roleId === "witch")!;
  assert.ok(witch);
  assert.equal(completeStep(state, witch.key, { targetIds: ["1"] }).ok, true);
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
  const result = nominate(state, "1", "2");
  assert.equal(result.ok, true);
  assert.equal(result.curse, true);
  assert.equal(result.nomination.nominatorId, "1");
  assert.equal(result.nomination.nomineeId, "2");
  assert.equal(state.players["1"].alive, false, "the cursed nominator dies");
  assert.equal(state.day.nominations.length, 1, "the nomination is still recorded");
  assert.equal(
    state.day.activeNominationId,
    result.nomination.id,
    "the nomination can still be voted on",
  );
  assert.equal(state.day.ended, false, "the game continues");
  const voters = state.order.filter((id) => state.players[id].alive);
  const votes = recordVotes(state, result.nomination.id, voters);
  assert.equal(votes.ok, true, votes.error);
  assert.equal(
    votes.nomination!.count,
    voters.length,
    "the surviving players still vote on the cursed nominator's nomination",
  );
});

test("a curse the Witch placed still kills the next nomination after the Witch dies or is impaired", () => {
  // Witch r3013: the curse is placed on the player and resolves on their next
  // nomination. Losing the ability later does not remove a placed curse; the
  // only removal is "if just 3 players live".
  for (const impair of ["dead", "poison"]) {
    const state = make({ 1: "clockmaker", 6: "witch", 7: "fanggu" }, { count: 7 });
    startNight(state);
    const witch = state.night.queue.find((step) => step.roleId === "witch")!;
    completeStep(state, witch.key, { targetIds: ["1"] });
    if (impair === "dead") {
      state.players["6"].alive = false;
    } else {
      state.effects.push({
        id: "test-poison",
        kind: "poison",
        sourceId: "7",
        targetId: "6",
        start: { phase: "night", number: 1 },
        expires: { phase: "night", number: 2 },
        active: true,
      });
    }
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
    const result = nominate(state, "1", "2");
    assert.equal(result.ok, true, impair);
    assert.equal(result.curse, true, impair + ": the placed curse still resolves");
    assert.equal(state.players["1"].alive, false, impair + ": the cursed nominator dies");
    assert.equal(state.day.nominations.length, 1, impair + ": the nomination stands");
  }
});

test("the Witch loses a placed curse only when exactly three players live", () => {
  const state = make({ 1: "clockmaker", 6: "witch", 7: "fanggu" }, { count: 7 });
  startNight(state);
  const witch = state.night.queue.find((step) => step.roleId === "witch")!;
  completeStep(state, witch.key, { targetIds: ["1"] });
  for (const id of ["3", "4", "5", "6"]) state.players[id].alive = false;
  assert.equal(state.order.filter((id) => state.players[id].alive).length, 3);
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
  const result = nominate(state, "1", "2");
  assert.equal(result.ok, true);
  assert.equal(result.curse, false, "with three living the Witch has no ability");
  assert.equal(state.players["1"].alive, true);
});

test("a first Outsider death makes the Outsider the new Fang Gu and kills the old Demon", () => {
  const state = make({ 1: "klutz", 2: "clockmaker", 7: "fanggu" }, { count: 7 });
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  const step = state.night.queue.find((candidate) => candidate.roleId === "fanggu")!;
  assert.ok(step, "Fang Gu wakes on a later night");
  completeStep(state, step.key, { targetIds: ["1"] });
  recordSvOutcome(state, step.key, { deathIds: ["1"] });
  assert.equal(state.players["1"].alive, true, "the Outsider survives as the new Fang Gu");
  assert.equal(state.players["1"].roleId, "fanggu");
  assert.equal(state.players["1"].team, "evil");
  assert.equal(state.players["7"].alive, false, "the old Demon dies");
  assert.equal(state.winner, null, "a Demon is still alive");
});

test("the No Dashii poisons the nearest Townsfolk even when that seat is dead", () => {
  const state = make(
    {
      2: "clockmaker",
      3: "dreamer",
      4: "nodashii",
      5: "artist",
      6: "juggler",
    },
    { count: 7 },
  );
  state.players["3"].alive = false;
  startNight(state);
  const poisoned = state.effects.filter((effect) => effect.kind === "poison");
  assert.equal(
    poisoned.some((effect) => effect.targetId === "3"),
    true,
    "the dead Townsfolk at seat 3 is still the nearest Townsfolk",
  );
  assert.equal(
    poisoned.some((effect) => effect.targetId === "2"),
    false,
    "the living Townsfolk farther away is not poisoned",
  );
});

test("No Dashii poison is reconciled when the source or a target changes character", () => {
  const state = make(
    {
      2: "clockmaker",
      3: "dreamer",
      4: "nodashii",
      5: "artist",
      6: "juggler",
    },
    { count: 7 },
  );
  startNight(state);
  const initial = state.effects.filter(
    (effect) => effect.kind === "poison" && effect.sourceId === "4",
  );
  assert.ok(initial.length > 0);
  state.players["4"].roleId = "vortox";
  reconcileNoDashiiPoison(state);
  assert.ok(
    initial.every((effect) => effect.active === false),
    "poison from a source that is no longer the No Dashii is removed",
  );

  const next = make(
    {
      2: "clockmaker",
      3: "dreamer",
      4: "nodashii",
      5: "artist",
      6: "juggler",
    },
    { count: 7 },
  );
  startNight(next);
  const before = next.effects.filter(
    (effect) => effect.kind === "poison" && effect.targetId === "3",
  );
  assert.ok(before.length);
  next.players["3"].roleId = "klutz";
  reconcileNoDashiiPoison(next);
  assert.ok(
    before.every((effect) => effect.active === false),
    "poison on a former Townsfolk target is removed",
  );
  assert.ok(
    next.effects.some(
      (effect) => effect.kind === "poison" && effect.targetId === "2" && effect.active,
    ),
    "the new nearest Townsfolk is poisoned",
  );
});

test("a custom all-Sects-and-Violets script is accepted and a mixed one is rejected", () => {
  const script = sectsAndVioletsScript();
  assert.equal(script.id, "snv");
  assert.equal(script.edition, "snv");
  assert.equal(script.roles.length, 25);
  assert.deepEqual(script.roles, SNV_ALL);
});

test("the Evil Twin setup requires a good twin", () => {
  const state = make({ 1: "clockmaker", 7: "eviltwin", 6: "vortox" }, { count: 7 });
  state.setup.evilTwinGoodId = null;
  assert.ok(setupErrors(state).some((error) => error.code === "evil-twin-good"));
});

test("the script parser accepts a full Sects and Violets custom script and rejects mixing", () => {
  const catalog: Role[] = SNV_ALL.flatMap((id) => {
    const team = roleTeam(id);
    return team ? [{ id, name: id, team, edition: "snv" }] : [];
  });
  catalog.push({ id: "washerwoman", name: "Washerwoman", team: "townsfolk", edition: "tb" });
  const all = parseScript(JSON.stringify(SNV_ALL.map((id) => ({ id }))), catalog);
  if (!all.ok) assert.fail(all.error);
  assert.equal(all.script.roles.length, 25);
  assert.equal(all.script.edition, "custom");
  const mixed = parseScript(
    JSON.stringify([...SNV_ALL.map((id) => ({ id })), { id: "washerwoman" }]),
    catalog,
  );
  if (mixed.ok) assert.fail("a mixed script must be rejected");
  assert.match(mixed.error, /Смешивать/);
});

test("the Fang Gu jump can happen only once per game", () => {
  // Wiki r2974: "This can only happen once per game. If the new Fang Gu
  // attacks an Outsider, the Outsider dies as normal." The ONCE reminder
  // stays in the centre even if the Fang Gu dies or changes character.
  const state = make({ 1: "klutz", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  const otherOutsider = state.order.find(
    (id) => id !== "1" && roleTeam(state.players[id].roleId || "") === "outsider",
  )!;
  assert.ok(otherOutsider, "the +1 Outsider setup puts a second Outsider in play");
  const otherRole = state.players[otherOutsider].roleId;

  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);

  let step = state.night.queue.find((candidate) => candidate.roleId === "fanggu");
  assert.ok(step, "Fang Gu wakes on a later night");
  completeStep(state, step.key, { targetIds: ["1"] });
  recordSvOutcome(state, step.key, { deathIds: ["1"] });
  assert.equal(state.players["1"].roleId, "fanggu");
  assert.equal(state.players["8"].alive, false);

  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);

  step = state.night.queue.find((candidate) => candidate.roleId === "fanggu");
  assert.ok(step, "the new Fang Gu wakes next night");
  assert.equal(step.actorId, "1");
  completeStep(state, step.key, { targetIds: [otherOutsider] });
  recordSvOutcome(state, step.key, { deathIds: [otherOutsider] });

  assert.equal(state.players[otherOutsider].alive, false, "the second Outsider dies as normal");
  assert.equal(
    state.players[otherOutsider].roleId,
    otherRole,
    "no second jump: the Outsider keeps its role",
  );
  assert.equal(state.players["1"].alive, true, "the new Fang Gu survives");
  assert.equal(state.players["1"].roleId, "fanggu");
});

test("redealing starts a fresh game with the Fang Gu limit available", () => {
  const state = make({ 1: "klutz", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  const assignment: Record<string, RoleId> = Object.fromEntries(
    state.order.map((id) => [id, state.players[id].roleId!]),
  );
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  const step = state.night.queue.find((candidate) => candidate.roleId === "fanggu")!;
  completeStep(state, step.key, { targetIds: ["1"] });
  recordSvOutcome(state, step.key, { deathIds: ["1"] });
  assert.equal(state.fangguJumped, true);

  const redeal = dealGame(state, { assignment });
  assert.equal(redeal.ok, true, JSON.stringify(redeal));
  assert.equal(state.fangguJumped, false, "a fresh deal clears the ONCE reminder");
  assert.equal(state.players["1"].roleId, "klutz");
  assert.equal(state.players["8"].roleId, "fanggu");
});

test("a save without the game-scoped flag still honours the old Fang Gu marker", () => {
  const state = make({ 1: "klutz", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  const otherOutsider = state.order.find(
    (id) => id !== "1" && roleTeam(state.players[id].roleId || "") === "outsider",
  )!;
  const otherRole = state.players[otherOutsider].roleId;

  reachFangGuNight(state);
  jumpFangGu(state, "1");
  assert.equal(state.fangguJumped, true);
  assert.equal(state.players["8"].used.fanggu, true, "the old code marked the acting Demon");

  // A save written before the game-scoped flag existed has only this marker.
  Reflect.deleteProperty(state, "fangguJumped");
  assert.deepEqual(validateState(state), []);

  nextNight(state);
  jumpFangGu(state, otherOutsider);

  assert.equal(state.players[otherOutsider].alive, false);
  assert.equal(state.players[otherOutsider].roleId, otherRole, "no second jump from a legacy save");
  assert.equal(state.players["1"].alive, true);
  assert.equal(state.players["1"].roleId, "fanggu");
});

test("setRoster clears the Fang Gu limit and a fresh deal allows one jump", () => {
  const state = make({ 1: "klutz", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  const assignment: Record<string, RoleId> = Object.fromEntries(
    state.order.map((id) => [id, state.players[id].roleId!]),
  );
  const roles = state.setup.roles.slice();
  const bluffs = state.setup.bluffs.slice();

  reachFangGuNight(state);
  jumpFangGu(state, "1");
  assert.equal(state.fangguJumped, true);

  setRoster(state, 8);
  assert.equal(state.fangguJumped, false, "setRoster clears the ONCE reminder");
  state.setup.roles = roles;
  state.setup.bluffs = bluffs;
  const redeal = dealGame(state, { assignment });
  assert.equal(redeal.ok, true, JSON.stringify(redeal));

  reachFangGuNight(state);
  jumpFangGu(state, "1");
  assert.equal(state.fangguJumped, true, "a fresh game allows its first jump");
  assert.equal(state.players["1"].roleId, "fanggu");
  assert.equal(state.players["8"].alive, false);
});

test("a bag reset clears the Fang Gu once-per-game limit", async () => {
  const { applyCommand } = await import("./index.ts");
  const state = make({ 1: "klutz", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  reachFangGuNight(state);
  jumpFangGu(state, "1");
  assert.equal(state.fangguJumped, true);

  const reset = applyCommand(state, {
    id: "reset-bag",
    type: "bagUpdate",
    payload: { patch: { count: 8 } },
  });
  assert.equal(reset.status, "allowed", JSON.stringify(reset));
  assert.equal(state.fangguJumped, false, "the setup reset clears the ONCE reminder");
  assert.equal(state.phase, "setup");
});

test("the Fang Gu limit survives an export and import", () => {
  const state = make({ 1: "klutz", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  const otherOutsider = state.order.find(
    (id) => id !== "1" && roleTeam(state.players[id].roleId || "") === "outsider",
  )!;
  const otherRole = state.players[otherOutsider].roleId;

  reachFangGuNight(state);
  jumpFangGu(state, "1");
  assert.equal(state.fangguJumped, true);

  const restored = importGame(exportGame(state));
  if (!restored.ok) assert.fail(restored.error);
  assert.equal(restored.state.fangguJumped, true, "the ONCE reminder is persisted");

  const next = restored.state;
  nextNight(next);
  jumpFangGu(next, otherOutsider);

  assert.equal(next.players[otherOutsider].alive, false, "the second Outsider dies as normal");
  assert.equal(next.players[otherOutsider].roleId, otherRole);
  assert.equal(next.players["1"].alive, true);
  assert.equal(next.players["1"].roleId, "fanggu");
});

function reachFangGuNight(state: GameState): NightStep {
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  const step = state.night.queue.find((candidate) => candidate.roleId === "fanggu")!;
  assert.ok(step, "Fang Gu wakes on a later night");
  return step;
}

function jumpFangGu(state: GameState, targetId: string): void {
  const step = state.night.queue.find((candidate) => candidate.roleId === "fanggu")!;
  assert.ok(step, "Fang Gu wakes on a later night");
  completeStep(state, step.key, { targetIds: [targetId] });
  recordSvOutcome(state, step.key, { deathIds: [targetId] });
}

function nextNight(state: GameState): void {
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
}

// ---------------------------------------------------------------------------
// Character and team replacements (Pit-Hag, Barber, Snake Charmer, Philosopher)

function laterNight(state: GameState): NightStep[] {
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  for (const effect of madnessReviewsDue(state)) {
    const result = applyCommand(state, {
      id: "test-madness-review-" + effect.id + "-" + state.day.number,
      type: "madnessPenalty",
      payload: {
        playerId: effect.targetId,
        effectId: effect.id,
        penalty: "none",
        reason: "The test Storyteller reviewed the player.",
      },
    });
    assert.equal(result.status, "allowed", JSON.stringify(result));
  }
  assert.equal(endDay(state).ok, true);
  return state.night.queue;
}

function stepFor(state: GameState, roleId: string): NightStep {
  const step = state.night.queue.find((candidate) => candidate.roleId === roleId);
  assert.ok(step, roleId + " has a night step");
  return step;
}

function runStep(state: GameState, id: string, payload: Record<string, unknown>) {
  return applyCommand(state, { id, type: "completeNightStep", payload });
}

function rolesInPlay(state: GameState): Array<RoleId | null> {
  return Object.values(state.players).map((player) => player.roleId);
}

function assertNoDuplicateCharacters(state: GameState): void {
  const roles = rolesInPlay(state);
  assert.equal(
    new Set(roles).size,
    roles.length,
    "no duplicate characters: " + JSON.stringify(roles),
  );
}

test("the Pit-Hag replaces a character atomically", () => {
  const state = make({ 1: "clockmaker", 6: "pithag", 7: "fanggu" }, { count: 7 });
  laterNight(state);
  const step = stepFor(state, "pithag");
  const target = state.order.find(
    (id) => id !== "1" && roleTeam(state.players[id].roleId || "") === "townsfolk",
  )!;
  const previous = state.players[target].roleId;
  // An evil character proves that the alignment does not follow the change.
  const roleId = SNV.minion.find((id) => !rolesInPlay(state).includes(id));
  assert.ok(roleId, "an absent Minion role exists");
  state.bluffs = [roleId, ...state.bluffs];

  const result = runStep(state, "pithag-create", { key: step.key, targetIds: [target], roleId });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players[target].roleId, roleId);
  assert.equal(state.players[target].shownRoleId, roleId);
  assert.equal(state.players[target].changedFrom, previous);
  assert.equal(state.players[target].team, "good", "the character changes, the alignment does not");
  assert.equal(state.bluffs.includes(roleId), false, "the new character leaves the bluffs");
  assertNoDuplicateCharacters(state);
  assert.deepEqual(validateState(state), []);
});

test("the Pit-Hag choosing a character already in play records that nothing happens", () => {
  const state = make({ 1: "clockmaker", 6: "pithag", 7: "fanggu" }, { count: 7 });
  laterNight(state);
  const step = stepFor(state, "pithag");
  assert.ok(
    (step.roleChoices || []).includes("clockmaker"),
    "a character already in play stays selectable so the no-op is recordable",
  );
  const target = "2";
  const previous = state.players[target].roleId;

  const result = runStep(state, "pithag-duplicate", {
    key: step.key,
    targetIds: [target],
    roleId: "clockmaker",
  });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players[target].roleId, previous, "the character does not change");
  const finished = state.night.queue.find((candidate) => candidate.key === step.key)!;
  assert.equal(finished.done, true, "the step is complete");
  assert.equal(finished.noteKey, "note.pithagInPlay");
  assert.match(finished.note || "", /уже в игре/, "the host is told nothing happens");
  assertNoDuplicateCharacters(state);
});

test("a Pit-Hag change that removes the Demon wins the game for good", () => {
  const state = make({ 1: "clockmaker", 6: "pithag", 7: "fanggu" }, { count: 7 });
  laterNight(state);
  const step = stepFor(state, "pithag");
  const roleId = SNV.townsfolk.find((id) => !rolesInPlay(state).includes(id));

  const result = runStep(state, "pithag-demon", { key: step.key, targetIds: ["7"], roleId });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["7"].roleId, roleId);
  assert.equal(state.winner && state.winner.team, "good");
  assert.equal(state.winner!.reason, "demon-dead");
});

test("the Snake Charmer swaps characters and alignments with the chosen Demon", () => {
  const state = make({ 1: "clockmaker", 6: "snakecharmer", 7: "fanggu" }, { count: 7 });
  laterNight(state);
  const step = stepFor(state, "snakecharmer");

  const result = runStep(state, "snake-swap", { key: step.key, targetIds: ["7"] });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["6"].roleId, "fanggu");
  assert.equal(state.players["6"].team, "evil");
  assert.equal(state.players["7"].roleId, "snakecharmer");
  assert.equal(state.players["7"].team, "good");
  const poison = state.effects.find(
    (effect) => effect.kind === "poison" && effect.targetId === "7" && effect.active,
  );
  assert.ok(poison, "the new Snake Charmer is poisoned");
  assert.equal(poison.expires, null, "the poison is permanent");
  assertNoDuplicateCharacters(state);
  const demonStep = state.night.queue.find(
    (candidate) => candidate.roleId === "fanggu" && !candidate.done && !candidate.skipped,
  );
  assert.ok(demonStep, "the new Demon wakes tonight in the Demon slot");
  assert.equal(demonStep.actorId, "6");
  assert.equal(
    state.night.queue.filter(
      (candidate) => candidate.actorId === "7" && !candidate.done && !candidate.skipped,
    ).length,
    0,
    "the new Snake Charmer does not wake again this night",
  );
  assert.deepEqual(validateState(state), []);
});

test("the Snake Charmer leaves a non-Demon target unchanged", () => {
  const state = make({ 1: "clockmaker", 6: "snakecharmer", 7: "fanggu" }, { count: 7 });
  laterNight(state);
  const step = stepFor(state, "snakecharmer");
  const beforeTarget = state.players["1"].roleId;
  const beforeActor = state.players["6"].roleId;

  const result = runStep(state, "snake-non-demon", { key: step.key, targetIds: ["1"] });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["1"].roleId, beforeTarget);
  assert.equal(state.players["6"].roleId, beforeActor);
  assert.equal(
    state.effects.some((effect) => effect.kind === "poison"),
    false,
    "no poison without a swap",
  );
});

test("the Snake Charmer cannot choose a dead player", () => {
  const state = make({ 1: "clockmaker", 6: "snakecharmer", 7: "fanggu" }, { count: 7 });
  laterNight(state);
  const step = stepFor(state, "snakecharmer");
  state.players["7"].alive = false;

  const result = runStep(state, "snake-dead", { key: step.key, targetIds: ["7"] });
  assert.equal(result.status, "rejected", JSON.stringify(result));
  assert.equal(result.errorCode, "error.55", "a dead target is rejected with error.55");
  assert.equal(state.players["6"].roleId, "snakecharmer");
  assert.equal(state.players["7"].roleId, "fanggu");
  assert.equal(
    state.effects.some((effect) => effect.kind === "poison"),
    false,
    "a dead target cannot be swapped",
  );
  assert.equal(state.night.queue.find((candidate) => candidate.key === step.key)!.done, false);
});

test("the Snake Charmer's poison outlives the new Demon", () => {
  const state = make({ 1: "clockmaker", 6: "snakecharmer", 7: "fanggu" }, { count: 7 });
  laterNight(state);
  const step = stepFor(state, "snakecharmer");
  const result = runStep(state, "snake-permanent-poison", { key: step.key, targetIds: ["7"] });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(isImpaired(state, "7"), true, "the new Snake Charmer is poisoned");

  state.players["6"].alive = false;
  assert.equal(isImpaired(state, "7"), true, "the poison does not end when the Demon dies");
  assert.deepEqual(validateState(state), []);
});

test("a No Dashii reconcile keeps the Snake Charmer's permanent poison", () => {
  const state = make(
    { 1: "clockmaker", 2: "dreamer", 3: "artist", 4: "nodashii", 8: "snakecharmer" },
    { count: 8 },
  );
  laterNight(state);
  const step = stepFor(state, "snakecharmer");
  const result = runStep(state, "snake-nodashii", { key: step.key, targetIds: ["4"] });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["8"].roleId, "nodashii");
  assert.equal(state.players["4"].roleId, "snakecharmer");
  assert.equal(isImpaired(state, "4"), true, "poisoned right after the swap");

  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);

  const poison = state.effects.find(
    (effect) => effect.permanent === true && effect.targetId === "4",
  );
  assert.ok(poison);
  assert.equal(poison.active, true, "the No Dashii reconcile leaves it active");
  assert.equal(isImpaired(state, "4"), true, "the new Snake Charmer stays poisoned");
});

test("an evil Snake Charmer and the Demon both stay evil", () => {
  const state = make({ 1: "clockmaker", 6: "snakecharmer", 7: "fanggu" }, { count: 7 });
  laterNight(state);
  state.players["6"].team = "evil";
  const step = stepFor(state, "snakecharmer");

  const result = runStep(state, "snake-evil", { key: step.key, targetIds: ["7"] });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["6"].roleId, "fanggu");
  assert.equal(state.players["6"].team, "evil");
  assert.equal(state.players["7"].roleId, "snakecharmer");
  assert.equal(state.players["7"].team, "evil");
});

test("the Barber swap exchanges two characters after the Barber dies", () => {
  const state = make({ 1: "clockmaker", 2: "barber", 6: "pithag", 8: "fanggu" }, { count: 8 });
  laterNight(state);
  const pithag = stepFor(state, "pithag");
  const roleId = SNV.townsfolk.find((id) => !rolesInPlay(state).includes(id));
  const kill = runStep(state, "pithag-barber-death", {
    key: pithag.key,
    targetIds: ["3"],
    roleId,
    deathIds: ["2"],
  });
  assert.equal(kill.status, "allowed", JSON.stringify(kill));
  assert.equal(state.players["2"].alive, false);

  const barber = stepFor(state, "barber");
  const before3 = state.players["3"].roleId;
  const before4 = state.players["4"].roleId;
  const team3 = state.players["3"].team;
  const team4 = state.players["4"].team;
  const result = runStep(state, "barber-swap", { key: barber.key, targetIds: ["3", "4"] });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["3"].roleId, before4);
  assert.equal(state.players["4"].roleId, before3);
  assert.equal(state.players["3"].team, team3, "a Barber swap does not change alignment");
  assert.equal(state.players["4"].team, team4, "a Barber swap does not change alignment");
  assertNoDuplicateCharacters(state);
  assert.deepEqual(validateState(state), []);
});

test("the Barber rejects another Demon but allows the Demon to swap itself", () => {
  const state = make({ 1: "clockmaker", 2: "barber", 6: "pithag", 8: "fanggu" }, { count: 8 });
  laterNight(state);
  const pithag = stepFor(state, "pithag");
  const created = runStep(state, "pithag-second-demon", {
    key: pithag.key,
    targetIds: ["3"],
    roleId: "vortox",
    deathIds: ["2"],
  });
  assert.equal(created.status, "allowed", JSON.stringify(created));
  const barber = stepFor(state, "barber");

  const rejected = runStep(state, "barber-two-demons", {
    key: barber.key,
    targetIds: ["3", "8"],
  });
  assert.equal(rejected.status, "rejected", JSON.stringify(rejected));
  assert.equal(state.players["3"].roleId, "vortox");

  const beforeDemon = state.players["3"].roleId;
  const before4 = state.players["4"].roleId;
  const ownSwap = runStep(state, "barber-self", { key: barber.key, targetIds: ["3", "4"] });
  assert.equal(ownSwap.status, "allowed", JSON.stringify(ownSwap));
  assert.equal(state.players["3"].roleId, before4);
  assert.equal(state.players["4"].roleId, beforeDemon);
});

function evilTwinBarberSwap(state: GameState) {
  laterNight(state);
  const pithag = stepFor(state, "pithag");
  const roleId = SNV.townsfolk.find((id) => !rolesInPlay(state).includes(id));
  const kill = runStep(state, "pithag-twin-death", {
    key: pithag.key,
    targetIds: ["3"],
    roleId,
    deathIds: ["2"],
  });
  assert.equal(kill.status, "allowed", JSON.stringify(kill));
  const barber = stepFor(state, "barber");
  const result = runStep(state, "barber-twin-third", {
    key: barber.key,
    targetIds: [state.setup.evilTwinGoodPlayerId, "3"],
  });
  assert.equal(result.status, "allowed", JSON.stringify(result));
}

test("the Evil Twin win follows the good twin after a character swap", () => {
  const state = make(
    { 1: "clockmaker", 2: "barber", 6: "eviltwin", 7: "pithag", 11: "fanggu" },
    { count: 11 },
  );
  const goodTwin = state.setup.evilTwinGoodPlayerId;
  const evilTwin = state.setup.evilTwinPlayerId;
  assert.ok(goodTwin && evilTwin, "the deal resolves the pair by player");

  evilTwinBarberSwap(state);
  assert.notEqual(state.players[goodTwin].roleId, "clockmaker");
  assert.equal(state.players["3"].roleId, "clockmaker");

  state.phase = "day";
  state.day = {
    number: 2,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  executeByDecision(state, goodTwin!);
  assert.equal(state.winner && state.winner!.reason, "evil-twin");
});

test("inheriting the good twin's character does not move the Evil Twin win", () => {
  const state = make(
    { 1: "clockmaker", 2: "barber", 6: "eviltwin", 7: "pithag", 11: "fanggu" },
    { count: 11 },
  );
  evilTwinBarberSwap(state);
  assert.equal(state.players["3"].roleId, "clockmaker", "the role moved to a third player");

  state.phase = "day";
  state.day = {
    number: 2,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  executeByDecision(state, "3");
  assert.equal(state.winner, null, "the new role holder is not the good twin");
});

test("a dead Evil Twin cannot win on the good twin's execution", () => {
  const state = make({ 1: "clockmaker", 6: "eviltwin", 7: "fanggu" }, { count: 7 });
  const goodTwin = state.setup.evilTwinGoodPlayerId;
  const evilTwin = state.setup.evilTwinPlayerId;
  assert.ok(goodTwin && evilTwin, "the deal resolves the pair by player");
  state.players[evilTwin].alive = false;

  state.phase = "day";
  state.day = {
    number: 2,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  executeByDecision(state, goodTwin!);
  assert.equal(state.winner, null, "a dead Evil Twin has no ability");
});

test("an Evil Twin that leaves play stops the twin win and the block", () => {
  const state = make(
    { 1: "clockmaker", 2: "barber", 6: "eviltwin", 7: "pithag", 11: "fanggu" },
    { count: 11 },
  );
  const goodTwin = state.setup.evilTwinGoodPlayerId;
  laterNight(state);
  const pithag = stepFor(state, "pithag");
  const roleId = SNV.townsfolk.find((id) => !rolesInPlay(state).includes(id));
  const changed = runStep(state, "pithag-evil-twin-out", {
    key: pithag.key,
    targetIds: ["6"],
    roleId,
  });
  assert.equal(changed.status, "allowed", JSON.stringify(changed));
  assert.equal(state.players["6"].roleId, roleId);

  state.phase = "day";
  state.day = {
    number: 2,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  executeByDecision(state, goodTwin!);
  assert.equal(state.winner, null, "no Evil Twin ability is in play");

  state.players["11"].alive = false;
  const winner = checkWin(state);
  assert.equal(winner && winner.team, "good");
  assert.equal(winner!.reason, "demon-dead", "the leaving Evil Twin no longer blocks good");
});

function twinSwapState() {
  const state = make(
    { 1: "clockmaker", 2: "barber", 6: "eviltwin", 7: "pithag", 11: "fanggu" },
    { count: 11 },
  );
  const pair = {
    good: state.setup.evilTwinGoodPlayerId!,
    evil: state.setup.evilTwinPlayerId!,
  };
  laterNight(state);
  const pithag = stepFor(state, "pithag");
  const roleId = SNV.townsfolk.find((id) => !rolesInPlay(state).includes(id));
  const kill = runStep(state, "pithag-twin-death", {
    key: pithag.key,
    targetIds: ["3"],
    roleId,
    deathIds: ["2"],
  });
  assert.equal(kill.status, "allowed", JSON.stringify(kill));
  const barber = stepFor(state, "barber");
  const swap = runStep(state, "barber-both-twins", {
    key: barber.key,
    targetIds: [pair.good, pair.evil],
  });
  assert.equal(swap.status, "allowed", JSON.stringify(swap));
  return { state, pair };
}

test("the two twins may swap characters and keep the pair", () => {
  const { state, pair } = twinSwapState();
  assert.equal(state.players[pair.good].roleId, "eviltwin");
  assert.equal(state.players[pair.evil].roleId, state.setup.evilTwinGoodId);

  state.phase = "day";
  state.day = {
    number: 2,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  executeByDecision(state, pair.good);
  assert.equal(
    state.winner && state.winner!.reason,
    "evil-twin",
    "the good-aligned twin still wins for evil",
  );
});

test("both twins alive still block a good win after they swap", () => {
  const { state } = twinSwapState();
  state.players["11"].alive = false;
  assert.equal(checkWin(state), null, "good cannot win while both twins live");
});

test("the Philosopher gains the chosen ability and drunks its owner", () => {
  const state = make({ 1: "philosopher", 2: "clockmaker", 7: "fanggu" }, { count: 7 });
  startNight(state);
  const step = stepFor(state, "philosopher");

  const result = runStep(state, "philosopher-clockmaker", {
    key: step.key,
    roleId: "clockmaker",
  });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["1"].used.philosopherAbility, "clockmaker");
  assert.ok(
    state.effects.some(
      (effect) =>
        effect.kind === "drunk" &&
        effect.philosopher === true &&
        effect.targetId === "2" &&
        effect.active,
    ),
    "the owner of the chosen character is drunk",
  );
  const borrowed = state.night.queue.find(
    (candidate) =>
      candidate.roleId === "clockmaker" &&
      candidate.actorId === "1" &&
      !candidate.done &&
      !candidate.skipped,
  );
  assert.ok(borrowed, "the Philosopher wakes with the borrowed ability");
  assertNoDuplicateCharacters(state);
  assert.deepEqual(validateState(state), []);
});

test("an impaired Philosopher spends the ability and gains nothing", () => {
  const state = make({ 1: "philosopher", 2: "clockmaker", 7: "fanggu" }, { count: 7 });
  startNight(state);
  state.effects.push({
    id: "test-philosopher-poison",
    kind: "poison",
    sourceId: "7",
    targetId: "1",
    start: { phase: "night", number: 1 },
    expires: null,
    active: true,
  });
  const step = stepFor(state, "philosopher");

  const result = runStep(state, "philosopher-impaired", {
    key: step.key,
    roleId: "clockmaker",
  });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["1"].used.philosopher, true, "the ability is spent");
  assert.equal(state.players["1"].used.philosopherAbility, undefined);
  assert.equal(
    state.effects.some((effect) => effect.philosopher === true),
    false,
  );
  assert.equal(
    state.night.queue.some(
      (candidate) => candidate.roleId === "clockmaker" && candidate.actorId === "1",
    ),
    false,
    "no borrowed ability step",
  );
});

test("the Philosopher can decline and keep the once-per-game ability", () => {
  const state = make({ 1: "philosopher", 2: "clockmaker", 7: "fanggu" }, { count: 7 });
  startNight(state);
  const step = stepFor(state, "philosopher");

  const result = runStep(state, "philosopher-decline", { key: step.key });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["1"].used.philosopher, undefined);
});

test("the Philosopher may choose their own character and becomes drunk", () => {
  const state = make({ 1: "philosopher", 2: "clockmaker", 7: "fanggu" }, { count: 7 });
  startNight(state);
  const step = stepFor(state, "philosopher");

  const result = runStep(state, "philosopher-self", { key: step.key, roleId: "philosopher" });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["1"].used.philosopherAbility, "philosopher");
  assert.ok(
    state.effects.some(
      (effect) =>
        effect.kind === "drunk" &&
        effect.philosopher === true &&
        effect.sourceId === "1" &&
        effect.targetId === "1" &&
        effect.active,
    ),
    "the Philosopher is drunk",
  );
});

test("the Philosopher's drunk moves to a character that enters play later", () => {
  const state = make({ 1: "philosopher", 2: "clockmaker", 6: "pithag", 7: "fanggu" }, { count: 7 });
  laterNight(state);
  const roleId = SNV.townsfolk.find((id) => !rolesInPlay(state).includes(id));
  assert.ok(roleId);
  const philosopher = stepFor(state, "philosopher");

  const chosen = runStep(state, "philosopher-absent", { key: philosopher.key, roleId });
  assert.equal(chosen.status, "allowed", JSON.stringify(chosen));
  assert.equal(
    state.effects.some((effect) => effect.philosopher === true),
    false,
    "no drunk while the character is absent",
  );

  const pithag = stepFor(state, "pithag");
  const created = runStep(state, "pithag-entry", { key: pithag.key, targetIds: ["3"], roleId });
  assert.equal(created.status, "allowed", JSON.stringify(created));
  assert.ok(
    state.effects.some(
      (effect) => effect.philosopher === true && effect.targetId === "3" && effect.active,
    ),
    "the character's new owner is drunk",
  );
});

test("a replacement clears the borrowed ability and the drunk", () => {
  const state = make({ 1: "philosopher", 2: "dreamer", 6: "pithag", 7: "fanggu" }, { count: 7 });
  startNight(state);
  const philosopher = stepFor(state, "philosopher");
  const chosen = runStep(state, "philosopher-dreamer", {
    key: philosopher.key,
    roleId: "dreamer",
  });
  assert.equal(chosen.status, "allowed", JSON.stringify(chosen));
  assert.equal(state.players["1"].used.philosopherAbility, "dreamer");
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);

  const pithag = stepFor(state, "pithag");
  const roleId = SNV.townsfolk.find((id) => !rolesInPlay(state).includes(id));
  const replaced = runStep(state, "pithag-ex-philosopher", {
    key: pithag.key,
    targetIds: ["1"],
    roleId,
  });
  assert.equal(replaced.status, "allowed", JSON.stringify(replaced));
  assert.equal(state.players["1"].roleId, roleId);
  assert.equal(state.players["1"].used.philosopherAbility, undefined);
  assert.equal(
    state.effects.some((effect) => effect.philosopher === true && effect.active !== false),
    false,
    "the drunk is withdrawn",
  );
  assert.equal(
    state.night.queue.some(
      (candidate) =>
        candidate.actorId === "1" &&
        candidate.roleId === "dreamer" &&
        !candidate.done &&
        !candidate.skipped,
    ),
    false,
    "the borrowed step is removed before the wake",
  );
});

test("a borrowed death-triggered ability wakes after the Philosopher dies", () => {
  const state = make({ 1: "philosopher", 2: "clockmaker", 6: "pithag", 7: "fanggu" }, { count: 7 });
  laterNight(state);
  const philosopher = stepFor(state, "philosopher");
  const chosen = runStep(state, "philosopher-sage", { key: philosopher.key, roleId: "sage" });
  assert.equal(chosen.status, "allowed", JSON.stringify(chosen));

  const demon = stepFor(state, "fanggu");
  const killed = runStep(state, "fanggu-kills-philosopher", {
    key: demon.key,
    targetIds: ["1"],
    deathIds: ["1"],
  });
  assert.equal(killed.status, "allowed", JSON.stringify(killed));
  assert.equal(state.players["1"].alive, false);
  assert.ok(
    state.night.queue.some(
      (candidate) =>
        candidate.actorId === "1" &&
        candidate.roleId === "sage" &&
        !candidate.done &&
        !candidate.skipped,
    ),
    "the borrowed Sage wakes after the death",
  );
});

test("a player who regains the Philosopher has a fresh once-per-game ability", () => {
  const state = make({ 1: "philosopher", 2: "clockmaker", 6: "pithag", 7: "fanggu" }, { count: 7 });
  startNight(state);
  const philosopher = stepFor(state, "philosopher");
  const first = runStep(state, "philosopher-first", {
    key: philosopher.key,
    roleId: "clockmaker",
  });
  assert.equal(first.status, "allowed", JSON.stringify(first));
  assert.equal(state.players["1"].used.philosopher, true);

  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  const away = stepFor(state, "pithag");
  const roleId = SNV.townsfolk.find((id) => !rolesInPlay(state).includes(id));
  const changed = runStep(state, "pithag-away", {
    key: away.key,
    targetIds: ["1"],
    roleId,
  });
  assert.equal(changed.status, "allowed", JSON.stringify(changed));

  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  const back = stepFor(state, "pithag");
  const regained = runStep(state, "pithag-back", {
    key: back.key,
    targetIds: ["1"],
    roleId: "philosopher",
  });
  assert.equal(regained.status, "allowed", JSON.stringify(regained));
  assert.equal(state.players["1"].roleId, "philosopher");
  assert.equal(state.players["1"].used.philosopher, undefined, "a fresh once-per-game ability");
});

test("a replacement survives an export and import", () => {
  const state = make({ 1: "clockmaker", 6: "pithag", 7: "fanggu" }, { count: 7 });
  laterNight(state);
  const step = stepFor(state, "pithag");
  const target = "3";
  const previous = state.players[target].roleId;
  const roleId = SNV.townsfolk.find((id) => !rolesInPlay(state).includes(id));
  const result = runStep(state, "pithag-export", { key: step.key, targetIds: [target], roleId });
  assert.equal(result.status, "allowed", JSON.stringify(result));

  const restored = importGame(exportGame(state));
  if (!restored.ok) assert.fail(restored.error);
  assert.equal(restored.state.players[target].roleId, roleId);
  assert.equal(restored.state.players[target].changedFrom, previous);
  assert.equal(restored.state.players[target].team, "good");
  assertNoDuplicateCharacters(restored.state);
  assert.deepEqual(validateState(restored.state), []);
});

test("an imported save resolves the twin pair before a swap", () => {
  const state = make(
    { 1: "clockmaker", 2: "barber", 6: "eviltwin", 7: "pithag", 11: "fanggu" },
    { count: 11 },
  );
  const goodTwin = state.setup.evilTwinGoodPlayerId;
  const evilTwin = state.setup.evilTwinPlayerId;
  assert.ok(goodTwin && evilTwin, "the deal resolves the pair by player");
  // A save written before the player ids existed stores only the roles.
  state.setup.evilTwinGoodPlayerId = null;
  state.setup.evilTwinPlayerId = null;

  const restored = importGame(exportGame(state));
  if (!restored.ok) assert.fail(restored.error);
  const next = restored.state;
  assert.equal(next.setup.evilTwinGoodPlayerId, goodTwin, "backfilled from the roles");
  assert.equal(next.setup.evilTwinPlayerId, evilTwin);

  evilTwinBarberSwap(next);
  next.phase = "day";
  next.day = {
    number: 2,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  executeByDecision(next, goodTwin);
  assert.equal(next.winner && next.winner.reason, "evil-twin");
});

test("death-triggered wakes are inserted in their shared priority order", () => {
  const wakeOrderFor = (deathIds: string[]) => {
    const state = make(
      { 1: "clockmaker", 2: "barber", 3: "sweetheart", 4: "dreamer", 6: "pithag", 8: "nodashii" },
      { count: 9 },
    );
    laterNight(state);
    const demon = stepFor(state, "nodashii");
    const result = runStep(state, "two-deaths-" + deathIds.join("-"), {
      key: demon.key,
      targetIds: [deathIds[0]],
      deathIds,
    });
    assert.equal(result.status, "allowed", JSON.stringify(result));
    return state.night.queue.map((step) => step.roleId || step.system);
  };
  const sweetheartFirst = wakeOrderFor(["3", "2"]);
  const barberFirst = wakeOrderFor(["2", "3"]);
  const barber = sweetheartFirst.indexOf("barber");
  const sweetheart = sweetheartFirst.indexOf("sweetheart");
  const dreamer = sweetheartFirst.indexOf("dreamer");
  assert.ok(barber !== -1 && sweetheart !== -1 && dreamer !== -1, "all three steps exist");
  assert.ok(
    barber < sweetheart && sweetheart < dreamer,
    "the Barber and Sweetheart wake before the later Dreamer, in that order",
  );
  assert.deepEqual(barberFirst, sweetheartFirst, "the death order does not change the wake order");
});

test("the Sage's death-triggered wake keeps its official slot", () => {
  const state = make(
    { 1: "clockmaker", 2: "sage", 4: "dreamer", 6: "pithag", 8: "nodashii" },
    { count: 9 },
  );
  laterNight(state);
  const demon = stepFor(state, "nodashii");
  const result = runStep(state, "sage-death", {
    key: demon.key,
    targetIds: ["2"],
    deathIds: ["2"],
  });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  const queue = state.night.queue;
  const sage = queue.findIndex((step) => step.roleId === "sage");
  const dreamer = queue.findIndex((step) => step.roleId === "dreamer");
  assert.ok(sage !== -1 && dreamer !== -1, "both steps exist");
  assert.equal(queue[sage].order, SV_NIGHT_OTHER.indexOf("sage"));
  assert.ok(sage < dreamer, "the Sage wakes before the Dreamer, not after every regular step");
});

// ---------------------------------------------------------------------------
// Madness (Cerenovus and Mutant)

function madnessDay(state: GameState, number = 1) {
  state.phase = "day";
  state.day = {
    number,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
}

function cerenovusMadness() {
  const state = make({ 1: "clockmaker", 6: "cerenovus", 7: "fanggu" }, { count: 7 });
  startNight(state);
  const step = stepFor(state, "cerenovus");
  const goodRole = state.players["1"].roleId;
  const result = completeStep(state, step.key, { targetIds: ["2"], roleId: goodRole });
  assert.equal(result.ok, true, JSON.stringify(result));
  return { state, goodRole };
}

test("the Cerenovus marks the chosen player mad for the next day only", () => {
  const { state, goodRole } = cerenovusMadness();
  const token = state.effects.find(
    (effect) => effect.kind === "madness" && effect.madness === "cerenovus",
  );
  assert.ok(token, "a madness token exists");
  assert.equal(token.sourceId, "6");
  assert.equal(token.targetId, "2");
  assert.equal(token.roleId, goodRole);
  assert.deepEqual(token.expires, { phase: "night", number: 2 });
  madnessDay(state);
  assert.equal(activeMadness(state, "2")?.id, token.id, "mad during the following day");
  assert.equal(
    activeMadness(state, "2", { phase: "night", number: 2 }),
    null,
    "no longer mad at the next night",
  );
  assert.deepEqual(validateState(state), []);
});

test("the Cerenovus needs a good character before it records madness", () => {
  const state = make({ 1: "clockmaker", 6: "cerenovus", 7: "fanggu" }, { count: 7 });
  startNight(state);
  const missing = completeStep(state, stepFor(state, "cerenovus").key, { targetIds: ["2"] });
  assert.equal(missing.ok, true, JSON.stringify(missing));
  assert.deepEqual(madnessEffects(state, { phase: "night", number: 1 }), []);

  const other = make({ 1: "clockmaker", 6: "cerenovus", 7: "fanggu" }, { count: 7 });
  startNight(other);
  const evil = completeStep(other, stepFor(other, "cerenovus").key, {
    targetIds: ["2"],
    roleId: "fanggu",
  });
  assert.equal(evil.ok, false);
  assert.deepEqual(madnessEffects(other, { phase: "night", number: 1 }), []);
});

test("an expired or removed madness token stops applying", () => {
  const { state } = cerenovusMadness();
  madnessDay(state);
  assert.ok(activeMadness(state, "2"));
  laterNight(state);
  assert.equal(
    activeMadness(state, "2", { phase: "night", number: 2 }),
    null,
    "the token expires at the next night",
  );

  const second = cerenovusMadness();
  madnessDay(second.state);
  const token = activeMadness(second.state, "2")!;
  const removed = applyCommand(second.state, {
    id: "remove-madness",
    type: "manualCorrection",
    payload: {
      change: { kind: "effect", effectId: token.id, value: false, reason: "Wrong target" },
    },
  });
  assert.equal(removed.status, "allowed", JSON.stringify(removed));
  assert.equal(activeMadness(second.state, "2"), null, "the Storyteller can remove the token");
});

test("the Storyteller executes a player who failed to be mad", () => {
  const { state } = cerenovusMadness();
  madnessDay(state);
  const result = applyCommand(state, {
    id: "madness-execute",
    type: "madnessPenalty",
    payload: {
      playerId: "2",
      penalty: "execute",
      reason: "Claimed to be the Clockmaker all day.",
    },
  });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["2"].alive, false);
  assert.equal(state.day.execution!.playerId, "2");
  assert.equal(state.day.execution!.cause, "madness");
  assert.equal(state.executions.at(-1)!.cause, "madness");
  const token = state.effects.find((effect) => effect.madness === "cerenovus")!;
  assert.equal(token.decidedDay, 1);
  assert.equal(token.decidedPenalty, "execute");
  assert.equal(token.decidedReason, "Claimed to be the Clockmaker all day.");
  const logged = state.log.filter((entry) => entry.playerId === "2").at(-1)!;
  assert.equal(logged.secret, true);
  assert.match(logged.detail, /Claimed to be the Clockmaker all day\./);
});

test("the madness penalty only accepts the legal Storyteller options", () => {
  const { state } = cerenovusMadness();
  madnessDay(state);
  const before = JSON.stringify(state.effects);
  const illegal = applyCommand(state, {
    id: "madness-illegal",
    type: "madnessPenalty",
    payload: { playerId: "2", penalty: "banish", reason: "decided" },
  });
  assert.equal(illegal.status, "requires-storyteller-choice");
  assert.deepEqual(illegal.choice.options, MADNESS_PENALTIES);
  assert.equal(JSON.stringify(state.effects), before, "an illegal penalty changes nothing");

  const noReason = applyCommand(state, {
    id: "madness-noreason",
    type: "madnessPenalty",
    payload: { playerId: "2", penalty: "none", reason: "   " },
  });
  assert.equal(noReason.status, "rejected");

  const declined = applyCommand(state, {
    id: "madness-none",
    type: "madnessPenalty",
    payload: { playerId: "2", penalty: "none", reason: "Was mad enough." },
  });
  assert.equal(declined.status, "allowed", JSON.stringify(declined));
  assert.equal(state.players["2"].alive, true);
  assert.equal(state.day.execution, null);
  const token = state.effects.find((effect) => effect.madness === "cerenovus")!;
  assert.equal(token.decidedPenalty, "none");
  assert.equal(token.decidedReason, "Was mad enough.");

  const again = applyCommand(state, {
    id: "madness-again",
    type: "madnessPenalty",
    payload: { playerId: "2", penalty: "none", reason: "Same outcome." },
  });
  assert.equal(again.status, "rejected");

  const upgraded = applyCommand(state, {
    id: "madness-upgrade",
    type: "madnessPenalty",
    payload: { playerId: "2", penalty: "execute", reason: "New evidence of a breach." },
  });
  assert.equal(upgraded.status, "allowed", JSON.stringify(upgraded));
  const repeated = applyCommand(state, {
    id: "madness-execute-again",
    type: "madnessPenalty",
    payload: { playerId: "2", penalty: "execute", reason: "Repeat." },
  });
  assert.equal(repeated.status, "rejected");

  const nobody = applyCommand(state, {
    id: "madness-nobody",
    type: "madnessPenalty",
    payload: { playerId: "3", penalty: "none", reason: "no token" },
  });
  assert.equal(nobody.status, "rejected");
});

test("ending the day is blocked until active madness has a Storyteller review", () => {
  const { state } = cerenovusMadness();
  madnessDay(state);
  const before = JSON.stringify({ phase: state.phase, day: state.day, night: state.night });
  const blocked = applyCommand(state, {
    id: "end-day-pending-madness",
    type: "endDay",
    payload: {},
  });
  assert.equal(blocked.status, "rejected", "the active madness must be reviewed");
  assert.equal(blocked.errorCode, "error.66");
  assert.deepEqual(
    { phase: state.phase, day: state.day, night: state.night },
    JSON.parse(before),
    "a blocked transition leaves the phase unchanged",
  );

  const review = applyCommand(state, {
    id: "madness-review-none",
    type: "madnessPenalty",
    payload: { playerId: "2", penalty: "none", reason: "Stayed convincingly mad." },
  });
  assert.equal(review.status, "allowed", JSON.stringify(review));
  assert.equal(endDay(state).ok, true, "the reviewed day may end");
});

test("each overlapping madness condition receives its own review", () => {
  const state = make({ 1: "clockmaker", 2: "mutant", 6: "cerenovus", 7: "fanggu" }, { count: 8 });
  startNight(state);
  const step = stepFor(state, "cerenovus");
  const completed = completeStep(state, step.key, { targetIds: ["2"], roleId: "clockmaker" });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  madnessDay(state);

  const reviews = madnessReviewsDue(state).filter((effect) => effect.targetId === "2");
  assert.equal(reviews.length, 2);
  for (const effect of reviews) {
    const result = applyCommand(state, {
      id: "overlapping-madness-" + effect.id,
      type: "madnessPenalty",
      payload: {
        playerId: "2",
        effectId: effect.id,
        penalty: "none",
        reason: "Reviewed this specific madness condition.",
      },
    });
    assert.equal(result.status, "allowed", JSON.stringify(result));
  }
  assert.deepEqual(madnessReviewsDue(state), []);
  assert.equal(endDay(state).ok, true);
});

test("a no-penalty madness review can be upgraded to execution later that day", () => {
  const { state } = cerenovusMadness();
  madnessDay(state);
  assert.equal(
    applyCommand(state, {
      id: "madness-review-early",
      type: "madnessPenalty",
      payload: { playerId: "2", penalty: "none", reason: "No breach observed yet." },
    }).status,
    "allowed",
  );

  const upgraded = applyCommand(state, {
    id: "madness-review-upgrade",
    type: "madnessPenalty",
    payload: { playerId: "2", penalty: "execute", reason: "Later evidence showed a breach." },
  });
  assert.equal(upgraded.status, "allowed", JSON.stringify(upgraded));
  assert.equal(state.day.execution?.playerId, "2");
  assert.equal(state.day.execution?.cause, "madness");
  const token = state.effects.find((effect) => effect.madness === "cerenovus")!;
  assert.equal(token.decidedPenalty, "execute");
  assert.equal(token.decidedReason, "Later evidence showed a breach.");
});

test("the Mutant is mad about being an Outsider while in play", () => {
  const state = make({ 1: "clockmaker", 2: "mutant", 6: "witch", 7: "fanggu" }, { count: 8 });
  startNight(state);
  const token = madnessEffects(state, { phase: "night", number: 1 }).find(
    (effect) => effect.madness === "mutant",
  );
  assert.ok(token, "the Mutant has a madness token");
  assert.equal(token.sourceId, "2");
  assert.equal(token.targetId, "2");
  assert.equal(token.roleId, null);
  assert.equal(token.expires, null);
  madnessDay(state);
  assert.equal(activeMadness(state, "2")?.madness, "mutant");
  const result = applyCommand(state, {
    id: "mutant-execute",
    type: "madnessPenalty",
    payload: { playerId: "2", penalty: "execute", reason: "Claimed to be a Townsfolk all day." },
  });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["2"].alive, false);
});

test("the living Mutant needs a new madness review each day", () => {
  const state = make({ 1: "clockmaker", 2: "mutant", 6: "witch", 7: "fanggu" }, { count: 8 });
  startNight(state);
  madnessDay(state, 1);
  const firstReview = applyCommand(state, {
    id: "mutant-review-day-one",
    type: "madnessPenalty",
    payload: { playerId: "2", penalty: "none", reason: "Stayed mad on day one." },
  });
  assert.equal(firstReview.status, "allowed", JSON.stringify(firstReview));
  assert.equal(endDay(state).ok, true);

  madnessDay(state, 2);
  const secondDay = applyCommand(state, {
    id: "mutant-end-day-two",
    type: "endDay",
    payload: {},
  });
  assert.equal(secondDay.status, "rejected");
  assert.equal(secondDay.errorCode, "error.66");
});

test("the Mutant madness follows the character holder", () => {
  const state = make({ 1: "clockmaker", 2: "mutant", 6: "witch", 7: "fanggu" }, { count: 8 });
  startNight(state);
  assert.ok(activeMadness(state, "2"));
  state.players["2"].roleId = "klutz";
  reconcileNoDashiiPoison(state);
  assert.equal(activeMadness(state, "2"), null, "the player stopped being the Mutant");
  const token = state.effects.find((effect) => effect.madness === "mutant")!;
  assert.equal(token.active, false);
  state.players["2"].roleId = "mutant";
  state.players["2"].alive = false;
  reconcileNoDashiiPoison(state);
  assert.equal(activeMadness(state, "2"), null, "a dead Mutant is no longer mad");
});

test("madness stays out of the public and player projections", () => {
  const { state, goodRole } = cerenovusMadness();
  madnessDay(state);
  assert.ok(activeMadness(state, "2"));
  const view = publicGameView(state);
  assert.deepEqual(Object.keys(view).sort(), [
    "day",
    "deaths",
    "living",
    "night",
    "phase",
    "total",
    "winner",
  ]);
  const text = JSON.stringify(view);
  assert.equal(text.includes("madness"), false);
  assert.equal(text.includes("cerenovus"), false);
  assert.equal(text.includes(goodRole ?? ""), false);
  const player = publicRoleView(state.players["2"], {
    id: "clockmaker",
    name: "Clockmaker",
    team: "townsfolk",
    ability: "One of two.",
    edition: "tb",
  });
  assert.ok(player);
  assert.deepEqual(Object.keys(player).sort(), [
    "ability",
    "image",
    "name",
    "role",
    "seat",
    "team",
    "teamLabel",
  ]);
  assert.equal(JSON.stringify(player).includes("madness"), false);
});

// Issue #41: Vigormortis, Vortox and the informational roles

test("the Vigormortis minion keeps its ability and poisons one Townsfolk neighbour", () => {
  const state = make({ 1: "clockmaker", 2: "cerenovus", 8: "vigormortis" }, { count: 8 });
  laterNight(state);
  const step = stepFor(state, "vigormortis");
  const killResult = applyCommand(state, {
    id: "vigo-kill",
    type: "completeNightStep",
    payload: { key: step.key, targetIds: ["2"], deathIds: ["2"] },
  });
  assert.equal(killResult.status, "allowed", JSON.stringify(killResult));
  const death = state.deaths.find((entry) => entry.playerId === "2");
  assert.ok(death, "the Minion died");
  assert.equal(death.ability, "vigormortis");
  assert.equal(death.demon, true);
  const poison = state.effects.find((effect) => effect.vigormortis === true)!;
  assert.ok(poison, "one Townsfolk neighbour is poisoned");
  assert.equal(poison.kind, "poison");
  assert.equal(poison.targetId, "3", "the nearest Townsfolk clockwise is poisoned");
  assert.equal(poison.permanent, true, "the poison outlives its dead source");
  assert.equal(isImpaired(state, "3"), true, "the poisoned Townsfolk is impaired");

  nextNight(state);
  const retained = state.night.queue.find((candidate) => candidate.roleId === "cerenovus");
  assert.ok(retained, "the dead Minion keeps its night step");
  assert.equal(retained.actorId, "2");
  const done = completeStep(state, retained.key, { targetIds: ["1"] });
  assert.equal(done.ok, true, JSON.stringify(done));
});

test("the Vigormortis retention ends when the Vigormortis dies", () => {
  const state = make({ 1: "clockmaker", 2: "cerenovus", 8: "vigormortis" }, { count: 8 });
  laterNight(state);
  const step = stepFor(state, "vigormortis");
  completeStep(state, step.key, { targetIds: ["2"] });
  recordSvOutcome(state, step.key, { deathIds: ["2"] });
  nextNight(state);
  const retained = state.night.queue.find((candidate) => candidate.roleId === "cerenovus");
  assert.ok(retained, "the retention exists while the Vigormortis lives");
  state.players["8"].alive = false;
  appendConditionalSteps(state);
  assert.equal(retained.skipped, true, "the dead Minion no longer keeps its ability");
  reconcileVigormortisPoison(state);
  const poison = state.effects.find((effect) => effect.vigormortis === true)!;
  assert.ok(poison, "the poison was applied at the kill");
  assert.equal(poison.active, false, "the poison ends with the Vigormortis");
});

test("the Vigormortis poison needs a real Minion kill", () => {
  const state = make({ 1: "clockmaker", 2: "cerenovus", 8: "vigormortis" }, { count: 8 });
  laterNight(state);
  const step = stepFor(state, "vigormortis");
  completeStep(state, step.key, { targetIds: ["2"] });
  state.players["2"].alive = false;
  const outcome = recordSvOutcome(state, step.key, { deathIds: ["2"] });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.deepEqual(outcome.deaths, [], "the Minion was already dead");
  assert.equal(
    state.effects.some((effect) => effect.vigormortis === true),
    false,
    "no poison without a kill",
  );
});

test("the Vigormortis poison ends when the killed Minion stops being a Minion", () => {
  const state = make({ 1: "clockmaker", 2: "cerenovus", 8: "vigormortis" }, { count: 8 });
  laterNight(state);
  const step = stepFor(state, "vigormortis");
  completeStep(state, step.key, { targetIds: ["2"] });
  recordSvOutcome(state, step.key, { deathIds: ["2"] });
  const poison = state.effects.find((effect) => effect.vigormortis === true)!;
  assert.ok(poison, "the poison exists");
  assert.equal(poison.active, true);
  assert.equal(isImpaired(state, poison.targetId!), true);

  const replaced = replaceCharacter(state, "2", "oracle", { order: 0, currentKey: null });
  assert.equal(replaced.ok, true);
  assert.equal(poison.active, false, "a non-Minion source no longer poisons");
  assert.equal(isImpaired(state, poison.targetId!), false);
});

test("an Evil Twin killed by the Vigormortis still wins on the good twin's execution", () => {
  const state = make({ 1: "clockmaker", 2: "eviltwin", 8: "vigormortis" }, { count: 8 });
  const goodTwin = state.setup.evilTwinGoodPlayerId;
  assert.equal(goodTwin, "1", "the good twin is the Clockmaker");
  laterNight(state);
  const step = stepFor(state, "vigormortis");
  completeStep(state, step.key, { targetIds: ["2"] });
  recordSvOutcome(state, step.key, { deathIds: ["2"] });
  assert.equal(state.players["2"].alive, false);
  state.phase = "day";
  state.day = {
    number: 2,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  executeByDecision(state, goodTwin!);
  assert.equal(state.winner && state.winner.team, "evil");
  assert.equal(state.winner && state.winner!.reason, "evil-twin");

  const lost = make({ 1: "clockmaker", 2: "eviltwin", 8: "vigormortis" }, { count: 8 });
  laterNight(lost);
  const lostStep = stepFor(lost, "vigormortis");
  completeStep(lost, lostStep.key, { targetIds: ["2"] });
  recordSvOutcome(lost, lostStep.key, { deathIds: ["2"] });
  lost.players["8"].alive = false;
  lost.phase = "day";
  lost.day = {
    number: 2,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  executeByDecision(lost, "1");
  assert.notEqual(
    lost.winner && lost.winner.reason,
    "evil-twin",
    "the ability ends with the Vigormortis",
  );
});

test("the host can name the Vigormortis poisoned neighbour", () => {
  const state = make({ 1: "clockmaker", 2: "cerenovus", 8: "vigormortis" }, { count: 8 });
  laterNight(state);
  const step = stepFor(state, "vigormortis");
  completeStep(state, step.key, { targetIds: ["2"] });
  const outcome = recordSvOutcome(state, step.key, { deathIds: ["2"], poisonId: "1" });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  const poison = state.effects.find((effect) => effect.vigormortis === true)!;
  assert.equal(poison.targetId, "1", "the host's neighbour is poisoned");

  const other = make({ 1: "clockmaker", 2: "cerenovus", 8: "vigormortis" }, { count: 8 });
  laterNight(other);
  const otherStep = stepFor(other, "vigormortis");
  completeStep(other, otherStep.key, { targetIds: ["2"] });
  const rejected = recordSvOutcome(other, otherStep.key, { deathIds: ["2"], poisonId: "8" });
  assert.equal(rejected.ok, false, "the Demon is not a Townsfolk neighbour");
  assert.equal(
    other.effects.some((effect) => effect.vigormortis === true),
    false,
    "no poison is applied",
  );
});

test("the console's poison choice reaches the engine through completeNightStep", () => {
  const state = make({ 1: "clockmaker", 2: "cerenovus", 8: "vigormortis" }, { count: 8 });
  laterNight(state);
  const step = stepFor(state, "vigormortis");
  const allowed = applyCommand(state, {
    id: "vigo-console-choice",
    type: "completeNightStep",
    payload: { key: step.key, targetIds: ["2"], deathIds: ["2"], poisonId: "1" },
  });
  assert.equal(allowed.status, "allowed", JSON.stringify(allowed));
  const poison = state.effects.find((effect) => effect.vigormortis === true)!;
  assert.equal(poison.targetId, "1", "the console's choice is the poisoned neighbour");

  const other = make({ 1: "clockmaker", 2: "cerenovus", 8: "vigormortis" }, { count: 8 });
  laterNight(other);
  const otherStep = stepFor(other, "vigormortis");
  const rejected = applyCommand(other, {
    id: "vigo-console-illegal",
    type: "completeNightStep",
    payload: { key: otherStep.key, targetIds: ["2"], deathIds: ["2"], poisonId: "8" },
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.errorCode, "error.56");
  assert.equal(
    other.effects.some((effect) => effect.vigormortis === true),
    false,
  );
});

test("a Townsfolk information step demands the host's answer while the Vortox lives", () => {
  const state = make({ 1: "clockmaker", 2: "cerenovus", 8: "vortox" }, { count: 8 });
  startNight(state);
  const step = stepFor(state, "clockmaker");
  const info = infoForStep(state, step);
  assert.equal(info.needsChoice, true, "false information is the host's choice");
  const blocked = stepOutcome(completeStep(state, step.key, {}));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.needsChoice, true);
  const done = stepOutcome(
    completeStep(state, step.key, {
      given: { kind: "number", value: 3, needsChoice: false },
    }),
  );
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.step!.given!.value, 3, "the host's false number is stored");
});

test("an impaired information role demands the host's answer", () => {
  const state = make({ 1: "clockmaker", 2: "cerenovus", 8: "fanggu" }, { count: 8 });
  startNight(state);
  const step = stepFor(state, "clockmaker");
  state.effects.push({
    id: "test-poison",
    kind: "poison",
    sourceId: "8",
    targetId: "1",
    start: { phase: "night", number: 1 },
    expires: { phase: "night", number: 2 },
    active: true,
  });
  const info = infoForStep(state, step);
  assert.equal(info.needsChoice, true);
  const blocked = stepOutcome(completeStep(state, step.key, {}));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.needsChoice, true);
});

test("an unimpaired information role completes without a host answer", () => {
  const state = make({ 1: "clockmaker", 2: "cerenovus", 8: "fanggu" }, { count: 8 });
  startNight(state);
  const step = stepFor(state, "clockmaker");
  const info = infoForStep(state, step);
  assert.equal(info.needsChoice, false);
  assert.equal(typeof info.value, "number");
  const done = stepOutcome(completeStep(state, step.key, {}));
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.step!.given!.value, info.value);
});

test("the Oracle counts dead evil players, not death events", () => {
  const state = make({ 1: "clockmaker", 2: "oracle", 8: "fanggu" }, { count: 8 });
  laterNight(state);
  kill(state, "7", "ability", { phase: "night", number: 1 }, { demon: true, ability: "fanggu" });
  kill(state, "5", "ability", { phase: "night", number: 1 }, { demon: true, ability: "fanggu" });
  const step = stepFor(state, "oracle");
  const info = infoForStep(state, step);
  assert.equal(info.kind, "number");
  assert.equal(info.value, 1, "only the dead Minion is evil");
  // A resurrection leaves the death event behind but the player is alive.
  state.players["7"].alive = true;
  assert.equal(infoForStep(state, step).value, 0, "a living player is not counted");
});

test("the Seamstress learns whether two players share an alignment once per game", () => {
  const same = make({ 1: "seamstress", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  startNight(same);
  const sameStep = stepFor(same, "seamstress");
  const sameInfo = infoForStep(same, sameStep, { targetIds: ["2", "5"] });
  assert.equal(sameInfo.kind, "yes-no");
  assert.equal(sameInfo.value, true);
  const done = stepOutcome(completeStep(same, sameStep.key, { targetIds: ["2", "5"] }));
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(same.players["1"].used.seamstress, true, "the ability is spent");
  nextNight(same);
  assert.equal(
    same.night.queue.some((candidate) => candidate.roleId === "seamstress"),
    false,
    "the Seamstress does not wake again",
  );

  const different = make({ 1: "seamstress", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  startNight(different);
  const differentStep = stepFor(different, "seamstress");
  const differentInfo = infoForStep(different, differentStep, { targetIds: ["2", "8"] });
  assert.equal(differentInfo.value, false);
  assert.equal(completeStep(different, differentStep.key, { targetIds: ["2", "8"] }).ok, true);
});

test("the Seamstress rejects a self, repeated or missing target pair", () => {
  const state = make({ 1: "seamstress", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  startNight(state);
  const step = stepFor(state, "seamstress");
  const self = stepOutcome(completeStep(state, step.key, { targetIds: ["1", "2"] }));
  assert.equal(self.ok, false);
  assert.equal(self.errorCode, "error.40");
  const repeated = stepOutcome(completeStep(state, step.key, { targetIds: ["2", "2"] }));
  assert.equal(repeated.ok, false);
  assert.equal(repeated.errorCode, "error.42");
  const missing = stepOutcome(completeStep(state, step.key, { targetIds: ["2"] }));
  assert.equal(missing.ok, false);
  assert.equal(missing.errorCode, "error.39");
  assert.equal(state.players["1"].used && state.players["1"].used.seamstress, undefined);
});

test("the Flowergirl and the Town Crier answer from the ended day", () => {
  const state = make(
    { 1: "flowergirl", 2: "towncrier", 3: "clockmaker", 7: "cerenovus", 8: "fanggu" },
    { count: 8 },
  );
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(openNominations(state).ok, true);
  const nomination = nominate(state, "7", "6");
  assert.equal(nomination.ok, true, JSON.stringify(nomination));
  const voters = state.order.filter((id) => state.players[id].alive);
  assert.equal(recordVotes(state, nomination.nomination!.id, voters).ok, true);
  assert.equal(endDay(state).ok, true);

  const flowergirl = stepFor(state, "flowergirl");
  assert.equal(infoForStep(state, flowergirl).value, true, "a Demon voted today");
  const towncrier = stepFor(state, "towncrier");
  assert.equal(infoForStep(state, towncrier).value, true, "a Minion nominated today");
});

test("the Flowergirl and the Town Crier answer no when neither happened", () => {
  const state = make(
    { 1: "flowergirl", 2: "towncrier", 3: "clockmaker", 7: "cerenovus", 8: "fanggu" },
    { count: 8 },
  );
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(openNominations(state).ok, true);
  const nomination = nominate(state, "1", "6");
  assert.equal(nomination.ok, true, JSON.stringify(nomination));
  const voters = state.order.filter((id) => state.players[id].alive && id !== "8");
  assert.equal(recordVotes(state, nomination.nomination!.id, voters).ok, true);
  assert.equal(endDay(state).ok, true);

  assert.equal(infoForStep(state, stepFor(state, "flowergirl")).value, false);
  assert.equal(infoForStep(state, stepFor(state, "towncrier")).value, false);
});

test("the Flowergirl and Town Crier need a host answer without the ended day", () => {
  const state = make(
    { 1: "flowergirl", 2: "towncrier", 3: "clockmaker", 7: "cerenovus", 8: "fanggu" },
    { count: 8 },
  );
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  state.lastDay = null;
  const flowergirl = infoForStep(state, stepFor(state, "flowergirl"));
  assert.equal(flowergirl.kind, "yes-no");
  assert.equal(flowergirl.needsChoice, true, "the missing day is a host answer");
  assert.equal(flowergirl.hostAnswer, true, "the answer is host-supplied, not false information");
  assert.equal(flowergirl.impaired, false, "a missing day is not impairment");
  assert.equal(infoForStep(state, stepFor(state, "towncrier")).needsChoice, true);
  const blocked = stepOutcome(completeStep(state, stepFor(state, "flowergirl").key, {}));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.needsChoice, true);
});

test("the stored Juggler guesses and ended day are validated", () => {
  const state = make({ 1: "juggler", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  assert.deepEqual(validateState(state), []);
  const badJuggler = { ...state, juggler: { day: 1 } };
  assert.ok(validateState(badJuggler).some((error) => error.includes("Juggler")));
  const badGuess = { ...state, juggler: { day: 1, guesses: "x" } };
  assert.ok(validateState(badGuess).some((error) => error.includes("Juggler")));
  const badDay = { ...state, lastDay: { number: 2 } };
  assert.ok(validateState(badDay).some((error) => error.includes("last-day")));
  const badNominations = { ...state, lastDay: { number: 2, nominations: "x" } };
  assert.ok(validateState(badNominations).some((error) => error.includes("last-day")));
});

test("the Juggler guesses on the first day and the night answer counts the matches", () => {
  const state = make({ 1: "juggler", 2: "clockmaker", 7: "cerenovus", 8: "fanggu" }, { count: 8 });
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(jugglerGuess(state, "2", "clockmaker").ok, true, "a correct guess is recorded");
  assert.equal(jugglerGuess(state, "6", "clockmaker").ok, true, "a wrong guess is recorded");
  assert.equal(endDay(state).ok, true);

  const step = stepFor(state, "juggler");
  const info = infoForStep(state, step);
  assert.equal(info.kind, "number");
  assert.equal(info.value, 1, "exactly one guess is correct");
  assert.notEqual(info.value, 0, "the answer is computed, not a constant");
  assert.equal(completeStep(state, step.key, {}).ok, true);
});

test("the Juggler may guess zero times and still learns zero", () => {
  const state = make({ 1: "juggler", 2: "clockmaker", 7: "cerenovus", 8: "fanggu" }, { count: 8 });
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  // The Juggler made no guesses on their first day; the host records that.
  state.juggler = { day: 1, guesses: {} };
  assert.equal(endDay(state).ok, true);
  const step = stepFor(state, "juggler");
  const info = infoForStep(state, step);
  assert.equal(info.kind, "number");
  assert.equal(info.value, 0, "zero guesses is a legal answer");
  assert.equal(completeStep(state, step.key, {}).ok, true);
});

test("the Juggler's answer counts repeated guesses and uses the guessing day", () => {
  const state = make({ 1: "juggler", 2: "clockmaker", 7: "cerenovus", 8: "fanggu" }, { count: 8 });
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  // Juggler r3020: up to five players' characters; a player may be guessed
  // more than once with different characters.
  state.juggler = {
    day: 1,
    guesses: [
      { playerId: "2", roleId: "clockmaker" },
      { playerId: "2", roleId: "oracle" },
      { playerId: "6", roleId: "clockmaker" },
    ],
  };
  assert.equal(endDay(state).ok, true);
  const info = infoForStep(state, stepFor(state, "juggler"));
  assert.equal(info.value, 1, "each guess is counted separately");

  // "Your 1st day" is the Juggler's own first day, not day one of the game.
  const later = make({ 1: "juggler", 2: "clockmaker", 7: "cerenovus", 8: "fanggu" }, { count: 8 });
  later.night.number = 3;
  later.night.queue = [];
  later.juggler = { day: 2, guesses: { "2": "clockmaker" } };
  const built = buildSvNightQueue(later);
  assert.ok(
    built.some((candidate) => candidate.roleId === "juggler"),
    "the step follows the day the guesses were made",
  );
  later.night.queue = [];
  later.juggler = { day: 1, guesses: { "2": "clockmaker" } };
  assert.equal(
    buildSvNightQueue(later).some((candidate) => candidate.roleId === "juggler"),
    false,
    "guesses from an earlier day do not repeat the step",
  );
});

test("the Juggler command has limits", () => {
  const limited = make(
    { 1: "juggler", 2: "clockmaker", 7: "cerenovus", 8: "fanggu" },
    { count: 8 },
  );
  startNight(limited);
  finishNight(limited);
  assert.equal(endNight(limited).ok, true);
  for (const id of ["2", "3", "4", "5", "6"]) {
    assert.equal(jugglerGuess(limited, id, "clockmaker").ok, true);
  }
  assert.equal(jugglerGuess(limited, "7", "clockmaker").ok, false, "six guesses are too many");
  assert.equal(jugglerGuess(limited, "2", "not-a-character").ok, false);
  assert.equal(endDay(limited).ok, true);
  assert.equal(jugglerGuess(limited, "2", "clockmaker").ok, false, "the first day is over");
});

test("the Klutz loses the game when the public choice is evil", () => {
  const state = make({ 1: "klutz", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  laterNight(state);
  kill(state, "1", "ability", { phase: "night", number: 2 }, { demon: true, ability: "fanggu" });
  appendConditionalSteps(state);
  const step = state.night.queue.find((candidate) => candidate.roleId === "klutz");
  assert.ok(step, "the dead Klutz has a step");
  const result = completeStep(state, step.key, { targetIds: ["7"] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(state.winner && state.winner.team, "evil");
  assert.equal(state.winner && state.winner!.reason, "klutz");
});

test("an evil Klutz choosing an evil player loses for evil", () => {
  const evil = make({ 1: "klutz", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  laterNight(evil);
  kill(evil, "1", "ability", { phase: "night", number: 2 }, { demon: true, ability: "fanggu" });
  evil.players["1"].team = "evil";
  appendConditionalSteps(evil);
  const evilStep = evil.night.queue.find((candidate) => candidate.roleId === "klutz")!;
  assert.equal(completeStep(evil, evilStep.key, { targetIds: ["7"] }).ok, true);
  assert.equal(evil.winner && evil.winner.team, "good", "the evil Klutz's team is the loser");
  assert.equal(evil.winner && evil.winner.reason, "klutz");

  const good = make({ 1: "klutz", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  laterNight(good);
  kill(good, "1", "ability", { phase: "night", number: 2 }, { demon: true, ability: "fanggu" });
  good.players["1"].team = "evil";
  appendConditionalSteps(good);
  const goodStep = good.night.queue.find((candidate) => candidate.roleId === "klutz")!;
  assert.equal(completeStep(good, goodStep.key, { targetIds: ["2"] }).ok, true);
  assert.equal(good.winner, null, "a non-evil target does not lose");
});

test("the Klutz choosing a non-evil player does not lose, and a dead choice is rejected", () => {
  const same = make({ 1: "klutz", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  laterNight(same);
  kill(same, "1", "ability", { phase: "night", number: 2 }, { demon: true, ability: "fanggu" });
  appendConditionalSteps(same);
  const sameStep = same.night.queue.find((candidate) => candidate.roleId === "klutz")!;
  assert.equal(completeStep(same, sameStep.key, { targetIds: ["2"] }).ok, true);
  assert.equal(same.winner, null, "a non-evil target does not lose");

  const dead = make({ 1: "klutz", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  laterNight(dead);
  kill(dead, "1", "ability", { phase: "night", number: 2 }, { demon: true, ability: "fanggu" });
  appendConditionalSteps(dead);
  const deadStep = dead.night.queue.find((candidate) => candidate.roleId === "klutz")!;
  const rejected = stepOutcome(completeStep(dead, deadStep.key, { targetIds: ["1"] }));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errorCode, "error.55");
  assert.equal(dead.winner, null);
});

test("a drunk Klutz cannot lose the game for their team", () => {
  const state = make({ 1: "klutz", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  laterNight(state);
  kill(state, "1", "ability", { phase: "night", number: 2 }, { demon: true, ability: "fanggu" });
  state.effects.push({
    id: "test-klutz-drunk",
    kind: "drunk",
    sourceId: "8",
    targetId: "1",
    start: { phase: "night", number: 2 },
    expires: null,
    active: true,
  });
  appendConditionalSteps(state);
  const step = state.night.queue.find((candidate) => candidate.roleId === "klutz");
  assert.ok(step, "the dead Klutz has a step");
  assert.equal(isImpaired(state, "1"), true, "the Klutz is drunk");
  const result = completeStep(state, step.key, { targetIds: ["8"] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(state.winner, null, "an impaired Klutz does not decide the game");
  assert.equal(state.players["1"].used.klutz, true, "the choice is still spent");
  assert.match(step.note || "", /не сработала/, "the step states the ability failed");
});

test("the Sage learns only after a Demon kill", () => {
  const state = make({ 1: "clockmaker", 2: "sage", 7: "cerenovus", 8: "fanggu" }, { count: 8 });
  laterNight(state);
  kill(state, "2", "ability", { phase: "night", number: 2 }, { demon: true, ability: "fanggu" });
  appendConditionalSteps(state);
  assert.ok(
    state.night.queue.some((candidate) => candidate.roleId === "sage"),
    "the Demon killed the Sage",
  );

  const other = make({ 1: "clockmaker", 2: "sage", 7: "cerenovus", 8: "fanggu" }, { count: 8 });
  laterNight(other);
  kill(other, "2", "ability", { phase: "night", number: 2 }, { ability: "cerenovus" });
  appendConditionalSteps(other);
  assert.equal(
    other.night.queue.some((candidate) => candidate.roleId === "sage"),
    false,
    "a non-Demon death gives no Sage information",
  );
});

test("the Sweetheart makes the chosen player permanently drunk", () => {
  const state = make({ 1: "sweetheart", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  laterNight(state);
  kill(state, "1", "ability", { phase: "night", number: 2 }, { demon: true, ability: "fanggu" });
  appendConditionalSteps(state);
  const step = state.night.queue.find((candidate) => candidate.roleId === "sweetheart");
  assert.ok(step, "the dead Sweetheart has a step");
  assert.equal(completeStep(state, step.key, { targetIds: ["4"] }).ok, true);
  const drunk = state.effects.find((effect) => effect.kind === "drunk" && effect.targetId === "4");
  assert.ok(drunk, "the chosen player is drunk");
  assert.equal(drunk.expires, null, "the drunk lasts to the end of the game");
  assert.equal(drunk.active, true);
  assert.equal(isImpaired(state, "4"), true);
});

test("the Dreamer cannot choose themself", () => {
  const state = make({ 1: "dreamer", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  startNight(state);
  const step = stepFor(state, "dreamer");
  const self = stepOutcome(completeStep(state, step.key, { targetIds: ["1"] }));
  assert.equal(self.ok, false);
  assert.equal(self.errorCode, "error.40");
  const other = completeStep(state, step.key, { targetIds: ["2"] });
  assert.equal(other.ok, true, JSON.stringify(other));
});

test("redealing clears the Juggler guesses and the ended day", () => {
  const state = make({ 1: "juggler", 2: "clockmaker", 7: "cerenovus", 8: "fanggu" }, { count: 8 });
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(jugglerGuess(state, "2", "clockmaker").ok, true);
  assert.equal(endDay(state).ok, true);
  assert.ok(state.juggler, "the guesses exist");
  assert.ok(state.lastDay, "the ended day is stored");

  const assignment: Record<string, RoleId> = Object.fromEntries(
    state.order.map((id) => [id, state.players[id].roleId!]),
  );
  const redeal = dealGame(state, { assignment });
  assert.equal(redeal.ok, true, JSON.stringify(redeal));
  assert.equal(state.juggler, null, "a fresh game starts without guesses");
  assert.equal(state.lastDay, null, "a fresh game starts without an ended day");
});

function falseInfo(info: InfoResult): Record<string, unknown> {
  const options = Array.isArray(info.options) ? info.options : [];
  // The engine now accepts only an offered answer, so the helper picks one.
  if (info.kind === "number")
    return { kind: "number", value: options.length ? Number(options[0]) : 0, needsChoice: false };
  if (info.kind === "yes-no")
    return {
      kind: "yes-no",
      value: options.length ? Boolean(options[0]) : false,
      needsChoice: false,
    };
  if (info.kind === "role-pair" && options.length)
    return { kind: "role-pair", pair: String(options[0]).split("|"), needsChoice: false };
  if ((info.kind === "character" || info.kind === "one-of-two") && options.length)
    return { kind: info.kind, roleId: String(options[0]), needsChoice: false };
  return { kind: info.kind || "note", needsChoice: false };
}

function finishWholeNight(
  state: GameState,
  demonId: string,
  seen: { juggler?: unknown; [key: string]: unknown },
): void {
  for (let guard = 0; guard < 80; guard += 1) {
    const step = currentStep(state);
    if (!step || state.winner) return;
    const living = state.order.filter((id) => state.players[id].alive && id !== step.actorId);
    const targets = (step.maxTargets || 0) > 0 ? living.slice(0, step.minTargets || 1) : [];
    const info = infoForStep(state, step, { targetIds: targets });
    if (step.roleId === "juggler") seen.juggler = info.value;
    const options: { targetIds: string[]; given?: Record<string, unknown> } = {
      targetIds: targets,
    };
    if (info.needsChoice) options.given = falseInfo(info);
    const result = completeStep(state, step.key, options);
    assert.equal(
      result.ok,
      true,
      (step.roleId || step.system || "") + ": " + JSON.stringify(result),
    );
    if (state.winner) return;
    if (step.canKill && step.actorId === demonId) {
      const victim = state.order.find(
        (id) =>
          state.players[id].alive &&
          id !== demonId &&
          roleTeam(state.players[id].roleId || "") !== "demon",
      );
      if (victim) recordSvOutcome(state, step.key, { deathIds: [victim] });
    }
  }
  throw new Error("night did not finish");
}

test("a full Sects and Violets game runs from setup to a winner", () => {
  const state = make(
    { 1: "clockmaker", 2: "oracle", 3: "cerenovus", 4: "vortox", 8: "juggler" },
    { count: 8 },
  );
  const demonId = "4";
  assert.deepEqual(setupErrors(state), []);
  assert.equal(startNight(state).ok, true);
  const seen: { juggler?: unknown } = {};
  for (let round = 0; round < 12 && !state.winner; round += 1) {
    finishWholeNight(state, demonId, seen);
    if (state.winner) break;
    assert.equal(endNight(state).ok, true);
    if (state.winner) break;
    if (state.day.number === 1) {
      assert.equal(jugglerGuess(state, "6", state.players["6"].roleId!).ok, true);
      assert.equal(jugglerGuess(state, "7", "juggler").ok, true);
    }
    assert.equal(openNominations(state).ok, true);
    const victim = state.order.find(
      (id) => state.players[id].alive && roleTeam(state.players[id].roleId || "") !== "demon",
    );
    assert.ok(victim, "a Townsfolk remains to execute");
    const executed = executeByDecision(state, victim);
    assert.equal(executed.ok, true, JSON.stringify(executed));
    if (state.winner) break;
    assert.equal(endDay(state).ok, true);
  }
  assert.ok(state.winner, "the game reaches a winner");
  assert.deepEqual(validateState(state), []);
  assert.equal(seen.juggler, 1, "the Juggler's night answer counts the first-day guesses");
});

// ---------------------------------------------------------------------------
// Issue #171 section 3: Sects and Violets audit fixes

test("the Klutz public choice resolves the game as soon as the Klutz learns of the death", () => {
  const state = make({ 1: "klutz", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  laterNight(state);
  state.phase = "day";
  state.day = {
    number: 2,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  assert.equal(executeByDecision(state, "1").ok, true);
  assert.equal(state.players["1"].alive, false);
  const result = recordKlutzChoice(state, "8");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(state.winner && state.winner.team, "evil", "an evil choice loses immediately");
  assert.equal(state.winner && state.winner.reason, "klutz");
  assert.equal(state.players["1"].used.klutz, true, "the once-per-game is spent");
  assert.equal(state.players["1"].used.klutzTarget, "8", "the public choice is recorded");
});

test("a recorded Klutz choice finishes the queued step and a dead target does not strand it", () => {
  const state = make({ 1: "klutz", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  laterNight(state);
  kill(state, "1", "ability", { phase: "night", number: 2 }, { demon: true, ability: "fanggu" });
  appendConditionalSteps(state);
  const step = state.night.queue.find((candidate) => candidate.roleId === "klutz")!;
  assert.ok(step, "the dead Klutz has a step");
  // The target the player meant to choose died first: the host must be able to
  // choose any player who is alive at the moment of the public choice.
  const rejected = recordKlutzChoice(state, "1");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errorCode, "error.55", "a dead target is refused, not stranded");
  assert.equal(recordKlutzChoice(state, "2").ok, true, "another living player is legal");
  assert.equal(step.done, true, "the public choice completes the queued step");
  assert.deepEqual(step.targetIds, ["2"]);
  assert.equal(state.winner, null, "a good choice does not lose");
});

test("a Pit-Hag-created Demon does not take the Demon turn and its deaths are not Demon attacks", () => {
  const state = make({ 1: "clockmaker", 2: "sage", 6: "pithag", 8: "fanggu" }, { count: 8 });
  laterNight(state);
  const step = stepFor(state, "pithag");
  const newDemon = ["nodashii", "vortox", "vigormortis"].find(
    (id) => !rolesInPlay(state).includes(id),
  ) as RoleId;
  const created = runStep(state, "pithag-demon-create", {
    key: step.key,
    targetIds: ["3"],
    roleId: newDemon,
  });
  assert.equal(created.status, "allowed", JSON.stringify(created));
  assert.equal(state.players["3"].roleId, newDemon);
  assert.equal(
    state.night.queue.some(
      (candidate) => candidate.roleId === newDemon && !candidate.done && !candidate.skipped,
    ),
    false,
    "the created Demon does not wake again tonight",
  );
  assert.equal(step.canKill, true, "the host records the arbitrary deaths on the Pit-Hag step");
  const outcome = recordSvOutcome(state, step.key, { deathIds: ["2"] });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  const death = state.deaths.find((entry) => entry.playerId === "2")!;
  assert.ok(death, "the Sage died");
  assert.notEqual(death.demon, true, "the death is a Pit-Hag attack, not a Demon attack");
  assert.equal(
    state.night.queue.some((candidate) => candidate.roleId === "sage"),
    false,
    "the Sage does not wake for a Pit-Hag death",
  );
});

test("Vortox and impairment make the Dreamer, Sage and Mathematician answers false choices", () => {
  const state = make({ 1: "dreamer", 2: "sage", 3: "mathematician", 7: "vortox" }, { count: 8 });
  startNight(state);
  // The Vortox ends a day without an execution, so the second night is built
  // directly to keep the Demon alive for the information check.
  state.night.number = 2;
  state.night.queue = buildSvNightQueue(state);
  const vortox = stepFor(state, "vortox");
  assert.equal(completeStep(state, vortox.key, { targetIds: ["2"] }).ok, true);
  assert.equal(recordSvOutcome(state, vortox.key, { deathIds: ["2"] }).ok, true);
  for (const roleId of ["dreamer", "mathematician", "sage"]) {
    const step = stepFor(state, roleId);
    const info = infoForStep(state, step);
    assert.equal(info.needsChoice, true, roleId + " demands a false answer under a Vortox");
    const targets = (step.minTargets || 0) > 0 ? ["2"] : [];
    const blocked = stepOutcome(completeStep(state, step.key, { targetIds: targets }));
    assert.equal(blocked.needsChoice, true, roleId + " is blocked without the host answer");
  }

  const clear = make({ 1: "dreamer", 2: "sage", 3: "mathematician", 7: "fanggu" }, { count: 8 });
  laterNight(clear);
  assert.equal(
    infoForStep(clear, stepFor(clear, "dreamer")).needsChoice,
    false,
    "a healthy Dreamer without a Vortox needs no answer",
  );
});

test("a drunk dead Minion loses the Vigormortis retention and the neighbour poison until sober", () => {
  const state = make({ 1: "clockmaker", 2: "cerenovus", 8: "vigormortis" }, { count: 8 });
  laterNight(state);
  const step = stepFor(state, "vigormortis");
  assert.equal(completeStep(state, step.key, { targetIds: ["2"] }).ok, true);
  assert.equal(recordSvOutcome(state, step.key, { deathIds: ["2"] }).ok, true);
  const poison = state.effects.find((effect) => effect.vigormortis === true)!;
  assert.ok(poison, "the neighbour poison exists");
  assert.equal(poison.active, true);
  assert.equal(minionRetainsAbility(state, "2"), true, "the dead Minion keeps the ability");

  const drunk = {
    id: "test-dead-minion-drunk",
    kind: "drunk",
    sourceId: "1",
    targetId: "2",
    start: { phase: "night" as const, number: 2 },
    expires: null,
    active: true,
  };
  state.effects.push(drunk);
  reconcileVigormortisPoison(state);
  assert.equal(isImpaired(state, "2"), true, "the dead Minion is drunk");
  assert.equal(
    minionRetainsAbility(state, "2"),
    false,
    "a drunk Minion loses the retained ability",
  );
  assert.equal(poison.active, false, "the permanent neighbour poison does not bypass impairment");
  assert.equal(isImpaired(state, poison.targetId!), false, "the poisoned neighbour is healthy");

  state.effects = state.effects.filter((effect) => effect !== drunk);
  reconcileVigormortisPoison(state);
  assert.equal(minionRetainsAbility(state, "2"), true, "the ability returns when sober");
  assert.equal(poison.active, true);
  assert.equal(isImpaired(state, poison.targetId!), true);
});

test("a Philosopher who borrowed the Klutz still makes the public choice after dying", () => {
  const state = make({ 1: "philosopher", 2: "clockmaker", 6: "pithag", 7: "fanggu" }, { count: 7 });
  startNight(state);
  const borrowed = runStep(state, "philosopher-klutz", {
    key: stepFor(state, "philosopher").key,
    roleId: "klutz",
  });
  assert.equal(borrowed.status, "allowed", JSON.stringify(borrowed));
  assert.equal(state.players["1"].used.philosopherAbility, "klutz");
  kill(state, "1", "ability", { phase: "night", number: 1 }, { demon: true, ability: "fanggu" });
  appendConditionalSteps(state);
  const step = state.night.queue.find(
    (candidate) => candidate.roleId === "klutz" && candidate.actorId === "1",
  );
  assert.ok(step, "the borrowed Klutz ability wakes after the Philosopher dies");
  assert.equal(completeStep(state, step.key, { targetIds: ["7"] }).ok, true);
  assert.equal(state.winner && state.winner.reason, "klutz");
  assert.equal(state.winner && state.winner.team, "evil");
});

test("the Sweetheart drunk starts at the death, not at the Sweetheart night slot", () => {
  const state = make({ 1: "sweetheart", 2: "clockmaker", 8: "fanggu" }, { count: 8 });
  laterNight(state);
  state.phase = "day";
  state.day = {
    number: 2,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  assert.equal(executeByDecision(state, "1").ok, true);
  assert.equal(state.players["1"].alive, false, "the Sweetheart was executed");
  state.phase = "night";
  state.night.number = 3;
  state.night.queue = [];
  appendConditionalSteps(state);
  const step = state.night.queue.find((candidate) => candidate.roleId === "sweetheart");
  assert.ok(step, "the dead Sweetheart has a step");
  assert.equal(completeStep(state, step.key, { targetIds: ["2"] }).ok, true);
  const drunk = state.effects.find((effect) => effect.kind === "drunk" && effect.targetId === "2")!;
  assert.ok(drunk, "the chosen player is drunk");
  assert.equal(drunk.start.phase, "day", "the drunk starts at the death");
  assert.equal(drunk.start.number, 2);
});

test("a Pit-Hag-created Evil Twin keeps the twin win and the good-win block", () => {
  const state = make({ 1: "clockmaker", 2: "dreamer", 6: "pithag", 7: "fanggu" }, { count: 7 });
  laterNight(state);
  const step = stepFor(state, "pithag");
  const created = runStep(state, "pithag-eviltwin", {
    key: step.key,
    targetIds: ["2"],
    roleId: "eviltwin",
  });
  assert.equal(created.status, "allowed", JSON.stringify(created));
  assert.equal(state.players["2"].roleId, "eviltwin");
  assert.equal(state.setup.evilTwinPlayerId, "2", "the new Evil Twin joins the pair");
  const goodTwin = state.setup.evilTwinGoodPlayerId;
  assert.equal(typeof goodTwin, "string", "the pair has a good twin");
  assert.notEqual(goodTwin, "2");
  assert.equal(state.players[goodTwin!].alive, true);
  assert.equal(realTeamOf(state.players[goodTwin!]), "good");

  // Executing the good twin still wins for evil.
  state.phase = "day";
  state.day = {
    number: 3,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  assert.equal(executeByDecision(state, goodTwin!).ok, true);
  assert.equal(state.winner && state.winner.reason, "evil-twin");

  const blocked = make({ 1: "clockmaker", 2: "dreamer", 6: "pithag", 7: "fanggu" }, { count: 7 });
  laterNight(blocked);
  const blockedStep = stepFor(blocked, "pithag");
  assert.equal(
    runStep(blocked, "pithag-eviltwin-block", {
      key: blockedStep.key,
      targetIds: ["2"],
      roleId: "eviltwin",
    }).status,
    "allowed",
  );
  blocked.players["7"].alive = false;
  assert.equal(
    checkWin(blocked),
    null,
    "good cannot win while both twins live and the Demon is dead",
  );
});

test("a madness execution can happen during the night", () => {
  const state = make({ 1: "clockmaker", 2: "mutant", 6: "witch", 7: "fanggu" }, { count: 8 });
  startNight(state);
  state.phase = "night";
  state.night.number = 2;
  const result = applyCommand(state, {
    id: "madness-night-execution",
    type: "madnessPenalty",
    payload: {
      playerId: "2",
      penalty: "execute",
      reason: "The Mutant broke madness during the night.",
    },
  });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["2"].alive, false, "the Storyteller may execute at night");
});
