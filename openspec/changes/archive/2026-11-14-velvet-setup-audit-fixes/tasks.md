# Tasks

## Evidence

- RED: `node --test src/core/engine/setup.test.ts` before the fixes — `ℹ pass 8`, `ℹ fail 9`; every new case for TB1, TB2, TB8, SET2, SET3, SET4, SET5, SET6 and SET12 failed with the assertion named in section 1.
- RED: `node --test --test-name-pattern="host reminder" src/core/engine/setup.test.ts` before the reminder data — `ℹ pass 0`, `ℹ fail 1`, `AssertionError: chambermaid has no reminder list`.
- RED: `node --test src/core/model/rules.test.ts` before `vars` reached the problem shape (the `add` helper dropped it) — `ℹ pass 0`, `ℹ fail 2`, `actual: undefined, expected: { count: 1, required: 7 }` and `expected: { count: 7 }`.
- GREEN: `node --test src/core/engine/setup.test.ts src/core/model/rules.test.ts` after the fixes — `ℹ tests 19`, `ℹ pass 19`, `ℹ fail 0`.
- GREEN: `npx openspec validate --changes --strict` — `Totals: 5 passed, 0 failed`.

## 1. RED: one failing behavioral case per finding

- [x] Add ten cases to `src/core/engine/setup.test.ts` (TB1, TB2, TB8, SET2,
  SET12, SET3, SET4, SET5, SET6, SET10). Run
  `node --test src/core/engine/setup.test.ts`; the seven pre-existing cases
  passed and every new case failed:
  - `a Librarian may learn zero when every Outsider in play is a Recluse` —
    `assert.deepEqual(secretsErrors(recluse), [])` received the
    `librarian-zero` reason.
  - `a first-night pair may show a character held by a registering Spy or
    Recluse` — `assert.deepEqual(secretsErrors(spy), [])` received the
    `info-inplay-washerwoman` reason.
  - `a Drunk shown the Librarian may record the zero Outsiders answer` —
    `assert.deepEqual(secretsErrors(state), [])` received the `drunk-info`
    reason.
  - `mixed setup modifiers are legal when the counts match the composition` —
    `7: ["godfather-minus"]` (assertion diff printed the reason and its Russian
    message).
  - `an impossible modifier combination reports a clear reason` —
    `["team-townsfolk","team-outsider"]`: no `composition-impossible` code.
  - `a deal rejects an assignment that is not a permutation of the bag` —
    `true !== false`: the duplicate-character deal was accepted.
  - `a re-deal clears the old gossip, grandchild, corrections and notes` —
    `{ truth: true, day: 1 } !== null`: the gossip survived.
  - `a random bag returns the Godfather direction it was composed for` —
    `undefined !== -1`: `randomBag` returned no direction.
  - `a Lunatic without a shown Demon mask is illegal` — `[]`: neither
    `bagErrors` nor `validateState` reported the missing mask.
  - `every official role has a host reminder for the secrets screen` —
    `chambermaid has no reminder list`: the map held the Trouble Brewing roles
    only.

## 2. GREEN: model and validator fixes

- [x] `src/core/model/rules.ts`: exported the `RandomBag` type, returned
  `godfatherOutsider`, reworked the modifier attribution (`godfather-minus`
  only when the composition is impossible, `composition-impossible` for a
  negative team count, `team-*` counters suppressed then), and made the Lunatic
  mask mandatory whenever the bag contains the Lunatic.
- [x] `src/core/engine/setup.ts`: the Librarian zero accepts a registering
  Recluse, `info-inplay-*` accepts a registering pair member, the Drunk may
  record the Librarian zero, the deal enforces a bag permutation and clears
  `gossip`, `setup.grandmotherId`, `corrections` and `notes`, and the Lunatic
  fallback to the real role is gone.
- [x] `src/core/model/state.ts`: `validateState` rejects the Lunatic in the bag
  without a shown Demon.
- [x] `src/core/model/rules.ts`: added the 25 Bad Moon Rising and 25 Sects &
  Violets host reminder tokens to `ROLE_REMINDERS_RU` in the existing
  one-line Russian style, so the Secrets screen has a checklist for every
  scenario.
- [x] `src/core/model/rules.ts` + `src/core/engine/setup.ts`: exported
  `SetupProblem` with optional `vars` and filled it for the role, count, team,
  bluff and mask codes; `bagErrors`, `setupErrors` and `secretsErrors` return
  that shape, with `code` and `message` unchanged.
- [x] `node --test src/core/engine/setup.test.ts src/core/model/rules.test.ts`
  → `ℹ tests 19`, `ℹ pass 19`, `ℹ fail 0`.

## 3. Blast radius

- [x] `node --test src/core/engine/engine.test.ts` → `pass 61`, `fail 0`.
- [x] `node --test src/core/engine/bmr.test.ts` → `pass 82`, `fail 0`.
- [x] `node --test src/core/model/scripts.test.ts` → `pass 12`, `fail 0`.
- [x] `node --test src/core/model/presets.test.ts` → `pass 11`, `fail 0`
  (after the owner added `lunaticShownId: bag.lunaticShownId` to the test's
  `bagErrors` call, which SET6 requires).
- [x] `src/core/engine/snv.test.ts` kept one failure:
  `the Vigormortis -1 Outsider choice is rejected when there is no Outsider to
  remove`. Its bag (Fang Gu plus Vigormortis at seven players) contradicts SET2
  and the Vigormortis setup rule; the Sects & Violets owner rewrites it.

## 4. OpenSpec

- [x] `proposal.md` names `Issue: #171`.
- [x] `specs/game/setup/spec.md` modifies the modifier, bag-validation and
  suggested-bag requirements and adds the deal-permutation, clean-re-deal,
  reminder-token and localizable-problem requirements, each with its source
  and asserting test.
- [x] `specs/game/trouble-brewing/spec.md` modifies the first-night pair
  requirement and adds the Drunk's setup false-information requirement.
- [x] `design.md` records the attribution, registration, permutation and
  direction decisions.
- [x] `npx openspec validate --changes --strict`.

## 5. Hand-off to other owners

- [x] `src/ui/screens/secrets.tsx`: offers the zero answer through `librarianZeroLegal` and `[data-info-zero]`; the `setup-legal-bags` game asserts it.
- [x] `src/ui/screens/secrets.tsx`: `infoRoleChoices` offers the not-in-play characters held by a registering Spy or Recluse; the `setup-legal-bags` game asserts the pair.
- [x] `src/ui/screens/secrets.tsx`: renders `ROLE_REMINDERS_RU` for all three scripts through `[data-reminders]`; the `setup-legal-bags` game compares the rows to the engine data.
- [x] `src/ui/screens/setup-messages.ts`: merges `problem.vars` into the `setupProblemKey` context and refuses an unfilled placeholder; `setup-messages.test.ts` covers both.
- [x] `src/ui/screens/bag.tsx`: confirmed SET5 needs no change; `applyBag` copies `bag.godfatherOutsider`.
- [x] `src/ui/screens/seat.tsx`, `sheet.tsx`: landed in the UI wave — `/seat` is names-only and the sheet shows each scenario's own Travellers; the `privacy` and browser checks assert both.
