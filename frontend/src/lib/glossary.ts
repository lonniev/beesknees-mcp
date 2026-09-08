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

interface Term {
  /** Matched case-insensitively. Whole words only. */
  term: string;
  /** Kept short — this is a footnote, not a chapter. */
  tip: string;
}

/**
 * Ordered longest-first so a multi-word term matches before its own parts:
 * "tool call" must win over "call", and "Lightning Network" over "Lightning".
 */
export const TERMS: Term[] = [
  {
    term: "MCP",
    tip: "Model Context Protocol — a standard way to offer software as a set of named tools an AI agent can call directly, instead of as a website a person has to click through.",
  },
  {
    term: "tool call",
    tip: "One named request to the service — fly, dig, seal. It is what a button press sends and what an agent sends; the game does not know or care which.",
  },
  {
    term: "DPYC",
    tip: "Don't Pester Your Customer — a network of services that charge tiny amounts per call from a balance you top up in advance, so nothing interrupts you mid-task to ask for a card.",
  },
  {
    term: "satoshis",
    tip: "The smallest unit of bitcoin — one hundred-millionth of one. Small enough that a single move in a game can have an honest price.",
  },
  {
    term: "Lightning",
    tip: "A payment layer on top of bitcoin built for amounts too small to be worth a bitcoin transaction. It is how money reaches the charity and the winner.",
  },
  {
    term: "Nostr",
    tip: "A protocol where your identity is a keypair you generate yourself, not an account somebody grants you. Nobody can issue it, and nobody can take it away.",
  },
  {
    term: "npub",
    tip: "The public half of a Nostr key — your name here. The private half never leaves your device, and signing with it is how you prove the name is yours.",
  },
  {
    term: "KYC",
    tip: "Know Your Customer — the identity paperwork financial services usually demand. There is none here: a key is enough to play.",
  },
  {
    term: "serverless",
    tip: "Infrastructure that runs only while a request is in flight and costs nothing between them. A quiet hive is a hive nobody is paying for.",
  },
  {
    term: "Postgres",
    tip: "The database holding every board, bee and fare. It is the one place the game exists — the service itself remembers nothing between requests.",
  },
  {
    term: "stateless",
    tip: "The service keeps nothing in its own memory between calls. Two requests can land on two different machines and neither can tell, because the board is in the database, not in either of them.",
  },
  {
    term: "agent",
    tip: "A program that decides what to do next — usually an AI model. Here it plays the same way you do, by asking what the board looks like and naming a move.",
  },
  {
    term: "cooldown",
    tip: "The wall-clock rest between a bee's moves. It is why money cannot buy a faster bee: everyone waits the same seconds.",
  },
  {
    term: "quorum",
    tip: "The number of bees one hive needs before the race begins — eight. Until then the hive is a lobby.",
  },
];

const SORTED = [...TERMS].sort((a, b) => b.term.length - a.term.length);
// Whole words, with an optional plural: the prose says "tool calls" and
// "cooldowns" as readily as the singular, and a definition that only matches
// one of them is a definition that misses half its occurrences.
const PATTERN = new RegExp(
  `\\b(${SORTED.map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})s?\\b`,
  "gi",
);


/** A piece of annotated prose: plain text, or a term to mark. */
export type Piece = string | { raw: string; tip: string; term: string };

/**
 * Split a paragraph into plain runs and terms to mark.
 *
 * `seen` is shared across a page so a term is marked once and then left alone.
 * Pass the same Set to every call on one page; a fresh one starts over.
 */
export function splitTerms(text: string, seen: Set<string> = new Set()): Piece[] {
  const out: Piece[] = [];
  let last = 0;

  PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATTERN.exec(text)) !== null) {
    const raw = m[0];
    const bare = raw.toLowerCase();
    const found = SORTED.find(
      (t) => t.term.toLowerCase() === bare || `${t.term.toLowerCase()}s` === bare,
    );
    if (!found || seen.has(found.term)) continue;
    seen.add(found.term);

    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ raw, tip: found.tip, term: found.term });
    last = PATTERN.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
