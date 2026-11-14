// Seat order: a local draft that the host commits with one command. A publish
// refreshes names and roles, but it never replaces an order being edited.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { GameSnapshot } from "../../application/store/create-game-store.ts";
import { SetupShell } from "../components/setup-shell.tsx";
import { useShellPorts } from "../ports.ts";
import { useGame } from "../store/use-game.ts";
import { publicSeats } from "./seat-projection.ts";
import { commandRejectionText } from "./setup-messages.ts";

const EMPTY_NOTE = "Нажмите место, затем другое, чтобы поменять.";

function orderOf(state: GameSnapshot["state"]): string[] {
  return state.order.filter((id) => state.players[id]);
}

interface Drag {
  pointerId: number;
  index: number;
  startX: number;
  startY: number;
  active: boolean;
  width: number;
}

export function SeatScreen() {
  const ports = useShellPorts();
  const snapshot = useGame(ports.game);
  const state = snapshot.state;
  const t = ports.strings.t;

  const [draft, setDraft] = useState<string[]>(() => orderOf(state));
  const [history, setHistory] = useState<string[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const selectedRef = useRef<number | null>(null);
  const pick = (value: number | null) => {
    selectedRef.current = value;
    setSelected(value);
  };
  const [status, setStatus] = useState(EMPTY_NOTE);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; width: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  // The drop target is read on pointerup, which runs from the closure that
  // existed at pointerdown. State would be stale there; a ref is not.
  const dragTargetRef = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const listeners = useRef<AbortController | null>(null);

  // A publish never replaces a draft, but it fills an empty one: another tab can
  // deal the bag while this screen still shows the empty state.
  useEffect(() => {
    if (draft.length) return;
    const published = orderOf(snapshot.state);
    if (published.length) setDraft(published);
  }, [snapshot, draft.length]);

  useEffect(() => {
    return () => listeners.current?.abort();
  }, []);

  // The route is readable by anyone at the table, so it renders names and seat
  // numbers only (`SPEC.md` `/seat` "names only"). Roles never enter this view.
  const seats = publicSeats(draft, state.players);
  const nameOf = (id: string) => seats.find((seat) => seat.id === id)?.name ?? "";

  const announce = (text: string) => setStatus(text);

  const swap = (from: number, to: number) => {
    if (from === to) {
      pick(null);
      announce("Selection cancelled.");
      return;
    }
    const held = draft[from];
    const other = draft[to];
    if (held === undefined || other === undefined) return;
    const next = draft.slice();
    setHistory((past) => [...past, draft.slice()]);
    next[from] = other;
    next[to] = held;
    pick(null);
    setDraft(next);
    const arriving = publicSeats(next, state.players)[to]?.name;
    announce(`${arriving || "Игрок " + (to + 1)} now sits at seat ${to + 1}.`);
  };

  const activate = (index: number) => {
    const current = selectedRef.current;
    if (current === null) {
      pick(index);
      announce(`Seat ${index + 1} picked. Activate another seat to swap.`);
      return;
    }
    if (current === index) {
      pick(null);
      announce("Selection cancelled.");
      return;
    }
    swap(current, index);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((past) => past.slice(0, -1));
    setDraft(last);
    pick(null);
    announce("Undone.");
  };

  const shuffleSeats = () => {
    const next = draft.slice();
    setHistory((past) => [...past, draft.slice()]);
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const held = next[i];
      const other = next[j];
      if (held === undefined || other === undefined) continue;
      next[i] = other;
      next[j] = held;
    }
    setDraft(next);
    pick(null);
    announce("Seats shuffled.");
  };

  const useOrder = () => {
    const result = ports.commands.setOrder(draft.slice());
    if (result.status !== "allowed") {
      window.alert(commandRejectionText(result) || "Не удалось изменить порядок мест.");
      return;
    }
    const dealt = draft.some((id) => state.players[id]?.roleId);
    const needsSecrets = state.phase === "seat";
    ports.router.go(dealt && needsSecrets ? "/secrets" : "/table");
  };

  const seatIndexAt = (clientX: number, clientY: number): number | null => {
    const under = document.elementFromPoint(clientX, clientY);
    const item = under instanceof Element ? under.closest("[data-index]") : null;
    if (!(item instanceof HTMLElement)) return null;
    return Number(item.dataset.index);
  };

  const finishDrag = () => {
    listeners.current?.abort();
    listeners.current = new AbortController();
    drag.current = null;
    dragTargetRef.current = null;
    setGhost(null);
    setDragIndex(null);
    setDragTarget(null);
  };

  const onPointerMove = (event: PointerEvent) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (!current.active) {
      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return;
      current.active = true;
      setDragIndex(current.index);
      setGhost({ x: event.clientX, y: event.clientY, width: current.width });
    }
    event.preventDefault();
    setGhost((previous) => ({
      x: event.clientX,
      y: event.clientY,
      width: previous?.width ?? 0,
    }));
    const next = seatIndexAt(event.clientX, event.clientY);
    dragTargetRef.current = next;
    setDragTarget(next);
  };

  const onPointerUp = (event: PointerEvent) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const target = dragTargetRef.current;
    const wasActive = current.active;
    const from = current.index;
    finishDrag();
    if (!wasActive) return;
    suppressClick.current = true;
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    if (target !== null && target !== from) swap(from, target);
    else {
      pick(null);
      setStatus("Selection cancelled.");
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!(event.target instanceof Element)) return;
    const item = event.target.closest("[data-index]");
    if (!(item instanceof HTMLElement)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    drag.current = {
      pointerId: event.pointerId,
      index: Number(item.dataset.index),
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      width: item.getBoundingClientRect().width,
    };
    const controller = listeners.current ?? new AbortController();
    listeners.current = controller;
    window.addEventListener("pointermove", onPointerMove, {
      passive: false,
      signal: controller.signal,
    });
    window.addEventListener("pointerup", onPointerUp, { signal: controller.signal });
    window.addEventListener(
      "pointercancel",
      () => {
        finishDrag();
        pick(null);
        setStatus("Selection cancelled.");
      },
      { signal: controller.signal },
    );
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || selected === null) return;
      pick(null);
      announce("Selection cancelled.");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected]);

  if (!draft.length) {
    return (
      <div className="seat-empty mx-auto grid max-w-[460px] place-items-center gap-2 px-5 py-24 text-center">
        <p className="m-0 text-[9px] font-semibold uppercase tracking-[0.18em] text-brass">
          {ports.strings.text("Seat order")}
        </p>
        <h1 className="m-0 font-role text-[26px] leading-tight text-parchment">
          {ports.strings.text("No one is seated yet.")}
        </h1>
        <p className="m-0 text-[13px] text-muted">
          {ports.strings.text("Build the bag first, then deal it to seats.")}
        </p>
        <a className="btn btn--accent mt-2" href={ports.router.path("bag")}>
          {ports.strings.text("Build the bag")}
        </a>
      </div>
    );
  }

  const dense = draft.length > 10;
  const deadCount = draft.filter((id) => state.players[id]?.alive === false).length;
  const radius = dense ? 42 : 40;
  const ghostPlayer = dragIndex === null ? null : draft[dragIndex];
  const ringClass = [
    "seat-ring relative mx-auto aspect-square w-[min(650px,66vh)] max-w-full max-sm:w-[min(92vw,340px)]",
    dense
      ? "max-sm:grid max-sm:w-full max-sm:max-w-none max-sm:aspect-auto max-sm:grid-cols-3 max-sm:gap-1.5 max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:before:hidden"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const itemClass = [
    "seat-item absolute flex w-[104px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 border-0 bg-transparent p-0 text-text select-none [touch-action:none] [-webkit-tap-highlight-color:transparent] max-sm:w-[92px]",
    dense
      ? "max-sm:static max-sm:w-full max-sm:[translate:none] max-sm:flex-row max-sm:items-center max-sm:gap-2 max-sm:rounded-md max-sm:border max-sm:border-edge max-sm:bg-crypt-3 max-sm:p-1.5 max-sm:text-left"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <SetupShell step="seat">
        <div className="mx-auto grid w-full max-w-[1680px] grid-cols-[290px_minmax(0,1fr)_330px] items-stretch border-t border-edge max-[1240px]:grid-cols-[290px_minmax(0,1fr)] max-[900px]:grid-cols-1">
          <aside className="grid min-w-0 content-start gap-2.5 border-r border-edge bg-gradient-to-b from-crypt-2 to-crypt p-3.5 max-[1240px]:border-r-0 max-[900px]:border-b">
            <div className="seat-title rounded-md border border-edge bg-crypt-2 p-3">
              <span className="chip inline-flex items-center gap-1 rounded-[4px] border border-amber-dim px-1.5 py-0.5 text-[8.5px] uppercase tracking-[.13em] text-amber">
                {ports.strings.text("Seat order")}
              </span>
              <b className="m-0 mt-1.5 block font-role text-[24px] leading-none font-normal text-parchment">
                {ports.strings.text("Circle")}
              </b>
              <p className="mt-1 text-[11px] text-muted">
                <span id="seat-total">{draft.length}</span> {ports.strings.text("players")} ·{" "}
                {state.script ? state.script.name : ""}
              </p>
            </div>
            <section className="rounded-md border border-edge bg-crypt-2 p-3">
              <h2 className="m-0 text-[9px] uppercase tracking-[.18em] text-muted">
                {ports.strings.text("Seat order")}
              </h2>
              <ol className="mt-2 grid list-none gap-1 p-0">
                {draft.map((id, index) => (
                  <li
                    key={id}
                    className="flex items-center gap-2 border-b border-edge/60 pb-1 text-[10.5px] last:border-0"
                  >
                    <b className="w-5 text-muted tabular-nums">{index + 1}</b>
                    <span className="min-w-0 flex-1 truncate">{nameOf(id)}</span>
                  </li>
                ))}
              </ol>
            </section>
          </aside>

          <main className="flex min-w-0 flex-col overflow-hidden max-[1200px]:col-span-2 max-[900px]:w-full">
            <div className="flex flex-wrap items-center gap-3 border-b border-edge px-4 py-2.5">
              <div className="grid">
                <b className="font-role text-[14px] font-normal leading-[1.2] tracking-[.05em] text-text">
                  {ports.strings.text("Seat order")}
                </b>
                <small className="mt-0.5 text-[9px] uppercase tracking-[.13em] text-muted">
                  {draft.length} {ports.strings.text("players")} · {deadCount}{" "}
                  {ports.strings.text("Dead")}
                </small>
              </div>
              <div className="ml-auto flex gap-1">
                <span className="flex items-center gap-1.5 rounded-[4px] border border-amber-dim bg-amber-dim/20 px-2 py-[5px] text-[8px] uppercase tracking-[.1em] text-amber">
                  <i className="size-1 rounded-full bg-current" aria-hidden="true" />
                  {ports.strings.text("Circle")}
                </span>
                <span className="flex items-center gap-1.5 rounded-[4px] border border-edge px-2 py-[5px] text-[8px] uppercase tracking-[.1em] text-muted/70">
                  <i className="size-1 rounded-full bg-current" aria-hidden="true" />
                  {t("secrets")}
                </span>
                <span className="flex items-center gap-1.5 rounded-[4px] border border-edge px-2 py-[5px] text-[8px] uppercase tracking-[.1em] text-muted/70">
                  <i className="size-1 rounded-full bg-current" aria-hidden="true" />
                  {t("night")}
                </span>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 place-items-center p-3">
              <div
                className={ringClass}
                id="seat-ring"
                onPointerDown={onPointerDown}
                onDragStart={(event) => event.preventDefault()}
                onClick={(event) => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  if (!(event.target instanceof Element)) return;
                  const item = event.target.closest("[data-index]");
                  if (item instanceof HTMLElement) activate(Number(item.dataset.index));
                }}
              >
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full text-edge"
                  viewBox="0 0 660 660"
                  aria-hidden="true"
                >
                  <circle
                    cx="330"
                    cy="330"
                    r="298"
                    fill="none"
                    stroke="currentColor"
                    strokeDasharray="2 8"
                  />
                  <circle
                    cx="330"
                    cy="330"
                    r="238"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                    opacity=".5"
                  />
                  <path
                    d="M330 4v14M330 640v14M4 330h14M640 330h14"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
                {draft.map((id, index) => {
                  const name = nameOf(id);
                  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / draft.length;
                  const style = {
                    left: (50 + radius * Math.cos(angle)).toFixed(2) + "%",
                    top: (50 + radius * Math.sin(angle)).toFixed(2) + "%",
                  } as CSSProperties;
                  const isSelected = selected === index;
                  const isTarget = dragTarget === index;
                  return (
                    <button
                      key={id + ":" + index}
                      type="button"
                      className={[
                        itemClass,
                        isSelected ? "is-selected" : "",
                        index === 0 ? "is-start" : "",
                        isTarget ? "is-target" : "",
                        dragIndex === index ? "is-dragging opacity-35" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-index={index}
                      style={style}
                      aria-label={`Seat ${index + 1}, ${name}. Activate, then activate another seat to swap.`}
                      aria-pressed={isSelected}
                    >
                      <span
                        className={[
                          "relative mx-auto block size-16 max-sm:size-10",
                          isSelected || isTarget ? "shadow-glow" : "",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "seat-disc absolute inset-0 [clip-path:polygon(50%_0,100%_25%,100%_75%,50%_100%,0_75%,0_25%)]",
                            isSelected || isTarget ? "bg-amber" : "bg-edge-2",
                          ].join(" ")}
                          aria-hidden="true"
                        />
                        <span
                          className={[
                            "absolute inset-[1.5px] [clip-path:polygon(50%_0,100%_25%,100%_75%,50%_100%,0_75%,0_25%)]",
                            isSelected || isTarget ? "bg-amber-dim" : "bg-crypt-3",
                          ].join(" ")}
                          aria-hidden="true"
                        />
                        <span className="seat-mono absolute inset-0 z-10 grid place-items-center font-role text-[20px] text-parchment max-sm:text-[14px]">
                          {name.charAt(0).toUpperCase() || "?"}
                        </span>
                        <span
                          className={[
                            "seat-num absolute bottom-[1px] left-1/2 z-20 -translate-x-1/2 rounded-[3px] border bg-crypt px-1 text-[8px] tabular-nums",
                            index === 0
                              ? "border-amber-dim text-amber"
                              : "border-edge-2 text-muted",
                          ].join(" ")}
                        >
                          {index + 1}
                        </span>
                      </span>
                      <span className="seat-name mt-1 block w-full truncate text-center text-[10.5px] font-semibold leading-tight text-text max-sm:text-left max-sm:text-[11px]">
                        {name}
                      </span>
                      {index === 0 ? (
                        <span className="rounded-[2px] border border-amber-dim px-1 py-px text-[7px] uppercase tracking-[.1em] text-amber">
                          {ports.strings.text("Start")}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                <div
                  className={`seat-hub pointer-events-none absolute left-1/2 top-1/2 w-[190px] -translate-x-1/2 -translate-y-1/2 text-center ${
                    dense ? "max-sm:hidden" : ""
                  }`}
                >
                  <b
                    className="seat-hub-count block font-role text-[42px] leading-none tracking-[-0.02em] tabular-nums text-parchment"
                    id="seat-count"
                  >
                    {draft.length}
                  </b>
                  <span className="seat-hub-total mt-1 block text-[9px] font-semibold uppercase tracking-[0.16em] text-brass">
                    {ports.strings.text("players")}
                  </span>
                  <em className="seat-hub-note mt-2 block text-[9px] uppercase not-italic tracking-[.16em] text-muted">
                    {deadCount} {ports.strings.text("Dead")}
                  </em>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-edge bg-gradient-to-b from-crypt-2 to-crypt px-3.5 py-2.5">
              <span
                className="seat-status flex items-center gap-2 text-[9px] uppercase tracking-[.11em] text-muted"
                role="status"
              >
                <i className="size-1.5 rounded-full bg-amber shadow-glow" aria-hidden="true" />
                {ports.strings.text(status)}
              </span>
              <div
                className="seat-actions ml-auto flex flex-wrap justify-end gap-1.5 max-[900px]:ml-0 max-[900px]:w-full max-[900px]:justify-start"
                role="group"
                aria-label={ports.strings.text("Actions")}
              >
                <a className="btn" href={ports.router.path("player")}>
                  {t("player")}
                </a>
                <button
                  className="btn"
                  type="button"
                  data-act="undo"
                  disabled={!history.length}
                  onClick={undo}
                >
                  {ports.strings.text("Undo")}
                </button>
                <button className="btn" type="button" data-act="shuffle" onClick={shuffleSeats}>
                  {ports.strings.text("Shuffle")}
                </button>
                <button className="btn btn--accent" type="button" data-act="use" onClick={useOrder}>
                  {ports.strings.text("Use this order")}
                </button>
              </div>
            </div>
          </main>

          <aside className="grid min-w-0 content-start gap-2.5 border-l border-edge bg-gradient-to-b from-crypt-2 to-crypt p-3.5 max-[1240px]:col-span-2 max-[1240px]:border-l-0 max-[1240px]:border-t max-[900px]:col-span-1">
            <h2 className="m-0 text-[9px] uppercase tracking-[.2em] text-brass">Подсказки</h2>
            <p className="m-0 text-[9.5px] leading-relaxed text-muted">
              {ports.strings.text("Seat 1 is the start.")}{" "}
              {ports.strings.text("Numbers run clockwise.")}
            </p>
            <section className="rounded-md border border-edge bg-crypt-2 p-3">
              <h2 className="m-0 text-[9px] uppercase tracking-[.18em] text-muted">Соседи</h2>
              <p className="mt-2 text-[10px] leading-relaxed text-muted">
                Соседи — игроки слева и справа от места. Способности, которые читают соседей,
                учитывают только живых.
              </p>
            </section>
            <section className="rounded-md border border-edge bg-crypt-2 p-3">
              <h2 className="m-0 text-[9px] uppercase tracking-[.18em] text-muted">Мёртвые</h2>
              <p className="mt-2 text-[10px] leading-relaxed text-muted">
                Мёртвый игрок сохраняет один голос до конца игры.
              </p>
            </section>
          </aside>
        </div>
      </SetupShell>
      {ghost && ghostPlayer ? (
        <div
          className="seat-ghost pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 scale-105 rounded-md opacity-95 shadow-deep"
          aria-hidden="true"
          style={{
            left: ghost.x + "px",
            top: ghost.y + "px",
            width: ghost.width ? ghost.width + "px" : undefined,
          }}
        >
          <span className="seat-disc relative grid size-16 place-items-center rounded-full border border-amber bg-crypt-3">
            <span className="seat-num absolute -left-0.5 -top-0.5 grid size-5 place-items-center rounded-sm border border-edge-2 bg-crypt text-[9.5px] tabular-nums text-muted">
              {(dragIndex ?? 0) + 1}
            </span>
            <span className="seat-mono font-role text-[23px] text-parchment">
              {(nameOf(ghostPlayer) || "?").charAt(0).toUpperCase()}
            </span>
          </span>
          <span className="seat-name block w-full truncate text-center text-[11.5px] text-text">
            {state.players[ghostPlayer]?.name ?? ""}
          </span>
        </div>
      ) : null}
    </>
  );
}
