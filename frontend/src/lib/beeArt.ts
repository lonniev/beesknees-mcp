/**
 * The bees, drawn — one source for every bee on the site.
 *
 * The racers on the WebGL board and the foragers drifting over the page used
 * to be the same 🐝 glyph, which is drawn by the operating system and differs
 * on every one of them: Apple's bee flies left, Google's faces the viewer,
 * Microsoft's is a different insect. These painters draw the SAME bee, and
 * the board turns the canvas into a texture while the foragers show it
 * directly — so the two cannot come to look like different species.
 *
 * Everything is seen from ABOVE. A top-down bee has no up: its heading is a
 * plain rotation, never a mirror, and it is never upside down. That retires
 * the mirror-or-rotate dance a glyph drawn in profile needed.
 *
 * Pure Canvas 2D on a context handed in, with the design laid out in a 64-unit
 * square and scaled to `size`, so a 3× phone gets a sharp bee for the price of
 * one `paint` call rather than an asset set per density. Nothing here touches
 * `document`; callers make the canvas.
 */

export const TAU = Math.PI * 2;

export interface BeePalette {
  /** Abdomen. */
  honey: string;
  /** Stripes, head, legs. */
  ink: string;
  /** Thorax. */
  fur: string;
  /** Fur highlight. */
  furLight: string;
  wing: string;
  wingEdge: string;
}

export const BEE_PALETTE: BeePalette = {
  honey: "#f3b53b",
  ink: "#2a1c08",
  fur: "#6b4a1a",
  furLight: "#c99b4a",
  wing: "rgba(220,235,255,0.55)",
  wingEdge: "rgba(255,255,255,0.7)",
};

/** The two frames of a wingbeat. Alternating them at ~20 Hz is the flap. */
export type WingFrame = "up" | "down";

/** A bee facing east (+x), centred, filling a `size`-pixel square. */
export function paintBee(ctx: CanvasRenderingContext2D, size: number, wings: WingFrame, p: BeePalette = BEE_PALETTE): void {
  const s = size / 64;
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.scale(s, s);

  const wing = (dir: 1 | -1) => {
    ctx.save();
    ctx.translate(-2, dir * 6);
    ctx.rotate(dir * (wings === "up" ? -0.55 : -0.95));
    ctx.fillStyle = p.wing;
    ctx.strokeStyle = p.wingEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 6.5, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  wing(-1);
  wing(1);

  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  for (const [lx, ly] of [[-6, 7], [0, 8], [6, 7], [-6, -7], [0, -8], [6, -7]] as const) {
    ctx.beginPath();
    ctx.moveTo(lx * 0.4, ly * 0.4);
    ctx.lineTo(lx, ly);
    ctx.lineTo(lx + 3, ly * 1.25);
    ctx.stroke();
  }

  // Abdomen, then its stripes clipped to it.
  ctx.fillStyle = p.honey;
  ctx.beginPath();
  ctx.ellipse(-6, 0, 14, 8.5, 0, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(-6, 0, 14, 8.5, 0, 0, TAU);
  ctx.clip();
  ctx.fillStyle = p.ink;
  for (const sx of [-15, -8, -1]) ctx.fillRect(sx, -10, 3.6, 20);
  ctx.restore();

  // Thorax, fuzzy.
  ctx.fillStyle = p.fur;
  ctx.beginPath();
  ctx.ellipse(7, 0, 7.5, 7, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = p.furLight;
  ctx.beginPath();
  ctx.ellipse(7, -1.5, 5, 4, 0, 0, TAU);
  ctx.fill();

  // Head and antennae.
  ctx.fillStyle = p.ink;
  ctx.beginPath();
  ctx.arc(16, 0, 5, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(18, -3);
  ctx.quadraticCurveTo(24, -7, 25, -11);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(18, 3);
  ctx.quadraticCurveTo(24, 7, 25, 11);
  ctx.stroke();

  // A sheen along the back.
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.ellipse(-8, -3.5, 7, 2.2, -0.1, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * A daisy. Yellow with an orange heart while it holds pollen — the complement
 * of the violet meadow, so the one cell a forager wants is the most visible
 * thing on it. Emptied, it turns lavender, close in hue to the ground, so it
 * recedes without vanishing: still a flower, no longer a prize.
 */
export function paintFlower(ctx: CanvasRenderingContext2D, size: number, full: boolean): void {
  const s = size / 64;
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.scale(s, s);
  const petals = 8;
  ctx.fillStyle = full ? "#fff1a8" : "#b79fd6";
  ctx.strokeStyle = full ? "#f2c14e" : "#8f78b3";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < petals; i++) {
    ctx.save();
    ctx.rotate((i / petals) * TAU);
    ctx.beginPath();
    ctx.ellipse(15, 0, 11, 5.5, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = full ? "#f59e0b" : "#6d5a8a";
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, TAU);
  ctx.fill();
  ctx.fillStyle = full ? "#fde68a" : "#8f78b3";
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 4, Math.sin(a) * 4, 1.4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** A soft dot: a pollen grain, a crumb of comb, or (large and pink) a glow. */
export function paintGrain(ctx: CanvasRenderingContext2D, size: number, color: string): void {
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.6, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}

/** The queen's crown, and the winner's. */
export function paintCrown(ctx: CanvasRenderingContext2D, size: number): void {
  const s = size / 64;
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.scale(s, s);
  ctx.fillStyle = "#f2c14e";
  ctx.strokeStyle = "#92400e";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-20, 12);
  ctx.lineTo(-22, -8);
  ctx.lineTo(-10, 2);
  ctx.lineTo(0, -16);
  ctx.lineTo(10, 2);
  ctx.lineTo(22, -8);
  ctx.lineTo(20, 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ff5fa2";
  for (const [px, py] of [[-12, 4], [0, 0], [12, 4]] as const) {
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A canvas with one of these painted on it, at device resolution.
 *
 * `size` is CSS pixels; the backing store is `size × dpr` so the drawing is
 * sharp on a 3× phone. Browser only — this is the one function here that
 * makes an element.
 */
export function paintedCanvas(
  size: number,
  dpr: number,
  paint: (ctx: CanvasRenderingContext2D, px: number) => void,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const px = Math.round(size * dpr);
  c.width = px;
  c.height = px;
  c.style.width = `${size}px`;
  c.style.height = `${size}px`;
  const ctx = c.getContext("2d");
  if (ctx) paint(ctx, px);
  return c;
}
