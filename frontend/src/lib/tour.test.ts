// The tour against the pages it walks: every name drawn, every page asked
// for, and the voice the package holds every site to.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { lintTours } from "@tollbooth-dpyc/web";
import { TARGETS, TOUR_PAGES, TOURS } from "./tour.ts";

const SRC = new URL("..", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return f.endsWith(".tsx") ? [p] : [];
  });
}
const ALL_TSX = sources(SRC).map((p) => readFileSync(p, "utf8")).join("\n");

describe("the tour and the pages", () => {
  const named = new Set<string>();
  for (const t of Object.values(TOURS)) for (const s of t.steps) {
    if (typeof s.target === "string" && !s.target.startsWith("tb.")) named.add(s.target);
  }

  it("every page named has a tour, and asks for it", () => {
    const where: Record<string, string> = {
      play: "pages/Play.tsx", lobby: "components/Lobby.tsx", board: "components/BoardScreen.tsx",
      honey: "pages/Honey.tsx", signin: "pages/SignIn.tsx", account: "pages/Profile.tsx",
    };
    for (const p of TOUR_PAGES) {
      assert.ok(TOURS[p].steps.length >= 3, `${p} has too few steps`);
      const src = readFileSync(join(SRC, where[p]), "utf8");
      assert.match(src, new RegExp(`useTour\\("${p}"`), `${where[p]} does not ask for the ${p} tour`);
    }
  });
  it("each named target is registered, drawn, and pointed at", () => {
    for (const n of named) assert.ok((TARGETS as readonly string[]).includes(n), `${n} is unregistered`);
    for (const n of TARGETS) {
      assert.ok(ALL_TSX.includes(`"${n}"`), `no page carries data-tour "${n}"`);
      assert.ok(named.has(n), `${n} is registered but no step points at it`);
    }
  });
  it("speaks in the voice the package holds every site to", () => {
    assert.deepEqual(lintTours(TOURS), []);
  });
});
