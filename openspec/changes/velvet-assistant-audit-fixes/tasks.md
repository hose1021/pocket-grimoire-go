# Tasks

## 1. RED tests

- [x] 1.1 Add console helper tests for the computed-note priority, the role and
  drunk blockers with their copy, the localized rejection, the given-answer card,
  the seat-picker selection algorithm, the redirect value and the blocker rows.
- [x] 1.2 Add the read-model resurrect-choice test for the Professor and
  Shabaloth cases.
- [x] 1.3 Add catalog tests for the audit win reasons, the new host copy, the
  split `error.66` and the corrected Russian guide and error drift.
- [x] 1.4 Record the RED run.
  - RED: `node --test src/ui/screens/table/helpers.test.ts` → `SyntaxError: The requested module './helpers.ts' does not provide an export named 'blockerText'` (1 failing test file).
  - RED: `node --test src/application/read-models/table.test.ts` → the module has no export named `resurrectChoices` (1 failing test file).
  - RED: `node --test src/ui/i18n/strings.test.ts` → `error.15 is Russian` failed with `actual: 'Virgin ability is unavailable.'`; the audit key set was missing.

## 2. Information and guidance

- [x] 2.1 Make `infoText` prefer the computed note text over `noteKey` (AS2).
- [x] 2.2 Give BMR/SV system steps and the Lunatic their own guide lines (AS3).
- [x] 2.3 Add `guideForStep` so a Drunk actor's step uses the Drunk guide; state
  that the ability does not work and the information is false (AS4).

## 3. Mandatory decisions and controls

- [x] 3.1 Add the `role` and `drunk` blockers to `stepBlockers` and `stepContext`
  (AS5, AS10).
- [x] 3.2 Render the blocker list in the step sheet next to the disabled Confirm
  (AS7).
- [x] 3.3 Give the Mayor redirect select an explicit unanswered state (AS8).
- [x] 3.4 Add `resurrectChoices` and use it in the resurrect select (AS9).
- [x] 3.5 Label a character answer as a registration choice (AS11).
- [x] 3.6 Remove the hardcoded Russian target sentence (AS18).

## 4. One execution and the day surfaces

- [x] 4.1 Move the survival choice into the shared drafts and align both
  execution surfaces on a living target (AS12).
- [x] 4.2 Preview the execution in the dock and reuse the preview identity
  (AS24).
- [x] 4.3 Split the madness review, the manual winner and the new Tinker day
  control out of day help into `DayActionsPanel`, rendered in the table menu
  (AS13, BMR22).
- [x] 4.4 Name the Pacifist rule on the survival control (BMR21).
- [x] 4.5 Generalise the seat picker to the step's maximum target count (BMR2).

## 5. Localized copy

- [x] 5.1 Localize rejection and setup reasons through `rejectionText` and the
  `error.N` keys (AS15).
- [x] 5.2 Split `error.66` into illegal-answer and madness-review copy (AS17).
- [x] 5.3 Add `winReason.{vortox,evil-twin,klutz}` in ru, en and az (AS16).
- [x] 5.4 Correct the RU Saint/Spy guide and `error.15/16` (AS19).
- [x] 5.5 Add the given-answer player card path (AS14).

## 6. Demo route

- [x] 6.1 Replace the store-mutating demo chain with a navigation to `/demo`
  and localize its hint in all three catalogs (SET1).

## 7. GREEN

- [x] 7.1 `node --test src/ui/screens/table/helpers.test.ts` → 28 pass, 0 fail.
- [x] 7.2 `node --test src/application/read-models/table.test.ts` → 11 pass, 0 fail.
- [x] 7.3 `node --test src/ui/i18n/strings.test.ts` → 11 pass, 0 fail.
- [x] 7.4 `npx tsc -p tsconfig.app.json --noEmit` → `TypeScript: No errors found`.
- [x] 7.5 `openspec validate velvet-assistant-audit-fixes --type change --strict` → valid.

## 8. Engine work and the Sects & Violets pass

- [x] 8.1 Pacifist: the engine owner landed the survival gate (`error.57`); the
  console catalogues it in all three locales and the control names the rule.
- [x] 8.2 Tinker: the engine owner landed `tinkerDeath`; the day control
  dispatches `{ playerId }` instead of a manual correction.
- [x] 8.3 SV11 Juggler: the panel reads `JugglerGuess[] | Record<string, RoleId>`,
  follows `state.juggler.day`, records 0–5 pairs with repeats, and dispatches
  `jugglerGuess` with `{ playerId, roleId }` or `{ guesses: [] }`.
- [ ] 8.4 SV4 Klutz: the `recordKlutzChoice` command now exists; the day-card
  control is the next UI pass.
- [ ] 8.5 SV3 Flowergirl/Town Crier: out of scope; needs a vote source or a host
  answer command.
- [ ] 8.6 `scripts/browser-check.mjs` must open the table menu where the day
  check used day help: `data-madness-review` and `data-madness-*`, and
  `data-winner-team` plus `data-act="declare-winner"`, moved to the menu.

## Evidence

- RED: `node --test src/ui/screens/table/helpers.test.ts` failed with `SyntaxError: ... does not provide an export named 'blockerText'`; `node --test src/application/read-models/table.test.ts` failed because the module had no export `resurrectChoices`; `node --test src/ui/i18n/strings.test.ts` failed `error.15 is Russian` with `actual: 'Virgin ability is unavailable.'`.
- GREEN: `node --test "src/ui/screens/table/*.test.ts" "src/application/read-models/*.test.ts" "src/ui/i18n/*.test.ts"` → 53 pass, 0 fail; `npx oxlint` and `npx oxfmt --check` clean on the changed files; `npx openspec validate velvet-assistant-audit-fixes --type change --strict` → valid.

