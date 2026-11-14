// Setup secrets: one-of-two pairs, the Drunk mask, the red herring, the reminder
// list and the host-only roster. Every change is a command; the screen renders
// the published snapshot, so an external write is visible without a reload.
import { useEffect, useRef } from "react";
import type { Player, RoleId, Team } from "../../core/model/types.ts";
import type { InfoRoleId, SetupInfoPatch } from "../../core/commands/contracts.ts";
import { secretsProjection } from "../../application/read-models/table.ts";
import {
  ROLE_REMINDERS_RU,
  isBmrScript,
  isManualScript,
  isSnvScript,
  roleLabel,
  roleTeam,
} from "../../core/model/rules.ts";
import { roleSupportEntries, scriptSupport, type SupportLevel } from "../../core/model/support.ts";
import { SetupShell } from "../components/setup-shell.tsx";
import { useShellPorts } from "../ports.ts";
import { useGame } from "../store/use-game.ts";
import { infoRoleChoices, librarianZeroLegal, reminderRows } from "./secrets-options.ts";
import { commandRejectionText, setupProblemText } from "./setup-messages.ts";

const INFO_ROLES: Array<[RoleId, Team]> = [
  ["washerwoman", "townsfolk"],
  ["librarian", "outsider"],
  ["investigator", "minion"],
];

const INFO_ROLE_IDS: RoleId[] = INFO_ROLES.map(([id]) => id);

const LABEL = "text-[9px] font-semibold uppercase tracking-[0.18em] text-brass";
const NOTE = "secrets-note m-0 text-[11.5px] leading-relaxed text-muted";
const CARD = "secrets-block min-w-0 rounded-md border border-edge bg-crypt-2 p-4";
const INFO = "secrets-info grid gap-3 rounded-md border border-edge bg-crypt-3 p-3";
const FIELD = "secrets-field grid min-w-0 gap-1";
const GRID = "secrets-grid grid min-w-0 gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))]";
const TAG =
  "secrets-tag rounded-sm border border-amber-dim px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-amber";

function isInfoRole(id: string | null): id is "washerwoman" | "librarian" | "investigator" {
  return id !== null && INFO_ROLE_IDS.includes(id);
}

export function SecretsScreen() {
  const ports = useShellPorts();
  const snapshot = useGame(ports.game);
  const state = snapshot.state;
  const t = ports.strings.t;

  const normalized = useRef(false);

  const players = state.order
    .map((id) => state.players[id])
    .filter((player): player is Player => Boolean(player && player.roleId));

  const roleOf = (id: RoleId | null | undefined) => {
    const known = ports.roles.byId(id ?? "");
    return known ?? { id: id ?? "", name: roleLabel(id), team: roleTeam(id ?? ""), ability: "" };
  };

  const displayName = (player: Player | null | undefined) =>
    player ? player.name || t("ui.player") + " " + player.seat : t("none");

  const SUPPORT_LEVEL_KEY: Record<SupportLevel, string> = {
    verified: "scriptLevelVerified",
    "requires-storyteller-choice": "scriptLevelStoryteller",
    unsupported: "scriptLevelUnsupported",
  };

  // The same derived level the bag screen and the rules matrix report. Every
  // non-verified role is listed, so a manual fallback is never hidden.
  const supportSection = (roles: readonly RoleId[]) => {
    if (!roles.length) return null;
    const support = scriptSupport(roles);
    const entries = roleSupportEntries(roles).filter((entry) => entry.status !== "verified");
    return (
      <div
        className={`${CARD} flex flex-col gap-1.5 text-[11.5px] text-muted`}
        data-script-support={support.level}
      >
        <span className={LABEL}>{t("roleSupport")}</span>
        <p className="m-0">
          <b className="text-parchment">{t(SUPPORT_LEVEL_KEY[support.level])}</b>
        </p>
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
          {t("scriptSupportVerified", { count: support.counts.verified })} ·{" "}
          {t("scriptSupportStoryteller", {
            count: support.counts["requires-storyteller-choice"],
          })}{" "}
          · {t("scriptSupportUnsupported", { count: support.counts.unsupported })}
        </p>
        {entries.length ? (
          <ul className="m-0 grid list-none gap-1.5 p-0 text-[12.5px]">
            {entries.map((entry) => (
              <li key={entry.roleId} data-role={entry.roleId} data-status={entry.status}>
                <b className="text-parchment">{roleOf(entry.roleId).name}</b> ·{" "}
                {t("roleSupport." + entry.status)}
                <span className="block text-[12px] text-muted">{t(entry.detail)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  };

  const startNight = () => {
    const result = ports.commands.startNight();
    if (result.status !== "allowed") {
      window.alert(commandRejectionText(result) || t("setupErrors"));
      return;
    }
    ports.router.go("/table");
  };

  // A Librarian with no Outsider must hold the zero information; the legacy
  // screen normalized this once on mount, and the command is idempotent.
  useEffect(() => {
    if (normalized.current) return;
    const current = Object.values(state.players);
    if (!current.some((player) => player.roleId === "librarian")) return;
    if (current.some((player) => roleTeam(player.roleId ?? "") === "outsider")) return;
    const info = state.setup.info.librarian;
    if (info && "zero" in info) return;
    normalized.current = true;
    ports.commands.normalizeSecrets();
  }, [state, ports]);

  const errors = secretsProjection(state).errors;

  const statusMarkup = () =>
    errors.length ? (
      <div
        className="secrets-status is-bad flex flex-col gap-1 rounded-md border border-crimson-dim bg-crimson-dim/30 p-3 text-[12px] text-danger"
        role="status"
      >
        <b>{t("setupErrors")}</b>
        <ul className="m-0 grid list-disc gap-0.5 pl-4">
          {errors.map((error, index) => (
            <li key={error.code + ":" + index}>
              {setupProblemText(error, { roleLabel: (id) => roleOf(id).name })}
            </li>
          ))}
        </ul>
      </div>
    ) : (
      <p className="secrets-status is-ok m-0 rounded-md border border-amber-dim bg-crypt-3 px-3 py-2.5 text-[12px] text-amber">
        {t("legal")}
      </p>
    );

  const sectionHead = (numeral: string, id: string, title: string, lead: string | null) => (
    <div className="secrets-block-head flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-baseline gap-3">
        {numeral ? (
          <span className="font-role text-[26px] leading-none tabular-nums text-muted/60">
            {numeral}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2
            id={id}
            className="m-0 font-role text-[22px] leading-tight tracking-[-0.01em] text-parchment md:text-[26px]"
          >
            {title}
          </h2>
          {lead ? <p className={`mt-1 ${NOTE}`}>{lead}</p> : null}
        </div>
      </div>
    </div>
  );

  const pageHead = (title: string, lead: string) => (
    <div className="secrets-head flex flex-wrap items-start justify-between gap-3 border-b border-edge pb-4">
      <div>
        <p className={LABEL}>{t("secrets")}</p>
        <h1 className="m-0 mt-1 font-role text-[26px] leading-tight text-parchment md:text-[30px]">
          {title}
        </h1>
        <p className={`secrets-intro mt-1 max-w-[720px] ${NOTE}`}>{lead}</p>
      </div>
    </div>
  );

  // The checklist lists every role in play that has Storyteller reminders, so
  // Bad Moon Rising and Sects & Violets show theirs like Trouble Brewing does.
  const reminders = reminderRows(
    state.setup.roles || [],
    ROLE_REMINDERS_RU,
    (id) => roleOf(id).name,
  );
  const remindersMarkup = reminders.length ? (
    <section className={CARD} aria-labelledby="secrets-reminders">
      {sectionHead("", "secrets-reminders", t("remindersToPlace"), null)}
      <ul className="secrets-reminders m-0 mt-2 grid list-none gap-0 p-0" data-reminders>
        {reminders.map((row) => (
          <li
            className="flex flex-wrap justify-between gap-x-3 border-b border-edge py-1.5 text-[12.5px]"
            key={row.roleId}
          >
            <b className="font-medium text-parchment">{row.name}</b>
            <span className="text-muted">{row.tokens.join(" · ")}</span>
          </li>
        ))}
      </ul>
    </section>
  ) : null;

  // A manual pool is resolved by the host, so it gets the manual screen even
  // when it contains BMR or S&V roles.
  const manual = isManualScript(state.script);

  if (!manual && isBmrScript(state.script)) {
    const has = (roleId: RoleId) => (state.setup.roles || []).includes(roleId);
    const lunatic = state.setup.lunaticShownId ? roleLabel(state.setup.lunaticShownId) : null;
    return (
      <SetupShell step="secrets">
        <div className="secrets mt-6 grid gap-5">
          {pageHead(t("bmrSecretsTitle"), t("bmrSecretsHint"))}
          <div className="rounded-md border border-amber-dim bg-amber-dim/40 p-3">
            <b className="text-[13px] text-parchment">{t("bmrHostWarningTitle")}</b>
            <p className={`mt-1 ${NOTE}`}>{t("bmrHostWarning")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <span className={LABEL}>{t("bmrGodfather")}</span>
              <p className="m-0 text-[13px]">
                {has("godfather")
                  ? state.setup.godfatherOutsider === -1
                    ? t("godfatherMinus")
                    : t("godfatherPlus")
                  : t("none")}
              </p>
            </div>
            <div className="grid gap-1">
              <span className={LABEL}>{t("lunaticShown")}</span>
              <p className="m-0 text-[13px]">
                {has("lunatic") ? lunatic || roleLabel("po") : t("none")}
              </p>
            </div>
          </div>
          {supportSection(state.setup.roles || [])}
          {remindersMarkup}
          {statusMarkup()}
          <div className="flex flex-wrap items-center gap-2">
            <a className="btn" href={ports.router.path("bag")}>
              {t("setup")}
            </a>
            <button
              className="btn btn--accent"
              type="button"
              data-act="bmr-start"
              disabled={Boolean(errors.length)}
              onClick={startNight}
            >
              {t("startFirstNight")}
            </button>
          </div>
        </div>
      </SetupShell>
    );
  }

  if (!manual && isSnvScript(state.script)) {
    const has = (roleId: RoleId) => (state.setup.roles || []).includes(roleId);
    const twin = state.setup.evilTwinGoodId ? roleLabel(state.setup.evilTwinGoodId) : null;
    return (
      <SetupShell step="secrets">
        <div className="secrets mt-6 grid gap-5">
          {pageHead(t("svSecretsTitle"), t("svSecretsHint"))}
          <div className="rounded-md border border-amber-dim bg-amber-dim/40 p-3">
            <b className="text-[13px] text-parchment">{t("bmrHostWarningTitle")}</b>
            <p className={`mt-1 ${NOTE}`}>{t("svHostWarning")}</p>
          </div>
          {supportSection(state.setup.roles || [])}
          <div className="grid gap-1">
            <span className={LABEL}>{t("evilTwinGood")}</span>
            <p className="m-0 text-[13px]">{has("eviltwin") ? twin || t("none") : t("none")}</p>
          </div>
          {remindersMarkup}
          {statusMarkup()}
          <div className="flex flex-wrap items-center gap-2">
            <a className="btn" href={ports.router.path("bag")}>
              {t("setup")}
            </a>
            <button
              className="btn btn--accent"
              type="button"
              data-act="sv-start"
              disabled={Boolean(errors.length)}
              onClick={startNight}
            >
              {t("startFirstNight")}
            </button>
          </div>
        </div>
      </SetupShell>
    );
  }

  if (!players.length) {
    return (
      <SetupShell step="secrets">
        <div className="secrets secrets-empty mx-auto grid w-full max-w-[460px] place-items-center gap-2 px-5 py-24 text-center">
          <div className="secrets-head grid place-items-center gap-2">
            <p className={LABEL}>{t("secrets")}</p>
            <h1 className="m-0 font-role text-[26px] leading-tight text-parchment">
              {t("noRoles")}
            </h1>
          </div>
          <a className="btn btn--accent mt-2" href={ports.router.path("bag")}>
            {t("setup")}
          </a>
        </div>
      </SetupShell>
    );
  }

  const realHas = (roleId: RoleId) => players.some((player) => player.roleId === roleId);
  const drunk = players.find((player) => player.roleId === "drunk");
  const drunkMask = drunk ? drunk.shownRoleId : null;

  const updateInfo = (roleId: InfoRoleId, patch: SetupInfoPatch) => {
    ports.commands.setSetupInfo(roleId, {
      ...patch,
      ...(roleId === drunkMask ? { forDrunk: true } : {}),
    });
  };

  const pairOf = (roleId: RoleId): [string, string] => {
    const info = state.setup.info[roleId as InfoRoleId];
    if (!info || !("pair" in info) || info.pair.length !== 2) return ["", ""];
    return [info.pair[0] ?? "", info.pair[1] ?? ""];
  };

  const roleOfInfo = (roleId: RoleId): string => {
    const info = state.setup.info[roleId as InfoRoleId];
    return info && "roleId" in info ? info.roleId : "";
  };

  const playerOptions = (roleIds: RoleId[]) =>
    roleIds.map((id) => (
      <option key={id} value={id}>
        {roleOf(id).name}
      </option>
    ));

  const playerSelect = (roleId: RoleId, index: 0 | 1, label: string) => {
    const pair = pairOf(roleId);
    return (
      <label className={FIELD}>
        <span className={LABEL}>{label}</span>
        <select
          className="field"
          data-player={"pair-" + (index === 0 ? "a" : "b") + "-" + roleId}
          value={pair[index] ?? ""}
          onChange={(event) => {
            const next: [string, string] = [pair[0] ?? "", pair[1] ?? ""];
            next[index] = event.target.value;
            updateInfo(roleId as "washerwoman" | "librarian" | "investigator", { pair: next });
          }}
        >
          <option value="">{t("ui.choosePlayer")}</option>
          {players.map((player) => (
            <option key={player.id} value={player.id}>
              {displayName(player)} ({player.seat}) · {roleOf(player.roleId).name}
            </option>
          ))}
        </select>
      </label>
    );
  };

  const infoEditor = (roleId: RoleId, team: Team, label: string, forDrunk = false) => {
    if (!forDrunk && !realHas(roleId)) return null;
    const held = players.map((player) => player.roleId).filter((id): id is RoleId => Boolean(id));
    // A Spy may register as a Townsfolk or an Outsider and a Recluse as a
    // Minion, so their not-in-play characters are legal shown answers.
    const registering = team === "minion" ? held.includes("recluse") : held.includes("spy");
    const roleOptions = infoRoleChoices({
      team,
      forDrunk,
      held,
      scriptRoles: state.script?.roles ?? [],
      registering,
    });
    // The zero is a shaped answer only the Librarian gives, and a Drunk shown
    // the Librarian may be told it as false information. A stored zero stays
    // editable even if the game changed, so the host can correct it.
    const stored = state.setup.info[roleId as InfoRoleId];
    const zeroInfo = Boolean(stored && "zero" in stored);
    const zeroAllowed =
      roleId === "librarian" && (forDrunk || zeroInfo || librarianZeroLegal(players));
    const infoRoleId = roleOfInfo(roleId);
    return (
      <div className={INFO} key={roleId}>
        <div className="secrets-info-head flex items-center justify-between gap-2">
          <h3 className="m-0 font-role text-[17px] leading-tight text-parchment">{label}</h3>
          <span className={TAG}>{forDrunk ? t("ui.drunk") : t("infoPair")}</span>
        </div>
        {zeroAllowed ? (
          <label className="flex items-center gap-2 text-[12px]">
            <input
              className="size-4 accent-accent"
              type="checkbox"
              data-info-zero={roleId}
              checked={zeroInfo}
              onChange={(event) =>
                updateInfo(
                  roleId as "washerwoman" | "librarian" | "investigator",
                  event.target.checked ? { zero: true } : { roleId: "", pair: ["", ""] },
                )
              }
            />
            <span>{t("zeroOutsiders")}</span>
          </label>
        ) : null}
        {zeroInfo ? (
          <p className={NOTE}>{t("zeroOutsiders")}.</p>
        ) : (
          <div className={GRID}>
            <label className={FIELD}>
              <span className={LABEL}>{t("roleInPlay")}</span>
              <select
                className="field"
                data-info-role={roleId}
                value={infoRoleId}
                onChange={(event) =>
                  updateInfo(roleId as "washerwoman" | "librarian" | "investigator", {
                    roleId: event.target.value,
                    pair: ["", ""],
                  })
                }
              >
                <option value="">{t("ui.chooseRole")}</option>
                {playerOptions(roleOptions)}
              </select>
            </label>
            {playerSelect(roleId, 0, t("ui.player1"))}
            {playerSelect(roleId, 1, t("ui.player2"))}
          </div>
        )}
      </div>
    );
  };

  const drunkInfoEditor = () => {
    if (!isInfoRole(drunkMask)) return null;
    const team: Team =
      drunkMask === "washerwoman" ? "townsfolk" : drunkMask === "librarian" ? "outsider" : "minion";
    return infoEditor(drunkMask, team, t("ui.drunk") + ": " + roleOf(drunkMask).name, true);
  };

  const herringEditor = () => {
    if (!realHas("fortuneteller")) return null;
    const good = players.filter((player) => {
      const team = roleTeam(player.roleId ?? "");
      return team !== "minion" && team !== "demon";
    });
    return (
      <div className={INFO}>
        <div className="secrets-info-head flex items-center justify-between gap-2">
          <h3 className="m-0 font-role text-[17px] leading-tight text-parchment">{t("herring")}</h3>
          <span className={TAG}>{t("forced")}</span>
        </div>
        <label className={`${FIELD} sm:max-w-[340px]`}>
          <span className={LABEL}>{t("herring")}</span>
          <select
            className="field"
            data-herring
            value={state.setup.herringId ?? ""}
            onChange={(event) => ports.commands.setHerring(event.target.value || null)}
          >
            <option value="">{t("ui.choosePlayer")}</option>
            {good.map((player) => (
              <option key={player.id} value={player.id}>
                {displayName(player)} · {roleOf(player.roleId).name}
              </option>
            ))}
          </select>
        </label>
        <p className={NOTE}>{t("ui.permanentHerring")}</p>
      </div>
    );
  };

  const claimed = players.filter((player) => player.claimed).length;
  const everyoneNamed = claimed === players.length;
  const seated = state.phase === "seat";

  return (
    <SetupShell step="secrets">
      <div className="secrets mx-auto w-full max-w-[1680px] flex flex-1 flex-col">
        <div className="px-3.5 pt-3">{statusMarkup()}</div>

        <main className="secrets-shell grid border-t border-edge max-lg:grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)_330px] lg:items-start">
          <aside className="grid content-start gap-2.5 border-r border-edge bg-gradient-to-b from-crypt-2 to-crypt p-3.5 max-lg:border-r-0 max-lg:border-b">
            <div className="secrets-head phase-card rounded-md border border-edge bg-crypt-2 p-3">
              <span className="inline-flex items-center gap-1 rounded-[4px] border border-amber-dim px-1.5 py-0.5 text-[8.5px] uppercase tracking-[.13em] text-amber">
                {t("secrets")}
              </span>
              <h1 className="mt-1.5 font-role text-[24px] font-normal leading-none text-parchment">
                Пары
              </h1>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">{t("secretsIntro")}</p>
            </div>
            {remindersMarkup}
          </aside>

          <section className="grid min-w-0 content-start gap-3 p-3.5 max-lg:border-b max-lg:border-edge">
            <div className="flex flex-wrap items-center gap-3 border-b border-edge pb-2.5">
              <div className="grid">
                <b className="font-role text-[14px] font-normal leading-[1.2] tracking-[.05em] text-text">
                  Секреты сценария
                </b>
                <small className="mt-0.5 text-[9px] uppercase tracking-[.13em] text-muted">
                  {state.script ? state.script.name : ""} · {players.length} {t("players")}
                </small>
              </div>
              <div className="ml-auto flex gap-1">
                <span className="flex items-center gap-1.5 rounded-[4px] border border-brass/30 px-2 py-[5px] text-[8px] uppercase tracking-[.1em] text-brass">
                  <i className="size-1 rounded-full bg-current" aria-hidden="true" />
                  Сбор
                </span>
                <span className="flex items-center gap-1.5 rounded-[4px] border border-amber-dim bg-amber-dim/20 px-2 py-[5px] text-[8px] uppercase tracking-[.1em] text-amber">
                  <i className="size-1 rounded-full bg-current" aria-hidden="true" />
                  {t("secrets")}
                </span>
                <span className="flex items-center gap-1.5 rounded-[4px] border border-edge px-2 py-[5px] text-[8px] uppercase tracking-[.1em] text-muted/70">
                  <i className="size-1 rounded-full bg-current" aria-hidden="true" />
                  {t("night")}
                </span>
              </div>
            </div>
            <section className={CARD} aria-labelledby="secrets-herring">
              {sectionHead("", "secrets-herring", t("herring"), null)}
              <div className="mt-3">{herringEditor()}</div>
            </section>
            <div className="grid gap-2.5">
              {INFO_ROLES.map(([roleId, team]) => infoEditor(roleId, team, roleOf(roleId).name))}
              {drunkInfoEditor()}
            </div>
            <section className={CARD} aria-labelledby="secrets-roster">
              {sectionHead(
                "",
                "secrets-roster",
                t("rolesReview"),
                `${t("warning")}: ${t("discussWarning")}`,
              )}
              <div className="secrets-roster mt-3 grid gap-1.5 sm:grid-cols-2">
                {players.map((player) => {
                  const role = roleOf(player.roleId);
                  const shown =
                    player.shownRoleId && player.shownRoleId !== player.roleId
                      ? roleOf(player.shownRoleId)
                      : null;
                  const image = ports.roles.image(ports.roles.byId(player.roleId ?? ""));
                  return (
                    <div
                      className="secrets-player grid min-w-0 grid-cols-[20px_30px_minmax(0,1fr)] items-center gap-2 rounded-sm border border-edge bg-crypt-3 p-2"
                      key={player.id}
                    >
                      <span className="secrets-seat text-[11px] tabular-nums text-brass">
                        {player.seat}
                      </span>
                      {image ? <img className="size-8 object-contain" src={image} alt="" /> : null}
                      <span className="secrets-player-body min-w-0">
                        <b className="block truncate text-[12.5px] font-medium text-parchment">
                          {displayName(player)}
                        </b>
                        <span className="block text-[11px] text-muted">
                          {role.name} · {ports.strings.teamText(role.team ?? "")}
                        </span>
                        {shown ? (
                          <span className="secrets-shown block text-[11px] text-amber">
                            {t("shownRole")}: {shown.name}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          </section>

          <aside className="secrets-dock grid content-start gap-2 border-l border-edge bg-gradient-to-b from-crypt-2 to-crypt p-3.5 max-lg:border-l-0 max-lg:border-t">
            <h2 className="m-0 flex items-center justify-between text-[9px] uppercase tracking-[.18em] text-muted">
              Готовность
              <b className="font-semibold tracking-[.06em] text-text">
                {errors.length ? `${errors.length}` : "✓"}
              </b>
            </h2>
            <ul className="m-0 grid list-none gap-1 p-0 text-[10px]">
              <li className="flex items-center justify-between gap-2">
                <b className="font-medium text-text">{t("infoRoles")}</b>
                <span className={errors.length ? "text-amber" : "text-outsider"}>
                  {errors.length ? "○ проверить" : "✓ готово"}
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <b className="font-medium text-text">{t("herring")}</b>
                <span className={state.setup.herringId ? "text-outsider" : "text-muted"}>
                  {state.setup.herringId ? "✓ выбрана" : "○ выбрать"}
                </span>
              </li>
            </ul>
            <a className="btn max-lg:w-full" href={ports.router.path("seat")}>
              {t("seats")}
            </a>
            {!everyoneNamed ? (
              <a className="btn btn--accent max-lg:w-full" href={ports.router.path("player")}>
                {t("ui.namesFirst")}
              </a>
            ) : !seated ? (
              <a className="btn btn--accent max-lg:w-full" href={ports.router.path("seat")}>
                {t("ui.seats")}
              </a>
            ) : (
              <button
                className="btn btn--accent max-lg:w-full"
                type="button"
                data-act="start"
                disabled={Boolean(errors.length)}
                onClick={startNight}
              >
                {t("startFirstNight")}
              </button>
            )}
            <p className="m-0 text-[10px] leading-relaxed text-muted">{t("discussWarning")}</p>
          </aside>
        </main>
      </div>
    </SetupShell>
  );
}
