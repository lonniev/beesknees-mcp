/**
 * Who plays which game.
 *
 * Solo is not a demo and not a lesser mode: it is the same board, the same
 * rules and the same interface with bots in the other seats, and it is how
 * anybody sees the game before deciding to pay for a bee. So it is what a guest
 * gets, and what a signed-in patron with an empty balance gets — being skint is
 * not a reason to be shown a locked door.
 *
 * The live game needs two things and says which one is missing:
 *
 *   an npub   — because a bee belongs to somebody, and the prize has to be
 *               payable to a key rather than to a browser tab;
 *   sats      — because every motion is a fare, and a bee that cannot move is
 *               worse than no bee at all.
 *
 * Somebody who has both can still choose solo. Nobody is ever pushed into the
 * live game by the interface.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Zap } from "lucide-react";
import LiveBoard from "../LiveBoard.tsx";
import SoloBoard from "../SoloBoard.tsx";
import { checkBalance } from "../lib/mcp";
import { useSession } from "../lib/session.ts";

type Mode = "choosing" | "solo" | "live";

export default function Play() {
  const session = useSession();
  const [balance, setBalance] = useState<number | null>(null);
  const [known, setKnown] = useState(false);
  const [mode, setMode] = useState<Mode>("choosing");

  const load = useCallback(() => {
    if (!session.signedIn) {
      setKnown(true);
      return;
    }
    checkBalance()
      .then((r) => {
        setBalance(r.error ? null : (r.balance_api_sats ?? 0));
        setKnown(true);
      })
      // A hive that did not answer is not an empty wallet. Unknown stays
      // unknown, and the live door stays offered rather than quietly removed.
      .catch(() => setKnown(true));
  }, [session.signedIn]);

  useEffect(load, [load]);

  if (mode === "solo") return <SoloBoard />;
  if (mode === "live") return <LiveBoard session={session} />;

  const canPlayLive = session.signedIn && (balance === null || balance > 0);
  const why = !session.signedIn
    ? "Sign in with an npub to buy a bee."
    : balance === 0
      ? "Your balance is empty — every motion is a fare."
      : "";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Play</h1>
        <p className="mt-1 text-sm text-white/50">
          The same board either way. The difference is whether the other eleven bees
          belong to people, and whether the pot is real.
        </p>
      </div>

      <button
        onClick={() => setMode("solo")}
        className="flex items-start gap-3 rounded-xl border border-white/10 p-4 text-left hover:bg-white/5"
      >
        <Bot size={20} className="mt-0.5 shrink-0 text-white/50" />
        <span>
          <span className="font-semibold">Practice</span>
          <span className="block text-sm text-white/50">
            Eleven bots, no sats, nothing at stake. Free, and always available.
          </span>
        </span>
      </button>

      <button
        onClick={() => canPlayLive && setMode("live")}
        disabled={!canPlayLive}
        className={`flex items-start gap-3 rounded-xl border p-4 text-left ${
          canPlayLive
            ? "border-[var(--color-you)]/40 hover:bg-white/5"
            : "border-white/10 opacity-55"
        }`}
      >
        <Zap size={20} className="mt-0.5 shrink-0 text-[var(--color-you)]" />
        <span>
          <span className="font-semibold">The real game</span>
          <span className="block text-sm text-white/50">
            Real bees, a real pot, and 80% of it to the pollinators.
          </span>
          {!canPlayLive && known && (
            <span className="mt-2 block text-sm text-[var(--color-wax)]">{why}</span>
          )}
        </span>
      </button>

      {!session.signedIn ? (
        <Link to="/signin" state={{ from: "/play" }} className="text-center text-sm underline text-white/60">
          Sign in
        </Link>
      ) : balance === 0 ? (
        <Link to="/profile" className="text-center text-sm underline text-white/60">
          Add sats
        </Link>
      ) : null}
    </div>
  );
}
