# Spec Delta

## MODIFIED Requirements

### Requirement: Spy and Recluse registration

The engine SHALL apply Spy and Recluse registration overrides for alignment,
Demon, Minion, Townsfolk and Outsider queries, including for a dead Spy or
Recluse, and SHALL NOT treat a Recluse registered merely as evil as a Demon.
The engine SHALL apply an override only while the registrant is sober and
healthy: a drunk or poisoned Spy or Recluse registers normally, and a
registration recorded for that player SHALL be rejected before the step mutates.

**Source**: [Spy r3118](https://wiki.bloodontheclocktower.com/index.php?title=Spy&oldid=3118), [Recluse r3007](https://wiki.bloodontheclocktower.com/index.php?title=Recluse&oldid=3007), [States r1039](https://wiki.bloodontheclocktower.com/index.php?title=States&oldid=1039)
**Tests**: `src/core/engine/engine.test.ts`, `src/core/engine/host-choice.test.ts`

#### Scenario: Dead Recluse registration

- **WHEN** a dead Recluse is registered as evil, a Minion or a Demon
- **THEN** the matching alignment and role queries return that registration

#### Scenario: Evil is not Demon

- **WHEN** a Recluse is registered only as evil
- **THEN** a Demon query returns false

#### Scenario: Dead Spy registration

- **WHEN** a dead Spy is registered as good, a Townsfolk or an Outsider
- **THEN** the matching alignment and role queries return that registration

#### Scenario: Impaired registrant

- **WHEN** a poisoned Spy is registered as good or as a Townsfolk
- **THEN** the Chef and alignment queries keep the real evil alignment, the
  Virgin does not trigger, and a registration recorded for that Spy is rejected

#### Scenario: Impaired Recluse

- **WHEN** a drunk Recluse is registered as a Demon
- **THEN** the Fortune Teller and the Slayer see the Recluse's real character

### Requirement: Day abilities

The engine SHALL spend the Virgin's first nomination even when it does not
trigger, SHALL execute only an eligible Townsfolk nominator, SHALL spend the
Slayer ability when used while impaired without a kill, and SHALL count an
illegal Butler vote with a private warning. The engine SHALL also record the
Virgin's first nomination from the table control even when the day already
recorded an execution, and that record SHALL spend the ability.

**Source**: [Virgin r1729](https://wiki.bloodontheclocktower.com/index.php?title=Virgin&oldid=1729), [Slayer r3122](https://wiki.bloodontheclocktower.com/index.php?title=Slayer&oldid=3122), [Butler r3120](https://wiki.bloodontheclocktower.com/index.php?title=Butler&oldid=3120)
**Tests**: `src/core/engine/engine.test.ts`

#### Scenario: Drunk nominator

- **WHEN** a Drunk nominates the Virgin for the first time
- **THEN** the nomination spends the ability and nobody is executed

#### Scenario: Impaired Slayer

- **WHEN** a poisoned Slayer chooses the Demon
- **THEN** the ability is spent and the Demon survives

#### Scenario: First nomination after an execution

- **WHEN** the day already recorded an execution and the host records the
  Virgin's first nomination with the table control
- **THEN** the nomination is recorded, `used.virgin` is true, and no second
  execution is attempted

### Requirement: Demon succession

The engine SHALL pass the Demon role to a sober Scarlet Woman only when at least
five players were alive immediately before the Demon died, SHALL pass the Imp's
self-kill to a living Minion below that threshold, and SHALL not let the new
Demon act again in the same night. When a player becomes the Demon, the engine
SHALL end every effect that player sourced.

**Source**: [Scarlet Woman r3117](https://wiki.bloodontheclocktower.com/index.php?title=Scarlet_Woman&oldid=3117), [Imp r3116](https://wiki.bloodontheclocktower.com/index.php?title=Imp&oldid=3116), [Poisoner r1737](https://wiki.bloodontheclocktower.com/index.php?title=Poisoner&oldid=1737)
**Tests**: `src/core/engine/engine.test.ts`

#### Scenario: Five living before the death

- **WHEN** the Demon dies with five players alive and a sober Scarlet Woman
- **THEN** the Scarlet Woman becomes the Demon

#### Scenario: Four living before the death

- **WHEN** the Demon dies with fewer than five players alive
- **THEN** the Scarlet Woman does not inherit

#### Scenario: Poisoner becomes the Imp

- **WHEN** the Poisoner is the only living Minion and the Imp kills itself
- **THEN** the Poisoner becomes the Imp and the poison it sourced stops

#### Scenario: Redirected Imp death

- **WHEN** the Imp attacks the Mayor and the Storyteller redirects the attack
  onto the Imp
- **THEN** the Imp dies by a normal Demon death and no Minion inherits below
  five living players

## ADDED Requirements

### Requirement: Saint loss scope

The engine SHALL declare the Saint's evil win only for an unimpaired Saint death
by execution on the current day, and a later check SHALL NOT re-fire from an
earlier day's death log.

**Source**: [Saint r3119](https://wiki.bloodontheclocktower.com/index.php?title=Saint&oldid=3119)
**Tests**: `src/core/engine/engine.test.ts`

#### Scenario: Same-day loss

- **WHEN** an unimpaired Saint dies by execution during the current day
- **THEN** evil wins with the `saint` reason

#### Scenario: Cleared winner on a later day

- **WHEN** the recorded winner is cleared and the next day's check runs
- **THEN** the earlier Saint execution does not declare evil again
