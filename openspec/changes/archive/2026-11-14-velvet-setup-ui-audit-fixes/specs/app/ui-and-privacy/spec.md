# Spec Delta

## MODIFIED Requirements

### Requirement: Public and player privacy

Public and player views SHALL render a projection that contains no real role,
bluff, note or effect, the player handoff SHALL expose only the shown role, and
the seat route SHALL render names and seat numbers only.

**Source**: `SPEC.md` "Runtime", "CSS and accessibility" and `/seat` "names only"; `AGENTS.md` "Architecture & Data Flow"; issue #171 SET8
**Tests**: `src/core/engine/engine.test.ts`, `src/ui/screens/seat-projection.test.ts`, `scripts/browser-check.mjs:758`

#### Scenario: Public screen during a night

- **WHEN** the public screen is open during an active night
- **THEN** it shows phase, alive count, public deaths and no role or bluff element

#### Scenario: Export projection

- **WHEN** the public projection is built from a saved game
- **THEN** it contains no role, bluff, note or effect field

#### Scenario: Seat route

- **WHEN** the seat route renders a dealt game
- **THEN** the projection contains a player id, a seat number and a name and no
  role, shown role, team or alive field

### Requirement: Role sheet scenario filter

The role sheet SHALL filter by Trouble Brewing, Bad Moon Rising, Sects and
Violets or all standard roles, SHALL show the selected scenario's five
Travellers in a separate section, SHALL show all fifteen Travellers in the
all-roles scenario, SHALL persist the filter across language change and reload,
and SHALL never mutate the saved game.

**Source**: `SPEC.md` `/sheet/{ru,en,az}`; issue #171 SET11
**Tests**: `scripts/browser-check.mjs:821`, `scripts/browser-check.mjs:1226`,
`src/ui/screens/sheet-scenarios.test.ts`

#### Scenario: Scenario selection

- **WHEN** the host selects Bad Moon Rising on the sheet
- **THEN** the sheet shows its 25 roles with the four standard team sections

#### Scenario: Travellers section

- **WHEN** the host opens the Travellers toggle
- **THEN** the 5 Travellers of the selected scenario appear outside the
  scenario count in their own section

#### Scenario: All roles

- **WHEN** the host selects the all-roles scenario and opens the Travellers
  toggle
- **THEN** the 15 standard Travellers appear in their own section

#### Scenario: Scenario switch

- **WHEN** the host switches from Trouble Brewing to Sects and Violets
- **THEN** the Travellers section shows the Sects and Violets Travellers and
  never the Trouble Brewing five
