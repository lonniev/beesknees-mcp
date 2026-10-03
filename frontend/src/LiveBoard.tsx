/**
 * The real game: five hives, real sats, and a server that owns the truth.
 *
 * Deliberately NOT a second board. It renders through the same `HiveView` as
 * solo and reasons about legality with the same rules module — the difference
 * is only that nothing here simulates. Every motion is a tool call, the reply
 * is the fact, and the board comes back from `match_state`.
 *
 * The client still knows the rules, and that is worth saying plainly: it uses
 * them to decide what to OFFER, never to decide what happened. A move the
 * client thinks is legal can still be refused — a rival took the cell half a
 * second ago — and the server's answer is the one that counts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BoardScreen from "./components/BoardScreen.tsx";
import { VERBS, activityLabel, readyLabel, tacticLabel, verbIcon, type Verb } from "./game/verbs.ts";
import { CRUISE_BEAT_MS, aimOver, shouldCruise } from "./game/aim.ts";
import NextStep from "./components/NextStep.tsx";
import Lobby from "./components/Lobby.tsx";
import { hydrate, phaseOf, type LiveHive } from "./game/live.ts";
import { HIVE_NAMES, HOT_RING, QUEEN_NAMES } from "./game/match.ts";
import { COMB, DEFAULT_RULES, TICK_MS, makeGeometry, neighbors, ringOf, type Bee } from "./game/rules.ts";
import { routeToward, stepToward } from "./game/bots.ts";
import { cooldownLeft, useLiveMatch, type LiveBee } from "./lib/useLiveMatch.ts";
import { callTool } from "@tollbooth-dpyc/web";
import type { Session } from "@tollbooth-dpyc/web/react";
import { claimPrize, dig as callDig, fly as callFly, seal as callSeal } from "./lib/mcp";
import { useCharity } from "./components/CharityNote";

const G = makeGeometry();
/** The client reasons with the same rules the server enforces. */
const RULES = DEFAULT_RULES;

/** The rules module reasons about a full Bee; the server sends a thinner one. */
function asBee(b: LiveBee): Bee {
  return {
    id: b.seat,
    strategy: "human",
    cell: b.cell,
    prevCell: -1,
    cameInward: Boolean(b.came_inward),
    lastAction: null,
    netTurn: 0,
    turnSwitches: 0,
    lastTurn: 0,
    phase: phaseOf(b),
    nextMoveTick: 0,
    spend: 0,
    moves: b.moves,
    meadowMoves: 0,
    digs: b.digs,
    collapses: b.seals,
    collapsedOn: 0,
    lastDelayTicks: 0,
    enteredHiveTick: -1,
    finishedTick: -1,
  };
}

export default function LiveBoard({ session }: { session: Session }) {
  const call = useCallback(
    (tool: string, args: Record<string, unknown>) =>
      callTool(tool, args, { bestEffort: true }) as Promise<unknown>,
    [],
  );
  const { board: live, error, refresh, leave } = useLiveMatch(call, true, session.npub);

  const [target, setTarget] = useState<number | null>(null);
  const [verb, setVerb] = useState<Verb>("move");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // Off on every mount: a default that spends is not a default.
  const [cruise, setCruise] = useState(false);
  // The board's `seq` when the last move was sent. `ready` is true again the
  // instant the call returns, before the next poll, so a cruise that acted on
  // `ready` alone would pay for a second move from the old cell.
  const sentSeq = useRef(-1);
  // Lost races in a row. One is the game; two means the route is contested
  // and the player should look.
  const lostRaces = useRef(0);
  const [now, setNow] = useState(Date.now());
  const [watching, setWatching] = useState<number | null>(null);
  const [claimed, setClaimed] = useState("");
  // Fetched up front, not at the moment of winning: naming the beneficiary in
  // the winner's own line is the whole point, and a fetch that starts when the
  // trophy appears would arrive after the player has read it.
  const who = useCharity();
  const [startedAt] = useState(Date.now());

  // The rest is read off the SERVER's stamp, so a tab that slept comes back
  // with the truth rather than a countdown it kept running while asleep.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const hives: LiveHive[] = useMemo(() => (live ? hydrate(live, G) : []), [live]);
  const mine = live?.bees.find((b) => b.npub === session.npub) ?? null;
  // Your hive by default; a rival while you are watching one.
  const focus = watching ?? mine?.hive ?? 0;
  const elapsed = Math.floor((now - startedAt) / 1000);
  const myHive = mine ? hives[mine.hive] : null;
  const bee = mine ? asBee(mine) : null;
  const left = cooldownLeft(mine);
  // How long THIS rest is for, so the fill reads true after an eight-second cut
  // rather than pretending every action costs the same.
  const servedMs = mine?.phase === "tunnel" && left > RULES.cooldownTicks * TICK_MS
    ? (RULES.cooldownTicks + RULES.digDelayTicks) * TICK_MS
    : RULES.cooldownTicks * TICK_MS;
  const ready = left <= 0 && live?.state === "running";
  void now;

  // A round is a Round-shaped thing to the rules module, so the client can ask
  // the same questions it asks in solo. It is READ-ONLY here.
  const round = useMemo(
    () =>
      myHive && bee
        ? {
            board: myHive.board,
            bees: myHive.bees.map(asBee),
            rules: RULES,
            tick: 0,
            winner: -1,
            rng: () => 0.5,
          }
        : null,
    [myHive, bee],
  );

  const route = useMemo(
    () => (round && bee && target !== null && verb === "move" ? routeToward(round, bee, target) : []),
    [round, bee, target, verb],
  );

  const options = useMemo(() => {
    if (!round || !bee || live?.state !== "running") return [];
    return neighbors(G, bee.cell).filter((n) =>
      verb === "seal"
        ? ringOf(G, n) >= 1 && ringOf(G, n) <= G.R && round.board.state[n] !== COMB
        : true,
    );
  }, [round, bee, verb, live?.state]);

  const onTapCell = useCallback(
    (cell: number) => {
      if (!round || !bee) return;
      if (verb === "seal") return setTarget(options.includes(cell) ? cell : null);
      setTarget(round.board.blocked[cell] ? null : cell);
    },
    [round, bee, verb, options],
  );

  /**
   * Drop an aim that is over — reached, or a flower somebody else emptied.
   *
   * Aiming reserves NOTHING — the server never hears where you are pointing,
   * and pollen is taken by arriving, inside the move statement. So the flower
   * you set off for can be gone before you land, and the only honest thing the
   * board can do is say so and let you choose again. And a bee standing on its
   * aim has nothing left to press for; the hint should say what to choose.
   */
  useEffect(() => {
    if (!myHive || !mine) return;
    const over = aimOver(myHive.board, mine, target);
    if (!over) return;
    setTarget(null);
    if (over === "spent") setNote("A rival got there first — pick another flower.");
  }, [live?.seq, target, myHive, mine]);

  /**
   * A finished act retires its aim — the same rule solo has had all along.
   *
   * Landing on the flower ends the forage; the aim stayed on the flower the
   * bee was already standing in, so the hint said "Flower chosen — press to
   * fly" over a button that could do nothing.
   */
  const phase = mine?.phase;
  useEffect(() => {
    setTarget(null);
  }, [phase]);

  const next = useMemo(() => {
    if (!round || !bee || target === null || verb === "seal") return null;
    return stepToward(round, bee, target);
  }, [round, bee, target, verb]);

  /**
   * Claim the prize the moment the round is settled.
   *
   * No choice is sent, deliberately. The server falls back to whatever the
   * winner already set in their profile, and donating is what silence means —
   * so a player who has decided is never asked again, and one who never thought
   * about it still ends the round with the money settled rather than promised.
   */
  useEffect(() => {
    if (!live?.winner_npub || live.winner_npub !== session.npub || claimed) return;
    claimPrize(live.match_id)
      .then((r) => {
        const res = r as { error?: string; donated?: boolean; outcome?: string };
        if (res.error) return;
        setClaimed(
          res.donated === false
            ? " — your share is yours; check your balance"
            : ` — your share went to ${who?.name ?? "the pollinators"}`,
        );
      })
      .catch(() => {});
  }, [live?.winner_npub, live?.match_id, session.npub, claimed, who?.name]);

  const act = useCallback(async () => {
    if (!ready || busy) return;
    setBusy(true);
    setNote("");
    sentSeq.current = live?.seq ?? -1;
    try {
      let res: Record<string, unknown>;
      if (verb === "seal" && target !== null) res = await callSeal(target);
      else if (next && next.kind !== "wait" && next.kind !== "collapse") {
        res = round!.board.state[next.to] === COMB ? await callDig(next.to) : await callFly(next.to);
      } else return;
      // The server's answer is the fact. `moved: false` is not an error — it is
      // a race this bee lost, and saying so is more use than a silent no-op.
      //
      // Cruise stops where continuing would be wrong: an error (an empty
      // balance arrives THIS way, as a normal reply with `error_code`, not as a
      // thrown 402), a refusal, or a second lost race in a row. The note already
      // carries the server's own reason; nothing is added to it.
      if (res.error) {
        setNote(String(res.error));
        setCruise(false);
      }
      // A refusal is the rules speaking, and it says why. It used to arrive as
      // "Tool execution failed. Check operator logs." — which reads as a broken
      // service when the service was working perfectly.
      else if (res.refused) {
        setNote(String(res.refused));
        setCruise(false);
      } else if (res.moved === false) {
        setNote(String(res.reason ?? "Somebody got there first."));
        if (++lostRaces.current >= 2) setCruise(false);
      } else {
        lostRaces.current = 0;
        if (res.pollen === true) setNote("Pollen! Head for a door.");
      }
      if (verb === "seal") setTarget(null);
      refresh();
    } catch (e) {
      setNote((e as Error).message);
      setCruise(false);
    } finally {
      setBusy(false);
    }
  }, [ready, busy, verb, target, next, round, refresh, live?.seq]);

  /**
   * Cruise: press the button for me whenever pressing it would do something.
   *
   * Never from the meadow, never while a call is in flight, and never twice
   * on the same read of the board — see `game/aim.ts` for each guard. It
   * chooses no aim: with nothing to press it idles, the hint says what to
   * choose, and the next tap resumes it.
   */
  const canCruise = shouldCruise({
    on: cruise,
    inHive: mine?.phase === "tunnel",
    ready,
    busy,
    hasStep: verb === "move" && !!next && next.kind !== "wait" && next.kind !== "collapse",
    running: live?.state === "running",
    seqAdvanced: (live?.seq ?? -1) !== sentSeq.current,
  });
  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    if (!canCruise) return;
    const t = setTimeout(() => void actRef.current(), CRUISE_BEAT_MS);
    return () => clearTimeout(t);
  }, [canCruise]);
  useEffect(() => {
    if (live && live.state !== "running") setCruise(false);
  }, [live?.state, live]);

  if (!live) {
    return <div className="p-8 text-center text-sm text-ink/70">{error || "Finding a hive…"}</div>;
  }

  // Nobody has enough bees yet. That is a state worth showing properly, not a
  // spinner — a patron who has paid wants to know how many more are needed.
  if (live.state === "forming") {
    return <Lobby live={live} session={session} onJoined={refresh} />;
  }

  const word = mine && ringOf(G, mine.cell) <= G.R ? "Crawl" : "Fly";
  const digging = left > RULES.cooldownTicks * TICK_MS;
  const winnerBee = live.winner_npub
    ? live.bees.find((b) => b.npub === live.winner_npub) ?? null
    : null;
  const iWon = Boolean(live.winner_npub) && live.winner_npub === session.npub;
  /**
   * The round is over, whoever it belonged to.
   *
   * Keyed on the MATCH's state rather than on finding the winner's bee row,
   * which is what it used to do — so a player whose rival's row was not in the
   * payload, or a round that hit the ceiling with no winner at all, watched a
   * board quietly stop moving and was told nothing. Losing is a result and
   * deserves to be announced; a frozen board is not an announcement.
   *
   * Stated as "not still running" rather than as a list of endings — forming
   * has already returned the lobby above. Listing them stranded a player once
   * already: a match retired onto `abandoned` is neither `ended` nor
   * `settled`, so the card never came, while `live_matches` had already
   * dropped it — a frozen board, an enabled Fly! that answered "no match is
   * running", and no way out but the browser's back button. Anything that is
   * not still going is over, including the states nobody has invented yet.
   */
  const ended = live.state !== "running";

  return (
    <BoardScreen
      hives={hives.map((h) => ({
        id: h.id,
        name: HIVE_NAMES[h.id],
        queen: `Queen ${QUEEN_NAMES[h.id % QUEEN_NAMES.length]} of Hive ${HIVE_NAMES[h.id]}`,
        board: h.board,
        bees: h.bees.map((b) => ({ id: b.seat, cell: b.cell, phase: b.phase, digs: b.digs, seals: b.seals })),
        hot: h.bees.some((b) => ringOf(G, b.cell) <= HOT_RING),
      }))}
      focus={focus}
      onFocus={setWatching}
      yourHive={mine?.hive ?? null}
      youId={mine?.seat ?? null}
      tag={`${live.bees.length} bees`}
      elapsedSec={elapsed}
      frame={live.seq}
      epoch={live.match_id}
      target={target}
      route={route}
      options={options}
      onTapCell={onTapCell}
      verbs={VERBS.map(({ id, hint }) => ({ id, hint, icon: verbIcon(id, word), label: tacticLabel(id, word) }))}
      verb={verb}
      onVerb={(v) => setVerb(v as Verb)}
      cruise={cruise}
      cruiseEnabled={mine?.phase === "tunnel" && live.state === "running"}
      onCruise={setCruise}
      pot={live.pot ?? null}
      charityName={who?.name}
      prompt={
        !ready && left > 0 ? (
          <span className="text-[var(--color-you-ink)]">
            {digging ? "Digging" : "Resting"} {(left / 1000).toFixed(1)}s
          </span>
        ) : (
          // The SAME hint the practice board gives. This used to be a two-way
          // ternary — one sentence before you aimed and one after — for a whole
          // round, and neither said which of the things on screen to tap or
          // what the bee was trying to do. The board that costs sats was the
          // one giving the least help. `game/nextStep.ts` holds the words now,
          // and its test refuses to let either board grow its own again.
          <NextStep phase={mine?.phase} aimed={target !== null} why={note} word={word} />
        )
      }
      actionLabel={
        mine?.phase === "done"
          ? { icon: "crown", text: "Home" }
          : !ready && left > 0
            // The server does not say WHICH action is being served, so it is read
            // off the length of the rest: only a cut costs more than one.
            ? activityLabel(digging ? "dig" : "fly", word)
            : busy
              ? { icon: null, text: "…" }
              : readyLabel(verb, word)
      }
      actionEnabled={ready && !busy && (verb === "seal" ? target !== null : Boolean(next))}
      onAct={act}
      restLeft={left > 0 ? left / servedMs : 0}
      winner={
        !ended
          ? null
          : winnerBee || live.winner_npub
          ? iWon
            ? {
                label: `Consort to Queen ${QUEEN_NAMES[(winnerBee?.hive ?? 0) % QUEEN_NAMES.length]}`,
                detail: `Hive ${HIVE_NAMES[winnerBee?.hive ?? 0]} is yours — first bee home`,
                // Where the winner's share went, on its own line rather than
                // tacked onto the sentence with a second dash.
                note: claimed ? claimed.replace(/^\s*—\s*/, "") : undefined,
                yours: true,
              }
            : {
                label: winnerBee?.label || live.winner_npub.slice(0, 12),
                detail: winnerBee
                  ? `reached Queen ${QUEEN_NAMES[winnerBee.hive % QUEEN_NAMES.length]} of Hive ${HIVE_NAMES[winnerBee.hive]}`
                  : "reached the queen first",
              }
          : {
              // Ended with nobody home: the ceiling ran out. Still a result,
              // and still owed to everyone who was playing.
              label: "The round is over",
              detail: "Time ran out before anybody reached a queen.",
              unwon: true,
            }
      }
      // Leaving is the player's own move: the result stays until they are done
      // reading it, rather than the next lobby taking the screen from under
      // them. Offered on ANY ending, not only a win — the loser needs the way
      // out more than the winner does, and it used to be the winner alone who
      // got one.
      //
      // It polls as it goes, so the next lobby arrives now rather than at the
      // end of a four-second cycle; the button reads as taking you somewhere.
      onNewMatch={
        ended
          ? () => {
              setWatching(null);
              // `leave`, not `refresh`. A finished round answers its own
              // players for three minutes so the result can be read — so a
              // refresh fetches the round this button exists to escape, and
              // the button reads as frozen.
              leave(live.match_id);
            }
          : undefined
      }
      againLabel="Queue for the next round"
    />
  );
}
