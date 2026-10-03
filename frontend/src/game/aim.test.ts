/**
 * The spec of when the bee moves on its own, and of when an aim is over.
 * Every guard in `shouldCruise` is a way a cruise could spend wrongly, so each
 * is flipped alone.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { aimOver, shouldCruise, type CruiseGuards } from "./aim.ts";
import { hiveLayout, makeBoard, makeGeometry } from "./rules.ts";

const g = makeGeometry();
const board = makeBoard(g, { mouths: 4, layout: hiveLayout(g, 3) });

test("an aim is over when the bee stands on it", () => {
  assert.equal(aimOver(board, { cell: 40, phase: "tunnel" }, 40), "arrived");
  assert.equal(aimOver(board, { cell: 41, phase: "tunnel" }, 40), null);
  assert.equal(aimOver(board, { cell: 41, phase: "tunnel" }, null), null);
});

test("a forage aim is spent once its flower has no pollen — and only then", () => {
  const flower = Array.from(board.flower).findIndex((f, c) => f && board.pollen[c]);
  const bee = { cell: g.hiveCells + 1, phase: "forage" };
  assert.equal(aimOver(board, bee, flower), null);
  board.pollen[flower] = 0;
  assert.equal(aimOver(board, bee, flower), "spent");
  // Inside the hive a flower is nobody's aim; the same cell is just a cell.
  assert.equal(aimOver(board, { ...bee, phase: "tunnel" }, flower), null);
  board.pollen[flower] = 1;
});

const go: CruiseGuards = { on: true, inHive: true, ready: true, busy: false, hasStep: true, running: true, seqAdvanced: true };

test("cruise fires only with every guard true", () => {
  assert.equal(shouldCruise(go), true);
  for (const key of Object.keys(go) as (keyof CruiseGuards)[]) {
    const flipped = { ...go, [key]: !go[key] };
    assert.equal(shouldCruise(flipped), false, `${key} alone must stop it`);
  }
});

test("cruise never acts from the meadow, and never twice on one board", () => {
  assert.equal(shouldCruise({ ...go, inHive: false }), false);
  assert.equal(shouldCruise({ ...go, seqAdvanced: false }), false);
});
