# Design

## Context

Issue #171 records the 2026-11-14 audit against the pinned official pages. The
affected code is three pure modules: `src/core/model/rules.ts` (bag data and
validation), `src/core/engine/setup.ts` (setup secrets and the deal) and
`src/core/model/state.ts` (save validation). None of them may import UI or
storage, and each returns the existing `{ ok, error }` /
`{ ok: false, errors: [{ code, message }] }` unions with Russian messages.

## Decisions

### Recognition instead of enumeration (TB1, TB2)

The Secrets screen asked "is this character in the bag?" as a stand-in for "can
this information be true?". The printed rules make a Spy able to register as a
Townsfolk or an Outsider and a Recluse able to register as a Minion or a Demon,
so a not-in-play character is legally showable when a pair member can register
as it.

- The Librarian zero is accepted while every Outsider in play is the Recluse;
  any other Outsider cannot register away from "Outsider", so the zero stays
  rejected.
- The pair check keeps its existing reasons (`info-*`, `info-pair-*`,
  `info-missing-*`, `info-team-*`, `info-true-*`) and relaxes only
  `info-inplay-*`, which now also accepts a registering pair member.

The engine does not invent the registration: it only admits the option, exactly
as `docs/rules-sources.md` item 14 requires.

### False information is not constrained by the bag (TB8)

The Drunk's setup record is data the Storyteller may invent. The Librarian's
zero is the one shaped answer that carries no role and no pair, so the drunk
branch accepts the zero shape for that mask and leaves the pair checks for the
other masks untouched. `src/ui/screens/secrets.tsx` still hides the zero
control for the Drunk; that UI change is listed for the UI owner.

### Attribution, not tiling (SET2, SET12)

The old validator re-derived "the base table has zero Outsiders" for each
modifier, so a second modifier that put an Outsider back (Fang Gu) or a
modifier that a first one already supplied (Baron plus Vigormortis) was rejected
even when the counts matched. Legality is now exactly the counts against
`compositionFor`, and the modifier-specific codes fire only when the composition
is genuinely negative for that direction. A negative required count that no
single modifier explains returns one stable `composition-impossible` reason and
suppresses the `team-*` counters, so the host never reads "0 of -1".

Direction of the count: `godfather-minus` stays the code for the Godfather's
impossible minus-one at a base row with no Outsider (the baseline spec and
`bmr.test.ts` name it). The Vigormortis setup rule ("if there are no Outsider
tokens to remove, do not add a Townsfolk token") belongs to the SV2 decision:
the owner will clamp `compositionFor` so a Vigormortis with nothing to remove is
a no-op, which leaves `vigormortis-minus` unreachable and makes a seven-player
Vigormortis bag legal.

### The deal is a permutation (SET3, SET4, SET6)

`dealGame` is the single entry point for both the `dealGame` and `startGame`
commands, so the permutation gate lives there: every seat in `state.order` gets
one role, and the multiset of assigned roles equals `state.setup.roles`. The
check runs before any player is mutated, matching the atomic-apply contract.

A new deal is a new game. The function already cleared night, day, deaths,
effects, bluffs, herring, info, winner and the log; it now clears `gossip`,
`setup.grandmotherId`, `corrections` and `notes` for the same reason.

The Lunatic mask is required by the bag validator itself rather than only when
the caller supplies the field, because `validateState` and the deal both read
the same gate: an imported save with a Lunatic and no mask dealt the Lunatic its
real role. `validateState` gains the same rule so import cannot bypass it, and
`dealGame` drops the silent fallback to the real role. `normalizeBag` in
`commands.ts` still fills the mask when the host adds the Lunatic, so the bag
screen keeps working without an extra click.

### The random bag owns its direction (SET5)

`randomBag` composed a bag with `options.godfatherOutsider`, then returned
nothing about it, so `applyBag` fell back to `+1`. It now returns
`RandomBag.godfatherOutsider` (named type, exported next to the function), and
reports `+1` when the bag holds no Godfather. `bag.tsx` already copies
`bag.godfatherOutsider` into the command payload, so no UI edit is needed for
this finding.

### Reminder tokens are role data, not screen copy (SET10)

`ROLE_REMINDERS_RU` is the engine-side source of the Secrets checklist, keyed by
role id. It held the 22 Trouble Brewing roles, so the screen showed nothing for
the other two scenarios. The Bad Moon Rising and Sects & Violets entries use the
same one-line Russian token style; the screen keeps rendering them, and a test
guards that every supported role has a list and every Bad Moon Rising and Sects
& Violets role has at least one token.

### Problems carry interpolation values (localization)

A Russian message is a fallback, not a contract. `SetupProblem.vars` exposes the
values the localized `error.<code>` key interpolates, using exactly the names the
catalog declares (`role`, `count`, `required`, `needed`, `team`, `shown`). Role
values stay role ids: the screen resolves them through the role catalog, so a
role name is never duplicated in three languages. Numeric and mask codes that a
screen cannot infer from the code alone (the `team-*` totals, `bluffs-count`,
the modifier count, the shown mask) supply their values; the `info-*` family
already carries its role in the code suffix, so it needs no extra value. The
field is additive: `code` and `message` are unchanged, and a caller that does not
localize keeps working.

## Risks
- `bagErrors` callers that omit `lunaticShownId` while dealing a Lunatic now see
  `lunatic-shown`. All production callers pass it (`setupErrors`, presets,
  suggestions, `repairBag`); `presets.test.ts` needed the field added.
- `snv.test.ts` asserted `vigormortis-minus` for a bag with two Demons. SET2
  supersedes that shape; the SV2 owner rewrites the case with the clamped
  composition.

## Verification

`node --test src/core/engine/setup.test.ts` (16 cases, all passing),
`node --test src/core/engine/engine.test.ts`, `src/core/engine/bmr.test.ts`,
`src/core/model/scripts.test.ts`, `src/core/model/presets.test.ts`, and
`npx openspec validate --changes --strict`.
