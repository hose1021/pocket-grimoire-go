# Command Engine Specification

## Purpose

Defines the single mutation path for the saved game: command validation, preview,
atomic apply, the idempotency ledger and the invariants that every accepted
state must keep.

## Requirements

### Requirement: Validate, preview and apply contract

Every persisting action SHALL be a command that validates against the current
state and returns one of `allowed`, `rejected` with a reason, or
`requires-storyteller-choice` with legal options; a rejected command SHALL leave
the state unchanged.

**Source**: `SPEC.md` "State v4" and "Domain rules"
**Tests**: `src/core/engine/commands.test.ts`, `src/core/engine/commands.test.ts`, `src/core/engine/commands.test.ts`

#### Scenario: Unknown command

- **WHEN** a screen dispatches a command type that is not registered
- **THEN** validation returns `rejected` and the state is byte-identical

#### Scenario: Host decision required

- **WHEN** a lethal attack on a sober Mayor is applied
- **THEN** the result is `requires-storyteller-choice` with the legal redirect options

### Requirement: Atomic apply

Apply SHALL run on a draft copy and SHALL commit the whole draft or none of it,
including recorded corrections.

**Source**: `SPEC.md` "Domain rules"
**Tests**: `src/core/engine/commands.test.ts`

#### Scenario: Rejected correction

- **WHEN** a correction fails validation during apply
- **THEN** the correction list and every other field stay unchanged

### Requirement: Idempotency ledger

Apply SHALL record a command id bound to a canonical fingerprint of type,
payload and ruleset version; a repeated id with the same fingerprint SHALL be a
no-op, a repeated id with a different payload SHALL be rejected, and an
unsupported ruleset version SHALL be rejected before any mutation.

**Source**: `SPEC.md` "State v4"
**Tests**: `src/core/engine/commands.test.ts`, `src/core/engine/commands.test.ts`, `src/core/engine/commands.test.ts`

#### Scenario: Repeated identical command

- **WHEN** the same command id, type and payload are applied twice
- **THEN** the second apply reports success without a second state change

#### Scenario: Unsupported ruleset version

- **WHEN** a command declares a ruleset version the app does not support
- **THEN** the command is rejected and the state is byte-identical

### Requirement: Deterministic preview and apply

Preview SHALL report the domain diff and delayed effects without mutating, and
SHALL agree with apply for the same initial state; the command timestamp is
captured once per id, fingerprint and initial state, and random values come
from a seeded generator.

**Source**: `SPEC.md` "Domain rules"
**Tests**: `src/core/engine/commands.test.ts`, `src/core/engine/commands.test.ts`, `src/core/engine/commands.test.ts`

#### Scenario: Preview then apply

- **WHEN** a command is previewed and then applied from the same initial state
- **THEN** both report the same domain events

### Requirement: State invariants

Every accepted state SHALL keep one role and team per player, no reference to a
missing player, an idempotent completion record, and no winner declared before
all mandatory immediate effects are resolved.

**Source**: `SPEC.md` "Domain rules"; `AGENTS.md` "Code Conventions"
**Tests**: `src/core/engine/commands.test.ts`

#### Scenario: Dangling player reference

- **WHEN** a draft effect or death points at a player id that does not exist
- **THEN** `checkInvariants` reports an error and apply rejects the command

#### Scenario: Premature winner

- **WHEN** a draft declares a winner while a mandatory Demon inheritance is unresolved
- **THEN** `checkInvariants` reports an error

### Requirement: Deterministic impairment dependency resolution

The engine SHALL resolve poison and drunk effects by their target-to-source dependency graph. An effect SHALL be inactive while its source is impaired by another active effect; a self-target SHALL remain active unless another effect impairs the source. Creation order SHALL decide which effect was validly created, and the result SHALL NOT depend on the order of `state.effects`.

**Source**: Owner decision on PR #24; [Abilities](https://wiki.bloodontheclocktower.com/Abilities)
**Tests**: `src/core/engine/commands.test.ts`, `src/core/engine/engine.test.ts`

#### Scenario: Sequential mutual poisoning

- **WHEN** a valid state contains a poison from A to B created on night 1 and a poison from B to A created on night 2 while B was already impaired
- **THEN** A's poison is active, B's poison is inactive, and A remains impaired

#### Scenario: Later poison suspends an earlier Pukka poison

- **WHEN** the Pukka poisons A on night 1 and another poison targets the Pukka on night 2
- **THEN** A's poison and pending death are suspended while the Pukka is impaired, and both resume when the Pukka becomes healthy

#### Scenario: Effect array order

- **WHEN** the engine evaluates the same effect set with `state.effects` reversed
- **THEN** the active set and every impaired player are identical

### Requirement: Effect lifetime boundaries

An effect SHALL be inactive before its `start` and at or after its `expires`. A not-yet-started effect SHALL NOT impair a target or a source; an expired effect SHALL NOT impair or suspend another effect. The boundary SHALL be the cycle of the phase and number.

**Source**: Owner decision on PR #24; [Abilities](https://wiki.bloodontheclocktower.com/Abilities)
**Tests**: `src/core/engine/commands.test.ts`

#### Scenario: Future poison does not impair

- **WHEN** a poison effect starts on night 2 and the engine evaluates the game on night 1
- **THEN** the target is not impaired and the poison is inactive

#### Scenario: Expired drunk does not impair

- **WHEN** a drunk effect expires on night 3 and the engine evaluates the game on night 3
- **THEN** the target is not impaired and the effect is inactive

#### Scenario: Start and expiry boundaries

- **WHEN** the engine evaluates an effect at its start cycle and at its expiry cycle
- **THEN** the effect is active at the start cycle and inactive at the expiry cycle

### Requirement: Impaired effect sources

A poison or drunk effect whose living source is impaired by another active effect SHALL be inactive. A drunk effect from a dead source SHALL remain active for an on-death ability; a self-target effect SHALL remain active unless another effect impairs the source.

**Source**: Owner decision on PR #24; [Abilities](https://wiki.bloodontheclocktower.com/Abilities)
**Tests**: `src/core/engine/commands.test.ts`, `src/core/engine/bmr.test.ts`

#### Scenario: Poisoned Sailor's drunk effect

- **WHEN** the Sailor's drunk effect is active and the Sailor becomes poisoned
- **THEN** the target is no longer drunk, and becomes drunk again when the poison ends

#### Scenario: Dead Sweetheart's drunk effect

- **WHEN** the Sweetheart creates a drunk effect on death
- **THEN** the effect remains active while its dead source is not otherwise impaired

#### Scenario: Self-target drunk effect

- **WHEN** the Sailor chooses itself
- **THEN** the drunk effect is active and the Sailor is impaired

### Requirement: Simultaneous poison and drunk

When a player is targeted by both poison and drunk effects, the player SHALL be impaired once, and both effects SHALL coexist in the dependency graph. A source impaired by either effect SHALL lose its own poison and drunk effects.

**Source**: Owner decision on PR #24; [Abilities](https://wiki.bloodontheclocktower.com/Abilities)
**Tests**: `src/core/engine/commands.test.ts`, `src/core/engine/bmr.test.ts`

#### Scenario: Both effects on one target

- **WHEN** a poison effect and a drunk effect target the same player
- **THEN** `isImpaired` is true and both effects are active

#### Scenario: Source both poisoned and drunk

- **WHEN** a source is targeted by both a poison and a drunk effect
- **THEN** its own poison and drunk effects are inactive, and removing only one impairment keeps them inactive while the other remains

#### Scenario: Mixed same-night cycle

- **WHEN** poison A→B and drunk B→A share the same start and cannot be resolved by creation order
- **THEN** validation, preview and apply return `CYCLIC_EFFECT_DEPENDENCY` and the state stays byte-identical

### Requirement: Cyclic effect dependency rejection

A genuinely unresolvable dependency cycle among poison or drunk effects SHALL be rejected with the error code `CYCLIC_EFFECT_DEPENDENCY`. Validation, preview, apply and import SHALL return that code and SHALL leave the state unchanged; the engine SHALL NOT throw an untyped error or overflow the call stack.

**Source**: Owner decision on PR #24; [Abilities](https://wiki.bloodontheclocktower.com/Abilities)
**Tests**: `src/core/engine/commands.test.ts`, `src/entry/store.test.ts`

#### Scenario: Same-night mutual poison

- **WHEN** a state contains poison A→B and poison B→A with the same start and neither can be resolved by chronology
- **THEN** command validation, preview and apply return `CYCLIC_EFFECT_DEPENDENCY` and the state stays byte-identical

#### Scenario: Three-source cycle

- **WHEN** poison effects A→B, B→C and C→A form a dependency cycle that survives creation filtering
- **THEN** the command is rejected with `CYCLIC_EFFECT_DEPENDENCY` and no effect or player changes

#### Scenario: Cycle detection is order-independent

- **WHEN** the same cyclic effect set is supplied in reverse array order
- **THEN** the same rejection code and the same effect ids are reported

### Requirement: Shared event priority

The engine SHALL expose one frozen event priority list, shared by Trouble
Brewing, Bad Moon Rising and Sects & Violets, that ranks deaths before their
on-death wakes, deferred steps, conditional wakes, impairment resolution and the
win check, in that order.

**Source**: Issue #29; `openspec/specs/game/command-engine/spec.md` "Deterministic impairment dependency resolution"
**Tests**: `src/core/engine/commands.test.ts`

#### Scenario: One ordered list

- **WHEN** the engine loads
- **THEN** `EVENT_PRIORITY` is frozen, lists the six event classes and its values increase with the documented order

### Requirement: Cascade resolution

The engine SHALL resolve a cascade in one call: every declared `after` edge is
honoured, ties follow the shared event priority and then the key, and the
result SHALL NOT depend on the insertion order of the items.

**Source**: Issue #29; `openspec/specs/game/command-engine/spec.md` "Deterministic impairment dependency resolution"
**Tests**: `src/core/engine/commands.test.ts`

#### Scenario: A to B to C in one call

- **WHEN** a cascade declares B after A and C after B and the items are passed in any order
- **THEN** one call returns A, B, C

#### Scenario: Insertion order does not change the result

- **WHEN** the same events are supplied forward and reversed
- **THEN** both calls return the same ordered keys

### Requirement: Cyclic cascade rejection

An unresolvable cascade cycle SHALL return the typed `CYCLIC_CASCADE` error
with the sorted unresolvable keys, SHALL NOT throw or recurse, and SHALL NOT
change the caller's input or the saved state.

**Source**: Issue #29; `openspec/specs/game/command-engine/spec.md` "Cyclic effect dependency rejection"
**Tests**: `src/core/engine/commands.test.ts`

#### Scenario: Cyclic cascade

- **WHEN** the items form A after B, B after C and C after A
- **THEN** the resolver returns `CYCLIC_CASCADE` with `A`, `B`, `C` regardless of insertion order and the input is byte-identical

#### Scenario: Effect cycle in a command

- **WHEN** a saved state contains a same-night poison cycle
- **THEN** validation, preview and apply reject the command and leave the state unchanged

### Requirement: Death-triggered wake order

Death-triggered and conditional night steps SHALL be inserted by their official
`nightsheet.json` order rather than appended in code or death order, so the set
of deaths resolves to the same night queue in any recording order.

**Source**: [Official night sheet](https://release.botc.app/resources/data/nightsheet.json), local snapshot `docs/official/nightsheet.json`; Issue #29
**Tests**: `src/core/engine/snv.test.ts`, `src/core/engine/bmr.test.ts`

#### Scenario: Two deaths in one night

- **WHEN** the Sweetheart and the Barber both die in one night
- **THEN** the Barber's earlier official slot precedes the Sweetheart's wake, in either order the deaths are recorded

#### Scenario: BMR Grandmother death step

- **WHEN** the Po kills the grandchild in the same night
- **THEN** the conditional Grandmother step takes the BMR sequence slot before the Chambermaid, not an appended position

#### Scenario: Effect chain in one graph resolution

- **WHEN** an effect chain A→B→C is evaluated once
- **THEN** B is impaired, C is not, and A's poison is active while B's poison is inactive

### Requirement: Single current character and resolvable player references

Every player SHALL hold exactly one current character from the active script and
exactly one alignment. Every record that names a player SHALL resolve to a player
in the state: seat order, players, effects, deaths, executions, night actors,
nominations, morning deaths, the day execution, the Butler master, the Mastermind
record and the setup player references. A resolved command SHALL leave the state
with no dangling reference.

**Source**: [Issue #32](https://github.com/hose1021/grimoria/issues/32), [Issue #19](https://github.com/hose1021/grimoria/issues/19) "Инварианты"; `docs/rules-sources.md` "Game state" contract and `docs/rules-matrix.md` "Dead actors do not wake", "Win order"
**Tests**: `src/core/engine/invariants.test.ts`, `src/core/engine/commands.test.ts`

#### Scenario: Dealt game is consistent

- **WHEN** a legal game is dealt
- **THEN** each player has one in-script character and one alignment, and `checkInvariants` reports no problem

#### Scenario: Dangling player reference is rejected

- **WHEN** a nomination, morning death, day execution, Butler master, Mastermind record, setup reference, effect, death, execution or night actor names a player that does not exist
- **THEN** `checkInvariants` reports the broken reference

### Requirement: Spent once-per-game abilities and dead wakes

A once-per-game ability SHALL stay spent until the game legally restores it (for
example, a new game). A dead player SHALL NOT wake for a night step; only a role
whose rule triggers on death SHALL keep or gain its step.

**Source**: [Issue #32](https://github.com/hose1021/grimoria/issues/32); [Ravenkeeper r3125](https://wiki.bloodontheclocktower.com/index.php?title=Ravenkeeper&oldid=3125), [Slayer r3122](https://wiki.bloodontheclocktower.com/index.php?title=Slayer&oldid=3122) pinned rows in `docs/rules-matrix.md`; "Dead actors do not wake" row
**Tests**: `src/core/engine/invariants.test.ts`, `src/core/engine/engine.test.ts`

#### Scenario: Reusing a spent ability

- **WHEN** a Slayer uses the ability a second time in the same game
- **THEN** the command is rejected and the spent flag is unchanged

#### Scenario: New game restores abilities

- **WHEN** a new game starts
- **THEN** the spent flags are cleared

#### Scenario: Dead player before their wake

- **WHEN** a player dies before their night step
- **THEN** that step is skipped and the player does not wake

#### Scenario: Rule exception on death

- **WHEN** the Ravenkeeper is killed at night
- **THEN** its step is added with `actorAlive` false

### Requirement: Role-specific effect source ending

When an effect's source ends, the effect SHALL be removed or kept according to
that role's rule, not a general source-death assumption. The Poisoner's poison
and the Monk's protection end when the source dies; the Sweetheart's on-death
drunk stays active; a Philosopher-granted drunk ends when the Philosopher dies;
the Snake Charmer's poison is permanent and outlives its source.

**Source**: [Issue #32](https://github.com/hose1021/grimoria/issues/32); pinned `docs/rules-matrix.md` rows [Poisoner r1737](https://wiki.bloodontheclocktower.com/index.php?title=Poisoner&oldid=1737), [Monk r3124](https://wiki.bloodontheclocktower.com/index.php?title=Monk&oldid=3124), [Sweetheart r2704](https://wiki.bloodontheclocktower.com/index.php?title=Sweetheart&oldid=2704), [Philosopher r2421](https://wiki.bloodontheclocktower.com/index.php?title=Philosopher&oldid=2421), [Snake Charmer r2905](https://wiki.bloodontheclocktower.com/index.php?title=Snake_Charmer&oldid=2905); `docs/rules-sources.md` "Poison", "Monk" and Sects & Violets effect notes
**Tests**: `src/core/engine/invariants.test.ts`, `src/core/engine/commands.test.ts`

#### Scenario: Impairing source dies

- **WHEN** a poison or drunk effect's source dies
- **THEN** the effect stays active only for the roles whose rule says so

#### Scenario: Protection source dies

- **WHEN** the Monk dies before the protection ends
- **THEN** the protection is inactive

### Requirement: Final win waits for mandatory effects and Demon replacement

A final win SHALL NOT be declared while a mandatory immediate effect or a Demon
replacement is unresolved. A pending demon-inheritance SHALL block the win check,
and a winning death SHALL be recorded together with the win, not before it.

**Source**: [Issue #32](https://github.com/hose1021/grimoria/issues/32); pinned `docs/rules-matrix.md` rows [Imp r3116](https://wiki.bloodontheclocktower.com/index.php?title=Imp&oldid=3116), [Scarlet Woman r3117](https://wiki.bloodontheclocktower.com/index.php?title=Scarlet_Woman&oldid=3117); "Win order" row
**Tests**: `src/core/engine/invariants.test.ts`, `src/core/engine/engine.test.ts`

#### Scenario: Unresolved heir blocks the win

- **WHEN** the Imp self-kills while several Minions are eligible
- **THEN** no winner is declared and the heir choice is queued

#### Scenario: Winner while the heir is pending

- **WHEN** a state has a winner and a pending demon-inheritance step
- **THEN** `checkInvariants` rejects the state

#### Scenario: Winning death is applied with its record

- **WHEN** the Slayer kills the last Demon
- **THEN** the death is recorded and the good win is declared in the same state

### Requirement: Replay, undo and command idempotency

Replaying the recorded command and event journal SHALL reproduce the current
canonical state and the same domain events. Restoring the pre-command snapshot
and replaying the undone command SHALL stay consistent. Re-applying a command id
SHALL NOT record a second death or stack a second effect.

**Source**: [Issue #32](https://github.com/hose1021/grimoria/issues/32); [Issue #19](https://github.com/hose1021/grimoria/issues/19) "Инварианты"
**Tests**: `src/core/engine/invariants.test.ts`, `src/core/engine/commands.test.ts`, `src/application/store/create-game-store.test.ts`

#### Scenario: Journal replay

- **WHEN** the recorded commands are applied to the initial state with their pinned timestamps
- **THEN** the canonical state and the derived events equal the live ones

#### Scenario: Undo then replay

- **WHEN** the pre-command snapshot is restored and the undone command is applied again
- **THEN** the state equals the state before the undo

#### Scenario: Repeated command

- **WHEN** the same command id is applied twice
- **THEN** the second application is idempotent and no death or effect is duplicated

### Requirement: Command journal

Every accepted domain command SHALL be recorded in `state.journal` with its id,
type, payload, resolved timestamp, ruleset version, canonical fingerprint and
undo flag; a rejected command SHALL NOT be recorded.

**Source**: Issue #30; `SPEC.md` "State v4" (`applied`); `src/core/engine/AGENTS.md`
**Tests**: `src/core/engine/commands.test.ts`, `src/core/engine/invariants.test.ts`

#### Scenario: Accepted command

- **WHEN** a command changes the game
- **THEN** one journal entry carries its id, type, host payload, resolved timestamp, ruleset version and fingerprint

#### Scenario: Rejected command

- **WHEN** a command is rejected by validation, apply or an invariant check
- **THEN** no journal entry is added and the state is unchanged

### Requirement: Journal reset and coalescing

A reset command (`newGame`, `importGame` or a store reset) SHALL start a new
journal and SHALL NOT be recorded as an entry; the next recorded entry SHALL
establish the base. A record-only command (`setNotes`, `setReviewOpen`,
`normalizeSecrets`) SHALL be coalesced into one trailing entry of its type
instead of adding one entry per call.

**Source**: Issue #30; `SPEC.md` "State v4" (`applied`)
**Tests**: `src/core/engine/commands.test.ts`

#### Scenario: Reset command

- **WHEN** a reset command runs
- **THEN** the journal restarts with that state as its base and no entry

#### Scenario: Repeated record-only command

- **WHEN** a record-only command runs many times in a row
- **THEN** the calls stay one trailing entry of that type and replay to the same state

### Requirement: Deterministic replay

`replay(journal)` SHALL rebuild the saved state by applying the recorded entries
in order with their pinned timestamps and the seeded PRNG; the rebuilt value
SHALL compare equal to the saved state under `canonicalState`, SHALL keep the
journal in the recorded key position, and SHALL emit the same domain events; a repeated
command id SHALL NOT append a second entry, death or effect.

**Source**: Issue #30; `docs/rules-matrix.md` defect 5; [Issue #19](https://github.com/hose1021/grimoria/issues/19) "Definition of Done"
**Tests**: `src/core/engine/commands.test.ts`, `src/core/engine/invariants.test.ts`

#### Scenario: Replay equals the saved state

- **WHEN** a recorded journal is replayed
- **THEN** the rebuilt state equals the saved state under `canonicalState`, keeps the journal in the recorded key position, and emits the recorded domain events

#### Scenario: Repeated command id

- **WHEN** a command with an already recorded id and the same fingerprint is applied again
- **THEN** the result is `idempotent`, the journal keeps one entry, and no second death or effect is created

### Requirement: Journal-backed undo and redo

Undo SHALL remove the last undoable journal entry, replay the remaining entries
and persist the result; redo SHALL re-insert the removed entry and replay it; a
remaining entry that no longer applies SHALL stop the operation with
`journal-dependency` and leave the state unchanged.

**Source**: Issue #30; `SPEC.md` "State v4"
**Tests**: `src/application/store/create-game-store.test.ts`, `src/core/engine/commands.test.ts`

#### Scenario: Undo then replay

- **WHEN** the host undoes the last accepted command
- **THEN** the state equals the state before that command and redo restores it

#### Scenario: Dependent entry

- **WHEN** replaying the journal without an entry rejects another recorded entry
- **THEN** the operation returns `journal-dependency` naming that entry and the state is unchanged

### Requirement: Legacy save keeps its history

A save written before the journal SHALL load with an empty journal and its
existing narrative log and applied ledger intact, and the first accepted
command SHALL start a new base state.

**Source**: Issue #30; `SPEC.md` "State v4"
**Tests**: `src/application/store/create-game-store.test.ts`, `src/entry/store.test.ts`

#### Scenario: Old save

- **WHEN** a v4 save without `journal` is loaded
- **THEN** the store keeps `state.log` and `state.applied`, starts with an empty journal, and accepts a command

### Requirement: One host action starts a prepared game

The engine SHALL expose a `startGame` command that takes a game which has only
run setup into the first night in one validated action: it SHALL deal the
prepared bag (honouring an explicit assignment), SHALL seal the seat order,
SHALL fill only the setup secrets the engine can derive without a host decision,
and SHALL start night 1. A prepared bag that still needs a host-only secret (the
Drunk's false information) SHALL NOT start and SHALL be reported so the host
records it and retries.

**Source**: [Issue #46](https://github.com/hose1021/grimoria/issues/46), [Issue #19](https://github.com/hose1021/grimoria/issues/19); `AGENTS.md` "Do not auto-fill Storyteller choices"; [Drunk r3051](https://wiki.bloodontheclocktower.com/index.php?title=Drunk&oldid=3051)
**Tests**: `src/core/engine/acceptance.test.ts`, `src/core/engine/commands.test.ts`

#### Scenario: Start from a prepared bag

- **WHEN** a game has a legal bag and no dealt roles
- **THEN** `startGame` deals the roles, moves through `seat` and returns a night-1 queue

#### Scenario: Host-only false information

- **WHEN** the Drunk was shown an information role and its false pair is unset
- **THEN** `startGame` does not deal an answer and the start stays rejected until `setSetupInfo` records one

#### Scenario: Already started game

- **WHEN** `startGame` is applied to a night, day or finished game
- **THEN** it is rejected and the state is unchanged

### Requirement: Zero-step acceptance pipeline

A game created from the zero state SHALL reach a finale through the command
surface alone. Every applied command SHALL have validated as `allowed` first,
every target, false-information answer, redirect and Demon heir SHALL come from
the engine's declared options, and the journal SHALL explain every phase, every
completed or skipped night step, every nomination, vote and execution, and the
finale. The path SHALL NOT write the state directly or require a screen.

**Source**: [Issue #46](https://github.com/hose1021/grimoria/issues/46), [Issue #19](https://github.com/hose1021/grimoria/issues/19) "Definition of Done"
**Tests**: `src/core/engine/acceptance.test.ts`

#### Scenario: Fixed five-player finale

- **WHEN** a five-player Trouble Brewing bag is started and driven by legal commands
- **THEN** the game ends with a winner and the journal contains a setup, phase, night, nomination, vote, execution and winner entry

#### Scenario: Seeded sample

- **WHEN** the preset Trouble Brewing bags for player counts 5-15 are played with three seeds per count
- **THEN** every game ends with a winner and the same seed reproduces the same game

#### Scenario: No legal completion

- **WHEN** a night step has no legal completion for its declared target mode
- **THEN** the host skips it with the validated `skipStep` command and the journal records the skip

### Requirement: Host-choice contract

The engine SHALL name every discretionary Storyteller decision by one closed
case id, SHALL attach a Storyteller-facing reason to that case, and SHALL expose
the case list and reasons to the screens and the journal.

**Source**: Issue #42; `src/core/engine/AGENTS.md`
**Tests**: `src/core/engine/host-choice.test.ts`

#### Scenario: Case list

- **WHEN** a discretionary decision exists
- **THEN** its case id is in the closed list and the reason names the official
  discretion

### Requirement: Legal answer only

A discretionary information step SHALL accept only an answer that is one of the
offered options; any other answer SHALL be rejected and SHALL leave the step
incomplete.

**Source**: Issue #42; `docs/rules-matrix.md` `host-choice` rows
**Tests**: `src/core/engine/host-choice.test.ts`

#### Scenario: Illegal answer

- **WHEN** the host supplies an answer outside the offered options
- **THEN** the command is rejected with `error.66`, the options are returned and
  the step stays open

#### Scenario: Legal answer

- **WHEN** the host supplies one of the offered options
- **THEN** the step completes and one secret journal line records the case, the
  reason and the chosen value

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
