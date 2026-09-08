/**
 * A meadow behind the page, for the screens that are mostly sky.
 *
 * The sign-in screen is one small card in the middle of a very large lavender
 * field, and on a tablet that reads as a page that failed to finish loading
 * rather than as a page that is calm. This is the ground underneath it.
 *
 * Drawn, not tiled. Every blade and petal is a path in one square-agnostic
 * viewBox, so it is as sharp on a 3x tablet as on a laptop and costs one
 * request rather than an asset set per density. A bitmap would have been
 * quicker to make and wrong at exactly the sizes this app is read at.
 *
 * The BEES are not here. They were, drifting on one CSS keyframe — the same arc
 * four times over — and they are the live foragers from the playfield now,
 * mounted once for the whole app (`Meadow`, `PageBees`). This is the ground
 * they fly over and nothing else.
 *
 * Three rules it obeys, because scenery that breaks any of them stops being
 * scenery:
 *
 *   * It never takes a tap. `pointer-events-none` throughout, and `aria-hidden`
 *     — a screen reader has no use for a hill, and a finger must never land on
 *     a flower instead of the button above it.
 *   * It never sits behind text. The band is anchored to the bottom of the
 *     viewport and the cards on these pages are opaque; the drifting bees are
 *     kept to the outer margins, where the column is not.
 *   * It does not move for somebody who asked for stillness. The drift is one
 *     keyframe, and `prefers-reduced-motion` stops it in `index.css` rather
 *     than here.
 *
 * Positions are a fixed table rather than `Math.random`, for the reason
 * `Sprigs` learned first: this renders on the server for the route check and
 * again in the browser, and randomness makes those two disagree.
 */

export default function Meadowscape() {
  return (
    <>
      {/* The ground. Three bands, each a little darker and a little nearer,
          which is the whole of the depth this needs. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 overflow-hidden"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 1200 300"
          preserveAspectRatio="xMidYMax slice"
          className="block h-[46vh] max-h-[380px] min-h-[190px] w-full"
        >
          {/* Far hill: the horizon of the whole picture, and barely there. */}
          <path
            d="M0 92 C 190 52, 340 96, 500 78 S 840 34, 1010 70 1200 88 1200 88 L1200 300 L0 300 Z"
            fill="var(--color-far)"
            opacity="0.55"
          />
          {/* Middle ground. */}
          <path
            d="M0 158 C 160 126, 360 172, 545 150 S 900 112, 1075 148 1200 158 1200 158 L1200 300 L0 300 Z"
            fill="var(--color-mid)"
            opacity="0.6"
          />
          {/* The near bank everything grows out of. */}
          <path
            d="M0 224 C 230 202, 430 238, 655 224 S 1020 196, 1200 220 L1200 300 L0 300 Z"
            fill="var(--color-near)"
            opacity="0.62"
          />

          {/* Grass, in clumps. Evenly spaced blades read as a comb; a meadow
              grows in tufts with gaps between them. */}
          <path
            d="M8 239c2-8 7-12 9-17M13 239c3-15 9-23 12-33M20 239c-1-8 -2-13 -2-19M26 239c-3-15 -10-23 -13-33M37 239c1-20 3-31 4-44M46 234c-3-20 -10-32 -13-45M54 234c-2-11 -8-17 -10-25M57 234c2-11 7-18 9-25M75 231c-3-8 -10-13 -13-18M81 231c-0-16 -2-25 -2-36M88 231c-0-15 -1-23 -1-34M94 231c1-18 4-28 6-40M106 233c-1-17 -5-27 -6-38M115 233c-1-9 -2-14 -2-20M122 233c-0-9 -0-14 -0-21M122 233c2-16 6-25 8-36M135 233c-1-19 -4-30 -5-42M146 234c3-19 10-29 13-41M153 234c-3-16 -10-25 -13-36M162 234c3-16 11-25 14-35M171 234c-1-11 -3-17 -3-25M185 239c-0-15 -0-24 -0-34M191 239c2-11 5-17 7-25M199 239c-0-20 -0-30 -0-44M215 234c2-18 8-28 10-41M221 234c-1-13 -3-20 -4-28M232 234c-2-20 -8-31 -10-45M232 234c-2-10 -6-16 -8-23M250 230c-1-13 -3-20 -4-29M258 230c1-20 4-31 5-45M265 230c1-16 4-24 5-35M266 230c2-19 6-30 8-43M294 232c-1-14 -2-21 -3-30M300 232c-0-20 -1-32 -2-46M305 232c-3-15 -9-24 -11-34M316 232c3-14 10-22 13-32M332 238c-2-9 -5-14 -7-20M339 238c-2-12 -8-19 -11-27M349 238c-0-21 -1-32 -1-46M368 228c-0-17 -0-27 -1-38M376 228c-2-14 -6-22 -8-31M386 228c1-12 4-19 5-27M412 240c-2-17 -5-26 -7-37M419 240c2-9 6-15 8-21M426 240c-1-18 -4-28 -5-39M430 240c3-18 11-28 14-40M446 240c2-18 7-28 9-40M453 229c3-17 11-27 14-38M461 229c-2-14 -7-21 -9-30M468 229c2-12 7-18 9-26M477 229c3-12 10-19 14-26M481 229c1-10 3-15 4-22M489 229c-0-19 -0-29 -1-41M496 229c-3-18 -9-28 -12-40M520 237c-2-14 -7-21 -9-30M528 237c2-12 7-18 9-26M538 237c-1-13 -2-20 -3-28M546 237c-2-17 -7-26 -9-38M548 234c1-16 2-25 3-36M556 234c3-14 10-21 13-30M560 234c-3-15 -11-23 -14-32M573 234c-3-17 -9-26 -11-38M589 232c-2-18 -6-29 -8-41M595 232c-2-11 -6-17 -7-25M604 232c-1-11 -2-17 -2-24M606 232c-1-19 -3-30 -4-43M625 238c-2-9 -8-14 -10-20M632 238c2-19 6-30 8-42M639 238c-2-18 -8-27 -10-39M641 238c-3-16 -8-24 -11-35M652 237c-2-15 -6-23 -7-33M658 237c0-18 0-27 0-39M666 237c3-17 9-27 12-39M672 237c0-15 0-24 0-34M688 232c3-14 10-21 13-30M696 232c3-19 10-30 13-42M700 232c3-15 10-23 13-33M713 232c-2-9 -8-14 -11-20M715 232c-2-8 -6-13 -7-18M715 237c1-9 5-14 6-21M723 237c3-9 8-14 11-20M733 237c3-10 10-16 13-23M735 237c3-14 11-21 14-31M749 237c-0-9 -2-15 -2-21M752 232c-1-8 -3-13 -4-19M758 232c1-13 4-21 6-30M765 232c-1-14 -5-22 -6-32M778 232c3-9 9-14 12-19M775 232c-3-19 -9-30 -12-42M783 230c3-13 9-20 12-29M791 230c-2-11 -8-17 -10-24M801 230c1-15 4-23 6-33M799 230c1-8 4-12 5-18M818 230c-2-8 -5-13 -7-19M825 230c-2-10 -5-16 -7-23M829 230c3-7 11-11 14-16M852 235c3-17 10-26 13-37M861 235c-2-11 -7-17 -9-24M870 235c0-16 1-24 1-35M870 235c1-13 4-21 5-29M876 235c3-18 11-28 14-40M879 236c-0-10 -1-15 -1-22M888 236c2-9 7-13 9-19M892 236c2-14 7-22 10-31M913 236c2-12 7-18 10-26M920 236c-1-16 -2-25 -3-35M925 236c-2-8 -8-12 -11-18M929 236c-2-17 -5-27 -7-38M935 236c2-8 8-13 10-19M956 234c-2-8 -7-12 -9-17M962 234c-1-7 -3-11 -4-16M969 234c-1-20 -4-32 -5-46M971 234c-2-19 -6-30 -8-42M979 234c-3-12 -9-18 -12-26M988 229c2-8 7-13 9-19M993 229c-1-15 -2-24 -3-34M1000 229c-3-16 -9-24 -12-35M1014 229c-2-19 -8-29 -10-42M1031 237c-1-14 -5-22 -6-31M1039 237c2-9 7-14 9-20M1047 237c-0-14 -2-22 -2-31M1055 237c3-14 9-22 12-31M1073 238c1-19 4-30 5-43M1080 238c-3-10 -10-16 -13-23M1084 238c-3-12 -9-19 -11-27M1115 235c-0-16 -0-25 -0-36M1120 235c2-18 5-28 7-40M1129 235c1-14 4-22 5-32M1143 230c2-11 5-17 7-24M1148 230c3-17 10-27 14-38M1157 230c-0-12 -0-19 -1-27M1166 230c1-18 3-27 3-39M1181 234c1-16 4-25 6-36M1189 234c-0-9 -0-14 -1-20M1195 234c-3-20 -9-32 -11-45"
            fill="none"
            stroke="var(--color-stem)"
            strokeWidth="2.6"
            strokeLinecap="round"
            opacity="0.5"
          />

          {/* Fewer flowers, bigger. Five specks read as dust; a dozen heads
              you can name read as a meadow. */}
          <g>
            {[
              [284, 231, 49],
              [608, 232, 70],
              [745, 229, 66],
              [1118, 229, 59]
            ].map(([x, y, h], i) => (
              <g key={`c${i}`}>
                <path
                  d={`M${x} ${y}c-4-${Math.round(h * 0.45)} 3-${Math.round(h * 0.75)} 0-${h}`}
                  fill="none"
                  stroke="var(--color-stem)"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  opacity="0.62"
                />
                {/* A clover head: three lobes, so the silhouette names it. */}
                <g fill="var(--color-flower)" transform={`translate(${x} ${y - h})`}>
                  <circle cx="-5" cy="1" r="6" />
                  <circle cx="5" cy="1" r="6" />
                  <circle cx="0" cy="-5" r="6" />
                  <circle cx="0" cy="-0.5" r="3.4" fill="#fff" opacity="0.45" />
                </g>
              </g>
            ))}
            {[
              [40, 231, 62],
              [168, 233, 71],
              [385, 238, 62],
              [507, 229, 75],
              [866, 232, 62],
              [972, 232, 76]
            ].map(([x, y, h], i) => (
              <g key={`d${i}`}>
                <path
                  d={`M${x} ${y}c4-${Math.round(h * 0.45)} -3-${Math.round(h * 0.75)} 0-${h}`}
                  fill="none"
                  stroke="var(--color-stem)"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  opacity="0.62"
                />
                {/* A dandelion: rays around a disc. */}
                <g transform={`translate(${x} ${y - h})`}>
                  <g
                    stroke="var(--color-wax)"
                    strokeWidth="3"
                    strokeLinecap="round"
                    opacity="0.9"
                  >
                    <path d="M0-9V-2M6.4-6.4 1.4-1.4M9 0H2M6.4 6.4 1.4 1.4M0 9V2M-6.4 6.4-1.4 1.4M-9 0H-2M-6.4-6.4-1.4-1.4" />
                  </g>
                  <circle r="3.6" fill="var(--color-wax-ink)" opacity="0.55" />
                </g>
              </g>
            ))}
          </g>
        </svg>
      </div>

    </>
  );
}
