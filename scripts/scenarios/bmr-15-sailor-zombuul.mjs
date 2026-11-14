// Bad Moon Rising, 15 players: the Sailor survives a day execution, the
// Exorcist blocks the Zombuul, and the Zombuul's first execution is a fake
// death that keeps it alive and stops its night attack.
import {
  runScenario,
  seedGame,
  playNight,
  playDay,
  snapshot,
  expectAlive,
  assert,
} from "../scenario-kit.mjs";

await runScenario("bmr-15-sailor-zombuul", async ({ page }) => {
  await seedGame(page, {
    edition: "bmr",
    assignment: {
      1: "sailor",
      2: "innkeeper",
      3: "exorcist",
      4: "courtier",
      5: "gambler",
      6: "professor",
      7: "grandmother",
      8: "chambermaid",
      9: "pacifist",
      10: "goon",
      11: "moonchild",
      12: "mastermind",
      13: "devilsadvocate",
      14: "assassin",
      15: "zombuul",
    },
    bluffs: ["tealady", "minstrel", "gossip"],
  });

  // Night 1. The Gambler, Courtier and Chambermaid are skipped: their choices
  // are covered by the engine tests, this game checks the death rules.
  await playNight(
    page,
    {
      sailor: { targets: ["2"], selects: [{ selector: "[data-bmr-drunk]", value: "2" }] },
      innkeeper: { targets: ["3", "4"], selects: [{ selector: "[data-bmr-drunk]", value: "3" }] },
      exorcist: { targets: ["15"] },
      grandmother: { targets: ["9"] },
      courtier: { skip: true },
      gambler: { skip: true },
    },
    { skipUnplanned: true },
  );
  let shot = await snapshot(page);
  assert.equal(shot.phase, "day", "night 1 ends into day 1");
  assert.equal(shot.deaths.length, 0, "nobody dies on night 1");

  // The Sailor is executed and remains alive ("You can't die.").
  await playDay(page, { execute: "1" });
  shot = await snapshot(page);
  expectAlive(shot, ["1"], true);
  await playDay(page, {});

  // Night 2: the Exorcist blocks the Zombuul, so nobody dies.
  await playNight(
    page,
    {
      sailor: { targets: ["2"], selects: [{ selector: "[data-bmr-drunk]", value: "2" }] },
      innkeeper: { targets: ["3", "4"], selects: [{ selector: "[data-bmr-drunk]", value: "3" }] },
      exorcist: { targets: ["15"] },
      courtier: { skip: true },
      gambler: { skip: true },
    },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  assert.equal(shot.deaths.length, 0, "the blocked Zombuul kills nobody");

  // The first execution of the Zombuul is a fake death: registered dead,
  // still alive, and no game over.
  await playDay(page, { execute: "15" });
  shot = await snapshot(page);
  const zombuul = shot.players.find((player) => player.id === "15");
  assert.equal(zombuul.alive, true, "the Zombuul is still alive");
  assert.equal(zombuul.registeredDead, true, "the Zombuul registers as dead");
  assert.equal(shot.winner, null, "the game is not over");
  await playDay(page, {});

  // Night 3: a registered-dead Zombuul does not attack.
  const before = shot.deaths.length;
  await playNight(
    page,
    {
      sailor: { targets: ["2"], selects: [{ selector: "[data-bmr-drunk]", value: "2" }] },
      innkeeper: { targets: ["3", "4"], selects: [{ selector: "[data-bmr-drunk]", value: "3" }] },
      courtier: { skip: true },
      gambler: { skip: true },
    },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  assert.equal(shot.deaths.length, before, "the Zombuul wakes nobody on night 3");
  return `sailor survived execution, Zombuul registered dead on day ${shot.day}`;
});
