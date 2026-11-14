// Trouble Brewing, 15 players, good win: night information, a poisoned Chef,
// the Imp execution, the Scarlet Woman inheritance and the second execution,
// plus the Spy registration the Undertaker learns, the Fortune Teller's red
// herring, the Ravenkeeper waking on a night death and the Mayor redirect.
import {
  runScenario,
  seedGame,
  playNight,
  playDay,
  snapshot,
  expectWinner,
  assert,
} from "../scenario-kit.mjs";

/** The night queue with the answers the console recorded: given, executed id, wake facts. */
async function nightSteps(page) {
  return page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    return store.state.night.queue.map((step) => ({
      key: step.key,
      roleId: step.roleId,
      actorId: step.actorId,
      actorAlive: step.actorAlive,
      deadTonight: step.deadTonight === true,
      targetIds: step.targetIds,
      given: step.given,
      executedId: step.executedId ?? null,
      executedRoleId: step.executedRoleId ?? null,
    }));
  });
}

function stepOf(steps, roleId) {
  return steps.filter((step) => step.roleId === roleId).at(-1) || null;
}

/** The characters the Spy may register as, from the same engine call the step card offers. */
async function spyRegistrations(page) {
  return page.evaluate(async () => {
    const { engine, rules, store } = await window.PG_MODULES();
    const spy = Object.values(store.state.players).find((player) => player.roleId === "spy");
    if (!spy) return null;
    const options = engine.characterChoices(store.state, spy.id, false);
    return {
      id: spy.id,
      options,
      teams: Object.fromEntries(options.map((id) => [id, rules.ROLE_TEAM[id] || null])),
      expected: ["spy"].concat(rules.TB.townsfolk, rules.TB.outsider),
    };
  });
}

async function herringId(page) {
  return page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    return store.state.setup.herringId || store.state.herringId || null;
  });
}

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
      8: "ravenkeeper",
      9: "mayor",
      10: "saint",
      11: "butler",
      12: "poisoner",
      13: "spy",
      14: "scarletwoman",
      15: "imp",
    },
    bluffs: ["monk", "soldier", "virgin"],
  });

  const herring = await herringId(page);
  const fortuneAnswers = [];

  // Night 1 has no Demon attack (official first-night sheet). The Poisoner
  // poisons the Chef and the Butler serves the Mayor.
  await playNight(page, {
    poisoner: { targets: ["4"] },
    fortuneteller: { targets: [herring, "2"] },
    butler: { targets: ["9"] },
  });
  let shot = await snapshot(page);
  let steps = await nightSteps(page);
  fortuneAnswers.push(stepOf(steps, "fortuneteller").given.value);
  assert.equal(shot.phase, "day", "night 1 ends into day 1");
  assert.equal(shot.deaths.length, 0, "the first night has no Demon attack, so nobody dies");

  // Day 1: no execution.
  await playDay(page, {});

  // Night 2: the Imp attacks the Mayor. The Storyteller redirects the attack
  // to the Investigator, so the Mayor survives and somebody else dies.
  await playNight(page, {
    poisoner: { targets: ["4"] },
    imp: { targets: ["9"], selects: [{ selector: "select[data-redirect]", value: "3" }] },
    fortuneteller: { targets: [herring, "2"] },
    butler: { targets: ["9"] },
  });
  shot = await snapshot(page);
  steps = await nightSteps(page);
  fortuneAnswers.push(stepOf(steps, "fortuneteller").given.value);
  const mayor = shot.players.find((player) => player.id === "9");
  const redirected = shot.deaths.filter(
    (death) => death.playerId === "3" && death.phase === "night" && death.number === 2,
  );
  assert.ok(
    mayor.alive && redirected.length === 1,
    `the Mayor redirect: the Mayor lives and the redirected player dies (mayor.alive=${mayor.alive}, deaths=${shot.deaths.map((death) => death.playerId + ":" + death.cause).join(",")})`,
  );
  const poison = shot.effects.find((effect) => effect.kind === "poison" && effect.targetId === "4");
  assert.ok(poison, "the Poisoner poisons the Chef on night 2");

  // Day 2: execute the Spy. Its death is what the Undertaker wakes for.
  await playDay(page, { execute: "13" });
  shot = await snapshot(page);
  assert.equal(
    shot.players.find((player) => player.id === "13").alive,
    false,
    "the day-2 execution kills the Spy",
  );
  await playDay(page, {});

  // Night 3: the Imp kills the Ravenkeeper, who wakes for its own night death;
  // the Undertaker learns the executed Spy registered as a Townsfolk.
  const registrations = await spyRegistrations(page);
  await playNight(page, {
    poisoner: { targets: ["4"] },
    imp: { targets: ["8"] },
    ravenkeeper: { targets: ["15"] },
    fortuneteller: { targets: ["4", "5"] },
    undertaker: { given: "chef" },
    butler: { targets: ["9"] },
  });
  shot = await snapshot(page);
  steps = await nightSteps(page);
  fortuneAnswers.push(stepOf(steps, "fortuneteller").given.value);

  assert.ok(
    fortuneAnswers[0] === true && fortuneAnswers[2] === false,
    `the Fortune Teller red herring: seat ${herring} reads as a Demon (herring pair=${fortuneAnswers[0]}) and a pair without the Demon or herring reads No (${fortuneAnswers[2]})`,
  );

  const ravenkeeper = stepOf(steps, "ravenkeeper");
  assert.ok(
    ravenkeeper &&
      ravenkeeper.actorId === "8" &&
      ravenkeeper.actorAlive === false &&
      ravenkeeper.deadTonight === true &&
      ravenkeeper.given.roleId === "imp",
    `the Ravenkeeper wakes for its own night death and learns the Demon: ${JSON.stringify(ravenkeeper)}`,
  );

  const undertaker = stepOf(steps, "undertaker");
  const answerTeam = undertaker ? registrations.teams[undertaker.given.roleId] : null;
  const offered = registrations.options.slice().sort().join(",");
  const expected = registrations.expected.slice().sort().join(",");
  assert.ok(
    undertaker &&
      undertaker.executedId === "13" &&
      answerTeam === "townsfolk" &&
      offered === expected,
    `the Spy execution registers to the Undertaker as a Townsfolk/Outsider: executed=${undertaker && undertaker.executedId}/${undertaker && undertaker.executedRoleId}, answer=${undertaker && undertaker.given.roleId} (${answerTeam}), options=${registrations.options.join(",")}`,
  );

  // Day 3: execute the Imp; the Scarlet Woman inherits.
  await playDay(page, { execute: "15" });
  shot = await snapshot(page);
  const heir = shot.players.find((player) => player.id === "14");
  assert.ok(
    heir.roleId === "imp" && shot.winner === null,
    `the Scarlet Woman inherits and keeps the game going (heir=${heir.roleId}, winner=${JSON.stringify(shot.winner)})`,
  );
  await playDay(page, {});

  // Night 4: the new Imp attacks; day 4 executes it for a good win.
  await playNight(page, {
    poisoner: { targets: ["4"] },
    imp: { targets: ["10"] },
    fortuneteller: { targets: [herring, "2"] },
    butler: { targets: ["9"] },
  });
  await playDay(page, { execute: "14" });
  shot = await snapshot(page);
  expectWinner(shot, "good", "demon-dead");

  const choices = await page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    return store.state.log
      .filter((entry) => entry.case)
      .map((entry) => `${entry.case}=${entry.detail}`);
  });
  return [
    `good win on day ${shot.day}`,
    `herring=seat ${herring}`,
    `ft=${fortuneAnswers.map(String).join("/")}`,
    `redirected=${shot.deaths
      .filter((death) => death.number === 2)
      .map((death) => death.playerId)
      .join(",")}`,
    `ravenkeeper=${ravenkeeper.given.roleId}`,
    `undertaker=${undertaker.given.roleId}(${answerTeam})`,
    `choices=[${choices.join(" | ")}]`,
  ].join("; ");
});
