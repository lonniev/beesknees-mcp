/**
 * What this round has raised, climbing as it is raised.
 *
 * Every fare paid in a round lands in one pot and is split at the end: most of
 * it to the pollinators, a tenth to the bee that reaches a queen first. That
 * was only ever visible afterwards, in the ledger — so a player spending sats
 * could watch a board move and never see the one thing the spending was for.
 *
 * The split is NOT computed here. It comes from the service already divided,
 * by the same `split_pot` that writes the settlement, so what climbs on screen
 * and what is written into the books are one arithmetic rather than two
 * opinions about money. The rounding falls to the charity, and a frontend
 * reimplementing 80/10 is exactly where that would quietly stop being true.
 *
 * Practice rounds pass nothing and the counter does not appear. A till showing
 * pretend money beside a game that costs nothing would be the fabricated
 * figure this whole screen is careful not to show.
 */
import { useEffect, useRef, useState } from "react";
import { HeartHandshake, Trophy } from "lucide-react";
import { MIN_REELS, reels, widthFor } from "../game/odometer.ts";

export interface Pot {
  pot: number;
  charity: number;
  winner: number;
}

/**
 * One figure, as a row of reels that slide to their digit.
 *
 * Each reel is a full 0-9 strip translated by whole digit-heights, so the
 * movement is the strip turning rather than the character being swapped. The
 * clip is `overflow-hidden` on the reel and `tabular-nums` on the strip, which
 * is what keeps the columns from breathing as the digits change.
 */
function Reels({ value, size }: { value: number; size: "big" | "small" }) {
  // Grows, never shrinks — see `widthFor`. Held in state rather than derived so
  // a figure that dips (it should not, but a re-read could) cannot narrow the
  // reel under the reader's eye.
  const [width, setWidth] = useState(MIN_REELS);
  useEffect(() => setWidth((w) => widthFor(value, w)), [value]);

  const digits = reels(value, width);
  const cell = size === "big" ? "h-7 w-[0.62em] text-[26px]" : "h-4 w-[0.6em] text-[13px]";
  return (
    <span className="inline-flex items-baseline tabular-nums" aria-hidden="true">
      {digits.map((d, i) => (
        <span key={`${digits.length}-${i}`} className={`relative inline-block overflow-hidden ${cell}`}>
          <span
            className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-500 ease-out motion-reduce:transition-none"
            style={{ transform: `translateY(-${d * 10}%)`, height: "1000%" }}
          >
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <span key={n} className="flex h-[10%] items-center justify-center leading-none">
                {n}
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

/** The figure, for anything that reads rather than watches. */
function spoken(p: Pot, charityName: string): string {
  return (
    `This round has raised ${p.pot} sats: ` +
    `${p.charity} to ${charityName}, ${p.winner} to the winning bee.`
  );
}

export default function RoundTally({ pot, charity }: { pot: Pot | null; charity?: string }) {
  // A round that has taken nothing still shows a till at zero — that is the
  // honest reading and a scoreboard at nil-nil is still a scoreboard. What
  // would be wrong is a figure nobody paid, so an ABSENT pot draws nothing.
  const last = useRef<Pot | null>(null);
  if (pot) last.current = pot;
  const p = pot ?? last.current;
  if (!p) return null;

  const who = charity || "the pollinators";
  return (
    <div
      className="rounded-xl border border-ink/14 bg-ink/4 px-2.5 py-2 text-ink/90"
      role="status"
      aria-live="polite"
      aria-label={spoken(p, who)}
    >
      <div className="text-[10px] uppercase tracking-wide text-ink/60">This round</div>
      <div className="flex items-baseline gap-1">
        <Reels value={p.pot} size="big" />
        <span className="text-[11px] text-ink/60">sats</span>
      </div>
      <div className="mt-1.5 space-y-1 border-t border-ink/10 pt-1.5">
        <div className="flex items-center gap-1.5" title={`To ${who}`}>
          <HeartHandshake size={12} className="shrink-0 text-[var(--color-wax-ink)]" />
          <Reels value={p.charity} size="small" />
          <span className="truncate text-[10px] text-ink/60">{who}</span>
        </div>
        <div className="flex items-center gap-1.5" title="To the bee that reaches a queen first">
          <Trophy size={12} className="shrink-0 text-[var(--color-you-ink)]" />
          <Reels value={p.winner} size="small" />
          <span className="text-[10px] text-ink/60">winner</span>
        </div>
      </div>
    </div>
  );
}
