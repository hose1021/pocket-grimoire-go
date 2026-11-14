// Privacy: the public page, the player handoff and the seat route render
// projections, never the saved grimoire. SPEC.md treats the app as a local aid,
// so this checks the projections, not a security boundary.
import {
  runScenario,
  seedGame,
  playNight,
  playDay,
  snapshot,
  gotoRoute,
  visibleText,
  assert,
} from "../scenario-kit.mjs";

const SECRET_NOTE = "SECRET-NOTE-42";

/** The exact role names the catalog renders, in the UI language. */
async function roleNames(page, ids) {
  return page.evaluate(
    (list) =>
      [...new Set(list.filter(Boolean))].map((id) => {
        const roles = Array.isArray(window.PG && window.PG.roles) ? window.PG.roles : [];
        const role = roles.find((candidate) => candidate.id === id);
        return role ? role.name : id;
      }),
    ids,
  );
}

/** Waits for an in-app route, naming it when it never arrives. */
async function waitRoute(page, route) {
  try {
    await page.waitForFunction((wanted) => document.body.dataset.route === wanted, route, {
      timeout: 8000,
    });
  } catch {
    const actual = await page
      .evaluate(() => document.body.dataset.route || "(none)")
      .catch(() => "(gone)");
    assert.fail(`the ${route} route must open, the app is on ${actual}`);
  }
}

/** Every role id the saved game hides: real roles, shown roles and bluffs. */
async function secretRoleIds(page) {
  const secrets = await gameSecrets(page);
  return [
    ...new Set(
      [
        ...secrets.players.map((player) => player.roleId),
        ...secrets.players.map((player) => player.shownRoleId),
        ...secrets.bluffs,
      ].filter(Boolean),
    ),
  ];
}

/** The saved fields a public projection may not carry. */
async function gameSecrets(page) {
  return page.evaluate(async () => {
    const { store } = await window.PG_MODULES();
    const state = store.state;
    return {
      order: state.order.slice(),
      phase: state.phase,
      notes: state.notes || "",
      bluffs: (state.setup.bluffs || []).slice(),
      roles: (state.setup.roles || []).slice(),
      script: (state.script && state.script.roles ? state.script.roles : []).slice(),
      players: state.order.map((id) => ({
        id,
        seat: state.players[id].seat,
        name: state.players[id].name,
        roleId: state.players[id].roleId,
        shownRoleId: state.players[id].shownRoleId,
        alive: state.players[id].alive,
      })),
    };
  });
}

/** The public projection the app exports and the `/public` screen renders. */
async function publicProjection(page) {
  return page.evaluate(async () => {
    const { model, store } = await window.PG_MODULES();
    return model.publicGameView(store.state);
  });
}

await runScenario("privacy-public-seat", async ({ page, url }) => {
  // A seeded five-player game first: the projections never grow a role when a
  // real death exists.
  await seedGame(page, {
    edition: "tb",
    assignment: { 1: "chef", 2: "empath", 3: "monk", 4: "poisoner", 5: "imp" },
    bluffs: [],
  });
  await playNight(page, { poisoner: { targets: ["1"] }, imp: { targets: ["2"] } });
  await playDay(page, {});
  await playNight(page, { poisoner: { targets: ["1"] }, imp: { targets: ["2"] } });
  const shot = await snapshot(page);
  assert.equal(shot.players.find((player) => player.id === "2").alive, false, "P2 died");

  await gotoRoute(page, "public");
  const publicText = await visibleText(page);
  assert.ok(publicText.includes("P2"), "the public page names the dead player");
  const seededRoles = ["chef", "empath", "monk", "poisoner", "imp"];
  const publicLeaks = (await roleNames(page, seededRoles)).filter((name) =>
    publicText.includes(name),
  );
  assert.deepEqual(publicLeaks, [], "the public page carries no role");

  // The seeded game hides a live poison effect and two roles: neither reaches
  // the projection the public screen renders.
  const liveEffects = (shot.effects || []).map((effect) => effect.kind);
  assert.ok(liveEffects.includes("poison"), "the seeded game carries a live poison effect");
  const seededProjectionText = JSON.stringify(await publicProjection(page));
  const seededSecrets = [...seededRoles, ...liveEffects];
  assert.deepEqual(
    seededSecrets.filter((word) => seededProjectionText.includes(word)),
    [],
    "the exported public projection carries no role or effect (seeded game)",
  );

  await gotoRoute(page, "seat");
  const seatText = await visibleText(page);
  assert.ok(seatText.includes("P1"), "the seat route lists the players");
  const seatLeaks = (await roleNames(page, seededRoles)).filter((name) => seatText.includes(name));
  assert.deepEqual(seatLeaks, [], "the seat route carries no role");

  // A real table deal next: the seeded bag cannot carry a Drunk mask, and the
  // handoff rule is about the role the Drunk believes.
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await page.waitForSelector(".host");

  await gotoRoute(page, "bag");
  await page.locator('[data-apply="preset-2"]').click();
  await page.waitForSelector("[data-drunk-role]");
  const bag = await gameSecrets(page);
  const mask = await page.evaluate(
    ({ roles, bluffs, script }) => {
      const taken = new Set([...roles, ...bluffs]);
      const all = Array.isArray(window.PG && window.PG.roles) ? window.PG.roles : [];
      const role = all.find(
        (candidate) =>
          candidate.team === "townsfolk" &&
          script.includes(candidate.id) &&
          !taken.has(candidate.id),
      );
      return role ? role.id : "";
    },
    { roles: bag.roles, bluffs: bag.bluffs, script: bag.script },
  );
  assert.ok(mask, "the Drunk needs an unused Townsfolk for the mask");
  await page.locator(`[data-drunk-role="${mask}"]`).click();
  await page.locator('[data-act="deal"]').click();
  await waitRoute(page, "player");

  // The number picker is a public projection: a seat number, no role.
  const pickerText = await visibleText(page);
  const pickerLeaks = (await roleNames(page, await secretRoleIds(page))).filter((name) =>
    pickerText.includes(name),
  );
  assert.deepEqual(
    pickerLeaks,
    [],
    `the player handoff picker carries no role (leaked ${pickerLeaks.join(", ")})`,
  );

  const dealt = await gameSecrets(page);
  const drunk = dealt.players.find((player) => player.roleId === "drunk");
  assert.ok(drunk, "the preset bag deals the Drunk");
  assert.equal(drunk.shownRoleId, mask, "the Drunk believes the chosen Townsfolk");
  const drunkIndex = dealt.order.indexOf(drunk.id);
  await page.locator(`[data-seat="${drunkIndex}"]`).click();
  await page.waitForSelector(".player-role-name");
  const believed = (await roleNames(page, [mask]))[0];
  const cardName = (await page.locator(".player-role-name").innerText()).trim();
  assert.equal(
    cardName,
    believed,
    `the player handoff shows the role the Drunk believes (${believed})`,
  );
  const cardText = await visibleText(page);
  const drunkName = (await roleNames(page, ["drunk"]))[0];
  assert.equal(
    cardText.includes(drunkName),
    false,
    `the player handoff carries no real role (leaked ${drunkName})`,
  );
  await page.locator("#player-name").fill(`P${drunkIndex + 1}`);
  await page.locator(".player-save").click();
  await page.waitForSelector(".player-numbers");

  // Every player claims a number on the handoff, then the seat route is read.
  for (let index = 0; index < dealt.order.length; index += 1) {
    const seat = page.locator(`[data-seat="${index}"]`);
    if (!(await seat.count())) continue;
    await seat.click();
    await page.waitForSelector("#player-name");
    await page.locator("#player-name").fill(`P${index + 1}`);
    await page.locator(".player-save").click();
    await page.waitForFunction(
      (wanted) => !document.querySelector(`[data-seat="${wanted}"]`),
      index,
    );
  }
  await page.locator('[data-act="to-seat"]').click();
  await waitRoute(page, "seat");
  await page.waitForSelector(".seat-item");
  const seatAfterDeal = await visibleText(page);
  const missingNames = dealt.order
    .map((id, index) => `P${index + 1}`)
    .filter((name) => !seatAfterDeal.includes(name));
  assert.deepEqual(missingNames, [], "the seat route lists every claimed name after a deal");
  const seatAfterDealLeaks = (await roleNames(page, await secretRoleIds(page))).filter((name) =>
    seatAfterDeal.includes(name),
  );
  assert.deepEqual(
    seatAfterDealLeaks,
    [],
    `the seat route stays names-only after a deal (leaked ${seatAfterDealLeaks.join(", ")})`,
  );

  // Seal the order: the app moves the phase to seat and opens the secrets
  // check. The role change runs on the table, where a seat opens the dialog.
  const beforeUse = await gameSecrets(page);
  assert.equal(
    beforeUse.phase,
    "deal",
    `the deal leaves the game in deal phase (${beforeUse.phase})`,
  );
  await page.locator('[data-act="use"]').click();
  await page.waitForFunction(
    () => ["table", "secrets"].includes(document.body.dataset.route),
    undefined,
    { timeout: 8000 },
  );
  await gotoRoute(page, "table");
  await page.waitForSelector('[data-act="roster"]');

  // A host role change through the correction dialog, then the seat route again.
  const changedSeat =
    dealt.players.find((player) => player.roleId === "chef") ||
    dealt.players.find((player) => player.roleId === "undertaker") ||
    dealt.players.find((player) => player.roleId === "virgin");
  assert.ok(changedSeat, "a non-demon seat for the host role change");
  await page.locator('[data-act="roster"]').click();
  const rosterRow = page.locator(`[data-roster-player="${changedSeat.id}"]`);
  await rosterRow.locator('[data-act="role-card"]').click();
  await page.waitForSelector('[data-act="player-correct"]');
  await page.locator('[data-act="player-correct"]').click();
  await page.waitForSelector('[data-correct="kind"]');
  await page.locator('[data-correct="kind"]').selectOption("role");
  await page.waitForSelector('[data-correct="role-value"]');
  await page.locator('[data-correct="role-value"]').selectOption("soldier");
  await page.locator('[data-correct="reason"]').fill("privacy scenario: host role change");
  await page.locator('[data-act="apply-correction"]').click();
  await page.waitForSelector('[data-correct="kind"]', { state: "detached" });
  const changed = await gameSecrets(page);
  assert.equal(
    changed.players.find((player) => player.id === changedSeat.id).roleId,
    "soldier",
    "the host role change applies",
  );

  await gotoRoute(page, "seat");
  await page.waitForSelector(".seat-item");
  const seatAfterChange = await visibleText(page);
  const missingAfterChange = dealt.order
    .map((id, index) => `P${index + 1}`)
    .filter((name) => !seatAfterChange.includes(name));
  assert.deepEqual(
    missingAfterChange,
    [],
    "the seat route lists every claimed name after a role change",
  );
  const seatAfterChangeLeaks = (await roleNames(page, await secretRoleIds(page))).filter((name) =>
    seatAfterChange.includes(name),
  );
  assert.deepEqual(
    seatAfterChangeLeaks,
    [],
    `the seat route stays names-only after a role change (leaked ${seatAfterChangeLeaks.join(", ")})`,
  );

  // A host note marks the projection: it must never leave the console.
  await gotoRoute(page, "table");
  await page.locator('[data-act="menu"]').click();
  await page.waitForSelector("[data-notes]");
  await page.locator("[data-notes]").fill(SECRET_NOTE);
  await page.locator('[data-act="close"]').last().click();
  await page.waitForSelector("[data-notes]", { state: "detached" });

  const secretsNow = await gameSecrets(page);
  assert.equal(secretsNow.notes, SECRET_NOTE, "the console keeps the host note");
  const projection = await publicProjection(page);
  assert.deepEqual(
    Object.keys(projection).sort(),
    ["day", "deaths", "living", "night", "phase", "total", "winner"],
    "the exported public projection carries no role, bluff, note or effect field",
  );
  const projectionText = JSON.stringify(projection);
  const secretWords = [
    ...secretsNow.players.map((player) => player.roleId),
    ...secretsNow.players.map((player) => player.shownRoleId),
    ...secretsNow.bluffs,
    secretsNow.notes,
    "effects",
    "note",
  ].filter(Boolean);
  const projectionLeaks = secretWords.filter((word) => projectionText.includes(word));
  assert.deepEqual(
    projectionLeaks,
    [],
    `the exported public projection carries no role, bluff, note or effect (leaked ${projectionLeaks.join(", ")})`,
  );

  // Day one: the host executes a plain seat, then the public page is read.
  await gotoRoute(page, "table");
  await page.locator('[data-act="start-night"]').click();
  await playNight(page, {}, { skipUnplanned: true });
  const night = await gameSecrets(page);
  const victim = night.players.find(
    (player) =>
      player.alive &&
      ["spy", "drunk", "undertaker", "slayer", "virgin"].includes(player.roleId || ""),
  );
  assert.ok(victim, "a plain seat for the day execution");
  await playDay(page, { execute: victim.id });
  const executed = await snapshot(page);
  assert.equal(executed.execution?.playerId, victim.id, "the day records the execution");
  assert.equal(
    executed.players.find((player) => player.id === victim.id).alive,
    false,
    "the executed player dies",
  );

  await gotoRoute(page, "public");
  const publicAfterExecution = await visibleText(page);
  const executionLeaks = (await roleNames(page, await secretRoleIds(page))).filter((name) =>
    publicAfterExecution.includes(name),
  );
  assert.deepEqual(
    executionLeaks,
    [],
    `the public page carries no role after an execution (leaked ${executionLeaks.join(", ")})`,
  );
  const executedName = `P${night.order.indexOf(victim.id) + 1}`;
  const recordedDeath = executed.deaths.find((death) => death.playerId === victim.id);
  const publicView = await publicProjection(page);
  const publicHeading = await page.locator(".public-card h2").first().innerText();
  assert.ok(
    recordedDeath && publicAfterExecution.includes(executedName),
    `the public morning names the executed player ${executedName}; the engine recorded ${JSON.stringify(recordedDeath)}, publicGameView.deaths is ${JSON.stringify(publicView.deaths)} and the page says "${publicHeading.trim()}"`,
  );

  return `${shot.deaths.length} seeded deaths, no role leak on /player, /public or /seat`;
});
