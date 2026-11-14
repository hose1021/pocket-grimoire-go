// Pure view helpers for the storyteller console. No DOM, no store access:
// they take the state and the two catalog lookups the screen already has.
import type { PreviewEffect, PreviewOutcome, PreviewResult } from "../../ports.ts";
import { livingPlayers, playerById } from "../../../core/model/state.ts";
import { ALL_ROLES as RULE_ROLES, roleLabel, roleTeam } from "../../../core/model/rules.ts";
import type { GameState, NightStep, Player, Role } from "../../../core/model/types.ts";
import type { InfoResult } from "../../../application/read-models/table.ts";

/** The loose engine result the normalizer accepts; no engine values imported. */
export interface RawPreview {
  status: "allowed" | "rejected" | "requires-storyteller-choice";
  id?: string | null;
  at?: string | null;
  reason?: string;
  errorCode?: string | null;
  errors?: string[] | null;
  events?: Array<{ type: string; payload?: unknown }>;
  changes?: unknown;
  future?: unknown;
  result?: unknown;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Narrows the engine result to the fields the console renders. The nested
 * `result.result` of a night step is flattened so an Imp attack can report
 * `noDeath`, and only a delayed effect with `resolve` can schedule a death.
 * It lives here, not in `ports.ts`, so the DOM-free tests never load React.
 */
export function toPreviewOutcome(raw: RawPreview): PreviewOutcome {
  const outcome: PreviewOutcome = {
    status: raw.status,
    id: raw.id ?? null,
    at: raw.at ?? null,
    errorCode: raw.errorCode ?? null,
    errors: raw.errors ?? null,
  };
  if (raw.reason !== undefined) outcome.reason = raw.reason;
  if (raw.status !== "allowed") return outcome;
  outcome.events = (raw.events || []).map((event) => ({
    type: event.type,
    payload: recordOf(event.payload) || {},
  }));
  const changes = recordOf(raw.changes);
  const deaths =
    changes && Array.isArray(changes.deaths)
      ? changes.deaths.filter((id): id is string => typeof id === "string")
      : [];
  outcome.changes = { deaths };
  const future = recordOf(raw.future);
  const delayed = future && Array.isArray(future.delayedEffects) ? future.delayedEffects : [];
  outcome.future = {
    delayedEffects: delayed.map((effect) => {
      const value = recordOf(effect) || {};
      const mapped: PreviewEffect = {
        targetId: typeof value.targetId === "string" ? value.targetId : null,
        expires: value.expires ?? null,
        resolve: value.resolve ?? null,
      };
      if (typeof value.kind === "string") mapped.kind = value.kind;
      return mapped;
    }),
  };
  const outer = recordOf(raw.result);
  const attack = outer
    ? recordOf(outer.result) || (typeof outer.noDeath === "boolean" ? outer : null)
    : null;
  if (attack) {
    const result: PreviewResult = { noDeath: attack.noDeath === true };
    if (typeof attack.reason === "string") result.reason = attack.reason;
    outcome.result = result;
  } else {
    outcome.result = null;
  }
  return outcome;
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;
export type RoleLookup = (id: string) => Role | null;

export interface Guide {
  host?: string;
  player: string;
  grimoire: string;
  publicLine: string;
  check: string;
}

/** The information result shape the engine returns for a step. */
export type StepInfo = InfoResult;

export interface CorrectionDraft {
  playerId: string;
  kind: string;
  value: string;
  reason: string;
}

/** A reason a step cannot be completed yet; the card maps it to a locale key. */
export type StepBlocker = "secrets" | "targets" | "role" | "drunk" | "given" | "redirect";

export interface StepGate {
  needsSetup: boolean;
  targetsIncomplete: boolean;
  needsGiven: boolean;
  needsRedirect: boolean;
  needsRole?: boolean;
  needsDrunk?: boolean;
}

/** Every unanswered mandatory decision, in the order the card explains it. */
export function stepBlockers(gate: StepGate): StepBlocker[] {
  const blockers: StepBlocker[] = [];
  if (gate.needsSetup) blockers.push("secrets");
  if (gate.targetsIncomplete) blockers.push("targets");
  if (gate.needsRole) blockers.push("role");
  if (gate.needsDrunk) blockers.push("drunk");
  if (gate.needsGiven) blockers.push("given");
  if (gate.needsRedirect) blockers.push("redirect");
  return blockers;
}

/** The localized sentence for one blocker; the dock and the step sheet share it. */
export function blockerText(blocker: StepBlocker, minTargets: number, t: Translate): string {
  if (blocker === "targets") return t("ui.blockTargets", { count: minTargets });
  if (blocker === "secrets") return t("ui.blockSecrets");
  if (blocker === "role") return t("ui.blockRole");
  if (blocker === "drunk") return t("ui.blockDrunk");
  if (blocker === "given") return t("ui.blockGiven");
  return t("ui.blockRedirect");
}

export interface Rejection {
  text: string;
  code: string | null;
}

/** The pinned id and timestamp the apply command reuses from its preview. */
export function previewIdentity(outcome: PreviewOutcome | null | undefined): {
  id?: string;
  at?: string;
} {
  const identity: { id?: string; at?: string } = {};
  if (outcome?.id) identity.id = outcome.id;
  if (outcome?.at) identity.at = outcome.at;
  return identity;
}

/** The visible reason when the engine rejects a command or asks for a choice. */
export function rejectionOf(result: PreviewOutcome | null | undefined): Rejection | null {
  if (!result) return null;
  if (result.status === "rejected") {
    const first = result.errors && result.errors.length ? result.errors[0] : "";
    return { text: first || result.reason || "", code: result.errorCode ?? null };
  }
  if (result.status === "requires-storyteller-choice") {
    return { text: result.reason || "", code: result.errorCode ?? null };
  }
  return null;
}

/**
 * The rejection in the UI language: a localized `error.N` key wins, then the
 * engine message as the fallback for a code the catalogs do not translate.
 */
export function rejectionText(rejection: Rejection | null, t: Translate): string {
  if (!rejection) return "";
  const code = rejection.code || "";
  if (code) {
    const localized = t(code);
    if (localized !== code) return localized;
  }
  return rejection.text || t("setupErrors");
}

/**
 * The text of the private information card. An impaired actor shows the answer
 * the host selected, then the typed template; a healthy actor shows the computed
 * information.
 */
export function shownCardText(
  state: GameState,
  step: NightStep,
  info: StepInfo | null | undefined,
  given: StepInfo | undefined,
  template: string,
  impaired: boolean,
  roles: RoleLookup,
  t: Translate,
): string {
  if (impaired) {
    return given ? infoText(state, step, given, roles, t) : template || t("ui.notSet");
  }
  return infoText(state, step, given || info, roles, t);
}

/**
 * The target list after one seat click. A single-target step replaces the
 * choice; a multi-target step toggles and drops the oldest target at its limit.
 */
export function nextSelection(current: string[], playerId: string, max: number): string[] {
  const list = current.slice();
  const at = list.indexOf(playerId);
  if (at !== -1) {
    list.splice(at, 1);
    return list;
  }
  if (max > 1) {
    if (list.length >= max) list.shift();
    list.push(playerId);
    return list;
  }
  return [playerId];
}

/** The select value of the Mayor redirect: empty means the host has not answered. */
export function redirectChoiceValue(redirect: string | null | undefined): string {
  return redirect ?? "";
}

export interface JugglerGuessPair {
  playerId: string;
  roleId: string;
}

/**
 * The Juggler's recorded guesses in the current pair-list shape, or in the
 * legacy player-id map a saved game may still carry.
 */
export function normalizeJugglerGuesses(stored: unknown): JugglerGuessPair[] {
  if (Array.isArray(stored)) {
    return stored.flatMap((entry) => {
      const value = recordOf(entry);
      return value && typeof value.playerId === "string" && typeof value.roleId === "string"
        ? [{ playerId: value.playerId, roleId: value.roleId }]
        : [];
    });
  }
  const map = recordOf(stored);
  return map
    ? Object.entries(map).flatMap(([playerId, roleId]) =>
        typeof roleId === "string" ? [{ playerId, roleId }] : [],
      )
    : [];
}

/**
 * The day the Juggler may guess. A stored day is the Juggler's own day; without
 * one, a dealt Juggler starts on day 1, and a Juggler created later starts on
 * the day the host sees them.
 */
export function jugglerGuessingDay(
  day: number,
  storedDay: number | null | undefined,
  createdLater: boolean,
): number {
  if (typeof storedDay === "number") return storedDay;
  return createdLater ? day : 1;
}

/** The six states the issue keeps apart in the step card and the log. */
export type ConsequenceKind =
  | "target"
  | "applied"
  | "death"
  | "scheduled"
  | "prevented"
  | "revived";

export interface Consequence {
  kind: ConsequenceKind;
  playerIds: string[];
}

/**
 * Classifies a preview into the step contract's states. `target` comes from the
 * draft, the rest from the domain events and the future view, so a preview
 * never claims a death happened when the engine only scheduled it.
 */
export function consequencesOf(
  outcome: PreviewOutcome | null | undefined,
  targetIds: string[] = [],
): Consequence[] {
  if (!outcome || outcome.status !== "allowed") return [];
  const lines: Consequence[] = [];
  const add = (kind: ConsequenceKind, playerIds: string[] = []) => {
    const found = lines.find((line) => line.kind === kind);
    if (found) {
      for (const id of playerIds) if (!found.playerIds.includes(id)) found.playerIds.push(id);
      return;
    }
    lines.push({ kind, playerIds: [...playerIds] });
  };
  if (targetIds.length) add("target", targetIds);
  for (const event of outcome.events || []) {
    if (event.type === "effect.added") add("applied");
    else if (event.type === "phase.changed" || event.type === "winner.declared") add("applied");
    else if (event.type === "death.recorded") {
      const death = event.payload.death as { playerId?: unknown } | null;
      const id = death && typeof death.playerId === "string" ? death.playerId : "";
      add("death", id ? [id] : []);
    } else if (event.type === "player.alive_changed") {
      add(event.payload.alive ? "revived" : "death", [String(event.payload.playerId)]);
    } else if (event.type === "player.registered_dead_changed" && event.payload.registeredDead) {
      add("prevented", [String(event.payload.playerId)]);
    }
  }
  if (outcome.result?.noDeath) add("prevented", targetIds);
  for (const effect of outcome.future?.delayedEffects || []) {
    // `expires` alone is a poison or protection; only a `resolve` (the Pukka's
    // delayed death) is a pending death.
    if (effect.kind === "pukka-death" || effect.resolve) {
      add("scheduled", effect.targetId ? [effect.targetId] : []);
    }
  }
  if (!outcome.events?.length && outcome.changes?.deaths?.length) {
    add("death", outcome.changes.deaths);
  }
  return lines;
}

/**
 * The category of a saved log line. It uses the entry kind and the player's
 * current life, not localized titles: a death-style entry for a living player
 * is a prevented death, and a winner entry is not a consequence line.
 */
export function logConsequence(entry: {
  kind: string;
  consequence?: "death" | "prevented" | "revived";
}): ConsequenceKind | null {
  if (entry.consequence) return entry.consequence;
  if (entry.kind === "winner") return null;
  return entry.kind === "death" || entry.kind === "execution" ? "death" : "applied";
}

export function displayName(player: Player | null | undefined, t: Translate): string {
  if (!player) return "—";
  return player.name || (player.seat ? t("ui.player") + " " + player.seat : "—");
}

export function roleNameOf(id: string | null | undefined, roles: RoleLookup): string {
  const role = roles(id || "");
  return role ? role.name : roleLabel(id || "");
}

export function stepTitle(
  step: NightStep | null | undefined,
  roles: RoleLookup,
  t: Translate,
): string {
  if (!step) return "";
  if (step.roleId) return roleNameOf(step.roleId, roles);
  return step.system ? t("system." + step.system) : t("step");
}

export function targetNames(
  ids: string[] | null | undefined,
  state: GameState,
  t: Translate,
): string {
  return (ids || [])
    .map((id) => {
      const player = playerById(state, id);
      return player ? displayName(player, t) : id;
    })
    .join(", ");
}

/** The over-panel key for the actual win cause, not just its reason code. */
export function winReasonKey(state: GameState, winner: { reason: string } | null): string {
  if (!winner) return "";
  if (winner.reason === "demon-dead") {
    const execution = state.day?.execution;
    const executed = execution ? playerById(state, execution.playerId) : null;
    if (executed && roleTeam(executed.roleId || "") === "demon") {
      return "winReason.demon-executed";
    }
  }
  return "winReason." + winner.reason;
}

export function causeText(cause: string, t: Translate): string {
  return (
    {
      execution: t("ui.execution"),
      ability: t("ui.ability"),
      demon: t("ui.demon"),
      slayer: t("ui.slayer"),
      virgin: t("ui.virgin"),
      "imp-self-kill": t("ui.selfKill"),
      manual: t("ui.correction"),
      legacy: t("ui.migrated"),
    }[cause] || cause
  );
}

/**
 * The five guidance blocks of one step. A Drunk actor runs the shown role's
 * step, but the ability does not work and the information is false, so the
 * Drunk guidance replaces the shown role's guide.
 */
export function guideForStep(
  t: Translate,
  guide: (step: NightStep) => Guide,
  state: GameState,
  step: NightStep,
): Guide {
  const actor = step.actorId ? playerById(state, step.actorId) : null;
  if (actor?.roleId === "drunk" && step.kind !== "system") {
    return {
      host: t("guide.drunk.host"),
      player: t("guide.player"),
      grimoire: t("guide.drunk.grimoire"),
      publicLine: t("guide.public"),
      check: t("guide.drunk.check"),
    };
  }
  return guide(step);
}

export function timerText(end: number | null, now: number): string {
  if (!end) return "—";
  const left = Math.max(0, end - now);
  const minutes = Math.floor(left / 60000);
  const seconds = Math.floor((left % 60000) / 1000);
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}

export function infoText(
  state: GameState,
  step: NightStep,
  info: StepInfo | null | undefined,
  roles: RoleLookup,
  t: Translate,
): string {
  if (!info) return t("none");
  const roleName = (id: string | null | undefined) => roleNameOf(id, roles);
  if (info.kind === "note") {
    // A computed note (the Lunatic report attached to the Demon's step) is the
    // live information. A step whose computed text is just its static note
    // keeps the localized key.
    if (info.text && (info.text !== step.note || !step.noteKey)) return info.text;
    if (step.noteKey) return t(step.noteKey, step.noteVars ?? undefined);
    return info.text || t("none");
  }
  if (info.kind === "one-of-two") {
    if (info.zero) return t("ui.zero");
    if (!info.roleId) return info.text || t("ui.notSet");
    const pair = (info.pair || []).map((id) => {
      const player = playerById(state, id);
      return player ? `${displayName(player, t)} (${player.seat})` : id;
    });
    return t("infoPairResult", { role: roleName(info.roleId), pair: pair.join(t("ui.or")) });
  }
  if (info.kind === "number") return t("numberResult", { value: String(info.value) });
  if (info.kind === "yes-no") {
    return t("answerResult", { value: info.value ? t("yes") : t("no") });
  }
  if (info.kind === "character") {
    const player = info.playerId ? playerById(state, info.playerId) : null;
    return `${player ? displayName(player, t) : t("ui.player")} — ${
      info.roleId ? roleName(info.roleId) : t("ui.unknown")
    }.`;
  }
  if (info.kind === "grimoire") return t("ui.showGrimoireHint");
  if (info.kind === "minion-info") {
    const demon = info.demonId ? playerById(state, info.demonId) : null;
    return t("demonResult", { name: demon ? displayName(demon, t) : "—" });
  }
  if (info.kind === "demon-info") {
    const minions = livingPlayers(state)
      .filter((player) => roleTeam(player.roleId || "") === "minion")
      .map((player) => displayName(player, t))
      .join(", ");
    const bluffs = (info.bluffs || state.bluffs || []).map(roleName).join(", ");
    const base = t("demonInfoResult", { minions: minions || "—", bluffs: bluffs || "—" });
    const lunatic = info.lunaticId ? playerById(state, info.lunaticId) : null;
    return lunatic ? base + " " + t("lunaticReveal", { name: displayName(lunatic, t) }) : base;
  }
  return info.text || t("none");
}

/** The command payload keeps an information result as a plain record. */
export function infoPayload(info: StepInfo | null | undefined): Record<string, unknown> | null {
  return info ? Object.fromEntries(Object.entries(info)) : null;
}

export function applyGiven(
  info: StepInfo | null | undefined,
  raw: string,
  kind: string,
): StepInfo | null | undefined {
  if (!info) return info;
  if (kind === "number") return { ...info, value: Number(raw), needsChoice: false };
  if (kind === "bool") return { ...info, value: raw === "true", needsChoice: false };
  if (kind === "role") return { ...info, roleId: raw, needsChoice: false };
  return info;
}

export function defaultCorrectionValue(kind: string, player: Player | null | undefined): string {
  if (kind === "role") return (player && player.roleId) || RULE_ROLES[0] || "";
  if (kind === "alive") return player && player.alive ? "dead" : "alive";
  return "";
}
