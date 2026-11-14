import assert from "node:assert/strict";
import { test } from "node:test";
import {
  autoSecrets,
  currentStep,
  dealGame,
  endDay,
  endNight,
  previewCommand,
  skipStep,
  startNight,
} from "../../../core/engine/index.ts";
import { createGame } from "../../../core/model/state.ts";
import type { NightStep, Player } from "../../../core/model/types.ts";
import type { PreviewOutcome } from "../../ports.ts";
import {
  applyGiven,
  blockerText,
  consequencesOf,
  defaultCorrectionValue,
  displayName,
  infoText,
  jugglerGuessingDay,
  logConsequence,
  nextSelection,
  normalizeJugglerGuesses,
  overlayOutlivesWin,
  redirectChoiceValue,
  rejectionOf,
  rejectionText,
  shownCardText,
  stepBlockers,
  stepTitle,
  timerText,
  toPreviewOutcome,
  winReasonKey,
} from "./helpers.ts";
import { dawnReport, seatBadges, seatGeometry } from "./ring.ts";

const t = (key: string, vars?: Record<string, string | number>): string =>
  vars ? `${key}:${Object.values(vars).join(",")}` : key;

function player(overrides: Partial<Player> = {}): Player {
  return {
    id: "p1",
    seat: 1,
    name: "",
    roleId: "chef",
    shownRoleId: "",
    alive: true,
    claimed: false,
    reminders: [],
    used: {},
    ...overrides,
  } as Player;
}

test("applyGiven records a number answer without the choice flag", () => {
  const info = { kind: "number", value: 0, needsChoice: true };
  assert.deepEqual(applyGiven(info, "3", "number"), {
    kind: "number",
    value: 3,
    needsChoice: false,
  });
});

test("applyGiven records a yes or no answer as a boolean", () => {
  assert.deepEqual(applyGiven({ kind: "yes-no", needsChoice: true }, "true", "bool"), {
    kind: "yes-no",
    value: true,
    needsChoice: false,
  });
  assert.deepEqual(applyGiven({ kind: "yes-no", needsChoice: true }, "false", "bool"), {
    kind: "yes-no",
    value: false,
    needsChoice: false,
  });
});

test("applyGiven records a role answer as the role id", () => {
  assert.deepEqual(applyGiven({ kind: "character", playerId: "p1" }, "empath", "role"), {
    kind: "character",
    playerId: "p1",
    roleId: "empath",
    needsChoice: false,
  });
});

test("applyGiven keeps an unknown choice kind unchanged", () => {
  const info = { kind: "one-of-two", needsChoice: true };
  assert.equal(applyGiven(info, "x", "text"), info);
  assert.equal(applyGiven(null, "x", "number"), null);
});

test("timerText formats the remaining time and clamps at zero", () => {
  assert.equal(timerText(null, 0), "—");
  assert.equal(timerText(300_000, 0), "05:00");
  assert.equal(timerText(300_000, 300_000 - 65_000), "01:05");
  assert.equal(timerText(300_000, 400_000), "00:00");
});

test("defaultCorrectionValue toggles life, keeps the role and clears a reminder", () => {
  assert.equal(defaultCorrectionValue("alive", player({ alive: true })), "dead");
  assert.equal(defaultCorrectionValue("alive", player({ alive: false })), "alive");
  assert.equal(defaultCorrectionValue("role", player({ roleId: "empath" })), "empath");
  assert.equal(defaultCorrectionValue("reminder", player()), "");
});

test("displayName prefers the saved name and falls back to the seat", () => {
  assert.equal(displayName(player({ name: "Аня" }), t), "Аня");
  assert.equal(displayName(player({ name: "", seat: 4 }), t), "ui.player 4");
  assert.equal(displayName(null, t), "—");
});

test("stepTitle names the role, the system step or the generic step", () => {
  const roles = (id: string) => (id === "chef" ? ({ id: "chef", name: "Chef" } as never) : null);
  assert.equal(stepTitle({ key: "k", roleId: "chef" } as never, roles, t), "Chef");
  assert.equal(stepTitle({ key: "k", system: "dawn" } as never, roles, t), "system.dawn");
  assert.equal(stepTitle({ key: "k" } as never, roles, t), "step");
});

test("stepBlockers lists every unanswered mandatory decision in priority order", () => {
  assert.deepEqual(
    stepBlockers({
      needsSetup: false,
      targetsIncomplete: true,
      needsGiven: false,
      needsRedirect: false,
    }),
    ["targets"],
  );
  assert.deepEqual(
    stepBlockers({
      needsSetup: true,
      targetsIncomplete: true,
      needsGiven: true,
      needsRedirect: true,
    }),
    ["secrets", "targets", "given", "redirect"],
  );
  assert.deepEqual(
    stepBlockers({
      needsSetup: false,
      targetsIncomplete: false,
      needsGiven: false,
      needsRedirect: false,
    }),
    [],
  );
});

test("stepBlockers reports an unanswered role choice and an unanswered drunk pick", () => {
  assert.deepEqual(
    stepBlockers({
      needsSetup: false,
      targetsIncomplete: false,
      needsGiven: false,
      needsRedirect: false,
      needsRole: true,
      needsDrunk: true,
    }),
    ["role", "drunk"],
  );
  assert.deepEqual(
    stepBlockers({
      needsSetup: false,
      targetsIncomplete: true,
      needsGiven: true,
      needsRedirect: true,
      needsRole: true,
      needsDrunk: false,
    }),
    ["targets", "role", "given", "redirect"],
  );
});

test("infoText prefers the computed note over the static note key", () => {
  const game = createGame(5);
  const step = { key: "n2-imp", roleId: "imp", noteKey: "note.bmr.po" } as NightStep;
  assert.equal(
    infoText(game, step, { kind: "note", text: "Lunatic: A; chose B" }, () => null, t),
    "Lunatic: A; chose B",
  );
  assert.equal(
    infoText(game, step, { kind: "note", text: "" }, () => null, t),
    "note.bmr.po",
  );
  assert.equal(
    infoText(game, step, { kind: "note" }, () => null, t),
    "note.bmr.po",
  );
  const staticStep = {
    key: "n2-demonchange",
    system: "demonchange",
    note: "Demon changed.",
    noteKey: "note.demonChanged",
  } as NightStep;
  assert.equal(
    infoText(game, staticStep, { kind: "note", text: "Demon changed." }, () => null, t),
    "note.demonChanged",
    "a computed copy of the static note keeps the localized key",
  );
});

test("a rejected command renders the localized error code, not the engine message", () => {
  const localized = (key: string): string => (key === "error.15" ? "Localized" : key);
  assert.equal(rejectionText({ text: "Русский текст", code: "error.15" }, localized), "Localized");
  assert.equal(
    rejectionText({ text: "Русский текст", code: "error.99" }, localized),
    "Русский текст",
  );
  assert.equal(rejectionText({ text: "", code: null }, localized), "setupErrors");
  assert.equal(rejectionText(null, localized), "");
});

test("an impaired actor card shows the chosen answer, then the template", () => {
  const game = createGame(5);
  game.players["1"]!.roleId = "chef";
  const step = { key: "n1-chef", roleId: "chef", actorId: "1" } as NightStep;
  const roles = (id: string) => (id === "chef" ? ({ id, name: "Chef" } as never) : null);
  assert.equal(
    shownCardText(
      game,
      step,
      { kind: "number", value: 1, needsChoice: true },
      { kind: "number", value: 2, needsChoice: false },
      "",
      true,
      roles,
      t,
    ),
    "numberResult:2",
    "the selected given answer is the recorded information",
  );
  assert.equal(
    shownCardText(
      game,
      step,
      { kind: "number", value: 1, needsChoice: true },
      undefined,
      "1 · Yes",
      true,
      roles,
      t,
    ),
    "1 · Yes",
  );
  assert.equal(
    shownCardText(
      game,
      step,
      { kind: "number", value: 1, needsChoice: true },
      undefined,
      "",
      true,
      roles,
      t,
    ),
    "ui.notSet",
  );
  assert.equal(
    shownCardText(game, step, { kind: "number", value: 1 }, undefined, "", false, roles, t),
    "numberResult:1",
  );
});

test("the seat picker collects every target a step allows", () => {
  assert.deepEqual(nextSelection([], "1", 1), ["1"]);
  assert.deepEqual(nextSelection(["1"], "1", 1), []);
  assert.deepEqual(nextSelection(["1", "2"], "3", 2), ["2", "3"]);
  assert.deepEqual(nextSelection([], "1", 3), ["1"]);
  assert.deepEqual(nextSelection(["1", "2", "3"], "4", 3), ["2", "3", "4"]);
  assert.deepEqual(nextSelection(["1", "2"], "1", 3), ["2"]);
});

test("the Mayor select has no value for an unanswered redirect", () => {
  assert.equal(redirectChoiceValue(undefined), "");
  assert.equal(redirectChoiceValue(null), "");
  assert.equal(redirectChoiceValue("none"), "none");
  assert.equal(redirectChoiceValue("2"), "2");
});

test("only the export and import dialogs outlive a win", () => {
  assert.equal(overlayOutlivesWin("export"), true);
  assert.equal(overlayOutlivesWin("import"), true);
  assert.equal(overlayOutlivesWin("day"), false);
  assert.equal(overlayOutlivesWin("step"), false);
  assert.equal(overlayOutlivesWin("info"), false);
  assert.equal(overlayOutlivesWin("menu"), false);
  assert.equal(overlayOutlivesWin(null), false);
});

test("the Juggler guesses read from both the pair list and the legacy map", () => {
  assert.deepEqual(
    normalizeJugglerGuesses([
      { playerId: "2", roleId: "clockmaker" },
      { playerId: "2", roleId: "dreamer" },
    ]),
    [
      { playerId: "2", roleId: "clockmaker" },
      { playerId: "2", roleId: "dreamer" },
    ],
    "the same player may be guessed twice",
  );
  assert.deepEqual(normalizeJugglerGuesses({ "2": "clockmaker", "6": "fanggu" }), [
    { playerId: "2", roleId: "clockmaker" },
    { playerId: "6", roleId: "fanggu" },
  ]);
  assert.deepEqual(normalizeJugglerGuesses([{ playerId: "2" }, null, { roleId: "chef" }]), []);
  assert.deepEqual(normalizeJugglerGuesses(null), []);
  assert.deepEqual(normalizeJugglerGuesses("x"), []);
});

test("the Juggler panel follows the Juggler's own day, not day one", () => {
  assert.equal(jugglerGuessingDay(4, 4, true), 4, "a stored Juggler day wins");
  assert.equal(jugglerGuessingDay(4, 2, false), 2, "a stored earlier day is the guess day");
  assert.equal(jugglerGuessingDay(3, null, false), 1, "a dealt Juggler starts on day one");
  assert.equal(jugglerGuessingDay(3, undefined, true), 3, "a created Juggler starts today");
});

test("every step blocker has its own localized sentence", () => {
  assert.equal(blockerText("targets", 2, t), "ui.blockTargets:2");
  assert.equal(blockerText("secrets", 1, t), "ui.blockSecrets");
  assert.equal(blockerText("given", 1, t), "ui.blockGiven");
  assert.equal(blockerText("redirect", 1, t), "ui.blockRedirect");
  assert.equal(blockerText("role", 1, t), "ui.blockRole");
  assert.equal(blockerText("drunk", 1, t), "ui.blockDrunk");
});

test("rejectionOf reports the engine reason for a rejected or Storyteller-choice command", () => {
  const rejected: PreviewOutcome = {
    status: "rejected",
    reason: "fallback",
    errorCode: "error.36",
    errors: ["Шаг не найден."],
  };
  assert.deepEqual(rejectionOf(rejected), { text: "Шаг не найден.", code: "error.36" });
  const choice: PreviewOutcome = {
    status: "requires-storyteller-choice",
    reason: "Выберите информацию.",
    errorCode: null,
  };
  assert.deepEqual(rejectionOf(choice), { text: "Выберите информацию.", code: null });
  assert.equal(rejectionOf({ status: "allowed" }), null);
  assert.equal(rejectionOf(null), null);
});

test("consequencesOf separates targets, applied state, deaths and revivals", () => {
  const outcome: PreviewOutcome = {
    status: "allowed",
    events: [
      { type: "effect.added", payload: { effect: { id: "e1", kind: "protected" } } },
      { type: "death.recorded", payload: { death: { playerId: "p2" } } },
      { type: "player.alive_changed", payload: { playerId: "p3", alive: true } },
      {
        type: "player.registered_dead_changed",
        payload: { playerId: "p4", registeredDead: true },
      },
    ],
    future: {
      delayedEffects: [{ kind: "pukka-death", targetId: "p5", resolve: { phase: "night" } }],
    },
  };
  const lines = consequencesOf(outcome, ["p1"]);
  assert.deepEqual(
    lines.map((line) => line.kind),
    ["target", "applied", "death", "revived", "prevented", "scheduled"],
  );
  assert.deepEqual(lines.find((line) => line.kind === "target")?.playerIds, ["p1"]);
  assert.deepEqual(lines.find((line) => line.kind === "death")?.playerIds, ["p2"]);
  assert.deepEqual(consequencesOf(null, ["p1"]), []);
});

test("a poison or protection expiry is not a scheduled death", () => {
  const outcome: PreviewOutcome = {
    status: "allowed",
    future: {
      delayedEffects: [
        { kind: "poison", targetId: "p2", expires: { phase: "night" } },
        { kind: "protected", targetId: "p3", expires: { phase: "night" } },
      ],
    },
  };
  assert.deepEqual(consequencesOf(outcome), []);
});

test("a blocked attack result is a prevented death", () => {
  const outcome: PreviewOutcome = {
    status: "allowed",
    result: { noDeath: true, reason: "The Soldier cannot die." },
  };
  assert.deepEqual(
    consequencesOf(outcome, ["p9"]).map((line) => line.kind),
    ["target", "prevented"],
  );
  assert.deepEqual(
    consequencesOf(outcome, ["p9"]).find((line) => line.kind === "prevented")?.playerIds,
    ["p9"],
  );
});

test("logConsequence reads the engine consequence and keeps an old-save fallback", () => {
  assert.equal(logConsequence({ kind: "death", consequence: "revived" }), "revived");
  assert.equal(logConsequence({ kind: "death", consequence: "prevented" }), "prevented");
  assert.equal(logConsequence({ kind: "execution", consequence: "prevented" }), "prevented");
  assert.equal(logConsequence({ kind: "death", consequence: "death" }), "death");
  assert.equal(logConsequence({ kind: "winner" }), null);
  assert.equal(logConsequence({ kind: "death" }), "death");
  assert.equal(logConsequence({ kind: "phase" }), "applied");
});

test("an Imp attack on a healthy Soldier previews a prevented death", () => {
  const game = createGame(5);
  const assignment: Record<string, string> = {
    "1": "soldier",
    "2": "chef",
    "3": "empath",
    "4": "poisoner",
    "5": "imp",
  };
  for (const player of Object.values(game.players)) {
    player.claimed = true;
    player.name = "Player " + player.seat;
  }
  game.setup.count = 5;
  game.setup.roles = [...new Set(Object.values(assignment))];
  game.setup.bluffs = [];
  dealGame(game, { assignment });
  autoSecrets(game);
  game.phase = "seat";
  startNight(game);
  while (currentStep(game)) {
    skipStep(game, currentStep(game)!.key, "test");
  }
  endNight(game);
  endDay(game);
  let step = currentStep(game);
  while (step && step.roleId !== "imp") {
    skipStep(game, step.key, "test");
    step = currentStep(game);
  }
  assert.equal(step?.roleId, "imp");
  const raw = previewCommand(game, {
    id: "imp-soldier-preview",
    type: "completeNightStep",
    payload: { key: step!.key, targetIds: ["1"] },
  });
  const outcome = toPreviewOutcome(raw);
  assert.equal(outcome.status, "allowed");
  assert.equal(outcome.result?.noDeath, true);
  assert.ok(consequencesOf(outcome, ["1"]).some((line) => line.kind === "prevented"));
});

test("the ring spaces five, eight and fifteen seats without a label collision", () => {
  for (const count of [5, 8, 15]) {
    const seats = seatGeometry(count);
    assert.equal(seats.length, count);
    assert.equal(
      new Set(seats.map((seat) => `${seat.x},${seat.y}`)).size,
      count,
      `${count}: every seat has its own centre`,
    );
    assert.deepEqual(
      seats.map((seat) => seat.z),
      seats.map((_, index) => count - index),
      `${count}: the paint order decreases with the seat index`,
    );
    assert.equal(
      new Set(seats.map((seat) => seat.side)).size > 1,
      true,
      `${count}: labels use more than one side`,
    );
    for (const seat of seats) {
      assert.ok(seat.x > 0 && seat.x < 100 && seat.y > 0 && seat.y < 100);
      if (seat.side === "right") assert.ok(seat.label.x < seat.x, `${count}: ${seat.index}`);
      if (seat.side === "left") assert.ok(seat.label.x > seat.x, `${count}: ${seat.index}`);
      if (seat.side === "above") assert.ok(seat.label.y < seat.y, `${count}: ${seat.index}`);
      if (seat.side === "below") assert.ok(seat.label.y > seat.y, `${count}: ${seat.index}`);
      for (const other of seats) {
        if (other === seat) continue;
        assert.ok(
          Math.hypot(seat.label.x - other.x, seat.label.y - other.y) > 8,
          `${count}: label ${seat.index} crosses seat ${other.index}`,
        );
      }
    }
  }
});

test("seatBadges lists every true table state in reading order", () => {
  assert.deepEqual(seatBadges({ alive: true, acting: true }), ["acting"]);
  assert.deepEqual(seatBadges({ alive: true, nominated: true }), ["nominated"]);
  assert.deepEqual(seatBadges({ alive: false, voteToken: true }), ["dead", "ghost-vote"]);
  assert.deepEqual(seatBadges({ alive: false, voteToken: false }), ["dead", "no-ghost-vote"]);
  assert.deepEqual(seatBadges({ alive: true, impaired: true, protected: true }), [
    "poison",
    "protection",
  ]);
  assert.deepEqual(seatBadges({ alive: true }), []);
  assert.deepEqual(seatBadges({ alive: true, scheduledDeath: true }), ["scheduled"]);
  assert.deepEqual(seatBadges({ alive: true, registeredDead: true }), ["registered-dead"]);
  assert.deepEqual(seatBadges({ alive: true, scheduledDeath: true, registeredDead: true }), [
    "scheduled",
    "registered-dead",
  ]);
});

test("winReasonKey separates an executed Demon from a night death", () => {
  const game = createGame(5);
  game.players["1"]!.roleId = "imp";
  game.day.execution = { playerId: "1", cause: "execution", at: new Date().toISOString() };
  assert.equal(winReasonKey(game, { reason: "demon-dead" }), "winReason.demon-executed");
  assert.equal(winReasonKey(game, { reason: "saint" }), "winReason.saint");
  game.players["1"]!.roleId = "chef";
  assert.equal(winReasonKey(game, { reason: "demon-dead" }), "winReason.demon-dead");
  assert.equal(winReasonKey(game, null), "");
});

test("dawnReport names the night deaths and counts the survivors", () => {
  const players = [
    { id: "1", name: "Ann", roleName: "Chef", alive: true },
    { id: "2", name: "Bob", roleName: "Empath", alive: false },
    { id: "3", name: "Cid", roleName: "Imp", alive: false },
  ];
  assert.deepEqual(dawnReport(players, [{ playerId: "2" }, { playerId: "3" }]), {
    deaths: [
      { playerId: "2", name: "Bob", roleName: "Empath" },
      { playerId: "3", name: "Cid", roleName: "Imp" },
    ],
    survivors: 1,
    total: 3,
    none: false,
  });
  assert.deepEqual(dawnReport(players, []), {
    deaths: [],
    survivors: 1,
    total: 3,
    none: true,
  });
  assert.deepEqual(dawnReport(players, [{ playerId: "ghost" }]).deaths, []);
});
