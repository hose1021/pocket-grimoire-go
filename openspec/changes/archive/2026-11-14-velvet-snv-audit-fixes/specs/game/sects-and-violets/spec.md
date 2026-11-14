# Spec Delta

## MODIFIED Requirements

### Requirement: Official roster, order and composition

The engine SHALL use the official Sects and Violets roster, composition and
night order, SHALL apply the Fang Gu's plus one Outsider and the Vigormortis's
minus one Outsider, SHALL NOT change the composition when the Vigormortis has no
Outsider token to remove, and SHALL never accept a negative team count.

**Source**: [Sects & Violets r3127](https://wiki.bloodontheclocktower.com/index.php?title=Sects_%26_Violets&oldid=3127), [Fang Gu r2974](https://wiki.bloodontheclocktower.com/index.php?title=Fang_Gu&oldid=2974), [Vigormortis r3015](https://wiki.bloodontheclocktower.com/index.php?title=Vigormortis&oldid=3015)
**Tests**: `src/core/engine/snv.test.ts`, `src/core/engine/setup.test.ts`

#### Scenario: First night

- **WHEN** an Sects and Violets game starts
- **THEN** the first night follows the official order and validates

#### Scenario: Vigormortis without an Outsider

- **WHEN** the bag has no Outsider token to remove and the Vigormortis is in play
- **THEN** the composition is the base one, the bag is legal and no
  `vigormortis-minus` reason is reported

### Requirement: Witch curse

The engine SHALL curse the chosen player and kill that player when they
nominate on the following day while keeping the nomination, SHALL apply a placed
curse even after the Witch dies or becomes impaired, SHALL stop cursing at
exactly three living players, and SHALL not place a curse while the Witch is
impaired at the night step.

**Source**: [Witch r2682](https://wiki.bloodontheclocktower.com/index.php?title=Witch&oldid=2682)
**Tests**: `src/core/engine/snv.test.ts`, `src/core/engine/engine.test.ts`

#### Scenario: Cursed nomination

- **WHEN** the cursed player nominates
- **THEN** the nominator dies and the nomination continues

#### Scenario: Impaired Witch

- **WHEN** the Witch is dead or poisoned at her own night step
- **THEN** no curse is placed

#### Scenario: Witch dies or is impaired after casting

- **WHEN** the Witch placed a curse and then died or became poisoned
- **THEN** the next nomination of the cursed player still kills them

#### Scenario: Three living players

- **WHEN** exactly three players live
- **THEN** the Witch has no ability and a placed curse no longer kills

### Requirement: Pit-Hag character change

The engine SHALL change the chosen player's character when the Pit-Hag chooses a
character that no player already holds, SHALL keep the player's alignment and
set the new shown character, SHALL keep the bluffs and the night queue
consistent, and SHALL record "nothing happens" when the chosen character is
already in play without changing the state.

**Source**: [Pit-Hag r2998](https://wiki.bloodontheclocktower.com/index.php?title=Pit-Hag&oldid=2998)
**Tests**: `src/core/engine/snv.test.ts`

#### Scenario: New character

- **WHEN** the Pit-Hag chooses a player and a character that nobody holds
- **THEN** that player's character changes, their alignment stays the same, and
  the character leaves the bluffs

#### Scenario: Character in play

- **WHEN** the Pit-Hag chooses a character another player already holds
- **THEN** the step completes with the nothing-happens reason and no player
  changes character

#### Scenario: No Demon remains

- **WHEN** the Pit-Hag changes the only living Demon into a non-Demon
- **THEN** good wins because no living Demon remains

### Requirement: Philosopher borrowed ability

The engine SHALL store the good character the Philosopher chooses, SHALL make
the owner of that character drunk while it is in play, and SHALL give the
Philosopher that character's night step on the same and later nights, including
each death-triggered ability the borrowed character has after the Philosopher
dies.

**Source**: [Philosopher r2421](https://wiki.bloodontheclocktower.com/index.php?title=Philosopher&oldid=2421)
**Tests**: `src/core/engine/snv.test.ts`

#### Scenario: Character in play

- **WHEN** the Philosopher chooses a good character another player holds
- **THEN** that player is drunk and the Philosopher wakes with the borrowed
  ability

#### Scenario: Character enters play later

- **WHEN** the chosen character is not in play at the choice and enters play
  later
- **THEN** its new owner becomes drunk at that moment

#### Scenario: Philosopher dies or is impaired

- **WHEN** the Philosopher dies or becomes impaired after granting the drunk
- **THEN** the owner is sober again

#### Scenario: Borrowed death-triggered ability

- **WHEN** the Philosopher borrowed the Klutz, the Sweetheart, the Sage or the
  Barber and the Philosopher dies in the way that triggers it
- **THEN** the borrowed ability wakes and resolves under the Philosopher's name

#### Scenario: Impaired Philosopher

- **WHEN** the Philosopher is poisoned or drunk when choosing
- **THEN** the once-per-game ability is spent and no ability or drunk effect is
  granted

#### Scenario: Declined ability

- **WHEN** the Philosopher completes the step without a character
- **THEN** the once-per-game ability is not spent

#### Scenario: Regained character

- **WHEN** a player who spent the ability later gains the Philosopher character
  again
- **THEN** the once-per-game ability is available again

### Requirement: Evil Twin pair after a character change

The engine SHALL keep the Evil Twin pair as the two stored players, SHALL create
the pair when the Pit-Hag creates an Evil Twin mid-game, and SHALL treat the
current holder of the `eviltwin` character (either pair member) as the ability
holder. It SHALL award evil the win when the executed player is the good-aligned
pair member and the holder is alive and unimpaired at the execution, and SHALL
keep the both-live block while the holder exists.

**Source**: [Evil Twin r3101](https://wiki.bloodontheclocktower.com/index.php?title=Evil_Twin&oldid=3101)
**Tests**: `src/core/engine/snv.test.ts`

#### Scenario: A swap moves a twin's character

- **WHEN** a swap moves the good twin's or the Evil Twin's character to another
  player
- **THEN** the pair stays with the same players and executing the good-aligned
  twin still wins for evil

#### Scenario: The two twins swap characters

- **WHEN** a Barber swap exchanges the two twins' characters
- **THEN** the pair keeps both players, executing the good-aligned twin wins for
  evil, and both twins alive still block a good win

#### Scenario: A Pit-Hag-created Evil Twin

- **WHEN** the Pit-Hag creates an Evil Twin
- **THEN** the pair holds the new twin and a living good player, executing the
  good twin wins for evil, and both twins alive still block a good win

#### Scenario: Dead Evil Twin

- **WHEN** the Evil Twin is dead and the good twin is executed
- **THEN** evil does not win by the Evil Twin ability

#### Scenario: Evil Twin leaves play

- **WHEN** the Evil Twin character leaves play and the good twin is executed
- **THEN** evil does not win and the pair no longer blocks a good win

#### Scenario: Imported legacy save

- **WHEN** a save without the twin player ids is imported
- **THEN** the pair is resolved once from the roles before any character change

## ADDED Requirements

### Requirement: Klutz public choice

The engine SHALL record the Klutz's public choice at the moment the Klutz learns
of the death: an evil target SHALL lose the game immediately for the Klutz's
team, a good target SHALL not, an impaired Klutz SHALL spend the choice and lose
nothing, and a target who is not alive when the choice is made SHALL be refused
with a typed reason so that the host can name another living player. A choice
already recorded SHALL complete the death-triggered step even if its target dies
beforewards.

**Source**: [Klutz r1758](https://wiki.bloodontheclocktower.com/index.php?title=Klutz&oldid=1758)
**Tests**: `src/core/engine/snv.test.ts`

#### Scenario: Evil target at the death

- **WHEN** an executed Klutz publicly chooses an evil player
- **THEN** the opposing team wins immediately with the `klutz` reason

#### Scenario: Target already dead

- **WHEN** the host tries to record a target who is not alive
- **THEN** the choice is refused with `error.55` and another living player can be
  recorded, so the step is never stranded

#### Scenario: Recorded choice and the queued step

- **WHEN** a choice is recorded while a Klutz step is still queued
- **THEN** that step is completed with the recorded target

### Requirement: Pit-Hag created Demon

The engine SHALL NOT give a Demon created by the Pit-Hag the normal Demon wake,
SHALL let the host record the night's arbitrary deaths on the Pit-Hag step, and
SHALL NOT tag those deaths as Demon attacks, so a Demon-only death trigger does
not fire.

**Source**: [Pit-Hag r2998](https://wiki.bloodontheclocktower.com/index.php?title=Pit-Hag&oldid=2998), [Sage r3049](https://wiki.bloodontheclocktower.com/index.php?title=Sage&oldid=3049)
**Tests**: `src/core/engine/snv.test.ts`

#### Scenario: A Demon is made

- **WHEN** the Pit-Hag creates a Demon
- **THEN** no Demon step is queued for that player that night and the Pit-Hag
  step accepts death records

#### Scenario: Arbitrary deaths and the Sage

- **WHEN** the host records a death on the Pit-Hag step and the Sage dies
- **THEN** the death is not a Demon attack and the Sage gets no information step

### Requirement: False information for computed Townsfolk answers

Every computed Townsfolk information step SHALL report whether its actor is
impaired and SHALL require a host answer when the actor is impaired or a living,
unimpaired Vortox is in play, so the Dreamer, the Sage and the Mathematician
behave like the Clockmaker, the Oracle, the Seamstress, the Flowergirl, the Town
Crier and the Juggler.

**Source**: [Vortox r3017](https://wiki.bloodontheclocktower.com/index.php?title=Vortox&oldid=3017), [Dreamer r3096](https://wiki.bloodontheclocktower.com/index.php?title=Dreamer&oldid=3096), [Sage r3049](https://wiki.bloodontheclocktower.com/index.php?title=Sage&oldid=3049), [Mathematician r3100](https://wiki.bloodontheclocktower.com/index.php?title=Mathematician&oldid=3100)
**Tests**: `src/core/engine/snv.test.ts`

#### Scenario: Vortox in play

- **WHEN** a living, unimpaired Vortox is in play at the Dreamer, Sage or
  Mathematician step
- **THEN** the step reports `needsChoice` and refuses to complete without a host
  answer

#### Scenario: Healthy actor, no Vortox

- **WHEN** the actor is healthy and no Vortox is in play
- **THEN** the step completes with the computed answer and no host choice

### Requirement: Vigormortis retention and impairment

The engine SHALL keep a Minion killed by the Vigormortis able to use its
character only while that Minion is sober and healthy, SHALL stop its neighbour
poison while it is impaired, and SHALL restore both when it is sober and healthy
again. A permanent poison SHALL NOT ignore its source's impairment.

**Source**: [Vigormortis r3015](https://wiki.bloodontheclocktower.com/index.php?title=Vigormortis&oldid=3015)
**Tests**: `src/core/engine/snv.test.ts`

#### Scenario: The dead Minion becomes drunk

- **WHEN** a Minion killed by the Vigormortis is drunk or poisoned
- **THEN** it loses the retained ability and its neighbour is no longer poisoned

#### Scenario: Sober again

- **WHEN** the impairment ends
- **THEN** the retained ability and the neighbour poison return

### Requirement: Sweetheart drunk timing

The Sweetheart's drunk SHALL start at the Sweetheart's death rather than at the
bookkeeping step's night slot, because the printed ability starts "from now on".

**Source**: [Sweetheart r3016](https://wiki.bloodontheclocktower.com/index.php?title=Sweetheart&oldid=3016)
**Tests**: `src/core/engine/snv.test.ts`

#### Scenario: Executed Sweetheart

- **WHEN** the Sweetheart is executed during a day and the host records the
  drunk choice that night
- **THEN** the stored effect starts at the day of the death

### Requirement: Juggler guesses

The Juggler SHALL make zero to five guesses, SHALL allow the same player to be
guessed more than once with different characters, SHALL count every guess
separately, SHALL wake with zero guesses and learn zero, and SHALL treat "your
1st day" as the day the guesses were made rather than day one of the game.

**Source**: [Juggler r3020](https://wiki.bloodontheclocktower.com/index.php?title=Juggler&oldid=3020)
**Tests**: `src/core/engine/snv.test.ts`

#### Scenario: Zero guesses

- **WHEN** the Juggler made no guesses on their first day
- **THEN** the night step exists and the computed answer is zero

#### Scenario: Repeated player

- **WHEN** the guesses name the same player twice with different characters
- **THEN** both guesses count toward the answer

#### Scenario: A later first day

- **WHEN** the guesses were recorded on a day other than day one
- **THEN** the step is built for the night after that day, and guesses from an
  earlier day do not repeat the step

### Requirement: Madness execution timing

A madness penalty of execution SHALL be recordable during the day or the night,
and a madness execution SHALL not be blocked by, and SHALL not consume, the
day's own execution.

**Source**: [Cerenovus r3070](https://wiki.bloodontheclocktower.com/index.php?title=Cerenovus&oldid=3070), [Mutant r2968](https://wiki.bloodontheclocktower.com/index.php?title=Mutant&oldid=2968)
**Tests**: `src/core/engine/snv.test.ts`

#### Scenario: Broken madness at night

- **WHEN** the host records an execution penalty for a mad player during the
  night
- **THEN** the command is allowed and the player dies

### Requirement: Vote-dependent information without a ledger

The Flowergirl and the Town Crier SHALL require a host answer when no ended day
with a recorded nomination ledger exists, because ordinary nominations and votes
are run at the table, and SHALL use the computed answer only when such a ledger
exists.

**Source**: [Flowergirl r3009](https://wiki.bloodontheclocktower.com/index.php?title=Flowergirl&oldid=3009), [Town Crier r3182](https://wiki.bloodontheclocktower.com/index.php?title=Town_Crier&oldid=3182), `docs/rules-sources.md` "Known limitations"
**Tests**: `src/core/engine/snv.test.ts`

#### Scenario: No ledger

- **WHEN** the previous day has no recorded nominations
- **THEN** the step reports `needsChoice` and refuses to complete without the
  host's yes or no

#### Scenario: Recorded ledger

- **WHEN** the previous day recorded a Demon vote or a Minion nomination
- **THEN** the step answers from the ledger
