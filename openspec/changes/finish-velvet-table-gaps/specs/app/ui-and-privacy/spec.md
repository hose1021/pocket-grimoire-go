# Spec Delta

## ADDED Requirements

### Requirement: Localized engine-originated console text

The console SHALL render every engine-originated note, cause and warning in the
active UI language. A raw English sentence SHALL NOT appear in the Russian UI,
and stored text without a localized form SHALL remain readable.

**Source**: [Issue #170](https://github.com/hose1021/grimoria/issues/170); `AGENTS.md` "Code Conventions"; `SPEC.md` "Screens"
**Tests**: `src/ui/i18n/strings.test.ts`, `src/core/engine/bmr.test.ts`, `scripts/browser-check.mjs`

#### Scenario: Bad Moon Rising step note

- **WHEN** a Bad Moon Rising step carries an engine note in the Russian UI
- **THEN** the note appears in Russian and not as a raw English sentence

#### Scenario: Language switch

- **WHEN** the host switches the UI language
- **THEN** the engine notes on the current step render in the new language

#### Scenario: Stored legacy note

- **WHEN** an imported save carries note text with no localized form
- **THEN** the console shows the stored text instead of a missing-key placeholder

### Requirement: One tracking disclaimer per screen

A screen SHALL show the tracking disclaimer once and SHALL NOT repeat it on the
deal screen, `/secrets` and every step sheet.

**Source**: [Issue #170](https://github.com/hose1021/grimoria/issues/170); `SPEC.md` "Screens"
**Tests**: `scripts/browser-check.mjs`

#### Scenario: Deal screen

- **WHEN** the deal screen renders
- **THEN** the tracking disclaimer appears once

#### Scenario: Step sheet

- **WHEN** a step sheet opens after the screen already showed the disclaimer
- **THEN** the sheet does not repeat it

#### Scenario: Secrets screen

- **WHEN** `/secrets` renders
- **THEN** the disclaimer appears once on the screen
