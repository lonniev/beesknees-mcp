/**
 * Invariants of the board.
 *
 * These lock the properties the game rests on rather than the numbers a
 * particular tuning happens to have. `geometry.py` on the server and the SVG
 * renderer in the frontend must both satisfy the same assertions, or three
 * copies of the rules will drift and only the players will notice.
 *
 *   node --test sim/rules.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMB,
  OPEN,
  apply,
  DEFAULT_RULES,
  field,
  idx,
  inward,
  makeBoard,
  makeGeometry,
  makeRound,
  mulberry32,
  neighbors,
  outward,
  ringOf,
  toQueen,
} from "./rules.ts";

test("rings narrow toward the queen — the funnel is real", () => {
  const g = makeGeometry(22, 4);
  for (let r = 2; r <= g.maxRing; r++) {
    assert.ok(
      g.size[r] >= g.size[r - 1],
      `ring ${r} (${g.size[r]}) must not be smaller than ring ${r - 1} (${g.size[r - 1]})`,
    );
  }
  // And the narrowing must actually bite: the wall has to be many times the
  // width of the last ring before the chamber, or there is no scrum.
  assert.ok(g.size[g.R] / g.size[1] > 6, `wall ${g.size[g.R]} vs inner ${g.size[1]}`);
  assert.equal(g.size[0], 1, "the queen chamber is one cell");
});

test("every cell round-trips through its ring and slot", () => {
  const g = makeGeometry(22, 4);
  for (let c = 0; c < g.cells; c++) {
    const r = ringOf(g, c);
    assert.equal(idx(g, r, c - g.offset[r]), c);
  }
});

test("inward and outward are consistent inverses", () => {
  const g = makeGeometry(22, 4);
  for (let r = 1; r <= g.maxRing; r++) {
    for (let i = 0; i < g.size[r]; i++) {
      const inw = inward(g, r, i)!;
      const back = outward(g, ringOf(g, inw), inw - g.offset[ringOf(g, inw)]);
      assert.ok(back.includes(idx(g, r, i)), `ring ${r} slot ${i} lost on the way back`);
    }
  }
});

test("adjacency is symmetric — no one-way passages", () => {
  const g = makeGeometry(14, 3);
  for (let c = 0; c < g.cells; c++) {
    for (const n of neighbors(g, c)) {
      assert.ok(neighbors(g, n).includes(c), `${c} -> ${n} is one-way`);
    }
  }
});

test("tangential movement wraps the ring", () => {
  const g = makeGeometry(22, 4);
  const r = 10;
  const first = idx(g, r, 0);
  const last = idx(g, r, g.size[r] - 1);
  assert.ok(neighbors(g, first).includes(last), "ring must close on itself");
});

test("the hive starts solid and the meadow starts open", () => {
  const g = makeGeometry(22, 4);
  const b = makeBoard(g, { mouths: 4, flowers: 20, blockShare: 0, rng: mulberry32(3) });
  for (let r = g.R + 1; r <= g.maxRing; r++)
    for (let i = 0; i < g.size[r]; i++) assert.equal(b.state[idx(g, r, i)], OPEN);
  for (let r = 0; r < g.R; r++)
    for (let i = 0; i < g.size[r]; i++) assert.equal(b.state[idx(g, r, i)], COMB);
  assert.equal([...b.mouth].filter(Boolean).length, 4);
  assert.equal([...b.flower].filter(Boolean).length, 20);
});

test("a dig opens the cell for everyone, and costs the digger extra time", () => {
  const round = makeRound(["digger"], DEFAULT_RULES, mulberry32(5));
  const bee = round.bees[0];
  bee.cell = idx(round.board.g, round.board.g.R, 5);
  bee.phase = "tunnel";
  const target = inward(round.board.g, round.board.g.R, 5)!;

  assert.equal(round.board.state[target], COMB);
  assert.ok(apply(round, bee, { kind: "dig", to: target }));
  assert.equal(round.board.state[target], OPEN, "a dug cell is public");
  assert.equal(
    bee.nextMoveTick,
    DEFAULT_RULES.cooldownTicks + DEFAULT_RULES.digDelayTicks,
    "cutting comb has to cost time, or riding a shaft is never worth crossing to",
  );
});

test("an illegal move changes nothing at all", () => {
  const round = makeRound(["bore"], DEFAULT_RULES, mulberry32(7));
  const bee = round.bees[0];
  const where = bee.cell;
  const far = 0; // the queen chamber, nowhere near a meadow bee
  assert.equal(apply(round, bee, { kind: "fly", to: far }), false);
  assert.equal(bee.cell, where);
  assert.equal(bee.moves, 0);
  assert.equal(bee.spend, 0);
});

test("the queen chamber and the meadow cannot be collapsed", () => {
  const round = makeRound(["sealer"], DEFAULT_RULES, mulberry32(11));
  const bee = round.bees[0];
  const g = round.board.g;
  assert.equal(apply(round, bee, { kind: "collapse", at: 0 }), false, "the prize must stay reachable");
  const meadow = idx(g, g.maxRing, 3);
  assert.equal(apply(round, bee, { kind: "collapse", at: meadow }), false, "air is not diggable");
});

test("a cell with a bee standing in it cannot be collapsed", () => {
  const round = makeRound(["sealer", "rider"], DEFAULT_RULES, mulberry32(13));
  const [a, b] = round.bees;
  const g = round.board.g;
  const cell = idx(g, 5, 2);
  round.board.state[cell] = OPEN;
  b.cell = cell;
  assert.equal(apply(round, a, { kind: "collapse", at: cell }), false);
  assert.equal(round.board.state[cell], OPEN);
});

test("collapse re-seals a cell and the distance field notices", () => {
  const round = makeRound(["sealer"], DEFAULT_RULES, mulberry32(17));
  const g = round.board.g;
  // Slot numbers do NOT line up between rings — the inward map is
  // floor(i * n(r-1) / n(r)), which is the funnel. Ask for the real neighbour.
  const outer = idx(g, 6, 2);
  const cell = inward(g, 6, 2)!;
  round.board.state[cell] = OPEN;
  round.board.version++;
  const before = toQueen(round.board, outer, round.rules);
  assert.ok(apply(round, round.bees[0], { kind: "collapse", at: cell }));
  const after = toQueen(round.board, outer, round.rules);
  assert.equal(round.board.state[cell], COMB);
  assert.equal(
    after - before,
    DEFAULT_RULES.digDelayTicks,
    "burying a shaft must cost whoever wanted it exactly one dig",
  );
});

test("the distance field is cached on board version, not stale across a dig", () => {
  // An obstruction-free board on purpose. This is testing cache invalidation,
  // and a random wall on the probe's route makes the measured difference depend
  // on the seed rather than on the thing under test.
  const round = makeRound(["digger"], { ...DEFAULT_RULES, blockShare: 0 }, mulberry32(19));
  const g = round.board.g;
  const probe = idx(g, g.R, 7);
  const step = inward(g, g.R, 7)!;
  const fly = DEFAULT_RULES.cooldownTicks;
  const dig = fly + DEFAULT_RULES.digDelayTicks;
  const first = field(round.board, [0], fly, dig, "t").dist[probe];
  round.board.state[step] = OPEN;
  round.board.version++;
  const second = field(round.board, [0], fly, dig, "t").dist[probe];
  assert.equal(
    first - second,
    DEFAULT_RULES.digDelayTicks,
    "a field that ignores a dig will route bees into walls",
  );
});

test("bees start evenly spread, so nobody is born next to a door", () => {
  const strategies = Array.from({ length: 20 }, () => "bore");
  const round = makeRound(strategies, DEFAULT_RULES, mulberry32(23));
  const g = round.board.g;
  const slots = round.bees.map((b) => b.cell - g.offset[g.maxRing]).sort((x, y) => x - y);
  const gaps = slots.slice(1).map((s, i) => s - slots[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `uneven start: ${gaps}`);
});

test("a rival empties the flower you were flying to", () => {
  // The meadow's only real decision. Without depletion every flower is
  // identical and the first act is a pure distance calculation.
  const round = makeRound(["rider", "rider"], DEFAULT_RULES, mulberry32(29));
  const g = round.board.g;
  const flower = [...Array(g.cells).keys()].find((c) => round.board.pollen[c])!;
  const [a, b] = round.bees;

  a.cell = flower;
  a.phase = "forage";
  b.cell = flower;
  b.phase = "forage";

  // The first to land takes it.
  const near = neighbors(g, flower).find((n) => round.board.state[n] === OPEN)!;
  a.cell = near;
  assert.ok(apply(round, a, { kind: "fly", to: flower }));
  assert.equal(a.phase, "return", "the first bee loads pollen");
  assert.equal(round.board.pollen[flower], 0, "and empties the flower");

  b.cell = near;
  b.nextMoveTick = round.tick;
  assert.ok(apply(round, b, { kind: "fly", to: flower }));
  assert.equal(b.phase, "forage", "the second bee arrives to nothing and must find another");
  assert.equal(round.board.flower[flower], 1, "the flower stays visible — an empty one is information");
});

test("no bee may enter an obstruction", () => {
  const round = makeRound(["rider"], DEFAULT_RULES, mulberry32(31));
  const g = round.board.g;
  const wall = [...Array(g.cells).keys()].find((c) => round.board.blocked[c]);
  if (wall === undefined) return; // this seed drew none
  const bee = round.bees[0];
  const from = neighbors(g, wall)[0];
  bee.cell = from;
  bee.phase = "tunnel";
  bee.cameInward = false;
  assert.equal(apply(round, bee, { kind: "dig", to: wall }), false, "capped brood cannot be cut");
  assert.equal(apply(round, bee, { kind: "fly", to: wall }), false, "nor flown through");
  assert.equal(bee.cell, from);
});

test("the hive wall cannot be cut — doors are the only way in", () => {
  // Measured before this rule: 80% of bees chopped their own hole rather than
  // fly to a mouth, which made the doors decoration and left the hive with no
  // chokepoint at all.
  const round = makeRound(["rider"], DEFAULT_RULES, mulberry32(37));
  const g = round.board.g;
  const bee = round.bees[0];
  const wallCell = [...Array(g.size[g.R]).keys()]
    .map((i) => idx(g, g.R, i))
    .find((c) => !round.board.mouth[c])!;
  const outside = neighbors(g, wallCell).find((n) => ringOf(g, n) > g.R)!;
  bee.cell = outside;
  bee.phase = "return";
  assert.equal(apply(round, bee, { kind: "dig", to: wallCell }), false);
  assert.equal(bee.cell, outside, "the wall turned it away");
});

test("a door does not arm the stagger, or every bee jams in the threshold", () => {
  // This combination deadlocked the whole game: entering counted as an inward
  // move, the stagger then demanded a sideways step, and sideways along the
  // wall is uncuttable. Nothing finished a round.
  const round = makeRound(["rider"], DEFAULT_RULES, mulberry32(41));
  const g = round.board.g;
  const bee = round.bees[0];
  const mouth = [...Array(g.cells).keys()].find((c) => round.board.mouth[c])!;
  const outside = neighbors(g, mouth).find((n) => ringOf(g, n) > g.R)!;
  bee.cell = outside;
  bee.phase = "return";

  assert.ok(apply(round, bee, { kind: "fly", to: mouth }), "in through the door");
  assert.equal(bee.phase, "tunnel");
  assert.equal(bee.cameInward, false, "passing a door is not cutting down a level");

  bee.nextMoveTick = round.tick;
  const inward1 = inward(g, g.R, mouth - g.offset[g.R])!;
  assert.ok(
    apply(round, bee, { kind: "dig", to: inward1 }),
    "and so the very next move may go inward",
  );
});
