// The player handoff: the public seat picker, the timed role card and one claim
// command. The projection carries the shown role only - no real role, reminder,
// effect, bluff or note - and the screen follows the store subscription.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { RoleCard } from "../components/arcane/role-card.tsx";
import { Dialog, DialogClose } from "../components/dialog.tsx";
import { useShellPorts } from "../ports.ts";
import { useGame } from "../store/use-game.ts";
import { projectSeats } from "./player-projection.ts";

const HIDE_SECONDS = 45;
const TICK_MS = 100;

// Preflight is on and the legacy stylesheets are gone, so every control is
// Tailwind utilities plus the shared tokens. The `.player-*` class names stay
// as inert hooks for the browser checks.
const SURFACE = "rounded-md border border-edge-2 bg-crypt-2 shadow-deep";

const SEAT =
  "player-num relative grid aspect-square min-h-11 place-items-center rounded-sm border border-edge bg-crypt-3 text-[24px] font-semibold tabular-nums text-text hover:not-disabled:border-brass hover:not-disabled:bg-crypt-2 disabled:cursor-not-allowed disabled:border-dashed disabled:border-edge disabled:bg-transparent disabled:opacity-40";

const ACTION =
  "inline-flex min-h-11 items-center justify-center rounded-sm border px-3 py-2 text-[12px]";
const ACCENT = `${ACTION} border-amber-2 bg-amber font-semibold text-ink hover:bg-amber-2`;
const NEUTRAL = `${ACTION} border-edge-2 bg-crypt-3 text-text hover:bg-crypt-2`;
const QUIET = `${ACTION} border-transparent bg-transparent text-muted hover:text-text`;

export function PlayerScreen() {
  const ports = useShellPorts();
  const snapshot = useGame(ports.game);
  const t = ports.strings.t;
  const seats = useMemo(() => projectSeats(snapshot.state), [snapshot]);

  const [seatIndex, setSeatIndex] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(HIDE_SECONDS);
  const [name, setName] = useState("");
  const [warning, setWarning] = useState(false);
  const deadline = useRef<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const hide = useCallback(() => {
    deadline.current = null;
    setSeatIndex(null);
  }, []);

  const seat = seatIndex === null ? null : (seats[seatIndex] ?? null);
  const role = seat?.shownRoleId ? ports.roles.byId(seat.shownRoleId) : null;
  const roleImage = ports.roles.image(role);
  const showing = seat !== null && role !== null;

  // The deadline is absolute: a publish re-renders the card, but it must not
  // restart the countdown.
  useEffect(() => {
    if (!showing) return;
    const end = deadline.current ?? Date.now() + HIDE_SECONDS * 1000;
    deadline.current = end;
    const tick = setInterval(() => {
      const left = Math.max(0, (end - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) hide();
    }, TICK_MS);
    return () => clearInterval(tick);
  }, [showing, hide]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (warning) {
        setWarning(false);
        return;
      }
      if (showing) hide();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [warning, showing, hide]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) hide();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", hide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", hide);
    };
  }, [hide]);

  const reveal = (index: number) => {
    const target = seats[index];
    if (!target || target.claimed || !target.shownRoleId) return;
    deadline.current = Date.now() + HIDE_SECONDS * 1000;
    setRemaining(HIDE_SECONDS);
    setName(target.name);
    setSeatIndex(index);
  };

  const claim = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!seat) {
      hide();
      return;
    }
    const typed = name.trim();
    if (!typed) {
      window.alert(t("enterName"));
      input.current?.focus();
      return;
    }
    const result = ports.commands.claimSeat(seat.id, typed);
    if (result.status === "allowed") {
      hide();
      return;
    }
    window.alert(result.reason || t("notAvailable"));
  };

  const header = (
    <>
      <header className="player-bar mx-auto flex w-[min(430px,100%)] items-center gap-2.5 px-4 pt-3 max-[560px]:flex-wrap max-[560px]:px-3.5">
        <span className="player-tag rounded-sm border border-edge bg-crypt-2 px-2.5 py-1.5 text-[9.5px] font-[650] uppercase tracking-[.18em] text-brass">
          {t("hostHandoff")}
        </span>

        <Dialog
          open={warning}
          onOpenChange={setWarning}
          trigger={
            <button
              className="player-link ml-auto inline-flex min-h-11 items-center whitespace-nowrap border-0 bg-transparent px-0.5 py-0 text-[12px] text-muted no-underline hover:text-amber hover:underline hover:underline-offset-2"
              type="button"
              data-act="back"
            >
              {t("playerBack")}
            </button>
          }
          title={t("backToTable")}
          description={t("playerWarning")}
          closeLabel={t("cancel")}
          footer={
            <>
              <button
                className={ACCENT}
                type="button"
                data-act="back-confirm"
                onClick={() => ports.router.go("/table")}
              >
                {t("backToTableConfirm")}
              </button>
              <DialogClose>
                <button className={`${NEUTRAL} ml-2`} type="button" data-act="back-cancel">
                  {t("cancel")}
                </button>
              </DialogClose>
            </>
          }
        />
      </header>
    </>
  );

  const hasRoles = seats.some((entry) => entry.shownRoleId);
  if (!hasRoles) {
    return (
      <>
        {header}
        <section className="player-view mx-auto flex min-h-[calc(100dvh-56px)] w-[min(430px,100%)] flex-col justify-center gap-4 px-4 pt-2.5 pb-[calc(28px+env(safe-area-inset-bottom))] max-[560px]:px-3.5 short:gap-3 player-view--numbers justify-start pt-4.5">
          <div className={`${SURFACE} grid gap-3 p-5`}>
            <p className="m-0 text-[9.5px] font-[650] uppercase tracking-[.18em] text-brass">
              {t("player")}
            </p>
            <h1 className="player-title m-0 font-role text-[clamp(26px,7vw,34px)] leading-[1.1] tracking-[-0.02em] text-text">
              {t("noRoles")}
            </h1>
            <p className="player-sub m-0 text-[13.5px] leading-relaxed text-muted">
              {t("setupIntro")}
            </p>
            <a
              className={`player-setup-link ${ACCENT} self-start no-underline`}
              href={ports.router.path("bag")}
            >
              {t("setup")}
            </a>
          </div>
        </section>
      </>
    );
  }

  if (seat && role) {
    return (
      <>
        {header}
        <section className="player-view mx-auto flex min-h-[calc(100dvh-56px)] w-[min(430px,100%)] flex-col justify-center gap-4 px-4.5 pt-2.5 pb-[calc(28px+env(safe-area-inset-bottom))] max-[560px]:px-3.5 short:gap-3 player-view--role">
          <div className="player-clock grid gap-1.5">
            <div
              className="player-timer h-1 overflow-hidden rounded-sm bg-crypt-3"
              aria-hidden="true"
            >
              <span
                className="block h-full w-full origin-left bg-amber"
                style={{ transform: `scaleX(${remaining / HIDE_SECONDS})` }}
              />
            </div>
            <p className="player-timer-text m-0 text-right text-[10.5px] uppercase tracking-[.12em] text-muted tabular-nums">
              {t("autoHide", { seconds: Math.ceil(remaining) })}
            </p>
          </div>
          <div className="player-card grid gap-2.5">
            <h1 className="player-role-name sr-only">{role.name}</h1>
            <p className="player-card-seat m-0 text-center text-[9.5px] font-[650] uppercase tracking-[.18em] text-brass">
              {t("seatNumber", { seat: seat.seat })}
            </p>
            <RoleCard
              className="animate-[player-reveal_.22s_ease-out_both] motion-reduce:animate-none"
              role={{
                name: role.name,
                teamLabel: ports.strings.teamText(role.team),
                ability: role.ability ?? "",
              }}
              image={roleImage}
            />
            <p className="player-note m-0 text-center text-[10.5px] text-muted">
              {t("playerWarning")}
            </p>
          </div>
          <form className="player-nameform grid gap-1.75" onSubmit={claim}>
            <label
              className="text-[9.5px] font-[650] uppercase tracking-[.18em] text-brass"
              htmlFor="player-name"
            >
              {t("playerName")}
            </label>
            <input
              ref={input}
              className="min-h-11 w-full rounded-sm border border-edge-2 bg-crypt px-3 py-2 text-[16px] text-text placeholder:text-muted"
              id="player-name"
              name="name"
              maxLength={24}
              autoComplete="off"
              placeholder={t("playerName")}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button className={`player-save ${ACCENT}`} type="submit">
              {t("playerSave")}
            </button>
            <button className={QUIET} type="button" data-act="cancel" onClick={hide}>
              {t("cancel")}
            </button>
          </form>
        </section>
      </>
    );
  }

  const open = seats.filter((entry) => !entry.claimed && entry.shownRoleId).length;
  return (
    <>
      {header}
      <section className="player-view mx-auto flex min-h-[calc(100dvh-56px)] w-[min(560px,100%)] flex-col justify-center gap-4 px-4 pt-2.5 pb-[calc(28px+env(safe-area-inset-bottom))] max-[560px]:px-3.5 short:gap-3 player-view--numbers">
        <div className="player-cover grid w-[min(520px,100%)] gap-0 rounded-[8px] border border-edge-2 bg-gradient-to-b from-crypt-2 to-crypt p-[38px_26px] text-center shadow-deep max-[560px]:p-6">
          <svg
            className="mx-auto mb-3.5 size-11 text-brass/80"
            viewBox="0 0 40 40"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            aria-hidden="true"
          >
            <circle cx="20" cy="20" r="15" />
            <path d="M20 5v30M5 20h30" />
            <circle cx="20" cy="20" r="6" />
          </svg>
          <p className="player-kicker m-0 text-[9.5px] font-[650] uppercase tracking-[.18em] text-brass">
            {t("playerHandoff")}
          </p>
          <h1 className="player-title m-0 mt-2 font-role text-[clamp(26px,3vw,30px)] leading-[1.1] tracking-[-0.02em] text-text">
            {t("playerPick")}
          </h1>
          <p className="player-sub mx-auto mt-2 max-w-[420px] text-[11.5px] leading-relaxed text-muted">
            {t("discussWarning")} {t("openCovered")}
          </p>
          <div className="player-numbers mt-5 grid grid-cols-4 gap-2">
            {seats.map((entry, index) => {
              if (entry.claimed) {
                return (
                  <button
                    key={entry.id}
                    className={SEAT}
                    type="button"
                    disabled
                    aria-label={`${t("seatNumber", { seat: entry.seat })}, ${entry.name}`}
                  >
                    {entry.seat}
                    <small className="absolute inset-x-1 bottom-1.5 truncate text-[8.5px] font-medium text-muted">
                      {entry.name}
                    </small>
                  </button>
                );
              }
              if (!entry.shownRoleId) {
                return (
                  <button
                    key={entry.id}
                    className={SEAT}
                    type="button"
                    disabled
                    aria-label={`${t("seatNumber", { seat: entry.seat })}, ${t("noRoles")}`}
                  >
                    {entry.seat}
                    <small className="absolute inset-x-1 bottom-1.5 truncate text-[8.5px] font-medium text-muted">
                      {t("noRoles")}
                    </small>
                  </button>
                );
              }
              return (
                <button
                  key={entry.id}
                  className={SEAT}
                  type="button"
                  data-seat={index}
                  aria-label={`${t("seatNumber", { seat: entry.seat })}, ${t("playerReveal")}`}
                  onClick={() => reveal(index)}
                >
                  {entry.seat}
                </button>
              );
            })}
          </div>
          <p className="player-hint m-0 text-center text-[11px] text-muted">
            {open ? t("availableNumbers", { count: open, total: seats.length }) : t("allClaimed")}
          </p>
          {open === 0 ? (
            <button
              className={ACCENT}
              type="button"
              data-act="to-seat"
              onClick={() => ports.router.go("/seat")}
            >
              {t("goSeats")}
            </button>
          ) : null}
        </div>
        <p className="player-note m-0 text-center text-[10.5px] text-muted">{t("playerWarning")}</p>
        <p className="player-note m-0 text-center text-[10.5px] text-muted">
          {t("abandonedClaim")}
        </p>
      </section>
    </>
  );
}
