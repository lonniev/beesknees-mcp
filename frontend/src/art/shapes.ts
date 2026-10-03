/**
 * The site's marks, as shapes — one source, two renderers.
 *
 * The bee on the WebGL board, the bee drifting over the Why page, the bee in
 * the nav, the bee in a sentence on About and the bee in a thumbnail used to be
 * four things: a canvas painter, two emoji and a glyph the operating system
 * chose. `Marks.tsx` says why that matters — a picture in the instructions that
 * is merely LIKE the thing on screen is worse than no picture. So every mark is
 * described once here, as primitives, and `canvas.ts` paints them for textures
 * while `svg.tsx` emits them as `<symbol>`s for everything in the DOM.
 *
 * Everything is seen from ABOVE, laid out in a square of `box` units either
 * side of the origin. A top-down bee has no up: its heading is a rotation and
 * nothing else, which is what retired the mirror-or-rotate dance a profile
 * glyph needed. Colours are CSS strings, so `currentColor` works for the icons
 * that take the text's colour.
 *
 * Pure. Nothing here touches a document or a canvas.
 */

export type Prim =
  | { k: "ellipse"; cx: number; cy: number; rx: number; ry: number; rot?: number; fill?: string; stroke?: string; w?: number }
  | { k: "circle"; cx: number; cy: number; r: number; fill?: string; stroke?: string; w?: number }
  | { k: "rect"; x: number; y: number; w: number; h: number; fill?: string }
  | { k: "path"; d: string; fill?: string; stroke?: string; w?: number; cap?: "round" | "butt"; join?: "round" | "miter" }
  | { k: "group"; x?: number; y?: number; rot?: number; clip?: Prim; kids: Prim[] };

export interface Shape {
  /** Half-extent of the design square: coordinates run −box..box. */
  box: number;
  prims: Prim[];
}

export const BEE_PALETTE = {
  honey: "#f3b53b",
  ink: "#2a1c08",
  fur: "#6b4a1a",
  furLight: "#c99b4a",
  wing: "rgba(220,235,255,0.55)",
  wingEdge: "rgba(255,255,255,0.7)",
  wax: "#f2c14e",
  waxInk: "#92400e",
  queen: "#ff5fa2",
};

export type WingFrame = "up" | "down";

/** A bee facing east (+x). Two wing frames; alternating them at ~20 Hz is the flap. */
export function bee(wings: WingFrame): Shape {
  const P = BEE_PALETTE;
  const wing = (dir: 1 | -1): Prim => ({
    k: "group",
    x: -2,
    y: dir * 6,
    rot: dir * (wings === "up" ? -31.5 : -54.4),
    kids: [{ k: "ellipse", cx: 0, cy: 0, rx: 13, ry: 6.5, fill: P.wing, stroke: P.wingEdge, w: 1 }],
  });
  const legs: Prim[] = ([[-6, 7], [0, 8], [6, 7], [-6, -7], [0, -8], [6, -7]] as const).map(([lx, ly]) => ({
    k: "path",
    d: `M${lx * 0.4} ${ly * 0.4} L${lx} ${ly} L${lx + 3} ${ly * 1.25}`,
    stroke: P.ink,
    w: 1.6,
    cap: "round",
  }));
  const abdomen: Prim = { k: "ellipse", cx: -6, cy: 0, rx: 14, ry: 8.5 };
  return {
    box: 32,
    prims: [
      wing(-1),
      wing(1),
      ...legs,
      { ...abdomen, fill: P.honey },
      {
        k: "group",
        clip: abdomen,
        kids: [-15, -8, -1].map((sx) => ({ k: "rect", x: sx, y: -10, w: 3.6, h: 20, fill: P.ink })),
      },
      { k: "ellipse", cx: 7, cy: 0, rx: 7.5, ry: 7, fill: P.fur },
      { k: "ellipse", cx: 7, cy: -1.5, rx: 5, ry: 4, fill: P.furLight },
      { k: "circle", cx: 16, cy: 0, r: 5, fill: P.ink },
      { k: "path", d: "M18 -3 Q24 -7 25 -11 M18 3 Q24 7 25 11", stroke: P.ink, w: 1.4 },
      { k: "ellipse", cx: -8, cy: -3.5, rx: 7, ry: 2.2, rot: -6, fill: "rgba(255,255,255,0.28)" },
    ],
  };
}

/**
 * A daisy. Yellow with an orange heart while it holds pollen — the complement
 * of the violet meadow, so the one cell a forager wants is the most visible
 * thing on it. Emptied, it turns lavender, close in hue to the ground, so it
 * recedes without vanishing: still a flower, no longer a prize.
 */
export function daisy(full: boolean): Shape {
  const petal = full ? "#fff1a8" : "#b79fd6";
  const edge = full ? "#f2c14e" : "#8f78b3";
  const prims: Prim[] = [];
  for (let i = 0; i < 8; i++) {
    prims.push({ k: "group", rot: i * 45, kids: [{ k: "ellipse", cx: 15, cy: 0, rx: 11, ry: 5.5, fill: petal, stroke: edge, w: 1.2 }] });
  }
  prims.push({ k: "circle", cx: 0, cy: 0, r: 8, fill: full ? "#f59e0b" : "#6d5a8a" });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    prims.push({ k: "circle", cx: +(Math.cos(a) * 4).toFixed(2), cy: +(Math.sin(a) * 4).toFixed(2), r: 1.4, fill: full ? "#fde68a" : "#8f78b3" });
  }
  return { box: 32, prims };
}

/** The queen's crown, and the winner's. `currentColor` so the scoreboard can tint it. */
export function crown(fill = BEE_PALETTE.wax): Shape {
  return {
    box: 32,
    prims: [
      { k: "path", d: "M-20 12 L-22 -8 L-10 2 L0 -16 L10 2 L22 -8 L20 12 Z", fill, stroke: BEE_PALETTE.waxInk, w: 2, join: "round" },
      { k: "circle", cx: -12, cy: 4, r: 3, fill: BEE_PALETTE.queen },
      { k: "circle", cx: 0, cy: 0, r: 3, fill: BEE_PALETTE.queen },
      { k: "circle", cx: 12, cy: 4, r: 3, fill: BEE_PALETTE.queen },
    ],
  };
}

/** A capped cell with an egg in it — the brood. */
export function eggCell(): Shape {
  return {
    box: 16,
    prims: [
      { k: "path", d: "M-13 0 L-6.5 -11.3 L6.5 -11.3 L13 0 L6.5 11.3 L-6.5 11.3 Z", fill: "rgba(242,193,78,0.18)", stroke: BEE_PALETTE.wax, w: 1.2, join: "round" },
      { k: "ellipse", cx: 0, cy: 1, rx: 4.2, ry: 5.8, fill: "#fff7d6" },
    ],
  };
}

/**
 * The verbs, in the same hand as the bee.
 *
 * Go is a wing pair; Crawl is footprints; Fill is a wax cap set on a cell.
 * Drawn in `currentColor` so they take the button's ink — a selected tactic
 * and an idle one differ in their ground, not in their glyph.
 */
export function iconGo(): Shape {
  return {
    box: 24,
    prims: [
      { k: "ellipse", cx: -7, cy: -4, rx: 12, ry: 5.5, rot: -28, fill: "rgba(220,235,255,0.6)", stroke: "currentColor", w: 1.8 },
      { k: "ellipse", cx: 7, cy: -4, rx: 12, ry: 5.5, rot: 28, fill: "rgba(220,235,255,0.6)", stroke: "currentColor", w: 1.8 },
      { k: "ellipse", cx: 0, cy: 6, rx: 5, ry: 8, fill: "currentColor" },
    ],
  };
}

export function iconCrawl(): Shape {
  return {
    box: 24,
    prims: [
      { k: "ellipse", cx: -6, cy: -6, rx: 4, ry: 6, rot: -12, fill: "currentColor" },
      { k: "ellipse", cx: 6, cy: 4, rx: 4, ry: 6, rot: 12, fill: "currentColor" },
      { k: "circle", cx: -8, cy: -15, r: 2, fill: "currentColor" },
      { k: "circle", cx: 4, cy: -5, r: 2, fill: "currentColor" },
    ],
  };
}

export function iconFill(): Shape {
  return {
    box: 24,
    prims: [
      { k: "path", d: "M-18 14 L-14 -6 A 22 22 0 0 1 14 -6 L18 14 Z", stroke: "currentColor", w: 1.8, join: "round" },
      { k: "path", d: "M-11 6 A 12 12 0 0 1 11 6 L13 14 L-13 14 Z", fill: BEE_PALETTE.wax, stroke: BEE_PALETTE.waxInk, w: 1.6, join: "round" },
    ],
  };
}

/** Cruise: the bee silhouette with its own wake — it moves without being pressed. */
export function iconCruise(): Shape {
  return {
    box: 24,
    prims: [
      { k: "path", d: "M-20 -6 h9 M-22 0 h11 M-20 6 h9", stroke: "currentColor", w: 2, cap: "round" },
      { k: "ellipse", cx: 2, cy: 0, rx: 9, ry: 6, fill: "currentColor" },
      { k: "circle", cx: 13, cy: 0, r: 4, fill: "currentColor" },
      { k: "ellipse", cx: 0, cy: -7, rx: 6, ry: 3, rot: -20, fill: "rgba(220,235,255,0.6)", stroke: "currentColor", w: 1.4 },
    ],
  };
}

/** Every symbol the DOM can `<use>`. A closed set: a typo is a build error, not a blank. */
export const SYMBOLS = {
  bee: () => bee("up"),
  "bee-down": () => bee("down"),
  daisy: () => daisy(true),
  "daisy-empty": () => daisy(false),
  crown: () => crown("currentColor"),
  "egg-cell": () => eggCell(),
  go: () => iconGo(),
  crawl: () => iconCrawl(),
  fill: () => iconFill(),
  cruise: () => iconCruise(),
} as const;

export type SymbolId = keyof typeof SYMBOLS;
