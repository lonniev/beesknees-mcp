/**
 * Who you are here, and what you have to spend.
 *
 * Two things a player needs off the board and cannot get anywhere else: the
 * identity the hive knows them by, and the balance that decides whether the
 * next press does anything. They sit on one page because they are one question
 * — "am I ready to play?" — asked twice.
 *
 * Every figure is the service's answer or a dash. A balance nobody has read yet
 * is unknown, and unknown is not zero: showing 0 sats to someone who has funds
 * would send them to buy credits they already own.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, RefreshCw, Zap } from "lucide-react";
import NostrProfilePanel from "../components/NostrProfilePanel.tsx";
import Winnings from "../components/Winnings.tsx";
import { checkBalance, checkPayment, purchaseCredits } from "../lib/mcp";
import type { Session } from "../lib/session.ts";

/** A dash, not a zero. See the note at the top of this file. */
function sats(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("en-US");
}

/** Top-up sizes, plainly labelled. The operator sets prices; this only offers
 *  round numbers to pay in, and never guesses what a round of play will cost. */
const TOP_UPS = [1_000, 5_000, 20_000];

export default function Profile({ session }: { session: Session }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [reachable, setReachable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [invoice, setInvoice] = useState<{ id: string; link: string; sats: number } | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    checkBalance()
      .then((r) => {
        if (r.error) {
          setReachable(false);
          return;
        }
        setReachable(true);
        setBalance(r.balance_api_sats ?? 0);
      })
      .catch(() => setReachable(false));
  }, []);

  useEffect(load, [load]);

  async function topUp(amount: number) {
    setBusy(true);
    setMsg("");
    try {
      const r = await purchaseCredits(amount);
      if (r.error || !r.invoice_id) {
        setMsg(r.error ?? "The service did not return an invoice. Try again.");
        return;
      }
      setInvoice({
        id: r.invoice_id,
        link: r.checkout_link ?? r.lightning_invoice ?? r.payment_request ?? "",
        sats: r.amount_sats ?? amount,
      });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!invoice) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await checkPayment(invoice.id);
      // Settled is the only state worth clearing the invoice for. Anything else
      // is "not yet", and saying so is more use than a spinner.
      if (r.status === "Settled") {
        setInvoice(null);
        setMsg(`Paid. ${sats(r.credits_granted ?? invoice.sats)} sats added.`);
        load();
      } else {
        setMsg(`Not paid yet — the invoice reads ${r.status ?? "unknown"}.`);
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!session.signedIn) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-white/60">
        <p className="mb-4">You are not signed in.</p>
        <Link
          to="/signin"
          state={{ from: "/profile" }}
          className="rounded-lg bg-[var(--color-you)] px-4 py-2 font-semibold text-black"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      {/* Identity first, and it is the panel's job now.
        *
        * The page used to open with its own avatar, npub and copy button, and
        * then the Nostr card below repeated all three — three avatars on one
        * screen, only one of which could actually change anything. The panel
        * shows the avatar you can pick, the name you can publish, and the npub
        * you can copy, so the page keeps only what the panel has no business
        * knowing: how this session is signing, and how to end it. */}
      <NostrProfilePanel npub={session.npub} />

      <section className="rounded-xl border border-white/10 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/60">Balance</span>
          <button onClick={load} title="Refresh" className="rounded-lg p-1.5 text-white/40 hover:bg-white/10">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">
            {sats(reachable ? balance : null)}
          </span>
          <span className="text-sm text-white/40">sats</span>
        </div>
        {!reachable && (
          <p className="mt-2 text-xs text-white/45">
            The hive did not answer. That is not the same as an empty balance, so nothing is
            shown rather than a nought.
          </p>
        )}

        {!invoice ? (
          <div className="mt-4 flex gap-2">
            {TOP_UPS.map((n) => (
              <button
                key={n}
                disabled={busy}
                onClick={() => topUp(n)}
                className="flex-1 rounded-lg border border-white/15 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
              >
                +{n.toLocaleString("en-US")}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <a
              href={invoice.link}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-you)] py-2.5 font-semibold text-black"
            >
              <Zap size={16} /> Pay {invoice.sats.toLocaleString("en-US")} sats
            </a>
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={confirm}
                className="flex-1 rounded-lg border border-white/15 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
              >
                I've paid — check
              </button>
              <button
                onClick={() => setInvoice(null)}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/50 hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {msg && <p className="mt-3 text-xs text-white/60">{msg}</p>}
      </section>

      <Winnings npub={session.npub} />

      <div className="flex items-center gap-3 px-1 pb-2">
        <span className="min-w-0 flex-1 text-[11px] leading-snug text-white/35">
          {session.canSign
            ? "Signing with a session key held in this tab."
            : "Signed in on a cached proof, which expires."}
        </span>
        <button
          onClick={session.signOut}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/55 hover:bg-white/10"
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  );
}
