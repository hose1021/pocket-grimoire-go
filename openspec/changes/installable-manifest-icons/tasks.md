# Tasks

## 1. Failing check first

- [x] 1.1 Extend the identity block in `scripts/browser-check.mjs`: assert the manifest declares a 192x192 and a 512x512 PNG icon and that each `src` resolves with HTTP 200. Run `node scripts/browser-check.mjs` and record the RED assertion text against the current manifest.

## 2. Icons and manifest

- [x] 2.1 Render `public/icon-192.png` and `public/icon-512.png` from `public/favicon.svg` and verify both files are square PNGs of the expected pixel size (`sips -g pixelWidth -g pixelHeight`).
- [x] 2.2 List both PNG icons first in `public/manifest.webmanifest`, keep the SVG entry, and verify the manifest parses (`node -e "JSON.parse(require('node:fs').readFileSync('public/manifest.webmanifest','utf8'))"`).

## 3. Verification

- [x] 3.1 Run `npm run build && npm run fallback && npm run offline` and verify `dist/sw.js` lists both PNG icons in `ASSETS` and the cache id changed.
- [x] 3.2 Run `node scripts/browser-check.mjs` and record the GREEN result, including the identity and offline scenarios.
- [x] 3.3 Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `node scripts/openspec-check.mjs`, `openspec validate --changes --strict` and `openspec validate --specs --strict`; record each result.

## Evidence

- RED: `PLAYWRIGHT_MODULE=… node scripts/browser-check.mjs` -> `AssertionError [ERR_ASSERTION]: manifest declares a 192x192 icon` at `scripts/browser-check.mjs:590`, against the manifest that listed only `favicon.svg`.
- GREEN: `PLAYWRIGHT_MODULE=… node scripts/browser-check.mjs` -> `Browser checks passed: phone/tablet, night/day, Virgin, route cleanup, privacy, reload, cross-tab, languages, native role sheet, dialog contract, offline project-subpath reload, fast PWA update.` A first run failed once in the update scenario (`the page never settled on pg-static-browsercheck-v2; last worker pg-static-b54ee169d4fa54dd, loads 10`); the unchanged rerun passed, so the failure was the known reload race in that scenario, not the icon set.
- GREEN: `npm test` -> 595 pass, 0 fail. `npm run typecheck`, `npm run lint`, `npm run format:check`, `node scripts/check-types-policy.mjs` and `node scripts/check-acceptance.mjs` (72 matrix roles, 12 test files) pass.
- GREEN: `node scripts/openspec-check.mjs`, `openspec validate --changes --strict` and `openspec validate --specs --strict` pass.
- GREEN: `dist/sw.js` cache `pg-static-b54ee169d4fa54dd` with 385 assets and `dist-root/sw.js` cache `pg-static-c8947e0e8a0c89a6` with 385 assets; both `ASSETS` lists contain `icon-192.png` and `icon-512.png`. The icon render was checked visually at 512 px.

## Workflow follow-up

- Push the branch, open the pull request against `main`, report the CI result and wait for the owner. Never merge.
- After the owner merges, sync the main spec, archive the change, remove the worktree and delete the local branch.
