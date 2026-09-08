/**
 * The bees that are not playing.
 *
 * Five hives sit on this screen and, until now, nothing moved between them
 * except the racers. A hive with no traffic reads as a diagram; a meadow with
 * foragers crossing it reads as a place the race is happening IN. That is the
 * whole job — these are scenery.
 *
 * ── Not confusable with a racer ────────────────────────────────────────────
 *
 * A racing bee is the same 🐝 glyph, sitting on a cell. So a loose one drifting
 * over a board would be a bee on the playfield that the rules know nothing
 * about, which is worse than no bees at all. This layer therefore sits BEHIND
 * the hives: each hive paints an opaque meadow square, so a forager crossing
 * one is occluded and reappears in the gaps. They live in the space BETWEEN
 * hives and can never appear on a board — the occlusion is the guarantee, not a
 * tuning value somebody has to keep true.
 *
 * ── The trip ───────────────────────────────────────────────────────────────
 *
 *   leaving → foraging → returning → at a door → out again
 *
 * on steering forces with acceleration and drag, which is what gives a bee its
 * darting-then-hovering character. Ported from goodearth-mcp, where the flight
 * answers a real question — honeybees do not forage below about 13 °C, so the
 * count and the vigour there ARE the temperature reading. Nothing here reads
 * anything: this is a nice room at 25 °C and the bees are simply out. The
 * constant below says so rather than leaving a stripped-out instrument looking
 * like one that broke.
 *
 * Unlike the sibling, home is not one hive. A forager picks a hive, works a
 * patch, and returns to whichever one it fancies — so the traffic actually
 * crosses the screen instead of orbiting a corner.
 */

import { useEffect, useRef, useState } from "react";
import { aimBee, doorOn, drawnHive, type Hive } from "../lib/beeFlight.ts";

type Phase = "leaving" | "foraging" | "returning" | "resting";

interface Forager {
  /** Fractions of the layer, not the viewport: this layer is not the page. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: Phase;
  tx: number;
  ty: number;
  /** Seconds left in the current phase. */
  timer: number;
  buzz: number;
  scale: number;
  /** Per-bee speed variation — a meadow is not a formation. */
  vigour: number;
  /** Which rally this bee has already answered. See `rally` below. */
  called: number;
}

/**
 * How lively they are, on nothing's authority but the look of the thing.
 *
 * In goodearth this is `(°F − 55) / 30` — a real reading, because a bee below
 * the flight threshold is a fact about the grower's morning. Here it is a dial
 * with one setting: a nice room, bees out and working.
 */
const AIR = 0.55;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Field {
  /** The layer's own size in pixels — what the fractions are fractions OF. */
  w: number;
  h: number;
  hives: Hive[];
  /** The hive being played, if one is marked. Where a rally goes. */
  focus: Hive | null;
}

/** Every hive on screen, measured together, or nothing before first paint. */
function measure(host: HTMLElement): Field {
  const box = host.getBoundingClientRect();
  if (!box.width || !box.height) return { w: 0, h: 0, hives: [], focus: null };
  const layer = { w: box.width, h: box.height };
  let focus: Hive | null = null;
  const hives = Array.from(host.parentElement?.querySelectorAll("[data-hive]") ?? [])
    .map((el) => {
      const r = el.getBoundingClientRect();
      const h = drawnHive(
        { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height },
        layer,
      );
      if (el.getAttribute("data-hive") === "focus") focus = h;
      return h;
    })
    .filter((h) => h.hx > 0.001 && h.hy > 0.001);
  return { ...layer, hives, focus };
}

/**
 * The band a reading page keeps for its words, as fractions of the width.
 *
 * Only consulted when there are no hives — see `anyDoor`. A prose page has one
 * column down the middle and margins either side, and a bee crossing the column
 * is not scenery, it is something on top of the sentence.
 */
const COLUMN = { from: 0.26, to: 0.74 };

/**
 * Somewhere worth visiting: out in the open, and far enough from every hive
 * that the trip is a trip rather than a hover at the door.
 */
function patch(hs: Hive[], keepColumnClear = false): { x: number; y: number } {
  const side = () =>
    Math.random() < 0.5 ? rnd(0.03, COLUMN.from) : rnd(COLUMN.to, 0.97);
  for (let i = 0; i < 12; i++) {
    const p = keepColumnClear
      ? { x: side(), y: rnd(0.05, 0.95) }
      : { x: rnd(0.03, 0.97), y: rnd(0.05, 0.95) };
    const clear = hs.every(
      (h) => Math.abs(p.x - h.cx) > h.hx * 1.35 || Math.abs(p.y - h.cy) > h.hy * 1.35,
    );
    if (clear) return p;
  }
  return keepColumnClear
    ? { x: side(), y: rnd(0.05, 0.95) }
    : { x: rnd(0.03, 0.97), y: rnd(0.05, 0.95) };
}

/**
 * A door on some hive, chosen at random — nobody here has a home hive.
 *
 * With NO hives on the screen there is nowhere to come home to, so the bee
 * simply picks another patch: it wanders rather than commutes. Returning to
 * `{0.5, 0.5}`, which is what this used to do, sent every bee on a page to the
 * dead centre — the one place the words are.
 */
function anyDoor(hs: Hive[], keepColumnClear = false): { x: number; y: number } {
  if (!hs.length) return patch(hs, keepColumnClear);
  return doorOn(hs[Math.floor(Math.random() * hs.length)], rnd(0, Math.PI * 2));
}

function spawn(n: number, hs: Hive[], keepColumnClear = false): Forager[] {
  return Array.from({ length: n }, (_, i) => {
    const d = anyDoor(hs, keepColumnClear);
    return {
      x: d.x,
      y: d.y,
      vx: 0,
      vy: 0,
      phase: "resting" as Phase,
      tx: d.x,
      ty: d.y,
      timer: rnd(0.1, 3) + i * 0.4, // stagger the departures
      buzz: rnd(0, 6.28),
      scale: rnd(0.8, 1.25),
      vigour: rnd(0.8, 1.25),
      called: 0,
    };
  });
}

/**
 * The wandering bees, on a page that has no board.
 *
 * The static SVG bees this replaces drifted on one CSS keyframe: the same arc,
 * for ever, four times over. These are the foragers from the playfield — real
 * steering, real acceleration, the stop-start of something working a patch —
 * and using them means the life on a reading page and the life on the board are
 * one piece of code rather than two that will come to differ.
 *
 * Mounted rather than hidden below 1024px, because hidden is not unmounted and
 * a still animation loop is a still animation loop. Below that the reading
 * column is the whole width and there is nowhere for a bee to be that is not on
 * top of the words.
 */
export function PageBees({ count = 6 }: { count?: number }) {
  const [room, setRoom] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setRoom(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return room ? <Meadow count={count} over="page" /> : null;
}

export default function Meadow({
  count = 8,
  rally = false,
  over = "board",
}: {
  count?: number;
  rally?: boolean;
  /**
   * `board` is the original: a layer inside the playfield, behind the hives.
   * `page` is the whole viewport on a screen that has no hives at all — the
   * bees wander it and keep out of the reading column.
   */
  over?: "board" | "page";
}) {
  const layer = useRef<HTMLDivElement | null>(null);
  const raf = useRef<number>(0);
  const pointer = useRef<{ x: number; y: number; until: number } | null>(null);

  /**
   * The meadow comes to the wedding.
   *
   * When a race ends, every forager breaks off and makes for the hive being
   * played. Answered ONCE per call rather than re-aimed every frame, or a bee
   * would pick a new door sixty times a second and shiver in place instead of
   * flying anywhere. The counter is what a bee compares itself against, so a
   * second win later in the session calls them out again.
   *
   * A ref, not state: this must not restart the flight, which is exactly what
   * putting it in the effect's deps would do — every bee back to a door, mid
   * celebration.
   */
  const call = useRef({ on: false, seq: 0 });
  if (rally !== call.current.on) {
    call.current = { on: rally, seq: call.current.seq + (rally ? 1 : 0) };
  }

  // Bees veer off from a looming hand and these do too. Passive, on window, and
  // never preventDefault — the layer is pointer-events:none throughout, so
  // nothing here can swallow a tap on the board underneath it.
  useEffect(() => {
    const mark = (e: PointerEvent) => {
      const host = layer.current;
      if (!host) return;
      const b = host.getBoundingClientRect();
      if (!b.width || !b.height) return;
      pointer.current = {
        x: (e.clientX - b.left) / b.width,
        y: (e.clientY - b.top) / b.height,
        // A touch is a moment, not a position: keep scattering briefly after
        // the finger lifts, which is what makes it read as a startle.
        until: performance.now() + (e.type === "pointerdown" ? 900 : 260),
      };
    };
    window.addEventListener("pointermove", mark, { passive: true });
    window.addEventListener("pointerdown", mark, { passive: true });
    return () => {
      window.removeEventListener("pointermove", mark);
      window.removeEventListener("pointerdown", mark);
    };
  }, []);

  useEffect(() => {
    const host = layer.current;
    if (!host || !count) return;

    // Reduced motion CALMS the flight rather than stopping it. The setting asks
    // for less movement, not for a still life, and a frozen bee on a board that
    // is still animating reads as a bug.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const calm = reduced ? 0.4 : 1;

    const wander = over === "page";
    let field = measure(host);
    const bees = spawn(count, field.hives, wander);

    host.replaceChildren();
    const nodes = bees.map((b) => {
      const el = document.createElement("div");
      el.style.cssText =
        "position:absolute;left:0;top:0;pointer-events:none;will-change:transform;" +
        `font-size:${10 + b.scale * 4}px;line-height:1;user-select:none;opacity:.62;`;
      el.textContent = "🐝";
      el.setAttribute("aria-hidden", "true");
      host.appendChild(el);
      return el;
    });

    // The hives move: the gutters collapse below `md`, the focus changes, the
    // window resizes. Re-read on a slow beat rather than every frame — five
    // getBoundingClientRect calls per frame would be five forced layouts.
    const remeasure = window.setInterval(() => {
      field = measure(host);
    }, 2000);

    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const ptr = pointer.current && pointer.current.until > now ? pointer.current : null;

      // A layer with no size means the row is not laid out yet — mid-collapse,
      // or a tab that was never shown. Every bee would translate to the origin
      // and pile up in the corner, so hold the frame instead.
      if (!field.w || !field.h) {
        raf.current = requestAnimationFrame(step);
        return;
      }

      // A forager works a patch; it does not race. Tuned so crossing the board
      // takes the better part of ten seconds — quicker than that reads as
      // agitation, and agitated scenery pulls the eye off the game.
      const CRUISE = (0.055 + AIR * 0.075) * calm;
      const ACCEL = (0.5 + AIR * 0.5) * calm;
      const DRAG = 3.0;
      const FLEE_RADIUS = 0.11;
      const FLEE_FORCE = 3.2;

      bees.forEach((b, i) => {
        b.timer -= dt;

        // ── Called to the wedding ──────────────────────────────────────
        if (call.current.on && field.focus && b.called !== call.current.seq) {
          const d = doorOn(field.focus, rnd(0, Math.PI * 2));
          b.tx = d.x;
          b.ty = d.y;
          b.phase = "returning";
          b.called = call.current.seq;
        }

        // ── The trip ───────────────────────────────────────────────────
        if (b.phase === "resting" && b.timer <= 0) {
          if (call.current.on && field.focus) {
            // Nobody goes back to work during a coronation. They circle the
            // doors instead — a crowd gathering rather than a queue standing.
            const d = doorOn(field.focus, rnd(0, Math.PI * 2));
            b.tx = d.x;
            b.ty = d.y;
            b.phase = "returning";
          } else {
            const p = patch(field.hives, wander);
            b.tx = p.x;
            b.ty = p.y;
            b.phase = "leaving";
          }
        } else if (b.phase === "leaving" && Math.hypot(b.tx - b.x, b.ty - b.y) < 0.05) {
          b.phase = "foraging";
          b.timer = rnd(5, 14); // stay and work it
        } else if (b.phase === "foraging" && b.timer <= 0) {
          b.phase = "returning";
          // Any hive, not the one it left — which is what puts traffic BETWEEN
          // the hives rather than a private orbit around each.
          const d = anyDoor(field.hives, wander);
          b.tx = d.x;
          b.ty = d.y;
        } else if (b.phase === "returning" && Math.hypot(b.tx - b.x, b.ty - b.y) < 0.03) {
          b.phase = "resting";
          b.timer = rnd(1.5, 4.5); // unload at the door
          b.vx *= 0.2;
          b.vy *= 0.2;
        }

        // ── Steering ───────────────────────────────────────────────────
        let ax = 0;
        let ay = 0;

        // Working a patch: short hops to neighbouring flowers with a pause at
        // each. Re-targeting on arrival is what produces the stop-start rhythm
        // a bee has and a drifting particle does not.
        if (b.phase === "foraging" && Math.hypot(b.tx - b.x, b.ty - b.y) < 0.02) {
          b.tx = Math.min(Math.max(b.x + rnd(-0.05, 0.05), 0.03), 0.97);
          b.ty = Math.min(Math.max(b.y + rnd(-0.04, 0.04), 0.05), 0.95);
        }

        if (b.phase !== "resting") {
          const dx = b.tx - b.x;
          const dy = b.ty - b.y;
          const d = Math.hypot(dx, dy) || 1;
          const eager = b.phase === "foraging" ? 0.45 : 1.15;
          ax += (dx / d) * ACCEL * eager * b.vigour;
          ay += (dy / d) * ACCEL * eager * b.vigour;
        }

        // ── Get out of the way ─────────────────────────────────────────
        if (ptr) {
          const dx = b.x - ptr.x;
          const dy = b.y - ptr.y;
          const d = Math.hypot(dx, dy);
          if (d < FLEE_RADIUS && d > 0.0001) {
            const push = FLEE_FORCE * (1 - d / FLEE_RADIUS) ** 2;
            ax += (dx / d) * push;
            ay += (dy / d) * push;
            if (b.phase === "resting") {
              b.phase = "leaving";
              const p = patch(field.hives, wander);
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
        const cap = ptr ? CRUISE * 3.4 : CRUISE * (b.phase === "foraging" ? 0.5 : 1.1);
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

        // ── Render ─────────────────────────────────────────────────────
        // The buzz is visual only. It never enters the physics, or the bee
        // would jitter its way across the screen rather than hold a line.
        const t = now / 1000;
        const amp = 0.0016 * calm * (b.phase === "resting" ? 0.3 : 1);
        const jx = amp * Math.sin(t * 36 * calm + b.buzz);
        const jy = amp * Math.cos(t * 49 * calm + b.buzz);

        // Face the flight path. The physics is untouched — this only decides
        // which way the drawing points along a vector it did not choose.
        const tilt = speed > 0.004 ? Math.atan2(b.vy, b.vx) * (180 / Math.PI) : 0;
        const aim = aimBee(tilt);

        nodes[i].style.transform =
          `translate(${(b.x + jx) * field.w}px, ${(b.y + jy) * field.h}px) ` +
          `rotate(${aim.rotate}deg) ` +
          `scale(${aim.mirror ? -b.scale : b.scale}, ${b.scale})`;
      });

      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf.current);
      window.clearInterval(remeasure);
    };
  }, [count, over]);

  return (
    <div
      ref={layer}
      aria-hidden="true"
      className={`pointer-events-none -z-10 overflow-hidden ${
        over === "page" ? "fixed inset-0" : "absolute inset-0"
      }`}
    />
  );
}
