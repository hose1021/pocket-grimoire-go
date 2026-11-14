# Spec Delta

## MODIFIED Requirements

### Requirement: Seat order draft

The seat screen SHALL keep the seat order as a local draft: selecting or dragging
one seat onto another SHALL swap them, shuffle and undo SHALL change only the
draft, and the use action SHALL commit it. A published state SHALL update the
names on the ring without replacing a non-empty draft. The ring, the sidebar and
the drag ghost SHALL show player names and seat numbers only.

**Source**: `SPEC.md` "Screens" and `/seat` "names only"; issue #82; issue #171
SET8
**Tests**: `scripts/browser-check.mjs`, `src/ui/screens/seat-projection.test.ts`

#### Scenario: Publish while editing

- **WHEN** the store publishes a renamed player while a draft is open
- **THEN** the ring shows the new name and keeps the draft order

#### Scenario: Empty draft

- **WHEN** the store publishes an order while the screen shows the empty state
- **THEN** the ring renders that order

#### Scenario: Swap

- **WHEN** two seats are activated in turn
- **THEN** their occupants swap, the status line names the result and undo
  restores the previous order

#### Scenario: Names only

- **WHEN** the seat route renders a dealt game
- **THEN** every seat shows a name and a seat number and no role name, role
  artwork, team or alive state

### Requirement: Setup secrets

The secrets screen SHALL edit the one-of-two pairs, the Drunk mask pair and the
red herring through commands, SHALL list the reminders and the host-only roster,
and SHALL start the first night only when the secrets are complete. Each script
SHALL render its own setup summary and reminder checklist, a manual script SHALL
render the manual pane, and the Librarian zero and a registering Spy or Recluse
SHALL extend the offered answers as the scenarios describe.

**Source**: `SPEC.md` `/secrets`; issue #82; issue #171 SET9, SET10, TB2, TB8
**Tests**: `scripts/browser-check.mjs`, `src/ui/screens/secrets-options.test.ts`,
`src/core/engine/setup.test.ts`

#### Scenario: Red herring

- **WHEN** the Fortune Teller is in play
- **THEN** the herring picker offers every good player, including the Fortune
  Teller, and records the choice

#### Scenario: Incomplete secrets

- **WHEN** a required pair or the herring is missing
- **THEN** the start control is disabled and the errors are listed

#### Scenario: Librarian zero

- **WHEN** the Librarian is in play and every Outsider in play is a Recluse
- **THEN** the zero control is offered and the recorded zero is legal

#### Scenario: Drunk shown the Librarian

- **WHEN** the Drunk is shown the Librarian
- **THEN** the false-information editor offers the zero answer

#### Scenario: Registering Spy or Recluse

- **WHEN** a Spy is in play for a Townsfolk or Outsider answer, or a Recluse is
  in play for a Minion answer
- **THEN** the role selector also offers the not-in-play characters of that team

#### Scenario: Mixed manual pool

- **WHEN** a manual script contains Trouble Brewing and Bad Moon Rising roles
- **THEN** the screen renders the manual secrets pane and not the Bad Moon
  Rising pane

#### Scenario: Reminder checklist

- **WHEN** the active script is Bad Moon Rising or Sects & Violets and the game
  is dealt
- **THEN** the pane lists the Storyteller reminders of every role in play

#### Scenario: Drunk mask label

- **WHEN** the Drunk is in play
- **THEN** the mask editor states that it sets the Drunk's shown role and is not
  part of the Demon bluff group

### Requirement: Bag editor

The bag screen SHALL edit the script pool, the player count, the roles, the
bluffs and the setup choices through one bag command, and SHALL deal only a legal
bag. It SHALL offer the presets, the random picker, the manual picker, the named
library and import/export. A rejected load SHALL stay open and explain itself;
the count stepper SHALL move one player per activation.

**Source**: `SPEC.md` `/bag`; issue #82; owner requirement "manual assembly groups roles"; issue #171 SET5, SET7
**Tests**: `scripts/browser-check.mjs`, `src/ui/screens/setup-messages.test.ts`

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

#### Scenario: Rejected library load

- **WHEN** the host loads a saved bag the current script cannot accept
- **THEN** the library stays open, the reason is shown in the UI language and
  the saved game is unchanged

#### Scenario: Godfather direction

- **WHEN** the random picker composes a bag with the Godfather at minus one
  Outsider, or the host switches to that script
- **THEN** the applied bag keeps the minus-one direction and the team counters
  stay legal

#### Scenario: One player per activation

- **WHEN** the host activates the count stepper
- **THEN** the count moves by exactly one, and a cancelled confirmation or a
  rejected command leaves it where it was

#### Scenario: Count stepper after a script switch

- **WHEN** the host switches to Bad Moon Rising and activates the increase
  control twice quickly
- **THEN** the count rises by exactly two from its previous value
