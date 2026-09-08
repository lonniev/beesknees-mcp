/**
 * Where the money went, and who has won the most of it.
 *
 * Every figure here is read from `settlement_history`, which is free precisely
 * so this page can exist: a claim about where donations went that costs money
 * to check is not a claim anybody should believe.
 *
 * Nothing is estimated and nothing is filled in. Before any match has settled
 * these read zero, which is the truth, and a plausible-looking number would be
 * worse than an empty one — it is the figure a screenshot would quote back.
 */

import { useEffect, useState } from "react";
import { LINK } from "../lib/ink";
import { HeartHandshake, Trophy, Coins, ExternalLink } from "lucide-react";
import { settlementHistory, type SettlementHistory } from "../lib/mcp";

function sats(n: number): string {
  return n.toLocaleString("en-US");
}

function shortNpub(npub: string): string {
  return npub.length > 16 ? `${npub.slice(0, 10)}…${npub.slice(-4)}` : npub;
}

export default function Ledger() {
  const [data, setData] = useState<SettlementHistory | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    settlementHistory(50)
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const raised = (data?.settlements ?? []).reduce((a, s) => a + s.pot_sats, 0);
  const charity = data?.accrued_sats ?? 0;

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Where the money went</h1>
      <Beneficiary name={data?.beneficiary ?? ""} website={data?.charity?.website ?? ""} />

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Stat icon={<Coins size={16} />} label="Raised across all matches" value={`${sats(raised)} sats`} />
        <Stat
          icon={<HeartHandshake size={16} />}
          label="Owed to the charity"
          value={`${sats(charity)} sats`}
        />
      </div>

      <h2 className="mt-9 flex items-center gap-2 text-sm font-semibold text-ink/90">
        <Trophy size={15} /> Most won
      </h2>
      {data?.leaderboard?.length ? (
        <ul className="mt-3 divide-y divide-ink/10 rounded-xl bg-ink/4">
          {data.leaderboard.map((row, i) => (
            <li key={row.npub} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-5 tabular-nums text-ink/65">{i + 1}</span>
              <span className="flex-1 truncate font-mono text-[12px] text-ink/80">
                {shortNpub(row.npub)}
              </span>
              <span className="text-ink/65">{row.wins}×</span>
              <span className="tabular-nums font-medium">{sats(row.sats)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink/65">
          {failed ? "The hive did not answer." : "No match has been settled yet."}
        </p>
      )}

      <h2 className="mt-9 text-sm font-semibold text-ink/90">Every settled match</h2>
      {data?.settlements?.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-ink/65">
              <tr>
                <th className="py-2 pr-4 font-normal">Match</th>
                <th className="py-2 pr-4 text-right font-normal">Raised</th>
                <th className="py-2 pr-4 text-right font-normal">To charity</th>
                <th className="py-2 pr-4 text-right font-normal">To winner</th>
                <th className="py-2 font-normal">Settled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {data.settlements.map((s) => (
                <tr key={s.match_id}>
                  <td className="py-2 pr-4 font-mono text-[11px] text-ink/70">{s.match_id}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{sats(s.pot_sats)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-[var(--color-wax-ink)]">
                    {sats(s.charity_sats)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{sats(s.winner_sats)}</td>
                  <td className="py-2 text-ink/65">{s.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink/65">
          {failed ? "The hive did not answer." : "No match has been settled yet."}
        </p>
      )}

      <p className="mt-8 text-xs leading-relaxed text-ink/65">
        A match's share accrues here and is paid to the charity in batches — a single round's share
        is small enough that a network fee could exceed it, so settling each one would destroy the
        thing it is meant to deliver. Each payment is recorded with its transaction id, which is
        what makes this checkable by somebody who trusts nothing else on this page.
      </p>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
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
 * Who the charity share goes to, and somewhere to go and check them.
 *
 * The link is the point. A page that names a beneficiary and gives you no way
 * to look them up is asking to be taken on trust, which is the one thing this
 * page exists not to do.
 */
function Beneficiary({ name, website }: { name: string; website: string }) {
  // A held line rather than a guess while it loads: the name IS the claim.
  if (!name) return <p className="mt-1 text-sm text-ink/70">&nbsp;</p>;

  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink/70">
      <span>
        Beneficiary: <span className="text-ink/85">{name}</span>
      </span>
      {website && (
        <a
          href={website}
          target="_blank"
          rel="noreferrer noopener"
          className={LINK}
        >
          {website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          <ExternalLink size={12} />
        </a>
      )}
    </p>
  );
}
