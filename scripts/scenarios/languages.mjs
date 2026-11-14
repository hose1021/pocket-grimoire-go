// Languages: every reading surface speaks the selected UI language. A Russian
// engine sentence, an untranslated note, rejection or win reason, or a raw key
// in EN or AZ is a defect (issue #171 AS1, AS15, AS16, AS19; issue #170).
import {
  runScenario,
  seedGame,
  playNight,
  playDay,
  gotoRoute,
  visibleText,
  currentStep,
  settle,
  snapshot,
  assert,
} from "../scenario-kit.mjs";

const CYRILLIC = /[\u0400-\u04FF]/;
const RAW_KEY = /\b(?:ui|note|error|winReason|guide|bag|step|sheet|player|role)\.[A-Za-z0-9_-]+/;

// BMR 8p: the Zombuul is the first role awake on night 2, so its own night
// note is on the current card. (The Lunatic cannot be seeded: dealGame demands
// setup.lunaticShownId, which the harness has no way to pass.)
const BMR_BAG = {
  1: "zombuul",
  2: "chambermaid",
  3: "fool",
  4: "gossip",
  5: "grandmother",
  6: "pacifist",
  7: "tinker",
  8: "assassin",
};
const BMR_BLUFFS = ["innkeeper", "professor", "courtier"];

// S&V 8p with the Pit-Hag as the only Minion: she wakes first on night 2.
// The Fang Gu adds an Outsider, so the bag is 4 townsfolk / 2 outsiders.
const PITHAG_BAG = {
  1: "pithag",
  2: "clockmaker",
  3: "dreamer",
  4: "oracle",
  5: "sage",
  6: "sweetheart",
  7: "barber",
  8: "fanggu",
};
const PITHAG_BLUFFS = ["seamstress", "savant", "artist"];

// S&V 5p: the Vortox ends a day without an execution.
const VORTOX_BAG = { 1: "clockmaker", 2: "dreamer", 3: "oracle", 4: "witch", 5: "vortox" };

const EXPECT = {
  en: {
    blocker: "Choose 1 target(s) first.",
    bmrNote: "No one died today, so the Zombuul may choose a player: they die.",
    winReason: "The Vortox was alive, no one was executed, and the information was false.",
    computed: /computed/i,
    inPlay: "is already in play: nothing happens.",
  },
  az: {
    blocker: "Əvvəlcə hədəf seçin: 1.",
    bmrNote: "Bu gün heç kim ölmədi, ona görə Zombuul oyunçu seçə bilər: o ölür.",
    winReason: "Vortoks sağ idi, edam olmadı və məlumat yalan idi.",
    computed: /hesablan/i,
    inPlay: "artıq oyundadır: heç nə baş vermir.",
  },
};

async function openLang(page, url, lang) {
  await page.evaluate((value) => localStorage.setItem("pg.lang", value), lang);
  await page.goto(url);
  await page.waitForSelector(".host");
  await settle(page);
}

/** One rule: the surface is written in the selected language, not in Russian. */
function noRussian(text, lang, surface) {
  const hit = text.match(CYRILLIC);
  assert.equal(
    hit,
    null,
    `${lang}: ${surface} shows a Russian sentence ("${hit && hit[0]}") -> ${JSON.stringify(text)}`,
  );
}

/** One rule: the surface resolves its translation instead of printing a key. */
function noRawKey(text, lang, surface) {
  const hit = text.match(RAW_KEY);
  assert.equal(
    hit,
    null,
    `${lang}: ${surface} shows the raw key "${hit && hit[0]}" -> ${JSON.stringify(text)}`,
  );
}

await runScenario("languages", async ({ page, url }) => {
  const leaks = [];
  for (const lang of ["en", "az"]) {
    const copy = EXPECT[lang];
    await openLang(page, url, lang);

    // --- BMR night 1: the console and the public page in the chosen language.
    await gotoRoute(page, "table");
    await seedGame(page, { edition: "bmr", assignment: BMR_BAG, bluffs: BMR_BLUFFS });
    await playNight(page, {}, { skipUnplanned: true });
    const day = await snapshot(page);
    assert.equal(day.phase, "day", `${lang}: night 1 ends on the day phase`);

    const dock = await page.locator("[data-table-dock]").innerText();
    noRussian(dock, lang, "the dock");
    noRawKey(dock, lang, "the dock");

    await gotoRoute(page, "public");
    const publicText = await visibleText(page);
    noRussian(publicText, lang, "the public page");
    noRawKey(publicText, lang, "the public page");

    // --- Player card: a dealt, unclaimed seat reveals its shown role. Seat 6
    // is the Pacifist in BMR_BAG; the picker indexes the seat order from 0.
    await gotoRoute(page, "player");
    await page.waitForSelector('[data-seat="5"]');
    await page.locator('[data-seat="5"]').click();
    await page.waitForSelector(".player-card");
    const card = await page.locator(".player-card").innerText();
    const [shownRole, shownAbility] = await page.evaluate(() => {
      const role = window.PG.roles.find((candidate) => candidate.id === "pacifist");
      return [role.name, role.ability];
    });
    assert.ok(
      card.includes(shownRole) && card.includes(shownAbility),
      `${lang}: the player card shows the shown role and its ability -> ${JSON.stringify(card)}`,
    );
    noRussian(card, lang, "the player card");
    noRawKey(card, lang, "the player card");

    // --- BMR night 2: a blocked action explains itself, and the Zombuul's
    // own night note is on the current card.
    await gotoRoute(page, "table");
    await playDay(page, {});
    const night = await snapshot(page);
    assert.equal(night.phase, "night", `${lang}: the day ends into night 2`);
    const bmrStep = await currentStep(page);
    assert.equal(bmrStep && bmrStep.roleId, "zombuul", `${lang}: the Zombuul wakes first`);

    const blocker = page.locator('[data-blocker-reason="targets"]');
    assert.equal(await blocker.count(), 1, `${lang}: the empty step names its blocker`);
    const blockerText = await blocker.innerText();
    assert.equal(blockerText, copy.blocker, `${lang}: the blocker is the localized reason`);
    noRussian(blockerText, lang, "the blocked-action reason");
    noRawKey(blockerText, lang, "the blocked-action reason");

    await page.locator('[data-target][data-id="2"]:not(:disabled)').click();
    await page.locator('[data-act="complete"]').click();
    await page.waitForSelector('[data-act="step-confirm"]');
    const note = await page.locator("[data-step-note]").innerText();
    assert.equal(note, copy.bmrNote, `${lang}: the Zombuul night note is the localized note`);
    noRussian(note, lang, "the Zombuul night note");
    noRawKey(note, lang, "the Zombuul night note");
    await page.locator('[data-act="step-confirm"]').click();
    await settle(page);
    await playNight(page, {}, { skipUnplanned: true });

    // --- Role sheet.
    await gotoRoute(page, "sheet/" + lang);
    await page.waitForSelector('[data-role-id="zombuul"]');
    const sheet = await visibleText(page);
    const sheetAbility = await page.evaluate(
      () => window.PG.roles.find((candidate) => candidate.id === "zombuul").ability,
    );
    assert.ok(
      sheet.includes(sheetAbility),
      `${lang}: the role sheet shows a localized ability -> ${JSON.stringify(sheet.slice(0, 200))}`,
    );
    noRussian(sheet, lang, "the role sheet");
    noRawKey(sheet, lang, "the role sheet");

    // --- The over panel names the Vortox win in the chosen language.
    await gotoRoute(page, "table");
    await seedGame(page, { edition: "snv", assignment: VORTOX_BAG });
    await playNight(page, {}, { skipUnplanned: true });
    await playDay(page, {});
    const over = await page.locator("[data-step='over']").innerText();
    assert.equal(
      await page.locator("[data-win-reason]").getAttribute("data-win-reason"),
      "vortox",
      `${lang}: the day without an execution is a Vortox win`,
    );
    const reason = await page.locator("[data-win-reason]").innerText();
    assert.equal(reason, copy.winReason, `${lang}: the over panel prints the localized win reason`);
    noRussian(reason, lang, "the win reason");
    noRawKey(reason, lang, "the win reason");
    noRussian(over, lang, "the over panel");

    // --- S&V night note: the Pit-Hag's own card and its in-play note.
    await seedGame(page, { edition: "snv", assignment: PITHAG_BAG, bluffs: PITHAG_BLUFFS });
    await playNight(page, {}, { skipUnplanned: true });
    await playDay(page, {});
    const pithagStep = await currentStep(page);
    assert.equal(pithagStep && pithagStep.roleId, "pithag", `${lang}: the Pit-Hag wakes first`);

    // The card's computed hint is engine-originated.
    await page.locator('[data-target][data-id="2"]:not(:disabled)').click();
    await page.locator('[data-act="complete"]').click();
    await page.waitForSelector("[data-step-sheet]");
    const pithagCard = await page.locator("[data-step-sheet]").innerText();
    assert.match(pithagCard, copy.computed, `${lang}: the Pit-Hag card shows the computed hint`);
    noRawKey(pithagCard, lang, "the Pit-Hag night card");
    const pithagHint = await page
      .locator('[data-step-sheet] div[class*="bg-accent-dim"]')
      .innerText();
    if (CYRILLIC.test(pithagHint)) leaks.push(`${lang} card hint: ${JSON.stringify(pithagHint)}`);

    // Naming a character already in play records `note.pithagInPlay`, which the
    // console shows in the event log.
    await page.locator("[data-bmr-role]").selectOption("clockmaker");
    await page.locator('[data-act="step-confirm"]').click();
    await settle(page);
    await page.locator('[data-act="menu"]').click();
    await page.waitForSelector("[data-menu]");
    const log = await page.locator("[data-menu]").innerText();
    const noteLine = log
      .split("\n")
      .find((line) => /already in play|уже в игре|artıq oyundadır/i.test(line));
    assert.ok(
      noteLine,
      `${lang}: the in-play note reaches the event log -> ${JSON.stringify(log)}`,
    );
    noRawKey(noteLine, lang, "the in-play note");
    if (!noteLine.includes(copy.inPlay)) {
      leaks.push(`${lang} in-play note: ${JSON.stringify(noteLine)}`);
    }
  }

  // The base language keeps its own copy and never prints a key.
  await page.evaluate(() => localStorage.setItem("pg.lang", "ru"));
  await page.goto(url);
  await page.waitForSelector(".host");
  const ru = await page.locator("[data-table-dock]").innerText();
  noRawKey(ru, "ru", "the dock");

  assert.deepEqual(
    leaks,
    [],
    "an engine-originated night note must be in the active UI language (Pit-Hag card hint, in-play note): " +
      leaks.join(" | "),
  );

  return "en and az consoles, notes, blockers, win reasons, the sheet and the player card are translated";
});
