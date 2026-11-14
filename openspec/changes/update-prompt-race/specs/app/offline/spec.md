# Spec Delta

## MODIFIED Requirements

### Requirement: Activation after the opening check

A worker installed by a later check SHALL NOT reload a window in use. The app
SHALL show its update prompt, and activation SHALL start only when the host
applies it.

**Source**: `SPEC.md` "Reliability and live-play additions"; issue #156
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Later update waits for the host

- **WHEN** a worker finishes installing after the opening check
- **THEN** the prompt appears and the window keeps running its current version
  until the host applies the update

#### Scenario: Install finishes before the event

- **WHEN** the worker finishes installing before the page receives the update
  event
- **THEN** the prompt still appears and the window keeps running its current
  version

#### Scenario: Applying a later update

- **WHEN** the host applies the prompt
- **THEN** the window saves best-effort, sends `SKIP_WAITING` and reloads once

#### Scenario: Worker does not activate

- **WHEN** the waiting worker has not activated within the activation timeout
- **THEN** the prompt reports the failure and offers a retry, and the saved game
  is unchanged
