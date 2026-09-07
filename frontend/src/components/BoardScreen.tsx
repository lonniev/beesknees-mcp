/**
 * The board screen. One of them, for both games.
 *
 * This layout was worked out deliberately — rivals two to a gutter rather than
 * stacked down one side, the prompt on the LEFT where reading starts, the rest
 * drawn on the button it gates, a way straight back to your own bee. Live play
 * originally got a second, thinner version of all that, which drifted from this
 * one within a day and had to be patched back toward it piece by piece.
 *
 * So there is one now, and it takes DATA rather than either engine's objects:
 * solo has a full local simulation and live has whatever `match_state` returned,
 * and a screen that insisted on one of them is exactly how the second one gets
 * written. Neither engine can change this layout without changing it for both.
 */

import type { ReactNode } from "react";
import { RotateCcw, Trophy } from "lucide-react";
import { HiveView, type ViewBee } from "./HiveView.tsx";
import Scoreboard from "./Scoreboard.tsx";
import type { Board } from "../game/rules.ts";
import { useWide } from "../lib/useWide.ts";

/**
 * What the button says while the bee is busy, rather than what to press.
 *
 * The button showed its imperative the whole time — "Dig!" greyed out for eight
 * seconds — so the one control on screen spent most of a round telling you to do
 * something you had already done. Naming the ACTIVITY makes the wait the bee's
 * work rather than the interface's silence, and it agrees with the prompt beside
 * it instead of contradicting it.
 *
 * `word` is Crawl or Fly, which the caller already decides from where the step
 * ENDS — underground is a crawl whichever side of the threshold you started on.
 */
export function activityLabel(action: string | null | undefined, word: string): string {
  if (action === "dig") return "⛏️ Digging…";
  if (action === "collapse") return "🧱 Sealing…";
  if (action === "fly") return word === "Crawl" ? "👣 Crawling…" : "💨 Flying…";
  return "🐝 Resting…";
}

export interface ScreenHive {
  id: number;
  name: string;
  /** "Queen Rose of Hive Linden" — shown for whichever hive you are watching. */
  queen: string;
  board: Board;
  bees: ViewBee[];
  hot: boolean;
}

export interface BoardScreenProps {
  hives: ScreenHive[];
  focus: number | null;
  onFocus: (id: number) => void;
  /** Which hive holds your bee, and which bee it is. Null while you have none. */
  yourHive: number | null;
  youId: number | null;

  /** A word beside the title — "solo", or the live game's bee count. */
  tag?: string;
  elapsedSec: number;
  /** Offered only where starting again is yours to do, which live play is not. */
  onNewMatch?: () => void;

  frame: number;
  target: number | null;
  route?: number[];
  options?: number[];
  onTapCell: (cell: number) => void;

  /** The verb strip. Ids and icons come from the caller so the words stay one set. */
  verbs: { id: string; hint: string; Icon: (p: { size?: number }) => ReactNode }[];
  verb: string;
  onVerb: (id: string) => void;

  prompt: ReactNode;
  actionLabel: string;
  actionEnabled: boolean;
  onAct: () => void;
  /** Fraction of the current rest still to serve, 1 → 0. Drawn on the button. */
  restLeft: number;

  winner?: { label: string; detail: string } | null;
}

function RivalTile({
  hive,
  yours,
  youId,
  frame,
  onPick,
}: {
  hive: ScreenHive;
  yours: boolean;
  youId: number | null;
  frame: number;
  onPick: (id: number) => void;
}) {
  return (
    <button
      onClick={() => onPick(hive.id)}
      title={yours ? `${hive.name} — your hive` : hive.name}
      className={`relative aspect-square h-full overflow-hidden rounded-lg border transition ${
        hive.hot
          ? "border-[var(--color-hot)]"
          : yours
            ? "border-[var(--color-you)]"
            : "border-white/10"
      }`}
    >
      <HiveView
        board={hive.board}
        bees={hive.bees}
        hot={hive.hot}
        frame={frame}
        youId={yours ? youId : null}
        target={null}
        focused={false}
        armed={false}
      />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/50 text-[9px] leading-tight text-white/75">
        {hive.name}
      </span>
    </button>
  );
}

/** A gutter of rivals, stacked. */
function RivalColumn({
  hives,
  yourHive,
  youId,
  frame,
  onPick,
}: {
  hives: ScreenHive[];
  yourHive: number | null;
  youId: number | null;
  frame: number;
  onPick: (id: number) => void;
}) {
  if (!hives.length) return null;
  return (
    <div className="flex w-24 shrink-0 flex-col justify-center gap-2 lg:w-32 xl:w-40">
      {hives.map((h) => (
        <div key={h.id} className="h-24 lg:h-32 xl:h-40">
          <RivalTile
            hive={h}
            yours={yourHive === h.id}
            youId={youId}
            frame={frame}
            onPick={onPick}
          />
        </div>
      ))}
    </div>
  );
}

export default function BoardScreen(p: BoardScreenProps) {
  const wide = useWide();
  const rivals = p.hives.filter((h) => h.id !== p.focus);
  const shown = p.focus === null ? null : p.hives.find((h) => h.id === p.focus) ?? null;
  const mineHere = p.yourHive !== null && p.yourHive === p.focus;

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <header className="flex shrink-0 items-center justify-between px-1">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">The Bee's Knees</span>
          {p.tag && <span className="text-xs text-white/40">{p.tag}</span>}
        </div>
        <div className="flex items-center gap-3 text-xs tabular-nums text-white/60">
          <span>
            {String(Math.floor(p.elapsedSec / 60))}:{String(p.elapsedSec % 60).padStart(2, "0")}
          </span>
          {p.onNewMatch && (
            <button onClick={p.onNewMatch} className="rounded-md p-1.5 hover:bg-white/10" title="New match">
              <RotateCcw size={16} />
            </button>
          )}
        </div>
      </header>

      <Scoreboard />

      {/* Which hive you are looking at — and a way straight back to your own,
       * since watching a rival is a click away and finding your way home
       * should not be a hunt through the gutters. */}
      {shown && (
        <div className="flex shrink-0 items-center px-1 text-xs">
          {/* The gutters are as wide as the rival columns, so the middle of this
            * row is the middle of the BOARD. The name of the hive you are flying
            * in belongs over that hive, not pinned to the window's edge a third
            * of a screen away from it. */}
          {wide && <span className="w-24 shrink-0 lg:w-32 xl:w-40" />}
          <span className="min-w-0 flex-1 truncate text-center font-medium">
            {shown.queen}
            {mineHere && <span className="ml-1.5 text-[var(--color-you)]">your hive</span>}
          </span>
          {wide && (
            <span className="flex w-24 shrink-0 justify-end lg:w-32 xl:w-40">
              {p.yourHive !== null && !mineHere && (
                <button
                  onClick={() => p.onFocus(p.yourHive!)}
                  className="rounded-full bg-[var(--color-you)]/15 px-2.5 py-1 text-[var(--color-you)]"
                >
                  Back to my bee
                </button>
              )}
            </span>
          )}
        </div>
      )}

      {/* Two rivals down each gutter, the board you are flying in the middle.
       *
       * The gutters were dead space — a centred circle on a wide screen leaves
       * a third of the window empty on either side. Filling them with the other
       * hives costs no room the board was using and puts every hive in the match
       * on one screen. Below `md` there is no gutter to spare, so the rivals fall
       * back to a strip above the board. */}
      <div className="flex min-h-0 flex-1 gap-2">
        {wide && (
          <RivalColumn
            hives={rivals.slice(0, Math.ceil(rivals.length / 2))}
            yourHive={p.yourHive}
            youId={p.youId}
            frame={p.frame}
            onPick={p.onFocus}
          />
        )}

        <div className="relative min-h-0 flex-1">
          {shown && (
            <HiveView
              board={shown.board}
              bees={shown.bees}
              hot={shown.hot}
              frame={p.frame}
              youId={mineHere ? p.youId : null}
              target={mineHere ? p.target : null}
              route={mineHere ? p.route : []}
              options={mineHere ? p.options : []}
              focused
              armed={p.verb === "seal"}
              onTapCell={p.onTapCell}
            />
          )}

          {p.winner && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
              <Trophy size={40} className="text-[var(--color-wax)]" />
              <div className="text-center">
                <div className="text-xl font-semibold">{p.winner.label}</div>
                <div className="text-sm text-white/60">{p.winner.detail}</div>
              </div>
              {p.onNewMatch && (
                <button
                  onClick={p.onNewMatch}
                  className="rounded-full bg-[var(--color-wax)] px-5 py-2 text-sm font-medium text-black"
                >
                  Again
                </button>
              )}
            </div>
          )}
        </div>

        {wide && (
          <RivalColumn
            hives={rivals.slice(Math.ceil(rivals.length / 2))}
            yourHive={p.yourHive}
            youId={p.youId}
            frame={p.frame}
            onPick={p.onFocus}
          />
        )}
      </div>

      {/* Narrow screens have no gutters, so the rivals go back on top. */}
      {!wide && (
        <div className="flex h-16 shrink-0 justify-center gap-1.5">
          {rivals.map((h) => (
            <RivalTile
              key={h.id}
              hive={h}
              yours={p.yourHive === h.id}
              youId={p.youId}
              frame={p.frame}
              onPick={p.onFocus}
            />
          ))}
        </div>
      )}

      {/* Controls. The prompt sits on the LEFT, where reading starts — after
       * the button it was an answer arriving behind its question. */}
      <div className="flex shrink-0 items-center gap-4 pb-[env(safe-area-inset-bottom)]">
        {/* The hint, centred in its own half so it reads level with the verb on
          * the button rather than trailing off at the window's edge — and named
          * as a hint, in italics, so it is plainly the game talking to you and
          * not a label on something. */}
        <span className="flex min-w-0 flex-1 items-center justify-center text-center text-[13px] italic leading-none text-white/60">
          <span className="min-w-0">
            <span className="not-italic text-white/35">Hint: </span>
            {p.prompt}
          </span>
        </span>

        <div className="flex gap-2 rounded-xl bg-white/5 p-1.5">
          {p.verbs.map(({ id, hint, Icon }) => (
            <button
              key={id}
              onClick={() => p.onVerb(id)}
              title={hint}
              aria-pressed={p.verb === id}
              className={`flex h-12 w-12 items-center justify-center rounded-lg transition ${
                p.verb === id ? "bg-[var(--color-you)] text-black" : "text-white/55 hover:bg-white/10"
              }`}
            >
              <Icon size={19} />
            </button>
          ))}
        </div>

        <button
          onClick={p.onAct}
          disabled={!p.actionEnabled}
          className={`relative min-w-40 overflow-hidden rounded-xl px-6 py-3 font-semibold transition ${
            p.actionEnabled ? "bg-[var(--color-you)] text-black" : "bg-white/10 text-white/45"
          }`}
        >
          {/* The rest, drawn ON the button it gates: the unfilled part IS the
           * wait. A bee moves once a second and rather longer after a dig, which
           * is what stops spending from buying speed. */}
          {p.restLeft > 0 && (
            <span
              className="absolute inset-y-0 left-0 bg-[var(--color-you)]/30 transition-[width] duration-100"
              style={{ width: `${Math.max(0, Math.min(1, 1 - p.restLeft)) * 100}%` }}
            />
          )}
          <span className="relative">{p.actionLabel}</span>
        </button>

        <span className="flex-1" />
      </div>
    </div>
  );
}
