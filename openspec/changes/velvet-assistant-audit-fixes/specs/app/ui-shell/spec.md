# Spec Delta

## ADDED Requirements

### Requirement: Computed information outranks a static note

The night card and the step sheet SHALL show a step's computed information when
the engine provides it, and SHALL fall back to the static note key only when the
computed text is empty. The Demon's step SHALL therefore show the Lunatic's
report.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS2); [Lunatic](https://wiki.bloodontheclocktower.com/index.php?title=Lunatic)
**Tests**: `src/ui/screens/table/helpers.test.ts`

#### Scenario: Stored Lunatic report

- **WHEN** the Demon's step carries a computed note naming the Lunatic and the
  target the Lunatic chose
- **THEN** the card shows that sentence and does not show the static role note

#### Scenario: Static note only

- **WHEN** the computed note text is empty
- **THEN** the card shows the localized static note key

### Requirement: Mandatory host decisions block Confirm

A step that names a character SHALL require that character before it can be
completed, and a Sailor or Innkeeper step SHALL require an explicit drunk pick.
An empty pick SHALL NOT be interpreted as the first target. The step sheet SHALL
list every unanswered decision with its own localized reason next to the
disabled Confirm control.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS5, AS7, AS10); [Courtier](https://wiki.bloodontheclocktower.com/index.php?title=Courtier)
**Tests**: `src/ui/screens/table/helpers.test.ts`, `src/ui/i18n/strings.test.ts`

#### Scenario: Courtier without a character

- **WHEN** the host opens the Courtier or Gambler step and confirms without
  choosing a character
- **THEN** Confirm stays disabled and the sheet names the missing character
  choice

#### Scenario: Sailor without a drunk pick

- **WHEN** the Sailor step has its target and no drunk pick
- **THEN** Confirm stays disabled, the drunk select has no "None" entry, and its
  placeholder is an unanswered state

#### Scenario: Several gaps at once

- **WHEN** the step lacks a target and a character
- **THEN** the sheet lists both reasons in the order the card explains them

### Requirement: Matching control state

The Mayor redirect select SHALL show the value the completion gate treats as
chosen, and an unanswered redirect SHALL have an explicit empty state. The
resurrect select SHALL list only the dead players the engine accepts: the
Professor's step target, or a Shabaloth target chosen on the immediately
preceding night.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS8, AS9); [Shabaloth](https://wiki.bloodontheclocktower.com/index.php?title=Shabaloth)
**Tests**: `src/ui/screens/table/helpers.test.ts`, `src/application/read-models/table.test.ts`

#### Scenario: Mayor attacked

- **WHEN** a healthy Mayor is the Imp's target and the host has not answered
- **THEN** the select shows its unanswered placeholder and the step stays
  blocked until the host picks the Mayor's fate

#### Scenario: Legal resurrect targets

- **WHEN** a Shabaloth step offers a resurrect choice after a night with chosen
  targets
- **THEN** only the dead players it chose on the preceding night are listed

### Requirement: One execution decision with a preview

The day card and the fixed dock SHALL share one execution target and one
survival choice, SHALL require a living target, and SHALL preview the execution
consequences before the command is applied. The preview's pinned identity SHALL
be reused by the apply command.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS12, AS24)
**Tests**: `src/ui/screens/table/helpers.test.ts`, `scripts/browser-check.mjs`

#### Scenario: Dead target selected

- **WHEN** the host selects a dead player on the day table
- **THEN** neither execution surface enables the control

#### Scenario: Survival chosen

- **WHEN** the host ticks the survival control and executes
- **THEN** the dock sends the same survival value the day card shows, and the
  consequence preview was visible before the click

### Requirement: Day help holds role forms only

The day-help sheet SHALL contain only the role forms and role panels. The
madness review, the manual winner declaration and the Tinker day-death control
SHALL live in the table menu.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS13)
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Madness is active

- **WHEN** the host opens day help while a madness review is due
- **THEN** the sheet shows no madness control and no winner declaration

#### Scenario: Madness review

- **WHEN** the host opens the table menu on the same day
- **THEN** the madness review, its reason field and its actions are available

### Requirement: Seat picker collects the allowed targets

A seat click SHALL toggle the target; a multi-target step SHALL keep adding up
to its maximum and drop the oldest choice at the limit. The Po's three-target
step SHALL behave like a two-target step.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (BMR2); [Po](https://wiki.bloodontheclocktower.com/index.php?title=Po)
**Tests**: `src/ui/screens/table/helpers.test.ts`

#### Scenario: Po chooses three

- **WHEN** the Po step allows three targets and the host taps three seats
- **THEN** all three are selected, and a fourth tap replaces the oldest

#### Scenario: Single target

- **WHEN** the step allows one target
- **THEN** a tap replaces the previous choice and a second tap clears it

### Requirement: Pacifist and Tinker day controls

The survival control SHALL name the Pacifist rule when the Pacifist is in play.
A living Tinker in a script that contains them SHALL have a day-death control in
the table menu.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (BMR21, BMR22); [Pacifist](https://wiki.bloodontheclocktower.com/index.php?title=Pacifist); [Tinker](https://wiki.bloodontheclocktower.com/index.php?title=Tinker)
**Tests**: `src/ui/i18n/strings.test.ts`

#### Scenario: Pacifist in play

- **WHEN** the script contains the Pacifist and the host opens the execution
  controls
- **THEN** the survival control says that the Pacifist ability applies

#### Scenario: Tinker during the day

- **WHEN** a living Tinker exists and the day has no execution
- **THEN** the table menu offers a control that announces the Tinker's day death

### Requirement: A dialog never covers the over panel

When the game ends while a console dialog is open, the console SHALL close that
dialog once, and SHALL keep the export and import dialogs open. After the
transition the host SHALL still be able to open the roster and the menu over the
over panel.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) host-assistant follow-up
**Tests**: `src/ui/screens/table/helpers.test.ts`

#### Scenario: Slayer shot from day help

- **WHEN** the host records a Slayer shot from the day-help sheet and the shot
  ends the game
- **THEN** the day-help dialog closes and the over panel is visible without a
  manual dismissal

#### Scenario: Export dialog

- **WHEN** the game ends while the export dialog is open
- **THEN** the dialog keeps its export text and stays open

#### Scenario: Roster after the win

- **WHEN** the host opens the roster after the game has ended
- **THEN** the roster stays open and the over panel is not covered on load

### Requirement: Demo never touches the saved game

The console's demo control SHALL open the `/demo` route and SHALL NOT dispatch a
new game, a bag update, a deal or seat claims on the saved store.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (SET1)
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Prepared game on disk

- **WHEN** the host has a prepared game and activates the demo control
- **THEN** the console leaves for `/demo` and the saved game and undo history
  are unchanged
