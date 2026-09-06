/**
 * One hive, drawn as a rosette.
 *
 * The comb is a single disc rather than 857 wedges. Only the cells somebody has
 * actually dug get their own path, so a fresh board costs a handful of nodes and
 * a heavily worked one a few hundred — which is what makes four live hives on a
 * phone possible at all. Tapping is answered by arithmetic in `polar.ts`, not by
 * hit-testing shapes that were never drawn.
 */

import { memo, useCallback, useRef } from "react";
import { OPEN, ringOf } from "../game/rules.ts";
import type { Bee } from "../game/rules.ts";
import type { Hive } from "../game/match.ts";
import { seated } from "../game/match.ts";
import { VIEW, cellAt, cellCentre, cellPath, ringRadius } from "../lib/polar.ts";

interface Props {
  hive: Hive;
  /** The bee this player is flying, when it is in this hive. */
  youId: number | null;
  focused: boolean;
  armed: boolean;
  onTapCell?: (cell: number) => void;
  onTapHive?: () => void;
}

function beeGlyph(bee: Bee): string {
  return bee.phase === "done" ? "👑" : "🐝";
}

function HiveViewInner({ hive, youId, focused, armed, onTapCell, onTapHive }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const g = hive.round.board.g;
  const board = hive.round.board;
  const bees = seated(hive);

  const handle = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!focused) {
        onTapHive?.();
        return;
      }
      const svg = svgRef.current;
      if (!svg || !onTapCell) return;
      const rect = svg.getBoundingClientRect();
      // The viewBox is square and centred, so view units come straight off the
      // shorter side. Using width alone breaks the moment the box is letterboxed.
      const size = Math.min(rect.width, rect.height);
      const x = ((e.clientX - rect.left - rect.width / 2) / size) * 2 * VIEW;
      const y = ((e.clientY - rect.top - rect.height / 2) / size) * 2 * VIEW;
      const cell = cellAt(g, x, y);
      if (cell !== null) onTapCell(cell);
    },
    [focused, g, onTapCell, onTapHive],
  );

  const wallR = ringRadius(g, g.R + 1);
  const openCells: number[] = [];
  const flowers: number[] = [];
  for (let c = 0; c < g.cells; c++) {
    if (ringOf(g, c) <= g.R && board.state[c] === OPEN) openCells.push(c);
    if (board.flower[c]) flowers.push(c);
  }

  return (
    <svg
      ref={svgRef}
      className="hive h-full w-full"
      viewBox={`${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`}
      onPointerDown={handle}
    >
      <circle cx={0} cy={0} r={VIEW} fill="var(--color-meadow)" />
      {flowers.map((c) => {
        const [x, y] = cellCentre(g, c);
        return (
          <circle key={`f${c}`} cx={x} cy={y} r={focused ? 1.8 : 2.6} fill="var(--color-wax)" opacity={0.75} />
        );
      })}

      {/* The solid comb: one disc, not 857 wedges. */}
      <circle cx={0} cy={0} r={wallR} fill="var(--color-comb)" stroke="var(--color-wax)" strokeWidth={0.6} />

      {/* Faint rings, so a player can read depth without every cell being drawn. */}
      {focused &&
        Array.from({ length: g.R + 1 }, (_, r) => (
          <circle
            key={`r${r}`}
            cx={0}
            cy={0}
            r={ringRadius(g, r)}
            fill="none"
            stroke="var(--color-comb-edge)"
            strokeWidth={0.25}
          />
        ))}

      {openCells.map((c) => (
        <path
          key={`o${c}`}
          d={cellPath(g, ringOf(g, c), c - g.offset[ringOf(g, c)])}
          fill="var(--color-tunnel)"
          opacity={0.55}
        />
      ))}

      {/* The queen's chamber. */}
      <circle cx={0} cy={0} r={ringRadius(g, 1)} fill="var(--color-queen)" opacity={0.9} />
      <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={focused ? 5 : 9}>
        👑
      </text>

      {bees.map((bee) => {
        const isYou = youId === bee.id;
        const [x, y] = cellCentre(g, bee.cell);
        return (
          <g key={`b${bee.id}`}>
            {isYou && (
              <circle cx={x} cy={y} r={focused ? 4.5 : 7} fill="none" stroke="#fff" strokeWidth={focused ? 0.9 : 1.6} />
            )}
            <text
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={focused ? 4.5 : 8}
              opacity={bee.phase === "done" ? 1 : isYou ? 1 : 0.8}
            >
              {beeGlyph(bee)}
            </text>
          </g>
        );
      })}

      {armed && focused && (
        <circle cx={0} cy={0} r={VIEW - 1} fill="none" stroke="var(--color-queen)" strokeWidth={1.5} />
      )}
    </svg>
  );
}

export const HiveView = memo(HiveViewInner);
