# Proposal

Issue: #171
Depends on: PR #169 (`feat/velvet-table-console`). Apply this change on the
velvet branch; it edits the console those files introduce.

## Why

The 2026-11-14 host-assistant audit of issue #171 found the console asks the
wrong questions, hides the wrong answer and speaks the wrong language. The
computed information (the Lunatic report on the Demon's step) is discarded in
favour of a static note; a Courtier, Gambler or Cerenovus can confirm without
naming a character; the Sailor's drunk pick silently defaults to the first
target; the Mayor redirect select shows a choice the gate treats as unanswered;
the resurrect select offers targets the engine rejects; the execution is split
between two surfaces with different legality and no preview; the day-help sheet
still carries a madness execution and a manual winner; and rejection, setup and
win-reason copy stays Russian or raw. The demo button overwrites the saved game.

This change fixes the console-side findings only. Engine-correctness findings
that need new commands or engine rules are reported to the engine owners, not
implemented here.

## What Changes

- `infoText` prefers the computed note over the static `noteKey`, so the Demon
  sees the Lunatic's report.
- Bad Moon Rising and Sects & Violets system steps (minioninfo, demoninfo,
  demonchange) get their own guide, and the Lunatic step keeps its own.
- A Drunk actor's step uses the Drunk guidance and states that the ability does
  not work and the information is false.
- A character choice (Courtier, Gambler, Cerenovus, Philosopher, Pit-Hag) and a
  Sailor/Innkeeper drunk pick are mandatory blockers; an empty pick never means
  the first target.
- The step sheet lists every blocker for a disabled Confirm, not one hardcoded
  Russian sentence.
- The Mayor redirect select has an explicit unanswered state that matches the
  gate, and the resurrect select lists only the targets the engine accepts.
- One shared execution decision: the day card and the dock read the same target,
  the same survival choice and the same living-target legality.
- The execution is previewed before it applies.
- The day-help sheet contains only role forms; the madness review, the manual
  winner and the Tinker day death move to the table menu.
- An impaired actor's player card shows the selected `given` answer first.
- Rejection and setup reasons render through the localized `error.N` keys, with
  `error.66` split into an illegal-answer sentence and a madness-review sentence.
- `winReason.vortox`, `winReason.evil-twin` and `winReason.klutz` exist in all
  three catalogs, and the RU guide and `error.15/16` drift is corrected.
- The seat picker collects every target the step allows, including the Po's
  three targets.
- The Pacifist survival control names its rule; the Tinker gets a day-death
  control and the missing engine command is reported.
- The `/table` demo button opens `/demo` instead of rebuilding a demo game on
  the saved store.

Out of scope: every rule change in `src/core/**` itself, and the demo screen
implementation (the button only routes to it). The Sects & Violets
Flowergirl/Town Crier answer is covered: the engine asks the host when no ended
day exists, so no vote-source command is needed.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `app/ui-shell`: the console's night decisions, blocker list, Mayor redirect,
  resurrect options, shared execution decision and preview, day-help scope,
  seat picker multi-target rule, Pacifist/Tinker day controls and the demo route.
- `app/ui-and-privacy`: computed-note priority, Drunk guidance, localized
  rejection/setup reasons, the given-answer player card, the split `error.66`,
  the three missing win reasons and the corrected Russian copy.

## Impact

`src/ui/screens/table/{helpers,step-context,cards,dialogs,dock,index,drafts}.ts(x)`,
`src/entry/guidance.ts`, `src/ui/i18n/locales/{ru,en,az}.ts`,
`src/ui/i18n/strings.test.ts`, `src/application/read-models/table.ts` and its
test. No schema change and no save migration: every new value is a transient
console draft.
