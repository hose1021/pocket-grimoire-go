// Trouble Brewing, 8 players: the Soldier cannot die to the Demon, the Monk
// protects its target, and the Slayer's public shot ends the game.
import {
  runScenario,
  seedGame,
  playNight,
  playDay,
  snapshot,
  expectWinner,
  assert,
} from "../scenario-kit.mjs";

await runScenario("tb-8-day-powers", async ({ page }) => {
  await seedGame(page, {
    edition: "tb",
    assignment: {
      1: "slayer",
      2: "monk",
      3: "soldier",
      4: "ravenkeeper",
      5: "empath",
      6: "saint",
      7: "poisoner",
      8: "imp",
    },
    bluffs: ["chef", "butler", "mayor"],
  });

  // 8 players = 5 townsfolk / 1 outsider / 1 minion / 1 demon.
  let shot = await snapshot(page);
  assert.equal(shot.players.length, 8, "the seeded game has eight players");

  // Night 1: the Poisoner poisons the Empath; no Demon attack on night 1.
  await playNight(page, { poisoner: { targets: ["5"] } });
  await playDay(page, {});

  // Night 2: the Monk protects the Empath and the Imp attacks the Soldier,
  // who cannot die to the Demon.
  await playNight(page, {
    poisoner: { targets: ["5"] },
    monk: { targets: ["5"] },
    imp: { targets: ["3"] },
  });
  shot = await snapshot(page);
  assert.equal(shot.deaths.length, 0, "the Soldier and the protected Empath survive");

  // Day 2: the Slayer shoots the Imp; the Demon dies and good wins.
  await page.locator('[data-act="day-help"]').click();
  await page.waitForSelector("[data-slayer-target]");
  await page.locator("[data-slayer-target]").selectOption("8");
  await page.locator('[data-act="slayer"]').click();
  await page.waitForSelector('[data-table-dock][data-phase="over"]');
  shot = await snapshot(page);
  expectWinner(shot, "good", "demon-dead");
  return `Slayer ended the game on day ${shot.day}`;
});
