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

  const poll = useCallback(async () => {
    try {
      const res = (await call("match_state", { since_seq: seq.current })) as
        | (Partial<LiveState> & { unchanged?: boolean; success?: boolean })
        | null;
      if (!alive.current || !res) return 1500;
      if (res.success === false) {
        setError("The hive did not answer");
        return 3000;
      }
      setError("");
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

    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
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
