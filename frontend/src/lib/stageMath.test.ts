/**
 * The stage notices what the engines never announce. Each case here is a
 * frame pair that fooled a simpler diff: a dig that is also a move, a rival
 * entering a hole it did not cut, a flower that came back on a thin reply.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { OPEN, cellCentre, hiveLayout, makeBoard, makeGeometry, neighbors, ringOf } from "../game/rules.ts";
import { VIEW, cellAt } from "./polar.ts";
import { diffFrame, openPath, snapshot, tweenMs, viewFromPointer } from "./stageMath.ts";

const g = makeGeometry();
const fresh = () => makeBoard(g, { mouths: 4, layout: hiveLayout(g, 7) });

/** A comb cell with an OPEN neighbour, and that neighbour: where a dig can start. */
function combBesideOpen(board: ReturnType<typeof fresh>): [number, number] {
  for (let c = 0; c < g.hiveCells; c++) {
    if (board.state[c] !== OPEN || board.blocked[c]) continue;
    for (const n of neighbors(g, c)) if (n < g.hiveCells && board.state[n] !== OPEN && !board.blocked[n]) return [n, c];
  }
  throw new Error("no comb beside an open cell");
}

test("a dig is a move whose counter rose into a cell that just opened", () => {
  const board = fresh();
  const [comb, open] = combBesideOpen(board);
  const before = snapshot(board, [{ id: 1, cell: open, phase: "tunnel", digs: 0 }]);
  board.state[comb] = OPEN;
  const after = snapshot(board, [{ id: 1, cell: comb, phase: "tunnel", digs: 1 }]);
  const d = diffFrame(g, before, after);
  assert.deepEqual(d.opened, [comb]);
  assert.equal(d.moved.length, 1);
  assert.equal(d.moved[0].dug, true);
  assert.deepEqual(d.moved[0].path, [comb]);
});

test("flying into a hole somebody else cut is not a dig", () => {
  const board = fresh();
  const [comb, open] = combBesideOpen(board);
  // Across one live poll: bee 2 digs `comb` and moves on; bee 1 flies in after it.
  const before = snapshot(board, [
    { id: 1, cell: open, phase: "tunnel", digs: 0 },
    { id: 2, cell: comb, phase: "tunnel", digs: 3 },
  ]);
  board.state[comb] = OPEN;
  const elsewhere = neighbors(g, comb).find((n) => n !== open && n < g.hiveCells)!;
  board.state[elsewhere] = OPEN;
  const after = snapshot(board, [
    { id: 1, cell: comb, phase: "tunnel", digs: 0 },
    { id: 2, cell: elsewhere, phase: "tunnel", digs: 4 },
  ]);
  const d = diffFrame(g, before, after);
  const one = d.moved.find((m) => m.id === 1)!;
  const two = d.moved.find((m) => m.id === 2)!;
  assert.equal(one.dug, false, "bee 1 only walked into it");
  assert.equal(two.dug, true, "bee 2 cut the cell it now stands in");
});

test("a seal is a cell closing while its sealer stays put", () => {
  const board = fresh();
  const [comb, open] = combBesideOpen(board);
  board.state[comb] = OPEN;
  const before = snapshot(board, [{ id: 1, cell: open, phase: "tunnel", seals: 0 }]);
  board.state[comb] = 0;
  const after = snapshot(board, [{ id: 1, cell: open, phase: "tunnel", seals: 1 }]);
  const d = diffFrame(g, before, after);
  assert.deepEqual(d.sealed, [comb]);
  assert.deepEqual(d.moved, []);
});

test("pollen taken is reported; pollen coming back is not", () => {
  const board = fresh();
  const flower = Array.from(board.flower).findIndex((f, c) => f && board.pollen[c]);
  const a = snapshot(board, []);
  board.pollen[flower] = 0;
  const b = snapshot(board, []);
  assert.deepEqual(diffFrame(g, a, b).emptied, [flower]);
  board.pollen[flower] = 1; // a thin live reply forgot taken_pollen
  const c = snapshot(board, []);
  assert.deepEqual(diffFrame(g, b, c).emptied, []);
});

test("a rebuilt board with the same content is no change at all", () => {
  // Live hydrates a NEW Board object on every poll; identity must not matter.
  const one = fresh();
  const two = fresh();
  assert.notEqual(one.id, two.id);
  const bees = [{ id: 0, cell: g.hiveCells + 3, phase: "forage" }];
  const d = diffFrame(g, snapshot(one, bees), snapshot(two, bees));
  assert.deepEqual(d, { moved: [], arrived: [], left: [], opened: [], sealed: [], emptied: [], phased: [] });
});

test("the first look arrives everybody and moves nobody", () => {
  const board = fresh();
  const d = diffFrame(g, null, snapshot(board, [{ id: 4, cell: 300, phase: "forage" }]));
  assert.deepEqual(d.arrived, [4]);
  assert.deepEqual(d.moved, []);
  assert.deepEqual(d.opened, []);
});

test("a skipped-moves jump walks the open cells, not the comb", () => {
  const board = fresh();
  // Open a short radial shaft from a wall cell inward and jump down it.
  const wall = g.offset[g.R] + 2;
  let at = wall;
  const shaft = [wall];
  for (let k = 0; k < 4; k++) {
    const inwardCell = neighbors(g, at).find((n) => n < g.hiveCells && ringOf(g, n) === ringOf(g, at) - 1)!;
    board.state[inwardCell] = OPEN;
    shaft.push(inwardCell);
    at = inwardCell;
  }
  board.state[wall] = OPEN;
  const path = openPath(g, board.state, wall, at);
  assert.deepEqual(path, shaft.slice(1));
  // Past the cap it gives up and crosses.
  assert.deepEqual(openPath(g, board.state, wall, at, 2), [at]);
});

test("an adjacent step is itself, and staying put is nothing", () => {
  const board = fresh();
  const c = g.hiveCells + 10;
  const n = neighbors(g, c)[0];
  assert.deepEqual(openPath(g, board.state, c, n), [n]);
  assert.deepEqual(openPath(g, board.state, c, c), []);
});

test("a pointer on the drawn square lands on the cell under it", () => {
  // A wide box: the square is letterboxed in the middle.
  const rect = { left: 10, top: 20, width: 600, height: 400 };
  for (const cell of [0, 5, g.offset[g.R] + 1, g.hiveCells + 7, g.cells - 1]) {
    const [vx, vy] = cellCentre(g, cell);
    const px = rect.left + rect.width / 2 + (vx / (2 * VIEW)) * 400;
    const py = rect.top + rect.height / 2 + (vy / (2 * VIEW)) * 400;
    const [x, y] = viewFromPointer(rect, px, py);
    assert.equal(cellAt(g, x, y), cell);
  }
});

test("a step draws in a fraction of the gap, never a snap", () => {
  assert.equal(tweenMs(100), 250);
  assert.equal(tweenMs(1200), 840);
  assert.equal(tweenMs(5000), 900);
});
