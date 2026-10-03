/**
 * Strategies, so the board can be asked whether judgement beats reflex.
 *
 * `bore` is the control and the one that matters: it steps inward every
 * cooldown and thinks about nothing. If it wins as often as the others, the
 * game is a lottery with extra steps and the board needs retuning before a line
 * of server code is written.
 */

import {
  type Action,
  type Bee,
  type Round,
  COMB,
  OPEN,
  field,
  legal,
  inward,
  isHive,
  neighbors,
  ringOf,
} from "./rules.ts";

export const STRATEGIES = ["bore", "rider", "digger", "sealer", "random"] as const;
export type Strategy = (typeof STRATEGIES)[number];

/** Cells that end the current act — what the bee is actually heading for. */
function goals(round: Round, bee: Bee): number[] {
  const { board } = round;
  const g = board.g;
  const out: number[] = [];
  if (bee.phase === "forage") {
    // Only flowers that still hold pollen are worth flying to.
    for (let c = 0; c < g.cells; c++) if (board.pollen[c]) out.push(c);
    if (!out.length) for (let c = 0; c < g.cells; c++) if (board.flower[c]) out.push(c);
    return out;
  }
  if (bee.phase === "return") {
    // The DOORS, not the whole wall. Aiming at any wall cell was fine while the
    // wall could be cut; once it could not, bees flew to a spot they could
    // never enter and no round finished at all.
    for (let c = 0; c < g.cells; c++) if (board.mouth[c]) out.push(c);
    return out;
  }
  return [0]; // the queen
}

/**
 * A distance field toward this bee's current goal, under its own reading of
 * what digging costs — in TICKS, because ticks are what decide a round.
 *
 * That weight is the whole difference between the strategies: truthful weights
 * make a bot cross the hive to reach an open shaft, and a weight equal to
 * flying makes it bore straight and eat the delay.
 */
function toGoal(round: Round, bee: Bee, digWeight: number) {
  const key = `${bee.phase}:${digWeight}`;
  return field(round.board, goals(round, bee), round.rules.cooldownTicks, digWeight, key);
}

/** Step to whichever neighbour sits lowest in the field. */
function descend(round: Round, bee: Bee, digWeight: number): Action {
  const f = toGoal(round, bee, digWeight);
  let best = -1;
  let bestD = Infinity;
  for (const n of neighbors(round.board.g, bee.cell)) {
    // Only consider moves the rules would actually allow. Under the stagger a
    // bot that picks the forbidden inward cell just stalls, which would read as
    // the rule being punishing when it is the bot being stupid.
    const kind = round.board.state[n] === OPEN ? "fly" : "dig";
    if (!legal(round, bee, { kind, to: n } as Action)) continue;
    const d = f.dist[n];
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  if (best < 0 || !Number.isFinite(bestD)) return { kind: "wait" };
  return round.board.state[best] === OPEN ? { kind: "fly", to: best } : { kind: "dig", to: best };
}

/** The control: straight at the queen, dig whatever is in the way, think nothing. */
function bore(round: Round, bee: Bee): Action {
  const g = round.board.g;
  const r = ringOf(g, bee.cell);
  // In the meadow there is nothing to bore through, so even the control has to
  // find a flower and a door. It does so on hop count alone.
  // Tunnelling AND inside. A bee in the meadow has no ring, so `g.offset[r]`
  // is undefined there and the drill arithmetic quietly becomes NaN — harmless
  // today because `legal` rejects it, but only by luck.
  if (bee.phase !== "tunnel" || !isHive(g, bee.cell))
    return descend(round, bee, round.rules.cooldownTicks);
  const i = bee.cell - g.offset[r];
  const target = inward(g, r, i);
  if (target === null) return { kind: "wait" };
  const drill: Action =
    round.board.state[target] === OPEN
      ? { kind: "fly", to: target }
      : { kind: "dig", to: target };
  // Drill when the way down is open to it. Shuffle blindly when it is not.
  //
  // This used to return the inward move unconditionally and `apply` rejected
  // it — changing nothing, INCLUDING the cooldown, so the bee re-offered the
  // same illegal move every tick for the rest of the round. One sat on a hive
  // door for 46 seconds with a rival in the single cell below it and the wall
  // either side uncuttable, holding the entrance shut against eleven others.
  //
  // The fallback is deliberately a BLIND step, not `descend`. Routing round the
  // obstacle was the obvious repair and it quietly destroyed what this bot is
  // for: "drill, and plan when you cannot" is a good strategy, and bore went
  // from winning 5% to winning 44% — the control beating everything it exists
  // to be the baseline for. It has to stay stupid. It just cannot stay stupid
  // in a doorway.
  return legal(round, bee, drill) ? drill : randomBot(round, bee);
}

/** Weighs a dig at what it truly costs in time, so it crosses to open shafts. */
function rider(round: Round, bee: Bee): Action {
  return descend(round, bee, round.rules.cooldownTicks + round.rules.digDelayTicks);
}

/** Treats comb as no slower than air, so it cuts its own line and eats the delay. */
function digger(round: Round, bee: Bee): Action {
  return descend(round, bee, round.rules.cooldownTicks);
}

function sealer(round: Round, bee: Bee, rate: number): Action {
  const { board } = round;
  const behind = bee.prevCell;
  if (
    bee.phase === "tunnel" &&
    behind >= 0 &&
    board.state[behind] === OPEN &&
    !board.mouth[behind] &&
    round.rng() < rate
  ) {
    const r = ringOf(board.g, behind);
    const occupied = round.bees.some((b) => b.phase !== "done" && b.cell === behind);
    if (r >= 1 && r <= board.g.R && !occupied && chasedFrom(round, bee, behind))
      return { kind: "collapse", at: behind };
  }
  return digger(round, bee);
}

/** Is anyone close enough behind to be worth the cooldown of burying the way? */
function chasedFrom(round: Round, bee: Bee, behind: number): boolean {
  const ns = neighbors(round.board.g, behind);
  return round.bees.some(
    (b) => b.id !== bee.id && b.phase === "tunnel" && (b.cell === behind || ns.includes(b.cell)),
  );
}

/**
 * One step along the cheapest way to wherever the player tapped.
 *
 * The tap names a destination, not a direction: at four hives on a phone a
 * single cell is a few millimetres across, and asking someone to hit the exact
 * neighbour they want would make the game a test of fingertip precision. The
 * route is recomputed every move, so a collapse ahead re-routes on its own.
 */
export type Bodies = "wall" | "ghost" | "jam";

/**
 * What a body in the way costs, on top of the cell's own fare: the wait it
 * usually is.
 *
 * The player's step is planned with bodies as JAMS, not walls, and that is the
 * fix for a bee that went forward and back and forward between the same cells.
 * With bodies as walls, a rival stepping into the next cell flipped the whole
 * shortest route to a detour — often outward — and their stepping out flipped
 * it back, a fare paid each way. A price is smooth where a wall is a cliff: a
 * short jam is worth waiting out, a long one is worth going round, and a rival
 * shuffling one cell does not turn the plan inside out.
 */
function jamCost(rules: Round["rules"]): number {
  return rules.cooldownTicks * 2;
}

function costToTarget(round: Round, bee: Bee, target: number, bodies: Bodies): Float64Array {
  const { rules, board } = round;
  const g = board.g;

  // A field over STATES, not cells: (cell, has-just-moved-inward).
  //
  // A plain cell field cannot express the stagger, and the failure is not
  // subtle — it ping-pongs. Having stepped inward, the next inward move is
  // barred, and the cheapest legal move is usually back OUTWARD into open
  // tunnel rather than sideways into comb that must be cut. From there inward
  // is legal again, so the bee oscillates between two rings forever, paying a
  // fare each time. Traced at rings 11 and 12 for the whole of a round.
  //
  // Doubling the state space fixes it by construction: arriving somewhere
  // "already committed" is a different position from arriving free, and the
  // search can see that.
  const N = g.cells;
  const dist = new Float64Array(N * 2).fill(Infinity);
  const buckets: number[][] = [];
  const push = (state: number, d: number) => {
    if (d >= dist[state]) return;
    dist[state] = d;
    (buckets[d] ||= []).push(state);
  };
  // Both arrival states of the target are done.
  push(target, 0);
  push(target + N, 0);

  const fly = rules.cooldownTicks;
  const digCost = rules.cooldownTicks + rules.digDelayTicks;

  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (const state of bucket) {
      if (dist[state] !== d) continue;
      const cell = state % N;
      // Searching BACKWARDS from the target: `armed` is the state we would be
      // in on arriving here, so a predecessor is any cell that could step in.
      const armedHere = state >= N;
      // Another bee's body — in the meadow as much as in the comb — is a wall,
      // a ghost or a jam. See `Bodies`.
      const occupied =
        rules.occupancy &&
        bodies !== "ghost" &&
        round.bees.some((b) => b.id !== bee.id && b.phase !== "done" && b.cell === cell);
      if (occupied && bodies === "wall") continue;
      const toll = occupied ? jamCost(rules) : 0;
      for (const prev of neighbors(g, cell)) {
        if (board.blocked[cell]) continue;
        const wentInward = ringOf(g, cell) < ringOf(g, prev) && ringOf(g, prev) <= g.R;
        if (wentInward !== armedHere) continue;
        const w = (board.state[cell] === OPEN ? fly : digCost) + toll;
        if (rules.staggerRequired && wentInward) {
          // Only reachable from a predecessor that was NOT already committed.
          push(prev, d + w);
        } else {
          push(prev, d + w);
          push(prev + N, d + w);
        }
      }
    }
  }

  return dist;
}

/**
 * One step along the cheapest way to `target`, or null when the right thing
 * to do is wait.
 *
 * Bodies are jams, not walls (see `Bodies`), and the step must get STRICTLY
 * nearer by that measure from the state the bee is actually in — committed by
 * the stagger, or free. A step that does not get nearer is a step back, and a
 * bee that steps back pays a fare to be where it was: when the only way on is
 * through somebody, the answer is to stand still until they move, which for a
 * player costs nothing at all.
 */
export function stepToward(round: Round, bee: Bee, target: number): Action | null {
  if (target === bee.cell) return null;
  const dist = costToTarget(round, bee, target, "jam");
  const N = round.board.g.cells;
  const here = dist[bee.cell + (bee.cameInward ? N : 0)];
  const step = pick(round, bee, dist);
  if (!step) return null;
  return step.d < here ? step.action : null;
}

/**
 * Is a rival the reason the bee is not moving — standing in the cell the route
 * wants next? What the hint says when a step is refused, or when the step on
 * offer is the one beside a door somebody is in.
 */
export function heldUp(round: Round, bee: Bee, target: number): boolean {
  if (target === bee.cell) return false;
  const { board, rules } = round;
  const g = board.g;
  const N = g.cells;
  const dist = costToTarget(round, bee, target, "jam");
  let best = -1;
  let bestD = Infinity;
  for (const n of neighbors(g, bee.cell)) {
    if (board.blocked[n]) continue;
    const armedAfter = ringOf(g, n) < ringOf(g, bee.cell) && ringOf(g, bee.cell) <= g.R;
    const d = dist[armedAfter ? n + N : n];
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  if (best < 0) return false;
  return rules.occupancy && round.bees.some((b) => b.id !== bee.id && b.phase !== "done" && b.cell === best);
}

/** The best legal neighbour under a cost field. Shared by both callers above. */
/** The legal neighbour lowest in the field, with its cost, or null. */
function pick(round: Round, bee: Bee, dist: Float64Array): { action: Action; d: number } | null {
  const { board } = round;
  const g = board.g;
  const N = g.cells;
  let best = -1;
  let bestD = Infinity;
  for (const n of neighbors(g, bee.cell)) {
    const kind = board.state[n] === OPEN ? "fly" : "dig";
    if (!legal(round, bee, { kind, to: n } as Action)) continue;
    const armedAfter =
      ringOf(g, n) < ringOf(g, bee.cell) && ringOf(g, bee.cell) <= g.R;
    const d = dist[armedAfter ? n + N : n];
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  if (best < 0 || !Number.isFinite(bestD)) return null;
  return { action: board.state[best] === OPEN ? { kind: "fly", to: best } : { kind: "dig", to: best }, d: bestD };
}

function randomBot(round: Round, bee: Bee): Action {
  // Blind, but not illegal. It used to pick any neighbour at all, so it could
  // offer the exact inward move the stagger had just barred — a refused move,
  // a wasted cooldown, and on a one-second clock the whole turn. Being stupid
  // is this bot's job; being rejected is not.
  const ns = neighbors(round.board.g, bee.cell).filter((n) => {
    const kind = round.board.state[n] === OPEN ? "fly" : "dig";
    return legal(round, bee, { kind, to: n } as Action);
  });
  if (!ns.length) return { kind: "wait" };
  const to = ns[Math.floor(round.rng() * ns.length)];
  return round.board.state[to] === OPEN ? { kind: "fly", to } : { kind: "dig", to };
}

export interface BotOpts {
  sabotageRate: number;
}

export const DEFAULT_BOT_OPTS: BotOpts = { sabotageRate: 0.25 };

export function chooseAction(round: Round, bee: Bee, opts = DEFAULT_BOT_OPTS): Action {
  switch (bee.strategy) {
    case "human":
      // A person's bee waits until a person says otherwise. It must never fall
      // through to the random bot, or the interface will appear to play itself.
      return { kind: "wait" };
    case "bore":
      return bore(round, bee);
    case "rider":
      return rider(round, bee);
    case "digger":
      return digger(round, bee);
    case "sealer":
      return sealer(round, bee, opts.sabotageRate);
    default:
      return randomBot(round, bee);
  }
}

export { COMB, OPEN };

/**
 * The whole path a bee would take to `target`, not just its next step.
 *
 * Once a tap sets a DESTINATION rather than a neighbour, the player has
 * committed to a route they cannot see — and the moment that route matters is
 * the moment a rival collapses part of it or parks in the shaft. Drawing it is
 * what turns "press the button forty times" back into a decision you can watch
 * being kept or broken.
 *
 * Planned as though nobody were in the way, deliberately. Bodies move between
 * now and then, so routing around where a bee happens to be standing would draw
 * a detour that is already wrong by the time the player reads it. What the line
 * shows is intent; `stepToward` is what actually respects the traffic.
 */
export function routeToward(round: Round, bee: Bee, target: number, max = 80): number[] {
  const g = round.board.g;
  const N = g.cells;
  if (target === bee.cell) return [];
  const dist = costToTarget(round, bee, target, "jam");

  const path: number[] = [];
  const seen = new Set<number>([bee.cell]);
  let cell = bee.cell;
  let armed = bee.cameInward;

  for (let i = 0; i < max && cell !== target; i++) {
    let best = -1;
    let bestD = Infinity;
    for (const n of neighbors(g, cell)) {
      if (round.board.blocked[n]) continue;
      // The FIRST cell is the step the bee will actually take, and a body
      // standing there is a wall this second whatever it costs in the field —
      // so the line starts where the bee will go, not through somebody.
      // Further along, bodies will have moved, and the field's price for them
      // is the honest guess.
      if (i === 0 && round.rules.occupancy && round.bees.some((b) => b.id !== bee.id && b.phase !== "done" && b.cell === n)) continue;
      const wentInward = ringOf(g, n) < ringOf(g, cell) && ringOf(g, cell) <= g.R;
      // The stagger shapes the drawn line too, or it would promise a straight
      // shaft the rules will not let the bee cut.
      if (round.rules.staggerRequired && armed && wentInward) continue;
      const d = dist[wentInward ? n + N : n];
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (best < 0 || !Number.isFinite(bestD) || seen.has(best)) break;
    path.push(best);
    seen.add(best);
    armed = ringOf(g, best) < ringOf(g, cell) && ringOf(g, cell) <= g.R;
    cell = best;
  }
  return path;
}
