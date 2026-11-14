# Spec Delta

## MODIFIED Requirements

### Requirement: Death prevention and bypass

The engine SHALL resolve protection deterministically: the Assassin bypasses
Fool, Sailor, Tea Lady, Innkeeper and Devil's Advocate protection; the Zombuul
replaces its first death and registers as dead while sober; an impaired Zombuul
dies normally. The Tea Lady and Innkeeper protections SHALL resolve before the
Fool's ability, so the Fool's once-per-game ability is spent only when the Fool
prevented the death. The Zombuul's replaced death SHALL be recorded as a Death
entry for that day while the player stays alive.

**Source**: [Assassin r1786](https://wiki.bloodontheclocktower.com/index.php?title=Assassin&oldid=1786), [Fool r2636](https://wiki.bloodontheclocktower.com/index.php?title=Fool&oldid=2636), [Zombuul r3022](https://wiki.bloodontheclocktower.com/index.php?title=Zombuul&oldid=3022), [Tea Lady r1777](https://wiki.bloodontheclocktower.com/index.php?title=Tea_Lady&oldid=1777), [Innkeeper r3129](https://wiki.bloodontheclocktower.com/index.php?title=Innkeeper&oldid=3129)
**Tests**: `src/core/engine/bmr.test.ts`, `src/core/engine/engine.test.ts`

#### Scenario: Assassin against the Fool

- **WHEN** the Assassin chooses the Fool
- **THEN** the Fool dies

#### Scenario: Impaired Zombuul

- **WHEN** a poisoned Zombuul dies for the first time
- **THEN** it dies and does not register as dead

#### Scenario: Protected Fool

- **WHEN** the Tea Lady or the Innkeeper prevents the Fool's death
- **THEN** the Fool stays alive and its ability is not spent

#### Scenario: Zombuul first death

- **WHEN** a sober Zombuul is executed for the first time
- **THEN** it stays alive, registers as dead, and the day records a Death entry
  so it does not wake that night

### Requirement: Sailor safety

The engine SHALL prevent the Sailor's death while sober and healthy from any
cause, including an execution, and SHALL allow a bypassing ability such as the
Assassin's to kill it. A drunk or poisoned Sailor dies normally.

**Source**: [Sailor r1768](https://wiki.bloodontheclocktower.com/index.php?title=Sailor&oldid=1768), [Assassin r1786](https://wiki.bloodontheclocktower.com/index.php?title=Assassin&oldid=1786)
**Tests**: `src/core/engine/bmr.test.ts`, `src/core/engine/engine.test.ts`

#### Scenario: Impaired Sailor

- **WHEN** the Sailor is drunk when attacked
- **THEN** the Sailor dies

#### Scenario: Executed Sailor

- **WHEN** a sober Sailor is executed by the town
- **THEN** the Sailor is executed but remains alive

#### Scenario: Assassin against the Sailor

- **WHEN** the Assassin attacks a sober Sailor
- **THEN** the Sailor dies

## ADDED Requirements

### Requirement: Bad Moon Rising target legality

The engine SHALL enforce the printed target restrictions in `completeStep`:
the Sailor and the Devil's Advocate choose a registered-living player, and the
Chambermaid chooses two registered-living players other than herself. A
registered-dead Zombuul SHALL count as dead for these checks.

**Source**: [Sailor r1768](https://wiki.bloodontheclocktower.com/index.php?title=Sailor&oldid=1768), [Chambermaid r2966](https://wiki.bloodontheclocktower.com/index.php?title=Chambermaid&oldid=2966), [Devil's Advocate r2594](https://wiki.bloodontheclocktower.com/index.php?title=Devil%27s_Advocate&oldid=2594), [Zombuul r3022](https://wiki.bloodontheclocktower.com/index.php?title=Zombuul&oldid=3022)
**Tests**: `src/core/engine/engine.test.ts`

#### Scenario: Dead target

- **WHEN** the Sailor or the Devil's Advocate chooses a dead player
- **THEN** the step is rejected with `error.55` and stays incomplete

#### Scenario: Chambermaid self-target

- **WHEN** the Chambermaid chooses herself
- **THEN** the step is rejected with `error.40`

#### Scenario: Sailor self-target

- **WHEN** the Sailor chooses themself
- **THEN** the step is accepted

### Requirement: Registered death and ability counts

A player whose state says it registers dead SHALL count as dead for other
players' abilities — Tea Lady neighbour selection and protection, the Scarlet
Woman's "5 or more alive" count, and living-target legality that already reads
registered death — while the game's own alive count, win checks, execution
threshold and the Zombuul's own actions SHALL keep the real `alive` state.

**Source**: [Zombuul r3022](https://wiki.bloodontheclocktower.com/index.php?title=Zombuul&oldid=3022), [Tea Lady r1777](https://wiki.bloodontheclocktower.com/index.php?title=Tea_Lady&oldid=1777), [Scarlet Woman r3117](https://wiki.bloodontheclocktower.com/index.php?title=Scarlet_Woman&oldid=3117)
**Tests**: `src/core/engine/engine.test.ts`

#### Scenario: Tea Lady next to a registered-dead Zombuul

- **WHEN** a registered-dead Zombuul sits next to the Tea Lady
- **THEN** it is skipped as a neighbour and the Tea Lady protects her real
  living neighbours

#### Scenario: Scarlet Woman threshold

- **WHEN** the Demon dies with five real living players but one of them
  registers dead
- **THEN** the Scarlet Woman does not inherit

#### Scenario: Game alive count

- **WHEN** a Zombuul registers dead
- **THEN** the game's alive count, win checks and the Zombuul's own wake keep
  the real `alive` state

### Requirement: Pacifist survival

The execution `survives` flag SHALL be accepted only for a good target while a
living, unimpaired Pacifist is in play and the execution is the day decision;
any other use SHALL be rejected with `error.57` before the day mutates.

**Source**: [Pacifist r2601](https://wiki.bloodontheclocktower.com/index.php?title=Pacifist&oldid=2601)
**Tests**: `src/core/engine/engine.test.ts`

#### Scenario: Evil target

- **WHEN** an evil player is executed with `survives`
- **THEN** the command is rejected with `error.57` and nobody dies

#### Scenario: No Pacifist in play

- **WHEN** a good role is executed with `survives` and no Pacifist is in play
- **THEN** the command is rejected, the player stays alive and no ability is
  spent

#### Scenario: Impaired Pacifist

- **WHEN** the only Pacifist is drunk or poisoned
- **THEN** the flag is rejected

### Requirement: Tinker death

The engine SHALL record a Tinker death as a real ability death: a sober Tinker
can die during the day or the night, the Death carries `cause: "ability"` and
Tinker provenance, and the normal death consequences and win check run. An
impaired Tinker SHALL be rejected.

**Source**: [Tinker r1782](https://wiki.bloodontheclocktower.com/index.php?title=Tinker&oldid=1782)
**Tests**: `src/core/engine/engine.test.ts`

#### Scenario: Day death

- **WHEN** the Storyteller records the Tinker's death during the day
- **THEN** the Tinker dies with `cause: "ability"` and the Death names the Tinker

#### Scenario: Night death

- **WHEN** the Storyteller records the Tinker's death during the night
- **THEN** the Tinker dies with the same provenance

#### Scenario: Impaired Tinker

- **WHEN** the Tinker is drunk or poisoned
- **THEN** the death is rejected and the Tinker stays alive
