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

import { LINK } from "../lib/ink";
import { ExternalLink } from "lucide-react";
import { sats } from "../lib/figures";
import {
  Money, Standings, StandingsHeading, useSettlements,
} from "../components/Standings";

export default function Ledger() {
  const { data, failed } = useSettlements(50);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Where the money went</h1>
      <Beneficiary name={data?.beneficiary ?? ""} website={data?.charity?.website ?? ""} />

      <div className="mt-6">
        <Money data={data} />
      </div>

      <div className="mt-9">
        <StandingsHeading>Most won</StandingsHeading>
      </div>
      <div className="mt-3">
        <Standings data={data} failed={failed} />
      </div>

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
