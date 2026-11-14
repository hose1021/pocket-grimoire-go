# Tasks

## 0. Evidence

- RED: `node --test --test-name-pattern="registration never applies|Poisoner who becomes the Imp|redirect onto the Imp|first nomination is recorded|first nomination still spends|dead player cannot be executed|Saint loss|startNight rejects|Sailor survives execution|Zombuul's first death is recorded|Fool is not spent|target modes reject|corpse execution" src/core/engine/engine.test.ts` against the six pre-edit engine files restored from `HEAD` in `/tmp/grim-red` → 12 failed, 1 passed (the impaired-Virgin guard already held before the fix).
- GREEN: `node --test src/core/engine/engine.test.ts` → `tests 73, pass 73, fail 0`; `node --test src/core/engine/commands.test.ts` → `42/42`; `host-choice.test.ts` 10/10; `invariants.test.ts` 5/5; `manual.test.ts` 8/8; `acceptance.test.ts` 5/5.

## 1. Evidence baseline

- [x] 1.1 Write one behavioral test per finding in `src/core/engine/engine.test.ts`, using the existing `make` fixture and a Bad Moon Rising `makeBmr` fixture that fills a legal bag.
- [x] 1.2 Record RED against the pre-edit engine. The six changed engine files were restored from `HEAD` in a scratch copy (`/tmp/grim-red`) and the new tests ran there:
  - RED: `node --test --test-name-pattern="registration never applies|Poisoner who becomes the Imp|redirect onto the Imp|first nomination is recorded|first nomination still spends|dead player cannot be executed|Saint loss|startNight rejects|Sailor survives execution|Zombuul's first death is recorded|Fool is not spent|target modes reject|corpse execution" src/core/engine/engine.test.ts` → 12 failed, 1 passed. The passing test is the impaired-Virgin guard, which already held before the fix.
  - Observed failures: the corpse Mayor win returned `null` instead of `good`; the Poisoner stayed poisoned after becoming the Imp (`true !== false`); the redirected Imp death was not `demon`; `recordVirginNomination` after an execution returned `error.8`; a dead player executed with `ok: true`; the Saint re-fired on the next day; `startNight` accepted the day phase; the Sailor died to an execution; the Zombuul recorded no Death entry; the Fool's ability was spent under Tea Lady protection; dead and self BMR targets were accepted.
- [x] 1.3 GREEN in the repository: `node --test src/core/engine/engine.test.ts` → `tests 73, pass 73, fail 0`.

## 2. Trouble Brewing findings

- [x] 2.1 TB3 — gate every Spy/Recluse registration read on the registrant's impairment (`information.ts`, `host-choice.ts`, `virginTriggers`, `useSlayer`).
  - Test: "a drunk or poisoned Spy or Recluse registration never applies to an ability".
  - GREEN: engine suite 73/73.
- [x] 2.2 TB4 — `becomeDemon` deactivates every effect the new Demon sourced (`death.ts`).
  - Test: "a Poisoner who becomes the Imp ends the poison it sourced".
- [x] 2.3 TB5 — a redirected attack is never a self-kill (`resolveAttack`).
  - Test: "a Mayor redirect onto the Imp is not the Imp's self-kill".
- [x] 2.4 TB6 — `recordVirginNomination` records and spends the first nomination after a day execution; the impaired-Virgin spend is guarded.
  - Tests: "the Virgin's first nomination is recorded after a day execution", "an impaired Virgin's first nomination still spends the ability".
- [x] 2.5 TB7 / AS21 — `executeByDecision` rejects a non-living target; the Mayor and Vortox checks use `executionDeathForDay`; `endDay` runs the end-of-day check for a closed day without an execution death.
  - Tests: "a dead player cannot be executed", "a corpse execution is not an execution event, so the Mayor still wins" (the existing test was updated from the wrong expectation).
- [x] 2.6 AS22 — the Saint loss is scoped to the execution day. Test: "the Saint loss is scoped to the day of the execution".
- [x] 2.7 AS23 — `startNight` rejects the day phase with `error.68` (`night.ts`). Test: "startNight rejects the day phase".

## 3. Bad Moon Rising findings

- [x] 3.1 BMR1 — the sober Sailor survives every cause; only `bypassProtection` kills (`effects.ts`). Test: "a sober Sailor survives execution and only a bypassing kill lands".
- [x] 3.2 BMR3 — the Zombuul's replaced death is a Death entry while the player stays alive (`death.ts`). Test: "the Zombuul's first death is recorded and keeps it from waking that night".
- [x] 3.3 BMR4 — Tea Lady and Innkeeper protection resolve before the Fool (`effects.ts`). Test: "the Fool is not spent when Tea Lady or Innkeeper protection prevents the death".
- [x] 3.4 BMR18/BMR19 — `completeStep` rejects dead (and registered-dead) targets for the Sailor, Devil's Advocate and Chambermaid and a self-target for the Chambermaid (`night.ts`). Test: "Bad Moon Rising target modes reject dead, self and invalid targets".

## 4. Verification of the change

- [x] 4.1 Focused suites that cover the changed modules pass: `node --test src/core/engine/engine.test.ts` (73/73), `commands.test.ts` (42/42), `host-choice.test.ts` (10/10), `invariants.test.ts` (5/5), `manual.test.ts` (8/8), `acceptance.test.ts` (5/5).
- [x] 4.2 Update the `docs/rules-matrix.md` rows that this change proves: Sailor, Fool, Zombuul, Virgin, Spy/Recluse registration, Mayor, Saint, Poisoner, and the BMR target-restriction note. No row is marked verified without a test in this change.
- [x] 4.3 `npx openspec validate --changes --strict` passes.
- [x] 4.4 Run the full `npm run verify` and the browser check in the integration wave: `npm run verify` exits 0 (595 tests) and `node scripts/browser-check.mjs` passes every contract on the branch head `b7e71f6`.

## 5. Hand-off outside this wave

- [x] 5.1 UI owners: the day card and the dock share one living-only execution target and the engine rejects a corpse with `error.55`; the `tb-15` and `tb-8` games assert the execution paths.
- [x] 5.2 Locale owners: `error.55`, `error.67` and `error.68` exist in ru/en/az; `strings.test.ts` asserts that every engine `error.*` literal resolves in all three catalogs.
- [x] 5.3 The `bmr.test.ts` #171 tests and the `snv.test.ts` Vigormortis test are green in the integration wave; both suites pass on the branch head.

## 6. BMR model follow-ups (batch 2)

- RED: `node --test --test-name-pattern="registered-dead Zombuul is not|registered-dead player does not|Pacifist survival flag|sober Tinker dies|Klutz public choice runs|Juggler with zero guesses" src/core/engine/engine.test.ts` against a scratch copy whose only differences were the pre-fix behavior (`registersAlive` = `alive`, no `survives` guard, no `tinkerDeath`/`recordKlutzChoice` registry entries, no Juggler list payload) → **6 failed, 0 passed**.
- GREEN: `node --test src/core/engine/engine.test.ts` → 79/79; `node --test src/core/engine/commands.test.ts src/core/engine/snv.test.ts src/core/engine/bmr.test.ts` → all pass; `npx tsc -p tsconfig.core.json --noEmit` and `npx tsc -p tsconfig.app.json --noEmit` → 0 errors.
- [x] 6.1 BMR12: `registersAlive(player)` in `state.ts`; Tea Lady neighbour selection and protection, the Scarlet Woman's five, and the existing registered-death target legality use it. Test: "a registered-dead Zombuul is not a Tea Lady neighbour but still counts as alive", "a registered-dead player does not count toward the Scarlet Woman's five"; `livingPlayers` is unchanged.
- [x] 6.2 BMR21: `execute`/`executeByDecision` reject `survives` unless the target is good, a living unimpaired Pacifist is in play, and the execution is the day decision (`error.57`). Test: "the Pacifist survival flag is legal only for a good target with a sober Pacifist".
- [x] 6.3 BMR22: `tinkerDeath` records a real ability death for a sober Tinker by day or night (`cause: "ability"`, `bmr: "tinker"`, win check). Test: "a sober Tinker dies from an ability death during the day and the night".
- [x] 6.4 Klutz command: `recordKlutzChoice` `{ targetId }` in the contract and registry, delegating to the SV resolver. Test: "the Klutz public choice runs through the command surface".
- [x] 6.5 Juggler: `jugglerGuess` accepts `{ guesses: [...] }` (empty list legal) or `{ playerId, roleId }`, max five, repeats allowed; `state.juggler.day` is persisted when the role is in play before a guess, so zero guesses still wakes on the night after the first day. Test: "a Juggler with zero guesses still answers on the night after their first day".
- [x] 6.6 `docs/rules-matrix.md`: Zombuul, Tea Lady, Scarlet Woman, Pacifist and Tinker rows updated; each `verified`/`host-choice` row cites the asserting test.
