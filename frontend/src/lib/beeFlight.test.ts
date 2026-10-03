/**
 * The thing about a flying bee that a screenshot cannot tell you: whether it
 * is at the hive it thinks it is at. It was wrong once in the sibling this is
 * ported from, and only ever caught by somebody watching the animation.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { doorOn, drawnHive } from "./beeFlight.ts";

test("a hive is the square inside its box, not the box", () => {
  const layer = { w: 1000, h: 500 };

  // The focused board: a wide element with a square hive letterboxed in it.
  // 200px of a 1000px-wide layer is a fifth across but two fifths down, and
  // saying so is the whole reason the half-extents are separate numbers.
  const h = drawnHive({ x: 400, y: 150, w: 400, h: 200 }, layer);
  assert.deepEqual(h, { cx: 0.6, cy: 0.5, hx: 0.1, hy: 0.2 });

  // A rival tile is already square, so only the layer's shape stretches it.
  const tile = drawnHive({ x: 0, y: 0, w: 100, h: 100 }, layer);
  assert.deepEqual(tile, { cx: 0.05, cy: 0.1, hx: 0.05, hy: 0.1 });
});

test("a door sits on the hive's verge, never inside it", () => {
  const layer = { w: 1000, h: 500 };
  const h = drawnHive({ x: 300, y: 100, w: 200, h: 200 }, layer);

  for (let a = 0; a < Math.PI * 2; a += Math.PI / 32) {
    const d = doorOn(h, a);
    // On the verge means one axis is exactly at its half-extent and neither is
    // past it — which is the check that a single-radius version fails.
    const ox = Math.abs(d.x - h.cx) / h.hx;
    const oy = Math.abs(d.y - h.cy) / h.hy;
    assert.ok(
      Math.abs(Math.max(ox, oy) - 1) < 1e-9,
      `at ${a.toFixed(2)} rad the door landed at ${Math.max(ox, oy).toFixed(3)} of the verge`,
    );
  }
});
