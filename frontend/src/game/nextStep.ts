/**
 * What to do next, in the order a player needs it.
 *
 * This lived inside `SoloBoard` and only Practice ever used it. The LIVE board
 * — the one that costs sats, and the one a newcomer reaches straight after
 * practising — carried a two-string ternary instead: "Tap where you want to
 * end up." or "Press to move." So the board that mattered gave the least help,
 * and neither of those sentences says which of the two things on screen to tap
 * or what the bee is trying to do.
 *
 * Pure, and separate from the painting of it, so `node --test` can hold it. The
 * marks it names are drawn by `components/NextStep.tsx`; a hint that says
 * "tap a flower that still has pollen" makes a first-timer work out which of
 * two flowers that is, and the mark answers it without a sentence.
 */

import { tr } from "../i18n/index.ts";

/** A mark the hint points at, drawn beside the words. */
export type Mark = "pollen" | "door" | null;

export interface Step {
  text: string;
  mark: Mark;
}

/**
 * @param phase   Where the bee is in the round: forage → return → tunnel → done.
 * @param aimed   Whether the player has already chosen a destination.
 * @param why     The board's own objection, if it has one — always wins, because
 *                it is about this press rather than about the phase.
 * @param word    "Fly" or "Crawl": what the next press is called out there (the
 *                English token; the words are read in the language on screen).
 */
export function nextStep(
  phase: string | undefined,
  aimed: boolean,
  why: string,
  word: string,
): Step {
  if (phase === "done") return { text: tr("next.done"), mark: null };

  if (!aimed) {
    if (phase === "forage") return { text: tr("next.forage"), mark: "pollen" };
    if (phase === "return") return { text: tr("next.return"), mark: "door" };
    return { text: tr("next.tunnel"), mark: null };
  }

  // The board's objection outranks the phase: it is about the press the player
  // is about to make, and the phase is about the half-hour they are in.
  if (why) return { text: why, mark: null };

  const crawl = word === "Crawl";
  if (phase === "forage") return { text: tr(crawl ? "next.flower.crawl" : "next.flower.fly"), mark: null };
  if (phase === "return") return { text: tr(crawl ? "next.door.crawl" : "next.door.fly"), mark: null };
  // The route is drawn, so this says what the NEXT press costs rather than
  // repeating a destination the player can already see marked.
  // Names the BUTTON, not the gesture. "Press to crawl the line" describes the
  // input; "Crawl! to follow the path" is the word actually printed on the
  // thing to press, so the sentence and the button agree.
  return { text: tr(crawl ? "next.path.crawl" : "next.path.fly"), mark: null };
}
