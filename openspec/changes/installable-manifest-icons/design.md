# Design

## Context

See proposal.md. The manifest declares one icon, `favicon.svg` with
`sizes: "any"`. Chrome's published install criteria require a 192 px and a
512 px icon, and the Android install sheet downgrades a manifest without a
suitable raster icon to a shortcut (Chromium 570202962).

The mark is a single SVG (`public/favicon.svg`, 64x64 viewBox, dark tile with a
rounded corner) and the repository has no image toolchain.

## Goals / Non-Goals

**Goals:**

- One manifest icon set that satisfies Chrome's install criteria on desktop and
  Android.
- The icons stay the same mark as the favicon, generated from the repository
  SVG rather than drawn twice.

**Non-Goals:**

- Maskable or monochrome variants: the mark already fills the square tile, and
  Chrome accepts the "any" icon for the adaptive layer.
- Screenshots, shortcuts and richer install UI.
- An image build step in the repository.

## Decisions

- **Raster PNG at 192 and 512.** Chrome's WebAPK path needs pixel sizes;
  `sizes: "any"` on an SVG is what Chromium 40925759 reports as a broken
  Android install. PNG is the format every browser accepts without a decoder
  question.
- **Generate the PNGs once from `favicon.svg` with headless Chrome**, then commit
  them. Alternative: add `sharp`/`resvg` as a devDependency and render at build
  time. Rejected: the mark changes rarely, a raster step in `vite build` would
  add a dependency and a failure mode to every deploy, and `public/` is the
  committed asset root that Vite copies verbatim.
- **Keep the SVG entry after the PNGs.** The SVG stays the favicon and the crisp
  scalable icon; the PNGs are listed first so install paths that prefer raster
  take them.
- **Assert in `scripts/browser-check.mjs`**, next to the existing manifest
  identity assertions. The harness already fetches the manifest over the built
  artifact under the project subpath, so it catches a missing file, a wrong base
  path and a stale manifest in one check.

## Risks / Trade-offs

- [Android WebAPK installation cannot be reproduced in the Playwright job] → the
  check asserts the declared sizes and asset responses, which are the two
  conditions the repository controls; device verification stays manual and is
  recorded in the pull request.
- [PNG bytes are opaque in review] → both files are renders of the committed
  `public/favicon.svg`; the tasks record the exact render command.
- [Cache id changes on deploy] → expected: the worker hashes `dist/`, so the
  first visit after the deploy offers the usual confirmed update.
