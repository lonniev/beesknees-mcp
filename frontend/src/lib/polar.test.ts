/**
 * Does a tap land on the cell under the finger?
 *
 * The renderer draws wedges and the hit test computes them, so the two agree
 * only as long as they share the same idea of where slot zero starts and which
 * way the angles run. Nothing in the interface reports that they have drifted —
 * the game simply moves the wrong way and feels broken. Hence a round trip.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { isHive, makeGeometry, ringOf } from "../game/rules.ts";
import { TAU, VIEW, cellAt, cellCentre, cellPath, cellShape, ringRadius, slotAngle, xy } from "./polar.ts";

const g = makeGeometry();

test("every cell's centre hit-tests back to that same cell", () => {
  let checked = 0;
  for (let c = 0; c < g.cells; c++) {
    const [x, y] = cellCentre(g, c);
    assert.equal(cellAt(g, x, y), c, `cell ${c} (ring ${ringOf(g, c)}) tapped at its own centre missed`);
    checked++;
  }
  assert.equal(checked, g.cells);
});

test("the queen's chamber is the centre of the board", () => {
  assert.equal(cellAt(g, 0, 0), 0);
  assert.deepEqual(cellCentre(g, 0), [0, 0]);
});

test("slot zero starts at twelve o'clock", () => {
  // Its EDGE is at twelve, not its centre — a slot spans clockwise from there,
  // so the middle of slot 0 sits half a slot past the vertical by design.
  const r = 10;
  const [x, y] = xy(ringRadius(g, r) + 0.5, slotAngle(g.size[r], 0));
  assert.ok(y < 0, `slot 0 should begin above the centre, got y=${y}`);
  assert.ok(Math.abs(x) < 1e-9, `slot 0 should begin on the vertical, got x=${x}`);
  // And it runs clockwise, which is the direction a dial is read.
  const [x1] = xy(ringRadius(g, r) + 0.5, slotAngle(g.size[r], 1));
  assert.ok(x1 > 0, "slots must advance clockwise");
});

test("a tap outside the field hits nothing rather than the nearest cell", () => {
  // The field IS the square, so anything past its edge is nothing at all.
  assert.equal(cellAt(g, VIEW * 1.5, VIEW * 1.5), null);
  assert.equal(cellAt(g, 0, -VIEW * 1.5), null);
});

test("every cell is inside the square, so nothing is drawn where nobody can see it", () => {
  // The reason there are two geometries. One polar grid stretched to the
  // corners put 140 of 491 cells off-screen, which then had to be blocked,
  // skipped by the connectivity repair, and hidden — bookkeeping in three
  // places to paper over a mismatch instead of not having one.
  for (let c = 0; c < g.cells; c++) {
    const [x, y] = cellCentre(g, c);
    assert.ok(
      Math.abs(x) <= VIEW && Math.abs(y) <= VIEW,
      `cell ${c} sits at ${x},${y}, outside the field`,
    );
  }
});

test("the corners of the field are meadow a bee can stand in", () => {
  // "Use the corners. Make the bees have to fly a bit." A cell must exist at
  // each corner and be a long way from the hive.
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const c = cellAt(g, sx * (VIEW - 1), sy * (VIEW - 1));
    assert.ok(c !== null, `no cell in the ${sx},${sy} corner`);
    assert.ok(!isHive(g, c!), `the ${sx},${sy} corner is hive, not meadow`);
  }
});

test("a square cell is drawn as a square and a comb cell as a wedge", () => {
  const meadow = g.hiveCells;
  const comb = g.offset[g.R];
  assert.ok(!cellShape(g, meadow).includes("A "), "a meadow square must not be an arc");
  assert.ok(cellShape(g, comb).includes("A "), "a comb cell must be a wedge");
  for (const c of [meadow, comb, 0]) assert.ok(!cellShape(g, c).includes("NaN"));
});

test("angles wrap, so a tap just left of twelve lands on the last slot", () => {
  const r = 8;
  const n = g.size[r];
  const [x, y] = xy(ringRadius(g, r) + 0.5, slotAngle(n, n - 0.5));
  const cell = cellAt(g, x, y);
  assert.equal(cell, g.offset[r] + n - 1);
});

test("wedges are drawn, not degenerate", () => {
  // Derived from the shipped board, never restated. An earlier version named
  // rings 20 and 24; the board shrank to 14 and the test started asserting
  // NaN geometry for rings that no longer exist.
  const probes = [1, Math.round(g.R / 2), g.R];
  for (const r of probes) {
    const d = cellPath(g, r, 0);
    assert.match(d, /^M /, `ring ${r} produced no path`);
    assert.ok(d.includes("A "), `ring ${r} wedge has no arc`);
    assert.ok(!d.includes("NaN"), `ring ${r} wedge has NaN: ${d}`);
  }
  const queen = cellPath(g, 0, 0);
  assert.ok(!queen.includes("NaN"));
  assert.ok(queen.includes("A "), "the queen's chamber must be a disc, not a sliver");
});

test("rings are laid out inside the viewBox, innermost first", () => {
  assert.equal(ringRadius(g, 0), 0);
  for (let r = 1; r <= g.R + 1; r++)
    assert.ok(ringRadius(g, r) > ringRadius(g, r - 1), `ring ${r} does not sit outside ring ${r - 1}`);
  // The wall's outer edge is where the hive stops and the meadow begins. Past
  // it the geometry is squares, so there is no ring to grow into.
  assert.equal(ringRadius(g, g.R + 1), VIEW * 0.8, "the wall must end at the hive's share");
  assert.equal(ringRadius(g, g.R + 5), ringRadius(g, g.R + 1), "nothing grows past the wall");
});

test("a full turn of any ring covers the whole circle with no gap", () => {
  for (const r of [1, Math.round(g.R / 2), g.R]) {
    const n = g.size[r];
    assert.ok(Math.abs(slotAngle(n, n) - slotAngle(n, 0) - TAU) < 1e-9, `ring ${r} does not close`);
  }
});
