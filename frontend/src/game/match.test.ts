/**
 * Who the finale belongs to.
 *
 * The board screen shows a coronation — a wave through the comb, a crown on the
 * queen, the meadow gathering at the doors — and it shows it to whoever the match
 * says won. Getting that wrong is not a cosmetic slip: it is a crown placed over
 * somebody else's queen while the player watches.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { youWon } from "./match.ts";
import type { Match } from "./match.ts";

/** Only the two fields the answer may depend on. */
function m(
  winner: { hive: number; beeId: number } | null,
  you: { hive: number; beeId: number } | null,
): Match {
  return { winner: winner && { ...winner, label: "x" }, you } as unknown as Match;
}

test("your own bee winning is your win", () => {
  assert.equal(youWon(m({ hive: 2, beeId: 5 }, { hive: 2, beeId: 5 })), true);
});

test("a rival in ANOTHER hive with the same seat number is not you", () => {
  // `beeId` is `hive.seats.length` at the time of sitting, so it is a seat index
  // within one hive and every hive has a bee 0. Comparing ids alone was true here.
  assert.equal(youWon(m({ hive: 3, beeId: 0 }, { hive: 1, beeId: 0 })), false);
  assert.equal(youWon(m({ hive: 0, beeId: 4 }, { hive: 2, beeId: 4 })), false);
});

test("a rival in your OWN hive is not you either", () => {
  assert.equal(youWon(m({ hive: 1, beeId: 7 }, { hive: 1, beeId: 2 })), false);
});

test("a match with no winner, or a watcher with no bee, wins nothing", () => {
  assert.equal(youWon(m(null, { hive: 1, beeId: 0 })), false);
  assert.equal(youWon(m({ hive: 1, beeId: 0 }, null)), false);
});
