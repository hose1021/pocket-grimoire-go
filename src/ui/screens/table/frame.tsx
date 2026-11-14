// The console tools and the night queue. They live in the table menu or under
// the step sheet; nothing here dispatches on its own.
import { useState } from "react";
import { tableProjection } from "../../../application/read-models/table.ts";
import { playerById } from "../../../core/model/state.ts";
import { EventLog } from "../../components/arcane/index.ts";
import { displayName, roleNameOf, timerText } from "./helpers.ts";
import { PanelHead, RoleToken, Warn } from "./parts.tsx";
import type { TableView } from "./view.ts";
import { INLINE, MUTED, PANEL, QUEUE_ITEM } from "./styles.ts";

export function SidePanel({ view, className = "" }: { view: TableView; className?: string }) {
  const { state, ports, actions } = view;
  const t = ports.strings.t;
  const entries = (state.log || []).slice(-8).reverse();
  return (
    <div className={`${className} grid gap-2`}>
      {state.storageError ? (
        <Warn title={t("storageError")} bad>
          <p>{state.storageError}</p>
        </Warn>
      ) : null}
      <EventLog
        title={t("log")}
        emptyLabel={t("none")}
        allLabel={t("all")}
        filters={[
          { id: "night", label: t("night") },
          { id: "day", label: t("day") },
          { id: "death", label: t("deaths") },
        ]}
        entries={entries.map((entry) => {
          const scope =
            entry.kind === "night"
              ? ("night" as const)
              : entry.kind === "day"
                ? ("day" as const)
                : /death|execut|kill/i.test(entry.kind)
                  ? ("death" as const)
                  : ("other" as const);
          const time = entry.at
            ? new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "";
          return {
            title: entry.title,
            detail: `${entry.phase}${entry.detail ? " · " + entry.detail : ""}`,
            ...(time ? { time } : {}),
            scope,
            ...(scope === "death" ? { tone: "danger" as const } : {}),
          };
        })}
      />
      <section className={`${PANEL} host-bluffs`}>
        <PanelHead label={t("bluffs")} />
        <div className="flex min-h-6 flex-wrap gap-[5px]">
          {(state.bluffs || []).length ? (
            state.bluffs!.map((id) => (
              <RoleToken key={id} id={id} ports={ports} mini onOpen={() => actions.openRole(id)} />
            ))
          ) : (
            <span className={MUTED}>{state.setup.count < 7 ? t("noBluffs") : t("none")}</span>
          )}
        </div>
        {state.setup.herringId || state.herringId ? (
          <p className={MUTED}>
            {t("herring")}:{" "}
            {displayName(playerById(state, state.setup.herringId || state.herringId || ""), t)}
          </p>
        ) : null}
      </section>
      <section className={PANEL}>
        <label className="label" htmlFor="host-notes">
          {t("notes")}
        </label>
        <textarea
          className="host-notes field mt-1 min-h-[84px] resize-y"
          id="host-notes"
          data-notes
          maxLength={4000}
          value={state.notes || ""}
          onChange={(event) =>
            actions.run({ type: "setNotes", payload: { notes: event.target.value } })
          }
        />
        <p className={MUTED}>{t("correctionHint")}</p>
      </section>
      <section className={PANEL}>
        <span className="label">{t("ui.backup")}</span>
        <div className={INLINE}>
          <button className="btn" type="button" data-act="export" onClick={actions.openExport}>
            {t("export")}
          </button>
          <button className="btn" type="button" data-act="import" onClick={actions.openImport}>
            {t("import")}
          </button>
        </div>
        <p className={MUTED}>{t("exportWarning")}</p>
      </section>
    </div>
  );
}

export function QueuePanel({ view }: { view: TableView }) {
  const { state, ports } = view;
  const t = ports.strings.t;
  const [open, setOpen] = useState(false);
  const { step: current, progress } = tableProjection(state);
  const { done, total } = progress;
  const stepLabel = (step: (typeof state.night.queue)[number]) =>
    step.roleId
      ? roleNameOf(step.roleId, ports.roles.byId)
      : step.system
        ? t("system." + step.system)
        : t("step");
  const next = state.night.queue
    .filter((step) => !step.done && !step.skipped && step.key !== current?.key)
    .slice(0, 3)
    .map(stepLabel)
    .join(", ");
  const segments = 7;
  const filled = total ? Math.round((done / total) * segments) : 0;
  return (
    <section className={`${PANEL} mx-auto mt-2 grid w-full max-w-[900px] gap-2`} data-panel="queue">
      <span className="label">{t("queue")}</span>
      <div className="flex items-baseline gap-2">
        <b className="font-role text-[40px] leading-none tabular-nums text-amber">{done}</b>
        <span className="text-[10px] uppercase tracking-[.14em] text-muted">из {total} ходов</span>
      </div>
      <div className="flex gap-[3px]" aria-hidden="true">
        {Array.from({ length: segments }, (_, index) => (
          <i
            key={index}
            className={`h-1 flex-1 rounded-[1px] ${index < filled ? "bg-amber" : "bg-crypt-3"}`}
          />
        ))}
      </div>
      <p className={`${MUTED} !text-[10px]`}>
        {next ? `Далее: ${next}.` : total ? t("ui.done") : t("noWake")}
      </p>
      <button
        className="btn min-h-[38px] w-full !justify-center max-[900px]:min-h-11"
        type="button"
        data-act="show-order"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Скрыть порядок" : "Показать порядок"}
      </button>
      {open ? (
        <ol className="mt-1 grid list-none gap-[3px] p-0">
          {state.night.queue.map((step) => {
            const active = current?.key === step.key && !step.done;
            return (
              <li
                key={step.key}
                className={`${QUEUE_ITEM} ${active ? "bg-amber-dim/40" : ""} ${
                  step.done ? "opacity-50" : ""
                } ${step.skipped ? "opacity-35" : ""} ${step.pending ? "bg-crimson-dim/30" : ""}`}
              >
                <span
                  className={`mt-[5px] h-1.5 w-1.5 rounded-full ${
                    active
                      ? "bg-amber"
                      : step.done
                        ? "bg-outsider"
                        : step.pending
                          ? "bg-danger"
                          : "bg-muted"
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <b className="block text-[14px] font-[550]">{stepLabel(step)}</b>
                  <small className="block text-[13px] text-muted">
                    {step.actorName || ""}
                    {step.skipped ? t("ui.skipped") : step.done ? t("ui.done") : ""}
                  </small>
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

export function DayPanel({ view }: { view: TableView }) {
  const { state, ports, drafts, actions } = view;
  const t = ports.strings.t;
  const executed = state.day.execution ? playerById(state, state.day.execution.playerId) : null;
  return (
    <section className={PANEL} data-panel="day-result">
      <PanelHead label={t("ui.dayResult")} />
      {executed ? (
        <p className="my-1 rounded-sm border border-crimson-dim px-2 py-1.5 text-[13px] text-danger">
          {t("execution")}: {displayName(executed, t)}
        </p>
      ) : (
        <p className={MUTED}>{t("noExecutionShort")}</p>
      )}
      <div className="mt-2 grid gap-1">
        <span className="label">{t("timer")}</span>
        <b className="text-[20px] tabular-nums tracking-[.04em]">
          {timerText(drafts.timerEnd, actions.now)}
        </b>
        <div className={INLINE}>
          <button className="btn" type="button" data-act="timer-start" onClick={actions.startTimer}>
            {t("startTimer")}
          </button>
          <button className="btn" type="button" data-act="timer-stop" onClick={actions.stopTimer}>
            {t("resetTimer")}
          </button>
        </div>
      </div>
    </section>
  );
}
