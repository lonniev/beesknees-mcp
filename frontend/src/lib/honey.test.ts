import assert from "node:assert/strict";
import { test } from "node:test";
import { distanceLabel, nearFromPosition, sellerGlyph, usesMiles } from "./honey.ts";

test("miles where the road signs say so, kilometres everywhere else", () => {
  assert.equal(usesMiles("en-US"), true);
  assert.equal(usesMiles("en-GB"), true);
  assert.equal(usesMiles("fr-CA"), false);
  assert.equal(usesMiles("en"), false);
});

test("a distance reads whole, or to one decimal when it is small", () => {
  assert.equal(distanceLabel(16.4, false), "16 km");
  assert.equal(distanceLabel(16.4, true), "10 mi");
  assert.equal(distanceLabel(2.35, false), "2.4 km");
  assert.equal(distanceLabel(3.0, false), "3 km");
});

test("a position becomes the service's lat,lon", () => {
  assert.equal(nearFromPosition(44.1681052, -73.2518037), "44.16811,-73.25180");
});

test("every kind has a mark and the unknown one is a flower", () => {
  assert.equal(sellerGlyph("honey"), "🍯");
  assert.equal(sellerGlyph("beekeeper"), "🐝");
  assert.equal(sellerGlyph("anything else"), "🌻");
});
