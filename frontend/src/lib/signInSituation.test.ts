/**
 * The message a patron actually saw, and what it should have said.
 *
 * The literal string below is the one that reached an iPad's sign-in screen on
 * 8 September 2026. It is kept verbatim rather than paraphrased: the point of
 * this module is that THIS text must never be the first thing a person reads,
 * and a paraphrase would let the test pass while the real one still leaked.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { readSignInFailure } from "./signInSituation.ts";

const SEEN =
  "Error calling tool 'beesknees_request_npub_proof': Relay registry unreachable " +
  "and no cached relays: get_relays() called from an async context (asyncio.run() " +
  "cannot be called from a running event loop); seed the registry or await the " +
  "Oracle client directly.";

test("a cold hive reads as 'try again', not as a broken key", () => {
  const s = readSignInFailure(SEEN);
  assert.equal(s.retryable, true);
  assert.match(s.lead, /try again/i);
  assert.ok(
    !/asyncio|event loop|get_relays/i.test(s.lead),
    "the SDK's own diagnosis must not be the sentence a person reads first",
  );
  assert.equal(s.detail, SEEN, "and it must still be there to paste into a bug report");
});

test("a dropped connection is told apart from a waking service", () => {
  const s = readSignInFailure("TypeError: Failed to fetch");
  assert.equal(s.retryable, true);
  assert.match(s.lead, /could not be reached/i);
});

test("an answer the service meant is passed through untouched", () => {
  // Not every failure is weather. "That npub is banned" is a verdict, and
  // dressing it up as a retry would send somebody round the loop for ever.
  const s = readSignInFailure("That npub is banned from this service.");
  assert.equal(s.retryable, false);
  assert.equal(s.lead, "That npub is banned from this service.");
  assert.equal(s.detail, "", "no second copy of a message that was already plain");
});

test("silence still says something", () => {
  const s = readSignInFailure("");
  assert.equal(s.retryable, false);
  assert.match(s.lead, /no reason/i);
});
