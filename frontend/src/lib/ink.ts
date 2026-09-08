/**
 * Ink that can actually be read on this ground.
 *
 * The palette moved from a dark theme to light lavender and the text colours
 * did not all follow. `amber-300` on the page ground measures **1.19:1** — a
 * yellow link on near-white, which is not a link, it is a rumour of one. AA
 * asks 4.5:1 for text and 3:1 for a graphical mark, and the owner has now
 * reported this three times in three places, which is what a per-component
 * colour gets you.
 *
 * So one definition, measured, in one file:
 *
 *   `--color-wax-ink` #92400e   5.86:1 on the page · 7.09:1 on a white card
 *                               6.84:1 on an amber note · 6.5:1 on stone
 *
 * Dark enough everywhere this app puts it, and still amber — it reads as this
 * service's colour rather than as generic link blue.
 */

/** An external link: underlined, and dark enough to be text. */
export const LINK =
  "inline-flex items-center gap-1 text-[var(--color-wax-ink)] underline " +
  "decoration-[var(--color-wax-ink)]/40 underline-offset-2 hover:text-ink " +
  "hover:decoration-ink/50 transition-colors";

/** An amber accent used as text or as a small glyph beside text. */
export const ACCENT = "text-[var(--color-wax-ink)]";
