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
 * @param word    "Fly" or "Crawl": what the next press is called out there.
 */
export function nextStep(
  phase: string | undefined,
  aimed: boolean,
  why: string,
  word: string,
): Step {
  if (phase === "done") return { text: "At the queen.", mark: null };

  if (!aimed) {
    if (phase === "forage") return { text: "Tap a flower that still has pollen", mark: "pollen" };
    if (phase === "return")
      return { text: "Choose a door now — tap a gap in the hive wall", mark: "door" };
    return { text: "Tap where you want to end up — the queen, or anywhere on the way.", mark: null };
  }

  // The board's objection outranks the phase: it is about the press the player
  // is about to make, and the phase is about the half-hour they are in.
  if (why) return { text: why, mark: null };

  const verb = word.toLowerCase();
  if (phase === "forage") return { text: `Flower chosen — press to ${verb}.`, mark: null };
  if (phase === "return") return { text: `Door chosen — press to ${verb}.`, mark: null };
  // The route is drawn, so this says what the NEXT press costs rather than
  // repeating a destination the player can already see marked.
  // Names the BUTTON, not the gesture. "Press to crawl the line" describes the
  // input; "Crawl! to follow the path" is the word actually printed on the
  // thing to press, so the sentence and the button agree.
  return {
    text: word === "Crawl" ? "Crawl! to follow the path" : "Fly! to follow the path",
    mark: null,
  };
}
