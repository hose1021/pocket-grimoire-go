# Design direction: Arcane Instrument

Grimoria is a dark fantasy table aid used by one Storyteller in a dim room. The
interface must read as a tabletop instrument, not a dashboard: the table is the
centre, the host controls sit beside it, and the record of play sits opposite.

The reference composition is `design/prototypes/03-arcane-instrument-full.html`.

## Materials and palette

| Role | Token | Value |
| --- | --- | --- |
| Page void | `--color-crypt` | `#080b0e` |
| Panel | `--color-crypt-2` | `#0f141a` |
| Raised panel, hover | `--color-crypt-3` | `#141b23` |
| Hairline | `--color-edge` | `#243039` |
| Strong border, focus | `--color-edge-2` | `#37464f` |
| Secondary metal | `--color-brass` | `#b08d57` |
| Primary action, active actor | `--color-amber` | `#e6a94c` |
| Primary hover | `--color-amber-2` | `#f0c072` |
| Primary border | `--color-amber-dim` | `#6a4d22` |
| Danger, death | `--color-crimson` | `#c04a42` |
| Danger border | `--color-crimson-dim` | `#5d2320` |
| Role and rules surface | `--color-parchment` | `#e8dcc0` |
| Text on parchment | `--color-ink` | `#2b2118` |
| Elevation | `--shadow-deep` | `0 24px 60px rgba(0,0,0,.55)` |
| Active glow | `--shadow-glow` | `0 0 24px rgba(230,169,76,.30)` |

Control and chrome surfaces use their own tokens: `--color-control-top` /
`--color-control-bottom` for the steel button gradient, its
`--color-control-border-hover`, `--color-forge-bottom` and
`--color-forge-hover` for the primary gradient, `--color-amber-ink`,
`--color-amber-raise`, `--color-danger-top`, `--color-danger-bottom`,
`--color-danger-ink`, `--color-danger-raise`, `--color-field`,
`--color-void-top` and `--color-void-bottom` for the page falloff,
`--color-alert-surface` / `--color-alert-ink` and
`--color-banner-surface` for the two global banners. The `theme-color`
metadata repeats the page-void value because a meta tag cannot read a
custom property.

Team colours stay as rule data: `townsfolk`, `outsider`, `minion`, `demon`,
`traveller`. They mark teams, never actions.

One glow per view. A card does not glow. A phase panel and a dialog do not use a
multi-colour gradient.

## Typography and shape

- Display: `--font-role` (Georgia stack) for phase titles, role names and
  section headings.
- Interface: Inter for labels, data and controls; tabular numerals for counts,
  timers and vote tallies.
- Labels: uppercase, 8 to 10 px, letter spacing .12 to .2 em, brass.
- Radii: 4 px for controls and chips, 6 px for panels and dialogs. No pills.
- Borders: one hairline; the left team edge is 2 to 3 px and always paired with
  a team label.

## Composition

One column: the app bar, the scrollable table stage and the action dock under
it. From 620 px the stage centres a 1.42:1 table; the dock keeps the phase, the
current step, one hint line and two action rows and never scrolls with the
table. Below 620 px the table keeps a width-relative 100:145 height, so fifteen
seats stay readable, and the stage is the only scroll container: the bar and the
dock stay put and the document does not scroll sideways at 360–390 px.

The table is an ellipse of fifteen seats around a centre hub. Names stay visible
at every width: near-horizontal seats put the label inward beside the medallion,
the bottom seats above it and the rest below, and the paint order decreases with
the seat index so a label is never cut by the next medallion. Medallions are
44 px on a phone and 58 px on a desktop. Role art lives on the medallion; the
role text lives in the player list, the step sheet and the player card. The
state of a seat is a coloured text badge, and acting, nominated and dead seats
also carry an outline, a strike or a mark, so colour is never the only channel.

## The two-second read

At a glance the console must answer: which phase and day, who is alive, who is
dead, who is nominated, who has votes, who is poisoned or protected, who acts
now, and what the single next action is. The dock names the actor and the next
action; the hub carries the threshold, the nomination, the dawn outcome and the
execution result. The dock exposes exactly one primary action per phase.

## Component vocabulary

`TableRing` (seats, hub and dawn report), `TableDock` (phase, guidance, preview
and action rows), the full-screen player card, `EventLog`, `RoleCard`,
`ArcaneAppBar` and the markup bar for the two string-composed screens. Both bars
read one nav list from `app-bar-parts.ts`. `ActionButton`, `PhasePanel`,
`GrimoirePanel`, `GameTable` and `PlayerToken` were drafted and deleted: every
screen composes the one `.btn`, `.field` and `.label` primitive from the
`components` layer instead. Components take plain props and never read the
store or the engine.

## Motion

State feedback only, 180 ms or less. No entrance choreography. The active actor
uses a static amber ring and a single glow. `prefers-reduced-motion: reduce`
removes animation and smooth scrolling.

## Accessibility

- Text contrast meets AA; parchment uses ink, never muted grey.
- Every control is at least 44x44 px and keyboard reachable, with a visible
  amber focus ring.
- Dead seats use a mark and a strike in addition to muted colour.
- Dialogs keep their Radix focus trap, Escape handling and accessible name.
- Hidden player and public projections carry no real role, reminder or effect.
