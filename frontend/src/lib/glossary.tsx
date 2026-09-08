/**
 * Painting the definitions that `glossary.ts` decided on.
 *
 * The dotted underline is the affordance; the popover opens on hover, on
 * keyboard focus and on tap, and closes the same three ways. `role="tooltip"`
 * with a real element rather than a `title=""` attribute, which renders a slow
 * OS-styled tooltip that looks different on every platform — and never appears
 * at all on a touch screen.
 */

import { useCallback, useState, type ReactNode } from "react";

import { splitTerms } from "./glossary.ts";

function Marked({ tip, children }: { tip: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [nudge, setNudge] = useState(0);

  /**
   * Centre the popover on the term, then push it back inside the window.
   *
   * Measured rather than guessed: where a term falls in a line is not knowable
   * in advance, and a definition hanging off the edge of a phone is not a
   * definition. A callback ref rather than a layout effect, because the bubble
   * only exists once somebody opens it — so there is nothing to measure on the
   * server, and no hook that has to be told to keep quiet there.
   */
  const measure = useCallback((el: HTMLSpanElement | null) => {
    if (!el) {
      setNudge(0);
      return;
    }
    const r = el.getBoundingClientRect();
    const margin = 8;
    if (r.left < margin) setNudge(margin - r.left);
    else if (r.right > window.innerWidth - margin) setNudge(window.innerWidth - margin - r.right);
  }, []);

  return (
    <span
      className="relative cursor-help border-b border-dotted border-[var(--color-wax-ink)]/70"
      tabIndex={0}
      role="button"
      aria-expanded={open}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
    >
      {children}
      {open && (
        <span
          ref={measure}
          role="tooltip"
          style={{ transform: `translateX(calc(-50% + ${nudge}px))` }}
          className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 w-max max-w-[min(20rem,86vw)] rounded-lg border border-ink/15 bg-white px-3 py-2 text-left text-[12px] font-normal not-italic leading-relaxed text-ink/85 shadow-lg"
        >
          {tip}
        </span>
      )}
    </span>
  );
}

/** Weave definitions into a paragraph. `seen` is shared across a page. */
export function annotate(text: string, seen: Set<string> = new Set()): ReactNode[] {
  return splitTerms(text, seen).map((piece, i) =>
    typeof piece === "string" ? (
      piece
    ) : (
      <Marked key={`g${i}`} tip={piece.tip}>
        {piece.raw}
      </Marked>
    ),
  );
}
