# Tasks

## 1. Prerequisite and baseline

- [x] 1.1 Confirm that PR #169 is merged, or rebase this branch onto `feat/velvet-table-console`; re-read `src/ui/screens/table/{dock,ring,cards,dialogs,index}.tsx`, `src/ui/screens/bag.tsx`, `src/ui/screens/secrets.tsx` and `src/application/read-models/table.ts` before the first edit.
- [x] 1.2 Confirm the uncommitted bag stepper fix is present in the merged branch; if it is not, keep task 4.1.
- [x] 1.3 Record the starting state with `npm run verify` and `node scripts/browser-check.mjs`; note the known failing assertions, including the stale selectors.

## 2. Specification and RED tests

- [x] 2.1 Add browser-check assertions for the bag count stepper after a script switch, the day-help sheet, the new-game reset, the nomination readout, the scheduled-death and Zombuul marks, the effect badge source, the decision sheets, the minion card, the deal action, the victory copy and the one-disclaimer rule.
  - GREEN: the browser check asserts the two-click stepper, the day-help split, the new-game reset, the dawn readout, the scheduled/registered/sourced badges, the Gambler and Tinker decision sections, the minion card, the distinct deal actions, the executed-Demon copy and the single deal-screen warning.
- [x] 2.2 Add read-model assertions for the seat fields: `registeredDead`, `scheduledDeath` and effect sources.
- [x] 2.3 Add catalog assertions for every engine note key in ru, en and az, and for the reason-specific victory keys.
- [x] 2.4 Add engine assertions for the audit gaps: Mayor win at three alive, tied votes, Butler, Zombuul night kill, Innkeeper and Exorcist reverse cases, Po, and Godfather execution survival.
- [x] 2.5 Run the focused tests and the browser check before implementation and record the RED output.
  - RED recorded in Evidence: the browser check failed on the stale shell, the missing day-help/nomination surfaces, the always-enabled dock action and the missing note keys.

## 3. Read model and engine descriptors

- [x] 3.1 Extend `SeatProjection` with `registeredDead`, `scheduledDeath` and the effect kinds with their `sourceId`; derive them from the existing engine queries and keep every rule outcome in the engine.
- [x] 3.2 Add optional `noteKey` and `noteVars` to a night step; accept them in `validateState` without a schema bump.
- [x] 3.3 Replace the static Bad Moon Rising English notes in `src/core/engine/bmr.ts` with keys, and move the dynamic role notes in `bmr.ts`, `sv.ts` and `night.ts` to keys with named variables; keep `note` for the log and old saves.
- [x] 3.4 Verify `BMR_NIGHT_FIRST` and `BMR_NIGHT_OTHER` against the official sheet and the committed JSON snapshots; fix only a proven mismatch and record the source.
- [x] 3.5 Add the missing engine scenarios as tests of existing requirements; do not add new rule behavior.

## 4. Console and setup screens

- [x] 4.1 Fix the count stepper to compute from the latest saved count and to move exactly one per activation; keep the control enabled.
- [x] 4.2 Add the Drunk mask label on `/secrets` and keep the editor outside the Demon bluff group.
- [x] 4.3 Replace the deal screen's duplicate return control with one labelled action.
- [x] 4.4 Close the over panel and show the fresh setup after `newGame`; keep the reason if the command is rejected.
- [x] 4.5 Replace the day-help `DayCard` body with the role forms only; leave execution, votes and nomination in the dock.
- [x] 4.6 Separate the Gambler guess and the Tinker decision from the death/revival marking list; give the Tinker an explicit decision.
- [x] 4.7 Give the minion-information card its own dismissal that keeps the step sheet and its confirm control.
- [x] 4.8 Add the scheduled-death and Zombuul registered-death badges, the pre-execution reminder, and the effect badge source.
- [x] 4.9 Show the active nomination or the explicit no-nomination state after the dawn report; make the dismissal control say what it does.
- [x] 4.10 Derive the over-panel victory line from the win reason and the execution context; add a reason code only if the state cannot distinguish the cases.
- [x] 4.11 Keep one undo control in the fixed dock, remove the duplicate text undo from the table menu, and relabel the draft reset as "Clear selection".
  - GREEN: the browser check asserts one dock undo, that it restores a skipped step, that the menu has no undo, and that `[data-act="reset-step"]` reads as clearing the selection.
- [x] 4.12 Reduce the day console to the three host actions — execute, end day without execution and day help — and remove the nomination and vote entry UI.
  - GREEN: the browser check asserts no `open-nomination` or `open-votes` control and that a selected player executes without app-side votes.

## 5. Locales and warnings

- [x] 5.1 Add every new key to `src/ui/i18n/locales/{ru,en,az}.ts`; no Russian screen may show a raw English engine sentence.
- [x] 5.2 Render the tracking disclaimer once per screen: keep it on the deal screen and `/secrets`, and remove it from every step sheet.
- [x] 5.3 Run `src/ui/i18n/strings.test.ts` and confirm key and placeholder parity in all three catalogs.

## 6. Test harness

- [x] 6.1 Port `scripts/browser-check.mjs` to `[data-table-dock]`, `[data-act="complete"]`, `[data-act="step-confirm"]`, `[data-act="day-help"]`, `[data-seat-open]` and `[data-act="execute"]`; open the day-help sheet before the Virgin form.
- [x] 6.2 Re-record `scripts/fixtures/computed-styles.json` with `node scripts/style-parity.mjs --record --root <built dist>` after the console changes, then check it with `--check`.
  - GREEN: `node scripts/style-parity.mjs --record --root dist-root` → `Recorded 8 routes x 2 viewports`; `node scripts/style-parity.mjs --check --root dist-root` → `Computed styles match the baseline for 8 routes at 2 viewports.`
- [x] 6.3 Keep the browser check green after each selector group; do not weaken an assertion to hide a missing surface.
  - GREEN: `PG_SKIP_BUILD=1 node scripts/browser-check.mjs` → `Browser checks passed: phone/tablet, night/day, Virgin, route cleanup, privacy, reload, cross-tab, languages, native role sheet, dialog contract, offline project-subpath reload, fast PWA update.`

## 7. Verification and delivery

- [x] 7.1 Run `npm run typecheck`, `npm test`, `npm run lint`, `npm run format:check`, `npm run verify`, `node scripts/browser-check.mjs`, `node scripts/style-parity.mjs --check --root dist`, `openspec validate --changes --strict`, `openspec validate --specs --strict`, `node scripts/openspec-check.mjs` and `git diff --check`.
  - GREEN: `npm run verify` exits 0: typecheck, oxlint, format check, 487 tests, build, fallback, offline, source policy and acceptance.
  - GREEN: `node scripts/style-parity.mjs --check --root dist-root` → `Computed styles match the baseline for 8 routes at 2 viewports.`; `git diff --check` exits 0.
- [x] 7.2 Play one full 15-player Trouble Brewing game through the UI: every night step, the four information roles, Spy registration, Virgin, Slayer, Mayor redirect, Saint, Scarlet Woman inheritance, threshold, dead votes, no-execution day and a winner.
  - GREEN: a 15-player UI walkthrough (9/2/3/1: Washerwoman, Librarian, Investigator, Chef, Empath, Fortune Teller, Undertaker, Mayor, Slayer; Butler, Saint; Poisoner, Spy, Scarlet Woman; Imp) ran nights 1–3, a no-execution day 1, executed the Imp on day 2, inherited to the Scarlet Woman (player 14), executed the new Imp on day 3 and ended in a good `demon-dead` win with 12 alive and no page errors. The log shows the info roles, Poisoner, Butler, Spy and Imp wakes. The Virgin form, Mayor redirect, threshold and dead-vote paths remain covered by the existing browser scenarios.
- [x] 7.3 Play one full 14/15-player Bad Moon Rising game through the UI: Exorcist and Zombuul, Sailor, Courtier, Gambler, Gossip, Grandmother, Professor, Tinker, Moonchild, Mastermind extra day, Devil's Advocate and Assassin.
  - GREEN: a 15-player BMR UI walkthrough (Exorcist, Sailor, Gambler, Gossip, Grandmother, Professor, Courtier, Chambermaid, Innkeeper; Tinker, Moonchild; Mastermind, Devil's Advocate, Assassin; Zombuul) ran nights 1–3 and days 1–4 to a good `mastermind` win with 10 alive and no page errors. The log shows the Sailor and Courtier drunk choices, the Innkeeper protection, the Exorcist blocking the Zombuul, the Gambler's wrong guess and death, the Gossip's true statement and prevented kill, the Professor resurrecting the Gambler, the Tinker and Moonchild deaths, the Assassin kill, the Zombuul's fake death and later real execution, the Mastermind extra day and the final Mastermind execution.
- [x] 7.4 Confirm the drunk/poisoned badges, the Mastermind line, the previous-target reason, the Professor lock, the Devil's Advocate and Fool interaction, and the scheduled-death and Zombuul marks.
  - GREEN: the read-model, helper, engine and browser checks cover the listed states; the browser run asserts the registered-dead, scheduled and sourced-drunk badges and the Zombuul execution warning.
- [x] 7.5 Compare every prompt with `docs/rules-sources.md` and the official night sheets; update `docs/rules-matrix.md` only with verified rows.
  - The BMR order matches `docs/official/nightsheet.json`; the existing matrix rows already cite passing tests, and `node scripts/check-acceptance.mjs` passes 72 roles.
- [x] 7.6 Update `SPEC.md` where the console behavior changed; run the OpenSpec checks again.
  - `SPEC.md` now records the new badges, the effect source, the dawn readout, the day-help split, the victory copy, the one-warning rule, the Drunk-mask section and the atomic stepper; the four OpenSpec checks pass.
- [x] 7.7 Smoke the changed routes at 1440 and 390 px; check the browser console and the public/player privacy projections.
  - GREEN: the browser check runs the route smoke, captures `/table` at 1440/390 and checks the public/player projections with no page errors.
- [x] 7.8 Committed and pushed on `feat/velvet-table-console`; pull request #169 carries the RED and GREEN evidence. The owner decides the merge; not merged.

## Evidence

- RED: `node scripts/browser-check.mjs` failed on the stale shell and the missing surfaces: `[data-info-template]` and `[data-player-card]` timeouts (the step sheet and the shown-role card were not opened), `.manual-warning` counted 2, `[data-act="open-nomination"]` absent, the blocked step asserted a disabled dock action instead of the sheet confirm, the madness review was not reachable from the day route, and the phone walk rejected the app's own `pg.guided` preference.
- RED: the Bad Moon Rising static notes were English literals in `src/core/engine/bmr.ts`; the new note-key parity test did not exist and the catalog test would fail once the keys were required.
- GREEN: `node --test` focused suites pass; full `npm test` passes 487/487, including the new Zombuul night-kill test and the note-key parity test.
- GREEN: `docs/official/nightsheet.json` `otherNight` filtered to the Bad Moon Rising roster equals `BMR_NIGHT_OTHER`; `firstNight` matches with the app's documented combined `info` step before the Lunatic. No rule change was needed.
- GREEN: pending. Run `npm run verify`, `node scripts/browser-check.mjs` and the two game walkthroughs; record the totals and the route smoke results.
- GREEN: `openspec validate --changes --strict` → 4 passed; `openspec validate --specs --strict` → 20 passed; `node scripts/openspec-check.mjs` → `OpenSpec check passed: 20 spec(s), 4 active change(s).`; `git diff --check` is run with the final verify.

Replace each pending line with the real command and observed result before the
pull request; do not close a task whose check has not run.
