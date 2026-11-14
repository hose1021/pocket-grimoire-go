# Proposal

Issue: #171

## Why

The 2026-11-14 rules audit found that the Bad Moon Rising night engine does not
match the pinned printed rules in seventeen places. Host-recorded deaths ignore
impairment, the target count and the chosen targets; the Goon triggers on
Storyteller choices and blocks targets that were chosen before it; the Lunatic
always attacks one player and its report is lost when the Demon does not wake;
the Courtier, Exorcist, Chambermaid and Grandmother ignore their printed
restrictions; the first night still emits Demon information before the Lunatic.
The host can therefore record a death the rules forbid, or lose a rule the
rules require. This change fixes the findings that live in
`src/core/engine/bmr.ts` and its test, and records the findings that belong to
other modules for their owners.

## What Changes

- Add the printed target restrictions for the Sailor, Chambermaid, Devil's
  Advocate, Grandmother and Godfather as one engine query,
  `bmrTargetError`, exported for the night flow (BMR19, BMR-O4).
- Gate outcome deaths on the actor's impairment for the roles whose deaths the
  outcome panel records (Po, Zombuul, Shabaloth, Godfather, Gossip, Pukka)
  (BMR6).
- Require every recorded death to be one of the step's chosen targets and to
  respect the ability's maximum (BMR7).
- Keep the deaths chosen before the Goon and stop those chosen after it, using
  the chosen order (BMR8).
- Do not trigger the Goon on the Gossip's Storyteller-chosen death or on the
  Moonchild's public choice; trigger it when the Courtier chooses the Goon
  character (BMR9, BMR24, BMR25).
- Regurgitate the Shabaloth's target before its new kills and persist the
  chosen targets even when nobody dies (BMR11, BMR29).
- Keep the Shabaloth's regurgitation available while the Exorcist blocks it
  (BMR26).
- Let a resurrected player regain a used once-per-game ability and wake later
  in the same night, including the Grandmother's start-knowing step (BMR10).
- Record the Exorcist's target even while impaired (BMR16).
- Fix the Courtier: an impaired choice does nothing and the once-per-game is
  spent only after a character is chosen (BMR14, BMR15).
- Show the Godfather the Outsider character tokens, not their seats (BMR5).
- Count only characters who woke for the Chambermaid and do not build its step
  with fewer than two other living players (BMR17, BMR18).
- Do not add the Grandmother's death step while she is impaired (BMR20).
- Use only the host's drunk choice for the Sailor and Innkeeper (BMR23).
- Give the Lunatic the target mode of its shown Demon, keep its night-one
  bluffs as the host's choice (they may be in play), and report its choice on
  its own step so the Demon learns it even when it does not wake (BMR27,
  BMR28).
- Emit the first-night information in the official order: Minions, the Lunatic,
  then the Demon (BMR-O1).
- Remove the Pukka's host death controls (BMR-O2) and the unreachable Gambler
  Recluse branch (BMR-O3).
- Add note keys with variables for every dynamic Bad Moon Rising note, keeping
  the Russian `note` as the stored fallback and log text.

Out of scope: the findings owned by other modules this wave — Sailor execution
immunity (effects.ts, BMR1), the Zombuul's fake death record (death.ts, BMR3),
the Fool protection order (effects.ts, BMR4), registered-dead living (state.ts,
BMR12), the Pukka timing decision (BMR13, owner decision), the Pacifist
(day.ts, BMR21), the Tinker day death (day.ts, BMR22), the Po multi-select
(table UI, BMR2), the `noteKey` priority in `infoText` (helpers.ts), the matrix
rows (docs/rules-matrix.md, BMR30). They are listed with the exact change in
`design.md` and in the pull request report.

## Capabilities

### Modified Capabilities

- `app/game/bad-moon-rising`: target restrictions, outcome resolution, Goon
  ordering, Lunatic mask and report, Shabaloth bookkeeping, resurrection
  abilities, Courtier/Exorcist/Chambermaid/Grandmother conditions, first-night
  order, Pukka controls and step note keys.

## Impact

`src/core/engine/bmr.ts`, `src/core/engine/bmr.test.ts`, the new note keys in
`src/ui/i18n/locales/{ru,en,az}.ts` (keys listed in the task evidence, catalogs
edited by their owner), and the `night.ts`/`table` wiring listed in
`design.md`. No save migration: `noteKey`/`noteVars` are additive and the
stored `note` text is kept.
