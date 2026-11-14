# Tasks

## 1. RED

- [x] 1.1 Reproduce the count assertion: `node scripts/browser-check.mjs` fails at
      `waitForLoads(page, loadsBeforeOpen + 2)` on pull request #163's CI, where
      the browser activated the waiting worker during the reload gap and the
      count reached one.
- [x] 1.2 State the limit: the missed prompt from `updatefound` has no
      deterministic RED, because it needs an install that completes inside one
      event turn; the fallback is covered by review and by the existing prompt
      scenario.

## 2. Prompt fallback

- [x] 2.1 In `src/entry/offline.ts`, watch `registration.installing ?? registration.waiting`
      from `updatefound`.
- [x] 2.2 `npm run typecheck` and `npm test` pass.

## 3. Browser check

- [x] 3.1 Replace the exact count in the opening-update step with a wait for the
      new version to settle, and assert the banner, the version and the pruned
      cache; the load count must stay at or below two.
- [x] 3.2 Assert the transition contract: the waiting worker answers
      `PREPARE_UPDATE` with `{ ok: true, failed: 0, unconfirmed: 0 }`.
- [x] 3.3 `node scripts/browser-check.mjs` passes.

## 4. Delivery

- [x] 4.1 `npm run verify`, `openspec validate --changes --strict`,
      `node scripts/openspec-check.mjs`.
- [x] 4.2 Commit, push, open the pull request, report CI; do not merge.

## Evidence

- RED: `page.waitForFunction: Timeout 30000ms exceeded` at
  `scripts/browser-check.mjs:2548` (`waitForLoads`) called from line 2617 on pull
  request #163's Playwright job: the page applied the opening update in one load
  because the browser activated the waiting worker during the reload gap.
- GREEN: `node scripts/browser-check.mjs` passed, including the new preflight
  reply assertion; the run after `npm run verify` passed again, so the load-count
  change is stable across two runs.
- GREEN (CI on pull request #167): the first Playwright run failed with
  `the opening check activates the waiting worker` — `pg-static-fa5f574225f473a0`
  instead of `pg-static-browsercheck-v2`. The check asserted the version on the
  document that activated the worker, before the reload that follows landed. The
  step now settles: two consecutive probes must report the new version with an
  unchanged load count. Two browser runs and `npm test` pass after the fix.
- GREEN: `npm run verify` exited 0 — typecheck, lint, format, 480 tests, build,
  fallback, offline worker `762a429742475ab4` with 381 assets, source policy and
  acceptance (72 matrix roles, 12 test files).
- GREEN: `openspec validate --changes --strict` 4/4 and
  `node scripts/openspec-check.mjs` 19 specs / 4 changes.
- GREEN (out of tree): a real old client, built from `dece322`, against the new
  artifact — the old banner appeared, `PREPARE_UPDATE` returned
  `{ ok: true, failed: 0, unconfirmed: 0 }`, `SKIP_WAITING` reloaded the window
  onto the new cache `pg-static-08fa1f78446a405b`, the old cache was pruned, the
  game route stayed `table`, no page errors, and reopening the app ran the new
  cache.
