/**
 * A charity ledger may not invent an exchange rate.
 *
 * The failure mode this guards is not a crash — it is a plausible number. A
 * page that says where donations went is the page somebody screenshots, and a
 * dollar figure derived from a rate that never arrived would be a figure
 * nobody could reproduce.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { usd } from "./btcUsd.ts";

const SATS_PER_BTC = 100_000_000;

test("no rate means no dollars, not zero dollars", () => {
  assert.equal(usd(50_000, null), null);
  assert.equal(usd(0, null), null);
});

test("dollars stop at the penny", () => {
  // A round hundred dollars' worth, at a round rate.
  assert.equal(usd(SATS_PER_BTC / 1000, 100_000), "$100.00");
  assert.match(usd(12_345, 100_000)!, /^\$\d+\.\d{2}$/, "two decimal places, never more");
});

test("a sum too small to be a cent says so rather than reading as nothing", () => {
  // One satoshi at $100k is a hundredth of a cent. "$0.00" on a receipt reads
  // as "nothing was raised", which is not what happened.
  assert.equal(usd(1, 100_000), "<$0.01");
  assert.equal(usd(0, 100_000), "$0.00", "and nothing really is nothing");
});

test("the conversion is the obvious one", () => {
  assert.equal(usd(SATS_PER_BTC, 60_000), "$60,000.00".replace(/,/g, ""));
});
