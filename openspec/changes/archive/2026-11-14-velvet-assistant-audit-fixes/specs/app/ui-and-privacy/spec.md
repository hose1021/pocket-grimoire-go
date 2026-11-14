# Spec Delta

## ADDED Requirements

### Requirement: Host guidance follows the UI language and the actor

The step guidance SHALL give a specific instruction for the Bad Moon Rising and
Sects & Violets introduction steps, SHALL keep a Lunatic-specific instruction,
and SHALL use the Drunk guidance for a Drunk actor's step, stating that the
ability does not work and the information is false.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS3, AS4); [Drunk](https://wiki.bloodontheclocktower.com/index.php?title=Drunk)
**Tests**: `src/ui/i18n/strings.test.ts`

#### Scenario: Minion introduction

- **WHEN** a Bad Moon Rising first night reaches the minion introduction
- **THEN** the host action tells the Storyteller to wake the Minions and show
  them the Demon and each other, not the generic ability line

#### Scenario: Drunk actor

- **WHEN** the actor of a night step is the Drunk
- **THEN** the guidance says the ability does not work and the information is
  false

### Requirement: Host-facing reasons and win causes are localized

A rejected command and a setup error SHALL render in the active UI language
through their `error.N` key when the catalogs translate it, and SHALL fall back
to the engine message otherwise. An illegal step answer and a madness review
SHALL have distinct `error.66` copy. The Vortox, Evil Twin and Klutz win causes
SHALL have a sentence in every catalog.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS15, AS16, AS17)
**Tests**: `src/ui/screens/table/helpers.test.ts`, `src/ui/i18n/strings.test.ts`

#### Scenario: English console rejects a command

- **WHEN** the engine rejects a step with a translated error code
- **THEN** the banner shows the English sentence, not the Russian engine message

#### Scenario: Vortox win

- **WHEN** the Vortox win cause is recorded
- **THEN** the over panel shows a full sentence for it in every catalog

### Requirement: The shown card records the chosen answer

For an impaired actor the private player card SHALL show the selected `given`
answer when the host recorded one, then the typed template, and only then an
explicit "information is not set up" state.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS14)
**Tests**: `src/ui/screens/table/helpers.test.ts`

#### Scenario: Poisoned Chef with a chosen number

- **WHEN** the host selects "2" for a poisoned Chef and shows the card
- **THEN** the card shows the computed form of that answer, not only the empty
  template

### Requirement: Registration is labelled as registration

The character answer for a healthy Undertaker or Ravenkeeper whose target
registers as another character SHALL be labelled as a registration choice, not
as false information.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS11)
**Tests**: `src/ui/screens/table/helpers.test.ts`

#### Scenario: Undertaker after a Spy execution

- **WHEN** a healthy Undertaker's executed target is the Spy and the host
  chooses the shown character
- **THEN** the control is labelled as a registration choice

### Requirement: Russian host copy matches the pinned rules

The Russian catalog SHALL state that the Saint's execution wins for evil, SHALL
keep the Spy's real-grimoire instruction separate from the impaired false-picture
instruction, and SHALL translate `error.15` and `error.16`.

**Source**: [Issue #171](https://github.com/hose1021/grimoria/issues/171) (AS19); [Saint](https://wiki.bloodontheclocktower.com/index.php?title=Saint)
**Tests**: `src/ui/i18n/strings.test.ts`

#### Scenario: Russian Saint guide

- **WHEN** the Russian console shows the Saint's guide
- **THEN** the host line says the healthy Saint's execution gives evil the win

#### Scenario: Russian error copy

- **WHEN** the Russian console shows `error.15` or `error.16`
- **THEN** the sentence is Russian, not the English placeholder
