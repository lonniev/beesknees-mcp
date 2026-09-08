/**
 * The state the shell used to call "signed in".
 *
 * A person pasted an npub, pressed Send proof DM, and never answered it. The
 * npub was already in storage — put there so the field would be prefilled —
 * and the shell asked only whether an npub was known. It let them in.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { canSignFor, isProven } from "./signedIn.ts";

const NPUB = "npub1yp8zlyv88cmxazp5zl307s97dv6vszgrcgnc";
const OTHER = "npub1d999638crq64z";

test("a DM that was sent and never answered is not a sign-in", () => {
  assert.equal(isProven({ npub: NPUB, proof: "", sessionNpub: null }), false);
});

test("an answered challenge is", () => {
  assert.equal(isProven({ npub: NPUB, proof: "seven-amber-doorway", sessionNpub: null }), true);
});

test("a session key proves the npub it derives to, and no other", () => {
  assert.equal(isProven({ npub: NPUB, proof: "", sessionNpub: NPUB }), true);
  assert.equal(
    isProven({ npub: NPUB, proof: "", sessionNpub: OTHER }),
    false,
    "a key left from a previous identity proves nothing about this one",
  );
});

test("no npub is no session, whatever else is lying around", () => {
  assert.equal(isProven({ npub: "", proof: "a stale token", sessionNpub: OTHER }), false);
});

test("signing for yourself is narrower than being proven", () => {
  // Living on a cached proof is a real session; it just cannot sign, which is
  // the distinction the pages that spend money have to make.
  const cached = { npub: NPUB, proof: "seven-amber-doorway", sessionNpub: null };
  assert.equal(isProven(cached), true);
  assert.equal(canSignFor(cached), false);
});
