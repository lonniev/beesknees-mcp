/** One cell as Pixi geometry — `cellArc`'s numbers as `arc`/`lineTo` calls. */

import type { Graphics } from "pixi.js";
import type { CellArc } from "../lib/polar.ts";

export function drawCell(gfx: Graphics, arc: CellArc, inset = 0): Graphics {
  if (arc.kind === "disc") return gfx.circle(0, 0, arc.r - inset);
  if (arc.kind === "square") return gfx.rect(arc.x + inset, arc.y + inset, arc.side - 2 * inset, arc.side - 2 * inset);
  const r0 = arc.r0 + inset;
  const r1 = arc.r1 - inset;
  const da = inset / ((r0 + r1) / 2);
  const a0 = arc.a0 + da;
  const a1 = arc.a1 - da;
  gfx.moveTo(r1 * Math.cos(a0), r1 * Math.sin(a0));
  gfx.arc(0, 0, r1, a0, a1);
  gfx.lineTo(r0 * Math.cos(a1), r0 * Math.sin(a1));
  gfx.arc(0, 0, r0, a1, a0, true);
  gfx.closePath();
  return gfx;
}
