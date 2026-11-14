// Privacy: the public page and the public seat route never show a role, a
// reminder or a secret effect. SPEC.md treats the app as a local aid, so this
// checks the projections, not a security boundary.
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

await runScenario("privacy-public-seat", async ({ page }) => {
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

  const labels = await page.evaluate(async () => {
    const { rules } = await window.PG_MODULES();
    return ["imp", "poisoner", "chef", "empath", "monk"].map((id) => rules.roleLabel(id));
  });

  await gotoRoute(page, "public");
  const publicText = await visibleText(page);
  assert.ok(publicText.includes("P2"), "the public page names the dead player");
  for (const label of labels) {
    assert.equal(publicText.includes(label), false, `public page leaks the role ${label}`);
  }

  await gotoRoute(page, "seat");
  const seatText = await visibleText(page);
  assert.ok(seatText.includes("P1"), "the seat route lists the players");
  for (const label of labels) {
    assert.equal(seatText.includes(label), false, `seat route leaks the role ${label}`);
  }

  return `${shot.deaths.length} deaths, no role leak on /public and /seat`;
});
