/**
 * The focused hive, drawn in WebGL.
 *
 * This is a RENDERER, not a game. It takes the same data the SVG board takes —
 * a board, some bees, where you are aiming — and draws it with depth, motion
 * and weather: bees that fly between cells rather than appearing in them,
 * pollen that trails a bee carrying it home, comb that crumbles when cut and
 * caps over when sealed, a wall that glows once the race is near a queen.
 * Nothing here decides anything. Both engines keep deciding exactly as before.
 *
 * Reached only by dynamic import. Pixi needs a window, and the build's smoke
 * and prerender scripts render the app in plain Node — the SVG board is what
 * they see and what a browser sees first, and this takes over on top of it.
 *
 * Neither engine emits events, so `update` snapshots the hive and asks
 * `stageMath.diffFrame` what changed (see there for why a dig is attributed by
 * counter and not by coincidence). Everything time-based — tweens, wingbeats,
 * pulses, particles — runs on Pixi's ticker and reads nothing from React.
 */

import { Application, BlurFilter, Container, Graphics, Sprite, Texture } from "pixi.js";
import { OPEN, isHive, ringOf, type Board, type Geometry } from "../game/rules.ts";
import { paintGrain, paintShape, paintedCanvas } from "../art/canvas.ts";
import { bee, crown, daisy } from "../art/shapes.ts";
import { VIEW, cellArc, cellCentre, ringRadius, slotAngle, type CellArc } from "../lib/polar.ts";
import {
  diffFrame,
  easeOut,
  snapshot,
  tweenMs,
  type Snapshot,
  type StageBee,
} from "../lib/stageMath.ts";
import { readPalette, type Palette } from "./palette.ts";

const TAU = Math.PI * 2;

export interface StageProps {
  board: Board;
  bees: StageBee[];
  hot: boolean;
  youId: number | null;
  target: number | null;
  route?: number[];
  options?: number[];
  armed: boolean;
  /**
   * Which match this is. A new epoch throws every bee away rather than
   * tweening seat 3 of the last round across the board to seat 3 of this one.
   */
  epoch: string;
}

export interface StageOpts {
  reduced: boolean;
  /** The WebGL context went away. The caller shows the SVG again. */
  onLost: () => void;
}

interface Tween {
  /** Waypoints in view units, starting where the bee was drawn. */
  points: [number, number][];
  /** Cumulative distance to each waypoint; `total` is the last. */
  marks: number[];
  total: number;
  t0: number;
  dur: number;
}

interface BeeSprite {
  id: number;
  cell: number;
  phase: string;
  sprite: Sprite;
  crown: Sprite;
  x: number;
  y: number;
  heading: number;
  tween: Tween | null;
  lastMoveAt: number;
  flap: number;
}

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  life: number;
  age: number;
  size: number;
}

interface Cap {
  gfx: Graphics;
  age: number;
}

function drawCell(gfx: Graphics, arc: CellArc, inset = 0): Graphics {
  if (arc.kind === "disc") return gfx.circle(0, 0, arc.r - inset);
  if (arc.kind === "square") return gfx.rect(arc.x + inset, arc.y + inset, arc.side - 2 * inset, arc.side - 2 * inset);
  const r0 = arc.r0 + inset;
  const r1 = arc.r1 - inset;
  const da = inset / ((r0 + r1) / 2);
  const a0 = arc.a0 + da;
  const a1 = arc.a1 - da;
  gfx.moveTo(r1 * Math.cos(a0), r1 * Math.sin(a0));
  gfx.arc(0, 0, r1, a0, a1);
  gfx.lineTo(r0 * Math.cos(a1), r0 * Math.sin(a1));
  gfx.arc(0, 0, r0, a1, a0, true);
  gfx.closePath();
  return gfx;
}

/** A dashed polyline, by hand — Pixi strokes have no dash. */
function dashed(gfx: Graphics, pts: [number, number][], on: number, off: number): void {
  let carry = 0;
  let pen = true;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / (len || 1);
    const uy = (y1 - y0) / (len || 1);
    let at = 0;
    while (at < len) {
      const seg = Math.min((pen ? on : off) - carry, len - at);
      if (pen) gfx.moveTo(x0 + ux * at, y0 + uy * at).lineTo(x0 + ux * (at + seg), y0 + uy * (at + seg));
      at += seg;
      carry += seg;
      if (carry >= (pen ? on : off) - 1e-9) {
        carry = 0;
        pen = !pen;
      }
    }
  }
}

export class HiveStage {
  private app: Application;
  private host: HTMLElement;
  private opts: StageOpts;
  private palette: Palette;
  private root = new Container();
  private ro: ResizeObserver | null = null;

  private g: Geometry | null = null;
  private epoch = "";
  private snap: Snapshot | null = null;
  private board: Board | null = null;

  private tex!: {
    beeUp: Texture;
    beeDown: Texture;
    full: Texture;
    empty: Texture;
    grain: Texture;
    crumb: Texture;
    glow: Texture;
    crown: Texture;
  };

  // Layers, bottom to top.
  private meadow = new Graphics();
  private flowerLayer = new Container();
  private comb = new Graphics();
  private cells = new Graphics();
  private queenGlow!: Sprite;
  private queen = new Graphics();
  private queenCrown!: Sprite;
  private wallGlow = new Graphics();
  private wall = new Graphics();
  private overlay = new Graphics();
  private halo = new Graphics();
  private beeLayer = new Container();
  private fx = new Container();
  private armedRing = new Graphics();

  private flowers = new Map<number, Sprite>();
  private bees = new Map<number, BeeSprite>();
  private pool: Sprite[] = [];
  private live: Particle[] = [];
  private caps: Cap[] = [];

  private hot = false;
  private mine = false;
  private youId: number | null = null;
  private lost = false;

  private constructor(app: Application, host: HTMLElement, opts: StageOpts) {
    this.app = app;
    this.host = host;
    this.opts = opts;
    this.palette = readPalette();
  }

  /** Make one. Rejects where WebGL is not to be had; the caller keeps the SVG. */
  static async create(host: HTMLElement, opts: StageOpts): Promise<HiveStage> {
    const app = new Application();
    await app.init({
      backgroundAlpha: 0,
      antialias: true,
      // Two is plenty for hairlines and sprites; three is nine times the
      // pixels of one, on exactly the phones with the least to spare.
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: "webgl",
    });
    const stage = new HiveStage(app, host, opts);
    stage.build();
    return stage;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  private build(): void {
    const { app, host, root } = this;
    const canvas = app.canvas;
    canvas.className = "hive";
    canvas.style.position = "absolute";
    canvas.style.touchAction = "none";
    host.appendChild(canvas);
    canvas.addEventListener("webglcontextlost", () => {
      this.lost = true;
      this.opts.onLost();
    });

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const made = (px: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void) =>
      Texture.from(paintedCanvas(px, dpr, paint));
    this.tex = {
      beeUp: made(64, (c, s) => paintShape(c, s, bee("up"))),
      beeDown: made(64, (c, s) => paintShape(c, s, bee("down"))),
      full: made(48, (c, s) => paintShape(c, s, daisy(true))),
      empty: made(48, (c, s) => paintShape(c, s, daisy(false))),
      grain: made(12, (c, s) => paintGrain(c, s, "#fcd34d")),
      crumb: made(12, (c, s) => paintGrain(c, s, "#c9a227")),
      glow: made(64, (c, s) => paintGrain(c, s, "#ff5fa2")),
      crown: made(48, (c, s) => paintShape(c, s, crown())),
    };

    this.queenGlow = new Sprite(this.tex.glow);
    this.queenGlow.anchor.set(0.5);
    this.queenCrown = new Sprite(this.tex.crown);
    this.queenCrown.anchor.set(0.5);
    this.wallGlow.filters = [new BlurFilter({ strength: 6 })];

    root.addChild(
      this.meadow,
      this.flowerLayer,
      this.comb,
      this.cells,
      this.queenGlow,
      this.queen,
      this.queenCrown,
      this.wallGlow,
      this.wall,
      this.overlay,
      this.halo,
      this.beeLayer,
      this.fx,
      this.armedRing,
    );
    app.stage.addChild(root);

    // The drawn hive is the centred square of the host — the same square the
    // SVG letterboxes itself into, which `Coronation` and the foragers'
    // `drawnHive` both assume. Sized by hand: `resizeTo` would fill the box.
    const fit = () => {
      const r = host.getBoundingClientRect();
      const s = Math.floor(Math.min(r.width, r.height));
      if (s <= 0) return;
      app.renderer.resize(s, s);
      canvas.style.left = `${(r.width - s) / 2}px`;
      canvas.style.top = `${(r.height - s) / 2}px`;
      root.position.set(s / 2, s / 2);
      root.scale.set(s / (2 * VIEW));
    };
    fit();
    this.ro = new ResizeObserver(fit);
    this.ro.observe(host);

    app.ticker.add(() => this.tick());
  }

  /** Draw the frame now, outside the ticker — for a flicker-free handover. */
  renderNow(): void {
    this.app.render();
  }

  destroy(): void {
    this.ro?.disconnect();
    this.ro = null;
    this.app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
  }

  // ── Static scenery, once per geometry ─────────────────────────────────

  private buildScenery(board: Board): void {
    const g = board.g;
    const P = this.palette;
    this.g = g;

    // The meadow: the brand violet, a little darker toward the corners, and
    // hairlines only between real squares — a lattice ruled across the hive
    // would be a grid where there is nothing to stand on.
    const m = this.meadow;
    m.clear();
    m.roundRect(-VIEW, -VIEW, 2 * VIEW, 2 * VIEW, 6).fill(P.meadow);
    m.roundRect(-VIEW, -VIEW, 2 * VIEW, 2 * VIEW, 6).fill({ color: 0x000000, alpha: 0.1 });
    for (let k = 0; k < 6; k++) m.circle(0, 0, VIEW * (1.25 - k * 0.07)).fill({ color: 0x6a5475, alpha: 0.07 });
    const at = (row: number, col: number) =>
      row < 0 || row >= g.gridN || col < 0 || col >= g.gridN ? -1 : g.slotCell[row * g.gridN + col];
    for (let row = 0; row < g.gridN; row++) {
      for (let col = 0; col < g.gridN; col++) {
        if (at(row, col) < 0) continue;
        const x0 = -VIEW + g.step * col;
        const y0 = -VIEW + g.step * row;
        const x1 = x0 + g.step;
        const y1 = y0 + g.step;
        if (at(row - 1, col) >= 0 || row === 0) m.moveTo(x0, y0).lineTo(x1, y0);
        if (at(row, col - 1) >= 0 || col === 0) m.moveTo(x0, y0).lineTo(x0, y1);
        if (row === g.gridN - 1) m.moveTo(x0, y1).lineTo(x1, y1);
        if (col === g.gridN - 1) m.moveTo(x1, y0).lineTo(x1, y1);
      }
    }
    m.stroke({ width: 1, pixelLine: true, color: 0x000000, alpha: 0.16 });

    // Flowers.
    this.flowerLayer.removeChildren();
    this.flowers.clear();
    for (let c = 0; c < g.cells; c++) {
      if (!board.flower[c]) continue;
      const [x, y] = cellCentre(g, c);
      const sp = new Sprite(this.tex.full);
      sp.anchor.set(0.5);
      sp.position.set(x, y);
      sp.width = sp.height = 8.5;
      (sp as Sprite & { sway: number }).sway = Math.random() * TAU;
      this.flowerLayer.addChild(sp);
      this.flowers.set(c, sp);
    }

    // The comb: a disc with every cell drawn in one of two wax tones so it
    // reads as cells rather than as background; a dark edge and a lighter
    // inner line on every ring, which is all the relief it needs.
    const wallR = ringRadius(g, g.R + 1);
    const comb = this.comb;
    comb.clear();
    comb.circle(0, 0, wallR + 0.6).fill({ color: 0x000000, alpha: 0.35 });
    comb.circle(0, 0, wallR).fill(P.comb);
    for (let c = 1; c < g.hiveCells; c++) {
      const r = ringOf(g, c);
      const i = c - g.offset[r];
      drawCell(comb, cellArc(g, c)).fill({ color: (r + i) & 1 ? 0x3a2c13 : 0x2a1f0d, alpha: 0.9 });
    }
    for (let r = 1; r <= g.R + 1; r++) {
      comb.circle(0, 0, ringRadius(g, r)).stroke({ width: 0.35, color: 0x1a1208, alpha: 0.9 });
      comb.circle(0, 0, ringRadius(g, r) - 0.45).stroke({ width: 0.25, color: 0x8a6a2a, alpha: 0.35 });
    }
    for (let r = 1; r <= g.R; r++) {
      const r0 = ringRadius(g, r);
      const r1 = ringRadius(g, r + 1);
      const n = g.size[r];
      for (let i = 0; i < n; i++) {
        const a = slotAngle(n, i);
        comb.moveTo(r0 * Math.cos(a), r0 * Math.sin(a)).lineTo(r1 * Math.cos(a), r1 * Math.sin(a));
      }
    }
    comb.stroke({ width: 0.3, color: 0x1a1208, alpha: 0.85 });

    // The queen's chamber.
    const q1 = ringRadius(g, 1);
    this.queenGlow.width = this.queenGlow.height = q1 * 6;
    this.queen.clear();
    this.queen.circle(0, 0, q1).fill(P.queen);
    this.queen.circle(0, 0, q1 * 0.6).fill({ color: 0xffffff, alpha: 0.35 });
    this.queenCrown.width = this.queenCrown.height = q1 * 1.7;

    this.armedRing.clear();
    this.armedRing.circle(0, 0, VIEW - 1).stroke({ width: 1.5, color: P.queen });
    this.armedRing.visible = false;
  }

  /** The wall as arcs BETWEEN the doors, so a door is a gap rather than a mark. */
  private paintWall(board: Board): void {
    const g = board.g;
    const P = this.palette;
    const wallR = ringRadius(g, g.R + 1);
    const n = g.size[g.R];
    const slots: number[] = [];
    for (let c = g.offset[g.R]; c < g.offset[g.R] + n; c++) if (board.mouth[c]) slots.push(c - g.offset[g.R]);
    slots.sort((a, b) => a - b);
    const arcs = (gfx: Graphics, width: number, color: number, alpha: number) => {
      if (!slots.length) {
        gfx.circle(0, 0, wallR).stroke({ width, color, alpha });
        return;
      }
      for (let k = 0; k < slots.length; k++) {
        const a0 = slotAngle(n, slots[k] + 1);
        const a1 = slotAngle(n, slots[(k + 1) % slots.length] + (k + 1 === slots.length ? n : 0));
        gfx.arc(0, 0, wallR, a0, a1).stroke({ width, color, alpha, cap: "round" });
      }
    };
    const tone = this.hot ? P.hot : this.mine ? P.hiveMine : P.wax;
    this.wall.clear();
    arcs(this.wall, 3.2, 0x8a6a1e, 1);
    arcs(this.wall, 2.0, tone, 1);
    arcs(this.wall, 0.7, 0xffffff, 0.35);
    this.wallGlow.clear();
    arcs(this.wallGlow, 7, tone, this.hot ? 0.8 : this.mine ? 0.35 : 0.2);
  }

  /** Tunnels and capped brood — the cells that change. */
  private paintCells(board: Board): void {
    const g = board.g;
    const P = this.palette;
    const c2 = this.cells;
    c2.clear();
    for (let c = 0; c < g.cells; c++) {
      if (board.blocked[c]) {
        drawCell(c2, cellArc(g, c)).fill({ color: 0x120c05, alpha: 0.9 });
        drawCell(c2, cellArc(g, c), 0.9).stroke({ width: 0.3, color: 0x6b4a1a, alpha: 0.5 });
      }
      if (isHive(g, c) && ringOf(g, c) <= g.R && board.state[c] === OPEN && !board.mouth[c]) {
        // Muted: a tunnel is the floor the bees walk on, not a lamp. The
        // first draft lit them and by the end of a round the hive was a
        // yellow disc.
        drawCell(c2, cellArc(g, c)).fill({ color: P.tunnel, alpha: 0.58 });
        drawCell(c2, cellArc(g, c), 0.9).fill({ color: 0xf2d060, alpha: 0.16 });
      }
    }
  }

  /**
   * Options, aim, route and cut marks: the two-step move made visible.
   *
   * Same decisions as the SVG board, for the same reasons (see there): the
   * options are faint because they are a menu; the destination is a white
   * outline because your bee is a lime disc and two lime circles side by side
   * were indistinguishable; the route is the line the bee will actually take,
   * with the cells it still has to CUT marked apart from the ones it walks.
   */
  private paintOverlay(p: StageProps, you: BeeSprite | null): void {
    const g = p.board.g;
    const o = this.overlay;
    o.clear();
    for (const c of p.options ?? []) {
      drawCell(o, cellArc(g, c)).fill({ color: 0xffffff, alpha: 0.07 });
      drawCell(o, cellArc(g, c)).stroke({ width: 0.35, color: 0xffffff, alpha: 0.3 });
    }
    if (p.target != null) {
      drawCell(o, cellArc(g, p.target)).fill({ color: 0xffffff, alpha: 0.1 });
      drawCell(o, cellArc(g, p.target)).stroke({ width: 1.4, color: 0xffffff, alpha: 0.9 });
      if (you && p.route && p.route.length) {
        const pts: [number, number][] = [[you.x, you.y], ...p.route.map((c) => cellCentre(g, c))];
        dashed(o, pts, 2, 2);
        o.stroke({ width: 0.6, color: 0xffffff, alpha: 0.5 });
        for (const c of p.route) {
          if (p.board.state[c] !== OPEN) drawCell(o, cellArc(g, c)).stroke({ width: 0.35, color: 0xffffff, alpha: 0.4 });
        }
      }
    }
  }

  // ── Bees ──────────────────────────────────────────────────────────────

  private makeBee(id: number, cell: number, phase: string): BeeSprite {
    const g = this.g!;
    const [x, y] = cellCentre(g, cell);
    const sprite = new Sprite(this.tex.beeUp);
    sprite.anchor.set(0.5);
    const crown = new Sprite(this.tex.crown);
    crown.anchor.set(0.5, 1.1);
    crown.width = crown.height = 9;
    crown.visible = phase === "done";
    const b: BeeSprite = {
      id, cell, phase, sprite, crown, x, y,
      heading: Math.atan2(-y, -x),
      tween: null,
      lastMoveAt: 0,
      flap: Math.random() * 10,
    };
    sprite.position.set(x, y);
    sprite.rotation = b.heading;
    this.beeLayer.addChild(sprite, crown);
    this.bees.set(id, b);
    this.dress(b);
    return b;
  }

  /** Yours is bigger and brighter; rivals are rivals. */
  private dress(b: BeeSprite): void {
    const you = b.id === this.youId;
    b.sprite.width = b.sprite.height = you ? 11 : 9;
    b.sprite.alpha = you ? 1 : 0.88;
  }

  private dropBee(b: BeeSprite): void {
    this.beeLayer.removeChild(b.sprite, b.crown);
    b.sprite.destroy();
    b.crown.destroy();
    this.bees.delete(b.id);
  }

  private startTween(b: BeeSprite, path: number[], now: number): void {
    const g = this.g!;
    const points: [number, number][] = [[b.x, b.y], ...path.map((c) => cellCentre(g, c))];
    const marks: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      marks.push(marks[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    const gap = b.lastMoveAt ? now - b.lastMoveAt : 900;
    b.lastMoveAt = now;
    const dur = tweenMs(gap, this.opts.reduced);
    b.tween = { points, marks, total: marks[marks.length - 1], t0: now, dur };
    if (dur === 0) this.settle(b);
  }

  private settle(b: BeeSprite): void {
    if (!b.tween) return;
    const end = b.tween.points[b.tween.points.length - 1];
    b.x = end[0];
    b.y = end[1];
    b.tween = null;
  }

  // ── Effects ───────────────────────────────────────────────────────────

  private particle(texture: Texture, x: number, y: number, size: number, vx: number, vy: number, life: number, tint: number): void {
    if (this.opts.reduced || this.live.length > 400) return;
    const sprite = this.pool.pop() ?? new Sprite(texture);
    sprite.texture = texture;
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    sprite.width = sprite.height = size;
    sprite.alpha = 1;
    sprite.tint = tint;
    sprite.visible = true;
    this.fx.addChild(sprite);
    this.live.push({ sprite, vx, vy, life, age: 0, size });
  }

  private burst(cell: number, texture: Texture, count: number, speed: number, size: number, life: number, tint: number): void {
    const [x, y] = cellCentre(this.g!, cell);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.4 + Math.random());
      this.particle(texture, x, y, size * (0.6 + Math.random() * 0.8), Math.cos(a) * v, Math.sin(a) * v, life * (0.7 + Math.random() * 0.6), tint);
    }
  }

  private sealCap(cell: number): void {
    if (this.opts.reduced) return;
    const g = this.g!;
    const gfx = new Graphics();
    drawCell(gfx, cellArc(g, cell)).fill({ color: this.palette.wax, alpha: 0.95 });
    drawCell(gfx, cellArc(g, cell), 0.7).stroke({ width: 0.35, color: 0x8a6a1e, alpha: 0.8 });
    const [x, y] = cellCentre(g, cell);
    gfx.pivot.set(x, y);
    gfx.position.set(x, y);
    gfx.scale.set(0.2);
    this.fx.addChild(gfx);
    this.caps.push({ gfx, age: 0 });
  }

  // ── The frame ─────────────────────────────────────────────────────────

  /**
   * Take in a new look at the hive. Cheap: a snapshot, a diff, and only the
   * layers the diff touched are redrawn. Safe to call on every React render.
   */
  update(p: StageProps): void {
    if (this.lost) return;
    const now = performance.now();
    const board = p.board;
    const g = board.g;
    const fresh = !this.g || this.g.cells !== g.cells || this.g.R !== g.R || this.g.gridN !== g.gridN;
    if (fresh) this.buildScenery(board);

    if (p.epoch !== this.epoch || fresh) {
      // A new match. Nobody tweens from the last one's seat to this one's.
      this.epoch = p.epoch;
      for (const b of [...this.bees.values()]) this.dropBee(b);
      for (const [c, sp] of this.flowers) {
        sp.texture = board.pollen[c] ? this.tex.full : this.tex.empty;
        sp.alpha = board.pollen[c] ? 1 : 0.7;
      }
      this.snap = null;
      for (const q of this.live) { q.sprite.visible = false; this.fx.removeChild(q.sprite); this.pool.push(q.sprite); }
      this.live.length = 0;
    }

    const next = snapshot(board, p.bees);
    const d = diffFrame(g, this.snap, next);
    this.snap = next;
    this.youId = p.youId;

    for (const id of d.arrived) {
      const b = next.bees.get(id)!;
      this.makeBee(id, b.cell, b.phase);
    }
    for (const id of d.left) {
      const b = this.bees.get(id);
      if (b) this.dropBee(b);
    }
    for (const m of d.moved) {
      const b = this.bees.get(m.id);
      if (!b) continue;
      this.settle(b);
      b.cell = m.to;
      this.startTween(b, m.path, now);
      if (m.dug) this.burst(m.to, this.tex.crumb, 12, 9, 2.2, 520, 0xe8c547);
    }
    for (const ph of d.phased) {
      const b = this.bees.get(ph.id);
      if (!b) continue;
      b.phase = ph.to;
      if (ph.to === "done") {
        b.crown.visible = true;
        this.burst(b.cell, this.tex.grain, 24, 14, 2.6, 900, 0xfff1a8);
      }
    }
    for (const c of d.sealed) this.sealCap(c);
    for (const c of d.emptied) {
      const sp = this.flowers.get(c);
      if (!sp) continue;
      sp.texture = this.tex.empty;
      sp.alpha = 0.7;
      this.burst(c, this.tex.grain, 8, 6, 1.6, 600, 0xfde68a);
    }
    // A flower back in bloom with no rule for it is a thin reply, not news.
    for (const [c, sp] of this.flowers) {
      const full = Boolean(board.pollen[c]);
      if (full && sp.texture !== this.tex.full) { sp.texture = this.tex.full; sp.alpha = 1; }
    }

    const mine = p.youId !== null;
    const wallChanged = fresh || this.board === null || p.hot !== this.hot || mine !== this.mine || this.board.mouth !== board.mouth;
    this.hot = p.hot;
    this.mine = mine;
    if (wallChanged) this.paintWall(board);
    if (fresh || d.opened.length || d.sealed.length || this.board !== board) this.paintCells(board);
    this.board = board;

    for (const b of this.bees.values()) this.dress(b);
    this.paintOverlay(p, p.youId === null ? null : this.bees.get(p.youId) ?? null);
    this.armedRing.visible = p.armed;
  }

  private tick(): void {
    if (this.lost) return;
    const now = performance.now();
    const dt = Math.min(this.app.ticker.deltaMS, 100);
    const t = now / 1000;
    const reduced = this.opts.reduced;
    const P = this.palette;

    for (const b of this.bees.values()) {
      if (b.tween) {
        const tw = b.tween;
        const k = tw.dur ? Math.min(1, (now - tw.t0) / tw.dur) : 1;
        const dist = easeOut(k) * tw.total;
        let i = 1;
        while (i < tw.marks.length - 1 && tw.marks[i] < dist) i++;
        const seg = tw.marks[i] - tw.marks[i - 1] || 1;
        const f = (dist - tw.marks[i - 1]) / seg;
        const [ax, ay] = tw.points[i - 1];
        const [bx, by] = tw.points[i];
        b.x = ax + (bx - ax) * f;
        b.y = ay + (by - ay) * f;
        if (bx !== ax || by !== ay) b.heading = Math.atan2(by - ay, bx - ax);
        if (k >= 1) this.settle(b);
        // Carrying pollen home leaves a trail of it.
        if (b.phase === "return" && Math.random() < 0.5) {
          this.particle(
            this.tex.grain,
            b.x - Math.cos(b.heading) * 2.5 + (Math.random() - 0.5),
            b.y - Math.sin(b.heading) * 2.5 + (Math.random() - 0.5),
            1.2 + Math.random(),
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2 - 1.5,
            700,
            0xfcd34d,
          );
        }
      }
      const bob = reduced ? 0 : 0.25 * Math.sin(t * 7 + b.flap);
      b.sprite.position.set(b.x, b.y + bob);
      b.sprite.rotation = b.heading;
      b.crown.position.set(b.x, b.y - 1);
      if (!reduced) b.sprite.texture = ((t * 24 + b.flap) | 0) % 2 ? this.tex.beeUp : this.tex.beeDown;
      if (b.phase === "done") b.crown.rotation = reduced ? 0 : Math.sin(t * 3) * 0.15;
    }

    // You, last and loudest: the spoke from the queen that makes finding
    // yourself on a crowded ring a glance rather than a search.
    const you = this.youId === null ? null : this.bees.get(this.youId) ?? null;
    this.halo.clear();
    if (you && this.g) {
      const len = Math.hypot(you.x, you.y);
      if (len > 0) {
        const r1 = ringRadius(this.g, 1);
        this.halo.moveTo((you.x / len) * r1, (you.y / len) * r1).lineTo(you.x, you.y).stroke({ width: 0.5, color: P.you, alpha: 0.45 });
      }
      const pulse = reduced ? 0.22 : 0.22 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.6));
      this.halo.circle(you.x, you.y, 6.2).fill({ color: P.you, alpha: pulse });
      this.halo.circle(you.x, you.y, 6.2).stroke({ width: 1.0, color: P.you, alpha: 0.95 });
    }

    this.queenGlow.alpha = reduced ? 0.3 : 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2));
    this.wallGlow.alpha = this.hot && !reduced ? 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 5)) : 1;
    if (!reduced) {
      for (const sp of this.flowers.values()) sp.rotation = 0.08 * Math.sin(t * 0.9 + (sp as Sprite & { sway: number }).sway);
    }

    for (let i = this.live.length - 1; i >= 0; i--) {
      const q = this.live[i];
      q.age += dt;
      const k = q.age / q.life;
      if (k >= 1) {
        q.sprite.visible = false;
        this.fx.removeChild(q.sprite);
        this.pool.push(q.sprite);
        this.live.splice(i, 1);
        continue;
      }
      q.sprite.x += (q.vx * dt) / 1000;
      q.sprite.y += (q.vy * dt) / 1000;
      q.sprite.alpha = 1 - k;
      q.sprite.width = q.sprite.height = q.size * (1 - 0.4 * k);
    }
    for (let i = this.caps.length - 1; i >= 0; i--) {
      const c = this.caps[i];
      c.age += dt;
      c.gfx.scale.set(0.2 + 0.8 * easeOut(c.age / 320));
      if (c.age > 700) c.gfx.alpha = Math.max(0, 1 - (c.age - 700) / 300);
      if (c.age > 1000) {
        this.fx.removeChild(c.gfx);
        c.gfx.destroy();
        this.caps.splice(i, 1);
      }
    }
  }
}
