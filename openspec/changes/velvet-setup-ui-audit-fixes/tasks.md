# Tasks

## 1. RED: failing behavioral cases

- [x] Added four DOM-free suites before the implementation and ran
  `node --test src/ui/screens/seat-projection.test.ts
  src/ui/screens/secrets-options.test.ts src/ui/screens/sheet-scenarios.test.ts
  src/ui/screens/setup-messages.test.ts`.
  All three suites failed with `ERR_MODULE_NOT_FOUND` for the modules the
  behavior needs (`seat-projection.ts`, `secrets-options.ts`,
  `sheet-scenarios.ts`), and `setup-messages.test.ts` failed because the helper
  did not exist.
- [x] `sheet-scenarios.test.ts` compares the sheet lists with
  `docs/official/roles.json`; had the module simply repeated the old five TB
  Travellers, the `bmr` and `snv` cases would still fail.

## 2. GREEN: screen fixes

- [x] `seat.tsx`: renders `publicSeats(draft, state.players)`; the role image,
  role name, sidebar role column and drag-ghost role image are removed (SET8).
- [x] `secrets.tsx`: `isManualScript` is checked before `isBmrScript` /
  `isSnvScript` (SET9); the reminder checklist is built once and rendered in
  the BMR, S&V and manual panes (SET10); the zero checkbox appears whenever
  `librarianZeroLegal` accepts it, including for a Drunk shown the Librarian
  (TB8), and `infoRoleChoices` adds the registering Spy/Recluse characters
  (TB2).
- [x] `sheet.tsx`: `SCENARIO_TRAVELLERS[scenario]` drives the Travellers
  section and the toggle count (SET11).
- [x] `bag.tsx`: `applyBag` and the script switch copy
  `bag.godfatherOutsider ?? 1` (SET5); `loadBag` and `loadPool` keep the
  library open and write the localized reason before returning (SET7);
  `setCount` confirms first, updates the ref after the confirmation and
  restores it on a rejection; every rejected setup command (bag, pool, order,
  deal, first night) renders through `setupProblemText` /
  `commandRejectionText`.
- [x] `bag.tsx` passes the totals it already sees into the localized problem
  (`size`, `bluffs-count`, `team-<team>`, `godfather-minus`,
  `vigormortis-minus`, `composition-impossible`) and the catalog role label;
  `secrets.tsx` passes the catalog label. `setupProblemKey` maps the dynamic
  `info-<role>`, `info-pair-<role>`, `info-missing-<role>`, `info-team-<role>`,
  `info-inplay-<role>`, `info-true-<role>`, `drunk-info-<role>` and the bare
  `drunk-info-team` code to the generic `error.info*` keys plus `{role}`. A
  translated key with an unsupplied placeholder falls back to the engine
  message, so no literal braces render.
- [x] `node --test src/ui/screens/seat-projection.test.ts
  src/ui/screens/secrets-options.test.ts src/ui/screens/sheet-scenarios.test.ts
  src/ui/screens/setup-messages.test.ts` → `pass 16`, `fail 0`; with
  `player-projection.test.ts` and `structure.test.ts` the focused run is
  `pass 22`, `fail 0`.
- [x] `node --test src/ui/screens/player-projection.test.ts
  src/ui/screens/structure.test.ts` → existing suites still pass.
- [x] `node --test src/core/engine/setup.test.ts` → `pass 17`, `fail 0` (the
  model owner's suite, run to confirm the UI did not disturb it).
- [x] `npm run typecheck` passed in the integration wave; the errors below were other agents' in-flight edits:
  (`src/core/engine/bmr.ts`, `information.ts`, `night.ts`, `engine.test.ts`,
  `snv.test.ts`); no error names a file in this change.

## 3. Manual repro (UI-only behavior)

- **SET7**: `/bag` → Saved → save the current bag; switch the script to Bad
  Moon Rising; Saved → Load the saved bag. The dialog stays open, shows the
  localized reason, and the bag on the left is unchanged.
- **SET8**: `/seat` with a dealt game. Ring, sidebar and drag ghost show names
  and seat numbers only; no role art, role name, team or alive badge.
- **SET9**: `/bag` → Custom → add Trouble Brewing and Bad Moon Rising roles,
  tick "manual-only"; `/secrets` renders the manual pane (pairs, herring,
  roster), not the BMR summary.
- **SET10**: deal a BMR game and open `/secrets`; the pane lists "Напоминания"
  rows such as Sailor → «Пьян» and Innkeeper → «Пьян · Защищён». Same for S&V
  (e.g. Cerenovus → «Безумие»).
- **SET11**: `/sheet?` → BMR → Travellers toggle shows Apprentice, Bishop,
  Judge, Matron, Voudon; S&V shows Barista, Bone Collector, Butcher, Deviant,
  Harlot; All shows fifteen.
- **SET5**: eight-player BMR, Godfather set to minus one, then switch the
  script away and back; the applied bag keeps the minus-one direction and the
  counters read `Изгои: 1/1`, never `0/2`.
- **Stepper**: `/bag` with a dealt game; click `+`, cancel the confirmation →
  the count does not move; click `+` again and confirm → it moves exactly one.
- **TB2 UI**: eight-player TB with a Spy; `/secrets` role select for the
  Washerwoman offers the not-in-play Chef.
- **TB8 UI**: Drunk shown the Librarian; `/secrets` shows the "No Outsiders in
  play" checkbox and ticking it clears the error.

## 4. Locale keys still needed (not edited: another owner)

Setup problem codes are looked up as `error.<code>`. Exact text to add to
`src/ui/i18n/locales/{ru,en,az}.ts`:

| Key | ru | en | az |
|---|---|---|---|
| `error.count` | Число игроков должно быть от 5 до 15. | The player count must be 5 to 15. | Oyunçu sayı 5 ilə 15 arasında olmalıdır. |
| `error.roles` | Список ролей отсутствует. | The role list is missing. | Rol siyahısı yoxdur. |
| `error.size` | Выбрано {count} ролей, нужно {required}. | Selected {count} roles, {required} needed. | {count} rol seçilib, {required} lazımdır. |
| `error.duplicate` | Одна роль выбрана дважды. | One role is chosen twice. | Bir rol iki dəfə seçilib. |
| `error.unknown` | Неизвестная роль: {role}. | Unknown character: {role}. | Naməlum rol: {role}. |
| `error.outside-script` | {role} не входит в выбранный сценарий. | {role} is not in the selected script. | {role} seçilmiş ssenariyə daxil deyil. |
| `error.godfather-minus` | Крёстный Отец не может убрать Изгоя: в базовом составе для {count} игроков их нет. | The Godfather cannot remove an Outsider: the base composition for {count} players has none. | Xaç atası Kənarçını çıxara bilməz: {count} oyunçu üçün baza tərkibində onlar yoxdur. |
| `error.vigormortis-minus` | Вигормортис не может убрать Изгоя: в базовом составе для {count} игроков их нет. | The Vigormortis cannot remove an Outsider: the base composition for {count} players has none. | Vigormortis Kənarçını çıxara bilməz: {count} oyunçu üçün baza tərkibində onlar yoxdur. |
| `error.composition-impossible` | Модификаторы состава невозможны: в базовом составе для {count} игроков не хватает ролей для выбранных сдвигов. | These composition modifiers are impossible: the base composition for {count} players cannot supply the chosen shifts. | Tərkib modifikatorları mümkün deyil: {count} oyunçu üçün baza tərkibi seçilmiş dəyişiklikləri ödəmir. |
| `error.team` | {team}: {count} из {required}. | {team}: {count} of {required}. | {team}: {required} içində {count}. |
| `error.demon` | В игре должен быть ровно один Демон. | Exactly one Demon must be in play. | Oyunda dəqiq bir Demon olmalıdır. |
| `error.drunk-unused` | Показанная роль Пьяницы задана, но Пьяницы нет в игре. | A Drunk shown role is set, but no Drunk is in play. | Sərxoşun göstərilən rolu verilib, amma oyunda Sərxoş yoxdur. |
| `error.drunk-shown` | Выберите Горожанина, которого увидит Пьяница. | Choose the Townsfolk the Drunk is shown. | Sərxoşun görəcəyi Şəhər sakinini seçin. |
| `error.drunk-team` | Пьянице можно показать только Горожанина. | The Drunk can be shown a Townsfolk only. | Sərxoşa yalnız Şəhər sakini göstərilə bilər. |
| `error.drunk-outside-script` | Показанная Пьянице роль не входит в выбранный сценарий. | The Drunk's shown role is not in the selected script. | Sərxoşa göstərilən rol seçilmiş ssenariyə daxil deyil. |
| `error.drunk-inplay` | Показанная Пьянице роль не должна быть в игре. | The Drunk's shown role must not be in play. | Sərxoşa göstərilən rol oyunda olmamalıdır. |
| `error.lunatic-shown` | Выберите Демона, которого увидит Безумец. | Choose the Demon the Lunatic is shown. | Dəlinin görəcəyi Demonu seçin. |
| `error.lunatic-team` | Безумцу можно показать только Демона. | The Lunatic can be shown a Demon only. | Dəliyə yalnız Demon göstərilə bilər. |
| `error.lunatic-outside-script` | Показанный Безумцу Демон не входит в выбранный сценарий. | The Lunatic's shown Demon is not in the selected script. | Dəliyə göstərilən Demon seçilmiş ssenariyə daxil deyil. |
| `error.lunatic-unused` | Показанный Демон Безумца задан, но Безумца нет в игре. | A Lunatic shown Demon is set, but no Lunatic is in play. | Dəlinin göstərilən Demonu verilib, amma oyunda Dəli yoxdur. |
| `error.bluffs-count-none` | Для 5–6 игроков блефы Демона не выдаются. | A 5–6 player game issues no Demon bluffs. | 5–6 oyunçu oyununda Demon blöfləri verilmir. |
| `error.bluffs-count` | Нужно ровно {needed} блефа, выбрано {count}. | Exactly {needed} bluffs are needed, {count} chosen. | Dəqiq {needed} blöf lazımdır, {count} seçilib. |
| `error.bluffs-duplicate` | Блефы не должны повторяться. | Bluffs must not repeat. | Blöflər təkrarlanmamalıdır. |
| `error.bluffs-team` | {role} — не добрая роль. | {role} is not a good character. | {role} yaxşı rol deyil. |
| `error.bluffs-outside-script` | {role} не входит в выбранный сценарий. | {role} is not in the selected script. | {role} seçilmiş ssenariyə daxil deyil. |
| `error.bluffs-inplay` | {role} уже в игре. | {role} is already in play. | {role} artıq oyundadır. |
| `error.bluffs-drunk` | {role} — маска Пьяницы. Если отдать её Демону как блеф, Демон получит подсказку о Пьянице. | {role} is the Drunk's mask. Giving it to the Demon as a bluff hints at the Drunk. | {role} Sərxoşun maskasıdır. Onu Demona blöf kimi vermək Demonu Sərxoşa yönəldir. |
| `error.bluffs-lunatic` | {role} — маска Безумца. Если отдать её Демону как блеф, Демон получит подсказку о Безумце. | {role} is the Lunatic's mask. Giving it to the Demon as a bluff hints at the Lunatic. | {role} Dəlinin maskasıdır. Onu Demona blöf kimi vermək Demonu Dəliyə yönəldir. |
| `error.herring-team` | Красная селёдка должна быть добрым игроком. | The red herring must be a good player. | Qırmızı siyənək yaxşı oyunçu olmalıdır. |
| `error.mixed-edition` | Смешанные редакции требуют ручного режима ведущего. | Mixed editions need manual-only mode. | Qarışıq nəşrlər yalnız əl rejimi tələb edir. |
| `error.evil-twin-good` | Выберите доброго игрока — второго Близнеца. | Choose the good player who is the other Twin. | Digər Əkiz olan yaxşı oyunçunu seçin. |
| `error.not-dealt` | Сначала раздайте роли. | Deal the roles first. | Əvvəl rolları paylayın. |
| `error.herring` | Выберите красную селёдку Гадалки. | Choose the Fortune Teller's red herring. | Falçının qırmızı siyənəyini seçin. |
| `error.librarian-zero` | Библиотекарь не может узнать «ноль», если в игре есть Изгой, кроме Отшельника. | The Librarian cannot learn "zero" while an Outsider other than the Recluse is in play. | Kitabxanaçı "sıfır" öyrənə bilməz, oyunda Zahiddən başqa Kənarçı varsa. |
| `error.info` | {role}: выберите роль и двух игроков. | {role}: choose a character and two players. | {role}: rol və iki oyunçu seçin. |
| `error.info-pair` | {role}: нужны два разных игрока. | {role}: two different players are required. | {role}: iki fərqli oyunçu lazımdır. |
| `error.info-missing` | {role}: один из игроков не найден. | {role}: one of the players is missing. | {role}: oyunçulardan biri tapılmadı. |
| `error.info-team` | {role}: выбранная роль не того типа. | {role}: the chosen character is the wrong type. | {role}: seçilmiş rol yanlış tipdədir. |
| `error.info-inplay` | {role}: выбранная роль должна быть в игре. | {role}: the chosen character must be in play. | {role}: seçilmiş rol oyunda olmalıdır. |
| `error.info-true` | {role}: хотя бы один из двух должен быть этой ролью или подходящей регистрацией. | {role}: one of the two must be that character or a matching registration. | {role}: ikisindən biri bu rol və ya uyğun qeydiyyat olmalıdır. |
| `error.drunk-info` | Пьяница: выберите ложную роль и двух игроков. | Drunk: choose a false character and two players. | Sərxoş: yalan rol və iki oyunçu seçin. |
| `error.drunk-info-team` | Пьяница: ложная роль должна быть того же типа, что показанная роль. | Drunk: the false character must have the shown role's type. | Sərxoş: yalan rol göstərilən rolla eyni tipdə olmalıdır. |

The UI now fills `{count}`, `{required}`, `{needed}` and `{role}` for the
codes whose values it can see or derive: `error.size`, `error.team`,
`error.bluffs-count` (`needed`/`count`), `error.godfather-minus`,
`error.vigormortis-minus`, `error.composition-impossible` (`count`), and every
`error.info*` key through the per-role code suffix. The remaining
parameterised keys (`error.unknown`, `error.outside-script`,
`error.bluffs-team`, `error.bluffs-outside-script`, `error.bluffs-inplay`,
`error.bluffs-drunk`, `error.bluffs-lunatic`) need the model to carry the role
id, because the Russian message embeds the label without a structured field.

## 5. Model changes still needed (outside this change)

- `src/core/model/rules.ts` and `src/core/engine/setup.ts` errors should carry
  the interpolation values, e.g.
  `{ code: string; message: string; vars?: Record<string, string | number> }`,
  and set `vars.role` (the role id) for `unknown`, `outside-script`,
  `bluffs-team`, `bluffs-outside-script`, `bluffs-inplay`, `bluffs-drunk` and
  `bluffs-lunatic`. `setupProblemText` already spreads `context.vars` over the
  derived values, so the UI needs no further change once the field exists:
  `setupProblemText(error, { roleLabel, vars: error.vars })`.

- `src/core/engine/commands.ts` `bagUpdate`/`setOrder`/`setHerring` return
  errors without a code (invalid script, roles, bluffs, order, herring). Add
  stable `errorCode`s so the screen can localize them.
- `src/core/model/rules.ts` `randomBag` throws
  `Неподдерживаемое число игроков.`, `В сценарии не хватает ролей для N
  игроков.` and `В сценарии не хватает добрых ролей для блефов Демона.` with no
  code; throw a coded result instead.
- `src/core/engine/setup.ts` `info-*` messages embed the role label; moving the
  label to a `{role}` parameter lets the locale keys above stay generic.

## 6. Hooks

- Added: `data-reminders` on the shared reminder checklist,
  `data-info-zero="<info role>"` on the zero checkbox.
- Renamed or removed: none. Existing `data-load-bag` / `data-load-pool` /
  `data-count` / `data-index` hooks are unchanged.

## 7. OpenSpec

- [x] `proposal.md` names `Issue: #171`.
- [x] `specs/app/ui-shell/spec.md` modifies the seat draft, setup secrets and
  bag editor requirements.
- [x] `specs/app/ui-and-privacy/spec.md` modifies public/player privacy and the
  role sheet scenario filter.
- [x] `design.md` records the projection, manual branch, reminder, Traveller,
  direction, rejection and stepper decisions.
- [x] `npx openspec validate --changes --strict` → `9 passed, 0 failed`,
  including `change/velvet-setup-ui-audit-fixes`.
- [x] `npx oxlint` and `npx oxfmt --check` on the four screens, the four new
  modules and the new tests → clean.

## 8. Hand-off outside this change

- `scripts/browser-check.mjs` (owned by the CI/UI-verification owner): the
  `/sheet/{code}` loop seeds `pg.sheetScenario = "all"` and expects five
  Travellers; with SET11 the all-roles sheet shows fifteen, so that assertion
  (`"${code}: five Travellers"`, around line 2946) must become fifteen, or the
  seed must use a single scenario. The BMR assertion "25 BMR + 5 Travellers"
  stays correct.
- `scripts/browser-check.mjs`: no assertion reads role art on `/seat`, so the
  names-only projection needs no other change.

## Evidence

- RED: `node --test src/ui/screens/{seat-projection,secrets-options,sheet-scenarios,setup-messages}.test.ts` → `ERR_MODULE_NOT_FOUND` for every new module before it existed.
- GREEN: `node --test src/ui/screens/{seat-projection,secrets-options,sheet-scenarios,setup-messages,player-projection,structure}.test.ts` → `pass 19, fail 0`; `npx openspec validate --changes --strict` → 11 passed; `npx oxlint` and `npx oxfmt --check` clean on the changed files.
