# app/arcane-visual-system Specification

## Purpose
Defines the visual language and the presentational component contract of the
Grimoria interface, so every route reads as one dark fantasy tabletop client and
a Storyteller can read the game state at a glance.

## Requirements

### Requirement: Material and palette roles

The interface SHALL use the dark stone surface scale, metal edges, brass and
amber for active and primary states, and crimson for danger and death. Role and
rules reading SHALL use parchment. `/table` SHALL use the table-scoped felt,
action and card tokens declared in `app/table-console`; its player card MAY use
parchment for the information it shows. A single view SHALL show at most one
magical glow, and no screen SHALL use a multi-colour decorative gradient.

**Source**: owner-selected Arcane Instrument direction; `design/prototypes/03-arcane-instrument-full.html`; [Issue #164](https://github.com/hose1021/grimoria/issues/164); `design/prototypes/05-velvet-ring.html`
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Primary action uses amber

- **WHEN** a phase panel outside `/table` shows its primary action
- **THEN** that action uses the amber treatment and no other control on the
  panel uses the same treatment

#### Scenario: Table primary action

- **WHEN** `/table` shows its primary action
- **THEN** that action uses the table primary token and no other control on the
  dock uses that treatment

#### Scenario: Danger uses crimson

- **WHEN** the console offers an execution or another destructive action
- **THEN** only that action uses the danger treatment

#### Scenario: No decorative gradient

- **WHEN** any route renders
- **THEN** no full-page or card background uses a multi-colour gradient

#### Scenario: Player card parchment

- **WHEN** the player card is shown on `/table`
- **THEN** it uses the parchment card token for the information it shows

### Requirement: Typography and shape

Phase, role and section titles SHALL use the display serif. Interface data,
labels and controls SHALL use the sans face with tabular numerals where numbers
align. Corners SHALL be between 4 and 6 pixels, and controls SHALL NOT be
pill-shaped, except the `/table` dock controls, state badges, phase control and
player card, which use the table-scoped radii and shapes declared in
`app/table-console`.

**Source**: owner-selected Arcane Instrument direction; `SPEC.md` "CSS and accessibility"; [Issue #164](https://github.com/hose1021/grimoria/issues/164)
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Phase title

- **WHEN** the console shows the current phase outside `/table`
- **THEN** the phase name renders in the display serif

#### Scenario: Sharp controls

- **WHEN** a button, input or panel outside `/table` renders
- **THEN** its computed corner radius is at most 6 pixels and it is not a pill

#### Scenario: Table controls

- **WHEN** a `/table` dock control, state badge, phase control or player card
  renders
- **THEN** it uses the table-scoped radius and shape token

### Requirement: Role card states

A role card SHALL support hidden, revealed and compact states. A revealed card
SHALL show the team, the role name, the ability and the active reminders. A
hidden card SHALL expose no real role in a public or player projection.

**Source**: `SPEC.md` "Screens"; `openspec/specs/app/ui-and-privacy/spec.md`
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Revealed card

- **WHEN** a player reveals their role
- **THEN** the card shows only that seat's shown role, its ability and reminder

#### Scenario: Hidden card

- **WHEN** the player screen is covered
- **THEN** the DOM carries no real role or secret effect

### Requirement: Action hierarchy

Each phase panel SHALL expose exactly one primary action, neutral actions and
any dangerous action with a distinct treatment. A disabled action SHALL state
why it is unavailable.

**Source**: owner requirement "buttons"; `SPEC.md` "Screens"
**Tests**: `scripts/browser-check.mjs`

#### Scenario: One primary

- **WHEN** a phase panel renders
- **THEN** exactly one control carries the primary treatment

#### Scenario: Disabled reason

- **WHEN** an action is unavailable because targets are unresolved
- **THEN** the control is disabled and the reason is readable

### Requirement: Motion is state feedback only

Motion SHALL be limited to state feedback and transitions of 180 milliseconds or
less. Entrance choreography SHALL NOT be used, and
`prefers-reduced-motion: reduce` SHALL remove animation and smooth scrolling.

**Source**: `SPEC.md` "CSS and accessibility"; owner requirement "subtle magical glow"
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Reduced motion

- **WHEN** the user requests reduced motion
- **THEN** no animation or transition runs

#### Scenario: Active actor

- **WHEN** the active actor changes
- **THEN** the change is conveyed by a static highlight and an optional short
  transition, not by a looping animation

### Requirement: Token-only styling

Every colour, radius, shadow and font used by the interface SHALL come from the
shared token layer. The token check SHALL fail when a token has no source or is
declared but unused.

The `theme-color` metadata repeats the page-void value because a meta tag
cannot read a custom property.

**Source**: `openspec/specs/app/design-tokens/spec.md`; `AGENTS.md` "Code Conventions"
**Tests**: `scripts/check-types-policy.test.mjs`, `scripts/browser-check.mjs`

#### Scenario: Unused token

- **WHEN** the theme declares a token that no class or rule uses
- **THEN** the styling check fails and names the token

#### Scenario: Unmapped token

- **WHEN** the theme declares a token that has no source value
- **THEN** the styling check fails and names the token
