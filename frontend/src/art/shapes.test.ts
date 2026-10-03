/**
 * One source, two renderers: every mark must come out of both without a
 * complaint, and the two facts the stage relies on must hold — the bee faces
 * east, and a wingbeat is two different frames. Node has no canvas, so the
 * painter runs against a context that only remembers what was asked of it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { paintShape } from "./canvas.ts";
import { SYMBOLS, bee, type Prim, type SymbolId } from "./shapes.ts";

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

// `Path2D` is a browser class; the painter news one up for every `path` and
// every path clip, and the recorder only needs it to exist.
(globalThis as { Path2D?: unknown }).Path2D ??= class {
  d: string;
  constructor(d: string) { this.d = d; }
};

function walk(prims: Prim[], f: (p: Prim) => void): void {
  for (const p of prims) {
    f(p);
    if (p.k === "group") {
      if (p.clip) f(p.clip);
      walk(p.kids, f);
    }
  }
}

test("every symbol paints on a canvas without throwing, and is non-empty", () => {
  for (const id of Object.keys(SYMBOLS) as SymbolId[]) {
    const shape = SYMBOLS[id]();
    assert.ok(shape.prims.length > 0, `${id} is empty`);
    const { ctx, calls } = recorder();
    paintShape(ctx, 64, shape);
    const drew = calls.filter((c) => c.op === "fill" || c.op === "stroke").length;
    assert.ok(drew > 0, `${id} painted nothing`);
  }
});

test("every primitive stays inside its symbol's box", () => {
  for (const id of Object.keys(SYMBOLS) as SymbolId[]) {
    const shape = SYMBOLS[id]();
    walk(shape.prims, (p) => {
      if (p.k === "ellipse") {
        const reach = Math.max(p.rx, p.ry);
        assert.ok(Math.abs(p.cx) + reach <= shape.box * 1.3 && Math.abs(p.cy) + reach <= shape.box * 1.3, `${id}: an ellipse leaves the box`);
      }
      if (p.k === "circle") assert.ok(Math.abs(p.cx) + p.r <= shape.box && Math.abs(p.cy) + p.r <= shape.box, `${id}: a circle leaves the box`);
    });
  }
});

test("the bee faces east: its head is drawn to the right of its abdomen", () => {
  const { ctx, calls } = recorder();
  paintShape(ctx, 64, bee("up"));
  const arcs = calls.filter((c) => c.op === "arc").map((c) => c.args[0] as number);
  const ellipses = calls.filter((c) => c.op === "ellipse").map((c) => c.args as number[]);
  const head = Math.max(...arcs);
  const abdomen = ellipses.find((e) => e[2] === 14)!;
  assert.ok(head > abdomen[0], "head must sit at +x, the heading the stage rotates from");
});

test("a wingbeat is two frames that differ only in wing angle", () => {
  const up = bee("up");
  const down = bee("down");
  const rot = (s: typeof up) => s.prims.filter((p) => p.k === "group" && p.rot).map((p) => (p as { rot: number }).rot);
  assert.notDeepEqual(rot(up), rot(down));
  assert.equal(up.prims.length, down.prims.length);
});

test("currentColor paints as whatever the caller says it is", () => {
  const seen = new Set<string>();
  const spy = new Proxy({} as CanvasRenderingContext2D, {
    get: () => () => undefined,
    set(_, key: string, value) { if (key === "fillStyle") seen.add(String(value)); return true; },
  });
  paintShape(spy, 48, SYMBOLS.crown(), { current: "#abcdef" });
  assert.ok(seen.has("#abcdef"), "the crown's currentColor fill must become the tint");
  assert.ok(!seen.has("currentColor"));
});
