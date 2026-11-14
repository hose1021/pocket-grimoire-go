// Bad Moon Rising, 15 players: the Demon and Minion target rules. One seeded
// game per rule, each dealt with the legal 9/2/3/1 bag and played through the
// console: the Po's no-one night and its three-target night, the Shabaloth's
// two kills and regurgitation, the Pukka's delayed poison/death, the Assassin
// killing through the Fool's protection, and the Mastermind's extra day.
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

// One 15-player roster shared by every game: 9 Townsfolk, 2 Outsiders,
// 3 Minions and the Demon under test in seat 15. The bluffs are good roles not
// in play (three bluffs are required at 7+ players).
const bluffs = ["innkeeper", "minstrel", "pacifist"];

function roster(demon) {
  return {
    1: "chambermaid",
    2: "courtier",
    3: "exorcist",
    4: "fool",
    5: "gambler",
    6: "gossip",
    7: "grandmother",
    8: "sailor",
    9: "tealady",
    10: "goon",
    11: "tinker",
    12: "assassin",
    13: "devilsadvocate",
    14: "mastermind",
    15: demon,
  };
}

// The Courtier and the Gambler must name a character before confirming, so
// their step is skipped: neither rule is under test in this file.
const quiet = { courtier: { skip: true }, gambler: { skip: true } };

/** The queued (not yet played) step for one role in the current night. */
async function queuedStep(page, roleId) {
  return page.evaluate(async (id) => {
    const { store } = await window.PG_MODULES();
    const step = store.state.night.queue.find(
      (candidate) => candidate.roleId === id && !candidate.done && !candidate.skipped,
    );
    return step ? { min: step.minTargets, max: step.maxTargets } : null;
  }, roleId);
}

async function poChoseNoOne(page) {
  return page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    return store.state.players["15"]?.used?.poNoOne === true;
  });
}

async function foolAbilityUsed(page) {
  return page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    return Boolean(store.state.players["4"]?.used?.fool);
  });
}

async function mastermindState(page) {
  return page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    return store.state.mastermind;
  });
}

/** Marks one host-declared death in the step sheet. */
function death(id) {
  return `[data-bmr-death][data-id="${id}"]`;
}

await runScenario("bmr-15-targets", async ({ page }) => {
  // The Po chooses no one, then exactly three the next night.
  await seedGame(page, { edition: "bmr", assignment: roster("po"), bluffs });
  await playNight(page, { ...quiet }, { skipUnplanned: true });
  let shot = await snapshot(page);
  assert.equal(shot.phase, "day", "night 1 ends into day 1");
  assert.equal(shot.deaths.length, 0, "the Po does not wake and kills nobody on night 1");
  await playDay(page, {});

  // An explicit empty target list is the Po choosing no one.
  await playNight(page, { ...quiet, po: { targets: [] } }, { skipUnplanned: true });
  shot = await snapshot(page);
  assert.equal(await poChoseNoOne(page), true, "Po: choosing no one is recorded for next night");
  assert.equal(shot.deaths.length, 0, "Po: a no-one night kills nobody");
  await playDay(page, {});

  const poStep = await queuedStep(page, "po");
  assert.ok(poStep, "Po: the Demon wakes on night 3");
  assert.deepEqual(
    [poStep.min, poStep.max],
    [3, 3],
    "Po: the night after a no-one choice must hit exactly three players",
  );

  await playNight(
    page,
    {
      ...quiet,
      po: { targets: ["1", "2", "3"], click: [death("1"), death("2"), death("3")] },
    },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  assert.equal(shot.deaths.length, 3, "Po: three chosen players die after a no-one night");
  expectAlive(shot, ["1", "2", "3"], false);
  expectAlive(shot, ["4"], true);

  // The Shabaloth kills two and regurgitates one of last night's targets.
  await seedGame(page, { edition: "bmr", assignment: roster("shabaloth"), bluffs });
  await playNight(page, { ...quiet }, { skipUnplanned: true });
  shot = await snapshot(page);
  assert.equal(shot.deaths.length, 0, "the Shabaloth does not wake on night 1");
  await playDay(page, {});

  const shabaloth = await queuedStep(page, "shabaloth");
  assert.deepEqual(
    [shabaloth?.min, shabaloth?.max],
    [2, 2],
    "Shabaloth: the Demon chooses exactly two players",
  );
  await playNight(
    page,
    {
      ...quiet,
      shabaloth: { targets: ["2", "3"], click: [death("2"), death("3")] },
    },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  assert.equal(shot.deaths.length, 2, "Shabaloth: both chosen players die");
  expectAlive(shot, ["2", "3"], false);
  await playDay(page, {});

  await playNight(
    page,
    {
      ...quiet,
      shabaloth: {
        targets: ["5", "6"],
        click: [death("5"), death("6")],
        selects: [{ selector: "[data-bmr-resurrect]", value: "2" }],
      },
    },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  assert.equal(
    shot.players.find((player) => player.id === "2").alive,
    true,
    "Shabaloth: a dead target from last night is regurgitated",
  );
  expectAlive(shot, ["5", "6"], false);

  // The Pukka poisons at once and kills the previous victim the next night.
  await seedGame(page, { edition: "bmr", assignment: roster("pukka"), bluffs });
  await playNight(page, { ...quiet, pukka: { targets: ["2"] } }, { skipUnplanned: true });
  shot = await snapshot(page);
  assert.ok(
    shot.effects.some((effect) => effect.kind === "poison" && effect.targetId === "2"),
    "Pukka: the chosen player is poisoned on night 1",
  );
  assert.equal(shot.deaths.length, 0, "Pukka: the poison kills nobody on the night it is given");
  await playDay(page, {});

  await playNight(page, { ...quiet, pukka: { targets: ["3"] } }, { skipUnplanned: true });
  shot = await snapshot(page);
  assert.equal(
    shot.players.find((player) => player.id === "2").alive,
    false,
    "Pukka: the previous victim dies on the next night",
  );
  assert.ok(
    shot.effects.some((effect) => effect.kind === "poison" && effect.targetId === "3"),
    "Pukka: the new target is poisoned while the old victim dies",
  );
  await playDay(page, {});

  await playNight(page, { ...quiet, pukka: { targets: ["5"] } }, { skipUnplanned: true });
  shot = await snapshot(page);
  assert.equal(
    shot.players.find((player) => player.id === "3").alive,
    false,
    "Pukka: the delay repeats for the next victim",
  );

  // The Assassin kills through the Fool's first-death protection.
  await seedGame(page, { edition: "bmr", assignment: roster("zombuul"), bluffs });
  await playNight(page, { ...quiet }, { skipUnplanned: true });
  await playDay(page, {});
  await playNight(
    page,
    { ...quiet, assassin: { targets: ["4"], click: [death("4")] } },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  expectAlive(shot, ["4"], false);
  assert.equal(
    await foolAbilityUsed(page),
    false,
    "Assassin: the Fool's protection is bypassed, not spent",
  );

  // The Mastermind grants one extra day after the Demon is executed.
  await seedGame(page, { edition: "bmr", assignment: roster("shabaloth"), bluffs });
  await playNight(page, { ...quiet }, { skipUnplanned: true });
  await playDay(page, { execute: "15" });
  shot = await snapshot(page);
  assert.equal(shot.winner, null, "Mastermind: executing the Demon does not end the game");
  assert.equal(
    (await mastermindState(page))?.active,
    true,
    "Mastermind: the living Minion activates when the Demon dies",
  );

  await playDay(page, {});
  shot = await snapshot(page);
  assert.equal(shot.phase, "day", "Mastermind: the game continues into one extra day");
  assert.equal(shot.day, 2, "Mastermind: the extra day is the next day");
  assert.equal(shot.winner, null, "Mastermind: no winner before the extra-day execution");

  await playDay(page, { execute: "1" });
  shot = await snapshot(page);
  expectWinner(shot, "evil", "mastermind");

  // The other side of the same rule: executing an evil player on the extra
  // day makes evil lose, so the town wins through the Mastermind.
  await seedGame(page, { edition: "bmr", assignment: roster("shabaloth"), bluffs });
  await playNight(page, { ...quiet }, { skipUnplanned: true });
  await playDay(page, { execute: "15" });
  await playDay(page, {});
  await playDay(page, { execute: "12" });
  shot = await snapshot(page);
  expectWinner(shot, "good", "mastermind");

  return `Po 0/3, Shabaloth regurgitation, Pukka delay, Assassin bypass, Mastermind extra day`;
});
