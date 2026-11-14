// Bad Moon Rising, 15 players: the Sailor survives a day execution, the
// Exorcist blocks the Zombuul, and the Zombuul's first execution is a fake
// death that keeps it alive and stops its night attack. The same game then
// covers the Mastermind's extra day. Two more seeded 15-player games cover the
// Devil's Advocate's execution protection and the Fool's once-only survival.
import {
  runScenario,
  seedGame,
  playNight,
  playDay,
  snapshot,
  expectAlive,
  assert,
} from "../scenario-kit.mjs";

const playerOf = (shot, id) => shot.players.find((player) => player.id === String(id));

/** Reads engine flags the serialized snapshot does not expose. Read-only. */
async function flagsOf(page, ids = []) {
  return page.evaluate(async (wanted) => {
    const { store } = await window.PG_MODULES();
    const state = store.state;
    return {
      mastermind: state.mastermind
        ? {
            active: state.mastermind.active === true,
            extraDay: state.mastermind.extraDay === true,
          }
        : null,
      used: Object.fromEntries(wanted.map((id) => [id, { ...(state.players[id] || {}).used }])),
    };
  }, ids);
}

/** Reads the just-finished night's steps. Read-only. */
async function nightQueue(page) {
  return page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    return store.state.night.queue.map((step) => ({
      roleId: step.roleId,
      done: step.done === true,
      skipped: step.skipped === true,
      targets: Array.isArray(step.targetIds) ? step.targetIds.map(String) : [],
    }));
  });
}

await runScenario("bmr-15-sailor-zombuul", async ({ page }) => {
  // ---------------------------------------------------------------------
  // Game 1: Sailor, Exorcist, Zombuul fake death, then the Mastermind.
  // ---------------------------------------------------------------------
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
  const zombuul = playerOf(shot, "15");
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

  // The second, real execution of the Zombuul: a living Mastermind turns the
  // Demon's death into one extra day instead of a good win.
  await playDay(page, { execute: "15" });
  shot = await snapshot(page);
  expectAlive(shot, ["15"], false);
  let seen = await flagsOf(page, ["12"]);
  assert.deepEqual(
    { winner: shot.winner, mastermind: seen.mastermind },
    { winner: null, mastermind: { active: true, extraDay: false } },
    "Mastermind: a living Mastermind suppresses the Demon-dead win and arms one extra day",
  );

  const dayOfDemonDeath = shot.day;
  await playDay(page, {});
  shot = await snapshot(page);
  seen = await flagsOf(page, ["12"]);
  assert.deepEqual(
    {
      day: shot.day,
      phase: shot.phase,
      winner: shot.winner,
      mastermind: seen.mastermind,
    },
    {
      day: dayOfDemonDeath + 1,
      phase: "day",
      winner: null,
      mastermind: { active: true, extraDay: true },
    },
    "Mastermind: ending the Demon's day grants exactly one more day with no result yet",
  );

  await playDay(page, { execute: "12" });
  shot = await snapshot(page);
  assert.deepEqual(
    {
      phase: shot.phase,
      winner: shot.winner ? { team: shot.winner.team, reason: shot.winner.reason } : null,
    },
    { phase: "over", winner: { team: "good", reason: "mastermind" } },
    "Mastermind: the player executed on the extra day loses immediately, without ending the day first",
  );

  // ---------------------------------------------------------------------
  // Game 2: the Devil's Advocate protects a target from tomorrow's execution.
  // ---------------------------------------------------------------------
  await seedGame(page, {
    edition: "bmr",
    assignment: {
      1: "courtier",
      2: "chambermaid",
      3: "exorcist",
      4: "grandmother",
      5: "gambler",
      6: "professor",
      7: "pacifist",
      8: "sailor",
      9: "minstrel",
      10: "goon",
      11: "moonchild",
      12: "mastermind",
      13: "devilsadvocate",
      14: "assassin",
      15: "zombuul",
    },
    bluffs: ["tealady", "fool", "innkeeper"],
  });

  // Night 1: the Devil's Advocate protects the Courtier. The Zombuul has no
  // first-night attack; every other target step is skipped.
  await playNight(
    page,
    { devilsadvocate: { targets: ["1"] }, courtier: { skip: true } },
    { skipUnplanned: true },
  );

  // Day 1: the protected Courtier is executed and survives.
  await playDay(page, { execute: "1" });
  shot = await snapshot(page);
  assert.equal(
    playerOf(shot, "1").alive,
    true,
    "Devil's Advocate: the chosen player survives the execution on the following day",
  );
  await playDay(page, {});

  // Night 2: the protection is not renewed for the same player ("different to
  // last night"), and the Zombuul attack is skipped so day 2 is clean.
  await playNight(
    page,
    { devilsadvocate: { targets: ["2"] }, courtier: { skip: true } },
    { skipUnplanned: true },
  );

  // Day 2: the same player is executed without protection and dies.
  await playDay(page, { execute: "1" });
  shot = await snapshot(page);
  assert.equal(
    playerOf(shot, "1").alive,
    false,
    "Devil's Advocate: the protection covers only the day after it is chosen",
  );

  // ---------------------------------------------------------------------
  // Game 3: the Fool's once-only survival is not spent by another protection.
  // ---------------------------------------------------------------------
  await seedGame(page, {
    edition: "bmr",
    assignment: {
      1: "gambler",
      2: "innkeeper",
      3: "courtier",
      4: "fool",
      5: "tealady",
      6: "professor",
      7: "pacifist",
      8: "chambermaid",
      9: "grandmother",
      10: "goon",
      11: "moonchild",
      12: "mastermind",
      13: "devilsadvocate",
      14: "assassin",
      15: "zombuul",
    },
    bluffs: ["sailor", "minstrel", "exorcist"],
  });
  // The Tea Lady sits at 5, so her neighbours are the Fool at 4 and the
  // Professor at 6 — both good, which makes her protection active.

  // Night 1: no attack and no other ability touches the Fool.
  await playNight(page, { courtier: { skip: true } }, { skipUnplanned: true });

  // Day 1: the Tea Lady's protection survives the Fool's lynching and the
  // Fool's own once-per-game ability is untouched.
  await playDay(page, { execute: "4" });
  shot = await snapshot(page);
  seen = await flagsOf(page, ["4"]);
  assert.deepEqual(
    {
      alive: playerOf(shot, "4").alive,
      foolSpent: seen.used["4"].fool === true,
      teaLadyAlive: playerOf(shot, "5").alive,
    },
    { alive: true, foolSpent: false, teaLadyAlive: true },
    "Fool: a death prevented by the Tea Lady does not spend the once-per-game survival",
  );
  await playDay(page, {});

  // Night 2: the Zombuul removes the Tea Lady so the Fool is unprotected next.
  await playNight(
    page,
    {
      zombuul: { targets: ["5"], click: ['[data-bmr-death][data-id="5"]'] },
      courtier: { skip: true },
    },
    { skipUnplanned: true },
  );

  // Day 2: no execution.
  await playDay(page, {});

  // Night 3: the Innkeeper protects the Fool from the Zombuul's kill, which
  // must not spend the Fool's own survival either.
  await playNight(
    page,
    {
      innkeeper: {
        targets: ["4", "7"],
        selects: [{ selector: "[data-bmr-drunk]", value: "7" }],
      },
      zombuul: { targets: ["4"], click: ['[data-bmr-death][data-id="4"]'] },
      courtier: { skip: true },
    },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  seen = await flagsOf(page, ["4"]);
  const attack = (await nightQueue(page)).find((step) => step.roleId === "zombuul");
  const innkeeperGuard = shot.effects.some(
    (effect) =>
      effect.kind === "protected" && effect.bmr === "innkeeper" && String(effect.targetId) === "4",
  );
  assert.deepEqual(
    {
      alive: playerOf(shot, "4").alive,
      foolSpent: seen.used["4"].fool === true,
      teaLadyAlive: playerOf(shot, "5").alive,
      attack: attack ? { done: attack.done, targets: attack.targets } : null,
      innkeeperGuard,
    },
    {
      alive: true,
      foolSpent: false,
      teaLadyAlive: false,
      attack: { done: true, targets: ["4"] },
      innkeeperGuard: true,
    },
    "Fool: a death prevented by the Innkeeper does not spend the once-per-game survival",
  );

  // Day 3: the first death the Fool suffers itself is prevented.
  await playDay(page, { execute: "4" });
  shot = await snapshot(page);
  assert.equal(
    playerOf(shot, "4").alive,
    true,
    "Fool: the first time the Fool would die, the once-per-game survival saves it",
  );
  await playDay(page, {});

  // Night 4: nothing wakes. The Courtier's role choice is skipped explicitly.
  await playNight(page, { courtier: { skip: true } }, { skipUnplanned: true });

  // Day 4: the survival is spent, so the second death kills.
  await playDay(page, { execute: "4" });
  shot = await snapshot(page);
  assert.equal(
    playerOf(shot, "4").alive,
    false,
    "Fool: the once-per-game survival is spent, so the next execution kills",
  );

  return `sailor survived, Zombuul faked death, Mastermind granted day ${dayOfDemonDeath + 1}, Devil's Advocate covered one day, Fool survived once`;
});
