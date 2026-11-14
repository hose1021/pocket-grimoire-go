# Proposal

## Why

The Storyteller console is still a three-zone cockpit: controls on the left, the
seat table in the centre, the event log on the right. At fifteen players the
table is where the Storyteller reads the state and decides, yet the seat names
disappear on a phone, the action context lives away from the table, and the
player-facing reveal has no dedicated private surface. The Velvet Ring prototype
(`design/prototypes/05-velvet-ring.html`, merged in #165) validated a
table-first window: names and states on the table, a fixed action dock, a dawn
report, and full-screen cards for the player. This change implements that
window.

Issue: #164

## What Changes

- Recompose `/table` as one host table: an oval of fifteen seats with visible
  names, role artwork and colour-coded text state badges; the table fills the
  desktop viewport and may grow taller than a phone viewport, where only the
  table area scrolls while the app bar and the action dock stay fixed.
- Put the phase control, the current step, the actor, the active effects and the
  engine's guidance into the fixed dock. The table stays a reading surface.
- Show the execution threshold in the hub and dock, record the host's votes and
  the execution result, and keep the engine as the authority for every action.
- Add the dawn report in the centre of the table: the night's deaths with names
  and roles, the survivor count, or "nobody died", dismissed to the nominations.
- Add a full-screen player card for the Storyteller to pass to a player: the
  role card, the night information, and a false-information template for a
  poisoned or drunk player. The card hides the console and shows only the
  information intended for the player. The Drunk's card shows the believed role.
- Surface the engine's consequence preview, rejection reason, mandatory
  decisions and warnings in the table dock; no rule outcome is decided in the
  screen and no Storyteller choice is auto-filled.
- Extend the token layer with the table-scoped felt, action and card tokens.
  No other route is restyled and no new dependency is added.
- **BREAKING** for the `/table` composition and the Arcane visual system: the
  three-zone console, the hidden phone seat labels and the two-second table read
  requirements are replaced for `/table` by `app/table-console`; the palette and
  shape roles are scoped for the table. The other routes keep their composition.

## Capabilities

### New Capabilities

- `app/table-console`: the Storyteller's table window — seat ring, visible
  names, text state badges, the fixed dock and its guidance, vote threshold and
  execution result, the dawn report, and the full-screen player card.

### Modified Capabilities

- `app/arcane-visual-system`: removes the three-zone console, the two-second
  table read and the player-token requirements for `/table`, and scopes the
  palette and shape roles for the table. The table behavior lives in
  `app/table-console`. The existing `app/design-tokens` one-source rule already
  covers adding the table tokens, so it has no requirement delta.

## Impact

- `src/ui/screens/table/`: the composition, the new presentational components
  and the table-scoped state mapping; the existing commands, preview and
  rejection paths stay.
- `src/ui/components/`: reusable seat, state badge, table dock and player-card
  primitives where a row of utilities repeats.
- `css/app.css`: the new theme tokens; no second stylesheet.
- `scripts/browser-check.mjs`: the table, phone, threshold, dawn and
  player-card scenarios.
- `openspec/specs/app/arcane-visual-system/spec.md`: the table requirements are
  superseded for `/table`; the delta is included in this change after
  `arcane-instrument-ui` was archived.
- No change to the engine, commands, state schema, storage keys, `/player`,
  `/public` or any other route. The prototype's local rule simulation is
  reference only and is not ported.
