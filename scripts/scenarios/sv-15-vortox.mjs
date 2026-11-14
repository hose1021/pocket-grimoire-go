// Sects & Violets, 15 players: the Vortox makes every Townsfolk answer false
// and loses good a day with no execution; the No Dashii poisons the nearest
// Townsfolk on both sides and their answers are false; the Flowergirl and the
// Town Crier need a host answer when the night has no ended day behind it.
import {
  runScenario,
  seedGame,
  playNight,
  playDay,
  snapshot,
  expectWinner,
  assert,
  settle,
} from "../scenario-kit.mjs";

const NO_LEDGER = /ведущий отвечает вручную/;

/** The finished night's step records, read from the published state. */
async function nightSteps(page, roleIds) {
  return page.evaluate(async (wanted) => {
    const { store } = await window.PG_MODULES();
    return store.state.night.queue
      .filter((step) => wanted.includes(step.roleId))
      .map((step) => ({
        roleId: step.roleId,
        done: step.done === true,
        given: step.given || null,
      }));
  }, roleIds);
}

/** Active poison effects, with their source and target seats. */
async function activePoison(page) {
  return page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    return store.state.effects
      .filter((effect) => effect.kind === "poison" && effect.active !== false)
      .map((effect) => ({
        sourceId: effect.sourceId,
        targetId: effect.targetId,
        nodashii: effect.nodashii === true,
      }));
  });
}

/** The host tools live in the table menu; open it only when it is closed. */
async function tableMenu(page) {
  if (await page.locator("[data-menu]").count()) return;
  await page.locator('[data-act="menu"]:visible').click();
  await page.waitForSelector("[data-menu]");
}

/**
 * Saves the game through the console's export/import controls with the ended
 * day removed. A night can only sit behind a real day through the console, so
 * this is the one way to probe the missing-ledger branch of the Flowergirl and
 * the Town Crier without editing application state behind the UI's back.
 */
async function saveWithoutLastDay(page) {
  await tableMenu(page);
  await page.locator('[data-act="export"]:visible').first().click();
  const textarea = page.locator("textarea[readonly]");
  await textarea.waitFor();
  const exported = JSON.parse(await textarea.inputValue());
  await page.locator('[data-act="close"]').first().click();
  await settle(page);
  await tableMenu(page);
  await page.locator('[data-act="import"]:visible').click();
  await page.waitForSelector("[data-import-text]");
  const saved = { ...exported, game: { ...exported.game, lastDay: null } };
  await page.locator("[data-import-text]").fill(JSON.stringify(saved));
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('[data-act="apply-import"]').click();
  await page.waitForSelector('[data-act="complete"], [data-act="end-night"]');
  await settle(page);
}

await runScenario("sv-15-vortox", async ({ page }) => {
  await seedGame(page, {
    edition: "snv",
    assignment: {
      1: "clockmaker",
      2: "dreamer",
      3: "snakecharmer",
      4: "oracle",
      5: "seamstress",
      6: "flowergirl",
      7: "towncrier",
      8: "mathematician",
      9: "juggler",
      10: "sweetheart",
      11: "barber",
      12: "witch",
      13: "cerenovus",
      14: "pithag",
      15: "vortox",
    },
    bluffs: ["artist", "sage", "savant"],
  });

  let shot = await snapshot(page);
  assert.ok(shot.step, "night 1 has a first step");

  // The Cerenovus makes P2 mad as a role; the Witch curses P1; the Pit-Hag
  // changes nobody; every Townsfolk answer is false under the Vortox.
  await playNight(page, {
    cerenovus: { targets: ["2"], selects: [{ selector: "[data-bmr-role]", index: 1 }] },
    dreamer: {
      targets: ["4"],
      fills: { "[data-given]": "Ложный сон: один добрый и один злой персонаж" },
    },
    mathematician: { fills: { "[data-given]": "Ложное число" } },
    witch: { targets: ["1"] },
    pithag: { skip: true },
  });
  shot = await snapshot(page);
  assert.equal(shot.phase, "day", "night 1 ends into day 1");

  // The Cerenovus madness needs a host review before the day can end.
  await page.locator('[data-act="menu"]').click();
  await page.waitForSelector("[data-madness-review]");
  await page.locator('[data-madness-reason="2"]').fill("P2 stayed mad.");
  await page.locator('[data-madness-action="none"]').click();
  await page.keyboard.press("Escape");

  // Day 1 executes the Clockmaker so the game reaches night 2 with a living
  // Vortox, and the night then runs with no ended day behind it.
  await playDay(page, { execute: "1" });
  await playDay(page, {});
  shot = await snapshot(page);
  assert.equal(shot.phase, "night", "a killing execution opens night 2");

  // With the ended day removed, the Flowergirl and the Town Crier have no
  // ledger to read: the Storyteller answers both, with either answer allowed.
  await saveWithoutLastDay(page);
  shot = await snapshot(page);
  assert.equal(shot.day, 2, "the saved game is still night 2");

  await playNight(page, {
    snakecharmer: { skip: true },
    pithag: { skip: true },
    vortox: { skip: true },
    witch: { skip: true },
    cerenovus: { skip: true },
    seamstress: { skip: true },
    dreamer: {
      targets: ["4"],
      fills: { "[data-given]": "Ложный сон без записанного дня" },
    },
    mathematician: { fills: { "[data-given]": "Ложное число без записанного дня" } },
    flowergirl: { given: false },
    towncrier: { given: true },
  });

  const answers = await nightSteps(page, ["flowergirl", "towncrier", "oracle"]);
  const flowergirl = answers.find((step) => step.roleId === "flowergirl");
  const towncrier = answers.find((step) => step.roleId === "towncrier");
  const oracle = answers.find((step) => step.roleId === "oracle");
  assert.ok(flowergirl && flowergirl.done, "the Flowergirl answers on night 2");
  // The only death is the executed Clockmaker, so the true count is zero and a
  // living Vortox may not let the Oracle say it.
  assert.ok(
    !oracle.given.options.includes(0) && oracle.given.value !== 0,
    "a living Vortox forces a false Oracle count",
  );
  assert.match(
    flowergirl.given.text,
    NO_LEDGER,
    "no ended day: the Storyteller answers the Flowergirl instead of the engine",
  );
  assert.match(
    towncrier.given.text,
    NO_LEDGER,
    "no ended day: the Storyteller answers the Town Crier instead of the engine",
  );
  assert.deepEqual(
    flowergirl.given.options,
    [true, false],
    "the missing ledger leaves both answers legal for the Storyteller",
  );
  assert.equal(flowergirl.given.value, false, "the Flowergirl's record holds the given answer");
  assert.equal(towncrier.given.value, true, "the Town Crier's record holds the given answer");

  // Day 2: no execution while the Vortox lives, so evil wins.
  await playDay(page, {});
  shot = await snapshot(page);
  expectWinner(shot, "evil", "vortox");
  const vortoxDay = shot.day;

  // ---------------------------------------------------------------- No Dashii
  // Seat 5 is the No Dashii; the nearest Townsfolk on each side are seat 4
  // (Seamstress) and seat 6 (Mathematician), so both are poisoned all night.
  await seedGame(page, {
    edition: "snv",
    assignment: {
      1: "clockmaker",
      2: "dreamer",
      3: "oracle",
      4: "seamstress",
      5: "nodashii",
      6: "mathematician",
      7: "flowergirl",
      8: "towncrier",
      9: "juggler",
      10: "snakecharmer",
      11: "sweetheart",
      12: "barber",
      13: "witch",
      14: "cerenovus",
      15: "pithag",
    },
    bluffs: ["artist", "sage", "savant"],
  });

  await playNight(page, {
    snakecharmer: { skip: true },
    witch: { targets: ["7"] },
    cerenovus: { targets: ["8"], selects: [{ selector: "[data-bmr-role]", index: 1 }] },
    dreamer: { targets: ["11"] },
    // Both players are good, so the true Seamstress answer is "yes": the
    // poisoned Seamstress may only be told "no".
    seamstress: { targets: ["1", "10"] },
    mathematician: { fills: { "[data-given]": "Ложное число от Но Даши" } },
  });

  const poison = await activePoison(page);
  const neighbours = poison
    .filter((effect) => effect.sourceId === "5")
    .map((effect) => effect.targetId)
    .sort();
  assert.deepEqual(
    neighbours,
    ["4", "6"],
    "the No Dashii poisons the nearest Townsfolk on both sides (Seamstress, Mathematician)",
  );
  assert.ok(
    poison.every((effect) => effect.sourceId === "5"),
    "the No Dashii is the only poison source on night 1",
  );

  const info = await nightSteps(page, ["seamstress", "mathematician", "clockmaker"]);
  const seamstress = info.find((step) => step.roleId === "seamstress");
  const mathematician = info.find((step) => step.roleId === "mathematician");
  const clockmaker = info.find((step) => step.roleId === "clockmaker");

  assert.deepEqual(
    seamstress.given.options,
    [false],
    "a poisoned Seamstress can only be told the untrue side of the answer",
  );
  assert.equal(seamstress.given.impaired, true, "the poisoned Seamstress is marked impaired");
  assert.equal(
    mathematician.given.impaired,
    true,
    "the poisoned Mathematician learns Storyteller information, not the computed number",
  );
  assert.equal(
    clockmaker.given.impaired,
    false,
    "the unpoisoned Clockmaker still gets its computed answer",
  );
  assert.equal(
    clockmaker.given.needsChoice,
    false,
    "an unpoisoned Clockmaker needs no Storyteller answer",
  );
  assert.equal(typeof clockmaker.given.value, "number", "the Clockmaker's answer is a number");

  // A poisoned neighbourhood is not a win condition: executing the No Dashii
  // still ends the game for good.
  await playDay(page, { execute: "5" });
  shot = await snapshot(page);
  expectWinner(shot, "good", "demon-dead");

  return `vortox win on day ${vortoxDay}; No Dashii poisoned seats 4 and 6`;
});
