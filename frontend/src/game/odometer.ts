/**
 * A number as the digits a reel shows.
 *
 * The counter on the board rolls like a till: each digit is its own strip of
 * 0-9 that slides to the one it should be showing. That needs the digits as
 * positions, and it needs the WIDTH to be stable — a reel that grows a column
 * as the number passes 999 shifts every digit beside it, which reads as the
 * whole figure jumping rather than one place turning over.
 *
 * Pure, and separate from the painting, because the arithmetic that matters
 * here is about money on screen and `node --test` cannot import a `.tsx`.
 */

/** Never fewer reels than this, so a small pot still looks like a counter. */
export const MIN_REELS = 3;

/**
 * The digits to show, most significant first, left-padded with zeroes.
 *
 * @param n     Sats. Negative is treated as nothing rather than throwing: this
 *              paints a live figure, and a counter is the wrong place to
 *              discover a sign error — the books are the right place.
 * @param width Fewest reels to show. The answer is never narrower, and grows
 *              when the number needs it.
 */
export function reels(n: number, width: number = MIN_REELS): number[] {
  const whole = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  const s = String(whole).padStart(Math.max(1, width), "0");
  return [...s].map((c) => Number(c));
}

/**
 * How wide the reel should be for a figure, so it does not shrink back.
 *
 * A counter that widens for 1,000 and narrows again at 999 twitches every time
 * the number crosses back. This only ever grows within a round, which is the
 * one direction a pot moves.
 */
export function widthFor(n: number, current: number = MIN_REELS): number {
  return Math.max(current, String(Math.max(0, Math.floor(n || 0))).length);
}
