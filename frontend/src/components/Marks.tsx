/**
 * The board's own marks, small enough to sit in a sentence.
 *
 * The About page described the game in words to somebody who had never seen it,
 * which is the wrong way round: a reader who has not played cannot picture a
 * "plucked flower" or "the halo", and by the time they meet one on the board
 * the explanation is three screens behind them.
 *
 * Every mark here is the mark the board draws, in the colours it draws it —
 * lucide icons for the tactics, the same glyphs for the flowers and the bees,
 * the same tokens for the queen's chamber and the halo. That matters more than
 * it sounds: a picture in the instructions that is merely LIKE the thing on
 * screen is worse than no picture, because it teaches somebody to look for
 * something that is not there.
 */

import { Footprints, Mountain, Wind } from "lucide-react";

/** A mark sitting on the text baseline, at about the size of a capital. */
function Inline({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <span
      title={title}
      aria-label={title}
      role="img"
      className="mx-0.5 inline-flex translate-y-[0.15em] items-center justify-center align-baseline"
    >
      {children}
    </span>
  );
}

export function Fly() {
  return (
    <Inline title="Fly">
      <Wind size={16} className="text-[var(--color-ink)]" />
    </Inline>
  );
}

export function Crawl() {
  return (
    <Inline title="Crawl">
      <Footprints size={16} className="text-[var(--color-ink)]" />
    </Inline>
  );
}

export function Mound() {
  return (
    <Inline title="Mound a tunnel shut">
      <Mountain size={16} className="text-[var(--color-ink)]" />
    </Inline>
  );
}

/** A flower that still has its pollen. `HiveView` draws this one 🌼. */
export function PollenFlower() {
  return (
    <Inline title="A flower with pollen">
      <span className="text-[15px] leading-none">🌼</span>
    </Inline>
  );
}

/** One somebody has already taken. `HiveView` draws this one 🪻. */
export function PluckedFlower() {
  return (
    <Inline title="A flower already plucked">
      <span className="text-[15px] leading-none">🪻</span>
    </Inline>
  );
}

export function BeeMark() {
  return (
    <Inline title="A bee">
      <span className="text-[15px] leading-none">🐝</span>
    </Inline>
  );
}

/** The queen, on her chamber — the pink disc at the centre of every hive. */
export function QueenMark() {
  return (
    <Inline title="The queen, in her chamber">
      <span
        className="inline-flex h-[19px] w-[19px] items-center justify-center rounded-full text-[11px] leading-none"
        style={{ background: "var(--color-queen)", opacity: 0.9 }}
      >
        👑
      </span>
    </Inline>
  );
}

/**
 * Your own bee, in its halo.
 *
 * The ring is what tells you which of sixty bees is yours, and it is the first
 * thing a new player asks. Same fill and stroke the board uses, at 22% and
 * solid — not "a green circle", the green circle.
 */
export function YouMark() {
  return (
    <Inline title="Your bee, in its halo">
      <span
        className="inline-flex h-[21px] w-[21px] items-center justify-center rounded-full text-[12px] leading-none"
        style={{
          background: "color-mix(in srgb, var(--color-you) 22%, transparent)",
          boxShadow: "inset 0 0 0 1.6px var(--color-you)",
        }}
      >
        🐝
      </span>
    </Inline>
  );
}

/**
 * A doorway: the gap in the wall, with the mouth cell showing through it.
 *
 * Drawn rather than glyphed, because a door is not a symbol on the board — it
 * is an ABSENCE, a break in the ring, and that is exactly the thing a new
 * player has to learn to look for.
 */
export function DoorMark() {
  return (
    <Inline title="A doorway in the hive wall">
      {/* A ring with a BREAK in it, and the mouth filling the break.
        * Two earlier attempts read as a broken circle and then as a smile: the
        * gap has to be unmistakable at twenty pixels, so it is a wide one at
        * the top with the gold door sitting right in it. */}
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        {/* The wall, almost all the way round. */}
        <path
          d="M15.59 4.45 A8.0 8.0 0 1 1 6.41 4.45"
          fill="none"
          stroke="var(--color-hive-mine)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        {/* The doorway itself, filling the gap the wall leaves. */}
        <path
          d="M6.41 4.45 A8.0 8.0 0 0 1 15.59 4.45"
          fill="none"
          stroke="var(--color-wax)"
          strokeWidth="3.4"
          strokeLinecap="butt"
        />
      </svg>
    </Inline>
  );
}
