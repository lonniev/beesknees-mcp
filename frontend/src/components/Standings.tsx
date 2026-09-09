/**
 * Who has won the most, and what the pot has raised — wherever it is asked.
 *
 * This was inside `pages/Ledger.tsx`, on a page a waiting player has to leave
 * the lobby to reach. The lobby is where they are STUCK: the one screen in the
 * app somebody is certain to read all of, and the only one where "what is this
 * wait for" is a live question. So the answer moves to a component and both
 * screens render it.
 *
 * Every figure comes from `settlement_history`, which is free precisely so a
 * claim about where donations went costs nothing to check. Nothing here is
 * estimated: before any match settles these read zero, which is the truth, and
 * a plausible-looking number would be the one a screenshot quotes back.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Coins, HeartHandshake, Trophy } from "lucide-react";
import { sats, shortNpub } from "../lib/figures";
import { settlementHistory, type SettlementHistory } from "../lib/mcp";

/** The public receipt, read once by whoever needs it. */
export function useSettlements(limit = 50): {
  data: SettlementHistory | null;
  failed: boolean;
} {
  const [data, setData] = useState<SettlementHistory | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    settlementHistory(limit)
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [limit]);
  return { data, failed };
}

export function Stat({ icon, label, value }: {
  icon: ReactNode; label: string; value: string;
}) {
  return (
    <div className="rounded-xl bg-ink/4 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] text-ink/70">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/**
 * The two figures that say what the game is for.
 *
 * "Raised" is every pot ever settled. "Owed" is the charity's share that has
 * accrued and not yet been sent — it is batched, because a single round's share
 * can be smaller than the network fee to move it.
 */
export function Money({ data }: { data: SettlementHistory | null }) {
  const raised = (data?.settlements ?? []).reduce((a, s) => a + s.pot_sats, 0);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Stat
        icon={<Coins size={16} />}
        label="Raised across all matches"
        value={`${sats(raised)} sats`}
      />
      <Stat
        icon={<HeartHandshake size={16} />}
        label="Waiting to be paid to the charity"
        value={`${sats(data?.accrued_sats ?? 0)} sats`}
      />
    </div>
  );
}

/**
 * Most won, biggest first.
 *
 * `limit` exists for the lobby, where this is a glance beside a countdown
 * rather than the page itself. `you` marks the reader's own row in the same
 * green their bee wears everywhere else — the point of a leaderboard on the
 * screen where you are waiting is to find yourself on it.
 */
export function Standings({ data, failed, limit, you = "" }: {
  data: SettlementHistory | null;
  failed: boolean;
  limit?: number;
  you?: string;
}) {
  const rows = data?.leaderboard ?? [];
  const shown = limit ? rows.slice(0, limit) : rows;

  if (!shown.length) {
    return (
      <p className="text-sm text-ink/65">
        {failed ? "The hive did not answer." : "No match has been settled yet."}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-ink/10 rounded-xl bg-ink/4 text-left">
      {shown.map((row, i) => {
        const mine = !!you && row.npub === you;
        return (
          <li
            key={row.npub}
            className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
              mine ? "text-[var(--color-you-ink)]" : ""
            }`}
          >
            <span className="w-5 tabular-nums text-ink/65">{i + 1}</span>
            <span className="flex-1 truncate font-mono text-[12px] text-ink/80">
              {mine ? "you" : shortNpub(row.npub)}
            </span>
            <span className="text-ink/65">{row.wins}×</span>
            <span className="tabular-nums font-medium">{sats(row.sats)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function StandingsHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold text-ink/90">
      <Trophy size={15} /> {children}
    </h2>
  );
}
