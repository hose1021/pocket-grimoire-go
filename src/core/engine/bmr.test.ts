import test from "node:test";
import assert from "node:assert/strict";
import {
  BMR,
  BMR_ALL,
  BMR_NIGHT_FIRST,
  BMR_NIGHT_OTHER,
  COMPOSITION,
  bagErrors,
  compositionFor,
  isBmrRole,
  isSupportedRole,
  randomBag,
  roleTeam,
} from "../model/rules.ts";
import { roleSupportEntries } from "../model/support.ts";
import { createGame, exportGame, importGame, validateState } from "../model/state.ts";
import {
  checkWin,
  completeStep,
  dealGame,
  effectActive,
  endDay,
  endNight,
  bmrInfoForStep,
  executeByDecision,
  gossipStatement,
  infoForStep,
  isImpaired,
  kill,
  moonchildChoice,
  recordBmrOutcome,
  setupErrors,
  skipStep,
  startNight,
} from "./index.ts";
import { applyCommand, canonicalState, previewCommand, validateCommand } from "./index.ts";
import { badMoonRisingScript } from "../model/scripts.ts";
import type { AllowedResult, DomainEvent, GameState, NightStep, RoleId } from "../model/types.ts";

type MakeOptions = { count?: number; lunaticShownId?: RoleId | null };

type FutureEffectView = {
  id: string;
  kind: string;
  targetId: string | null;
  expires: { number: number } | null;
  resolve: { number: number } | null;
  suspended: string | null;
  resumeOnHealthy: boolean;
};

type FutureView = {
  winner: { team: string; reason: string } | null;
  delayedEffects: FutureEffectView[];
};

type ChangesView = { deaths: string[] };

type CommandView = AllowedResult & {
  events: DomainEvent[];
  changes: ChangesView;
  future: FutureView;
};

// Builds a legal bag that contains every requested role and fills the rest
// from the same teams, then deals the requested roles to the named seats.
function make(assignment: Record<string, RoleId>, options: MakeOptions = {}): GameState {
  const count = options.count || Object.keys(assignment).length;
  const state = createGame(count);
  state.script = badMoonRisingScript();
  state.scriptId = "bmr";
  state.setup.count = count;
  const required = [...new Set(Object.values(assignment))];
  const counts: Record<string, number> = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const id of required) counts[roleTeam(id)!] += 1;
  const target = compositionFor(count, required)!;
  const roles = [...required];
  for (const team of ["outsider", "townsfolk", "minion", "demon"] as const) {
    const need = target[team] - counts[team];
    assert.ok(need >= 0, "too many " + team + " in fixture");
    const pool = BMR[team].filter((id) => !roles.includes(id));
    assert.ok(pool.length >= need, "not enough " + team + " roles for fixture");
    roles.push(...pool.slice(0, need));
  }
  assert.equal(roles.length, count, "fixture bag size");
  state.setup.roles = roles;
  state.setup.bluffs = BMR_ALL.filter((id) => !roles.includes(id)).slice(0, count >= 7 ? 3 : 0);
  state.setup.lunaticShownId = roles.includes("lunatic")
    ? roles.find((id) => roleTeam(id) === "demon") || null
    : null;
  const full = { ...assignment };
  const spare = roles.filter((id) => !required.includes(id));
  for (const id of state.order) {
    if (full[id]) continue;
    full[id] = spare.shift()!;
  }
  if (options.lunaticShownId) state.setup.lunaticShownId = options.lunaticShownId;
  const result = dealGame(state, { assignment: full });
  assert.equal(result.ok, true, JSON.stringify(result));
  for (const id of state.order) state.players[id].name = "P" + id;
  return state;
}

function aliveExcept(
  state: GameState,
  excluded: ReadonlyArray<string | null | undefined> = [],
): string[] {
  return state.order.filter((id) => state.players[id].alive && !excluded.includes(id));
}

function finishNight(state: GameState): void {
  for (let guard = 0; guard < 40; guard += 1) {
    const step = state.night.queue.find((candidate) => !candidate.done && !candidate.skipped);
    if (!step) return;
    const pool = aliveExcept(state, [step.actorId, step.previousTarget]);
    const ids = pool.slice(0, step.minTargets || 0);
    const info = infoForStep(state, step, { targetIds: ids });
    // The engine accepts only an offered option, so the fixture picks one.
    const options = Array.isArray(info.options) ? info.options : [];
    let given: Record<string, unknown> = { kind: "note", text: "fixture" };
    if (options.length) {
      const option = options[0];
      if (info.kind === "number") given = { kind: "number", value: Number(option) };
      else if (info.kind === "yes-no") given = { kind: "yes-no", value: Boolean(option) };
      else if (info.kind === "role-pair")
        given = { kind: "role-pair", pair: String(option).split("|") };
      else if (info.kind === "character" || info.kind === "one-of-two")
        given = { kind: info.kind, roleId: String(option) };
    }
    const result: Record<string, unknown> = completeStep(state, step.key, {
      targetIds: ids,
      given,
    });
    if (!result.ok) {
      assert.equal(result.needsChoice, true, JSON.stringify(result));
      completeStep(state, step.key, { targetIds: ids, given });
    }
  }
  throw new Error("night did not finish");
}

function nextNight(state: GameState): void {
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
}

function skipRemaining(state: GameState): void {
  for (let guard = 0; guard < 40; guard += 1) {
    const step = state.night.queue.find((candidate) => !candidate.done && !candidate.skipped);
    if (!step) return;
    assert.equal(skipStep(state, step.key, "fixture").ok, true);
  }
  throw new Error("night did not finish");
}

function skipUntil(
  state: GameState,
  predicate: (step: NightStep) => boolean,
): NightStep | undefined {
  for (let guard = 0; guard < 40; guard += 1) {
    const step = state.night.queue.find((candidate) => !candidate.done && !candidate.skipped);
    if (!step || predicate(step)) return step;
    assert.equal(skipStep(state, step.key, "fixture").ok, true);
  }
  throw new Error("step not found");
}

function nightTwo(state: GameState): void {
  startNight(state);
  skipRemaining(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
}

function endNightToNext(state: GameState): void {
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
}

function pukkaStep(state: GameState): NightStep | undefined {
  return state.night.queue.find((step) => step.roleId === "pukka");
}

test("Bad Moon Rising rosters, composition and night order follow the official data", () => {
  assert.equal(BMR_ALL.length, 25);
  assert.deepEqual(
    [BMR.townsfolk.length, BMR.outsider.length, BMR.minion.length, BMR.demon.length],
    [13, 4, 4, 4],
  );
  for (const id of BMR_ALL) assert.equal(isBmrRole(id), true);
  assert.equal(isSupportedRole("po"), true);
  assert.equal(isBmrRole("chef"), false);
  assert.deepEqual(compositionFor(8, ["godfather"]), {
    townsfolk: 4,
    outsider: 2,
    minion: 1,
    demon: 1,
  });
  assert.deepEqual(compositionFor(8, ["godfather"], -1), {
    townsfolk: 6,
    outsider: 0,
    minion: 1,
    demon: 1,
  });
  assert.deepEqual(compositionFor(7, ["baron"]), {
    townsfolk: 3,
    outsider: 2,
    minion: 1,
    demon: 1,
  });
  assert.deepEqual(BMR_NIGHT_FIRST, [
    "info",
    "lunatic",
    "sailor",
    "courtier",
    "godfather",
    "devilsadvocate",
    "pukka",
    "grandmother",
    "chambermaid",
  ]);
  assert.equal(BMR_NIGHT_OTHER.length, 19);
  assert.equal(BMR_NIGHT_OTHER[0], "sailor");
  assert.equal(BMR_NIGHT_OTHER.at(-1), "chambermaid");
});

test("random Bad Moon Rising bags are legal at every player count", () => {
  for (const count of Object.keys(COMPOSITION).map(Number)) {
    const bag = randomBag(count, Math.random, BMR_ALL);
    const errors = bagErrors({
      count,
      roles: bag.roles,
      bluffs: bag.bluffs,
      lunaticShownId: bag.lunaticShownId,
      pool: BMR_ALL,
    });
    assert.deepEqual(errors, [], count + ": " + JSON.stringify(errors));
    assert.equal(bag.bluffs.length, count >= 7 ? 3 : 0);
  }
});

test("the Godfather +/-1 Outsider setting is applied and impossible choices are reported", () => {
  const bag = randomBag(8, () => 0.9, BMR_ALL, { godfatherOutsider: -1 });
  assert.equal(
    bagErrors({
      count: 8,
      roles: bag.roles,
      bluffs: bag.bluffs,
      lunaticShownId: bag.lunaticShownId,
      pool: BMR_ALL,
      godfatherOutsider: -1,
    }).length,
    0,
  );
  const invalid = bagErrors({
    count: 7,
    roles: ["godfather", "chambermaid", "chef", "empath", "fortuneteller", "undertaker", "imp"],
    bluffs: ["soldier", "mayor", "virgin"],
    pool: BMR_ALL,
    godfatherOutsider: -1,
  });
  assert.ok(invalid.some((error) => error.code === "godfather-minus"));
});

test("a Bad Moon Rising game deals, validates and starts a night", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "gossip",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 8 },
  );
  assert.deepEqual(setupErrors(state), []);
  assert.deepEqual(validateState(state), []);
  const started = startNight(state);
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.ok(state.night.queue.some((step) => step.roleId === "chambermaid"));
  assert.ok(state.night.queue.some((step) => step.roleId === "sailor"));
  assert.equal(importGame(exportGame(state)).ok, true);
});

test("Bad Moon Rising night targets are validated against the step range", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "gossip",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 8 },
  );
  startNight(state);
  const sailor = state.night.queue.find((step) => step.roleId === "sailor")!;
  assert.equal(completeStep(state, sailor.key, { targetIds: [] }).ok, false);
  assert.equal(completeStep(state, sailor.key, { targetIds: ["1", "2"] }).ok, false);
  assert.equal(completeStep(state, sailor.key, { targetIds: ["1"] }).ok, true);
  assert.equal(completeStep(state, sailor.key, { targetIds: ["1"] }).ok, false);
});

test("the Po may hit three players only after a night with no choice", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "gossip",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 8 },
  );
  assert.equal(startNight(state).ok, true);
  nextNight(state); // Po does not wake on night one.
  const first = state.night.queue.find((step) => step.roleId === "po");
  assert.ok(first);
  assert.equal(first.minTargets, 0);
  assert.equal(first.maxTargets, 1);
  completeStep(state, first.key, { targetIds: [] });
  assert.equal(state.players["6"].used.poNoOne, true);
  nextNight(state);
  const second = state.night.queue.find((step) => step.roleId === "po");
  assert.ok(second);
  assert.equal(second.minTargets, 3);
  assert.equal(second.maxTargets, 3);
});

test("the Pukka poisons immediately and kills the previous victim next night", () => {
  const state = make(
    {
      1: "pukka",
      2: "chambermaid",
      3: "courtier",
      4: "sailor",
      5: "gossip",
      6: "mastermind",
    },
    { count: 7 },
  );
  startNight(state);
  let step = pukkaStep(state)!;
  assert.ok(step, "Pukka wakes on night one");
  completeStep(state, step.key, { targetIds: ["2"] });
  assert.equal(isImpaired(state, "2"), true, "the target is poisoned immediately");
  assert.equal(state.players["2"].alive, true);
  assert.ok(
    state.effects.some(
      (effect) =>
        effect.kind === "poison" &&
        effect.pukka === true &&
        effect.targetId === "2" &&
        effect.active,
    ),
  );

  nextNight(state);
  step = pukkaStep(state)!;
  completeStep(state, step.key, { targetIds: ["3"] });
  assert.equal(state.players["2"].alive, false, "the previous victim dies");
  assert.equal(state.deaths.at(-1)!.impaired, true, "the victim is still poisoned when it dies");
  assert.equal(isImpaired(state, "2"), false, "the victim becomes healthy");
  assert.equal(isImpaired(state, "3"), true, "the new target is poisoned");
  assert.equal(state.deaths.at(-1)!.number, 2);

  nextNight(state);
  step = pukkaStep(state)!;
  completeStep(state, step.key, { targetIds: ["4"] });
  assert.equal(state.players["3"].alive, false, "the next victim dies");
  assert.equal(isImpaired(state, "3"), false);
  assert.equal(isImpaired(state, "4"), true);
});

test("an Exorcist skip resolves the Pukka's previous kill without a new poison", () => {
  const state = make(
    {
      1: "pukka",
      2: "exorcist",
      3: "chambermaid",
      4: "courtier",
      5: "sailor",
      6: "mastermind",
    },
    { count: 7 },
  );
  startNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["3"] });
  nextNight(state);

  const exorcist = state.night.queue.find((step) => step.roleId === "exorcist")!;
  completeStep(state, exorcist.key, { targetIds: ["1"] });
  assert.equal(state.players["3"].alive, false, "the previous victim still dies");
  assert.equal(isImpaired(state, "3"), false);
  const skipped = pukkaStep(state)!;
  assert.equal(skipped.done, true);
  assert.equal(skipped.skipped, true);
  assert.equal(isImpaired(state, "4"), false, "the Pukka did not wake, so no new poison");

  nextNight(state);
  const nextExorcist = state.night.queue.find((step) => step.roleId === "exorcist")!;
  completeStep(state, nextExorcist.key, { targetIds: ["2"] });
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["4"] });
  assert.equal(isImpaired(state, "4"), true, "the Pukka poisons again on a later night");
});

test("an Innkeeper prevents the Pukka's delayed death and clears the poison", () => {
  const state = make(
    {
      1: "pukka",
      2: "innkeeper",
      3: "chambermaid",
      4: "courtier",
      5: "sailor",
      6: "mastermind",
    },
    { count: 7 },
  );
  startNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["3"] });
  nextNight(state);

  const innkeeper = state.night.queue.find((step) => step.roleId === "innkeeper")!;
  completeStep(state, innkeeper.key, { targetIds: ["3", "4"], drunkId: "4" });
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["5"] });

  assert.equal(state.players["3"].alive, true, "the protected victim survives");
  assert.equal(isImpaired(state, "3"), false, "the surviving victim is no longer poisoned");
  assert.equal(isImpaired(state, "5"), true, "the new target is poisoned");
});

test("the Pukka poisons the new target before the previous victim dies", () => {
  const state = make(
    {
      1: "pukka",
      2: "chambermaid",
      3: "tealady",
      4: "courtier",
      5: "gossip",
      6: "mastermind",
      7: "exorcist",
    },
    { count: 7 },
  );
  startNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["2"] });
  nextNight(state);

  completeStep(state, pukkaStep(state)!.key, { targetIds: ["3"] });
  assert.equal(isImpaired(state, "3"), true, "the Tea Lady is poisoned first");
  assert.equal(
    state.players["2"].alive,
    false,
    "the impaired Tea Lady cannot protect her neighbour",
  );
});

test("a sober Tea Lady protects a Pukka victim from the delayed death", () => {
  const state = make(
    {
      1: "pukka",
      2: "chambermaid",
      3: "tealady",
      4: "courtier",
      5: "gossip",
      6: "mastermind",
      7: "exorcist",
    },
    { count: 7 },
  );
  startNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["2"] });
  nextNight(state);

  completeStep(state, pukkaStep(state)!.key, { targetIds: ["5"] });
  assert.equal(state.players["2"].alive, true, "the Tea Lady protects her neighbour");
  assert.equal(isImpaired(state, "2"), false, "the protected victim becomes healthy");
  assert.equal(isImpaired(state, "5"), true, "the new target is poisoned");
});

test("the Pukka can poison a dead player who is resurrected later", () => {
  const state = make(
    {
      1: "pukka",
      2: "professor",
      3: "chambermaid",
      4: "courtier",
      5: "gossip",
      6: "mastermind",
      7: "tinker",
    },
    { count: 8 },
  );
  startNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["4"] });
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  kill(state, "3", "ability", { phase: "day" as const, number: 1 });
  assert.equal(endDay(state).ok, true);

  completeStep(state, pukkaStep(state)!.key, { targetIds: ["3"] });
  const professor = state.night.queue.find((step) => step.roleId === "professor")!;
  assert.ok(professor);
  completeStep(state, professor.key, { targetIds: ["3"] });
  assert.equal(state.players["3"].alive, true, "the Professor resurrects the Chambermaid");
  assert.equal(isImpaired(state, "3"), true, "the resurrected player is still poisoned");

  nextNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["5"] });
  assert.equal(
    state.players["3"].alive,
    false,
    "the delayed death still applies after resurrection",
  );
});

test("the Exorcist cannot resolve a Pukka death scheduled for a later night", () => {
  const state = make(
    {
      1: "pukka",
      2: "exorcist",
      3: "chambermaid",
      4: "courtier",
      5: "gossip",
      6: "mastermind",
    },
    { count: 7 },
  );
  startNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["3"] });
  nextNight(state);

  completeStep(state, pukkaStep(state)!.key, { targetIds: ["4"] });
  assert.equal(state.players["3"].alive, false);
  const exorcist = state.night.queue.find((step) => step.roleId === "exorcist")!;
  completeStep(state, exorcist.key, { targetIds: ["1"] });
  assert.equal(
    state.players["4"].alive,
    true,
    "the new victim dies on the next night, not this one",
  );

  nextNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["5"] });
  assert.equal(state.players["4"].alive, false, "the pending death resolves on its due night");
});

test("the Pukka choosing the same player twice clears both poisons", () => {
  const state = make(
    {
      1: "pukka",
      2: "chambermaid",
      3: "courtier",
      4: "sailor",
      5: "gossip",
      6: "mastermind",
    },
    { count: 7 },
  );
  startNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["3"] });
  nextNight(state);

  completeStep(state, pukkaStep(state)!.key, { targetIds: ["3"] });
  assert.equal(state.players["3"].alive, false);
  assert.equal(isImpaired(state, "3"), false, "both Pukka poisons are cleared on death");
  assert.equal(
    state.effects.some(
      (effect) =>
        effect.targetId === "3" &&
        effect.active !== false &&
        (effect.kind === "pukka-death" || (effect.kind === "poison" && effect.pukka === true)),
    ),
    false,
  );
});

test("a protected Pukka victim chosen twice becomes healthy", () => {
  const state = make(
    {
      1: "pukka",
      2: "innkeeper",
      3: "chambermaid",
      4: "courtier",
      5: "gossip",
      6: "mastermind",
    },
    { count: 7 },
  );
  startNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["3"] });
  nextNight(state);

  const innkeeper = state.night.queue.find((step) => step.roleId === "innkeeper")!;
  completeStep(state, innkeeper.key, { targetIds: ["3", "4"], drunkId: "4" });
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["3"] });
  assert.equal(state.players["3"].alive, true);
  assert.equal(isImpaired(state, "3"), false, "the protected victim becomes healthy");
  assert.equal(
    state.effects.some(
      (effect) =>
        effect.targetId === "3" &&
        effect.active !== false &&
        (effect.kind === "pukka-death" || (effect.kind === "poison" && effect.pukka === true)),
    ),
    false,
  );
});

test("a drunk Pukka suspends the poison and resumes it when sober", () => {
  const state = make(
    {
      1: "pukka",
      2: "chambermaid",
      3: "courtier",
      4: "sailor",
      5: "gossip",
      6: "mastermind",
    },
    { count: 7 },
  );
  startNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["2"] });
  nextNight(state);

  state.effects.push({
    id: "test-pukka-drunk",
    kind: "drunk",
    sourceId: "1",
    targetId: "1",
    start: { phase: "night" as const, number: 2 },
    expires: { phase: "night" as const, number: 3 },
    active: true,
  });
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["3"] });
  assert.equal(state.players["2"].alive, true, "the delayed death is suspended");
  assert.equal(
    isImpaired(state, "2"),
    false,
    "the old poison is inactive while the Pukka is drunk",
  );
  assert.equal(isImpaired(state, "3"), false, "a drunk Pukka does not poison a new target");

  nextNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["4"] });
  assert.equal(
    state.players["2"].alive,
    false,
    "the suspended victim dies when the Pukka is sober",
  );
  assert.equal(isImpaired(state, "3"), false);
  assert.equal(isImpaired(state, "4"), true);
});

test("a dead Pukka stops poisoning and cancels the delayed death", () => {
  const state = make(
    {
      1: "pukka",
      2: "chambermaid",
      3: "courtier",
      4: "sailor",
      5: "gossip",
      6: "mastermind",
    },
    { count: 7 },
  );
  startNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["2"] });
  const pending = state.effects.find((effect) => effect.kind === "pukka-death");
  assert.ok(pending);

  kill(state, "1", "ability", { phase: "night" as const, number: 1 }, { demon: true });
  assert.equal(state.players["1"].alive, false);
  assert.equal(effectActive(state, pending, { phase: "night" as const, number: 2 }), false);
  assert.equal(isImpaired(state, "2"), false);
});

test("Pukka consequences are identical through validate, preview and apply", () => {
  const state = make(
    {
      1: "pukka",
      2: "chambermaid",
      3: "courtier",
      4: "sailor",
      5: "gossip",
      6: "mastermind",
    },
    { count: 7 },
  );
  startNight(state);
  const first = pukkaStep(state)!;
  const command = {
    id: "pukka-first",
    type: "completeNightStep",
    payload: { key: first.key, targetIds: ["2"] },
  };
  const before = canonicalState(state);
  assert.equal(validateCommand(state, command).status, "allowed");
  assert.deepEqual(canonicalState(state), before, "validate must not mutate");

  const preview = previewCommand(state, command) as CommandView;
  assert.equal(preview.status, "allowed", JSON.stringify(preview));
  assert.ok(preview.events.some((event) => event.type === "effect.added"));
  assert.ok(
    preview.future.delayedEffects.some(
      (effect) => effect.kind === "pukka-death" && effect.resolve && effect.resolve.number === 2,
    ),
    "the pending death appears in the future projection",
  );
  assert.deepEqual(canonicalState(state), before, "preview must not mutate");

  const applied = applyCommand(state, command) as CommandView;
  assert.equal(applied.status, "allowed", JSON.stringify(applied));
  assert.deepEqual(preview.events, applied.events);
  assert.equal(isImpaired(state, "2"), true);

  nextNight(state);
  const second = pukkaStep(state)!;
  const killCommand = {
    id: "pukka-second",
    type: "completeNightStep",
    payload: { key: second.key, targetIds: ["3"] },
  };
  const killPreview = previewCommand(state, killCommand) as CommandView;
  assert.equal(killPreview.status, "allowed", JSON.stringify(killPreview));
  assert.ok(killPreview.events.some((event) => event.type === "death.recorded"));
  const appliedKill = applyCommand(state, killCommand);
  assert.equal(appliedKill.status, "allowed", JSON.stringify(appliedKill));
  assert.equal(state.players["2"].alive, false);
  assert.equal(isImpaired(state, "3"), true);

  const repeated = applyCommand(state, killCommand) as AllowedResult;
  assert.equal(repeated.idempotent, true);
  assert.equal(state.deaths.filter((death) => death.playerId === "2").length, 1);
});

test("the Pukka's poison and pending death survive export and import", () => {
  const state = make(
    {
      1: "pukka",
      2: "chambermaid",
      3: "courtier",
      4: "sailor",
      5: "gossip",
      6: "mastermind",
    },
    { count: 7 },
  );
  startNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["2"] });

  const restored = importGame(exportGame(state));
  assert.equal(restored.ok, true, "error" in restored ? restored.error : "");
  assert.deepEqual(validateState(restored.state), []);
  assert.equal(isImpaired(restored.state, "2"), true, "the poison persists");

  nextNight(restored.state);
  completeStep(restored.state, pukkaStep(restored.state)!.key, { targetIds: ["3"] });
  assert.equal(restored.state.players["2"].alive, false, "the pending death persists");
  assert.equal(isImpaired(restored.state, "3"), true);
});

test("the Assassin kills through the Fool's protection", () => {
  const state = make(
    {
      1: "fool",
      2: "chambermaid",
      3: "sailor",
      4: "courtier",
      5: "po",
      6: "assassin",
      7: "exorcist",
    },
    { count: 8 },
  );
  startNight(state);
  nextNight(state);
  const assassin = state.night.queue.find((step) => step.roleId === "assassin");
  assert.ok(assassin);
  completeStep(state, assassin.key, { targetIds: ["1"] });
  recordBmrOutcome(state, assassin.key, { deathIds: ["1"] });
  assert.equal(state.players["1"].alive, false);
  assert.equal(state.players["1"].used.fool, undefined, "the Assassin ignored the Fool's ability");
});

test("the Zombuul survives its first death but registers as dead", () => {
  const state = make(
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
  const result = executeByDecision(state, "6");
  assert.equal(result.ok, true);
  assert.equal(state.players["6"].alive, true);
  assert.equal(state.players["6"].registeredDead, true);
  assert.equal(state.winner, null);
  assert.equal(state.players["6"].used.zombuul, true);
  const zombuulLog = state.log.find((entry) => entry.title.includes("первая смерть Зомбула"));
  assert.equal(zombuulLog?.consequence, "prevented");
});

test("the Zombuul kills at night when nobody died today", () => {
  const state = make(
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
  nextNight(state);
  const step = state.night.queue.find((candidate) => candidate.roleId === "zombuul");
  assert.ok(step, "the Zombuul wakes after a day without a death");
  assert.equal(completeStep(state, step.key, { targetIds: ["1"] }).ok, true);
  assert.equal(recordBmrOutcome(state, step.key, { deathIds: ["1"] }).ok, true);
  assert.equal(state.players["1"].alive, false, "the chosen player dies");
});

test("the Mastermind extends the game by one day after a Demon execution", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "mastermind",
      4: "sailor",
      5: "gossip",
      6: "po",
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
  executeByDecision(state, "6");
  assert.equal(state.winner, null);
  assert.equal(state.mastermind!.active, true);
  assert.equal(endDay(state).ok, true);
  assert.equal(state.phase, "day");
  assert.equal(state.day.number, 2);
  executeByDecision(state, "1");
  endDay(state);
  assert.equal(state.winner!.team, "evil");
  assert.equal(state.winner!.reason, "mastermind");
});

test("a Minion execution makes everyone except the Minstrel drunk", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "gossip",
      5: "devilsadvocate",
      6: "po",
      7: "minstrel",
    },
    { count: 9 },
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
  executeByDecision(state, "5");
  const drunk = state.effects.filter((effect) => effect.kind === "drunk");
  assert.equal(drunk.length, 7);
  assert.ok(drunk.every((effect) => effect.targetId !== "7"));
});

test("the Professor resurrects a dead Townsfolk only", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "gossip",
      5: "professor",
      6: "po",
      7: "goon",
    },
    { count: 8 },
  );
  state.players["1"].alive = false;
  finishNight((startNight(state), state));
  assert.equal(endNight(state).ok, true);
  endDay(state);
  const professor = state.night.queue.find((step) => step.roleId === "professor")!;
  assert.ok(professor);
  completeStep(state, professor.key, { targetIds: ["1"] });
  recordBmrOutcome(state, professor.key, { resurrectId: "1" });
  assert.equal(state.players["1"].alive, true);
  const resurrectLog = state.log.find((entry) => entry.title.includes("возвращается"));
  assert.equal(resurrectLog?.consequence, "revived");
});

test("the Devil's Advocate prevents tomorrow's execution death", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "gossip",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 8 },
  );
  startNight(state);
  const advocate = state.night.queue.find((step) => step.roleId === "devilsadvocate")!;
  completeStep(state, advocate.key, { targetIds: ["2"] });
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  const result = executeByDecision(state, "2");
  assert.equal(result.ok, true);
  assert.equal(state.players["2"].alive, true);
});

test("the Gossip statement schedules a night death only when it was true", () => {
  for (const truth of [false, true]) {
    const state = make(
      {
        1: "chambermaid",
        2: "courtier",
        3: "sailor",
        4: "gossip",
        5: "devilsadvocate",
        6: "po",
        7: "fool",
      },
      { count: 8 },
    );
    startNight(state);
    finishNight(state);
    assert.equal(endNight(state).ok, true);
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
    assert.equal(gossipStatement(state, truth).ok, true);
    assert.equal(endDay(state).ok, true);
    assert.equal(
      state.night.queue.some((step) => step.roleId === "gossip"),
      truth,
    );
  }
});

test("the Moonchild picks a living player after dying", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "moonchild",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 9 },
  );
  state.players["4"].alive = false;
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
  assert.equal(moonchildChoice(state, "99").ok, false);
  assert.equal(moonchildChoice(state, "1").ok, true);
  assert.equal(state.players["4"].used.moonchildTarget, "1");
});

test("the Exorcist stops the chosen Demon's wake", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "exorcist",
      5: "devilsadvocate",
      6: "po",
      7: "grandmother",
    },
    { count: 9 },
  );
  nextNight(state);
  const exorcist = state.night.queue.find((step) => step.roleId === "exorcist")!;
  assert.ok(exorcist);
  completeStep(state, exorcist.key, { targetIds: ["6"] });
  const demon = state.night.queue.find((step) => step.roleId === "po")!;
  assert.equal(demon.done || demon.skipped, true);
  assert.match(demon.note || "", /Экзорцист|Экзорциста/);
});

test("the Devil's Advocate cannot choose the same target on consecutive nights", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "gossip",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 8 },
  );
  startNight(state);
  const first = state.night.queue.find((step) => step.roleId === "devilsadvocate")!;
  assert.equal(completeStep(state, first.key, { targetIds: ["2"] }).ok, true);
  nextNight(state);
  const second = state.night.queue.find((step) => step.roleId === "devilsadvocate")!;
  assert.equal(second.previousTarget, "2");

  const before = canonicalState(state);
  const rejected = applyCommand(state, {
    id: "repeat-advocate",
    type: "completeStep",
    payload: { key: second.key, options: { targetIds: ["2"] } },
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.errorCode, "error.50");
  assert.deepEqual(canonicalState(state), before);

  const repeat = completeStep(state, second.key, { targetIds: ["2"] });
  assert.equal(repeat.ok, false);
  assert.equal(second.done, false);
  assert.deepEqual(second.targetIds, []);

  const allowed = applyCommand(state, {
    id: "advocate-new-target",
    type: "completeStep",
    payload: { key: second.key, options: { targetIds: ["3"] } },
  });
  assert.equal(allowed.status, "allowed", JSON.stringify(allowed));
  const completed = state.night.queue.find((step) => step.key === second.key)!;
  assert.deepEqual(completed.targetIds, ["3"]);
});

test("the Exorcist cannot choose the same target on consecutive nights", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "exorcist",
      5: "devilsadvocate",
      6: "po",
      7: "grandmother",
    },
    { count: 9 },
  );
  nextNight(state);
  const first = state.night.queue.find((step) => step.roleId === "exorcist")!;
  assert.equal(completeStep(state, first.key, { targetIds: ["2"] }).ok, true);
  nextNight(state);
  const second = state.night.queue.find((step) => step.roleId === "exorcist")!;
  assert.equal(second.previousTarget, "2");

  const repeat: Record<string, unknown> = completeStep(state, second.key, { targetIds: ["2"] });
  assert.equal(repeat.ok, false);
  assert.equal(repeat.errorCode, "error.50");
  assert.equal(second.done, false);

  assert.equal(completeStep(state, second.key, { targetIds: ["3"] }).ok, true);
  assert.equal(second.targetIds![0], "3");
});

test("the Devil's Advocate may repeat a target after a skipped night", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "gossip",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 8 },
  );
  startNight(state);
  const first = state.night.queue.find((step) => step.roleId === "devilsadvocate")!;
  assert.equal(completeStep(state, first.key, { targetIds: ["2"] }).ok, true);
  skipRemaining(state);
  endNightToNext(state);

  const second = state.night.queue.find((step) => step.roleId === "devilsadvocate")!;
  assert.ok(second);
  assert.equal(skipStep(state, second.key, "no choice").ok, true);
  skipRemaining(state);
  endNightToNext(state);

  const third = state.night.queue.find((step) => step.roleId === "devilsadvocate")!;
  assert.ok(third);
  assert.equal(third.previousTarget, undefined, "a skipped night breaks the consecutive pair");
  assert.equal(completeStep(state, third.key, { targetIds: ["2"] }).ok, true);
});

test("the Exorcist may repeat a target after a skipped night", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "exorcist",
      5: "devilsadvocate",
      6: "po",
      7: "grandmother",
    },
    { count: 9 },
  );
  startNight(state);
  skipRemaining(state);
  endNightToNext(state);

  const first = state.night.queue.find((step) => step.roleId === "exorcist")!;
  assert.equal(completeStep(state, first.key, { targetIds: ["2"] }).ok, true);
  skipRemaining(state);
  endNightToNext(state);

  const second = state.night.queue.find((step) => step.roleId === "exorcist")!;
  assert.ok(second);
  assert.equal(skipStep(state, second.key, "no choice").ok, true);
  skipRemaining(state);
  endNightToNext(state);

  const third = state.night.queue.find((step) => step.roleId === "exorcist")!;
  assert.ok(third);
  assert.equal(third.previousTarget, undefined, "a skipped night breaks the consecutive pair");
  assert.equal(completeStep(state, third.key, { targetIds: ["2"] }).ok, true);
});

test("a resurrected Devil's Advocate may repeat a target from before death", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "gossip",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 8 },
  );
  startNight(state);
  const first = state.night.queue.find((step) => step.roleId === "devilsadvocate")!;
  assert.equal(completeStep(state, first.key, { targetIds: ["2"] }).ok, true);
  state.players["5"].alive = false;
  skipRemaining(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);

  skipRemaining(state);
  assert.equal(endNight(state).ok, true);
  state.players["5"].alive = true;
  assert.equal(endDay(state).ok, true);

  const third = state.night.queue.find((step) => step.roleId === "devilsadvocate")!;
  assert.ok(third);
  assert.equal(
    third.previousTarget,
    undefined,
    "the dead Devil's Advocate made no choice last night",
  );
  assert.equal(completeStep(state, third.key, { targetIds: ["2"] }).ok, true);
});

test("a Devil's Advocate who left play and returned is not bound by the old target", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "gossip",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 8 },
  );
  startNight(state);
  const first = state.night.queue.find((step) => step.roleId === "devilsadvocate")!;
  assert.equal(completeStep(state, first.key, { targetIds: ["2"] }).ok, true);
  skipRemaining(state);
  assert.equal(endNight(state).ok, true);
  state.players["5"].roleId = "courtier";
  assert.equal(endDay(state).ok, true);

  skipRemaining(state);
  assert.equal(endNight(state).ok, true);
  state.players["5"].roleId = "devilsadvocate";
  assert.equal(endDay(state).ok, true);

  const third = state.night.queue.find((step) => step.roleId === "devilsadvocate")!;
  assert.ok(third);
  assert.equal(third.previousTarget, undefined, "the old record belongs to a different stint");
  assert.equal(completeStep(state, third.key, { targetIds: ["2"] }).ok, true);
});

test("a legacy target without a night is treated as unknown", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "gossip",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 8 },
  );
  startNight(state);
  const first = state.night.queue.find((step) => step.roleId === "devilsadvocate")!;
  assert.equal(completeStep(state, first.key, { targetIds: ["2"] }).ok, true);
  delete state.players["5"].used.devilsadvocateTargetNight;

  const restored = importGame(exportGame(state));
  assert.equal(restored.ok, true, "error" in restored ? restored.error : "");
  assert.equal(restored.state.players["5"].used.devilsadvocateTarget, "2");

  skipRemaining(restored.state);
  endNightToNext(restored.state);
  const second = restored.state.night.queue.find((step) => step.roleId === "devilsadvocate")!;
  assert.equal(
    second.previousTarget,
    undefined,
    "an unknown old target cannot be proven to be last night",
  );
  assert.equal(completeStep(restored.state, second.key, { targetIds: ["2"] }).ok, true);
  assert.equal(restored.state.players["5"].used.devilsadvocateTargetNight, 2);
});

test("an impaired Devil's Advocate still records its choice", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "gossip",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 8 },
  );
  addEffect(state, "drunk", "5");
  startNight(state);
  const first = state.night.queue.find((step) => step.roleId === "devilsadvocate")!;
  assert.equal(completeStep(state, first.key, { targetIds: ["2"] }).ok, true);
  assert.equal(isImpaired(state, "5"), true);
  nextNight(state);
  const second = state.night.queue.find((step) => step.roleId === "devilsadvocate")!;
  assert.equal(second.previousTarget, "2");
  assert.equal(completeStep(state, second.key, { targetIds: ["2"] }).ok, false);
});

test("the Grandmother stores the grandchild and dies when the Demon kills them", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "grandmother",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 9 },
  );
  startNight(state);
  const grandmother = state.night.queue.find((step) => step.roleId === "grandmother")!;
  completeStep(state, grandmother.key, { targetIds: ["1"] });
  assert.equal(state.setup.grandmotherId, "1");
  nextNight(state);
  const po = state.night.queue.find((step) => step.roleId === "po")!;
  completeStep(state, po.key, { targetIds: ["1"] });
  recordBmrOutcome(state, po.key, { deathIds: ["1"] });
  const extra = state.night.queue.find(
    (step) =>
      step.roleId === "grandmother" &&
      (step.noteKey === "note.bmr.grandmotherDeath" ||
        Boolean(step.note && step.note.includes("Demon"))),
  );
  assert.ok(extra, "the Grandmother's death step is inserted");
  const chambermaid = state.night.queue.find((step) => step.roleId === "chambermaid");
  assert.ok(chambermaid, "the Chambermaid keeps her regular step");
  assert.equal(extra.order, BMR_NIGHT_OTHER.indexOf("grandmother"));
  assert.ok(
    state.night.queue.indexOf(extra) < state.night.queue.indexOf(chambermaid),
    "the Grandmother's death step precedes the Chambermaid, not every regular step",
  );
});

function addEffect(state: GameState, kind: string, targetId: string) {
  state.effects.push({
    id: "test-" + kind + "-" + targetId,
    kind,
    sourceId: state.order.find((id) => state.players[id].roleId === "po") || state.order[0]!,
    targetId,
    start: { phase: "night" as const, number: 1 },
    expires: { phase: "night" as const, number: 2 },
    active: true,
  });
}

test("the Tea Lady skips dead seats to find her nearest living neighbours", () => {
  const state = make(
    {
      2: "chambermaid",
      3: "gossip",
      4: "tealady",
      5: "courtier",
      6: "professor",
      7: "assassin",
      8: "po",
    },
    { count: 8 },
  );
  state.players["3"].alive = false;
  state.players["5"].alive = false;
  const at = { phase: "night" as const, number: 1 };
  assert.equal(kill(state, "2", "ability", at), null, "seat 2 is the nearest living neighbour");
  assert.equal(kill(state, "6", "ability", at), null, "seat 6 is the nearest living neighbour");
});

test("a good but drunk or poisoned Tea Lady neighbour is still protected", () => {
  const state = make(
    {
      2: "chambermaid",
      3: "gossip",
      4: "tealady",
      5: "courtier",
      6: "professor",
      7: "assassin",
      8: "po",
    },
    { count: 8 },
  );
  addEffect(state, "drunk", "3");
  addEffect(state, "poison", "5");
  const at = { phase: "night" as const, number: 1 };
  assert.equal(kill(state, "3", "ability", at), null);
  assert.equal(kill(state, "5", "ability", at), null);
});

test("the Tea Lady does not protect when a living neighbour is evil", () => {
  const state = make(
    {
      3: "assassin",
      4: "tealady",
      5: "chambermaid",
      8: "po",
    },
    { count: 8 },
  );
  const at = { phase: "night" as const, number: 1 };
  const death = kill(state, "5", "ability", at);
  assert.ok(death, "an evil neighbour cancels the Tea Lady's protection");
  assert.equal(state.players["5"].alive, false);
});

test("the Sailor cannot die while healthy but dies while poisoned or drunk", () => {
  const makeSailor = () => make({ 3: "sailor", 8: "po" }, { count: 8 });
  const at = { phase: "night" as const, number: 1 };
  assert.equal(kill(makeSailor(), "3", "ability", at), null, "healthy");

  const poisoned = makeSailor();
  addEffect(poisoned, "poison", "3");
  assert.ok(kill(poisoned, "3", "ability", at), "poison removes the protection");

  const drunk = makeSailor();
  addEffect(drunk, "drunk", "3");
  assert.ok(kill(drunk, "3", "ability", at), "drunk removes the protection");

  const restored = makeSailor();
  addEffect(restored, "poison", "3");
  restored.effects.at(-1)!.active = false;
  assert.equal(kill(restored, "3", "ability", at), null, "restored Sailor is protected again");
});

test("a sober Zombuul replaces its first death and dies on the second", () => {
  const state = make({ 7: "assassin", 8: "zombuul" }, { count: 8 });
  const at = { phase: "night" as const, number: 1 };
  assert.equal(kill(state, "8", "ability", at), null);
  assert.equal(state.players["8"].alive, true);
  assert.equal(state.players["8"].registeredDead, true);
  assert.equal(state.players["8"].used.zombuul, true);
  const second = kill(state, "8", "ability", at);
  assert.ok(second, "the second death is real");
  assert.equal(state.players["8"].alive, false);
});

test("an impaired Zombuul dies on its first death and does not register as dead", () => {
  const state = make({ 7: "assassin", 8: "zombuul" }, { count: 8 });
  addEffect(state, "poison", "8");
  const at = { phase: "night" as const, number: 1 };
  const death = kill(state, "8", "ability", at);
  assert.ok(death, "the poisoned Zombuul's ability does not work");
  assert.equal(state.players["8"].alive, false);
  assert.notEqual(state.players["8"].registeredDead, true);
  assert.notEqual(state.players["8"].used.zombuul, true);
  checkWin(state);
  assert.equal(state.winner!.team, "good");
});

function selfTargetFixture(): GameState {
  const state = make(
    {
      1: "pukka",
      2: "chambermaid",
      3: "courtier",
      4: "sailor",
      5: "gossip",
      6: "mastermind",
    },
    { count: 7 },
  );
  startNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["2"] });
  nextNight(state);
  return state;
}

function healSelfPoisonCommand(state: GameState, id: string) {
  const poison = state.effects.find(
    (effect) =>
      effect.kind === "poison" &&
      effect.pukka === true &&
      effect.sourceId === "1" &&
      effect.targetId === "1" &&
      effect.active !== false,
  );
  assert.ok(poison, "the Pukka is self-poisoned");
  return {
    id,
    type: "manualCorrection",
    payload: { change: { kind: "effect", effectId: poison.id, value: false, reason: "test heal" } },
  };
}

test("the Pukka choosing itself poisons itself and suspends the previous death", () => {
  const state = selfTargetFixture();
  const deaths = state.deaths.length;
  const command = {
    id: "pukka-self-1",
    type: "completeNightStep",
    payload: { key: pukkaStep(state)!.key, targetIds: ["1"] },
  };
  const before = canonicalState(state);
  const preview = previewCommand(state, command) as CommandView;
  assert.equal(preview.status, "allowed", JSON.stringify(preview));
  assert.deepEqual(canonicalState(state), before, "preview must not mutate");
  const applied = applyCommand(state, command) as CommandView;
  assert.equal(applied.status, "allowed", JSON.stringify(applied));

  assert.equal(state.players["2"].alive, true);
  assert.equal(isImpaired(state, "2"), false, "the previous victim becomes healthy");
  assert.equal(isImpaired(state, "1"), true, "the Pukka is self-poisoned");
  assert.equal(state.deaths.length, deaths, "no death is recorded on the self-target step");

  const pendingA = state.effects.find(
    (effect) => effect.kind === "pukka-death" && effect.targetId === "2" && effect.active !== false,
  );
  assert.ok(pendingA);
  assert.equal(pendingA.suspended, "self-target");
  assert.equal(pendingA.resumeOnHealthy, true);

  const selfPoison = state.effects.find(
    (effect) =>
      effect.kind === "poison" &&
      effect.pukka === true &&
      effect.sourceId === "1" &&
      effect.targetId === "1" &&
      effect.active !== false,
  );
  assert.ok(selfPoison);
  assert.ok(
    preview.future.delayedEffects.some(
      (effect) =>
        effect.id === pendingA.id &&
        effect.suspended === "self-target" &&
        effect.resolve &&
        effect.resolve.number === 2,
    ),
    "the suspended death appears in the future projection",
  );
});

test("a self-poisoned Pukka applies no new poison and resolves no suspended death", () => {
  const state = selfTargetFixture();
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["1"] });
  nextNight(state);
  const deaths = state.deaths.length;

  const applied = applyCommand(state, {
    id: "pukka-self-2",
    type: "completeNightStep",
    payload: { key: pukkaStep(state)!.key, targetIds: ["3"] },
  });
  assert.equal(applied.status, "allowed", JSON.stringify(applied));

  const pendingA = state.effects.find(
    (effect) => effect.kind === "pukka-death" && effect.targetId === "2" && effect.active !== false,
  )!;
  const selfPending = state.effects.find(
    (effect) => effect.kind === "pukka-death" && effect.targetId === "1" && effect.active !== false,
  )!;
  assert.equal(state.players["2"].alive, true);
  assert.equal(state.players["3"].alive, true);
  assert.equal(state.deaths.length, deaths);
  assert.equal(
    isImpaired(state, "2"),
    false,
    "the previous victim stays healthy while the Pukka is self-poisoned",
  );
  assert.equal(isImpaired(state, "1"), true);
  assert.equal(pendingA.suspended, "self-target");
  assert.equal(selfPending.suspended, "impaired");
});

test("a healed Pukka resolves the suspended death immediately and can end the game", () => {
  const state = selfTargetFixture();
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["1"] });
  for (const id of state.order) {
    if (["1", "2", "4"].includes(id)) continue;
    state.players[id].alive = false;
    state.players[id].voteToken = true;
  }

  const command = healSelfPoisonCommand(state, "pukka-heal-1");
  const before = canonicalState(state);
  const preview = previewCommand(state, command) as CommandView;
  assert.equal(preview.status, "allowed", JSON.stringify(preview));
  assert.deepEqual(canonicalState(state), before, "preview must not mutate");
  const applied = applyCommand(state, command) as CommandView;
  assert.equal(applied.status, "allowed", JSON.stringify(applied));

  assert.equal(
    state.players["2"].alive,
    false,
    "the suspended victim dies when the Pukka becomes healthy",
  );
  assert.equal(state.winner && state.winner.reason, "two-alive");
  assert.equal(preview.future.winner && preview.future.winner.reason, "two-alive");
  assert.ok(preview.changes.deaths.includes("2"));
  assert.ok(applied.changes.deaths.includes("2"));
  assert.equal(
    state.effects.some(
      (effect) =>
        effect.targetId === "2" &&
        effect.active !== false &&
        (effect.kind === "pukka-death" || (effect.kind === "poison" && effect.pukka === true)),
    ),
    false,
    "the victim's Pukka effects clear",
  );
});

test("a recovered Pukka dies as the previously poisoned target when it chooses again", () => {
  const state = selfTargetFixture();
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["1"] });
  const healed = applyCommand(state, healSelfPoisonCommand(state, "pukka-heal-2"));
  assert.equal(healed.status, "allowed", JSON.stringify(healed));
  assert.equal(state.players["1"].alive, true, "the Pukka is healthy before its next step");

  nextNight(state);
  const command = {
    id: "pukka-recovered",
    type: "completeNightStep",
    payload: { key: pukkaStep(state)!.key, targetIds: ["3"] },
  };
  const before = canonicalState(state);
  const preview = previewCommand(state, command) as CommandView;
  assert.equal(preview.status, "allowed", JSON.stringify(preview));
  assert.deepEqual(canonicalState(state), before, "preview must not mutate");
  const applied = applyCommand(state, command) as CommandView;
  assert.equal(applied.status, "allowed", JSON.stringify(applied));

  assert.equal(state.players["1"].alive, false, "the Pukka dies as the previously poisoned target");
  const newPoison = state.effects.find(
    (effect) => effect.kind === "poison" && effect.pukka === true && effect.targetId === "3",
  );
  assert.ok(newPoison, "the new target was poisoned before the Pukka died");
  assert.deepEqual(applied.changes.deaths, preview.changes.deaths);
  assert.ok(preview.changes.deaths.includes("1"));
});

test("a later poison suspends the Pukka's earlier poison and pending death", () => {
  const state = make(
    {
      1: "pukka",
      2: "chambermaid",
      3: "courtier",
      4: "sailor",
      5: "gossip",
      6: "mastermind",
    },
    { count: 7 },
  );
  startNight(state);
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["2"] });
  nextNight(state);
  state.effects.push({
    id: "test-pukka-late-poison",
    kind: "poison",
    sourceId: "6",
    targetId: "1",
    start: { phase: "night" as const, number: 2 },
    expires: { phase: "night" as const, number: 3 },
    active: true,
  });

  const pending = state.effects.find(
    (effect) => effect.kind === "pukka-death" && effect.targetId === "2" && effect.active !== false,
  );
  assert.equal(isImpaired(state, "1"), true, "the later poison impairs the Pukka");
  assert.equal(isImpaired(state, "2"), false, "the earlier Pukka poison is suspended");
  assert.equal(effectActive(state, pending!), false, "the pending death is suspended");

  const later: GameState = JSON.parse(JSON.stringify(state));
  later.night.number = 3;
  assert.equal(isImpaired(later, "1"), false, "the later poison expired");
  assert.equal(isImpaired(later, "2"), true, "the Pukka's poison resumes");
  const resumed = later.effects.find(
    (effect) => effect.kind === "pukka-death" && effect.targetId === "2" && effect.active !== false,
  );
  assert.equal(effectActive(later, resumed!), true, "the pending death resumes");
});

test("a Pukka stays suspended until the last impairment ends", () => {
  const state = selfTargetFixture();
  completeStep(state, pukkaStep(state)!.key, { targetIds: ["1"] });
  state.effects.push(
    {
      id: "test-pukka-drunk",
      kind: "drunk",
      sourceId: "3",
      targetId: "1",
      start: { phase: "night" as const, number: 2 },
      expires: { phase: "night" as const, number: 4 },
      active: true,
    },
    {
      id: "test-pukka-poison-2",
      kind: "poison",
      sourceId: "4",
      targetId: "1",
      start: { phase: "night" as const, number: 2 },
      expires: { phase: "night" as const, number: 4 },
      active: true,
    },
  );

  const healed = applyCommand(state, healSelfPoisonCommand(state, "pukka-heal-mixed"));
  assert.equal(healed.status, "allowed", JSON.stringify(healed));
  assert.equal(state.players["2"].alive, true, "the Pukka is still impaired");

  const drunkOff = {
    id: "heal-pukka-drunk",
    type: "manualCorrection",
    payload: {
      change: { kind: "effect", effectId: "test-pukka-drunk", value: false, reason: "test" },
    },
  };
  assert.equal(applyCommand(state, drunkOff).status, "allowed");
  assert.equal(state.players["2"].alive, true, "the remaining poison still suspends the death");

  const poisonOff = {
    id: "heal-pukka-poison-2",
    type: "manualCorrection",
    payload: {
      change: { kind: "effect", effectId: "test-pukka-poison-2", value: false, reason: "test" },
    },
  };
  assert.equal(applyCommand(state, poisonOff).status, "allowed");
  assert.equal(state.players["2"].alive, false, "the death resolves when the last impairment ends");
});

test("a poisoned Sailor's drunk effect suspends until the Sailor is healthy", () => {
  const state = make(
    {
      1: "sailor",
      2: "chambermaid",
      3: "mastermind",
      4: "courtier",
      5: "gossip",
      6: "pukka",
    },
    { count: 7 },
  );
  state.night.number = 2;
  state.effects.push(
    {
      id: "test-sailor-drunk",
      kind: "drunk",
      sourceId: "1",
      targetId: "2",
      start: { phase: "night" as const, number: 1 },
      expires: { phase: "night" as const, number: 5 },
      active: true,
    },
    {
      id: "test-sailor-poison",
      kind: "poison",
      sourceId: "3",
      targetId: "1",
      start: { phase: "night" as const, number: 2 },
      expires: { phase: "night" as const, number: 4 },
      active: true,
    },
  );

  assert.equal(
    isImpaired(state, "2"),
    false,
    "the drunk effect is suspended while the Sailor is poisoned",
  );
  const healthy: GameState = JSON.parse(JSON.stringify(state));
  healthy.effects.find((effect) => effect.id === "test-sailor-poison")!.active = false;
  assert.equal(
    isImpaired(healthy, "2"),
    true,
    "the drunk effect resumes when the Sailor is healthy",
  );
});

test("the Fool's first death is prevented, the ability is spent and the next death kills", () => {
  const state = make(
    {
      1: "fool",
      2: "chambermaid",
      3: "sailor",
      4: "courtier",
      5: "po",
      6: "assassin",
      7: "exorcist",
    },
    { count: 8 },
  );
  const at = { phase: "night" as const, number: 1 };
  assert.equal(kill(state, "1", "ability", at), null, "the first death is prevented");
  assert.equal(state.players["1"].alive, true);
  assert.equal(state.players["1"].used.fool, true, "the ability is spent");
  const second = kill(state, "1", "ability", at);
  assert.ok(second, "the second death is real");
  assert.equal(state.players["1"].alive, false);

  const executed = make(
    { 1: "fool", 2: "chambermaid", 3: "sailor", 4: "courtier", 5: "po" },
    { count: 8 },
  );
  executed.phase = "day";
  executed.day = {
    number: 1,
    morning: [],
    nominations: [],
    activeNominationId: null,
    execution: null,
    ended: false,
    open: true,
  };
  assert.equal(executeByDecision(executed, "1").ok, true);
  assert.equal(executed.players["1"].alive, true, "the first execution is prevented");
  assert.equal(executed.players["1"].used.fool, true);
});

test("the Courtier makes the chosen character drunk for three nights and days, once per game", () => {
  const state = make(
    {
      1: "courtier",
      2: "chambermaid",
      3: "sailor",
      4: "gossip",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 8 },
  );
  startNight(state);
  const courtier = state.night.queue.find((step) => step.roleId === "courtier")!;
  assert.ok(courtier);
  assert.equal(completeStep(state, courtier.key, { roleId: "fool" }).ok, true);

  assert.equal(isImpaired(state, "7", { phase: "night" as const, number: 1 }), true);
  assert.equal(isImpaired(state, "7", { phase: "day" as const, number: 3 }), true);
  assert.equal(isImpaired(state, "7", { phase: "night" as const, number: 4 }), false);
  assert.equal(isImpaired(state, "2", { phase: "night" as const, number: 1 }), false);

  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  assert.equal(
    state.night.queue.some((step) => step.roleId === "courtier"),
    false,
    "the Courtier wakes only once per game",
  );
});

test("the Innkeeper protects both targets tonight and makes one of them drunk until dusk", () => {
  const state = make(
    {
      1: "innkeeper",
      2: "chambermaid",
      3: "gossip",
      4: "fool",
      5: "devilsadvocate",
      6: "po",
    },
    { count: 8 },
  );
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);

  const innkeeper = state.night.queue.find((step) => step.roleId === "innkeeper")!;
  assert.ok(innkeeper);
  assert.equal(
    completeStep(state, innkeeper.key, { targetIds: ["2", "3"], drunkId: "2" }).ok,
    true,
  );

  const at = { phase: "night" as const, number: 2 };
  assert.equal(isImpaired(state, "2", at), true);
  assert.equal(isImpaired(state, "3", at), false);
  assert.equal(kill(state, "2", "ability", at), null, "the drunk target is safe tonight");
  assert.equal(kill(state, "3", "ability", at), null, "the second target is safe tonight");

  const dawn = { phase: "night" as const, number: 3 };
  assert.equal(isImpaired(state, "2", dawn), false, "drunk ends at dusk");
  assert.ok(kill(state, "2", "ability", dawn), "protection ends at dawn");
});

test("the Sailor makes the chosen recipient drunk until dusk and supports choosing themself", () => {
  const state = make(
    { 1: "sailor", 2: "chambermaid", 3: "gossip", 4: "fool", 5: "po" },
    { count: 8 },
  );
  startNight(state);
  const first = state.night.queue.find((step) => step.roleId === "sailor")!;
  assert.ok(first);
  assert.equal(completeStep(state, first.key, { targetIds: ["2"], drunkId: "2" }).ok, true);
  assert.equal(isImpaired(state, "2", { phase: "night" as const, number: 1 }), true);
  assert.equal(isImpaired(state, "2", { phase: "day" as const, number: 1 }), true);
  assert.equal(
    isImpaired(state, "2", { phase: "night" as const, number: 2 }),
    false,
    "ends at dusk",
  );

  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  const second = state.night.queue.find((step) => step.roleId === "sailor")!;
  assert.ok(second);
  assert.equal(completeStep(state, second.key, { targetIds: ["1"], drunkId: "1" }).ok, true);
  assert.equal(
    isImpaired(state, "1", { phase: "night" as const, number: 2 }),
    true,
    "the Sailor themself",
  );
  assert.equal(isImpaired(state, "2", { phase: "night" as const, number: 2 }), false);
});

test("the Gambler dies on a wrong guess and survives a correct guess", () => {
  const makeGambler = () =>
    make(
      {
        1: "gambler",
        2: "chambermaid",
        3: "sailor",
        4: "courtier",
        5: "fool",
        6: "po",
      },
      { count: 8 },
    );
  const setup = () => {
    const state = makeGambler();
    startNight(state);
    finishNight(state);
    assert.equal(endNight(state).ok, true);
    assert.equal(endDay(state).ok, true);
    const step = state.night.queue.find((candidate) => candidate.roleId === "gambler");
    assert.ok(step);
    return { state, step };
  };

  const wrong = setup();
  assert.equal(
    completeStep(wrong.state, wrong.step.key, { targetIds: ["2"], roleId: "fool" }).ok,
    true,
  );
  assert.equal(wrong.state.players["1"].alive, false, "a wrong guess kills the Gambler");

  const right = setup();
  assert.equal(
    completeStep(right.state, right.step.key, { targetIds: ["2"], roleId: "chambermaid" }).ok,
    true,
  );
  assert.equal(right.state.players["1"].alive, true, "a correct guess is harmless");

  const impaired = setup();
  impaired.state.effects.push({
    id: "test-gambler-poison",
    kind: "poison",
    sourceId: "6",
    targetId: "1",
    start: { phase: "night" as const, number: 2 },
    expires: { phase: "night" as const, number: 3 },
    active: true,
  });
  assert.equal(
    completeStep(impaired.state, impaired.step.key, { targetIds: ["2"], roleId: "fool" }).ok,
    true,
  );
  assert.equal(impaired.state.players["1"].alive, true, "an impaired Gambler has no ability");
});

test("the Godfather learns the Outsiders in play on the first night", () => {
  const state = make(
    {
      1: "godfather",
      2: "chambermaid",
      3: "sailor",
      4: "moonchild",
      5: "tinker",
      6: "po",
    },
    { count: 8 },
  );
  startNight(state);
  const step = state.night.queue.find((candidate) => candidate.roleId === "godfather");
  assert.ok(step);
  assert.equal(completeStep(state, step.key).ok, true);
  const text = String(step.given!.text);
  for (const id of state.order) {
    const outsider = roleTeam(state.players[id].roleId || "") === "outsider";
    assert.equal(
      text.includes("P" + id),
      outsider,
      "the Godfather sees only the Outsiders: " + text,
    );
  }
});

test("the Godfather kills only after an Outsider died today", () => {
  const build = () =>
    make(
      {
        1: "chambermaid",
        2: "courtier",
        3: "sailor",
        4: "gossip",
        5: "godfather",
        6: "po",
        7: "moonchild",
      },
      { count: 9 },
    );

  const state = build();
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(executeByDecision(state, "7").ok, true);
  assert.equal(endDay(state).ok, true);
  const step = state.night.queue.find((candidate) => candidate.roleId === "godfather");
  assert.ok(step, "the Godfather wakes after an Outsider died today");
  const outcome = recordBmrOutcome(state, step.key, { deathIds: ["1"] });
  assert.equal(outcome.ok, true);
  assert.equal(state.players["1"].alive, false, "the chosen player dies");

  const quiet = build();
  startNight(quiet);
  finishNight(quiet);
  assert.equal(endNight(quiet).ok, true);
  assert.equal(endDay(quiet).ok, true);
  assert.equal(
    quiet.night.queue.some((candidate) => candidate.roleId === "godfather"),
    false,
    "no Outsider died today",
  );
});

test("the Shabaloth kills two players and can regurgitate a target from last night", () => {
  const state = make(
    {
      1: "shabaloth",
      2: "chambermaid",
      3: "sailor",
      4: "courtier",
      5: "gossip",
      6: "devilsadvocate",
      7: "fool",
    },
    { count: 8 },
  );
  startNight(state);
  assert.equal(
    state.night.queue.some((step) => step.roleId === "shabaloth"),
    false,
    "the Shabaloth does not wake on the first night",
  );
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);

  const second = state.night.queue.find((step) => step.roleId === "shabaloth")!;
  assert.ok(second);
  assert.equal(completeStep(state, second.key, { targetIds: ["2", "4"] }).ok, true);
  const outcome = recordBmrOutcome(state, second.key, { deathIds: ["2", "4", "5"] });
  assert.equal(outcome.ok, true);
  assert.equal(state.players["2"].alive, false);
  assert.equal(state.players["4"].alive, false);
  assert.equal(state.players["5"].alive, false, "the host recorded a third death");
  assert.deepEqual(state.players["1"].used.shabalothTargets, ["2", "4"]);
  assert.equal(state.players["1"].used.shabalothTargetsNight, 2);

  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  const third = state.night.queue.find((step) => step.roleId === "shabaloth")!;
  assert.ok(third);
  assert.equal(completeStep(state, third.key, { targetIds: ["2", "4"] }).ok, true);
  const rejected = recordBmrOutcome(state, third.key, { deathIds: [], resurrectId: "5" });
  assert.equal(rejected.ok, false, "a recorded death outside the chosen targets is rejected");
  assert.equal(rejected.errorCode, "error.51");
  assert.equal(state.players["5"].alive, false);
  const resurrect = recordBmrOutcome(state, third.key, { deathIds: [], resurrectId: "2" });
  assert.equal(resurrect.ok, true);
  assert.equal(state.players["2"].alive, true, "the previous choice is regurgitated");
});

test("the Shabaloth cannot regurgitate after a skipped night", () => {
  const state = make(
    {
      1: "shabaloth",
      2: "chambermaid",
      3: "sailor",
      4: "courtier",
      5: "gossip",
      6: "devilsadvocate",
      7: "fool",
    },
    { count: 8 },
  );
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);

  const second = state.night.queue.find((step) => step.roleId === "shabaloth")!;
  assert.ok(second);
  assert.equal(completeStep(state, second.key, { targetIds: ["2", "4"] }).ok, true);
  assert.equal(recordBmrOutcome(state, second.key, { deathIds: ["2", "4"] }).ok, true);
  assert.equal(state.players["2"].alive, false);

  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  skipRemaining(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  assert.equal(state.night.number, 4);

  const fourth = state.night.queue.find((step) => step.roleId === "shabaloth")!;
  assert.ok(fourth, "the Shabaloth wakes again on night four");
  const rejected = recordBmrOutcome(state, fourth.key, { deathIds: [], resurrectId: "2" });
  assert.equal(rejected.ok, false, "a skipped night clears the previous choice");
  assert.equal(rejected.errorCode, "error.51");
  assert.equal(state.players["2"].alive, false);
});

test("the Moonchild kills the chosen good player on the next night", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "moonchild",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 9 },
  );
  state.players["4"].alive = false;
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
  assert.equal(moonchildChoice(state, "2").ok, true);
  assert.equal(endDay(state).ok, true);

  const step = state.night.queue.find((candidate) => candidate.roleId === "moonchild");
  assert.ok(step, "the Moonchild step is queued on the next night");
  assert.deepEqual(step.targetIds, ["2"], "the public choice is recorded on the step");
  const result = completeStep(state, step.key);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(step.targetIds, ["2"], "the completion keeps the recorded choice");
  assert.equal(state.players["2"].alive, false, "a good target dies");
  assert.equal(state.players["4"].used.moonchildResolved, true);
});

test("the Moonchild does not kill an evil target", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "moonchild",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 9 },
  );
  state.players["4"].alive = false;
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
  assert.equal(moonchildChoice(state, "6").ok, true);
  assert.equal(endDay(state).ok, true);
  const step = state.night.queue.find((candidate) => candidate.roleId === "moonchild");
  assert.ok(step);
  assert.equal(completeStep(state, step.key).ok, true);
  assert.equal(state.players["6"].alive, true);
});

test("the Moonchild rejects a target that differs from the public choice", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "sailor",
      4: "moonchild",
      5: "devilsadvocate",
      6: "po",
      7: "fool",
    },
    { count: 9 },
  );
  state.players["4"].alive = false;
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
  assert.equal(moonchildChoice(state, "2").ok, true);
  assert.equal(endDay(state).ok, true);
  const step = state.night.queue.find((candidate) => candidate.roleId === "moonchild");
  assert.ok(step);
  assert.deepEqual(step.targetIds, ["2"]);
  const before = canonicalState(state);
  const result: Record<string, unknown> = completeStep(state, step.key, { targetIds: ["1"] });
  assert.equal(result.ok, false, "a different target is rejected");
  assert.equal(result.errorCode, "error.51");
  assert.equal(state.players["1"].alive, true);
  assert.equal(state.players["2"].alive, true);
  assert.equal(step.done, false, "the step stays incomplete");
  assert.deepEqual(step.targetIds, ["2"], "the recorded choice is unchanged");
  assert.deepEqual(canonicalState(state), before, "a rejected completion leaves state unchanged");
});

test("the Professor resurrects only a dead Townsfolk", () => {
  const state = make(
    {
      1: "professor",
      2: "moonchild",
      3: "chambermaid",
      4: "courtier",
      5: "sailor",
      6: "gossip",
      7: "po",
    },
    { count: 8 },
  );
  state.players["2"].alive = false;
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  const step = state.night.queue.find((candidate) => candidate.roleId === "professor");
  assert.ok(step);
  assert.equal(completeStep(state, step.key, { targetIds: ["2"] }).ok, true);
  const outcome = recordBmrOutcome(state, step.key, { resurrectId: "2" });
  assert.equal(outcome.ok, false, "the outcome rejects a non-Townsfolk");
  assert.equal(outcome.errorCode, "error.51");
  assert.equal(state.players["2"].alive, false, "an Outsider is not resurrected");
});

test("the Professor ability is once per game", () => {
  const state = make(
    {
      1: "professor",
      2: "chambermaid",
      3: "courtier",
      4: "sailor",
      5: "gossip",
      6: "po",
    },
    { count: 8 },
  );
  state.players["2"].alive = false;
  state.players["3"].alive = false;
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  const step = state.night.queue.find((candidate) => candidate.roleId === "professor");
  assert.ok(step);
  const standalone = recordBmrOutcome(state, step.key, { resurrectId: "2" });
  assert.equal(standalone.ok, false, "the outcome alone cannot resurrect");
  assert.equal(state.players["2"].alive, false);
  assert.equal(completeStep(state, step.key, { targetIds: ["2"] }).ok, true);
  assert.equal(recordBmrOutcome(state, step.key, { resurrectId: "2" }).ok, true);
  assert.equal(state.players["2"].alive, true, "the dead Townsfolk is resurrected");
  const second = recordBmrOutcome(state, step.key, { resurrectId: "3" });
  assert.equal(second.ok, false, "a second resurrection in the same use is rejected");
  assert.equal(second.errorCode, "error.51");
  assert.equal(state.players["3"].alive, false);

  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  assert.equal(
    state.night.queue.some((candidate) => candidate.roleId === "professor"),
    false,
    "the Professor does not wake again",
  );
});

test("an impaired Professor does not resurrect", () => {
  const state = make(
    {
      1: "professor",
      2: "chambermaid",
      3: "courtier",
      4: "sailor",
      5: "gossip",
      6: "po",
    },
    { count: 8 },
  );
  state.players["2"].alive = false;
  startNight(state);
  finishNight(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);
  state.effects.push({
    id: "test-professor-poison",
    kind: "poison",
    sourceId: "6",
    targetId: "1",
    start: { phase: "night" as const, number: 2 },
    expires: { phase: "night" as const, number: 3 },
    active: true,
  });
  const step = state.night.queue.find((candidate) => candidate.roleId === "professor");
  assert.ok(step);
  assert.equal(completeStep(state, step.key, { targetIds: ["2"] }).ok, true);
  assert.equal(state.players["2"].alive, false, "the impaired ability does not resurrect");
  const outcome = recordBmrOutcome(state, step.key, { resurrectId: "2" });
  assert.equal(outcome.ok, false, "the outcome also respects the impairment");
  assert.equal(state.players["2"].alive, false);
});

test("the Lunatic's target is reported to the real Demon", () => {
  const state = make({ 1: "lunatic", 5: "po" }, { count: 8 });
  assert.equal(state.setup.lunaticShownId, "po");
  assert.equal(state.players["1"].roleId, "lunatic");
  assert.equal(state.players["1"].shownRoleId, "po", "the Lunatic sees the false Demon");

  startNight(state);
  const first = state.night.queue.find((candidate) => candidate.roleId === "lunatic");
  assert.ok(first, "the Lunatic wakes on the first night");
  assert.equal(first.targetMode, "none");
  nextNight(state);

  const step = state.night.queue.find((candidate) => candidate.roleId === "lunatic");
  assert.ok(step, "the Lunatic chooses on later nights");
  assert.equal(step.targetMode, "one-any");
  assert.equal(completeStep(state, step.key, { targetIds: ["2"] }).ok, true);
  assert.equal(state.players["1"].used.lunaticTarget, "2");

  const demonStep = state.night.queue.find((candidate) => candidate.roleId === "po");
  assert.ok(demonStep);
  const info = bmrInfoForStep(state, demonStep, {});
  assert.equal(info.kind, "note");
  assert.match(info.text!, /Безумец/);
  assert.match(info.text!, /P2/, "the Demon learns who the Lunatic chose");
  assert.equal(state.players["2"].alive, true, "the Lunatic's choice kills nobody");
});

test("the Goon drinks its first chooser until dusk and takes their alignment", () => {
  const state = make(
    {
      1: "po",
      2: "goon",
      3: "chambermaid",
      4: "pacifist",
      5: "professor",
      6: "gossip",
      7: "sailor",
      8: "mastermind",
    },
    { count: 8 },
  );
  startNight(state);
  skipRemaining(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);

  const sailor = state.night.queue.find((step) => step.roleId === "sailor")!;
  assert.equal(completeStep(state, sailor.key, { targetIds: ["4"] }).ok, true);
  const po = state.night.queue.find((step) => step.roleId === "po")!;
  assert.equal(completeStep(state, po.key, { targetIds: ["2"] }).ok, true);

  const goon = state.players["2"];
  assert.equal(goon.team, "evil");
  const granted = state.effects.filter((effect) => effect.bmr === "goon");
  assert.equal(granted.length, 1);
  assert.equal(granted[0].targetId, "1");
  assert.equal(isImpaired(state, "1"), true);

  // A later chooser in the same night changes nothing.
  const chambermaid = state.night.queue.find((step) => step.roleId === "chambermaid")!;
  assert.equal(completeStep(state, chambermaid.key, { targetIds: ["2", "4"] }).ok, true);
  assert.equal(state.effects.filter((effect) => effect.bmr === "goon").length, 1);
  assert.equal(goon.team, "evil");
  assert.equal(isImpaired(state, "3"), false);

  skipRemaining(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(isImpaired(state, "1", { phase: "day" as const, number: 2 }), true);
  assert.equal(endDay(state).ok, true);
  assert.equal(isImpaired(state, "1"), false);
});

test("a drunk or poisoned Goon grants nothing", () => {
  for (const kind of ["drunk", "poison"]) {
    const state = make(
      {
        1: "po",
        2: "goon",
        3: "chambermaid",
        4: "pacifist",
        5: "professor",
        6: "gossip",
        7: "sailor",
        8: "mastermind",
      },
      { count: 8 },
    );
    startNight(state);
    skipRemaining(state);
    assert.equal(endNight(state).ok, true);
    assert.equal(endDay(state).ok, true);

    state.effects.push({
      id: "fixture-goon-" + kind,
      kind,
      sourceId: "7",
      targetId: "2",
      start: { phase: "night" as const, number: 2 },
      expires: null,
      active: true,
    });
    const po = state.night.queue.find((step) => step.roleId === "po")!;
    assert.equal(completeStep(state, po.key, { targetIds: ["2"] }).ok, true);
    assert.equal(state.players["2"].team, "good", kind);
    assert.equal(state.effects.filter((effect) => effect.bmr === "goon").length, 0, kind);
    assert.equal(isImpaired(state, "1"), false, kind);
  }
});

test("a chooser who was already drunk still triggers the Goon", () => {
  const state = make(
    {
      1: "po",
      2: "goon",
      3: "chambermaid",
      4: "pacifist",
      5: "professor",
      6: "gossip",
      7: "sailor",
      8: "mastermind",
    },
    { count: 8 },
  );
  nightTwo(state);
  state.effects.push({
    id: "fixture-poison-chooser",
    kind: "poison",
    sourceId: "7",
    targetId: "1",
    start: { phase: "night" as const, number: 2 },
    expires: { phase: "night" as const, number: 3 },
    active: true,
  });
  const po = state.night.queue.find((step) => step.roleId === "po")!;
  assert.equal(completeStep(state, po.key, { targetIds: ["2"] }).ok, true);
  assert.equal(state.players["2"].team, "evil");
  assert.equal(state.effects.filter((effect) => effect.bmr === "goon").length, 1);
  assert.equal(po.goonImpaired, true);
  assert.equal(isImpaired(state, "1"), true);
});

test("the Lunatic wears a Demon mask and the real Demon learns its choice", () => {
  const state = make(
    {
      1: "lunatic",
      2: "po",
      3: "chambermaid",
      4: "sailor",
      5: "pacifist",
      6: "professor",
      7: "gossip",
      8: "mastermind",
    },
    { count: 8, lunaticShownId: "po" },
  );
  assert.equal(state.setup.lunaticShownId, "po");
  assert.equal(state.players["1"].roleId, "lunatic");
  assert.equal(state.players["1"].shownRoleId, "po");
  assert.equal(state.players["1"].team, "good");

  startNight(state);
  const demonInfo = state.night.queue.find((step) => step.system === "demoninfo")!;
  assert.equal(infoForStep(state, demonInfo).lunaticId, "1");
  assert.equal(completeStep(state, demonInfo.key, {}).ok, true);
  assert.equal(demonInfo.given!.lunaticId, "1");
  const firstLunatic = state.night.queue.find((step) => step.roleId === "lunatic")!;
  assert.equal(completeStep(state, firstLunatic.key, {}).ok, true);
  assert.equal(state.deaths.length, 0, "the Lunatic's choice kills no one");
  skipRemaining(state);
  assert.equal(endNight(state).ok, true);
  assert.equal(endDay(state).ok, true);

  const lunatic = state.night.queue.find((step) => step.roleId === "lunatic")!;
  assert.equal(completeStep(state, lunatic.key, { targetIds: ["5"] }).ok, true);
  assert.equal(state.players["1"].used.lunaticTarget, "5");
  const po = state.night.queue.find((step) => step.roleId === "po")!;
  assert.equal(po.infoKind, "note");
  const info = infoForStep(state, po);
  assert.equal(info.kind, "note");
  assert.match(info.text!, /P1/);
  assert.match(info.text!, /P5/);
});

test("a player executed on the Mastermind's extra day loses for their team", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "courtier",
      3: "mastermind",
      4: "sailor",
      5: "gossip",
      6: "po",
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
  executeByDecision(state, "6");
  assert.equal(state.mastermind!.active, true);
  assert.equal(endDay(state).ok, true);
  assert.equal(state.day.number, 2);
  executeByDecision(state, "3");
  endDay(state);
  assert.equal(state.winner!.team, "good");
  assert.equal(state.winner!.reason, "mastermind");
});

test("the support table covers every requested role and never hides a manual fallback", () => {
  const roles = ["goon", "lunatic", "tinker", "pacifist", "mastermind", "chef"];
  const support = roleSupportEntries(roles);
  assert.deepEqual(
    support.map((entry) => [entry.roleId, entry.status]),
    [
      ["goon", "verified"],
      ["lunatic", "verified"],
      ["tinker", "host-choice"],
      ["pacifist", "host-choice"],
      ["mastermind", "verified"],
      ["chef", "verified"],
    ],
  );
  for (const entry of support) assert.match(entry.detail, /^roleSupport\./);
  const unknown = roleSupportEntries(["notarole"]);
  assert.deepEqual(
    unknown.map((entry) => [entry.roleId, entry.status]),
    [["notarole", "unsupported"]],
  );
});

test("a Pukka choosing the Goon completes without an effect cycle", () => {
  const state = make(
    {
      1: "pukka",
      2: "goon",
      3: "chambermaid",
      4: "pacifist",
      5: "professor",
      6: "gossip",
      7: "sailor",
      8: "mastermind",
    },
    { count: 8 },
  );
  startNight(state);
  const pukka = skipUntil(state, (step) => step.roleId === "pukka");
  assert.ok(pukka);
  const result = applyCommand(state, {
    id: "goon-pukka",
    type: "completeNightStep",
    payload: { key: pukka.key, targetIds: ["2"] },
  });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["2"].team, "evil");
  assert.equal(state.effects.filter((effect) => effect.bmr === "goon").length, 1);
  assert.equal(state.night.queue.find((step) => step.key === pukka.key)!.goonImpaired, true);
  assert.equal(isImpaired(state, "2"), false, "the Pukka's poison did not land");
});

test("a Sailor choosing the Goon completes without an effect cycle", () => {
  const state = make(
    {
      1: "sailor",
      2: "goon",
      3: "pukka",
      4: "chambermaid",
      5: "pacifist",
      6: "professor",
      7: "gossip",
      8: "mastermind",
    },
    { count: 8 },
  );
  startNight(state);
  const sailor = skipUntil(state, (step) => step.roleId === "sailor");
  assert.ok(sailor);
  const result = applyCommand(state, {
    id: "goon-sailor",
    type: "completeNightStep",
    payload: { key: sailor.key, targetIds: ["2"], drunkId: "2" },
  });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["2"].team, "good");
  assert.equal(isImpaired(state, "1"), true, "the Sailor is drunk");
  assert.equal(isImpaired(state, "2"), false, "the Sailor's own drunk is inactive");
});

test("an Innkeeper choosing the Goon completes without an effect cycle", () => {
  const state = make(
    {
      1: "innkeeper",
      2: "goon",
      3: "pukka",
      4: "chambermaid",
      5: "pacifist",
      6: "professor",
      7: "gossip",
      8: "mastermind",
    },
    { count: 8 },
  );
  nightTwo(state);
  const innkeeper = skipUntil(state, (step) => step.roleId === "innkeeper");
  assert.ok(innkeeper);
  const result = applyCommand(state, {
    id: "goon-innkeeper",
    type: "completeNightStep",
    payload: { key: innkeeper.key, targetIds: ["2", "4"], drunkId: "2" },
  });
  assert.equal(result.status, "allowed", JSON.stringify(result));
  assert.equal(state.players["2"].team, "good");
  assert.equal(isImpaired(state, "1"), true, "the Innkeeper is drunk");
  assert.equal(isImpaired(state, "2"), false, "the Innkeeper's own drunk is inactive");
});

test("a Chambermaid choosing the Goon gets false information", () => {
  const state = make(
    {
      1: "chambermaid",
      2: "goon",
      3: "pukka",
      4: "pacifist",
      5: "professor",
      6: "gossip",
      7: "sailor",
      8: "mastermind",
    },
    { count: 8 },
  );
  startNight(state);
  const chambermaid = skipUntil(state, (step) => step.roleId === "chambermaid");
  assert.ok(chambermaid);
  const preview = infoForStep(state, chambermaid, { targetIds: ["2", "4"] });
  assert.equal(preview.needsChoice, true);
  const pending: Record<string, unknown> = completeStep(state, chambermaid.key, {
    targetIds: ["2", "4"],
  });
  assert.equal(pending.ok, false);
  assert.equal(pending.needsChoice, true);
  assert.equal(state.effects.filter((effect) => effect.bmr === "goon").length, 0);
  const given = { kind: "number", value: 2 };
  assert.equal(completeStep(state, chambermaid.key, { targetIds: ["2", "4"], given }).ok, true);
  assert.equal(chambermaid.goonImpaired, true);
  assert.equal(isImpaired(state, "1"), true);
  assert.deepEqual(chambermaid.given, given);
});

test("a Shabaloth choosing the Goon records no deaths", () => {
  const state = make(
    {
      1: "shabaloth",
      2: "goon",
      3: "mastermind",
      4: "chambermaid",
      5: "courtier",
      6: "sailor",
      7: "gossip",
      8: "professor",
    },
    { count: 8 },
  );
  nightTwo(state);
  const shabaloth = skipUntil(state, (step) => step.roleId === "shabaloth");
  assert.ok(shabaloth);
  assert.equal(completeStep(state, shabaloth.key, { targetIds: ["2", "4"] }).ok, true);
  assert.equal(shabaloth.goonImpaired, true);
  const before = state.deaths.length;
  const outcome = recordBmrOutcome(state, shabaloth.key, { deathIds: ["2", "4"] });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorCode, "error.52");
  assert.equal(state.deaths.length, before);
});

test("the Lunatic's simulated choice does not trigger the Goon", () => {
  const state = make(
    {
      1: "lunatic",
      2: "goon",
      3: "po",
      4: "chambermaid",
      5: "sailor",
      6: "pacifist",
      7: "professor",
      8: "mastermind",
      9: "gossip",
    },
    { count: 9, lunaticShownId: "po" },
  );
  nightTwo(state);
  const lunatic = state.night.queue.find((step) => step.roleId === "lunatic")!;
  assert.equal(completeStep(state, lunatic.key, { targetIds: ["2"] }).ok, true);
  assert.equal(state.effects.filter((effect) => effect.bmr === "goon").length, 0);
  assert.equal(state.players["2"].team, "good");
});

test("the Grandmother's chosen grandchild does not trigger the Goon", () => {
  const state = make(
    {
      1: "grandmother",
      2: "goon",
      3: "po",
      4: "chambermaid",
      5: "sailor",
      6: "pacifist",
      7: "professor",
      8: "mastermind",
    },
    { count: 8 },
  );
  startNight(state);
  const grandmother = skipUntil(state, (step) => step.roleId === "grandmother");
  assert.ok(grandmother);
  assert.equal(completeStep(state, grandmother.key, { targetIds: ["2"] }).ok, true);
  assert.equal(state.setup.grandmotherId, "2");
  assert.equal(state.effects.filter((effect) => effect.bmr === "goon").length, 0);
  assert.equal(state.players["2"].team, "good");
});

test("the Assassin kills the Goon and the Goon still turns evil", () => {
  const state = make(
    {
      1: "assassin",
      2: "goon",
      3: "po",
      4: "chambermaid",
      5: "sailor",
      6: "pacifist",
      7: "professor",
      8: "gossip",
    },
    { count: 8 },
  );
  nightTwo(state);
  const assassin = skipUntil(state, (step) => step.roleId === "assassin");
  assert.ok(assassin);
  assert.equal(completeStep(state, assassin.key, { targetIds: ["2"] }).ok, true);
  assert.equal(state.players["2"].team, "evil");
  assert.equal(state.players["2"].alive, false);
  assert.ok(state.deaths.some((death) => death.playerId === "2"));
  assert.equal(assassin.goonImpaired, true);
  assert.equal(assassin.goonImpairedOnly, true);
  // The host may still record the outcome for the Assassin step.
  assert.equal(recordBmrOutcome(state, assassin.key, { deathIds: ["2"] }).ok, true);
});

test("the Moonchild's stored choice still kills the Goon", () => {
  const state = make(
    {
      1: "moonchild",
      2: "goon",
      3: "po",
      4: "chambermaid",
      5: "sailor",
      6: "pacifist",
      7: "professor",
      8: "gossip",
      9: "mastermind",
    },
    { count: 9 },
  );
  state.players["1"].alive = false;
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
  assert.equal(moonchildChoice(state, "2").ok, true);
  assert.equal(endDay(state).ok, true);
  const moonchild = state.night.queue.find((step) => step.roleId === "moonchild")!;
  assert.ok(moonchild);
  assert.equal(completeStep(state, moonchild.key, { targetIds: ["2"] }).ok, true);
  assert.equal(state.players["2"].alive, false);
  assert.ok(state.deaths.some((death) => death.playerId === "2"));
  assert.equal(moonchild.goonImpaired, true);
});
