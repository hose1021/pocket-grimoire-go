// Sects & Violets, twelve players. One Demon per table, so the row's four
// rules run as dealt games, each led by the Demon that owns the rule:
//
//   1. 7/2/2/1 Vortox — the good Evil Twin is executed (r2964) and the
//      Mutant's madness penalty is an execution at night (r3006).
//   2. 6/3/2/1 Fang Gu — the Demon adds an Outsider, then jumps into the
//      first Outsider it kills; the jump happens once (r2974).
//   3. 8/1/2/1 Vigormortis — the Demon removes an Outsider; the Minion it
//      kills keeps its ability and poisons a Townsfolk neighbour (r3015).
//
// Two more tables guard the seat orders a host reaches by shuffling:
//
//   4. 6/3/2/1 Fang Gu with the old Demon at seat 1 and the Outsider it jumps
//      into at seat 12: the living new Fang Gu must be the one that wakes.
//   5. A Mutant that survives into a second day: its standing madness is due
//      again, so the review must still offer the no-penalty answer.
//
// Every night step, host decision and execution goes through the console;
// page.evaluate only reads the queue and the effects the console produced.
import {
  runScenario,
  seedGame,
  playNight,
  playDay,
  snapshot,
  expectWinner,
  expectAlive,
  assert,
  settle,
} from "../scenario-kit.mjs";

const SKIPS = {
  snakecharmer: { skip: true },
  dreamer: { skip: true },
  seamstress: { skip: true },
};

/** The queue the console is about to play, read before the night starts. */
async function nightQueue(page) {
  return page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    return store.state.night.queue.map((step) => ({
      roleId: step.roleId,
      actorId: step.actorId,
    }));
  });
}

/** Resolves one madness review in the table menu, the host's only surface. */
async function madnessReview(page, playerId, { execute = false, reason }) {
  await page.locator('[data-act="menu"]').click();
  await page.waitForSelector(`[data-madness-player="${playerId}"]`);
  await page.locator(`[data-madness-reason="${playerId}"]`).fill(reason);
  await page
    .locator(`[data-madness-player="${playerId}"]`)
    .locator(`[data-madness-action="${execute ? "execute" : "none"}"]`)
    .click();
  await settle(page);
  await page.keyboard.press("Escape");
  await settle(page);
}

/** The last execution record and the night death it produced. */
async function lastExecution(page, playerId) {
  return page.evaluate(async (playerId) => {
    const { store } = await window.PG_MODULES();
    const state = store.state;
    const entry = state.executions[state.executions.length - 1] || null;
    const death = state.deaths.find((candidate) => candidate.playerId === playerId) || null;
    return {
      cause: entry ? entry.cause : null,
      phase: death ? death.phase : null,
      number: death ? death.number : null,
      dayExecution: state.day ? state.day.execution || null : null,
    };
  }, playerId);
}

/** The Vigormortis poison token and its legal neighbour list, as the engine sees them. */
async function vigormortisPoison(page, deathId) {
  return page.evaluate(async (deathId) => {
    const { store, engine, rules } = await window.PG_MODULES();
    const state = store.state;
    const effect = state.effects.find(
      (candidate) => candidate.kind === "poison" && candidate.vigormortis === true,
    );
    const legal = effect ? engine.vigormortisPoisonChoices(state, deathId) : [];
    const target = effect && effect.targetId ? state.players[effect.targetId] : null;
    return {
      sourceId: effect ? effect.sourceId : null,
      neighbour: Boolean(effect && effect.targetId && legal.includes(String(effect.targetId))),
      team: target ? rules.roleTeam(target.roleId) : null,
      impaired: effect && effect.targetId ? engine.isImpaired(state, effect.targetId) : false,
    };
  }, deathId);
}

await runScenario("sv-12-evil-twin", async ({ page }) => {
  // -------------------------------------------------------------------------
  // Game 1 — Vortox, 7 Townsfolk / 2 Outsiders / 2 Minions / 1 Demon.
  // Seat 1 is the good twin the Evil Twin is paired with.
  // -------------------------------------------------------------------------
  await seedGame(page, {
    edition: "snv",
    assignment: {
      1: "clockmaker",
      2: "dreamer",
      3: "mathematician",
      4: "oracle",
      5: "seamstress",
      6: "snakecharmer",
      7: "towncrier",
      8: "mutant",
      9: "sweetheart",
      10: "eviltwin",
      11: "cerenovus",
      12: "vortox",
    },
    twin: "clockmaker",
    bluffs: ["artist", "juggler", "sage"],
  });

  // The Mutant's standing madness is the first host decision of the game: the
  // penalty chosen is an execution at night, which is outside the day's single
  // execution ("Only a madness execution at night is outside the day's
  // execution", day.ts).
  await madnessReview(page, "8", {
    execute: true,
    reason: "P8 was not mad about being an Outsider.",
  });
  let shot = await snapshot(page);
  const mutant = shot.players.find((player) => player.id === "8");
  const penalty = await lastExecution(page, "8");
  assert.deepEqual(
    { alive: mutant.alive, ...penalty },
    { alive: false, cause: "madness", phase: "night", number: 1, dayExecution: null },
    "Mutant r3006: the madness penalty executes at night and is not the day's execution",
  );

  // Night 1: no Demon attack on the first night. Under the Vortox every
  // Townsfolk answer is the host's false information: the Clockmaker gets a
  // false number from the select, the Mathematician a false note.
  await playNight(
    page,
    {
      ...SKIPS,
      cerenovus: { skip: true },
      clockmaker: {},
      mathematician: { fills: { "[data-given]": "Ложное число: 1" } },
    },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  assert.equal(shot.phase, "day", "night 1 ends into day 1");

  // Day 1: executing the good twin wins the game for evil on the spot.
  await playDay(page, { execute: "1" });
  shot = await snapshot(page);
  expectWinner(shot, "evil", "evil-twin");
  expectAlive(shot, ["1"], false);

  // -------------------------------------------------------------------------
  // Game 2 — Fang Gu, 6 Townsfolk / 3 Outsiders / 2 Minions / 1 Demon (the
  // Demon adds an Outsider). Seat 11 jumps; the old Demon is seat 12.
  // -------------------------------------------------------------------------
  await seedGame(page, {
    edition: "snv",
    assignment: {
      1: "clockmaker",
      2: "dreamer",
      3: "mathematician",
      4: "oracle",
      5: "seamstress",
      6: "snakecharmer",
      7: "witch",
      8: "cerenovus",
      9: "klutz",
      10: "sweetheart",
      11: "barber",
      12: "fanggu",
    },
    bluffs: ["artist", "juggler", "sage"],
  });

  await playNight(
    page,
    { ...SKIPS, witch: { skip: true }, cerenovus: { skip: true } },
    { skipUnplanned: true },
  );
  await playDay(page, {});

  // Night 2: the Fang Gu kills the Barber, the first Outsider to die. The
  // Outsider survives as the new Fang Gu and the old Demon dies instead.
  await playNight(
    page,
    {
      ...SKIPS,
      witch: { skip: true },
      cerenovus: { skip: true },
      fanggu: { targets: ["11"], click: ['[data-bmr-death][data-id="11"]'] },
    },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  const newFangGu = shot.players.find((player) => player.id === "11");
  const oldFangGu = shot.players.find((player) => player.id === "12");
  assert.deepEqual(
    {
      role: newFangGu.roleId,
      alive: newFangGu.alive,
      team: newFangGu.team,
      oldAlive: oldFangGu.alive,
    },
    { role: "fanggu", alive: true, team: "evil", oldAlive: false },
    "Fang Gu r2974: the first Outsider it kills becomes the new Fang Gu and the old Demon dies",
  );

  await playDay(page, {});

  // Night 3: the jumped player must be the Demon that wakes and attacks.
  let queue = await nightQueue(page);
  const jumpedWake = queue.find((step) => step.roleId === "fanggu");
  assert.equal(
    jumpedWake ? jumpedWake.actorId : null,
    "11",
    "Fang Gu r2974: the player who jumped wakes as the Demon on later nights",
  );

  await playNight(
    page,
    {
      ...SKIPS,
      witch: { skip: true },
      cerenovus: { skip: true },
      fanggu: { targets: ["10"], click: ['[data-bmr-death][data-id="10"]'] },
      sweetheart: { skip: true },
    },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  const sweetheart = shot.players.find((player) => player.id === "10");
  const livingFangGu = shot.players.filter((player) => player.alive && player.roleId === "fanggu");
  assert.deepEqual(
    { alive: sweetheart.alive, role: sweetheart.roleId, demons: livingFangGu.map((p) => p.id) },
    { alive: false, role: "sweetheart", demons: ["11"] },
    "Fang Gu r2974: the jump happens once — a later Outsider dies as normal",
  );

  // -------------------------------------------------------------------------
  // Game 3 — Vigormortis, 8 Townsfolk / 1 Outsider / 2 Minions / 1 Demon (the
  // Demon removes an Outsider). The Cerenovus is seat 10.
  // -------------------------------------------------------------------------
  await seedGame(page, {
    edition: "snv",
    assignment: {
      1: "clockmaker",
      2: "dreamer",
      3: "mathematician",
      4: "oracle",
      5: "seamstress",
      6: "snakecharmer",
      7: "towncrier",
      8: "artist",
      9: "sweetheart",
      10: "cerenovus",
      11: "witch",
      12: "vigormortis",
    },
    bluffs: ["juggler", "sage", "savant"],
  });

  await playNight(
    page,
    { ...SKIPS, witch: { skip: true }, cerenovus: { skip: true } },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  assert.equal(shot.phase, "day", "night 1 ends into day 1");
  await playDay(page, {});

  // Night 2: the Vigormortis kills its own Cerenovus; the dead Minion's
  // poison lands on a Townsfolk neighbour of the seat it died on.
  await playNight(
    page,
    {
      ...SKIPS,
      witch: { skip: true },
      cerenovus: { skip: true },
      vigormortis: { targets: ["10"], click: ['[data-bmr-death][data-id="10"]'] },
    },
    { skipUnplanned: true },
  );
  const poison = await vigormortisPoison(page, "10");
  assert.deepEqual(
    {
      sourceId: poison.sourceId,
      neighbour: poison.neighbour,
      team: poison.team,
      impaired: poison.impaired,
    },
    { sourceId: "10", neighbour: true, team: "townsfolk", impaired: true },
    "Vigormortis r3015: a Minion it kills poisons one Townsfolk neighbour",
  );

  await playDay(page, {});

  // Night 3: the dead Cerenovus still wakes and its madness still applies.
  queue = await nightQueue(page);
  const retainedWake = queue.some((step) => step.roleId === "cerenovus" && step.actorId === "10");
  await playNight(
    page,
    {
      ...SKIPS,
      witch: { skip: true },
      cerenovus: { targets: ["3"], selects: [{ selector: "[data-bmr-role]", index: 1 }] },
      vigormortis: { skip: true },
    },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  const madness = shot.effects.find(
    (effect) => effect.kind === "madness" && effect.sourceId === "10",
  );
  assert.ok(
    madness && madness.targetId === "3",
    "Vigormortis r3015: a Minion it kills keeps its ability (dead Cerenovus wake in the queue: " +
      retainedWake +
      ")",
  );

  // -------------------------------------------------------------------------
  // Game 4 — the same jump, but the old Demon sits at seat 1 and the Outsider
  // it jumps into at seat 12. The new Fang Gu is the only living Demon, so it
  // must be the one the next night wakes.
  // -------------------------------------------------------------------------
  await seedGame(page, {
    edition: "snv",
    assignment: {
      1: "fanggu",
      2: "clockmaker",
      3: "dreamer",
      4: "mathematician",
      5: "oracle",
      6: "seamstress",
      7: "snakecharmer",
      8: "witch",
      9: "pithag",
      10: "klutz",
      11: "sweetheart",
      12: "barber",
    },
    bluffs: ["artist", "juggler", "sage"],
  });

  await playNight(page, { ...SKIPS, witch: { skip: true } }, { skipUnplanned: true });
  await playDay(page, {});

  await playNight(
    page,
    {
      ...SKIPS,
      witch: { skip: true },
      fanggu: { targets: ["12"], click: ['[data-bmr-death][data-id="12"]'] },
    },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  assert.equal(
    shot.players.find((player) => player.id === "12").roleId,
    "fanggu",
    "Fang Gu r2974: the Outsider at a higher seat still becomes the new Fang Gu",
  );
  await playDay(page, {});

  queue = await nightQueue(page);
  const demonWake = queue.filter((step) => step.roleId === "fanggu").map((step) => step.actorId);
  assert.ok(
    demonWake.includes("12"),
    "Fang Gu r2974: the living new Fang Gu wakes even when the dead old Demon sits first " +
      "(Fang Gu wake actors: [" +
      demonWake.join(", ") +
      "] — seat 1 is the dead old Demon, seat 12 the living new one)",
  );

  // -------------------------------------------------------------------------
  // Game 5 — the Mutant's standing madness is due again on a later day. The
  // host must be able to answer "no penalty" every day, and endDay refuses to
  // close the day while the review is due (day.ts `madnessReviewsDue`).
  // -------------------------------------------------------------------------
  await seedGame(page, {
    edition: "snv",
    assignment: {
      1: "clockmaker",
      2: "dreamer",
      3: "mathematician",
      4: "oracle",
      5: "seamstress",
      6: "snakecharmer",
      7: "witch",
      8: "cerenovus",
      9: "mutant",
      10: "klutz",
      11: "sweetheart",
      12: "fanggu",
    },
    bluffs: ["artist", "juggler", "sage"],
  });

  await playNight(page, SKIPS, { skipUnplanned: true });
  await madnessReview(page, "9", {
    reason: "P9 stayed mad about being an Outsider today.",
  });
  await playDay(page, {});

  // Night 2: no attack, only the review that follows it.
  await playNight(page, { ...SKIPS, fanggu: { skip: true } }, { skipUnplanned: true });

  await page.locator('[data-act="menu"]').click();
  await page.waitForSelector('[data-madness-player="9"]');
  const answers = await page
    .locator('[data-madness-player="9"] [data-madness-action]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-madness-action")));
  assert.ok(
    answers.includes("none"),
    "Mutant r3006: a madness review due on a later day offers the no-penalty answer " +
      "(offered: " +
      answers.join(", ") +
      ")",
  );

  return (
    "evil-twin win on day 1; Fang Gu jump at night 2; Vigormortis poison + dead Cerenovus wake; " +
    "two seat-order/day-review probes"
  );
});
