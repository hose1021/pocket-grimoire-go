# Proposal

Issue: #171

## Why

The 2026-11-14 audit of the Velvet worktree found setup-screen behavior that
contradicts the printed rules and `SPEC.md`:

- The seat route renders every player's real role, although `SPEC.md` `/seat`
  says "names only" and the route is readable by anyone at the table (SET8).
- A rejected saved bag or pool load closes the library and keeps no reason, so
  the host cannot see why the entry cannot be loaded (SET7).
- A mixed manual pool renders the Bad Moon Rising or Sects & Violets pane
  instead of the manual secrets screen, because the branch tests the pool
  contents before the manual mode (SET9).
- The Bad Moon Rising and Sects & Violets secrets panes return before the
  Storyteller reminder checklist (SET10).
- The role sheet always shows the five Trouble Brewing Travellers, on every
  scenario (SET11).
- The random bag composes a Godfather direction but the script switch applies
  `+1` regardless (SET5).
- The player-count stepper moved before the "change the count?" confirmation
  and before the command result, so a cancelled or rejected change left the
  local counter one ahead of the saved one.
- The Secrets screen could not record the Librarian's zero or a not-in-play
  character held by a registering Spy or Recluse, although the engine accepts
  both, and setup rejections rendered the engine's Russian message in every
  language.

## What Changes

- `/seat` renders a name-and-seat projection; no role, shown role, team or
  alive state reaches the ring, the sidebar or the drag ghost.
- A rejected `bagUpdate` from a saved bag or pool keeps the library open, shows
  the localized reason and leaves the published state unchanged.
- The Secrets screen picks the manual pane whenever the script is manual, and
  the BMR and S&V panes render the reminder checklist for the roles in play.
- The role sheet shows each scenario's own five Travellers and all fifteen on
  the all-roles sheet; the Travellers stay in their separate toggle.
- Both `applyBag` and the script switch apply the `godfatherOutsider`
  direction returned by `randomBag`.
- The count stepper updates its local ref only after the confirmation and a
  successful command, so each activation moves one player.
- The Librarian's zero is a control whenever the engine accepts it, the Drunk
  shown the Librarian may record it, and a registering Spy or Recluse adds the
  not-in-play characters of the needed team.
- Setup and bag rejection reasons render through the existing `error.N` keys,
  with the engine message only as a fallback.

Out of scope: the model-side fixes of the setup-owner change
(`openspec/changes/velvet-setup-audit-fixes`), the table console, and the locale
catalog entries still needed for setup problem codes (reported in `tasks.md`).

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `app/ui-shell`: the seat draft no longer shows role art, the bag editor keeps
  a rejected library load and the stepper atomic, and the secrets screen
  handles manual pools, the reminder checklist and the two registration
  answers.
- `app/ui-and-privacy`: the seat route shows names only, and the role sheet
  shows the selected scenario's Travellers.

## Impact

- Code: `src/ui/screens/seat.tsx`, `secrets.tsx`, `sheet.tsx`, `bag.tsx` and
  three small pure modules (`seat-projection.ts`, `secrets-options.ts`,
  `sheet-scenarios.ts`) plus `setup-messages.ts`.
- Tests: `src/ui/screens/seat-projection.test.ts`,
  `secrets-options.test.ts`, `sheet-scenarios.test.ts`,
  `setup-messages.test.ts`.
- Follow-up outside this change: setup problem codes still need `error.<code>`
  locale entries (exact text in `tasks.md`), and `randomBag`'s thrown errors
  still carry Russian messages without codes.
