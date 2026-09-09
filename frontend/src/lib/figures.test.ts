/**
 * The house style for a figure and a key, now that two screens share it.
 *
 * These were local helpers inside the ledger page. The lobby renders the same
 * standings and the same sat totals, and a reader compares the two — so the
 * rules are pinned here rather than left to whichever copy is edited next.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sats, shortNpub } from "./figures.ts";

describe("a sat figure", () => {
  it("groups, and never abbreviates", () => {
    assert.equal(sats(1234567), "1,234,567");
    // "1.2M sats" is not a receipt. The ledger's whole claim is that the
    // figure can be checked, and a rounded one cannot.
    assert.ok(!sats(1234567).includes("M"));
  });

  it("reads zero as zero, because that is usually the truth", () => {
    // Before any match settles these ARE zero, and a dash or a blank would
    // read as "not loaded" on a page whose point is that nothing is hidden.
    assert.equal(sats(0), "0");
  });

  it("does not print NaN at a reader", () => {
    assert.equal(sats(NaN), "0");
    assert.equal(sats(undefined as unknown as number), "0");
  });
});

describe("a shortened npub", () => {
  const key = "npub1qqqqqqwwwwwweeeeeerrrrrrttttttyyyyyy";

  it("keeps both ends", () => {
    const out = shortNpub(key);
    // The head alone is useless — every npub starts `npub1` — and the tail
    // alone loses the part somebody has actually memorised.
    assert.ok(out.startsWith("npub1qqqqq"), out);
    assert.ok(out.endsWith(key.slice(-4)), out);
    assert.ok(out.includes("…"));
  });

  it("leaves a short key whole rather than eliding nothing", () => {
    assert.equal(shortNpub("npub1short"), "npub1short");
    assert.equal(shortNpub(""), "");
  });
});
