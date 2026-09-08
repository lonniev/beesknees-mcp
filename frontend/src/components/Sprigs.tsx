/**
 * A few flowers, scattered.
 *
 * The lobby is a wait, and a wait on an empty screen reads as a page that
 * failed to load. These are not decoration for its own sake: they are what
 * makes the space between the hives read as ground rather than as margin.
 *
 * Positions come from a fixed table rather than `Math.random`, so they do not
 * jump on every re-render — the lobby repaints on a one-second poll, and
 * flowers that hop each time would be worse than none. Absolutely positioned
 * inside a `relative` parent, pointer-events-none, and `aria-hidden`: a screen
 * reader has no use for scattered glyphs and a finger must never land on one
 * instead of the button underneath.
 */

/* Botanical only. A purple heart read as a stray emoji rather than as
   something growing. */
const GLYPHS = ["🌼", "🌸", "🌿", "🌾", "🌱"];

/**
 * left %, top %, size px, rotation deg — dealt once, by hand, to look unplanned.
 *
 * Confined to the MARGINS. The first pass scattered them across the whole box
 * and two landed on the hive stacks and one in the middle of the footer text —
 * faint and click-through, but a flower growing out of a sentence is not
 * scenery, it is a mistake. Content lives between 18% and 82% across, so these
 * stay outside that, or below it.
 */
const SPRIGS: [number, number, number, number][] = [
  [4, 14, 22, -12], [9, 41, 15, 6], [6, 66, 19, -5], [13, 87, 17, 9],
  [95, 17, 20, 10], [90, 44, 15, -7], [96, 70, 23, 4], [88, 90, 16, 13],
  [30, 98, 14, -6], [63, 98, 16, 5],
];

export default function Sprigs() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {SPRIGS.map(([x, y, size, rot], i) => (
        <span
          key={i}
          className="absolute select-none"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            fontSize: size,
            transform: `translate(-50%, -50%) rotate(${rot}deg)`,
            // Faint. They are the ground, not the subject — a flower that
            // competes with the seat count has stopped being scenery.
            opacity: 0.22,
          }}
        >
          {GLYPHS[i % GLYPHS.length]}
        </span>
      ))}
    </div>
  );
}
