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

import { useEffect, useRef, useState, type ReactNode } from "react";
import RoundTally, { type Pot } from "./RoundTally.tsx";
import { Hourglass, Maximize2, Minimize2, Repeat, RotateCcw } from "lucide-react";
import { Art } from "../art/svg.tsx";
import type { SymbolId } from "../art/shapes.ts";
import type { ActionLabel } from "../game/verbs.ts";
import { HiveView, type ViewBee } from "./HiveView.tsx";
import HiveStage from "./HiveStage.tsx";
import Meadow from "./Meadow.tsx";
import Scoreboard from "./Scoreboard.tsx";
import type { Board } from "../game/rules.ts";
import { useWide } from "../lib/useWide.ts";

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
  /**
   * What that button says. Solo starts a fresh board on the spot; live cannot —
   * the next round forms when enough bees have taken a seat — so it says what
   * it actually does rather than promising an immediate game.
   */
  againLabel?: string;

  frame: number;
  /**
   * Which match this is. The WebGL board tweens bees between frames, and a
   * fresh match reuses the seat ids of the last one — without this it would
   * fly every bee across the board from where its predecessor finished.
   */
  epoch: string;
  target: number | null;
  route?: number[];
  options?: number[];
  onTapCell: (cell: number) => void;

  /** The verb strip. Ids and marks come from `game/verbs.ts` so the words stay one set. */
  verbs: readonly { id: string; hint: string; icon: SymbolId; label: string }[];
  /** What this round has raised, already split. Absent in practice, where
    * there is no money and a till would be showing a figure nobody paid. */
  pot?: Pot | null;
  /** Who the charity share goes to, for the till's label. */
  charityName?: string;
  verb: string;
  onVerb: (id: string) => void;
  /**
   * Cruise: the bee takes each move as soon as it is ready, until there is
   * nothing to press. A standing choice, so it lives in the tactic tray; only
   * offered inside the hive, where the presses are many and the choice is one.
   */
  cruise: boolean;
  cruiseEnabled: boolean;
  onCruise: (on: boolean) => void;

  prompt: ReactNode;
  actionLabel: ActionLabel;
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
    /** Where it happened: the hive, and the winner's seat in it. The board
     * turns to that hive, and its stage holds the wedding there. */
    hive?: number;
    beeId?: number;
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
  footer,
  header,
}: {
  hives: ScreenHive[];
  yourHive: number | null;
  youId: number | null;
  frame: number;
  onPick: (id: number) => void;
  /** Dropped into the empty gutter BELOW the tiles. See the hint. */
  footer?: ReactNode;
  /** Dropped into the empty gutter ABOVE them. See the round tally. */
  header?: ReactNode;
}) {
  if (!hives.length) return null;
  return (
    <div className="relative flex w-24 shrink-0 flex-col justify-center gap-2 lg:w-32 xl:w-40">
      {header && <div className="shrink-0">{header}</div>}
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
      {/* Absolute, so the tiles stay exactly centred in the gutter and the
        * footer takes the empty space under them rather than pushing them
        * up to make room for itself. */}
      {footer && <div className="absolute inset-x-0 bottom-0">{footer}</div>}
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

  /**
   * The width of the hive as it is actually DRAWN, so the controls can line up
   * with it.
   *
   * The row spanned the whole window, which on a tablet put the action button
   * out at the far right with a third of the screen between it and the board it
   * acts on — the eye had to leave the game to find the verb. Aligning it to the
   * board is not decoration: the controls belong to the thing above them and
   * should look like they do.
   *
   * Measured rather than derived. `HiveView` is a square viewBox in a `h-full
   * w-full` svg, so the drawn hive is `min(width, height)` of its box and
   * letterboxed centre — a number no CSS on the row can know, because it
   * depends on the height the board happened to get.
   */
  /**
   * The hint, drawn once and placed in one of two homes — never both.
   *
   * Wide: the gutter under the last rival tile, which was empty space beside a
   * board that had none to spare. Narrow: below the controls, because a short
   * screen has to cut something and the order down the page should be the order
   * of what can be spared — the board, then the thing you press, then a sentence
   * you can play without.
   *
   * It shared the control row until the row was narrowed to the board's width,
   * and then wrapped to four lines in a column beside the tactic buttons. A
   * sentence needs the width of a sentence.
   */
  const hintLine = (
    <span className="block px-2 text-center text-[13px] font-semibold leading-snug text-ink/90">
      <span className="font-normal text-ink/65">Hint: </span>
      {p.prompt}
    </span>
  );

  const boardBox = useRef<HTMLDivElement | null>(null);
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const el = boardBox.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setDrawn(Math.round(Math.min(r.width, r.height)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Whether the reward tableau has been dismissed.
   *
   * The wedding runs for about seven seconds on the board and the result card
   * is opaque — a bee crossed a meadow, queued at a door and cut thirty cells
   * of comb, and its reward was once cut off half way through by a button. The
   * card waits to be asked for.
   *
   * Keyed on the win itself, so a fresh result starts a fresh flourish rather
   * than arriving already dismissed by the last one.
   */
  const [dismissed, setDismissed] = useState("");
  const won = p.winner ? `${p.winner.label}|${p.winner.detail}` : "";
  // The card waits for the tap, always. It used to come straight away under
  // the OS's reduce-motion setting, which covered the wedding in the same
  // instant it began — the owner won a round and saw only the words. The site
  // does not answer that setting any more; a game's motion is its content.
  //
  // Nobody won it, so there is no tableau to interrupt: the hourglass IS the
  // result. Ceremony for a stalemate reads as mockery, and so does a wait.
  const showCard = Boolean(p.winner) && (p.winner!.unwon || dismissed === won);
  const immersive = !wide && zoomed;

  /**
   * The board turns to the hive where the race was decided.
   *
   * The wedding is drawn on that hive's stage, by the bees that were there; a
   * player watching their own hive while a rival won elsewhere would otherwise
   * see nothing but a result card. Once, per win; the gutters are still there
   * to look back.
   */
  const where = p.winner?.hive;
  useEffect(() => {
    if (where !== undefined && where !== null && p.focus !== where) p.onFocus(where);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where, won]);

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
              footer={hintLine}
            />
          )}

          {/* The focused board. Its ELEMENT is wider than the hive drawn in
            * it — a square letterboxed in a wide box, whether the SVG's
            * viewBox or the WebGL canvas — which is what `drawnHive` corrects
            * for so a bee homes to the hive rather than to the empty band
            * beside it. */}
          <div ref={boardBox} className="relative min-h-0 flex-1" data-hive="focus">
            {shown && (
              <HiveStage
                board={shown.board}
                bees={shown.bees}
                hot={shown.hot}
                frame={p.frame}
                epoch={`${p.epoch}:${shown.id}`}
                winnerId={p.winner && p.winner.hive === shown.id && p.winner.beeId !== undefined ? p.winner.beeId : null}
                youId={mineHere ? p.youId : null}
                target={mineHere ? p.target : null}
                route={mineHere ? p.route : []}
                options={mineHere ? p.options : []}
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

            {p.winner && !showCard && (
              /* The whole hive is the button. Nothing to aim at, and no way to
               * miss it — the one thing a person wants here is to look, and
               * then to be done looking. */
              <button
                onClick={() => setDismissed(won)}
                aria-label="Dismiss the result"
                className="absolute inset-0 z-20 flex items-end justify-center pb-6"
              >
                <span className="bk-hint rounded-full bg-black/45 px-3 py-1 text-[11px] text-white/85 backdrop-blur-sm">
                  Tap when you have finished looking
                </span>
              </button>
            )}

            {showCard && p.winner && (
              <div
                key={`card:${p.winner.detail}`}
                /* Still a DARK surface, on an otherwise light page. Everything
                 * inside it keeps white-on-black ink and the bright accents —
                 * the page-wide swap to dark ink would have made this card
                 * unreadable, which is the one place the frame's palette must
                 * not reach. */
                className="bk-reveal absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 text-white backdrop-blur-sm"
              >
                {/* The wedding was on the board, under this card. A round nobody
                  * won gets the hourglass: ceremony for a stalemate reads as
                  * mockery. */}
                {p.winner.unwon && <Hourglass size={34} className="text-white/45" />}
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
                    className="bk-wax inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold"
                  >
                    <Repeat size={15} /> {p.againLabel ?? "Play Again"}
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
              /* The till goes in the RIGHT gutter, above the tiles. The hint
                 already sits under the left column, so the two pieces of
                 furniture end up diagonally opposite rather than stacked down
                 one side of a centred board. */
              header={<RoundTally pot={p.pot ?? null} charity={p.charityName} />}
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
      {/* Exactly as wide as the hive above it, and centred on the same axis:
        * "Tactic?" starts where the meadow starts and the action button ends
        * where it ends. `maxWidth` only, so a screen too narrow for the board's
        * width simply keeps the full width it has. */}
      <div
        style={drawn ? { maxWidth: drawn } : undefined}
        className="mx-auto flex w-full shrink-0 items-center gap-2 pb-[env(safe-area-inset-bottom)] sm:gap-4"
      >
        {/* TACTIC — a standing choice, and a different question from the one
          * the button asks. It wore the action's lime, so the two read as one
          * control in two halves and the toggle looked like a smaller Crawl
          * button. Purple, and labelled, and no longer shoulder to shoulder
          * with the thing it modifies. */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="shrink text-[11px] font-medium tracking-wide text-ink/60">Tactic?</span>
          {/* A tray the tactics sit IN — sunk a little, so the chosen one, raised
            * and purple, reads as the cell that is lit. The marks are the board's
            * own, in the button's ink: a selected tactic and an idle one differ in
            * their ground, not in their glyph. */}
          <div className="bk-tray flex gap-1.5 rounded-2xl p-1.5">
            {/* The icon with its name in teeny print beneath, in the same
              * cell: the screen has the pixels for it now, and a word that
              * small is a caption on the mark, not a sentence about it. */}
            {p.verbs.map(({ id, hint, icon, label }) => (
              <button
                key={id}
                onClick={() => p.onVerb(id)}
                title={hint}
                aria-pressed={p.verb === id}
                className={`bk-cell flex h-11 w-11 flex-col items-center justify-center rounded-xl transition sm:h-12 sm:w-12 ${
                  p.verb === id ? "bk-verb-on text-[var(--color-ink)]" : "text-ink/70 hover:bg-ink/7"
                }`}
              >
                <Art id={icon} size={21} />
                <span>{label}</span>
              </button>
            ))}
            <button
              onClick={() => p.onCruise(!p.cruise)}
              disabled={!p.cruiseEnabled}
              title="Cruise"
              aria-pressed={p.cruise}
              className={`bk-cell flex h-11 w-11 flex-col items-center justify-center rounded-xl transition sm:h-12 sm:w-12 disabled:opacity-35 ${
                p.cruise ? "bk-verb-on text-[var(--color-ink)]" : "text-ink/70 hover:bg-ink/7"
              }`}
            >
              <Art id="cruise" size={21} />
              <span>cruise</span>
            </button>
          </div>
        </div>

        {/* The gap between the standing choice and the thing you do now. It is
          * the first thing to close on a narrow screen — the two groups have to
          * fit before the air between them does. */}
        <span className="min-w-2 flex-1 sm:min-w-6" />

        <span className="shrink text-[11px] font-medium tracking-wide text-ink/60">Now?</span>
        {/* Lime wax: your colour, with the weight of a thing you press. */}
        <button
          onClick={p.onAct}
          disabled={!p.actionEnabled}
          className="bk-act relative min-w-28 shrink-0 overflow-hidden rounded-2xl px-4 py-3 font-semibold transition sm:min-w-40 sm:px-6"
        >
          {/* The rest, drawn ON the button it gates: lime wax rising across it
           * as the wait runs down, so the unfilled part IS the wait. A bee moves
           * once a second and rather longer after a dig, which is what stops
           * spending from buying speed. */}
          {p.restLeft > 0 && (
            <span
              className="bk-rest absolute inset-y-0 left-0 transition-[width] duration-100"
              style={{ width: `${Math.max(0, Math.min(1, 1 - p.restLeft)) * 100}%` }}
            />
          )}
          <span className="relative inline-flex items-center justify-center gap-1.5">
            {p.actionLabel.icon && <Art id={p.actionLabel.icon} size={18} />}
            {p.actionLabel.text}
          </span>
        </button>

      </div>

      {/* On a phone the hint goes BELOW the controls, deliberately last.
        * A short screen has to cut something, and the order down the page is
        * the order of what can be spared: the board, then the thing you press,
        * then a sentence you can play without. Above the controls it would have
        * pushed the button off instead. */}
      {!wide && p.pot && (
        <div className="shrink-0 px-2 pt-1">
          <RoundTally pot={p.pot} charity={p.charityName} />
        </div>
      )}
      {!wide && <div className="shrink-0 pt-1">{hintLine}</div>}
    </div>
  );
}
