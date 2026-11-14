// The phase cards: night, day, deal/setup and the over/review card. Each card
// reads the published state and the draft hook; it keeps no state of its own.
import {
  madnessReviewProjection,
  poisonChoicesProjection,
  resurrectChoices,
  secretsProjection,
  seatProjection,
  shownRoleChoices,
  tableProjection,
} from "../../../application/read-models/table.ts";
import { useEffect, useState } from "react";
import { livingPlayers, orderedPlayers, playerById } from "../../../core/model/state.ts";
import { ALL_ROLES, isManualScript } from "../../../core/model/rules.ts";
import { roleSupportEntries } from "../../../core/model/support.ts";
import type { NightStep } from "../../../core/model/types.ts";
import {
  applyGiven,
  causeText,
  displayName,
  guideForStep,
  infoText,
  jugglerGuessingDay,
  localizeVars,
  normalizeJugglerGuesses,
  redirectChoiceValue,
  roleNameOf,
  stepTitle,
  targetNames,
  winReasonKey,
} from "./helpers.ts";
import type { StepInfo } from "./helpers.ts";
import { Warn } from "./parts.tsx";
import { stepContext } from "./step-context.ts";
import { writeStepDraft } from "./step-draft.ts";
import type { StepDraft } from "./step-draft.ts";
import type { TableView } from "./view.ts";
import {
  ALERT,
  CARD,
  CARD_LINE,
  CARD_TEXT,
  CARD_TITLE,
  CHECK,
  CHIP,
  CHIPS,
  FIELD_BOX,
  INFO_PREVIEW,
  INLINE,
  MUTED,
  NIGHT_CARD,
  DAY_CARD,
  OVER_CARD,
  PRIMARY,
  SECTION,
  TARGET,
  TARGET_GRID,
  TARGET_ON,
  WARNING,
} from "./styles.ts";

type PendingOption = { id: string; name: string; roleId: string };

function effectName(kind: string, t: TableView["ports"]["strings"]["t"]): string {
  const key = "ui.effect." + kind;
  const label = t(key);
  return label === key ? kind : label;
}

export function MainCard({ view }: { view: TableView }) {
  const { state } = view;
  if (state.phase === "over") return <OverCard view={view} />;
  if (state.phase === "night") return <NightCard view={view} />;
  // A new day or a new game remounts the card, so its execution drafts start
  // clean instead of carrying a survival choice from the previous one.
  if (state.phase === "day")
    return <DayCard key={`${state.createdAt}:${state.day.number}`} view={view} />;
  if (state.phase === "setup" && !state.setup.roles.length) return <SetupPrompt view={view} />;
  return <DealCard view={view} />;
}

export function NightCard({ view }: { view: TableView }) {
  const { state, ports, actions } = view;
  const t = ports.strings.t;
  const { step, progress, pendingDemonChange } = tableProjection(state);
  const pending = pendingDemonChange as {
    key: string;
    pending?: { options?: PendingOption[] };
  } | null;

  if (pending) {
    const options = pending.pending ? pending.pending.options || [] : [];
    return (
      <section className={`host-card is-night ${NIGHT_CARD}`}>
        <p className="label">{t("pendingHeir")}</p>
        <h1 className={CARD_TITLE}>{t("pendingHeirText")}</h1>
        <div className={TARGET_GRID}>
          {options.map((option) => (
            <button
              key={option.id}
              className={TARGET}
              type="button"
              data-heir={pending.key}
              data-id={option.id}
              onClick={() =>
                actions.run({
                  type: "chooseDemonHeir",
                  payload: { stepKey: pending.key, heirId: option.id },
                })
              }
            >
              {option.name}
              <small className="mt-0.5 block text-[12px] text-muted">
                {roleNameOf(option.roleId, ports.roles.byId)}
              </small>
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (!step) {
    return (
      <section className={`host-card is-night ${NIGHT_CARD}`}>
        {manualWarning(view)}
        <p className="label">
          {t("night")} {state.night.number}
        </p>
        <h1 className={CARD_TITLE}>{state.night.queue.length ? t("ui.allDone") : t("noWake")}</h1>
        <p className={CARD_TEXT}>
          {t("check")}: {progress.done} / {progress.total}.
        </p>
      </section>
    );
  }

  return <StepCard view={view} step={step} />;
}

function StepCard({ view, step }: { view: TableView; step: NightStep }) {
  const { state, drafts, ports, actions } = view;
  const t = ports.strings.t;
  const guide = guideForStep(t, ports.guidance.for, state, step);
  const role = step.roleId ? ports.roles.byId(step.roleId) : null;
  const roleSupport = step.roleId ? roleSupportEntries([step.roleId])[0] : undefined;
  const actor = step.actorId ? playerById(state, step.actorId) : null;
  const key = step.key;
  const context = stepContext(state, drafts, step);
  const { draftKey, selected, registrations, given, redirect, derived } = context;
  const info = derived.info;
  const { targetsIncomplete, deadImpTarget, poisonChoices } = context;
  const needsSetup = Boolean(info.missing);
  const targetIsMayor = context.targetsMayor;
  const stepEffects = derived.effects;

  // Recovery aid: the untouched draft of this step survives a reload. It is
  // not a game mutation, so it never enters the store or the undo history.
  const storedDraft: StepDraft = {
    key: draftKey,
    targets: selected,
    redirect: redirect ?? null,
    registrations,
    given: given ?? null,
    bmrDeaths: drafts.bmrDeaths.get(draftKey) || [],
    bmrResurrect: drafts.bmrResurrect.get(draftKey) || null,
    bmrRoles: drafts.bmrRoles.get(draftKey) || null,
    bmrDrunk: drafts.bmrDrunk.get(draftKey) || null,
    bmrPoison: drafts.bmrPoison.get(draftKey) || poisonChoices[0] || null,
  };
  const storedDraftText = JSON.stringify(storedDraft);
  useEffect(() => {
    writeStepDraft(ports.prefs.write, storedDraft);
  }, [ports.prefs.write, draftKey, storedDraftText]);

  return (
    <section className={`host-card is-night ${NIGHT_CARD}`} data-step={key} data-step-sheet>
      {manualWarning(view)}
      <div className="flex items-center justify-between gap-2">
        <p className="label">{t("ui.activeRole")}</p>
        <span className="text-[9px] uppercase tracking-[.12em] text-brass">
          {actor ? displayName(actor, t) : ""}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2.5 rounded-sm border border-edge-2 bg-crypt-3 p-2">
        {role ? (
          <img
            className="size-11 shrink-0 rounded-sm border border-edge-2 bg-crypt object-contain p-1"
            src={ports.roles.image(role)}
            alt=""
          />
        ) : null}
        <div className="min-w-0">
          <b className="block truncate font-role text-[18px] leading-tight text-parchment">
            {stepTitle(step, ports.roles.byId, t)}
          </b>
          <small className="mt-0.5 block truncate text-[10px] text-muted">
            {role ? ports.strings.teamText(role.team) : ""}
            {step.targetMode !== "none" ? ` · ${t("chooseTarget")}` : ""}
          </small>
        </div>
      </div>
      {step.deadTonight ? <p className={`${ALERT} text-danger`}>{t("ui.deadWake")}</p> : null}
      {derived.actorImpaired ? <p className={`${ALERT} text-danger`}>{t("ui.impaired")}</p> : null}

      <details
        className="my-2.5 overflow-hidden rounded-sm border border-edge bg-crypt-3"
        open={drafts.guided}
        data-guide
        onToggle={(event) => actions.toggleGuided(event.currentTarget.open)}
      >
        <summary className="min-h-11 cursor-pointer p-2.5 text-[12px]">
          {t("guidedInstructions")}
        </summary>
        {roleSupport ? (
          <p
            className={`${MUTED} px-2.5`}
            data-role-support={roleSupport.roleId}
            data-status={roleSupport.status}
          >
            <b>{t("roleSupport")}:</b> {t("roleSupport." + roleSupport.status)} —{" "}
            {t(roleSupport.detail)}
          </p>
        ) : null}
        <div className="grid gap-1.5 px-2.5 pb-2.5" data-step-summary>
          <p className={MUTED}>
            {t("ui.stepWakes", {
              name: actor ? displayName(actor, t) : stepTitle(step, ports.roles.byId, t),
            })}
          </p>
          <p className={MUTED}>
            <b>{t("ui.stepAllowed")}:</b> {guide.host || guide.check}
          </p>
          <p className={MUTED}>
            {t("ui.chosenTargets", { names: targetNames(selected, state, t) || "—" })}
          </p>
          {step.noteKey || step.note ? (
            <p className={MUTED} data-step-note>
              {step.noteKey
                ? t(step.noteKey, localizeVars(step.noteVars, ports.roles.byId))
                : step.note}
            </p>
          ) : null}
          <div className="grid gap-1">
            <span className="label">{t("ui.activeEffects")}</span>
            {stepEffects.length ? (
              <span className={CHIPS}>
                {stepEffects.map((effect) => (
                  <span key={effect.id} className={CHIP} data-effect={effect.kind}>
                    {effectName(effect.kind, t)}
                  </span>
                ))}
              </span>
            ) : (
              <p className={MUTED}>{t("ui.noActiveEffects")}</p>
            )}
          </div>
        </div>
        {guideRow(t("hostAction"), guide.host)}
        {guideRow(t("playerAction"), guide.player)}
        {guideRow(t("grimoireNote"), guide.grimoire)}
        {guideRow(t("publicLine"), guide.publicLine)}
        {guideRow(t("check"), guide.check)}
      </details>

      {step.targetMode !== "none" ? (
        <div className="mt-3 rounded-sm border border-edge bg-crypt-3 p-2.5 text-[11px] text-muted">
          <b className="text-text">{t("ui.chooseTargetOnTable")}</b>
          {selected.length ? <span>: {targetNames(selected, state, t)}</span> : null}
          {deadImpTarget ? <p className={`${WARNING} mt-1`}>{t("ui.deadTarget")}</p> : null}
        </div>
      ) : null}

      {targetIsMayor ? (
        <label className={FIELD_BOX}>
          <span className="label">{t("forced")}</span>
          <select
            className="field"
            data-redirect={key}
            value={redirectChoiceValue(redirect)}
            onChange={(event) => drafts.putRedirect(draftKey, event.target.value || "none")}
          >
            <option value="" disabled>
              {t("ui.chooseRedirect")}
            </option>
            <option value="none">{t("ui.mayorDies")}</option>
            {orderedPlayers(state)
              .filter((player) => player.id !== selected[0])
              .map((player) => (
                <option key={player.id} value={player.id}>
                  {!player.alive
                    ? t("mayorRedirectDead", { name: displayName(player, t) })
                    : seatProjection(state, player.id).safeFromAttack
                      ? t("mayorRedirectProtected", { name: displayName(player, t) })
                      : t("mayorRedirectResult", { name: displayName(player, t) })}
                </option>
              ))}
          </select>
        </label>
      ) : null}

      <RegistrationStep view={view} step={step} draftKey={draftKey} />

      {step.infoKind !== "none" ? (
        <div className={SECTION}>
          <span className="label">{t("computed")}</span>
          <div className={INFO_PREVIEW}>
            {needsSetup
              ? t("ui.needsSecrets")
              : targetsIncomplete
                ? t("ui.targetFirst")
                : infoText(state, step, given || info, ports.roles.byId, t)}
          </div>
          {!targetsIncomplete ? (
            <GivenSelect view={view} step={step} info={info} draftKey={draftKey} />
          ) : null}
          {given ? (
            <p className={MUTED}>
              {t("given")}: {infoText(state, step, given, ports.roles.byId, t)}
            </p>
          ) : null}
          {!needsSetup && !targetsIncomplete ? (
            step.roleId === "spy" ? (
              <div className="grid gap-1">
                <button
                  className="btn"
                  type="button"
                  data-act="show-grimoire"
                  onClick={actions.openGrimoire}
                >
                  {t("ui.showGrimoire")}
                </button>
                {derived.actorImpaired ? (
                  <p className={`${ALERT} text-amber-2`} data-warning="spyFalseGrimoire">
                    {t("ui.spyFalseGrimoire")}
                  </p>
                ) : null}
              </div>
            ) : derived.actorImpaired ? (
              <div className="mt-1 grid gap-1.5" data-template>
                <label className={FIELD_BOX}>
                  <span className="label">{t("ui.template")}</span>
                  <textarea
                    className="field min-h-[64px] resize-y"
                    data-info-template
                    value={drafts.infoTemplate}
                    onChange={(event) => drafts.setInfoTemplate(event.target.value)}
                  />
                </label>
                <p className={MUTED}>{t("ui.templateHint")}</p>
                <button
                  className="btn"
                  type="button"
                  data-act="show-template"
                  disabled={!drafts.infoTemplate.trim()}
                  onClick={() => actions.openInfo(key)}
                >
                  {t("ui.showTemplate")}
                </button>
              </div>
            ) : (
              <button
                className="btn"
                type="button"
                data-act="show-info"
                data-key={key}
                onClick={() => actions.openInfo(key)}
              >
                {t("showCard")}
              </button>
            )
          ) : null}
        </div>
      ) : null}

      {needsSetup ? (
        <Warn title={t("setupErrors")} bad>
          <p>{t("secretsIntro")}</p>
          <a className="btn" href={ports.router.path("secrets")}>
            {t("secrets")}
          </a>
        </Warn>
      ) : null}

      <BmrOutcome view={view} step={step} draftKey={draftKey} />
    </section>
  );
}

function guideRow(label: string, text: string | undefined) {
  return (
    <div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-2 border-t border-edge px-[10px] py-[7px] first:border-t-0 max-[640px]:grid-cols-1 max-[640px]:gap-px">
      <span className="label whitespace-nowrap">{label}</span>
      <p className="m-0 text-[16px] leading-[1.45]">{text || "—"}</p>
    </div>
  );
}

function manualWarning(view: TableView) {
  const { state, ports } = view;
  if (!isManualScript(state.script)) return null;
  return (
    <Warn title={ports.strings.t("manualOnlyTitle")} className="manual-warning">
      <p>{ports.strings.t("manualOnlyWarning")}</p>
    </Warn>
  );
}

function bmrWarning(view: TableView) {
  const { state, ports } = view;
  const edition = state.script ? state.script.edition : "tb";
  if (edition !== "bmr" && edition !== "snv") return null;
  return (
    <Warn title={ports.strings.t("bmrHostWarningTitle")} className="bmr-warning">
      <p>{ports.strings.t(edition === "snv" ? "svHostWarning" : "bmrHostWarning")}</p>
    </Warn>
  );
}

function RegistrationStep({
  view,
  step,
  draftKey,
}: {
  view: TableView;
  step: NightStep;
  draftKey: string;
}) {
  const { state, drafts, ports } = view;
  const t = ports.strings.t;
  const relevant = orderedPlayers(state).filter(
    (player) => player.roleId === "spy" || player.roleId === "recluse",
  );
  if (!relevant.length) return null;
  const regs = drafts.registrations.get(draftKey) || {};
  const setReg = (playerId: string, value: string, checked: boolean) => {
    const next = { ...regs };
    if (checked) next[playerId] = value;
    else delete next[playerId];
    drafts.putRegistrations(draftKey, next);
  };
  if (step.roleId === "chef" || step.roleId === "empath") {
    return (
      <div className="mb-2 grid gap-1">
        <span className="label">{t("registration")}</span>
        {relevant.map((player) => {
          const spy = player.roleId === "spy";
          const value = spy ? "good" : "evil";
          return (
            <label key={player.id} className={CHECK}>
              <input
                type="checkbox"
                className="mt-0.5"
                data-reg={step.key}
                data-reg-player={player.id}
                data-reg-value={value}
                checked={regs[player.id] === value}
                onChange={(event) => setReg(player.id, value, event.target.checked)}
              />
              <span>
                {spy ? t("ui.spyGood") : t("recluseEvil")} — {displayName(player, t)}
              </span>
            </label>
          );
        })}
      </div>
    );
  }
  if (step.roleId === "fortuneteller") {
    return (
      <div className="mb-2 grid gap-1">
        <span className="label">{t("registration")}</span>
        {relevant
          .filter((player) => player.roleId === "recluse")
          .map((player) => (
            <label key={player.id} className={CHECK}>
              <input
                type="checkbox"
                className="mt-0.5"
                data-reg={step.key}
                data-reg-player={player.id}
                data-reg-value="demon"
                checked={regs[player.id] === "demon"}
                onChange={(event) => setReg(player.id, "demon", event.target.checked)}
              />
              <span>
                {t("recluseDemon")} — {displayName(player, t)}
              </span>
            </label>
          ))}
      </div>
    );
  }
  return null;
}

function GivenSelect({
  view,
  step,
  info,
  draftKey,
}: {
  view: TableView;
  step: NightStep;
  info: StepInfo;
  draftKey: string;
}) {
  const { state, drafts, ports } = view;
  const t = ports.strings.t;
  if (!info.needsChoice) return null;
  if (info.kind === "note") {
    // The host decides what a note-style role learns (Dreamer, Sage,
    // Mathematician under a Vortox): the recorded text is the decision.
    const current = drafts.givens.get(draftKey);
    return (
      <label className={FIELD_BOX}>
        <span className="label">{t("falseInfo")}</span>
        <textarea
          className="field min-h-[52px] resize-y"
          data-given={step.key}
          data-given-kind="note"
          defaultValue={current?.text ?? ""}
          placeholder={info.text || t("computed")}
          onChange={(event) => {
            const text = event.target.value.trim();
            if (!text) {
              drafts.dropGiven(draftKey);
              return;
            }
            drafts.putGiven(draftKey, { ...info, text, needsChoice: false });
          }}
        />
      </label>
    );
  }
  let options: Array<string | number | boolean> = [];
  let kind = "number";
  if (info.kind === "number") {
    options =
      info.options && info.options.length
        ? (info.options as Array<string | number | boolean>)
        : Array.from({ length: orderedPlayers(state).length + 1 }, (_, index) => index);
  } else if (info.kind === "yes-no") {
    kind = "bool";
    options =
      info.options && info.options.length
        ? (info.options as Array<string | number | boolean>)
        : [true, false];
  } else if (info.kind === "character") {
    kind = "role";
    options =
      info.options && info.options.length
        ? (info.options as Array<string | number | boolean>)
        : info.playerId
          ? shownRoleChoices(state, info.playerId)
          : ALL_ROLES;
  } else if (info.kind === "one-of-two") {
    kind = "role";
    options =
      info.options && info.options.length
        ? (info.options as Array<string | number | boolean>)
        : ALL_ROLES;
  }
  if (!options.length) return null;
  // A character answer for a healthy Undertaker or Ravenkeeper is a
  // registration decision, and a missing data source is a plain host answer;
  // only a false-information decision gets the false-information label.
  const label =
    kind === "role" && !info.impaired
      ? t("registration")
      : info.hostAnswer && !info.impaired
        ? t("ui.hostAnswer")
        : t("falseInfo");
  return (
    <label className={FIELD_BOX}>
      <span className="label">{label}</span>
      <select
        className="field"
        data-given={step.key}
        data-given-kind={kind}
        value=""
        onChange={(event) => {
          const raw = event.target.value;
          if (!raw) {
            drafts.dropGiven(draftKey);
            return;
          }
          const next = applyGiven(info, raw, kind);
          if (next) drafts.putGiven(draftKey, next);
        }}
      >
        <option value="">
          {t("computed")}: {infoText(state, step, info, ports.roles.byId, t)}
        </option>
        {options.map((value) => (
          <option key={String(value)} value={String(value)}>
            {kind === "role"
              ? roleNameOf(String(value), ports.roles.byId)
              : kind === "bool"
                ? value
                  ? t("yes")
                  : t("no")
                : String(value)}
          </option>
        ))}
      </select>
    </label>
  );
}

function BmrOutcome({
  view,
  step,
  draftKey,
}: {
  view: TableView;
  step: NightStep;
  draftKey: string;
}) {
  const { state, drafts, ports } = view;
  const t = ports.strings.t;
  if (!step.bmr && !step.sv) return null;
  const dead = orderedPlayers(state).filter((player) => !player.alive);
  const deaths = drafts.bmrDeaths.get(draftKey) || [];
  const chosenDeath = drafts.bmrResurrect.get(draftKey) || "";
  const poisonChoices = step.roleId === "vigormortis" ? poisonChoicesProjection(state, deaths) : [];
  const key = step.key;
  return (
    <div className={`${SECTION} grid gap-1`}>
      <span className="label">{t("bmrOutcome")}</span>
      <p className={MUTED}>{t(step.roleId === "pukka" ? "bmrPukkaAuto" : "bmrHostRuns")}</p>
      {Array.isArray(step.roleChoices) && step.roleChoices.length ? (
        <div className="grid gap-1 rounded-sm border border-edge p-2" data-bmr-decision="role">
          <label className={FIELD_BOX}>
            <span className="label">{t("bmrRoleChoice")}</span>
            <select
              className="field"
              data-bmr-role={key}
              value={drafts.bmrRoles.get(draftKey) || ""}
              onChange={(event) => drafts.putBmrRole(draftKey, event.target.value || null)}
            >
              <option value="">{t("ui.chooseRole")}</option>
              {(step.roleChoices as unknown[]).map((id) => (
                <option key={String(id)} value={String(id)}>
                  {roleNameOf(String(id), ports.roles.byId)}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {step.roleId === "tinker" ? (
        <div className="grid gap-1 rounded-sm border border-edge p-2" data-bmr-decision="tinker">
          <span className="label">{t("ui.tinkerDecision")}</span>
          <p className={`${MUTED} m-0`}>{t("ui.tinkerHint")}</p>
          <div className={INLINE}>
            <button
              className={`${TARGET} ${deaths.includes(String(step.actorId)) ? TARGET_ON : ""}`}
              type="button"
              data-tinker-decision="die"
              onClick={() =>
                drafts.putBmrDeaths(draftKey, step.actorId ? [String(step.actorId)] : [])
              }
            >
              {t("ui.tinkerDies")}
            </button>
            <button
              className={`${TARGET} ${deaths.length ? "" : TARGET_ON}`}
              type="button"
              data-tinker-decision="live"
              onClick={() => drafts.putBmrDeaths(draftKey, [])}
            >
              {t("ui.tinkerLives")}
            </button>
          </div>
        </div>
      ) : null}
      {step.canKill && step.roleId !== "tinker" ? (
        <div className="grid gap-1 rounded-sm border border-edge p-2" data-bmr-decision="marking">
          <div className={TARGET_GRID}>
            {orderedPlayers(state)
              .filter((player) => player.alive)
              .map((player) => (
                <button
                  key={player.id}
                  className={`${TARGET} ${deaths.includes(player.id) ? TARGET_ON : ""}`}
                  type="button"
                  data-bmr-death={key}
                  data-id={player.id}
                  onClick={() => {
                    const list = deaths.slice();
                    const at = list.indexOf(player.id);
                    if (at === -1) list.push(player.id);
                    else list.splice(at, 1);
                    drafts.putBmrDeaths(draftKey, list);
                  }}
                >
                  <span className="block text-[12px]">
                    {player.seat} · {displayName(player, t)}
                  </span>
                  <small className="mt-0.5 block text-[12px] text-muted">
                    {roleNameOf(player.roleId, ports.roles.byId)}
                  </small>
                </button>
              ))}
          </div>
          <p className={MUTED}>
            {t("bmrDeaths")}: {targetNames(deaths, state, t) || "—"}
          </p>
        </div>
      ) : null}
      {poisonChoices.length ? (
        <label className={FIELD_BOX}>
          <span className="label">{t("bmrPoisonChoice")}</span>
          <select
            className="field"
            data-bmr-poison={key}
            value={drafts.bmrPoison.get(draftKey) || poisonChoices[0] || ""}
            onChange={(event) => drafts.putBmrPoison(draftKey, event.target.value || null)}
          >
            {poisonChoices.map((id) => {
              const player = playerById(state, id);
              return (
                <option key={id} value={id}>
                  {player ? displayName(player, t) : id}
                </option>
              );
            })}
          </select>
        </label>
      ) : null}
      {(step.roleId === "sailor" || step.roleId === "innkeeper") &&
      (drafts.targets.get(draftKey) || []).length ? (
        <label className={FIELD_BOX}>
          <span className="label">{t("bmrDrunkChoice")}</span>
          <select
            className="field"
            data-bmr-drunk={key}
            value={drafts.bmrDrunk.get(draftKey) || ""}
            onChange={(event) => drafts.putBmrDrunk(draftKey, event.target.value || null)}
          >
            <option value="" disabled>
              {t("ui.choosePlayer")}
            </option>
            {(step.roleId === "sailor"
              ? [step.actorId, ...(drafts.targets.get(draftKey) || [])]
              : drafts.targets.get(draftKey) || []
            )
              .filter((id): id is string => Boolean(id))
              .map((id) => {
                const player = playerById(state, id);
                return (
                  <option key={id} value={id}>
                    {player ? displayName(player, t) : id}
                  </option>
                );
              })}
          </select>
        </label>
      ) : null}
      {step.canResurrect && dead.length ? (
        <label className={FIELD_BOX}>
          <span className="label">{t("bmrResurrect")}</span>
          <select
            className="field"
            data-bmr-resurrect={key}
            value={chosenDeath}
            onChange={(event) => drafts.putBmrResurrect(draftKey, event.target.value || null)}
          >
            <option value="">{t("none")}</option>
            {resurrectChoices(state, step, drafts.targets.get(draftKey) || []).map((id) => {
              const player = playerById(state, id);
              return (
                <option key={id} value={id}>
                  {player ? displayName(player, t) : id} ·{" "}
                  {roleNameOf(player ? player.roleId : "", ports.roles.byId)}
                </option>
              );
            })}
          </select>
        </label>
      ) : null}
    </div>
  );
}

export function DayCard({
  view,
  roleFormsOnly = false,
}: {
  view: TableView;
  roleFormsOnly?: boolean;
}) {
  const { state, drafts, ports, actions } = view;
  const t = ports.strings.t;
  // The execution choice and its survival flag live in the shared drafts, so
  // the day card and the dock make one decision.
  const day = state.day;
  const executed = day.execution ? playerById(state, day.execution.playerId) : null;
  const living = livingPlayers(state);
  const manual = isManualScript(state.script);
  const pacifistSupport = roleSupportEntries(state.setup.roles || []).find(
    (entry) => entry.roleId === "pacifist",
  );
  const virgin = !manual
    ? orderedPlayers(state).find(
        (player) => player.roleId === "virgin" && player.alive && !player.used.virgin,
      )
    : null;
  const slayer =
    !manual && !day.execution && !day.ended
      ? orderedPlayers(state).find(
          (player) => player.roleId === "slayer" && player.alive && !player.used.slayer,
        )
      : null;
  const canExecute =
    Boolean(drafts.executeTarget) &&
    Boolean(playerById(state, drafts.executeTarget)?.alive) &&
    !day.execution &&
    !day.ended &&
    !state.winner;

  return (
    <section className={`host-card is-day ${DAY_CARD}`} data-step="day">
      {manualWarning(view)}
      <p className="label">
        {t("day")} {day.number}
      </p>
      <h1 className={CARD_TITLE}>{t("ui.dayResult")}</h1>

      {!roleFormsOnly && !day.execution && !day.ended ? (
        <div className="my-2.5 grid gap-1.5 rounded-sm border border-edge p-2.5">
          <span className="label">{t("ui.executedWho")}</span>
          <div className={INLINE}>
            <select
              className="field min-w-[180px]"
              data-exec-target
              value={drafts.executeTarget}
              onChange={(event) => drafts.setExecuteTarget(event.target.value)}
            >
              <option value="">{t("ui.noExecution")}</option>
              {orderedPlayers(state).map((player) => (
                <option key={player.id} value={player.id}>
                  {displayName(player, t)}
                  {player.alive ? "" : t("ui.alreadyDead")}
                </option>
              ))}
            </select>
            <button
              className="btn btn--accent"
              type="button"
              data-act="execute-direct"
              disabled={!canExecute}
              onClick={() => {
                if (!drafts.executeTarget) return;
                const result = actions.run({
                  type: "executeByDecision",
                  payload: {
                    playerId: drafts.executeTarget,
                    options: { survives: drafts.executeSurvives },
                  },
                });
                if (result.status === "allowed") {
                  drafts.setExecuteTarget("");
                  drafts.setExecuteSurvives(false);
                }
              }}
            >
              {t("execute")}
            </button>
          </div>
          {state.script &&
          Array.isArray(state.script.roles) &&
          state.script.roles.some((id) =>
            ["pacifist", "sailor", "fool", "devilsadvocate", "zombuul"].includes(id),
          ) ? (
            <label className={CHECK}>
              <input
                type="checkbox"
                data-exec-survives
                checked={drafts.executeSurvives}
                onChange={(event) => drafts.setExecuteSurvives(event.target.checked)}
              />
              <span>{pacifistSupport ? t("ui.pacifistSurvives") : t("survivesExecution")}</span>
            </label>
          ) : null}
          {pacifistSupport ? (
            <p className={MUTED} data-role-support="pacifist" data-status={pacifistSupport.status}>
              <b>{t("roleSupport")}:</b> {t("roleSupport." + pacifistSupport.status)} —{" "}
              {t(pacifistSupport.detail)}
            </p>
          ) : null}
          <p className={MUTED}>{t("ui.tableVotes")}</p>
        </div>
      ) : null}

      {!manual && virgin && !day.execution && !day.ended ? (
        <form
          className="my-2.5 grid gap-1.5 rounded-sm border border-edge p-2.5"
          data-virgin-form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            actions.run({
              type: "recordVirginNomination",
              payload: {
                nominatorId: String(data.get("nominator") || ""),
                virginId: virgin.id,
                options: { spyRegistersTownsfolk: data.has("spy") },
              },
            });
          }}
        >
          <h2 className="m-0 text-[18px]">{t("virginNomination")}</h2>
          <p className={CARD_TEXT}>{t("virginHint")}</p>
          <label className="grid gap-1.5">
            {t("nominator")}
            <select className="field" name="nominator" required defaultValue="">
              <option value="">{t("chooseTarget")}</option>
              {living.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.seat} · {displayName(player, t)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="spy" /> {t("spyTownsfolk")}
          </label>
          <button className="btn" type="submit" data-virgin={virgin.id}>
            {t("recordNomination")}
          </button>
        </form>
      ) : null}

      {!roleFormsOnly && executed ? (
        <div className="my-2.5 rounded-md border border-crimson-dim bg-crimson-dim/20 p-2.5">
          <span className="label">{t("execution")}</span>
          <b className="my-0.5 block text-[18px]">{displayName(executed, t)}</b>
          <p className={MUTED}>
            {day.execution?.deathId ? t("ui.executedDied") : t("ui.executedNoDeath")}
          </p>
        </div>
      ) : null}

      {slayer ? <SlayerPanel view={view} slayerId={slayer.id} /> : null}
      {manual ? null : <GossipPanel view={view} />}
      {manual ? null : <JugglerPanel view={view} />}
      {manual ? null : <MoonchildPanel view={view} />}
      {manual ? null : mastermindPanel(view)}
    </section>
  );
}

/**
 * The day actions that are not role forms: the madness review, the manual
 * winner (manual scripts only) and the Tinker's daytime death. They live in the
 * table menu, not in the day-help sheet, which only resolves role forms.
 */
export function DayActionsPanel({ view }: { view: TableView }) {
  const { state, ports, drafts, actions } = view;
  const t = ports.strings.t;
  const [madnessReasons, setMadnessReasons] = useState<Record<string, string>>({});
  const madnessReviews = madnessReviewProjection(state);
  const day = state.day;
  const manual = isManualScript(state.script);
  const tinker =
    state.script && Array.isArray(state.script.roles) && state.script.roles.includes("tinker")
      ? orderedPlayers(state).find((player) => player.roleId === "tinker" && player.alive)
      : null;
  if (!madnessReviews.length && !manual && !tinker) return null;
  return (
    <>
      {tinker && state.phase === "day" && !day.execution && !day.ended && !state.winner ? (
        <div className="grid gap-1.5 rounded-sm border border-edge p-2.5" data-tinker-day>
          <span className="label">{t("ui.tinkerDay")}</span>
          <p className={`${MUTED} m-0`}>{t("ui.tinkerDayHint")}</p>
          <button
            className="btn"
            type="button"
            data-act="tinker-day-death"
            onClick={() => actions.run({ type: "tinkerDeath", payload: { playerId: tinker.id } })}
          >
            {t("ui.tinkerDayDies")}
          </button>
        </div>
      ) : null}
      {madnessReviews.length ? (
        <div
          className={`${SECTION} grid gap-2 border border-edge-2 border-l-2 border-l-accent p-2.5`}
          data-madness-review
        >
          <span className="label">{t("ui.madnessReviewTitle")}</span>
          <p className={`${MUTED} m-0`}>{t("ui.madnessReviewHint")}</p>
          {madnessReviews.map(({ effect, playerId, pending }) => {
            const playerName = displayName(playerById(state, playerId), t);
            const condition =
              effect.madness === "mutant"
                ? t("ui.madnessMutant", { name: playerName })
                : t("ui.madnessCerenovus", {
                    name: playerName,
                    role: roleNameOf(String(effect.roleId || ""), ports.roles.byId),
                  });
            const reason = madnessReasons[effect.id] || "";
            const executed = effect.decidedPenalty === "execute";
            return (
              <div
                key={effect.id}
                className="grid gap-1.5 rounded-sm border border-edge bg-crypt-2 p-2.5"
                data-madness-player={effect.targetId || ""}
                data-madness-status={pending ? "pending" : executed ? "executed" : "reviewed"}
              >
                <b>{condition}</b>
                <p className={`${MUTED} m-0`}>
                  {pending
                    ? t("ui.madnessPending")
                    : executed
                      ? t("ui.madnessReviewedExecute")
                      : t("ui.madnessReviewedNone")}
                </p>
                {!executed ? (
                  <label className="grid gap-1 text-[13px] text-muted">
                    {t("ui.madnessReason")}
                    <input
                      className="field"
                      value={reason}
                      aria-label={t("ui.madnessReason") + ": " + playerName}
                      data-madness-reason={effect.targetId || ""}
                      onChange={(event) =>
                        setMadnessReasons((current) => ({
                          ...current,
                          [effect.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ) : null}
                <div className={INLINE}>
                  {!executed ? (
                    <button
                      className="btn"
                      type="button"
                      data-madness-action="execute"
                      disabled={!reason.trim() || Boolean(day.execution) || day.ended}
                      onClick={() =>
                        actions.run({
                          type: "madnessPenalty",
                          payload: {
                            playerId: String(effect.targetId || ""),
                            effectId: effect.id,
                            penalty: "execute",
                            reason,
                          },
                        })
                      }
                    >
                      {t("ui.madnessExecute")}
                    </button>
                  ) : null}
                  {!executed &&
                  (effect.decidedPenalty !== "none" || effect.decidedDay !== day.number) ? (
                    <button
                      className="btn"
                      type="button"
                      data-madness-action="none"
                      disabled={!reason.trim()}
                      onClick={() =>
                        actions.run({
                          type: "madnessPenalty",
                          payload: {
                            playerId: String(effect.targetId || ""),
                            effectId: effect.id,
                            penalty: "none",
                            reason,
                          },
                        })
                      }
                    >
                      {t("ui.madnessNone")}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {manual ? (
        <div className="grid gap-1.5 rounded-sm border border-edge p-2.5">
          <span className="label">{t("manualWinner")}</span>
          <div className={INLINE}>
            <select
              className="field"
              data-winner-team
              value={drafts.winnerTeam}
              onChange={(event) =>
                drafts.setWinnerTeam(event.target.value === "evil" ? "evil" : "good")
              }
            >
              <option value="good">{t("winnerGood")}</option>
              <option value="evil">{t("winnerEvil")}</option>
            </select>
            <button
              className="btn btn--accent"
              type="button"
              data-act="declare-winner"
              onClick={() =>
                actions.run({
                  type: "setWinner",
                  payload: { team: drafts.winnerTeam, reason: "manual" },
                })
              }
            >
              {t("declareWinner")}
            </button>
          </div>
          <p className={MUTED}>{t("manualWinnerHint")}</p>
        </div>
      ) : null}
    </>
  );
}

export function SlayerPanel({ view, slayerId }: { view: TableView; slayerId: string }) {
  const { state, drafts, ports, actions } = view;
  const t = ports.strings.t;
  const selected = orderedPlayers(state).find((player) => player.id === drafts.slayerTarget);
  return (
    <div className={SECTION}>
      <span className="label">{t("slayer")}</span>
      <p className={MUTED}>{t("slayerHint")}</p>
      <div className={INLINE}>
        <select
          className="field min-w-[180px]"
          data-slayer-target
          value={drafts.slayerTarget}
          onChange={(event) => drafts.setSlayerTarget(event.target.value)}
        >
          <option value="">{t("chooseTarget")}</option>
          {orderedPlayers(state).map((player) => (
            <option key={player.id} value={player.id}>
              {displayName(player, t)}
              {player.alive ? "" : t("ui.deadSuffix")}
            </option>
          ))}
        </select>
        {selected && selected.roleId === "recluse" ? (
          <label className={CHECK}>
            <input
              type="checkbox"
              data-recluse-slayer
              checked={drafts.recluseSlayer}
              onChange={(event) => drafts.setRecluseSlayer(event.target.checked)}
            />
            <span>{t("recluseDemon")}</span>
          </label>
        ) : null}
        <button
          className="btn"
          type="button"
          data-act="slayer"
          disabled={!drafts.slayerTarget}
          onClick={() =>
            actions.run({
              type: "useSlayer",
              payload: {
                slayerId,
                targetId: drafts.slayerTarget,
                options: { recluseRegistersDemon: drafts.recluseSlayer },
              },
            })
          }
        >
          {t("useSlayer")}
        </button>
      </div>
    </div>
  );
}

function GossipPanel({ view }: { view: TableView }) {
  const { state, ports, actions } = view;
  const t = ports.strings.t;
  const gossip =
    state.script && Array.isArray(state.script.roles) && state.script.roles.includes("gossip")
      ? orderedPlayers(state).find((player) => player.roleId === "gossip" && player.alive)
      : null;
  if (!gossip || state.day.execution || state.day.ended) return null;
  if (state.gossip && state.gossip.day === state.day.number) return null;
  return (
    <div className="my-2.5 grid gap-1.5 rounded-sm border border-edge p-2.5">
      <span className="label">{t("gossipPanel")}</span>
      <p className={MUTED}>
        {displayName(gossip, t)}: {t("gossipHint")}
      </p>
      <div className={INLINE}>
        <button
          className="btn"
          type="button"
          data-act="gossip-true"
          onClick={() => actions.run({ type: "gossipStatement", payload: { truth: true } })}
        >
          {t("gossipTrue")}
        </button>
        <button
          className="btn"
          type="button"
          data-act="gossip-false"
          onClick={() => actions.run({ type: "gossipStatement", payload: { truth: false } })}
        >
          {t("gossipFalse")}
        </button>
      </div>
    </div>
  );
}

function JugglerPanel({ view }: { view: TableView }) {
  const { state, drafts, ports, actions } = view;
  const t = ports.strings.t;
  const juggler =
    state.script && Array.isArray(state.script.roles) && state.script.roles.includes("juggler")
      ? orderedPlayers(state).find((player) => player.roleId === "juggler" && player.alive)
      : null;
  const storedDay =
    state.juggler && typeof state.juggler.day === "number" ? state.juggler.day : null;
  const guessingDay = jugglerGuessingDay(
    state.day.number,
    storedDay,
    Boolean(juggler && juggler.changedFrom),
  );
  if (
    !juggler ||
    state.phase !== "day" ||
    state.day.ended ||
    state.winner ||
    juggler.used.juggler ||
    guessingDay !== state.day.number
  ) {
    return null;
  }
  const guesses = normalizeJugglerGuesses(state.juggler ? state.juggler.guesses : null);
  const count = guesses.length;
  const target = drafts.jugglerTarget;
  const full = count >= 5;
  return (
    <div className="my-2.5 grid gap-1.5 rounded-sm border border-edge p-2.5">
      <span className="label">{t("jugglerPanel")}</span>
      <p className={MUTED}>
        {displayName(juggler, t)}: {t("jugglerHint")}
      </p>
      <p className={MUTED} data-juggler-count>
        {t("jugglerCount", { count })}
      </p>
      <div className={INLINE}>
        <select
          className="field min-w-[180px]"
          data-juggler-target
          value={target}
          onChange={(event) => drafts.setJugglerTarget(event.target.value)}
        >
          <option value="">{t("chooseTarget")}</option>
          {orderedPlayers(state).map((player) => (
            <option key={player.id} value={player.id}>
              {displayName(player, t)}
              {player.alive ? "" : t("ui.deadSuffix")}
            </option>
          ))}
        </select>
        <select
          className="field min-w-[160px]"
          data-juggler-role
          value={drafts.jugglerRole}
          onChange={(event) => drafts.setJugglerRole(event.target.value)}
        >
          <option value="">{t("ui.chooseRole")}</option>
          {state.script.roles.map((id) => (
            <option key={id} value={id}>
              {roleNameOf(id, ports.roles.byId)}
            </option>
          ))}
        </select>
        <button
          className="btn"
          type="button"
          data-act="juggler-guess"
          disabled={!target || !drafts.jugglerRole || full}
          onClick={() => {
            actions.run({
              type: "jugglerGuess",
              payload: { playerId: target, roleId: drafts.jugglerRole },
            });
            drafts.setJugglerTarget("");
          }}
        >
          {t("jugglerAdd")}
        </button>
        <button
          className="btn"
          type="button"
          data-act="juggler-none"
          disabled={count > 0 || Boolean(state.juggler) || Boolean(state.winner)}
          onClick={() => actions.run({ type: "jugglerGuess", payload: { guesses: [] } })}
        >
          {t("jugglerNone")}
        </button>
      </div>
      {count ? (
        <ul className="m-0 grid gap-1 pl-4">
          {guesses.map((guess, index) => {
            const player = state.players[guess.playerId];
            return (
              <li key={guess.playerId + "-" + index} className={MUTED}>
                {player ? displayName(player, t) : guess.playerId}:{" "}
                {roleNameOf(guess.roleId, ports.roles.byId)}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function MoonchildPanel({ view }: { view: TableView }) {
  const { state, drafts, ports, actions } = view;
  const t = ports.strings.t;
  const moonchild =
    state.phase === "day"
      ? orderedPlayers(state).find(
          (player) =>
            player.roleId === "moonchild" &&
            !player.alive &&
            !(player.used && player.used.moonchildTarget),
        )
      : null;
  if (!moonchild) return null;
  return (
    <div className="my-2.5 grid gap-1.5 rounded-sm border border-edge p-2.5">
      <span className="label">{t("moonchildPanel")}</span>
      <p className={MUTED}>
        {displayName(moonchild, t)}: {t("moonchildHint")}
      </p>
      <div className={INLINE}>
        <select
          className="field"
          data-moonchild-target
          value={drafts.moonchildTarget}
          onChange={(event) => drafts.setMoonchildTarget(event.target.value)}
        >
          <option value="">{t("chooseTarget")}</option>
          {livingPlayers(state).map((player) => (
            <option key={player.id} value={player.id}>
              {player.seat} · {displayName(player, t)}
            </option>
          ))}
        </select>
        <button
          className="btn"
          type="button"
          data-act="moonchild-choice"
          onClick={() => {
            if (!drafts.moonchildTarget) return;
            actions.run({ type: "moonchildChoice", payload: { targetId: drafts.moonchildTarget } });
          }}
        >
          {t("recordChoice")}
        </button>
      </div>
    </div>
  );
}

function mastermindPanel(view: TableView) {
  const { state, ports } = view;
  if (!state.mastermind || !state.mastermind.active) return null;
  return (
    <Warn title={ports.strings.t("mastermindActive")}>
      <p>{ports.strings.t("mastermindHint")}</p>
    </Warn>
  );
}

export function SetupPrompt({ view }: { view: TableView }) {
  const { ports } = view;
  const t = ports.strings.t;
  return (
    <section className={`host-card ${CARD} ${CARD_LINE} px-[18px] py-[34px] text-center`}>
      <p className="label">{t("setup")}</p>
      <h1 className={CARD_TITLE}>{t("noRoles")}</h1>
      <p className={CARD_TEXT}>{t("setupIntro")}</p>
      <div className={INLINE}>
        <a className="btn btn--accent" href={ports.router.path("bag")}>
          {t("ui.begin")}
        </a>
        <a className="btn" href={ports.router.path("demo")}>
          {t("demo")}
        </a>
      </div>
    </section>
  );
}

export function DealCard({ view }: { view: TableView }) {
  const { state, ports, actions } = view;
  const t = ports.strings.t;
  const players = orderedPlayers(state);
  const claimed = players.filter((player) => player.claimed).length;
  const everyoneNamed = claimed === players.length;
  const seated = state.phase === "seat";
  const errors = secretsProjection(state).errors;
  const step = !everyoneNamed ? "names" : !seated ? "seats" : "secrets";
  const route = step === "names" ? "player" : step === "seats" ? "seat" : "secrets";
  const demoRoute = () => ports.router.go("demo");
  return (
    <section className={`host-card ${CARD} ${CARD_LINE}`}>
      {manualWarning(view)}
      {bmrWarning(view)}
      <p className="label">{t("playerHandoff")}</p>
      <h1 className={CARD_TITLE}>
        {!everyoneNamed ? t("ui.names") : !seated ? t("ui.arrange") : t("ui.checkSecrets")}
      </h1>
      <p className={CARD_TEXT}>{t("discussWarning")}</p>
      <div className="my-2 flex items-center gap-2.5">
        <div className="h-[7px] flex-1 overflow-hidden rounded-full border border-edge bg-crypt">
          <span
            className="block h-full bg-amber"
            style={{ width: `${players.length ? (claimed / players.length) * 100 : 0}%` }}
          />
        </div>
        <b>
          {claimed} / {players.length}
        </b>
      </div>
      <div className={INLINE}>
        <a className="btn btn--accent" href={ports.router.path(route)}>
          {step === "names" ? t("ui.handoff") : step === "seats" ? t("ui.seats") : t("ui.secrets")}
        </a>
        {(
          [
            ["player", t("ui.handoff")],
            ["seat", t("seats")],
            ["secrets", t("secrets")],
          ] as const
        )
          .filter(([target]) => target !== route)
          .map(([target, label]) => (
            <a className="btn" href={ports.router.path(target)} key={target}>
              {label}
            </a>
          ))}
        <button
          className="btn btn--quiet"
          type="button"
          data-act="demo-15"
          title={t("ui.demoHint")}
          onClick={demoRoute}
        >
          {t("demo")}
        </button>
      </div>
      {seated && errors.length ? (
        <Warn title={t("setupErrors")} bad>
          <ul className="mt-1 list-disc pl-4">
            {errors.map((error) => {
              const localized = t(error.code);
              return (
                <li key={error.code + error.message}>
                  {localized !== error.code ? localized : error.message}
                </li>
              );
            })}
          </ul>
        </Warn>
      ) : null}
      {seated ? (
        <button
          className={`btn mt-3 ${PRIMARY}`}
          type="button"
          data-act="start-night"
          disabled={!everyoneNamed || errors.length > 0}
          onClick={() => actions.run({ type: "startNight", payload: {} })}
        >
          {t("startFirstNight")}
        </button>
      ) : null}
    </section>
  );
}

export function OverCard({ view }: { view: TableView }) {
  const { state, ports, actions } = view;
  const t = ports.strings.t;
  const winner = state.winner;
  return (
    <section className={`host-card is-over ${OVER_CARD}`} data-step="over">
      <p className="label">{t("gameOver")}</p>
      <h1 className={CARD_TITLE}>
        {winner ? t(winner.team === "good" ? "winnerGood" : "winnerEvil") : t("gameOver")}
      </h1>
      <p className={CARD_TEXT} data-win-reason={winner?.reason ?? ""}>
        {winner ? t(winReasonKey(state, winner)) : ""}
      </p>
      <div className={INLINE}>
        {!state.reviewOpen ? (
          <button
            className="btn btn--accent"
            type="button"
            data-act="review"
            onClick={() => actions.run({ type: "setReviewOpen", payload: { open: true } })}
          >
            {t("review")}
          </button>
        ) : null}
        <button className="btn" type="button" data-act="new-game" onClick={actions.armNew}>
          {t("newGame")}
        </button>
        <button className="btn" type="button" data-act="export" onClick={actions.openExport}>
          {t("export")}
        </button>
      </div>
      {!state.reviewOpen ? (
        <p className={MUTED}>{t("reviewHidden")}</p>
      ) : (
        <ReviewTable view={view} />
      )}
    </section>
  );
}

function ReviewTable({ view }: { view: TableView }) {
  const { state, ports } = view;
  const t = ports.strings.t;
  return (
    <div className="host-review mt-3 overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-[11px] max-[900px]:min-w-0">
        <thead>
          <tr>
            {["#", t("player"), t("role"), t("shownRole"), t("team"), t("dead"), t("notes")].map(
              (head) => (
                <th
                  key={head}
                  className="border-b border-edge px-1.5 py-1.5 text-left text-[9.5px] font-semibold uppercase tracking-[.06em] text-muted"
                >
                  {head}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {orderedPlayers(state).map((player) => {
            const role = player.roleId ? ports.roles.byId(player.roleId) : null;
            const shown = player.shownRoleId ? ports.roles.byId(player.shownRoleId) : null;
            return (
              <tr key={player.id}>
                <td className="border-b border-edge px-1.5 py-1.5 text-left">{player.seat}</td>
                <td className="border-b border-edge px-1.5 py-1.5 text-left">
                  {displayName(player, t)}
                </td>
                <td className="border-b border-edge px-1.5 py-1.5 text-left">
                  {role ? role.name : "—"}
                </td>
                <td className="border-b border-edge px-1.5 py-1.5 text-left">
                  {shown ? shown.name : "—"}
                </td>
                <td className="border-b border-edge px-1.5 py-1.5 text-left">
                  {role ? ports.strings.teamText(role.team) : "—"}
                </td>
                <td className="border-b border-edge px-1.5 py-1.5 text-left">
                  {player.alive
                    ? "—"
                    : player.deadAt
                      ? causeText(player.deadAt.cause || "", t)
                      : "—"}
                </td>
                <td className="border-b border-edge px-1.5 py-1.5 text-left">
                  {(player.reminders || []).join(", ")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
