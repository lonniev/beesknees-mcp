/**
 * The operator's console: who the money is for, and sending it.
 *
 * Three things live here because they are one question — "is the charity's
 * share going where it should, and has it gone yet?" — asked in three parts:
 * who the beneficiary is, what is owed, and the button that settles it.
 *
 * The route is only linked for the operator, but the gate is cosmetic: every
 * tool here is `restricted` and the runtime proves the caller before it runs.
 * A patron who types the URL gets a page whose buttons the service refuses.
 * Cosmetic cuts both ways, which this page learned the hard way: it also
 * insisted on a session key, the service never did, and the operator was shut
 * out of their own books for answering the DM challenge as instructed.
 *
 * Nothing is estimated. A figure the service has not returned shows as a dash,
 * because this is the page somebody screenshots when asked where the money
 * went, and a plausible zero is worse than an obvious gap.
 */

import { useCallback, useEffect, useState } from "react";
import { HeartHandshake, Loader2, Send, Trophy, Wallet } from "lucide-react";
import {
  payCharity,
  setCharity,
  settlementHistory,
  treasury,
  type SettlementHistory,
  type Treasury,
} from "../lib/mcp";
import { useOperator } from "../lib/useOperator";
import { RefreshButton, type Session } from "@tollbooth-dpyc/web/react";
import { useT } from "../i18n/index.ts";

const card = "rounded-xl border border-ink/14 p-4";
const field =
  "w-full rounded-lg border border-ink/25 bg-white/70 px-3 py-2 text-sm placeholder:text-ink/50 focus:border-amber-400 focus:outline-none";

/** A dash, not a zero. See the note at the top of this file. */
function sats(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-US");
}

function shortNpub(npub: string): string {
  return npub.length > 16 ? `${npub.slice(0, 10)}…${npub.slice(-4)}` : npub;
}

export default function Operator({ session }: { session: Session }) {
  const { isOperator, canAct, known } = useOperator(session.npub, session.signedIn);
  const tr = useT();

  const [t, setT] = useState<Treasury | null>(null);
  const [history, setHistory] = useState<SettlementHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [dirty, setDirty] = useState(false);

  // Returns both reads, so the refresh button spins until they land.
  const load = useCallback(() => {
    const books = treasury()
      .then((r) => {
        setT(r);
        // Never clobber what somebody is mid-way through typing.
        if (r?.charity && !dirty) {
          setName(r.charity.name ?? "");
          setWebsite(r.charity.website ?? "");
          setAddress(r.charity.lightning_address ?? "");
        }
      })
      .catch(() => setT(null));
    const ledger = settlementHistory(50).then(setHistory).catch(() => setHistory(null));
    return Promise.all([books, ledger]);
  }, [dirty]);

  useEffect(() => {
    if (isOperator) void load();
  }, [isOperator, load]);

  if (!known) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-ink/65">
        <Loader2 className="mx-auto mb-3 h-4 w-4 animate-spin" />
        {tr("operator.asking")}
      </div>
    );
  }

  if (!isOperator) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-ink/78">
        <p>{tr("operator.notYours")}</p>
        <p className="mt-2 text-xs text-ink/65">
          {tr("operator.notYoursNote")}
        </p>
      </div>
    );
  }

  async function saveCharity() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await setCharity(name.trim(), website.trim(), address.trim());
      if (!r.success) {
        setMsg({ tone: "err", text: r.error ?? tr("operator.didNotSave") });
        return;
      }
      setDirty(false);
      setMsg({ tone: "ok", text: tr("operator.saved", { name: name.trim() }) });
      void load();
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function settle() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await payCharity();
      if (!r.success) {
        setMsg({ tone: "err", text: r.error ?? tr("operator.refused") });
        return;
      }
      setMsg({
        tone: "ok",
        text: r.matches
          ? tr(r.settled ? "operator.sent" : "operator.inFlight", {
              count: r.matches, amount: sats(r.amount_sats), to: r.to ?? "",
            })
          : tr("operator.nothingOwed"),
      });
      void load();
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const owedCharity = t?.owed_charity_sats ?? 0;
  const canSettle = canAct && !busy && owedCharity > 0 && Boolean(t?.node_reachable);

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{tr("operator.title")}</h1>
        <RefreshButton
          onRefresh={load}
          label={tr("operator.refresh")}
          iconSize={15}
          classNames={{ root: "inline-flex items-center justify-center rounded-lg text-ink/65 hover:bg-ink/7 disabled:opacity-60" }}
        />
      </div>

      {/* ── The wallet ─────────────────────────────────────────────── */}
      <section className={card}>
        <div className="flex items-center gap-2">
          <Wallet size={15} className="text-ink/70" />
          <h2 className="text-sm font-semibold text-ink/90">{tr("operator.wallet")}</h2>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <Figure label={tr("operator.canSend")} value={t?.node_reachable ? sats(t.sendable_sats) : null} />
          <Figure label={tr("operator.owedCharity")} value={t ? sats(t.owed_charity_sats) : null} />
          <Figure label={tr("operator.owedWinners")} value={t ? sats(t.owed_prizes_sats) : null} />
        </div>
        {t && !t.node_reachable && (
          <p className="mt-3 text-xs text-ink/70">
            {tr("operator.nodeSilent")} {t.note}
          </p>
        )}
        {t?.node_reachable && !t.covers_everything_owed && (
          <p className="mt-3 text-xs text-[var(--color-wax-ink)]">
            {tr("operator.short")}
          </p>
        )}

        <button
          onClick={settle}
          disabled={!canSettle}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-you)] py-2.5 text-sm font-semibold text-black disabled:opacity-40"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {owedCharity > 0 ? tr("operator.pay", { n: sats(owedCharity) }) : tr("operator.noneOwed")}
        </button>
        <p className="mt-2 text-[11px] leading-relaxed text-ink/65">
          {tr("operator.payNote")}
        </p>
      </section>

      {/* ── Who it goes to ─────────────────────────────────────────── */}
      <section className={card}>
        <div className="flex items-center gap-2">
          <HeartHandshake size={15} className="text-[var(--color-wax-ink)]" />
          <h2 className="text-sm font-semibold text-ink/90">{tr("operator.beneficiary")}</h2>
        </div>
        <p className="mt-1 text-xs text-ink/65">
          {tr("operator.beneficiaryNote")}
        </p>

        <div className="mt-4 space-y-3">
          <Labelled label={tr("operator.name")}>
            <input className={field} value={name} placeholder="Pollinator Partnership"
              onChange={(e) => { setName(e.target.value); setDirty(true); }} />
          </Labelled>
          <Labelled label={tr("operator.website")}>
            <input className={field} value={website} placeholder="https://pollinator.org"
              inputMode="url" autoCapitalize="none" spellCheck={false}
              onChange={(e) => { setWebsite(e.target.value); setDirty(true); }} />
          </Labelled>
          <Labelled label={tr("operator.address")}>
            <input className={field} value={address} placeholder="them@wallet.com"
              inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              onChange={(e) => { setAddress(e.target.value); setDirty(true); }} />
          </Labelled>
        </div>

        <button
          onClick={saveCharity}
          disabled={!canAct || busy || !name.trim()}
          className="mt-4 w-full rounded-lg border border-ink/26 py-2 text-sm text-ink/90 hover:bg-ink/7 disabled:opacity-40"
        >
          {busy ? tr("operator.saving") : tr("operator.save")}
        </button>
      </section>

      {msg && (
        <p className={`text-xs ${msg.tone === "ok" ? "text-[var(--color-you-ink)]" : "text-[var(--color-hot-ink)]"}`}>
          {msg.text}
        </p>
      )}

      {/* ── What the winners got ───────────────────────────────────── */}
      <section className={card}>
        <div className="flex items-center gap-2">
          <Trophy size={15} className="text-[var(--color-wax-ink)]" />
          <h2 className="text-sm font-semibold text-ink/90">{tr("operator.winners")}</h2>
        </div>
        {/* "None" and "could not ask" are different answers and must not share
          * a sentence. A signed-out-ish session gets its reads refused, and
          * rendering that as an empty history is the same lie as showing a
          * zero for an unknown balance. */}
        {!history || history.success === false ? (
          <p className="mt-3 text-xs text-ink/70">
            {tr("operator.cannotRead")}
          </p>
        ) : !history.settlements?.length ? (
          <p className="mt-3 text-xs text-ink/65">{tr("operator.noneSettled")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-ink/65">
                <tr>
                  <th className="py-1.5 pr-3 font-normal">{tr("operator.col.winner")}</th>
                  <th className="py-1.5 pr-3 text-right font-normal">{tr("operator.col.share")}</th>
                  <th className="py-1.5 pr-3 text-right font-normal">{tr("operator.col.charity")}</th>
                  <th className="py-1.5 font-normal">{tr("operator.col.outcome")}</th>
                </tr>
              </thead>
              <tbody className="text-ink/80">
                {history.settlements.map((s) => (
                  <tr key={s.match_id} className="border-t border-ink/10">
                    <td className="py-1.5 pr-3 font-mono text-[11px]">
                      {s.winner_npub ? shortNpub(s.winner_npub) : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{sats(s.winner_sats)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{sats(s.charity_sats)}</td>
                    <td className="py-1.5">
                      <Outcome state={s.prize_state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value ?? "—"}</div>
      <div className="text-[11px] text-ink/65">{label}</div>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink/65">{label}</span>
      {children}
    </label>
  );
}

/**
 * What became of a winner's share.
 *
 * `unclaimed` is not a failure and must not read as one: it means that winner
 * has never said what they want, and the share is held rather than lost.
 */
function Outcome({ state }: { state: string }) {
  const tr = useT();
  const to = "text-[var(--color-wax-ink)]";
  if (state === "donated") return <span className={to}>{tr("operator.outcome.donated")}</span>;
  // A share no person took. Named for where it went, not for what the
  // winner failed to do — the money is the charity's either way.
  if (state === "forfeited") return <span className={to}>{tr("operator.outcome.forfeited")}</span>;
  if (state === "kept") return <span className="text-[var(--color-you-ink)]">{tr("operator.outcome.kept")}</span>;
  return <span className="text-ink/65">{tr("operator.outcome.open")}</span>;
}
