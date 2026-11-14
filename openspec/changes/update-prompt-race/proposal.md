# Proposal

## Why

`app/offline` requires a prompt for a worker installed after the opening check.
The page misses that prompt when the install finishes before `updatefound` is
delivered, because the handler reads `registration.installing`, which is already
null. The browser check also pins the opening update to exactly two page loads,
while the browser legitimately applies the update in one load when the reload
leaves no controlled client. That assertion failed pull request #163's CI.

Issue: #166

## What Changes

- The `updatefound` handler SHALL fall back to `registration.waiting`, so a
  worker that finished installing before the event still raises the prompt.
- The browser check SHALL accept one or two page loads for the opening update and
  SHALL assert its outcome instead: the new version runs, the banner stays
  hidden, and the previous cache is pruned.
- The browser check SHALL assert the compatibility contract that a page on the
  previous page code relies on: `PREPARE_UPDATE` receives
  `{ ok: true, failed: 0, unconfirmed: 0 }` from the waiting worker.
- No storage key, route or game rule changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `app/offline`: one scenario on the existing "Activation after the opening
  check" requirement pins the event order the prompt must survive.

## Impact

- `src/entry/offline.ts`: one lookup in the `updatefound` handler.
- `scripts/browser-check.mjs`: the opening-update assertion and one compatibility
  assertion.
