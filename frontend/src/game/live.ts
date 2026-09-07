/**
 * The server's answer, turned into a board the renderer already knows how to draw.
 *
 * `HiveView` takes the same shapes the solo engine produces, and the whole point
 * of sharing the rules module is that live play should not need a second
 * renderer, a second geometry or a second idea of what a legal move is. So this
 * is the only bridge: `match_state` in, the solo engine's own structures out.
 *
 * Nothing here simulates. The server owns where every bee is and which cells are
 * open; this rebuilds the parts that are DERIVED — the obstructions, the
 * flowers, the doors — from the seed the server sent, because they are the same
 * function on both sides and shipping hundreds of integers per poll for
 * something both machines can compute would be silly.
 */

import type { LiveBee, LiveState } from "../lib/useLiveMatch.ts";
import {
  COMB,
  OPEN,
  hiveLayout,
  makeBoard,
  makeGeometry,
  type Board,
  type Geometry,
  type Phase,
} from "./rules.ts";

/** Each hive's own seed. Mirrors `board_store.hive_seed` exactly. */
export function hiveSeed(seed: number, hive: number): number {
  return (seed * 31 + hive * 7919) % 2 ** 31;
}

export interface LiveHive {
  id: number;
  board: Board;
  bees: LiveBee[];
}

/**
 * Rebuild every hive of a live match.
 *
 * Recomputed on each new board rather than patched in place: a poll can miss
 * intervening states (a tab wakes, a packet is lost) and a board mended from
 * deltas would then be quietly wrong. Rebuilding is a few hundred cells and
 * cannot drift from what the server said.
 */
export function hydrate(live: LiveState, g: Geometry = makeGeometry()): LiveHive[] {
  const hives: LiveHive[] = [];
  for (let h = 0; h < live.hives; h++) {
    const board = makeBoard(g, { mouths: 4, layout: hiveLayout(g, hiveSeed(live.seed ?? 0, h)) });

    // What the server says is open, is open. The doors are already open from the
    // layout; a dug cell is only ever known from here.
    for (const c of live.open_cells) if (c.hive === h) board.state[c.cell] = OPEN;
    // ...and a cell nobody has dug is solid, even if we thought otherwise: a
    // seal takes a tunnel back, and the client must not keep showing a way
    // through that the server has closed.
    const open = new Set(live.open_cells.filter((c) => c.hive === h).map((c) => c.cell));
    for (let c = 0; c < g.hiveCells; c++)
      if (!open.has(c) && !board.mouth[c]) board.state[c] = COMB;

    for (const p of live.taken_pollen ?? []) if (p.hive === h) board.pollen[p.cell] = 0;

    hives.push({ id: h, board, bees: live.bees.filter((b) => b.hive === h) });
  }
  return hives;
}

/** How many seats are taken across the whole match. */
export function seated(live: LiveState | null): number {
  return live?.bees.length ?? 0;
}

/** The phase a live bee is in, in the rules module's own vocabulary. */
export function phaseOf(bee: LiveBee | null | undefined): Phase {
  const p = bee?.phase;
  return p === "return" || p === "tunnel" || p === "done" ? p : "forage";
}
