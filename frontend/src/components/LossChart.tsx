/**
 * US managed honeybee colony losses, by survey year.
 *
 * A DOT PLOT rather than bars, and that is the whole design decision. Four
 * survey years are missing from what could be sourced, and bars would draw
 * those gaps as zero or hide them behind a continuous baseline. Dots read
 * correctly as observations: a year with no dot has no reading, not no loss.
 *
 * The 2024–25 figure that circulated widely is a WINTER loss and is deliberately
 * absent — mixing it with annual losses would make the last point look like a
 * collapse when it is a different measurement.
 *
 * Colour: brand gold, one series. `validate_palette.js` fails it on the dark
 * lightness band (L 0.83 vs 0.48–0.67) and passes contrast against this page's
 * actual surface. The band is a categorical check — the script's own footer says
 * so — and there is no second series here to separate. Forcing L≈0.6 would put a
 * dull gold on a near-black page, which is a worse chart in service of a rule
 * that is not about this case.
 */

import { useState } from "react";

/** Annual colony loss, % of managed colonies, US national surveys (BIP / AIA). */
const SERIES: { year: string; loss: number | null }[] = [
  { year: "2010–11", loss: 36.4 },
  { year: "2011–12", loss: 28.9 },
  { year: "2012–13", loss: 45.0 },
  { year: "2013–14", loss: 34.2 },
  { year: "2014–15", loss: 42.1 },
  { year: "2015–16", loss: 40.5 },
  { year: "2016–17", loss: 33.2 },
  { year: "2017–18", loss: null },
  { year: "2018–19", loss: 40.7 },
  { year: "2019–20", loss: null },
  { year: "2020–21", loss: 50.8 },
  { year: "2021–22", loss: 39.0 },
];

/** The decade average beekeepers report — the line the dots scatter around. */
const AVERAGE = 40;

const W = 640;
const H = 210;
const PAD = { top: 14, right: 14, bottom: 30, left: 34 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const Y_MAX = 60;

const x = (i: number) => PAD.left + (i / (SERIES.length - 1)) * PLOT_W;
const y = (v: number) => PAD.top + PLOT_H - (v / Y_MAX) * PLOT_H;

export default function LossChart() {
  const [hover, setHover] = useState<number | null>(null);
  const points = SERIES.map((d, i) => ({ ...d, i })).filter((d) => d.loss !== null);
  const active = hover !== null ? SERIES[hover] : null;

  return (
    <figure className="my-7">
      <figcaption className="text-sm font-medium text-ink/95">
        Share of US managed colonies lost each year
      </figcaption>
      <p className="mt-0.5 text-[11px] text-ink/65">
        Beekeeper-reported annual losses. Years without a dot are years I have no figure for, not
        years without losses.
      </p>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 w-full"
        role="img"
        aria-label="Annual US managed honeybee colony losses by survey year, ranging from about 29 to 51 percent"
      >
        {/* Recessive grid — four gridlines, no box, no ticks. */}
        {[0, 20, 40, 60].map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke="currentColor"
              className="text-ink/8"
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={y(v) + 3.5} textAnchor="end" className="fill-ink/65 text-[10px]">
              {v}%
            </text>
          </g>
        ))}

        {/* The level the whole decade sits at. Labelled, because a bare dashed
            line is a line nobody can read. */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(AVERAGE)}
          y2={y(AVERAGE)}
          stroke="var(--color-hot)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          opacity={0.65}
        />
        <text x={W - PAD.right} y={y(AVERAGE) - 6} textAnchor="end" className="fill-[var(--color-hot)] text-[10px]">
          about 4 in 10, most years
        </text>

        {SERIES.map((d, i) => (
          <text
            key={d.year}
            x={x(i)}
            y={H - 10}
            textAnchor="middle"
            className={`text-[9px] ${d.loss === null ? "fill-ink/65" : "fill-ink/65"}`}
          >
            {d.year.slice(2)}
          </text>
        ))}

        {points.map((d) => (
          <g key={d.year}>
            {/* A hit target larger than the mark, per the interaction rules. */}
            <circle
              cx={x(d.i)}
              cy={y(d.loss as number)}
              r={14}
              fill="transparent"
              onMouseEnter={() => setHover(d.i)}
              onMouseLeave={() => setHover(null)}
            />
            <circle
              cx={x(d.i)}
              cy={y(d.loss as number)}
              r={hover === d.i ? 7 : 5}
              fill="var(--color-wax-ink)"
              stroke="var(--color-sky)"
              strokeWidth={2}
            />
          </g>
        ))}

        {active?.loss != null && hover !== null && (
          <g pointerEvents="none">
            <rect
              x={Math.min(Math.max(x(hover) - 42, 2), W - 86)}
              y={y(active.loss) - 34}
              width={84}
              height={24}
              rx={5}
              fill="var(--color-ink)"
              opacity={0.82}
            />
            <text
              x={Math.min(Math.max(x(hover) - 42, 2), W - 86) + 42}
              y={y(active.loss) - 18}
              textAnchor="middle"
              className="fill-white text-[11px]"
            >
              {active.year}: {active.loss}%
            </text>
          </g>
        )}
      </svg>

      {/* Identity is never colour-alone, and the numbers are readable without
          hovering anything. */}
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-ink/65">The figures</summary>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink/70">
          {points.map((d) => (
            <span key={d.year} className="tabular-nums">
              {d.year} <span className="text-ink/95">{d.loss}%</span>
            </span>
          ))}
        </div>
      </details>

      <p className="mt-2 text-[10px] text-ink/65">
        Source: Bee Informed Partnership / Apiary Inspectors of America national colony loss surveys.
      </p>
    </figure>
  );
}
