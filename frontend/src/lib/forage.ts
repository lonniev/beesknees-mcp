/**
 * How a forager flies — the physics of the bees that are not playing.
 *
 * Steering forces with acceleration and drag, which is what gives a bee its
 * darting-then-hovering character. Ported from goodearth-mcp, where the flight
 * answers a real question — honeybees do not forage below about 13 °C, so the
 * count and the vigour there ARE the temperature reading. Nothing here reads
 * anything: this is a nice room at 25 °C and the bees are simply out.
 *
 * Kept out of the component so it can be run under `node --test` with a seeded
 * random source: a steering bug shows up as a bee that never arrives, and
 * "never" is not something you can watch for in a browser.
 *
 * Positions are FRACTIONS of the layer the bees fly over, not pixels — the
 * layer is almost never square, and a hive measured in it is half-extents
 * (`Hive` in `beeFlight.ts`) for the same reason.
 */

import { doorOn, type Hive } from "./beeFlight.ts";

export type ForagePhase = "leaving" | "foraging" | "returning" | "resting";

export interface Forager {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: ForagePhase;
  tx: number;
  ty: number;
  /** Seconds left in the current phase. */
  timer: number;
  buzz: number;
  scale: number;
  /** Per-bee speed variation — a meadow is not a formation. */
  vigour: number;
  /** Which rally this bee has already answered. See `StepOpts.call`. */
  called: number;
}

export interface Field {
  /** The layer's own size in pixels — what the fractions are fractions OF. */
  w: number;
  h: number;
  hives: Hive[];
  /** The hive being played, if one is marked. Where a rally goes. */
  focus: Hive | null;
}

/** A random source, injected so a test can seed it. */
export type Rnd = () => number;

/**
 * How lively they are, on nothing's authority but the look of the thing.
 *
 * In goodearth this is `(°F − 55) / 30` — a real reading, because a bee below
 * the flight threshold is a fact about the grower's morning. Here it is a dial
 * with one setting: a nice room, bees out and working.
 */
export const AIR = 0.55;

/**
 * The band a reading page keeps for its words, as fractions of the width.
 *
 * Only consulted when there are no hives — see `anyDoor`. A prose page has one
 * column down the middle and margins either side, and a bee crossing the column
 * is not scenery, it is something on top of the sentence.
 */
export const COLUMN = { from: 0.26, to: 0.74 };

const between = (rnd: Rnd, a: number, b: number) => a + rnd() * (b - a);

/**
 * Somewhere worth visiting: out in the open, and far enough from every hive
 * that the trip is a trip rather than a hover at the door.
 */
export function patch(hs: Hive[], keepColumnClear: boolean, rnd: Rnd): { x: number; y: number } {
  const side = () => (rnd() < 0.5 ? between(rnd, 0.03, COLUMN.from) : between(rnd, COLUMN.to, 0.97));
  for (let i = 0; i < 12; i++) {
    const p = keepColumnClear
      ? { x: side(), y: between(rnd, 0.05, 0.95) }
      : { x: between(rnd, 0.03, 0.97), y: between(rnd, 0.05, 0.95) };
    const clear = hs.every(
      (h) => Math.abs(p.x - h.cx) > h.hx * 1.35 || Math.abs(p.y - h.cy) > h.hy * 1.35,
    );
    if (clear) return p;
  }
  return keepColumnClear
    ? { x: side(), y: between(rnd, 0.05, 0.95) }
    : { x: between(rnd, 0.03, 0.97), y: between(rnd, 0.05, 0.95) };
}

/**
 * A door on some hive, chosen at random — nobody here has a home hive.
 *
 * With NO hives on the screen there is nowhere to come home to, so the bee
 * simply picks another patch: it wanders rather than commutes. Returning to
 * `{0.5, 0.5}`, which is what this used to do, sent every bee on a page to the
 * dead centre — the one place the words are.
 */
export function anyDoor(hs: Hive[], keepColumnClear: boolean, rnd: Rnd): { x: number; y: number } {
  if (!hs.length) return patch(hs, keepColumnClear, rnd);
  return doorOn(hs[Math.floor(rnd() * hs.length)], between(rnd, 0, Math.PI * 2));
}

export function spawn(n: number, hs: Hive[], keepColumnClear: boolean, rnd: Rnd): Forager[] {
  return Array.from({ length: n }, (_, i) => {
    const d = anyDoor(hs, keepColumnClear, rnd);
    return {
      x: d.x,
      y: d.y,
      vx: 0,
      vy: 0,
      phase: "resting" as ForagePhase,
      tx: d.x,
      ty: d.y,
      timer: between(rnd, 0.1, 3) + i * 0.4, // stagger the departures
      buzz: between(rnd, 0, 6.28),
      scale: between(rnd, 0.8, 1.25),
      vigour: between(rnd, 0.8, 1.25),
      called: 0,
    };
  });
}

export interface StepOpts {
  /** 1 normally; 0.4 under reduced motion — calmer, never still. */
  calm: number;
  /** A page with no hives: keep out of the reading column. */
  wander: boolean;
  /** A looming hand, as a fraction of the layer, or nothing. */
  ptr: { x: number; y: number } | null;
  /**
   * The meadow comes to the wedding.
   *
   * When a race ends, every forager breaks off and makes for the hive being
   * played. Answered ONCE per `seq` rather than re-aimed every frame, or a bee
   * would pick a new door sixty times a second and shiver in place.
   */
  call: { on: boolean; seq: number };
}

/** Advance every forager by `dt` seconds. Mutates in place — this runs at 60 Hz. */
export function step(bees: Forager[], field: Field, dt: number, o: StepOpts, rnd: Rnd): void {
  // A forager works a patch; it does not race. Tuned so crossing the board
  // takes the better part of ten seconds — quicker than that reads as
  // agitation, and agitated scenery pulls the eye off the game.
  const CRUISE = (0.055 + AIR * 0.075) * o.calm;
  const ACCEL = (0.5 + AIR * 0.5) * o.calm;
  const DRAG = 3.0;
  const FLEE_RADIUS = 0.11;
  const FLEE_FORCE = 3.2;

  for (const b of bees) {
    b.timer -= dt;

    // ── Called to the wedding ────────────────────────────────────────
    if (o.call.on && field.focus && b.called !== o.call.seq) {
      const d = doorOn(field.focus, between(rnd, 0, Math.PI * 2));
      b.tx = d.x;
      b.ty = d.y;
      b.phase = "returning";
      b.called = o.call.seq;
    }

    // ── The trip ─────────────────────────────────────────────────────
    if (b.phase === "resting" && b.timer <= 0) {
      if (o.call.on && field.focus) {
        // Nobody goes back to work during a coronation. They circle the
        // doors instead — a crowd gathering rather than a queue standing.
        const d = doorOn(field.focus, between(rnd, 0, Math.PI * 2));
        b.tx = d.x;
        b.ty = d.y;
        b.phase = "returning";
      } else {
        const p = patch(field.hives, o.wander, rnd);
        b.tx = p.x;
        b.ty = p.y;
        b.phase = "leaving";
      }
    } else if (b.phase === "leaving" && Math.hypot(b.tx - b.x, b.ty - b.y) < 0.05) {
      b.phase = "foraging";
      b.timer = between(rnd, 5, 14); // stay and work it
    } else if (b.phase === "foraging" && b.timer <= 0) {
      b.phase = "returning";
      // Any hive, not the one it left — which is what puts traffic BETWEEN
      // the hives rather than a private orbit around each.
      const d = anyDoor(field.hives, o.wander, rnd);
      b.tx = d.x;
      b.ty = d.y;
    } else if (b.phase === "returning" && Math.hypot(b.tx - b.x, b.ty - b.y) < 0.03) {
      b.phase = "resting";
      b.timer = between(rnd, 1.5, 4.5); // unload at the door
      b.vx *= 0.2;
      b.vy *= 0.2;
    }

    // ── Steering ─────────────────────────────────────────────────────
    let ax = 0;
    let ay = 0;

    // Working a patch: short hops to neighbouring flowers with a pause at
    // each. Re-targeting on arrival is what produces the stop-start rhythm
    // a bee has and a drifting particle does not.
    if (b.phase === "foraging" && Math.hypot(b.tx - b.x, b.ty - b.y) < 0.02) {
      b.tx = Math.min(Math.max(b.x + between(rnd, -0.05, 0.05), 0.03), 0.97);
      b.ty = Math.min(Math.max(b.y + between(rnd, -0.04, 0.04), 0.05), 0.95);
    }

    if (b.phase !== "resting") {
      const dx = b.tx - b.x;
      const dy = b.ty - b.y;
      const d = Math.hypot(dx, dy) || 1;
      const eager = b.phase === "foraging" ? 0.45 : 1.15;
      ax += (dx / d) * ACCEL * eager * b.vigour;
      ay += (dy / d) * ACCEL * eager * b.vigour;
    }

    // ── Get out of the way ───────────────────────────────────────────
    if (o.ptr) {
      const dx = b.x - o.ptr.x;
      const dy = b.y - o.ptr.y;
      const d = Math.hypot(dx, dy);
      if (d < FLEE_RADIUS && d > 0.0001) {
        const push = FLEE_FORCE * (1 - d / FLEE_RADIUS) ** 2;
        ax += (dx / d) * push;
        ay += (dy / d) * push;
        if (b.phase === "resting") {
          b.phase = "leaving";
          const p = patch(field.hives, o.wander, rnd);
          b.tx = p.x;
          b.ty = p.y;
        }
      }
    }

    b.vx += ax * dt;
    b.vy += ay * dt;
    b.vx -= b.vx * DRAG * dt;
    b.vy -= b.vy * DRAG * dt;

    // Capped at cruise, except while fleeing — a startled bee is quick.
    const speed = Math.hypot(b.vx, b.vy);
    const cap = o.ptr ? CRUISE * 3.4 : CRUISE * (b.phase === "foraging" ? 0.5 : 1.1);
    if (speed > cap) {
      b.vx = (b.vx / speed) * cap;
      b.vy = (b.vy / speed) * cap;
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.x < 0.01) { b.x = 0.01; b.vx = Math.abs(b.vx) * 0.5; }
    if (b.x > 0.99) { b.x = 0.99; b.vx = -Math.abs(b.vx) * 0.5; }
    if (b.y < 0.02) { b.y = 0.02; b.vy = Math.abs(b.vy) * 0.5; }
    if (b.y > 0.98) { b.y = 0.98; b.vy = -Math.abs(b.vy) * 0.5; }
  }
}

/**
 * Where to DRAW a forager: its position plus a buzz, and which way it faces.
 *
 * The buzz is visual only. It never enters the physics, or the bee would jitter
 * its way across the screen rather than hold a line. `t` is seconds. `tilt` is
 * degrees, 0 east, which a top-down sprite takes as its rotation.
 */
export function pose(b: Forager, t: number, calm: number): { x: number; y: number; tilt: number } {
  const amp = 0.0016 * calm * (b.phase === "resting" ? 0.3 : 1);
  const jx = amp * Math.sin(t * 36 * calm + b.buzz);
  const jy = amp * Math.cos(t * 49 * calm + b.buzz);
  const speed = Math.hypot(b.vx, b.vy);
  const tilt = speed > 0.004 ? Math.atan2(b.vy, b.vx) * (180 / Math.PI) : 0;
  return { x: b.x + jx, y: b.y + jy, tilt };
}
