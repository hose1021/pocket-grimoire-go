# Tasks

## 1. RED tests

- [x] 1.1 Rewrite the SV2 case as "a seven-player Vigormortis bag is legal with no Outsider to remove".
- [x] 1.2 Rewrite the SV1 case as "a curse the Witch placed still kills the next nomination after the Witch dies or is impaired" and add the three-living guard.
- [x] 1.3 Rewrite the SV12 case as "the Pit-Hag choosing a character already in play records that nothing happens".
- [x] 1.4 Add the Klutz public-choice cases, the Pit-Hag-created Demon case, the false-information case, the Vigormortis impairment case, the borrowed-Klutz case, the Sweetheart timing case, the Juggler zero/repeat/first-day cases, the Pit-Hag Evil Twin case and the night madness case.
- [x] 1.5 Run `node --test src/core/engine/snv.test.ts`: 88 pass, 14 fail. Failing: the eleven new or rewritten cases plus `the Juggler may guess zero times and still learns zero`, `the Juggler's answer counts repeated guesses and uses the guessing day` and `a recorded Klutz choice finishes the queued step and a dead target does not strand it`.

## 2. Sects & Violets engine (`src/core/engine/sv.ts`, `retention.ts`)

- [x] 2.1 SV8: `minionRetainsAbility` requires a sober, healthy source; `reconcileVigormortisPoison` toggles the permanent neighbour poison with the source's impairment.
- [x] 2.2 SV11: `jugglerGuesses` reads the record and the pair list, counts each guess, wakes with zero guesses and follows `state.juggler.day`.
- [x] 2.3 SV5: `replaceCharacter`/`requeueForCharacter` take `suppressWake`; the Pit-Hag step sets `canKill` and blocks the created Demon's wake.
- [x] 2.4 SV7: the Dreamer, Sage and Mathematician report `impaired` and `needsChoice: impaired || vortoxFalsifies(...)`.
- [x] 2.5 SV12: a character already in play completes the step with `note.pithagInPlay`.
- [x] 2.6 SV13: `replaceCharacter` builds the Evil Twin pair for a created Evil Twin.
- [x] 2.7 SV4: `recordKlutzChoice` plus `resolveKlutzChoice` resolve the public choice at the death, keep a recorded choice valid, and complete the queued step.
- [x] 2.8 SV10: the Sweetheart drunk starts at `actor.deadAt`.
- [x] 2.9 SV9: `DEATH_WAKE_SPECS` is the single table for the four death wakes, and a borrowed ability builds its step from it.

## 3. Verification

- [x] 3.1 Run `node --test src/core/engine/snv.test.ts`: 99 pass, 3 fail (SV1, SV6 and SV2, whose fixes are outside this change's files).
- [x] 3.2 Run `npx openspec validate --changes --strict`.

## 4. Shared-file follow-ups (other owners)

- [ ] 4.1 SV2 (rules.ts): `compositionFor` applies the Vigormortis shift only when an Outsider token remains; `bagErrors` drops `vigormortis-minus`; `randomBag` composes through `compositionFor`.
- [ ] 4.2 SV1 (day.ts, effects.ts): `activeWitchCurse` drops the Witch's life and impairment guards; `effectActive` short-circuits `kind === "witch"`.
- [ ] 4.3 SV6 (day.ts): `applyMadnessPenalty` accepts the night phase; `executeByDecision` allows a madness execution outside the day and beside the day's execution.
- [ ] 4.4 SV11 (day.ts, types.ts, state.ts): `jugglerGuess` records a list of pairs on the Juggler's own first day, zero to five guesses, repeats allowed; `Juggler.guesses` and `validateState` accept the list.
- [ ] 4.5 SV4 (index.ts, UI): re-export `recordKlutzChoice` and add the day-card control that records the public choice when the death is announced.

## 5. Locale keys

- [ ] 5.1 `note.pithagInPlay`: ru `"{{role}} уже в игре: ничего не происходит."`, en `"{{role}} is already in play: nothing happens."`, az
  `"{{role}} artıq oyundadır: heç nə olmur."`
- [ ] 5.2 `note.pithagDemon` (optional; the current note key is `note.characterBecame` with the arbitrary-deaths sentence appended).

## Evidence

- RED: `node --test src/core/engine/snv.test.ts` → `tests 102, pass 88, fail 14`, covering SV1, SV2, SV4 (`×2`), SV5, SV6, SV7, SV8, SV9, SV10, SV11 (`×2`), SV12 and SV13.
- GREEN: `node --test src/core/engine/snv.test.ts` → `tests 102, pass 102, fail 0`; `npx tsc -p tsconfig.core.json --noEmit` clean; `npx openspec validate --changes --strict` → 11 passed.
