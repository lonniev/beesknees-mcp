/**
 * The shapes, painted on a 2D canvas — for the WebGL board's textures and the
 * foragers drifting over the page.
 *
 * `size` is the canvas edge in pixels; the shape's `box` is scaled to fill it.
 * `currentColor` has no meaning on a canvas, so a caller that paints an icon
 * passes the colour it would have had.
 */

import type { Prim, Shape } from "./shapes.ts";

export interface PaintOpts {
  /** What `currentColor` paints as. */
  current?: string;
}

function trace(ctx: CanvasRenderingContext2D, p: Prim): void {
  switch (p.k) {
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(p.cx, p.cy, p.rx, p.ry, ((p.rot ?? 0) * Math.PI) / 180, 0, Math.PI * 2);
      break;
    case "circle":
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
      break;
    case "rect":
      ctx.beginPath();
      ctx.rect(p.x, p.y, p.w, p.h);
      break;
    default:
      break;
  }
}

export function paintPrims(ctx: CanvasRenderingContext2D, prims: Prim[], o: PaintOpts = {}): void {
  const colour = (c: string | undefined) => (c === "currentColor" ? (o.current ?? "#000") : c);
  for (const p of prims) {
    if (p.k === "group") {
      ctx.save();
      ctx.translate(p.x ?? 0, p.y ?? 0);
      if (p.rot) ctx.rotate((p.rot * Math.PI) / 180);
      if (p.clip) {
        if (p.clip.k === "path") ctx.clip(new Path2D(p.clip.d));
        else {
          trace(ctx, p.clip);
          ctx.clip();
        }
      }
      paintPrims(ctx, p.kids, o);
      ctx.restore();
      continue;
    }
    const path = p.k === "path" ? new Path2D(p.d) : null;
    if (!path) trace(ctx, p);
    if (p.fill) {
      ctx.fillStyle = colour(p.fill)!;
      if (path) ctx.fill(path);
      else ctx.fill();
    }
    if (p.k !== "rect" && p.stroke) {
      ctx.strokeStyle = colour(p.stroke)!;
      ctx.lineWidth = p.w ?? 1;
      ctx.lineCap = p.k === "path" && p.cap ? p.cap : "butt";
      ctx.lineJoin = p.k === "path" && p.join ? p.join : "miter";
      if (path) ctx.stroke(path);
      else ctx.stroke();
    }
  }
}

/** Paint a shape centred in a `size`-pixel square, clearing it first. */
export function paintShape(ctx: CanvasRenderingContext2D, size: number, shape: Shape, o: PaintOpts = {}): void {
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.scale(size / (2 * shape.box), size / (2 * shape.box));
  paintPrims(ctx, shape.prims, o);
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

/**
 * A canvas with something painted on it, at device resolution.
 *
 * `size` is CSS pixels; the backing store is `size × dpr` so the drawing is
 * sharp on a 3× phone. Browser only — the one function here that makes an
 * element.
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
