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
  const top = known ? (data.leaderboard ?? []).slice(0, 3) : [];

  return (
    <div className="flex shrink-0 items-start justify-between gap-4 px-1 text-[11px]">
      <div className="flex items-center gap-1.5 text-white/50">
        <Coins size={13} />
        <span>raised</span>
        <span className="font-medium tabular-nums text-white/85">{sats(raised)}</span>
        <span className="text-white/35">sats</span>
      </div>

      <div className="flex min-w-0 flex-col items-end gap-1">
        <div className="flex items-center gap-1.5 text-white/50">
          <HeartHandshake size={13} className="text-[var(--color-wax)]" />
          <span>to pollinators</span>
          <span className="font-medium tabular-nums text-[var(--color-wax)]">{sats(charity)}</span>
          <span className="text-white/35">sats</span>
        </div>

        {top.length > 0 && (
          <div className="flex items-center gap-2 text-white/40">
            <Trophy size={11} />
            {top.map((row) => (
              <span key={row.npub} className="tabular-nums">
                <span className="font-mono text-[10px]">{short(row.npub)}</span>{" "}
                <span className="text-white/70">{sats(row.sats)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
