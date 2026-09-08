/**
 * What the game has raised, and who has won the most of it.
 *
 * Every figure is read from the live service and every one of them starts at
 * zero, which is the correct reading and not a reason to hide the board. A
 * scoreboard at nil-nil is still a scoreboard. What would be wrong is a
 * PLAUSIBLE number nobody earned — so these are either the service's answer or
 * a dash, never an estimate.
 */

import { useEffect, useState } from "react";
import { HeartHandshake, Coins, Trophy } from "lucide-react";
import { settlementHistory, type SettlementHistory } from "../lib/mcp";

/** Slow on purpose: settlements happen per match, not per second. */
const REFRESH_MS = 60_000;

function sats(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("en-US");
}

function short(npub: string): string {
  return npub.length > 14 ? `${npub.slice(0, 8)}…${npub.slice(-4)}` : npub;
}

export default function Scoreboard() {
  const [data, setData] = useState<SettlementHistory | null>(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () =>
      settlementHistory(50)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setReachable(true);
        })
        // A hive that did not answer is not a hive that raised nothing. Showing
        // a dash says "unknown"; showing 0 would be a claim.
        .catch(() => alive && setReachable(false));
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const known = reachable && data;
  const raised = known ? (data.settlements ?? []).reduce((a, s) => a + s.pot_sats, 0) : null;
  const charity = known ? (data.accrued_sats ?? 0) : null;
  // Ranked by rounds won, then by sats — and only bees that have actually won
  // one. Three of them: enough to be a podium, few enough to read at a glance.
  const top = known
    ? (data.leaderboard ?? [])
        .filter((r) => r.wins > 0)
        .sort((a, b) => b.wins - a.wins || b.sats - a.sats)
        .slice(0, 3)
    : [];

  return (
    <div className="flex shrink-0 items-start justify-between gap-4 px-1 text-[11px]">
      <div className="flex items-center gap-1.5 text-ink/70">
        <Coins size={13} />
        <span>raised</span>
        <span className="font-medium tabular-nums text-ink/95">{sats(raised)}</span>
        <span className="text-ink/65">sats</span>
      </div>

      <div className="flex min-w-0 flex-col items-end gap-1">
        <div className="flex items-center gap-1.5 text-ink/70">
          <HeartHandshake size={13} className="text-[var(--color-wax-ink)]" />
          <span>to pollinators</span>
          <span className="font-medium tabular-nums text-[var(--color-wax-ink)]">{sats(charity)}</span>
          <span className="text-ink/65">sats</span>
        </div>

        {/* The three best bees in the hive, by ROUNDS WON.
          *
          * It ranked by sats, which with nothing priced meant three names each
          * showing 0 — a leaderboard that led on the one number that is the same
          * for everybody. Wins are what a player is actually competing for, and
          * they are a real number today. Sats ride along where there are any.
          *
          * A player who has won nothing is not shown a table of strangers: an
          * empty board says so, because "nobody has won yet" is an invitation
          * and a list of zeroes is not. */}
        {top.length > 0 && (
          <div className="flex items-center gap-2.5 text-ink/65">
            <Trophy size={11} className="text-[var(--color-wax-ink)]" />
            {top.map((row, i) => (
              <span key={row.npub} className="tabular-nums" title={row.npub}>
                <span aria-hidden>{["🥇", "🥈", "🥉"][i]}</span>{" "}
                <span className="font-mono text-[10px]">{short(row.npub)}</span>{" "}
                <span className="text-ink/85">
                  {row.wins} {row.wins === 1 ? "win" : "wins"}
                </span>
                {row.sats > 0 && <span className="pl-1 text-ink/70">· {sats(row.sats)}</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
