/**
 * When an aim stops being a goal, and when the bee may take its next step
 * without being asked.
 *
 * Both boards used to decide these for themselves and decided differently:
 * solo dropped the aim on a phase change and live did not, so after landing on
 * a flower the live hint still said "Flower chosen — press to fly" over a
 * button that could do nothing. One rule now, pure, held still by a test.
 */

import type { Board } from "./rules.ts";

/** A bee as both boards see it — the engine's `Bee` and live's hydrated one. */
export interface AimBee {
  cell: number;
  phase: string;
}

/**
 * The two ways an aim ends WITHOUT a phase change.
 *
 * `arrived`: the bee is standing on the cell it was aiming at. Nothing can get
 * it closer, so "Held up — nothing gets you closer yet" was true and useless;
 * the aim is simply over and the next thing to do is choose again.
 *
 * `spent`: the aim was a flower and a rival emptied it first. Aiming reserves
 * nothing — pollen is taken by arriving — so the flower you set off for can be
 * gone before you land.
 */
export function aimOver(board: Board, bee: AimBee, target: number | null): "arrived" | "spent" | null {
  if (target === null) return null;
  if (bee.cell === target) return "arrived";
  if (bee.phase === "forage" && board.flower[target] && !board.pollen[target]) return "spent";
  return null;
}

export interface CruiseGuards {
  /** The switch. Off is the default on every mount: a default that spends is not a default. */
  on: boolean;
  /** Cruise is for the comb. The meadow and the door are a few presses and tactical. */
  inHive: boolean;
  ready: boolean;
  /** A move is in flight. */
  busy: boolean;
  /** There is a legal step toward the aim. A `why` beside it ("fly up beside it") is fine. */
  hasStep: boolean;
  running: boolean;
  /**
   * The board has been read again since the last move was sent.
   *
   * On the live board `ready` is true again the instant the call returns,
   * before the next poll — the rest on screen is the OLD one — and the step was
   * computed from the old cell. Acting then pays for a duplicate move that is
   * refused or loses a race. Solo passes `true`: its state is the engine's own.
   */
  seqAdvanced: boolean;
}

/** Press the button for me, whenever pressing it would do something. */
export function shouldCruise(g: CruiseGuards): boolean {
  return g.on && g.inHive && g.ready && !g.busy && g.hasStep && g.running && g.seqAdvanced;
}

/** A beat between the board changing and the next step being paid for, so the drawn bee lands first. */
export const CRUISE_BEAT_MS = 180;
