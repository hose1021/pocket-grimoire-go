# UI and Privacy Specification

## Purpose

Defines the static screens, the public and player projections that keep secret
information out, and the key parity the interface relies on.

## Requirements

### Requirement: Route table and fallback

The app SHALL serve the static routes `/bag`, `/seat`, `/secrets`, `/table`,
`/player`, `/public`, `/help`, `/demo`, `/sheet` and `/sheet/{ru,en,az}`, SHALL
fall back to `/table` for an unknown path, and SHALL dispose the previous screen
before mounting the next.

**Source**: `SPEC.md` "Runtime" and "Reliability and live-play additions"
**Tests**: `scripts/browser-check.mjs:1226`

#### Scenario: Unknown path

- **WHEN** the browser opens a path the router does not know
- **THEN** the app renders `/table`

#### Scenario: Route change

- **WHEN** the host navigates from `/table` to `/bag`
- **THEN** the table screen cleanup runs and the bag screen mounts

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

### Requirement: Interface string parity

The English, Russian and Azerbaijani UI catalogs SHALL have matching keys and
parameters, and role names SHALL come from the role catalog rather than
hardcoded translations.

**Source**: `SPEC.md` "Screens"; `AGENTS.md` "Code Conventions"
**Tests**: `src/ui/i18n/strings.test.ts`

#### Scenario: Missing key

- **WHEN** a key exists in one catalog and not another
- **THEN** the parity check reports the difference

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

### Requirement: Minimum viewport and accessibility

Screens SHALL avoid horizontal overflow at 360 to 390 pixels, keep touch
targets at least 44 pixels, keep visible focus, label controls, and show secret
states with text and icons rather than colour alone.

**Source**: `SPEC.md` "CSS and accessibility"
**Tests**: `scripts/browser-check.mjs:1226`

#### Scenario: Phone width

- **WHEN** a screen renders at 390 pixels wide
- **THEN** the document does not scroll horizontally

### Requirement: Application identity and logo

The app SHALL present itself as Grimoria: the document title, the web app
manifest name and short name, the README and the in-app brand labels SHALL use
that name. The app SHALL show the Grimoria mark as the favicon, the manifest
icon and the compact brand on the table, setup, role-sheet and help screens.
The mark SHALL be decorative where the adjacent text already names the app.

**Source**: [Issue #54](https://github.com/hose1021/grimoria/issues/54)
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Page identity

- **WHEN** the browser opens any route
- **THEN** the document title is `Grimoria` and the manifest name is `Grimoria`

#### Scenario: Header brand

- **WHEN** the table, setup, role-sheet or help screen renders
- **THEN** it shows the Grimoria mark and no `PG` text mark

#### Scenario: Install icon

- **WHEN** the browser reads the manifest and caches the app shell
- **THEN** the icon is the square Grimoria mark and it is part of the precache

### Requirement: Download file naming

A game or library export downloaded by the host SHALL use a `grimoria-` file
name prefix, and the file SHALL keep the existing export format identifiers so
an earlier export still imports unchanged.

**Source**: [Issue #54](https://github.com/hose1021/grimoria/issues/54)
**Tests**: `scripts/browser-check.mjs`, `src/infrastructure/library/bag-library.test.ts`

#### Scenario: Game export download

- **WHEN** the host downloads a game export
- **THEN** the suggested file name starts with `grimoria-` and the JSON keeps the `pocket-grimoire` format

#### Scenario: Earlier export still imports

- **WHEN** the host imports a game exported before the rename
- **THEN** the import succeeds with the stored format identifier unchanged

### Requirement: Player handoff completion

After a player saves a valid name, the player handoff SHALL hide the shown-role
card and return to the number picker, without an intermediate pass-the-device
step. When every number is claimed, the number picker SHALL offer the seat
arrangement route.

**Source**: `SPEC.md` `/player`
**Tests**: `scripts/browser-check.mjs:781`

#### Scenario: Save returns to the number picker

- **WHEN** a player reveals their role, enters a non-empty name and saves
- **THEN** the role card is hidden and the number picker is visible again

#### Scenario: Last claim offers seats

- **WHEN** the last open number is claimed and saved
- **THEN** the number picker shows the route to seat arrangement

### Requirement: Role reveal on the number tap

Tapping a free number on the player handoff SHALL render the shown-role card
immediately and start the auto-hide deadline on that tap. A claimed number and
a number without a dealt role SHALL stay inert.

**Source**: `SPEC.md` `/player`
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Free number shows the role

- **WHEN** a player taps a free number
- **THEN** the shown-role card appears without an intermediate reveal screen

#### Scenario: Claimed number stays inert

- **WHEN** a player taps a claimed number
- **THEN** no role card appears

#### Scenario: Auto-hide returns to the picker

- **WHEN** the role card is open and Escape is pressed or the document becomes hidden
- **THEN** the number picker returns and the role card is gone

### Requirement: Storyteller step explanation

The night step card SHALL show who wakes, what the Storyteller is allowed to do,
the chosen targets, the active effects that touch the step, and every mandatory
decision that is still unanswered, each with its reason.

**Source**: [Issue #45](https://github.com/hose1021/grimoria/issues/45) "Область", `SPEC.md` "Screens"
**Tests**: `src/ui/screens/table/helpers.test.ts`, `scripts/browser-check.mjs`

#### Scenario: Unanswered target

- **WHEN** the current step requires a target and none is chosen
- **THEN** the card marks the step blocked, lists the target reason and disables the confirm button

#### Scenario: Complete target selection

- **WHEN** the host chooses the required target
- **THEN** the blocking reason disappears and the confirm button is enabled

### Requirement: Consequence preview and separation

The step and phase cards SHALL preview the consequences of the command before it
is confirmed, and the preview SHALL keep "target chosen", "state applied",
"death scheduled", "death happened", "death prevented" and "player revived"
distinct in the card and in the saved log line.

**Source**: [Issue #45](https://github.com/hose1021/grimoria/issues/45) "Область", `src/core/commands/result.ts` "DomainEvent", `src/core/model/types.ts` "LogEntry"
**Tests**: `src/ui/screens/table/helpers.test.ts`, `src/core/engine/bmr.test.ts`, `src/core/engine/engine.test.ts`, `scripts/browser-check.mjs`

#### Scenario: Preview before confirming

- **WHEN** the host changes the step input
- **THEN** the card shows the separated consequence list without mutating or saving the game

#### Scenario: Scheduled versus happened

- **WHEN** a delayed effect only carries an expiry, such as poison or protection
- **THEN** the preview shows no "death scheduled" line

#### Scenario: Real scheduled death

- **WHEN** the Pukka's delayed death carries a resolve mark
- **THEN** the preview shows "death scheduled" and not "death happened"

#### Scenario: Blocked attack

- **WHEN** the engine reports `noDeath` for an Imp attack on a healthy Soldier
- **THEN** the preview shows "death prevented"

#### Scenario: Log line category

- **WHEN** the engine records a death, a prevention or a resurrection
- **THEN** the log entry carries `consequence` and the side panel renders that stable category, falling back to the line kind for old saves

### Requirement: Phase transition preview

Ending the night or the day SHALL show the engine preview of that transition
before it is confirmed, and the engine remains the authority on whether the
transition is allowed.

**Source**: [Issue #45](https://github.com/hose1021/grimoria/issues/45) "Область", `src/core/engine/night.ts` "endNight", `src/core/engine/day.ts` "endDay"
**Tests**: `src/ui/screens/table/helpers.test.ts`, `scripts/browser-check.mjs`

#### Scenario: Day transition

- **WHEN** the host is on the day card
- **THEN** the end-of-day button stays enabled and its preview lists the engine consequences

### Requirement: Rejected command reason

A command rejected by the engine, or one that requires a Storyteller choice,
SHALL show its reason in a dismissible console banner and the game SHALL stay
unchanged.

**Source**: [Issue #45](https://github.com/hose1021/grimoria/issues/45) "Область", `src/core/commands/result.ts`
**Tests**: `src/ui/screens/table/helpers.test.ts`, `scripts/browser-check.mjs`

#### Scenario: Rejected command

- **WHEN** the engine returns a rejection with a reason
- **THEN** the console shows the reason and a dismiss control, and the published state is unchanged

#### Scenario: Rejected import

- **WHEN** the host applies an unreadable import
- **THEN** the console shows the rejection reason instead of a browser alert

#### Scenario: Storyteller choice required

- **WHEN** the engine returns a Storyteller-choice outcome
- **THEN** the console shows that outcome's reason instead of silently choosing a default

### Requirement: Correcting a step input

A step's local draft SHALL be clearable without applying it, so a corrected
target is previewed from the empty draft and no trigger is processed twice.

**Source**: [Issue #45](https://github.com/hose1021/grimoria/issues/45) "Область", `AGENTS.md` "Code Conventions"
**Tests**: `src/ui/screens/table/helpers.test.ts`, `scripts/browser-check.mjs`, `src/core/engine/commands.test.ts`

#### Scenario: Clear a wrong target

- **WHEN** the host clears the step input
- **THEN** the targets, redirect, given answer, registrations and role drafts are empty and nothing is dispatched

#### Scenario: Preview stays read-only

- **WHEN** the host previews a step repeatedly before confirming
- **THEN** the saved state and the applied-command ledger are unchanged

### Requirement: Guidance parity

The storyteller step guidance SHALL be semantically complete in the Russian,
English and Azerbaijani catalogs, with matching keys and parameters for every
key the step card and the consequence preview use.

**Source**: [Issue #45](https://github.com/hose1021/grimoria/issues/45) "Область", `openspec/specs/app/ui-and-privacy/spec.md` "Interface string parity"
**Tests**: `src/ui/i18n/strings.test.ts`

#### Scenario: Missing guidance key

- **WHEN** a step or consequence key is missing from one catalog
- **THEN** the parity test fails and names the language and key

#### Scenario: Placeholder mismatch

- **WHEN** one catalog uses a different placeholder set for a shared key
- **THEN** the parity test reports the key

### Requirement: Snake Charmer dead-seat target picker

On a Snake Charmer night step the Storyteller target picker SHALL disable every
dead player's seat, SHALL keep living seats selectable, and the engine SHALL
continue to reject a dead target with `error.55`.

**Source**: [Issue #104](https://github.com/hose1021/grimoria/issues/104), [Snake Charmer r2905](https://wiki.bloodontheclocktower.com/index.php?title=Snake_Charmer&oldid=2905)
**Tests**: `scripts/browser-check.mjs`, `src/core/engine/snv.test.ts`

#### Scenario: Dead seat

- **WHEN** the Snake Charmer step is shown with a dead player in a seat
- **THEN** that seat is disabled and cannot be chosen

#### Scenario: Living seat

- **WHEN** the Snake Charmer step is shown with living players in other seats
- **THEN** those seats remain selectable

#### Scenario: Engine rejection

- **WHEN** a dead target reaches the engine for the Snake Charmer step
- **THEN** the command is rejected with `error.55` and no swap happens

### Requirement: Localized engine-originated console text

The console SHALL render every engine-originated note, cause and warning in the
active UI language. A raw English sentence SHALL NOT appear in the Russian UI,
and stored text without a localized form SHALL remain readable.

**Source**: [Issue #170](https://github.com/hose1021/grimoria/issues/170); `AGENTS.md` "Code Conventions"; `SPEC.md` "Screens"
**Tests**: `src/ui/i18n/strings.test.ts`, `src/core/engine/bmr.test.ts`, `scripts/browser-check.mjs`

#### Scenario: Bad Moon Rising step note

- **WHEN** a Bad Moon Rising step carries an engine note in the Russian UI
- **THEN** the note appears in Russian and not as a raw English sentence

#### Scenario: Language switch

- **WHEN** the host switches the UI language
- **THEN** the engine notes on the current step render in the new language

#### Scenario: Stored legacy note

- **WHEN** an imported save carries note text with no localized form
- **THEN** the console shows the stored text instead of a missing-key placeholder

### Requirement: One tracking disclaimer per screen

A screen SHALL show the tracking disclaimer once and SHALL NOT repeat it on the
deal screen, `/secrets` and every step sheet.

**Source**: [Issue #170](https://github.com/hose1021/grimoria/issues/170); `SPEC.md` "Screens"
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Deal screen

- **WHEN** the deal screen renders
- **THEN** the tracking disclaimer appears once

#### Scenario: Step sheet

- **WHEN** a step sheet opens after the screen already showed the disclaimer
- **THEN** the sheet does not repeat it

#### Scenario: Secrets screen

- **WHEN** `/secrets` renders
- **THEN** the disclaimer appears once on the screen

### Requirement: Host guidance follows the UI language and the actor

The step guidance SHALL give a specific instruction for the Bad Moon Rising and
Sects & Violets introduction steps, SHALL keep a Lunatic-specific instruction,
and SHALL use the Drunk guidance for a Drunk actor's step, stating that the
ability does not work and the information is false.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS3, AS4); [Drunk](https://wiki.bloodontheclocktower.com/index.php?title=Drunk)
**Tests**: `src/ui/i18n/strings.test.ts`

#### Scenario: Minion introduction

- **WHEN** a Bad Moon Rising first night reaches the minion introduction
- **THEN** the host action tells the Storyteller to wake the Minions and show
  them the Demon and each other, not the generic ability line

#### Scenario: Drunk actor

- **WHEN** the actor of a night step is the Drunk
- **THEN** the guidance says the ability does not work and the information is
  false

### Requirement: Host-facing reasons and win causes are localized

A rejected command and a setup error SHALL render in the active UI language
through their `error.N` key when the catalogs translate it, and SHALL fall back
to the engine message otherwise. An illegal step answer and a madness review
SHALL have distinct `error.66` copy. The Vortox, Evil Twin and Klutz win causes
SHALL have a sentence in every catalog.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS15, AS16, AS17)
**Tests**: `src/ui/screens/table/helpers.test.ts`, `src/ui/i18n/strings.test.ts`

#### Scenario: English console rejects a command

- **WHEN** the engine rejects a step with a translated error code
- **THEN** the banner shows the English sentence, not the Russian engine message

#### Scenario: Vortox win

- **WHEN** the Vortox win cause is recorded
- **THEN** the over panel shows a full sentence for it in every catalog

### Requirement: The shown card records the chosen answer

For an impaired actor the private player card SHALL show the selected `given`
answer when the host recorded one, then the typed template, and only then an
explicit "information is not set up" state.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS14)
**Tests**: `src/ui/screens/table/helpers.test.ts`

#### Scenario: Poisoned Chef with a chosen number

- **WHEN** the host selects "2" for a poisoned Chef and shows the card
- **THEN** the card shows the computed form of that answer, not only the empty
  template

### Requirement: Registration is labelled as registration

The character answer for a healthy Undertaker or Ravenkeeper whose target
registers as another character SHALL be labelled as a registration choice, not
as false information.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS11)
**Tests**: `src/ui/screens/table/helpers.test.ts`

#### Scenario: Undertaker after a Spy execution

- **WHEN** a healthy Undertaker's executed target is the Spy and the host
  chooses the shown character
- **THEN** the control is labelled as a registration choice

### Requirement: Russian host copy matches the pinned rules

The Russian catalog SHALL state that the Saint's execution wins for evil, SHALL
keep the Spy's real-grimoire instruction separate from the impaired false-picture
instruction, and SHALL translate `error.15` and `error.16`.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS19); [Saint](https://wiki.bloodontheclocktower.com/index.php?title=Saint)
**Tests**: `src/ui/i18n/strings.test.ts`

#### Scenario: Russian Saint guide

- **WHEN** the Russian console shows the Saint's guide
- **THEN** the host line says the healthy Saint's execution gives evil the win

#### Scenario: Russian error copy

- **WHEN** the Russian console shows `error.15` or `error.16`
- **THEN** the sentence is Russian, not the English placeholder
