# Proposal

Issue: #170
Depends on: PR #169 (`feat/velvet-table-console`). Apply this change after that
pull request merges, or on a branch rebased onto it.

## Why

The Velvet Ring console now renders the host table, but six full-game audits
and a manual 15-player Trouble Brewing playthrough found remaining defects. The
host can hit a stale bag stepper, a duplicate day-help block, untranslated
engine notes, invisible scheduled deaths and Zombuul fake deaths, ambiguous
effect and decision controls, and browser checks that still target the old
shell. These gaps block the console from being the trusted play surface.

## What Changes

- Make the bag count stepper move exactly one player per activation, including
  immediately after a script switch.
- Replace the static «К номинации» dawn label with a dismissal control and show
  the active nomination and vote tally in the ring header.
- Reset the table route cleanly after «Новая игра»; no stale game state remains.
- Limit the day-help sheet to role-specific forms; the generic execution and
  nomination stay in the dock.
- Localize every engine-originated note shown in the console, including the
  static Bad Moon Rising step notes and the dynamic role notes.
- Show engine-scheduled deaths and the Zombuul's registered-dead state on the
  ring, and remind the host before the next execution.
- Separate the role decision from death and revival marking in the Gambler and
  Tinker sheets, and give the Tinker an explicit decision control.
- Show each effect badge with its owner or source, label the Drunk mask editor,
  disambiguate the deal screen return actions, and show the tracking disclaimer
  once per screen rather than on every sheet.
- Localize the victory copy per win reason.
- Port `scripts/browser-check.mjs` to the Velvet table selectors, re-record the
  style parity baseline, and keep `npm run verify` green.
- Verify the Bad Moon Rising night order against the official sheet and add the
  untested engine scenarios: Mayor win with three alive, tied votes, Butler,
  Zombuul night kill, Innkeeper and Exorcist reverse cases, Po, and Godfather
  execution survival.

Out of scope: the Sailor, mastermind-result, drunk/poisoned, Devil's Advocate
and Fool, Professor, previous-target, locale, threshold, guide and Mastermind
banner fixes that PR #169 already carries uncommitted. This change does not
re-open them.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `app/table-console`: the ring nomination readout, scheduled-death and Zombuul
  visibility, the effect badge source, the day-help sheet, the decision sheets,
  the minion card independence, and the deal-screen return action. This
  capability arrives with PR #169; the delta is authored against that spec.
- `app/ui-shell`: the bag count stepper, the secrets Drunk mask label, the
  over-panel new-game reset, and the reason-specific victory copy.
- `app/ui-and-privacy`: every engine-originated console note is localized in the
  active UI language, and the tracking disclaimer appears once per screen.

## Impact

`src/ui/screens/bag.tsx`, `src/ui/screens/secrets.tsx`,
`src/ui/screens/table/` (`dock.tsx`, `ring.ts`, `ring.tsx`, `cards.tsx`,
`dialogs.tsx`, `index.tsx`, `helpers.ts`), the three locale catalogs,
`src/application/read-models/table.ts`, `src/core/engine/bmr.ts` note
descriptors, the engine and read-model tests, `scripts/browser-check.mjs` and
`scripts/fixtures/computed-styles.json`. No save migration is planned: legacy
notes keep their stored text, and the new descriptors are additive.
