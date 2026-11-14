# Static app spec (GitHub Pages)

One static Storyteller app for Trouble Brewing, Bad Moon Rising and Sects &
Violets. TypeScript and React in `src/`, built by Vite into `dist/`. No
backend, state in `localStorage`. The app is a local one-device aid. It is not
a security boundary against a player with DevTools access to the same browser
profile.

## Runtime

- `index.html` is the Vite entry: it loads the boot catalog through
  `%BASE_URL%`, then `src/entry/main.ts` as a module. The language switch loads
  `en_GB` or `az_AZ` through `src/infrastructure/catalog/role-catalog.ts`. Vite
  bundles the modules and fingerprints the CSS.
- `src/ui/` is the React shell. `/sheet` is native; every other route renders
  through `legacy-bridge.tsx`. Tailwind CSS v4 ships through
  `@tailwindcss/vite` without Preflight, and the one `@theme` block in
  `css/app.css` is the only token source.
- `window.PG.roles` is the catalog. Static assets (`assets/`, `favicon.svg`,
  `manifest.webmanifest`, `.nojekyll`) live in `public/` and are copied
  verbatim into `dist/`.
- The base path is one normalized `BASE_PATH`: it feeds Vite, the router root,
  the generated `404.html` and the worker registration.
- Routes are paths: `/bag`, `/seat`, `/secrets`, `/table`, `/player`,
  `/public`, `/help`, `/demo`, `/sheet` and `/sheet/{ru,en,az}`. Default
  route is `/table`.
- `/table` is the Storyteller console. `/player` and `/public` are
  player-facing and must never render full grimoire state.

## Modules

| File | Responsibility |
|---|---|
| `src/core/` | command contracts, prepare/adopt, validated state, typed events, core ports |
| `src/application/` | store factory, application ports, legacy command adapter, read models |
| `src/infrastructure/` | browser storage, platform, preferences |
| `src/ui/` | React shell, router store, legacy bridge, shared components, native screens, Tailwind entry and tokens |
| `src/entry/` | composition root: store facade, locale boot, offline registration and the two DOM screens |
| `src/application/dispatch/adopt.ts` | the one conversion point from the engine result union to the typed store result |
| `src/core/model/state.ts` | schema v4, script metadata, player defaults, public projection, migration, import/export validation |
| `src/core/model/scripts.ts` | official script catalog, BotC script JSON parsing and validation |
| `src/core/model/rules.ts` | Trouble Brewing, Bad Moon Rising and Sects & Violets composition, bag validation, recommended sets, night order, labels |
| `src/core/engine/index.ts` | stable API for `engine/` domain modules: deal, night, BMR/S&V queues and outcomes, effects, information, day, host execution, win, corrections |
| `src/core/engine/commands.ts` | one command registry: Validate, Preview, Apply, invariants, idempotency ledger and domain-event diff |
| `src/entry/store.ts` | browser composition root and facade over `createGameStore`: live state, dispatch, undo, import/export |
| `src/ui/screens/bag.tsx` | setup screen: scenario picker, count, legal bag, bluffs, Drunk mask |
| `src/ui/screens/seat.tsx` | seat order and swaps |
| `src/ui/screens/secrets.tsx` | red herring, one-of-two pairs, reminder checklist |
| `src/ui/screens/table/` | host table: seat ring and hub, fixed dock, dawn report, player card, night/day decisions, win, review |
| `src/ui/screens/player.tsx` | safe handoff with a public-only role projection |
| `src/ui/screens/public.tsx` | public screen with no roles, bluffs, notes or effects |
| `src/entry/screens/help.ts` | compact rules and all-role reference |
| `src/entry/screens/demo.ts` | separate scripted 10-player teaching game |
| `src/ui/screens/sheet.tsx` | all-role sheet in Russian, English and Azerbaijani; read-only |
| `src/ui/store/use-game.ts` | one subscription over the cached store snapshot |
| `src/ui/legacy-bridge.tsx` | mounts an unmigrated screen and disposes it on navigation |
| `src/ui/i18n/strings.ts` | keyed en/ru/az UI catalogs in `src/ui/i18n/locales/`; role names come from the role catalog |
| `src/ui/i18n/translate.ts` | existing text translator and language switch |

No screen reads or writes `localStorage` directly. Screens mutate the singleton
through engine functions, then call `save()`/`run()` from `src/entry/store.ts`.

## State v4

Key: `pg.game.v4`. Legacy `pg.game.v3` and `pg.game.v2` are migrated on load. A
corrupt value is kept under `pg.game.broken.<timestamp>` and the UI reports the
problem.

```js
{
  v: 4,
  scriptId: "tb",
  script: { id, name, edition: "tb" | "custom", source, author, roles: [roleId] },
  phase: "setup" | "deal" | "seat" | "night" | "day" | "over",
  setup: {
    count, roles: [roleId], bluffs: [roleId], drunkShownId, herringId,
    lunaticShownId, godfatherOutsider, grandmotherId, evilTwinGoodId,
    info: { washerwoman, librarian, investigator }, ready
  },
  order: ["1", "2"],
  players: {
    "1": {
      id, seat, name, roleId, shownRoleId, team, alive, claimed,
      reminders: [], used: {}, voteToken, butlerMasterId,
      changedFrom, deadAt, registeredDead, notes
    }
  },
  bluffs: [roleId],
  herringId,
  night: { number, queue: [step], currentIndex, demonChanged },
  day: {
    number, morning: [death], nominations: [],
    activeNominationId, execution, ended, open
  },
  deaths: [], executions: [], effects: [], corrections: [],
  gossip, mastermind,
  log: [], notes, winner, reviewOpen, publicRevealed, applied, journal
}
```

`applied` is the idempotency ledger: command id mapped to `{ type, at,
rulesetVersion, fingerprint, followUp, undoable }`. A repeated command id is a
no-op only when its type, payload and ruleset version match the fingerprint; a
different payload or version with the same id is rejected.

`journal` is the deterministic command history: one base state plus the ordered
accepted commands, each with its id, type, host payload, resolved `at`, ruleset
version, fingerprint and undo flag. `replay(journal)` rebuilds the state with
the pinned clock and the seeded PRNG; undo and redo replay the journal. A
rejected command is never recorded, and a repeated id appends no entry. The
narrative console feed stays in `log`, not in the journal.

An effect records `kind`, `sourceId`, `targetId`, `start`, `expires` and
`active`. A night step records its stable key, role or system kind, actor,
target mode, targets, registrations, computed/given information, completion
state and optional pending Demon-heir choice.

## Domain rules

- The engine is the only place that applies game rules. UI code may render
  options and host decisions, but must call `src/core/engine`.
- Screens mutate state only through `store.dispatch({ id, type, payload,
  at?, rulesetVersion? })`. `src/core/engine/commands.ts` runs
  Validate/Preview/Apply
  on a draft, checks invariants, and returns `allowed`, `rejected` or
  `requires-storyteller-choice` with legal options. A rejected command leaves
  state unchanged. `previewCommand` returns the domain diff and delayed effects
  without mutating. An command id is bound to a canonical fingerprint of type,
  payload and ruleset version; unsupported versions are rejected. Execution is
  deterministic through a seeded PRNG; Preview captures the command timestamp
  once per id, fingerprint and initial state, and Apply reuses it (`at` pins it
  explicitly), so Preview and Apply agree for the same initial state. A failed save rolls the in-memory state back and
  returns `persist-failed`.
- Every completed step and recorded vote is idempotent: applying it twice
  returns `{ ok: false }`.
- Saint, Scarlet Woman inheritance, Imp self-kill, Mayor redirect, Ravenkeeper,
  Undertaker, Drunk, Virgin, Slayer, Soldier, Monk, Butler, Spy and Recluse
  behaviour is covered by tests.
- Bad Moon Rising keeps the official order, setup (Godfather ±1 Outsider,
  Lunatic mask), conditional wakes, death protections, Po/Shabaloth/
  Professor outcomes, Minstrel and the Mastermind extra day in the engine. The
  Storyteller resolves each printed ability; the night card exposes the role
  ability and the outcome controls.
- Sects & Violets keeps the official order, Evil Twin setup, Fang Gu/Vigormortis
  composition, No Dashii poison, Fang Gu succession, Sweetheart drunk, the
  Vortox/Evil Twin wins and the Witch curse (lost at three living). Madness,
  swaps, Pit-Hag changes and
  the remaining abilities are host-adjudicated; the UI carries a visible
  warning.
- The host chooses false information, registration variants, Mayor redirects
  and a Demon heir when several Minions are eligible. The engine offers only
  allowed choices.

## Screens

- `/bag`: scenario selector for Trouble Brewing, Bad Moon Rising, Sects and
  Violets and Custom; 5–15 players; tabs for three suggested bags, manual role
  selection and a random legal bag; the manual picker lists every role of the
  selected script grouped by team, with per-team counts and required-vs-selected
  counters, clear and undo, and no search or edition/team filters; exact
  composition with Baron, Godfather, Fang Gu and Vigormortis modifiers; three
  curated suggestions for every count in each official scenario; Drunk
  real/shown split; three good bluffs not in play,
  excluding the Drunk mask; bluffs and the Drunk mask are role tokens with
  names under them; the Drunk mask has its own labelled section outside the
  Demon bluff group; 5–6 player games have no bluffs. The player-count stepper
  moves exactly one per activation, including after a script switch. Named
  pools and exact bags can be saved, reloaded, exported and imported. Legal
  does not mean balanced.
- `/seat`: ring in seat order, swap, shuffle, undo; names only, after players
  have entered them in `/player`. New games start with blank names; the player
  flow requires a non-empty name before it claims a number.
- `/secrets`: host-chosen red herring and one-of-two pairs (no auto-fill),
  reminder checklist, host-only role roster.
- `/table`: one host table. The app bar stays above a scrollable stage that
  holds an oval of seats around a centre hub, with the fixed action dock below
  it. Every seat keeps the player name at 360–390 px, role artwork on the
  medallion and coloured text state badges (acting, nominated, scheduled
  death, dead, registered death, ghost vote, poison, protection); an effect
  badge names its source role when the state records one. The dock carries the
  phase, the current step, the actor, the engine guidance, the active effects,
  the consequence preview and the rejection reason. The hub shows the day's
  nomination, the recorded votes and the `ceil(living / 2)` threshold, the
  execution result and the dawn report; dismissing the dawn shows the active
  nomination or an explicit no-nomination state. The day-help sheet carries
  only the role forms; the madness review, a manual winner declaration and the
  Tinker's day death live in the table menu. The day dock has exactly three
  actions: execute the selected player, end the day without execution, and day
  help. The day card and the dock share one selected player and one survival
  choice, and both require a living target. A disabled Confirm lists every
  blocker reason inside the step sheet. Nominations
  and votes stay live at the table; the app records only the execution result
  and keeps an imported nomination and the threshold read-only. The engine
  remains the authority and a refused command shows its reason. A full-screen player card shows a role card, the night
  information or a host-entered template: the Drunk sees the believed role and
  a poisoned or drunk actor gets only the template. Host notes, the timer,
  undo, import and export live in the table menu. The over panel names the
  actual win cause, including a Demon execution. The host-adjudicated tracking
  warning appears once per screen. Win and review gate stay.
- `/player`: number picker; a tap on a free number shows the shown role with
  the auto-hide deadline; name entry; saving the name returns to the number
  picker, which offers seat arrangement once every number is claimed; warning
  before returning to the host console.
- `/public`: phase, alive count, public deaths, winner. No roles, bluffs,
  notes, effects or hidden information.
- `/help`: rules and all-role reference without the current game's secrets.
- `/demo`: separate scripted game; never touches the saved real game.
- `/sheet/{ru,en,az}`: scenario-filtered Trouble Brewing, Bad Moon Rising,
  Sects & Violets or all-standard reference with names, abilities and role art
  in the selected language. Travellers live in a separate toggle/section, and
  the filter is a UI preference that never mutates the saved game.

## Scenarios

- Trouble Brewing, Bad Moon Rising and Sects & Violets are playable from the
  picker.
- Bad Moon Rising is host-adjudicated: the engine owns the official order,
  setup choices (Godfather Outsider shift, Lunatic mask), targets, conditional
  wakes, death/resurrection recording, protections and the Mastermind extra
  day. The Storyteller resolves each printed ability; the night card exposes
  the role ability and the outcome controls.
- A custom script is stored with the game and constrains the bag, bluffs and
  Drunk mask to its roles. Imported custom scripts must use roles from a single
  supported edition: all Trouble Brewing, all Bad Moon Rising or all Sects &
  Violets. A manual custom pool may span editions. Same-edition pools use the
  matching supported engine. Mixed pools run in an explicit manual-only
  Storyteller mode: the host deals, resolves every ability and death, records
  corrections and declares the winner. No automatic role or win check runs, and
  the table carries a prominent warning.
- Accepted import sources: JSON file, URL (the host must allow CORS), clipboard
  text. The BotC format is an array of role ids or `{ id }` objects with an
  optional `_meta` entry; an object with `roles` is also accepted. `_meta.name`
  and `_meta.author` are shown in the preview.
- Travellers are ignored during the deal. Unknown role ids and unsupported
  roles are rejected with a message naming them.
- Changing the script resets the deal; the script travels with export/import.

## CSS and accessibility

- `css/app.css` is the only stylesheet: the layer order, the Tailwind theme,
  Preflight, utilities, the font face, one `@theme` block and a small
  `@layer base` reset. `scripts/check-types-policy.mjs` fails on a second
  stylesheet, a dead token or an unresolved `var(--…)`. Every screen
  composes Tailwind utilities, the shared `.btn`/`.field`/`.label` primitives and
  the Arcane components, with Preflight enabled: `css/bag.css`, `css/seat.css` and
  `css/setup.css` are deleted, and legacy class names remain as inert hooks
  for the browser checks. The Arcane Instrument tokens add the crypt
  surfaces, brass, amber, crimson, parchment and ink scale;
  `docs/design-direction.md` records their roles.
- Dark surfaces, role art, touch targets at least 44px, visible focus, labels on
  controls, no horizontal overflow at 360–390px.
- Secret states use text and icons, not color alone.
- `prefers-reduced-motion` disables animation and smooth scrolling.
- Player-facing views build a projection object. They do not receive the full
  secret state and do not rely on blur or opacity for privacy.

## Pages

`dist/` is the artifact. The Pages workflow runs the tests, builds, generates
`dist/404.html` with the configured base and `dist/sw.js` from the artifact, then
uploads `dist/`. Unknown nested paths receive the real 404 document, which
redirects to the base and restores the route; `scripts/serve-dist.mjs`
reproduces that behaviour locally.

## Acceptance

- `npm test` passes (`node --test "src/**/*.test.ts"`).
- Bag → Seat → Secrets → Table → Player → Public works, reload preserves state.
- A 7/10/12-player bag deals, names are entered by players, a full night and day
  resolve, the host records the execution, and the win screen gates the role
  review.
- No console errors, no horizontal overflow at 360 and 1440.
- Public and player views expose no real role, bluffs, notes or effects.

## Reliability and live-play additions

- Screens return a cleanup function from `mount`; the router disposes it before
  navigating, changing locale, or clearing the screen. `unmount` also supports
  cleanup after a partial mount failure.
- `src/ui/dom.ts` provides shared escaping for the remaining DOM screens; the
  console guidance comes from `src/entry/guidance.ts` through a shell port, and
  the console overlays live in `src/ui/screens/table/dialogs.tsx`.
- `createGameStore(ports)` owns the transaction: prepare, validate, apply on the
  live draft, invariants, persist, publish. A rejected command leaves the state
  untouched; a failed write restores the pre-command clone and publishes only
  the save status. `src/entry/store.ts` is the browser composition root and
  facade.
- A failed write publishes the same game and revision with `save.status =
  "failed"`; an identical repeated failure publishes nothing; the next
  successful write clears it. Save revisions and disk snapshots detect
  conflicts, and an adopted cross-tab save clears undo history.
- Disk snapshot checks prevent stale sequential overwrites between tabs.
- Public/player transitions return to the console with no cover step. Player role
  lookup occurs only for the selected seat; the number-picker projection
  contains no role details. Auto-hide uses a fixed deadline and survives
  rerendering without extending it.
- The phone table window is one column: the app bar, the scrollable table stage
  and the fixed dock. Instructions are collapsible and stored under `pg.guided`.
  Live controls target 44px minimum; the stage, not the document, scrolls.
- The Virgin action records triggering or non-triggering first nominations. The
  host can also record the voter list of a normal nomination; the engine counts
  the threshold and the leader. A correction can reopen a claimed number.
- Voting requires `ceil(living / 2)` votes plus a sole highest total.
- `manifest.webmanifest`, `src/entry/offline.ts` and generated `sw.js` support
  offline loading. `scripts/build-offline.mjs` hashes the runtime asset set and
  precaches only the locale catalogs the loader can request.
  The app asks for an update as soon as it opens, before the 30-minute throttle
  that governs later checks. The worker that opening check installs activates
  without a prompt: the window saves best-effort, sends `SKIP_WAITING`, and
  reloads once. A failed save never blocks an update; the unsaved game in memory
  is lost. A worker found after the opening check keeps the **Update** /
  **Later** prompt and applies on demand. **Later** keeps the current worker.
  Old caches are pruned only when the new worker activates. A client on the
  previous protocol still activates this worker through the transitional
  preflight reply, so one rollout is enough.
