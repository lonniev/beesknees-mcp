/** The hive's words in every language say what English says: the same keys, {{places}} and <tags/>. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES, localeProblems, setLanguage, translate } from "@tollbooth-dpyc/web";
import english from "../i18n/en.ts";
import { registered, WORDS } from "../i18n/index.ts";
import { QUOTE_COUNT } from "./quotes.ts";
import { TERM_IDS } from "./glossary.ts";

for (const { code } of LANGUAGES.filter((l) => l.code !== "en")) {
  test(`${code}: every message is there, with English's {{places}} and <tags/>`, async () => {
    const locale = (await import(`../i18n/${code}.ts`)).default;
    assert.deepEqual(localeProblems(english, locale), []);
  });
}

test("no message keeps a single-brace {place} or a raw ${…}", () => {
  for (const [key, text] of Object.entries(english)) assert.doesNotMatch(text, /(^|[^{])\{\w+\}(?!\})|\$\{/, key);
});

test("the hive's words are read through the package, in the chosen language", async () => {
  await registered;
  const key = "play.title";
  assert.equal(translate(key, undefined, WORDS), english[key]);
  await setLanguage("fr");
  const fr = (await import("../i18n/fr.ts")).default as Record<string, string>;
  assert.equal(translate(key, undefined, WORDS), fr[key]);
  await setLanguage("en");
});

test("every quote and glossary term the code asks for has its English", () => {
  for (let i = 0; i < QUOTE_COUNT; i++) {
    assert.ok(english[`quotes.${i}.text` as keyof typeof english], `quote ${i}`);
    assert.ok(english[`quotes.${i}.author` as keyof typeof english], `quote ${i}'s author`);
  }
  assert.equal(english[`quotes.${QUOTE_COUNT}.text` as keyof typeof english], undefined, "a quote the lobby never shows");
  for (const id of TERM_IDS) assert.ok(english[`glossary.${id}.tip` as keyof typeof english], id);
});
