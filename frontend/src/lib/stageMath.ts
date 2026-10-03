/**
 * What changed between two looks at a hive — the arithmetic under the stage.
 *
 * Neither engine emits events. Solo mutates its board and bees in place and
 * bumps a frame counter; live hands over a freshly built board on every poll,
 * and a poll can skip several moves. So the renderer cannot be told that a bee
 * dug: it has to notice. This module does the noticing, on copies, with no
 * Pixi in it, so the cases that matter — a dig that is also a move, a rival
 * flying into a hole somebody else cut, a flower that came back because a thin
 * reply forgot it — are things a test can hold still.
 */

import type { Board, Geometry } from "../game/rules.ts";
import { OPEN, neighbors } from "../game/rules.ts";
import { VIEW } from "./polar.ts";

/** The least the stage needs to know about a bee. Counters are optional
 * because `HiveView`'s thumbnails never carry them. */
export interface StageBee {
  id: number;
  cell: number;
  phase: string;
  digs?: number;
  seals?: number;
}

export interface BeeSeen {
  cell: number;
  phase: string;
  digs: number;
  seals: number;
}

/** A hive as it was at one frame — copies, never the engine's own arrays. */
export interface Snapshot {
  bees: Map<number, BeeSeen>;
  state: Uint8Array;
  pollen: Uint8Array;
}

export function snapshot(board: Board, bees: StageBee[]): Snapshot {
  const seen = new Map<number, BeeSeen>();
  for (const b of bees) seen.set(b.id, { cell: b.cell, phase: b.phase, digs: b.digs ?? 0, seals: b.seals ?? 0 });
  return { bees: seen, state: Uint8Array.from(board.state), pollen: Uint8Array.from(board.pollen) };
}

export interface Move {
  id: number;
  from: number;
  to: number;
  /** The cells to pass through, ending at `to`. One entry for an ordinary step. */
  path: number[];
  /** This move cut the cell it ends in. */
  dug: boolean;
}

export interface FrameDiff {
  moved: Move[];
  /** Bees not in the previous frame — a fresh round, or the first look. */
  arrived: number[];
  /** Bees that were there and are not now. */
  left: number[];
  opened: number[];
  sealed: number[];
  /** Flowers whose pollen was taken. A flower coming BACK is not reported:
   * live's `taken_pollen ?? []` can forget on a thin reply, and a refill the
   * game has no rule for must not throw a party. */
  emptied: number[];
  phased: { id: number; from: string; to: string }[];
}

export function diffFrame(g: Geometry, prev: Snapshot | null, next: Snapshot): FrameDiff {
  const opened: number[] = [];
  const sealed: number[] = [];
  const emptied: number[] = [];
  if (prev) {
    for (let c = 0; c < g.cells; c++) {
      if (prev.state[c] !== next.state[c]) (next.state[c] === OPEN ? opened : sealed).push(c);
      if (prev.pollen[c] && !next.pollen[c]) emptied.push(c);
    }
  }
  const openedSet = new Set(opened);

  const moved: Move[] = [];
  const arrived: number[] = [];
  const left: number[] = [];
  const phased: FrameDiff["phased"] = [];
  for (const [id, b] of next.bees) {
    const was = prev?.bees.get(id);
    if (!was) {
      arrived.push(id);
      continue;
    }
    if (was.cell !== b.cell) {
      // A dig is a counter going up AND the hole being new. Either alone lies:
      // across a live gap one bee can cut a cell, move on, and another fly into
      // it; and a bee that dug two polls ago still has a higher counter.
      const dug = b.digs > was.digs && openedSet.has(b.cell);
      moved.push({ id, from: was.cell, to: b.cell, path: openPath(g, next.state, was.cell, b.cell), dug });
    }
    if (was.phase !== b.phase) phased.push({ id, from: was.phase, to: b.phase });
  }
  if (prev) for (const id of prev.bees.keys()) if (!next.bees.has(id)) left.push(id);

  return { moved, arrived, left, opened, sealed, emptied, phased };
}

/**
 * The cells a bee passed through to get from one place to another.
 *
 * An adjacent step is itself. Anything further — a live poll that skipped
 * moves, a solo loop catching up after a tab slept — is walked over the cells
 * that are OPEN now, breadth first, so the drawn bee goes through the shaft it
 * actually used rather than straight through solid comb. Capped: past `cap`
 * steps the search gives up and the bee simply crosses, because a tween that
 * long would be a slideshow anyway.
 */
export function openPath(g: Geometry, state: Uint8Array, from: number, to: number, cap = 8): number[] {
  if (from === to) return [];
  if (neighbors(g, from).includes(to)) return [to];
  const back = new Map<number, number>([[from, -1]]);
  let frontier = [from];
  for (let depth = 0; depth < cap && frontier.length; depth++) {
    const nextFrontier: number[] = [];
    for (const c of frontier) {
      for (const n of neighbors(g, c)) {
        if (back.has(n)) continue;
        // The destination counts even if it is comb — that is what a dig is.
        if (n !== to && state[n] !== OPEN) continue;
        back.set(n, c);
        if (n === to) {
          const path: number[] = [];
          for (let at = to; at !== from; at = back.get(at)!) path.push(at);
          return path.reverse();
        }
        nextFrontier.push(n);
      }
    }
    frontier = nextFrontier;
  }
  return [to];
}

/**
 * A pointer position as a point in view units.
 *
 * The square stage is letterboxed in a box that is usually wider than it is
 * tall, so view units come off the SHORTER side and the origin is the box's
 * centre. Lifted from the SVG board, where getting this wrong once put every
 * tap one cell to the left.
 */
export function viewFromPointer(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): [number, number] {
  const size = Math.min(rect.width, rect.height);
  return [
    ((clientX - rect.left - rect.width / 2) / size) * 2 * VIEW,
    ((clientY - rect.top - rect.height / 2) / size) * 2 * VIEW,
  ];
}

export function easeOut(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return 1 - (1 - k) * (1 - k);
}

/**
 * How long a step should take to draw.
 *
 * A fraction of the gap between frames, so the bee is at rest before its next
 * move arrives and never visibly lags the game — but never so quick that it
 * teleports, which is the thing this renderer exists to stop. Reduced motion
 * snaps: the setting asks for less movement, and a bee that glides is movement.
 */
export function tweenMs(gapMs: number, reduced: boolean): number {
  if (reduced) return 0;
  return Math.min(900, Math.max(250, gapMs * 0.7));
}
