// Every transient console value lives here and never reaches the store: seat
// targets, redirects, registrations, host-given answers, the BMR/S&V drafts,
// the open overlay and the day timer.
import { useCallback, useState } from "react";
import type { CorrectionDraft, StepInfo } from "./helpers.ts";
import { restoredMap } from "./step-draft.ts";
import type { StepDraft } from "./step-draft.ts";

export type Overlay =
  | "info"
  | "grimoire"
  | "role"
  | "player"
  | "playerSheet"
  | "step"
  | "roster"
  | "menu"
  | "correction"
  | "export"
  | "import"
  | "day"
  | null;

export type Panel = "play" | "roster" | "tools";

function useMap<T>(initial: Map<string, T>) {
  const [map, setMap] = useState(initial);
  const put = useCallback((key: string, value: T) => {
    setMap((previous) => new Map(previous).set(key, value));
  }, []);
  const drop = useCallback((key: string) => {
    setMap((previous) => {
      const next = new Map(previous);
      next.delete(key);
      return next;
    });
  }, []);
  const reset = useCallback(() => setMap(new Map()), []);
  return { map, put, drop, reset };
}

export interface TableDrafts {
  overlay: Overlay;
  setOverlay(value: Overlay): void;
  /** The overlay a role card returns to when it closes. */
  roleCardBack: Overlay;
  setRoleCardBack(value: Overlay): void;
  infoKey: string | null;
  setInfoKey(value: string | null): void;
  roleCardId: string | null;
  setRoleCardId(value: string | null): void;
  /** The seat whose private role card is open. */
  playerCardId: string | null;
  setPlayerCardId(value: string | null): void;
  /** Host-entered false information for a poisoned or drunk actor. */
  infoTemplate: string;
  setInfoTemplate(value: string): void;
  correction: CorrectionDraft | null;
  setCorrection(value: CorrectionDraft | null): void;
  exportText: string;
  setExportText(value: string): void;
  importText: string;
  setImportText(value: string): void;
  timerEnd: number | null;
  setTimerEnd(value: number | null): void;
  panel: Panel;
  setPanel(value: Panel): void;
  guided: boolean;
  setGuided(value: boolean): void;
  armedNew: boolean;
  setArmedNew(value: boolean): void;
  executeTarget: string;
  setExecuteTarget(value: string): void;
  executeSurvives: boolean;
  setExecuteSurvives(value: boolean): void;
  slayerTarget: string;
  setSlayerTarget(value: string): void;
  recluseSlayer: boolean;
  setRecluseSlayer(value: boolean): void;
  winnerTeam: "good" | "evil";
  setWinnerTeam(value: "good" | "evil"): void;
  moonchildTarget: string;
  setMoonchildTarget(value: string): void;
  jugglerTarget: string;
  setJugglerTarget(value: string): void;
  jugglerRole: string;
  setJugglerRole(value: string): void;
  targets: Map<string, string[]>;
  putTargets(key: string, value: string[]): void;
  dropTargets(key: string): void;
  redirects: Map<string, string | null>;
  putRedirect(key: string, value: string | null): void;
  dropRedirect(key: string): void;
  registrations: Map<string, Record<string, string>>;
  putRegistrations(key: string, value: Record<string, string>): void;
  dropRegistrations(key: string): void;
  givens: Map<string, StepInfo>;
  putGiven(key: string, value: StepInfo): void;
  dropGiven(key: string): void;
  bmrDeaths: Map<string, string[]>;
  putBmrDeaths(key: string, value: string[]): void;
  bmrResurrect: Map<string, string | null>;
  putBmrResurrect(key: string, value: string | null): void;
  bmrRoles: Map<string, string | null>;
  putBmrRole(key: string, value: string | null): void;
  bmrDrunk: Map<string, string | null>;
  putBmrDrunk(key: string, value: string | null): void;
  bmrPoison: Map<string, string | null>;
  putBmrPoison(key: string, value: string | null): void;
  /** Clears every draft a completed step leaves behind. */
  clearStep(key: string): void;
  /** Closes the overlay and resets the drafts it owned. */
  closeOverlay(): void;
}

export function useTableDrafts(
  guidedPreference: boolean,
  restored: StepDraft | null = null,
): TableDrafts {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [roleCardBack, setRoleCardBack] = useState<Overlay>(null);
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [roleCardId, setRoleCardId] = useState<string | null>(null);
  const [playerCardId, setPlayerCardId] = useState<string | null>(null);
  const [infoTemplate, setInfoTemplate] = useState("");
  const [correction, setCorrection] = useState<CorrectionDraft | null>(null);
  const [exportText, setExportText] = useState("");
  const [importText, setImportText] = useState("");
  const [timerEnd, setTimerEnd] = useState<number | null>(null);
  const [panel, setPanel] = useState<Panel>("play");
  const [guided, setGuided] = useState(guidedPreference);
  const [armedNew, setArmedNew] = useState(false);
  const [executeTarget, setExecuteTarget] = useState("");
  const [executeSurvives, setExecuteSurvives] = useState(false);
  const [slayerTarget, setSlayerTarget] = useState("");
  const [recluseSlayer, setRecluseSlayer] = useState(false);
  const [winnerTeam, setWinnerTeam] = useState<"good" | "evil">("good");
  const [moonchildTarget, setMoonchildTarget] = useState("");
  const [jugglerTarget, setJugglerTarget] = useState("");
  const [jugglerRole, setJugglerRole] = useState("");
  const targets = useMap<string[]>(restoredMap(restored, restored?.targets));
  const redirects = useMap<string | null>(restoredMap(restored, restored?.redirect));
  const registrations = useMap<Record<string, string>>(
    restoredMap(restored, restored?.registrations),
  );
  const givens = useMap<StepInfo>(restoredMap(restored, restored?.given));
  const bmrDeaths = useMap<string[]>(restoredMap(restored, restored?.bmrDeaths));
  const bmrResurrect = useMap<string | null>(restoredMap(restored, restored?.bmrResurrect));
  const bmrRoles = useMap<string | null>(restoredMap(restored, restored?.bmrRoles));
  const bmrDrunk = useMap<string | null>(restoredMap(restored, restored?.bmrDrunk));
  const bmrPoison = useMap<string | null>(restoredMap(restored, restored?.bmrPoison));

  const clearStep = useCallback(
    (key: string) => {
      bmrDeaths.drop(key);
      bmrResurrect.drop(key);
      bmrRoles.drop(key);
      bmrDrunk.drop(key);
      bmrPoison.drop(key);
    },
    [bmrDeaths, bmrResurrect, bmrRoles, bmrDrunk, bmrPoison],
  );

  const closeOverlay = useCallback(() => {
    setOverlay(null);
    setRoleCardBack(null);
    setInfoKey(null);
    setRoleCardId(null);
    setPlayerCardId(null);
    setCorrection(null);
  }, []);

  return {
    overlay,
    setOverlay,
    roleCardBack,
    setRoleCardBack,
    infoKey,
    setInfoKey,
    roleCardId,
    setRoleCardId,
    playerCardId,
    setPlayerCardId,
    infoTemplate,
    setInfoTemplate,
    correction,
    setCorrection,
    exportText,
    setExportText,
    importText,
    setImportText,
    timerEnd,
    setTimerEnd,
    panel,
    setPanel,
    guided,
    setGuided,
    armedNew,
    setArmedNew,
    executeTarget,
    setExecuteTarget,
    executeSurvives,
    setExecuteSurvives,
    slayerTarget,
    setSlayerTarget,
    recluseSlayer,
    setRecluseSlayer,
    winnerTeam,
    setWinnerTeam,
    moonchildTarget,
    setMoonchildTarget,
    jugglerTarget,
    setJugglerTarget,
    jugglerRole,
    setJugglerRole,
    targets: targets.map,
    putTargets: targets.put,
    dropTargets: targets.drop,
    redirects: redirects.map,
    putRedirect: redirects.put,
    dropRedirect: redirects.drop,
    registrations: registrations.map,
    putRegistrations: registrations.put,
    dropRegistrations: registrations.drop,
    givens: givens.map,
    putGiven: givens.put,
    dropGiven: givens.drop,
    bmrDeaths: bmrDeaths.map,
    putBmrDeaths: bmrDeaths.put,
    bmrResurrect: bmrResurrect.map,
    putBmrResurrect: bmrResurrect.put,
    bmrRoles: bmrRoles.map,
    putBmrRole: bmrRoles.put,
    bmrDrunk: bmrDrunk.map,
    putBmrDrunk: bmrDrunk.put,
    bmrPoison: bmrPoison.map,
    putBmrPoison: bmrPoison.put,
    clearStep,
    closeOverlay,
  };
}
