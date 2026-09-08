/**
 * The colour is measured, not eyeballed.
 *
 * Three separate reports — "all your grey texts is excruciating to read", "the
 * detail on this card is a bit hard to distinguish", "yellow on white is not
 * good for hyperlinks" — were all the same defect: a dark-theme colour left
 * behind when the palette went light. `amber-300` on this page ground is
 * 1.19:1.
 *
 * The tokens are READ from the shipped stylesheet rather than restated here.
 * A test that carries its own copy of the hex passes happily while the real
 * page is unreadable.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { ACCENT, LINK } from "./ink.ts";

const css = readFileSync(fileURLToPath(new URL("../index.css", import.meta.url)), "utf8");

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `--${name} is not defined in index.css`);
  return m![1];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const WHITE = "#ffffff";

test("link ink clears AA on both grounds this app uses", () => {
  const ink = token("color-wax-ink");
  const page = token("color-sky");
  for (const [what, ground] of [["the page", page], ["a white card", WHITE]] as const) {
    const r = contrast(ink, ground);
    assert.ok(r >= 4.5, `${ink} on ${what} (${ground}) is ${r.toFixed(2)}:1, under 4.5`);
  }
});

test("the colour it replaced would have failed, which is the point", () => {
  // amber-300, the value that shipped. Kept here as the counter-example so the
  // threshold above is known to be capable of failing.
  assert.ok(contrast("#fcd34d", token("color-sky")) < 2);
});

test("nothing declares a raw amber text class where the token belongs", () => {
  for (const cls of [LINK, ACCENT]) {
    assert.ok(
      !/text-amber-[234]00/.test(cls),
      "the light-theme tokens are the only ink these are allowed to carry",
    );
  }
});
