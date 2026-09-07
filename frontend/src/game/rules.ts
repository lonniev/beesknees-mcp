/**
 * The Bee's Knees — the rules, with nothing else attached.
 *
 * No network, no money, no identity. This module is the disposable simulation's
 * only durable part: it ports to `geometry.py` on the server and to the SVG
 * renderer in the frontend, and both of those must agree with it exactly.
 *
 * The board is TWO grids. Outside is a square lattice of open meadow; inside is
 * a polar one whose rings narrow toward the queen. They meet only at the doors.
 * See `Geometry` below for why it is worth having two.
 *
 * Costs here are RELATIVE EFFORT WEIGHTS for comparing strategies. They are not
 * prices and must never be read as any. What a motion costs a patron is set at
 * runtime in the pricing model.
 */

export type CellState = 0 | 1; // 0 = comb (must be dug), 1 = open
/** Half-width of the square field, in view units. Mirrors polar.ts's VIEW. */
export const VIEW_HALF = 100;
/** Share of the half-width taken by the hive disc. Mirrors polar.ts's HIVE_SHARE. */
export const HIVE_SHARE = 0.8;

export const COMB: CellState = 0;
export const OPEN: CellState = 1;

/** Wall-clock milliseconds per simulated tick. */
export const TICK_MS = 100;

export type Phase = "forage" | "return" | "tunnel" | "done";

/**
 * TWO geometries, joined at the doors.
 *
 * The meadow is a SQUARE LATTICE and the hive is CONCENTRIC RINGS, because the
 * two halves of this game want opposite things of a grid. Outside, a bee crosses
 * open ground toward a hive it can see from anywhere, and what matters is
 * heading and distance — which is what a square lattice measures and what makes
 * a far corner genuinely far. Inside, every bee is converging on one cell at the
 * centre and the field has to NARROW as they close on it; that funnel is what
 * rings are for, and it is the whole reason the hive is radial.
 *
 * One geometry stretched across both jobs was wrong in both directions. Rings
 * that stop at the hive leave the square's corners painted and uninhabited.
 * Rings pushed out to the corners put 140 of 491 cells off-screen, where they
 * had to be blocked, skipped by the connectivity repair, and hidden from the
 * eye — bookkeeping in three places to hide a mismatch, instead of not having
 * one.
 *
 * Cell ids run hive-first: `0 .. hiveCells-1` are polar, the rest are meadow.
 */
export interface Geometry {
  /** Hive wall ring. Ring 0 is the queen, 1..R-1 comb, R the wall with its doors. */
  R: number;
  /** Cells in each hive ring, indexed by ring 0..R. */
  size: number[];
  /** Flat-index offset of each hive ring's first cell. */
  offset: number[];
  /** How many cells the polar half holds. Meadow ids begin here. */
  hiveCells: number;
  /** The ring number reported for EVERY meadow cell. The meadow has no rings. */
  maxRing: number;
  /** Side of the meadow lattice, in cells. */
  gridN: number;
  /** View units per lattice square. */
  step: number;
  /** Lattice slot (row*gridN + col) -> cell id, or -1 where the hive covers it. */
  slotCell: Int32Array;
  /** Meadow cell id minus `hiveCells` -> its lattice slot. */
  cellSlot: Int32Array;
  meadowCells: number;
  cells: number;
  /** Wall slot -> the meadow square beyond it. The seam, and the only way through. */
  doorOut: Int32Array;
  /** Meadow cell id -> the wall cells that open onto it. */
  doorIn: Map<number, number[]>;
}

/**
 * The shipped board, settled by simulation rather than by taste.
 *
 * Fourteen rings and the stagger rule together: a round landing near two and a
 * half minutes, and a good player beating an adequate one about 3.5 times as
 * often. The straight-line driller wins ZERO percent, which is the whole point
 * of the stagger — before it, boring a radial shaft beat routing.
 *
 * Twenty-four rings without the stagger gave 1.8x and a driller on 22%; with
 * the stagger it gave 4.2x but a four-and-a-half-minute round. Fourteen keeps
 * nearly all the skill and hands back the two minutes.
 *
 * Sixteen lattice squares to a side leaves two of them of clear air above a
 * cardinal door and about five on the diagonal, so the corners a bee starts in
 * are a real flight from the nearest way in.
 */
export const BOARD = { wall: 14, gridN: 16, cellW: 3.0 } as const;

export function makeGeometry(
  R: number = BOARD.wall,
  gridN: number = BOARD.gridN,
  cellW: number = BOARD.cellW,
): Geometry {
  const size: number[] = [];
  const offset: number[] = [];
  let hiveCells = 0;
  for (let r = 0; r <= R; r++) {
    // Ring 0 is a single chamber. Everything else scales with circumference,
    // floored at 6 so the innermost rings stay navigable rather than degenerate.
    const n = r === 0 ? 1 : Math.max(6, Math.round((2 * Math.PI * r) / cellW));
    offset.push(hiveCells);
    size.push(n);
    hiveCells += n;
  }

  const step = (2 * VIEW_HALF) / gridN;
  const hiveR = HIVE_SHARE * VIEW_HALF;
  const slotCell = new Int32Array(gridN * gridN).fill(-1);
  const cellSlot: number[] = [];
  for (let row = 0; row < gridN; row++) {
    for (let col = 0; col < gridN; col++) {
      const x = -VIEW_HALF + step * (col + 0.5);
      const y = -VIEW_HALF + step * (row + 0.5);
      // A square with the hive under its middle is not meadow. The hive is
      // painted over the lattice, so the ragged seam never shows.
      if (Math.hypot(x, y) <= hiveR) continue;
      slotCell[row * gridN + col] = hiveCells + cellSlot.length;
      cellSlot.push(row * gridN + col);
    }
  }

  const g: Geometry = {
    R,
    size,
    offset,
    hiveCells,
    maxRing: R + 1,
    gridN,
    step,
    slotCell,
    cellSlot: Int32Array.from(cellSlot),
    meadowCells: cellSlot.length,
    cells: hiveCells + cellSlot.length,
    doorOut: new Int32Array(size[R]).fill(-1),
    doorIn: new Map(),
  };

  // The seam. Each wall cell opens onto the lattice square beyond its middle,
  // found by probing outward — the first square out is occasionally one the
  // hive swallowed, and a door onto nothing is a door nobody can use.
  for (let i = 0; i < size[R]; i++) {
    const a = ((i + 0.5) / size[R]) * Math.PI * 2 - Math.PI / 2;
    for (let d = 0.6; d < 4; d += 0.5) {
      const reach = hiveR + step * d;
      const c = meadowAt(g, Math.cos(a) * reach, Math.sin(a) * reach);
      if (c === null) continue;
      g.doorOut[i] = c;
      const back = g.doorIn.get(c);
      if (back) back.push(idx(g, R, i));
      else g.doorIn.set(c, [idx(g, R, i)]);
      break;
    }
  }
  return g;
}

/** Is this cell in the hive rather than the meadow? */
export function isHive(g: Geometry, cell: number): boolean {
  return cell < g.hiveCells;
}

/** Lattice row and column of a meadow cell. */
export function rowCol(g: Geometry, cell: number): [number, number] {
  const slot = g.cellSlot[cell - g.hiveCells];
  return [Math.floor(slot / g.gridN), slot % g.gridN];
}

/** The meadow square holding a point, or null — off the field, or under the hive. */
export function meadowAt(g: Geometry, x: number, y: number): number | null {
  const col = Math.floor((x + VIEW_HALF) / g.step);
  const row = Math.floor((y + VIEW_HALF) / g.step);
  if (col < 0 || col >= g.gridN || row < 0 || row >= g.gridN) return null;
  const c = g.slotCell[row * g.gridN + col];
  return c < 0 ? null : c;
}

/**
 * Radius of a hive ring's inner edge, in view units.
 *
 * Duplicated from `polar.ts` deliberately: the RULES need the geometry and the
 * renderer must not be a dependency of them. `polar.test.ts` asserts the two agree.
 */
export function ringR(g: Geometry, r: number): number {
  return (Math.min(r, g.R + 1) / (g.R + 1)) * HIVE_SHARE * VIEW_HALF;
}

/** Centre of a cell in view coordinates, whichever geometry it belongs to. */
export function cellCentre(g: Geometry, cell: number): [number, number] {
  if (!isHive(g, cell)) {
    const [row, col] = rowCol(g, cell);
    return [-VIEW_HALF + g.step * (col + 0.5), -VIEW_HALF + g.step * (row + 0.5)];
  }
  const r = ringOf(g, cell);
  if (r === 0) return [0, 0];
  const i = cell - g.offset[r];
  const mid = (ringR(g, r) + ringR(g, r + 1)) / 2;
  const a = ((i + 0.5) / g.size[r]) * Math.PI * 2 - Math.PI / 2;
  return [mid * Math.cos(a), mid * Math.sin(a)];
}

export function idx(g: Geometry, r: number, i: number): number {
  return g.offset[r] + (((i % g.size[r]) + g.size[r]) % g.size[r]);
}

/** Ring of a hive cell; `maxRing` for anything out in the meadow. */
export function ringOf(g: Geometry, cell: number): number {
  if (cell >= g.hiveCells) return g.maxRing;
  for (let r = g.R; r >= 0; r--) if (cell >= g.offset[r]) return r;
  return 0;
}

/** Slot within its ring, or -1 for a meadow cell, which has no ring to sit in. */
export function slotOf(g: Geometry, cell: number): number {
  if (cell >= g.hiveCells) return -1;
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

/** Every cell one step outward from a hive cell. Usually one or two. */
export function outward(g: Geometry, r: number, i: number): number[] {
  // Out of the WALL there is no ring, only the seam: the square beyond this
  // door. Whether it may be crossed is the cell's state, not its geometry.
  if (r >= g.R) {
    const c = g.doorOut[i];
    return c < 0 ? [] : [c];
  }
  const out: number[] = [];
  const n = g.size[r + 1];
  for (let j = 0; j < n; j++) {
    if (Math.floor((j * g.size[r]) / n) === i) out.push(idx(g, r + 1, j));
  }
  return out;
}

/**
 * Neighbours of a cell, in whichever geometry it lives.
 *
 * In the hive: inward, outward and the two tangential cells. Tangential
 * movement is what makes it a maze rather than a set of lanes — it is how a bee
 * slides onto someone else's open shaft, or steps out from under a collapse.
 *
 * In the meadow: all eight compass directions, because a bee flies and a flight
 * that can only turn right angles reads as a machine. Plus any door that opens
 * onto this square, which is the only place the two geometries touch.
 */
export function neighbors(g: Geometry, cell: number): number[] {
  if (!isHive(g, cell)) {
    const [row, col] = rowCol(g, cell);
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const r2 = row + dr;
        const c2 = col + dc;
        if (r2 < 0 || r2 >= g.gridN || c2 < 0 || c2 >= g.gridN) continue;
        const n = g.slotCell[r2 * g.gridN + c2];
        if (n >= 0) out.push(n);
      }
    }
    const doors = g.doorIn.get(cell);
    if (doors) out.push(...doors);
    return out;
  }

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
  /**
   * Which board this is. Distance fields are cached, and the cache is global —
   * so without an identity here, five hives with five different boards shared
   * one entry and whichever computed first won. Every other hive's bees then
   * descended a stranger's map: they converged on doors that were open in hive
   * 0 and solid in theirs, and all five hives showed bees in identical spots.
   */
  id: number;
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
  /**
   * The hive this seed lays out — starts, flowers and obstructions together.
   *
   * Passed in whole rather than rolled here, because the SERVER lays out a live
   * hive from the match seed and the client must draw the same one. Two places
   * generating "the same" board from the same numbers is how they drift; there
   * is one generator now, in `hiveLayout`, and both sides call it.
   */
  layout: HiveLayout;
}

/** Monotonic, so two boards are never confused for one another in a cache. */
let nextBoardId = 1;

export function makeBoard(g: Geometry, o: BoardOpts): Board {
  const state = new Uint8Array(g.cells);
  const flower = new Uint8Array(g.cells);
  const mouth = new Uint8Array(g.cells);
  const blocked = new Uint8Array(g.cells);
  const pollen = new Uint8Array(g.cells);

  // The meadow is open air. The hive starts solid all the way down; the queen
  // chamber is the prize and must be dug into like anything else.
  for (let c = g.hiveCells; c < g.cells; c++) state[c] = OPEN;

  // Mouths: evenly spaced doors in the wall, open from the start. They are a
  // convenience, not a hard gate — a bee may always pay to dig its own door.
  for (const c of mouthCells(g, o.mouths)) {
    state[c] = OPEN;
    mouth[c] = 1;
  }

  for (const c of o.layout.flowers) {
    flower[c] = 1;
    pollen[c] = 1;
  }
  for (const c of o.layout.blocked) blocked[c] = 1;

  const board = { id: nextBoardId++, g, state, flower, pollen, mouth, blocked, version: 0 };
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
  /**
   * What the bee is busy doing while its delay runs.
   *
   * The delay used to be reported as "Resting" whatever caused it, which told
   * the player their bee was idle at the exact moment it was working hardest.
   * A bee that has just cut through eight seconds of wax is not resting, and
   * saying so made an honest cost read as a lazy animal.
   */
  lastAction: "fly" | "dig" | "collapse" | "wait" | null;
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
  // A bee crawls quickly and digs slowly, and the gap between the two IS the
  // game.
  //
  // An eight-second wait after cutting one cell read as a lazy bee, because the
  // cell opened at once and the bee then sat still. The wait was never the
  // problem; it was being called a rest. So crawling is a second and cutting is
  // eight, and the interface says "Digging" while it happens.
  //
  // Measured over 250 rounds, this is also the best of the four settings tried.
  // Widening the gap between travelling and cutting is exactly what makes
  // riding somebody else's shaft worth the detour:
  //
  //   crawl 1s dig 4s   median 1:50  reversals 8.3   rider 13%  (too short)
  //   crawl 1s dig 8s   median 3:23  reversals 13.7  rider 18%  <- this
  //   crawl 2s dig 8s   median 3:38  reversals 8.1   rider 11%  (was)
  //
  // Most routing and the most contested field of anything tried: 36/34/18/12
  // across digger, sealer, rider and the driller, where a uniform share is 20.
  cooldownTicks: 10, // 10 x 100ms = 1s to crawl or fly
  digDelayTicks: 70, // a cut costs EIGHT times a move, and shows it
  maxTicks: 6000, // 10 minutes
  collapseRange: "anywhere",
  collapseTicks: 10,
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

  // A bee has a body, everywhere. A cell holds ONE of them, so a bee in front of
  // you is an obstacle to route around, to wait behind, or to bury — never
  // something to walk through.
  //
  // The meadow used to be exempt, on the grounds that enforcing bodies above
  // ground would gridlock a start where all twelve bees stood on one ring. They
  // start in the four corners now, on twelve distinct squares, so the reason is
  // gone — and the exemption was letting five bees pile into the one square
  // outside a door, which is what made a doorway look deadlocked.
  if (
    rules.occupancy &&
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
    bee.lastAction = "wait";
    bee.lastDelayTicks = rules.cooldownTicks;
    bee.nextMoveTick = round.tick + rules.cooldownTicks;
    return true;
  }

  if (a.kind === "collapse") {
    board.state[a.at] = COMB;
    board.version++;
    bee.spend += rules.costs.collapse;
    bee.collapses++;
    bee.lastAction = "collapse";
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
  if (rFrom === rTo && rFrom <= g.R && g.size[rFrom] > 2) {
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
  bee.lastAction = a.kind;
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
    for (let c = 0; c < g.cells; c++)
      if (!seen[c] && !board.blocked[c]) unreachable.push(c);
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
  // Scoped to the BOARD. The caller's key describes what is being asked for
  // (phase, dig weight); it cannot describe which of five hives is asking, and
  // the version counters of two fresh boards are both zero.
  const scoped = `${board.id}:${key}`;
  const cached = fieldCache.get(scoped);
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
  fieldCache.set(scoped, f);
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

/**
 * Where a bee begins: out at the corners, never in front of a door.
 *
 * Doors sit at the four cardinal points of the wall, so the four DIAGONALS are
 * the furthest a bee can start from any of them — nobody is handed a door, and
 * everyone has to cross the meadow to find one. Bees cluster in fours around
 * each diagonal on adjacent slots, spread rather than stacked, which also puts
 * them in the corners of a square meadow where there was previously nothing.
 */
export function cornerStarts(g: Geometry, seats: number, rng?: () => number): number[] {
  // The four corners of the square, in view coordinates.
  const corners: [number, number][] = [
    [VIEW_HALF, -VIEW_HALF],
    [VIEW_HALF, VIEW_HALF],
    [-VIEW_HALF, VIEW_HALF],
    [-VIEW_HALF, -VIEW_HALF],
  ];
  // Which corner a seat draws is dealt, not fixed. Without this the twelve
  // bees opened in the same twelve cells in every hive of every match — the
  // obstructions varied and the opening never did, so each round began by
  // looking exactly like the last one.
  if (rng) {
    for (let i = corners.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [corners[i], corners[j]] = [corners[j], corners[i]];
    }
  }

  // Every meadow square is a candidate; the hive is not.
  const usable: number[] = [];
  for (let c = g.hiveCells; c < g.cells; c++) usable.push(c);

  const taken = new Set<number>();
  const out: number[] = [];
  for (let i = 0; i < seats; i++) {
    const [cx, cy] = corners[i % corners.length];
    // The nearest free square to that corner, or — when there is randomness to
    // spend — one of the nearest few. Strictly nearest packs every bee into the
    // same tight clump against the point; a little spread keeps them in the
    // corner without making the opening a fixed picture.
    const ranked = usable
      .filter((c) => !taken.has(c))
      .map((c) => {
        const [x, y] = cellCentre(g, c);
        return { c, d: (x - cx) ** 2 + (y - cy) ** 2 };
      })
      .sort((a, b) => a.d - b.d);
    if (!ranked.length) break;
    const pool = rng ? Math.min(3, ranked.length) : 1;
    const best = ranked[rng ? Math.floor(rng() * pool) : 0].c;
    if (best < 0) break;
    taken.add(best);
    out.push(best);
  }
  return out;
}

/** Flowers scattered across one hive's meadow. Mirrors geometry.py's FLOWERS. */
export const FLOWERS = 24;
/** Seats in a hive. Mirrors match.ts's SEATS and geometry.py's. */
export const SEATS = 12;

export interface HiveLayout {
  starts: number[];
  flowers: number[];
  blocked: Set<number>;
}

/**
 * Everything about one hive that its seed decides, drawn from ONE stream.
 *
 * Starts, then flowers, then obstructions — the order matters, because
 * `geometry.py` draws them in exactly this order from exactly this PRNG and the
 * two must produce the same hive from the same seed. The server enforces this
 * board and the client draws it; a disagreement is a bee refused a move for a
 * reason nobody can see on screen.
 *
 * Nothing is stored. A hive IS its seed, which is why `match_state` has to send
 * one.
 */
export function hiveLayout(g: Geometry, seed: number): HiveLayout {
  const rng = mulberry32(seed);
  const starts = cornerStarts(g, SEATS, rng);
  const flowers = flowerCells(g, rng, starts);
  const blocked = obstructions(g, rng);
  return { starts, flowers, blocked };
}

/**
 * Where the pollen is. Never on a starting square or one touching it — a bee
 * that opens on its own flower has won the first act before pressing anything.
 */
export function flowerCells(g: Geometry, rng: () => number, starts: number[], count = FLOWERS): number[] {
  const near = new Set<number>(starts);
  for (const st of starts) for (const n of neighbors(g, st)) near.add(n);
  const out: number[] = [];
  const seen = new Set<number>();
  let guard = 0;
  while (out.length < count && guard < count * 200) {
    guard++;
    const c = g.hiveCells + Math.floor(rng() * g.meadowCells);
    if (near.has(c) || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/** Impassable cells. See `makeBoard` for which places never get one, and why. */
export function obstructions(g: Geometry, rng: () => number, share = DEFAULT_RULES.blockShare): Set<number> {
  const spared = new Set<number>();
  for (const m of mouthCells(g))
    for (const n of neighbors(g, m)) if (ringOf(g, n) < ringOf(g, m)) spared.add(n);
  const out = new Set<number>();
  for (let r = 2; r < g.R; r++) {
    for (let i = 0; i < g.size[r]; i++) {
      // The die is rolled for every candidate either way, so the sequence stays
      // identical to geometry.py's — a spared cell must still consume its draw.
      const hit = rng() < share;
      const c = idx(g, r, i);
      if (hit && !spared.has(c)) out.add(c);
    }
  }
  return out;
}

/** The doors, evenly spaced. Mirrors geometry.py's `mouth_cells`. */
export function mouthCells(g: Geometry, mouths = 4): number[] {
  return Array.from({ length: mouths }, (_, m) => idx(g, g.R, Math.floor((m * g.size[g.R]) / mouths)));
}

export function makeRound(
  strategies: string[],
  rules: Rules,
  rng: () => number,
  geo?: Geometry,
): Round {
  const g = geo ?? makeGeometry();
  // One seed lays out the whole hive, through the same function the server
  // uses. Solo and live are then the same board, drawn once, by one generator.
  const layout = hiveLayout(g, Math.floor(rng() * 2 ** 31));
  const { starts } = layout;
  const board = makeBoard(g, { mouths: 4, layout });
  const bees: Bee[] = strategies.map((strategy, id) => ({
    id,
    strategy,
    cell: starts[id] ?? starts[starts.length - 1] ?? g.hiveCells,
    prevCell: -1,
    cameInward: false,
    lastAction: null,
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
