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
  return round.board.state[target] === OPEN
    ? { kind: "fly", to: target }
    : { kind: "dig", to: target };
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
export function stepToward(round: Round, bee: Bee, target: number): Action | null {
  if (target === bee.cell) return null;
  const { rules, board } = round;
  const dig = rules.cooldownTicks + rules.digDelayTicks;
  const f = field(board, [target], rules.cooldownTicks, dig, `to:${target}`);
  let best = -1;
  let bestD = f.dist[bee.cell];
  for (const n of neighbors(board.g, bee.cell)) {
    if (f.dist[n] < bestD) {
      bestD = f.dist[n];
      best = n;
    }
  }
  if (best < 0) return null;
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
