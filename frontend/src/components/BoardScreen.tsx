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

import { useState, type ReactNode } from "react";
import { Hourglass, Maximize2, Minimize2, Repeat, RotateCcw } from "lucide-react";
import { HiveView, type ViewBee } from "./HiveView.tsx";
import Brood from "./Brood.tsx";
import Coronation from "./Coronation.tsx";
import Meadow from "./Meadow.tsx";
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

  /**
   * The end of the race. `yours` turns the flourish up — it is still the end
   * of the race when a rival wins, but it is not your wedding.
   */
  winner?: {
    label: string;
    detail: string;
    note?: string;
    yours?: boolean;
    /** Nobody reached a queen — the ceiling ran out. A result, not a victory. */
    unwon?: boolean;
  } | null;
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
      /* Where the foragers in `Meadow` think this hive is. Read from the
       * rendered element rather than assumed: the gutters collapse below `md`
       * and the tiles move with them. */
      data-hive=""
      className={`relative aspect-square h-full overflow-hidden rounded-lg border transition ${
        hive.hot
          ? "border-[var(--color-hot)]"
          : yours
            ? "border-[var(--color-you)]"
            : "border-ink/14"
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
      <span /* White, not ink: this strip is a dark scrim laid over the board
        * thumbnail, so it keeps the board's palette rather than the frame's. */
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55 text-[9px] leading-tight text-white/85">
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
  /**
   * A phone showing one hive and nothing else.
   *
   * On a narrow screen the board was the smallest thing on it: a header, the
   * scoreboard, the queen's line, a strip of rivals and the controls all took
   * their cut first, and what was left had to hold a 358-cell rosette. Tapping
   * a hive now gives it the screen; the chrome comes back on the toggle.
   *
   * Never on a wide screen — there the gutters ARE the point, and hiding four
   * hives to enlarge a fifth would lose the thing the layout was built for.
   */
  const [zoomed, setZoomed] = useState(false);
  const immersive = !wide && zoomed;
  const rivals = p.hives.filter((h) => h.id !== p.focus);
  const shown = p.focus === null ? null : p.hives.find((h) => h.id === p.focus) ?? null;
  const mineHere = p.yourHive !== null && p.yourHive === p.focus;

  return (
    <div
      className={`flex h-full flex-col ${immersive ? "gap-1 p-0" : "gap-2 p-2"}`}
    >
      {!immersive && (
      <header className="flex shrink-0 items-center justify-between px-1">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">The Bee's Knees</span>
          {p.tag && <span className="text-xs text-ink/65">{p.tag}</span>}
        </div>
        <div className="flex items-center gap-3 text-xs tabular-nums text-ink/78">
          <span>
            {String(Math.floor(p.elapsedSec / 60))}:{String(p.elapsedSec % 60).padStart(2, "0")}
          </span>
          {p.onNewMatch && (
            <button onClick={p.onNewMatch} className="rounded-md p-1.5 hover:bg-ink/7" title="New match">
              <RotateCcw size={16} />
            </button>
          )}
        </div>
      </header>
      )}

      {!immersive && <Scoreboard />}

      {/* Which hive you are looking at — and a way straight back to your own,
       * since watching a rival is a click away and finding your way home
       * should not be a hunt through the gutters. */}
      {shown && !immersive && (
        <div className="flex shrink-0 items-center px-1 text-xs">
          {/* The gutters are as wide as the rival columns, so the middle of this
            * row is the middle of the BOARD. The name of the hive you are flying
            * in belongs over that hive, not pinned to the window's edge a third
            * of a screen away from it. */}
          {wide && <span className="w-24 shrink-0 lg:w-32 xl:w-40" />}
          <span className="min-w-0 flex-1 truncate text-center font-medium">
            {shown.queen}
            {mineHere && <span className="ml-1.5 text-[var(--color-you-ink)]">your hive</span>}
          </span>
          {wide && (
            <span className="flex w-24 shrink-0 justify-end lg:w-32 xl:w-40">
              {p.yourHive !== null && !mineHere && (
                <button
                  onClick={() => p.onFocus(p.yourHive!)}
                  className="rounded-full bg-[var(--color-you)]/15 px-2.5 py-1 text-[var(--color-you-ink)]"
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
      <div className="relative isolate flex min-h-0 flex-1 flex-col gap-2">
        {/* The meadow the hives sit in.
          *
          * `relative` so the flight measures against the hives rather than the
          * window, and `isolate` so its negative z stays in here. It spans the
          * narrow-screen rival strip as well as the gutters, so the traffic
          * crosses all five hives on a phone rather than orbiting the one in
          * the middle. */}
        <Meadow rally={Boolean(p.winner)} />

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

          {/* The focused board. Its ELEMENT is wider than the hive drawn in
            * it — a square viewBox letterboxed in a wide box — which is what
            * `drawnHive` corrects for so a bee homes to the hive rather than
            * to the empty band beside it. */}
          <div className="relative min-h-0 flex-1" data-hive="focus">
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

            {/* The flourish plays on the CLEAR board; the card follows. Both
              * are keyed on the winner's line so a fresh win replays them
              * rather than showing a finished animation and a new name. */}
            {/* The way in and the way out of a full-screen hive. Over the board
            * rather than in the header, because in immersive mode there is no
            * header — a control that vanishes with the thing it undoes is a
            * trap. Phone only: on a wide screen the gutters are the point. */}
          {!wide && shown && (
            <button
              onClick={() => setZoomed((v) => !v)}
              aria-pressed={zoomed}
              title={zoomed ? "Show every hive" : "Fill the screen with this hive"}
              className="absolute right-1.5 top-1.5 z-10 rounded-lg bg-black/45 p-2 text-white/85 backdrop-blur-sm"
            >
              {zoomed ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}

          {/* While immersive the queen's line has nowhere else to live. */}
          {immersive && shown && (
            <div className="pointer-events-none absolute inset-x-0 top-1.5 z-10 text-center text-[11px] text-white/80">
              <span className="rounded-md bg-black/45 px-2 py-1 backdrop-blur-sm">
                {shown.queen}
                {mineHere && <span className="ml-1.5 text-[var(--color-you)]">your hive</span>}
              </span>
            </div>
          )}

          {p.winner && !p.winner.unwon && (
              <Coronation key={p.winner.detail} yours={Boolean(p.winner.yours)} />
            )}

            {p.winner && (
              <div
                key={`card:${p.winner.detail}`}
                /* Still a DARK surface, on an otherwise light page. Everything
                 * inside it keeps white-on-black ink and the bright accents —
                 * the page-wide swap to dark ink would have made this card
                 * unreadable, which is the one place the frame's palette must
                 * not reach. */
                className="bk-settle absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 text-white backdrop-blur-sm"
              >
                {p.winner.unwon ? (
                  // No brood for a round nobody won. Ceremony for a stalemate
                  // reads as mockery.
                  <Hourglass size={34} className="text-white/45" />
                ) : (
                  // A trophy is a sports cup, and this was a race to a queen.
                  // The tableau says what actually happened; `yours` only makes
                  // it bigger and lays two more eggs.
                  <Brood yours={Boolean(p.winner.yours)} />
                )}
                <div className="text-center">
                  <div className="text-xl font-semibold">{p.winner.label}</div>
                  <div className="mt-0.5 text-sm text-white/70">{p.winner.detail}</div>
                  {/* The money, on its own line. It was appended to the detail
                    * with a second dash, which read as an afterthought about
                    * the thing the whole game is for. */}
                  {p.winner.note && (
                    <div className="mt-2 text-[13px] text-[var(--color-wax)]/80">{p.winner.note}</div>
                  )}
                </div>
                {p.onNewMatch && (
                  <button
                    onClick={p.onNewMatch}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-wax)] px-5 py-2 text-sm font-medium text-black"
                  >
                    <Repeat size={15} /> Play Again
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

        {/* Narrow screens have no gutters, so the rivals go in a strip below —
          * and it is the first thing to go when one hive takes the screen. */}
        {!wide && !immersive && (
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
      </div>

      {/* Controls. The prompt sits on the LEFT, where reading starts — after
       * the button it was an answer arriving behind its question. */}
      {/* On a phone the hint gets its own line. Sharing the row with two button
        * groups gave it about a hundred pixels, and it wrapped to seven lines —
        * stealing the height from the board it was meant to be helping with. */}
      {!wide && (
        <span className="shrink-0 px-2 text-center text-[13px] italic leading-snug text-ink/78">
          <span className="not-italic text-ink/65">Hint: </span>
          {p.prompt}
        </span>
      )}

      <div className="flex shrink-0 items-center gap-4 px-1 pb-[env(safe-area-inset-bottom)]">
        {/* The hint, centred in its own half so it reads level with the verb on
          * the button rather than trailing off at the window's edge — and named
          * as a hint, in italics, so it is plainly the game talking to you and
          * not a label on something. Wide screens only; see above. */}
        {wide && (
        <span className="flex min-w-0 flex-1 items-center justify-center text-center text-[13px] italic leading-none text-ink/78">
          <span className="min-w-0">
            <span className="not-italic text-ink/65">Hint: </span>
            {p.prompt}
          </span>
        </span>
        )}

        <div className="flex gap-2 rounded-xl bg-ink/4 p-1.5">
          {p.verbs.map(({ id, hint, Icon }) => (
            <button
              key={id}
              onClick={() => p.onVerb(id)}
              title={hint}
              aria-pressed={p.verb === id}
              className={`flex h-12 w-12 items-center justify-center rounded-lg transition ${
                p.verb === id ? "bg-[var(--color-you)] text-black" : "text-ink/70 hover:bg-ink/7"
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
            p.actionEnabled ? "bg-[var(--color-you)] text-black" : "bg-ink/7 text-ink/70"
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

        {wide && <span className="flex-1" />}
      </div>
    </div>
  );
}
