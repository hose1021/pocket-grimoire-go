# app/ui-shell Specification

## Purpose
Defines the application shell that hosts every route: how the shell keeps
unmigrated routes alive, how a screen reads the game through one subscription,
the shared component behaviour, and the parity of the first migrated screen, the
role sheet.

## Requirements

### Requirement: Shell owns every route

Every existing path SHALL render the same screen after the shell is adopted.
Routes that are not migrated yet SHALL render through a bridge that calls the
legacy screen's mount and cleanup; navigating away SHALL dispose the previous
route's listeners, timers and subscriptions before the next route mounts.
Unknown paths SHALL keep falling back to the table screen.

**Source**: `docs/architecture.md` "Migration map"; issue #69
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Direct link

- **WHEN** a route such as `/table` or `/sheet/ru` is opened directly
- **THEN** the matching screen renders, including its language, with no console
  error

#### Scenario: Route switch disposes

- **WHEN** the user navigates from one route to another
- **THEN** the previous screen's cleanup runs before the next screen mounts

#### Scenario: Partial mount failure

- **WHEN** the requested locale catalog fails to load
- **THEN** the shell shows a recoverable error and the cleanup path still runs

### Requirement: One subscription over the game state

A screen SHALL read the game state through the store's subscription with an
immutable snapshot that is stable between changes. A re-render SHALL happen only
when the snapshot changes. A screen SHALL NOT mutate the state directly, keep a
second store, or persist transient UI drafts.

**Source**: `SPEC.md` "Reliability and live-play additions"; issue #69
**Tests**: `src/entry/store.test.ts`, `scripts/browser-check.mjs`

#### Scenario: Stable snapshot

- **WHEN** no command has been applied
- **THEN** two consecutive reads return the same snapshot reference

#### Scenario: Failed save is visible

- **WHEN** a command applies but the save fails
- **THEN** subscribers receive a snapshot whose save status reports the failure
  and the game state is not rolled back silently

#### Scenario: No second store

- **WHEN** the shell and a screen read the game
- **THEN** both see the same store instance, and no module creates another

### Requirement: Shared dialog behaviour

The dialog component SHALL move focus inside on open, close on Escape, restore
focus to the trigger on close, expose an accessible name and `aria-modal`, and
keep its controls usable at a 390 px viewport. Closing by overlay activation or
the explicit close control SHALL behave like Escape.

**Source**: `SPEC.md` "Screens"; issue #69
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Keyboard close

- **WHEN** the dialog is open and the user presses Escape
- **THEN** it closes and focus returns to the element that opened it

#### Scenario: Accessible name

- **WHEN** the dialog is open
- **THEN** assistive technology can read its title and the content behind it is
  marked inactive

### Requirement: Role sheet parity

`/sheet` SHALL render the 72 standard roles across the three scripts and the 5
Travellers in their separate section, filter by scenario, switch language
between Russian, English and Azerbaijani, and show each role's artwork. Roles
SHALL be grouped by team in script order, each group naming the team and
count. The header SHALL carry no route or language control: the app bar menu is
the only navigation. The screen SHALL be read-only.

**Source**: `SPEC.md` "Screens"; issue #69, issue #151
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Role counts

- **WHEN** `/sheet/en` opens with no filter
- **THEN** 72 standard roles and 5 Travellers are present

#### Scenario: Scenario filter

- **WHEN** the Trouble Brewing filter is active
- **THEN** only that script's roles remain and the Travellers stay in their own
  section

#### Scenario: Language switch

- **WHEN** the host opens the app bar menu and chooses Azerbaijani while the
  sheet is open
- **THEN** the names and abilities come from that catalog, the URL ends in
  `/sheet/az`, and the scenario and Travellers preferences are unchanged

#### Scenario: One navigation surface

- **WHEN** `/sheet/ru` renders at 390 or 1440 CSS pixels
- **THEN** the header shows the title, intro, summary and filters, with no route
  link and no language control, and the app bar menu carries the table, Help
  and language controls

#### Scenario: Read-only

- **WHEN** the sheet is used
- **THEN** no command is dispatched and the saved game is unchanged

#### Scenario: Team groups

- **WHEN** a scenario is shown
- **THEN** its roles appear under Townsfolk, Outsider, Minion and Demon groups
  with a count for each group

### Requirement: Player handoff renders in the shell

`/player` SHALL render as a native shell screen, not through the legacy bridge.
The picker SHALL show one number per seat, SHALL label a claimed seat with its
saved name, SHALL label a seat without a shown role as unavailable, and SHALL
open only a free seat that has a shown role. The picker projection SHALL carry
the shown role id only: no real role, reminder, effect, bluff or note.

**Source**: `SPEC.md` `/player`; issue #77
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Claimed seat

- **WHEN** a seat is claimed
- **THEN** its number is disabled and labelled with the stored name

#### Scenario: No role yet

- **WHEN** the bag has not been dealt
- **THEN** no number is selectable, the setup link is shown, and the DOM carries
  no role, reminder, effect or bluff

#### Scenario: Free number

- **WHEN** a free seat with a shown role is tapped
- **THEN** the card renders that seat's shown role only

### Requirement: Picker follows the store

The screen SHALL read the game through the shell subscription and SHALL update
when the store publishes a change, without a route change or a manual re-render.

**Source**: `SPEC.md` "Reliability and live-play additions"; issue #77
**Tests**: `scripts/browser-check.mjs`

#### Scenario: External publish

- **WHEN** the store publishes a state with a newly claimed seat
- **THEN** that number becomes disabled without navigation

### Requirement: Role card deadline

The role card SHALL hide 45 seconds after the number tap. A re-render SHALL NOT
extend the deadline. The card SHALL also close on Escape, when the document
becomes hidden and when the page is hidden.

**Source**: `SPEC.md` `/player`; `SPEC.md` "Reliability and live-play additions"
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Deadline not extended

- **WHEN** the game state publishes while the card is open
- **THEN** the remaining time counts from the original deadline

#### Scenario: Auto hide

- **WHEN** 45 seconds pass with the card open
- **THEN** the card closes and the picker returns

#### Scenario: Escape

- **WHEN** the card is open and the user presses Escape
- **THEN** the card closes without a claim

### Requirement: Claim through the shell

The screen SHALL claim a seat by dispatching `claimSeat` through a shell port,
SHALL require a non-empty name, SHALL show the rejection reason and keep the card
open when the command is rejected, and SHALL return to the picker after a
successful claim.

**Source**: `SPEC.md` `/player`; `AGENTS.md` "Architecture & Data Flow"
**Tests**: `scripts/browser-check.mjs`, `src/core/engine/commands.test.ts`

#### Scenario: Empty name

- **WHEN** the name is empty or whitespace
- **THEN** the card stays open and the name field takes focus

#### Scenario: Rejected claim

- **WHEN** the command is rejected, for example for an already claimed seat
- **THEN** the reason is shown and the card stays open

### Requirement: Hand-back warning

The back control SHALL open a modal warning that moves focus inside, closes on
Escape and on the cancel control, and leaves the handoff only from the confirm
control. The modal SHALL expose an accessible name and `aria-modal`.

**Source**: `SPEC.md` `/player`; issue #77
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Focus inside

- **WHEN** the warning is open
- **THEN** the active element is inside the modal

#### Scenario: Cancel

- **WHEN** the cancel control or Escape is used
- **THEN** the warning closes and the handoff stays open

#### Scenario: Confirm

- **WHEN** the confirm control is used
- **THEN** the route changes to `/table`

### Requirement: Setup screens render in the shell

`/bag`, `/seat` and `/secrets` SHALL render as native shell screens.
Navigating away SHALL dispose their listeners, timers and pointer handlers.

**Source**: `SPEC.md` "Screens"; issue #82
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Direct link

- **WHEN** `/bag`, `/seat` or `/secrets` is opened directly
- **THEN** the matching screen renders without the legacy bridge

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

### Requirement: Storyteller console renders in the shell

`/table` SHALL render as a native shell screen and SHALL NOT mount through the
legacy bridge. It SHALL dispose its listeners and timer when the route changes.

**Source**: `SPEC.md` "Screens"; `docs/architecture.md` "Migration map"; issue #85
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Direct link

- **WHEN** `/table` is opened directly
- **THEN** the console renders without the legacy bridge and owns the saved game

#### Scenario: Route switch

- **WHEN** the host navigates from `/table` to `/seat`
- **THEN** the console cleanup runs and its timer and listeners are gone

### Requirement: One next step per phase

The console SHALL show exactly one phase panel for the current phase: setup,
deal, night, day or over. The night panel SHALL name the step and actor, show
progress, and keep complete unavailable while targets, information or the
Mayor redirection are unresolved. For a target step the table SHALL be the
target control: a seat selects or deselects the target, and the panel shows
the prompt and chosen names. Complete and skip SHALL live in the bottom strip;
skip SHALL complete without a reason.

**Source**: `SPEC.md` "Screens" (`/table`); issue #45
**Tests**: `src/core/engine/commands.test.ts`, `scripts/browser-check.mjs`

#### Scenario: Unresolved targets

- **WHEN** the step needs a target and none is selected
- **THEN** the complete control is unavailable and the reason is shown

#### Scenario: Targets on the table

- **WHEN** a night step accepts one or two targets
- **THEN** activating a seat token selects or deselects that player, the panel
  lists the chosen names, and the complete control enables only when the choice
  is valid

#### Scenario: Skip needs a reason

- **WHEN** the host skips a step and supplies a reason
- **THEN** the step completes and its note and the journal record that reason

#### Scenario: Skip without a reason

- **WHEN** the host activates the skip control without a reason
- **THEN** the step completes without a prompt and the night moves to the next
  step

#### Scenario: Night actions in the strip

- **WHEN** a night step is active
- **THEN** the confirm-target and skip controls sit in the bottom strip with the
  undo and role-card controls, not inside the night card

#### Scenario: Phase card

- **WHEN** the phase changes from night to day
- **THEN** only the day panel renders and the night queue stays in the controls
  zone

### Requirement: Five-part step guidance

The night card SHALL show the host action, the player action, the grimoire note,
the public line and the check for the current step, and SHALL persist the
expanded state of that guidance across routes and reloads.

**Source**: `SPEC.md` "Screens" (`/table`); issue #45
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Expanded state

- **WHEN** the host expands the guidance and returns later
- **THEN** the guidance is still expanded

#### Scenario: A role without a dedicated guide

- **WHEN** the current step has no dedicated guide
- **THEN** the generic instruction text is shown, never a raw key

### Requirement: Night information and registrations

The night card SHALL preview the computed information for the current targets,
SHALL let the host replace it with a given answer for that step, SHALL offer the
Spy and Recluse registration choices, SHALL open the information card, and
SHALL show the Spy the grimoire overlay instead.

**Source**: `SPEC.md` "Screens" (`/table`); `SPEC.md` "Domain rules"
**Tests**: `scripts/browser-check.mjs`, `src/core/engine/engine.test.ts`

#### Scenario: Information card

- **WHEN** the targets are complete and the host shows the card
- **THEN** the card repeats the computed information for that step

#### Scenario: Given answer

- **WHEN** the host picks another answer for the step
- **THEN** the completed step carries that answer and the preview matches it

#### Scenario: Grimoire

- **WHEN** the current step belongs to the Spy
- **THEN** the host opens a grimoire overlay listing every seat with its role

### Requirement: Day execution and role panels

The day card SHALL announce the morning deaths, SHALL show the vote threshold as
`ceil(living / 2)`, SHALL record the host's execution with the optional
survival choice, and SHALL offer the Virgin nomination, Slayer, Gossip,
Moonchild and Mastermind panels only when they apply. A custom script SHALL
offer the manual winner instead.

**Source**: `SPEC.md` "Screens" (`/table`); `SPEC.md` "Domain rules"
**Tests**: `scripts/browser-check.mjs`, `src/core/engine/bmr.test.ts`, `src/core/engine/snv.test.ts`

#### Scenario: Vote threshold

- **WHEN** six players are alive
- **THEN** the day card shows three votes as the threshold

#### Scenario: Execution result

- **WHEN** the host records an execution
- **THEN** the day card names the executed player and whether the death happened

#### Scenario: Manual winner

- **WHEN** the script is custom
- **THEN** the day card offers a winner team and records it

### Requirement: Seat and day controls

A seat token SHALL select or deselect the night target, select the execution
target by day, and otherwise open the correction dialog with the alive toggle,
role change, reminder, winner rollback and claim recovery. The day bottom strip
SHALL show votes and threshold, the dead count, role-card, execute and undo;
hide SHALL live in the side panel. The role-card control SHALL open the role card.

**Source**: `SPEC.md` "Screens" (`/table`); issue #42
**Tests**: `scripts/browser-check.mjs`, `src/core/engine/commands.test.ts`

#### Scenario: Target or correction

- **WHEN** the host activates a seat during a target step, during the day and
  outside a target step
- **THEN** the first selects the night target, the second selects the execution
  target, and the third opens the correction dialog

#### Scenario: Day execution strip

- **WHEN** the day console renders with a selected seat
- **THEN** the bottom strip shows the votes and threshold, the dead count, the
  role card and the crimson execute control, keeps undo, and offers no hide
  control

#### Scenario: Clear the day target

- **WHEN** the host activates the selected day seat again
- **THEN** the seat clears, the execute control becomes the neutral "Day without
  execution" control, and that control ends the day without an execution

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

### Requirement: Undo through the shell

The console SHALL expose an undo control that is unavailable when no earlier
state can be restored, SHALL restore the previous game state through the shell
without leaving the route, and SHALL close any open overlay after a successful
undo.

**Source**: `SPEC.md` "Screens" (`/table`); `AGENTS.md` "Architecture & Data Flow"
**Tests**: `src/entry/store.test.ts`, `scripts/browser-check.mjs`

#### Scenario: Nothing to undo

- **WHEN** no command has been applied yet
- **THEN** the undo control is unavailable

#### Scenario: Undo restores the previous state

- **WHEN** the host activates undo after a command
- **THEN** the previous state returns, the console re-renders and any open
  overlay is closed

### Requirement: Side panel, notes and backups

The console SHALL expose the night queue with progress, the last eight log
entries, the notes field, the day timer and the backup controls. The side
panels SHALL be informational and SHALL NOT duplicate the seat target choice.
Notes SHALL be saved through the store. Export SHALL offer the game JSON by
text, download and copy, with a `grimoria-` download name. Import SHALL ask for
confirmation and SHALL show the error reason when the text is rejected. A
failed save SHALL be visible.

**Source**: `SPEC.md` "Screens" (`/table`); issue #54
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Hints, not controls

- **WHEN** a target step renders
- **THEN** the side panels show the prompt, the chosen names and the hints, and
  no duplicate target buttons

#### Scenario: Notes persist

- **WHEN** the host types a note and returns to the console
- **THEN** the note is still there and the saved game contains it

#### Scenario: Export download

- **WHEN** the host downloads the export
- **THEN** the file name starts with `grimoria-` and the JSON keeps its format
  identifier

#### Scenario: Import rejected

- **WHEN** the import text is not a valid game
- **THEN** the dialog reports the reason and the saved game is unchanged

### Requirement: Console styles without legacy stylesheets

Every route SHALL be styled by Tailwind utilities and the shared token layer.
The only component rules SHALL be the `.btn`, `.field` and `.label` primitives
in the components layer, so a utility can override them. No `host-*`, `tbl-*`,
`bag-*`, `seat-*`, `setup-*`, `help-*` or `demo-*` rule SHALL remain.
`css/bag.css`, `css/seat.css` and `css/setup.css` SHALL be deleted and not
loaded. Retained legacy class names SHALL be inert browser-check hooks.

**Source**: `AGENTS.md` "Runtime/Tooling Preferences"; `docs/architecture.md` "UI shell"
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Phone width

- **WHEN** the console renders at 390 pixels
- **THEN** the document does not scroll horizontally

#### Scenario: Demo and help

- **WHEN** `/demo` and `/help` render after the migration
- **THEN** their grids, alerts, logs and responsive layout render from utilities
  and tokens

#### Scenario: No legacy rule

- **WHEN** the built stylesheets are scanned
- **THEN** no rule for the listed legacy prefixes exists

### Requirement: Screens render one projection

The derived console facts — the current step, its progress, the pending demon
change, the living count and threshold, the target bounds, information, effects
and Mayor redirect, the seat facts, and the setup and secrets errors — SHALL be
computed once by the engine and the read models in
`src/application/read-models/`. A screen SHALL render them and SHALL NOT call an
engine function or import the engine or `js/`.

**Source**: issue #33, parent #19 Stage 1; `AGENTS.md` "Architecture & Data Flow"
**Tests**: `src/application/read-models/table.test.ts`, `src/ui/screens/structure.test.ts`

#### Scenario: Projection after every command

- **WHEN** the scenario applies the setup, first night, day and second-night
  commands, including an Imp attack on the Mayor
- **THEN** after every command the table, step and seat projections equal the
  engine's current step, progress, pending demon change, execution threshold,
  information, effects and seat facts

#### Scenario: Registrations reach the answer

- **WHEN** the host registers the Recluse as evil for the Chef
- **THEN** the step projection hands the same Chef count as the engine and the
  count differs from the unregistered answer

#### Scenario: Screen import boundary

- **WHEN** a module under `src/ui/screens` imports `src/core/engine` or `js/`
- **THEN** the structure test fails and names the file and the specifier

#### Scenario: No behavior change

- **WHEN** the screens render from the projection
- **THEN** the values, the dispatch commands and the persisted state are
  unchanged from the direct engine calls

### Requirement: Preview at the dispatch boundary

The command preview SHALL be built by `src/application/dispatch/preview.ts`,
which adds the fresh command id and the ruleset version. The composition root
SHALL NOT import the engine to build it.

**Source**: `AGENTS.md` "Architecture & Data Flow"; issue #33
**Tests**: `src/application/read-models/table.test.ts`, `src/ui/screens/structure.test.ts`

#### Scenario: Composition root stays rule-free

- **WHEN** `src/entry` imports the engine to build a preview command
- **THEN** the structure test fails; the preview is built at the dispatch
  boundary instead

#### Scenario: Preview keeps apply's timestamp

- **WHEN** the screen previews a command
- **THEN** the fresh id pins the timestamp that apply reuses for the same
  initial state

### Requirement: Phone finale path is reachable by touch

From a clean browser profile at 360x640 portrait and 640x360 landscape, the
shell SHALL reach the setup prompt, the bag, the player handoff, the seat
order, the setup secrets, the first night, the first day, the over card and the
role review using only visible controls, without a config file and without a
saved bag registry.

**Source**: issue #46; `SPEC.md` "Screens"
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Clean profile

- **WHEN** the app loads in a new profile whose storage holds only the language
  preference
- **THEN** the host can tap from the setup prompt to the review, and the only
  keys written are the language preference, the game save and the console's own
  night-step recovery aid

#### Scenario: Saved bag registry

- **WHEN** the walk finishes
- **THEN** no saved bag registry key exists and no config file was read

### Requirement: Phone screens avoid horizontal overflow

Every screen on the phone finale path SHALL keep its document scroll width at
or below the viewport width at 360x640 and 640x360.

**Source**: issue #46; `openspec/specs/app/ui-and-privacy/spec.md`
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Narrow portrait

- **WHEN** the setup prompt, bag, player, seat, secrets, night, day, result or
  review renders at 360x640
- **THEN** `document.documentElement.scrollWidth` does not exceed the viewport

#### Scenario: Short landscape

- **WHEN** the same screen renders at 640x360
- **THEN** the document still does not scroll horizontally

### Requirement: Phone controls are touch-sized and unclipped

Every visible link or button on the phone finale path SHALL be at least 44x44
CSS pixels, SHALL stay inside the viewport, and SHALL NOT be clipped by an
`overflow-x: hidden` or `overflow-x: clip` ancestor.

**Source**: issue #46; `openspec/specs/app/ui-and-privacy/spec.md` "touch
targets at least 44 pixels"
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Console header

- **WHEN** the console renders at a child viewport
- **THEN** its Undo and Hide buttons are at least 44 px high

#### Scenario: Bag controls

- **WHEN** the bag renders at a child viewport
- **THEN** the count steppers, scenario pills and mode tabs are at least 44 px
  high

#### Scenario: Review table

- **WHEN** the over card opens the role review on a phone
- **THEN** the review table scrolls inside its own container and no link or
  button is clipped by that container

### Requirement: Host choice stays out of public projections

The console SHALL keep the case and the Storyteller reason in the secret
journal, and no case, reason, journal or hidden role SHALL appear in the public
or player projection.

**Source**: Issue #42; `src/ui/AGENTS.md`
**Tests**: `src/core/engine/host-choice.test.ts`

#### Scenario: Public view

- **WHEN** a host choice is recorded
- **THEN** `publicGameView`, `publicSnapshot` and `playerSnapshot` carry no case,
  reason or hidden role

### Requirement: Built artifact styles load offline

The built artifact SHALL ship the application styles itself, with no CDN and no
external request at run time. The one global stylesheet SHALL be present in the
cached artifact, so every route renders its styles with the network disabled.

**Source**: `AGENTS.md` "Runtime/Tooling Preferences"; issue #69, issue #137
**Tests**: `scripts/browser-check.mjs`, `src/infrastructure/offline/offline-worker.test.ts`

#### Scenario: Offline load

- **WHEN** the app loads from the service worker with the network disabled
- **THEN** the styles are available and no request leaves the origin

#### Scenario: Every route after load

- **WHEN** the app runs from the cached artifact without the network
- **THEN** every route renders with its styles and no console error

### Requirement: Setup screens style with utilities

`/bag`, `/seat` and `/secrets` SHALL be styled by Tailwind utilities and theme
tokens only, with no `bag-*`, `seat-*`, `setup-*`, `secrets-*` or `script-*`
rule left in the repository. Their computed typography, spacing, borders,
colours and responsive layout SHALL match the recorded pre-migration baseline.

**Source**: `AGENTS.md` "Code Conventions"; `docs/architecture.md` "UI shell"; issue #82, issue #137
**Tests**: `scripts/style-parity.mjs`, `scripts/browser-check.mjs`

#### Scenario: Narrow layout

- **WHEN** `/bag`, `/seat` or `/secrets` renders at 360 px
- **THEN** neither the page nor the seat ring overflows horizontally

#### Scenario: No screen rule remains

- **WHEN** the tracked stylesheets and markup are scanned
- **THEN** no selector carries a setup screen prefix

#### Scenario: Interactive states

- **WHEN** a control on a setup screen is hovered, disabled or focused with the
  keyboard
- **THEN** its recorded state styles match the baseline

### Requirement: Computed-style parity

A committed baseline SHALL record the computed styles of named elements on
`/bag`, `/seat`, `/secrets`, `/table`, `/player`, `/sheet`, `/help` and `/demo`
from the pre-migration build. A check SHALL compare the current build against
that baseline at 1280 px and 390 px, and SHALL fail naming the route, element
and property that changed.

**Source**: `AGENTS.md` "Code Conventions"; issue #137
**Tests**: `scripts/style-parity.mjs`, `scripts/browser-check.mjs`

#### Scenario: Unchanged route

- **WHEN** a migrated route renders at either recorded width
- **THEN** every recorded element matches the baseline

#### Scenario: Changed style

- **WHEN** a utility edit changes a recorded property
- **THEN** the check exits non-zero and names the route, the element and the
  property

#### Scenario: State coverage

- **WHEN** the baseline records hover, disabled, keyboard focus or reduced
  motion for a control
- **THEN** the same states are compared for the current build

### Requirement: Setup routes open without a cover

After `/player` or `/public`, `/bag`, `/seat`, `/secrets` and `/table` SHALL
render directly. The shell SHALL NOT place a cover screen, a warning step or an
extra confirmation between a private route and a setup route, and SHALL NOT
place one between a private route and the console.

**Source**: `SPEC.md` "Screens" (`/player`); issues #142 and #150
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Player handoff to the bag

- **WHEN** the player handoff opens `/bag` after `/player`
- **THEN** the bag renders without a cover heading or a return control

#### Scenario: Browser back from the handoff

- **WHEN** the browser back button returns from `/player` to `/bag`
- **THEN** the bag renders without a cover heading or a return control

#### Scenario: Table overlay unchanged

- **WHEN** `/table` opens after `/player` or `/public`
- **THEN** the console renders without a cover heading, a warning step or a
  reveal control, and the setup routes keep their uncovered rendering

### Requirement: Sheet role legibility

The role sheet SHALL show every role's name and ability in full: no CSS line
clamp, no ellipsis, and no clipped or scrollable text inside the card. The card
SHALL grow to the height the text needs. The role name SHALL render at 16 px or
larger and the ability at 12 px or larger in every sheet language.

**Source**: issue #143; `SPEC.md` "Screens"; `AGENTS.md` "Testing & QA"
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Long ability in Russian

- **WHEN** `/sheet/ru` renders all 72 standard roles at 1280 px
- **THEN** the Pit-Hag card shows its complete ability with no ellipsis and no
  clipped content

#### Scenario: Every width and language

- **WHEN** the sheet shows 72 standard roles at 320, 360, 390, 768, 1280 or
  1440 px, with the Travellers toggle on
- **THEN** every card shows ability text equal to the loaded catalog, computed
  `-webkit-line-clamp: none`, no clipped content, name at least 16 px and
  ability at least 12 px

#### Scenario: Read-only behaviour is preserved

- **WHEN** the sheet is filtered, its language is switched, or it is reloaded
- **THEN** the scenario, Travellers and language behaviour is unchanged and the
  saved game stays unmodified

### Requirement: Seat action dock

The seat screen SHALL render its actions in the bottom bar of the main column,
below the seat ring, not in the left rail. The bar SHALL contain the status line
and exactly one control for each action: Игроку, Отменить, Перемешать,
Использовать порядок. The screen SHALL render no "Секреты" action and no
"Далее: секреты" link; `/secrets` stays reachable from the app bar. At 390 CSS
pixels the bar SHALL wrap without horizontal scrolling and each control SHALL be
at least 44 pixels high.

**Source**: `SPEC.md` "Screens"; issue #154
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Actions under the ring

- **WHEN** `/seat` renders with a dealt bag
- **THEN** the action controls are inside the main column's bottom bar and no
  action control renders in the left rail

#### Scenario: One player control

- **WHEN** `/seat` renders
- **THEN** exactly one control links to `/player`

#### Scenario: No secrets shortcut

- **WHEN** `/seat` renders
- **THEN** no control on the screen links to `/secrets` and the app bar keeps its
  secrets route

#### Scenario: Phone width

- **WHEN** `/seat` renders at 390 CSS pixels
- **THEN** the document does not scroll horizontally and every action control is
  at least 44 pixels high

### Requirement: Exact-order commit

The use action SHALL commit the draft exactly as displayed: the same player ids
in the same positions, each player's seat updated to its new position, and no
re-sort, re-deal or shuffle. A published state after the commit SHALL keep that
order. The commit SHALL keep the current forward navigation.

**Source**: `SPEC.md` "Screens"; issue #154
**Tests**: `scripts/browser-check.mjs`, `src/core/engine/commands.test.ts`

#### Scenario: Swapped order is kept

- **WHEN** the host swaps two seats and activates the use action
- **THEN** the saved order equals the displayed draft and each player's seat
  matches that position

#### Scenario: Published state matches

- **WHEN** the screen reads the game after a successful commit
- **THEN** the ring shows the committed order with no reordering

#### Scenario: Rejected commit

- **WHEN** the command rejects the order
- **THEN** the reason is shown and the draft stays unchanged

### Requirement: Console opens directly after a private route

`/table` SHALL render the console immediately when it opens after `/player` or
`/public`. The console SHALL expose no hide control, no cover screen, no reveal
control and no warning step, and the route SHALL open no overlay of its own.
Mounting the console SHALL NOT dispatch a command or change the saved game.

**Source**: `SPEC.md` "Screens" (`/table`); issue #150
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Host returns from the player handoff

- **WHEN** the host leaves `/player` for `/table`
- **THEN** the console shows the phase card, and no `[data-act="hide"]`,
  `[data-act="reveal"]` or `[aria-modal="true"]` element exists

#### Scenario: Return from the public screen

- **WHEN** the public screen opens `/table`
- **THEN** the console renders without an intermediate cover and the grimoire
  controls are usable immediately

#### Scenario: Saved game unchanged

- **WHEN** a private route opens `/table`
- **THEN** the saved game and its revision are the same as before the route
  change

### Requirement: Mobile app bar menu

Below 900 CSS pixels the app bar SHALL replace its inline route list with one
menu toggle. The toggle SHALL expose `aria-expanded` and SHALL control one panel
that contains the seven route links, Help and the language switch. At 900 CSS
pixels and above the same links, Help and the language control SHALL render
inline and no toggle SHALL render.

**Source**: `SPEC.md` "CSS and accessibility"; issue #141
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Closed on a phone

- **WHEN** `/table` opens at 390 CSS pixels
- **THEN** the toggle is visible with `aria-expanded="false"` and the route links
  are not visible

#### Scenario: Open on a phone

- **WHEN** the toggle is activated
- **THEN** it reports `aria-expanded="true"` and the seven route links, Help and
  the language switch are visible

#### Scenario: Desktop inline navigation

- **WHEN** a route opens at 1440 CSS pixels
- **THEN** the route links, Help and the language switch render inline in the app
  bar and no toggle renders

#### Scenario: Phone width

- **WHEN** the panel is open at 360 CSS pixels
- **THEN** the document does not scroll horizontally and every item is at least
  44 pixels high

### Requirement: App bar menu dismissal

The panel SHALL close on Escape, on a press outside it and after a route
activation. Escape and a route activation SHALL return focus to the toggle when
the destination screen still shows it. Closing the panel SHALL NOT dispatch a
command or change the saved game.

**Source**: `SPEC.md` "CSS and accessibility"; issue #141
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Escape

- **WHEN** the panel is open and Escape is pressed
- **THEN** the panel closes, `aria-expanded` becomes `false` and focus returns to
  the toggle

#### Scenario: Outside press

- **WHEN** the panel is open and the host presses outside it
- **THEN** the panel closes and focus does not move

#### Scenario: Route activation

- **WHEN** a route link in the panel is activated
- **THEN** the destination screen renders with its panel closed

#### Scenario: No game change

- **WHEN** the panel is opened and closed without activating a route
- **THEN** no command is dispatched and the saved game is unchanged

### Requirement: One menu on every app bar

Every app bar that shows host navigation SHALL use the same menu behaviour,
including the React shell bar and the string-composed bar on `/help` and
`/demo`. The public screen SHALL keep no host navigation and SHALL render no
menu toggle.

**Source**: `SPEC.md` "CSS and accessibility"; issue #141
**Tests**: `scripts/browser-check.mjs`

#### Scenario: String-composed bar

- **WHEN** `/help` opens at 390 CSS pixels
- **THEN** its toggle opens the same panel content as the React bar

#### Scenario: Language from the panel

- **WHEN** the language changes from the open panel on `/help` or `/demo`
- **THEN** the screen re-renders in that language on the same route

#### Scenario: Public screen

- **WHEN** `/public` opens at 390 CSS pixels
- **THEN** no menu toggle and no route links render

### Requirement: Shell base and global reset

The built artifact SHALL ship the shell's styles itself, with no CDN and no
external request at run time. Once every route uses utilities and shared tokens,
the shell SHALL apply one global reset so components render consistently, and no
route SHALL depend on an unlayered legacy rule for its layout.

**Source**: `AGENTS.md` "Runtime/Tooling Preferences"; issue #69; Arcane Instrument change
**Tests**: `scripts/browser-check.mjs`, `src/infrastructure/offline/offline-worker.test.ts`

#### Scenario: Offline load

- **WHEN** the app loads from the service worker with the network disabled
- **THEN** the shell's styles are available and no request leaves the origin

#### Scenario: Reset after the cutover

- **WHEN** the global reset is enabled and every route renders
- **THEN** no route loses spacing, focus, list or form styling compared with
  its migrated state

### Requirement: Mobile console composition

Below 900 pixels the console SHALL render the seat table before the controls and
the event log. The top navigation SHALL keep the setup, seat, player, public,
role sheet and help routes reachable, and no fixed footer dock SHALL render. The document SHALL not scroll horizontally at 360 or 390 pixels.

**Source**: `SPEC.md` "CSS and accessibility"; issue #45
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Table first

- **WHEN** the console opens at 390 pixels
- **THEN** the table renders above the controls and the log

#### Scenario: Routes reachable

- **WHEN** the host uses the phone navigation
- **THEN** setup, seats, player, public, role sheet and help can each be opened

#### Scenario: No fixed dock

- **WHEN** the console renders at 390 pixels
- **THEN** no fixed footer navigation is present

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
