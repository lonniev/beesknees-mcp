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

import { useState } from "react";
import { LINK } from "../lib/ink";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { sats } from "../lib/figures";
import { useBtcUsd, usd } from "../lib/btcUsd";
import type { LedgerSort } from "../lib/mcp";
import {
  Money, Standings, StandingsHeading, useSettlements,
} from "../components/Standings";

const PAGE = 25;

/** The columns, in the order they are read, with the key the server sorts by. */
const COLUMNS: { key: LedgerSort; label: string; right?: boolean }[] = [
  { key: "match", label: "Match" },
  { key: "raised", label: "Raised", right: true },
  { key: "charity", label: "To charity", right: true },
  { key: "winner", label: "To winner", right: true },
  { key: "settled", label: "Settled" },
];

/**
 * A settlement's moment, to the minute.
 *
 * The date alone put every match on a day and no closer, which is no use on a
 * page whose whole job is to be checkable against somebody else's records —
 * several rounds settle in an hour. Rendered in the READER's timezone, because
 * the question a reader has is when it happened to them.
 */
function when(iso: string | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(t.getTime())) return iso.slice(0, 16).replace("T", " ");
  return t.toLocaleString(undefined, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function Ledger() {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<LedgerSort>("settled");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const { data, failed } = useSettlements(page, PAGE, sort, dir);
  const rate = useBtcUsd();

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  /** A header press sorts by that column, or turns the sort it already has. */
  function sortBy(key: LedgerSort) {
    if (key === sort) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(key);
      // A fresh column starts at its most useful end: newest, biggest, and A
      // first for the one column that is a name.
      setDir(key === "match" ? "asc" : "desc");
    }
    setPage(0); // page 3 of the old order is nowhere in the new one
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Funds Raised and Charity Payouts
      </h1>
      <Beneficiary name={data?.beneficiary ?? ""} website={data?.charity?.website ?? ""} />

      <div className="mt-6">
        <Money data={data} btcUsd={rate} />
      </div>
      <Quote rate={rate} />

      <div className="mt-9">
        <StandingsHeading>Most won</StandingsHeading>
      </div>
      <div className="mt-3">
        <Standings data={data} failed={failed} />
      </div>

      <div className="mt-9 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold text-ink/90">Every settled match</h2>
        {total > 0 && (
          <span className="text-xs text-ink/65">
            {sats(total)} settled · page {page + 1} of {pages}
          </span>
        )}
      </div>

      {data?.settlements?.length ? (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-ink/65">
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={`py-2 font-normal ${c.right ? "text-right" : ""} ${
                        c.key === "settled" ? "" : "pr-4"
                      }`}
                    >
                      {/* The whole heading is the control. A tiny arrow beside a
                        * word is a target nobody can hit on a phone. */}
                      <button
                        onClick={() => sortBy(c.key)}
                        aria-sort={sort === c.key ? (dir === "asc" ? "ascending" : "descending") : "none"}
                        className={`inline-flex items-center gap-1 rounded px-1 -mx-1 hover:text-ink/90 ${
                          sort === c.key ? "text-ink/90" : ""
                        }`}
                      >
                        {c.label}
                        {sort === c.key &&
                          (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10">
                {data.settlements.map((s) => (
                  <tr key={s.match_id}>
                    <td className="py-2 pr-4 font-mono text-[11px] text-ink/70">{s.match_id}</td>
                    <Sats n={s.pot_sats} rate={rate} />
                    <Sats n={s.charity_sats} rate={rate} tone="text-[var(--color-wax-ink)]" />
                    <Sats n={s.winner_sats} rate={rate} />
                    <td className="py-2 whitespace-nowrap text-ink/65">{when(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between gap-3 text-[13px]">
              <button
                onClick={() => setPage((n) => Math.max(0, n - 1))}
                disabled={page === 0}
                className="rounded-lg bg-ink/6 px-3 py-1.5 disabled:opacity-40"
              >
                Newer
              </button>
              <span className="text-ink/65">
                {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {sats(total)}
              </span>
              <button
                onClick={() => setPage((n) => Math.min(pages - 1, n + 1))}
                disabled={page >= pages - 1}
                className="rounded-lg bg-ink/6 px-3 py-1.5 disabled:opacity-40"
              >
                Older
              </button>
            </div>
          )}
        </>
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
 * A sat figure with its dollars underneath.
 *
 * Sats on top because sats are what moved; the conversion is a second line in
 * a quieter ink, and it is simply absent when no rate came back. A ledger may
 * not carry an exchange rate it could not fetch.
 */
function Sats({ n, rate, tone = "" }: { n: number; rate: number | null; tone?: string }) {
  return (
    <td className={`py-2 pr-4 text-right tabular-nums ${tone}`}>
      {sats(n)}
      {usd(n, rate) && <span className="block text-[11px] text-ink/55">{usd(n, rate)}</span>}
    </td>
  );
}

/**
 * The rate the dollars on this page were figured at.
 *
 * Said out loud, because every dollar figure here is derived from it and a
 * reader checking this against a bank statement needs to know what it was
 * converted at. Nothing at all when the quote did not arrive — the sats stand
 * on their own, and a page about charity money does not guess.
 */
function Quote({ rate }: { rate: number | null }) {
  if (rate === null) return null;
  return (
    <p className="mt-2 text-xs text-ink/60">
      Dollar figures at ${rate.toLocaleString("en-US", { maximumFractionDigits: 0 })} per bitcoin,
      quoted just now. Sats are what actually moved.
    </p>
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
