# Grimoria

A standalone Storyteller aid for **Blood on the Clocktower**. The rules engine
implements **Trouble Brewing**, **Bad Moon Rising** and **Sects & Violets**.
Each character has one audit level: the engine automates the roles the rules
matrix marks `verified` and leaves the rest to the Storyteller, who still gets
the official night order, setup choices, targets and death bookkeeping. The
support table below is derived from [`docs/rules-matrix.md`](docs/rules-matrix.md)
and checked by `scripts/check-acceptance.mjs`; the `/bag` and `/secrets` screens
show the same counts.

| Scenario        | Verified | Storyteller choice | Unsupported |
| --------------- | -------: | -----------------: | ----------: |
| Trouble Brewing |       21 |                  1 |           0 |
| Bad Moon Rising |       21 |                  4 |           0 |
| Sects & Violets |       17 |                  6 |           2 |

Built with Vite into a static `dist/` artifact. There is no backend or database.
Game state stays in `localStorage`.

## Run

```sh
npm ci
npm run dev
```

Open the URL Vite prints. Routes use real paths (`/table`, `/seat`). `npm run
build` emits `dist/`; `node scripts/serve-dist.mjs --root dist` serves it with a
real 404 fallback, like GitHub Pages. A `file://` page does not load the modules
and language catalogs reliably.

## Routes

- `/table` — Storyteller console: one host table with the seat ring, the centre
  hub and the fixed action dock. The hub carries the dawn report, the
  nomination, the votes and the `ceil(living / 2)` threshold; the dock records
  the votes, the execution and the day. A full-screen player card shows a role
  card, the night information or a host template. Win and review stay in the
  table window.
- `/bag` — player count, scenario picker, three suggested bags per count, a
  searchable 72-role manual picker, a random legal bag, Drunk mask and Demon
  bluffs. Named pools and bags can be saved, exported and imported. Same-edition
  custom pools play with their supported engine; mixed pools use explicit
  manual-only Storyteller play. Scripts can be imported from a JSON file, a URL
  or the clipboard. Every script shows the three support levels — fully
  verified, requires Storyteller choice, unsupported — and any official jinx
  pair in the pool with its source; a jinxed pool stays Storyteller-resolved.
  Legal does not mean balanced.
- `/seat` — seat order, swap, shuffle.
- `/secrets` — red herring, host-chosen one-of-two pairs, reminders.
- `/player` — safe device handoff: number, cover, shown role, name.
- `/public` — public screen without roles, bluffs, notes or effects.
- `/help` — compact rules and role reference.
- `/demo` — scripted 10-player teaching game.
- `/sheet` — role sheet in the current language.
- `/sheet/ru`, `/sheet/en`, `/sheet/az` — the same role sheet in Russian,
  English and Azerbaijani.

The role sheet filters between Trouble Brewing (22 roles), Bad Moon Rising
(25 roles), Sects & Violets (25 roles) and all standard scenarios (72 roles).
The five Travellers used by the reference sheet — Scapegoat, Gunslinger,
Beggar, Bureaucrat and Thief — are a separate toggle, so they are not counted
with the selected scenario. The filter and the Travellers toggle are reading
preferences: they never change the saved game.

## Data

`assets/data/` contains the locale catalogs, `assets/img/roles/` the role art
and `assets/fonts/inter/` the font. These files are part of the deployment.

Game state uses `pg.game.v4`. The store migrates `pg.game.v3` and `pg.game.v2`, keeps a backup
when a save is corrupt, and supports JSON export/import. Exports contain secret
roles and notes; treat them as Storyteller material.

## Test

```sh
npm test
```

The tests cover composition, the Drunk, bluffs, night order, all Trouble
Brewing, Bad Moon Rising and Sects & Violets roles, effects, execution versus
death, the at-least-half vote threshold, win priorities, the Mastermind extra
day, migration and import/export, script parsing, custom-script bags, the three
character support levels and the versioned jinx table.

## Rules

The implemented rules and sources are in
[`docs/rules-sources.md`](docs/rules-sources.md). Official data snapshots are in
`docs/official/` (roles, night order and jinxes).

## Deploy

The repository is `grimoria` and the live site is
<https://hose1021.github.io/grimoria/>. `dist/` is the GitHub Pages artifact.
Set Pages to **GitHub Actions**. The workflow runs the tests, builds, generates
the fallback and the worker, and uploads `dist/`. Keep `.nojekyll`.

## Live play and recovery

On phones the table window is one column: the app bar, the scrollable table
stage and the fixed dock. Detailed Storyteller guidance starts collapsed and
remembers your preference. Use a player's correction dialog to reopen a
mistaken role claim; provide a reason. Returning from a player-facing route
opens the console directly.

Public tabs update from saved changes. A failed save shows a persistent warning:
export before closing the tab.

## Offline

The committed service worker caches the app, catalogs, fonts and role art.
Wait for **Ready offline** after the first online load. It then supports offline
reloads, including GitHub Pages project subpaths. When a newer release has been
fully precached, the app offers **Update** or **Later**. **Update** first saves
the current game and asks every other open window to save; only then does it
activate the new worker and reload each window once. **Later** keeps playing on
the version already loaded. An update is never forced during a game, and a
failed save in any window cancels activation; a window that still cannot save
at reload time keeps its code and shows a recovery message.

The first upgrade from a release older than this update flow cannot show the
prompt: that version's code does not know about it. It keeps working while the
new worker waits. Close every open Grimoria window (on a phone, close
the installed app from the app switcher); the next launch runs the new version
and later releases use the prompt.

After changing application assets, regenerate the committed cache manifest:

```sh
node scripts/build-offline.mjs
```

Actions also regenerates it before uploading the Pages artifact. Building needs
`npm ci` once; the deployed artifact ships no runtime dependency.

## Browser verification

`scripts/browser-check.mjs` is a Playwright check that runs in pull-request CI
and can also be run locally on demand. With Playwright and its Chromium browser
installed outside the repo, set `PLAYWRIGHT_MODULE` to its `index.mjs`, then run
`node scripts/browser-check.mjs`. It starts its own local
server under a project subpath, checks phone/tablet/desktop routes, completes
7- and 12-player scenarios, and exercises privacy, dialogs, cross-tab updates,
locales, offline reloads, and the stale-to-new service-worker update flow,
including a pre-update client's first upgrade. Screenshots are written to the
system temp folder.

See [implementation notes](docs/improvement-implementation.md) for validation
results and the scope of the research recommendations.
