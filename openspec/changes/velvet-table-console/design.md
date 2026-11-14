# Design

## Context

See `proposal.md` for motivation. The current `/table` console is the
Arcane Instrument three-zone composition: `ArcaneAppBar`, a control column, the
seat ring in `frame.tsx`, a side panel and a phone dock. It reads the game
through `useGame`, keeps every transient draft in `useTableDrafts`, and
dispatches or previews through `useShellPorts().commands`; the screen never
calls the engine. `tableProjection` provides the phase, the step, the
nomination and the seat data. `src/ui/screens/table/helpers.test.ts` and
`step-draft.test.ts` hold the screen-level tests.

The Velvet Ring prototype (merged in #165) is a design reference, not a source
of rules: it carries a local fifteen-player simulation. The production screen
must keep the engine, the commands, `tableProjection`, the existing drafts and
the Arcane token source. The `arcane-instrument-ui` change is still open; its
`app/arcane-visual-system` spec is the base for the visual language and its
`app/design-tokens` delta is the token base.

Constraints: no new dependency, one global stylesheet, one token source, no
rules or state schema changes, 44 px targets, no horizontal overflow at 360 to
390 px, visible focus, reduced-motion support, and a private player card that
never shows the console.

## Goals / Non-Goals

**Goals:**

- One host table window: a readable seat ring, a fixed action dock that carries
  the current step and the engine guidance, and a phone layout where the table
  scrolls under a fixed bar and dock.
- The table answers the Storyteller's questions at a glance: who is alive, who
  acts, who is nominated, votes and the threshold, poison and protection, the
  dawn outcome and the next action.
- A full-screen player card that is safe to hand over: the role card, the night
  information, or a host-entered template, with no console and no host notes.
- Every action remains an existing command with the existing preview,
  rejection and Storyteller-choice handling.

**Non-Goals:**

- No new game rule, command, state field, storage key or projection. The
  prototype's local rule simulation is not ported.
- No change to `/player`, `/public`, `/bag`, `/seat`, `/secrets` or `/sheet`.
- No second visual language for the other routes and no new dependency.
- No automated Storyteller choice. The assistant warns; the host decides.

## Decisions

### 1. Screen shell: bar, stage, fixed dock

Replace the three-zone grid with one column: the app bar, a table stage and an
action dock. At 720 px and above the stage centres the table and fits the
viewport. Below 620 px the stage is a vertical scroll container; the table may
be taller than the stage and the bar and dock remain outside the scroll. The
dock is the only place that scrolls the actions; its content is capped to a
compact step line, one hint line and two action rows.

Alternatives considered: keeping the three-zone grid and adding the dock
(duplicates the step and the target context); a full-height fixed table with no
scroll (cannot keep all fifteen names at 390 px); a grid of seat cards instead
of the ring (loses the table spatial read and the prototype's direction).

The stage height for the mobile table uses the available stage height as a
minimum and a width-relative height as a fallback when the labels need room.
The table is centred with auto margins; when it is taller than the stage the
top remains reachable and the stage scrolls.

### 2. Seat ring and label placement

The ring uses the existing forty-four-pixel minimum target at phone width and a
fifty-eight-pixel medallion on desktop. Seats are placed at equal angles around
an ellipse; the label rules are derived from the angle:

- near-horizontal seats (absolute cosine above 0.8) place the label inward,
  beside the medallion, right-aligned on the right side and left-aligned on the
  left;
- bottom seats (sine above 0.7) place the label above the medallion;
- all other seats place it below.

Labels paint above later seats by a decreasing z-index per seat, so a name is
never cut by the next medallion. The seat number stays on the medallion on
desktop and is omitted on phones, where the name and the role artwork carry the
identity; the number remains in the player list and the step sheet. The role is
artwork on the medallion; its text lives in the player list, the step sheet and
the player card.

The geometry (seat centres, label side and the label-anchor boxes) is a pure
helper so `helpers.test.ts` can cover fifteen seats, the four label sides and
the no-collision property without a browser.

Alternative considered: hiding the names below a per-token width, as the current
Arcane visual system does. It fails the phone requirement and the Storyteller's
at-a-glance read. The visual-system delta replaces that requirement for
`/table`.

### 3. State badges

A seat renders text badges from the projection and the transient table state:
`Действует`, `На казнь`, `Мёртв`, `Голос` or `Без голоса`, `Яд`, `Защита`.
The badges are coloured with the theme tokens, have a border and a text label,
and the acting, nominated and dead seats also keep their outline or muted
artwork, so colour is never the only channel. The role-specific host tokens
(red herring, butler master, spent ability) stay in the player card; they are
not table badges. Vote counts are shown as the threshold pips and the tally in
the hub, not as a second row of per-seat pips, because the host records actual
voters through the existing vote flow.

Alternatives considered: the corner icon badges (unreadable at 44 px and not
textual); showing every host token on the table (fifteen seats become noisy and
the states are no longer at a glance).

### 4. Day, threshold and dawn

The day hub shows the open nomination, the recorded voters, the threshold
`ceil(living / 2)` and the execution control. The existing command path
(`nominate`, `recordVotes`, `execute`, `endDay`) and the existing draft/vote
flow remain; the screen never computes whether an execution is allowed. The
dock shows the threshold and the engine's rejection.

The dawn report is a transient view state in the screen, not persisted: at the
first day render it reads the night's deaths from the state (the deaths that the
engine recorded for the finished night) and shows the names and roles, the
survivor count, or "nobody died". Dismissing it shows the nomination view. The
report does not decide deaths; it presents the engine's state.

Alternatives considered: a persistent dawn log entry only (the Storyteller has
to search the log); an automatic modal (it would block the day start). The
centre report matches the table window and can be dismissed.

### 5. Full-screen player card

A new `PlayerCard` dialog renders a full-viewport, opaque surface with one
parchment card and one close control. It is opened from the step sheet (night
information) and from the player list (role card); it is local screen state and
is never persisted. The data:

- role card: the player's role artwork, role name and ability; for a Drunk the
  believed role's artwork, name and ability, never the Drunk role;
- night information: the public information object of the current step (the
  pair and role, the count, the yes/no, the learned role, the grimoire, the
  minion/demon lists); the host truth is not included;
- template: a host-entered free-text card with the actor's role artwork, used
  when the actor is poisoned or drunk. The true information control is not
  offered for a poisoned actor; only the template is.

The card is a modal dialog, so focus moves inside and Escape closes it. The
console behind is inert and fully covered; the card shows no navigation, dock,
log, statuses or notes. It does not dispatch a command; the step is confirmed
after the player hands the device back.

Alternatives considered: reusing `/player` (it is a seat-number handoff with a
45-second deadline and a different flow); a sheet with the table blurred (the
table remains visible and can leak host information).

### 6. Assistant and command boundaries

The dock renders the engine's step guidance, the active effects that touch the
step, the mandatory decisions, the consequence preview and the rejection
reason, using the existing `tableProjection`, `useTableDrafts`, `preview` and
`run` paths. Warnings are derived from the preview result (prevented death,
Soldier, Mayor redirect, Saint execution), not from local rule checks. The
target choice stays on the seat ring; the player card is for information, not
target selection. A Storyteller choice remains a visible unanswered decision;
nothing is auto-filled.

### 7. Tokens and visual scope

Add the table tokens to the single `@theme` block: the day and night felt, the
primary, secondary and danger action colours, the parchment card and its ink.
The table's tinted surfaces use one ground per phase and one glow at most. The
other routes keep the Arcane tokens and composition. The one-source rule and
the token policy check are unchanged.

The Arcane change is archived, so `app/arcane-visual-system` is in the main
specs. This change includes its delta: the three-zone console, the two-second
table read and the player-token requirements are removed for `/table`, and the
palette and shape roles are scoped for the table. The new `app/table-console`
owns the table composition, the state badges and the table read. The table
tokens are still declared in the single `@theme` block; the one-source and token
policy checks are unchanged. The prototype's looping acting pulse is not ported:
the visual system's motion rule keeps the acting highlight static.

### 8. Dependency and sequencing

1. `arcane-instrument-ui` was merged and archived (#168); this change is
   rebased on that `main`.
2. The visual-system delta is included and validated; the table implementation
   starts from the tasks.
3. The prototype's design reference stays under `design/prototypes/`; its local
   simulation is never imported by `src/`.

## Risks / Trade-offs

- **Fifteen-seat density.** Names and text badges at 390 px are at the edge of
  legibility. The label geometry test and the browser checks pin the no-collision
  property; a 320 px viewport is narrower than the required 360 to 390 px range
  and may show the table with the same labels at a smaller text size.
- **Dock height.** The fixed dock consumes roughly a quarter of a phone screen.
  The table scroll absorbs it; the dock is capped to the step line, one hint and
  two action rows. If the hint wraps, it truncates rather than grows without
  bound.
- **Modal stacking.** The player card opens over the step sheet as a second
  modal. The dialog implementation must restore focus to the correct trigger;
  the browser checks cover open, Escape and return.
- **Palette drift.** The felt and the mint/secondary actions extend the Arcane
  palette. The visual-system delta and the token policy are the gate; if the
  palette is rejected, the table falls back to the Arcane surfaces without
  changing the composition.
- **The table scroll can move the actor off-screen.** The dock always names the
  actor and the step; the table does not auto-scroll. A "to the actor" control
  can be added later without changing the command contract.
- **The prototype is not a rule source.** The risk is copying its local
  simulation. The tasks explicitly map every action to the existing command and
  the screen tests assert the engine remains authoritative.
