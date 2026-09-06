/**
 * The Bee's Knees — the rules, with nothing else attached.
 *
 * No network, no money, no identity. This module is the disposable simulation's
 * only durable part: it ports to `geometry.py` on the server and to the SVG
 * renderer in the frontend, and both of those must agree with it exactly.
 *
 * The board is a POLAR cell grid. Ring 0 is the queen chamber, ring `R` is the
 * hive wall, and rings above `R` are open meadow. Cells per ring scale with
 * circumference, so the field NARROWS toward the queen — that funnel is the
 * whole reason the layout is radial rather than square, and it is what turns
 * fifty bees spread along a wall into a scrum at the centre.
 *
 * Costs here are RELATIVE EFFORT WEIGHTS for comparing strategies. They are not
 * prices and must never be read as any. What a motion costs a patron is set at
 * runtime in the pricing model.
 */

export type CellState = 0 | 1; // 0 = comb (must be dug), 1 = open
export const COMB: CellState = 0;
export const OPEN: CellState = 1;

/** Wall-clock milliseconds per simulated tick. */
export const TICK_MS = 100;

export type Phase = "forage" | "return" | "tunnel" | "done";

export interface Geometry {
  /** Hive wall ring. Rings 1..R are comb; ring 0 is the queen chamber. */
  R: number;
  /** Open-air rings above the wall: R+1 .. R+meadowRings. */
  meadowRings: number;
  /** Outermost ring index. */
  maxRing: number;
  /** Cells in each ring, indexed by ring. */
  size: number[];
  /** Flat-index offset of each ring's first cell. */
  offset: number[];
  /** Total cells. */
  cells: number;
}

/**
 * The shipped board, settled by simulation rather than by taste.
 *
 * 857 cells is the number that matters as much as the others: it is small
 * enough that four hives render at once on a phone, and deep enough that a
 * round lands near two minutes with a good player beating an adequate one
 * roughly 1.8 times as often. Finer rings made a prettier comb and a board
 * nobody could draw four of.
 */
export const BOARD = { wall: 24, meadowRings: 4, cellW: 3.0 } as const;

export function makeGeometry(
  R: number = BOARD.wall,
  meadowRings: number = BOARD.meadowRings,
  cellW: number = BOARD.cellW,
): Geometry {
  const maxRing = R + meadowRings;
  const size: number[] = [];
  const offset: number[] = [];
  let total = 0;
  for (let r = 0; r <= maxRing; r++) {
    // Ring 0 is a single chamber. Everything else scales with circumference,
    // floored at 6 so the innermost rings stay navigable rather than degenerate.
    const n = r === 0 ? 1 : Math.max(6, Math.round((2 * Math.PI * r) / cellW));
    offset.push(total);
    size.push(n);
    total += n;
  }
  return { R, meadowRings, maxRing, size, offset, cells: total };
}

export function idx(g: Geometry, r: number, i: number): number {
  return g.offset[r] + (((i % g.size[r]) + g.size[r]) % g.size[r]);
}

export function ringOf(g: Geometry, cell: number): number {
  for (let r = g.maxRing; r >= 0; r--) if (cell >= g.offset[r]) return r;
  return 0;
}

export function slotOf(g: Geometry, cell: number): number {
  return cell - g.offset[ringOf(g, cell)];
}

/**
 * The single cell one ring inward.
 *
 * Rings shrink as they descend, so this map is many-to-one: several outer cells
 * funnel into one inner cell. That pinch is the contention the game is built on
 * — it is not an artefact of the index arithmetic, it is the point of it.
 */
export function inward(g: Geometry, r: number, i: number): number | null {
  if (r === 0) return null;
  const j = Math.floor((i * g.size[r - 1]) / g.size[r]);
  return idx(g, r - 1, j);
}

/** Every cell one ring outward that funnels into this one. Usually one or two. */
export function outward(g: Geometry, r: number, i: number): number[] {
  if (r >= g.maxRing) return [];
  const out: number[] = [];
  const n = g.size[r + 1];
  for (let j = 0; j < n; j++) {
    if (Math.floor((j * g.size[r]) / n) === i) out.push(idx(g, r + 1, j));
  }
  return out;
}

/**
 * Neighbours of a cell: inward, outward, and the two tangential cells.
 *
 * Tangential movement is what makes this a maze rather than a set of lanes —
 * it is how a bee slides sideways onto someone else's open shaft, or steps out
 * from under a collapse.
 */
export function neighbors(g: Geometry, cell: number): number[] {
  const r = ringOf(g, cell);
  const i = cell - g.offset[r];
  const out: number[] = [];
  const inw = inward(g, r, i);
  if (inw !== null) out.push(inw);
  for (const o of outward(g, r, i)) out.push(o);
  if (g.size[r] > 1) {
    out.push(idx(g, r, i + 1));
    if (g.size[r] > 2) out.push(idx(g, r, i - 1));
  }
  return out;
}

// ── The board ────────────────────────────────────────────────────────────

export interface Board {
  g: Geometry;
  state: Uint8Array;
  flower: Uint8Array;
  mouth: Uint8Array;
  /** Bumped on every dig or collapse, so distance fields know to recompute. */
  version: number;
}

export interface BoardOpts {
  mouths: number;
  flowers: number;
  rng: () => number;
}

export function makeBoard(g: Geometry, o: BoardOpts): Board {
  const state = new Uint8Array(g.cells);
  const flower = new Uint8Array(g.cells);
  const mouth = new Uint8Array(g.cells);

  // Meadow is open air. Rings 0..R start solid; the queen chamber is the prize
  // and must be dug into like anything else.
  for (let r = g.R + 1; r <= g.maxRing; r++)
    for (let i = 0; i < g.size[r]; i++) state[idx(g, r, i)] = OPEN;

  // Mouths: evenly spaced doors in the wall, open from the start. They are a
  // convenience, not a hard gate — a bee may always pay to dig its own door.
  for (let m = 0; m < o.mouths; m++) {
    const i = Math.floor((m * g.size[g.R]) / o.mouths);
    const c = idx(g, g.R, i);
    state[c] = OPEN;
    mouth[c] = 1;
  }

  // Flowers scatter through the meadow.
  let placed = 0;
  let guard = 0;
  while (placed < o.flowers && guard++ < o.flowers * 100) {
    const r = g.R + 1 + Math.floor(o.rng() * g.meadowRings);
    const c = idx(g, r, Math.floor(o.rng() * g.size[r]));
    if (!flower[c]) {
      flower[c] = 1;
      placed++;
    }
  }
  return { g, state, flower, mouth, version: 0 };
}

// ── Bees ─────────────────────────────────────────────────────────────────

export interface Bee {
  id: number;
  strategy: string;
  cell: number;
  /** The cell just vacated — what a sealer buries behind itself. */
  prevCell: number;
  phase: Phase;
  nextMoveTick: number;
  /** Relative effort spent. Not sats. */
  spend: number;
  moves: number;
  meadowMoves: number;
  digs: number;
  collapses: number;
  collapsedOn: number;
  /** How long the delay just served was, so a cooldown ring can fill honestly. */
  lastDelayTicks: number;
  /** Tick this bee first got inside the wall — where the meadow half ends. */
  enteredHiveTick: number;
  finishedTick: number;
}

export interface Costs {
  fly: number;
  dig: number;
  collapse: number;
}

export const DEFAULT_COSTS: Costs = { fly: 1, dig: 3, collapse: 8 };

export interface Rules {
  costs: Costs;
  cooldownTicks: number;
  /**
   * Extra cooldowns owed after breaking fresh comb.
   *
   * This is the load-bearing rule. A first pass with digging and flying on the
   * same clock made riding a rival's shaft strictly worse than boring your own:
   * the fare saved was real but fares do not win races, so the whole dig-or-ride
   * choice collapsed and the thoughtless control led the field. Cutting comb has
   * to cost TIME for an open tunnel to be worth crossing the hive to reach.
   */
  digDelayTicks: number;
  maxTicks: number;
  /** Whether a collapse may target any cell, or only one next to the bee. */
  collapseRange: "anywhere" | "adjacent";
  /**
   * Cooldowns a collapse costs the bee that buys it.
   *
   * Set this to a full cooldown and collapsing is a move not made, so it always
   * loses ground and no one rationally does it. At zero it is the one place in
   * the game where SPENDING converts into position rather than into nothing —
   * which is the whole reason there is a game to play rather than fifty bees on
   * identical clocks arriving in a random order.
   */
  collapseTicks: number;
}

export const DEFAULT_RULES: Rules = {
  costs: DEFAULT_COSTS,
  cooldownTicks: 20, // 20 x 100ms = 2s
  digDelayTicks: 60, // a dug cell costs four cooldowns in all
  maxTicks: 6000, // 10 minutes
  collapseRange: "anywhere",
  collapseTicks: 0,
};

export interface Round {
  board: Board;
  bees: Bee[];
  rules: Rules;
  tick: number;
  winner: number;
  rng: () => number;
}

export type Action =
  | { kind: "fly"; to: number }
  | { kind: "dig"; to: number }
  | { kind: "collapse"; at: number }
  | { kind: "wait" };

/** Is this a legal action for this bee right now? Pure; no mutation. */
export function legal(round: Round, bee: Bee, a: Action): boolean {
  const { board } = round;
  const g = board.g;
  if (bee.phase === "done") return false;
  if (a.kind === "wait") return true;

  if (a.kind === "collapse") {
    const r = ringOf(g, a.at);
    // The meadow cannot be collapsed (it is open air) and neither can the queen
    // chamber — burying the prize would end a round with nobody able to win it.
    if (r < 1 || r > g.R) return false;
    if (board.state[a.at] !== OPEN) return false;
    if (board.mouth[a.at]) return false;
    if (round.bees.some((b) => b.phase !== "done" && b.cell === a.at)) return false;
    if (round.rules.collapseRange === "adjacent" && !neighbors(g, bee.cell).includes(a.at))
      return false;
    return true;
  }

  if (!neighbors(g, bee.cell).includes(a.to)) return false;
  if (a.kind === "fly") return board.state[a.to] === OPEN;
  return board.state[a.to] === COMB; // dig
}

/**
 * Apply an action. Returns false if it was not legal — which the caller must
 * believe, exactly as the server's fenced CAS will: a rejected move changed
 * nothing, and pretending otherwise is how a double-move gets built.
 */
export function apply(round: Round, bee: Bee, a: Action): boolean {
  if (!legal(round, bee, a)) return false;
  const { board, rules } = round;
  const g = board.g;

  if (a.kind === "wait") {
    bee.lastDelayTicks = rules.cooldownTicks;
    bee.nextMoveTick = round.tick + rules.cooldownTicks;
    return true;
  }

  if (a.kind === "collapse") {
    board.state[a.at] = COMB;
    board.version++;
    bee.spend += rules.costs.collapse;
    bee.collapses++;
    bee.lastDelayTicks = rules.collapseTicks;
    bee.nextMoveTick = round.tick + rules.collapseTicks;
    return true;
  }

  let delay = rules.cooldownTicks;
  if (a.kind === "dig") {
    board.state[a.to] = OPEN;
    board.version++;
    bee.spend += rules.costs.dig;
    bee.digs++;
    delay += rules.digDelayTicks;
  } else {
    bee.spend += rules.costs.fly;
  }

  if (ringOf(g, bee.cell) > g.R) bee.meadowMoves++;
  bee.prevCell = bee.cell;
  bee.cell = a.to;
  bee.moves++;
  bee.lastDelayTicks = delay;
  bee.nextMoveTick = round.tick + delay;
  advancePhase(round, bee);
  return true;
}

/** The three acts, resolved from where the bee now stands. */
function advancePhase(round: Round, bee: Bee): void {
  const { board } = round;
  const g = board.g;
  const r = ringOf(g, bee.cell);

  if (bee.phase === "forage" && board.flower[bee.cell]) {
    bee.phase = "return";
    return;
  }
  if (bee.phase === "return" && r <= g.R) {
    bee.phase = "tunnel";
    bee.enteredHiveTick = round.tick;
    return;
  }
  if (bee.phase === "tunnel" && r === 0) {
    bee.phase = "done";
    bee.finishedTick = round.tick;
    if (round.winner < 0) round.winner = bee.id;
  }
}

// ── Distance fields ──────────────────────────────────────────────────────
//
// Every tunnelling bee is heading for the same cell, so a single Dijkstra from
// ring 0 outward answers all of them at once. Bots then just descend the field.
// Cached on board version, because recomputing per bee per tick is what makes a
// naive simulation too slow to answer anything.

export interface Field {
  dist: Float64Array;
  version: number;
}

const fieldCache = new Map<string, Field>();

/**
 * Cost-to-reach every cell from `sources`, where entering a comb cell costs
 * `digWeight` and an open cell costs `flyWeight`.
 *
 * `digWeight` is what separates the strategies: weight it truthfully and a bot
 * prefers existing tunnels; weight it equal to flying and the bot bores a
 * straight shaft and pays for it.
 */
export function field(
  board: Board,
  sources: number[],
  flyWeight: number,
  digWeight: number,
  key: string,
): Field {
  const cached = fieldCache.get(key);
  if (cached && cached.version === board.version) return cached;

  const g = board.g;
  const dist = new Float64Array(g.cells).fill(Infinity);
  // Bucket queue: weights are small integers, so this beats a binary heap and
  // keeps the whole sweep linear in the number of cells.
  const buckets: number[][] = [];
  const push = (c: number, d: number) => {
    if (d >= dist[c]) return;
    dist[c] = d;
    (buckets[d] ||= []).push(c);
  };
  for (const s of sources) push(s, 0);

  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (const c of bucket) {
      if (dist[c] !== d) continue; // stale entry
      for (const n of neighbors(g, c)) {
        const w = board.state[n] === OPEN ? flyWeight : digWeight;
        push(n, d + w);
      }
    }
  }

  const f = { dist, version: board.version };
  fieldCache.set(key, f);
  return f;
}

export function clearFieldCache(): void {
  fieldCache.clear();
}

/**
 * How far a bee still is from the queen, measured in TICKS rather than fares.
 *
 * Time is what decides a round, so it is also what "closest" has to mean. Rank
 * by money and a thrifty bee that is nowhere near the queen reads as the leader.
 */
export function toQueen(board: Board, cell: number, rules: Rules): number {
  const fly = rules.cooldownTicks;
  const dig = rules.cooldownTicks + rules.digDelayTicks;
  return field(board, [0], fly, dig, `queen:${fly}:${dig}`).dist[cell];
}

/** Rank key — lower is better. Phase first, then remaining time to the queen. */
export function progress(board: Board, bee: Bee, rules: Rules): number {
  const order = { done: 0, tunnel: 1, return: 2, forage: 3 } as const;
  return order[bee.phase] * 1e7 + (bee.phase === "done" ? 0 : toQueen(board, bee.cell, rules));
}

// ── Setting up a round ───────────────────────────────────────────────────

export function makeRound(
  strategies: string[],
  rules: Rules,
  rng: () => number,
  geo?: Geometry,
): Round {
  const g = geo ?? makeGeometry();
  const board = makeBoard(g, { mouths: 4, flowers: 24, rng });
  const outer = g.maxRing;
  const bees: Bee[] = strategies.map((strategy, id) => ({
    id,
    strategy,
    // Spread evenly around the outermost ring, so nobody starts nearer a door
    // than anyone else by accident.
    cell: idx(g, outer, Math.floor((id * g.size[outer]) / strategies.length)),
    prevCell: -1,
    phase: "forage" as Phase,
    nextMoveTick: 0,
    spend: 0,
    moves: 0,
    meadowMoves: 0,
    digs: 0,
    collapses: 0,
    collapsedOn: 0,
    lastDelayTicks: 0,
    enteredHiveTick: -1,
    finishedTick: -1,
  }));
  clearFieldCache();
  return { board, bees, rules, tick: 0, winner: -1, rng };
}

/** Deterministic RNG, so a surprising round can be replayed exactly. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
