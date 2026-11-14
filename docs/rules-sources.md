# Rules sources

Checked on 2026-11-10 for the Storyteller app, with all three scenarios
rechecked; the jinx snapshot was added on 2026-11-11. The app implements
Trouble Brewing, Bad Moon Rising and Sects & Violets. The role catalog and role
art come from the existing `assets/data` and `assets/img` files.

The audited ruleset, per-role source revisions, test references and current
implementation status live in [rules-matrix.md](rules-matrix.md). This document
explains the sources and the interpretations; it is not a normative
specification by itself. A role is claimed as automated only when its matrix
row is `verified`.

The pinned ruleset is the three core editions: the 22 Trouble Brewing, 25 Bad
Moon Rising and 25 Sects & Violets roles. Travellers, Fabled, Loric and
Carousel roles are outside the supported set. Jinxes whose two characters are
supported are pinned in `docs/official/jinxes.json` and applied only as a
Storyteller-resolved interaction.

## Primary sources

| Source | What it was used for |
|---|---|
| [Trouble Brewing](https://wiki.bloodontheclocktower.com/Trouble_Brewing) | Role list, team split, beginner guidance. |
| [Setup](https://wiki.bloodontheclocktower.com/Setup) | Player count, secret bag, Baron setup, Drunk, reminder tokens, 5–6 player notes. |
| [Rules Explanation](https://wiki.bloodontheclocktower.com/Rules_Explanation) | Opening speech, public/private talk, death, voting, one dead vote. |
| [Glossary](https://wiki.bloodontheclocktower.com/Glossary) | Exact meanings of alive, dead, execution, poison, drunk, register, neighbour, once per game, win. |
| [States](https://wiki.bloodontheclocktower.com/States) | Drunk and poison behaviour, timing, persistent effects, death ending effects. |
| [Imp](https://wiki.bloodontheclocktower.com/Imp) | Self-kill inheritance, new Imp does not act again that night. |
| [Scarlet Woman](https://wiki.bloodontheclocktower.com/Scarlet_Woman) | Five living immediately before the Demon dies; Travellers do not count. |
| [Mayor](https://wiki.bloodontheclocktower.com/Mayor) | Night redirection to dead, Soldier or Monk-protected targets; three-player win. |
| [Butler](https://wiki.bloodontheclocktower.com/Butler) | Count a vote that was actually cast; the player, not the Storyteller, enforces the master restriction. |
| [Fortune Teller](https://wiki.bloodontheclocktower.com/Fortune_Teller) | Self-selection and dead targets are allowed; the red herring is permanent. |
| [Official resources](https://release.botc.app/resources/) | Canonical app data. |
| [`nightsheet.json`](https://release.botc.app/resources/data/nightsheet.json) | First-night and other-night order. Local snapshot: `docs/official/nightsheet.json`. |
| [`roles.json`](https://release.botc.app/resources/data/roles.json) | Role metadata reference. Local snapshot: `docs/official/roles.json`. |
| [`jinxes.json`](https://release.botc.app/resources/data/jinxes.json) | Official jinx pairs. Local snapshot: `docs/official/jinxes.json`, committed 2026-11-11. |
| [Pocket Grimoire](https://www.pocketgrimoire.co.uk/ru_RU/) | Feature reference only; never used as a rules authority. |

## Night order used by the app

The app follows the official app's `nightsheet.json` order. That order places
the Spy at the end so the Spy sees the final state of the grimoire.

First night: Minion info (7+), Demon info (7+), Poisoner, Washerwoman,
Librarian, Investigator, Chef, Empath, Fortune Teller, Butler, Spy.

Other nights: Poisoner, Monk, Scarlet Woman (passive), Imp, Ravenkeeper, Empath,
Fortune Teller, Undertaker, Butler, Spy.

The Scarlet Woman is not a normal wake. The app resolves her inheritance at the
moment the Demon dies and then inserts a short "Demon changed" confirmation
step. The Ravenkeeper step is inserted only if the Ravenkeeper died that night.
The Undertaker step is inserted only if an execution death happened today.

## Setup and composition

Base counts are the official table:

| Players | Townsfolk | Outsiders | Minions | Demon |
|---:|---:|---:|---:|---:|
| 5 | 3 | 0 | 1 | 1 |
| 6 | 3 | 1 | 1 | 1 |
| 7 | 5 | 0 | 1 | 1 |
| 8 | 5 | 1 | 1 | 1 |
| 9 | 5 | 2 | 1 | 1 |
| 10 | 7 | 0 | 2 | 1 |
| 11 | 7 | 1 | 2 | 1 |
| 12 | 7 | 2 | 2 | 1 |
| 13 | 9 | 0 | 3 | 1 |
| 14 | 9 | 1 | 3 | 1 |
| 15 | 9 | 2 | 3 | 1 |

Baron changes the bag by two: two Townsfolk become two Outsiders. The app
supports the resulting low-Townsfolk compositions, including 1 Townsfolk and
2 Outsiders at five players, but labels random bags as "legal", not "balanced".
Godfather, Fang Gu and Vigormortis shifts are applied the same way. A manual
pool may mix editions; mixed games run in manual-only Storyteller mode, without
automatic role or win resolution.

## Interpretations that matter in code

1. **5–6 players.** There is no Minion info and no Demon info. The Demon gets no
   three bluffs. Real abilities still work, including the Spy seeing the
   grimoire. The app does not show the "evil team introduction" steps.
2. **Bluffs.** Three distinct good roles not in play. The Drunk's shown role is
   excluded: giving it to the Demon would leak the Drunk mask. Outsiders are
   allowed as bluffs; the UI prefers Townsfolk only as a convention.
3. **Drunk.** `roleId` is always `drunk`; `shownRoleId` is a Townsfolk not in
   play. The player sees only the shown role. The night step follows the shown
   role, but the ability never works. The host may give false information.
4. **Poison.** A Poisoner target is poisoned for that night and the next day.
   The effect ends at the next dusk, when the Poisoner loses the ability, when
   the Poisoner dies, or when the Poisoner becomes the Demon (there is then no
   Poisoner in play). The app stores source, target, start and expiry, and
   checks the source's live and sober state dynamically.
5. **Monk.** The Monk cannot choose themself. Protection lasts tonight and ends
   at dawn or when the Monk loses the ability or dies. It stops the Demon, not
   executions.
6. **Soldier.** Safe from the Demon's attack while healthy. Poison or drunk
   removes the protection.
7. **Mayor.** A night attack on the healthy Mayor lets the host let the Mayor
   die, or make another player die instead. The replacement may be any other
   player, alive or dead. A dead replacement, a healthy Soldier, or a
   Monk-protected replacement causes no death tonight, and the Mayor remains
   alive. The host is asked only when the Mayor would actually die: a poisoned
   or drunk Mayor has no ability and dies normally, and the Poisoner's poison
   is not an attack, so choosing the Mayor as a poison target never offers a
   redirection. The Mayor wins for good at the end of a day with exactly three
   living players and **no execution event**, even if an execution was
   attempted and nobody died. If a real execution happened, the Mayor does not
   win by this ability.
8. **Saint.** If the Saint dies by execution while the ability works, evil wins.
   Poison or drunk at the moment of execution prevents the loss.
9. **Scarlet Woman.** Living players immediately before the Demon dies must be
   at least five. Travellers do not count. The new Demon does not act again in
   the same night. With fewer than five, the Imp's own self-kill can still pass
   the role to a living Minion; a host choice is required when several Minions
   are eligible.
10. **Virgin.** The trigger is the first nomination of the Virgin. If the
    nominator registers as a Townsfolk, the nominator is executed immediately
    and the day ends. A Drunk, Recluse or Spy (unless the host chooses the Spy
    Townsfolk registration) does not trigger it. The first nomination spends the
    ability even when it does not trigger or the Virgin is impaired.
11. **Slayer.** Once per game, during the day, publicly choose a player. A hit on
    the Demon is a death, not an execution. Using the ability while poisoned or
    drunk spends it and does nothing.
12. **Ravenkeeper.** Wakes only if they died this night. The host shows a
    character. A Spy or Recluse target allows the host to choose a permitted
    registration. If the Ravenkeeper was impaired, the host chooses false
    information.
13. **Undertaker.** Learns the character of a player who died by execution today.
    No execution, or an execution of an already dead player, gives no
    information. A Slayer death is not an execution.
14. **Spy and Recluse.** Registration is a host decision, not a random result.
    The app exposes the allowed variants: Spy may register good and as a
    Townsfolk/Outsider; Recluse may register evil and as a Minion/Demon.
15. **Fortune Teller.** The red herring is permanent. Dead players may be
    chosen, the Fortune Teller may choose themself as one of the two targets,
    and the red herring may be the Fortune Teller themself. The app does not
    restrict any of these choices.
16. **Butler.** The Butler may vote only when the chosen master also votes.
    If the Butler casts a vote illegally, the app counts it and records a
    private host warning, matching the official Storyteller guidance; the
    player, not the Storyteller, is responsible for following the restriction.
    The execution threshold is at least half of the living players:
    `ceil(living / 2)`. Dead votes count toward the tally, not toward the living
    count. It never announces the Butler's role to the table.
17. **Baron.** Changes setup only. Death does not change the composition.
18. **Killed before the wake.** A player killed during the night is skipped
    if their wake is later in the order. The Ravenkeeper is the exception: the
    Ravenkeeper step is inserted after the death. If a Minion becomes the Demon
    mid-night, their old role step (for example, the Spy's grimoire step) is
    skipped.
19. **Spy grimoire.** The host console has a separate full-screen grimoire
    view for the Spy. It shows real roles, reminders and effects, but no notes
    or Demon bluffs. If the Spy is impaired, the host may show a false picture;
    the app does not pretend to generate one.
20. **Win order.** The app applies the official end conditions and the ability
    conditions in this order:
    1. A pending Demon change and an active Mastermind extra day suspend the
       check until they resolve.
    2. The execution of the good Evil Twin wins for evil.
    3. A day that ends with no execution while a living, unimpaired Vortox is
       in play wins for evil.
    4. The execution of the Demon with a living, unimpaired Mastermind in play
       starts one more day instead of ending the game.
    5. The execution of an unimpaired Saint wins for evil.
    6. An unimpaired Mayor wins for good at the end of a day with exactly three
       living players and no execution event.
    7. No living Demon wins for good, unless both Evil Twins live.
    8. Two or fewer living players win for evil.
    The base rules are "no living Demon" and "two or fewer living players";
    the ability conditions replace them. A Klutz who publicly chooses a player
    on the opposing team ends the game at that moment with the `klutz` reason.
    A dead Demon token alone never ends the game before inheritance is
    resolved.

## Known limitations

- Trouble Brewing, Bad Moon Rising and Sects & Violets rules are implemented.
  An imported custom script must use one edition: all Trouble Brewing, all Bad
  Moon Rising or all Sects & Violets. A manual pool may mix editions, but a
  mixed pool is accepted only in explicit manual-only mode, without automatic
  role or win resolution.
- Bad Moon Rising and Sects & Violets are host-adjudicated in part. The engine
  tracks the Pukka's poison and delayed death, the Goon's trigger and alignment,
  the Lunatic's mask and Demon report, and the Cerenovus and Mutant madness
  tokens and penalty, but not every ability; automated effects and information
  can differ from the true game state, so the host must verify them manually.
  The night/day cards and the scenario secrets screens show a visible warning
  and every audited role's support status.
- Custom scripts can be imported from a JSON file, a URL or the clipboard. URL
  import depends on the host allowing CORS; the app is otherwise offline-first.
- Travellers and Fabled are not part of the setup flow, although the role
  catalog still contains them. An imported script may list Travellers; the
  parser collects and ignores them for the deal. The script still needs five
  standard roles and all required teams.
- Every supported character carries one of three support levels from the audit
  table: `verified`, `requires-storyteller-choice` or `unsupported`. A role with
  an official host choice or an unverified implementation is never reported as
  `verified`. The README, the rules matrix and the `/bag` and `/secrets` screens
  report the same counts, and `scripts/check-acceptance.mjs` fails when they
  diverge or a `verified` row loses its passing test.
- The seven official jinx pairs whose two characters are supported are pinned
  in the versioned table taken from `docs/official/jinxes.json` (committed
  2026-11-11). The table stores the official reason and a snapshot source; the
  engine lists the pair and leaves the interaction to the Storyteller. All
  seven pairs cross editions, so they can appear only in a mixed manual pool.
- Known implementation defects are recorded in
  [rules-matrix.md](rules-matrix.md). A role is not automated merely because
  its name appears in a script.
- The app is a local, one-device Storyteller aid. There is no network play and
  no authentication. It is not a security boundary against a player with
  DevTools access to the same browser profile.
- Registration choices are explicit host controls. The app does not invent a
  registration, nor does it try every combination automatically.
- False information is chosen by the host. The app computes the standard result
  and offers allowed alternatives; it does not claim that every alternative is
  equally likely or strategically right.
- Random legal bags are not advertised as balanced. Curated suggested bags
  exist for every count from 5 to 15 in all three official scenarios, and a
  custom pool generates up to three deterministic suggestions per count. Legal
  does not mean balanced.
- Live UI catalogs, role guides and help support en/ru/az. Existing narrative
  log records and some teaching-demo narrative retain their original text.
- The Storyteller console records the final execution and the Virgin’s first
  nomination. Ordinary nominations and
  votes are run at the table; the engine keeps vote bookkeeping for tests and
  compatibility, but it is not exposed as a UI ledger.
- Players enter their own names after the deal. New games start with blank
  names; the seat rail uses a placeholder until a name is entered.
- The red herring and all one-of-two pairs are chosen by the host in `/secrets`.
  The production screen does not auto-fill them. Bluffs and the Drunk mask are
  shown as role tokens with names under them. The 10- and 12-player teaching
  sets use Soldier, Virgin and Ravenkeeper as Demon bluffs.
- Export files contain all secrets. The UI warns before export and before
  importing a replacement game.
- The demonstration game is separate from the real saved game and uses the same
  domain functions, but it is a scripted teaching example, not a second engine.


## Bad Moon Rising

Checked on 2026-11-10; per-role revisions are pinned in
[rules-matrix.md](rules-matrix.md).

| Source | What it was used for |
|---|---|
| [Bad Moon Rising](https://wiki.bloodontheclocktower.com/Bad_Moon_Rising) | Script roster, teams, setup notes. |
| [Godfather](https://wiki.bloodontheclocktower.com/Godfather) | +1 or -1 Outsider setup; which Outsider died. |
| [Lunatic](https://wiki.bloodontheclocktower.com/Lunatic) | Demon token shown to the Lunatic; Demon kills. |
| [Mastermind](https://wiki.bloodontheclocktower.com/Mastermind) | One extra day after a Demon execution; the executed player's team loses. |
| [Zombuul](https://wiki.bloodontheclocktower.com/Zombuul) | First death is replaced; registers as dead. |
| [Fool](https://wiki.bloodontheclocktower.com/Fool), [Sailor](https://wiki.bloodontheclocktower.com/Sailor), [Tea Lady](https://wiki.bloodontheclocktower.com/Tea_Lady), [Innkeeper](https://wiki.bloodontheclocktower.com/Innkeeper), [Devil's Advocate](https://wiki.bloodontheclocktower.com/Devil%27s_Advocate), [Assassin](https://wiki.bloodontheclocktower.com/Assassin) | Death prevention, protection and bypass ordering. |
| [Po](https://wiki.bloodontheclocktower.com/Po), [Shabaloth](https://wiki.bloodontheclocktower.com/Shabaloth), [Professor](https://wiki.bloodontheclocktower.com/Professor) | Three-target attacks, resurrection, once-per-game flags. |
| [Gossip](https://wiki.bloodontheclocktower.com/Gossip), [Moonchild](https://wiki.bloodontheclocktower.com/Moonchild), [Grandmother](https://wiki.bloodontheclocktower.com/Grandmother), [Chambermaid](https://wiki.bloodontheclocktower.com/Chambermaid) | Conditional wakes and information. |
| [BMR night sheet](https://release.botc.app/resources/data/nightsheet.json) | First-night and other-night order. Local snapshot: `docs/official/nightsheet.json`. |
| [`roles.json`](https://release.botc.app/resources/data/roles.json) | Role metadata and reminder text. Local snapshot: `docs/official/roles.json`. |

### Implementation model

Bad Moon Rising is **host-adjudicated**. The engine owns setup, the official
night order, target ranges, conditional wakes, death/resurrection bookkeeping,
the deterministic protection order, the Minstrel drunk trigger and the
Mastermind extra day. The Storyteller resolves each printed ability and records
deaths and resurrections in the night card's outcome panel.

- Setup: the Godfather shifts the Outsider count by +1 or -1; -1 is rejected
  when the base composition has no Outsider. The Lunatic is shown one Demon
  from the script, stored as `setup.lunaticShownId`; the real Demon knows the
  Lunatic, not the reverse. A missing, non-Demon or out-of-script mask is
  rejected with a reason, and the mask never appears as a Demon bluff or in the
  public view. Bluffs also exclude the Drunk mask.
- First night: combined Minion/Demon information at the official position,
  then Lunatic, Sailor, Courtier, Godfather, Devil's Advocate, Pukka,
  Grandmother, Chambermaid. The Lunatic sees only its false Demon token.
- Other nights: Sailor, Courtier, Innkeeper, Gambler, Devil's Advocate,
  Lunatic, Exorcist, Zombuul, Pukka, Shabaloth, Po, Assassin, Godfather,
  Gossip, Professor, Tinker, Moonchild, Grandmother, Chambermaid.
- Conditional wakes: Zombuul only if nobody died today; Godfather only after an
  Outsider died; Gossip only after a true statement; Professor and Assassin
  once per game; Grandmother after the Demon kills the grandchild; Moonchild
  after its death and choice; Exorcist skips the chosen Demon's wake.
- Protections: Assassin bypasses Fool, Soldier, Sailor, Tea Lady, Innkeeper and
  Devil's Advocate; Zombuul's first death is replaced even by the Assassin.
  The Devil's Advocate protects against the next day's execution. The Tea Lady
  and Innkeeper protections resolve before the Fool, so the Fool's first death
  is prevented and spends the ability only when the Fool was the reason. The
  Zombuul stays alive but registers as dead, and a Death entry is recorded for
  that day so it does not wake. The Tea Lady protects both neighbours while both
  are good; the Innkeeper protects its two targets for the night; the Sailor
  cannot die while sober and healthy from any cause, including an execution.
- The Minstrel makes every other living player drunk until dusk tomorrow when
  a Minion dies by execution.
- The Mastermind triggers when the Demon dies by execution: the game gets one
  more day instead of ending. If the extra day ends with an execution, that
  player's team loses; otherwise good wins.
- The Goon's first chooser each night becomes drunk immediately, so their
  ability does not work that night or the next day, and the Goon takes their
  alignment until the next dusk. A later chooser changes nothing; a drunk or
  poisoned Goon grants nothing; a chooser who was already drunk or poisoned
  still triggers. The Lunatic's simulated choice and the Grandmother's
  Storyteller-chosen grandchild are not ability choices, so neither triggers the
  Goon. Two printed exceptions remain: the Assassin kills the Goon, which still
  turns evil, and the Moonchild's already-made choice still resolves at its
  bookkeeping wake even though the Goon makes the Moonchild drunk.
- The Lunatic is good and sees the stored Demon. The night-one Demon
  information and every Demon role step name the Lunatic and their last choice.

### Known limits in this release

- Pukka poison and its delayed death are engine effects: the target is poisoned
  immediately, dies at the next Pukka step (or an Exorcist skip), and becomes
  healthy. A drunk or poisoned Pukka suspends both parts until sober; a dead
  Pukka cancels them. Innkeeper and Tea Lady protection prevent the death and
  clear the poison. Death abilities that resolve while the victim is still
  poisoned are left to the Storyteller, and the BMR cards carry a visible
  warning.
- Pukka self-target follows the documented Pukka × Pukka interaction
  ([botc.me](https://botc.me/interaction/pukka/pukka), owner decision on PR
  #24): the Pukka poisons itself, the previous victim becomes healthy and its
  death stays suspended, a healthy Pukka resolves that death immediately, and
  a healthy Pukka that chooses again dies as the previous target after the new
  poison.
- Poison and drunk effects resolve in one dependency graph, independent of the
  order of `state.effects`. An effect is inactive before its `start` and at or
  after its `expires`; a living source that is poisoned or drunk loses its
  effect; a dead-source on-death drunk effect stays active. A later poison can
  suspend an earlier Pukka poison, so a Pukka remains suspended while any other
  poison or drunk effect targets it and resumes only after the last impairment
  ends. A genuinely unresolvable cycle returns `CYCLIC_EFFECT_DEPENDENCY` from
  command validation, preview, apply and import instead of guessing a rule or
  overflowing the stack.
- At six players the Demon information step is not built (no bluffs). A Demon
  without a first-night role step, such as the Po, has no automatic place to
  learn the Lunatic on night one; the host tells the Demon. Every Demon role
  step from night two onward reports the Lunatic and their choice.
- The Courtier's three-night drunk window and the Sailor's drunk recipient are
  engine effects stored by the role step and expire at their printed time.
- The Zombuul's registered-dead state is shown on the table and public screen,
  but the app does not hide its role from Storyteller-only projections.
- An imported custom script uses a single edition; a mixed manual pool runs
  only in explicit manual-only mode. There is no Bad Moon Rising demo or
  teaching set yet.


## Sects & Violets

Checked on 2026-11-10; per-role revisions are pinned in
[rules-matrix.md](rules-matrix.md).

| Source | What it was used for |
|---|---|
| [Sects & Violets](https://wiki.bloodontheclocktower.com/Sects_%26_Violets) | Script roster, teams, setup notes. |
| [Evil Twin](https://wiki.bloodontheclocktower.com/Evil_Twin) | Good Twin setup, execution win, "while both alive good cannot win". |
| [Vortox](https://wiki.bloodontheclocktower.com/Vortox) | False information and the no-execution evil win. |
| [Witch](https://wiki.bloodontheclocktower.com/Witch) | Curse on the next nomination; ability lost at three living. |
| [Fang Gu](https://wiki.bloodontheclocktower.com/Fang_Gu) | +1 Outsider composition and once-per-game first-Outsider succession. |
| [Vigormortis](https://wiki.bloodontheclocktower.com/Vigormortis) | -1 Outsider composition and minion behaviour. |
| [No Dashii](https://wiki.bloodontheclocktower.com/No_Dashii) | Nearest Townsfolk neighbours poisoned. |
| [Sweetheart](https://wiki.bloodontheclocktower.com/Sweetheart) | Drunk on death. |
| [Clockmaker](https://wiki.bloodontheclocktower.com/Clockmaker), [Oracle](https://wiki.bloodontheclocktower.com/Oracle), [Seamstress](https://wiki.bloodontheclocktower.com/Seamstress) | Information calculations. |
| [S&V night sheet](https://release.botc.app/resources/data/nightsheet.json) | First-night and other-night order. Local snapshot: `docs/official/nightsheet.json`. |
| [`roles.json`](https://release.botc.app/resources/data/roles.json) | Role metadata and reminder text. Local snapshot: `docs/official/roles.json`. |

### Implementation model

Sects & Violets is **host-adjudicated**. The engine owns setup, the official
night order, target ranges, death bookkeeping, Fang Gu succession, No Dashii
poison, the Vigormortis minion behaviour, the Vortox/Evil Twin/Klutz wins, the
Witch curse (lost at three living) and the computable information answers. The
Storyteller resolves madness, the false information itself, Poisoner-style
effects and the remaining printed abilities; the engine applies the Pit-Hag,
Barber, Snake Charmer and Philosopher character changes atomically.

- Setup: the Evil Twin's good twin is a role selected in the bag and resolved to
  its player after dealing. Fang Gu adds one Outsider and Vigormortis removes
  one; the impossible -1 at a composition with no Outsider is rejected.
- First night: Minion/Demon information at the official position, then
  Philosopher, Snake Charmer, Evil Twin, Witch, Cerenovus, Clockmaker, Dreamer,
  Seamstress, Mathematician.
- Other nights: Philosopher, Snake Charmer, Witch, Cerenovus, Pit-Hag, Fang Gu,
  No Dashii, Vortox, Vigormortis, Barber, Sweetheart, Sage, Dreamer,
  Flowergirl, Town Crier, Oracle, Seamstress, Juggler, Mathematician.
- Automatic effects/wins: No Dashii poison (nearest Townsfolk by role,
  regardless of death; reconciled when the source or the neighbourhood changes),
  the Vigormortis minion retention and its neighbour poison (a dead Minion
  killed by the Vigormortis keeps its step while the Demon lives and unimpaired;
  one nearest Townsfolk neighbour is poisoned, with a host override),
  Fang Gu once-per-game first-Outsider succession, Sweetheart drunk, Evil Twin
  execution win, Vortox no-execution win, the Klutz team loss when the public
  choice is on the opposing team, the Witch curse on the next
  nomination (the Witch loses the ability when only three players live), and
  the Pit-Hag, Barber, Snake Charmer and Philosopher character changes. The
  Philosopher's drunk follows the chosen character and ends when the Philosopher
  dies or is impaired.
- Computed information: Oracle (dead evil players), Seamstress (same
  alignment of two distinct players other than herself), Flowergirl (a Demon
  voted in the ended day), Town Crier (a Minion nominated in the ended day),
  Juggler (first-day guesses counted against the players' characters) and
  Clockmaker. When the actor is impaired or a living, unimpaired Vortox is in
  play, the step requires a host-supplied answer instead of the computed one.
- Storyteller-run: madness (Cerenovus/Mutant), the false information itself,
  Artist, Savant, the Mathematician count, the Dreamer character pair, and the
  Sweetheart and Klutz choices.

### Known limits in this release

- Madness and the Storyteller's false information are host-managed. The app
  carries the host-mode warning on the bag, secrets, night and day cards.
- The Evil Twin pair is resolved to player ids at the deal and stays the two
  stored players regardless of which character each holds, so the Barber may
  swap the two twins. The win reads the good twin's real alignment; the ability
  holder is the current holder of the `eviltwin` character (either pair member)
  and must be alive and unimpaired, with the execution resolved before its own
  death. A dead Evil Twin, or one whose character left play, stops both the
  execution win and the "good cannot win" block. An imported legacy save
  backfills the pair once from the roles.
- A character change recalculates the current night by official position: a new
  character whose wake slot has already passed does not act again that night.
  The Pit-Hag changes the character but not the alignment; the Barber swaps
  characters and keeps both alignments; the Snake Charmer swaps both characters
  and alignments and leaves the new Snake Charmer poisoned permanently, even
  after the new Demon dies or is impaired. It cannot choose a dead player. The
  No Dashii poison reconcile ignores a permanent poison even when its source is
  now the No Dashii.
- There is no Sects & Violets demo or teaching set yet.
