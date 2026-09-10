/**
 * The live board must not give worse guidance than the practice board.
 *
 * It did. `SoloBoard` had a phase-aware hint that names the thing to tap and
 * shows the mark for it; `LiveBoard` had
 * `note || (target === null ? "Tap where you want to end up." : "Press to move.")`
 * — two sentences for an entire round. The board that costs sats was the one
 * helping least, and nothing failed, because a hint has no type.
 *
 * These hold the guidance itself, so one board cannot quietly drift from the
 * other again: there is now only one function, and this is what it says.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { nextStep } from "./nextStep.ts";

test("an unaimed forager is told to tap a flower, and shown which kind", () => {
  const s = nextStep("forage", false, "", "Fly");
  assert.match(s.text, /flower that still has pollen/);
  assert.equal(s.mark, "pollen", "the mark is the half that says WHICH flower");
});

test("an unaimed returner is told to choose a door, and shown one", () => {
  const s = nextStep("return", false, "", "Fly");
  assert.match(s.text, /door/i);
  assert.equal(s.mark, "door");
});

test("inside the hive with no aim, the hint names the goal rather than a mark", () => {
  const s = nextStep("tunnel", false, "", "Crawl");
  assert.match(s.text, /the queen, or anywhere on the way/);
  assert.equal(s.mark, null);
});

test("the board's own objection outranks the phase", () => {
  // A prompt that reports the phase while the board is refusing the press is
  // the failure that produced "No way through" at the moment the bee succeeded.
  const s = nextStep("forage", true, "That flower has been emptied.", "Fly");
  assert.equal(s.text, "That flower has been emptied.");
  assert.equal(s.mark, null);
});

test("the press is named by the word the board is using", () => {
  assert.match(nextStep("tunnel", true, "", "Crawl").text, /crawl the line/);
  assert.match(nextStep("tunnel", true, "", "Fly").text, /fly the line/);
  assert.match(nextStep("forage", true, "", "Crawl").text, /press to crawl\.$/);
});

test("a finished bee is told it is finished, not told to tap something", () => {
  const s = nextStep("done", false, "", "Fly");
  assert.equal(s.text, "At the queen.");
  assert.equal(s.mark, null);
});

test("no phase ever yields an empty hint", () => {
  for (const phase of [undefined, "forage", "return", "tunnel", "done", "unheard-of"]) {
    for (const aimed of [true, false]) {
      const s = nextStep(phase, aimed, "", "Fly");
      assert.ok(s.text.trim().length > 0, `empty hint for ${phase}/${aimed}`);
    }
  }
});

test("BOTH boards read this one function", async () => {
  // The regression was two implementations, not a bad string. A guard on the
  // strings alone would have passed the whole time the live board had its own.
  const { readFile } = await import("node:fs/promises");
  for (const f of ["src/LiveBoard.tsx", "src/SoloBoard.tsx"]) {
    const src = await readFile(f, "utf8");
    assert.ok(/<NextStep\b/.test(src), `${f} does not use the shared hint`);
    // `assert.ok`, not `doesNotMatch`: the latter prints the whole file when it
    // fails, which buries the one line that matters under five kilobytes.
    assert.ok(!/Press to move\./.test(src), `${f} still carries its own hint`);
  }
});
