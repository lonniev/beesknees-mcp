/**
 * The board's colours, read from the stylesheet rather than copied out of it.
 *
 * `index.css` is the one place a colour is chosen; the SVG board reads the
 * tokens with `var(--color-…)` and WebGL cannot, so they are resolved here once
 * at mount. The fallbacks are the same hex values, for a stylesheet that has
 * not arrived yet — a stage painted in the wrong violet is better than one
 * painted in black, and the real tokens take over on the next mount.
 */

const FALLBACK = {
  meadow: "#584461",
  comb: "#2f2410",
  combEdge: "#4a3819",
  tunnel: "#c9a227",
  wax: "#f2c14e",
  queen: "#ff5fa2",
  you: "#a3e635",
  hot: "#ff4d4d",
  hiveMine: "#7dd3fc",
  flower: "#d8b4fe",
};

export type Palette = { -readonly [K in keyof typeof FALLBACK]: number };

const TOKEN: Record<keyof typeof FALLBACK, string> = {
  meadow: "--color-meadow",
  comb: "--color-comb",
  combEdge: "--color-comb-edge",
  tunnel: "--color-tunnel",
  wax: "--color-wax",
  queen: "--color-queen",
  you: "--color-you",
  hot: "--color-hot",
  hiveMine: "--color-hive-mine",
  flower: "--color-flower",
};

function hex(s: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(s.trim());
  return m ? parseInt(m[1], 16) : null;
}

export function readPalette(root: Element = document.documentElement): Palette {
  const style = getComputedStyle(root);
  const out = {} as Palette;
  for (const key of Object.keys(FALLBACK) as (keyof typeof FALLBACK)[]) {
    out[key] = hex(style.getPropertyValue(TOKEN[key])) ?? hex(FALLBACK[key])!;
  }
  return out;
}
