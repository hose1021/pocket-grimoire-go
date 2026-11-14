# Spec Delta

## MODIFIED Requirements

### Requirement: Mayor three-player win

The engine SHALL give good the win at the end of a day with exactly three
living players and no execution death, and SHALL not grant it when an execution
produced a death or the Mayor was impaired. A selection of an already dead
player SHALL NOT count as an execution event for this check or for the Vortox.

**Source**: [Mayor r2995](https://wiki.bloodontheclocktower.com/index.php?title=Mayor&oldid=2995), `docs/rules-sources.md` "Interpretations" item 7
**Tests**: `src/core/engine/engine.test.ts`

#### Scenario: Three living, no execution

- **WHEN** exactly three players live and the day ends with no execution death
- **THEN** good wins

#### Scenario: Attempted execution with no death

- **WHEN** an execution was recorded but produced no death
- **THEN** the Mayor win still triggers

#### Scenario: Corpse selection

- **WHEN** the day recorded a selection of an already dead player and nobody died
- **THEN** the Mayor win still triggers

#### Scenario: Execution death

- **WHEN** an execution produced a death that day
- **THEN** the Mayor win does not trigger

## ADDED Requirements

### Requirement: Execution of a living player

The engine SHALL reject `executeByDecision` for a player who is not alive, SHALL
leave the day without an execution record in that case, and SHALL keep the
execution record for a living player whose death is prevented.

**Source**: [Rules Explanation r1310](https://wiki.bloodontheclocktower.com/index.php?title=Rules_Explanation&oldid=1310)
**Tests**: `src/core/engine/engine.test.ts`, `src/core/engine/commands.test.ts`

#### Scenario: Dead target

- **WHEN** the host executes an already dead player
- **THEN** the command is rejected with `error.55` and the day records no
  execution

#### Scenario: Prevented death

- **WHEN** a living player is executed and a protection prevents the death
- **THEN** the execution is recorded and the day has no execution death

### Requirement: Night start phase guard

The engine SHALL reject `startNight` while the game is in the day phase and
SHALL NOT rebuild the night queue or change the phase.

**Source**: `SPEC.md` "Domain actions"; [Rules Explanation r1310](https://wiki.bloodontheclocktower.com/index.php?title=Rules_Explanation&oldid=1310)
**Tests**: `src/core/engine/engine.test.ts`

#### Scenario: Stale tab

- **WHEN** a command starts the night while the game is in the day phase
- **THEN** the command is rejected with `error.68` and the state is unchanged
