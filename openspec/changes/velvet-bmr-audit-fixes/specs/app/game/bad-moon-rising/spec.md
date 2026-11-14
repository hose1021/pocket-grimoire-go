# Spec Delta

## ADDED Requirements

### Requirement: Printed target restrictions

The engine SHALL reject a Bad Moon Rising target that violates the printed
ability: the Sailor, Devil's Advocate and Godfather need a living player, the
Chambermaid needs two living players other than herself, and the Grandmother's
grandchild must be a good Townsfolk or Outsider.

**Source**: [Sailor r1768](https://wiki.bloodontheclocktower.com/index.php?title=Sailor&oldid=1768), [Chambermaid r1784](https://wiki.bloodontheclocktower.com/index.php?title=Chambermaid&oldid=1784), [Devil's Advocate r3013](https://wiki.bloodontheclocktower.com/index.php?title=Devil%27s_Advocate&oldid=3013), [Grandmother r1777](https://wiki.bloodontheclocktower.com/index.php?title=Grandmother&oldid=1777); [Issue #171](https://github.com/hose1021/grimoria/issues/171)
**Tests**: `src/core/engine/bmr.test.ts`

#### Scenario: Dead Sailor target

- **WHEN** the Sailor step is completed with a dead player
- **THEN** the engine returns a target reason and no drunk effect is created

#### Scenario: Chambermaid self target

- **WHEN** the Chambermaid step includes her own seat or a dead player
- **THEN** the engine returns a target reason

#### Scenario: Evil grandchild

- **WHEN** the Grandmother step is completed with an evil player
- **THEN** the engine returns a target reason and accepts only a good
  Townsfolk or Outsider

### Requirement: Host-recorded outcomes follow the ability

The engine SHALL record a Bad Moon Rising death only when the actor's ability
works, the death is one of the step's chosen targets and the count does not
exceed the ability's maximum; a regurgitated target SHALL resolve before the
Shabaloth's new kills; a blocked Demon SHALL still be able to regurgitate.

**Source**: [Goon r2977](https://wiki.bloodontheclocktower.com/index.php?title=Goon&oldid=2977), [Po r3104](https://wiki.bloodontheclocktower.com/index.php?title=Po&oldid=3104), [Shabaloth r1790](https://wiki.bloodontheclocktower.com/index.php?title=Shabaloth&oldid=1790), [Exorcist r1769](https://wiki.bloodontheclocktower.com/index.php?title=Exorcist&oldid=1769); [Issue #171](https://github.com/hose1021/grimoria/issues/171)
**Tests**: `src/core/engine/bmr.test.ts`

#### Scenario: Impaired Demon

- **WHEN** a poisoned Po's outcome records a death
- **THEN** the engine rejects the death and nobody dies

#### Scenario: Third Shabaloth death

- **WHEN** the Shabaloth chose two targets and three deaths are marked
- **THEN** the engine rejects the outcome

#### Scenario: Goon in the chosen order

- **WHEN** the Po chooses a player, then the Goon, then another player
- **THEN** the first player still dies, and a marked death for the later one is
  rejected

#### Scenario: Regurgitation before the kills

- **WHEN** the Shabaloth regurgitates the Tea Lady and attacks her neighbours
  the same night
- **THEN** the Tea Lady is alive before the attacks resolve and protects them

#### Scenario: Blocked Shabaloth

- **WHEN** the Exorcist names the Shabaloth
- **THEN** the Shabaloth step records no death but still offers the
  regurgitation of last night's target

### Requirement: Goon triggers on ability choices only

The engine SHALL trigger the Goon only when a player chooses the Goon with
their own ability: the Gossip's Storyteller victim and the Moonchild's public
choice SHALL NOT trigger it, and the Courtier choosing the Goon character
SHALL.

**Source**: [Goon r2977](https://wiki.bloodontheclocktower.com/index.php?title=Goon&oldid=2977), [Courtier r1797](https://wiki.bloodontheclocktower.com/index.php?title=Courtier&oldid=1797), [Moonchild r1783](https://wiki.bloodontheclocktower.com/index.php?title=Moonchild&oldid=1783); [Issue #171](https://github.com/hose1021/grimoria/issues/171)
**Tests**: `src/core/engine/bmr.test.ts`

#### Scenario: Gossip consequence

- **WHEN** the Gossip's statement was true and the host chooses the Goon as the
  victim
- **THEN** no Goon drunk is granted and the Goon keeps its alignment

#### Scenario: Moonchild choice

- **WHEN** the dead Moonchild's public choice is a living evil Goon
- **THEN** the Goon is not killed and keeps its alignment

#### Scenario: Courtier character

- **WHEN** the Courtier chooses the Goon character
- **THEN** the Goon takes the Courtier's alignment and the Courtier is drunk
  instead of making the Goon drunk for three nights

### Requirement: Resurrection restores abilities and wakes

A resurrected player SHALL regain every once-per-game ability, and a wake whose
slot is still ahead in the same night SHALL become available again, including
the Grandmother's start-knowing step.

**Source**: [Shabaloth r1790](https://wiki.bloodontheclocktower.com/index.php?title=Shabaloth&oldid=1790); [Issue #171](https://github.com/hose1021/grimoria/issues/171)
**Tests**: `src/core/engine/bmr.test.ts`

#### Scenario: Used Courtier

- **WHEN** the Professor resurrects a Courtier who already used the ability
- **THEN** the once-per-game flag is cleared

#### Scenario: Later wake

- **WHEN** the Shabaloth regurgitates the Assassin, who acts later that night
- **THEN** the Assassin's step exists again and is not completed

### Requirement: Courtier and Exorcist choices

The Courtier SHALL spend its once-per-game only after choosing a character and
SHALL apply no effect while impaired; the Exorcist SHALL record its target even
while impaired so the next night's "different to last night" rule applies.

**Source**: [Courtier r1797](https://wiki.bloodontheclocktower.com/index.php?title=Courtier&oldid=1797), [Exorcist r1769](https://wiki.bloodontheclocktower.com/index.php?title=Exorcist&oldid=1769); [Issue #171](https://github.com/hose1021/grimoria/issues/171)
**Tests**: `src/core/engine/bmr.test.ts`

#### Scenario: Empty Courtier choice

- **WHEN** the Courtier step completes without a character
- **THEN** the ability is not spent and the Courtier wakes on a later night

#### Scenario: Impaired Exorcist

- **WHEN** a poisoned Exorcist chooses a player
- **THEN** the target is stored and no Demon is blocked

### Requirement: Information and conditional wakes

The Godfather SHALL learn the Outsider character tokens, the Chambermaid SHALL
count only characters who woke due to their ability and SHALL not wake with
fewer than two other living players, the Grandmother SHALL not die while
impaired, and the Sailor and Innkeeper SHALL apply a drunk only to the
Storyteller's explicit choice.

**Source**: [Godfather r2394](https://wiki.bloodontheclocktower.com/index.php?title=Godfather&oldid=2394), [Chambermaid r1784](https://wiki.bloodontheclocktower.com/index.php?title=Chambermaid&oldid=1784), [Grandmother r1777](https://wiki.bloodontheclocktower.com/index.php?title=Grandmother&oldid=1777), [Sailor r1768](https://wiki.bloodontheclocktower.com/index.php?title=Sailor&oldid=1768), [Innkeeper r1774](https://wiki.bloodontheclocktower.com/index.php?title=Innkeeper&oldid=1774); [Issue #171](https://github.com/hose1021/grimoria/issues/171)
**Tests**: `src/core/engine/bmr.test.ts`

#### Scenario: Godfather first night

- **WHEN** the Godfather wakes on the first night
- **THEN** the note names the Outsider characters and no seat

#### Scenario: Chambermaid count

- **WHEN** the Chambermaid chooses the Gossip and the Innkeeper
- **THEN** she learns one, because only the Innkeeper woke

#### Scenario: Drunk Grandmother

- **WHEN** the Demon kills the grandchild while the Grandmother is drunk
- **THEN** no Grandmother death step is added

#### Scenario: No drunk choice

- **WHEN** the Sailor or Innkeeper completes without a drunk choice
- **THEN** no player is made drunk

### Requirement: Lunatic mask and report

The Lunatic SHALL attack with the target mode of the Demon it was shown and
SHALL report its choice to the real Demon even when the Demon does not wake;
its night-one note SHALL list the actual bluffs, which may be in play.

**Source**: [Lunatic r3112](https://wiki.bloodontheclocktower.com/index.php?title=Lunatic&oldid=3112), [Po r3104](https://wiki.bloodontheclocktower.com/index.php?title=Po&oldid=3104); [Issue #171](https://github.com/hose1021/grimoria/issues/171)
**Tests**: `src/core/engine/bmr.test.ts`

#### Scenario: Shabaloth mask

- **WHEN** the Lunatic believes they are the Shabaloth
- **THEN** its step takes exactly two targets

#### Scenario: Po mask charge

- **WHEN** the Lunatic believes they are the Po and chose no one last night
- **THEN** its step takes exactly three targets

#### Scenario: Silent Demon

- **WHEN** the real Demon is a Zombuul who does not wake after a death today
- **THEN** the Lunatic's step carries the report note with the Lunatic's and
  the target's names

### Requirement: First-night order

The first night SHALL emit Minion information, then the Lunatic, then Demon
information.

**Source**: [Bad Moon Rising r2871](https://wiki.bloodontheclocktower.com/index.php?title=Bad_Moon_Rising&oldid=2871); [Issue #171](https://github.com/hose1021/grimoria/issues/171)
**Tests**: `src/core/engine/bmr.test.ts`

#### Scenario: Queue order

- **WHEN** a Bad Moon Rising game with a Lunatic starts night one
- **THEN** the Minion information precedes the Lunatic and the Demon
  information follows it

### Requirement: Step controls match the engine

The Pukka step SHALL NOT offer host death controls, because the engine resolves
its delayed death, and the Gambler SHALL NOT carry the unreachable Recluse
registration branch.

**Source**: [Pukka r3074](https://wiki.bloodontheclocktower.com/index.php?title=Pukka&oldid=3074), [Gambler r1785](https://wiki.bloodontheclocktower.com/index.php?title=Gambler&oldid=1785); [Issue #171](https://github.com/hose1021/grimoria/issues/171)
**Tests**: `src/core/engine/bmr.test.ts`

#### Scenario: Pukka outcome panel

- **WHEN** the Pukka step is active
- **THEN** it advertises no host-recorded death

#### Scenario: Gambler guess

- **WHEN** the Gambler's guess differs from the target's character
- **THEN** the Gambler dies; no registration id changes the guess
