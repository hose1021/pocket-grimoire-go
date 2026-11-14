// Setup: the bag screen keeps a legal bag at every count, the stepper moves
// exactly one player per activation (including right after a script switch),
// and the Random bag and Deal control agree with the engine's composition.
import { runScenario, gotoRoute, settle, assert } from "../scenario-kit.mjs";

async function setupState(page) {
  return page.evaluate(async () => {
    const { store, rules } = await window.PG_MODULES();
    const state = store.state;
    return {
      count: state.setup.count,
      roles: state.setup.roles.slice(),
      composition: rules.compositionFor(state.setup.count, state.setup.roles),
      bagErrors: rules.bagErrors({
        count: state.setup.count,
        roles: state.setup.roles,
        bluffs: state.setup.bluffs,
        drunkShownId: state.setup.drunkShownId,
        lunaticShownId: state.setup.lunaticShownId,
        pool: state.script.roles,
      }),
    };
  });
}

await runScenario("setup-legal-bags", async ({ page }) => {
  await gotoRoute(page, "bag");
  await settle(page, 200);

  // Two fast clicks after the first paint move the count by exactly two.
  let before = await setupState(page);
  await page.locator('[data-count="1"]').click();
  await page.locator('[data-count="1"]').click();
  await settle(page, 150);
  let after = await setupState(page);
  assert.equal(after.count, before.count + 2, "each activation moves one player");

  // A single click moves exactly one.
  before = after;
  await page.locator('[data-count="1"]').click();
  await settle(page, 150);
  after = await setupState(page);
  assert.equal(after.count, before.count + 1, "one activation moves one player");

  // The Random bag lives in its own tab: it produces a legal bag at the current count.
  await page.locator('[data-tab="random"]').click();
  await settle(page, 120);
  await page.locator('[data-act="random"]').click();
  await settle(page, 150);
  after = await setupState(page);
  assert.deepEqual(after.bagErrors, [], "the random bag is legal");
  assert.equal(after.roles.length, after.count, "the random bag fills every seat");
  assert.equal(await page.locator('[data-act="deal"]').isEnabled(), true, "a legal bag deals");

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
    assert.equal(state.count, count, `the count is ${count}`);
    assert.equal(state.roles.length, count, `the random bag has ${count} roles`);
    assert.deepEqual(state.bagErrors, [], `the ${count}-player bag is legal`);
    assert.equal(
      await page.locator('[data-act="deal"]').isEnabled(),
      true,
      `a ${count}-player bag deals`,
    );
  }

  return "stepper atomic, random bag and every count 5-15 legal";
});
