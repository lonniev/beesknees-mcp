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
import {
  NostrProfilePanel, SessionKeyClaim, TimezonePicker, UsageSummary, useTopUp, type Session,
  type UsageFigure, type UsageSummaryClassNames,
} from "@tollbooth-dpyc/web/react";
import { checkBalance } from "@tollbooth-dpyc/web";
import Winnings from "../components/Winnings.tsx";

/** A dash, not a zero. See the note at the top of this file. */
function sats(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("en-US");
}

/** Top-up sizes, plainly labelled. The operator sets prices; this only offers
 *  round numbers to pay in, and never guesses what a round of play will cost. */
const TOP_UPS = [1_000, 5_000, 20_000];

/** The month only: the balance has its own card above, and lifetime totals
 *  under a "Last 30 days" heading would read as the month's. */
const MONTH: readonly UsageFigure[] = ["spent", "calls", "credited"];

/** The page's card, chip and ink ladder — the package draws, the hive dresses. */
const MONTH_LOOK: UsageSummaryClassNames = {
  root: "rounded-xl border border-ink/14 p-4",
  header: "flex items-center justify-between",
  heading: "text-sm text-ink/78",
  chip: "rounded-lg border border-ink/20 px-2.5 py-1 text-xs text-ink/70 hover:bg-ink/7 disabled:opacity-40",
  figures: "mt-3 grid grid-cols-3 gap-2",
  figure: "rounded-lg bg-ink/4 px-2 py-2",
  value: "text-lg font-semibold tabular-nums",
  label: "text-[11px] text-ink/65",
  subheading: "mt-4 text-xs font-semibold text-ink/78",
  list: "mt-1 divide-y divide-ink/10 text-sm",
  row: "flex items-baseline gap-2 py-1.5",
  loading: "mt-2 text-xs text-ink/65",
  error: "mt-2 text-xs text-ink/70",
  empty: "mt-3 text-xs text-ink/65",
};

/** A tool's name without the service's prefix: "fly", not "beesknees_fly". */
function toolName(tool: string): string {
  return tool.replace(/^beesknees_/, "").replace(/_/g, " ");
}

export default function Profile({ session }: { session: Session }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [reachable, setReachable] = useState(true);
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

  // purchase_credits → invoice → check_payment is the package's; an open
  // invoice is checked on its own until it settles, and "I've paid" still works.
  const { state, create, check, cancel } = useTopUp({ onSettled: load });
  const busy = state.phase === "creating" || (state.phase === "awaiting" && state.checking);
  const invoice = state.phase === "awaiting" ? state.invoice : null;
  // Settled is the only state worth clearing the invoice for. Anything else
  // is "not yet", and saying so is more use than a spinner.
  const msg =
    state.phase === "settled"
      ? `Paid. ${sats(state.credited)} sats added.`
      : state.phase === "failed"
        ? state.message
        : state.phase === "awaiting" && state.status
          ? `Not paid yet — the invoice reads ${state.status}.`
          : state.phase === "idle"
            ? (state.message ?? "")
            : "";

  if (!session.signedIn) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-ink/78">
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
      {/* Browser-held session nsec only — silent when NIP-07 / courier.
          Keyed by npub so a revealed key never carries across a sign-in. */}
      <SessionKeyClaim key={session.npub} npub={session.npub} />

      <section className="rounded-xl border border-ink/14 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink/78">Balance</span>
          <button onClick={load} title="Refresh" className="rounded-lg p-1.5 text-ink/65 hover:bg-ink/7">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">
            {sats(reachable ? balance : null)}
          </span>
          <span className="text-sm text-ink/65">sats</span>
        </div>
        {!reachable && (
          <p className="mt-2 text-xs text-ink/70">
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
                onClick={() => create(n)}
                className="flex-1 rounded-lg border border-ink/20 py-2 text-sm hover:bg-ink/7 disabled:opacity-40"
              >
                +{n.toLocaleString("en-US")}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <a
              href={invoice.checkoutLink ?? (invoice.bolt11 ? `lightning:${invoice.bolt11}` : "#")}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-you)] py-2.5 font-semibold text-black"
            >
              <Zap size={16} /> Pay {invoice.sats.toLocaleString("en-US")} sats
            </a>
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={check}
                className="flex-1 rounded-lg border border-ink/20 py-2 text-sm hover:bg-ink/7 disabled:opacity-40"
              >
                I've paid — check
              </button>
              <button
                onClick={cancel}
                className="rounded-lg border border-ink/20 px-3 py-2 text-sm text-ink/70 hover:bg-ink/7"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {msg && <p className="mt-3 text-xs text-ink/78">{msg}</p>}
      </section>

      <UsageSummary
        figures={MONTH}
        labels={{ spent: "Spent", calls: "Moves & calls", credited: "Bought" }}
        classNames={MONTH_LOOK}
        renderRow={(t) => (
          <>
            <span className="min-w-0 flex-1 truncate">{toolName(t.tool)}</span>
            <span className="text-xs text-ink/65 tabular-nums">
              {t.calls.toLocaleString("en-US")} {t.calls === 1 ? "call" : "calls"}
            </span>
            <span className="w-20 text-right tabular-nums">{sats(t.sats)} sats</span>
          </>
        )}
      />

      <Winnings npub={session.npub} />

      <section className="rounded-xl border border-ink/14 p-4">
        <TimezonePicker
          label="Time zone"
          classNames={{
            root: "flex flex-col gap-1.5",
            label: "text-sm text-ink/78",
            select:
              "w-full rounded-lg border border-ink/25 bg-white/70 px-3 py-2 text-sm focus:border-[var(--color-you-ink)] focus:outline-none",
          }}
        />
        <p className="mt-2 text-xs text-ink/65">
          The times on the Ledger read in this zone.
        </p>
      </section>

      <div className="flex items-center gap-3 px-1 pb-2">
        <span className="min-w-0 flex-1 text-[11px] leading-snug text-ink/65">
          {session.canSign
            ? "Signing with a session key held in this tab."
            : "Signed in on a cached proof, which expires."}
        </span>
        <button
          onClick={session.signOut}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink/20 px-3 py-1.5 text-xs text-ink/70 hover:bg-ink/7"
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  );
}
