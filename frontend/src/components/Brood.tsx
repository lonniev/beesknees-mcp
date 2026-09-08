/**
 * What the race was actually for.
 *
 * The winner's card showed a trophy — a sports cup, for a round about a drone
 * reaching a queen. This is the scene instead: the queen, the bee that got to
 * her, and the brood that follows, laid one cell at a time.
 *
 * Comb and eggs are drawn rather than lettered. There is no queen-bee emoji and
 * `🥚` is a hen's egg the size of the queen's head, which is funny for the wrong
 * reason; a bee's egg is a pale grain standing in a cell, and six hexagons with
 * grains in them read as brood to anybody who has seen a frame. The bees stay
 * glyphs because the board already draws them that way.
 *
 * The eggs arrive in sequence, left to right, after the pair have settled. That
 * ordering is the whole gag — it is a consequence, and a consequence should
 * land after its cause.
 */

/** A hexagon, flat-top, centred on (cx, cy). Comb, not a honeycomb pattern. */
function hex(cx: number, cy: number, r: number): string {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  });
  return pts.join(" ");
}

export default function Brood({ yours = false }: { yours?: boolean }) {
  const eggs = yours ? 6 : 4;
  const R = 11;
  const gap = R * 1.78;
  const width = gap * (eggs - 1) + R * 2 + 8;

  return (
    <div
      className="flex flex-col items-center gap-1 select-none"
      role="img"
      aria-label={
        yours
          ? "Your bee has reached the queen, and the brood is being laid."
          : "The winning bee has reached the queen, and the brood is being laid."
      }
    >
      {/* The pair. The crown sits over the queen, not over the winner — she was
        * always the queen; he only just arrived. */}
      <div className="flex items-end gap-2" aria-hidden="true">
        <span className="relative inline-block">
          <span
            className="absolute -top-3 left-1/2 -translate-x-1/2 leading-none"
            style={{ fontSize: yours ? 16 : 13 }}
          >
            👑
          </span>
          <span className="bk-queen block leading-none" style={{ fontSize: yours ? 40 : 30 }}>
            🐝
          </span>
        </span>
        {/* Arriving, and out of breath: the winner is the one that moves. */}
        <span className="bk-suitor block leading-none" style={{ fontSize: yours ? 26 : 20 }}>
          🐝
        </span>
      </div>

      <svg
        width={width}
        height={R * 2 + 6}
        viewBox={`0 0 ${width} ${R * 2 + 6}`}
        aria-hidden="true"
      >
        {Array.from({ length: eggs }, (_, i) => {
          const cx = R + 4 + i * gap;
          const cy = R + 3;
          return (
            <g key={i}>
              <polygon
                points={hex(cx, cy, R)}
                fill="none"
                stroke="var(--color-wax)"
                strokeWidth={1.4}
                opacity={0.5}
              />
              {/* A grain leaning in the cell, not a bar standing in it. A
                * bee lays the egg on end and slightly tilted, and upright
                * white ellipses at this size read as punctuation. The lean
                * alternates so six of them are a brood rather than a comb. */}
              <ellipse
                className="bk-egg"
                cx={cx}
                cy={cy + 1}
                rx={2.4}
                ry={4.1}
                fill="#fdf6e3"
                opacity={0.92}
                transform={`rotate(${i % 2 ? 13 : -13} ${cx} ${cy + 1})`}
                style={{ animationDelay: `${0.75 + i * 0.16}s`, transformOrigin: `${cx}px ${cy}px` }}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
