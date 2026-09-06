/**
 * The Bee's Knees — solo mode.
 *
 * Everything here runs against the local engine so the interface can be played
 * before anybody has paid for anything. The board, the clock and the rules are
 * already the ones the server will enforce; what solo mode fakes is only who is
 * asked for the next move.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pickaxe, RotateCcw, ShieldOff, Trophy } from "lucide-react";
import { HiveView } from "./components/HiveView.tsx";
import { stepToward } from "./game/bots.ts";
import { OPEN, TICK_MS, ringOf } from "./game/rules.ts";
import type { Hive, Match } from "./game/match.ts";
import { isHot, seated, standings } from "./game/match.ts";
import { useSoloMatch } from "./lib/useMatch.ts";
import { useWide } from "./lib/useWide.ts";

const PHASE_WORD: Record<string, string> = {
  forage: "Find a flower",
  return: "Carry it home",
  tunnel: "Dig for the queen",
  done: "At the queen",
};

/**
 * One rival hive, small.
 *
 * Its whole job is to answer "is anything happening over there" at a glance —
 * which is why the wall carries the hive's temperature rather than the tile's
 * border doing it: the border is a few pixels of chrome, the wall is the shape
 * the eye already lands on.
 */
function RivalTile({
  hive,
  match,
  frame,
  onPick,
}: {
  hive: Hive;
  match: Match;
  frame: number;
  onPick: (id: number) => void;
}) {
  const isYours = match.you?.hive === hive.id;
  const hot = isHot(hive);
  return (
    <button
      onClick={() => onPick(hive.id)}
      title={isYours ? `${hive.name} — your hive` : hive.name}
      className={`relative aspect-square h-full overflow-hidden rounded-lg border transition ${
        hot
          ? "border-[var(--color-hot)]"
          : isYours
            ? "border-[var(--color-you)]"
            : "border-white/10"
      }`}
    >
      <HiveView
        hive={hive}
        frame={frame}
        youId={isYours ? (match.you?.beeId ?? null) : null}
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
  match,
  frame,
  onPick,
}: {
  hives: Hive[];
  match: Match;
  frame: number;
  onPick: (id: number) => void;
}) {
  if (!hives.length) return null;
  return (
    <div className="flex w-24 shrink-0 flex-col justify-center gap-2 lg:w-32 xl:w-40">
      {hives.map((h) => (
        <div key={h.id} className="h-24 lg:h-32 xl:h-40">
          <RivalTile hive={h} match={match} frame={frame} onPick={onPick} />
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const { match, frame, you, cooldown, submit, restart } = useSoloMatch();
  const [focus, setFocus] = useState<number | null>(match.you?.hive ?? 0);
  const [armed, setArmed] = useState(false);
  const wide = useWide();

  // A new match re-seats you, so the view follows your bee rather than staying
  // parked on whichever rival you were watching when the last round ended.
  const newMatch = useCallback(() => {
    restart();
    setFocus(0);
  }, [restart]);

  const rivals = match.hives.filter((h) => h.id !== focus);
  const yourHive = match.you ? match.hives[match.you.hive] : null;
  const ready = cooldown <= 0;

  const onTapCell = useCallback(
    (cell: number) => {
      if (!yourHive || !you || !ready || match.state !== "running") return;
      const round = yourHive.round;

      if (armed) {
        const r = ringOf(round.board.g, cell);
        if (r >= 1 && r <= round.board.g.R && round.board.state[cell] === OPEN) {
          submit({ kind: "collapse", at: cell });
          setArmed(false);
        }
        return;
      }
      const action = stepToward(round, you, cell);
      if (action) submit(action);
    },
    [armed, match.state, ready, submit, you, yourHive],
  );

  // Sealing is only ever legal inside the comb, so the control should not be
  // offered in the meadow where it would simply do nothing when pressed.
  const canSeal =
    !!you && !!yourHive && you.phase === "tunnel" && ringOf(yourHive.round.board.g, you.cell) <= yourHive.round.board.g.R;

  useEffect(() => {
    if (!canSeal && armed) setArmed(false);
  }, [armed, canSeal]);

  const board = useMemo(() => standings(match).slice(0, 6), [match, frame]);
  const elapsed = Math.floor((match.tick * TICK_MS) / 1000);

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <header className="flex items-center justify-between px-1">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">The Bee's Knees</span>
          <span className="text-xs text-white/40">solo</span>
        </div>
        <div className="flex items-center gap-3 text-xs tabular-nums text-white/60">
          <span>
            {String(Math.floor(elapsed / 60))}:{String(elapsed % 60).padStart(2, "0")}
          </span>
          <button onClick={newMatch} className="rounded-md p-1.5 hover:bg-white/10" title="New match">
            <RotateCcw size={16} />
          </button>
        </div>
      </header>

      {/* Which hive you are looking at — and a way straight back to your own,
       * since watching a rival is a click away and finding your way home
       * should not be a hunt through the gutters. */}
      {focus !== null && (
        <div className="flex shrink-0 items-center justify-between px-1 text-xs">
          <span className="font-medium">
            {match.hives[focus].name}
            {match.you?.hive === focus && (
              <span className="ml-1.5 text-[var(--color-you)]">your hive</span>
            )}
          </span>
          {match.you && match.you.hive !== focus && (
            <button
              onClick={() => setFocus(match.you!.hive)}
              className="rounded-full bg-[var(--color-you)]/15 px-2.5 py-1 text-[var(--color-you)]"
            >
              Back to my bee
            </button>
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
            match={match}
            frame={frame}
            onPick={setFocus}
          />
        )}

        <div className="relative min-h-0 flex-1">
          {focus !== null && (
            <HiveView
              hive={match.hives[focus]}
              frame={frame}
              youId={match.you?.hive === focus ? (match.you?.beeId ?? null) : null}
              focused
              armed={armed}
              onTapCell={onTapCell}
            />
          )}

          {match.state === "ended" && match.winner && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
              <Trophy size={40} className="text-[var(--color-wax)]" />
              <div className="text-center">
                <div className="text-xl font-semibold">{match.winner.label}</div>
                <div className="text-sm text-white/60">
                  reached the queen in {match.hives[match.winner.hive].name}
                </div>
              </div>
              <button
                onClick={newMatch}
                className="rounded-full bg-[var(--color-wax)] px-5 py-2 text-sm font-medium text-black"
              >
                Again
              </button>
            </div>
          )}
        </div>

        {wide && (
          <RivalColumn
            hives={rivals.slice(Math.ceil(rivals.length / 2))}
            match={match}
            frame={frame}
            onPick={setFocus}
          />
        )}
      </div>

      {/* Narrow screens have no gutters, so the rivals go back on top. */}
      {!wide && (
        <div className="flex h-16 shrink-0 justify-center gap-1.5">
          {rivals.map((h) => (
            <RivalTile key={h.id} hive={h} match={match} frame={frame} onPick={setFocus} />
          ))}
        </div>
      )}

      {/* Standings — who is nearest a queen, anywhere. */}
      <div className="flex shrink-0 gap-1 overflow-x-auto px-0.5 pb-0.5 text-[11px]">
        {board.map(({ hive, seat, bee }) => {
          const isYou = seat.npub === "you";
          return (
            <div
              key={`${hive.id}-${seat.beeId}`}
              className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 ${
                isYou ? "bg-white/20 font-medium" : "bg-white/5 text-white/60"
              }`}
            >
              <span>{seat.label}</span>
              <span className="text-white/30">{hive.name.slice(0, 3)}</span>
              <span className="tabular-nums text-white/40">
                {bee.phase === "tunnel" ? `${ringOf(hive.round.board.g, bee.cell)}` : bee.phase === "done" ? "\u2713" : "\u00b7"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Controls. */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex-1 rounded-xl bg-white/5 px-3 py-2">
          <div className="text-[11px] text-white/50">{you ? PHASE_WORD[you.phase] : "—"}</div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[var(--color-wax)] transition-[width] duration-100"
              style={{ width: `${Math.max(0, Math.min(1, 1 - cooldown)) * 100}%` }}
            />
          </div>
        </div>
        <button
          disabled={!canSeal}
          onClick={() => setArmed((a) => !a)}
          className={`flex h-14 w-14 items-center justify-center rounded-xl transition disabled:opacity-25 ${
            armed ? "bg-[var(--color-queen)] text-black" : "bg-white/10"
          }`}
          title="Seal a tunnel behind you"
        >
          {armed ? <ShieldOff size={20} /> : <Pickaxe size={20} />}
        </button>
      </div>

      <p className="shrink-0 px-1 pb-[env(safe-area-inset-bottom)] text-center text-[11px] text-white/35">
        {armed
          ? "Tap an open tunnel to bring it down"
          : yourHive && seated(yourHive).length
            ? "Tap where you want to go"
            : ""}
      </p>
    </div>
  );
}
