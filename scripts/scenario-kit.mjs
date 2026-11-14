// Shared harness for the full-game scenario checks: one built dist, one
// browser, one real UI path per step. Game state is seeded through the same
// engine commands the setup screen dispatches, then every night step, host
// decision and execution goes through the table controls.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDistServer } from "./serve-dist.mjs";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? process.env.PLAYWRIGHT_MODULE : "playwright"
);

const root = fileURLToPath(new URL("../", import.meta.url));
const BASE = "/pocket/";

export { assert };

export async function bootScenario({ viewport = { width: 1280, height: 900 } } = {}) {
  const server = createDistServer({ root: join(root, "dist"), prefix: BASE });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}${BASE}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    window.PG_MODULES = () => import("/pocket/test-entry.js");
  });
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(url);
  await page.waitForSelector(".host");
  return {
    page,
    url,
    errors,
    failed,
    async close() {
      await browser.close();
      await new Promise((done) => server.close(done));
    },
    async screenshot(name) {
      await page.screenshot({ path: join(root, "dist", `scenario-${name}.png`), fullPage: true });
    },
  };
}

/**
 * Seeds a dealt game and lands on the table.
 * edition: "tb" | "bmr" | "snv" | "manual"; assignment: { seatId: roleId }.
 */
export async function seedGame(page, { edition = "tb", assignment, bluffs = [], start = "night" }) {
  const result = await page.evaluate(
    async ({ edition, assignment, bluffs, start }) => {
      const { model, engine, store, rules } = await window.PG_MODULES();
      const seats = Object.keys(assignment);
      const game = model.createGame(seats.length);
      if (edition !== "tb") {
        const all = edition === "bmr" ? rules.BMR_ALL : rules.SNV_ALL;
        game.scriptId = edition;
        game.script = {
          ...game.script,
          id: edition,
          name: edition === "bmr" ? "Bad Moon Rising" : "Sects and Violets",
          edition,
          roles: [...all],
        };
      }
      for (const [id, roleId] of Object.entries(assignment)) {
        game.players[id].name = "P" + id;
        game.players[id].claimed = true;
        void roleId;
      }
      game.setup.count = seats.length;
      game.setup.roles = [...new Set(Object.values(assignment))];
      game.setup.bluffs = bluffs;
      const dealt = engine.dealGame(game, { assignment });
      if (!dealt.ok) return { ok: false, step: "deal", detail: dealt };
      engine.autoSecrets(game);
      game.phase = "seat";
      if (start === "night") {
        const begun = engine.startNight(game);
        if (!begun.ok) return { ok: false, step: "startNight", detail: begun };
      }
      const errors = model.validateState(game);
      if (errors.length) return { ok: false, step: "validate", detail: errors };
      const replaced = store.replaceState(game);
      if (replaced && replaced.status && replaced.status !== "allowed")
        return { ok: false, step: "replace", detail: replaced };
      dispatchEvent(new PopStateEvent("popstate"));
      return { ok: true };
    },
    { edition, assignment, bluffs, start },
  );
  assert.equal(result.ok, true, `seed failed: ${JSON.stringify(result)}`);
  await settle(page);
}

/** In-app navigation: the router reads popstate, so no 404 document is fetched. */
export async function gotoRoute(page, route) {
  const path = BASE + String(route).replace(/^\//, "");
  await page.evaluate((target) => {
    history.pushState({}, "", target);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await settle(page);
}

export async function visibleText(page) {
  return page.locator("body").innerText();
}

export async function settle(page, ms = 90) {
  await page.waitForTimeout(ms);
}

/** Serialized view of the fields a scenario asserts on. */
export async function snapshot(page) {
  return page.evaluate(async () => {
    const { store, engine } = await window.PG_MODULES();
    const state = store.state;
    const step = engine.currentStep(state);
    return {
      phase: state.phase,
      day: state.day.number,
      winner: state.winner,
      dayEnded: state.day.ended,
      execution: state.day.execution
        ? { playerId: state.day.execution.playerId, deathId: state.day.execution.deathId }
        : null,
      step: step ? { key: step.key, roleId: step.roleId, targetMode: step.targetMode } : null,
      players: Object.values(state.players).map((player) => ({
        id: player.id,
        seat: player.seat,
        roleId: player.roleId,
        alive: player.alive,
        registeredDead: player.registeredDead === true,
        team: player.team,
      })),
      deaths: state.deaths.map((death) => ({
        playerId: death.playerId,
        cause: death.cause,
        phase: death.phase,
        number: death.number,
      })),
      effects: state.effects.map((effect) => ({
        kind: effect.kind,
        sourceId: effect.sourceId,
        targetId: effect.targetId,
        bmr: effect.bmr,
      })),
      log: state.log.length,
      logTail: state.log.slice(-6).map((entry) => entry.title),
    };
  });
}

export async function currentStep(page) {
  return page.evaluate(async () => {
    const { store, engine } = await window.PG_MODULES();
    const step = engine.currentStep(store.state);
    return step ? { key: step.key, roleId: step.roleId, targetMode: step.targetMode } : null;
  });
}

async function pickTargets(page, wanted) {
  const seats = page.locator("[data-target]:not(:disabled)");
  const available = await seats.count();
  const ids = Array.isArray(wanted) ? wanted.map(String) : [];
  if (!ids.length) {
    const count = Number(wanted) || 1;
    assert.ok(available >= count, `step needs ${count} target(s), ${available} selectable`);
    for (let index = 0; index < count; index += 1) await seats.nth(index).click();
    return;
  }
  for (const id of ids) {
    const seat = page.locator(`[data-target][data-id="${id}"]:not(:disabled)`);
    assert.equal(await seat.count(), 1, `target ${id} must be selectable`);
    await seat.click();
  }
}

async function pickGiven(page, wanted) {
  const select = page.locator("select[data-given]:visible");
  if (!(await select.count())) return;
  const options = await select
    .locator("option")
    .evaluateAll((nodes) => nodes.map((node) => ({ value: node.value, text: node.textContent })));
  const value =
    wanted === undefined || wanted === null
      ? (options.find((option) => option.value) || {}).value
      : typeof wanted === "number"
        ? (options[wanted] || options.find((option) => option.value) || {}).value
        : String(wanted);
  if (value === undefined) return;
  await select.selectOption(value);
}

/**
 * Plays the whole night through the console.
 * plan: { [roleId]: { targets, given, click: [selectors], skip } }.
 */
export async function playNight(page, plan = {}, { skipUnplanned = false } = {}) {
  for (let guard = 0; guard < 80; guard += 1) {
    if (await page.locator('[data-act="end-night"]').count()) {
      await page.locator('[data-act="end-night"]').click();
      await settle(page);
      return;
    }
    const step = await currentStep(page);
    assert.ok(step, "a night step or the end-night control must exist");
    const spec = plan[step.roleId] || plan[step.key] || {};
    if (
      spec.skip ||
      (skipUnplanned && !spec.targets && step.targetMode && step.targetMode !== "none")
    ) {
      await page.locator('[data-act="skip"]').click();
      await settle(page);
      continue;
    }
    if (spec.targets) await pickTargets(page, spec.targets);
    else if (step.targetMode === "two") await pickTargets(page, 2);
    else if (step.targetMode === "po") {
      /* the Po may choose none; the scenario decides */
    } else if (step.targetMode && step.targetMode !== "none") await pickTargets(page, 1);
    await page.locator('[data-act="complete"]').click();
    await page.waitForSelector('[data-act="step-confirm"]');
    await pickGiven(page, spec.given);
    for (const selector of spec.click || []) {
      const control = page.locator(selector).first();
      if (await control.count()) await control.click();
    }
    for (const { selector, value, index } of spec.selects || []) {
      const control = page.locator(selector).first();
      if (!(await control.count())) continue;
      const options = await control
        .locator("option")
        .evaluateAll((nodes) => nodes.map((node) => node.value));
      const chosen =
        value !== undefined
          ? String(value)
          : index !== undefined
            ? options[index]
            : options.find((option) => option);
      if (chosen !== undefined) await control.selectOption(chosen);
    }
    for (const selector of spec.checks || []) {
      const control = page.locator(selector).first();
      if (await control.count()) await control.check();
    }
    for (const [selector, text] of Object.entries(spec.fills || {})) {
      const control = page.locator(selector).first();
      if (await control.count()) await control.fill(String(text));
    }
    const confirm = page.locator('[data-act="step-confirm"]');
    assert.equal(
      await confirm.isEnabled(),
      true,
      `confirm disabled on ${step.roleId}: ${await page.locator("[data-blocker-reason]").allTextContents()}`,
    );
    await confirm.click();
    await settle(page);
  }
  throw new Error("night did not end");
}

/** Executes one living player through the dock, or ends the day without one. */
export async function playDay(page, { execute = null, survives = false } = {}) {
  if (execute) {
    if (survives) {
      const card = page.locator("[data-exec-target]");
      if (await card.count()) await card.selectOption(String(execute));
      const surviveBox = page.locator("[data-exec-survives]");
      if (await surviveBox.count()) await surviveBox.check();
      await page.locator('[data-act="execute-direct"]').click();
      await settle(page);
      return;
    }
    await page.locator(`[data-seat-open="${execute}"]`).click();
    await settle(page, 40);
    await page.locator('[data-act="execute"]').click();
    await settle(page);
    return;
  }
  await page.locator('[data-act="end-day"]').click();
  await settle(page);
}

export function expectWinner(shot, team, reason) {
  assert.ok(shot.winner, `expected a ${team} win, no winner yet`);
  assert.equal(shot.winner.team, team, `winner team (${JSON.stringify(shot.winner)})`);
  if (reason) assert.equal(shot.winner.reason, reason, "winner reason");
}

export function expectAlive(shot, ids, alive = true) {
  for (const id of ids) {
    const player = shot.players.find((candidate) => candidate.id === String(id));
    assert.ok(player, `player ${id} missing`);
    assert.equal(player.alive, alive, `player ${id} alive must be ${alive}`);
  }
}

/** Runs one scenario, prints one PASS line, exits non-zero on failure. */
export async function runScenario(name, fn) {
  const started = Date.now();
  let kit = null;
  try {
    kit = await bootScenario();
    const summary = await fn(kit, name);
    const ms = Date.now() - started;
    console.log(`SCENARIO PASS ${name} (${ms} ms)${summary ? `: ${summary}` : ""}`);
    if (kit.errors.length) console.log(`  page errors: ${kit.errors.join(" | ")}`);
    if (kit.failed.length) console.log(`  failed requests: ${kit.failed.join(" | ")}`);
    await kit.close();
    process.exit(0);
  } catch (error) {
    console.log(`SCENARIO FAIL ${name}: ${error && error.message}`);
    if (kit) {
      try {
        await kit.screenshot(name);
        const shot = await snapshot(kit.page);
        console.log(JSON.stringify(shot, null, 1));
        if (kit.errors.length) console.log(`page errors: ${kit.errors.join(" | ")}`);
      } catch {
        /* the page may already be gone */
      }
      await kit.close();
    }
    process.exit(1);
  }
}
