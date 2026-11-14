// Languages: the console speaks the selected UI language. A raw Russian
// engine sentence, an untranslated note or a raw key in EN or AZ is a defect
// (issue #171 AS1, AS15, AS16, AS19).
import {
  runScenario,
  seedGame,
  playNight,
  playDay,
  gotoRoute,
  visibleText,
  assert,
} from "../scenario-kit.mjs";

const CYRILLIC = /[\u0400-\u04FF]/;
const RAW_KEY = /\b(?:ui|note|error|winReason|guide)\.[A-Za-z]/;

await runScenario("languages", async ({ page, url }) => {
  for (const lang of ["en", "az"]) {
    await page.evaluate((value) => localStorage.setItem("pg.lang", value), lang);
    await page.goto(url);
    await page.waitForSelector(".host");
    await seedGame(page, {
      assignment: { 1: "chef", 2: "empath", 3: "monk", 4: "poisoner", 5: "imp" },
    });
    await playNight(page, { poisoner: { targets: ["1"] } });
    await playDay(page, {});

    const dock = await page.locator("[data-table-dock]").innerText();
    assert.equal(
      CYRILLIC.test(dock),
      false,
      `${lang}: the dock shows a Russian sentence -> ${dock}`,
    );
    assert.equal(RAW_KEY.test(dock), false, `${lang}: the dock shows a raw key -> ${dock}`);

    await gotoRoute(page, "public");
    const publicText = await visibleText(page);
    assert.equal(
      CYRILLIC.test(publicText),
      false,
      `${lang}: the public page shows a Russian sentence`,
    );
  }

  await page.evaluate(() => localStorage.setItem("pg.lang", "ru"));
  await page.goto(url);
  await page.waitForSelector(".host");
  const ru = await page.locator("[data-table-dock]").innerText();
  assert.equal(RAW_KEY.test(ru), false, "ru: the dock shows a raw key");

  return "en and az consoles have no Russian sentence and no raw key";
});
