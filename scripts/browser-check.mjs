// Optional browser verification. Set PLAYWRIGHT_MODULE to an installed Playwright ESM entry.
// No browser package is required to run or deploy the application.
import { execFile } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { createDistServer } from "./serve-dist.mjs";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright"
);
const root = fileURLToPath(new URL("../", import.meta.url));
const BASE = "/pocket/";
const dist = join(root, "dist");
const distRoot = join(root, "dist-root");
const run = promisify(execFile);

// The harness drives the built artifact, not the source tree. Build once with
// the subpath base (and again at the root base for the fallback matrix), then
// generate the fallback document and the worker from each build.
if (!process.env.PG_SKIP_BUILD) {
  const build = (base, outDir) =>
    run(
      process.execPath,
      [
        join(root, "node_modules/vite/bin/vite.js"),
        "build",
        "--mode",
        "test",
        ...(outDir ? ["--outDir", outDir] : []),
      ],
      { cwd: root, env: { ...process.env, BASE_PATH: base } },
    );
  const post = (base, target) =>
    Promise.all([
      run(process.execPath, [join(root, "scripts/build-fallback.mjs"), "--root", target], {
        cwd: root,
        env: { ...process.env, BASE_PATH: base },
      }),
      run(
        process.execPath,
        [join(root, "scripts/build-offline.mjs"), "--root", target, "--out", join(target, "sw.js")],
        { cwd: root, env: { ...process.env, BASE_PATH: base } },
      ),
    ]);
  await build(BASE, null);
  await post(BASE, dist);
  await build("/", distRoot);
  await post("/", distRoot);
}

// A mutable release lets the update-flow check deploy a second worker version.
let releaseOverride = null;

async function before(req, res, pathname) {
  if (!pathname.startsWith(BASE)) return false;
  const relative = pathname.slice(BASE.length);
  if (relative === "sw.js" && releaseOverride !== null) {
    res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
    res.end(releaseOverride);
    return true;
  }
  return false;
}

const server = createDistServer({ root: dist, prefix: BASE, before });
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}${BASE}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  try {
    sessionStorage.setItem(
      "pg-test-loads",
      String(Number(sessionStorage.getItem("pg-test-loads") || "0") + 1),
    );
  } catch {
    /* storage can be unavailable during teardown */
  }
  // Test-mode entry: the same module instances the app bundle uses.
  window.PG_MODULES = () => import("/pocket/test-entry.js");
});
const page = await context.newPage();
const errors = [];
context.on("page", (tab) => tab.on("pageerror", (error) => errors.push(error.message)));
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
const screenshots = join(tmpdir(), "pocket-grimoire-check");
await mkdir(screenshots, { recursive: true });

async function route(path) {
  // Mirror real navigation: stay inside the app's project subpath so that a
  // reload still resolves to a served document.
  await page.evaluate((href) => {
    history.pushState(null, "", href);
    dispatchEvent(new PopStateEvent("popstate"));
  }, "/pocket" + path);
  await page.waitForFunction((path) => document.body.dataset.route === path.slice(1), path);
  await page.waitForTimeout(60);
}
async function sheetRoute(path) {
  await page.evaluate((href) => {
    history.pushState(null, "", href);
    dispatchEvent(new PopStateEvent("popstate"));
  }, "/pocket" + path);
  await page.waitForFunction(() => document.body.dataset.route === "sheet");
  await page.waitForTimeout(60);
}
async function overflow() {
  const detail = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    route: location.pathname,
    width: innerWidth,
    elements: [...document.querySelectorAll("#screen *")]
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 6)
      .map((el) => ({
        tag: el.tagName,
        class: el.className,
        right: el.getBoundingClientRect().right,
      })),
  }));
  assert.equal(detail.overflow, false, JSON.stringify(detail));
}
// Issue #143: a role card must show its complete role. The ability text comes
// from the loaded catalog, no clamp applies, and the card grows instead of
// clipping the text.
async function sheetLegibility(widths) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(80);
    assert.equal(
      await page.locator(".sheet-role").count(),
      77,
      `${width}px: 72 standard roles and 5 Travellers are present`,
    );
    const problems = await page.evaluate(() => {
      const abilityById = new Map(
        (window.PG?.roles ?? []).map((role) => [role.id, role.ability ?? ""]),
      );
      const problems = [];
      for (const card of document.querySelectorAll(".sheet-role")) {
        const id = card.dataset.roleId;
        const article = card.querySelector("article");
        const name = card.querySelector("h3");
        const text = card.querySelector("p");
        if (!article || !name || !text) {
          problems.push(`${id}: incomplete card markup`);
          continue;
        }
        if (text.textContent !== abilityById.get(id))
          problems.push(`${id}: ability text differs from the catalog`);
        const clamp = getComputedStyle(text).webkitLineClamp;
        if (clamp !== "none") problems.push(`${id}: -webkit-line-clamp is ${clamp}`);
        if (text.scrollHeight > text.clientHeight + 1)
          problems.push(`${id}: ability clips ${text.scrollHeight}>${text.clientHeight}`);
        if (article.scrollHeight > article.clientHeight + 1)
          problems.push(`${id}: card clips ${article.scrollHeight}>${article.clientHeight}`);
        const abilitySize = parseFloat(getComputedStyle(text).fontSize);
        if (abilitySize < 12) problems.push(`${id}: ability font size ${abilitySize}px`);
        const nameSize = parseFloat(getComputedStyle(name).fontSize);
        if (nameSize < 16) problems.push(`${id}: name font size ${nameSize}px`);
      }
      return problems.slice(0, 8);
    });
    assert.deepEqual(problems, [], `${width}px: ${problems.join("; ")}`);
    await overflow();
  }
}
async function chooseLanguage(lang) {
  const mobile = (await page.viewportSize()).width < 900;
  if (mobile) {
    await page.locator("[data-app-bar-toggle]").click();
    await page.locator("[data-app-bar-menu]").waitFor({ state: "visible" });
  }
  await page.locator(`.lang-switch [data-lang="${lang}"]`).click();
  if (mobile) await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
}
async function seed(count, phase = "night") {
  const result = await page.evaluate(
    async ({ count, phase }) => {
      const model = (await window.PG_MODULES()).model;
      const engine = (await window.PG_MODULES()).engine;
      const store = (await window.PG_MODULES()).store;
      const seedBags = {
        7: {
          roles: ["chef", "empath", "fortuneteller", "undertaker", "virgin", "poisoner", "imp"],
          bluffs: ["washerwoman", "librarian", "monk"],
          drunkShownId: null,
        },
        12: {
          roles: [
            "chef",
            "empath",
            "fortuneteller",
            "undertaker",
            "monk",
            "slayer",
            "mayor",
            "drunk",
            "saint",
            "poisoner",
            "scarletwoman",
            "imp",
          ],
          bluffs: ["soldier", "virgin", "ravenkeeper"],
          drunkShownId: "washerwoman",
        },
      };
      const game = model.createGame(count);
      Object.assign(game.setup, structuredClone(seedBags[count]));
      const assignment = Object.fromEntries(
        game.order.map((id, index) => [id, game.setup.roles[index]]),
      );
      const result = engine.dealGame(game, { assignment });
      if (!result.ok) return result;
      game.order.forEach((id) => {
        game.players[id].name = id === "1" ? "Alice" : "Player " + id;
        game.players[id].claimed = phase !== "deal";
      });
      engine.autoSecrets(game);
      if (count === 12)
        game.setup.info.washerwoman = { forDrunk: true, roleId: "chef", pair: ["1", "2"] };
      if (phase !== "deal") {
        game.phase = "seat";
        const start = engine.startNight(game);
        if (!start.ok) return start;
      }
      const errors = model.validateState(game);
      if (errors.length) return { ok: false, errors };
      store.replaceState(game);
      dispatchEvent(new PopStateEvent("popstate"));
      return { ok: true };
    },
    { count, phase },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  await page.waitForTimeout(100);
}

// Night 2 of a 5-player Mayor game, with the Poisoner's step waiting. Night 1
// is completed with the Chef poisoned so the Mayor starts healthy.
async function seedMayorNight2() {
  const result = await page.evaluate(async () => {
    const model = (await window.PG_MODULES()).model;
    const engine = (await window.PG_MODULES()).engine;
    const store = (await window.PG_MODULES()).store;
    const assignment = { 1: "mayor", 2: "chef", 3: "empath", 4: "poisoner", 5: "imp" };
    const game = model.createGame(5);
    Object.entries(assignment).forEach(([id]) => {
      game.players[id].name = "Player " + id;
      game.players[id].claimed = true;
    });
    game.setup.count = 5;
    game.setup.roles = [...new Set(Object.values(assignment))];
    game.setup.bluffs = [];
    const dealt = engine.dealGame(game, { assignment });
    if (!dealt.ok) return dealt;
    engine.autoSecrets(game);
    game.phase = "seat";
    const start = engine.startNight(game);
    if (!start.ok) return start;
    engine.completeStep(game, game.night.queue.find((step) => step.roleId === "poisoner").key, {
      targetIds: ["2"],
    });
    while (engine.currentStep(game))
      engine.skipStep(game, engine.currentStep(game).key, "browser check");
    engine.endNight(game);
    engine.endDay(game);
    const errors = model.validateState(game);
    if (errors.length) return { ok: false, errors };
    store.replaceState(game);
    dispatchEvent(new PopStateEvent("popstate"));
    return { ok: true };
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  await page.waitForTimeout(100);
}
// Night 2 of a 5-player game where the healthy Soldier is the Imp's target:
// the attack is blocked and the preview must show a prevented death.
async function seedSoldierNight() {
  const result = await page.evaluate(async () => {
    const model = (await window.PG_MODULES()).model;
    const engine = (await window.PG_MODULES()).engine;
    const store = (await window.PG_MODULES()).store;
    const assignment = { 1: "soldier", 2: "chef", 3: "empath", 4: "poisoner", 5: "imp" };
    const game = model.createGame(5);
    Object.entries(assignment).forEach(([id]) => {
      game.players[id].name = "Player " + id;
      game.players[id].claimed = true;
    });
    game.setup.count = 5;
    game.setup.roles = [...new Set(Object.values(assignment))];
    game.setup.bluffs = [];
    const dealt = engine.dealGame(game, { assignment });
    if (!dealt.ok) return dealt;
    engine.autoSecrets(game);
    game.phase = "seat";
    const start = engine.startNight(game);
    if (!start.ok) return start;
    while (engine.currentStep(game)) {
      engine.skipStep(game, engine.currentStep(game).key, "browser check");
    }
    engine.endNight(game);
    engine.endDay(game);
    while (engine.currentStep(game) && engine.currentStep(game).roleId !== "imp") {
      engine.skipStep(game, engine.currentStep(game).key, "browser check");
    }
    const errors = model.validateState(game);
    if (errors.length) return { ok: false, errors };
    store.replaceState(game);
    dispatchEvent(new PopStateEvent("popstate"));
    return { ok: true };
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  await page.waitForTimeout(100);
}

// Night 2 of a 7-player Mayor game. P2 died to the Imp on night 1, the Monk
// protects P3 tonight, and P5 is a healthy Soldier. All three are valid Mayor
// replacements, but a dead or protected replacement must not die.
async function seedMayorRedirectTargets() {
  const result = await page.evaluate(async () => {
    const model = (await window.PG_MODULES()).model;
    const engine = (await window.PG_MODULES()).engine;
    const store = (await window.PG_MODULES()).store;
    const assignment = {
      1: "mayor",
      2: "chef",
      3: "empath",
      4: "monk",
      5: "soldier",
      6: "poisoner",
      7: "imp",
    };
    const game = model.createGame(7);
    Object.entries(assignment).forEach(([id]) => {
      game.players[id].name = "Player " + id;
      game.players[id].claimed = true;
    });
    game.setup.count = 7;
    game.setup.roles = [...new Set(Object.values(assignment))];
    game.setup.bluffs = ["washerwoman", "librarian", "investigator"];
    const dealt = engine.dealGame(game, { assignment });
    if (!dealt.ok) return dealt;
    engine.autoSecrets(game);
    game.phase = "seat";
    let start = engine.startNight(game);
    if (!start.ok) return start;
    engine.completeStep(game, game.night.queue.find((step) => step.roleId === "poisoner").key, {
      targetIds: ["5"],
    });
    while (engine.currentStep(game)) {
      const step = engine.currentStep(game);
      if (step.roleId === "imp") engine.completeStep(game, step.key, { targetIds: ["2"] });
      else engine.skipStep(game, step.key, "browser check");
    }
    engine.endNight(game);
    // P2 died away from a night wake: the Imp does not wake on night 1, so the
    // host records the death before night 2 begins.
    engine.kill(game, "2", "test");
    engine.endDay(game);
    start = engine.startNight(game);
    if (!start.ok) return start;
    engine.completeStep(game, game.night.queue.find((step) => step.roleId === "poisoner").key, {
      targetIds: ["2"],
    });
    engine.completeStep(game, game.night.queue.find((step) => step.roleId === "monk").key, {
      targetIds: ["3"],
    });
    const current = engine.currentStep(game);
    if (!current || current.roleId !== "imp")
      return { ok: false, errors: [{ code: "step", message: String(current && current.roleId) }] };
    const errors = model.validateState(game);
    if (errors.length) return { ok: false, errors };
    store.replaceState(game);
    dispatchEvent(new PopStateEvent("popstate"));
    return { ok: true };
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  await page.waitForTimeout(100);
}

// Night 1 of a 7-player Fortune Teller game, stopped on the Fortune Teller step
// with a known red herring so the self-target read is deterministic.
async function seedFortuneTellerNight() {
  const result = await page.evaluate(async () => {
    const model = (await window.PG_MODULES()).model;
    const engine = (await window.PG_MODULES()).engine;
    const store = (await window.PG_MODULES()).store;
    const assignment = {
      1: "fortuneteller",
      2: "chef",
      3: "empath",
      4: "monk",
      5: "soldier",
      6: "poisoner",
      7: "imp",
    };
    const game = model.createGame(7);
    Object.entries(assignment).forEach(([id]) => {
      game.players[id].name = "Player " + id;
      game.players[id].claimed = true;
    });
    game.setup.count = 7;
    game.setup.roles = [...new Set(Object.values(assignment))];
    game.setup.bluffs = ["washerwoman", "librarian", "investigator"];
    const dealt = engine.dealGame(game, { assignment });
    if (!dealt.ok) return dealt;
    engine.autoSecrets(game);
    game.setup.herringId = "3";
    game.phase = "seat";
    const start = engine.startNight(game);
    if (!start.ok) return start;
    while (engine.currentStep(game) && engine.currentStep(game).roleId !== "fortuneteller") {
      engine.skipStep(game, engine.currentStep(game).key, "browser check");
    }
    const current = engine.currentStep(game);
    if (!current || current.roleId !== "fortuneteller")
      return { ok: false, errors: [{ code: "step", message: String(current && current.roleId) }] };
    const errors = model.validateState(game);
    if (errors.length) return { ok: false, errors };
    store.replaceState(game);
    dispatchEvent(new PopStateEvent("popstate"));
    return { ok: true };
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  await page.waitForTimeout(100);
}

// Night 1 of a 7-player Sects & Violets game, stopped on the Snake Charmer step
// with seat 1 already dead, so the picker must not offer that seat.
async function seedSnakeCharmerNight() {
  const result = await page.evaluate(async () => {
    const { model, engine, store, rules } = await window.PG_MODULES();
    const assignment = {
      1: "clockmaker",
      2: "dreamer",
      3: "snakecharmer",
      4: "artist",
      5: "mutant",
      6: "witch",
      7: "fanggu",
    };
    const game = model.createGame(7);
    game.scriptId = "snv";
    // The script catalog is not exposed to the harness; the edition flag is
    // what routes the night into the Sects & Violets queue.
    game.script = {
      ...game.script,
      id: "snv",
      name: "Sects and Violets",
      edition: "snv",
      roles: [...rules.SNV_ALL],
    };
    Object.entries(assignment).forEach(([id]) => {
      game.players[id].name = "Player " + id;
      game.players[id].claimed = true;
    });
    game.setup.count = 7;
    game.setup.roles = [...new Set(Object.values(assignment))];
    game.setup.bluffs = [...rules.SNV_ALL]
      .filter((id) => !game.setup.roles.includes(id))
      .slice(0, 3);
    const dealt = engine.dealGame(game, { assignment });
    if (!dealt.ok) return dealt;
    engine.autoSecrets(game);
    game.players["1"].alive = false;
    game.phase = "seat";
    const start = engine.startNight(game);
    if (!start.ok) return start;
    while (engine.currentStep(game) && engine.currentStep(game).roleId !== "snakecharmer") {
      engine.skipStep(game, engine.currentStep(game).key, "browser check");
    }
    const current = engine.currentStep(game);
    if (!current || current.roleId !== "snakecharmer")
      return { ok: false, errors: [{ code: "step", message: String(current && current.roleId) }] };
    const errors = model.validateState(game);
    if (errors.length) return { ok: false, errors };
    store.replaceState(game);
    dispatchEvent(new PopStateEvent("popstate"));
    return { ok: true };
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  await page.waitForTimeout(100);
}

async function finishNight() {
  for (let i = 0; i < 30; i++) {
    if (await page.locator('[data-act="end-night"]').count()) {
      await page.locator('[data-act="end-night"]').click();
      return;
    }
    const targets = page.locator("[data-target]:not(:disabled)");
    if (await targets.count()) {
      const mode = await page.evaluate(async () => {
        const { state } = (await window.PG_MODULES()).store;
        const { currentStep } = (await window.PG_MODULES()).engine;
        return currentStep(state).targetMode;
      });
      await targets.nth(0).click();
      if (mode === "two") await page.locator("[data-target]:not(:disabled)").nth(1).click();
    }
    const given = page.locator("select[data-given]");
    if (await given.count()) {
      const value = await given
        .locator("option")
        .evaluateAll((options) => options.find((option) => option.value)?.value);
      if (value) await given.selectOption(value);
    }
    const complete = page.locator('[data-act="complete"]');
    assert.equal(await complete.isEnabled(), true, "night step should be completable");
    await complete.click();
  }
  throw new Error("Night did not end");
}

try {
  await page.goto(url);
  await page.waitForSelector(".host");
  assert.equal(
    await page.locator("#update-banner").isVisible(),
    false,
    "first install must not show an update prompt",
  );

  // Identity: the shell, the manifest and every header name Grimoria.
  assert.equal(await page.title(), "Grimoria", "document title");
  const identityManifest = await page.evaluate(async (href) => {
    const response = await fetch(href);
    return { ok: response.ok, body: await response.json() };
  }, new URL("manifest.webmanifest", url).href);
  assert.equal(identityManifest.ok, true, "manifest loads");
  assert.equal(identityManifest.body.name, "Grimoria", "manifest name");
  assert.equal(identityManifest.body.short_name, "Grimoria", "manifest short name");
  assert.equal(
    (await page.locator(".setup-brand").innerText()).includes("PG"),
    false,
    "table header has no PG mark",
  );
  assert.equal(
    await page
      .locator(".setup-brand img.brand-mark")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
    "table header mark loads",
  );
  {
    const identity = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const tab = await identity.newPage();
    for (const [path, header, image] of [
      ["bag", ".setup-brand", ".setup-brand img.brand-mark"],
      ["sheet/ru", ".setup-brand", ".setup-brand img.brand-mark"],
      ["help", ".setup-brand", ".setup-brand img.brand-mark"],
    ]) {
      await tab.goto(url + path);
      await tab.waitForSelector(header);
      assert.equal(
        (await tab.locator(header).innerText()).includes("PG"),
        false,
        `${path} has no PG mark`,
      );
      assert.equal(
        await tab.locator(header).getAttribute("aria-label"),
        "Grimoria",
        `${path} brand name`,
      );
      assert.equal(
        await tab.locator(image).evaluate((img) => img.complete && img.naturalWidth > 0),
        true,
        `${path} brand image loads`,
      );
    }
    await identity.close();
  }

  // Pages-like fallback matrix: a real 404 for a nested route, exactly one
  // redirect, the route restored; the same cases at the root base.
  const matrix = async (target, cases) => {
    for (const testCase of cases) {
      const cold = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const tab = await cold.newPage();
      const fallbacks = [];
      tab.on("response", (response) => {
        if (response.status() === 404 && response.request().resourceType() === "document")
          fallbacks.push(response.url());
      });
      await tab.goto(target + testCase.path);
      await tab.waitForSelector("#screen > *", { timeout: 15000 });
      assert.equal(
        fallbacks.length,
        1,
        `${testCase.path} produced ${fallbacks.length} fallback responses`,
      );
      assert.equal(tab.url().startsWith(target), true, `${testCase.path} stayed inside the base`);
      if (testCase.final) assert.equal(tab.url(), target + testCase.final, testCase.path);
      await cold.close();
    }
  };
  await matrix(url, [
    { path: "table" },
    { path: "table/", final: "table" },
    { path: "table?x=1", final: "table?x=1" },
    { path: "sheet/ru" },
    { path: "sheet/en" },
    { path: "sheet/az" },
    { path: "unknown-route" },
  ]);

  // A path outside the project base is not stored and never bounces elsewhere.
  {
    const cold = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const tab = await cold.newPage();
    await tab.goto(new URL("/outside", url).href);
    await tab.waitForSelector("#screen > *", { timeout: 15000 });
    assert.equal(tab.url(), url + "table");
    await cold.close();
  }

  const rootServer = createDistServer({ root: distRoot, prefix: "/" });
  await new Promise((done) => rootServer.listen(0, "127.0.0.1", done));
  const rootUrl = `http://127.0.0.1:${rootServer.address().port}/`;
  try {
    await matrix(rootUrl, [
      { path: "table" },
      { path: "table/", final: "table" },
      { path: "table?x=1", final: "table?x=1" },
      { path: "sheet/ru" },
      { path: "unknown-route" },
    ]);
  } finally {
    await new Promise((done) => rootServer.close(done));
  }
  await chooseLanguage("en");
  await seed(7);

  // The demo keeps its own game and never reads or writes the saved one.
  const savedBeforeDemo = await page.evaluate(() => localStorage.getItem("pg.game.v4"));
  await route("/demo");
  await page.waitForSelector("#screen > *");
  await page.waitForTimeout(120);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("pg.game.v4")),
    savedBeforeDemo,
    "the demo must not touch the saved game",
  );
  await route("/table");

  await overflow();
  assert.equal(await page.locator(".host-main").isVisible(), true);
  assert.equal(await page.locator(".host-seats").count(), 0, "the ring replaces the seat rail");
  const ringBox = await page.locator("[data-game-table]").last().boundingBox();
  const hostBox = await page.locator(".host-card").first().boundingBox();
  assert.ok(ringBox && hostBox && ringBox.y < hostBox.y, "the table renders first on a phone");
  await page.screenshot({ path: join(screenshots, "phone-night.png"), fullPage: true });

  // Regression: switching scripts without a reload must replace the bag's
  // role pool. The old mount-time role list kept showing roles from the
  // previous script.
  await page.evaluate(async () => {
    const store = (await window.PG_MODULES()).store;
    store.reset(7);
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await route("/bag");
  await page.waitForSelector(".setup");
  await page.locator('[data-tab="manual"]').click();
  assert.equal(
    await page.locator(".bag-role").count(),
    22,
    "Trouble Brewing exposes its full roster",
  );
  const customRoles = [
    "chef",
    "mayor",
    "undertaker",
    "monk",
    "slayer",
    "soldier",
    "ravenkeeper",
    "fortuneteller",
    "butler",
    "poisoner",
    "imp",
  ];
  const customJson = JSON.stringify([
    { id: "_meta", name: "Browser Script" },
    ...customRoles.map((id) => ({ id })),
  ]);
  const supportCounts = (scope) =>
    page
      .locator(`${scope} [data-support-level]`)
      .evaluateAll((nodes) =>
        Object.fromEntries(
          nodes.map((node) => [node.dataset.supportLevel, Number(node.dataset.supportCount)]),
        ),
      );
  await page.locator('[data-act="script"]').click();
  await page.waitForSelector(".script-modal");
  await page.locator("details[data-script-section='clipboard'] summary").click();
  await page.locator("[data-script-text]").fill(customJson);
  await page.locator('[data-act="script-text"]').click();
  await page.waitForSelector(".script-preview");
  assert.equal(
    await page.locator('.script-preview [data-script-support="verified"]').count(),
    1,
    "a fully verified custom script shows the verified level before apply",
  );
  assert.deepEqual(
    await supportCounts(".script-preview"),
    { verified: customRoles.length, "requires-storyteller-choice": 0, unsupported: 0 },
    "the import preview shows the count in each support level",
  );
  await page.locator('[data-act="apply-script"]').click();
  await page.waitForSelector(".script-modal", { state: "detached" });
  assert.match(await page.locator(".setup-brand small").innerText(), /browser script/i);
  assert.equal(
    await page.locator(".bag-role").count(),
    72,
    "custom mode exposes the full 72-role catalog",
  );
  const shownRoles = await page
    .locator(".bag-role")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.role));
  assert.ok(
    customRoles.every((id) => shownRoles.includes(id)),
    "the imported pool is part of the manual picker",
  );
  const selectedRoles = await page
    .locator(".bag-role.is-on")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.role));
  assert.ok(
    selectedRoles.every((id) => customRoles.includes(id)),
    "the auto-filled bag uses only the new script's roles",
  );

  // Switching back to the official script restores the full roster.
  await page.locator('[data-act="script"]').click();
  await page.waitForSelector(".script-modal");
  await page.locator('input[name="script-pick"][value="tb"]').check();
  await page.locator('[data-act="apply-script"]').click();
  await page.waitForSelector(".script-modal", { state: "detached" });
  assert.equal(
    await page.locator(".bag-role").count(),
    22,
    "Trouble Brewing roles return after the switch",
  );
  assert.equal(await page.locator('.bag-role[data-role="mayor"]').count(), 1);
  assert.equal(
    await page.locator('[data-script-support="requires-storyteller-choice"]').count(),
    1,
    "the Trouble Brewing script reports its Storyteller-choice role",
  );
  assert.deepEqual(
    await supportCounts("[data-script-support]"),
    { verified: 21, "requires-storyteller-choice": 1, unsupported: 0 },
    "the setup screen shows the Trouble Brewing counts",
  );

  // Bad Moon Rising is a real picker choice with its own 25-role pool and
  // script name; switching to it must replace the Trouble Brewing roster.
  await page.locator('[data-act="script"]').click();
  await page.waitForSelector(".script-modal");
  await page.locator('input[name="script-pick"][value="bmr"]').check();
  await page.locator('[data-act="apply-script"]').click();
  await page.waitForSelector(".script-modal", { state: "detached" });
  assert.match(await page.locator(".setup-brand small").innerText(), /bad moon rising/i);
  assert.equal(
    await page.locator(".bag-role").count(),
    25,
    "Bad Moon Rising exposes its full roster",
  );
  assert.equal(await page.locator('.bag-role[data-role="chambermaid"]').count(), 1);
  assert.equal(
    await page.locator('[data-script-support="unsupported"]').count(),
    0,
    "Bad Moon Rising has no unsupported character",
  );
  assert.deepEqual(
    await supportCounts("[data-script-support]"),
    { verified: 21, "requires-storyteller-choice": 4, unsupported: 0 },
    "Bad Moon Rising shows four Storyteller-choice roles and none unsupported",
  );
  assert.equal(
    await page.locator('.bag-role[data-role="mayor"]').count(),
    0,
    "Trouble Brewing roles are not in the Bad Moon Rising pool",
  );
  const bmrRoles = await page
    .locator(".bag-role")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.role));
  assert.ok(
    bmrRoles.every((id) =>
      [
        "chambermaid",
        "courtier",
        "exorcist",
        "fool",
        "gambler",
        "gossip",
        "grandmother",
        "innkeeper",
        "minstrel",
        "pacifist",
        "professor",
        "sailor",
        "tealady",
        "goon",
        "lunatic",
        "moonchild",
        "tinker",
        "assassin",
        "devilsadvocate",
        "godfather",
        "mastermind",
        "po",
        "pukka",
        "shabaloth",
        "zombuul",
      ].includes(id),
    ),
    "the Bad Moon Rising pool contains only Bad Moon Rising roles",
  );
  assert.equal(
    await page.locator(".bag-note.bmr-warning").count(),
    1,
    "the Bad Moon Rising host-mode warning is visible",
  );

  // Sects and Violets is the third selectable scenario with its own pool.
  await page.locator('[data-act="script"]').click();
  await page.waitForSelector(".script-modal");
  await page.locator('input[name="script-pick"][value="snv"]').check();
  await page.locator('[data-act="apply-script"]').click();
  await page.waitForSelector(".script-modal", { state: "detached" });
  assert.match(await page.locator(".setup-brand small").innerText(), /sects and violets/i);
  assert.equal(
    await page.locator(".bag-role").count(),
    25,
    "Sects and Violets exposes its full roster",
  );
  assert.equal(await page.locator('.bag-role[data-role="clockmaker"]').count(), 1);
  assert.equal(
    await page.locator('.bag-role[data-role="chambermaid"]').count(),
    0,
    "Bad Moon Rising roles are not in the Sects and Violets pool",
  );
  assert.equal(
    await page.locator(".bag-note.snv-warning").count(),
    1,
    "the Sects and Violets host-mode warning is visible",
  );

  await page.locator('[data-act="script"]').click();
  await page.waitForSelector(".script-modal");
  await page.locator('input[name="script-pick"][value="tb"]').check();
  await page.locator('[data-act="apply-script"]').click();
  await page.waitForSelector(".script-modal", { state: "detached" });

  // Issue #17: three suggested bags, preview/apply, manual editing, undo and
  // the mixed-edition block.
  await route("/bag");
  await page.waitForSelector(".setup");
  await page.locator('[data-tab="recommended"]').click();
  assert.equal(
    await page.locator(".bag-preset-card").count(),
    3,
    "three suggested bags at seven players",
  );
  await page.locator(".bag-preset-card [data-preview]").first().click();
  await page.waitForSelector(".bag-preview");
  assert.ok((await page.locator(".bag-preview .bag-token").count()) > 0);
  await page.locator('[data-act="close-preview"]').first().click();
  await page.locator(".bag-preset-card [data-apply]").first().click();
  await page.waitForSelector(".bag-status.is-ok");
  assert.equal(
    await page.locator('[data-act="deal"]').isDisabled(),
    false,
    "a valid preset enables the deal",
  );
  await page.locator('[data-tab="manual"]').click();
  assert.equal(
    await page.locator(".bag-selected .bag-token").count(),
    7,
    "the applied bag is editable in the manual picker",
  );

  await page.locator('[data-count="1"]').click();
  assert.equal(
    await page.locator(".bag-selected .bag-token").count(),
    7,
    "growing the count keeps the chosen roles",
  );
  await page.locator('[data-count="-1"]').click();

  assert.equal(await page.locator("[data-search]").count(), 0, "the manual picker has no search");
  assert.equal(await page.locator("[data-edition]").count(), 0, "no edition filter");
  assert.equal(await page.locator("[data-team-filter]").count(), 0, "no team filter");
  assert.equal(await page.locator("[data-team-group]").count(), 4, "roles are grouped by team");
  assert.equal(await page.locator(".bag-role").count(), 22, "all script roles remain visible");
  await page.locator('.bag-role[data-role="mayor"]').click();
  assert.equal(
    await page.locator(".bag-selected .bag-token").count(),
    8,
    "manual selection adds a token",
  );
  await page.locator('[data-act="undo"]').click();
  assert.equal(
    await page.locator(".bag-selected .bag-token").count(),
    7,
    "undo restores the previous bag",
  );

  // Library: save the current bag, clear it, load it back.
  await page.locator('[data-act="library"]').click();
  await page.waitForSelector("[data-library-name]");
  await page.locator("[data-library-name]").fill("Browser bag");
  await page.locator('[data-act="save-bag"]').click();
  await page.waitForSelector("[data-load-bag]");
  await page.locator('[data-act="close-library"]').last().click();
  await page.locator('[data-tab="manual"]').click();
  await page.locator('[data-act="clear"]').click();
  assert.equal(await page.locator(".bag-selected .bag-token").count(), 0, "clear empties the bag");
  assert.equal(
    await page.locator('[data-act="deal"]').isDisabled(),
    true,
    "an empty bag cannot be dealt",
  );
  await page.locator('[data-act="library"]').click();
  await page.locator("[data-load-bag]").first().click();
  await page.waitForFunction(
    () => document.querySelectorAll(".bag-selected .bag-token").length === 7,
  );

  // A custom draft survives a reload, and a mixed pool becomes playable in
  // explicit manual-only mode.
  await page.locator('[data-scenario="custom"]').click();
  await page.waitForSelector(".bag-pool-hint");
  await page.reload();
  await page.waitForSelector(".setup");
  assert.equal(
    await page.locator(".setup-banner.is-error").count(),
    0,
    "a short custom draft is not treated as corrupt",
  );
  assert.match(await page.locator(".setup-brand small").innerText(), /custom|свой сценарий/i);
  await page.locator('[data-act="edit-pool"]').click();
  await page.waitForSelector(".bag-pool-hint");
  for (const id of ["chef", "empath", "monk", "poisoner", "imp", "chambermaid"]) {
    await page.locator(`.bag-role[data-role="${id}"]`).click();
  }
  assert.equal(
    await page.locator(".setup-banner.is-warning").count(),
    1,
    "a mixed-edition pool enters manual-only mode",
  );
  assert.equal(await page.locator("[data-manual-only]").isChecked(), true);

  // Undo restores the pool, not only the bag selection.
  await page.locator('.bag-role[data-role="mayor"]').click();
  await page.locator('[data-act="undo"]').click();
  assert.equal(
    await page.evaluate(async () => {
      const { state } = (await window.PG_MODULES()).store;
      return state.script.roles.includes("mayor");
    }),
    false,
    "undo restores the custom pool",
  );

  await page.locator('[data-act="edit-pool"]').click();
  await page.locator('[data-count="-1"]').click();
  await page.locator('[data-count="-1"]').click();
  for (const id of ["chef", "empath", "chambermaid", "poisoner", "imp"]) {
    await page.locator(`.bag-role[data-role="${id}"]`).click();
  }
  await page.waitForSelector(".bag-status.is-ok");
  assert.equal(
    await page.locator('[data-act="deal"]').isDisabled(),
    false,
    "a legal mixed bag can be dealt in manual-only mode",
  );

  // The bag picker localizes in all three languages and never overflows.
  for (const [lang, manual] of [
    ["az", "Əl ilə"],
    ["ru", "Вручную"],
    ["en", "Manual"],
  ]) {
    await page.evaluate((code) => localStorage.setItem("pg.lang", code), lang);
    await page.reload();
    await page.waitForSelector(".setup");
    await page.locator('[data-tab="manual"]').click();
    const folded = (value) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    assert.equal(
      folded((await page.locator('[data-tab="manual"]').innerText()).trim()),
      folded(manual),
      `the manual tab is localized in ${lang}`,
    );
    assert.ok((await page.locator(".bag-role b").count()) > 20, `role names render in ${lang}`);
    await overflow();
  }
  assert.equal(
    await page.locator(".bag-selected .bag-token").count(),
    5,
    "the mixed bag survives reload",
  );
  assert.equal(
    await page.locator('[data-act="deal"]').isDisabled(),
    false,
    "the saved mixed bag is ready to deal",
  );
  assert.equal(
    await page.locator("[data-manual-only]").isChecked(),
    true,
    "manual-only mode survives reload",
  );
  await page.locator('[data-act="deal"]').click();
  await page.waitForFunction(() => document.body.dataset.route === "player");
  assert.equal(
    (await page.locator(".player-view").count()) > 0,
    true,
    "the saved mixed bag starts the deal",
  );
  await page.waitForTimeout(200);

  // Mixed-edition manual gameplay: deal, empty automatic night, day and a
  // host-declared winner.
  const mixedSeeded = await page.evaluate(async () => {
    const model = (await window.PG_MODULES()).model;
    const engine = (await window.PG_MODULES()).engine;
    const store = (await window.PG_MODULES()).store;
    const game = model.createGame(5);
    game.script = {
      id: "custom-mixed",
      name: "Mixed manual",
      edition: "custom",
      source: "manual",
      roles: ["fortuneteller", "chambermaid", "monk", "poisoner", "imp"],
      manualOnly: true,
    };
    game.scriptId = game.script.id;
    game.setup.count = 5;
    game.setup.roles = ["fortuneteller", "chambermaid", "monk", "poisoner", "imp"];
    game.setup.bluffs = [];
    const assignment = { 1: "fortuneteller", 2: "chambermaid", 3: "monk", 4: "poisoner", 5: "imp" };
    const dealt = engine.dealGame(game, { assignment });
    if (!dealt.ok) return dealt;
    game.order.forEach((id) => {
      game.players[id].name = "Player " + id;
      game.players[id].claimed = true;
    });
    game.phase = "seat";
    store.replaceState(game);
    dispatchEvent(new PopStateEvent("popstate"));
    return { ok: true };
  });
  assert.equal(mixedSeeded.ok, true, JSON.stringify(mixedSeeded));
  await route("/table");
  assert.equal(await page.locator(".manual-warning").count(), 1, "manual warning on the deal card");
  await page.locator('[data-act="start-night"]').click();
  await page.waitForSelector(".host-card.is-night");
  assert.equal(
    await page.locator(".manual-warning").count(),
    1,
    "manual warning on the night card",
  );
  await page.locator('[data-act="end-night"]').click();
  await page.waitForSelector(".host-card.is-day");
  // The side panel owns the day timer and the notes; both go through the store.
  await page.locator('[data-act="timer-start"]').click();
  await page.waitForFunction(
    () => (document.querySelector('[data-panel="day-result"] b')?.textContent || "—") !== "—",
    undefined,
    { timeout: 3000 },
  );
  await page.locator('[data-act="timer-stop"]').click();
  await page.locator("[data-notes]").fill("Browser verification");
  await page.waitForFunction(async () => {
    const { store } = await window.PG_MODULES();
    return store.state.notes === "Browser verification";
  });
  assert.equal(
    await page.locator("[data-winner-team]").count(),
    1,
    "the host can declare a winner",
  );
  await page.locator("[data-winner-team]").selectOption("evil");
  await page.locator('[data-act="declare-winner"]').click();
  await page.waitForSelector(".host-card.is-over");
  assert.match(await page.locator(".host-card.is-over h1").innerText(), /Evil|Зло/);

  // Editing a dealt custom pool requires confirmation; cancelling must leave
  // the saved game byte-for-byte intact.
  const customDealt = await page.evaluate(async () => {
    const model = (await window.PG_MODULES()).model;
    const engine = (await window.PG_MODULES()).engine;
    const store = (await window.PG_MODULES()).store;
    const { ALL_ROLES } = (await window.PG_MODULES()).rules;
    const game = model.createGame(7);
    game.script = {
      id: "custom-tb",
      name: "Custom TB",
      edition: "custom",
      source: "manual",
      roles: ALL_ROLES.slice(),
    };
    game.scriptId = game.script.id;
    game.setup.count = 7;
    game.setup.roles = [
      "chef",
      "empath",
      "fortuneteller",
      "undertaker",
      "washerwoman",
      "poisoner",
      "imp",
    ];
    game.setup.bluffs = ["librarian", "investigator", "monk"];
    const assignment = {
      1: "chef",
      2: "empath",
      3: "fortuneteller",
      4: "undertaker",
      5: "washerwoman",
      6: "poisoner",
      7: "imp",
    };
    const dealt = engine.dealGame(game, { assignment });
    if (!dealt.ok) return dealt;
    game.order.forEach((id) => {
      game.players[id].name = "Player " + id;
      game.players[id].claimed = true;
    });
    game.phase = "deal";
    store.replaceState(game);
    dispatchEvent(new PopStateEvent("popstate"));
    return { ok: true };
  });
  assert.equal(customDealt.ok, true, JSON.stringify(customDealt));
  await route("/bag");
  await page.waitForSelector(".setup");
  await page.locator('[data-tab="manual"]').click();
  await page.locator('[data-act="edit-pool"]').click();
  const savedBefore = await page.evaluate(async () => {
    const { KEY } = (await window.PG_MODULES()).store;
    return localStorage.getItem(KEY);
  });
  let cancelled = false;
  page.once("dialog", (dialog) => {
    cancelled = true;
    dialog.dismiss();
  });
  await page.locator('.bag-role[data-role="mayor"]').click();
  await page.waitForTimeout(100);
  const savedAfter = await page.evaluate(async () => {
    const { KEY } = (await window.PG_MODULES()).store;
    return localStorage.getItem(KEY);
  });
  assert.equal(cancelled, true, "editing a dealt pool asks for confirmation");
  assert.equal(savedAfter, savedBefore, "cancelling leaves the saved game byte-for-byte intact");

  await seed(7);
  await route("/table");

  // Regression (issue #1): the Poisoner's step must never ask for a Mayor
  // redirection. Selecting the Mayor as a poison target shows no redirect
  // control and leaves "Complete step" enabled.
  await seedMayorNight2();
  await route("/table");
  const stepRole = () =>
    page.evaluate(async () => {
      const { currentStep } = (await window.PG_MODULES()).engine;
      const { state } = (await window.PG_MODULES()).store;
      const step = currentStep(state);
      return step && (step.roleId || step.system);
    });
  assert.equal(await stepRole(), "poisoner", "Mayor scenario should start on the Poisoner");
  // Issue #45: an unanswered mandatory target blocks the step and explains why;
  // the preview shows the chosen target before the step is confirmed.
  assert.equal(
    await page.locator('[data-act="complete"]').isDisabled(),
    true,
    "the Poisoner step is blocked until a target is chosen",
  );
  assert.equal(
    await page.locator('[data-blocker-reason="targets"]').count(),
    1,
    "the blocking card names the missing target",
  );
  assert.equal(await page.locator("[data-preview]").count(), 1, "the preview is visible");
  assert.ok(
    (await page.locator("[data-preview-reason]").innerText()).trim().length > 0,
    "the preview explains the rejected empty command",
  );
  await page.locator('[data-target][data-id="1"]').click();
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator('[data-blocker-reason="targets"]').count(),
    0,
    "choosing a target clears the blocking reason",
  );
  assert.match(
    await page.locator('[data-consequence="target"]').innerText(),
    /Player 1/,
    "the preview names the chosen target",
  );
  assert.equal(
    await page.locator('[data-consequence="applied"]').count(),
    1,
    "the Poisoner's poison is an applied state, not a death",
  );
  assert.equal(
    await page.locator('[data-consequence="scheduled"]').count(),
    0,
    "an expiry-only poison is not a scheduled death",
  );
  // Correcting a wrong draft clears it locally; the trigger is not applied.
  await page.locator('[data-act="reset-step"]').click();
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator('[data-blocker-reason="targets"]').count(),
    1,
    "clearing the step input restores the blocking reason",
  );
  assert.equal(
    await page.locator('[data-consequence="target"]').count(),
    0,
    "the cleared draft no longer previews a target",
  );
  // Desktop smoke inside the table scenario, not the PWA update flow.
  await page.setViewportSize({ width: 1440, height: 900 });
  await overflow();
  assert.equal(
    await page.locator('[data-act="complete"]').isDisabled(),
    true,
    "the desktop step stays blocked without a target",
  );
  assert.equal(await page.locator("[data-preview-reason]").count(), 1);
  assert.ok(
    (await page.locator("[data-preview-reason]").innerText()).trim().length > 0,
    "the desktop preview explains the rejected empty command",
  );
  await page.screenshot({
    path: join(screenshots, "storyteller-step-preview-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-target][data-id="1"]').click();
  await page.waitForTimeout(150);
  await page.screenshot({
    path: join(screenshots, "storyteller-step-preview-phone.png"),
    fullPage: true,
  });
  assert.equal(
    await page.locator("select[data-redirect]").count(),
    0,
    "the Poisoner's step must not offer a Mayor redirection",
  );
  assert.equal(
    await page.locator('[data-act="complete"]').isEnabled(),
    true,
    "the step-complete button stays enabled when the Mayor is only poisoned",
  );
  await page.screenshot({
    path: join(screenshots, "mayor-poison-poisoner-step.png"),
    fullPage: true,
  });
  await page.locator('[data-act="complete"]').click();
  await page.waitForTimeout(200);
  // The poisoned Mayor loses the ability, so the Imp's step also asks nothing.
  assert.equal(await stepRole(), "imp");
  await page.locator('[data-target][data-id="1"]').click();
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator("select[data-redirect]").count(),
    0,
    "a poisoned Mayor attacked by the Imp must not offer a redirection",
  );
  await page.locator('[data-act="complete"]').click();
  await page.waitForTimeout(200);
  const mayorDead = await page.evaluate(
    async () => (await window.PG_MODULES()).store.state.players["1"].alive,
  );
  assert.equal(mayorDead, false, "the poisoned Mayor dies to the Demon");

  // A stored redirection belongs to one victim: changing the Demon's target
  // must clear it instead of silently reusing the old replacement.
  await seedMayorNight2();
  await route("/table");
  await page.locator('[data-target][data-id="2"]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-act="complete"]').click();
  await page.waitForTimeout(200);
  assert.equal(await stepRole(), "imp");
  await page.locator('[data-target][data-id="1"]').click();
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator("select[data-redirect]").count(),
    1,
    "a healthy Mayor still offers a redirection",
  );
  await page.locator("select[data-redirect]").selectOption("2");
  await page.waitForTimeout(150);
  await page.locator('[data-target][data-id="3"]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-target][data-id="1"]').click();
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator("select[data-redirect]").inputValue(),
    "none",
    "retargeting the Imp must reset the stored Mayor redirection",
  );

  // A dead or protected player can be named as the Mayor's replacement, but
  // the attack then kills nobody and the Mayor survives.
  await seedMayorRedirectTargets();
  await route("/table");
  assert.equal(await stepRole(), "imp");
  await page.locator('[data-target][data-id="1"]').click();
  await page.waitForTimeout(150);
  const redirectSelect = page.locator("select[data-redirect]");
  assert.equal(await redirectSelect.count(), 1, "a healthy Mayor offers a redirection");
  const redirectOptions = await redirectSelect
    .locator("option")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ value: node.value, text: node.textContent.trim() })),
    );
  assert.ok(
    redirectOptions.some(
      (option) => option.value === "2" && /already dead|уже мёртв|artıq ölü/.test(option.text),
    ),
    "a dead player is offered as a replacement and labelled as no death: " +
      JSON.stringify(redirectOptions),
  );
  assert.ok(
    redirectOptions.some(
      (option) => option.value === "3" && /protected|под защитой|qorunur/.test(option.text),
    ),
    "a Monk-protected player is offered and labelled as no death",
  );
  await redirectSelect.selectOption("2");
  await page.waitForTimeout(150);
  await page.locator('[data-act="complete"]').click();
  await page.waitForTimeout(200);
  let mayorState = await page.evaluate(async () => {
    const { state } = (await window.PG_MODULES()).store;
    return {
      mayorAlive: state.players["1"].alive,
      nightDeaths: state.deaths.filter((death) => death.phase === "night" && death.number === 2)
        .length,
    };
  });
  assert.equal(mayorState.mayorAlive, true, "the Mayor survives a redirect to a dead player");
  assert.equal(mayorState.nightDeaths, 0, "a dead replacement produces no extra death");

  await seedMayorRedirectTargets();
  await route("/table");
  await page.locator('[data-target][data-id="1"]').click();
  await page.waitForTimeout(150);
  await page.locator("select[data-redirect]").selectOption("3");
  await page.waitForTimeout(150);
  await page.locator('[data-act="complete"]').click();
  await page.waitForTimeout(200);
  mayorState = await page.evaluate(async () => {
    const { state } = (await window.PG_MODULES()).store;
    return {
      mayorAlive: state.players["1"].alive,
      protectedAlive: state.players["3"].alive,
      nightDeaths: state.deaths.filter((death) => death.phase === "night" && death.number === 2)
        .length,
    };
  });
  assert.equal(mayorState.mayorAlive, true, "the Mayor survives a redirect to a protected player");
  assert.equal(mayorState.protectedAlive, true, "the Monk-protected replacement survives");
  assert.equal(mayorState.nightDeaths, 0, "a protected replacement produces no extra death");

  // The Sailor's drunk picker reads the same draft as the target list.
  await page.evaluate(async () => {
    const { model, engine, store, rules } = await window.PG_MODULES();
    const assignment = {
      1: "sailor",
      2: "innkeeper",
      3: "courtier",
      4: "tinker",
      5: "assassin",
      6: "shabaloth",
    };
    const game = model.createGame(6);
    game.scriptId = "bmr";
    // The script catalog is not exposed to the harness; the edition flag is
    // what routes the night into the Bad Moon Rising queue.
    game.script = {
      ...game.script,
      id: "bmr",
      name: "Bad Moon Rising",
      edition: "bmr",
      roles: [...rules.BMR_ALL],
    };
    game.setup.count = 6;
    game.setup.roles = Object.values(assignment);
    game.setup.bluffs = [];
    Object.entries(assignment).forEach(([id]) => {
      game.players[id].name = "Player " + id;
      game.players[id].claimed = true;
    });
    const dealt = engine.dealGame(game, { assignment });
    if (!dealt.ok) throw new Error(JSON.stringify(dealt));
    engine.autoSecrets(game);
    game.phase = "seat";
    const start = engine.startNight(game);
    if (!start.ok) throw new Error(JSON.stringify(start));
    while (engine.currentStep(game) && engine.currentStep(game).roleId !== "sailor") {
      engine.skipStep(game, engine.currentStep(game).key, "browser check");
    }
    store.replaceState(game);
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await route("/table");
  assert.equal(await stepRole(), "sailor");
  await page.locator('[data-target][data-id="2"]').click();
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator("select[data-bmr-drunk]").count(),
    1,
    "the Sailor can name the drunk target",
  );
  assert.ok(
    (await page.locator("select[data-bmr-drunk] option").allTextContents()).some((text) =>
      /Player 2/.test(text),
    ),
    "the selected target is offered as the drunk pick",
  );

  // The Fortune Teller may pick themself as one of the two targets.
  await seedFortuneTellerNight();
  await route("/table");
  assert.equal(await stepRole(), "fortuneteller");
  const selfButton = page.locator('[data-target][data-id="1"]');
  assert.equal(await selfButton.isDisabled(), false, "the Fortune Teller can select themself");
  await selfButton.click();
  await page.locator('[data-target][data-id="2"]').click();
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator('[data-act="complete"]').isEnabled(),
    true,
    "self plus another player is a complete Fortune Teller choice",
  );
  await page.locator('[data-act="complete"]').click();
  await page.waitForTimeout(200);
  const fortuneGiven = await page.evaluate(async () => {
    const { state } = (await window.PG_MODULES()).store;
    const step = state.night.queue.find((candidate) => candidate.roleId === "fortuneteller");
    return { targets: step.targetIds, given: step.given && step.given.value };
  });
  assert.deepEqual(fortuneGiven.targets, ["1", "2"], "self-selection is recorded as a target");
  assert.equal(fortuneGiven.given, false, "no Demon and no red herring in the pair");

  // The /secrets picker must offer the Fortune Teller as their own red herring.
  await seedFortuneTellerNight();
  await route("/secrets");
  const herringOptions = await page
    .locator("select[data-herring] option")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ value: node.value, text: node.textContent.trim() })),
    );
  assert.ok(
    herringOptions.some((option) => option.value === "1" && /Fortune Teller/.test(option.text)),
    "the Fortune Teller can be their own red herring: " + JSON.stringify(herringOptions),
  );
  await page.locator("select[data-herring]").selectOption("1");
  assert.equal(
    await page.evaluate(async () => (await window.PG_MODULES()).store.state.setup.herringId),
    "1",
    "choosing the red herring writes the command",
  );

  // Issue #45: the Imp's blocked attack on a healthy Soldier previews a
  // prevented death, not a death.
  await seedSoldierNight();
  await route("/table");
  assert.equal(await stepRole(), "imp");
  await page.locator('[data-target][data-id="1"]').click();
  await page.waitForTimeout(150);
  assert.ok(
    (await page.locator('[data-consequence="prevented"]').innerText()).trim().length > 0,
    "the blocked Soldier attack is a prevented death",
  );
  assert.equal(
    await page.locator('[data-consequence="death"]').count(),
    0,
    "a prevented death is never shown as a death",
  );

  // Issue #104: a dead seat is not selectable on the Snake Charmer step, while
  // a living seat remains selectable; the engine keeps rejecting a dead target.
  await seedSnakeCharmerNight();
  await route("/table");
  assert.equal(await stepRole(), "snakecharmer");
  assert.equal(
    await page.locator('[data-target][data-id="1"]').isDisabled(),
    true,
    "the dead seat is disabled on the Snake Charmer step",
  );
  assert.equal(
    await page.locator('[data-target][data-id="2"]').isDisabled(),
    false,
    "a living seat stays selectable on the Snake Charmer step",
  );

  // Restore the seven-player game the rest of the script expects.
  await seed(7);
  await route("/table");

  // Issue #45: a rejected import renders its reason in the console banner.
  await page.locator('[data-act="import"]:visible').click();
  await page.waitForSelector("[data-import-text]");
  await page.locator("[data-import-text]").fill("not a game");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('[data-act="apply-import"]').click();
  await page.waitForSelector("[data-rejection]");
  assert.ok(
    (await page.locator("[data-rejection]").innerText()).trim().length > 0,
    "the rejected import shows a reason",
  );
  await page.locator('[data-act="close"]').first().click();
  await page.locator('[data-act="dismiss-rejection"]').click();
  assert.equal(await page.locator("[data-rejection]").count(), 0, "the reason is dismissible");

  // Regression: a stale table Escape listener must never act on another route.
  await route("/player");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".player-view").count(), 1);
  assert.equal(await page.locator(".host").count(), 0);
  assert.equal(
    await page.evaluate(() => location.pathname),
    "/pocket/player",
    "Escape on the handoff stays on the handoff",
  );
  // Issue #150: the console opens directly after a private route. No hide
  // control, no cover and no reveal step exist any more.
  await route("/table");
  assert.equal(await page.locator(".host").count(), 1, "the console opens directly");
  assert.equal(await page.locator('[data-act="hide"]').count(), 0, "no hide control");
  assert.equal(await page.locator('[data-act="reveal"]').count(), 0, "no reveal control");
  assert.equal(await page.locator('[aria-modal="true"]').count(), 0, "no overlay on mount");
  // Exercise extracted correction and export dialogs with real DOM interaction.
  await page.locator('[data-seat-open="1"]').click();
  await page.locator('[data-correct="kind"]').selectOption("role");
  await page.locator('[data-correct="role-value"]').selectOption("chef");
  await page.locator('[data-correct="reason"]').fill("Browser verification");
  await page.locator('[data-act="apply-correction"]').click();
  assert.equal(await page.locator('[aria-modal="true"]').count(), 0);
  await page.locator('[data-act="export"]:visible').first().click();
  assert.match(await page.locator("textarea[readonly]").inputValue(), /pocket-grimoire/);
  const exportDownload = page.waitForEvent("download");
  await page.locator('[data-act="download"]').click();
  assert.match(
    (await exportDownload).suggestedFilename(),
    /^grimoria-tb\.json$/,
    "game export file name",
  );
  await page.locator('[data-act="close"]').click();
  await finishNight();
  assert.equal(await page.locator("[data-virgin-form]").count(), 1);
  assert.equal(
    await page.locator('[data-act="end-day"]').isEnabled(),
    true,
    "the day transition button stays enabled",
  );
  assert.equal(
    await page.locator("[data-preview]").count(),
    1,
    "the day card shows its transition preview",
  );
  await page.locator("[data-virgin-form] select").selectOption("1");
  await page.locator("[data-virgin-form] button").click();
  assert.equal(
    await page.evaluate(async () => (await window.PG_MODULES()).store.state.day.execution.cause),
    "virgin",
  );
  await page.reload();
  await page.waitForSelector(".host");
  assert.equal(
    await page.evaluate(async () => (await window.PG_MODULES()).store.state.players["1"].name),
    "Alice",
  );

  // A public tab is read-only and updates live.
  const publicPage = await context.newPage();
  await publicPage.goto(url + "#/public");
  await publicPage.waitForSelector(".public");
  await page.evaluate(async () => {
    const store = (await window.PG_MODULES()).store;
    store.run((game) => {
      game.players["2"].alive = false;
      return { ok: true };
    });
  });
  await publicPage.waitForFunction(
    () => document.querySelector(".public-count b").textContent === "5",
  );
  assert.equal(await publicPage.locator(".host-role, .host-bluffs, .host-notes").count(), 0);
  await publicPage.close();

  // A bluff token opens the role card, and notes follow the store when another
  // game replaces this one.
  await page.locator(".host-bluffs [data-role-card]").first().click();
  assert.equal(
    await page.locator('[aria-modal="true"]').count(),
    1,
    "a bluff token opens the role card",
  );
  await page.locator('[data-act="close"]').click();
  await page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    const next = structuredClone(store.state);
    next.notes = "External note";
    store.replaceState(next);
  });
  await page.waitForFunction(
    () => document.querySelector("[data-notes]")?.value === "External note",
    undefined,
    { timeout: 3000 },
  );

  // Finish the seven-player game, including the review gate.
  await page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    const next = structuredClone(store.state);
    next.effects.push({
      id: "browser-cerenovus-review",
      kind: "madness",
      madness: "cerenovus",
      roleId: "clockmaker",
      sourceId: "6",
      targetId: "2",
      start: { phase: "night", number: 1 },
      expires: { phase: "night", number: 2 },
      active: true,
    });
    store.replaceState(next);
  });
  await page.waitForSelector('[data-madness-review] [data-madness-status="pending"]');
  await page.locator('[data-act="end-day"]').click();
  assert.match(
    await page.locator("[data-preview-reason]").textContent(),
    /Review every active madness effect/,
    "the engine preview blocks a day with an unreviewed madness effect",
  );
  await page.locator('[data-madness-reason="2"]').fill("Player stayed convincingly mad.");
  await page.locator('[data-madness-action="none"]').click();
  await page.waitForSelector('[data-madness-review] [data-madness-status="reviewed"]');
  assert.equal(
    await page.evaluate(async () => {
      const { store } = await window.PG_MODULES();
      return store.state.effects.find((effect) => effect.id === "browser-cerenovus-review")
        ?.decidedPenalty;
    }),
    "none",
    "the Storyteller's review is stored on the madness effect",
  );
  await page.locator('[data-act="end-day"]').click();
  await finishNight();
  await page.locator("[data-exec-target]").selectOption("7");
  await page.locator('[data-act="execute-direct"]').click();
  assert.equal(await page.locator(".host-review").count(), 0);
  await page.locator('[data-act="review"]').click();
  assert.equal(await page.locator(".host-review").count(), 1);

  // Privacy projection and interrupted role timer cannot overwrite another route.
  await seed(7, "deal");
  await route("/player");
  assert.equal(await page.locator(".player-card").count(), 0);
  // A publish outside the screen refreshes the picker without navigation.
  await page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    const next = structuredClone(store.state);
    next.players["2"].claimed = true;
    store.replaceState(next);
  });
  await page.waitForFunction(() => document.querySelector('[data-seat="1"]') === null, undefined, {
    timeout: 3000,
  });
  await page.locator('[data-seat="0"]').click();
  assert.equal(
    await page.locator(".player-card").count(),
    1,
    "the number tap reveals the role card",
  );
  assert.equal(await page.locator(".player-role-name").count(), 1);
  await page.locator("#player-name").fill("Alice");
  await page.locator(".player-save").click();
  assert.equal(
    await page.locator(".player-card").count(),
    0,
    "the role card hides after saving the name",
  );
  assert.equal(
    await page.locator(".player-numbers").count(),
    1,
    "the number picker returns after saving the name",
  );
  await page.locator('[data-act="back"]').click();
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => !!document.activeElement.closest('[aria-modal="true"]')),
    true,
  );
  await page.locator('[data-act="back-cancel"]').click();
  await route("/help");
  await page.clock.install();
  await page.clock.fastForward(46000);
  assert.equal(await page.locator(".player-card, .host").count(), 0);
  await page.clock.resume();
  await route("/player");
  await route("/bag");
  assert.equal(
    await page.locator("#return-host").count(),
    0,
    "a setup route opens without a hand-back cover",
  );
  await page.waitForSelector(".setup");

  // The seat ring follows the store for names, but a publish never replaces an
  // order the host is editing.
  await seed(7, "seat");
  await route("/seat");
  await page.waitForSelector('.seat-item[data-index="0"]');
  await page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    const next = structuredClone(store.state);
    next.players["1"].name = "Zed";
    store.replaceState(next);
  });
  await page.waitForFunction(
    () => document.querySelector('.seat-item[data-index="0"] .seat-name')?.textContent === "Zed",
    undefined,
    { timeout: 3000 },
  );
  await page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    const next = structuredClone(store.state);
    next.order = next.order.slice().reverse();
    store.replaceState(next);
  });
  await page.waitForTimeout(200);
  assert.equal(
    await page.locator('.seat-item[data-index="0"] .seat-name').textContent(),
    "Zed",
    "a publish keeps the seat draft",
  );

  // Regression: dragging a seat onto another must swap them, and enter undo.
  await seed(7, "seat");
  await route("/seat");
  await page.waitForSelector('.seat-item[data-index="0"]');
  const seatNames = () =>
    page
      .locator(".seat-item .seat-name")
      .evaluateAll((nodes) => nodes.map((node) => node.textContent));
  const beforeDrag = await seatNames();
  const beforeIds = await page.evaluate(async () =>
    (await window.PG_MODULES()).store.state.order.slice(),
  );
  assert.equal(
    await page.locator("aside .seat-actions").count(),
    0,
    "the left rail keeps no action block",
  );
  const seatRingBox = await page.locator("#seat-ring").boundingBox();
  const seatBarBox = await page.locator(".seat-actions").boundingBox();
  assert.ok(
    seatRingBox && seatBarBox && seatBarBox.y > seatRingBox.y,
    "the actions render under the ring",
  );
  assert.equal(
    await page.locator('#screen main a[href$="/player"]').count(),
    1,
    "one player control remains",
  );
  assert.equal(
    await page.locator('#screen main a[href$="/secrets"]').count(),
    0,
    "the seat screen keeps no secrets shortcut",
  );
  await page.locator("#seat-ring").scrollIntoViewIfNeeded();
  const dragFrom = await page.locator('.seat-item[data-index="0"]').boundingBox();
  const dragTo = await page.locator('.seat-item[data-index="2"]').boundingBox();
  assert.ok(dragFrom && dragTo, "the ring renders the dragged seat and the target");
  await page.mouse.move(dragFrom.x + dragFrom.width / 2, dragFrom.y + dragFrom.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragTo.x + dragTo.width / 2, dragTo.y + dragTo.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  assert.deepEqual(
    await seatNames(),
    [beforeDrag[2], beforeDrag[1], beforeDrag[0], ...beforeDrag.slice(3)],
    "a drag swaps the picked seat with the drop target",
  );
  assert.equal(
    await page.locator(".seat-item.is-selected").count(),
    0,
    "a drag leaves no seat selected",
  );
  assert.equal(
    (await page.locator(".seat-status").textContent())?.trim(),
    `${beforeDrag[0]} now sits at seat 3.`,
    "the drag announces the arriving player",
  );
  assert.equal(
    await page.locator('[data-act="undo"]').isDisabled(),
    false,
    "a drag enters the undo history",
  );
  await page.locator('[data-act="undo"]').click();
  assert.deepEqual(await seatNames(), beforeDrag, "undo restores the dragged order");

  // Click pairing swaps the same way and announces the arriving player.
  await page.locator('.seat-item[data-index="0"]').click();
  await page.locator('.seat-item[data-index="2"]').click();
  assert.deepEqual(
    await seatNames(),
    [beforeDrag[2], beforeDrag[1], beforeDrag[0], ...beforeDrag.slice(3)],
    "clicking two seats swaps them",
  );
  assert.equal(
    (await page.locator(".seat-status").textContent())?.trim(),
    `${beforeDrag[0]} now sits at seat 3.`,
    "the click swap announces the arriving player",
  );

  const clickedOrder = [beforeDrag[2], beforeDrag[1], beforeDrag[0], ...beforeDrag.slice(3)];

  // The history is a stack: two swaps, two undos return to the click swap.
  await page.locator('.seat-item[data-index="0"]').click();
  await page.locator('.seat-item[data-index="1"]').click();
  await page.locator('.seat-item[data-index="2"]').click();
  await page.locator('.seat-item[data-index="3"]').click();
  await page.locator('[data-act="undo"]').click();
  await page.locator('[data-act="undo"]').click();
  assert.deepEqual(await seatNames(), clickedOrder, "two undos restore two swaps");

  // Shuffle reorders the draft (retry once for the identity permutation) and
  // undo restores it.
  await page.locator('[data-act="shuffle"]').click();
  let shuffledOrder = await seatNames();
  if (JSON.stringify(shuffledOrder) === JSON.stringify(clickedOrder)) {
    await page.locator('[data-act="undo"]').click();
    await page.locator('[data-act="shuffle"]').click();
    shuffledOrder = await seatNames();
  }
  assert.notDeepEqual(shuffledOrder, clickedOrder, "shuffle reorders the draft");
  assert.equal((await page.locator(".seat-status").textContent())?.trim(), "Seats shuffled.");
  assert.equal(
    await page.locator('[data-act="undo"]').isDisabled(),
    false,
    "shuffle enters the history",
  );
  await page.locator('[data-act="undo"]').click();
  assert.deepEqual(await seatNames(), clickedOrder, "undo restores the shuffled order");

  // A language switch must not remount the screen and lose the draft.
  const seatLang = await page.evaluate(() => document.documentElement.lang);
  const otherLang = seatLang === "en" ? "ru" : "en";
  await chooseLanguage(otherLang);
  await page.waitForFunction((lang) => document.documentElement.lang === lang, otherLang);
  assert.equal(
    (await page.locator(".seat-title > span").first().textContent())?.trim(),
    otherLang === "ru" ? "Порядок мест" : "Seat order",
    "the language switch translates the screen",
  );
  await page.waitForFunction(
    (expected) =>
      JSON.stringify(
        [...document.querySelectorAll(".seat-item .seat-name")].map((node) => node.textContent),
      ) === JSON.stringify(expected),
    clickedOrder,
  );
  assert.equal(
    await page.locator('[data-act="undo"]').isDisabled(),
    false,
    "the draft and its history survive a language switch",
  );

  // The use action is the only commit; it routes to the table when the phase
  // is not "seat". The saved order must equal the order on the ring.
  const displayedNames = await seatNames();
  const displayedIds = await page.evaluate(async (names) => {
    const { store } = await window.PG_MODULES();
    const byName = new Map(
      Object.entries(store.state.players).map(([id, player]) => [player.name, id]),
    );
    return names.map((name) => byName.get(name));
  }, displayedNames);
  await page.locator('[data-act="use"]').click();
  await page.waitForFunction(() => document.body.dataset.route === "table");
  const savedOrder = await page.evaluate(async () =>
    (await window.PG_MODULES()).store.state.order.slice(),
  );
  assert.deepEqual(
    savedOrder,
    [beforeIds[2], beforeIds[1], beforeIds[0], ...beforeIds.slice(3)],
    "the use action commits the draft",
  );
  assert.deepEqual(savedOrder, displayedIds, "the saved order equals the displayed order");
  const savedSeats = await page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    return store.state.order.map((id) => store.state.players[id]?.seat);
  });
  assert.deepEqual(
    savedSeats,
    displayedIds.map((_, index) => index + 1),
    "each player seat matches its position",
  );
  await route("/seat");
  await page.waitForSelector('.seat-item[data-index="0"]');
  assert.deepEqual(await seatNames(), displayedNames, "the ring shows the committed order");

  // The action dock wraps at a phone width without shrinking its controls.
  await page.setViewportSize({ width: 390, height: 844 });
  await route("/seat");
  await page.waitForSelector('.seat-item[data-index="0"]');
  await overflow();
  const actionHeights = await page
    .locator(".seat-actions .btn")
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.equal(actionHeights.length, 4, "four actions render in the dock");
  assert.deepEqual(
    actionHeights.filter((height) => height < 44),
    [],
    "every action is at least 44 pixels high",
  );
  await page.setViewportSize({ width: 1440, height: 900 });

  // Full night/day transition at tablet size using a 12-player game.
  await page.setViewportSize({ width: 1024, height: 900 });
  await route("/table");
  await seed(12);
  await finishNight();
  await overflow();
  await page.locator('[data-act="end-day"]').click();
  await page.screenshot({ path: join(screenshots, "tablet-night.png"), fullPage: true });
  for (const lang of ["ru", "en", "az"]) {
    await chooseLanguage(lang);
    await overflow();
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await overflow();
  await page.screenshot({ path: join(screenshots, "phone-az.png"), fullPage: true });

  // All production routes and locale sheets remain usable at narrow and wide sizes.
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      "/bag",
      "/seat",
      "/secrets",
      "/help",
      "/sheet/en",
      "/sheet/ru",
      "/sheet/az",
      "/demo",
      "/table",
    ]) {
      await page.evaluate((path) => {
        history.pushState(null, "", path);
        dispatchEvent(new PopStateEvent("popstate"));
      }, "/pocket" + path);
      const marker = { "/bag": ".setup", "/seat": ".seat-ring", "/secrets": ".secrets-head" }[path];
      if (marker) await page.waitForSelector(marker);
      await page.waitForTimeout(80);
      await overflow();
    }
  }

  // Mobile app bar menu (issue #141): one burger below 900 px, the inline list
  // at desktop, and the same panel on the string-composed screens.
  await page.setViewportSize({ width: 390, height: 844 });
  await route("/table");
  await page.waitForSelector(".host");
  const menuToggle = page.locator("[data-app-bar-toggle]");
  const menuPanel = page.locator("[data-app-bar-menu]");
  assert.equal(await menuToggle.isVisible(), true, "the burger renders at 390 px");
  assert.equal(await menuPanel.isVisible(), false, "the menu starts closed");
  assert.equal(await menuToggle.getAttribute("aria-expanded"), "false");
  await menuToggle.click();
  assert.equal(await menuToggle.getAttribute("aria-expanded"), "true");
  assert.equal(await menuPanel.isVisible(), true);
  assert.equal(
    await menuPanel.locator(".lang-switch").isVisible(),
    true,
    "the language switch lives in the panel",
  );
  const menuHrefs = await menuPanel
    .locator("a")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") || ""));
  for (const name of ["table", "bag", "seat", "secrets", "player", "sheet", "public", "help"]) {
    assert.ok(
      menuHrefs.some((href) => href.endsWith("/" + name)),
      `the panel links /${name}: ${JSON.stringify(menuHrefs)}`,
    );
  }
  const gameBeforeMenu = await page.evaluate(() => localStorage.getItem("pg.game.v4"));
  await page.keyboard.press("Escape");
  assert.equal(await menuToggle.getAttribute("aria-expanded"), "false", "Escape closes the menu");
  assert.equal(await menuPanel.isVisible(), false);
  assert.equal(
    await page.evaluate(() => document.activeElement?.hasAttribute("data-app-bar-toggle")),
    true,
    "Escape returns focus to the toggle",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("pg.game.v4")),
    gameBeforeMenu,
    "the menu never writes the game",
  );
  await menuToggle.click();
  await page.evaluate(() =>
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
  );
  assert.equal(await menuPanel.isVisible(), false, "an outside press closes the menu");
  await menuToggle.click();
  await menuPanel.locator('a[href$="/bag"]').click();
  await page.waitForSelector(".setup");
  assert.equal(
    await page.locator("[data-app-bar-toggle]").getAttribute("aria-expanded"),
    "false",
    "the next screen starts closed",
  );
  assert.equal(await page.locator("[data-app-bar-menu]").isVisible(), false);

  await page.setViewportSize({ width: 360, height: 640 });
  await route("/table");
  await page.waitForSelector(".host");
  await page.locator("[data-app-bar-toggle]").click();
  await overflow();
  const menuRows = await page
    .locator("[data-app-bar-menu] a")
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  assert.ok(
    menuRows.every((height) => height >= 44),
    "every menu row is 44 px: " + JSON.stringify(menuRows),
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await route("/table");
  await page.waitForSelector(".host");
  assert.equal(
    await page.locator("[data-app-bar-toggle]").isVisible(),
    false,
    "no burger at desktop",
  );
  assert.equal(
    await page.locator("[data-app-bar-menu]").isVisible(),
    true,
    "the inline navigation stays visible",
  );
  assert.equal(await page.locator("[data-app-bar-menu] .lang-switch").isVisible(), true);
  assert.ok((await page.locator("[data-app-bar-menu] a").count()) >= 8);

  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/help", "/demo"]) {
    await route(path);
    await page.waitForSelector("#screen > *");
    assert.equal(
      await page.locator("[data-app-bar-toggle]").isVisible(),
      true,
      `${path} renders the burger`,
    );
    await page.locator("[data-app-bar-toggle]").click();
    assert.equal(
      await page.locator("[data-app-bar-menu]").isVisible(),
      true,
      `${path} opens the panel`,
    );
    assert.equal(
      await page.locator("[data-app-bar-menu] .lang-switch").isVisible(),
      true,
      `${path} keeps the language control in the panel`,
    );
    await page.keyboard.press("Escape");
    if (path === "/demo") {
      await page.locator('[data-act="next"]').click();
      await page.locator("[data-app-bar-toggle]").click();
      assert.equal(
        await page.locator("[data-app-bar-menu]").isVisible(),
        true,
        "the demo re-render keeps the menu usable",
      );
      await page.keyboard.press("Escape");
    }
  }
  await route("/help");
  await page.waitForSelector("#screen > *");
  await page.locator("[data-app-bar-toggle]").click();
  await page.locator("[data-app-bar-menu] .lang-switch").selectOption("en");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  assert.equal(
    new URL(page.url()).pathname.endsWith("/help"),
    true,
    "the panel language change keeps the route",
  );
  await page.keyboard.press("Escape");

  await route("/public");
  await page.waitForSelector(".public");
  assert.equal(
    await page.locator("[data-app-bar-toggle]").count(),
    0,
    "the public screen has no burger",
  );
  assert.equal(await page.locator("[data-app-bar-menu]").count(), 0);
  assert.equal(await page.locator(".lang-switch").isVisible(), true);

  // Role sheet scenario selector (issue #14): edition filtering, a separate
  // Travellers toggle, language/reload persistence and game-state isolation.
  await page.setViewportSize({ width: 390, height: 844 });
  const sheetGame = await page.evaluate(async () => {
    const { KEY } = (await window.PG_MODULES()).store;
    return localStorage.getItem(KEY);
  });
  const sheetTeamCounts = () =>
    page
      .locator(".sheet-team")
      .evaluateAll((nodes) =>
        Object.fromEntries(
          nodes.map((node) => [
            node.dataset.team,
            Number(node.querySelector(".sheet-team-count").textContent),
          ]),
        ),
      );
  await sheetRoute("/sheet/en");
  await page.waitForSelector(".sheet-page");
  assert.equal(
    await page.locator('[data-scenario="tb"]').getAttribute("aria-pressed"),
    "true",
    "the sheet defaults to the active Trouble Brewing game",
  );
  assert.equal(await page.locator(".sheet-role").count(), 22, "Trouble Brewing shows its 22 roles");
  assert.deepEqual(await sheetTeamCounts(), { townsfolk: 13, outsider: 4, minion: 4, demon: 1 });
  assert.equal(
    await page.locator(".sheet-team[data-team='traveller']").count(),
    0,
    "Travellers stay out of the scenario count",
  );
  assert.match(
    await page.locator("[data-sheet-summary]").textContent(),
    /Trouble Brewing · 22 roles/,
  );
  await overflow();

  await page.locator('[data-scenario="bmr"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".sheet-role").length === 25);
  assert.deepEqual(await sheetTeamCounts(), { townsfolk: 13, outsider: 4, minion: 4, demon: 4 });
  assert.equal(
    await page.locator('[data-role-id="mayor"]').count(),
    0,
    "Trouble Brewing roles leave the Bad Moon Rising sheet",
  );
  assert.equal(await page.locator('[data-role-id="chambermaid"]').count(), 1);
  assert.match(
    await page.locator("[data-sheet-summary]").textContent(),
    /Bad Moon Rising · 25 roles/,
  );
  await overflow();

  await page.locator('[data-scenario="snv"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".sheet-role").length === 25);
  assert.deepEqual(await sheetTeamCounts(), { townsfolk: 13, outsider: 4, minion: 4, demon: 4 });
  assert.equal(await page.locator('[data-role-id="clockmaker"]').count(), 1);
  assert.equal(await page.locator('[data-role-id="chambermaid"]').count(), 0);
  assert.match(
    await page.locator("[data-sheet-summary]").textContent(),
    /Sects and Violets · 25 roles/,
  );

  await page.locator('[data-scenario="all"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".sheet-role").length === 72);
  assert.deepEqual(await sheetTeamCounts(), { townsfolk: 39, outsider: 12, minion: 12, demon: 9 });
  assert.equal(await page.locator('[data-role-id="mayor"]').count(), 1);
  assert.equal(await page.locator("[data-travellers]").getAttribute("aria-pressed"), "false");

  // Native buttons keep the filter keyboard-operable.
  await page.locator('[data-scenario="tb"]').focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelectorAll(".sheet-role").length === 22);
  assert.equal(await page.locator('[data-scenario="tb"]').getAttribute("aria-pressed"), "true");

  // Travellers are a separate, explicitly labelled section, not a fifth team.
  await page.locator("[data-travellers]").click();
  await page.waitForSelector(".sheet-travellers");
  assert.equal(
    await page.locator(".sheet-sections > .sheet-team").count(),
    4,
    "Travellers are not mixed into the scenario teams",
  );
  assert.equal(await page.locator(".sheet-travellers .sheet-team-count").textContent(), "5");
  assert.equal(await page.locator(".sheet-travellers .sheet-role").count(), 5);
  assert.match(
    await page.locator(".sheet-travellers-note").textContent(),
    /Outside the selected scenario/,
  );
  assert.equal(await page.locator("[data-travellers]").getAttribute("aria-pressed"), "true");
  await overflow();

  // The app bar menu is the only navigation surface: the sheet header carries
  // no route link and no language control of its own (issue #151).
  assert.equal(
    await page.locator(".sheet-head a").count(),
    0,
    "the sheet header repeats no navigation",
  );
  await page.locator("[data-app-bar-toggle]").click();
  await page.locator("[data-app-bar-menu]").waitFor({ state: "visible" });
  assert.equal(
    await page.locator('[data-app-bar-menu] a[href$="/table"]').count(),
    1,
    "the panel carries the table link",
  );
  assert.equal(
    await page.locator('[data-app-bar-menu] a[href$="/help"]').count(),
    1,
    "the panel carries the Help link",
  );
  assert.equal(
    await page.locator("[data-app-bar-menu] .lang-switch").isVisible(),
    true,
    "the panel carries the language control",
  );
  await page.keyboard.press("Escape");

  // Language switching and reload keep both preferences.
  await page.locator('[data-scenario="bmr"]').click();
  await page.waitForFunction(
    () => document.querySelectorAll(".sheet-sections > .sheet-team").length === 4,
  );
  for (const [lang, allLabel, travellersLabel] of [
    ["ru", "Все сценарии", "Странники"],
    ["az", "Bütün ssenarilər", "Səyahətçilər"],
  ]) {
    await chooseLanguage(lang);
    await page.waitForFunction(
      (code) =>
        document.documentElement.lang === code && location.pathname.endsWith("/sheet/" + code),
      lang,
    );
    assert.equal(
      await page.locator('[data-scenario="bmr"]').getAttribute("aria-pressed"),
      "true",
      `the scenario survives ${lang}`,
    );
    assert.equal(
      await page.locator("[data-travellers]").getAttribute("aria-pressed"),
      "true",
      `the Travellers toggle survives ${lang}`,
    );
    assert.match(await page.locator('[data-scenario="all"]').textContent(), new RegExp(allLabel));
    assert.match(
      await page.locator("[data-travellers]").textContent(),
      new RegExp(travellersLabel),
    );
    assert.equal(await page.locator(".sheet-role").count(), 30, "25 BMR + 5 Travellers");
    await overflow();
  }
  await page.reload();
  await page.waitForSelector(".sheet-page");
  await page.waitForFunction(() => document.body.dataset.route === "sheet");
  assert.equal(
    await page.locator('[data-scenario="bmr"]').getAttribute("aria-pressed"),
    "true",
    "the scenario survives a reload",
  );
  assert.equal(
    await page.locator("[data-travellers]").getAttribute("aria-pressed"),
    "true",
    "the Travellers toggle survives a reload",
  );
  assert.equal(await page.locator(".sheet-role").count(), 30);
  await overflow();

  // The filter is a UI preference: the saved game stays byte-for-byte intact.
  assert.equal(
    await page.evaluate(async () => {
      const { KEY } = (await window.PG_MODULES()).store;
      return localStorage.getItem(KEY);
    }),
    sheetGame,
    "the sheet filter must not write the saved game",
  );
  assert.equal(await page.evaluate(() => localStorage.getItem("pg.sheetScenario")), "bmr");

  // Native sheet: role counts per language, the Travellers section, route
  // disposal in both directions and no write to the saved game.
  for (const code of ["ru", "en", "az"]) {
    // The sheet reads the scenario preference at mount; leave the route so it
    // remounts with the preference set below.
    await route("/table");
    await page.evaluate(() => {
      localStorage.setItem("pg.sheetScenario", "all");
      localStorage.setItem("pg.sheetTravellers", "false");
    });
    await sheetRoute(`/sheet/${code}`);
    await page.waitForSelector(".sheet-page");
    await page.waitForFunction((lang) => document.documentElement.lang === lang, code);
    await page.waitForFunction(() => document.querySelectorAll(".sheet-role").length === 72);
    assert.equal(
      await page.locator(".sheet-sections > .sheet-team").count(),
      4,
      `${code}: four standard teams`,
    );
    assert.equal(
      await page.locator(".sheet-travellers").count(),
      0,
      `${code}: Travellers start hidden`,
    );
    assert.equal(await page.locator("[data-travellers]").getAttribute("aria-pressed"), "false");
    await page.locator("[data-travellers]").click();
    await page.waitForSelector(".sheet-travellers");
    assert.equal(
      await page.locator(".sheet-travellers .sheet-role").count(),
      5,
      `${code}: five Travellers`,
    );
    assert.equal(
      await page.locator(".sheet-role").count(),
      77,
      `${code}: 72 standard roles and 5 Travellers`,
    );
    assert.equal(
      await page.locator(".sheet-sections > .sheet-team").count(),
      4,
      `${code}: Travellers stay separate`,
    );
    await sheetLegibility([320, 360, 390, 768, 1280, 1440]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(60);
    await overflow();
  }
  assert.equal(
    await page.evaluate(async () => {
      const { KEY } = (await window.PG_MODULES()).store;
      return localStorage.getItem(KEY);
    }),
    sheetGame,
    "the native sheet never writes the saved game",
  );

  await sheetRoute("/sheet/en");
  await page.waitForSelector(".sheet-page");
  await route("/table");
  await page.waitForSelector(".host");
  assert.equal(await page.locator(".sheet-page").count(), 0, "leaving the sheet unmounts it");
  await sheetRoute("/sheet/en");
  await page.waitForSelector(".sheet-page");
  assert.equal(await page.locator(".host").count(), 0, "the sheet disposes the previous screen");

  // One stylesheet ships from the origin, and the document surface still
  // carries the pre-migration typography. The per-element comparison against
  // the recorded baseline lives in scripts/style-parity.mjs.
  await route("/table");
  await page.waitForSelector(".host");
  assert.equal(
    await page.evaluate(() => document.querySelectorAll("link[rel='stylesheet']").length),
    1,
    "the document loads one stylesheet",
  );
  const surface = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return {
      fontSize: body.fontSize,
      lineHeight: body.lineHeight,
      fontFamily: body.fontFamily,
      margin: body.margin,
    };
  });
  assert.equal(surface.fontSize, "14px", "the body font size is unchanged");
  assert.equal(surface.lineHeight, "20.3px", "the body line height is unchanged");
  assert.match(surface.fontFamily, /Inter/, "the body font family is unchanged");
  assert.equal(surface.margin, "0px", "the base layer keeps the margin reset");

  // Shared dialog contract: focus in, Escape, overlay and close control,
  // focus restore, accessible name, aria-modal and a 390 px viewport.
  await page.evaluate(async () => {
    const container = document.createElement("div");
    container.id = "dialog-probe";
    container.style.cssText = "position:fixed;left:4px;top:4px;z-index:900";
    document.body.append(container);
    window.__dialogProbe = (await window.PG_MODULES()).probe.mountDialogProbe(container);
  });
  const dialog = page.locator("[role='dialog']");
  await page.locator("#probe-open").click();
  await dialog.waitFor();
  assert.equal(
    await dialog.getAttribute("aria-modal"),
    "true",
    "the dialog is modal for assistive technology",
  );
  assert.equal(
    await page.evaluate(() => {
      const element = document.querySelector("[role='dialog']");
      const labelledBy = element.getAttribute("aria-labelledby");
      return labelledBy ? document.getElementById(labelledBy).textContent : null;
    }),
    "Probe dialog",
    "the dialog has an accessible name",
  );
  assert.equal(
    await page.evaluate(() =>
      document.querySelector("[role='dialog']").contains(document.activeElement),
    ),
    true,
    "focus moves inside the dialog",
  );
  const dialogBox = await dialog.boundingBox();
  assert.ok(
    dialogBox && dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 390,
    "the dialog fits a 390 px viewport: " + JSON.stringify(dialogBox),
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.id === "probe-open", undefined, {
    timeout: 2000,
  });
  await page.locator("#probe-open").click();
  await dialog.waitFor();
  await page.locator("[data-shell-overlay]").click({ position: { x: 380, y: 4 } });
  await dialog.waitFor({ state: "detached" });
  await page.waitForFunction(
    () => document.activeElement?.id === "probe-open",
    undefined,
    { timeout: 2000 },
    { message: "the overlay restores focus" },
  );
  await page.locator("#probe-open").click();
  await dialog.waitFor();
  await page.getByRole("button", { name: "Close probe" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.id === "probe-open", undefined, {
    timeout: 2000,
  });
  await page.evaluate(() => {
    window.__dialogProbe?.();
    document.getElementById("dialog-probe")?.remove();
    delete window.__dialogProbe;
  });

  const saved = await page.evaluate(async () => {
    const { KEY } = (await window.PG_MODULES()).store;
    return localStorage.getItem(KEY);
  });
  await route("/demo");
  for (let i = 0; i < 20 && (await page.locator('[data-act="next"]:not(:disabled)').count()); i++) {
    await page.locator('[data-act="next"]').click();
  }
  assert.equal(
    await page.evaluate(async () => {
      const { KEY } = (await window.PG_MODULES()).store;
      return localStorage.getItem(KEY);
    }),
    saved,
    "demo must not change the saved game",
  );
  await route("/table");

  // Project-subpath offline bootstrap, including dynamically imported engine modules.
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.getRegistration())?.active,
    { timeout: 30000 },
  );
  await page.reload();
  await page.waitForSelector(".host");
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector(".host");
  await chooseLanguage("en");
  assert.equal(await page.locator(".host-main").count(), 1);
  await finishNight();
  await page.locator("[data-exec-target]").selectOption("12");
  await page.locator('[data-act="execute-direct"]').click();
  assert.equal(
    await page.evaluate(async () => (await window.PG_MODULES()).store.state.players["11"].roleId),
    "imp",
  );
  await page.locator('[data-act="end-day"]').click();
  await finishNight();
  await page.locator("[data-exec-target]").selectOption("11");
  await page.locator('[data-act="execute-direct"]').click();
  assert.equal(
    await page.evaluate(async () => (await window.PG_MODULES()).store.state.winner?.team),
    "good",
  );
  await context.setOffline(false);

  // Fast update (issue #156): the app checks for a deploy as soon as it opens,
  // applies what that check installs without a prompt, and never lets a failed
  // save hold the update back. A deploy found while the page stays open keeps
  // the prompt.
  const swSource = await readFile(join(dist, "sw.js"), "utf8");
  const baseCache = /const CACHE = "([^"]+)";/.exec(swSource)[1];
  const versionSource = (cache) => swSource.replace(baseCache, cache);
  const nextCache = "pg-static-browsercheck-v2";
  const thirdCache = "pg-static-browsercheck-v3";
  const fourthCache = "pg-static-browsercheck-v4";
  const fifthCache = "pg-static-browsercheck-v5";
  // An automatic reload can destroy the document mid-read, so both readers retry
  // until the page settles.
  const readPage = async (target, read) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        return await target.evaluate(read);
      } catch {
        await target.waitForTimeout(200);
      }
    }
    throw new Error("the page kept navigating");
  };
  const workerVersion = (target = page) =>
    readPage(
      target,
      () =>
        new Promise((done) => {
          const controller = navigator.serviceWorker.controller;
          if (!controller) {
            done(null);
            return;
          }
          const channel = new MessageChannel();
          channel.port1.onmessage = (event) => done(event.data && event.data.version);
          controller.postMessage({ type: "GET_VERSION" }, [channel.port2]);
          setTimeout(() => done(null), 2000);
        }),
    );
  const loadCount = (target = page) =>
    readPage(target, () => Number(sessionStorage.getItem("pg-test-loads") || "0"));
  // Publish a worker without asking the page to look for it: only the opening
  // check can find this one.
  const publish = (cache) => {
    releaseOverride = versionSource(cache);
  };
  const deploy = async (cache) => {
    publish(cache);
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg.update();
    });
    await page.waitForFunction(
      async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
      { timeout: 20000 },
    );
    await page.waitForSelector("#update-banner:not([hidden])");
  };
  const waitForLoads = (target, expected) =>
    target.waitForFunction(
      (count) => Number(sessionStorage.getItem("pg-test-loads") || "0") >= count,
      expected,
      { timeout: 30000 },
    );
  // Waits until the page runs `cache` and stops reloading. The controller can
  // report the new version on the document that activated it, before the reload
  // that follows lands, so the load count must hold still as well.
  const settle = async (target, cache) => {
    let stable = 0;
    let previous = -1;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      let version = null;
      let loads = null;
      try {
        version = await workerVersion(target);
        loads = await loadCount(target);
      } catch {
        /* a navigation is in flight */
      }
      if (version === cache && loads !== null && loads === previous) {
        stable += 1;
        if (stable >= 2) return loads;
      } else {
        stable = 0;
      }
      if (loads !== null) previous = loads;
      await target.waitForTimeout(200);
    }
    throw new Error(`the page never settled on ${cache}`);
  };

  await page.setViewportSize({ width: 390, height: 844 });
  await route("/table");
  await seed(7);
  await chooseLanguage("en");
  assert.equal(
    await page.locator("#update-banner").isVisible(),
    false,
    "no prompt without a waiting worker",
  );
  assert.equal(await workerVersion(), baseCache);

  // Offline clients keep running the cached app; returning online checks again.
  await context.setOffline(true);
  await page.waitForFunction(() => navigator.onLine === false);
  publish(nextCache);
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
    false,
    "an offline client cannot install a new worker",
  );
  await context.setOffline(false);
  await page.waitForFunction(() => navigator.onLine === true);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
    { timeout: 15000 },
  );
  await page.waitForSelector("#update-banner:not([hidden])");
  assert.match(await page.locator("#update-message").textContent(), /update is ready/i);
  assert.equal(
    await workerVersion(),
    baseCache,
    "an installed update does not replace the running code",
  );
  const cachesDuringInstall = await page.evaluate(() => caches.keys());
  assert.ok(
    cachesDuringInstall.includes(baseCache),
    "the old cache remains active before confirmation",
  );
  assert.ok(cachesDuringInstall.includes(nextCache), "the new version is precached independently");
  await page.screenshot({ path: join(screenshots, "update-available-phone.png"), fullPage: true });

  // Later keeps the running code and the waiting worker.
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.locator("#update-later").click();
  assert.equal(await page.locator("#update-banner").isVisible(), false);
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(() => performance.timeOrigin),
    timeOrigin,
    "Later must not reload",
  );
  assert.equal(await workerVersion(), baseCache);
  assert.equal(
    await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
    true,
  );

  // Opening the page applies the waiting worker with no prompt. The browser can
  // activate it during the reload, before the new document exists, so the page
  // replaces itself at most once and the result is what gets asserted.
  const loadsBeforeOpen = await loadCount();
  await page.reload();
  const openingLoadCount = await settle(page, nextCache);
  await page.waitForSelector(".host");
  const openingLoads = openingLoadCount - loadsBeforeOpen;
  assert.ok(
    openingLoads >= 1 && openingLoads <= 2,
    `the opening load replaces itself at most once; loads ${openingLoads}`,
  );
  assert.equal(
    await page.locator("#update-banner").isVisible(),
    false,
    "an automatic update shows no prompt",
  );
  const cachesAfterUpdate = await page.evaluate(() => caches.keys());
  assert.ok(cachesAfterUpdate.includes(nextCache));
  assert.ok(!cachesAfterUpdate.includes(baseCache), "activation prunes the previous cache");
  assert.equal(
    await page.evaluate(async () => (await window.PG_MODULES()).store.state.players["1"].name),
    "Alice",
    "the saved game survives an automatic update",
  );

  // The opening check finds a deploy the page never asked about, without the
  // 30-minute throttle the old check waited for.
  const loadsBeforeCheck = await loadCount();
  publish(thirdCache);
  await page.reload();
  const checkLoadCount = await settle(page, thirdCache);
  await page.waitForSelector(".host");
  const checkLoads = checkLoadCount - loadsBeforeCheck;
  assert.ok(
    checkLoads >= 1 && checkLoads <= 2,
    `the opening check installs without a prompt; loads ${checkLoads}`,
  );
  assert.equal(await page.locator("#update-banner").isVisible(), false);

  // A deploy found while the page stays open waits for the host.
  await deploy(fourthCache);
  const loadsBeforeApply = await loadCount();
  await page.waitForTimeout(500);
  assert.equal(await loadCount(), loadsBeforeApply, "a later deploy does not reload by itself");
  assert.equal(
    await workerVersion(),
    thirdCache,
    "a later deploy does not replace the running code",
  );

  // A page still running the previous page code asks the waiting worker for its
  // save preflight before it sends SKIP_WAITING. The worker answers, so one
  // rollout covers clients that predate the fast-update change.
  assert.deepEqual(
    await page.evaluate(
      () =>
        new Promise((done) => {
          navigator.serviceWorker.getRegistration().then((reg) => {
            const worker = reg && reg.waiting;
            if (!worker) {
              done("no waiting worker");
              return;
            }
            const channel = new MessageChannel();
            const timer = setTimeout(() => done("no reply"), 5000);
            channel.port1.onmessage = (event) => {
              clearTimeout(timer);
              done(event.data);
            };
            worker.postMessage({ type: "PREPARE_UPDATE" }, [channel.port2]);
          });
        }),
    ),
    { ok: true, failed: 0, unconfirmed: 0 },
    "a page on the previous page code still gets a preflight reply",
  );

  // A window that cannot save must not hold the update back. The unsaved note is
  // lost, which this change accepts.
  await page.evaluate(async () => {
    const { KEY, state } = (await window.PG_MODULES()).store;
    state.notes = "Unsaved update note";
    window.__pgSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === KEY) throw new Error("Quota exceeded");
      return window.__pgSetItem.call(this, key, value);
    };
  });
  await page.locator("#update-now").click();
  await waitForLoads(page, loadsBeforeApply + 1);
  await page.waitForSelector(".host");
  await page.waitForTimeout(600);
  assert.equal(await workerVersion(), fourthCache, "a failed save does not stop activation");
  assert.equal(await page.locator("#update-banner").isVisible(), false);
  assert.notEqual(
    await page.evaluate(async () => (await window.PG_MODULES()).store.state.notes),
    "Unsaved update note",
    "the unsaved note is gone, as this change accepts",
  );
  await page.evaluate(() => {
    if (!window.__pgSetItem) return;
    Storage.prototype.setItem = window.__pgSetItem;
    delete window.__pgSetItem;
  });

  // Two windows reload once each, with no save coordination between them.
  const publicTab = await context.newPage();
  await publicTab.goto(url + "#/public");
  await publicTab.waitForSelector(".public");
  await deploy(fifthCache);
  await publicTab.waitForSelector("#update-banner:not([hidden])");
  const hostLoads = await loadCount();
  const publicLoads = await loadCount(publicTab);
  await page.locator("#update-now").click();
  await waitForLoads(page, hostLoads + 1);
  await page.waitForSelector(".host");
  await waitForLoads(publicTab, publicLoads + 1);
  await publicTab.waitForSelector(".public");
  await page.waitForTimeout(1200);
  assert.equal(await loadCount(), hostLoads + 1, "the applying window reloads exactly once");
  assert.equal(
    await loadCount(publicTab),
    publicLoads + 1,
    "the other window reloads exactly once",
  );
  assert.equal(await workerVersion(), fifthCache, "the new worker controls the reloaded app");
  assert.equal(await workerVersion(publicTab), fifthCache, "every window runs the new worker");
  await publicTab.close();

  // The pre-#11 client scenario needed the unbundled source tree. The worker
  // protocol it exercised (activation, cache pruning) is covered by
  // src/infrastructure/offline/offline-worker.test.ts, and the game survival of
  // an update is asserted above.
  releaseOverride = null;

  // Issue #46 — phone acceptance. A blank profile, no config file and no saved
  // bag registry: every screen from setup to the finale is reached by tapping
  // visible controls at 360x640 and 640x360, and each screen keeps its document
  // width and every link/button inside the viewport, unclipped and at least
  // 44x44.
  const auditPhone = async (tab, screen, route) => {
    const detail = await tab.evaluate(() => {
      const viewport = innerWidth;
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const describe = (el) =>
        `${el.tagName.toLowerCase()} ${el.dataset.act || el.dataset.panel || ""} ${(el.textContent || "").trim().slice(0, 24)}`;
      const controls = [
        ...document.querySelectorAll('#screen a[href], #screen button, #screen [role="button"]'),
      ].filter(visible);
      const outside = [];
      const undersized = [];
      const clipped = [];
      for (const control of controls) {
        const rect = control.getBoundingClientRect();
        if (rect.left < -0.5 || rect.right > viewport + 0.5)
          outside.push(`${describe(control)} [${Math.round(rect.left)},${Math.round(rect.right)}]`);
        if (Math.round(rect.width) < 44 || Math.round(rect.height) < 44)
          undersized.push(
            `${describe(control)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          );
        for (
          let parent = control.parentElement;
          parent && parent !== document.body;
          parent = parent.parentElement
        ) {
          const style = getComputedStyle(parent);
          if (style.overflowX !== "hidden" && style.overflowX !== "clip") continue;
          const box = parent.getBoundingClientRect();
          if (rect.left < box.left - 0.5 || rect.right > box.right + 0.5)
            clipped.push(
              `${describe(control)} clipped by .${String(parent.className).slice(0, 40)}`,
            );
          break;
        }
      }
      return {
        route: document.body.dataset.route,
        viewport,
        scrollWidth: document.documentElement.scrollWidth,
        outside,
        undersized,
        clipped,
      };
    });
    assert.equal(detail.route, route, `${screen}: route`);
    assert.equal(
      detail.scrollWidth <= detail.viewport,
      true,
      `${screen}: horizontal overflow ${JSON.stringify(detail)}`,
    );
    assert.deepEqual(detail.outside, [], `${screen}: controls outside the viewport`);
    assert.deepEqual(detail.undersized, [], `${screen}: controls below 44px`);
    assert.deepEqual(
      detail.clipped,
      [],
      `${screen}: controls clipped by an overflow-hidden ancestor`,
    );
  };

  const fillPhoneSecrets = async (tab) => {
    // The pair must include the player who really holds the role named by the
    // block heading; the Drunk-mask editor reuses the same slot, so it must be
    // filled through the heading too.
    for (const block of await tab.locator(".secrets-info").all()) {
      const roleSelect = block.locator("select[data-info-role]");
      if (!(await roleSelect.count())) continue;
      const heading = (
        await block
          .locator("h3")
          .innerText()
          .catch(() => "")
      ).trim();
      if (heading.includes(":")) continue;
      const pairA = block.locator('select[data-player^="pair-a"]');
      const pairB = block.locator('select[data-player^="pair-b"]');
      let roleValue = await roleSelect.inputValue();
      if (!roleValue) {
        const firstRole = await roleSelect
          .locator("option")
          .evaluateAll((nodes) => nodes.find((node) => node.value)?.value ?? "");
        if (!firstRole) continue;
        await roleSelect.selectOption(firstRole);
        await tab.waitForTimeout(120);
        roleValue = firstRole;
      }
      const currentA = await pairA.inputValue();
      const currentB = await pairB.inputValue().catch(() => "");
      if (currentA && currentB) continue;
      const roleText = await roleSelect
        .locator("option:checked")
        .innerText()
        .catch(() => "");
      const options = await pairA
        .locator("option")
        .evaluateAll((nodes) =>
          nodes.map((node) => ({ value: node.value, text: node.textContent.trim() })),
        );
      const trueRole = options.find((option) => option.value && option.text.includes(roleText));
      const first = trueRole?.value ?? options.find((option) => option.value)?.value ?? "";
      const second = options.find((option) => option.value && option.value !== first)?.value ?? "";
      if (first) await pairA.selectOption(first);
      await tab.waitForTimeout(120);
      if (second) await pairB.selectOption(second);
      await tab.waitForTimeout(120);
    }
    const herring = tab.locator("select[data-herring]");
    if (await herring.count()) {
      const good = await herring
        .locator("option")
        .evaluateAll((nodes) => nodes.map((node) => node.value).filter(Boolean));
      if (good.length) await herring.selectOption(good[0]);
    }
  };

  const finishPhoneNight = async (tab) => {
    for (let guard = 0; guard < 40; guard += 1) {
      if (await tab.locator('[data-act="end-night"]').count()) return;
      const targets = tab.locator("[data-target]:not(:disabled)");
      if (await targets.count()) {
        const mode = await tab.evaluate(async () => {
          const { state } = (await window.PG_MODULES()).store;
          const { currentStep } = (await window.PG_MODULES()).engine;
          return currentStep(state)?.targetMode ?? "one";
        });
        await targets.first().click();
        if (mode === "two") await tab.locator("[data-target]:not(:disabled)").nth(1).click();
        await tab.waitForTimeout(100);
      }
      const given = tab.locator("select[data-given]:visible");
      if (await given.count()) {
        const value = await given
          .locator("option")
          .evaluateAll((nodes) => nodes.find((node) => node.value)?.value);
        if (value) await given.selectOption(value);
      }
      const complete = tab.locator('[data-act="complete"]:visible');
      if ((await complete.count()) && (await complete.first().isEnabled())) {
        await complete.first().click();
      } else {
        const skip = tab.locator('[data-act="skip"]:visible');
        assert.ok(await skip.count(), "a night step exposes a control");
        await skip.first().click();
      }
      await tab.waitForTimeout(120);
    }
    throw new Error("the phone night did not end");
  };

  const walkPhone = async ({ width, height }) => {
    const label = `phone ${width}x${height}`;
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      isMobile: true,
    });
    // Same test-mode probe as the default context: the walk reads the current
    // step's target mode and the Imp's id, and every transition is still a tap.
    await context.addInitScript(() => {
      window.PG_MODULES = () => import("/pocket/test-entry.js");
    });
    const tab = await context.newPage();
    tab.on("pageerror", (error) => errors.push(error.message));
    try {
      const visited = [];
      const record = async (screen, route) => {
        await auditPhone(tab, `${label} ${screen}`, route);
        visited.push(screen);
      };

      await tab.goto(url + "table");
      await tab.waitForSelector("#screen > *");
      // No configuration or saved-bag registry: a new profile may hold only
      // the language preference before the first interaction.
      assert.deepEqual(
        await tab.evaluate(() => Object.keys(localStorage).sort()),
        ["pg.lang"],
        `${label}: a clean profile holds no config or registry`,
      );
      await record("setup", "table");

      await tab.locator('#screen a[href$="/bag"]:visible').first().click();
      await tab.waitForSelector(".setup");
      await record("bag", "bag");
      await tab.locator(".bag-preset-card [data-apply]").first().click();
      await tab.waitForFunction(() => !document.querySelector('[data-act="deal"]').disabled);
      await tab.locator('[data-act="deal"]').click();
      await tab.waitForSelector(".player-view");
      await record("player", "player");

      for (let guard = 0; guard < 20; guard += 1) {
        const seat = tab.locator("[data-seat]").first();
        if (!(await seat.count())) break;
        await seat.click();
        await tab.waitForSelector(".player-card");
        await tab.locator("#player-name").fill(`Player ${guard + 1}`);
        await tab.locator(".player-save").click();
        await tab.waitForFunction(() => document.querySelector(".player-card") === null);
      }
      assert.equal(await tab.locator("[data-seat]").count(), 0, `${label}: every seat is claimed`);
      await tab.locator('[data-act="to-seat"]').click();
      await tab.waitForSelector(".seat-ring");
      await record("seat", "seat");

      await tab.locator('[data-act="use"]').click();
      await tab.waitForSelector(".secrets");
      await record("secrets", "secrets");
      await fillPhoneSecrets(tab);
      await tab.waitForSelector(".secrets-status.is-ok");
      await tab.locator('[data-act="start"]').click();
      await tab.waitForSelector(".host-card.is-night");
      await record("night", "table");

      await finishPhoneNight(tab);
      await tab.locator('[data-act="end-night"]').click();
      await tab.waitForSelector(".host-card.is-day");
      await record("day", "table");

      // The host knows the Imp and executes it, which ends the game in a good
      // victory; the choice is still made through the day card's select.
      const demonId = await tab.evaluate(async () => {
        const { store } = await window.PG_MODULES();
        return (
          Object.values(store.state.players).find((player) => player.roleId === "imp")?.id ?? null
        );
      });
      assert.ok(demonId, `${label}: the dealt bag contains the Imp`);
      const executionOptions = await tab
        .locator("[data-exec-target] option")
        .evaluateAll((nodes) => nodes.map((node) => node.value).filter(Boolean));
      assert.ok(executionOptions.includes(demonId), `${label}: the Imp is an execution target`);
      await tab.locator("[data-exec-target]").selectOption(demonId);
      await tab.locator('[data-act="execute-direct"]').click();
      await tab.waitForSelector(".host-card.is-over");
      await record("result", "table");

      await tab.locator('[data-act="review"]').click();
      await tab.waitForSelector(".host-review");
      await record("review", "table");

      assert.deepEqual(
        visited,
        ["setup", "bag", "player", "seat", "secrets", "night", "day", "result", "review"],
        `${label}: every screen was reached by tapping`,
      );
      assert.equal(
        await tab.evaluate(() => localStorage.getItem("pg.library.v1")),
        null,
        `${label}: no saved bag registry is required`,
      );
      // A played game writes two records of its own: the save and the console's
      // night-step recovery aid. Neither is a configuration the host supplied.
      const OWN_KEYS = ["pg.game.v4", "pg.lang", "pg.stepDraft"];
      const keys = await tab.evaluate(() => Object.keys(localStorage).sort());
      assert.deepEqual(
        keys.filter((key) => !OWN_KEYS.includes(key)),
        [],
        `${label}: no config key is required`,
      );
      console.log(`${label} acceptance reached: ${visited.join(" -> ")}`);
    } finally {
      await context.close();
    }
  };

  await walkPhone({ width: 360, height: 640 });
  await walkPhone({ width: 640, height: 360 });

  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: phone/tablet, night/day, Virgin, route cleanup, privacy, reload, cross-tab, languages, native role sheet, dialog contract, offline project-subpath reload, fast PWA update.",
  );
  console.log("Screenshots: " + screenshots);
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
