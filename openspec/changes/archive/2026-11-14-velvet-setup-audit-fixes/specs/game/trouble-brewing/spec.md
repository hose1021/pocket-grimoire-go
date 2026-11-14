# Spec Delta

## MODIFIED Requirements

### Requirement: Trouble Brewing first-night pair information

The engine SHALL compute the Librarian and Investigator first-night
information from the real setup: a Librarian learns that one of two players is
a particular Outsider or that zero are in play, and an Investigator learns that
one of two players is a particular Minion. The zero SHALL stay legal while every
Outsider in play can register as something else, and a shown character SHALL NOT
have to be in the bag when one of the two players can register as it.

**Source**: [Librarian r1721](https://wiki.bloodontheclocktower.com/index.php?title=Librarian&oldid=1721), [Investigator r2983](https://wiki.bloodontheclocktower.com/index.php?title=Investigator&oldid=2983), [Washerwoman r2630](https://wiki.bloodontheclocktower.com/index.php?title=Washerwoman&oldid=2630), [Spy r3118](https://wiki.bloodontheclocktower.com/index.php?title=Spy&oldid=3118), [Recluse r3007](https://wiki.bloodontheclocktower.com/index.php?title=Recluse&oldid=3007)
**Tests**: `src/core/engine/setup.test.ts`, `src/core/engine/engine.test.ts`

#### Scenario: Librarian pair

- **WHEN** the first night resolves the Librarian step and an Outsider is in play
- **THEN** the shown role is that Outsider and the pair contains that player

#### Scenario: Librarian zero

- **WHEN** no Outsider is in play on the first night
- **THEN** the Librarian learns that zero are in play and no pair is required

#### Scenario: Librarian zero with a registering Recluse

- **WHEN** the only Outsider in play is the Recluse and the Storyteller makes the Recluse register as a Minion
- **THEN** the Librarian's zero is accepted and the night is not blocked

#### Scenario: Outsider that cannot register away

- **WHEN** a non-Recluse Outsider is in play and the host records the Librarian's zero
- **THEN** setup secrets report `librarian-zero`

#### Scenario: Investigator pair

- **WHEN** the first night resolves the Investigator step
- **THEN** the shown role is a Minion in play and the pair contains that player

#### Scenario: A shown character held by a registering Spy or Recluse

- **WHEN** the Washerwoman or Librarian names a not-in-play character and one of the pair is the Spy, or the Investigator names a not-in-play Minion and one of the pair is the Recluse
- **THEN** the pair is accepted and no `info-inplay-*` reason is reported

#### Scenario: A shown character nobody can register as

- **WHEN** the pair names a character that is neither in the bag nor registrable through a pair member
- **THEN** setup secrets report `info-inplay-*` for that role

## ADDED Requirements

### Requirement: False information for the Drunk's setup information

The engine SHALL accept the false setup information the Storyteller gives a
Drunk under the shown information role. A Drunk shown the Librarian SHALL be
able to record the "zero Outsiders" answer without a role and a two-player
pair.

**Source**: [Drunk r3165](https://wiki.bloodontheclocktower.com/index.php?title=Drunk&oldid=3165), [Librarian r1721](https://wiki.bloodontheclocktower.com/index.php?title=Librarian&oldid=1721), `docs/rules-sources.md` "Interpretations that matter in code" item 3
**Tests**: `src/core/engine/setup.test.ts`, `src/core/engine/engine.test.ts`

#### Scenario: Drunk shown the Librarian

- **WHEN** the bag contains the Drunk shown the Librarian and the host records the zero answer
- **THEN** setup secrets accept it and report no `drunk-info`

#### Scenario: Drunk shown the Washerwoman

- **WHEN** the Drunk's false pair is missing or names the wrong team
- **THEN** setup secrets still report `drunk-info` or `drunk-info-team`
