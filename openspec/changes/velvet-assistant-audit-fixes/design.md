# Design

## Scope boundary

The audit lists engine-correctness findings (BMR/SV legality, impairment gates,
win timing) and assistant findings. Only the console's own answers are changed
here. Everything that needs a rule decision or a new command stays with the
engine owners and is listed in the report; the console never compensates for a
wrong engine result.

## Information priority

`infoText` reads a step's computed information first. The engine already attaches
the Lunatic's report to the Demon's note; the static `step.noteKey` remains the
fallback when the computed text is empty. This changes no engine value and no
stored save.

## Guidance without a shared port change

The guidance port is `for(step)`, so it cannot know whether the actor is the
Drunk. The BMR/SV and system-step instructions stay in `src/entry/guidance.ts`;
the Drunk override is a pure view helper (`guideForStep`) in
`src/ui/screens/table/helpers.ts`, which receives the state and replaces the
shown role's guide when `player.roleId === "drunk"`. One helper serves the step
card, the step sheet and the dock.

## Mandatory decisions

`stepBlockers` gains `role` and `drunk`, computed in `stepContext`:

- `role`: `step.roleChoices` is non-empty and no draft role is stored. The
  Courtier, Gambler, Cerenovus, Philosopher and Pit-Hag all carry this list.
- `drunk`: a Sailor or Innkeeper step has its targets and no explicit drunk
  pick. The select loses its "None" entry and shows a disabled placeholder.

Both blockers disable the sheet Confirm and appear in the dock and the sheet with
their own localized sentence.

## One execution decision

`executeTarget` already lived in the shared drafts; `executeSurvives` joins it,
so the day card and the dock read the same execution. Both require a living
target and honour the survival flag, and both send the preview identity the
preview pinned. The dock previews the execution with the shared
`ConsequenceList` before the button applies it.

## Day-help scope

The day-help sheet keeps the role forms (Virgin, Slayer, Gossip, Juggler,
Moonchild, Mastermind warning). The madness review, the manual winner and the
new Tinker day-death control move to `DayActionsPanel`, rendered in the table
menu. The existing `data-madness-*`, `data-winner-team` and
`data-act="declare-winner"` hooks move with them.

## Engine gaps

- **Pacifist (BMR21)**: the engine owner landed the survival gate
  (`error.57`: only a good player survives, and only while the Pacifist is
  alive and unimpaired). The console names the rule on the control and
  catalogues the rejection in all three locales.
- **Tinker (BMR22)**: the engine owner landed `tinkerDeath` (`{ playerId }`),
  which records a real ability death for a sober, living Tinker. The day control
  dispatches it instead of a manual correction.
- **Flowergirl / Town Crier (SV3)**: landed without a vote ledger. The engine
  demands a host answer when the ended day is missing, and the console renders
  the yes/no control for that answer; each answer is stored on the step, so no
  separate vote source is needed.
- **Juggler first day (SV11)**: the console reads `state.juggler.day` first and
  uses `jugglerGuessingDay` as the fallback for a first report before any guess
  exists; a persisted first-day value on role gain would remove the fallback.
- **Klutz public choice (SV4)**: the `recordKlutzChoice` command exists and the
  queued Klutz step records the chosen living player, so the console resolves an
  evil choice as soon as the death is announced; no separate day-card control is
  required.

## Tests

Focused RED/GREEN tests live in `src/ui/screens/table/helpers.test.ts`,
`src/application/read-models/table.test.ts` and
`src/ui/i18n/strings.test.ts`. They assert the note priority, the blocker order
and copy, the localized rejection, the given-answer card, the seat-picker
selection algorithm, the redirect value, the legal resurrect choices, the audit
win reasons, and the corrected Russian copy.
