# Spec Delta

## ADDED Requirements

### Requirement: Scheduled deaths on the ring

The ring SHALL mark a seat whose death the engine has scheduled but not yet
resolved, SHALL distinguish that mark from a resolved death, and SHALL clear it
when the death resolves or is prevented.

**Source**: [Issue #170](https://github.com/hose1021/grimoria/issues/170); `SPEC.md` "Screens" (`/table`)
**Tests**: `src/core/engine/bmr.test.ts`, `src/ui/screens/table/helpers.test.ts`, `src/application/read-models/table.test.ts`, `scripts/browser-check.mjs`

#### Scenario: Pending Pukka death

- **WHEN** a Pukka death is scheduled for the next resolution
- **THEN** the target's seat shows a scheduled-death mark and the seat stays
  alive until the engine resolves the death

#### Scenario: Prevented death

- **WHEN** the scheduled death is prevented or suspended
- **THEN** the mark clears and the seat shows no scheduled death

### Requirement: Zombuul registered death

When the Zombuul registers as dead while alive, the ring SHALL show a fake-death
state distinct from a real death, and the console SHALL warn before the next
execution that the registered body may still act.

**Source**: [Zombuul r3022](https://wiki.bloodontheclocktower.com/index.php?title=Zombuul&oldid=3022); [Issue #170](https://github.com/hose1021/grimoria/issues/170)
**Tests**: `src/core/engine/bmr.test.ts`, `src/ui/screens/table/helpers.test.ts`, `scripts/browser-check.mjs`

#### Scenario: First Zombuul death

- **WHEN** a sober Zombuul dies for the first time
- **THEN** its seat reads as registered dead, not as a real death

#### Scenario: Before the next execution

- **WHEN** the host opens the execution control after a Zombuul registered death
- **THEN** the console warns that the body may still act and does not decide the
  execution automatically

### Requirement: Nomination readout after dawn

After the dawn report is dismissed, the ring centre SHALL show the active
nomination with its nominator, nominee and vote tally, or an explicit
no-nomination state. The dismissal control SHALL NOT promise to open a
nomination.

**Source**: [Issue #170](https://github.com/hose1021/grimoria/issues/170); `SPEC.md` "Screens" (`/table`)
**Tests**: `src/ui/screens/table/helpers.test.ts`, `scripts/browser-check.mjs`

#### Scenario: No nomination yet

- **WHEN** the dawn report is dismissed before any nomination exists
- **THEN** the centre says that no nomination is open and offers no control that
  implies one can be opened from there

#### Scenario: Recorded nomination

- **WHEN** a nomination has votes
- **THEN** the centre names the nominator, the nominee and the current tally

### Requirement: Effect badge source

A seat's effect badge SHALL name the effect's source role or owner when the state
records one, and SHALL use a generic badge only when no source exists.

**Source**: [Issue #170](https://github.com/hose1021/grimoria/issues/170); `SPEC.md` "Screens" (`/table`)
**Tests**: `src/ui/screens/table/helpers.test.ts`, `src/application/read-models/table.test.ts`, `scripts/browser-check.mjs`

#### Scenario: Sourced drunk state

- **WHEN** a Sailor or Courtier makes a player drunk
- **THEN** the badge names the source role and the affected player

#### Scenario: Sourceless state

- **WHEN** an effect has no recorded source
- **THEN** the badge uses the generic effect text and does not invent a source

### Requirement: Day help sheet

The day-help sheet SHALL contain only role-specific forms and SHALL NOT
duplicate the generic execution target, execution result or nomination controls
that the dock owns.

**Source**: [Issue #170](https://github.com/hose1021/grimoria/issues/170); `SPEC.md` "Screens" (`/table`)
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Virgin form

- **WHEN** the host opens the day-help sheet with the Virgin in play
- **THEN** the sheet shows the Virgin nomination form and no generic execution or
  nomination form

#### Scenario: Execution stays in the dock

- **WHEN** the host records an execution
- **THEN** the execution control is the dock control and the day-help sheet
  shows no second execution control

### Requirement: Role decision sheets

The Gambler and Tinker sheets SHALL keep the role decision separate from the
death and revival marking list, SHALL give the Tinker an explicit decision
control, and SHALL NOT show adjacent seat controls with opposite effects.

**Source**: [Issue #170](https://github.com/hose1021/grimoria/issues/170); `SPEC.md` "Screens" (`/table`)
**Tests**: `scripts/browser-check.mjs`, `src/core/engine/bmr.test.ts`

#### Scenario: Gambler guess

- **WHEN** the host records the Gambler's guess
- **THEN** the guess control is separate from the death and revival marking list

#### Scenario: Tinker decision

- **WHEN** the Tinker step is active
- **THEN** the sheet offers an explicit decision control and the marking list is
  not the only way to decide the death

### Requirement: Minion information card independence

The minion-information card's hide control SHALL close only the card, and the
step sheet and its confirm control SHALL stay available afterwards.

**Source**: [Issue #170](https://github.com/hose1021/grimoria/issues/170); `SPEC.md` "Screens" (`/table`)
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Hide the minion card

- **WHEN** the host hides the minion-information card
- **THEN** the step sheet remains open with its confirm control

#### Scenario: Confirm after hiding

- **WHEN** the host confirms the step after hiding the minion card
- **THEN** the step completes without reopening the card

### Requirement: Live nominations stay at the table

The day console SHALL offer exactly three actions: execute the selected player,
end the day without execution, and open day help. It SHALL NOT offer nomination
or vote entry. The vote threshold and an existing saved nomination SHALL stay
read-only.

**Source**: [Issue #170](https://github.com/hose1021/grimoria/issues/170); `SPEC.md` "Screens" (`/table`)
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Three day actions

- **WHEN** the day console renders
- **THEN** the dock shows execute, end day and day help, and no nomination or
  vote controls

#### Scenario: Execution without app-side votes

- **WHEN** the host selects a living player and executes
- **THEN** the execution is recorded without entering a nomination or a vote
  list in the app

#### Scenario: Saved nomination stays read-only

- **WHEN** an imported or legacy save already carries a nomination
- **THEN** the hub shows it and its tally without offering an edit control

### Requirement: One undo control

The console SHALL expose one undo control in the fixed dock. The table menu
SHALL NOT repeat undo, and the local step-draft reset SHALL be labelled as
clearing the selection rather than as undoing a turn.

**Source**: [Issue #170](https://github.com/hose1021/grimoria/issues/170); `SPEC.md` "Screens" (`/table`)
**Tests**: `scripts/browser-check.mjs`

#### Scenario: One dock control

- **WHEN** the console renders a night or day phase
- **THEN** the fixed dock carries the only undo control and the table menu has
  none

#### Scenario: Undo after a step

- **WHEN** the host skips a night step and activates the dock undo
- **THEN** the skipped step returns

#### Scenario: Draft reset label

- **WHEN** the host clears the target or answer draft
- **THEN** the control reads as clearing the selection, not as undo

### Requirement: Deal screen return action

The deal screen SHALL offer one return-to-table action with a single wording and
meaning, and SHALL NOT show two identically worded controls.

**Source**: [Issue #170](https://github.com/hose1021/grimoria/issues/170); `SPEC.md` "Screens" (`/table`)
**Tests**: `scripts/browser-check.mjs`

#### Scenario: One return control

- **WHEN** the deal screen renders
- **THEN** exactly one control returns to the table and its label states that
  destination

#### Scenario: Return keeps the deal

- **WHEN** the host returns to the table from the deal screen
- **THEN** the dealt roles and the saved game are unchanged
