/**
 * The wait before a round, made legible.
 *
 * A patron who has paid for a bee and is looking at a still board needs one
 * question answered: how many more of us, and how long. A spinner answers
 * neither. The quorum is the honest number — a match starts when any single
 * hive reaches it, not when the whole field is full — so that is what counts
 * down, and the hive nearest it is the one shown filling.
 */

import { useEffect, useState } from "react";
import { Check, Share2, Users, Zap } from "lucide-react";
import QuoteScroller from "./QuoteScroller.tsx";
import { checkNow, joinMatch } from "../lib/mcp";
import type { LiveState } from "../lib/useLiveMatch.ts";
import type { Session } from "../lib/session.ts";

/** Mirrors board_store.QUORUM. A match starts when one hive holds this many. */
const QUORUM = 8;

export default function Lobby({
  live,
  session,
  onJoined,
}: {
  live: LiveState;
  session: Session;
  onJoined: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [waited, setWaited] = useState(0);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setWaited((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Somebody has to ask.
  //
  // `advance()` runs on a join and on every motion — and a full lobby makes
  // neither. Once the last seat is taken and the grace has run out, a room of
  // people polling `match_state` would have waited for a cron that may be
  // half an hour away. `check_now` carries no authority: it can only cause work
  // that was already due.
  useEffect(() => {
    const t = setInterval(() => {
      checkNow().catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const mine = live.bees.find((b) => b.npub === session.npub) ?? null;

  // Per hive, because the quorum is per hive. The fullest one is the one that
  // will actually start the match, so it is the one worth watching.
  const perHive = Array.from({ length: live.hives }, (_, h) =>
    live.bees.filter((b) => b.hive === h).length,
  );
  const fullest = Math.max(0, ...perHive);
  const needed = Math.max(0, QUORUM - fullest);

  /**
   * Hand the round to somebody else.
   *
   * The quorum is the whole problem a lobby has: eight bees, and a patron who
   * has paid can do nothing about seven of them. Sim bees will fill the gap
   * after a minute, but a friend is a better game than a bot — so the one action
   * available while waiting is the one that might actually change the wait.
   *
   * The native share sheet where there is one, the clipboard where there is not.
   */
  async function share() {
    const url = `${window.location.origin}/play`;
    const text =
      "I'm one bee short of a race in The Bee's Knees — come play, " +
      "80% of the pot goes to the pollinators.";
    try {
      if (navigator.share) {
        await navigator.share({ title: "The Bee's Knees", text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setShared(true);
        window.setTimeout(() => setShared(false), 2500);
      }
    } catch {
      // A cancelled share sheet is not a failure and must not look like one.
    }
  }

  async function join() {
    setBusy(true);
    setError("");
    try {
      const r = await joinMatch(session.npub.slice(5, 13));
      if (r.error) setError(String(r.error));
      else onJoined();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10 text-center">
      <div>
        <div className="text-sm text-white/50">The hive is filling</div>
        <div className="mt-2 flex items-baseline justify-center gap-2">
          <span className="text-5xl font-semibold tabular-nums">{fullest}</span>
          <span className="text-2xl text-white/40">/ {QUORUM}</span>
        </div>
        <div className="mt-1 text-sm text-white/60">
          {needed === 0
            ? "Quorum reached — the round is about to start."
            : `${needed} more ${needed === 1 ? "bee" : "bees"} and the race begins.`}
        </div>
      </div>

      {/* Every hive, so the shape of the room is visible rather than one number
       * — and the bees themselves rather than a bar chart of them.
       *
       * A seated bee THRUMS: it shivers on its perch the way a real one does
       * warming the cluster, each on its own offset so eight never buzz in
       * unison and turn back into a progress bar. An empty seat is a dim comb
       * cell waiting for somebody. */}
      <div className="flex justify-center gap-2">
        {perHive.map((n, h) => (
          <div key={h} className="flex flex-col items-center gap-1">
            <div className="flex h-28 w-9 flex-col-reverse items-center gap-[1px] rounded-md bg-white/5 p-[3px]">
              {Array.from({ length: QUORUM }, (_, i) =>
                i < n ? (
                  <span
                    key={i}
                    className="bk-thrum flex-1 text-[13px] leading-none"
                    // Its own rhythm. Shared, they read as one machine.
                    style={{ animationDelay: `${((i * 137 + h * 61) % 900) / 1000}s` }}
                    title={mine?.hive === h ? "your hive" : undefined}
                  >
                    🐝
                  </span>
                ) : (
                  <span key={i} className="flex-1 text-[13px] leading-none opacity-15">
                    ⬡
                  </span>
                ),
              )}
            </div>
            <span
              className={`text-[10px] ${
                mine?.hive === h ? "text-[var(--color-you)]" : "text-white/35"
              }`}
            >
              {n}
            </span>
          </div>
        ))}
      </div>

      {mine ? (
        <div className="text-sm text-white/55">
          <Users size={14} className="mr-1 inline" />
          Your bee has a seat. Waiting {Math.floor(waited / 60)}:
          {String(waited % 60).padStart(2, "0")}
        </div>
      ) : (
        <button
          onClick={join}
          disabled={busy}
          className="mx-auto flex items-center gap-2 rounded-xl bg-[var(--color-you)] px-6 py-3 font-semibold text-black disabled:opacity-40"
        >
          <Zap size={16} /> {busy ? "Buying a bee…" : "Buy a bee and take a seat"}
        </button>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* The one thing a waiting player can do about the wait. A bot will fill
        * the seat eventually; a friend is a better game. */}
      <button
        onClick={share}
        className="mx-auto flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/75 hover:bg-white/5"
      >
        {shared ? <Check size={15} className="text-[var(--color-you)]" /> : <Share2 size={15} />}
        {shared ? "Link copied — send it to a friend" : "Share it — bring a friend to the race"}
      </button>

      {/* Bee poetry while the hive fills. A lobby is a wait somebody else
        * controls, and a bare number counting to eight is a frozen "Loading…"
        * wearing a different hat. This game also asks people to spend money on
        * pollinators, and this minute is the one they are certain to read. */}
      <QuoteScroller className="pt-1" />

      <p className="text-xs leading-relaxed text-white/35">
        Nothing is spent while you wait — a seat costs a fare, and the motions cost
        theirs only once the race is on. Every hive races its own board; the first
        bee to any queen ends the round.
      </p>
    </div>
  );
}
