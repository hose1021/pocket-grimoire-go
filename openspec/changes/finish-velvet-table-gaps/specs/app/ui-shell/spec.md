# Spec Delta

## MODIFIED Requirements

### Requirement: Bag editor

The bag screen SHALL edit the script pool, the player count, the roles, the
bluffs and the special setup choices through one bag command, SHALL offer the
recommended presets, the random picker, the manual picker, the named library and
the import/export paths, and SHALL deal the bag only when it is legal. The
manual picker SHALL list every role of the selected script grouped by team and
SHALL NOT offer a search field or edition and team filters. The player-count
stepper SHALL change the count by exactly one per activation and SHALL derive
the next count from the latest saved count, so quick activations after a script
switch produce one increment each.

**Source**: `SPEC.md` `/bag`; issue #82; owner requirement "manual assembly groups roles"; [Issue #170](https://github.com/hose1021/grimoria/issues/170)
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Preset

- **WHEN** a recommended preset is applied
- **THEN** the count, the roles and the bluffs match that preset

#### Scenario: Illegal bag

- **WHEN** the composition is incomplete
- **THEN** the status lists the errors and the deal control is unavailable

#### Scenario: Undo

- **WHEN** a role is picked and undo is used
- **THEN** the previous bag returns

#### Scenario: Manual grouping

- **WHEN** the manual picker is active
- **THEN** every role of the selected script appears under its team heading with
  a count, and no search or edition filter is present

#### Scenario: Count stepper after a script switch

- **WHEN** the host switches to Bad Moon Rising and activates the increase
  control twice quickly
- **THEN** the count rises by exactly two from its previous value

### Requirement: Setup secrets

The secrets screen SHALL edit the one-of-two pairs, the Drunk mask pair and the
red herring through commands, SHALL list the reminders and the host-only roster,
and SHALL start the first night only when the secrets are complete. Bad Moon
Rising and Sects & Violets SHALL render their own setup summaries instead. The
Drunk mask editor SHALL be labelled as the Drunk's shown role and SHALL stay
separate from the Demon bluff group.

**Source**: `SPEC.md` `/secrets`; issue #82; [Issue #170](https://github.com/hose1021/grimoria/issues/170)
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Red herring

- **WHEN** the Fortune Teller is in play
- **THEN** the herring picker offers every good player, including the Fortune
  Teller, and records the choice

#### Scenario: Incomplete secrets

- **WHEN** a required pair or the herring is missing
- **THEN** the start control is disabled and the errors are listed

#### Scenario: Librarian zero

- **WHEN** the Librarian is in play and no Outsider is
- **THEN** the screen normalizes the zero information once

#### Scenario: Drunk mask label

- **WHEN** the Drunk is in play
- **THEN** the mask editor states that it sets the Drunk's shown role and is not
  part of the Demon bluff group

### Requirement: Correction reason and over panel

A correction SHALL require a reason. The over panel SHALL hide the review table
until used and SHALL require a second confirmation before a new game. After the
confirmed new game, the console SHALL publish the fresh game before it leaves
`/table`; no finished-game table, phase or review state SHALL remain visible.

**Source**: `SPEC.md` "Screens" (`/table`); issue #42; [Issue #170](https://github.com/hose1021/grimoria/issues/170)
**Tests**: `scripts/browser-check.mjs`, `src/core/engine/commands.test.ts`

#### Scenario: Correction reason

- **WHEN** a correction is applied without a reason
- **THEN** the dialog stays open and the reason field is reported

#### Scenario: Review gate

- **WHEN** the game is over
- **THEN** the review table stays hidden until the review control is used

#### Scenario: New game

- **WHEN** the new game control is used once
- **THEN** the game is unchanged and the confirmation is shown

#### Scenario: New game clears the table

- **WHEN** the host confirms the new game and the console returns to the table
- **THEN** the table shows the fresh setup and no finished-game table, phase or
  review state

## ADDED Requirements

### Requirement: Over panel victory copy

The over panel SHALL show a victory line specific to the win cause. An executed
Demon SHALL read as executed rather than as succession, and a night death,
inheritance or manual declaration SHALL read as that cause.

**Source**: [Issue #170](https://github.com/hose1021/grimoria/issues/170); `SPEC.md` "Screens" (`/table`)
**Tests**: `src/ui/i18n/strings.test.ts`, `scripts/browser-check.mjs`

#### Scenario: Demon executed

- **WHEN** the game ends because the Demon was executed and no heir remains
- **THEN** the over panel says the Demon was executed and does not mention
  inheritance

#### Scenario: Demon died at night

- **WHEN** the game ends because the Demon died at night and no heir remains
- **THEN** the over panel names that cause

#### Scenario: Saint execution

- **WHEN** the Saint's execution ends the game
- **THEN** the over panel says the Saint died by execution
