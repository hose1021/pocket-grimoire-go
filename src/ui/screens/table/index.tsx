// The storyteller console. Route-level screen: reads the published game
// through one subscription, keeps every transient draft in `useTableDrafts`,
// and dispatches through the shell ports only. The composition is one host
// table: the app bar, a scrollable stage and a fixed action dock.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DispatchResult } from "../../../core/commands/result.ts";
import {
  mayorRedirectNeeded,
  tableProjection,
  targetBounds,
} from "../../../application/read-models/table.ts";
import { playerById } from "../../../core/model/state.ts";
import { useShellPorts } from "../../ports.ts";
import type { PreviewOutcome, ShellPorts } from "../../ports.ts";
import { useGame } from "../../store/use-game.ts";
import { MainCard } from "./cards.tsx";
import { Overlays } from "./dialogs.tsx";
import { useTableDrafts } from "./drafts.ts";
import { TableDock } from "./dock.tsx";
import { ArcaneAppBar } from "../../components/arcane/index.ts";
import { TableRing } from "./ring.tsx";
import { nextSelection, overlayOutlivesWin, rejectionOf, rejectionText } from "./helpers.ts";
import type { Rejection } from "./helpers.ts";
import { readStepDraft } from "./step-draft.ts";
import type { TableActions, TableView } from "./view.ts";
import { ALERT, ALERT_BAD, HOST } from "./styles.ts";

export function TableScreen() {
  const ports = useShellPorts();
  const snapshot = useGame(ports.game);
  const state = snapshot.state;
  const [guidedPreference] = useState(() => ports.prefs.read("pg.guided") !== "false");
  // Read the recovery record once, for the step that is current at mount: a
  // reload mid-night reopens it with the host's untouched choices.
  const [restoredDraft] = useState(() => {
    const step = tableProjection(state).step;
    return step
      ? readStepDraft(ports.prefs.read, `${state.createdAt}:${state.night.number}:${step.key}`)
      : null;
  });
  const drafts = useTableDrafts(guidedPreference, restoredDraft);
  const [now, setNow] = useState(() => Date.now());
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const [dismissedDawn, setDismissedDawn] = useState<Set<string>>(() => new Set());
  const returnFocus = useRef<HTMLElement | null>(null);
  const hadOverlay = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const closeOverlay = drafts.closeOverlay;
  useEffect(() => {
    if (!drafts.overlay) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOverlay();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drafts.overlay, closeOverlay]);

  // A win ends the game behind the console; the dialog open at that moment
  // would cover the over panel. Close it once, on the transition, so the host
  // can still open the roster and the menu afterwards. Export and import keep
  // their content.
  const closedOnWin = useRef(false);
  useEffect(() => {
    if (!state.winner) {
      closedOnWin.current = false;
      return;
    }
    if (closedOnWin.current) return;
    closedOnWin.current = true;
    if (drafts.overlay && !overlayOutlivesWin(drafts.overlay)) closeOverlay();
  }, [state.winner, drafts.overlay, closeOverlay]);

  // A privacy surface hides the console but keeps it mounted, so the trigger
  // stays reachable; a trigger inside a closed dialog is replaced by the dock.
  useEffect(() => {
    if (drafts.overlay) {
      hadOverlay.current = true;
      return;
    }
    if (!hadOverlay.current) return;
    hadOverlay.current = false;
    const target = returnFocus.current;
    const frame = requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
      else
        document.querySelector<HTMLElement>('[data-act="roster"], [data-act="show-info"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [drafts.overlay]);

  const run = useCallback(
    (command: Parameters<ShellPorts["commands"]["dispatch"]>[0]): DispatchResult => {
      const result = ports.commands.dispatch(command);
      const rejection = rejectionOf(result);
      // `error.66` is an illegal answer in a step, but in a madness review the
      // same code means the review condition changed; give each its own copy.
      setRejection(
        rejection?.code === "error.66" && command.type === "madnessPenalty"
          ? { text: ports.strings.t("ui.madnessTransitionBlock"), code: null }
          : rejection,
      );
      return result;
    },
    [ports],
  );

  const preview = useCallback(
    (command: Parameters<ShellPorts["commands"]["preview"]>[0]): PreviewOutcome =>
      ports.commands.preview(command),
    [ports],
  );

  const captureFocus = () => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };

  const openCorrection = (playerId: string) => {
    const player = playerById(state, playerId);
    captureFocus();
    drafts.setCorrection({
      playerId,
      kind: "alive",
      value: player && player.alive ? "dead" : "alive",
      reason: "",
    });
    drafts.setOverlay("correction");
  };

  const actions: TableActions = {
    run,
    preview,
    rejection,
    dismissRejection: () => setRejection(null),
    undo: () => {
      if (ports.history.undo()) closeOverlay();
    },
    closeOverlay,
    closeRole: () => {
      drafts.setOverlay(drafts.roleCardBack);
      drafts.setRoleCardBack(null);
      drafts.setRoleCardId(null);
    },
    openRole: (id) => {
      captureFocus();
      drafts.setRoleCardBack(drafts.overlay);
      drafts.setRoleCardId(id);
      drafts.setOverlay("role");
    },
    openPlayerCard: (id) => {
      captureFocus();
      drafts.setPlayerCardId(id);
      drafts.setOverlay("player");
    },
    openInfo: (key) => {
      captureFocus();
      drafts.setInfoKey(key);
      drafts.setOverlay("info");
    },
    closeInfo: () => {
      drafts.setInfoKey(null);
      drafts.setOverlay("step");
    },
    openCorrection,
    selectSeat: (playerId) => {
      if (state.phase === "day") {
        drafts.setExecuteTarget(drafts.executeTarget === playerId ? "" : playerId);
        return;
      }
      const step = tableProjection(state).step;
      if (state.phase !== "night" || !step || step.targetMode === "none") {
        openCorrection(playerId);
        return;
      }
      const key = `${state.createdAt}:${state.night.number}:${step.key}`;
      const list = drafts.targets.get(key) || [];
      const before = list[0];
      const next = nextSelection(list, playerId, targetBounds(step).max);
      drafts.putTargets(key, next);
      if (before !== next[0]) drafts.dropRedirect(key);
      if (mayorRedirectNeeded(state, step, next[0] || "") && !drafts.redirects.has(key)) {
        drafts.putRedirect(key, "none");
      }
    },
    openGrimoire: () => {
      captureFocus();
      drafts.setOverlay("grimoire");
    },
    openExport: () => {
      captureFocus();
      drafts.setExportText(ports.game.exportGame());
      drafts.setOverlay("export");
    },
    openImport: () => {
      captureFocus();
      drafts.setOverlay("import");
    },
    toggleGuided: (open) => {
      drafts.setGuided(open);
      ports.prefs.write("pg.guided", String(open));
    },
    startTimer: () => drafts.setTimerEnd(Date.now() + 5 * 60 * 1000),
    stopTimer: () => drafts.setTimerEnd(null),
    armNew: () => {
      if (!drafts.armedNew) {
        drafts.setArmedNew(true);
        window.alert(ports.strings.t("ui.newConfirm"));
        return;
      }
      actions.startNewGame();
    },
    startNewGame: () => {
      const result = run({ type: "newGame", payload: { count: 8 } });
      if (result.status !== "allowed") {
        drafts.setArmedNew(false);
        return;
      }
      drafts.setArmedNew(false);
      ports.router.go("/bag");
    },
    applyImport: () => {
      if (!window.confirm(ports.strings.t("ui.importConfirm"))) return;
      const result = ports.commands.dispatch({
        type: "importGame",
        payload: { text: drafts.importText },
      });
      if (result.status !== "allowed") {
        setRejection(rejectionOf(result) ?? { text: ports.strings.t("importError"), code: null });
        return;
      }
      setRejection(null);
      closeOverlay();
    },
    download: () => {
      const blob = new Blob([drafts.exportText], { type: "application/json" });
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = "grimoria-tb.json";
      anchor.click();
      URL.revokeObjectURL(anchor.href);
    },
    copy: () => {
      navigator.clipboard.writeText(drafts.exportText).catch(() => {});
    },
    now,
  };

  const view: TableView = { state, viewVersion: snapshot.viewVersion, ports, drafts, actions };
  const t = ports.strings.t;
  const privacy =
    drafts.overlay === "info" || drafts.overlay === "player" || drafts.overlay === "grimoire";
  const rejectionWarning = rejection ? (
    <div className={`${ALERT} ${ALERT_BAD}`} role="alert" data-rejection>
      <b>{t("ui.rejectedTitle")}</b>
      <p className="my-1">{rejectionText(rejection, t) || t("setupErrors")}</p>
      <button
        className="btn"
        type="button"
        data-act="dismiss-rejection"
        onClick={actions.dismissRejection}
      >
        {t("ui.dismiss")}
      </button>
    </div>
  ) : null;
  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <div hidden={privacy} className="flex min-h-0 flex-1 flex-col">
        <ArcaneAppBar current="table" />
        <div className={`host ${HOST} flex min-h-0 flex-1 flex-col`} data-console="table">
          {rejectionWarning}
          <main
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2 pt-2"
            data-table-stage
            aria-label={t("table")}
          >
            {state.phase === "day" || state.phase === "night" ? (
              <TableRing
                view={view}
                dismissedDawn={dismissedDawn}
                onDismissDawn={(key) => setDismissedDawn((previous) => new Set(previous).add(key))}
              />
            ) : (
              <div className="mx-auto mt-2 grid w-full max-w-[900px] gap-2">
                <MainCard view={view} />
              </div>
            )}
          </main>
          <TableDock view={view} />
        </div>
      </div>
      <Overlays view={view} />
    </div>
  );
}
