/**
 * Definitions that are actually reached, and reached once.
 *
 * The two ways a glossary rots: a term nobody says any more, still defined; and
 * a wall of jargon on the page with nothing behind it. The first is checkable
 * here by running each language's About words through its own glossary, so it is.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { LANGUAGES } from "@tollbooth-dpyc/web";
import english from "../i18n/en.ts";
import { TERM_IDS, glossary, splitTerms, type Term } from "./glossary.ts";

/** One language's terms, read straight from its catalog. */
function termsOf(words: Record<string, string>) {
  return glossary((key) => words[key] ?? english[key as keyof typeof english]);
}

/** Every term the About page underlines in that language: its words run through the glossary. */
function marked(words: Record<string, string>, terms: Term[]): Set<string> {
  const seen = new Set<string>();
  const about = Object.keys(english).filter((k) => k.startsWith("about."));
  for (const k of about) splitTerms(words[k] ?? english[k as keyof typeof english], seen, terms);
  return seen;
}

for (const { code } of LANGUAGES) {
  test(`${code}: every definition is for a word the About page actually says`, async () => {
    const words: Record<string, string> = code === "en" ? english : (await import(`../i18n/${code}.ts`)).default;
    const terms = termsOf(words);
    const seen = marked(words, terms);
    for (const id of TERM_IDS) {
      const forms = terms.find((t) => t.id === id)!.forms.join(" | ");
      assert.ok(seen.has(id), `${code}: "${forms}" is defined but the About page never says it`);
    }
  });
}

const EN = termsOf(english);

test("a term is marked once across a whole page, not once per paragraph", () => {
  const seen = new Set<string>();
  const first = splitTerms("An MCP service. Another MCP mention.", seen, EN);
  // One marked node; the rest is plain text either side of it.
  assert.equal(first.filter((n) => typeof n !== "string").length, 1);

  const second = splitTerms("A third MCP sentence entirely.", seen, EN);
  assert.equal(
    second.filter((n) => typeof n !== "string").length,
    0,
    "the second paragraph must not underline the same word again",
  );
  assert.equal(second.join(""), "A third MCP sentence entirely.");
});

test("plurals are matched, and partial words are not", () => {
  const marked = (s: string) => splitTerms(s, new Set(), EN).filter((n) => typeof n !== "string").length;
  assert.equal(marked("every tool call is priced"), 1);
  assert.equal(marked("tool calls are priced"), 1, "the plural is the same term");
  assert.equal(marked("MCPish nonsense"), 0, "a word that merely starts with a term is not it");
  assert.equal(marked("agentic frameworks"), 0);
});

test("a term in a script written without spaces is found inside its sentence", () => {
  const ja = [{ id: "cooldown", forms: ["クールダウン"], tip: "…" }] as Term[];
  assert.equal(splitTerms("一回のクールダウンごとに動く", new Set(), ja).filter((n) => typeof n !== "string").length, 1);
  const mcp = splitTerms("MCPサービスです", new Set(), EN).filter((n) => typeof n !== "string");
  assert.equal(mcp.length, 1, "a Latin term beside Japanese is still a whole word");
});

test("prose with no jargon comes back exactly as it went in", () => {
  const plain = "A bee crosses the meadow and waits its turn at the door.";
  assert.equal(splitTerms(plain, new Set(), EN).join(""), plain);
});
