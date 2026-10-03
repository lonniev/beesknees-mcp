/**
 * The geometry a flying bee needs, kept out of the animation loop.
 *
 * Five hives on screen at once, each drawn as a square inside a box that is
 * usually wider than it is tall, so "where is that hive, really" is a question
 * with an answer worth checking — a transform buried in a requestAnimationFrame
 * callback is not something a test can reach. (The glyph-aiming arithmetic
 * that used to live here went with the glyph: a bee painted from above has a
 * heading and nothing else to get wrong.)
 */

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
