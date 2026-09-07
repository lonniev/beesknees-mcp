/**
 * The multiplayer clock, which is not here.
 *
 * Solo mode steps the engine locally, and that is exactly what must NOT happen
 * against a server: browsers throttle or stop `requestAnimationFrame` in a
 * background tab, so a client that simulates does not merely pause — it falls
 * behind silently and then fast-forwards on return, and now two machines
 * disagree about where every bee is with no way to reconcile.
 *
 * So this hook never advances anything. It polls `match_state`, renders what
 * came back, and submits motions. The rules module is shared with the server so
 * the client can still say what a move WOULD do — but the server's answer is the
 * only one that counts.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface LiveBee {
  hive: number;
  seat: number;
  npub: string;
  label: string;
  cell: number;
  phase: string;
  moves: number;
  digs: number;
  seals: number;
  /**
   * Did this bee's last move cut downward?
   *
   * The stagger bars two inward moves in a row, so without this the client
   * cannot tell a committed bee from a free one — it offers the cut, the server
   * refuses it, and the patron spends a cooldown learning what the board
   * already knew.
   */
  came_inward: boolean;
  next_move_at: string | null;
  finished_at: string | null;
}

export interface LiveState {
  match_id: string;
  state: "forming" | "running" | "ended" | "settled";
  seq: number;
  poll_after_ms: number;
  winner_npub: string;
  hives: number;
  seats: number;
  bees: LiveBee[];
  open_cells: { hive: number; cell: number }[];
  /**
   * The match seed. Everything DERIVED about the board comes from it.
   *
   * Obstructions, flowers and starting squares are generated, not stored, and
   * the client runs the same generator on the same number to get the same hive.
   * Without it a live board would be a bare green field with moves refused for
   * reasons nothing on screen explained.
   */
  seed: number;
  /** Flowers already emptied — the one piece of meadow state a rival changes. */
  taken_pollen: { hive: number; cell: number }[];
}

type Caller = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

/** How long to wait for a board before giving up and asking again. */
const POLL_TIMEOUT_MS = 6000;
/** Sentinel for "this poll took too long", distinct from any real answer. */
const STALLED = Symbol("stalled");
/** If the board has not come back in this long, ask again no matter what. */
const WATCHDOG_MS = 5000;

export interface LiveApi {
  board: LiveState | null;
  error: string;
  /** Ask for a refresh now — after your own move, so the board catches up. */
  refresh: () => void;
}

/**
 * Poll the board at the cadence the SERVER asks for.
 *
 * `poll_after_ms` comes back with every answer, computed from how hot the match
 * actually is. One cadence algorithm, owned server-side, so sixty clients
 * throttle themselves consistently and the operator keeps a valve it can turn
 * under load — rather than every client inventing its own backoff and drifting.
 */
export function useLiveMatch(call: Caller, enabled = true): LiveApi {
  const [board, setBoard] = useState<LiveState | null>(null);
  const [error, setError] = useState("");
  const seq = useRef(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  /** When the board last actually came back. The watchdog reads this. */
  const lastOk = useRef(Date.now());

  const poll = useCallback(async () => {
    try {
      // A poll that never returns must not freeze the board.
      //
      // The next poll is only scheduled once this one settles, and the tool
      // layer's own timeout is two minutes — so a single stalled request left
      // the screen showing a board that had moved on without it, for up to two
      // minutes, while the player watched a still picture and fell behind. This
      // service has already been measured with a 32-second outlier.
      //
      // Abandoning a slow answer costs nothing: the very next poll asks the same
      // question, and `since_seq` means a board that has not moved answers small.
      const res = (await Promise.race([
        call("match_state", { since_seq: seq.current }),
        new Promise((resolve) => setTimeout(() => resolve(STALLED), POLL_TIMEOUT_MS)),
      ])) as
        | (Partial<LiveState> & { unchanged?: boolean; success?: boolean })
        | typeof STALLED
        | null;
      if (res === STALLED) {
        // Not an error the player needs to see — one slow request, and we simply
        // ask again. Saying "the hive did not answer" here would cry wolf on
        // every blip of a connection that is working.
        return 300;
      }
      if (!alive.current || !res) return 1500;
      if (res.success === false) {
        setError("The hive did not answer");
        return 3000;
      }
      setError("");
      lastOk.current = Date.now();
      if (!res.unchanged && res.bees) {
        seq.current = res.seq ?? seq.current;
        setBoard(res as LiveState);
      } else if (res.seq !== undefined) {
        seq.current = res.seq;
      }
      return res.poll_after_ms ?? 1200;
    } catch {
      // A blip must not stop the loop, and must not log anybody out — the
      // caller marks this call best-effort for exactly that reason.
      if (alive.current) setError("");
      return 3000;
    }
  }, [call]);

  const schedule = useCallback(
    (ms: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        if (!alive.current) return;
        schedule(await poll());
      }, ms);
    },
    [poll],
  );

  const refresh = useCallback(() => {
    schedule(0);
  }, [schedule]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;

    // A hidden tab is not watching, so it should not be asking. It catches up
    // the moment it comes back rather than replaying the wait.
    const onVisibility = () => {
      if (document.hidden) {
        if (timer.current) clearTimeout(timer.current);
      } else {
        schedule(0);
      }
    };
    if (!document.hidden) schedule(0);
    document.addEventListener("visibilitychange", onVisibility);

    // The board keeps itself current whether or not the player does anything.
    //
    // A round moves without you: rivals dig, flowers empty, somebody reaches a
    // queen. A player who is thinking, or simply resting out a cooldown, must
    // not be looking at a picture of a minute ago — and the chain of "schedule
    // the next poll when this one finishes" has exactly one failure mode, which
    // is a poll that never finishes. This is the belt to that braces: if the
    // board has not come back for a while, ask again regardless of what the
    // chain thinks it is doing.
    const watchdog = window.setInterval(() => {
      if (document.hidden || !alive.current) return;
      if (Date.now() - lastOk.current > WATCHDOG_MS) schedule(0);
    }, WATCHDOG_MS);

    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      window.clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, schedule]);

  return { board, error, refresh };
}

/**
 * Milliseconds until this bee may act again, from the server's own stamp.
 *
 * Read off the clock rather than counted down locally, so a tab that was asleep
 * comes back with the truth instead of a stale countdown it kept running.
 */
export function cooldownLeft(bee: LiveBee | null | undefined): number {
  if (!bee?.next_move_at) return 0;
  const at = Date.parse(bee.next_move_at);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, at - Date.now());
}
