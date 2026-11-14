// Trouble Brewing, 15 players, good win: night information, a poisoned
// Empath, the Imp execution, the Scarlet Woman inheritance and the second
// execution. The pattern file for every other scenario.
import {
  runScenario,
  seedGame,
  playNight,
  playDay,
  snapshot,
  expectWinner,
  expectAlive,
  assert,
} from "../scenario-kit.mjs";

await runScenario("tb-15-demon-chain", async ({ page }) => {
  await seedGame(page, {
    edition: "tb",
    assignment: {
      1: "washerwoman",
      2: "librarian",
      3: "investigator",
      4: "chef",
      5: "empath",
      6: "fortuneteller",
      7: "undertaker",
      8: "virgin",
      9: "mayor",
      10: "saint",
      11: "butler",
      12: "poisoner",
      13: "spy",
      14: "scarletwoman",
      15: "imp",
    },
    bluffs: ["monk", "ravenkeeper", "soldier"],
  });

  // Night 1 has no Demon attack (official first-night sheet). The Poisoner
  // poisons the Empath and the Butler serves the Mayor.
  await playNight(page, {
    poisoner: { targets: ["5"] },
    butler: { targets: ["9"] },
  });
  let shot = await snapshot(page);
  assert.equal(shot.phase, "day", "night 1 ends into day 1");
  assert.equal(shot.deaths.length, 0, "nobody dies on night 1");

  // Day 1: no execution.
  await playDay(page, {});

  // Night 2: the Poisoner keeps the Empath drunk; the Imp kills the Saint.
  await playNight(page, {
    poisoner: { targets: ["5"] },
    butler: { targets: ["9"] },
    imp: { targets: ["10"] },
  });
  shot = await snapshot(page);
  expectAlive(shot, ["10"], false);
  const poison = shot.effects.find((effect) => effect.kind === "poison" && effect.targetId === "5");
  assert.ok(poison, "the Empath is poisoned on night 2");

  // Day 2: execute the Imp; the Scarlet Woman inherits.
  await playDay(page, { execute: "15" });
  shot = await snapshot(page);
  expectAlive(shot, ["15"], false);
  const heir = shot.players.find((player) => player.id === "14");
  assert.equal(heir.roleId, "imp", "the Scarlet Woman becomes the Imp");
  assert.equal(shot.winner, null, "a living heir keeps the game going");
  await playDay(page, {});

  // Night 3: the new Imp attacks the Chef; day 3 executes it for a good win.
  await playNight(page, { imp: { targets: ["4"] } });
  await playDay(page, { execute: "14" });
  shot = await snapshot(page);
  expectWinner(shot, "good", "demon-dead");
  return `good win on day ${shot.day}, ${shot.deaths.length} deaths`;
});
