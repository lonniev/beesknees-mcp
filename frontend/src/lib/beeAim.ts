/**
 * Which way a page bee is drawn, given which way it is going.
 *
 * The page bees are the 🐝 glyph, as Good Earth's are, and this is Good
 * Earth's aiming brought over with it. A glyph is a side view — it can bank,
 * it cannot fly on its back — so it is mirrored to face its way rather than
 * turned through more than a quarter circle. Pure, and out of the animation
 * loop, because a transform buried in a requestAnimationFrame callback is not
 * something a test can reach.
 */

/// Which way the 🐝 glyph faces before anything is done to it, in the same
/// degrees the flight vector is measured in: 0 is east, 180 is west. Every
/// platform draws the bee in left profile, head at the leading edge.
const GLYPH_HEADING = 180;

/**
 * How to draw a bee moving along `tilt` degrees so it points where it is going.
 *
 * Eastbound: mirrored, then rotated by its tilt. Westbound: left alone, rotated
 * by tilt minus the glyph's own heading. Both end up nose-first with their
 * backs to the sky.
 */
export function aimBee(tilt: number): { rotate: number; mirror: boolean } {
  const eastbound = Math.abs(turn(tilt)) <= 90;
  return eastbound
    ? { rotate: turn(tilt), mirror: true }
    : { rotate: turn(tilt - GLYPH_HEADING), mirror: false };
}

/** An angle as the shortest way round, in (-180, 180]. */
export function turn(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

/**
 * A heading that follows the flight rather than snapping to it.
 *
 * A forager working a patch re-aims every hop, and a sprite that turns on the
 * spot each time reads as a scurry rather than a flight. The drawn heading
 * chases the true one a little each frame, the short way round.
 */
export function easeHeading(drawn: number, wanted: number, dt: number, rate = 6): number {
  const diff = turn(wanted - drawn);
  const k = 1 - Math.exp(-rate * dt);
  return turn(drawn + diff * k);
}
