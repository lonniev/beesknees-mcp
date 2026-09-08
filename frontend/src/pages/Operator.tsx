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
 *
 * Nothing is estimated. A figure the service has not returned shows as a dash,
 * because this is the page somebody screenshots when asked where the money
 * went, and a plausible zero is worse than an obvious gap.
 */

import { useCallback, useEffect, useState } from "react";
import { HeartHandshake, Loader2, RefreshCw, Send, Trophy, Wallet } from "lucide-react";
import {
  payCharity,
  setCharity,
  settlementHistory,
  treasury,
  type SettlementHistory,
  type Treasury,
} from "../lib/mcp";
import { useOperator } from "../lib/useOperator";
import type { Session } from "../lib/session.ts";

const card = "rounded-xl border border-white/10 p-4";
const field =
  "w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm placeholder:text-white/25 focus:border-amber-400 focus:outline-none";

/** A dash, not a zero. See the note at the top of this file. */
function sats(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-US");
}

function shortNpub(npub: string): string {
  return npub.length > 16 ? `${npub.slice(0, 10)}…${npub.slice(-4)}` : npub;
}

export default function Operator({ session }: { session: Session }) {
  const { isOperator, canAct, known } = useOperator(session.npub, session.canSign);

  const [t, setT] = useState<Treasury | null>(null);
  const [history, setHistory] = useState<SettlementHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [dirty, setDirty] = useState(false);

  const load = useCallback(() => {
    treasury()
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
    settlementHistory(50).then(setHistory).catch(() => setHistory(null));
  }, [dirty]);

  useEffect(() => {
    if (isOperator) load();
  }, [isOperator, load]);

  if (!known) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-white/40">
        <Loader2 className="mx-auto mb-3 h-4 w-4 animate-spin" />
        Asking the hive who runs it…
      </div>
    );
  }

  if (!isOperator) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-white/60">
        <p>This page belongs to whoever runs the hive.</p>
        <p className="mt-2 text-xs text-white/35">
          Signing in as somebody else would not help — every button here is proven
          against the operator's key by the service itself.
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
        setMsg({ tone: "err", text: r.error ?? "That did not save." });
        return;
      }
      setDirty(false);
      setMsg({ tone: "ok", text: `Saved. The charity share goes to ${name.trim()}.` });
      load();
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
        setMsg({ tone: "err", text: r.error ?? "The payment was refused." });
        return;
      }
      setMsg({
        tone: "ok",
        text: r.matches
          ? `${sats(r.amount_sats)} sats sent to ${r.to} across ${r.matches} match${
              r.matches === 1 ? "" : "es"
            }${r.settled ? "." : " — the node reports it as still in flight."}`
          : "Nothing is owed to the charity.",
      });
      load();
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
        <h1 className="text-lg font-semibold">The hive's books</h1>
        <button onClick={load} title="Refresh" className="rounded-lg p-2 text-white/40 hover:bg-white/10">
          <RefreshCw size={15} />
        </button>
      </div>

      {!canAct && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          You are the operator, but this session signed in on a cached proof rather
          than a key. Sending money needs a signature — sign in with the operator's
          nsec to use the buttons here.
        </p>
      )}

      {/* ── The wallet ─────────────────────────────────────────────── */}
      <section className={card}>
        <div className="flex items-center gap-2">
          <Wallet size={15} className="text-white/50" />
          <h2 className="text-sm font-semibold text-white/80">The wallet</h2>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <Figure label="Can send" value={t?.node_reachable ? sats(t.sendable_sats) : null} />
          <Figure label="Owed to charity" value={t ? sats(t.owed_charity_sats) : null} />
          <Figure label="Owed to winners" value={t ? sats(t.owed_prizes_sats) : null} />
        </div>
        {t && !t.node_reachable && (
          <p className="mt-3 text-xs text-white/45">
            The node did not answer, so nothing is shown rather than a nought — and
            nothing can be sent. {t.note}
          </p>
        )}
        {t?.node_reachable && !t.covers_everything_owed && (
          <p className="mt-3 text-xs text-amber-300/80">
            The wallet holds less than is owed. A payment for part of it will still
            go through; the rest stays on the books until there are sats for it.
          </p>
        )}

        <button
          onClick={settle}
          disabled={!canSettle}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-you)] py-2.5 text-sm font-semibold text-black disabled:opacity-40"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {owedCharity > 0 ? `Pay ${sats(owedCharity)} sats now` : "Nothing owed"}
        </button>
        <p className="mt-2 text-[11px] leading-relaxed text-white/35">
          One Lightning payment covering every unpaid match at once. A single
          match's share can be smaller than the fee to route it, so the shares
          accrue and settle together — the books stay per match, the sats move once.
        </p>
      </section>

      {/* ── Who it goes to ─────────────────────────────────────────── */}
      <section className={card}>
        <div className="flex items-center gap-2">
          <HeartHandshake size={15} className="text-amber-300/80" />
          <h2 className="text-sm font-semibold text-white/80">The beneficiary</h2>
        </div>
        <p className="mt-1 text-xs text-white/40">
          Shown to every player, and where 80% of every pot is sent. Changing it
          never rewrites history — each settlement records the charity it actually
          paid at the time.
        </p>

        <div className="mt-4 space-y-3">
          <Labelled label="Name">
            <input className={field} value={name} placeholder="Pollinator Partnership"
              onChange={(e) => { setName(e.target.value); setDirty(true); }} />
          </Labelled>
          <Labelled label="Website">
            <input className={field} value={website} placeholder="https://pollinator.org"
              inputMode="url" autoCapitalize="none" spellCheck={false}
              onChange={(e) => { setWebsite(e.target.value); setDirty(true); }} />
          </Labelled>
          <Labelled label="Lightning address — where the sats actually go">
            <input className={field} value={address} placeholder="them@wallet.com"
              inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              onChange={(e) => { setAddress(e.target.value); setDirty(true); }} />
          </Labelled>
        </div>

        <button
          onClick={saveCharity}
          disabled={!canAct || busy || !name.trim()}
          className="mt-4 w-full rounded-lg border border-white/20 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </section>

      {msg && (
        <p className={`text-xs ${msg.tone === "ok" ? "text-emerald-300" : "text-red-300/90"}`}>
          {msg.text}
        </p>
      )}

      {/* ── What the winners got ───────────────────────────────────── */}
      <section className={card}>
        <div className="flex items-center gap-2">
          <Trophy size={15} className="text-[var(--color-wax)]" />
          <h2 className="text-sm font-semibold text-white/80">Winners</h2>
        </div>
        {/* "None" and "could not ask" are different answers and must not share
          * a sentence. A signed-out-ish session gets its reads refused, and
          * rendering that as an empty history is the same lie as showing a
          * zero for an unknown balance. */}
        {!history || history.success === false ? (
          <p className="mt-3 text-xs text-white/45">
            Could not read the settlements — this session cannot sign for them.
          </p>
        ) : !history.settlements?.length ? (
          <p className="mt-3 text-xs text-white/35">No match has settled yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-white/35">
                <tr>
                  <th className="py-1.5 pr-3 font-normal">Winner</th>
                  <th className="py-1.5 pr-3 text-right font-normal">Their share</th>
                  <th className="py-1.5 pr-3 text-right font-normal">To charity</th>
                  <th className="py-1.5 font-normal">Outcome</th>
                </tr>
              </thead>
              <tbody className="text-white/70">
                {history.settlements.map((s) => (
                  <tr key={s.match_id} className="border-t border-white/5">
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
      <div className="text-[11px] text-white/35">{label}</div>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-white/40">{label}</span>
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
  if (state === "donated") return <span className="text-amber-300/80">donated</span>;
  if (state === "kept") return <span className="text-emerald-300/80">kept</span>;
  return <span className="text-white/35">not yet chosen</span>;
}
