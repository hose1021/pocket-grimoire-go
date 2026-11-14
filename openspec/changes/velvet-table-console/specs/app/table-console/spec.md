# Spec Delta

## Purpose

Defines the Storyteller's table window: the seat ring and the state it carries,
the fixed action dock and the engine guidance it surfaces, the vote threshold
and dawn report, and the full-screen player card. The table is the primary
surface for reading and driving a game, on a desktop and a phone.

## ADDED Requirements

### Requirement: Table window composition

`/table` SHALL render one host table window with a top bar, a table area and a
fixed action dock. At 720 px and above the table SHALL fit the stage. Below
620 px the table MAY be taller than the viewport: the table area SHALL scroll
vertically while the top bar and the dock remain in place and usable, and the
document SHALL NOT scroll horizontally at 360 to 390 px. The phase control
SHALL live in the fixed bar or dock, not float over the scrolling table.

**Source**: [Issue #164](https://github.com/hose1021/grimoria/issues/164); `design/prototypes/05-velvet-ring.html`; `SPEC.md` "Screens" (`/table`)
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Desktop table

- **WHEN** `/table` renders at 1440x900
- **THEN** the table area fits the viewport and the dock stays below it

#### Scenario: Phone scroll

- **WHEN** a fifteen-player table is taller than the viewport at 390 px
- **THEN** only the table area scrolls and the top bar and dock remain fixed

#### Scenario: No sideways scroll

- **WHEN** `/table` renders at 360 and 390 px
- **THEN** the document has no horizontal overflow

### Requirement: Two-second table read

At 1440x900, `/table` SHALL show the phase and day, the living and dead counts,
the actor, the next action, the vote threshold and the nomination, and the state
of every seat without scrolling. At 360 to 390 px the same state SHALL be
available in the table stage and the fixed dock; the table area MAY scroll and
the dock SHALL stay fixed.

**Source**: [Issue #164](https://github.com/hose1021/grimoria/issues/164); `design/prototypes/05-velvet-ring.html`; `SPEC.md` "Screens" (`/table`)
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Desktop day

- **WHEN** a fifteen-player day opens at 1440x900
- **THEN** the phase, the nomination, the threshold, the dead seat and the
  execution control are visible without scrolling

#### Scenario: Desktop night

- **WHEN** a night step is active at 1440x900
- **THEN** the actor, the next action, the step progress and the resolve control
  are visible without scrolling

#### Scenario: Phone state

- **WHEN** `/table` renders at 360 to 390 px
- **THEN** the dock carries the actor and the next action and the table carries
  the state of every seat; only the table area scrolls

### Requirement: Visible seats and role identity

Every seat SHALL show the player name at 360 to 390 px, the seat number where
space allows, and the role artwork on the medallion. The role text SHALL be
available in the player list, the step sheet and the player card. A seat SHALL
be a keyboard-reachable control with a target of at least 44x44 CSS pixels.

**Source**: [Issue #164](https://github.com/hose1021/grimoria/issues/164); `design/prototypes/05-velvet-ring.html`
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Fifteen names at 390

- **WHEN** a fifteen-player table renders at 390 px
- **THEN** all fifteen player names are visible on the table

#### Scenario: Role artwork

- **WHEN** a seat renders
- **THEN** its role artwork identifies the role and the role text is available
  in the player list and the player card

#### Scenario: Seat target

- **WHEN** the host uses the table with a keyboard or a touch screen
- **THEN** every seat is reachable, named, and at least 44x44 CSS pixels

### Requirement: Text state badges

Each seat SHALL show its states as coloured text badges under the role artwork:
acting, nominated, dead, ghost vote available or used, poisoned and protected.
The state SHALL NOT be conveyed by colour alone; the acting, nominated and dead
seats SHALL also differ by outline, mark or label. The table SHALL show only
states that are true, and the role-specific host tokens (red herring, butler's
master, spent ability) SHALL remain in the player card.

**Source**: [Issue #164](https://github.com/hose1021/grimoria/issues/164); `design/prototypes/05-velvet-ring.html`
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Acting seat

- **WHEN** a night step has an actor
- **THEN** the actor's seat shows the acting text badge and the amber outline

#### Scenario: Nominated seat

- **WHEN** a nomination is open
- **THEN** the nominee's seat shows the nomination text badge and the danger
  outline

#### Scenario: Dead and ghost vote

- **WHEN** a player dies
- **THEN** the seat shows the dead text badge and whether the ghost vote is
  still available

#### Scenario: Poison and protection

- **WHEN** a player is poisoned or protected
- **THEN** the seat shows the matching text badge and the state remains readable
  without colour

### Requirement: Vote threshold and execution result

The day SHALL display the execution threshold, `ceil(living / 2)`, in the centre
hub and the dock. The host SHALL record the votes; the execution control SHALL
be unavailable below the threshold. The table SHALL dispatch the existing
command for execution and the centre SHALL show the executed player and role
afterwards. The engine SHALL remain the authority for whether an execution is
allowed; the screen SHALL NOT compute a rule outcome locally.

**Source**: [Issue #164](https://github.com/hose1021/grimoria/issues/164); `game/day-and-win`; `SPEC.md` "Screens" (`/table`)
**Tests**: `scripts/browser-check.mjs`; `src/core/engine/commands.test.ts`

#### Scenario: Threshold

- **WHEN** a nomination is open with fifteen living players
- **THEN** the hub and the dock both show that eight votes are needed

#### Scenario: Host records votes

- **WHEN** the host records a vote
- **THEN** the vote total and the threshold progress update and the execution
  control becomes available only at the threshold

#### Scenario: Execution result

- **WHEN** the host executes the nominee
- **THEN** the centre shows the executed player and role and the day can be
  closed

### Requirement: Dawn report

When a day starts, the centre of the table SHALL show the night's deaths with
the player name and role and the number of survivors, or state that nobody died
and everyone survived. The host SHALL be able to dismiss the report to the
nomination view. The report SHALL read the night deaths from the game state; the
engine SHALL remain the authority on deaths and the win state.

**Source**: [Issue #164](https://github.com/hose1021/grimoria/issues/164); `game/day-and-win`; `design/prototypes/05-velvet-ring.html`
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Night deaths

- **WHEN** a night ends with one death
- **THEN** the dawn report names the dead player and role and the survivor count

#### Scenario: No deaths

- **WHEN** a night ends without a death
- **THEN** the dawn report says that nobody died and everyone survived

#### Scenario: Dismiss

- **WHEN** the host dismisses the dawn report
- **THEN** the centre shows the current nomination state

### Requirement: Full-screen player card surface

The table SHALL provide a full-screen player card that hides the console, the
table, the dock and the chrome and shows only the information intended for the
player. The card SHALL NOT show host notes, the host's truth, other roles or
statuses not intended for the player. Closing the card SHALL return to the
console; focus SHALL move into the card when it opens and Escape SHALL close it.

**Source**: [Issue #164](https://github.com/hose1021/grimoria/issues/164); `app/ui-and-privacy` "Public and player privacy"; `design/prototypes/05-velvet-ring.html`
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Information card

- **WHEN** the host shows a night information card
- **THEN** the screen contains only that information and hides the console

#### Scenario: Close and focus

- **WHEN** the player card opens or the host closes it
- **THEN** focus moves into the card and Escape returns it to the console

### Requirement: Player card content and poisoned guard

The card SHALL present a role card, the night information, or a host-entered
false-information template. The Drunk's role card SHALL show the believed role
and its ability, not the Drunk role. For a poisoned or drunk player, the true
information card SHALL NOT be offered; only the template SHALL be available.

**Source**: [Issue #164](https://github.com/hose1021/grimoria/issues/164); `app/ui-and-privacy` "Public and player privacy"; `design/prototypes/05-velvet-ring.html`
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Drunk role card

- **WHEN** the host shows the card of a Drunk player
- **THEN** the card shows the believed role and its ability, not the Drunk role

#### Scenario: Poisoned player

- **WHEN** the information actor is poisoned
- **THEN** the true information card is unavailable and only the template is
  offered

#### Scenario: Host template

- **WHEN** the host enters a false-information template
- **THEN** the player card shows the role artwork and only the entered text

### Requirement: Engine guidance and host safety

The dock and the step sheet SHALL surface the engine's step guidance, the active
effects that touch the step, the mandatory decisions, the consequence preview,
the rejection reason and the Storyteller-choice reason required by
`app/ui-and-privacy`. The table SHALL dispatch the existing commands only. It
SHALL warn before a consequence the engine reports as prevented or special
(protection, Soldier, Mayor redirect, Saint execution) and SHALL NOT auto-fill a
Storyteller choice.

**Source**: `app/ui-and-privacy` "Storyteller step explanation", "Consequence preview and separation", "Rejected command reason"; [Issue #164](https://github.com/hose1021/grimoria/issues/164)
**Tests**: `scripts/browser-check.mjs`; `src/core/engine/commands.test.ts`

#### Scenario: Preview before confirm

- **WHEN** the host chooses a target and a consequence is pending
- **THEN** the dock shows the consequence before the host confirms

#### Scenario: Protected target

- **WHEN** the chosen target is protected from the current effect
- **THEN** the dock says the death or effect will be prevented before the host
  confirms

#### Scenario: Rejection

- **WHEN** the engine rejects a command
- **THEN** the console shows the reason and the game state does not change

### Requirement: Table theme tokens and visual scope

The table's felt day and night surfaces, action colours, parchment card and ink
SHALL be declared in the one `@theme` block before use. The table visual
language SHALL apply to `/table` only; the other routes SHALL keep their
composition and tokens. No second stylesheet and no new runtime dependency SHALL
be introduced.

**Source**: [Issue #164](https://github.com/hose1021/grimoria/issues/164); `app/design-tokens` "One token source"
**Tests**: `scripts/check-types-policy.mjs`; `scripts/browser-check.mjs`

#### Scenario: Token source

- **WHEN** a table colour is used
- **THEN** its value is declared in the `@theme` block and the token policy
  check passes

#### Scenario: Other routes

- **WHEN** the table change is applied
- **THEN** no route other than `/table` changes composition or tokens
