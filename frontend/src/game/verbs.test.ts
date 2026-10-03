/**
 * Both boards read their words from here, so a change to one is a change to
 * both — and a test that a wait is named after the WORK, not the idleness.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { activityLabel, moveWord, readyLabel, tacticLabel, verbIcon, verbLabel } from "./verbs.ts";

test("moving names itself from where the step ends", () => {
  assert.equal(moveWord(false), "Fly");
  assert.equal(moveWord(true), "Crawl");
  assert.equal(verbLabel("move", "Fly"), "Fly!");
  assert.equal(verbLabel("move", "Crawl"), "Crawl!");
  assert.equal(verbLabel("seal", "Fly"), "Fill!");
});

test("wings above ground, feet below, wax for the seal", () => {
  assert.equal(verbIcon("move", "Fly"), "go");
  assert.equal(verbIcon("move", "Crawl"), "crawl");
  assert.equal(verbIcon("seal", "Fly"), "fill");
});

test("a wait is named after the work, and the verb that caused it rides the label", () => {
  assert.deepEqual(activityLabel("dig", "Crawl"), { icon: "crawl", text: "Digging…" });
  assert.deepEqual(activityLabel("collapse", "Fly"), { icon: "fill", text: "Sealing…" });
  assert.deepEqual(activityLabel("fly", "Fly"), { icon: "go", text: "Flying…" });
  assert.deepEqual(activityLabel("fly", "Crawl"), { icon: "crawl", text: "Crawling…" });
  assert.equal(activityLabel(null, "Fly").text, "Resting…");
  assert.equal(activityLabel("wait", "Fly").text, "Resting…");
});

test("ready says what pressing will do", () => {
  assert.deepEqual(readyLabel("move", "Crawl"), { icon: "crawl", text: "Crawl!" });
  assert.deepEqual(readyLabel("seal", "Fly"), { icon: "fill", text: "Fill!" });
});

test("the tactic's teeny label follows the word, and the seal is a mound", () => {
  assert.equal(tacticLabel("move", "Fly"), "fly");
  assert.equal(tacticLabel("move", "Crawl"), "crawl");
  assert.equal(tacticLabel("seal", "Crawl"), "mound");
});
