// Run: node --test src/lib/leaving.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stillLeaving } from "./leaving.ts";

const ME = "npub1me";
const OLD = "match-i-won";
const LOBBY = "match-forming";

describe("leaving the round you have read", () => {
  it("keeps saying so while sitting in a lobby it has not joined", () => {
    // THE BUG, twice reported. Clearing on the first different match meant one
    // poll carried `next_round`, the lobby came back, the flag was dropped —
    // and the next poll asked the ordinary question, so the server handed over
    // the finished round it holds for three minutes and the coronation
    // returned. The button undid itself once per poll.
    const lobby = { match_id: LOBBY, bees: [{ npub: "npub1someone" }] };
    assert.equal(stillLeaving(OLD, lobby, ME), OLD);
  });

  it("stops once the player is actually in a round again", () => {
    const joined = { match_id: LOBBY, bees: [{ npub: "npub1someone" }, { npub: ME }] };
    assert.equal(stillLeaving(OLD, joined, ME), "");
  });

  it("keeps saying so while the old round is still what answers", () => {
    const same = { match_id: OLD, bees: [{ npub: ME }] };
    assert.equal(stillLeaving(OLD, same, ME), OLD,
      "being handed the round you are leaving is not having left it");
  });

  it("says nothing when nothing is being left", () => {
    assert.equal(stillLeaving("", { match_id: LOBBY, bees: [] }, ME), "");
  });

  it("holds on through an answer that carries no match at all", () => {
    // `unchanged` replies and blips answer small. Neither is a handover.
    assert.equal(stillLeaving(OLD, {}, ME), OLD);
    assert.equal(stillLeaving(OLD, { match_id: LOBBY }, ME), OLD);
  });

  it("does not mistake somebody else's seat for yours", () => {
    const others = { match_id: LOBBY, bees: [{ npub: "npub1a" }, { npub: "npub1b" }] };
    assert.equal(stillLeaving(OLD, others, ME), OLD);
  });
});
