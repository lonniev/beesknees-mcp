/**
 * The focused board: WebGL on top, SVG underneath.
 *
 * The SVG `HiveView` is rendered synchronously, so the server-side smoke and
 * prerender scripts see a full board and a browser paints one on the first
 * frame. Then, once Pixi has loaded and drawn its own first frame, the SVG is
 * hidden and frozen — hidden so the stage shows through, frozen so React
 * stops re-rendering 358 cells ten times a second for a picture nobody sees.
 *
 * It stays mounted. It is the fallback: no WebGL, a context lost to memory
 * pressure, a module that failed to load — the SVG is simply shown again and
 * the game carries on exactly as it did before this file existed.
 */

import { memo, useEffect, useRef, useState } from "react";
import { cellAt } from "../lib/polar.ts";
import { viewFromPointer } from "../lib/stageMath.ts";
import { HiveView, type ViewBee } from "./HiveView.tsx";
import type { Board } from "../game/rules.ts";
import type { HiveStage as Stage, StageProps } from "../stage/HiveStage.ts";

interface Props {
  board: Board;
  bees: ViewBee[];
  hot: boolean;
  youId: number | null;
  target: number | null;
  route?: number[];
  options?: number[];
  armed: boolean;
  frame: number;
  /** Which match this is — see `StageProps.epoch`. */
  epoch: string;
  /** The winner's id when the race was decided in THIS hive; the stage holds the wedding. */
  winnerId: number | null;
  onTapCell?: (cell: number) => void;
}

const FrozenHive = memo(HiveView, () => true);

export default function HiveStage(p: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const svgWrap = useRef<HTMLDivElement | null>(null);
  const stage = useRef<Stage | null>(null);
  const latest = useRef(p);
  latest.current = p;
  const [frozen, setFrozen] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    let made: Stage | null = null;

    const fallBack = () => {
      stage.current = null;
      setFrozen(false);
      if (svgWrap.current) svgWrap.current.style.visibility = "";
      made?.destroy();
      made = null;
    };

    (async () => {
      try {
        const { HiveStage: Impl } = await import("../stage/HiveStage.ts");
        if (cancelled) return;
        const s = await Impl.create(el, { onLost: fallBack });
        // StrictMode mounts twice and HMR remounts; a stage that resolves
        // after its effect was torn down would be a leaked WebGL context.
        if (cancelled) {
          s.destroy();
          return;
        }
        made = s;
        s.update(asStageProps(latest.current));
        s.renderNow();
        // Same task as the first draw, so there is never a frame with both or neither.
        if (svgWrap.current) svgWrap.current.style.visibility = "hidden";
        stage.current = s;
        setFrozen(true);
      } catch (e) {
        // No WebGL, or Pixi failed to load. The SVG was never hidden.
        console.warn("hive stage unavailable; keeping the SVG board", e);
      }
    })();

    return () => {
      cancelled = true;
      stage.current = null;
      made?.destroy();
      made = null;
    };
  }, []);

  // Every render: the stage diffs for itself and only redraws what moved.
  useEffect(() => {
    stage.current?.update(asStageProps(p));
  });

  const tap = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = stage.current;
    if (!s || !p.onTapCell) return;
    if (e.target !== s.canvas) return;
    const [x, y] = viewFromPointer(s.canvas.getBoundingClientRect(), e.clientX, e.clientY);
    const cell = cellAt(p.board.g, x, y);
    if (cell !== null) p.onTapCell(cell);
  };

  const Svg = frozen ? FrozenHive : HiveView;
  return (
    <div ref={host} className="relative h-full w-full" onPointerDown={tap}>
      <div ref={svgWrap} className="absolute inset-0">
        <Svg
          board={p.board}
          bees={p.bees}
          hot={p.hot}
          frame={p.frame}
          youId={p.youId}
          target={p.target}
          route={p.route}
          options={p.options}
          focused
          armed={p.armed}
          onTapCell={p.onTapCell}
        />
      </div>
    </div>
  );
}

function asStageProps(p: Props): StageProps {
  return {
    board: p.board,
    bees: p.bees,
    hot: p.hot,
    youId: p.youId,
    target: p.target,
    route: p.route,
    options: p.options,
    armed: p.armed,
    epoch: p.epoch,
    winnerId: p.winnerId,
  };
}
