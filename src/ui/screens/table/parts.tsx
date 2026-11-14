// Presentational pieces shared by the console cards.
import type { ReactNode } from "react";
import type { GameState, Player } from "../../../core/model/types.ts";
import { seatProjection } from "../../../application/read-models/table.ts";
import type { PreviewOutcome } from "../../ports.ts";
import type { ShellPorts } from "../../ports.ts";
import { consequencesOf, displayName, rejectionOf, rejectionText, targetNames } from "./helpers.ts";
import {
  ALERT,
  ALERT_BAD,
  CHIP,
  CHIPS,
  MUTED,
  PANEL_HEAD,
  TOKEN,
  TOKEN_BUTTON,
  TOKEN_IMG,
  TOKEN_MINI,
  TOKEN_MINI_IMG,
  TOKEN_MINI_NAME,
  TOKEN_NAME,
} from "./styles.ts";

export type ViewPorts = ShellPorts;

/** Shows the engine preview as the six separated consequence states. */
export function ConsequenceList({
  outcome,
  targets,
  state,
  ports,
  rejectionCopy,
}: {
  outcome: PreviewOutcome | null;
  targets: string[];
  state: GameState;
  ports: ViewPorts;
  /** A command-specific sentence that replaces the generic `error.N` copy. */
  rejectionCopy?: string | undefined;
}) {
  const t = ports.strings.t;
  const lines = consequencesOf(outcome, targets).slice(0, 4);
  const rejection = rejectionOf(outcome);
  const reason = rejectionCopy || rejectionText(rejection, t);
  return (
    <div className="grid gap-0.5" data-preview>
      <span className="text-[8px] font-semibold uppercase tracking-[.16em] text-brass">
        {t("ui.consequences")}
      </span>
      {rejection ? (
        <p
          className={`${ALERT} ${ALERT_BAD} m-0 px-1.5 py-1 text-[10.5px] leading-tight`}
          data-preview-reason
        >
          {reason}
        </p>
      ) : null}
      {lines.length ? (
        <ul className="m-0 grid list-none gap-0.5 p-0 text-[10.5px] leading-tight">
          {lines.map((line) => (
            <li key={line.kind} className={MUTED} data-consequence={line.kind}>
              <b>{t("ui.consequence." + line.kind)}</b>
              {line.playerIds.length ? ": " + targetNames(line.playerIds, state, t) : ""}
            </li>
          ))}
        </ul>
      ) : rejection ? null : (
        <p className={`${MUTED} !text-[10.5px]`}>{t("ui.previewEmpty")}</p>
      )}
    </div>
  );
}

export function RoleToken({
  id,
  ports,
  mini = false,
  onOpen,
}: {
  id: string;
  ports: ViewPorts;
  mini?: boolean;
  onOpen?: () => void;
}) {
  const role = ports.roles.byId(id);
  if (!role) return null;
  const content = (
    <>
      <img className={mini ? TOKEN_MINI_IMG : TOKEN_IMG} src={ports.roles.image(role)} alt="" />
      <b className={mini ? TOKEN_MINI_NAME : TOKEN_NAME}>{role.name}</b>
    </>
  );
  const classes = mini ? `${TOKEN_MINI}` : `${TOKEN}${onOpen ? ` ${TOKEN_BUTTON}` : ""}`;
  if (!onOpen) {
    return (
      <span className={classes} data-role-token={id}>
        {content}
      </span>
    );
  }
  return (
    <button className={classes} type="button" data-role-card={id} onClick={onOpen}>
      {content}
    </button>
  );
}

export function EffectBadges({
  state,
  player,
  ports,
}: {
  state: GameState;
  player: Player;
  ports: ViewPorts;
}) {
  const t = ports.strings.t;
  const seat = seatProjection(state, player.id);
  const badges: string[] = [];
  if (player.roleId === "drunk") badges.push(t("ui.drunk"));
  if (player.roleId !== "drunk" && seat.impaired) badges.push(t("ui.poisoned"));
  if (seat.protected) badges.push(t("ui.protected"));
  const master = seat.butlerMasterId;
  if (master) badges.push(t("ui.master") + displayName(state.players[master], t));
  if (state.setup.herringId === player.id || state.herringId === player.id) {
    badges.push(t("ui.herring"));
  }
  for (const reminder of player.reminders || []) badges.push(reminder);
  const used = Object.keys(player.used || {});
  if (used.length) badges.push(t("ui.used") + used.join(", "));
  if (!badges.length) return null;
  return (
    <span className={CHIPS}>
      {badges.map((badge) => (
        <span key={badge} className={CHIP}>
          {badge}
        </span>
      ))}
    </span>
  );
}

export function PanelHead({ label, note }: { label: string; note?: ReactNode }) {
  return (
    <div className={PANEL_HEAD}>
      <span className="label">{label}</span>
      {note === undefined ? null : <span className={MUTED}>{note}</span>}
    </div>
  );
}

export function Warn({
  title,
  children,
  bad = false,
  className = "",
}: {
  title: ReactNode;
  children?: ReactNode;
  bad?: boolean;
  className?: string;
}) {
  return (
    <div className={`${ALERT}${bad ? ` ${ALERT_BAD}` : ""}${className ? ` ${className}` : ""}`}>
      <b>{title}</b>
      {children}
    </div>
  );
}
