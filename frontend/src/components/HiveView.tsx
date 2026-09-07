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
import {
  VIEW,
  cellAt,
  cellCentre,
  cellShape,
  combLattice,
  meadowLattice,
  ringRadius,
  slotAngle,
  xy,
} from "../lib/polar.ts";

interface Props {
  hive: Hive;
  /**
   * The cells this bee could legally step to next, drawn as options.
   *
   * Showing them does the teaching the rules cannot: when the stagger bars the
   * way inward, the inward cell simply is not offered, so the player learns the
   * rule by seeing it rather than by being refused.
   */
  options?: number[];
  /**
   * Where the player has aimed, drawn so the two-step move is visible.
   *
   * REQUIRED, not optional. It was optional, a patch failed to add it to the
   * focused board, and the compiler said nothing — so every tap set state that
   * nothing rendered and the game was unplayable with no error anywhere. A prop
   * the component cannot do its job without is not optional.
   */
  target: number | null;
  /**
   * The cells the bee will actually pass through to reach `target`.
   *
   * A tap in the comb now sets a DESTINATION rather than the next cell, so the
   * player has committed to a route they would otherwise not be able to see —
   * and the moment it matters is the moment a rival collapses part of it or
   * parks in the shaft. Empty while there is no aim.
   */
  route?: number[];
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

function HiveViewInner({ hive, frame, youId, target, route, options, focused, armed, onTapCell, onTapHive }: Props) {
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

  // The wall as arcs between the doors. A door was a coloured cell on an
  // unbroken ring, which reads as decoration; a GAP reads as a way in.
  const mouths: number[] = [];
  for (let c = 0; c < g.cells; c++) if (board.mouth[c]) mouths.push(c);
  const wallArcs: string[] = [];
  {
    const n = g.size[g.R];
    const slots = mouths.map((c) => c - g.offset[g.R]).sort((a, b) => a - b);
    for (let k = 0; k < slots.length; k++) {
      // From just past this door to just before the next one.
      const a0 = slotAngle(n, slots[k] + 1);
      const a1 = slotAngle(n, slots[(k + 1) % slots.length] + (k + 1 === slots.length ? n : 0));
      const [x0, y0] = xy(wallR, a0);
      const [x1, y1] = xy(wallR, a1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      wallArcs.push(`M${x0.toFixed(2)} ${y0.toFixed(2)}A${wallR.toFixed(2)} ${wallR.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`);
    }
  }
  const openCells: number[] = [];
  const flowers: number[] = [];
  const blockedCells: number[] = [];
  for (let c = 0; c < g.cells; c++) {
    if (ringOf(g, c) <= g.R && board.state[c] === OPEN) openCells.push(c);
    if (board.flower[c]) flowers.push(c);
    if (board.blocked[c]) blockedCells.push(c);
  }

  return (
    <svg
      ref={svgRef}
      className="hive h-full w-full"
      viewBox={`${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`}
      onPointerDown={handle}
    >
      {/* The meadow: a square lattice, filling the square field including its
       * corners, which is what a square grid is FOR. Rings could only ever have
       * reached the corners by stretching, and a stretched ring is a cell that
       * is bigger the further from the hive it sits. */}
      <rect x={-VIEW} y={-VIEW} width={VIEW * 2} height={VIEW * 2} fill="var(--color-meadow)" rx={6} />
      {focused && (
        <path
          d={meadowLattice(g)}
          fill="none"
          stroke="#000"
          strokeWidth={0.2}
          opacity={0.14}
        />
      )}

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
            opacity={board.pollen[c] ? 0.95 : 0.28}
          >
            🪻
          </text>
        );
      })}

      {/* The comb fill: one disc, not hundreds of wedges. */}
      <circle cx={0} cy={0} r={wallR} fill="var(--color-comb)" />

      {/* The wall, drawn as arcs BETWEEN the doors so a door is a gap rather
       * than a marking on an unbroken ring. It also carries the hive's
       * temperature — red once anyone is near the queen, its own blue while the
       * hive is yours and calm. */}
      {wallArcs.map((d, k) => (
        <path
          key={`w${k}`}
          d={d}
          fill="none"
          stroke={hot ? "var(--color-hot)" : mine ? "var(--color-hive-mine)" : "var(--color-wax)"}
          strokeWidth={hot ? 2.4 : 1.8}
          strokeLinecap="round"
        />
      ))}

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

      {/* Capped brood. Drawn, because a wall the player cannot see is a move
       * refused for no reason they can work out from the screen. */}
      {blockedCells.map((c) => (
        <path
          key={`x${c}`}
          d={cellShape(g, c)}
          fill="#000"
          opacity={0.55}
        />
      ))}

      {openCells.map((c) => (
        <path
          key={`o${c}`}
          d={cellShape(g, c)}
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

      {/* The moves available right now. Faint: they are a menu, not the answer. */}
      {focused &&
        options?.map((c) => (
          <path
            key={`opt${c}`}
            d={cellShape(g, c)}
            fill="#fff"
            opacity={0.07}
            stroke="#fff"
            strokeWidth={0.35}
            strokeOpacity={0.3}
          />
        ))}

      {/* The aim, and it has to be unmistakable.
       *
       * A tinted wedge was not enough: on a lit meadow a 22%-opacity fill over a
       * big cell reads as a shadow, and there was no way to tell which flower
       * you had picked. What the player chose is a FLOWER, so the mark goes
       * round the flower — a lime ring in the same colour as their own bee,
       * breathing, so the two read as a pair. */}
      {focused && target != null && (
        <g pointerEvents="none">
          {(() => {
            return (
              <>
                {/* The destination is the CELL, outlined, in white — a different
                    shape and a different hue from the bee's lime disc. They were
                    both lime circles of nearly the same size sitting side by
                    side, and there was no telling which was which. */}
                <path
                  d={cellShape(g, target)}
                  fill="#fff"
                  opacity={0.1}
                />
                <path
                  d={cellShape(g, target)}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={1.4}
                  className="bk-pulse"
                />
                {/* The ROUTE, not a straight thread to the destination.
                 *
                 * A straight line across the comb says "there", which the player
                 * already knows — it is the only thing they chose. What they
                 * cannot see is the line the bee will actually take: where the
                 * stagger makes it step sideways, where it detours round capped
                 * brood, and which of those cells it still has to cut. That is
                 * the plan, and watching a rival break it is the game. */}
                {youBee && route && route.length > 0 && (
                  <>
                    <polyline
                      points={[youBee.cell, ...route]
                        .map((c) => cellCentre(g, c).map((v) => v.toFixed(1)).join(","))
                        .join(" ")}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={0.6}
                      strokeDasharray="2 2"
                      opacity={0.5}
                      strokeLinejoin="round"
                    />
                    {/* Cells still to be CUT, marked apart from cells to be
                     * travelled: the difference is 8 seconds against 2, which
                     * is the whole cost of the line the player picked. */}
                    {route
                      .filter((c) => board.state[c] !== OPEN)
                      .map((c) => (
                        <path
                          key={`cut${c}`}
                          d={cellShape(g, c)}
                          fill="none"
                          stroke="#fff"
                          strokeWidth={0.35}
                          opacity={0.4}
                        />
                      ))}
                  </>
                )}
              </>
            );
          })()}
        </g>
      )}

      {armed && focused && (
        <circle cx={0} cy={0} r={VIEW - 1} fill="none" stroke="var(--color-queen)" strokeWidth={1.5} />
      )}
    </svg>
  );
}

export const HiveView = memo(HiveViewInner);
