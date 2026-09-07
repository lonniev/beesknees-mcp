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
import { HiveView } from "./components/HiveView.tsx";
import Scoreboard from "./components/Scoreboard.tsx";
import Lobby from "./components/Lobby.tsx";
import { hydrate, phaseOf, type LiveHive } from "./game/live.ts";
import { COMB, DEFAULT_RULES, makeGeometry, neighbors, ringOf, type Bee } from "./game/rules.ts";
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
    cameInward: false,
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

  // The rest is read off the SERVER's stamp, so a tab that slept comes back
  // with the truth rather than a countdown it kept running while asleep.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const hives: LiveHive[] = useMemo(() => (live ? hydrate(live, G) : []), [live]);
  const mine = live?.bees.find((b) => b.npub === session.npub) ?? null;
  const myHive = mine ? hives[mine.hive] : null;
  const bee = mine ? asBee(mine) : null;
  const left = cooldownLeft(mine);
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
    return (
      <div className="p-8 text-center text-sm text-white/50">
        {error || "Finding a hive…"}
      </div>
    );
  }

  // Nobody has enough bees yet. That is a state worth showing properly, not a
  // spinner — a patron who has paid wants to know how many more are needed.
  if (live.state === "forming") {
    return <Lobby live={live} session={session} onJoined={refresh} />;
  }

  const focus = mine?.hive ?? 0;
  const busyLabel = mine?.phase === "done" ? "Home" : busy ? "…" : verb === "seal" ? "Fill!" : "Go!";

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <header className="flex shrink-0 items-baseline justify-between px-1">
        <span className="text-lg font-semibold tracking-tight">The Bee's Knees</span>
        <span className="text-xs text-white/40">
          {live.bees.length} bees · {live.state}
        </span>
      </header>
      <Scoreboard />

      <div className="min-h-0 flex-1">
        <HiveView
          board={hives[focus].board}
          bees={hives[focus].bees.map((b) => ({ id: b.seat, cell: b.cell, phase: b.phase }))}
          hot={false}
          frame={live.seq}
          youId={mine?.seat ?? null}
          target={target}
          route={route}
          options={options}
          focused
          armed={verb === "seal"}
          onTapCell={onTapCell}
        />
      </div>

      <div className="flex shrink-0 items-center gap-4 pb-[env(safe-area-inset-bottom)]">
        <span className="min-w-0 flex-1 text-left text-[13px] leading-tight text-white/60">
          {!ready && left > 0 ? (
            <span className="text-[var(--color-you)]">
              {mine?.phase === "tunnel" ? "Working" : "Resting"} {(left / 1000).toFixed(1)}s
            </span>
          ) : (
            note || (target === null ? "Tap where you want to end up." : "Press to move.")
          )}
        </span>
        <div className="flex gap-2 rounded-xl bg-white/5 p-1.5">
          {(["move", "seal"] as const).map((v) => {
            const Icon = v === "seal" ? Mountain : mine && ringOf(G, mine.cell) <= G.R ? Footprints : Wind;
            return (
              <button
                key={v}
                onClick={() => setVerb(v)}
                aria-pressed={verb === v}
                className={`flex h-12 w-12 items-center justify-center rounded-lg transition ${
                  verb === v ? "bg-[var(--color-you)] text-black" : "text-white/55 hover:bg-white/10"
                }`}
              >
                <Icon size={19} />
              </button>
            );
          })}
        </div>
        <button
          onClick={act}
          disabled={!ready || busy || (verb === "move" && !next)}
          className={`min-w-32 rounded-xl px-6 py-3 font-semibold transition ${
            ready && !busy ? "bg-[var(--color-you)] text-black" : "bg-white/10 text-white/45"
          }`}
        >
          {busyLabel}
        </button>
      </div>
    </div>
  );
}
