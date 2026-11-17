/**
 * The words this game cannot avoid, explained where they are used.
 *
 * The About page has to say "MCP", "Nostr", "satoshi" and "serverless" to be
 * truthful, and every one of them is a wall to somebody who came for a game
 * about bees. Sending them to a search engine is how you lose them. So each
 * term carries its own short definition, on a dotted underline, and the prose
 * stays readable for a person who already knows.
 *
 * This half is the DECISION — which words match, and that each is marked once
 * per page. No JSX, so the test runner can import it; `glossary.tsx` is the
 * paint. The idea is optionality-mcp's `annotate` — a term list woven into the React
 * tree rather than a `title=""` attribute, which renders a slow OS tooltip
 * that looks different on every platform. Three things are done differently
 * here, and each is a fault the original would have had on this site:
 *
 *   * **A tap opens it.** The original opens on `mouseenter` and `focus`. This
 *     site is read on an iPad, where there is no hover at all — the definitions
 *     would simply not have existed for the person who asked for them.
 *   * **It stays on screen.** `left: 50%` centres the popover on the term, so a
 *     term near the edge of a phone hangs off it. This one measures itself once
 *     on open and nudges back inside.
 *   * **Once per page.** "MCP" appears six times in three paragraphs; six dotted
 *     underlines of the same word reads as spam. Only the first is marked.
 */

import { tr, type MessageKey, type Translate } from "../i18n/index.ts";

/**
 * The words with a definition. Each one's forms and tip are in the catalog, as
 * `glossary.<id>.term` (its forms in that language, "|" between them — "tool
 * call|tool calls") and `glossary.<id>.tip`, so a page is annotated in the
 * language it is read in.
 */
export const TERM_IDS = [
  "mcp", "toolCall", "dpyc", "satoshis", "lightning", "nostr", "npub",
  "kyc", "serverless", "postgres", "stateless", "agent", "cooldown", "quorum",
] as const;

export type TermId = (typeof TERM_IDS)[number];

export interface Term {
  id: TermId;
  /** Matched case-insensitively, whole words only. */
  forms: string[];
  /** Kept short — this is a footnote, not a chapter. */
  tip: string;
}

/** The terms as `t` speaks them. */
export function glossary(t: Translate = tr): Term[] {
  return TERM_IDS.map((id) => ({
    id,
    forms: t(`glossary.${id}.term` as MessageKey).split("|").map((f) => f.trim()).filter(Boolean),
    tip: t(`glossary.${id}.tip` as MessageKey),
  }));
}

/**
 * A letter that would make a match part of a longer word. Latin and Devanagari
 * words are separated by spaces, so a term there must stand alone ("agent" is
 * not in "agentic"); Chinese and Japanese are written without spaces, so a
 * term there is found wherever it is written.
 */
const WORD = "[\\p{Script=Latin}\\p{Script=Devanagari}\\p{M}\\p{N}_]";

/** A piece of annotated prose: plain text, or a term to mark. */
export type Piece = string | { raw: string; tip: string; term: TermId };

/**
 * Split a paragraph into plain runs and terms to mark.
 *
 * `seen` is shared across a page so a term is marked once and then left alone.
 * Pass the same Set to every call on one page; a fresh one starts over. Forms
 * are tried longest first, so "tool call" wins over a shorter term inside it.
 */
export function splitTerms(text: string, seen: Set<string> = new Set(), terms: Term[] = glossary()): Piece[] {
  const byForm = new Map<string, Term>();
  for (const term of terms) for (const form of term.forms) byForm.set(form.toLocaleLowerCase(), term);
  const forms = [...byForm.keys()].sort((a, b) => b.length - a.length);
  if (!forms.length) return [text];
  const pattern = new RegExp(
    `(?<!${WORD})(${forms.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?!${WORD})`,
    "giu",
  );

  const out: Piece[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const raw = m[0];
    const found = byForm.get(raw.toLocaleLowerCase());
    if (!found || seen.has(found.id)) continue;
    seen.add(found.id);

    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ raw, tip: found.tip, term: found.id });
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
