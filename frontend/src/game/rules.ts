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
 * Fourteen rings and the stagger rule together: 365 cells, a round landing near
 * two and a half minutes, and a good player beating an adequate one about 3.5
 * times as often. The straight-line driller wins ZERO percent, which is the
 * whole point of the stagger — before it, boring a radial shaft beat routing.
 *
 * Twenty-four rings without the stagger gave 1.8x and a driller on 22%; with
 * the stagger it gave 4.2x but a four-and-a-half-minute round. Fourteen keeps
 * nearly all the skill and hands back the two minutes.
 */
export const BOARD = { wall: 14, meadowRings: 4, cellW: 3.0 } as const;

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
  /**
   * Cells that can never be cut — capped brood, stone-hard old wax.
   *
   * A uniform comb has only ONE gradient, radial, so every sideways step is as
   * good as every other and a bee under the stagger rule simply spirals:
   * measured at 18 cells travelled round with 0.7 reversals of direction, which
   * is a race round and round rather than a routing problem.
   *
   * Obstructions rather than merely-expensive cells, deliberately. Doubling the
   * dig cost of a third of the comb produced the variability (5.3 reversals) and
   * tripled the round past its ceiling — nothing finished. An impassable cell
   * forces the same detour and costs no time at all to meet.
   *
   * Five percent, measured: reversals go 0.6 -> 5.4 with the round unchanged at
   * two and a half minutes. Ten percent starts pushing rounds into the ceiling
   * and fifteen puts the median there. It also un-solves the game — one
   * strategy on 68% becomes three between 27 and 45.
   */
  blocked: Uint8Array;
  flower: Uint8Array;
  /**
   * Which flowers still hold pollen.
   *
   * A flower is emptied by whoever reaches it first, so the one you aimed at
   * can be gone by the time you arrive and you have to choose again. That is
   * the meadow's only real decision — without it, every flower is identical
   * and the first act is pure distance.
   */
  pollen: Uint8Array;
  mouth: Uint8Array;
  /** Bumped on every dig or collapse, so distance fields know to recompute. */
  version: number;
}

export interface BoardOpts {
  mouths: number;
  flowers: number;
  /** Share of comb cells that are impassable. 0 makes every hive identical. */
  blockShare: number;
  rng: () => number;
}

export function makeBoard(g: Geometry, o: BoardOpts): Board {
  const state = new Uint8Array(g.cells);
  const flower = new Uint8Array(g.cells);
  const mouth = new Uint8Array(g.cells);
  const blocked = new Uint8Array(g.cells);
  const pollen = new Uint8Array(g.cells);

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

  // Flowers scatter through the meadow, but never on the two outermost rings.
  //
  // Bees start spread around the outermost ring, so a flower there — or one ring
  // in — is a bee that begins ON its pollen or one press away from it. Whoever
  // was seeded next to a flower would win the first act for free. Keeping the
  // outer two rings clear makes the shortest possible forage two presses, for
  // everybody.
  const innerMeadow = Math.max(1, g.meadowRings - 2);
  let placed = 0;
  let guard = 0;
  while (placed < o.flowers && guard++ < o.flowers * 100) {
    const r = g.R + 1 + Math.floor(o.rng() * innerMeadow);
    const c = idx(g, r, Math.floor(o.rng() * g.size[r]));
    if (!flower[c]) {
      flower[c] = 1;
      pollen[c] = 1;
      placed++;
    }
  }
  // Obstructions. Never on ring 1 — with only six cells there, two blocks could
  // wall the queen in and end a round nobody could win.
  for (let r = 2; r <= g.R; r++)
    for (let i = 0; i < g.size[r]; i++)
      if (o.rng() < o.blockShare) blocked[idx(g, r, i)] = 1;

  const board = { g, state, flower, pollen, mouth, blocked, version: 0 };
  clearBlocksUntilQueenIsReachable(board);
  return board;
}

// ── Bees ─────────────────────────────────────────────────────────────────

export interface Bee {
  id: number;
  strategy: string;
  cell: number;
  /** The cell just vacated — what a sealer buries behind itself. */
  prevCell: number;
  /** Was the last move inward? The stagger rule reads this. */
  cameInward: boolean;
  /** Net rotation in cells: +ve clockwise. A spiral shows up as a big number. */
  netTurn: number;
  /** How often the bee REVERSED its way round. Zero means a pure spiral. */
  turnSwitches: number;
  /** The last tangential direction taken, or 0 if none yet. */
  lastTurn: number;
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
  /** Whether a cell inside the hive holds only one bee. */
  occupancy: boolean;
  /** Share of comb that is impassable — the texture that makes routing a choice. */
  blockShare: number;
  /** Whether a collapse may target any cell, or only one next to the bee. */
  collapseRange: "anywhere" | "adjacent";
  /**
   * Forbid two inward moves in a row, so a bee must step sideways between them.
   *
   * Without it a bee can drill a straight radial shaft while a smarter one
   * carves a long arc, and the driller simply wins on distance. The stagger is
   * the hive changing level: you cut down, you shift along, you cut down again.
   */
  staggerRequired: boolean;
  /**
   * Cooldowns a collapse costs the bee that buys it.
   *
   * It was free, deliberately — the one place spending bought position without
   * spending time. Once bees had BODIES that changed: a seal now traps a rival
   * where it also blocks everyone behind it, and free sealing took 57% of
   * rounds. One cooldown brings it to 48.5% against the digger's 40.5% and
   * pulls the p90 round from 6:14 to 4:22.
   *
   * Spending still buys position — a seal costs one move and sets a rival back
   * several — it is simply no longer free while doing it.
   */
  collapseTicks: number;
}

export const DEFAULT_RULES: Rules = {
  costs: DEFAULT_COSTS,
  cooldownTicks: 20, // 20 x 100ms = 2s
  digDelayTicks: 60, // a dug cell costs four cooldowns in all
  maxTicks: 6000, // 10 minutes
  collapseRange: "anywhere",
  collapseTicks: 20,
  staggerRequired: true,
  blockShare: 0.05,
  occupancy: true,
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
  const { board, rules } = round;
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
  if (board.blocked[a.to]) return false;

  // A bee has a body. Inside the hive a cell holds ONE of them, so a bee in
  // front of you is an obstacle to route around or to bury — not something to
  // walk through. The meadow is air and exempt: bees pass each other there at
  // different heights, and enforcing it above ground only gridlocks the start,
  // where all twelve are on one ring by construction.
  if (
    rules.occupancy &&
    ringOf(g, a.to) <= g.R &&
    round.bees.some((b) => b.id !== bee.id && b.phase !== "done" && b.cell === a.to)
  )
    return false;
  // The stagger: no two inward moves back to back. Applies to flying as well as
  // digging, or a bee would simply ride a straight shaft somebody else cut.
  if (round.rules.staggerRequired && bee.cameInward && ringOf(g, a.to) < ringOf(g, bee.cell))
    return false;
  if (a.kind === "fly") return board.state[a.to] === OPEN;

  // The WALL cannot be cut. Only the doors get you in.
  //
  // It was diggable, and measurement said 80% of bees simply chopped their own
  // hole rather than fly to a mouth — which made the doors decoration and the
  // wall a formality. A hive you can enter anywhere has no chokepoint and no
  // reason to look at where anyone else is going.
  if (ringOf(g, a.to) === g.R) return false;
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

  // Tangential bookkeeping, so the simulation can answer whether the stagger
  // turns the hive into a spiral race or a genuine routing problem.
  const rFrom = ringOf(g, bee.cell);
  const rTo = ringOf(g, a.to);
  if (rFrom === rTo && g.size[rFrom] > 2) {
    const n = g.size[rFrom];
    const from = bee.cell - g.offset[rFrom];
    const to = a.to - g.offset[rTo];
    // Shortest way round, so wrapping the ring does not read as a huge jump.
    let d = to - from;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    const dir = Math.sign(d);
    if (dir !== 0) {
      if (bee.lastTurn !== 0 && dir !== bee.lastTurn) bee.turnSwitches++;
      bee.lastTurn = dir;
      bee.netTurn += d;
    }
  }
  // Passing through a DOOR is not cutting down a level, so it does not arm the
  // stagger. It used to, and the combination deadlocked every bee at the
  // threshold: it could not go inward (stagger) and could not go sideways (the
  // wall is uncuttable), so no round finished at all.
  bee.cameInward = rTo < rFrom && rFrom <= g.R;
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

  if (bee.phase === "forage" && board.pollen[bee.cell]) {
    // Taken. The flower stays on the board — an empty one is information — but
    // nobody else can load from it.
    board.pollen[bee.cell] = 0;
    board.version++;
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

/**
 * Unblock cells until the queen can be reached from everywhere that matters.
 *
 * Generated obstructions can wall the chamber off, and a round nobody can win
 * is worse than a boring one. Rather than rejecting the whole board and
 * re-rolling — which loops unboundedly on a bad seed — this opens the fewest
 * cells that restore the connection, then checks again.
 */
function clearBlocksUntilQueenIsReachable(board: Board): void {
  const g = board.g;
  for (let attempt = 0; attempt < 200; attempt++) {
    const seen = new Uint8Array(g.cells);
    const stack = [0];
    seen[0] = 1;
    let n = 1;
    while (stack.length) {
      const c = stack.pop()!;
      for (const nb of neighbors(g, c)) {
        if (!seen[nb] && !board.blocked[nb]) {
          seen[nb] = 1;
          n++;
          stack.push(nb);
        }
      }
    }
    const unreachable: number[] = [];
    for (let c = 0; c < g.cells; c++) if (!seen[c] && !board.blocked[c]) unreachable.push(c);
    if (!unreachable.length && n > g.cells / 2) return;

    // Open the blocked cell that touches the reached region, so the frontier
    // grows rather than a random hole appearing in the middle of nowhere.
    let opened = false;
    for (let c = 0; c < g.cells && !opened; c++) {
      if (!board.blocked[c]) continue;
      if (neighbors(g, c).some((nb) => seen[nb])) {
        board.blocked[c] = 0;
        opened = true;
      }
    }
    if (!opened) return;
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
        if (board.blocked[n]) continue;
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
  const board = makeBoard(g, { mouths: 4, flowers: 24, blockShare: rules.blockShare, rng });
  const outer = g.maxRing;
  const bees: Bee[] = strategies.map((strategy, id) => ({
    id,
    strategy,
    // Spread evenly around the outermost ring, so nobody starts nearer a door
    // than anyone else by accident.
    cell: idx(g, outer, Math.floor((id * g.size[outer]) / strategies.length)),
    prevCell: -1,
    cameInward: false,
    netTurn: 0,
    turnSwitches: 0,
    lastTurn: 0,
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
