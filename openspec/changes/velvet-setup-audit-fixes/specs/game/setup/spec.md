# Spec Delta

## MODIFIED Requirements

### Requirement: Scenario setup modifiers

The setup SHALL apply the Baron's plus two Outsiders, the Godfather's plus or
minus one Outsider, the Fang Gu's plus one Outsider and the Vigormortis's minus
one Outsider, SHALL keep the bag the same size as the player count, and SHALL
treat a bag as legal when its team counts equal the composition its own
modifiers produce. A modifier SHALL be rejected only when the composition it
takes part in is impossible: another modifier may already account for the
Outsider that this one removes.

**Source**: [Baron r2961](https://wiki.bloodontheclocktower.com/index.php?title=Baron&oldid=2961), [Godfather r2394](https://wiki.bloodontheclocktower.com/index.php?title=Godfather&oldid=2394), [Fang Gu r2974](https://wiki.bloodontheclocktower.com/index.php?title=Fang_Gu&oldid=2974), [Vigormortis r3015](https://wiki.bloodontheclocktower.com/index.php?title=Vigormortis&oldid=3015), `docs/rules-sources.md` "Setup and composition"
**Tests**: `src/core/engine/setup.test.ts`, `src/core/engine/bmr.test.ts`, `src/core/engine/snv.test.ts`

#### Scenario: Each modifier shifts the composition

- **WHEN** the bag contains the Baron, the Godfather, the Fang Gu or the Vigormortis
- **THEN** the composition gains two Outsiders, gains or loses one, gains one, or loses one respectively, and the team total still equals the player count

#### Scenario: Impossible Godfather shift

- **WHEN** the host sets the Godfather to minus one Outsider and the base composition has no Outsider
- **THEN** bag validation reports `godfather-minus` and a reason

#### Scenario: Vigormortis shift

- **WHEN** the Vigormortis is in play and an Outsider token remains after the other modifiers
- **THEN** the bag removes one Outsider and no team count goes negative

#### Scenario: Impossible Vigormortis shift

- **WHEN** the Vigormortis is in play at a count with no base Outsider
- **THEN** the shift is a no-op: the base composition stays, the bag is legal, and no `vigormortis-minus` reason is reported

#### Scenario: Modifiers that cancel each other

- **WHEN** a bag combines two modifiers whose shifts cancel, and its team counts equal `compositionFor`
- **THEN** bag validation accepts it with no `godfather-minus` reason

#### Scenario: Impossible combination

- **WHEN** the combined shifts ask for a negative team count
- **THEN** bag validation reports `composition-impossible` with a Russian reason and never prints a negative "of N" counter

### Requirement: Legal bag validation

Bag validation SHALL reject duplicate roles, a wrong total, roles outside the
selected script, a bluff that is in play, a Drunk shown role that leaks the
mask, and a Lunatic shown role that is missing, not a Demon or outside the
selected script, each with a stable reason code; a bag that contains the Lunatic
SHALL be rejected when the caller supplies no shown Demon at all. A randomly
generated bag SHALL be legal at every supported player count.

**Source**: [Setup r1361](https://wiki.bloodontheclocktower.com/index.php?title=Setup&oldid=1361), [Drunk r3165](https://wiki.bloodontheclocktower.com/index.php?title=Drunk&oldid=3165), [Lunatic r3112](https://wiki.bloodontheclocktower.com/index.php?title=Lunatic&oldid=3112), `docs/rules-sources.md` "Setup and composition"
**Tests**: `src/core/engine/setup.test.ts`, `src/core/engine/engine.test.ts`, `src/core/engine/bmr.test.ts`, `src/core/engine/snv.test.ts`

#### Scenario: Duplicate role

- **WHEN** a five-player bag lists the Chef twice
- **THEN** bag validation fails with the duplicate reason

#### Scenario: Bluff that is in play

- **WHEN** a bluff role is also in the bag
- **THEN** bag validation fails with the in-play reason

#### Scenario: Lunatic without a shown Demon

- **WHEN** the bag contains the Lunatic and the caller passes no shown Demon, including an omitted field
- **THEN** bag validation reports `lunatic-shown`

#### Scenario: Lunatic mask of the wrong team or script

- **WHEN** the shown Lunatic role is not a Demon or is outside the selected script
- **THEN** bag validation reports `lunatic-team` or `lunatic-outside-script`

#### Scenario: An imported save without the mask

- **WHEN** a saved or imported state has the Lunatic in the bag and no shown Demon
- **THEN** `validateState` reports `Invalid Lunatic mask.` and the deal is rejected

### Requirement: Suggested bags

The setup SHALL provide three curated bags for every count from 5 to 15 in each
of the three official scenarios and SHALL generate three distinct deterministic
suggestions from a custom pool; the random bag SHALL return the Godfather
Outsider direction it was composed for, and that direction SHALL be `+1` when
the bag holds no Godfather. A legal bag is not advertised as balanced.

**Source**: `SPEC.md` `/bag` and "Scenarios"; [Godfather r2394](https://wiki.bloodontheclocktower.com/index.php?title=Godfather&oldid=2394); `docs/rules-sources.md` "Known limitations"
**Tests**: `src/core/model/presets.test.ts`, `src/core/engine/setup.test.ts`

#### Scenario: Official preset validation

- **WHEN** all 99 official presets are validated
- **THEN** every preset has the exact count, pool membership and team composition

#### Scenario: Deterministic custom suggestions

- **WHEN** the host requests suggestions twice for the same count and pool
- **THEN** both calls return the same bags

#### Scenario: Random bag carries its direction

- **WHEN** the host asks for a random bag with the Godfather set to minus one and the bag contains the Godfather
- **THEN** the returned bag reports `godfatherOutsider: -1`

## ADDED Requirements

### Requirement: The deal is a permutation of the bag

`dealGame` SHALL accept an explicit assignment only when it places every role
in `state.setup.roles` exactly once over the seat order: a repeated role, a role
outside the bag and a seat without a role SHALL all be rejected with a Russian
reason and SHALL leave the players untouched. Without an assignment the deal
SHALL shuffle the bag itself.

**Source**: `SPEC.md` "State contract"; `docs/rules-sources.md` "Setup and composition"
**Tests**: `src/core/engine/setup.test.ts`, `src/core/engine/commands.test.ts`, `src/core/engine/acceptance.test.ts`

#### Scenario: Duplicate character

- **WHEN** the assignment gives two seats the same character from the bag
- **THEN** the deal returns `{ ok: false }` and no player receives a role

#### Scenario: Character outside the bag

- **WHEN** the assignment deals a character the bag does not contain
- **THEN** the deal returns `{ ok: false }`

#### Scenario: Unassigned seat

- **WHEN** the assignment leaves one seat without a role
- **THEN** the deal returns `{ ok: false, error }` naming the missing seat

#### Scenario: Legal permutation

- **WHEN** the assignment is a permutation of the bag over the order
- **THEN** the deal succeeds and every seat receives its assigned character

### Requirement: A re-deal starts from a clean slate

A new deal SHALL clear everything that belonged to the previous game: the
recorded gossip, the Grandmother's grandchild, the manual corrections and the
host notes, in addition to the night, day, death, effect and winner records it
already reset.

**Source**: `SPEC.md` "Persistence and reset"; [Gossip r2387](https://wiki.bloodontheclocktower.com/index.php?title=Gossip&oldid=2387)
**Tests**: `src/core/engine/setup.test.ts`, `src/core/engine/bmr.test.ts`, `src/core/engine/commands.test.ts`

#### Scenario: Re-deal after a true gossip

- **WHEN** the host re-deals a Bad Moon Rising bag after a true Gossip statement
- **THEN** `state.gossip` is null and no earlier Gossip consequence survives

#### Scenario: Old grandchild and corrections

- **WHEN** the host re-deals after choosing a grandchild and recording a correction
- **THEN** `setup.grandmotherId` is null, `corrections` is empty and `notes` is empty

### Requirement: Host reminder tokens for every official role

The setup data SHALL expose a Russian host reminder token list for every
Trouble Brewing, Bad Moon Rising and Sects & Violets role, so the Secrets screen
can show its checklist for any scenario; a role with no printed reminder MAY
carry an empty list.

**Source**: [Setup r1361](https://wiki.bloodontheclocktower.com/index.php?title=Setup&oldid=1361), `SPEC.md` "/secrets"; `docs/official/roles.json`
**Tests**: `src/core/engine/setup.test.ts`

#### Scenario: Every official role is listed

- **WHEN** the Secrets screen asks for the reminders of a role in the bag
- **THEN** every supported role has a reminder list, and every Bad Moon Rising and Sects & Violets role has at least one token

### Requirement: Localizable setup problem

Every bag, setup and secrets problem SHALL carry a stable `code`, the Russian
`message`, and optional `vars` with the values the localized `error.<code>` key
interpolates. A role SHALL stay a role id so the screen maps it through the role
catalog, and `code` and `message` SHALL keep their current values.

**Source**: `SPEC.md` "Localization"; `src/ui/i18n/AGENTS.md`
**Tests**: `src/core/model/rules.test.ts`, `src/core/engine/setup.test.ts`

#### Scenario: Problem that names a role

- **WHEN** the bag names an unknown role, a role outside the script, or a rejected bluff
- **THEN** the problem's `vars.role` is the role id and the message is unchanged

#### Scenario: Problem that names numbers or a team

- **WHEN** the problem is `size`, a `team-*` mismatch, `bluffs-count`, `godfather-minus` or `composition-impossible`
- **THEN** `vars` carries `count` and `required`, or `needed`, or `team`, as the localized key expects

#### Scenario: Problem that names a shown mask

- **WHEN** a Drunk or Lunatic mask is rejected
- **THEN** `vars.shown` is the rejected role id and the message is unchanged
