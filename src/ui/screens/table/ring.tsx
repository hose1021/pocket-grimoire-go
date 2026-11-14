// The host table: one ellipse of seats around a centre hub. The screen owns
// every action; a seat only reports the target choice, and the hub reads the
// published state.
import { orderedPlayers, playerById } from "../../../core/model/state.ts";
import { seatProjection, tableProjection } from "../../../application/read-models/table.ts";
import type { Nomination } from "../../../core/model/types.ts";
import { displayName, roleNameOf, stepTitle } from "./helpers.ts";
import { dawnReport, seatBadges, seatGeometry, SEAT_BADGE_KEY, SEAT_BADGE_TONE } from "./ring.ts";
import type { DawnReport, LabelSide } from "./ring.ts";
import type { TableView } from "./view.ts";

const SIDE: Record<LabelSide, string> = {
  right: "right-[calc(100%+6px)] top-1/2 -translate-y-1/2 items-end text-right",
  left: "left-[calc(100%+6px)] top-1/2 -translate-y-1/2 items-start text-left",
  above: "bottom-[calc(100%+4px)] left-1/2 -translate-x-1/2 items-center text-center",
  below: "top-[calc(100%+4px)] left-1/2 -translate-x-1/2 items-center text-center",
};

export interface TableRingProps {
  view: TableView;
  /** The dawn report the host has already dismissed, keyed by game and day. */
  dismissedDawn: Set<string>;
  onDismissDawn(key: string): void;
}

export function TableRing({ view, dismissedDawn, onDismissDawn }: TableRingProps) {
  const { state, ports, actions } = view;
  const t = ports.strings.t;
  const players = orderedPlayers(state);
  const placements = seatGeometry(players.length);
  const projection = tableProjection(state);
  const nomination =
    state.day.nominations.find((entry) => entry.id === state.day.activeNominationId) ??
    state.day.nominations[state.day.nominations.length - 1];
  const step = projection.step;
  const targetStep = state.phase === "night" && step && step.targetMode !== "none" ? step : null;
  const targetKey = targetStep ? targetStep.key : null;
  const draftKey = targetStep ? `${state.createdAt}:${state.night.number}:${targetStep.key}` : "";
  const selectedTargets = targetStep ? (view.drafts.targets.get(draftKey) ?? []) : [];
  const dawnKey = `${state.createdAt}:${state.day.number}`;
  const dawnVisible =
    state.phase === "day" &&
    !dismissedDawn.has(dawnKey) &&
    state.day.nominations.length === 0 &&
    !state.day.execution &&
    !state.day.ended;
  const dawn = dawnReport(
    players.map((player) => ({
      id: player.id,
      name: displayName(player, t),
      roleName: roleNameOf(player.roleId, ports.roles.byId),
      alive: player.alive,
    })),
    state.day.morning,
  );

  return (
    <div
      className="relative mx-auto aspect-[100/145] w-full max-w-[560px] min-[620px]:aspect-[1.42] min-[620px]:w-[min(100%,calc(52dvh*1.42),1040px)]"
      data-game-table
      aria-label={t("table")}
      role="group"
    >
      <div
        className="absolute inset-0 rounded-[50%] bg-[radial-gradient(ellipse_at_50%_38%,var(--color-felt-day),var(--color-crypt)_74%)] shadow-[inset_0_0_90px_rgba(0,0,0,.55)]"
        aria-hidden="true"
      >
        {state.phase === "night" ? (
          <span className="absolute inset-0 rounded-[50%] bg-[radial-gradient(ellipse_at_50%_38%,var(--color-felt-night),var(--color-crypt)_74%)]" />
        ) : null}
        <span className="absolute inset-[4%] rounded-[50%] border border-dashed border-edge/60" />
      </div>
      <Hub
        view={view}
        dawnVisible={dawnVisible}
        dawn={dawn}
        onDismissDawn={() => onDismissDawn(dawnKey)}
        nomination={nomination}
      />
      {players.map((player, index) => {
        const seat = seatProjection(state, player.id);
        const role = player.roleId ? ports.roles.byId(player.roleId) : null;
        const placement = placements[index]!;
        const name = displayName(player, t);
        const roleName = role ? role.name : t("ui.unknown");
        const nominated = nomination?.nomineeId === player.id;
        const selected = targetStep
          ? selectedTargets.includes(player.id)
          : state.phase === "day" && view.drafts.executeTarget === player.id;
        const disabled = targetStep
          ? Boolean(
              (targetStep.targetMode === "one-other" && player.id === targetStep.actorId) ||
              (targetStep.sv &&
                ["dreamer", "seamstress"].includes(String(targetStep.roleId)) &&
                player.id === targetStep.actorId) ||
              (targetStep.sv && targetStep.roleId === "snakecharmer" && !player.alive) ||
              targetStep.previousTarget === player.id ||
              (targetStep.bmr && targetStep.roleId === "professor" && player.alive) ||
              (targetStep.bmr &&
                targetStep.targetMode === "one-any" &&
                targetStep.canResurrect &&
                !player.alive &&
                targetStep.roleId !== "moonchild" &&
                String(targetStep.roleId) !== "professor"),
            )
          : false;
        const badges = seatBadges({
          alive: player.alive,
          voteToken: player.voteToken,
          acting: projection.step?.actorId === player.id,
          nominated: Boolean(nominated),
          impaired: seat.impaired && player.roleId !== "drunk",
          drunk: seat.drunk && player.roleId !== "drunk",
          poisoned: seat.poisoned && player.roleId !== "drunk",
          protected: seat.protected,
          scheduledDeath: seat.scheduledDeath,
          registeredDead: seat.registeredDead,
        });
        const badgeSources: Partial<Record<(typeof badges)[number], string | null>> = {
          drunk: seat.drunkSourceRoleId,
          poison: seat.poisonSourceRoleId,
          protection: seat.protectionSourceRoleId,
        };
        const badgeLabels = badges.map((badge) => {
          const source = badgeSources[badge];
          const sourceName = source ? roleNameOf(source, ports.roles.byId) : "";
          return t(SEAT_BADGE_KEY[badge]) + (sourceName ? " · " + sourceName : "");
        });
        const badgeText = badgeLabels.join(", ");
        return (
          <button
            key={player.id}
            type="button"
            className="absolute min-h-11 min-w-11 -translate-x-1/2 -translate-y-1/2 overflow-visible border-0 bg-transparent p-0 text-center text-text disabled:cursor-not-allowed disabled:opacity-45"
            style={{ left: `${placement.x}%`, top: `${placement.y}%`, zIndex: placement.z }}
            data-seat-open={player.id}
            data-target={targetKey ?? undefined}
            data-id={targetKey ? player.id : undefined}
            aria-pressed={selected}
            aria-label={`${player.seat}, ${name}, ${roleName}${badgeText ? `, ${badgeText}` : ""}`}
            disabled={disabled}
            onClick={() => actions.selectSeat(player.id)}
          >
            <span
              className={`relative mx-auto block size-11 rounded-full border bg-crypt-3 min-[620px]:size-[58px] ${
                projection.step?.actorId === player.id
                  ? "border-amber shadow-[0_0_0_2px_var(--color-amber),0_0_24px_rgba(230,169,76,.45)]"
                  : nominated
                    ? "border-crimson shadow-[0_0_0_2px_var(--color-crimson),0_0_22px_rgba(192,74,66,.42)]"
                    : selected
                      ? "border-table-danger shadow-[0_0_0_2px_var(--color-table-danger)]"
                      : "border-edge-2"
              }`}
            >
              {role ? (
                <img
                  className={`absolute inset-0 m-auto size-[74%] rounded-full object-contain ${
                    player.alive ? "" : "opacity-50 grayscale"
                  }`}
                  src={ports.roles.image(role)}
                  alt=""
                />
              ) : (
                <span className="absolute inset-0 grid place-items-center font-role text-[18px] text-brass">
                  {player.seat}
                </span>
              )}
              <span
                data-seat-number=""
                className="absolute -left-1 -top-1 hidden place-items-center rounded-full border border-edge-2 bg-crypt px-1 text-[8px] tabular-nums text-muted min-[620px]:grid"
              >
                {player.seat}
              </span>
              {player.alive ? null : (
                <span className="absolute inset-0 grid place-items-center text-[20px] text-crimson">
                  ✕
                </span>
              )}
            </span>
            <span
              className={`pointer-events-none absolute z-30 flex w-max max-w-[96px] flex-col gap-0.5 min-[620px]:max-w-[150px] ${SIDE[placement.side]}`}
            >
              <b
                data-seat-name=""
                className={`block max-w-full truncate text-[10px] font-semibold leading-tight min-[620px]:text-[12.5px] ${
                  player.alive ? "" : "text-muted line-through decoration-crimson"
                }`}
              >
                {name}
              </b>
              {badges.length ? (
                <span className="flex flex-wrap gap-0.5">
                  {badges.map((badge, index) => (
                    <span
                      key={badge}
                      data-seat-badge={badge}
                      className={`whitespace-nowrap rounded-full border px-1 py-px text-[6.5px] font-semibold uppercase tracking-[.04em] min-[620px]:text-[7.5px] ${SEAT_BADGE_TONE[badge]}`}
                    >
                      {badgeLabels[index]}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Hub({
  view,
  dawnVisible,
  dawn,
  onDismissDawn,
  nomination,
}: {
  view: TableView;
  dawnVisible: boolean;
  dawn: DawnReport;
  onDismissDawn(): void;
  nomination: Nomination | undefined;
}) {
  const { state, ports } = view;
  const t = ports.strings.t;
  const projection = tableProjection(state);
  const executed = state.day.execution ? playerById(state, state.day.execution.playerId) : null;
  const diedToday =
    executed !== null &&
    !executed.alive &&
    executed.deadAt?.phase === "day" &&
    executed.deadAt?.number === state.day.number;
  const step = projection.step;
  const actor = step?.actorId ? playerById(state, step.actorId) : null;
  const label =
    "text-[7.5px] font-semibold uppercase tracking-[.18em] text-brass min-[620px]:text-[9px]";
  const sub = "text-[8.5px] leading-tight text-muted min-[620px]:text-[10px]";

  if (state.phase === "night") {
    const role = step?.roleId ? ports.roles.byId(step.roleId) : null;
    return (
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex w-[min(190px,52%)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center min-[620px]:w-[min(300px,48%)] min-[620px]:gap-2">
        <span data-hub-phase className={label}>
          {t("night")} {state.night.number}
        </span>
        {step && role ? (
          <img
            className="size-11 rounded-md border border-edge-2 bg-crypt-3 object-contain p-1 min-[620px]:size-14"
            src={ports.roles.image(role)}
            alt=""
          />
        ) : null}
        <b
          data-hub-step
          className="max-w-full truncate font-role text-[15px] leading-tight text-player-role-text min-[620px]:text-[20px]"
        >
          {step ? stepTitle(step, ports.roles.byId, t) : t("ui.allDone")}
        </b>
        <span className={sub}>
          {step
            ? actor
              ? `${displayName(actor, t)} · ${t("seatNumber", { seat: actor.seat })}`
              : t("ui.activeSeat")
            : `${projection.progress.done} / ${projection.progress.total}`}
        </span>
        <span className="flex flex-wrap justify-center gap-1" aria-hidden="true">
          {state.night.queue.slice(0, 16).map((entry) => (
            <i
              key={entry.key}
              className={`size-1 rounded-full ${entry.key === step?.key ? "bg-amber" : "bg-muted/40"}`}
            />
          ))}
        </span>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex w-[min(190px,54%)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center min-[620px]:w-[min(300px,48%)] min-[620px]:gap-1.5">
      <span data-hub-phase className={label}>
        {t("day")} {state.day.number}
      </span>
      {dawnVisible ? (
        <div className="grid gap-1" data-dawn>
          <span className={label}>
            {t("dawn")} · {t("night")} {state.night.number}
          </span>
          {dawn.none ? (
            <b className="text-[11px] leading-tight text-text min-[620px]:text-[13px]">
              {t("noDeaths")}
            </b>
          ) : (
            <div className="grid gap-0.5">
              <b className="text-[8.5px] uppercase tracking-[.14em] text-danger">{t("died")}</b>
              {dawn.deaths.map((death) => (
                <span
                  key={death.playerId}
                  data-dawn-death=""
                  className="block text-[10px] leading-tight text-text min-[620px]:text-[12px]"
                >
                  {death.name} · {death.roleName}
                </span>
              ))}
            </div>
          )}
          <span data-dawn-survivors className={sub}>
            {t("dawnSurvivors", { living: dawn.survivors, total: dawn.total })}
          </span>
          <button
            className="pointer-events-auto mx-auto mt-1 inline-flex min-h-11 items-center rounded-sm border border-edge-2 bg-crypt/50 px-2.5 text-[9px] uppercase tracking-[.1em] text-text"
            type="button"
            data-act="dawn-dismiss"
            onClick={onDismissDawn}
          >
            {t("dawnDismiss")}
          </button>
        </div>
      ) : executed ? (
        <div className="grid gap-1" data-executed>
          <span className={label}>{t("execution")}</span>
          <b className="text-[12px] leading-tight text-danger min-[620px]:text-[15px]">
            {displayName(executed, t)} · {roleNameOf(executed.roleId, ports.roles.byId)}
          </b>
          <span className={sub}>{diedToday ? t("ui.executedDied") : t("ui.executedNoDeath")}</span>
        </div>
      ) : nomination ? (
        <div className="grid gap-1" data-nomination>
          <span className={label}>{t("nomination")}</span>
          <span className="text-[10px] leading-tight text-text min-[620px]:text-[12px]">
            {displayName(playerById(state, nomination.nominatorId), t)} →{" "}
            {displayName(playerById(state, nomination.nomineeId), t)}
          </span>
          <span className="flex justify-center gap-0.5" aria-hidden="true">
            {Array.from({ length: nomination.threshold }, (_, index) => (
              <i
                key={index}
                className={`size-1.5 rounded-full border border-edge-2 ${
                  index < nomination.count ? "bg-amber" : "bg-crypt"
                }`}
              />
            ))}
          </span>
          <b
            data-nomination-tally
            className="text-[18px] leading-none text-text min-[620px]:text-[24px]"
          >
            {nomination.count} / {nomination.threshold}
          </b>
          <span className={sub}>{t("votes")}</span>
        </div>
      ) : (
        <b
          className="max-w-full text-[11px] leading-tight text-text min-[620px]:text-[13px]"
          data-nomination-none
        >
          {t("ui.noNomination")}
        </b>
      )}
      <span
        data-hub-threshold
        className="text-[7.5px] font-semibold uppercase tracking-[.18em] text-muted min-[620px]:text-[9px]"
      >
        {t("threshold")} {projection.threshold}
      </span>
    </div>
  );
}
