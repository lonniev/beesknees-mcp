/**
 * Bee poetry, rotating, for a wait somebody else controls.
 *
 * The tactic is cypher's — its loading screen turns dead time into something to
 * read rather than a frozen "Loading…". A lobby is the same shape of wait: you
 * have paid, you cannot act, and the number of bees is not yours to change. The
 * quotes are inlined, so the one thing on screen during a wait cannot itself be
 * waiting on the network.
 */

import { useEffect, useRef, useState } from "react";
import { QUOTES } from "../lib/quotes";

const DWELL_MS = 7000;
const FADE_MS = 600;

export default function QuoteScroller({ className = "" }: { className?: string }) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * QUOTES.length));
  const [visible, setVisible] = useState(true);
  const tick = useRef<number | undefined>(undefined);
  const fade = useRef<number | undefined>(undefined);

  useEffect(() => {
    tick.current = window.setInterval(() => {
      setVisible(false);
      fade.current = window.setTimeout(() => {
        setIndex((prev) => {
          let next = prev;
          while (next === prev) next = Math.floor(Math.random() * QUOTES.length);
          return next;
        });
        setVisible(true);
      }, FADE_MS);
    }, DWELL_MS);
    return () => {
      if (tick.current) window.clearInterval(tick.current);
      if (fade.current) window.clearTimeout(fade.current);
    };
  }, []);

  const q = QUOTES[index];

  return (
    <div className={`px-4 text-center ${className}`}>
      <div
        className="mx-auto flex min-h-[6.5rem] max-w-lg flex-col justify-center gap-2"
        style={{ opacity: visible ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }}
      >
        <p className="font-serif text-[15px] italic leading-relaxed text-white/70">
          <span className="text-[var(--color-wax)]">“</span>
          {q.text}
          <span className="text-[var(--color-wax)]">”</span>
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/35">{q.author}</p>
      </div>
    </div>
  );
}
