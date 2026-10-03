/**
 * A forager must actually arrive. The steering is drag against acceleration
 * with a speed cap, and a wrong sign in any of them is a bee that circles for
 * ever — which on screen looks like a bee, so nobody would notice for a week.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Hive } from "./beeFlight.ts";
import { COLUMN, patch, pose, spawn, step, type Field, type StepOpts } from "./forage.ts";

/** A seeded source, so a failing run can be re-run. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const hive: Hive = { cx: 0.5, cy: 0.5, hx: 0.15, hy: 0.2 };
const field: Field = { w: 800, h: 600, hives: [hive], focus: hive };
const calm: StepOpts = { calm: 1, wander: false, ptr: null, call: { on: false, seq: 0 } };

/** Run the sim for `seconds` at 60 Hz. */
function run(bees: ReturnType<typeof spawn>, seconds: number, o: StepOpts, rnd: () => number) {
  for (let i = 0; i < seconds * 60; i++) step(bees, field, 1 / 60, o, rnd);
}

test("a forager leaves its door, works a patch, and comes home", () => {
  const rnd = seeded(1);
  const bees = spawn(1, [hive], false, rnd);
  const seen = new Set<string>();
  for (let i = 0; i < 60 * 60; i++) {
    step(bees, field, 1 / 60, calm, rnd);
    seen.add(bees[0].phase);
  }
  assert.deepEqual([...seen].sort(), ["foraging", "leaving", "resting", "returning"]);
});

test("a patch is never under a hive, and keeps out of the column when asked", () => {
  const rnd = seeded(2);
  for (let i = 0; i < 200; i++) {
    const p = patch([hive], false, rnd);
    const underHive = Math.abs(p.x - hive.cx) <= hive.hx * 1.35 && Math.abs(p.y - hive.cy) <= hive.hy * 1.35;
    assert.ok(!underHive, `patch ${JSON.stringify(p)} is under the hive`);
    const q = patch([], true, rnd);
    assert.ok(q.x < COLUMN.from || q.x > COLUMN.to, `patch ${q.x} is in the reading column`);
  }
});

test("speed is capped at cruise, and a startled bee is quicker", () => {
  const rnd = seeded(3);
  const bees = spawn(3, [hive], false, rnd);
  run(bees, 20, calm, rnd);
  const CRUISE = 0.055 + 0.55 * 0.075;
  for (const b of bees) assert.ok(Math.hypot(b.vx, b.vy) <= CRUISE * 1.1 + 1e-9);
  const startled = { ...calm, ptr: { x: bees[0].x + 0.01, y: bees[0].y } };
  run(bees, 0.5, startled, rnd);
  assert.ok(Math.hypot(bees[0].vx, bees[0].vy) > CRUISE * 1.1, "a hand nearby should send it off faster");
});

test("a rally sends every bee to the focused hive's doors, once per call", () => {
  const rnd = seeded(4);
  const bees = spawn(4, [hive], false, rnd);
  run(bees, 10, calm, rnd);
  step(bees, field, 1 / 60, { ...calm, call: { on: true, seq: 1 } }, rnd);
  for (const b of bees) {
    assert.equal(b.phase, "returning");
    assert.equal(b.called, 1);
    assert.ok(Math.abs(b.tx - hive.cx) <= hive.hx + 1e-9 && Math.abs(b.ty - hive.cy) <= hive.hy + 1e-9, "target must be on the hive's edge");
  }
  const targets = bees.map((b) => [b.tx, b.ty]);
  step(bees, field, 1 / 60, { ...calm, call: { on: true, seq: 1 } }, rnd);
  assert.deepEqual(bees.map((b) => [b.tx, b.ty]), targets, "the same call must not re-aim");
});

test("reduced motion calms the flight rather than stopping it", () => {
  const a = spawn(1, [hive], false, seeded(5));
  const b = spawn(1, [hive], false, seeded(5));
  run(a, 8, calm, seeded(6));
  run(b, 8, { ...calm, calm: 0.4 }, seeded(6));
  const moved = (x: ReturnType<typeof spawn>[number], s: ReturnType<typeof spawn>[number]) => Math.hypot(x.x - s.x, x.y - s.y);
  const start = spawn(1, [hive], false, seeded(5))[0];
  assert.ok(moved(b[0], start) > 0, "a calm bee still moves");
  assert.ok(moved(a[0], start) >= moved(b[0], start) * 0.9, "but not further than a lively one");
});

test("the pose faces the flight path and the buzz never enters the physics", () => {
  const rnd = seeded(7);
  const [b] = spawn(1, [hive], false, rnd);
  b.vx = 0.1; b.vy = 0;
  assert.equal(pose(b, 0, 1).tilt, 0);
  b.vx = 0; b.vy = 0.1;
  assert.equal(pose(b, 0, 1).tilt, 90);
  const before = { x: b.x, y: b.y };
  pose(b, 3.7, 1);
  assert.deepEqual({ x: b.x, y: b.y }, before);
});

test("a bee stays inside the layer", () => {
  const rnd = seeded(8);
  const bees = spawn(6, [hive], false, rnd);
  run(bees, 90, calm, rnd);
  for (const b of bees) assert.ok(b.x >= 0.01 && b.x <= 0.99 && b.y >= 0.02 && b.y <= 0.98);
});
