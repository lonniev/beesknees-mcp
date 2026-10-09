import assert from "node:assert/strict";
import { test } from "node:test";
import { aimBee, easeHeading, turn } from "./beeAim.ts";

test("a bee heading east is mirrored and banked by its tilt", () => {
  assert.deepEqual(aimBee(0), { rotate: 0, mirror: true });
  assert.deepEqual(aimBee(30), { rotate: 30, mirror: true });
  assert.deepEqual(aimBee(-45), { rotate: -45, mirror: true });
});

test("a bee heading west keeps the glyph's own profile and never flies inverted", () => {
  assert.deepEqual(aimBee(180), { rotate: 0, mirror: false });
  assert.deepEqual(aimBee(150), { rotate: -30, mirror: false });
  assert.deepEqual(aimBee(-135), { rotate: 45, mirror: false });
  // Down-and-left came out of the arithmetic at -315° once; the value lied.
  assert.ok(Math.abs(aimBee(-135).rotate) <= 90);
});

test("an angle is always the short way round", () => {
  assert.equal(turn(-315), 45);
  assert.equal(turn(540), 180);
  assert.equal(turn(181), -179);
});

test("the drawn heading chases the wanted one and takes the short way", () => {
  const h1 = easeHeading(0, 90, 0.5);
  assert.ok(h1 > 0 && h1 < 90, `moved part way: ${h1}`);
  // Nearly there after a couple of seconds, never past it.
  let h = 0;
  for (let i = 0; i < 120; i++) h = easeHeading(h, 90, 1 / 60);
  assert.ok(h > 89 && h <= 90, `settled: ${h}`);
  // From 170 to -170 is 20° through the back, not 340° through the front.
  const h2 = easeHeading(170, -170, 0.1);
  assert.ok(h2 > 170 || h2 < -170, `went through 180: ${h2}`);
});
