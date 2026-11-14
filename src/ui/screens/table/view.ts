// The controller object the console cards receive. The screen builds it once
// per render; the cards stay presentational and take every action from here.
import type { DispatchResult } from "../../../core/commands/result.ts";
import type { GameState } from "../../../core/model/types.ts";
import type { PreviewOutcome, ShellPorts } from "../../ports.ts";
import type { Rejection } from "./helpers.ts";
import type { TableDrafts } from "./drafts.ts";

export interface TableActions {
  /** Dispatches one command and stores a rejection reason for the console. */
  run(command: Parameters<ShellPorts["commands"]["dispatch"]>[0]): DispatchResult;
  /** Previews a command on the live state without mutating or saving it. */
  preview(command: Parameters<ShellPorts["commands"]["preview"]>[0]): PreviewOutcome;
  /** The last rejection or Storyteller-choice reason, shown above the card. */
  rejection: Rejection | null;
  dismissRejection(): void;
  undo(): void;
  closeOverlay(): void;
  /** Closes the role card back to the overlay it opened from. */
  closeRole(): void;
  openRole(id: string): void;
  /** Opens the private full-screen role card of one player. */
  openPlayerCard(id: string): void;
  openInfo(key: string): void;
  /** Closes the information card and returns to the step sheet. */
  closeInfo(): void;
  openCorrection(playerId: string): void;
  /** Selects or deselects a target on the table for the current night step. */
  selectSeat(playerId: string): void;
  openGrimoire(): void;
  openExport(): void;
  openImport(): void;
  toggleGuided(open: boolean): void;
  startTimer(): void;
  stopTimer(): void;
  armNew(): void;
  startNewGame(): void;
  applyImport(): void;
  download(): void;
  copy(): void;
  /** Current clock for the day timer, refreshed once per second. */
  now: number;
}

export interface TableView {
  state: GameState;
  /** The store publication counter; invalidates memoized previews. */
  viewVersion: number;
  ports: ShellPorts;
  drafts: TableDrafts;
  actions: TableActions;
}
