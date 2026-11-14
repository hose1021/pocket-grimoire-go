// Trouble Brewing, 8 players: the day powers. The Slayer's public shot ends
// the game, the Monk and the Soldier prevent deaths, and three separate seeded
// games cover the Virgin's first nomination, the Saint's execution and the
// Mayor's no-execution win at three living.
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
  // --- Game 1: Slayer, Monk, Soldier -------------------------------------
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
  // The day-help dialog stays open after the shot; close it before the next seed.
  await page.keyboard.press("Escape");
  shot = await snapshot(page);
  expectWinner(shot, "good", "demon-dead");

  // --- Game 2: the Virgin's first nomination ------------------------------
  // A fresh 8p bag: the Virgin, a townsfolk nominator and the day form.
  await seedGame(page, {
    edition: "tb",
    assignment: {
      1: "virgin",
      2: "monk",
      3: "soldier",
      4: "empath",
      5: "ravenkeeper",
      6: "saint",
      7: "poisoner",
      8: "imp",
    },
    bluffs: ["chef", "butler", "mayor"],
  });
  await playNight(page, {}, { skipUnplanned: true });

  // Day 1: the Monk (a real Townsfolk) is the first nomination of the Virgin.
  await page.locator('[data-act="day-help"]').click();
  await page.waitForSelector("[data-virgin-form]");
  await page.locator('[data-virgin-form] select[name="nominator"]').selectOption("2");
  await page.locator('[data-virgin="1"]').click();
  await page.keyboard.press("Escape");
  shot = await snapshot(page);
  // The trigger is not a vote: the execution names the Virgin and no
  // nomination was recorded for the day.
  const virginDay = await page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    return {
      cause: store.state.day.execution ? store.state.day.execution.cause : null,
      nominations: store.state.day.nominations.length,
    };
  });
  assert.deepEqual(
    { executedId: shot.execution?.playerId, cause: virginDay.cause, votes: virginDay.nominations },
    { executedId: "2", cause: "virgin", votes: 0 },
    "Virgin: the first nomination executes the Townsfolk nominator at once, without a vote",
  );
  assert.equal(shot.dayEnded, true, "Virgin: the trigger ends the day instead of opening a vote");
  assert.deepEqual(
    shot.players
      .filter((player) => player.id === "1" || player.id === "2")
      .map((player) => [player.id, player.alive]),
    [
      ["1", true],
      ["2", false],
    ],
    "Virgin: the nominator dies and the Virgin survives",
  );
  assert.equal(shot.winner, null, "Virgin: executing a Townsfolk nominator does not end the game");

  // --- Game 3: executing the Saint loses for good ------------------------
  await seedGame(page, {
    edition: "tb",
    assignment: {
      1: "saint",
      2: "mayor",
      3: "monk",
      4: "soldier",
      5: "empath",
      6: "slayer",
      7: "poisoner",
      8: "imp",
    },
    bluffs: ["chef", "butler", "virgin"],
  });
  await playNight(page, {}, { skipUnplanned: true });
  await playDay(page, { execute: "1" });
  shot = await snapshot(page);
  assert.deepEqual(
    shot.winner && {
      team: shot.winner.team,
      reason: shot.winner.reason,
      saintDead: shot.players.find((player) => player.id === "1")?.alive === false,
    },
    { team: "evil", reason: "saint", saintDead: true },
    "Saint: executing the Saint with the ability active loses the game for good",
  );

  // --- Game 4: a day without an execution at three living ----------------
  await seedGame(page, {
    edition: "tb",
    assignment: {
      1: "mayor",
      2: "monk",
      3: "soldier",
      4: "empath",
      5: "ravenkeeper",
      6: "recluse",
      7: "poisoner",
      8: "imp",
    },
    bluffs: ["chef", "butler", "virgin"],
  });

  // Night 1 has no Demon attack; day 1 executes the Recluse.
  await playNight(page, {}, { skipUnplanned: true });
  await playDay(page, { execute: "6" });
  await playDay(page, {});
  // Night 2 kills the Empath; day 2 executes the Ravenkeeper.
  await playNight(page, { imp: { targets: ["4"] } }, { skipUnplanned: true });
  await playDay(page, { execute: "5" });
  await playDay(page, {});
  // Night 3 kills the Monk; day 3 executes the Poisoner, leaving three.
  await playNight(page, { imp: { targets: ["2"] } }, { skipUnplanned: true });
  await playDay(page, { execute: "7" });
  await playDay(page, {});
  shot = await snapshot(page);
  const living = shot.players
    .filter((player) => player.alive)
    .map((player) => player.id)
    .sort();
  assert.deepEqual(
    living,
    ["1", "3", "8"],
    "Mayor setup: the day-3 execution leaves three players alive",
  );
  assert.equal(shot.winner, null, "Mayor setup: the day-3 execution keeps the game running");

  // Night 4: the Imp attacks the Soldier and nobody dies.
  await playNight(page, { imp: { targets: ["3"] } }, { skipUnplanned: true });
  shot = await snapshot(page);
  assert.deepEqual(
    shot.players
      .filter((player) => player.alive)
      .map((player) => player.id)
      .sort(),
    ["1", "3", "8"],
    "Mayor: the night attack before the final day leaves the three alive",
  );

  // Day 4 ends without an execution: the Mayor wins at three living.
  await playDay(page, {});
  shot = await snapshot(page);
  assert.deepEqual(
    shot.winner && { team: shot.winner.team, reason: shot.winner.reason },
    { team: "good", reason: "mayor" },
    "Mayor: a day that ends without an execution at three living wins for good",
  );
  return `Slayer day-2 win, Virgin execution, Saint loss, Mayor win on day ${shot.day}`;
});
