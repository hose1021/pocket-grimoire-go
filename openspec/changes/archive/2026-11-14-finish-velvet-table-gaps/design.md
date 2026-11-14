# Design

## Context

See `proposal.md` for the backlog. The console code lives on
`feat/velvet-table-console` in `/Users/hose/Programming/grimoria-velvet-table-console`;
PR #169 is open and its last fixes are uncommitted there. The `app/table-console`
capability is introduced by that pull request's OpenSpec change, so this delta
targets the path that exists after #169 merges.

The console reads `tableProjection` and `seatProjection` from
`src/application/read-models/table.ts`, dispatches through the shell ports, and
renders the ring, dock, cards and dialogs with React. Locales live in
`src/ui/i18n/locales/{ru,en,az}.ts`; `t()` is the only UI string seam. The UI
harness is `scripts/browser-check.mjs`; the visual baseline is
`scripts/fixtures/computed-styles.json`.

## Goals / Non-Goals

**Goals:**

- Close every section 4 item except the fixes PR #169 already carries.
- Keep every rule decision in the engine and every presentation value in the UI.
- Record the remaining behavior in specs with scenarios and test references.

**Non-Goals:**

- Re-open the Sailor, mastermind-result, drunk/poisoned, Devil's Advocate and
  Fool, Professor, previous-target, threshold, guide or Mastermind banner fixes.
- Change the game rules, the save schema version, or the route table.
- Add a dependency or a second stylesheet.

## Decisions

### Dependency and base

Apply this change after #169 merges. If the owner wants it earlier, rebase the
change branch onto `feat/velvet-table-console` and carry the delta. The planning
worktree stays on `origin/main` so the artifacts are reviewable before the
prerequisite lands. Alternative: implement on `main` now; rejected because the
console code and the `app/table-console` spec do not exist there.

### Read model owns derived console state

Extend `SeatProjection` with the facts the ring needs and no rule outcome:
`registeredDead`, `scheduledDeath` (from active `pukka-death` effects), and the
effect list with `kind` and `sourceId`. The ring maps those fields to badges and
resolves the source through `ports.roles.byId`; it does not read `state.effects`
or decide whether a death will resolve. Alternative: compute in the screen from
`state.effects`; rejected because two screens would duplicate the logic.

### Locale-neutral engine notes

The engine keeps `note` as the human-readable log string. Add optional
`noteKey` and `noteVars` to a night step. The step definitions and the dynamic
role handlers set the key and its variables; the console renders
`t(noteKey, noteVars)` and falls back to `note` when the save has no key or the
catalog lacks it. This keeps the engine locale-free and makes old saves
readable. `validateState` accepts the optional fields; no schema bump is needed.
Alternative: write Russian literals in the engine; rejected because it breaks
the en/az catalogs. Alternative: translate raw strings in the UI; rejected as
brittle.

The static Bad Moon Rising definitions (`src/core/engine/bmr.ts`) are the first
batch because they surface English verbatim. The dynamic notes in `bmr.ts`,
`sv.ts` and `night.ts` move to keys with named variables in the same pass. Log
lines keep `note`, so the journal remains readable without a key.

### Bag count stepper

Keep a synchronous ref seeded from `state.setup.count` and updated on every
store publication; each activation computes from the ref and writes the ref
before dispatching. The #169 worktree already contains this fix uncommitted; if
it is not in the merged branch, this change re-applies it. Alternative: disable
the controls while an update is pending; rejected because it adds state and
still reads a stale value on the second click.

### Day help, decision sheets and the minion card

`DayCard` currently renders the whole legacy day card inside the day-help
dialog. Replace that body with the role-form components only (Virgin, Slayer,
Gossip, Juggler, Moonchild and the scenario equivalents). The dock keeps the
execution target, votes and result. The Gambler guess and the Tinker decision
move above the shared death/revival marking list; the Tinker gets a two-option
decision that writes the existing death draft. The minion card gets its own
dismissal action that clears `infoKey` only, leaving the step-sheet overlay in
place.

### New game reset

Run the reset through the existing `newGame` command, then route to `/bag` only
after the store publishes the fresh snapshot. The over panel closes; the table
screen must render the setup phase and no stale winner, review or table state.
If the command is rejected, keep the over panel and show the reason. Alternative:
route first and reset on `/bag`; rejected because a failed save would leave the
old game on the table.

### Victory copy

Derive the over-panel line from `winner.reason` plus `state.day.execution`: when
`demon-dead` follows an execution whose player is a Demon, show the executed
copy; otherwise show the night-death or inheritance copy. No new reason code is
planned. If the state cannot distinguish the cases in practice, add a
`demon-executed` reason with an engine test rather than guessing in the UI.

### Browser checks and style baseline

Migrate the selectors in `scripts/browser-check.mjs` to `[data-table-dock]`,
`[data-act="complete"]`, `[data-act="step-confirm"]`, `[data-act="day-help"]`,
`[data-seat-open]` and `[data-act="execute"]`, and open the day-help sheet
before the Virgin form. Record the computed-style baseline after the console
changes with `node scripts/style-parity.mjs --record --root <built dist>`, then
check it with `--check`. Alternative: hand-edit the baseline; rejected because
it hides real computed changes.

### Night order and the untested scenarios

Compare `BMR_NIGHT_FIRST` and `BMR_NIGHT_OTHER` with the official night sheet in
`docs/rules-sources.md` and the committed official JSON snapshots before editing
`src/core/model/rules.ts`. Add engine tests for the audit gaps: Mayor win at
three alive, tied votes, Butler, Zombuul night kill, Innkeeper and Exorcist
reverse cases, Po, and Godfather execution survival. These are tests of existing
requirements, not new rules.

## Risks / Trade-offs

- [PR #169 changes under us] → Rebase and re-read the touched files before the
  first edit; the tasks start with a confirmation that the watched code exists.
- [Optional note fields rejected by the state validator or old saves] → Extend
  `validateState` and keep the raw `note` fallback; add a legacy-save test.
- [Dynamic note keys lose context] → Keys carry named variables for player
  names, roles and numbers; the UI escapes values through the existing `t()`.
- [Browser checks are slow and environment-dependent] → Migrate one scenario at
  a time, run the focused checks, and keep the known WebKit harness symptom out
  of the acceptance criteria.
- [Style baseline records transient font or anti-aliasing noise] → Record on
  the same headless browser and viewport set the check uses, then run `--check`
  twice.

## Migration Plan

1. Merge #169, or rebase this branch onto it.
2. Implement in the order in `tasks.md`; no save migration is required.
3. Run `npm run verify`, the migrated `node scripts/browser-check.mjs`, and the
   two BMR/TB game walkthroughs.
4. Rollback is a revert of the change branch; old saves still carry `note`, and
   the console falls back to it.
5. After the owner merge, archive the change and remove the worktree and the
   local branch.
