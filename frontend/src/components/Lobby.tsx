/**
 * The wait before a round, made legible.
 *
 * A patron who has paid for a bee and is looking at a still board needs one
 * question answered: how many more of us, and how long. A spinner answers
 * neither. The quorum is the honest number — a match starts when any single
 * HIVE reaches it, not when the whole field is full — so that is what counts
 * down, and the hive nearest it is the one shown filling.
 *
 * This briefly counted across the match instead, which made the big number a
 * lie in the only place it mattered: it read 1/8 while the rule needed a hive
 * of eight, and the race did not begin when it said it would.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Share2, Users, Zap } from "lucide-react";
import CharityNote, { useCharity } from "./CharityNote";
import {
  Money, Standings, StandingsHeading, useSettlements,
} from "./Standings";
import Elsewhere from "./Elsewhere";
import Skep from "./Skep";
import Meadowscape from "./Meadowscape.tsx";
import { PageBees } from "./Meadow.tsx";
import { HIVE_NAMES } from "../game/match.ts";
import FirstTime from "./FirstTime.tsx";
import QuoteScroller from "./QuoteScroller.tsx";
import { checkNow, joinMatch } from "../lib/mcp";
import type { LiveState } from "../lib/useLiveMatch.ts";
import type { Session } from "../lib/session.ts";

/** Mirrors board_store.QUORUM — bees in ONE hive, which is what starts a match.
 *
 * Seats are dealt round-robin, so the hives fill together and a hive reaches
 * eight only when the board is nearly full. That is what the simulated swarm
 * is for — it tops the room up to the quota rather than making up numbers. */
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
  const [explaining, setExplaining] = useState(false);
  const nav = useNavigate();
  // Named here as well as shown, so the invitation a friend receives says who
  // the money is for rather than gesturing at "the pollinators".
  const who = useCharity();
  // Free, and the same read the ledger page makes. A player stuck in a
  // lobby should not have to leave it to find out what the wait is for.
  const { data: money, failed: moneyFailed } = useSettlements(0, 10);

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

  // The FULLEST hive, because that is what the quorum watches. Seats are dealt
  // to the emptiest hive, so the five stay within one of each other and the
  // whole board fills together — which means the fullest hive is also a fair
  // picture of the room, not a lucky outlier.
  const perHive = Array.from({ length: live.hives }, (_, h) =>
    live.bees.filter((b) => b.hive === h).length,
  );
  const fullest = perHive.length ? Math.max(...perHive) : 0;
  // What the ROOM still needs, which is not `QUORUM - fullest`: another bee
  // goes to the emptiest hive, so the fullest one only grows once every hive
  // has caught up with it.
  const needed = perHive.reduce((n, seats) => n + Math.max(0, QUORUM - seats), 0);

  /** Is this the cell the player's own bee is sitting in? */
  const isMine = (hive: number, index: number) =>
    !!mine && mine.hive === hive && mine.seat === index;

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
      "I'm waiting on a hive in The Bee's Knees — come play, " +
      `80% of the pot goes to ${who?.name ?? "the pollinators"}.`;
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

  /**
   * Fund a bee, or explain what funding one needs.
   *
   * A visitor with no key pressed this and was sent to a form asking for an
   * npub — a word the page had not used, in a box, with nothing said about
   * what it is or where to get the money either. That is where a curious
   * stranger stops.
   */
  function fund() {
    if (!session.signedIn) {
      setExplaining(true);
      return;
    }
    void join();
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
    <>
      {/* The lobby is the longest WAIT in the app — you sit here until forty
          bees have a seat — and it was the one screen with no life on it. The
          sign-in card, which is a five-second stop, had the drawn meadow; this
          had ten emoji in the margins.

          Neither of these is new. The ground is `Meadowscape`, which shipped
          mounted on sign-in and nowhere else. The bees are the same foragers
          the board and every reading page already run; they were kept off this
          screen by `!onBoard` in App, which is a test on the PATH — and the
          lobby shares `/play` with the board that guard was written for. This
          is not a board: `LiveBoard` renders EITHER this or `BoardScreen`,
          never both, so a forager here can never be a bee the rules know
          nothing about. The guard still covers the case it was for.

          Siblings of the column rather than children of it, exactly as
          `SignIn` mounts the meadow. Both layers are `fixed` and negatively
          stacked, and the working arrangement is the one to copy rather than
          the one to reason about. */}
      <Meadowscape />
      <PageBees />

      {/* The column stays narrow on a phone and opens out on anything wider —
        * the lobby had a single `max-w-md` column, so on an iPad five hives
        * huddled in the middle third with the screen empty on both sides. */}
      <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10 text-center sm:max-w-3xl sm:gap-8 sm:py-12">
      <div>
        <div className="text-sm text-ink/70">The hive is filling</div>
        <div className="mt-2 flex items-baseline justify-center gap-2">
          <span className="text-5xl font-semibold tabular-nums">{fullest}</span>
          <span className="text-2xl text-ink/65">/ {QUORUM}</span>
        </div>
        <div className="mt-1 text-sm text-ink/78">
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
      {/* One column per hive, given room to breathe. Each is a named place with
        * a skep over it rather than an anonymous bar: seats are dealt
        * round-robin now, so all five fill together and the row reads as five
        * hives in a meadow instead of a chart with one tall column. */}
      <div className="relative flex justify-center gap-3 sm:gap-8 lg:gap-14">
        {perHive.map((n, h) => (
          <div key={h} className="flex w-14 flex-col items-center gap-1.5 sm:w-20">
            <Skep filling={n / QUORUM} yours={mine?.hive === h} className="max-w-[44px] sm:max-w-[64px]" />
            <span
              className={`text-[10px] font-medium tracking-wide sm:text-xs ${
                mine?.hive === h ? "text-[var(--color-you-ink)]" : "text-ink/70"
              }`}
            >
              {HIVE_NAMES[h]}
            </span>
            <div className="flex h-28 w-9 flex-col-reverse items-center gap-[1px] rounded-md bg-ink/6 p-[3px] sm:h-32 sm:w-11">
              {Array.from({ length: QUORUM }, (_, i) =>
                i < n ? (
                  <span
                    key={i}
                    className={`bk-thrum relative flex-1 text-[13px] leading-none ${
                      // YOUR seat, not just your hive. `seat` is the index
                      // within the hive — the primary key is (match, hive,
                      // seat) and it is dealt from that hive's own count — and
                      // the column renders bottom-up, so seat 0 IS the bottom
                      // cell. The hive label was tinted before, which told you
                      // which column to look at and left you counting bees in
                      // it.
                      isMine(h, i) ? "rounded-full ring-1 ring-[var(--color-you)]" : ""
                    }`}
                    // Its own rhythm. Shared, they read as one machine.
                    style={{ animationDelay: `${((i * 137 + h * 61) % 900) / 1000}s` }}
                    title={isMine(h, i) ? "your bee" : mine?.hive === h ? "your hive" : undefined}
                  >
                    {/* The same halo the board draws around your bee: a soft
                        disc of `--color-you` breathing underneath it, and a
                        ring. One vocabulary for "this one is yours", so the
                        lobby is not teaching a mark the race will not use. */}
                    {isMine(h, i) && (
                      <span
                        aria-hidden="true"
                        className="bk-pulse absolute left-1/2 top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-you)]"
                      />
                    )}
                    <span className="relative">🐝</span>
                  </span>
                ) : (
                  // An empty seat is an absence, but it is still a comb cell somebody
                  // could sit in. `opacity-15` was invisible once the page went light.
                  <span key={i} className="flex-1 text-[13px] leading-none text-ink/50">
                    ⬡
                  </span>
                ),
              )}
            </div>
            <span
              className={`text-[10px] ${
                mine?.hive === h ? "text-[var(--color-you-ink)]" : "text-ink/65"
              }`}
            >
              {n}
            </span>
          </div>
        ))}
      </div>

      {mine ? (
        <div className="flex flex-col gap-2">
          <div className="text-sm text-ink/70">
            <Users size={14} className="mr-1 inline" />
            Your bee has a seat. Waiting {Math.floor(waited / 60)}:
            {String(waited % 60).padStart(2, "0")}
          </div>
          {/* Said once they are actually seated, because until then there is
              nothing to come back to. The wait is minutes and nobody should
              feel held here — but the race starts without them, so the leaving
              and the returning have to be said in the same breath. */}
          <p className="mx-auto max-w-md text-xs leading-relaxed text-ink/65">
            You can leave this page while waiting but make sure to get back
            before the game begins.
          </p>
        </div>
      ) : (
        <button
          onClick={fund}
          disabled={busy}
          className="mx-auto flex items-center gap-2 rounded-xl bg-[var(--color-you)] px-6 py-3 font-semibold text-black disabled:opacity-40"
        >
          <Zap size={16} /> {busy ? "Funding your bee…" : "Fund a Bee"}
        </button>
      )}

      {explaining && (
        <FirstTime
          onGenerate={() => nav("/signin", { state: { from: "/play", generate: true } })}
          onExisting={() => nav("/signin", { state: { from: "/play" } })}
          onClose={() => setExplaining(false)}
        />
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* The one thing a waiting player can do about the wait. A bot will fill
        * the seat eventually; a friend is a better game. */}
      <button
        onClick={share}
        className="mx-auto flex items-center gap-2 rounded-xl border border-ink/20 px-4 py-2.5 text-sm text-ink/85 hover:bg-ink/4"
      >
        {shared ? <Check size={15} className="text-[var(--color-you-ink)]" /> : <Share2 size={15} />}
        {shared ? "Link copied — send it to a friend" : "Share it — bring a friend to the race"}
      </button>

      {/* What the wait is FOR.
        *
        * This lived on the ledger, one navigation away — and the lobby is the
        * one screen somebody is certain to read all of, because they cannot do
        * anything else. Naming the charity beside the sats already owed to it,
        * and the standings beside both, is the whole argument for spending the
        * fare, made where the spending is being considered. */}
      {/* Opaque, because the meadow is FIXED and negatively stacked and these
        * cards are a 4% wash — a hill ran straight through the standings when
        * this block first landed in the lower third of the page. The backdrop
        * belongs here rather than in `Standings`, which the ledger also
        * renders on a page that has no meadow behind it. */}
      <div className="flex flex-col gap-3 rounded-2xl bg-[var(--color-sky)]/92 p-4 text-left">
        <Money data={money} />
        <CharityNote className="text-center" />
        <StandingsHeading>Most won</StandingsHeading>
        <Standings data={money} failed={moneyFailed} limit={5} you={session.npub} />
      </div>

      {/* Bee poetry while the hive fills. A lobby is a wait somebody else
        * controls, and a bare number counting to eight is a frozen "Loading…"
        * wearing a different hat. This game also asks people to spend money on
        * pollinators, and this minute is the one they are certain to read. */}
      <QuoteScroller className="pt-1" />

      {/* Somewhere to go, for the one screen where a visitor has nothing to do
        * and is certain to read something. */}
      <Elsewhere />


      <p className="text-xs leading-relaxed text-ink/65">
        Nothing is spent while you wait — a seat costs a fare, and the motions cost
        theirs only once the race is on. Every hive races its own board; the first
        bee to any queen ends the round.
      </p>
      </div>
    </>
  );
}
