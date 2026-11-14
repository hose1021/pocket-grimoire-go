# Proposal

Issue: #171
Follow-up to #170 and PR #169.

## Why

The 2026-11-14 full rules audit compared the Velvet console engine with the
pinned official pages and found rules the engine resolves differently from the
printed text: registration is read for drunk or poisoned Spies and Recluses, a
Poisoner keeps its poison after becoming the Imp, a Mayor redirect onto the Imp
counts as a self-kill, the Virgin's first nomination is lost after a day
execution, a corpse can be executed, the Sailor dies to an execution, the
Zombuul's replaced death is invisible to the day, the Fool is spent under Tea
Lady or Innkeeper protection, Bad Moon Rising target restrictions are only in
the ring, and the day-phase guards are missing. Each defect changes a death,
an execution or a winner.

## What Changes

- Ignore every Spy and Recluse registration while the registrant is drunk or
  poisoned, and reject a registration recorded that way.
- End every effect a player sourced when that player becomes the Demon.
- Keep a Mayor redirect onto the Imp a normal Demon death, not a self-kill.
- Record and spend the Virgin's first nomination from the table path even after
  the day already recorded an execution.
- Reject the execution of a dead player and stop counting a corpse selection as
  an execution event for the Mayor and Vortox checks.
- Make a sober Sailor survive every cause of death; only the Assassin's bypass
  kills it.
- Record the Zombuul's replaced first death as a Death entry while the player
  stays alive.
- Resolve Tea Lady and Innkeeper protection before the Fool's ability.
- Enforce alive / not-yourself / two-alive BMR target rules in `completeStep`.
- Scope the Saint loss to the day of the execution and reject `startNight`
  during the day.

Out of scope: every finding owned by another wave, the UI change for the
dead-player execution selector, and the locale catalogs. The report lists the
locale keys the UI needs.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `game/trouble-brewing`: impaired registration, the Virgin first nomination at
  the table, the effects of the new Demon, and the Saint's loss scope.
- `game/day-and-win`: the Mayor and Vortox checks use an execution death, and a
  dead player cannot be executed.
- `game/bad-moon-rising`: Sailor survival, the Zombuul replaced death, the
  Fool's spent order, and BMR target legality.
- `game/command-engine`: registration legality for impaired registrants and the
  night-start phase guard.

## Impact

`src/core/engine/effects.ts`, `death.ts`, `day.ts`, `night.ts`,
`information.ts`, `host-choice.ts`, `engine.test.ts`, and the verified rows of
`docs/rules-matrix.md`. No save schema change: the Zombuul Death entry is an
ordinary `Death` record with an extra `zombuul` marker, and old saves keep
working.
