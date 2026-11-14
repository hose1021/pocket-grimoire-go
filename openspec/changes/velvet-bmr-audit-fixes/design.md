# Design

## Context

Bad Moon Rising is host-adjudicated: the engine owns the order, the conditional
wakes, protection and the death/resurrection bookkeeping, and the Storyteller
records each printed ability's outcome in the night card. Issue #171 section 2
audited the engine against the pinned wiki revisions. The findings that live in
`src/core/engine/bmr.ts` are fixed here; the ones that live in another module
are documented below with the exact change its owner needs.

## Decisions

### One target-restriction query

`bmrTargetError(state, step, targets)` returns a reason or `null` for the
printed "alive", "not yourself" and "good Townsfolk or Outsider" restrictions
(BMR19, BMR-O4). It is exported because the count checks live in
`completeStep` (`night.ts`), which must call it before any mutation. The engine
keeps one rule source instead of duplicating the restrictions in the ring.

Landed in `night.ts` (`completeStep`'s BMR branch):

```ts
// after the count check in the `step.bmr` branch of completeStep
const targetError = bmrTargetError(state, step, targets);
if (targetError) {
  return { ok: false, errorCode: "error.51", error: targetError };
}
```

### Outcome resolution

`recordBmrOutcome` now decides in this order: an Exorcist-blocked Demon records
no death; the Goon's drunk keeps the targets chosen before it; an impaired
actor of a death-recording role records nothing; every death is one of the
chosen targets and within the maximum; the Shabaloth regurgitates before its
new kills. The Goon's order uses `step.targetIds`, so the Po example (r3104:
only the Moonchild dies after the Goon) is expressible without a second model.

### Shabaloth bookkeeping

The completion moves this night's choice into `used.shabalothPrevious*` and
stores the new choice in `used.shabalothTargets`. The regurgitation validation
reads the previous fields, so it stays legal when the step is completed before
the outcome is recorded, and the chosen targets persist even when nobody dies.

### Lunatic

The step's target mode comes from `setup.lunaticShownId`, including the Po's
0/1/3 charge and the Zombuul's "no death today" condition. The night-one note
lists the real bluff count and the actual bluff character names; the wiki
allows characters that are in play, so the note must not claim otherwise. The
Lunatic's choice is written to its own step as `note.bmr.lunaticReport` and,
when the Demon step exists, to that step, so a silent Zombuul or a blocked
Demon still gets the report.

### Resurrection

`resurrectPlayer` clears the once-per-game flags and re-opens a wake whose
sequence slot is still ahead of the resurrecting step. The `afterOrder` guard
mirrors the Shabaloth example: an Exorcist who acts before the Shabaloth does
not act tonight.

## Landed by other owners

- `effects.ts` BMR1: a sober Sailor survives every cause, including an
  execution; only `bypassProtection` kills (Sailor r1768). Landed in
  `velvet-rules-audit-fixes`.
- `effects.ts` BMR4: the Tea Lady and Innkeeper protections resolve before the
  Fool's own prevention (Fool r2636). Landed in `velvet-rules-audit-fixes`.
- `death.ts` BMR3: the Zombuul's first "death" writes a Death record, so
  `anyoneDiedToday` sees it (Zombuul r3022). Landed in
  `velvet-rules-audit-fixes`.
- `state.ts`/`effects.ts`/`day.ts` BMR12: a registered-dead player counts as
  dead for other abilities and stays alive for the game's own count.
- `day.ts` BMR21: `survives` is legal only for a good target while a living,
  unimpaired Pacifist is in play (`error.57`).
- `day.ts`/UI BMR22: the `tinkerDeath` command records a real ability death and
  the table dispatches it.
- `helpers.ts` AS2: `infoText` must prefer the computed `info.text` when it is
  the Lunatic report, or the step's `noteKey` must be the report key (the engine
  now sets the key, so the existing priority already renders it).
- `table/index.tsx` BMR2: multi-select seats when `maxTargets > 1` and cap at
  `targetBounds(step).max` instead of the hardcoded 2.
- `ring.tsx` BMR-O4: disable dead seats for the Godfather step (the engine
  rejects them once wired).
- 7.5 `docs/rules-matrix.md` (BMR30): mark only the rows backed by an asserting
  test.
