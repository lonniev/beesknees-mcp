/**
 * The counter shows money. What it must never do is lie about the figure or
 * jitter while it is being read.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MIN_REELS, reels, widthFor } from "./odometer.ts";

test("a figure is shown left-padded, so the reel does not change width", () => {
  assert.deepEqual(reels(0), [0, 0, 0]);
  assert.deepEqual(reels(7), [0, 0, 7]);
  assert.deepEqual(reels(884), [8, 8, 4]);
});

test("a figure wider than the reel is never truncated", () => {
  // Truncating is the one failure that would be silent AND wrong about money.
  assert.deepEqual(reels(12345), [1, 2, 3, 4, 5]);
  assert.deepEqual(reels(1000, MIN_REELS), [1, 0, 0, 0]);
});

test("the reel grows and never shrinks back", () => {
  // 999 → 1000 → 999 should not widen and then narrow; that twitch happens
  // exactly while somebody is watching the number.
  let w = MIN_REELS;
  w = widthFor(999, w);
  assert.equal(w, 3);
  w = widthFor(1000, w);
  assert.equal(w, 4);
  w = widthFor(999, w);
  assert.equal(w, 4, "the reel must not narrow again");
});

test("nonsense reads as nothing rather than throwing", () => {
  // A counter is the wrong place to discover a bad number — it is on screen,
  // mid-round, in front of a player. The books are the right place.
  for (const bad of [NaN, Infinity, -Infinity, -5, undefined as unknown as number]) {
    assert.deepEqual(reels(bad), [0, 0, 0], String(bad));
  }
});

test("every reel position is a single digit", () => {
  for (const n of [0, 9, 10, 99, 100, 884, 1001, 999999]) {
    for (const d of reels(n)) {
      assert.ok(Number.isInteger(d) && d >= 0 && d <= 9, `${n} → ${d}`);
    }
  }
});
