/**
 * The one place that converts between a cell and a wedge on screen.
 *
 * Both the renderer and the hit test go through here, because a tap that
 * lands on a different cell than the one under the finger is the single most
 * infuriating bug a board game can ship, and it happens the moment two
 * functions disagree about where a wedge starts.
 */

import type { Geometry } from "../game/rules.ts";
import { idx, ringOf } from "../game/rules.ts";

export const TAU = Math.PI * 2;
/** The viewBox is -100..100 on both axes, so the outermost ring ends at 100. */
export const VIEW = 100;

/**
 * Share of the radius given to the hive, leaving the rest to the meadow.
 *
 * Deliberately NOT the ring count's own proportion. There are 15 comb rings to
 * 4 meadow ones, which would leave the meadow a sliver — and the meadow is
 * where every bee starts, where the flowers are, and where the whole first act
 * happens. Widening it costs the comb nothing legible, because comb rings only
 * need to be big enough to tell a dug cell from a solid one.
 */
export const COMB_SHARE = 0.68;

/** Radius in view units where a ring begins. */
export function ringRadius(g: Geometry, r: number): number {
  const wallEdge = g.R + 1;
  if (r <= wallEdge) return (r / wallEdge) * COMB_SHARE * VIEW;
  const meadow = g.maxRing + 1 - wallEdge;
  return (COMB_SHARE + ((r - wallEdge) / meadow) * (1 - COMB_SHARE)) * VIEW;
}

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

/** Where to put a glyph so it sits in the middle of a cell. */
export function cellCentre(g: Geometry, cell: number): [number, number] {
  const r = ringOf(g, cell);
  if (r === 0) return [0, 0];
  const i = cell - g.offset[r];
  const mid = (ringRadius(g, r) + ringRadius(g, r + 1)) / 2;
  return xy(mid, slotAngle(g.size[r], i + 0.5));
}

/**
 * The whole comb's cell boundaries as ONE path.
 *
 * Un-dug comb was a flat brown disc, which is most of the board and reads as
 * empty background rather than as something to be cut through. Drawing the
 * lattice fixes that, but 857 cells is 857 DOM nodes per hive and there are
 * four hives — so every ring arc and every radial divider is concatenated into
 * a single `d` string instead. One node, the whole honeycomb.
 *
 * Geometry never changes during a match, so the result is cached rather than
 * rebuilt each frame.
 */
const latticeCache = new Map<string, string>();

export function combLattice(g: Geometry): string {
  const key = `${g.R}:${g.maxRing}:${g.cells}`;
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
 * Which cell a point in view coordinates falls in, or null beyond the meadow.
 *
 * Computed rather than hit-tested against the DOM: there are 857 cells in a
 * hive and four hives on screen, and drawing every one of them just so a
 * pointer event has something to land on is how a board game becomes a
 * slideshow on a phone.
 */
export function cellAt(g: Geometry, x: number, y: number): number | null {
  const frac = Math.hypot(x, y) / VIEW;
  const wallEdge = g.R + 1;
  // The inverse of ringRadius, and it MUST stay the inverse: the moment these
  // two disagree, taps land on a different cell than the finger is over.
  const r =
    frac <= COMB_SHARE
      ? Math.floor((frac / COMB_SHARE) * wallEdge)
      : wallEdge +
        Math.floor(((frac - COMB_SHARE) / (1 - COMB_SHARE)) * (g.maxRing + 1 - wallEdge));
  if (r < 0 || r > g.maxRing) return null;
  if (r === 0) return 0;
  const n = g.size[r];
  const theta = Math.atan2(y, x) + Math.PI / 2;
  const turns = ((theta % TAU) + TAU) % TAU;
  return idx(g, r, Math.floor((turns / TAU) * n));
}
