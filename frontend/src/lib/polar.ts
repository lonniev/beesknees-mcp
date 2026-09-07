/**
 * The one place that converts between a cell and a shape on screen.
 *
 * Both the renderer and the hit test go through here, because a tap that lands
 * on a different cell than the one under the finger is the single most
 * infuriating bug a board game can ship, and it happens the moment two
 * functions disagree about where a cell starts.
 *
 * There are two shapes now — a wedge in the hive, a square in the meadow — so
 * every function here begins by asking which geometry it is in. See `Geometry`
 * in `rules.ts` for why the board is built that way.
 */

import type { Geometry } from "../game/rules.ts";
import {
  HIVE_SHARE,
  cellCentre as ruleCentre,
  idx,
  isHive,
  meadowAt,
  ringOf,
  ringR,
} from "../game/rules.ts";

export const TAU = Math.PI * 2;
/** The viewBox is -100..100 on both axes, so the square field ends at 100. */
export const VIEW = 100;

/**
 * Share of the half-width given to the hive, leaving the rest to the meadow.
 *
 * Deliberately NOT the ring count's own proportion. The comb only needs cells
 * big enough to tell a dug one from a solid one and to land a finger on one in
 * particular — but that is where the whole second half of the game happens, so
 * it takes the middle four fifths and the meadow takes the frame and the
 * corners, which is exactly the shape the square lattice is good at filling.
 */
export const COMB_SHARE = HIVE_SHARE;

/** Radius in view units where a hive ring begins. Mirrors `ringR` in the rules. */
export const ringRadius = ringR;

/** Slot 0 starts at twelve o'clock, which is where a person expects it. */
export function slotAngle(n: number, i: number): number {
  return (i / n) * TAU - Math.PI / 2;
}

export function xy(radius: number, angle: number): [number, number] {
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

/**
 * The SVG path for one cell.
 *
 * Ring 0 is the queen's chamber and has a single cell, so it is a disc rather
 * than a wedge — an annular sector of a full turn degenerates into an invisible
 * zero-width sliver, which is how the queen vanishes if you forget.
 */
export function cellPath(g: Geometry, r: number, i: number): string {
  const r0 = ringRadius(g, r);
  const r1 = ringRadius(g, r + 1);
  if (r === 0) return `M ${-r1} 0 A ${r1} ${r1} 0 1 0 ${r1} 0 A ${r1} ${r1} 0 1 0 ${-r1} 0 Z`;

  const n = g.size[r];
  const a0 = slotAngle(n, i);
  const a1 = slotAngle(n, i + 1);
  const [x0o, y0o] = xy(r1, a0);
  const [x1o, y1o] = xy(r1, a1);
  const [x1i, y1i] = xy(r0, a1);
  const [x0i, y0i] = xy(r0, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return (
    `M ${x0o.toFixed(2)} ${y0o.toFixed(2)} ` +
    `A ${r1.toFixed(2)} ${r1.toFixed(2)} 0 ${large} 1 ${x1o.toFixed(2)} ${y1o.toFixed(2)} ` +
    `L ${x1i.toFixed(2)} ${y1i.toFixed(2)} ` +
    `A ${r0.toFixed(2)} ${r0.toFixed(2)} 0 ${large} 0 ${x0i.toFixed(2)} ${y0i.toFixed(2)} Z`
  );
}

/** The SVG path for any cell, wedge or square, addressed by id. */
export function cellShape(g: Geometry, cell: number): string {
  if (isHive(g, cell)) {
    const r = ringOf(g, cell);
    return cellPath(g, r, cell - g.offset[r]);
  }
  const [cx, cy] = ruleCentre(g, cell);
  const h = g.step / 2;
  const f = (n: number) => n.toFixed(2);
  return `M ${f(cx - h)} ${f(cy - h)} H ${f(cx + h)} V ${f(cy + h)} H ${f(cx - h)} Z`;
}

/** Where to put a glyph so it sits in the middle of a cell. */
export const cellCentre = ruleCentre;

/**
 * The comb's cell boundaries as ONE path.
 *
 * Un-dug comb was a flat brown disc, which is most of the hive and reads as
 * empty background rather than as something to be cut through. Drawing the
 * lattice fixes that, but 225 cells is 225 DOM nodes per hive and there are
 * five hives — so every ring arc and every radial divider is concatenated into
 * a single `d` string instead. One node, the whole honeycomb.
 *
 * Geometry never changes during a match, so the result is cached rather than
 * rebuilt each frame.
 */
const latticeCache = new Map<string, string>();

export function combLattice(g: Geometry): string {
  const key = `comb:${g.R}:${g.hiveCells}`;
  const hit = latticeCache.get(key);
  if (hit) return hit;

  const p: string[] = [];
  const f = (n: number) => n.toFixed(1);

  // Ring boundaries, as two half-arcs each (a full circle needs two, since an
  // arc of exactly 360 degrees is degenerate and draws nothing).
  for (let r = 1; r <= g.R + 1; r++) {
    const rr = ringRadius(g, r);
    p.push(`M${f(-rr)} 0A${f(rr)} ${f(rr)} 0 1 0 ${f(rr)} 0A${f(rr)} ${f(rr)} 0 1 0 ${f(-rr)} 0`);
  }

  // Radial dividers between neighbouring cells in each ring. Slot counts differ
  // per ring, so these deliberately do NOT line up across rings — that stagger
  // is the funnel made visible.
  for (let r = 1; r <= g.R; r++) {
    const r0 = ringRadius(g, r);
    const r1 = ringRadius(g, r + 1);
    const n = g.size[r];
    for (let i = 0; i < n; i++) {
      const a = slotAngle(n, i);
      const [x0, y0] = xy(r0, a);
      const [x1, y1] = xy(r1, a);
      p.push(`M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`);
    }
  }

  const d = p.join("");
  latticeCache.set(key, d);
  return d;
}

/**
 * The meadow's square boundaries as ONE path — same argument as `combLattice`.
 *
 * Only the edges between two REAL squares are drawn. Ruling the whole grid
 * would carry lines across the hive and off past the field's edge, drawing a
 * lattice where there is nothing to stand on.
 */
export function meadowLattice(g: Geometry): string {
  const key = `meadow:${g.gridN}:${g.meadowCells}`;
  const hit = latticeCache.get(key);
  if (hit) return hit;

  const p: string[] = [];
  const f = (n: number) => n.toFixed(1);
  const at = (row: number, col: number) =>
    row < 0 || row >= g.gridN || col < 0 || col >= g.gridN
      ? -1
      : g.slotCell[row * g.gridN + col];

  for (let row = 0; row < g.gridN; row++) {
    for (let col = 0; col < g.gridN; col++) {
      if (at(row, col) < 0) continue;
      const x0 = -VIEW + g.step * col;
      const y0 = -VIEW + g.step * row;
      const x1 = x0 + g.step;
      const y1 = y0 + g.step;
      // Each square draws its own top and left edge, so a shared edge is drawn
      // once rather than twice.
      if (at(row - 1, col) >= 0 || row === 0) p.push(`M${f(x0)} ${f(y0)}H${f(x1)}`);
      if (at(row, col - 1) >= 0 || col === 0) p.push(`M${f(x0)} ${f(y0)}V${f(y1)}`);
      if (row === g.gridN - 1) p.push(`M${f(x0)} ${f(y1)}H${f(x1)}`);
      if (col === g.gridN - 1) p.push(`M${f(x1)} ${f(y0)}V${f(y1)}`);
    }
  }

  const d = p.join("");
  latticeCache.set(key, d);
  return d;
}

/**
 * Which cell a point in view coordinates falls in, or null off the field.
 *
 * Computed rather than hit-tested against the DOM: there are hundreds of cells
 * in a hive and five hives on screen, and drawing every one of them just so a
 * pointer event has something to land on is how a board game becomes a
 * slideshow on a phone.
 */
export function cellAt(g: Geometry, x: number, y: number): number | null {
  if (Math.abs(x) > VIEW || Math.abs(y) > VIEW) return null;

  const rad = Math.hypot(x, y);
  const hiveR = COMB_SHARE * VIEW;
  if (rad > hiveR) {
    const m = meadowAt(g, x, y);
    if (m !== null) return m;
    // The seam: this square's middle is under the hive, so the finger is over
    // the hive even though the point is outside its radius. Fall through and
    // read it as the wall, which is what the eye sees there.
  }

  const wallEdge = g.R + 1;
  // The inverse of ringRadius, and it MUST stay the inverse: the moment these
  // two disagree, taps land on a different cell than the finger is over.
  const r = Math.min(g.R, Math.floor((rad / (COMB_SHARE * VIEW)) * wallEdge));
  if (r === 0) return 0;
  const n = g.size[r];
  const theta = Math.atan2(y, x) + Math.PI / 2;
  const turns = ((theta % TAU) + TAU) % TAU;
  return idx(g, r, Math.floor((turns / TAU) * n));
}
