/**
 * The moment the queen is reached.
 *
 * A bee crosses a meadow, waits its turn at a door somebody else is standing
 * in, and digs thirty cells of comb to get here. What it got for that was a
 * trophy glyph and a line of grey text — the same card a dialog uses to say a
 * form was saved. The end of a race is the one moment in this game that is
 * allowed to be loud.
 *
 * Three beats, over about a second and a half:
 *
 *   a wave out of the queen chamber, through the comb, over the wall
 *   the crown, landing with weight rather than fading up politely
 *   the hive emptying out — bees RISING, because falling confetti is the
 *   wrong physics for the one animal this screen is about
 *
 * Then the result card settles over it. The card is opaque and covers the
 * hive, so it is held back rather than arriving on the same frame and hiding
 * everything above.
 *
 * A rival's win gets the same shape at half the volume: it is still the end of
 * the race, but it is not YOUR wedding.
 *
 * Geometry and opacity only, like the rest of the board — no illustration, and
 * no sound. Nothing here survives its two seconds, and `prefers-reduced-motion`
 * skips it entirely rather than playing it slowly.
 */

import { useMemo } from "react";

/** Where the wave starts: the queen chamber, as a share of the hive's square. */
const QUEEN = 0.08;

interface Fleck {
  glyph: string;
  dx: string;
  dy: string;
  spin: string;
  life: string;
  wait: string;
  size: number;
}

/**
 * The swarm, drawn once.
 *
 * Rising and spreading, biased upward — a hive boiling over goes up and out,
 * not down. Randomised per win rather than per frame, so React re-rendering
 * mid-flight cannot restart anybody's arc.
 */
function swarm(n: number): Fleck[] {
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  return Array.from({ length: n }, (_, i) => {
    // Fanned across the upper half, with a few stragglers going sideways.
    const angle = rnd(-Math.PI * 0.95, Math.PI * 0.05);
    const reach = rnd(90, 230);
    return {
      glyph: i % 7 === 0 ? "👑" : "🐝",
      dx: `${Math.cos(angle) * reach}px`,
      dy: `${Math.sin(angle) * reach}px`,
      spin: `${rnd(-160, 160)}deg`,
      life: `${rnd(1.1, 2.0).toFixed(2)}s`,
      wait: `${rnd(0, 0.45).toFixed(2)}s`,
      size: rnd(13, 24),
    };
  });
}

export default function Coronation({ yours }: { yours: boolean }) {
  // Keyed on `yours` only, so the arcs are dealt once and the animation is
  // never restarted by an unrelated re-render — a poll landing mid-flourish
  // would otherwise snap every bee back to the centre.
  const flecks = useMemo(() => swarm(yours ? 22 : 10), [yours]);

  return (
    // Centred on the hive rather than the box: every hive is a square viewBox
    // letterboxed in an element that is usually wider, so `h-full aspect-square`
    // IS the hive, and a wave sized to the box would break the wall early on
    // one axis and never reach it on the other.
    <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
      <div className="relative aspect-square h-full">
        {/* Three waves, staggered, so it reads as a pulse rather than a ring. */}
        {[0, 0.22, 0.44].slice(0, yours ? 3 : 2).map((delay, i) => (
          <span
            key={i}
            className="bk-wave absolute inset-0 rounded-full"
            style={{
              border: `3px solid ${yours ? "var(--color-wax)" : "var(--color-hot)"}`,
              animationDelay: `${delay}s`,
              // The leading wave carries a wash, so the comb LIGHTS as it
              // passes. The others are outline only, or the middle of the
              // board turns to soup.
              background:
                i === 0
                  ? "radial-gradient(circle, rgba(255,205,90,.45), rgba(255,205,90,.14) 55%, transparent 78%)"
                  : undefined,
            }}
          />
        ))}

        {/* The crown, over the queen.
          *
          * Two spans, because the animation animates `transform` and would
          * otherwise overwrite the centring translate — the crown landed
          * below and to the right of the queen it was meant to sit on, which
          * is exactly the kind of thing only a screenshot catches. */}
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span
            className="bk-crown block select-none"
            style={{ fontSize: yours ? "clamp(34px, 7vmin, 88px)" : "clamp(20px, 4vmin, 48px)" }}
            aria-hidden="true"
          >
            👑
          </span>
        </span>

        {/* The hive, emptying out. */}
        <div
          className="absolute left-1/2 top-1/2"
          style={{ transform: `translate(-50%, -50%) scale(${1 - QUEEN})` }}
        >
          {flecks.map((f, i) => (
            <span
              key={i}
              className="bk-rise absolute select-none"
              aria-hidden="true"
              style={
                {
                  fontSize: f.size,
                  lineHeight: 1,
                  "--dx": f.dx,
                  "--dy": f.dy,
                  "--spin": f.spin,
                  "--life": f.life,
                  "--wait": f.wait,
                } as React.CSSProperties
              }
            >
              {f.glyph}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
