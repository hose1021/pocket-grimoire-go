# Day and Win Specification

## Purpose

Defines execution, voting and the order in which the engine decides that a team
has won.

## Requirements

### Requirement: Execution threshold

The engine SHALL require at least half of the living players, rounded up, for
an execution.

**Source**: [Rules Explanation r1310](https://wiki.bloodontheclocktower.com/index.php?title=Rules_Explanation&oldid=1310), `docs/rules-sources.md` "Interpretations" item 16
**Tests**: `src/core/engine/engine.test.ts`

#### Scenario: Six living players

- **WHEN** six players are alive
- **THEN** three votes are enough for an execution

#### Scenario: Seven living players

- **WHEN** seven players are alive
- **THEN** four votes are required

### Requirement: Dead vote token

The engine SHALL count a dead player's vote once and SHALL spend the token when
the vote is cast, including a failed nomination.

**Source**: [Rules Explanation r1310](https://wiki.bloodontheclocktower.com/index.php?title=Rules_Explanation&oldid=1310)
**Tests**: `src/core/engine/engine.test.ts`

#### Scenario: Second dead vote

- **WHEN** a dead player votes a second time
- **THEN** the vote is not counted

### Requirement: Ties and execution outcome

The engine SHALL block an execution when the highest vote total is tied, SHALL
keep the leader when a lower total is tied, and SHALL record an execution event
that may produce no death.

**Source**: [Rules Explanation r1310](https://wiki.bloodontheclocktower.com/index.php?title=Rules_Explanation&oldid=1310), `docs/rules-sources.md` "Interpretations" item 7
**Tests**: `src/core/engine/engine.test.ts`, `src/core/engine/engine.test.ts`

#### Scenario: Tied maximum

- **WHEN** two nominees share the maximum vote total
- **THEN** nobody is executed

#### Scenario: Execution without a death

- **WHEN** an execution event happens and the target does not die
- **THEN** the day records the execution and no death

### Requirement: Win precedence

The engine SHALL check wins in this order: Saint execution, Mastermind extra
day, Evil Twin and Vortox day end, Mayor three-player win, no living Demon, and
two living players; a dead Demon token SHALL not end the game before inheritance
is resolved.

**Source**: `docs/rules-sources.md` "Interpretations" item 20, [Saint r3119](https://wiki.bloodontheclocktower.com/index.php?title=Saint&oldid=3119), [Mastermind r2993](https://wiki.bloodontheclocktower.com/index.php?title=Mastermind&oldid=2993)
**Tests**: `src/core/engine/engine.test.ts`, `src/core/engine/engine.test.ts`, `src/core/engine/engine.test.ts`, `src/core/engine/bmr.test.ts`, `src/core/engine/snv.test.ts`, `src/core/engine/snv.test.ts`

#### Scenario: Saint executed

- **WHEN** a sober Saint dies by execution
- **THEN** evil wins

#### Scenario: No living Demon before two alive

- **WHEN** the last Demon is dead and two players remain
- **THEN** good wins by the Demon check, not the two-alive rule

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

### Requirement: Idempotent day actions

The engine SHALL reject a second application of a completed night step or a
recorded vote.

**Source**: `SPEC.md` "Domain rules"
**Tests**: `src/core/engine/engine.test.ts`

#### Scenario: Repeated vote

- **WHEN** the same vote command is applied twice
- **THEN** the second apply reports failure and does not change the tally

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
