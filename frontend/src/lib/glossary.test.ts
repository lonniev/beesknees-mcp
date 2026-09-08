/**
 * Definitions that are actually reached, and reached once.
 *
 * The two ways a glossary rots: a term nobody says any more, still defined; and
 * a wall of jargon on the page with nothing behind it. The first is checkable
 * here by reading the page's own source, so it is.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { TERMS, splitTerms } from "./glossary.ts";

const about = readFileSync(fileURLToPath(new URL("../pages/About.tsx", import.meta.url)), "utf8");

test("every definition is for a word the page actually uses", () => {
  for (const { term } of TERMS) {
    assert.match(
      about,
      new RegExp(`\\b${term}s?\\b`, "i"),
      `"${term}" is defined but the About page never says it`,
    );
  }
});

test("a term is marked once across a whole page, not once per paragraph", () => {
  const seen = new Set<string>();
  const first = splitTerms("An MCP service. Another MCP mention.", seen);
  // One marked node; the rest is plain text either side of it.
  assert.equal(first.filter((n) => typeof n !== "string").length, 1);

  const second = splitTerms("A third MCP sentence entirely.", seen);
  assert.equal(
    second.filter((n) => typeof n !== "string").length,
    0,
    "the second paragraph must not underline the same word again",
  );
  assert.equal(second.join(""), "A third MCP sentence entirely.");
});

test("plurals are matched, and partial words are not", () => {
  const marked = (s: string) => splitTerms(s, new Set()).filter((n) => typeof n !== "string").length;
  assert.equal(marked("every tool call is priced"), 1);
  assert.equal(marked("tool calls are priced"), 1, "the plural is the same term");
  assert.equal(marked("MCPish nonsense"), 0, "a word that merely starts with a term is not it");
  assert.equal(marked("agentic frameworks"), 0);
});

test("prose with no jargon comes back exactly as it went in", () => {
  const plain = "A bee crosses the meadow and waits its turn at the door.";
  assert.equal(splitTerms(plain, new Set()).join(""), plain);
});
