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
  if (bee.phase !== "tunnel") return descend(round, bee, round.rules.cooldownTicks);
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
function costToTarget(round: Round, bee: Bee, target: number, ignoreBodies: boolean): Float64Array {
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
      for (const prev of neighbors(g, cell)) {
        if (board.blocked[cell]) continue;
        // Another bee's body is a wall for as long as it stands there — in the
        // meadow as much as in the comb. `ignoreBodies` asks the other question:
        // where would this bee go if nobody were in the way? That route is what
        // lets a bee queue toward a door somebody is standing in, instead of
        // being told there is no way through.
        if (
          rules.occupancy &&
          !ignoreBodies &&
          round.bees.some((b) => b.id !== bee.id && b.phase !== "done" && b.cell === cell)
        )
          continue;
        const wentInward = ringOf(g, cell) < ringOf(g, prev) && ringOf(g, prev) <= g.R;
        if (wentInward !== armedHere) continue;
        if (rules.staggerRequired && wentInward) {
          // Only reachable from a predecessor that was NOT already committed.
          push(prev, d + (board.state[cell] === OPEN ? fly : digCost));
        } else {
          const w = board.state[cell] === OPEN ? fly : digCost;
          push(prev, d + w);
          push(prev + N, d + w);
        }
      }
    }
  }

  return dist;
}

/**
 * One step along the quickest route to `target`, or null if there is no route.
 *
 * Bodies count: a cell somebody is standing in is a wall for as long as they
 * stand there, so this returns null when a rival is the only thing in the way.
 * `approach` is the answer to that case.
 */
export function stepToward(round: Round, bee: Bee, target: number): Action | null {
  if (target === bee.cell) return null;
  const dist = costToTarget(round, bee, target, false);
  return pick(round, bee, dist);
}

/**
 * One step that gets NEARER the target, even when the route is currently taken.
 *
 * "No way through" is true and useless. Every door may have a queue and a bee
 * has to be near its chosen door anyway, so when a rival is standing in the
 * only way in, the right answer is to move up beside it and wait — not to be
 * refused. The route is computed as though nobody were in the way, and then the
 * step is chosen from the moves that are actually legal, so a bee never walks
 * through anyone: it just knows which way to queue.
 *
 * Returns null only when no legal move gets closer at all, which is a genuine
 * wait rather than a mistake.
 */
export function approach(round: Round, bee: Bee, target: number): Action | null {
  if (target === bee.cell) return null;
  const g = round.board.g;
  const ghost = costToTarget(round, bee, target, true);
  const N = g.cells;
  const here = Math.min(ghost[bee.cell], ghost[bee.cell + N]);
  const step = pick(round, bee, ghost);
  if (!step || step.kind === "wait" || step.kind === "collapse") return null;
  // It must actually close the gap. Without this a queued bee shuffles sideways
  // for ever, paying a fare each time to stay exactly where it was.
  const after = Math.min(ghost[step.to], ghost[step.to + N]);
  return after < here ? step : null;
}

/** The best legal neighbour under a cost field. Shared by both callers above. */
function pick(round: Round, bee: Bee, dist: Float64Array): Action | null {
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
  return board.state[best] === OPEN ? { kind: "fly", to: best } : { kind: "dig", to: best };
}

function randomBot(round: Round, bee: Bee): Action {
  const ns = neighbors(round.board.g, bee.cell);
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
