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
import { isHot, seated } from "../game/match.ts";
import { VIEW, cellAt, cellCentre, cellPath, combLattice, ringRadius } from "../lib/polar.ts";

interface Props {
  hive: Hive;
  /** Where the player has aimed, drawn so the two-step move is visible. */
  target?: number | null;
  /**
   * The match's tick counter.
   *
   * Not read — it exists so `memo` has something that actually changes. The
   * board is mutated in place inside a stable `hive` object, so every prop a
   * thumbnail receives is reference-equal frame to frame and memo would be
   * entitled to skip the re-render. Passing the frame makes the dependency
   * explicit rather than relying on some other prop happening to churn.
   */
  frame: number;
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

function HiveViewInner({ hive, frame, youId, target, focused, armed, onTapCell, onTapHive }: Props) {
  void frame;
  const svgRef = useRef<SVGSVGElement>(null);
  const g = hive.round.board.g;
  const board = hive.round.board;
  const bees = seated(hive);
  const youBee = youId === null ? null : bees.find((b) => b.id === youId) ?? null;
  // Red beats green: a hive of yours with the race reaching its queen is hot
  // first and yours second, because the thing you need to know is that it is
  // being decided right now.
  const hot = isHot(hive);
  const mine = youId !== null;

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

      {/* Flowers were gold dots, which at this size is exactly what a distant
       * bee looks like — so the meadow read as forty bees rather than twelve
       * bees among flowers. A glyph settles it at a glance. */}
      {flowers.map((c) => {
        const [x, y] = cellCentre(g, c);
        return (
          <text
            key={`f${c}`}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={focused ? 6 : 6}
            opacity={0.95}
          >
            🪻
          </text>
        );
      })}

      {/* The solid comb: one disc, not 857 wedges. The wall carries the hive's
       * temperature — red once anyone is near the queen, green while the hive
       * is yours and calm. It is the one signal readable at thumbnail size. */}
      <circle
        cx={0}
        cy={0}
        r={wallR}
        fill="var(--color-comb)"
        stroke={hot ? "var(--color-hot)" : mine ? "var(--color-hive-mine)" : "var(--color-wax)"}
        strokeWidth={hot ? 1.8 : mine ? 1.2 : 0.6}
      />

      {/* The comb's cells — one path for all 857 of them.
       *
       * Only on the focused board: at thumbnail size the lattice turns to mud
       * and costs more than it says. The thumbnails get a handful of depth
       * rings instead, which is all they need to show how far in a rival is. */}
      {focused ? (
        <path
          d={combLattice(g)}
          fill="none"
          stroke="var(--color-comb-edge)"
          strokeWidth={0.22}
          opacity={0.85}
        />
      ) : (
        Array.from({ length: 5 }, (_, k) => (
          <circle
            key={`r${k}`}
            cx={0}
            cy={0}
            r={ringRadius(g, Math.round(((k + 1) * g.R) / 6))}
            fill="none"
            stroke="var(--color-comb-edge)"
            strokeWidth={0.5}
          />
        ))
      )}

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

      {/* Rivals first, dimmed, so your own bee is never drawn under one. */}
      {bees
        .filter((b) => b.id !== youId)
        .map((bee) => {
          const [x, y] = cellCentre(g, bee.cell);
          return (
            <text
              key={`b${bee.id}`}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={focused ? 4.5 : 7}
              opacity={bee.phase === "done" ? 1 : 0.5}
            >
              {beeGlyph(bee)}
            </text>
          );
        })}

      {/* You, last and loudest.
       *
       * Twelve identical glyphs on a ring is a find-the-difference puzzle, and
       * the thin white circle this replaced disappeared entirely at thumbnail
       * size. The spoke is the part that actually works: the eye follows a line
       * from the centre out, so locating yourself costs a glance rather than a
       * search — which matters most on the crowded outer rings where every bee
       * starts. */}
      {youBee && (
        <g>
          {(() => {
            const [x, y] = cellCentre(g, youBee.cell);
            const len = Math.hypot(x, y);
            const [sx, sy] = len > 0 ? [(x / len) * ringRadius(g, 1), (y / len) * ringRadius(g, 1)] : [0, 0];
            return (
              <>
                <line
                  x1={sx}
                  y1={sy}
                  x2={x}
                  y2={y}
                  stroke="var(--color-you)"
                  strokeWidth={focused ? 0.5 : 0.9}
                  opacity={0.45}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={focused ? 5 : 8}
                  fill="var(--color-you)"
                  opacity={0.22}
                  className="bk-pulse"
                />
                <circle
                  cx={x}
                  cy={y}
                  r={focused ? 5 : 8}
                  fill="none"
                  stroke="var(--color-you)"
                  strokeWidth={focused ? 1.1 : 1.8}
                />
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={focused ? 5.5 : 9}
                >
                  {beeGlyph(youBee)}
                </text>
              </>
            );
          })()}
        </g>
      )}

      {/* The aim. Without it the board gives no sign that a tap did anything,
       * and the button looked like the only control that existed. */}
      {focused && target != null && (
        <g pointerEvents="none">
          <path
            d={cellPath(g, ringOf(g, target), target - g.offset[ringOf(g, target)])}
            fill="var(--color-you)"
            opacity={0.22}
          />
          <path
            d={cellPath(g, ringOf(g, target), target - g.offset[ringOf(g, target)])}
            fill="none"
            stroke="var(--color-you)"
            strokeWidth={0.9}
          />
        </g>
      )}

      {armed && focused && (
        <circle cx={0} cy={0} r={VIEW - 1} fill="none" stroke="var(--color-queen)" strokeWidth={1.5} />
      )}
    </svg>
  );
}

export const HiveView = memo(HiveViewInner);
