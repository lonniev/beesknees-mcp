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
import { Link, useNavigate } from "react-router-dom";
import { Bot, Zap } from "lucide-react";
import LiveBoard from "../LiveBoard.tsx";
import SoloBoard from "../SoloBoard.tsx";
import FirstTime from "../components/FirstTime.tsx";
import { PageBees } from "../components/Meadow.tsx";
import Meadowscape from "../components/Meadowscape.tsx";
import { checkBalance } from "../lib/mcp";
import { useSession } from "../lib/session.ts";

type Mode = "choosing" | "solo" | "live";

export default function Play() {
  const session = useSession();
  const [balance, setBalance] = useState<number | null>(null);
  const [known, setKnown] = useState(false);
  const [mode, setMode] = useState<Mode>("choosing");
  const [explaining, setExplaining] = useState(false);
  const nav = useNavigate();

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

  // Boards first, and they get no scenery of their own: each runs the same
  // foragers INSIDE its playfield, where the hives paint over them so a loose
  // bee can never be taken for a racer. A layer behind the board would put one
  // beside it with no such guarantee.
  if (mode === "solo") return <SoloBoard />;
  if (mode === "live") return <LiveBoard session={session} />;

  const canPlayLive = session.signedIn && (balance === null || balance > 0);
  /**
   * A stranger is not turned away at this door; they are told what is behind it.
   *
   * The card was simply disabled, with "Sign in with an npub to buy a bee" — a
   * word the visitor has not met, refusing them something they have not been
   * told the shape of. It is also the FIRST wall: the lobby's Fund a Bee
   * button, where the same explanation belongs, sits behind this one, and a
   * signed-out visitor never reaches it.
   *
   * An empty balance is a different case and keeps its plain refusal. That
   * person already knows what a bee costs and what a wallet is.
   */
  const needsOnboarding = !session.signedIn;
  const why = session.signedIn && balance === 0
    ? "Your balance is empty — every motion is a fare."
    : "";

  return (
    <>
      {/* Only while this is a choice. `App` leaves the whole `/play` route
        * alone, so this is the one mount and the bees cannot double up. */}
      <Meadowscape />
      <PageBees />

      {explaining && (
        <FirstTime
          onGenerate={() => nav("/signin", { state: { from: "/play", generate: true } })}
          onExisting={() => nav("/signin", { state: { from: "/play" } })}
          onClose={() => setExplaining(false)}
        />
      )}

      <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Play</h1>
          {/* The code owner's words. It opened with "The same board either
            * way", which compares two things the reader has not been told
            * about yet — a sentence for somebody who already knows the game.
            * This one starts by saying what the site is and then names the two
            * doors, which is the order a first-time visitor needs. */}
          <p className="mt-1 text-sm text-ink/70">
            Welcome to The Bee's Knees game. You can choose to play a Practice round or
            help raise donations with a Real round. During Practice play there are no
            fees and the bees are agentic simulator bees.
          </p>
        </div>

        <button
          onClick={() => setMode("solo")}
          className="flex items-start gap-3 rounded-xl border border-ink/14 p-4 text-left hover:bg-ink/4"
        >
          <Bot size={20} className="mt-0.5 shrink-0 text-ink/70" />
          <span>
            <span className="font-semibold">Practice</span>
            {/* Says what the reader GETS, not what the board contains. The
              * count of bots is a fact about the simulation and meant nothing
              * to somebody deciding whether to tap it; "no sats" and "nothing
              * at stake" both name an absence, which is a poor pitch for the
              * door a first-time visitor should actually go through. */}
            <span className="block text-sm text-ink/70">
              Watch and learn how to play without having to purchase anything. Come
              practice anytime.
            </span>
          </span>
        </button>

        <button
          onClick={() => {
            if (needsOnboarding) setExplaining(true);
            else if (canPlayLive) setMode("live");
          }}
          disabled={!canPlayLive && !needsOnboarding}
          // The SAME border as Practice. A green rim on this one and a grey rim
          // on the other read as a recommendation, and these are two doors
          // rather than a default and an alternative. What still separates them
          // is the icon's colour and, when the round is out of reach, the
          // dimming — a state, which is a fair thing for a border not to carry.
          className={`flex items-start gap-3 rounded-xl border border-ink/14 p-4 text-left ${
            canPlayLive || needsOnboarding ? "hover:bg-ink/4" : "opacity-55"
          }`}
        >
          <Zap size={20} className="mt-0.5 shrink-0 text-[var(--color-you-ink)]" />
          <span>
            <span className="font-semibold">The real game</span>
            <span className="block text-sm text-ink/70">
              Real bees, a real pot, and 80% of it to the pollinators.
            </span>
            {needsOnboarding && (
              <span className="mt-2 block text-sm text-[var(--color-wax-ink)]">
                New to this? Press here and I will explain what you need.
              </span>
            )}
            {why && known && (
              <span className="mt-2 block text-sm text-[var(--color-wax-ink)]">{why}</span>
            )}
          </span>
        </button>

        {!session.signedIn ? (
          <Link to="/signin" state={{ from: "/play" }} className="text-center text-sm underline text-ink/78">
            I already have an npub — sign in
          </Link>
        ) : balance === 0 ? (
          <Link to="/profile" className="text-center text-sm underline text-ink/78">
            Add sats
          </Link>
        ) : null}
      </div>
    </>
  );
}
