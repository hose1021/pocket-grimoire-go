// Sects & Violets, 15 players (9 Townsfolk / 2 Outsiders / 3 Minions / 1 Demon,
// no setup modifier): the character-swap roles, the death-triggered wakes and
// the two rules that end the game from a choice. Four legal games run one after
// the other in one console session; every night step, host decision and
// execution goes through the table controls.
import {
  runScenario,
  seedGame,
  playNight,
  playDay,
  snapshot,
  currentStep,
  expectWinner,
  settle,
  assert,
} from "../scenario-kit.mjs";

// Nine Townsfolk, three Minions and the No Dashii stay seated in every game; the
// two Outsider seats and what happens to them differ per game.
// Seat order is part of the fixture: the No Dashii poisons the nearest Townsfolk
// on each side of seat 15, and the Snake Charmer swap moves the Demon to seat 3,
// whose neighbours are seats 2 and 4. Those four seats are number or yes/no
// information roles, so a poisoned answer is a host choice in a select instead
// of a free-text note that would stall the night.
const TOWNSFOLK = {
  1: "clockmaker",
  2: "oracle",
  3: "snakecharmer",
  4: "seamstress",
  5: "dreamer",
  6: "mathematician",
  7: "sage",
  8: "flowergirl",
  9: "towncrier",
};
const MINIONS = { 12: "witch", 13: "cerenovus", 14: "pithag" };
const BLUFFS = ["artist", "savant", "juggler"];

function deal(outsiders, { minions = MINIONS, ...extras } = {}) {
  return {
    edition: "snv",
    assignment: { ...TOWNSFOLK, ...outsiders, ...minions, 15: "nodashii" },
    bluffs: BLUFFS,
    ...extras,
  };
}

/** The fields `snapshot()` does not project: effect flags, queue steps, death triggers. */
async function inspect(page) {
  return page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    const state = store.state;
    return {
      queue: state.night.queue.map((step) => ({
        roleId: step.roleId,
        done: step.done || step.skipped,
        noteKey: step.noteKey || null,
      })),
      effects: state.effects.map((effect) => ({
        kind: effect.kind,
        sourceId: effect.sourceId,
        targetId: effect.targetId,
        active: effect.active !== false,
        permanent: effect.permanent === true,
        nodashii: effect.nodashii === true,
      })),
      deaths: state.deaths.map((death) => ({
        playerId: death.playerId,
        demon: death.demon === true,
      })),
      twin: {
        evil: state.setup.evilTwinPlayerId,
        good: state.setup.evilTwinGoodPlayerId,
      },
    };
  });
}

function player(shot, id) {
  const found = shot.players.find((candidate) => candidate.id === String(id));
  assert.ok(found, `player ${id} missing from the table`);
  return found;
}

/**
 * The shared loop needs a next step or the end-night control after every step,
 * and the over card has neither. The Klutz's lost game ends inside the night, so
 * this night is played with its own loop that stops when the win lands.
 */
async function playNightUntilOver(page, plan) {
  for (let guard = 0; guard < 80; guard += 1) {
    const step = await currentStep(page);
    if (!step) {
      const end = page.locator('[data-act="end-night"]');
      if (await end.count()) await end.click();
      await settle(page);
      return;
    }
    const spec = plan[step.roleId] || plan[step.key] || { skip: true };
    if (spec.skip) {
      await page.locator('[data-act="skip"]').click();
      await settle(page);
      continue;
    }
    for (const id of spec.targets || []) {
      await page.locator(`[data-target][data-id="${id}"]:not(:disabled)`).click();
    }
    await page.locator('[data-act="complete"]').click();
    await page.waitForSelector('[data-act="step-confirm"]');
    for (const selector of spec.click || []) {
      const control = page.locator(selector).first();
      if (await control.count()) await control.click();
    }
    await page.locator('[data-act="step-confirm"]').click();
    await settle(page);
  }
  throw new Error("night did not finish");
}

/** Skips every wake that precedes the step under test. */
async function skipUntil(page, roleId) {
  for (let guard = 0; guard < 40; guard += 1) {
    const step = await currentStep(page);
    if (!step || step.roleId === roleId) return;
    await page.locator('[data-act="skip"]').click();
    await settle(page);
  }
  throw new Error(`never reached the ${roleId} step`);
}

/** Opens one step's sheet with its targets picked, the way the dock does. */
async function openStep(page, targets) {
  for (const id of targets) {
    await page.locator(`[data-target][data-id="${id}"]:not(:disabled)`).click();
  }
  await page.locator('[data-act="complete"]').click();
  await page.waitForSelector('[data-act="step-confirm"]');
}

await runScenario("sv-15-roles", async ({ page }) => {
  const rules = [];

  // --------------------------------------------------------------- game 1 --
  // No Dashii poison, the Snake Charmer swap, the executed Barber's swap, the
  // Sage killed by the Demon, the Sweetheart's drunk and the Demon's execution
  // on day 3.
  await seedGame(page, deal({ 10: "sweetheart", 11: "barber" }));
  let shot = await snapshot(page);
  let deep = await inspect(page);
  let poisoned = deep.effects
    .filter((effect) => effect.kind === "poison" && effect.nodashii && effect.active)
    .map((effect) => effect.targetId)
    .sort();
  assert.deepEqual(
    poisoned,
    ["1", "9"],
    "No Dashii rule: the nearest Townsfolk on each side of seat 15 (seats 1 and 9) are poisoned",
  );
  rules.push("No Dashii poison");

  // Night 2: the Snake Charmer picks the Demon, the new Demon kills the Sage,
  // the executed Barber swaps two characters.
  await playNight(page, {}, { skipUnplanned: true });
  assert.equal((await snapshot(page)).phase, "day", "night 1 ends into day 1");
  await playDay(page, { execute: "11" });
  shot = await snapshot(page);
  assert.equal(player(shot, "11").alive, false, "day 1 executes the Barber");
  await playDay(page, {});

  await playNight(
    page,
    {
      snakecharmer: { targets: ["15"] },
      nodashii: { targets: ["7"], click: ['[data-bmr-death][data-id="7"]'] },
      barber: { targets: ["6", "12"] },
    },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  deep = await inspect(page);

  assert.equal(
    player(shot, "3").roleId,
    "nodashii",
    "Snake Charmer rule: the chosen Demon's character moves to the Snake Charmer",
  );
  assert.equal(
    player(shot, "15").roleId,
    "snakecharmer",
    "Snake Charmer rule: the Demon takes the Snake Charmer's character",
  );
  assert.equal(
    player(shot, "3").team,
    "evil",
    "Snake Charmer rule: the alignments swap with the characters (r2905)",
  );
  assert.equal(player(shot, "15").team, "good", "Snake Charmer rule: the old Demon is now good");
  rules.push("Snake Charmer swap");

  const snakePoison = deep.effects.find(
    (effect) =>
      effect.kind === "poison" &&
      effect.permanent &&
      effect.active &&
      effect.sourceId === "3" &&
      effect.targetId === "15",
  );
  assert.ok(
    snakePoison,
    "Snake Charmer rule: the Demon is poisoned for the rest of the game, even after the swap",
  );
  rules.push("Snake Charmer poison");

  const sageDeath = deep.deaths.find((death) => death.playerId === "7");
  assert.equal(sageDeath?.demon, true, "Sage rule: the Sage is killed by the Demon");
  const sageStep = deep.queue.find((step) => step.roleId === "sage");
  assert.ok(sageStep?.done, "Sage rule: the death-triggered wake runs in the same night");
  rules.push("Sage wake");

  assert.deepEqual(
    [player(shot, "6").roleId, player(shot, "12").roleId],
    ["witch", "mathematician"],
    "Barber rule: the two chosen players swap characters",
  );
  assert.deepEqual(
    [player(shot, "6").team, player(shot, "12").team],
    ["good", "evil"],
    "Barber rule: a swapped character does not move the alignment with it",
  );
  rules.push("Barber swap");

  // Night 3: the Demon kills the Sweetheart, who makes one player drunk.
  await playDay(page, {});
  await playNight(
    page,
    {
      nodashii: { targets: ["10"], click: ['[data-bmr-death][data-id="10"]'] },
      sweetheart: { targets: ["2"] },
    },
    { skipUnplanned: true },
  );
  deep = await inspect(page);
  const drunk = deep.effects.find(
    (effect) => effect.kind === "drunk" && effect.active && effect.targetId === "2",
  );
  assert.ok(
    drunk && drunk.sourceId === "10",
    "Sweetheart rule: the chosen player is drunk from the moment the Sweetheart dies",
  );
  rules.push("Sweetheart drunk");

  // Day 3: the new Demon is executed and nobody inherits it.
  await playDay(page, { execute: "3" });
  shot = await snapshot(page);
  expectWinner(shot, "good", "demon-dead");
  rules.push("demon execution");

  // --------------------------------------------------------------- game 2 --
  // Klutz: the public choice of an evil player loses the game immediately, in
  // the middle of the night.
  await seedGame(page, deal({ 10: "klutz", 11: "barber" }));
  await playNight(page, {}, { skipUnplanned: true });
  await playDay(page, {});
  await playNightUntilOver(page, {
    nodashii: { targets: ["10"], click: ['[data-bmr-death][data-id="10"]'] },
    klutz: { targets: ["12"] },
  });
  shot = await snapshot(page);
  assert.equal(player(shot, "10").alive, false, "Klutz rule: the Demon killed the Klutz");
  assert.equal(
    player(shot, "12").roleId,
    "witch",
    "Klutz rule: the chosen player (seat 12) is the evil Witch",
  );
  expectWinner(shot, "evil", "klutz");
  assert.equal(shot.phase, "over", "Klutz rule: an evil choice loses the game at once");
  rules.push("Klutz loss");

  // --------------------------------------------------------------- game 3 --
  // Evil Twin: the pair is the evil Minion and the good Clockmaker, and
  // executing the good twin wins the game for evil on the spot.
  await seedGame(
    page,
    deal(
      { 10: "klutz", 11: "barber" },
      {
        minions: { 12: "eviltwin", 13: "witch", 14: "cerenovus" },
        twin: "clockmaker",
      },
    ),
  );
  deep = await inspect(page);
  assert.equal(
    deep.twin.evil,
    "12",
    "Evil Twin rule: the minion seat (12) holds the Evil Twin character",
  );
  assert.equal(
    deep.twin.good,
    "1",
    "Evil Twin rule: the pair's good player is the Clockmaker at seat 1",
  );
  rules.push("Evil Twin pair");

  await playNight(page, {}, { skipUnplanned: true });
  await playDay(page, { execute: "1" });
  shot = await snapshot(page);
  assert.equal(player(shot, "1").alive, false, "Evil Twin rule: the good twin was executed");
  expectWinner(shot, "evil", "evil-twin");
  rules.push("Evil Twin execution win");

  // --------------------------------------------------------------- game 4 --
  // Pit-Hag: a character that is not in play replaces the target's character,
  // and the alignment is untouched.
  await seedGame(page, deal({ 10: "klutz", 11: "barber" }));
  await playNight(page, {}, { skipUnplanned: true });
  await playDay(page, {});
  await playNight(
    page,
    {
      pithag: { targets: ["2"], selects: [{ selector: "[data-bmr-role]", value: "artist" }] },
    },
    { skipUnplanned: true },
  );
  shot = await snapshot(page);
  deep = await inspect(page);
  assert.equal(
    player(shot, "2").roleId,
    "artist",
    "Pit-Hag rule: a character not in play replaces the target's character",
  );
  assert.equal(
    player(shot, "2").team,
    "good",
    "Pit-Hag rule: the character changes, the alignment does not (r2998)",
  );
  assert.equal(
    player(shot, "1").roleId,
    "clockmaker",
    "Pit-Hag rule: only the chosen player changes character",
  );
  rules.push("Pit-Hag change");

  // Night 3: the Pit-Hag may also name a character already in play; the rule is
  // that nothing happens (sv.ts completeSvStep, note.pithagInPlay). The chooser
  // must offer it: sv.ts makeStep fills roleChoices with script roles that have
  // no holder, so the no-op branch below it is unreachable from the console and
  // this assertion fails until the chooser offers in-play characters too.
  await playDay(page, {});
  await skipUntil(page, "pithag");
  await openStep(page, ["3"]);
  const offered = await page
    .locator("[data-bmr-role] option")
    .evaluateAll((nodes) => nodes.map((node) => node.value).filter(Boolean));
  assert.ok(
    offered.includes("clockmaker"),
    `Pit-Hag rule: a character already in play must be selectable so the legal no-op is recordable; the chooser offered only ${offered.join(", ")}`,
  );
  await page.locator("[data-bmr-role]").selectOption("clockmaker");
  await page.locator('[data-act="step-confirm"]').click();
  await settle(page);
  shot = await snapshot(page);
  deep = await inspect(page);
  assert.equal(
    player(shot, "3").roleId,
    "snakecharmer",
    "Pit-Hag rule: naming a character already in play changes nothing",
  );
  const inPlayStep = deep.queue.find((step) => step.roleId === "pithag");
  assert.equal(
    inPlayStep?.noteKey,
    "note.pithagInPlay",
    "Pit-Hag rule: the console records the nothing-happened outcome",
  );
  rules.push("Pit-Hag in-play no-op");

  await playNight(page, {}, { skipUnplanned: true });
  return `${rules.length} rules: ${rules.join(", ")}`;
});
