// Setup: the bag screen keeps a legal bag at every count, the stepper moves
// exactly one player per activation (including right after a script switch),
// and the Random bag and Deal control agree with the engine's composition.
// The Secrets screen offers the Librarian's zero only while every Outsider can
// register as something else, lets a registering Spy unlock a not-in-play
// first-night answer, and lists the BMR and S&V host reminders. The saved-bag
// library round-trips through export/import, and a stale bag is refused
// without closing the library or touching the game.
import { readFile } from "node:fs/promises";
import { runScenario, seedGame, gotoRoute, settle, assert } from "../scenario-kit.mjs";

const LIBRARY_KEY = "pg.library.v1";

async function setupState(page) {
  return page.evaluate(async () => {
    const { store, rules } = await window.PG_MODULES();
    const state = store.state;
    return {
      count: state.setup.count,
      roles: state.setup.roles.slice(),
      bluffs: state.setup.bluffs.slice(),
      scriptId: state.script?.id ?? null,
      outsiderBase: rules.compositionFor(state.setup.count, []).outsider,
      composition: rules.compositionFor(
        state.setup.count,
        state.setup.roles,
        state.setup.godfatherOutsider === -1 ? -1 : 1,
      ),
      bagErrors: rules.bagErrors({
        count: state.setup.count,
        roles: state.setup.roles,
        bluffs: state.setup.bluffs,
        drunkShownId: state.setup.drunkShownId,
        lunaticShownId: state.setup.lunaticShownId,
        pool: state.script.roles,
        godfatherOutsider: state.setup.godfatherOutsider === -1 ? -1 : 1,
      }),
      lunaticShownTeam: state.setup.lunaticShownId
        ? rules.roleTeam(state.setup.lunaticShownId)
        : null,
    };
  });
}

/** Read-only view of the published game state; never mutates after seeding. */
async function gameState(page) {
  return page.evaluate(async () => {
    const { store, engine } = await window.PG_MODULES();
    const state = store.state;
    return {
      phase: state.phase,
      scriptId: state.scriptId,
      count: state.setup.count,
      roles: state.setup.roles.slice(),
      bluffs: state.setup.bluffs.slice(),
      info: JSON.parse(JSON.stringify(state.setup.info)),
      players: Object.values(state.players).map((player) => ({
        id: player.id,
        roleId: player.roleId,
        seat: player.seat,
      })),
      secretsErrors: engine.secretsErrors(state).map((error) => error.code),
      night: state.night.number,
      day: state.day.number,
    };
  });
}

/** The reminder rows the rules table promises, in bag order. */
async function reminderTable(page) {
  return page.evaluate(async () => {
    const { store, rules } = await window.PG_MODULES();
    const state = store.state;
    const seen = new Set();
    const rows = [];
    for (const roleId of state.setup.roles) {
      if (seen.has(roleId)) continue;
      seen.add(roleId);
      const tokens = rules.ROLE_REMINDERS_RU[roleId] ?? [];
      if (tokens.length) rows.push(tokens.join(" · "));
    }
    return rows;
  });
}

/** The rendered checklist token lists, in row order. */
async function renderedReminders(page) {
  return page
    .locator("[data-reminders] > li")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.querySelector("span")?.textContent?.trim() ?? ""),
    );
}

async function librarySnapshot(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, LIBRARY_KEY);
}

async function openLibrary(page) {
  await page.locator('[data-act="library"]').click();
  await settle(page, 150);
}

/** Claims every seat through the player handoff, then returns to Secrets. */
async function claimSeats(page, count) {
  await gotoRoute(page, "player");
  await settle(page, 200);
  for (let index = 0; index < count; index += 1) {
    await page.locator(`[data-seat="${index}"]`).click();
    await page.waitForSelector("#player-name");
    await page.locator("#player-name").fill("Player " + (index + 1));
    await page.locator('form.player-nameform button[type="submit"]').click();
    await settle(page, 150);
  }
  await gotoRoute(page, "secrets");
  await settle(page, 200);
}

await runScenario("setup-legal-bags", async ({ page }) => {
  // Any confirmation (count change, re-deal, bag load) is a host acting on the
  // setup screens. Accepting it keeps the real control in the path.
  page.on("dialog", (dialog) => void dialog.accept());

  await gotoRoute(page, "bag");
  await settle(page, 200);

  // Two fast clicks after the first paint move the count by exactly two.
  let before = await setupState(page);
  await page.locator('[data-count="1"]').click();
  await page.locator('[data-count="1"]').click();
  await settle(page, 150);
  let after = await setupState(page);
  assert.equal(after.count, before.count + 2, "rule: each activation moves one player");

  // A single click moves exactly one.
  before = after;
  await page.locator('[data-count="1"]').click();
  await settle(page, 150);
  after = await setupState(page);
  assert.equal(after.count, before.count + 1, "rule: one activation moves one player");

  // The Random bag lives in its own tab: it produces a legal bag at the current count.
  await page.locator('[data-tab="random"]').click();
  await settle(page, 120);
  await page.locator('[data-act="random"]').click();
  await settle(page, 150);
  after = await setupState(page);
  assert.deepEqual(after.bagErrors, [], "rule: the random bag is legal");
  assert.equal(after.roles.length, after.count, "rule: the random bag fills every seat");
  assert.equal(
    await page.locator('[data-act="deal"]').isEnabled(),
    true,
    "rule: a legal bag deals",
  );

  // Walk every count: the composition stays legal and Deal stays available.
  for (const count of [5, 7, 10, 12, 15]) {
    const current = (await setupState(page)).count;
    const delta = count - current;
    const control = delta > 0 ? '[data-count="1"]' : '[data-count="-1"]';
    for (let step = 0; step < Math.abs(delta); step += 1) await page.locator(control).click();
    await settle(page, 120);
    await page.locator('[data-act="random"]').click();
    await settle(page, 120);
    const state = await setupState(page);
    assert.equal(state.count, count, `rule: the count is ${count}`);
    assert.equal(state.roles.length, count, `rule: the random bag has ${count} roles`);
    assert.deepEqual(state.bagErrors, [], `rule: the ${count}-player bag is legal`);
    assert.equal(
      await page.locator('[data-act="deal"]').isEnabled(),
      true,
      `rule: a ${count}-player bag deals`,
    );
  }

  // An illegal bag is refused by the Deal control and the status names the
  // missing slot with the model's own numbers, never a raw placeholder.
  await page.locator('[data-tab="manual"]').click();
  await settle(page, 120);
  const full = await setupState(page);
  const dropped = full.roles[0];
  await page.locator(`[data-team-group] [data-role="${dropped}"]`).first().click();
  await settle(page, 150);
  const short = await setupState(page);
  const dealSection = page.locator('[aria-labelledby="bag-deal"]');
  assert.equal(short.roles.length, full.count - 1, "rule: the manual tab removes one role");
  assert.equal(
    await page.locator('[data-act="deal"]').isEnabled(),
    false,
    "rule: Deal is disabled while the bag is illegal",
  );
  const shortStatus = await dealSection.locator('[role="status"]').innerText();
  assert.ok(
    shortStatus.includes(String(short.roles.length)) &&
      shortStatus.includes(String(short.count)) &&
      !/\{\w+\}/.test(shortStatus),
    `rule: the illegal bag explains the size mismatch with its numbers (got ${JSON.stringify(shortStatus)})`,
  );
  await page.locator('[data-act="undo"]').first().click();
  await settle(page, 150);
  const restored = await setupState(page);
  assert.deepEqual(restored.bagErrors, [], "rule: undo restores a dealable bag");
  assert.equal(
    await page.locator('[data-act="deal"]').first().isEnabled(),
    true,
    "rule: a restored bag deals again",
  );

  // Script switch: the official picker replaces the pool and deals a legal bag
  // of the new script at the count the host already chose.
  const countBefore = restored.count;
  await page.locator('[data-act="script"]').click();
  await settle(page, 150);
  await page.locator('input[name="script-pick"][value="bmr"]').check();
  await page.locator('[data-act="apply-script"]').click();
  await settle(page, 250);
  const bmr = await setupState(page);
  assert.equal(bmr.scriptId, "bmr", "rule: the script picker applies the chosen script");
  assert.equal(bmr.count, countBefore, "rule: a script switch keeps the player count");
  assert.deepEqual(bmr.bagErrors, [], "rule: a script switch produces a legal bag");

  // Modifiers: the Godfather preset applies its +1 Outsider bag, the screen
  // exposes the direction it was built with, and the Lunatic preset carries a
  // shown Demon. The composition counters must agree with the bag.
  await page.locator('[data-tab="recommended"]').click();
  await settle(page, 120);
  const godfatherCard = page.locator('article.bag-preset-card:has([data-apply="preset-2"])');
  const godfatherRoles = ((await godfatherCard.getAttribute("data-roles")) || "").split(" ");
  await page.locator('[data-apply="preset-2"]').click();
  await settle(page, 200);
  const modified = await setupState(page);
  assert.deepEqual(
    modified.roles,
    godfatherRoles,
    "rule: Apply deals the preset roster the card shows",
  );
  assert.equal(
    modified.roles.includes("godfather"),
    true,
    "rule: the Godfather preset puts the Godfather in the bag",
  );
  assert.equal(
    await page.locator('[data-godfather="1"]').count(),
    1,
    "rule: the bag screen offers the Godfather direction control",
  );
  assert.equal(
    modified.composition.outsider,
    modified.outsiderBase + 1,
    "rule: the Godfather composition adds one Outsider to the base count",
  );
  assert.deepEqual(
    modified.bagErrors,
    [],
    "rule: the Godfather preset is legal at its own composition",
  );
  assert.equal(
    modified.lunaticShownTeam,
    "demon",
    "rule: the Lunatic preset carries a shown Demon",
  );

  await page.locator('[data-act="deal"]').first().click();
  await settle(page, 250);
  await gotoRoute(page, "secrets");
  await settle(page, 250);
  const bmrReminders = await reminderTable(page);
  const bmrRendered = await renderedReminders(page);
  assert.ok(bmrReminders.length > 0, "rule: a Bad Moon Rising game has host reminder rows");
  assert.deepEqual(
    bmrRendered,
    bmrReminders,
    "rule: the BMR Secrets screen lists every reminder token for the roles in play",
  );
  assert.equal(
    await page.locator('[data-act="bmr-start"]').count(),
    1,
    "rule: BMR shows the host Secrets screen with its first-night control",
  );

  // Sects & Violets takes the same checklist through the same picker.
  await gotoRoute(page, "bag");
  await settle(page, 200);
  await page.locator('[data-act="script"]').click();
  await settle(page, 150);
  await page.locator('input[name="script-pick"][value="snv"]').check();
  await page.locator('[data-act="apply-script"]').click();
  await settle(page, 250);
  const snv = await setupState(page);
  assert.equal(snv.scriptId, "snv", "rule: the picker switches to Sects & Violets");
  await page.locator('[data-tab="recommended"]').click();
  await settle(page, 120);
  const fangGuCard = page.locator('article.bag-preset-card:has([data-apply="preset-1"])');
  const fangGuRoles = ((await fangGuCard.getAttribute("data-roles")) || "").split(" ");
  await page.locator('[data-apply="preset-1"]').click();
  await settle(page, 200);
  const shifted = await setupState(page);
  assert.equal(
    shifted.roles.includes("fanggu"),
    true,
    "rule: the Fang Gu preset puts the Fang Gu in the bag",
  );
  assert.deepEqual(shifted.roles, fangGuRoles, "rule: Apply deals the S&V preset roster");
  assert.equal(
    shifted.composition.outsider,
    shifted.outsiderBase + 1,
    "rule: the Fang Gu composition adds one Outsider to the base count",
  );
  assert.deepEqual(
    shifted.bagErrors,
    [],
    "rule: the Fang Gu preset is legal at its own composition",
  );
  await page.locator('[data-act="deal"]').first().click();
  await settle(page, 250);
  await gotoRoute(page, "secrets");
  await settle(page, 250);
  const snvReminders = await reminderTable(page);
  const snvRendered = await renderedReminders(page);
  assert.ok(snvReminders.length > 0, "rule: a Sects & Violets game has host reminder rows");
  assert.deepEqual(
    snvRendered,
    snvReminders,
    "rule: the S&V Secrets screen lists every reminder token for the roles in play",
  );
  assert.equal(
    await page.locator('[data-act="sv-start"]').count(),
    1,
    "rule: S&V shows the host Secrets screen with its first-night control",
  );

  // Saved-bag library round trip: save the current deal's bag, export it,
  // import the exported file back, and load it — the same bag must deal again.
  await gotoRoute(page, "bag");
  await settle(page, 200);
  const dealt = await gameState(page);
  await openLibrary(page);
  await page.locator("[data-library-name]").fill("Round trip");
  await page.locator('[data-act="save-bag"]').first().click();
  await settle(page, 200);
  const saved = await librarySnapshot(page);
  assert.ok(saved && saved.bags.length === 1, "rule: the save control stores the current bag");
  assert.deepEqual(saved.bags[0].roles, dealt.roles, "rule: a saved bag holds the dealt roles");
  assert.deepEqual(saved.bags[0].bluffs, dealt.bluffs, "rule: a saved bag holds the dealt bluffs");

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 10000 }),
    page.locator('[data-act="export-library"]').click(),
  ]);
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(
    exported.format,
    "pocket-grimoire-library",
    "rule: Export writes the library file format",
  );
  assert.deepEqual(
    exported.bags.map((bag) => ({ roles: bag.roles, bluffs: bag.bluffs })),
    saved.bags.map((bag) => ({ roles: bag.roles, bluffs: bag.bluffs })),
    "rule: Export carries every saved bag and bluff unchanged",
  );

  await page.locator("[data-library-file]").setInputFiles({
    name: "grimoria-library.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await settle(page, 250);
  const reimported = await librarySnapshot(page);
  assert.deepEqual(
    reimported.bags.map((bag) => ({ roles: bag.roles, bluffs: bag.bluffs })),
    exported.bags.map((bag) => ({ roles: bag.roles, bluffs: bag.bluffs })),
    "rule: Import restores the exported bags exactly",
  );

  await page.locator("[data-load-bag]").first().click();
  await settle(page, 250);
  const loaded = await setupState(page);
  assert.deepEqual(loaded.roles, exported.bags[0].roles, "rule: Load applies the saved roles");
  assert.deepEqual(loaded.bluffs, exported.bags[0].bluffs, "rule: Load applies the saved bluffs");
  await page.locator('[data-act="deal"]').first().click();
  await settle(page, 250);
  const redealt = await gameState(page);
  assert.deepEqual(
    redealt.players.map((player) => player.roleId).sort(),
    exported.bags[0].roles.slice().sort(),
    "rule: a bag that survived export/import deals the same characters",
  );
  assert.deepEqual(
    redealt.bluffs,
    exported.bags[0].bluffs,
    "rule: a bag that survived export/import deals the same bluffs",
  );

  // A stale saved bag that names roles outside the current script is refused
  // by the engine: the library stays open, a reason is shown in the dialog,
  // and the game is untouched.
  const staleLibrary = {
    format: "pocket-grimoire-library",
    version: 1,
    pools: [],
    bags: [
      {
        id: "bag-stale",
        name: "Stale Trouble Brewing bag",
        scriptId: "custom",
        pool: [],
        roles: ["chef", "empath", "soldier", "monk", "imp"],
        bluffs: [],
        drunkShownId: null,
        lunaticShownId: null,
        godfatherOutsider: 1,
        evilTwinGoodId: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
  const beforeRejectedLoad = await gameState(page);
  await gotoRoute(page, "bag");
  await settle(page, 200);
  await openLibrary(page);
  await page.locator("[data-library-file]").setInputFiles({
    name: "stale-library.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(staleLibrary)),
  });
  await settle(page, 250);
  await page.locator('[data-load-bag="bag-stale"]').click();
  await settle(page, 250);
  const libraryOpen = await page.locator("[data-library-name]").isVisible();
  const reason = await page
    .locator('[role="dialog"]:has([data-act="close-library"]) [role="alert"]')
    .innerText()
    .catch(() => "");
  const afterRejectedLoad = await gameState(page);
  assert.equal(libraryOpen, true, "rule: a rejected Load keeps the saved-bag library open");
  assert.deepEqual(
    afterRejectedLoad.roles,
    beforeRejectedLoad.roles,
    "rule: a rejected Load leaves the current bag untouched",
  );
  assert.ok(reason.trim().length > 0, "rule: a rejected Load shows its reason");
  assert.ok(
    !reason.trim().startsWith("error."),
    `rule: a rejected Load shows catalog text, not a raw key (got ${JSON.stringify(reason)})`,
  );
  // The completeness check runs last: a defect in the reason text must not
  // hide the rest of this scenario's coverage. It is reported, never dropped.

  // The Librarian's zero is true information while the only Outsider is a
  // Recluse, who may register as a Minion; the screen must offer it.
  const librarianBag = {
    1: "librarian",
    2: "chef",
    3: "empath",
    4: "soldier",
    5: "ravenkeeper",
    6: "recluse",
    7: "poisoner",
    8: "imp",
  };
  await seedGame(page, {
    edition: "tb",
    assignment: librarianBag,
    bluffs: ["washerwoman", "fortuneteller", "undertaker"],
    start: "seat",
  });
  await gotoRoute(page, "secrets");
  await settle(page, 250);
  assert.equal(
    await page.locator('[data-info-zero="librarian"]').count(),
    1,
    "rule: the Librarian may answer zero while every Outsider can register as a Minion",
  );
  await page.locator('[data-info-zero="librarian"]').check();
  await settle(page, 200);
  const zeroed = await gameState(page);
  assert.equal(zeroed.info.librarian.zero, true, "rule: the zero answer is stored");
  assert.deepEqual(zeroed.secretsErrors, [], "rule: the zero answer passes the Secrets checks");
  await claimSeats(page, 8);
  assert.equal(
    await page.locator('[data-act="start"]').isEnabled(),
    true,
    "rule: the zero-answer setup offers the first-night control",
  );
  await page.locator('[data-act="start"]').click();
  await settle(page, 250);
  const started = await gameState(page);
  assert.equal(started.phase, "night", "rule: a zero-answer setup starts the first night");
  assert.equal(started.night, 1, "rule: the first night is night one");

  // The zero is illegal with a fixed Outsider in play, so the screen hides it.
  await seedGame(page, {
    edition: "tb",
    assignment: {
      1: "librarian",
      2: "chef",
      3: "empath",
      4: "soldier",
      5: "ravenkeeper",
      6: "recluse",
      7: "saint",
      8: "poisoner",
      9: "imp",
    },
    bluffs: ["washerwoman", "fortuneteller", "undertaker"],
    start: "seat",
  });
  await gotoRoute(page, "secrets");
  await settle(page, 250);
  assert.equal(
    await page.locator('[data-info-zero="librarian"]').count(),
    0,
    "rule: the Librarian's zero is refused while an Outsider other than the Recluse is in play",
  );

  // A Spy may register as a not-in-play Townsfolk, so the Washerwoman can be
  // told a character that is not in the bag.
  await seedGame(page, {
    edition: "tb",
    assignment: {
      1: "washerwoman",
      2: "chef",
      3: "empath",
      4: "soldier",
      5: "ravenkeeper",
      6: "butler",
      7: "spy",
      8: "imp",
    },
    bluffs: ["monk", "undertaker", "fortuneteller"],
    start: "seat",
  });
  await gotoRoute(page, "secrets");
  await settle(page, 250);
  const options = await page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    const state = store.state;
    const held = Object.values(state.players).map((player) => player.roleId);
    const values = [...document.querySelectorAll('[data-info-role="washerwoman"] option')]
      .map((node) => node.value)
      .filter(Boolean);
    const spy = Object.values(state.players).find((player) => player.roleId === "spy");
    const other = Object.values(state.players).find((player) => player.id !== (spy && spy.id));
    return {
      choosable: values.filter((value) => !held.includes(value)),
      spyId: spy ? spy.id : null,
      otherId: other ? other.id : null,
    };
  });
  assert.ok(
    options.choosable.length > 0,
    "rule: a Spy unlocks not-in-play Townsfolk answers for the Washerwoman",
  );
  const named = options.choosable[0];
  await page.selectOption('[data-info-role="washerwoman"]', named);
  await settle(page, 120);
  await page.selectOption('[data-player="pair-a-washerwoman"]', options.spyId);
  await settle(page, 120);
  await page.selectOption('[data-player="pair-b-washerwoman"]', options.otherId);
  await settle(page, 200);
  const paired = await gameState(page);
  assert.equal(paired.info.washerwoman.roleId, named, "rule: the pair names the chosen character");
  assert.deepEqual(
    paired.secretsErrors,
    [],
    "rule: a Spy registration makes a not-in-play first-night pair legal",
  );
  await claimSeats(page, 8);
  await page.locator('[data-act="start"]').click();
  await settle(page, 250);
  const spyNight = await gameState(page);
  assert.equal(
    spyNight.phase,
    "night",
    "rule: the engine accepts the Spy-registered pair for the first night",
  );
  assert.equal(spyNight.info.washerwoman.roleId, named, "rule: the pair survives into the night");

  // Deferred from the stale-bag section so the earlier coverage still runs:
  // the rejected Load renders the catalog template with its `{role}`
  // placeholder unfilled, because `rejectionText` passes no interpolation
  // values and the library prints that text verbatim.
  assert.ok(
    !/\{\w+\}/.test(reason),
    `rule: a rejected Load fills every placeholder in its reason (got ${JSON.stringify(reason)})`,
  );

  return "stepper, every count 5-15, illegal-bag explanation, script switch, BMR/S&V reminders, library round trip and stale-bag refusal, Librarian zero and Spy-registered pair";
});
