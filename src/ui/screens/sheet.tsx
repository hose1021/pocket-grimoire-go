// The first native screen. It is read-only: the filter and the language are UI
// preferences, and nothing here dispatches a command or writes the saved game.
// Styling is Tailwind only; `css/sheet.css` is gone. The legacy class names
// remain as inert hooks for the browser checks.
import { useEffect, useState } from "react";
import type { Role } from "../../core/model/types.ts";
import { RoleCard } from "../components/arcane/role-card.tsx";
import { ArcaneAppBar } from "../components/arcane/app-bar.tsx";
import { useShellPorts } from "../ports.ts";
import { useGame } from "../store/use-game.ts";
import { ALL_TRAVELLER_IDS, SCENARIO_TRAVELLERS, type SheetScenario } from "./sheet-scenarios.ts";

type ScenarioKey = SheetScenario;

const TB_IDS = [
  "washerwoman",
  "librarian",
  "investigator",
  "chef",
  "empath",
  "fortuneteller",
  "undertaker",
  "monk",
  "ravenkeeper",
  "virgin",
  "slayer",
  "soldier",
  "mayor",
  "butler",
  "saint",
  "recluse",
  "drunk",
  "poisoner",
  "spy",
  "baron",
  "scarletwoman",
  "imp",
];

const BMR_IDS = [
  "chambermaid",
  "courtier",
  "exorcist",
  "fool",
  "gambler",
  "gossip",
  "grandmother",
  "innkeeper",
  "minstrel",
  "pacifist",
  "professor",
  "sailor",
  "tealady",
  "goon",
  "lunatic",
  "moonchild",
  "tinker",
  "assassin",
  "devilsadvocate",
  "godfather",
  "mastermind",
  "po",
  "pukka",
  "shabaloth",
  "zombuul",
];

const SNV_IDS = [
  "artist",
  "clockmaker",
  "dreamer",
  "flowergirl",
  "juggler",
  "mathematician",
  "oracle",
  "philosopher",
  "sage",
  "savant",
  "seamstress",
  "snakecharmer",
  "towncrier",
  "barber",
  "klutz",
  "mutant",
  "sweetheart",
  "cerenovus",
  "eviltwin",
  "pithag",
  "witch",
  "fanggu",
  "nodashii",
  "vigormortis",
  "vortox",
];

const STANDARD_IDS = TB_IDS.concat(BMR_IDS, SNV_IDS);
const SHEET_IDS = STANDARD_IDS.concat(ALL_TRAVELLER_IDS);

// The sheet filter is a reading preference: it never touches game setup.
const SCENARIOS: Record<ScenarioKey, readonly string[]> = {
  tb: TB_IDS,
  bmr: BMR_IDS,
  snv: SNV_IDS,
  all: STANDARD_IDS,
};
const SCENARIO_ORDER: readonly ScenarioKey[] = ["tb", "bmr", "snv", "all"];
const SCENARIO_LABELS: Record<ScenarioKey, string> = {
  tb: "sheetScenarioTb",
  bmr: "sheetScenarioBmr",
  snv: "sheetScenarioSnv",
  all: "sheetScenarioAll",
};
const SCENARIO_KEY = "pg.sheetScenario";
const TRAVELLERS_KEY = "pg.sheetTravellers";

const TEAMS = ["townsfolk", "outsider", "minion", "demon"] as const;

const TEAM_BORDER: Record<string, string> = {
  townsfolk: "data-[team=townsfolk]:border-l-townsfolk",
  outsider: "data-[team=outsider]:border-l-outsider",
  minion: "data-[team=minion]:border-l-minion",
  demon: "data-[team=demon]:border-l-demon",
  traveller: "data-[team=traveller]:border-l-traveller",
};
const TEAM_DOT: Record<string, string> = {
  townsfolk: "group-data-[team=townsfolk]:bg-townsfolk",
  outsider: "group-data-[team=outsider]:bg-outsider",
  minion: "group-data-[team=minion]:bg-minion",
  demon: "group-data-[team=demon]:bg-demon",
  traveller: "group-data-[team=traveller]:bg-traveller",
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SheetScreenProps {
  lang: string;
}

export function SheetScreen({ lang }: SheetScreenProps) {
  const ports = useShellPorts();
  const game = useGame(ports.game);
  const [attempt, setAttempt] = useState(0);
  const [catalog, setCatalog] = useState<Role[] | null>(() =>
    ports.locale.current() === lang ? ports.roles.all() : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ScenarioKey>(() => {
    const saved = ports.prefs.read(SCENARIO_KEY);
    if (saved && Object.hasOwn(SCENARIOS, saved)) return saved as ScenarioKey;
    const scriptId = game.state.script?.id;
    return scriptId === "bmr" || scriptId === "snv" ? scriptId : "tb";
  });
  const [showTravellers, setShowTravellers] = useState(
    () => ports.prefs.read(TRAVELLERS_KEY) === "true",
  );

  useEffect(() => {
    let alive = true;
    setError(null);
    const apply = () => {
      ports.locale.use(lang);
      setCatalog(ports.roles.all());
    };
    if (ports.locale.current() === lang) {
      apply();
      return () => {
        alive = false;
      };
    }
    setCatalog(null);
    ports.locale
      .load(lang)
      .then(() => {
        if (alive) apply();
      })
      .catch((failure: unknown) => {
        if (alive) setError(messageOf(failure));
      });
    return () => {
      alive = false;
    };
  }, [lang, attempt, ports]);

  const chooseScenario = (next: ScenarioKey) => {
    if (next === scenario) return;
    setScenario(next);
    ports.prefs.write(SCENARIO_KEY, next);
  };

  const toggleTravellers = () => {
    const next = !showTravellers;
    setShowTravellers(next);
    ports.prefs.write(TRAVELLERS_KEY, String(next));
  };

  const byId = new Map((catalog ?? []).map((role) => [role.id, role]));
  const standard = SCENARIOS[scenario]
    .map((id) => byId.get(id))
    .filter((role): role is Role => role !== undefined);
  const missing = catalog ? SHEET_IDS.filter((id) => !byId.has(id)) : [];
  const travellerIds = SCENARIO_TRAVELLERS[scenario];
  const travellers = travellerIds
    .map((id) => byId.get(id))
    .filter((role): role is Role => role !== undefined);
  const summaryCount = SCENARIOS[scenario].length;
  const summary = `${ports.strings.t(SCENARIO_LABELS[scenario])} · ${summaryCount} ${ports.strings.roleCount(summaryCount)}`;

  return (
    <>
      <ArcaneAppBar current="sheet" />
      <div
        className="sheet-page mx-auto min-w-0 w-[min(1180px,100%)] px-4 pb-12 pt-3.5 max-[680px]:px-3 max-[680px]:pb-10 max-[680px]:pt-3"
        aria-busy={catalog === null}
      >
        <header className="sheet-head flex flex-wrap items-start justify-between gap-3.5 border-b border-edge pb-4 pt-1">
          <div className="min-w-0">
            <div className="min-w-0">
              <h1 className="mb-0.5 mt-0 font-role text-[clamp(22px,3vw,30px)] font-normal leading-none text-text">
                {ports.strings.t("roleSheet")}
              </h1>
              <p className="m-0 mt-1.5 text-[11px] leading-[1.45] text-muted max-[680px]:text-[12px]">
                {ports.strings.t("roleSheetIntro")}
              </p>
              <p
                className="sheet-summary m-0 mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber"
                data-sheet-summary=""
                aria-live="polite"
              >
                {summary}
              </p>
            </div>
          </div>
          <div
            className="sheet-filters flex grow shrink-0 basis-full flex-wrap items-center gap-1.5 max-[680px]:gap-1.25"
            data-sheet-filters=""
          >
            <span
              className="text-[9px] font-[650] uppercase tracking-[0.18em] text-brass max-[680px]:basis-full"
              id="sheet-scenario-label"
            >
              {ports.strings.t("sheetScenario")}
            </span>
            <div
              className="sheet-scenario-group flex flex-wrap gap-1 max-[680px]:grid max-[680px]:grid-cols-3 max-[680px]:gap-1.25"
              role="group"
              aria-labelledby="sheet-scenario-label"
            >
              {SCENARIO_ORDER.map((id) => {
                const on = id === scenario;
                return (
                  <button
                    key={id}
                    type="button"
                    className={
                      on
                        ? "sheet-scenario-btn is-on inline-flex min-h-11 items-center justify-center gap-1.75 rounded-sm border border-amber-dim bg-amber-dim px-2.5 py-1.75 text-[11px] uppercase tracking-[0.1em] text-amber no-underline disabled:cursor-not-allowed disabled:opacity-40 max-[680px]:px-1.5 max-[680px]:py-1 max-[680px]:text-[10.5px]/[1.2]"
                        : "sheet-scenario-btn inline-flex min-h-11 items-center justify-center gap-1.75 rounded-sm border border-edge-2 bg-crypt-2 px-2.5 py-1.75 text-[11px] uppercase tracking-[0.1em] text-muted no-underline transition-colors hover:bg-crypt-3 hover:text-text disabled:cursor-not-allowed disabled:opacity-40 max-[680px]:px-1.5 max-[680px]:py-1 max-[680px]:text-[10.5px]/[1.2]"
                    }
                    data-scenario={id}
                    aria-pressed={on}
                    onClick={() => chooseScenario(id)}
                  >
                    {ports.strings.t(SCENARIO_LABELS[id])}
                    <span
                      className={
                        on
                          ? "sheet-filter-count tabular-nums text-[10.5px] text-inherit opacity-75"
                          : "sheet-filter-count tabular-nums text-[10.5px] text-muted"
                      }
                    >
                      {SCENARIOS[id].length}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={
                showTravellers
                  ? "sheet-travellers-btn is-on inline-flex min-h-11 items-center justify-center gap-1.75 rounded-sm border border-amber-dim bg-amber-dim px-2.5 py-1.75 text-[11px] uppercase tracking-[0.1em] text-amber no-underline disabled:cursor-not-allowed disabled:opacity-40 max-[680px]:grow max-[680px]:shrink-0 max-[680px]:basis-full"
                  : "sheet-travellers-btn inline-flex min-h-11 items-center justify-center gap-1.75 rounded-sm border border-edge-2 bg-crypt-2 px-2.5 py-1.75 text-[11px] uppercase tracking-[0.1em] text-muted no-underline transition-colors hover:bg-crypt-3 hover:text-text disabled:cursor-not-allowed disabled:opacity-40 max-[680px]:grow max-[680px]:shrink-0 max-[680px]:basis-full"
              }
              data-travellers=""
              aria-pressed={showTravellers}
              onClick={toggleTravellers}
            >
              {ports.strings.t("sheetTravellersToggle")}
              <span
                className={
                  showTravellers
                    ? "sheet-filter-count tabular-nums text-[10.5px] text-inherit opacity-75"
                    : "sheet-filter-count tabular-nums text-[10.5px] text-muted"
                }
              >
                {travellerIds.length}
              </span>
            </button>
          </div>
        </header>

        {error ? (
          <div
            className="host-alert is-bad mt-3 grid gap-2 rounded-md border border-crimson-dim bg-crimson-dim/20 p-3 text-[12px] leading-[1.5] text-danger"
            role="alert"
          >
            <p className="m-0 font-semibold">{ports.strings.t("screenFailed")}</p>
            <p className="m-0">{error}</p>
            <button
              type="button"
              className="inline-flex min-h-11 w-fit items-center justify-center gap-1.5 rounded-sm border border-edge-2 bg-crypt-2 px-3 py-2 text-[12px] font-medium text-text transition-colors hover:border-brass/60 hover:bg-crypt-3 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {ports.strings.t("retry")}
            </button>
          </div>
        ) : null}

        {missing.length ? (
          <div className="host-alert is-bad mt-3 rounded-md border border-crimson-dim bg-crimson-dim/20 p-3 text-[12px] text-danger">{`Нет данных для ролей: ${missing.join(", ")}.`}</div>
        ) : null}

        <main className="sheet-sections mt-3.5 grid gap-2.5" data-sheet-sections="">
          {TEAMS.map((team) => {
            const roles = standard.filter((role) => role.team === team);
            if (!roles.length) return null;
            return (
              <section
                key={team}
                className={`sheet-team group min-w-0 rounded-md border border-l-[3px] border-edge bg-crypt-2 p-3 ${TEAM_BORDER[team]}`}
                data-team={team}
              >
                <div className="sheet-team-head mb-2 flex items-center gap-2">
                  <span
                    className={`sheet-team-dot size-2 rounded-full ${TEAM_DOT[team]}`}
                    aria-hidden="true"
                  />
                  <h2 className="m-0 text-[14px] font-semibold tracking-[0.02em] text-text">
                    {ports.strings.teamText(team)}
                  </h2>
                  <span className="sheet-team-count ml-auto text-[9px] tabular-nums text-muted">
                    {roles.length}
                  </span>
                </div>
                <div className="sheet-grid grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-1.5 max-[680px]:grid-cols-1">
                  {roles.map((role) => (
                    <div key={role.id} className="sheet-role min-w-0" data-role-id={role.id}>
                      <RoleCard
                        role={{
                          name: role.name,
                          teamLabel: ports.strings.teamText(role.team),
                          ability: role.ability ?? "",
                        }}
                        image={ports.roles.image(role)}
                        orientation="row"
                        mode="compact"
                        className="h-full transition-colors hover:border-brass/50"
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          {showTravellers && travellers.length ? (
            <div
              className="sheet-travellers mt-0.5 grid gap-2 border-t border-dashed border-edge-2 pt-3.5"
              id="sheet-travellers"
            >
              <p className="sheet-travellers-note m-0 text-[11px] leading-[1.45] text-muted">
                {ports.strings.t("sheetTravellersNote")}
              </p>
              <section
                className={`sheet-team group min-w-0 rounded-md border border-l-[3px] border-edge bg-crypt-2 p-3 ${TEAM_BORDER.traveller}`}
                data-team="traveller"
              >
                <div className="sheet-team-head mb-2 flex items-center gap-2">
                  <span
                    className={`sheet-team-dot size-2 rounded-full ${TEAM_DOT.traveller}`}
                    aria-hidden="true"
                  />
                  <h2 className="m-0 text-[14px] font-semibold tracking-[0.02em] text-text">
                    {ports.strings.teamText("traveller")}
                  </h2>
                  <span className="sheet-team-count ml-auto text-[9px] tabular-nums text-muted">
                    {travellers.length}
                  </span>
                </div>
                <div className="sheet-grid grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-1.5 max-[680px]:grid-cols-1">
                  {travellers.map((role) => (
                    <div key={role.id} className="sheet-role min-w-0" data-role-id={role.id}>
                      <RoleCard
                        role={{
                          name: role.name,
                          teamLabel: ports.strings.teamText(role.team),
                          ability: role.ability ?? "",
                        }}
                        image={ports.roles.image(role)}
                        orientation="row"
                        mode="compact"
                        className="h-full transition-colors hover:border-brass/50"
                      />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}
        </main>

        <footer className="sheet-foot mt-4 flex flex-wrap gap-x-3.5 gap-y-1 border-t border-edge pt-3 text-[11px] leading-[1.5] text-muted">
          <p className="m-0">{ports.strings.t("nightExceptFirst")}</p>
          <p className="m-0">{ports.strings.t("roleSheetHint")}</p>
        </footer>
      </div>
    </>
  );
}
