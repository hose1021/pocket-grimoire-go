// Pure table geometry and seat state for `/table`. Percentages are relative to
// the table box, so the same numbers drive a phone, a tablet and a desktop
// without measuring the DOM. Nothing here reads the store or renders React.

export type LabelSide = "right" | "left" | "above" | "below";

export interface SeatGeometry {
  index: number;
  /** Seat centre as a percentage of the table box. */
  x: number;
  y: number;
  /** Which side of the medallion carries the name label. */
  side: LabelSide;
  /** Paint order: the first seat paints above every later seat. */
  z: number;
  /** Label anchor in the same percentage space, with its text alignment. */
  label: { x: number; y: number; align: "start" | "center" | "end" };
}

export interface RingOptions {
  /** Ellipse radii as percentages of the table box. */
  rx?: number;
  ry?: number;
  /** Distance from the medallion centre to the label anchor. */
  gap?: number;
}

/**
 * Places `count` seats at equal angles from the top, clockwise, on an ellipse.
 * A seat with a strong horizontal component puts the label inward beside the
 * medallion; the near-vertical seats put it above the medallion, and only the
 * middle diagonals use a below label. z decreases with the index, so a label is
 * never cut by the seat that follows it on the ring.
 */
export function seatGeometry(count: number, options: RingOptions = {}): SeatGeometry[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const rx = options.rx ?? 42;
  const ry = options.ry ?? 39;
  const gap = options.gap ?? 8;
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = Number((50 + rx * cos).toFixed(2));
    const y = Number((50 + ry * sin).toFixed(2));
    const side: LabelSide =
      cos >= 0.55 || cos <= -0.55
        ? cos > 0
          ? "right"
          : "left"
        : sin >= 0.55 || sin <= -0.55
          ? "above"
          : "below";
    const label =
      side === "right"
        ? { x: Number((x - gap).toFixed(2)), y, align: "end" as const }
        : side === "left"
          ? { x: Number((x + gap).toFixed(2)), y, align: "start" as const }
          : side === "above"
            ? { x, y: Number((y - gap).toFixed(2)), align: "center" as const }
            : { x, y: Number((y + gap).toFixed(2)), align: "center" as const };
    return { index, x, y, side, z: count - index, label };
  });
}

export type SeatBadge =
  | "acting"
  | "nominated"
  | "scheduled"
  | "dead"
  | "registered-dead"
  | "ghost-vote"
  | "no-ghost-vote"
  | "poison"
  | "drunk"
  | "protection";

export interface SeatState {
  alive: boolean;
  voteToken?: boolean;
  acting?: boolean;
  nominated?: boolean;
  impaired?: boolean;
  drunk?: boolean;
  poisoned?: boolean;
  protected?: boolean;
  scheduledDeath?: boolean;
  registeredDead?: boolean;
}

/** The locale key and the token tone of each table badge. */
export const SEAT_BADGE_KEY: Record<SeatBadge, string> = {
  acting: "ui.activeSeat",
  nominated: "ui.nominatedSeat",
  scheduled: "ui.consequence.scheduled",
  dead: "ui.dead",
  "registered-dead": "ui.registeredDead",
  "ghost-vote": "ui.ghostVote",
  "no-ghost-vote": "ui.noGhostVote",
  poison: "ui.poisoned",
  drunk: "ui.drunk",
  protection: "ui.protected",
};

export const SEAT_BADGE_TONE: Record<SeatBadge, string> = {
  acting: "border-amber/60 text-amber",
  nominated: "border-crimson text-danger",
  scheduled: "border-crimson/60 text-danger",
  dead: "border-edge-2 text-muted",
  "registered-dead": "border-brass/60 text-brass",
  "ghost-vote": "border-townsfolk/60 text-townsfolk",
  "no-ghost-vote": "border-edge-2 text-muted",
  poison: "border-outsider/60 text-outsider",
  drunk: "border-amber-2/60 text-amber-2",
  protection: "border-amber-2/60 text-amber-2",
};

/**
 * Every true state of one seat, in the order the badge row reads. Role-specific
 * host tokens never reach this list; the table carries only table states.
 */
export function seatBadges(state: SeatState): SeatBadge[] {
  const badges: SeatBadge[] = [];
  if (state.acting) badges.push("acting");
  if (state.nominated) badges.push("nominated");
  if (state.scheduledDeath) badges.push("scheduled");
  if (!state.alive) {
    badges.push("dead");
    badges.push(state.voteToken === false ? "no-ghost-vote" : "ghost-vote");
  }
  if (state.registeredDead) badges.push("registered-dead");
  if (state.drunk) badges.push("drunk");
  else if (state.poisoned || state.impaired) badges.push("poison");
  if (state.protected) badges.push("protection");
  return badges;
}

export interface DawnPlayer {
  id: string;
  name: string;
  roleName: string;
  alive: boolean;
}

export interface DawnReport {
  deaths: Array<{ playerId: string; name: string; roleName: string }>;
  survivors: number;
  total: number;
  none: boolean;
}

/** The night's deaths and the survivor count, read from the finished night. */
export function dawnReport(
  players: DawnPlayer[],
  morning: Array<{ playerId: string }>,
): DawnReport {
  const byId = new Map(players.map((player) => [player.id, player]));
  const deaths = morning.flatMap((entry) => {
    const player = byId.get(entry.playerId);
    return player ? [{ playerId: player.id, name: player.name, roleName: player.roleName }] : [];
  });
  return {
    deaths,
    survivors: players.filter((player) => player.alive).length,
    total: players.length,
    none: deaths.length === 0,
  };
}
