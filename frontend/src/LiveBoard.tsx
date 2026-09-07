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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Footprints, Mountain, Wind } from "lucide-react";
import BoardScreen from "./components/BoardScreen.tsx";
import Lobby from "./components/Lobby.tsx";
import { hydrate, phaseOf, type LiveHive } from "./game/live.ts";
import { HIVE_NAMES, HOT_RING, QUEEN_NAMES } from "./game/match.ts";
import { COMB, DEFAULT_RULES, TICK_MS, makeGeometry, neighbors, ringOf, type Bee } from "./game/rules.ts";
import { approach, routeToward, stepToward } from "./game/bots.ts";
import { cooldownLeft, useLiveMatch, type LiveBee } from "./lib/useLiveMatch.ts";
import { callTool, dig as callDig, fly as callFly, seal as callSeal } from "./lib/mcp";
import type { Session } from "./lib/session.ts";

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
  const { board: live, error, refresh } = useLiveMatch(call);

  const [target, setTarget] = useState<number | null>(null);
  const [verb, setVerb] = useState<"move" | "seal">("move");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [now, setNow] = useState(Date.now());
  const [watching, setWatching] = useState<number | null>(null);
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

  const next = useMemo(() => {
    if (!round || !bee || target === null || verb === "seal") return null;
    return stepToward(round, bee, target) ?? approach(round, bee, target);
  }, [round, bee, target, verb]);

  const act = useCallback(async () => {
    if (!ready || busy) return;
    setBusy(true);
    setNote("");
    try {
      let res: Record<string, unknown>;
      if (verb === "seal" && target !== null) res = await callSeal(target);
      else if (next && next.kind !== "wait" && next.kind !== "collapse") {
        res = round!.board.state[next.to] === COMB ? await callDig(next.to) : await callFly(next.to);
      } else return;
      // The server's answer is the fact. `moved: false` is not an error — it is
      // a race this bee lost, and saying so is more use than a silent no-op.
      if (res.error) setNote(String(res.error));
      // A refusal is the rules speaking, and it says why. It used to arrive as
      // "Tool execution failed. Check operator logs." — which reads as a broken
      // service when the service was working perfectly.
      else if (res.refused) setNote(String(res.refused));
      else if (res.moved === false) setNote(String(res.reason ?? "Somebody got there first."));
      else if (res.pollen === true) setNote("Pollen! Head for a door.");
      if (verb === "seal") setTarget(null);
      refresh();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [ready, busy, verb, target, next, round, refresh]);

  if (!live) {
    return <div className="p-8 text-center text-sm text-white/50">{error || "Finding a hive…"}</div>;
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

  return (
    <BoardScreen
      hives={hives.map((h) => ({
        id: h.id,
        name: HIVE_NAMES[h.id],
        queen: `Queen ${QUEEN_NAMES[h.id % QUEEN_NAMES.length]} of Hive ${HIVE_NAMES[h.id]}`,
        board: h.board,
        bees: h.bees.map((b) => ({ id: b.seat, cell: b.cell, phase: b.phase })),
        hot: h.bees.some((b) => ringOf(G, b.cell) <= HOT_RING),
      }))}
      focus={focus}
      onFocus={setWatching}
      yourHive={mine?.hive ?? null}
      youId={mine?.seat ?? null}
      tag={`${live.bees.length} bees`}
      elapsedSec={elapsed}
      frame={live.seq}
      target={target}
      route={route}
      options={options}
      onTapCell={onTapCell}
      verbs={[
        { id: "move", hint: "Travel — cut fresh comb where you must", Icon: word === "Crawl" ? Footprints : Wind },
        { id: "seal", hint: "Bring down an open tunnel", Icon: Mountain },
      ]}
      verb={verb}
      onVerb={(v) => setVerb(v as "move" | "seal")}
      prompt={
        !ready && left > 0 ? (
          <span className="text-[var(--color-you)]">
            {digging ? "Digging" : "Resting"} {(left / 1000).toFixed(1)}s
          </span>
        ) : (
          note || (target === null ? "Tap where you want to end up." : "Press to move.")
        )
      }
      actionLabel={mine?.phase === "done" ? "Home" : busy ? "…" : verb === "seal" ? "Fill!" : `${word}!`}
      actionEnabled={ready && !busy && (verb === "seal" ? target !== null : Boolean(next))}
      onAct={act}
      restLeft={left > 0 ? left / servedMs : 0}
      winner={
        winnerBee
          ? {
              label: winnerBee.label || winnerBee.npub.slice(0, 12),
              detail: `reached Queen ${QUEEN_NAMES[winnerBee.hive % QUEEN_NAMES.length]} of Hive ${HIVE_NAMES[winnerBee.hive]}`,
            }
          : null
      }
    />
  );
}
