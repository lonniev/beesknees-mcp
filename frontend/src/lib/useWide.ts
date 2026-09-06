/**
 * Is there room in the gutters for the rival hives?
 *
 * A CSS `md:hidden` would have been shorter, but hidden is not unmounted: both
 * arrangements would sit in the DOM and every hive in the losing one would keep
 * re-rendering on every frame of the animation loop. Nine boards drawn to show
 * five. Choosing in JS mounts one.
 */

import { useEffect, useState } from "react";

const QUERY = "(min-width: 768px)";

export function useWide(): boolean {
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return wide;
}
