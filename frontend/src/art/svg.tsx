/**
 * The shapes, as SVG — for everything in the DOM.
 *
 * `ArtSymbols` is mounted once, in the app shell, and emits every mark as a
 * `<symbol>`. `Art` then puts one anywhere with a `<use>`: in a sentence, in
 * the nav, in a thumbnail's `<svg>`. The id set is closed in `shapes.ts`, so a
 * mark that does not exist is a type error rather than a blank square.
 *
 * Server-rendered like anything else, which is what keeps the smoke and route
 * checks honest: they count `<use>`s of the bee the way they used to count 🐝.
 */

import type { CSSProperties, ReactNode } from "react";
import { SYMBOLS, type Prim, type SymbolId } from "./shapes.ts";

export const PREFIX = "bk-";

function el(p: Prim, key: string, clipIds: { n: number; owner: string }): ReactNode {
  switch (p.k) {
    case "ellipse":
      return (
        <ellipse
          key={key}
          cx={p.cx}
          cy={p.cy}
          rx={p.rx}
          ry={p.ry}
          transform={p.rot ? `rotate(${p.rot} ${p.cx} ${p.cy})` : undefined}
          fill={p.fill ?? "none"}
          stroke={p.stroke}
          strokeWidth={p.stroke ? (p.w ?? 1) : undefined}
        />
      );
    case "circle":
      return <circle key={key} cx={p.cx} cy={p.cy} r={p.r} fill={p.fill ?? "none"} stroke={p.stroke} strokeWidth={p.stroke ? (p.w ?? 1) : undefined} />;
    case "rect":
      return <rect key={key} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.fill ?? "none"} />;
    case "path":
      return (
        <path
          key={key}
          d={p.d}
          fill={p.fill ?? "none"}
          stroke={p.stroke}
          strokeWidth={p.stroke ? (p.w ?? 1) : undefined}
          strokeLinecap={p.cap}
          strokeLinejoin={p.join}
        />
      );
    case "group": {
      const parts = [];
      if (p.x || p.y) parts.push(`translate(${p.x ?? 0} ${p.y ?? 0})`);
      if (p.rot) parts.push(`rotate(${p.rot})`);
      let clipId: string | undefined;
      let clip: ReactNode = null;
      if (p.clip) {
        clipId = `${clipIds.owner}-clip-${clipIds.n++}`;
        clip = (
          <clipPath key={`${key}-clip`} id={clipId}>
            {el(p.clip, `${key}-clipshape`, clipIds)}
          </clipPath>
        );
      }
      return (
        <g key={key} transform={parts.length ? parts.join(" ") : undefined} clipPath={clipId ? `url(#${clipId})` : undefined}>
          {clip}
          {p.kids.map((k, i) => el(k, `${key}-${i}`, clipIds))}
        </g>
      );
    }
  }
}

/** Every mark, once. Mount it once, near the top of the app. */
export function ArtSymbols() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      {(Object.keys(SYMBOLS) as SymbolId[]).map((id) => {
        const shape = SYMBOLS[id]();
        const clipIds = { n: 0, owner: `${PREFIX}${id}` };
        return (
          <symbol key={id} id={`${PREFIX}${id}`} viewBox={`${-shape.box} ${-shape.box} ${shape.box * 2} ${shape.box * 2}`}>
            {shape.prims.map((p, i) => el(p, `${id}-${i}`, clipIds))}
          </symbol>
        );
      })}
    </svg>
  );
}

/**
 * One mark, `size` pixels square.
 *
 * `rotate` is degrees clockwise — a bee's heading, 0 east. `tint` is what any
 * `currentColor` in the shape paints as (the crown, the verb icons).
 */
export function Art({
  id,
  size,
  rotate,
  tint,
  className,
  title,
  style,
}: {
  id: SymbolId;
  size: number;
  rotate?: number;
  tint?: string;
  className?: string;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      style={{ ...style, color: tint ?? style?.color, transform: rotate ? `rotate(${rotate}deg)` : style?.transform }}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <use href={`#${PREFIX}${id}`} width={size} height={size} />
    </svg>
  );
}

/**
 * The same mark INSIDE another svg, for the thumbnails: a `<use>` placed in
 * that svg's own units, rotated about its centre.
 */
export function UseArt({ id, x, y, size, rotate }: { id: SymbolId; x: number; y: number; size: number; rotate?: number }) {
  const t = `translate(${x} ${y})${rotate ? ` rotate(${rotate})` : ""}`;
  return (
    <g transform={t}>
      <use href={`#${PREFIX}${id}`} x={-size / 2} y={-size / 2} width={size} height={size} />
    </g>
  );
}
