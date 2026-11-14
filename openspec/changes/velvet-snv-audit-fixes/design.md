# Design

## Context

Issue #171 section 3 records the Sects & Violets audit against
`docs/official/roles.json`, `docs/official/nightsheet.json` and the pinned wiki
pages listed in `docs/rules-sources.md`. The engine modules are DOM-free and
return the existing `{ ok, error }` / `{ ok: false, errors: [{ code, message }] }`
unions with Russian messages. Sects & Violets is host-adjudicated: the engine
owns setup, order, bookkeeping and the computable answers, the Storyteller makes
every choice the printed ability leaves open.

## Decisions

### The Vigormortis shift is a no-op when nothing can be removed (SV2)

Owner decision: official Vigormortis r3015 says "if there are no Outsider tokens
to remove, do not add a Townsfolk token". A seven-player bag therefore has five
Townsfolk, no Outsider and a legal Vigormortis. `compositionFor` applies the
shifts against the running Outsider count, so the Vigormortis removes a token
only when one exists after the other modifiers; `bagErrors` drops the
`vigormortis-minus` code, which becomes unreachable, and `randomBag` composes
its candidate through `compositionFor` so the two stay in agreement. The
Godfather's minus-one at a row with no Outsider stays an error, because that is
a host choice the printed setup note does not license.

### The Klutz chooses publicly at the death (SV4)

Official Klutz r1758: "When you learn that you died, publicly choose 1 alive
player: if they are evil, your team loses." The choice is not a night ability,
so the engine exposes `recordKlutzChoice(state, targetId)` next to the existing
`completeSvStep` path:

- the choice is valid only for a dead Klutz who has not chosen;
- the target must be alive **at the moment of the choice** — a target who died
  earlier is refused with a typed reason, which is what "choose 1 alive player"
  allows, and the host simply names another living player;
- an evil target loses the game immediately, a good target does not, and an
  impaired Klutz spends the ability and loses nothing;
- the queued death-triggered step, if one was already built, is completed with
  the recorded choice, so the night can still end. A choice recorded at the
  death stands even if its target dies before that step resolves.

The Klutz death wake keeps its place in the night queue as a bookkeeping step,
because a reloaded save must still show it; the public choice no longer waits
for it.

### A created Demon does not take the Demon turn (SV5)

Official Pit-Hag r2998: "If a Demon is made, deaths tonight are arbitrary."
`replaceCharacter` gains `suppressWake`, used only by the Pit-Hag path when the
new character is a Demon: the old character's queued step is skipped, and the
Demon slot is not added. The Pit-Hag step sets `canKill`, so the host records
the arbitrary deaths there. `recordSvOutcome` tags a death `demon: true` only
for a real Demon role step, so those deaths are ability deaths: the Sage does
not wake, the Soldier is not protected by its Demon-only clause and the Fang Gu
jump is not triggered. A Demon created by the Snake Charmer still wakes,
because the official Snake Charmer ruling lets the new Demon act in its slot —
that path does not pass `suppressWake`.

### Impairment makes computed information false (SV7)

Every Townsfolk information step now answers the same question with the same
shape: compute the true answer, then ask the host when the actor is impaired or
a living, unimpaired Vortox is in play. The Dreamer, Sage and Mathematician
join the Clockmaker, Oracle, Seamstress, Flowergirl, Town Crier and Juggler:
`impaired` is reported, `needsChoice` is `impaired || vortoxFalsifies(...)`, and
the note names the false-information requirement. The note kinds stay free-form
narration, so the host records any allowed false answer through the existing
`given` field and `validateGiven` gate.

### Retention is an ability, so impairment removes it (SV8)

Vigormortis r3015 keeps the dead Minion's ability, and a drunk or poisoned
character has no ability. `minionRetainsAbility` therefore requires the dead
Minion to be sober and healthy, and `reconcileVigormortisPoison` sets the
stored permanent neighbour poison active exactly while the Vigormortis lives,
the source is still a Minion and the source is not impaired. The poison's
`permanent` flag only means "outlives its dead source", not "ignores its
source's state", so the reconcile no longer treats it as unconditional.

### One table for death-triggered wakes (SV9)

The Barber, Sweetheart, Sage and Klutz wakes are the same four conditional
wakes whether the holder is the printed character or a Philosopher who borrowed
it. A single `DEATH_WAKE_SPECS` table holds their step specs; the printed
holders and the borrowed-ability loop both build their step from it, and a
borrowed character without a night-order slot is appended after the last step.

### "From now on" starts at the death (SV10)

Sweetheart r3016: "When you die, 1 player is drunk from now on." The stored
effect's `start` is the Sweetheart's death (`player.deadAt`), not the completion
time of its bookkeeping step. The effect graph reads `start`, so the drunk is
already in force for every step of the night in which the Sweetheart died.

### Juggler guesses are a list, not a map (SV11)

Juggler r3020: "On your 1st day, publicly guess up to 5 players' characters."
A player may be guessed more than once, so one guess per player id cannot
express the ability. `sv.ts` reads `state.juggler.guesses` as either the legacy
record or a list of `{ playerId, roleId }` pairs, counts each pair separately,
offers 0–5 as the answer range, wakes with zero guesses, and schedules the step
for the night after `state.juggler.day` — the Juggler's own first day, not day
one of the game. The command that records the guesses
(`jugglerGuess`, owned by the day module) must write the list form and stop
hardcoding day one; `types.ts` and `validateState` must accept the list, with
the record kept as the legacy import shape.

### The Pit-Hag no-op and the created Evil Twin (SV12, SV13)

"If that character is not in play" is a condition of the change, so choosing a
character already in play is a legal outcome: the step completes with the
`note.pithagInPlay` reason and the state is untouched. Creating an Evil Twin
sets the pair explicitly: the new twin becomes `setup.evilTwinPlayerId`, the
stored good twin is kept when it is still a living good player, and otherwise
the first living good player in seat order is used. That keeps both the
execution win and the "good can't win while both live" block, which the pair
lookup in `death.ts` otherwise drops.

### Shared modules still to change (SV1, SV6, SV3)

- SV1: `activeWitchCurse` in `day.ts` must stop requiring a living, unimpaired
  Witch — a placed curse resolves on the next nomination and only "just 3
  players live" removes it. `effectActive` in `effects.ts` must short-circuit
  `effect.kind === "witch"` like the Cerenovus token, so the effect graph's
  source rule does not drop it.
- SV6: `applyMadnessPenalty` must accept the night phase and
  `executeByDecision` must allow a madness execution at night and beside the
  day's execution.
- SV3: the engine already needs a mandatory host answer when no ended day with
  a vote ledger exists (`svInfoForStep` for the Flowergirl and Town Crier); the
  UI must render that yes/no control, because nominations and votes are run at
  the table.

## Risks

- The Klutz choice is now available in both phases; the console has no control
  for it yet, so a host who relies on the old night step still sees that step
  and its result.
- The Vigormortis clamp changes `randomBag`'s candidate choice at counts with no
  Outsider; the random bag and `bagErrors` are proven consistent by the
  existing every-count test.
- `jugglerGuess` still writes the legacy record until the day module changes,
  so repeated guesses are only reachable through a save written in the list
  form until then.

## Verification

`node --test src/core/engine/snv.test.ts` (102 cases),
`npx openspec validate --changes --strict`.
