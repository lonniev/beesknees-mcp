/**
 * A match is five hives racing.
 *
 * Twelve seats each, and the whole thing starts as soon as ANY hive has eight
 * bees in it. The split is not cosmetic: simulation showed that sixty bees
 * racing to one queen is close to a lottery, because first-past-the-post among
 * that many near-identical racers is an extreme-value draw and those are decided
 * by variance rather than by skill. Twelve to a hive puts the judgement back.
 *
 * One queen is reached first across all five hives and that bee takes the
 * round. Winning your own hive is skill-weighted; which hive finishes first is
 * a fair draw among five leaders, and an unbiased second stage does not erode
 * the first — so the skill signal survives intact.
 *
 * Five rather than four is a screen decision that costs the game nothing: two
 * hives flank the board you are playing on either side, which is balanced, and
 * per-hive dynamics are untouched because the tuning is per hive.
 */

import {
  type Bee,
  type Round,
  type Rules,
  DEFAULT_RULES,
  apply,
  makeGeometry,
  makeRound,
  mulberry32,
  progress,
  ringOf,
} from "./rules.ts";
import { STRATEGIES, chooseAction } from "./bots.ts";

export const HIVES = 5;
export const SEATS = 12;
/** Bees in any one hive that get the whole match moving. */
export const QUORUM = 8;
/**
 * How close to the queen counts as the exciting part.
 *
 * The inner rings are where the field narrows and the race is actually decided,
 * so a hive with somebody down there is worth looking at whether or not it is
 * yours. Five of twenty-four, which is roughly the point where a bee has fewer
 * cells to choose between than it has rivals.
 */
export const HOT_RING = 5;

export type MatchState = "forming" | "running" | "ended";

export interface Seat {
  beeId: number;
  /** Empty for a bot. A real patron's key goes here. */
  npub: string;
  label: string;
  bot: string;
}

export interface Hive {
  id: number;
  name: string;
  round: Round;
  seats: Seat[];
}

export interface Match {
  hives: Hive[];
  state: MatchState;
  tick: number;
  /** Set the moment a bee reaches any queen. */
  winner: { hive: number; beeId: number; label: string } | null;
  /** The seat the human is playing, if any. */
  you: { hive: number; beeId: number } | null;
  rules: Rules;
  rng: () => number;
}

/** All five are real bee forage, which is the point of the whole exercise. */
const HIVE_NAMES = ["Linden", "Clover", "Thistle", "Borage", "Heather"];

/** Distinguishable names for bots, so a rival reads as somebody. */
const BOT_NAMES = [
  "Ambrose", "Bramble", "Cinder", "Dapple", "Ember", "Fennel",
  "Gossamer", "Hazel", "Ivy", "Juniper", "Kestrel", "Larkspur",
  "Mallow", "Nettle", "Ochre", "Pippin", "Quill", "Rowan",
  "Sorrel", "Tansy", "Umber", "Vervain", "Willow", "Yarrow",
];

function emptyHive(id: number, rules: Rules, rng: () => number): Hive {
  // A round is built for a full house so the geometry never changes underfoot,
  // then unfilled seats are simply not played.
  const round = makeRound(new Array(SEATS).fill("rider"), rules, rng, makeGeometry());
  return { id, name: HIVE_NAMES[id], round, seats: [] };
}

export function makeMatch(rules: Rules = DEFAULT_RULES, seed = Date.now()): Match {
  const rng = mulberry32(seed);
  return {
    hives: Array.from({ length: HIVES }, (_, i) => emptyHive(i, rules, rng)),
    state: "forming",
    tick: 0,
    winner: null,
    you: null,
    rules,
    rng,
  };
}

/** The bees actually in play — a seat that nobody bought does not fly. */
export function seated(hive: Hive): Bee[] {
  return hive.seats.map((s) => hive.round.bees[s.beeId]);
}

/**
 * Put a bee in the hive that is closest to getting the match moving.
 *
 * Filling the fullest hive that still has room reaches the quorum of eight
 * soonest, which is what a patron who has just paid actually wants. Spreading
 * arrivals evenly would look tidier and keep everybody waiting.
 */
export function join(match: Match, npub: string, label: string, bot = ""): Seat | null {
  const open = match.hives
    .filter((h) => h.seats.length < SEATS)
    .sort((a, b) => b.seats.length - a.seats.length);
  if (!open.length) return null;

  const hive = open[0];
  const beeId = hive.seats.length;
  const seat: Seat = { beeId, npub, label, bot };
  hive.seats.push(seat);
  hive.round.bees[beeId].strategy = bot || "human";
  if (!npub) return seat;

  match.you = { hive: hive.id, beeId };
  return seat;
}

export function quorumReached(match: Match): boolean {
  return match.hives.some((h) => h.seats.length >= QUORUM);
}

export function totalSeated(match: Match): number {
  return match.hives.reduce((a, h) => a + h.seats.length, 0);
}

export function start(match: Match): void {
  if (match.state === "forming" && quorumReached(match)) match.state = "running";
}

/**
 * Solo mode — the whole match filled with bots except one seat.
 *
 * Not a toy: it is how the interface gets exercised before seven other people
 * have paid to be in the room, and it is the only way to see a full board
 * without an audience. Strategies are dealt round-robin so every rival style
 * is on show.
 */
export function makeSoloMatch(label = "You", seed = Date.now()): Match {
  const match = makeMatch(DEFAULT_RULES, seed);
  const bots = STRATEGIES.filter((s) => s !== "random");
  let n = 0;
  for (let h = 0; h < HIVES; h++) {
    for (let s = 0; s < SEATS; s++) {
      const first = h === 0 && s === 0;
      join(
        match,
        first ? "you" : "",
        first ? label : BOT_NAMES[n % BOT_NAMES.length],
        first ? "" : bots[n % bots.length],
      );
      n++;
    }
  }
  match.state = "running";
  return match;
}

/**
 * Advance every hive by one tick.
 *
 * Bots choose for themselves; the human's bee moves only when told to, which is
 * why its action arrives from outside rather than from a strategy.
 */
export function step(match: Match, humanAction: ReturnType<typeof chooseAction> | null): void {
  if (match.state !== "running") return;

  for (const hive of match.hives) {
    const round = hive.round;
    round.tick = match.tick;

    const due = seated(hive).filter((b) => b.phase !== "done" && b.nextMoveTick <= match.tick);
    // Shuffle, or seat order becomes a standing advantage in every tie.
    for (let i = due.length - 1; i > 0; i--) {
      const j = Math.floor(match.rng() * (i + 1));
      [due[i], due[j]] = [due[j], due[i]];
    }

    for (const bee of due) {
      const isYou = match.you && match.you.hive === hive.id && match.you.beeId === bee.id;
      if (isYou) {
        if (humanAction) apply(round, bee, humanAction);
        continue;
      }
      apply(round, bee, chooseAction(round, bee));
    }

    if (round.winner >= 0 && !match.winner) {
      const seat = hive.seats.find((s) => s.beeId === round.winner)!;
      match.winner = { hive: hive.id, beeId: round.winner, label: seat.label };
      match.state = "ended";
    }
  }

  match.tick++;
  if (match.tick >= match.rules.maxTicks && !match.winner) {
    // The ceiling fell. The bee nearest a queen takes it, so a round can stall
    // but can never simply fail to have a winner.
    let best: { hive: Hive; bee: Bee; p: number } | null = null;
    for (const hive of match.hives)
      for (const bee of seated(hive)) {
        const p = progress(hive.round.board, bee, match.rules);
        if (!best || p < best.p) best = { hive, bee, p };
      }
    if (best) {
      const seat = best.hive.seats.find((s) => s.beeId === best!.bee.id)!;
      match.winner = { hive: best.hive.id, beeId: best.bee.id, label: seat.label };
    }
    match.state = "ended";
  }
}

/** The lowest ring any bee in this hive has reached. */
export function deepestRing(hive: Hive): number {
  const g = hive.round.board.g;
  let best = g.maxRing;
  for (const bee of seated(hive)) {
    const r = ringOf(g, bee.cell);
    if (r < best) best = r;
  }
  return best;
}

/** Is somebody in this hive close enough to the queen to be worth watching? */
export function isHot(hive: Hive): boolean {
  return deepestRing(hive) <= HOT_RING;
}

/** Every seated bee across every hive, nearest the queen first. */
export function standings(match: Match): { hive: Hive; bee: Bee; seat: Seat; p: number }[] {
  const all = match.hives.flatMap((hive) =>
    hive.seats.map((seat) => ({
      hive,
      seat,
      bee: hive.round.bees[seat.beeId],
      p: progress(hive.round.board, hive.round.bees[seat.beeId], match.rules),
    })),
  );
  return all.sort((a, b) => a.p - b.p);
}
