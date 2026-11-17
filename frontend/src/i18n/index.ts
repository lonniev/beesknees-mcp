/**
 * The Bee's Knees' words, handed to the shared web package. The package does
 * all the translating (i18next): which language to start in, fetching a
 * language when chosen, falling back to English, the chooser. The hive supplies
 * only the English and its translations.
 *
 * English is registered the moment this module loads, so the browser, the
 * server-rendered route checks and the node tests all read the same words
 * without a setup step each.
 */

import { registerNamespace, translate, type Vars } from "@tollbooth-dpyc/web";
import { useT as useWords } from "@tollbooth-dpyc/web/react";
import en, { type MessageKey } from "./en.ts";

export type { MessageKey };

/** The hive's words, for `useT`, `tr` and `<Tx ns={WORDS} …/>`. */
export const WORDS = "beesknees";

/** Resolves once the reader's language (if it is not English) has arrived. */
export const registered: Promise<void> = registerNamespace(WORDS, en, {
  fr: () => import("./fr.ts"),
  es: () => import("./es.ts"),
  ja: () => import("./ja.ts"),
  zh: () => import("./zh.ts"),
  hi: () => import("./hi.ts"),
});

export type Translate = (key: MessageKey, vars?: Vars) => string;

/** `t(key, vars?)` in a component: re-renders when the language changes. */
export const useT = (): Translate => useWords<MessageKey>(WORDS);

/**
 * `tr(key, vars?)` outside a component, in the language on screen now. Call it
 * when the words are needed (at render time), never at module load, or the
 * words are stuck in the language the page opened in.
 */
export const tr: Translate = (key, vars) => translate(key, vars, WORDS);
