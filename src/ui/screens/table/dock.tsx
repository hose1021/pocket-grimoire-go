// The fixed action dock. It is the only animated-free, always-visible surface
// for the current step, the engine preview, the rejection reason and the two
// action rows; the table above it stays a reading surface.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { livingPlayers, orderedPlayers, playerById } from "../../../core/model/state.ts";
import { isManualScript } from "../../../core/model/rules.ts";
import { tableProjection } from "../../../application/read-models/table.ts";
import { displayName, previewIdentity, stepTitle, timerText } from "./helpers.ts";
import { ConsequenceList } from "./parts.tsx";
import { stepContext } from "./step-context.ts";
import type { StepBlocker } from "./helpers.ts";
import type { TableView } from "./view.ts";

const DISABLED_ACTION =
  "disabled:!border-edge-2 disabled:!bg-transparent disabled:!text-muted disabled:!opacity-100";
const PRIMARY_ACTION = `btn min-h-11 !justify-center !border-table-primary !bg-table-primary !bg-none font-semibold !text-table-primary-ink ${DISABLED_ACTION}`;
const SECONDARY_ACTION = `btn min-h-11 !justify-center border-table-secondary !bg-table-secondary/15 !bg-none text-table-secondary ${DISABLED_ACTION}`;
const DANGER_ACTION = `btn min-h-11 !justify-center !border-table-danger !bg-table-danger !bg-none !text-parchment ${DISABLED_ACTION}`;
const QUIET_ACTION = "btn btn--quiet min-h-11 !justify-center";
const ICON_BUTTON =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-sm border border-edge-2 text-muted";

function blockerText(
  blocker: StepBlocker,
  minTargets: number,
  t: TableView["ports"]["strings"]["t"],
) {
  if (blocker === "targets") return t("ui.blockTargets", { count: minTargets });
  if (blocker === "secrets") return t("ui.blockSecrets");
  if (blocker === "given") return t("ui.blockGiven");
  return t("ui.blockRedirect");
}

export function TableDock({ view }: { view: TableView }) {
  const { state, ports, drafts, actions, viewVersion } = view;
  const t = ports.strings.t;
  const projection = tableProjection(state);
  const step = state.phase === "night" ? projection.step : null;
  const context = step ? stepContext(state, drafts, step) : null;
  const stepPreview = useMemo(
    () =>
      step && context
        ? actions.preview({ type: "completeNightStep", payload: context.payload })
        : null,
    // The payload content and the store publication decide the preview.
    [actions.preview, step?.key, context ? JSON.stringify(context.payload) : "", viewVersion],
  );
  const nightEndPreview = useMemo(
    () =>
      state.phase === "night" && !step ? actions.preview({ type: "endNight", payload: {} }) : null,
    [actions.preview, state.phase, step?.key, viewVersion],
  );
  const dayEndPreview = useMemo(
    () => (state.phase === "day" ? actions.preview({ type: "endDay", payload: {} }) : null),
    [actions.preview, state.phase, viewVersion],
  );
  const target = state.phase === "day" ? playerById(state, drafts.executeTarget) : null;
  const canExecute =
    state.phase === "day" && Boolean(target?.alive) && !state.day.execution && !state.day.ended;
  const executed = state.day.execution ? playerById(state, state.day.execution.playerId) : null;
  const saintWarning =
    state.phase === "day" && !state.day.execution && !state.day.ended && target?.roleId === "saint";
  const registeredDead = orderedPlayers(state).filter(
    (player) => player.alive && player.registeredDead,
  );
  const guide = step ? ports.guidance.for(step) : null;
  const outcome = state.phase === "night" ? (step ? stepPreview : nightEndPreview) : dayEndPreview;
  const dockStep =
    state.phase === "night"
      ? step
        ? stepTitle(step, ports.roles.byId, t)
        : t("ui.allDone")
      : state.phase === "day"
        ? target
          ? displayName(target, t)
          : `${t("day")} ${state.day.number}`
        : state.phase === "over"
          ? t("gameOver")
          : t("setup");
  const hint =
    state.phase === "night" && step
      ? guide?.check || guide?.host || ""
      : state.phase === "day"
        ? t("ui.tableVotes")
        : state.phase === "night"
          ? t("ui.allDone")
          : "";

  return (
    <footer
      className="relative z-20 w-full border-t border-edge bg-[linear-gradient(180deg,var(--color-crypt-2),var(--color-crypt)_45%)] px-3 pb-[calc(8px+env(safe-area-inset-bottom))] pt-2"
      data-table-dock
      data-phase={state.phase}
      aria-label={t("table")}
    >
      <div className="mx-auto grid w-full max-w-[900px] gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <div
            data-dock-phase
            className="flex items-center gap-1 whitespace-nowrap rounded-sm border border-edge px-2 py-1 text-[9px] uppercase tracking-[.12em]"
          >
            <span className={state.phase === "day" ? "text-amber" : "text-muted"}>
              {t("day")} {state.day.number}
            </span>
            <span aria-hidden="true">·</span>
            <span className={state.phase === "night" ? "text-amber" : "text-muted"}>
              {t("night")} {state.night.number}
            </span>
          </div>
          <span className="min-w-0 flex-1 truncate text-[9px] uppercase tracking-[.1em] text-muted">
            {livingPlayers(state).length} {t("alive")} ·{" "}
            {orderedPlayers(state).length - livingPlayers(state).length} {t("dead")}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums tracking-[.04em] text-text" data-timer>
            {timerText(drafts.timerEnd, actions.now)}
          </span>
          <button
            className={`${ICON_BUTTON} disabled:cursor-not-allowed disabled:opacity-40`}
            type="button"
            data-act="undo"
            aria-label={t("undo")}
            title={t("undo")}
            disabled={!ports.history.canUndo()}
            onClick={actions.undo}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
              className="size-5"
            >
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
            </svg>
          </button>
          <button
            className={ICON_BUTTON}
            type="button"
            data-act="roster"
            aria-label={t("roster")}
            onClick={() => drafts.setOverlay("roster")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
              className="size-5"
            >
              <circle cx="9" cy="8" r="3.2" />
              <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.8M18 19a5.4 5.4 0 0 0-2.4-4.5" />
            </svg>
          </button>
          <button
            className={ICON_BUTTON}
            type="button"
            data-act="menu"
            aria-label={t("tableMenu")}
            onClick={() => drafts.setOverlay("menu")}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-5">
              <circle cx="5" cy="12" r="1.7" />
              <circle cx="12" cy="12" r="1.7" />
              <circle cx="19" cy="12" r="1.7" />
            </svg>
          </button>
        </div>

        <p
          className="m-0 flex items-start gap-1.5 text-[10.5px] leading-[1.35] text-muted"
          data-dock-hint
        >
          <span
            aria-hidden="true"
            className="mt-[5px] size-[5px] shrink-0 rounded-full bg-amber/85"
          />
          <span className="min-w-0">
            <b className="text-text" data-dock-step>
              {dockStep}
            </b>
            {state.phase === "night" && step ? (
              <span className="text-muted">
                {" "}
                · {projection.progress.done + 1} / {projection.progress.total}
              </span>
            ) : null}
            {hint && hint !== dockStep ? <> — {hint}</> : null}
          </span>
        </p>

        {isManualScript(state.script) && (state.phase === "night" || state.phase === "day") ? (
          <p className="manual-warning m-0 text-[10px] leading-tight text-amber-2">
            {t("manualOnlyWarning")}
          </p>
        ) : null}

        {context ? (
          <div className="grid gap-0.5">
            <span className="text-[8px] font-semibold uppercase tracking-[.16em] text-brass">
              {t("ui.activeEffects")}
            </span>
            {context.derived.effects.length ? (
              <span className="flex flex-wrap gap-1">
                {context.derived.effects.slice(0, 4).map((effect) => {
                  const key = "ui.effect." + effect.kind;
                  const label = t(key);
                  return (
                    <span
                      key={effect.id}
                      data-effect={effect.kind}
                      className="rounded-full border border-edge-2 px-1.5 py-px text-[9px] text-muted"
                    >
                      {label === key ? effect.kind : label}
                    </span>
                  );
                })}
              </span>
            ) : (
              <span className="text-[10px] text-muted">{t("ui.noActiveEffects")}</span>
            )}
          </div>
        ) : null}

        {context?.blockers.length ? (
          <ul className="m-0 grid list-none gap-0.5 p-0 text-[10px] leading-tight text-amber-2">
            {context.blockers.map((blocker) => (
              <li key={blocker} data-blocker-reason={blocker}>
                {blockerText(blocker, context.minTargets, t)}
              </li>
            ))}
          </ul>
        ) : null}

        {outcome ? (
          <ConsequenceList
            outcome={outcome}
            targets={context ? context.selected : []}
            state={state}
            ports={ports}
          />
        ) : null}

        {stepPreview?.result?.noDeath ? (
          <p className="m-0 text-[10px] leading-tight text-amber-2" data-warning="prevented">
            {stepPreview.result.reason || t("ui.consequence.prevented")}
          </p>
        ) : null}
        {state.mastermind?.active && state.mastermind.extraDay ? (
          <p className="m-0 text-[10px] leading-tight text-amber-2" data-warning="mastermind">
            {t("ui.mastermindExtraDay")}
          </p>
        ) : null}
        {saintWarning ? (
          <p className="m-0 text-[10px] leading-tight text-amber-2" data-warning="saint">
            {t("ui.saintExecution")}
          </p>
        ) : null}
        {state.phase === "day" &&
        !state.day.execution &&
        !state.day.ended &&
        registeredDead.length ? (
          <p className="m-0 text-[10px] leading-tight text-amber-2" data-warning="zombuul">
            {t("ui.zombuulExecution", {
              names: registeredDead.map((player) => displayName(player, t)).join(", "),
            })}
          </p>
        ) : null}
        {step?.previousTarget ? (
          <p className="m-0 text-[10px] leading-tight text-amber-2" data-dock-previous-target>
            {t("ui.previousTargetBlocked", {
              name: displayName(playerById(state, step.previousTarget), t),
            })}
          </p>
        ) : null}

        <div className="grid gap-1.5">
          {state.phase === "night" && step ? (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                <DockButton
                  className={PRIMARY_ACTION}
                  act="complete"
                  onClick={() => drafts.setOverlay("step")}
                >
                  {t("ui.action")}
                </DockButton>
                <DockButton
                  className={SECONDARY_ACTION}
                  act="skip"
                  onClick={() => actions.run({ type: "skipStep", payload: { key: step.key } })}
                >
                  {t("skipWake")}
                </DockButton>
              </div>
              <DockButton
                className={QUIET_ACTION}
                act="reset-step"
                disabled={!context?.selected.length && !context?.redirect && !context?.given}
                onClick={() => {
                  if (!context) return;
                  drafts.dropTargets(context.draftKey);
                  drafts.dropRedirect(context.draftKey);
                  drafts.dropGiven(context.draftKey);
                  drafts.dropRegistrations(context.draftKey);
                  drafts.clearStep(context.draftKey);
                }}
              >
                {t("ui.resetStep")}
              </DockButton>
            </>
          ) : state.phase === "night" ? (
            <DockButton
              className={PRIMARY_ACTION}
              act="end-night"
              onClick={() =>
                actions.run({
                  type: "endNight",
                  payload: {},
                  ...previewIdentity(nightEndPreview),
                })
              }
            >
              {t("finishNight")}
            </DockButton>
          ) : state.phase === "day" ? (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                <DockButton
                  className={DANGER_ACTION}
                  act="execute"
                  disabled={!canExecute}
                  onClick={() => {
                    if (!canExecute) return;
                    actions.run({
                      type: "executeByDecision",
                      payload: { playerId: drafts.executeTarget, options: { survives: false } },
                    });
                  }}
                >
                  {t("execute")}
                </DockButton>
                <DockButton
                  className={PRIMARY_ACTION}
                  act="end-day"
                  onClick={() => {
                    drafts.setExecuteTarget("");
                    actions.run({
                      type: "endDay",
                      payload: {},
                      ...previewIdentity(dayEndPreview),
                    });
                  }}
                >
                  {executed || state.day.ended || state.day.execution
                    ? t("endDay")
                    : t("noExecution")}
                </DockButton>
              </div>
              <DockButton
                className={QUIET_ACTION}
                act="day-help"
                onClick={() => drafts.setOverlay("day")}
              >
                {t("ui.dayHelp")}
              </DockButton>
            </>
          ) : null}
        </div>
        {state.phase === "day" && !canExecute ? (
          <p className="m-0 text-[9.5px] leading-tight text-muted" data-dock-disabled-reason>
            {target ? t("ui.executeUnavailable") : t("ui.executeNeedsTarget")}
          </p>
        ) : null}
        <p className="m-0 text-[9.5px] uppercase tracking-[.1em] text-muted" data-dock-threshold>
          {t("threshold")} {projection.threshold} {t("votes")}
        </p>
      </div>
    </footer>
  );
}

function DockButton({
  className,
  act,
  disabled = false,
  onClick,
  children,
}: {
  className: string;
  act: string;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      className={className}
      type="button"
      data-act={act}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
