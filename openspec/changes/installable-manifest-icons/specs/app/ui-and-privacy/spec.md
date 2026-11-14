# Spec Delta

## ADDED Requirements

### Requirement: Installable manifest icon set

The web app manifest SHALL declare a 192x192 and a 512x512 PNG icon of the
Grimoria mark, and both SHALL resolve with HTTP 200 under the deployed base
path so Chrome can evaluate the app as installable on Android.

**Source**: [web.dev install criteria](https://web.dev/articles/install-criteria),
[Chromium 570202962](https://issues.chromium.org/issues/570202962),
[Issue #173](https://github.com/hose1021/grimoria/issues/173)
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Manifest declares both icon sizes

- **WHEN** a browser reads the manifest of the deployed app
- **THEN** the icon list contains a 192x192 PNG entry and a 512x512 PNG entry

#### Scenario: Both icons download

- **WHEN** the browser requests the source URL of each declared PNG icon
- **THEN** each response is HTTP 200 with the PNG media type
