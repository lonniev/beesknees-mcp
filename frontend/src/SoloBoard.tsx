/**
 * The Bee's Knees — solo mode.
 *
 * Everything here runs against the local engine so the interface can be played
 * before anybody has paid for anything. The board, the clock and the rules are
 * already the ones the server will enforce; what solo mode fakes is only who is
 * asked for the next move.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Footprints, Mountain, Wind } from "lucide-react";
import BoardScreen, { activityLabel } from "./components/BoardScreen.tsx";
import { approach, routeToward, stepToward } from "./game/bots.ts";
import type { Action } from "./game/rules.ts";
import { COMB, OPEN, TICK_MS, legal, neighbors, ringOf } from "./game/rules.ts";
import { isHot, queenName, queenOf, seated, youWon } from "./game/match.ts";
import { cellCentre } from "./lib/polar.ts";
import { useSoloMatch } from "./lib/useMatch.ts";

/**
 * The three things a bee can do, named rather than inferred.
 *
 * Tapping used to choose the verb for you — fly if the cell was open, dig if it
 * was not — which quietly hid the only real decision in the game. Cutting your
 * own shaft and riding somebody else's cost differently and take different
 * amounts of TIME, so which one you are doing should be something you say.
 */
/**
 * Two modes, not three — and only one of them is a decision.
 *
 * Fly and Dig were separate buttons the player had to choose BETWEEN before
 * tapping, which made them a mode error waiting to happen: whether a step is a
 * crawl or a cut is decided by the cell, not by the person, and with "Fly"
 * selected the diggable cells were not offered at all, so a perfectly good
 * comb face read as a dead end. Moving is now one verb that names itself from
 * the cell it is about to enter.
 *
 * Seal stays its own mode because it genuinely is one: it is the only thing
 * here that destroys rather than travels, and it must never be a mis-tap.
 */
const VERBS = [
  { id: "move", label: "Go!", Icon: Wind, hint: "Travel — cut fresh comb where you must" },
  { id: "seal", label: "Fill!", Icon: Mountain, hint: "Bring down an open tunnel" },
] as const;

/**
 * The same motion is called something different inside the hive.
 *
 * A bee in the meadow flies; a bee in a tunnel crawls. It is one verb in the
 * rules and two words on the button, because "Fly" over a bee that is
 * underground reads as a bug rather than as a synonym.
 */
function verbLabel(id: Verb, word: string): string {
  if (id === "move") return `${word}!`;
  return VERBS.find((v) => v.id === id)!.label;
}

/**
 * The motion's name, decided by where it ENDS rather than where it starts.
 *
 * A bee on the square outside a door is about to go underground, so it crawls
 * in — even though it is standing in open air. A bee in the doorway heading
 * back out is about to be airborne, so it flies out. Naming the word after the
 * bee's current cell got both of those backwards, which is exactly the moment
 * the word matters: at the threshold.
 */
/**
 * What the bee is DOING while its clock runs down.
 *
 * It said "Resting" whatever the delay was for, which told the player their bee
 * was idle at the exact moment it was working hardest — eight seconds of it,
 * after cutting a cell. The wait was never the problem. Being told an
 * industrious animal was having a lie-down was.
 *
 * The cell really does open the instant the dig is paid for, and the bee really
 * is standing in it — that is the rule, and the server's fenced write depends on
 * it. So this is an honest reading of the same fact rather than a fiction: the
 * bee is in the cell it is still busy cutting its way through.
 */
function busyWord(action: string | null | undefined): string {
  if (action === "dig") return "Digging";
  if (action === "collapse") return "Sealing";
  return "Resting";
}

function moveWord(destInHive: boolean): string {
  return destInHive ? "Crawl" : "Fly";
}

/** Wings above ground, feet below. A bee going into a tunnel is not flying. */
function verbIcon(id: Verb, word: string) {
  if (id === "move") return word === "Crawl" ? Footprints : Wind;
  return VERBS.find((v) => v.id === id)!.Icon;
}

type Verb = (typeof VERBS)[number]["id"];

/**
 * What to do next, in the order a player needs it.
 *
 * Written as one function because the prompt was three nested ternaries that
 * had already produced "No way through" at the exact moment the bee succeeded.
 * A prompt that reports the engine's opinion rather than the player's next move
 * is worse than none.
 */
function NEXT_STEP(
  phase: string | undefined,
  target: number | null,
  why: string,
  word: string,
): string {
  if (phase === "done") return "At the queen.";
  if (target === null) {
    if (phase === "forage") return "Tap a flower that still has pollen.";
    if (phase === "return") return "Choose a door now — tap a gap in the hive wall.";
    return "Tap where you want to end up — the queen, or anywhere on the way.";
  }
  if (why) return why;
  const verb = word.toLowerCase();
  if (phase === "forage") return `Flower chosen — press to ${verb}.`;
  if (phase === "return") return `Door chosen — press to ${verb}.`;
  // The route is drawn, so the prompt says what the NEXT press costs rather
  // than repeating the destination the player can already see marked.
  return word === "Crawl" ? "Press to crawl the line." : "Press to fly the line.";
}


/**
 * One rival hive, small.
 *
 * Its whole job is to answer "is anything happening over there" at a glance —
 * which is why the wall carries the hive's temperature rather than the tile's
 * border doing it: the border is a few pixels of chrome, the wall is the shape
 * the eye already lands on.
 */
export default function App() {
  const { match, frame, you, cooldown, cooldownMs, submit, restart } = useSoloMatch();
  const [focus, setFocus] = useState<number | null>(match.you?.hive ?? 0);
  const [verb, setVerb] = useState<Verb>("move");
  const [target, setTarget] = useState<number | null>(null);

  // A new match re-seats you, so the view follows your bee rather than staying
  // parked on whichever rival you were watching when the last round ended.
  const newMatch = useCallback(() => {
    restart();
    setFocus(0);
  }, [restart]);
  const yourHive = match.you ? match.hives[match.you.hive] : null;
  const ready = cooldown <= 0;
  const inHive =
    !!you && !!yourHive && ringOf(yourHive.round.board.g, you.cell) <= yourHive.round.board.g.R;

  /**
   * The moves available to your bee right now, under the verb you have chosen.
   *
   * Inside the comb this is also what a tap may select, so finger precision
   * stops mattering: there are four to six options and the nearest one wins.
   * Widening the cells to make them easier to hit was measured and rejected —
   * fewer cells per ring plus bodies gridlocks the hive, and completion fell
   * from 91% to 79%.
   */
  const options = useMemo(() => {
    if (!you || !yourHive || you.phase !== "tunnel" || match.state !== "running") return [];
    const round = yourHive.round;
    const g = round.board.g;
    return neighbors(g, you.cell).filter((n) => {
      if (verb === "seal") return ringOf(g, n) >= 1 && ringOf(g, n) <= g.R && round.board.state[n] === OPEN;
      // Every legal step, whichever kind it is. Filtering these by a chosen
      // verb is what made a wall of diggable comb look like a dead end.
      const kind = round.board.state[n] === OPEN ? "fly" : "dig";
      return legal(round, you, { kind, to: n } as Action);
    });
  }, [frame, match.state, verb, you, yourHive]);



  /**
   * A tap AIMS, and it aims at the thing you meant.
   *
   * Foraging, you are choosing a flower — not the cell it happens to sit in —
   * and a meadow cell is a few millimetres across on a phone. So the tap snaps
   * to the nearest flower that still holds pollen, and on the way home to the
   * nearest door. Only inside the comb is a tap a cell, because there the exact
   * cell IS the decision.
   */
  const onTapCell = useCallback(
    (cell: number) => {
      if (!yourHive || !you) return setTarget(cell);
      const b = yourHive.round.board;
      const g = b.g;

      const candidates: number[] = [];
      if (you.phase === "forage") {
        for (let c = 0; c < g.cells; c++) if (b.pollen[c]) candidates.push(c);
      } else if (you.phase === "return") {
        for (let c = 0; c < g.cells; c++) if (b.mouth[c]) candidates.push(c);
      } else if (verb === "seal") {
        // Sealing acts on ONE cell, so the tap is that cell and nothing else.
        candidates.push(...options);
      } else {
        // A tap in the comb picks a DESTINATION, exactly as a tap in the meadow
        // picks a flower — not the next cell along.
        //
        // It used to offer only the four to six cells touching the bee, so the
        // player had to re-aim before every single press. A winning bee makes
        // 43 moves inside the comb: that was 86 interactions, one every two
        // seconds, to express a route they had already decided on. The skill is
        // reading the comb and choosing a line; the tapping was never the game.
        for (let c = 0; c < g.cells; c++) if (!b.blocked[c]) candidates.push(c);
      }
      if (!candidates.length) return setTarget(null);

      const [tx, ty] = cellCentre(g, cell);
      let best = candidates[0];
      let bestD = Infinity;
      for (const c of candidates) {
        const [x, y] = cellCentre(g, c);
        const d = (x - tx) ** 2 + (y - ty) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      setTarget(best);
    },
    [options, you, yourHive],
  );

  /**
   * Drop an aim that has become pointless.
   *
   * A flower a rival emptied first is the case this exists for: without it the
   * bee keeps flying at a spent flower and the player has to notice for
   * themselves that the thing they aimed at is gone.
   */
  useEffect(() => {
    if (target === null || !yourHive || !you) return;
    const b = yourHive.round.board;
    if (you.phase === "forage" && b.flower[target] && !b.pollen[target]) setTarget(null);
  }, [frame, target, you, yourHive]);

  /**
   * A finished act retires its aim.
   *
   * Landing on a flower ends the forage and begins the walk home, but the aim
   * stayed on the flower the bee was already standing in — so the button
   * reported "No way through", which is true and useless. The prompt should be
   * telling you the next thing to do.
   */
  const phase = you?.phase;
  useEffect(() => {
    setTarget(null);
  }, [phase]);

  /**
   * The move the button would make, or the reason it cannot.
   *
   * Worked out here rather than on press, so the control can say NOW whether it
   * will do anything — a button that looks live and then does nothing is what
   * made the old bar so hard to read.
   */
  /** The path the aim commits to, recomputed as the comb changes under it. */
  const route = useMemo(() => {
    if (!yourHive || !you || target === null || verb === "seal") return [];
    return routeToward(yourHive.round, you, target);
  }, [frame, target, verb, you, yourHive]);

  const pending = useMemo((): { action: Action | null; why: string; word: string } => {
    const fallback = moveWord(inHive);
    if (!yourHive || !you || match.state !== "running")
      return { action: null, why: "", word: fallback };
    const round = yourHive.round;
    const g = round.board.g;
    if (target === null) return { action: null, why: "Tap the board to aim", word: fallback };

    if (verb === "seal") {
      const r = ringOf(g, target);
      if (r < 1 || r > g.R) return { action: null, why: "Only inside the hive", word: fallback };
      if (round.board.state[target] !== OPEN)
        return { action: null, why: "Already solid", word: fallback };
      return { action: { kind: "collapse", at: target }, why: "", word: fallback };
    }

    // A rival standing in the doorway is not "no way through". Every door may
    // have a queue and this bee has to be near its own door regardless, so when
    // the direct route is taken we route toward it anyway and take the best
    // legal step — which puts the bee alongside the door rather than refusing
    // it. Only a bee that cannot get any closer at all is genuinely waiting.
    const direct = stepToward(round, you, target);
    const queueing = !direct;
    const step = direct ?? approach(round, you, target);
    if (!step || step.kind === "wait" || step.kind === "collapse")
      return { action: null, why: "Held up — nothing gets you closer yet.", word: fallback };

    // The word is named for where the step ENDS: into the hive is a crawl, out
    // of it is a flight, whichever side of the threshold the bee is standing on.
    const word = moveWord(ringOf(g, step.to) <= g.R);
    // And the KIND is named by the cell, not by the player. Solid comb is cut,
    // open tunnel is travelled, and nobody has to declare which in advance.
    const solid = round.board.state[step.to] === COMB;
    const action = { kind: solid ? "dig" : "fly", to: step.to } as Action;
    return {
      action,
      why: queueing ? `That door is taken — ${word.toLowerCase()} up beside it.` : "",
      word,
    };
  }, [frame, inHive, match.state, target, verb, you, yourHive]);

  const act = useCallback(() => {
    if (!pending.action || !ready) return;
    submit(pending.action);
    if (verb === "seal") setTarget(null);
  }, [pending, ready, submit, verb]);

  const elapsed = Math.floor((match.tick * TICK_MS) / 1000);

  return (
    <BoardScreen
      hives={match.hives.map((h) => ({
        id: h.id,
        name: h.name,
        queen: queenOf(h),
        board: h.round.board,
        bees: seated(h),
        hot: isHot(h),
      }))}
      focus={focus}
      onFocus={setFocus}
      yourHive={match.you?.hive ?? null}
      youId={match.you?.beeId ?? null}
      tag="solo"
      elapsedSec={elapsed}
      onNewMatch={newMatch}
      frame={frame}
      target={target}
      route={route}
      options={options}
      onTapCell={onTapCell}
      verbs={VERBS.map(({ id, hint }) => ({ id, hint, Icon: verbIcon(id, pending.word) }))}
      verb={verb}
      onVerb={(v) => setVerb(v as Verb)}
      prompt={
        !ready ? (
          <span className="text-[var(--color-you-ink)]">
            {busyWord(you?.lastAction)} {(cooldownMs / 1000).toFixed(1)}s
          </span>
        ) : pending.action?.kind === "dig" ? (
          "Press to cut — eight seconds of digging, against one to crawl."
        ) : (
          NEXT_STEP(you?.phase, target, pending.why, pending.word)
        )
      }
      actionLabel={
        // Busy: say what the bee is doing. Ready: say what pressing will do.
        ready ? verbLabel(verb, pending.word) : activityLabel(you?.lastAction, pending.word)
      }
      actionEnabled={Boolean(pending.action) && ready}
      onAct={act}
      restLeft={ready ? 0 : cooldown}
      winner={
        match.state === "ended" && match.winner
          ? youWon(match)
            ? {
                label: `Consort to ${queenName(match.hives[match.winner.hive])}`,
                detail: `Hive ${match.hives[match.winner.hive].name} is yours — first bee home`,
                yours: true,
              }
            : {
                label: match.winner.label,
                detail: `reached ${queenOf(match.hives[match.winner.hive])}`,
              }
          : null
      }
    />
  );
}
