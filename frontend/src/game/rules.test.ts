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
  cornerStarts,
  FLOWERS,
  hiveLayout,
  mouthCells,
  outward,
  ringOf,
  slotOf,
  cellCentre,
  VIEW_HALF,
  toQueen,
  type Phase,
} from "./rules.ts";
import { approach, routeToward, stepToward } from "./bots.ts";
import { hydrate, hiveSeed } from "./live.ts";

test("rings narrow toward the queen — the funnel is real", () => {
  const g = makeGeometry(22);
  for (let r = 2; r <= g.R; r++) {
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
  const g = makeGeometry(22);
  for (let c = 0; c < g.hiveCells; c++) {
    const r = ringOf(g, c);
    assert.equal(idx(g, r, c - g.offset[r]), c);
  }
  // A meadow cell has no ring to round-trip through, and says so rather than
  // quietly indexing past the end of the ring table.
  assert.equal(ringOf(g, g.hiveCells), g.maxRing);
  assert.equal(slotOf(g, g.hiveCells), -1);
});

test("inward and outward are consistent inverses", () => {
  const g = makeGeometry(22);
  for (let r = 1; r <= g.R; r++) {
    for (let i = 0; i < g.size[r]; i++) {
      const inw = inward(g, r, i)!;
      const back = outward(g, ringOf(g, inw), inw - g.offset[ringOf(g, inw)]);
      assert.ok(back.includes(idx(g, r, i)), `ring ${r} slot ${i} lost on the way back`);
    }
  }
});

test("adjacency is symmetric — no one-way passages", () => {
  const g = makeGeometry(14);
  for (let c = 0; c < g.cells; c++) {
    for (const n of neighbors(g, c)) {
      assert.ok(neighbors(g, n).includes(c), `${c} -> ${n} is one-way`);
    }
  }
});

test("tangential movement wraps the ring", () => {
  const g = makeGeometry(22);
  const r = 10;
  const first = idx(g, r, 0);
  const last = idx(g, r, g.size[r] - 1);
  assert.ok(neighbors(g, first).includes(last), "ring must close on itself");
});

test("the hive starts solid and the meadow starts open", () => {
  const g = makeGeometry(22);
  const b = makeBoard(g, { mouths: 4, layout: hiveLayout(g, 3) });
  for (let c = g.hiveCells; c < g.cells; c++) assert.equal(b.state[c], OPEN);
  for (let r = 0; r < g.R; r++)
    for (let i = 0; i < g.size[r]; i++) assert.equal(b.state[idx(g, r, i)], COMB);
  assert.equal([...b.mouth].filter(Boolean).length, 4);
  // Read from the shipped constant, not restated: the count is the board's
  // now, not a per-call option, and a test that names its own number cannot
  // notice the board changing.
  assert.equal([...b.flower].filter(Boolean).length, FLOWERS);
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
  const meadow = g.hiveCells + 3;
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

test("bees start in the corners, spread, and never facing a door", () => {
  // They used to be spread EVENLY around a ring, which put somebody directly in
  // front of each door — a free entrance for whoever drew that seat — and left
  // the corners of the square empty. Measured in view coordinates now, because
  // a starting cell is a meadow square and has no ring slot to reason about.
  const seats = 12;
  const round = makeRound(Array.from({ length: seats }, () => "rider"), DEFAULT_RULES, mulberry32(23));
  const g = round.board.g;
  const cells = round.bees.map((b) => b.cell);

  assert.equal(new Set(cells).size, seats, "no two bees may start in the same cell");
  for (const c of cells) assert.ok(c >= g.hiveCells, `bee starts at ${c}, inside the hive`);

  const bearing = (c: number) => {
    const [x, y] = cellCentre(g, c);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  };
  const doors = [...Array(g.cells).keys()].filter((c) => round.board.mouth[c]).map(bearing);

  for (const c of cells) {
    const gap = Math.min(...doors.map((d) => {
      const t = Math.abs(bearing(c) - d);
      return Math.min(t, 360 - t);
    }));
    assert.ok(gap > 15, `a bee starts ${gap.toFixed(0)} degrees off a door — near enough to be handed it`);
  }

  // Genuinely IN the corners, so the flight in is a journey rather than a step
  // off the wall. Both coordinates well past the hive's own half-width.
  for (const c of cells) {
    const [x, y] = cellCentre(g, c);
    assert.ok(
      Math.abs(x) > VIEW_HALF * 0.5 && Math.abs(y) > VIEW_HALF * 0.5,
      `a bee starts at ${x.toFixed(0)},${y.toFixed(0)} — not in a corner`,
    );
  }

  // Three to a corner, four corners, so no corner is crowded and none is empty.
  const perCorner = new Map<string, number>();
  for (const c of cells) {
    const [x, y] = cellCentre(g, c);
    const k = `${Math.sign(x)},${Math.sign(y)}`;
    perCorner.set(k, (perCorner.get(k) ?? 0) + 1);
  }
  assert.equal(perCorner.size, 4, `expected four corners used, got ${perCorner.size}`);
  for (const [k, n] of perCorner) assert.equal(n, seats / 4, `corner ${k} holds ${n} bees`);
});

test("a rival empties the flower you were flying to", () => {
  // The meadow's only real decision. Without depletion every flower is
  // identical and the first act is a pure distance calculation.
  const round = makeRound(["rider", "rider"], DEFAULT_RULES, mulberry32(29));
  const g = round.board.g;
  const flower = [...Array(g.cells).keys()].find((c) => round.board.pollen[c])!;
  const [a, b] = round.bees;

  // Two bees one step out, on opposite sides. They cannot start ON the flower,
  // or on the same square as each other: a bee has a body out here.
  const around = neighbors(g, flower).filter((n) => round.board.state[n] === OPEN);
  const near = around[0];
  a.cell = near;
  a.phase = "forage";
  b.cell = around[1];
  b.phase = "forage";

  // The first to land takes it.
  assert.ok(apply(round, a, { kind: "fly", to: flower }));
  assert.equal(a.phase, "return", "the first bee loads pollen");
  assert.equal(round.board.pollen[flower], 0, "and empties the flower");

  // It moves on, freeing the square, and the second bee arrives to nothing.
  a.cell = near;
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

test("a bee that follows the pathfinder actually arrives", () => {
  // The regression this exists for did not throw, log, or look wrong. Having
  // stepped inward, the stagger barred another inward move, and the cheapest
  // legal move was back OUTWARD into open tunnel rather than sideways into comb
  // that had to be cut — from where inward was legal again. The bee oscillated
  // between two rings for the whole round, paying a fare every time, and the
  // board looked entirely normal throughout.
  //
  // A cell-based field cannot express the stagger. This asserts the outcome
  // rather than the mechanism, so any future shortcut that reintroduces the
  // ping-pong fails here.
  const round = makeRound(["human"], DEFAULT_RULES, mulberry32(5));
  const g = round.board.g;
  const bee = round.bees[0];
  const mouth = [...Array(g.cells).keys()].find((c) => round.board.mouth[c])!;
  bee.cell = mouth;
  bee.phase = "tunnel" as Phase;
  bee.cameInward = false;

  const rings: number[] = [];
  for (let i = 0; i < 300 && bee.phase !== "done"; i++) {
    const a = stepToward(round, bee, 0);
    assert.ok(a, `the pathfinder gave up at ring ${ringOf(g, bee.cell)} after ${i} moves`);
    bee.nextMoveTick = round.tick;
    assert.ok(apply(round, bee, a!), `it proposed a move the rules refused: ${JSON.stringify(a)}`);
    rings.push(ringOf(g, bee.cell));
  }

  assert.equal(bee.phase, "done", `never reached the queen; got to ring ${ringOf(g, bee.cell)}`);
  // Fourteen rings under the stagger needs about twenty-eight moves. Sixty
  // leaves room for obstructions and still fails a bee that is ping-ponging.
  assert.ok(rings.length < 60, `took ${rings.length} moves — that is a bee going in circles`);
});

test("a bee has a body — one cell, one bee, inside the hive", () => {
  const round = makeRound(["rider", "rider"], DEFAULT_RULES, mulberry32(43));
  const g = round.board.g;
  const [a, b] = round.bees;
  const cell = idx(g, 6, 2);
  round.board.state[cell] = OPEN;
  round.board.blocked[cell] = 0;
  const from = neighbors(g, cell).find(
    (n) => ringOf(g, n) > ringOf(g, cell) && !round.board.blocked[n],
  )!;
  round.board.state[from] = OPEN;

  b.cell = cell;
  b.phase = "tunnel";
  a.cell = from;
  a.phase = "tunnel";
  a.cameInward = false;

  assert.equal(apply(round, a, { kind: "fly", to: cell }), false, "no walking through a rival");
  assert.equal(a.cell, from);

  // And once that bee is gone, the way is open again.
  b.phase = "done" as Phase;
  a.nextMoveTick = round.tick;
  assert.ok(apply(round, a, { kind: "fly", to: cell }));
});

test("a bee has a body in the meadow too — no piling into one square", () => {
  // The meadow used to be exempt, and the exemption let five bees pile into the
  // one square outside a door. That is what made a doorway look deadlocked: not
  // a stuck bee, a stack of them waiting on a single cell nobody could see was
  // full. Bees start on twelve distinct corner squares, so the reason the
  // exemption existed — a start with everyone on one ring — is gone.
  const round = makeRound(["rider", "rider"], DEFAULT_RULES, mulberry32(47));
  const g = round.board.g;
  const [a, b] = round.bees;
  const cell = g.hiveCells + Math.floor(g.meadowCells / 2);
  b.cell = cell;
  const from = neighbors(g, cell).find((n) => ringOf(g, n) > g.R)!;
  a.cell = from;
  assert.equal(apply(round, a, { kind: "fly", to: cell }), false, "no flying through a rival");
  assert.equal(a.cell, from, "and the refused bee has not moved");

  // Once that bee is gone the square is free again — it is a queue, not a wall.
  b.phase = "done" as Phase;
  a.nextMoveTick = round.tick;
  assert.ok(apply(round, a, { kind: "fly", to: cell }));
});

test("an obstruction never bricks a door, nor the cell it opens onto", () => {
  // Obstructions were rolled over rings 2..R, and R IS the wall. Measured at 18
  // of 240 doors blocked outright and 7 more opening onto a blocked cell — and
  // since the wall to either side of a doorway cannot be cut, that second case
  // is a door a bee can enter and then only reverse out of. Both read to a
  // player as a deadlock at the doorway.
  const g = makeGeometry();
  for (let seed = 1; seed <= 40; seed++) {
    const b = makeBoard(g, { mouths: 4, layout: hiveLayout(g, seed) });
    const doors = [...Array(g.cells).keys()].filter((c) => b.mouth[c]);
    assert.equal(doors.length, 4);
    for (const d of doors) {
      assert.equal(b.blocked[d], 0, `seed ${seed}: door ${d} is bricked shut`);
      const on = neighbors(g, d).filter((n) => ringOf(g, n) < ringOf(g, d));
      assert.ok(on.length > 0, `seed ${seed}: door ${d} opens onto nothing`);
      assert.ok(
        on.some((n) => !b.blocked[n]),
        `seed ${seed}: door ${d} opens only onto an obstruction`,
      );
    }
    // And the wall itself never carries one, where it could do nothing but
    // delete a door.
    for (let i = 0; i < g.size[g.R]; i++)
      assert.equal(b.blocked[idx(g, g.R, i)], 0, `seed ${seed}: an obstruction landed on the wall`);
  }
});

test("a door somebody is standing in still lets you queue up beside it", () => {
  // "No way through" is true and useless. Every door may have a queue and this
  // bee has to be near its own door regardless, so a rival in the doorway must
  // yield a move that gets CLOSER, not a refusal.
  const round = makeRound(["rider", "rider"], DEFAULT_RULES, mulberry32(61));
  const g = round.board.g;
  const [a, b] = round.bees;
  const door = [...Array(g.cells).keys()].find((c) => round.board.mouth[c])!;
  const outside = neighbors(g, door).find((n) => ringOf(g, n) > g.R)!;

  b.cell = door; // a rival is in the doorway
  a.cell = neighbors(g, outside).find((n) => ringOf(g, n) > g.R && n !== door)!;
  a.phase = "return" as Phase;

  assert.equal(stepToward(round, a, door), null, "the direct route really is taken");

  const step = approach(round, a, door);
  assert.ok(step, "a queued bee must still be offered a move");
  assert.equal(step!.kind, "fly");
  const to = (step as { to: number }).to;
  assert.ok(
    neighbors(g, to).includes(door) || to === outside,
    "the move should bring the bee alongside the door",
  );
  assert.ok(apply(round, a, step!), "and it must be legal");
  assert.notEqual(a.cell, door, "without ever walking through the bee standing there");
});

test("a bee waiting behind a rival is not sent shuffling sideways for ever", () => {
  // `approach` must only offer a step that closes the gap. Without that guard a
  // queued bee paces back and forth beside the door, paying a fare each time to
  // end up exactly where it started.
  const round = makeRound(["rider", "rider"], DEFAULT_RULES, mulberry32(67));
  const g = round.board.g;
  const [a, b] = round.bees;
  const door = [...Array(g.cells).keys()].find((c) => round.board.mouth[c])!;
  const outside = neighbors(g, door).find((n) => ringOf(g, n) > g.R)!;

  // a is already as close as bodies allow: right outside a door someone holds.
  b.cell = door;
  a.cell = outside;
  a.phase = "return" as Phase;
  assert.equal(approach(round, a, door), null, "nothing gets it closer, so it waits");
});

test("two hives do not share one distance field", () => {
  // The cache is global and its key was the CALLER's — "forage:20" — which
  // cannot say which of five hives is asking, and two fresh boards both have
  // version 0. So whichever hive computed first won, and every other hive's
  // bees descended a stranger's map: converging on doors that were open in
  // hive 0 and solid in theirs. On screen all five hives showed bees frozen in
  // identical positions, which is how it was noticed — never by a failure.
  const g = makeGeometry();
  const a = makeBoard(g, { mouths: 4, layout: hiveLayout(g, 1) });
  const b = makeBoard(g, { mouths: 4, layout: hiveLayout(g, 999) });

  assert.notEqual(a.id, b.id, "two boards must not share an identity");
  assert.equal(a.version, b.version, "and both are fresh, which is what defeated the old key");

  const fa = field(a, [0], 20, 80, "same-key");
  const fb = field(b, [0], 20, 80, "same-key");
  assert.notEqual(fa, fb, "the same key on two boards must not return one field");

  // Different obstructions have to produce a different map somewhere.
  let differs = 0;
  for (let c = 0; c < g.cells; c++) if (fa.dist[c] !== fb.dist[c]) differs++;
  assert.ok(differs > 0, "two differently blocked hives cannot have identical distances");
});

test("the opening is dealt, not fixed", () => {
  // Obstructions varied from the first day and the opening never did, so every
  // round began looking exactly like the last one. Twelve bees, same twelve
  // cells, every hive, every match.
  const g = makeGeometry();
  const layouts = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) {
    layouts.add(cornerStarts(g, 12, mulberry32(seed)).slice().sort((a, b) => a - b).join(","));
  }
  assert.ok(layouts.size > 1, `12 seeds produced ${layouts.size} distinct openings`);

  // Still a legal opening every time: distinct meadow squares, out in the
  // corners, and never handed a door.
  for (let seed = 1; seed <= 12; seed++) {
    const st = cornerStarts(g, 12, mulberry32(seed));
    assert.equal(new Set(st).size, 12, `seed ${seed}: two bees share a cell`);
    for (const c of st) {
      assert.ok(c >= g.hiveCells, `seed ${seed}: a bee starts inside the hive`);
      const [x, y] = cellCentre(g, c);
      assert.ok(
        Math.abs(x) > VIEW_HALF * 0.4 && Math.abs(y) > VIEW_HALF * 0.4,
        `seed ${seed}: a bee starts at ${x.toFixed(0)},${y.toFixed(0)} — not in a corner`,
      );
    }
  }
});

test("a rejected action still costs the clock", () => {
  // `apply` returning false changed NOTHING — not the position, not the
  // cooldown — so a bot that offered an illegal move re-offered it every tick,
  // free, for ever. A bee sat on a hive door for 46 seconds that way, with a
  // rival in the one cell below it and the wall either side uncuttable, holding
  // the entrance shut against eleven others. Rounds reaching the queen went
  // from 69% to 100% when the clock started advancing.
  const round = makeRound(["rider", "rider"], DEFAULT_RULES, mulberry32(71));
  const g = round.board.g;
  const [a, b] = round.bees;
  const cell = g.hiveCells + Math.floor(g.meadowCells / 2);
  b.cell = cell;
  a.cell = neighbors(g, cell).find((n) => ringOf(g, n) > g.R)!;

  const before = a.nextMoveTick;
  assert.equal(apply(round, a, { kind: "fly", to: cell }), false, "the move really is illegal");
  assert.equal(a.nextMoveTick, before, "a refused move is not itself a turn");

  // Which is exactly why the caller must spend one. `match.step` does this for
  // every bot; here it is asserted as the rule it stands on.
  assert.ok(apply(round, a, { kind: "wait" }));
  assert.ok(a.nextMoveTick > before, "waiting must move the clock, or nothing ever unblocks");
});

test("a route reaches the target, obeys the stagger, and never doubles back", () => {
  // A tap in the comb now sets a DESTINATION, so the player commits to a line
  // they cannot otherwise see. If the drawn line is not the line the bee walks,
  // the picture is a lie and the decision it invites is worthless.
  const round = makeRound(["rider"], DEFAULT_RULES, mulberry32(83));
  const g = round.board.g;
  const bee = round.bees[0];
  bee.cell = idx(g, g.R, 0); // in a doorway, heading down
  bee.phase = "tunnel" as Phase;
  bee.cameInward = false;

  const path = routeToward(round, bee, 0);
  assert.ok(path.length > 0, "no route to the queen from a door");
  assert.equal(path[path.length - 1], 0, "the route must actually arrive");
  assert.equal(new Set(path).size, path.length, "a route must not revisit a cell");

  let prev = bee.cell;
  let armed = false;
  for (const c of path) {
    assert.ok(neighbors(g, prev).includes(c), `${prev} -> ${c} is not a step`);
    assert.equal(round.board.blocked[c], 0, `the route runs through an obstruction at ${c}`);
    const inward = ringOf(g, c) < ringOf(g, prev) && ringOf(g, prev) <= g.R;
    assert.ok(!(armed && inward), `the drawn route cuts two levels in a row at ${c}`);
    armed = inward;
    prev = c;
  }
});

test("a route redraws when the comb changes under it", () => {
  // The point of drawing it: something lands on your line and you can SEE the
  // plan break. A route computed once and cached would keep showing a path
  // through a cell nobody can enter any more.
  const round = makeRound(["rider"], DEFAULT_RULES, mulberry32(89));
  const g = round.board.g;
  const bee = round.bees[0];
  bee.cell = idx(g, g.R, 0);
  bee.phase = "tunnel" as Phase;

  const before = routeToward(round, bee, 0);
  assert.ok(before.length > 3, "need a route long enough to break");

  // Put capped brood squarely in the middle of it.
  const broken = before[Math.floor(before.length / 2)];
  round.board.blocked[broken] = 1;
  round.board.version++;

  const after = routeToward(round, bee, 0);
  assert.ok(!after.includes(broken), "the route still runs through the obstruction");
  assert.ok(after.length > 0, "and it must find another way, not give up");
  assert.equal(after[after.length - 1], 0, "which still ends at the queen");
});

test("a live board rebuilds exactly what the server described", () => {
  // The client draws obstructions and flowers it was never sent, by running the
  // same generator on the seed it WAS sent. If that drifts, a patron is refused
  // moves for reasons nothing on their screen explains — which is precisely
  // what live play did before the seed was sent at all.
  const g = makeGeometry();
  const seed = 4242;
  const live = {
    match_id: "m",
    state: "running" as const,
    seq: 1,
    poll_after_ms: 700,
    winner_npub: "",
    hives: 2,
    seats: 12,
    seed,
    bees: [{ hive: 0, seat: 0, npub: "npub1x", label: "you", cell: 300, phase: "forage",
             moves: 0, digs: 0, seals: 0, next_move_at: null, finished_at: null }],
    open_cells: [{ hive: 0, cell: 150 }],
    taken_pollen: [] as { hive: number; cell: number }[],
  };

  const hives = hydrate(live, g);
  assert.equal(hives.length, 2, "every hive is rebuilt, not just yours");

  for (let h = 0; h < 2; h++) {
    const expected = hiveLayout(g, hiveSeed(seed, h));
    for (const c of expected.blocked)
      assert.equal(hives[h].board.blocked[c], 1, `hive ${h}: obstruction at ${c} not drawn`);
    for (const c of expected.flowers)
      assert.equal(hives[h].board.flower[c], 1, `hive ${h}: flower at ${c} not drawn`);
  }

  // The server said one cell is dug. It must be open, and nothing else in the
  // comb may be — a board mended from stale guesses would show a way through
  // that a seal has already closed.
  assert.equal(hives[0].board.state[150], OPEN, "the dug cell is not open");
  const doors = new Set(mouthCells(g));
  let strayOpen = 0;
  for (let c = 0; c < g.hiveCells; c++)
    if (hives[0].board.state[c] === OPEN && c !== 150 && !doors.has(c)) strayOpen++;
  assert.equal(strayOpen, 0, "the client invented open comb the server never mentioned");

  // An emptied flower is still drawn, without its pollen — an empty flower is
  // information the player needs.
  const flower = hiveLayout(g, hiveSeed(seed, 0)).flowers[0];
  const after = hydrate({ ...live, taken_pollen: [{ hive: 0, cell: flower }] }, g);
  assert.equal(after[0].board.flower[flower], 1, "the flower vanished instead of emptying");
  assert.equal(after[0].board.pollen[flower], 0, "the flower still holds pollen");
});
