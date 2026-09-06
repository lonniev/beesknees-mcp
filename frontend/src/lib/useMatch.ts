/**
 * The clock.
 *
 * Locally this drives the whole match; against the server it will drive only the
 * animation, with the authoritative board arriving from `round_state`. Keeping
 * the loop in one hook is what makes that swap a change of source rather than a
 * rewrite of every component.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Action, Bee } from "../game/rules.ts";
import { TICK_MS } from "../game/rules.ts";
import type { Match } from "../game/match.ts";
import { makeSoloMatch, step } from "../game/match.ts";

export interface MatchApi {
  match: Match;
  /** Bumped every tick so React re-renders a mutable board. */
  frame: number;
  you: Bee | null;
  /** 0 while ready to act, 1 immediately after acting. */
  cooldown: number;
  submit: (a: Action | null) => void;
  restart: () => void;
}

export function useSoloMatch(): MatchApi {
  const [match, setMatch] = useState<Match>(() => makeSoloMatch());
  const [frame, setFrame] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const pending = useRef<Action | null>(null);

  const restart = useCallback(() => {
    pending.current = null;
    setMatch(makeSoloMatch());
    setFrame(0);
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let carry = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = now - last;
      last = now;
      // Fixed-step, so a slow frame does not slow the game down and a fast
      // screen does not speed it up. Capped, so a backgrounded tab does not
      // return and simulate a minute of hive in one frame.
      carry = Math.min(carry + dt, TICK_MS * 20);
      let stepped = false;
      while (carry >= TICK_MS) {
        carry -= TICK_MS;
        step(match, pending.current);
        pending.current = null;
        stepped = true;
      }
      if (stepped) {
        setFrame((f) => f + 1);
        const you = match.you;
        if (you) {
          const bee = match.hives[you.hive].round.bees[you.beeId];
          const left = bee.nextMoveTick - match.tick;
          // Measured against the delay actually served, so the ring reads true
          // after a dig (which costs several cooldowns) and not just after a fly.
          setCooldown(left <= 0 ? 0 : left / Math.max(1, bee.lastDelayTicks));
        }
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [match]);

  const submit = useCallback((a: Action | null) => {
    pending.current = a;
  }, []);

  const you = match.you ? match.hives[match.you.hive].round.bees[match.you.beeId] : null;

  return { match, frame, you, cooldown, submit, restart };
}
