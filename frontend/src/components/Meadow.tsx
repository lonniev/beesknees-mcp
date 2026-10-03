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
 * darting-then-hovering character — see `lib/forage.ts`, where the physics
 * lives so a test can reach it.
 *
 * Unlike the goodearth sibling it came from, home is not one hive. A forager picks a hive, works a
 * patch, and returns to whichever one it fancies — so the traffic actually
 * crosses the screen instead of orbiting a corner.
 */

import { useEffect, useRef, useState } from "react";
import { paintShape, paintedCanvas } from "../art/canvas.ts";
import { bee } from "../art/shapes.ts";
import { drawnHive } from "../lib/beeFlight.ts";
import { pose, spawn, step, type Field } from "../lib/forage.ts";

/**
 * The physics lives in `lib/forage.ts`, where `node --test` can reach it. This
 * file is the part a test cannot hold still: measuring where the hives are on
 * the real page, and moving the nodes.
 */

/** Every hive on screen, measured together, or nothing before first paint. */
function measure(host: HTMLElement): Field {
  const box = host.getBoundingClientRect();
  if (!box.width || !box.height) return { w: 0, h: 0, hives: [], focus: null };
  const layer = { w: box.width, h: box.height };
  let focus: Field["focus"] = null;
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
    const bees = spawn(count, field.hives, wander, Math.random);

    // The same painted bee as the board's racers, seen from above, so the
    // scenery and the game are one species. Two canvases per bee — wings up,
    // wings down — and the flap is which one is showing. The canvas sits
    // centred on the bee's point so the rotation turns it about its thorax.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    host.replaceChildren();
    const nodes = bees.map((b) => {
      const el = document.createElement("div");
      const px = Math.round(16 + b.scale * 6);
      el.style.cssText =
        "position:absolute;left:0;top:0;pointer-events:none;will-change:transform;" +
        `width:${px}px;height:${px}px;margin:${-px / 2}px 0 0 ${-px / 2}px;opacity:.78;`;
      el.setAttribute("aria-hidden", "true");
      const up = paintedCanvas(px, dpr, (ctx, size) => paintShape(ctx, size, bee("up")));
      const down = paintedCanvas(px, dpr, (ctx, size) => paintShape(ctx, size, bee("down")));
      for (const c of [up, down]) {
        c.style.position = "absolute";
        c.style.inset = "0";
        el.appendChild(c);
      }
      down.style.visibility = "hidden";
      host.appendChild(el);
      return { el, up, down };
    });

    // The hives move: the gutters collapse below `md`, the focus changes, the
    // window resizes. Re-read on a slow beat rather than every frame — five
    // getBoundingClientRect calls per frame would be five forced layouts.
    const remeasure = window.setInterval(() => {
      field = measure(host);
    }, 2000);

    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const ptr = pointer.current && pointer.current.until > now ? pointer.current : null;

      // A layer with no size means the row is not laid out yet — mid-collapse,
      // or a tab that was never shown. Every bee would translate to the origin
      // and pile up in the corner, so hold the frame instead.
      if (!field.w || !field.h) {
        raf.current = requestAnimationFrame(frame);
        return;
      }

      step(bees, field, dt, { calm, wander, ptr, call: call.current }, Math.random);

      const t = now / 1000;
      // The wingbeat: ~20 flaps a second, each bee on its own clock so a row
      // of them does not beat in step. Reduced motion holds the wings still.
      bees.forEach((b, i) => {
        const at = pose(b, t, calm);
        // Face the flight path. Top-down, so heading is the whole of it —
        // no mirror, nothing upside down.
        nodes[i].el.style.transform =
          `translate(${at.x * field.w}px, ${at.y * field.h}px) rotate(${at.tilt}deg)`;
        const flying = b.phase !== "resting";
        const wingsUp = !reduced && flying ? (((t * 20 + b.buzz) | 0) & 1) === 0 : true;
        nodes[i].up.style.visibility = wingsUp ? "" : "hidden";
        nodes[i].down.style.visibility = wingsUp ? "hidden" : "";
      });

      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
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
