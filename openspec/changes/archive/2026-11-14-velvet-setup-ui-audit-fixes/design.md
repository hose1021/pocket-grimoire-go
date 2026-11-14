# Design

## Context

Issue #171 records the 2026-11-14 audit. This change owns the four setup screens
(`bag`, `secrets`, `seat`, `sheet`); the model-side setup fixes live in
`openspec/changes/velvet-setup-audit-fixes` and already landed in
`src/core/model/rules.ts` and `src/core/engine/setup.ts`. The UI is React and
must stay outside `src/core`, so every rule the screens need is either called on
the existing model or expressed in a small pure module next to the screen.

## Decisions

### A projection for the public seat route (SET8)

`/seat` is readable by anyone at the table, and `SPEC.md` says "names only". The
screen now renders `publicSeats(order, players)` from
`src/ui/screens/seat-projection.ts`: an id, a seat number and a name. The role
artwork, the role name under each seat, the sidebar role column and the drag
ghost image are gone. The projection is a pure function so the privacy rule has
a DOM-free test instead of a source-reading test.

### The manual script decides the secrets pane (SET9)

`isBmrScript` and `isSnvScript` detect any BMR or S&V role in the pool, so a
mixed manual pool matched both. The screen now checks `isManualScript` first and
skips both script panes, which matches `secretsErrors`, already returning no
automatic secrets for a manual script.

### One reminder checklist for every script (SET10)

The BMR and S&V panes returned before the list. The rows are now built once
(`reminderRows`) from the roles in play and the shared `ROLE_REMINDERS_RU`, which
already contains all BMR and S&V entries, and rendered in all three panes with
the existing `remindersToPlace` key. The heading and the checklist use the same
`secrets-reminders` id and a `data-reminders` hook so the three panes stay
identical for the browser checks.

### Travellers belong to a scenario (SET11)

The role catalog marks every Traveller with its edition. The sheet now keeps
`SCENARIO_TRAVELLERS` in `sheet-scenarios.ts` and renders the selected
scenario's five; `all` renders the fifteen. The toggle and section stay. The
test compares the lists with `docs/official/roles.json`, so a wrong edition list
fails rather than a hand-copied constant being re-asserted.

### The bag owns its direction (SET5)

`randomBag` now returns `godfatherOutsider` (model change in the setup-owner
change). `applyBag` already copied it; the script switch did not, and sent `1`.
Both paths now copy `bag.godfatherOutsider ?? 1`, so the counters match the
composition the bag was built for. A random bag without a Godfather reports
`1`, which is the neutral direction.

### Rejections are visible and localized (SET7, AS15 UI part)

`loadBag` and `loadPool` ignored the `DispatchResult`. They now keep the library
open and write the reason into the dialog. The reason goes through
`rejectionText(rejectionOf(result))` from the console helpers, so an existing
`error.N` key wins and the engine message is only a fallback; `applyBag`, the
script switch, the deal and the first-night start use the same helper. Setup
validation problems carry stable codes (`herring`, `mixed-edition`,
`lunatic-shown`, ...) that are not in the catalogs yet, so `setupProblemKey`
looks them up as `error.<code>`. The bag screen supplies the totals it already
computes (`size`, `bluffs-count`, `team-<team>`, the modifier counts) and the
catalog role label; the dynamic per-role information codes map to the generic
`error.info*` key plus `{role}`. A translated key with an unsupplied
placeholder falls back to the engine message, so a literal brace never renders.
The keys listed in `tasks.md` now exist in ru/en/az, and the model carries `vars.role` for the role-naming codes; `strings.test.ts` asserts the parity.

### The stepper moves after the command (SPEC `/bag`)

`setCount` moved its local `countRef` before the "change the count?"
confirmation and never reverted it when the command was rejected, so the saved
count and the ref drifted. It now confirms first, updates the ref, and restores
the published count and the undo entry when `bagUpdate` is rejected. The ref is
the synchronous guard, so two activations in one frame still move two steps.

### Two more setup answers the engine already allows (TB2, TB8 UI part)

`librarianZeroLegal` mirrors `secretsErrors`: the zero is offerable while every
Outsider in play is a Recluse. `infoRoleChoices` mirrors the registration rule:
a Spy in play adds not-in-play Townsfolk and Outsider characters, a Recluse adds
not-in-play Minions, and the Drunk may be told any character of the team. Both
are pure and tested.

## Risks

- The seat screen no longer reads `ports.roles` at all; any browser check that
  expected a role image on the ring is stale by design (`SPEC.md` names only).
- `setupProblemText` namespaces codes as `error.<code>` because several setup
  codes collide with existing label keys (`herring`, `count`, `demon`). The
  catalog owner must add `error.`-prefixed keys, not bare ones.
- `randomBag` still throws Russian `Error` messages without a code
  (`Неподдерживаемое число игроков.` and two pool-size messages); those stay
  unlocalized until the model gives them codes.

## Verification

`node --test src/ui/screens/seat-projection.test.ts
src/ui/screens/secrets-options.test.ts src/ui/screens/sheet-scenarios.test.ts
src/ui/screens/setup-messages.test.ts`, the existing
`src/ui/screens/player-projection.test.ts` and `src/ui/screens/structure.test.ts`,
`node --test src/ui/i18n/strings.test.ts`, and
`npx openspec validate --changes --strict`.
