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
import { Users, Zap } from "lucide-react";
import { joinMatch } from "../lib/mcp";
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

  useEffect(() => {
    const t = setInterval(() => setWaited((s) => s + 1), 1000);
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

      {/* Every hive, so the shape of the room is visible rather than one number.
       * A patron can see their own hive filling and whether another is ahead. */}
      <div className="flex justify-center gap-2">
        {perHive.map((n, h) => (
          <div key={h} className="flex flex-col items-center gap-1">
            <div className="flex h-24 w-8 flex-col-reverse gap-[2px] rounded-md bg-white/5 p-[3px]">
              {Array.from({ length: QUORUM }, (_, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-[2px] ${
                    i < n
                      ? mine?.hive === h
                        ? "bg-[var(--color-you)]"
                        : "bg-[var(--color-wax)]/70"
                      : "bg-white/10"
                  }`}
                />
              ))}
            </div>
            <span className="text-[10px] text-white/35">{n}</span>
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

      <p className="text-xs leading-relaxed text-white/35">
        Nothing is spent while you wait — a seat costs a fare, and the motions cost
        theirs only once the race is on. Every hive races its own board; the first
        bee to any queen ends the round.
      </p>
    </div>
  );
}
