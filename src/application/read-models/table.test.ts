import test from "node:test";
import assert from "node:assert/strict";
import {
  RULESET_VERSION,
  activeEffects,
  applyCommand,
  autoSecrets,
  butlerMaster,
  currentStep,
  dealGame,
  demonChangePending,
  executionThreshold,
  infoForStep,
  isImpaired,
  protectionFor,
  secretsErrors,
  setupErrors,
  soldierSafe,
  stepProgress,
} from "../../core/engine/index.ts";
import { createGame, livingPlayers } from "../../core/model/state.ts";
import type { CommandInput } from "../../core/commands/contracts.ts";
import type { Command, Effect, GameState, NightStep } from "../../core/model/types.ts";
import { previewOnState } from "../dispatch/preview.ts";
import {
  mayorRedirectNeeded,
  madnessReviewProjection,
  progressProjection,
  seatProjection,
  setupProjection,
  secretsProjection,
  stepProjection,
  tableProjection,
  targetBounds,
} from "./table.ts";

const ASSIGNMENT: Record<string, string> = {
  "1": "mayor",
  "2": "chef",
  "3": "empath",
  "4": "poisoner",
  "5": "imp",
  "6": "recluse",
};

let sequence = 0;

function scene(count = 6): GameState {
  const game = createGame(count);
  for (const player of Object.values(game.players)) {
    player.claimed = true;
    player.name = "Player " + player.seat;
  }
  game.setup.count = count;
  game.setup.roles = [...new Set(Object.values(ASSIGNMENT))];
  game.setup.bluffs = [];
  dealGame(game, { assignment: ASSIGNMENT });
  autoSecrets(game);
  game.phase = "seat";
  return game;
}

/** Apply one command and assert the screen projection still equals the engine. */
function play(state: GameState, command: CommandInput): void {
  sequence += 1;
  const result = applyCommand(state, {
    ...command,
    id: `projection-${sequence}`,
    rulesetVersion: RULESET_VERSION,
  } as Command);
  assert.equal(result.status, "allowed", `${command.type} is allowed`);
  expectProjectionEqualsEngine(state);
}

function touching(state: GameState, step: NightStep, targetIds: string[]): Effect[] {
  const ids = [step.actorId || "", ...targetIds];
  return activeEffects(state, null).filter(
    (effect) =>
      (effect.sourceId != null && ids.includes(String(effect.sourceId))) ||
      (effect.targetId != null && ids.includes(String(effect.targetId))),
  );
}

function expectProjectionEqualsEngine(state: GameState): void {
  const projection = tableProjection(state);
  assert.deepEqual(projection.step, currentStep(state));
  assert.deepEqual(projection.progress, stepProgress(state));
  assert.deepEqual(projection.progress, progressProjection(state));
  assert.deepEqual(projection.pendingDemonChange, demonChangePending(state));
  assert.equal(projection.living, livingPlayers(state).length);
  assert.equal(projection.threshold, executionThreshold(livingPlayers(state).length));
  // The engine's current step is the first open one in the queue.
  assert.equal(
    projection.step,
    state.night.queue.find((step) => !step.done && !step.skipped) || null,
  );
  // The threshold is the at-least-half rule, not a copy of the engine call.
  assert.equal(projection.threshold, Math.ceil(projection.living / 2));
  for (const player of Object.values(state.players)) {
    const seat = seatProjection(state, player.id);
    assert.equal(seat.impaired, isImpaired(state, player.id));
    assert.equal(seat.protected, Boolean(protectionFor(state, player.id)));
    assert.equal(
      seat.safeFromAttack,
      Boolean(protectionFor(state, player.id)) || soldierSafe(state, player.id),
    );
    assert.equal(seat.butlerMasterId, butlerMaster(state, player.id));
  }
  const step = projection.step;
  if (!step) return;
  const derived = stepProjection(state, step);
  assert.deepEqual(derived.info, infoForStep(state, step));
  assert.deepEqual(derived.effects, touching(state, step, []));
  assert.equal(derived.actorImpaired, step.actorId ? isImpaired(state, step.actorId) : false);
  assert.equal(derived.needsRedirect, mayorRedirectNeeded(state, step, ""));
}

/** A table row: the commands the screen issues in one phase, asserted after each. */
interface Row {
  name: string;
  play: (state: GameState) => void;
}

function skipOpenSteps(state: GameState): void {
  for (let step = currentStep(state); step; step = currentStep(state)) {
    play(state, { type: "skipStep", payload: { key: step.key, reason: "projection test" } });
  }
}

function skipUntil(state: GameState, roleId: string): void {
  for (let step = currentStep(state); step && step.roleId !== roleId; step = currentStep(state)) {
    play(state, { type: "skipStep", payload: { key: step.key, reason: "projection test" } });
  }
}

const SCENARIO: Row[] = [
  {
    name: "start the first night",
    play: (state) => {
      play(state, { type: "startNight", payload: {} });
      // Independently derived: six living players, an untouched three-step queue.
      const projection = tableProjection(state);
      assert.deepEqual(projection.progress, { done: 0, total: 3 });
      assert.equal(projection.living, 6);
      assert.equal(projection.threshold, 3);
    },
  },
  {
    name: "skip the Poisoner",
    play: (state) => {
      const step = currentStep(state);
      assert.equal(step?.roleId, "poisoner", "the Poisoner wakes first");
      play(state, { type: "skipStep", payload: { key: step!.key, reason: "projection test" } });
      assert.deepEqual(tableProjection(state).progress, { done: 1, total: 3 });
    },
  },
  {
    name: "complete the Chef with the Recluse registered evil",
    play: (state) => {
      const chef = currentStep(state);
      assert.equal(chef?.roleId, "chef", "the Chef wakes after the Poisoner");
      assert.equal(chef?.key, state.night.queue[1]?.key);
      // Independently derived: one evil adjacent pair (Poisoner, Imp) before the
      // registration, two once the Recluse registers evil.
      assert.equal(infoForStep(state, chef!).value, 1);
      const registrations = { "6": "evil" };
      play(state, {
        type: "completeNightStep",
        payload: { key: chef!.key, registrations },
      });
      const stored = state.night.queue.find((step) => step.key === chef!.key)!;
      assert.equal(infoForStep(state, stored).value, 2);
      assert.deepEqual(
        stepProjection(state, stored, { registrations }).info,
        infoForStep(state, stored, { registrations }),
      );
      assert.deepEqual(stepProjection(state, stored).info, infoForStep(state, stored));
    },
  },
  { name: "drain the first night", play: skipOpenSteps },
  {
    name: "end the first night",
    play: (state) => play(state, { type: "endNight", payload: {} }),
  },
  {
    name: "execute the Chef",
    play: (state) => play(state, { type: "executeByDecision", payload: { playerId: "2" } }),
  },
  {
    name: "end the first day",
    play: (state) => play(state, { type: "endDay", payload: {} }),
  },
  { name: "skip to the Imp", play: (state) => skipUntil(state, "imp") },
  {
    name: "attack the Mayor and redirect the death to nobody",
    play: (state) => {
      const step = currentStep(state);
      assert.equal(step?.roleId, "imp", "the Imp wakes on the second night");
      play(state, {
        type: "completeNightStep",
        payload: { key: step!.key, targetIds: ["1"], redirectId: "none" },
      });
    },
  },
  { name: "drain the second night", play: skipOpenSteps },
  {
    name: "end the second night",
    play: (state) => play(state, { type: "endNight", payload: {} }),
  },
];

test("the screen projection equals the engine state after every command", () => {
  const game = scene();
  expectProjectionEqualsEngine(game);
  for (const row of SCENARIO) row.play(game);
  assert.equal(tableProjection(game).living, livingPlayers(game).length);
});

test("a step projection with registrations equals the engine's registered answer", () => {
  const game = scene();
  play(game, { type: "startNight", payload: {} });
  skipUntil(game, "chef");
  const chef = currentStep(game);
  assert.equal(chef?.roleId, "chef");
  const registrations = { "6": "evil" };
  assert.equal(stepProjection(game, chef!, { registrations }).info.value, 2);
  assert.deepEqual(
    stepProjection(game, chef!, { registrations }).info,
    infoForStep(game, chef!, { registrations }),
  );
  // Without the registration the same step counts one evil pair.
  assert.equal(stepProjection(game, chef!).info.value, 1);
});

test("a step projection asks for the mayor redirect only on an Imp attack", () => {
  const game = scene();
  for (const row of SCENARIO) {
    row.play(game);
    if (tableProjection(game).step?.roleId === "imp") break;
  }
  const imp = tableProjection(game).step;
  assert.equal(imp?.roleId, "imp");
  const attack = stepProjection(game, imp!, { targetIds: ["1"] });
  assert.equal(attack.needsRedirect, true);
  assert.deepEqual(attack.info, infoForStep(game, imp!, { targetIds: ["1"] }));
  assert.equal(mayorRedirectNeeded(game, imp!, "1"), true);
  const empath = game.night.queue.find((step) => step.roleId === "empath");
  assert.ok(empath, "the Empath step exists in the second-night queue");
  assert.equal(stepProjection(game, empath, { targetIds: ["1"] }).needsRedirect, false);
});

test("a seat projection reports its impairment, protection and butler master", () => {
  const game = scene();
  const baseline = seatProjection(game, "1");
  assert.equal(baseline.impaired, false);
  assert.equal(baseline.protected, false);
  assert.equal(baseline.safeFromAttack, false);
  assert.equal(baseline.butlerMasterId, null);
});

test("a seat projection reports a poisoned chef, a soldier and a butler master", () => {
  const game = createGame(6);
  const assignment: Record<string, string> = {
    "1": "monk",
    "2": "soldier",
    "3": "butler",
    "4": "chef",
    "5": "poisoner",
    "6": "imp",
  };
  for (const player of Object.values(game.players)) {
    player.claimed = true;
    player.name = "Player " + player.seat;
  }
  game.setup.count = 6;
  game.setup.roles = [...new Set(Object.values(assignment))];
  game.setup.bluffs = [];
  dealGame(game, { assignment });
  autoSecrets(game);
  game.phase = "seat";
  play(game, { type: "startNight", payload: {} });

  // Night one: the Poisoner poisons the Chef, the Butler serves the Chef.
  for (let step = currentStep(game); step; step = currentStep(game)) {
    if (step.roleId === "poisoner" || step.roleId === "butler") {
      play(game, { type: "completeNightStep", payload: { key: step.key, targetIds: ["4"] } });
    } else {
      play(game, { type: "skipStep", payload: { key: step.key, reason: "projection test" } });
    }
  }
  assert.equal(seatProjection(game, "4").impaired, true);
  assert.equal(seatProjection(game, "3").butlerMasterId, "4");
  assert.equal(seatProjection(game, "2").protected, false);
  assert.equal(seatProjection(game, "2").safeFromAttack, true);

  // Night two: the Monk protects the Soldier.
  play(game, { type: "endNight", payload: {} });
  play(game, { type: "endDay", payload: {} });
  skipUntil(game, "monk");
  const monk = currentStep(game);
  assert.equal(monk?.roleId, "monk");
  play(game, {
    type: "completeNightStep",
    payload: { key: monk!.key, targetIds: ["2"] },
  });
  assert.equal(seatProjection(game, "2").protected, true);
  assert.equal(seatProjection(game, "2").safeFromAttack, true);
});

test("a seat projection exposes a scheduled death, a registered death and an effect source", () => {
  const game = scene();
  game.effects.push({
    id: "pending-death",
    kind: "pukka-death",
    sourceId: "1",
    targetId: "2",
    start: { phase: "night", number: 1 },
    expires: null,
    active: true,
  });
  game.effects.push({
    id: "drunk-source",
    kind: "drunk",
    sourceId: "1",
    targetId: "3",
    start: { phase: "night", number: 1 },
    expires: null,
    active: true,
  });
  game.players["4"]!.registeredDead = true;
  assert.equal(seatProjection(game, "2").scheduledDeath, true);
  assert.equal(seatProjection(game, "3").drunk, true);
  assert.equal(seatProjection(game, "3").drunkSourceRoleId, "mayor");
  assert.equal(seatProjection(game, "4").registeredDead, true);
});

test("the setup and secrets projections report a broken bag", () => {
  const game = scene();
  assert.deepEqual(setupProjection(game).errors, setupErrors(game));
  assert.deepEqual(secretsProjection(game).errors, secretsErrors(game));
  assert.deepEqual(setupProjection(game).errors, []);
  assert.deepEqual(secretsProjection(game).errors, []);
  game.setup.roles = ["chef"];
  assert.ok(setupProjection(game).errors.length > 0);
  assert.ok(secretsProjection(game).errors.length > 0);
});

test("the day projection exposes pending and reviewed madness to the Storyteller", () => {
  const game = scene();
  game.phase = "day";
  game.day.number = 1;
  game.effects.push({
    id: "cerenovus-review",
    kind: "madness",
    madness: "cerenovus",
    roleId: "clockmaker",
    sourceId: "4",
    targetId: "1",
    start: { phase: "night", number: 1 },
    expires: { phase: "night", number: 2 },
    active: true,
  });

  assert.deepEqual(madnessReviewProjection(game), [
    {
      effect: game.effects.at(-1),
      playerId: "1",
      pending: true,
    },
  ]);

  game.effects.at(-1)!.decidedDay = 1;
  game.effects.at(-1)!.decidedPenalty = "none";
  assert.equal(madnessReviewProjection(game)[0].pending, false);
});

test("the dispatch preview issues a fresh id without touching the state", () => {
  const game = scene();
  const before = JSON.stringify(game);
  const first = previewOnState(game, { type: "startNight", payload: {} });
  const second = previewOnState(game, { type: "startNight", payload: {} });
  assert.equal(first.status, "allowed");
  assert.equal(second.status, "allowed");
  const firstId = first.status === "allowed" ? first.id : "";
  const secondId = second.status === "allowed" ? second.id : "";
  assert.notEqual(firstId, secondId);
  assert.equal(JSON.stringify(game), before, "the preview must not mutate the state");
});

test("target bounds follow the step's fixed target mode", () => {
  const step: NightStep = { key: "n1-x", kind: "system", system: "dusk", targetMode: "none" };
  assert.deepEqual(targetBounds(step), { min: 0, max: 0 });
  assert.deepEqual(targetBounds({ ...step, targetMode: "one" }), { min: 1, max: 1 });
  assert.deepEqual(targetBounds({ ...step, targetMode: "two" }), { min: 2, max: 2 });
  assert.deepEqual(targetBounds({ ...step, bmr: true, minTargets: 1, maxTargets: 3 }), {
    min: 1,
    max: 3,
  });
});
