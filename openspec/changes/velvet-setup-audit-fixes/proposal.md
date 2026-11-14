# Proposal

Issue: #171

## Why

The 2026-11-14 full audit of the Velvet worktree measured the setup model against
the pinned official pages. The Secrets screen is stricter than the printed rules
and rejects information the Storyteller is allowed to give, while the bag
validator and the deal accept states the table cannot run:

- A Librarian could not learn "0" when the only Outsider in play was a Recluse
  registering as a Minion (issue TB1).
- A Washerwoman, Librarian or Investigator pair could not name a character held
  by a registering Spy or Recluse when that character was not in the bag (TB2).
- A Drunk shown the Librarian could not record the false "0" answer (TB8).
- Two setup modifiers that cancel each other out were rejected even when the
  counts matched `compositionFor`, and a genuinely impossible combination was
  reported as an "0 of -1" team counter (SET2, SET12).
- `dealGame` accepted an assignment that repeated a role, used a role outside
  the bag or skipped a seat (SET3).
- A re-deal kept the previous game's gossip, grandchild choice, manual
  corrections and host notes (SET4).
- `randomBag` composed a Godfather-direction bag but did not return the
  direction, so the bag screen applied the opposite counters (SET5).
- A bag with the Lunatic and no shown Demon passed `bagErrors`, `validateState`
  and dealt the Lunatic its real role (SET6).
- The Secrets screen had no host reminder checklist for Bad Moon Rising or
  Sects & Violets, because `ROLE_REMINDERS_RU` held the Trouble Brewing roles
  only (SET10).

## What Changes

- `secretsErrors`: the Librarian zero is legal while every Outsider in play may
  register as something else (a Recluse); a first-night pair may name a
  not-in-play character when the pair holds a registering Spy or Recluse; the
  Drunk may record the Librarian's zero as false information.
- `bagErrors`: the Godfather and Vigormortis direction errors fire only when the
  modifier is part of an impossible composition; a negative required team count
  returns the stable `composition-impossible` reason instead of a negative
  counter; a Lunatic in the bag requires a shown Demon even when the caller
  omits the field.
- `validateState` and `dealGame` reject a Lunatic without a shown Demon.
- `dealGame` requires the assignment to be a permutation of the bag over the
  seat order, and a new deal clears `gossip`, `setup.grandmotherId`,
  `corrections` and `notes`.
- `randomBag` returns `godfatherOutsider` so the bag screen applies the
  direction the bag was composed for.
- `ROLE_REMINDERS_RU` gains a Russian reminder token list for every Bad Moon
  Rising and Sects & Violets role, so the Secrets screen shows its checklist in
  all three scenarios.
- Every bag, setup and secrets problem carries optional `vars` with the values
  the localized `error.<code>` key interpolates (role ids, counts, team, shown
  mask), so the UI never falls back to the Russian message; `code` and
  `message` stay unchanged.
- Tests: `src/core/engine/setup.test.ts` gains ten behavioral cases, one per
  finding, each written RED before the fix, and `src/core/model/rules.test.ts`
  asserts the interpolation values.

Out of scope: the corresponding UI controls (the Secrets zero choice, the
not-in-play role selector, the bag screen's direction copy already reads the new
field) and the S&V Vigormortis composition decision, which belongs to SV2.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `game/setup`: the modifier requirement becomes "legal when the counts match
  the composition, impossible combinations name their reason", the legal bag
  requirement makes the Lunatic mask mandatory, the deal is a bag permutation,
  a re-deal resets the previous game, the random bag returns its Godfather
  direction, and every official role carries host reminder tokens.
- `game/trouble-brewing`: the Librarian zero admits a registering Recluse, the
  first-night pair admits a registering Spy or Recluse, and the Drunk shown the
  Librarian may record the zero.

## Impact

- Code: `src/core/model/rules.ts` (`RandomBag`, `randomBag`, `bagErrors`,
  `ROLE_REMINDERS_RU`, `SetupProblem`), `src/core/engine/setup.ts`
  (`setupErrors`, `secretsErrors`, `dealGame`), `src/core/model/state.ts`
  (`validateState`).
- Tests: `src/core/engine/setup.test.ts` (ten new cases),
  `src/core/model/rules.test.ts` (new: the interpolation values).
- Follow-up outside this change: `src/core/model/presets.test.ts` needed
  `lunaticShownId` in its `bagErrors` call (owner applied it), and
  `src/core/engine/snv.test.ts`'s Vigormortis case contradicts SET2 and belongs
  to the SV2 owner.
- UI follow-up: `src/ui/screens/secrets.tsx` must offer the Librarian zero to a
  Drunk and the registering not-in-play character in the first-night role
  selector; the engine now accepts both.
