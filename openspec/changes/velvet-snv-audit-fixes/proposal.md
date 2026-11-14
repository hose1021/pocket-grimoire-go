# Proposal

Issue: #171

## Why

The 2026-11-14 full audit compared the Sects & Violets engine with the pinned
official pages. Eleven findings in section 3 are wrong in `sv.ts` and
`retention.ts`, and three more in the shared night/day modules:

- SV2: a legal seven-player Vigormortis bag was rejected (`vigormortis-minus`)
  even though the official text says the -1 Outsider is a no-op when there is
  no Outsider token to remove.
- SV4: the Klutz's public choice was a private night step at the end of the
  queue, so it was asked long after the death and a target who died in between
  left the step unresolvable.
- SV5: a Pit-Hag-created Demon was given a normal Demon wake and its deaths
  were tagged as Demon attacks, so the Sage woke for a Pit-Hag kill.
- SV7: the Dreamer, Sage and Mathematician returned a bare note, without the
  impairment and Vortox branch that the Clockmaker, Oracle, Seamstress,
  Flowergirl, Town Crier and Juggler steps use.
- SV8: a dead Minion that became drunk or poisoned kept the Vigormortis
  retention, and the permanent neighbour poison bypassed its source's
  impairment.
- SV9: a Philosopher who borrowed the Klutz never got the death-triggered wake.
- SV10: the Sweetheart's drunk started at the Sweetheart's night slot instead
  of at the death ("from now on").
- SV11: the Juggler needed a guess to wake, was limited to one guess per
  player, and hardcoded day one as "your 1st day".
- SV12: the Pit-Hag choosing a character already in play was an `error.52`
  rejection instead of the legal "nothing happens" outcome.
- SV13: an Evil Twin created by the Pit-Hag had no twin pair, so both the
  execution win and the "good can't win" block disappeared.
- SV1, SV3, SV6: the Witch's placed curse was dropped when the Witch died or
  was impaired, the Flowergirl and Town Crier had no engine path to a host
  answer without a vote ledger, and a madness execution was impossible during
  the night.

## What Changes

- `compositionFor` applies the Vigormortis -1 Outsider only when the running
  Outsider count allows it; `bagErrors` no longer reports `vigormortis-minus`.
- `sv.ts` gains `recordKlutzChoice`: the public Klutz choice is recorded when
  the player learns of the death, resolves an evil target immediately, and
  finishes any queued Klutz step; a new choice must still be a living player.
- `replaceCharacter` gains `suppressWake`, so a Pit-Hag-created Demon takes no
  Demon turn; the Pit-Hag step carries `canKill` for the arbitrary deaths, and
  those deaths are not tagged as Demon attacks.
- The Dreamer, Sage and Mathematician report `impaired` and
  `needsChoice: impaired || vortoxFalsifies(...)` like the other computed
  information steps.
- `minionRetainsAbility` requires the dead Minion to be sober and healthy, and
  `reconcileVigormortisPoison` toggles the neighbour poison with that state.
- A borrowed Klutz joins the death-triggered borrowed abilities, built from one
  `DEATH_WAKE_SPECS` table shared with the printed death wakes.
- The Sweetheart drunk starts at the Sweetheart's death.
- Juggler guesses are read as a list of player/character pairs (repeats
  allowed, zero to five), and the step follows the day the guesses were made.
- Choosing a character already in play records the legal no-op.
- A Pit-Hag-created Evil Twin gets a pair, so both the win and the block stay
  active.
- Tests: `src/core/engine/snv.test.ts` gains or rewrites fourteen behavioural
  cases, each written RED before the fix.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `game/sects-and-violets`: composition, Witch curse, Pit-Hag, Philosopher,
  Evil Twin pair, Klutz, Vigormortis, Sweetheart, Juggler, computed
  information and madness execution timing.

## Impact

- Code: `src/core/engine/sv.ts`, `src/core/engine/retention.ts`,
  `src/core/model/rules.ts` (`compositionFor`, `bagErrors`, `randomBag`).
- Tests: `src/core/engine/snv.test.ts`.
- Landed in the neighbouring owner files: `src/core/engine/day.ts`, `src/core/engine/effects.ts`, `src/core/model/types.ts`, `src/core/model/state.ts`, and `src/core/engine/index.ts`, which re-exports `recordKlutzChoice`.
- UI follow-up: the day card needs the Klutz public-choice control and the
  Juggler guess entry needs to record zero to five pairs.
- Locale keys: `note.pithagInPlay` and the `winReason.*` keys listed in
  `tasks.md`.
