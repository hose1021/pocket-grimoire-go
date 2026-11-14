# Spec Delta

## MODIFIED Requirements

### Requirement: Registration legality

A registration override SHALL be accepted only for the Spy or the Recluse,
only with a value their abilities read, and only while that player is sober and
healthy; any other player, value or impaired registrant SHALL be rejected before
the step mutates.

**Source**: Issue #42, Issue #171; [Spy r3118](https://wiki.bloodontheclocktower.com/index.php?title=Spy&oldid=3118), [Recluse r3007](https://wiki.bloodontheclocktower.com/index.php?title=Recluse&oldid=3007), [States r1039](https://wiki.bloodontheclocktower.com/index.php?title=States&oldid=1039)
**Tests**: `src/core/engine/host-choice.test.ts`, `src/core/engine/engine.test.ts`

#### Scenario: Wrong player

- **WHEN** a registration names a player other than the Spy or the Recluse
- **THEN** the command is rejected with `error.67` and the state is unchanged

#### Scenario: Unread value

- **WHEN** a registration value is one the information functions never read
- **THEN** the command is rejected with `error.67`

#### Scenario: Impaired registrant

- **WHEN** a registration names a drunk or poisoned Spy or Recluse
- **THEN** the command is rejected with `error.67` and the step stays incomplete

## ADDED Requirements

### Requirement: Table decision commands

The command surface SHALL expose the Klutz public choice, the Tinker ability
death and the Juggler guess list with typed payloads, SHALL validate the target
and the current choice before mutating, and SHALL reject an illegal call
atomically.

**Source**: [Klutz r3072](https://wiki.bloodontheclocktower.com/index.php?title=Klutz&oldid=3072), [Tinker r1782](https://wiki.bloodontheclocktower.com/index.php?title=Tinker&oldid=1782), [Juggler r3079](https://wiki.bloodontheclocktower.com/index.php?title=Juggler&oldid=3079)
**Tests**: `src/core/engine/engine.test.ts`, `src/core/engine/commands.test.ts`

#### Scenario: Klutz choice

- **WHEN** the host sends `recordKlutzChoice` with `{ targetId }` and an
  unresolved Klutz
- **THEN** the public choice is recorded and the queued step resolves

#### Scenario: Klutz without a choice

- **WHEN** no Klutz is waiting for a public choice
- **THEN** the command is rejected with `error.29`

#### Scenario: Tinker death

- **WHEN** the host sends `tinkerDeath` with `{ playerId }` for a sober Tinker
- **THEN** the Tinker dies with ability provenance

#### Scenario: Non-Tinker death

- **WHEN** `tinkerDeath` names another role or a dead player
- **THEN** the command is rejected with `error.58`

#### Scenario: Juggler guess list

- **WHEN** the host sends `jugglerGuess` with `{ guesses: [...] }`, including an
  empty list
- **THEN** the list is recorded for the Juggler's first day, at most five
  entries, repeats allowed

#### Scenario: Juggler single guess

- **WHEN** the host sends `jugglerGuess` with `{ playerId, roleId }`
- **THEN** that guess is appended to the current list
