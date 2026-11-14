# Tasks

## 1. RED tests

- [x] 1.1 Add one behavioral test per finding that lives in `bmr.ts` to
  `src/core/engine/bmr.test.ts`: BMR5, BMR6, BMR7, BMR8, BMR9, BMR10 (three
  tests), BMR11, BMR14, BMR15, BMR16, BMR17, BMR18, BMR19, BMR20, BMR23,
  BMR24, BMR25, BMR26, BMR27, BMR28, BMR29, BMR-O1, BMR-O2.
  - RED: `node --test src/core/engine/bmr.test.ts` → 27 failures, including
    `the Godfather learns the Outsider characters in play, not their seats (BMR5)`,
    `a drunk or poisoned Demon records no host-marked deaths (BMR6)`,
    `a host-marked death must match the chosen targets and the Demon's maximum (BMR7)`,
    `the Goon's trigger keeps the deaths chosen before it and stops the rest (BMR8)`,
    `an Exorcist blocking the Shabaloth still lets it regurgitate (BMR26)`,
    `the Demon learns the Lunatic's choice even when it does not wake (BMR28)`,
    `the first night introduces Minions before the Lunatic and the Demon after it (BMR-O1)`.
- [x] 1.2 Correct the old assertions that encoded the audited defect: the
  Godfather information test and the "third Shabaloth death" test.
- [x] 1.3 Note BMR-O3: the Recluse is not in the Bad Moon Rising script, so the
  Gambler/Recluse branch is unreachable dead code; it is removed without a
  behavioral test.

## 2. Engine

- [x] 2.1 Add `bmrTargetError` and the role restrictions.
- [x] 2.2 Order the outcome resolution: blocked Demon, Goon order, impairment,
  target/maximum, regurgitation first, then kills.
- [x] 2.3 Keep the Shabaloth's previous choice for the regurgitation and store
  the new choice at completion.
- [x] 2.4 Block only the Shabaloth's kills when the Exorcist names it, keeping
  the regurgitation step.
- [x] 2.5 Restore the once-per-game flags and a later wake on resurrection.
- [x] 2.6 Record the Exorcist's target before its impairment check.
- [x] 2.7 Fix the Courtier cost and impairment, and the Courtier-on-Goon trigger.
- [x] 2.8 Add the Goon exclusions (Gossip, Moonchild) and the Courtier trigger.
- [x] 2.9 Godfather character tokens; Chambermaid count and wake condition;
  Grandmother impairment; Sailor/Innkeeper drunk source.
- [x] 2.10 Lunatic mask target mode, night-one bluffs and the Demon report.
- [x] 2.11 First-night order: Minions, Lunatic, Demon.
- [x] 2.12 Remove the Pukka `canKill` and the dead Gambler branch.
- [x] 2.13 Add `noteKey`/`noteVars` for the Lunatic first-night note, the
  Lunatic report and the Godfather Outsiders; keep `note` as the fallback.
  - GREEN: `node --test src/core/engine/bmr.test.ts` → 107 pass, 0 fail.

## 3. Verification

- [x] 3.1 `npx tsc -p tsconfig.core.json --noEmit` exits 0.
- [x] 3.2 `node --test src/core/engine/bmr.test.ts` → 107 pass, 0 fail.
- [x] 3.3 `node --test src/core/engine/acceptance.test.ts` → the
  `bmr` finale test passes; the `snv` finale test fails on
  `madnessPenalty` in the day flow, which belongs to the S&V/day owner.
- [x] 3.4 `npx openspec validate --changes --strict` → 5 passed.

## 4. Locale keys for the catalog owner

- [x] 4.1 List the new keys in `Evidence`; the catalogs are edited by their
  owner this wave.

## Evidence

- RED: `node --test src/core/engine/bmr.test.ts` with the new tests and the
  original engine → 27 failing tests (the 26 new assertions above and the
  corrected Moonchild/Goon expectation).
- GREEN: `node --test src/core/engine/bmr.test.ts` → `tests 107`, `pass 107`,
  `fail 0`.
- GREEN: `npx tsc -p tsconfig.core.json --noEmit` → no diagnostics.
- GREEN: `node --test src/core/engine/acceptance.test.ts` → `pass 4`, the Bad
  Moon Rising finale test passes.
- New keys (`noteKey` + `noteVars`):
  - `note.bmr.lunaticFirst` — vars `{minions, bluffs}`. ru: «Покажите Безумцу
    {minions} указаний на Приспешников и 3 добрые роли (они могут быть и в
    игре): {bluffs}.»; en: "Show the Lunatic {minions} Minion pointers and any
    3 good characters (they may be in play): {bluffs}."; az: "Lunatika
    {minions} Nökər göstərişi və istənilən 3 yaxşı personaj göstərin (onlar
    oyunda ola bilər): {bluffs}."
  - `note.bmr.lunaticReport` — vars `{name, target}`. ru: «Безумец: {name};
    выбрал {target}. Сообщите это Демону.»; en: "The Lunatic {name} chose
    {target}. Tell the Demon."; az: "Lunatik {name} {target} seçdi. Bunu
    Demon-a deyin."
  - `note.bmr.godfatherOutsiders` — vars `{outsiders}`. ru: «Изгои в игре:
    {outsiders}.»; en: "Outsiders in play: {outsiders}."; az: "Oyunda olan
    Kənarçılar: {outsiders}."
  - `note.bmr.lunaticFirst` replaces Russian text only in the UI; the stored
    `note` stays the Russian fallback for old saves and the log.
- GREEN: `npx openspec validate --changes --strict` → all changes pass.
