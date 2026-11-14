// Sects & Violets, 15 players, Vortox: every Townsfolk answer is false, and a
// day with no execution loses the game for good.
import {
  runScenario,
  seedGame,
  playNight,
  playDay,
  snapshot,
  expectWinner,
  assert,
} from "../scenario-kit.mjs";

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

  // No execution today: the living Vortox makes good lose.
  await playDay(page, {});
  shot = await snapshot(page);
  expectWinner(shot, "evil", "vortox");
  return `evil win on day ${shot.day}, ${shot.log} log entries`;
});
