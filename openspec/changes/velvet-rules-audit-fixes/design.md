# Design

## Registration is an ability

Registration is the Spy's and the Recluse's ability, so an impaired registrant
has no registration (States r1039). The gate lives in both directions:

- `information.ts` reads the override only through one `registrationApplies`
  check, which runs `isImpaired` for the registrant. This covers the Chef,
  Empath, Fortune Teller, Washerwoman/Librarian/Investigator character choices,
  and the Undertaker and Ravenkeeper character answers.
- `host-choice.ts` (`registrationError`) rejects a registration recorded for an
  impaired player with `error.67` before the step mutates.
- The two day reads that take a registration option, the Virgin's Spy
  registration and the Slayer's Recluse registration, check the registrant with
  `isImpaired` at the day time.

No new option or command is introduced: the same payload becomes illegal while
the registrant is impaired.

## The new Demon ends the effects it sourced

`becomeDemon` already rewrites the role and skips the old role's remaining
steps. It now also sets `active = false` on every effect whose `sourceId` is the
new Demon. In Trouble Brewing the only persistent effect a Minion sources is
the Poisoner's poison (Poisoner r1737: "there is no Poisoner in play"), so
deactivating all sourced effects matches the ability ending. A source that
never holds a step effect (Scarlet Woman) is unaffected.

## The Mayor redirect is not a self-kill

`resolveAttack` computed `selfKill` from the final victim id, so a redirect onto
the Imp recorded `imp-self-kill` and passed the role to a living Minion even
below five living players. The self-kill is now `!redirected && victim ===
attacker`: only the Imp choosing itself passes the role. The redirected death
uses the normal `demon` cause.

## Execution events are execution deaths

The day records two different things: the host's execution selection
(`state.day.execution`) and the death that selection produced. The Mayor
(r2995) and the Vortox need an execution that happened, and a corpse selection
is not an execution at all (AS21). `executeByDecision` rejects a non-living
target, and the end-of-day check uses `executionDeathForDay` instead of the
presence of `state.day.execution`. `endDay` also runs that check when the day
was already closed by an execution, so a prevented execution still allows the
three-living Mayor win, as `docs/rules-sources.md` item 7 states.

The Saint check is scoped the same way: the death must be an execution death on
the current day, so a cleared winner cannot re-fire from an older day.

## Zombuul replaced death

The Zombuul's first death is replaced, not prevented (r3022). `kill` now records
an ordinary `Death` entry with a `zombuul` marker, `cause` and the day number,
while the player stays `alive` and `registeredDead`. `anyoneDiedToday` in
`bmr.ts` filters only `fake` deaths, so the entry keeps the Zombuul from waking,
and the Undertaker can learn the registered character. The log line keeps
`consequence: "prevented"` because nobody actually died.

## Fool ordering

`bmrCannotDie` is an ordered chain. The Fool's protection is checked after the
Tea Lady and Innkeeper protections, so `kill` sets `used.fool` only when the
Fool's ability was the reason. The Assassin's bypass still returns before the
Fool.

## Sailor

The Sailor's "You can't die." (r1768) is unconditional while sober; the earlier
`cause === "demon" || cause === "ability"` guard let an execution kill it. Only
`bypassProtection` (the Assassin) now reaches the death path.

## Target legality in the engine

`completeStep` now rejects the printed BMR restrictions with existing codes:
`error.55` for a dead target and `error.40` for a self-target. The ring keeps
its disabled seats as a hint; the engine is the authority. `registeredDead`
counts as dead for these checks so a registered-dead Zombuul cannot be the
Devil's Advocate's target.

## Phase guard

`startNight` rejects the day phase with `error.68` before rebuilding the queue,
so a stale tab cannot turn an active day into a night. `error.68` needs a
locale entry; the screens already fall back to the engine message.
