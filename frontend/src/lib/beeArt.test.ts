/**
 * Node has no canvas, so the painters are run against a context that only
 * remembers what was asked of it. Enough to hold the two facts the stage
 * relies on: the bee faces east, and a wingbeat is two different frames.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { paintBee, paintFlower } from "./beeArt.ts";

function recorder() {
  const calls: { op: string; args: unknown[] }[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_, op: string) {
      return (...args: unknown[]) => { calls.push({ op, args }); return undefined; };
    },
    set(_, key: string, value) { state[key] = value; return true; },
  });
  return { ctx, calls, state };
}

test("the bee faces east: its head is drawn to the right of its abdomen", () => {
  const { ctx, calls } = recorder();
  paintBee(ctx, 64, "up");
  const arcs = calls.filter((c) => c.op === "arc").map((c) => c.args[0] as number);
  const ellipses = calls.filter((c) => c.op === "ellipse").map((c) => c.args as number[]);
  const head = Math.max(...arcs);
  const abdomen = ellipses.find((e) => e[2] === 14)!;
  assert.ok(head > abdomen[0], "head must sit at +x, the heading the stage rotates from");
});

test("a wingbeat is two frames that differ", () => {
  const up = recorder();
  const down = recorder();
  paintBee(up.ctx, 64, "up");
  paintBee(down.ctx, 64, "down");
  const rot = (r: ReturnType<typeof recorder>) => r.calls.filter((c) => c.op === "rotate").map((c) => c.args[0]);
  assert.notDeepEqual(rot(up), rot(down));
  assert.equal(up.calls.length, down.calls.length, "same drawing, different wing angle");
});

test("a full flower and an emptied one are the same shape in different colours", () => {
  const a = recorder();
  const b = recorder();
  paintFlower(a.ctx, 64, true);
  paintFlower(b.ctx, 64, false);
  assert.deepEqual(a.calls.map((c) => c.op), b.calls.map((c) => c.op));
  assert.notEqual(a.state.fillStyle, b.state.fillStyle);
});
