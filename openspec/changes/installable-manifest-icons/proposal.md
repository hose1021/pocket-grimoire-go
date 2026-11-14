# Proposal

Issue: #173

## Why

Chrome 156 on Android opens the "Install and create shortcut" sheet with
"This app cannot be installed" and offers only a shortcut, because the manifest
declares no raster icon.

## What Changes

- Add 192x192 and 512x512 PNG icons of the Grimoria mark to `public/`.
- Declare both PNG icons in `public/manifest.webmanifest` before the existing
  SVG favicon entry.
- Extend the browser regression check to assert both icons are declared and
  resolve with HTTP 200 under the deployed base path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `app/ui-and-privacy`: adds an installable manifest icon set requirement next
  to the existing application identity requirement.

## Impact

- Static assets: `public/icon-192.png`, `public/icon-512.png` (new),
  `public/manifest.webmanifest`.
- Regression harness: `scripts/browser-check.mjs` identity block.
- Offline worker: no code change. `scripts/build-offline.mjs` hashes `dist/`, so
  the new icons enter the precache and change the cache id on deploy.
- No change to game rules, state schema, routes, storage keys or projections.
