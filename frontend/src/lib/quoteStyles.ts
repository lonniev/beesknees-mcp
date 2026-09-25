/**
 * How the bee poetry looks. @tollbooth-dpyc/web's QuoteScroller brings the
 * rotation and the fade; the look is this site's, and lives here: a quiet
 * serif at 80% ink, wax quotation marks that stay legible over the meadow,
 * and a small-caps mono byline.
 */

import type { QuoteScrollerClassNames } from "@tollbooth-dpyc/web/react";

export const quoteStyles: QuoteScrollerClassNames = {
  root: "px-4 pt-1 text-center",
  figure: "mx-auto flex min-h-[6.5rem] max-w-lg flex-col justify-center gap-2",
  text: "font-serif text-[15px] italic leading-relaxed text-ink/80",
  mark: "text-[var(--color-wax-ink)]",
  author: "font-mono text-[10px] uppercase tracking-[0.28em] text-ink/65",
};
