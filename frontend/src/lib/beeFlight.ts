/**
 * The geometry a flying bee needs, kept out of the animation loop.
 *
 * `aimBee` is ported from goodearth-mcp, where the same arithmetic was wrong in
 * a way nobody could see without watching the screen — a transform buried in a
 * requestAnimationFrame callback is not something a test can reach. The rest is
 * this game's own: five hives on screen at once, each drawn as a square inside
 * a box that is usually wider than it is tall, so "where is that hive, really"
 * is a question with an answer worth checking.
 */

/**
 * Which way the 🐝 glyph faces before anything is done to it, in the same
 * degrees the flight vector is measured in: 0 is east, 180 is west.
 *
 * **It points west.** Every platform draws the bee in left profile, head at the
 * leading edge.
 */
const GLYPH_HEADING = 180;

/**
 * How to draw a bee moving along `tilt` degrees so it points where it is going.
 *
 * Two ways to aim a glyph: rotate it, or mirror it and rotate less. Rotation
 * alone would put a westbound bee on its back, since anything past a quarter
 * turn reads as upside down — an insect can bank, it does not fly inverted. So
 * an eastbound bee is mirrored and rotated by its tilt, and a westbound one is
 * left alone and rotated by tilt minus the glyph's own heading. Both end up
 * nose-first with their backs to the sky.
 */
export function aimBee(tilt: number): { rotate: number; mirror: boolean } {
  const eastbound = Math.abs(tilt) <= 90;
  return eastbound
    ? { rotate: turn(tilt), mirror: true }
    : { rotate: turn(tilt - GLYPH_HEADING), mirror: false };
}

/**
 * An angle as the shortest way round, in (-180, 180].
 *
 * A bee heading down and to the left came out of the arithmetic at -315°, which
 * draws identically to +45° and is not the same number. The rendering was right
 * and the value was a lie, which is the kind of thing that reads as fine until
 * something else tries to reason about it.
 */
function turn(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

/** A rectangle in pixels, measured relative to the flight layer. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A hive as it is actually drawn, in fractions of the layer.
 *
 * Half-extents rather than one radius, because the layer is almost never
 * square: a hive that IS square in pixels covers more of the layer's height
 * than of its width, and a single number would have to be wrong on one axis.
 * The first version of this used one, and put every door inside the tile.
 */
export interface Hive {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
}

/**
 * Where a hive really is inside the box it was given.
 *
 * Every hive is a square viewBox in an element sized `h-full w-full`, and the
 * browser letterboxes it — so the focused board's ELEMENT is a wide rectangle
 * while the hive itself is a square in the middle of it, with transparent bands
 * either side. Homing to the element's centre is close enough; homing to its
 * left edge would send a bee to a hive that is not there.
 */
export function drawnHive(el: Rect, layer: { w: number; h: number }): Hive {
  const side = Math.min(el.w, el.h);
  return {
    cx: (el.x + el.w / 2) / layer.w,
    cy: (el.y + el.h / 2) / layer.h,
    hx: side / 2 / layer.w,
    hy: side / 2 / layer.h,
  };
}

/**
 * A door on a hive's verge, at `angle` radians.
 *
 * The point where the ray leaves the RECTANGLE the hive occupies in layer
 * fractions, not a circle inscribed in it: a bee that stopped short would be
 * under the opaque meadow the hive is painted on, and a returning bee that
 * vanishes has not arrived, it has gone.
 */
export function doorOn(hive: Hive, angle: number): { x: number; y: number } {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Whichever axis saturates first decides which edge the ray leaves by.
  const reach = 1 / Math.max(Math.abs(dx) / hive.hx, Math.abs(dy) / hive.hy);
  return { x: hive.cx + dx * reach, y: hive.cy + dy * reach };
}
