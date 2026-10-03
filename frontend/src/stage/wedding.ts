/**
 * The wedding — what the race was actually for, drawn on the board.
 *
 * A bee crosses a meadow, carries pollen home through a door somebody else is
 * standing in, and cuts thirty cells of comb to reach the queen. The reward
 * used to be two CSS rings and some emoji flecks over the hive, then a card.
 * This is a parade: the queen rises from her chamber, crowned and bigger than
 * any bee; the consort comes to her flank wearing his; the two fly a royal
 * circuit out to the wall and back, trailing gold and petals, with the hive
 * falling in behind in train; the comb dims to a spotlight as they retire,
 * the court settles in a ring around them, and the brood is laid cell by cell
 * in the two rings around the chamber. About seven seconds, in the stage's
 * own units, so it lands on the wall on every screen.
 *
 * Yours gets a lap and a half in gold; a rival's one lap in red — it is still
 * the end of the race, but it is not your wedding. Reduced motion skips to
 * the final tableau.
 */

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { Geometry } from "../game/rules.ts";
import { VIEW, cellArc, cellCentre, ringRadius } from "../lib/polar.ts";
import { easeOut } from "../lib/stageMath.ts";
import { drawCell } from "./draw.ts";
import type { Palette } from "./palette.ts";

const TAU = Math.PI * 2;

/** The bees on the board, as the wedding needs to move them. */
export interface Dancer {
  id: number;
  cell: number;
  x: number;
  y: number;
  heading: number;
  sprite: Sprite;
  crown: Sprite;
}

export interface WeddingTextures {
  beeUp: Texture;
  beeDown: Texture;
  crown: Texture;
  glow: Texture;
  grain: Texture;
  full: Texture;
}

/** How to leave a particle in the queen's wake. */
export type Spawn = (texture: Texture, x: number, y: number, size: number, vx: number, vy: number, life: number, tint: number) => void;

interface Cell {
  gfx: Graphics;
  arc: ReturnType<typeof cellArc>;
}

const RISE = 0.9;
const PARADE = 4.5;
const BROOD_AT = RISE + PARADE;

export class Wedding {
  readonly layer = new Container();
  readonly yours: boolean;
  readonly winnerId: number;
  /** Where the consort is drawn — your halo rides here when it is you. */
  consortAt: [number, number] = [0, 0];

  private t0: number;
  private readonly g: Geometry;
  private readonly P: Palette;
  private readonly tex: WeddingTextures;
  private readonly queen: Sprite;
  private readonly qCrown: Sprite;
  private readonly consort: Sprite;
  private readonly cCrown: Sprite;
  private readonly attendants: Dancer[];
  private readonly waves: Graphics[];
  private readonly eggs: Cell[];
  private readonly spot: Graphics;
  private readonly glow: Sprite;
  private readonly laps: number;
  private readonly start: number;
  private readonly spawn: Spawn;
  private readonly reduced: boolean;

  constructor(opts: {
    g: Geometry;
    palette: Palette;
    tex: WeddingTextures;
    winner: Dancer;
    others: Dancer[];
    yours: boolean;
    spawn: Spawn;
    reduced: boolean;
    now: number;
  }) {
    const { g, palette: P, tex } = opts;
    this.g = g;
    this.P = P;
    this.tex = tex;
    this.yours = opts.yours;
    this.winnerId = opts.winner.id;
    this.spawn = opts.spawn;
    this.reduced = opts.reduced;
    // Reduced motion: begin at the end.
    this.t0 = opts.reduced ? opts.now - (BROOD_AT + 10) * 1000 : opts.now;

    this.queen = new Sprite(tex.beeUp);
    this.queen.anchor.set(0.5);
    this.qCrown = new Sprite(tex.crown);
    this.qCrown.anchor.set(0.5);
    this.qCrown.width = this.qCrown.height = 9;
    this.consort = new Sprite(tex.beeUp);
    this.consort.anchor.set(0.5);
    this.consort.width = this.consort.height = 12;
    this.cCrown = new Sprite(tex.crown);
    this.cCrown.anchor.set(0.5);
    this.cCrown.width = this.cCrown.height = 7;
    // The winner's own sprite steps aside; the consort is drawn here.
    opts.winner.sprite.visible = false;
    opts.winner.crown.visible = false;
    this.attendants = opts.others.slice(0, 8);
    this.waves = [0, 1, 2].map(() => new Graphics());
    this.eggs = [];
    for (const r of [1, 2]) {
      for (let i = 0; i < g.size[r]; i++) {
        const c = g.offset[r] + i;
        const arc = cellArc(g, c);
        const gfx = new Graphics();
        gfx.visible = false;
        this.eggs.push({ gfx, arc });
      }
    }
    this.spot = new Graphics();
    this.spot.circle(0, 0, VIEW * 1.5).fill({ color: 0x000000, alpha: 0.55 });
    this.spot.circle(0, 0, ringRadius(g, 4)).cut();
    this.spot.alpha = 0;
    this.glow = new Sprite(tex.glow);
    this.glow.anchor.set(0.5);
    this.glow.width = this.glow.height = ringRadius(g, 1) * 10;
    this.glow.tint = 0xffd77a;
    this.glow.alpha = 0;
    this.laps = opts.yours ? 1.5 : 1;
    this.start = Math.atan2(opts.winner.y, opts.winner.x) || -Math.PI / 2;
    this.layer.addChild(...this.waves, this.spot, this.glow, ...this.eggs.map((e) => e.gfx), this.consort, this.cCrown, this.queen, this.qCrown);
  }

  /** Is this bee in the parade — moved by the wedding rather than by the game? */
  owns(id: number): boolean {
    return id === this.winnerId || this.attendants.some((a) => a.id === id);
  }

  destroy(): void {
    this.layer.destroy({ children: true });
  }

  /** The royal circuit: out from the chamber to just inside the wall and back, turning as it goes. */
  private circuit(k: number): [number, number, number] {
    const q1 = ringRadius(this.g, 1);
    const wall = ringRadius(this.g, this.g.R + 1);
    const r = q1 + (wall - q1 - 6) * Math.sin(Math.PI * k);
    const a = this.start + TAU * this.laps * k;
    return [r * Math.cos(a), r * Math.sin(a), a + Math.PI / 2 + (k < 0.5 ? 0.6 : -0.6)];
  }

  /** A crown sits on the HEAD: forward along the heading, turned with it. */
  private crownOn(crown: Sprite, x: number, y: number, h: number, size: number): void {
    crown.position.set(x + Math.cos(h) * size * 0.42, y + Math.sin(h) * size * 0.42);
    crown.rotation = h + Math.PI / 2;
  }

  tick(now: number): void {
    const { g, P, tex } = this;
    const t = (now - this.t0) / 1000;
    const flap = ((t * 24) | 0) % 2 ? tex.beeUp : tex.beeDown;
    const q1 = ringRadius(g, 1);

    // The crowning: waves out of the chamber as the queen rises.
    this.waves.forEach((wv, i) => {
      const k = Math.min(1, Math.max(0, (t - i * 0.25) / 1.4));
      wv.clear();
      if (k > 0 && k < 1) {
        const r = q1 + (ringRadius(g, g.R + 1) + 8 - q1) * easeOut(k);
        wv.circle(0, 0, r).stroke({ width: 2.2, color: this.yours ? P.wax : P.hot, alpha: (1 - k) * 0.9 });
        if (i === 0) wv.circle(0, 0, r).fill({ color: 0xffcd5a, alpha: (1 - k) * 0.22 });
      }
    });
    this.glow.alpha = 0.35 + 0.25 * Math.sin(t * 4);

    const place = (sp: Sprite, crown: Sprite, k: number, size: number) => {
      const [x, y, h] = this.circuit(k);
      const bob = this.reduced ? 0 : 0.3 * Math.sin(t * 9 + size);
      sp.position.set(x, y + bob);
      sp.rotation = h;
      sp.texture = flap;
      this.crownOn(crown, x, y + bob, h, size);
      return [x, y + bob] as [number, number];
    };

    if (t < RISE) {
      const rise = easeOut(t / RISE);
      const sz = 18 * (0.2 + 0.8 * rise);
      this.queen.width = this.queen.height = sz;
      this.queen.position.set(0, 0);
      this.queen.rotation = -Math.PI / 2;
      this.crownOn(this.qCrown, 0, 0, -Math.PI / 2, sz);
      this.qCrown.alpha = rise;
      const [wx, wy] = this.circuit(0);
      const ch = Math.atan2(-wy, -wx);
      this.consort.position.set(wx, wy);
      this.consort.rotation = ch;
      this.crownOn(this.cCrown, wx, wy, ch, 12);
      this.consortAt = [wx, wy];
    } else {
      const kq = Math.min(1, (t - RISE) / PARADE);
      this.queen.width = this.queen.height = 18;
      place(this.queen, this.qCrown, kq, 18);
      this.consortAt = place(this.consort, this.cCrown, Math.max(0, kq - 0.035), 12);
      // The hive in train, then a court in a ring around the chamber, facing in.
      this.attendants.forEach((a, i) => {
        const ka = kq - 0.07 - i * 0.045;
        if (ka > 0 && ka < 1) {
          const [x, y, h] = this.circuit(ka);
          a.x = x;
          a.y = y;
          a.heading = h;
        } else if (ka >= 1) {
          const seat = (i / this.attendants.length) * TAU + this.start;
          const rr = ringRadius(g, 3) + 1.5;
          const f = Math.min(1, (ka - 1) / 0.08);
          a.x += (rr * Math.cos(seat) - a.x) * f;
          a.y += (rr * Math.sin(seat) - a.y) * f;
          a.heading = Math.atan2(-a.y, -a.x);
        }
        a.sprite.position.set(a.x, a.y);
        a.sprite.rotation = a.heading;
        if (ka > 0 && ka < 1) a.sprite.texture = flap;
      });
      // Petals and gold in her wake.
      if (kq < 1 && !this.reduced) {
        const [x, y] = this.circuit(kq);
        this.spawn(tex.grain, x + (Math.random() - 0.5) * 3, y + (Math.random() - 0.5) * 3, 1.4 + Math.random(), (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 900, 0xfff1a8);
        if (Math.random() < 0.35) this.spawn(tex.full, x, y, 2.6, (Math.random() - 0.5) * 4, 1 + Math.random() * 2, 1400, 0xffd1e8);
      }
    }

    // The brood, laid one cell at a time around the chamber, under a spotlight.
    this.spot.alpha = Math.min(1, Math.max(0, (t - BROOD_AT + 0.6) / 0.8));
    this.eggs.forEach((e, i) => {
      const k = Math.min(1, Math.max(0, (t - BROOD_AT - i * 0.12) / 0.35));
      if (k <= 0) return;
      if (!e.gfx.visible) {
        e.gfx.visible = true;
        const gfx = e.gfx;
        drawCell(gfx, e.arc, 0.4).fill({ color: P.wax, alpha: 0.5 }).stroke({ width: 0.4, color: 0xffe08a, alpha: 0.95 });
        const centre = this.eggCentre(i);
        gfx.ellipse(centre[0], centre[1], 1.2, 1.9).fill({ color: 0xfff7d6, alpha: 0.95 });
      }
      e.gfx.alpha = easeOut(k);
    });
    if (t > BROOD_AT) {
      // Retired to the chamber: she at its heart, he at her side, both facing up the page.
      const bob = this.reduced ? 0 : 0.25 * Math.sin(t * 5);
      this.queen.position.set(-2.2, bob);
      this.queen.rotation = -Math.PI / 2;
      this.crownOn(this.qCrown, -2.2, bob, -Math.PI / 2, 18);
      this.consort.position.set(3.6, 1 + bob);
      this.consort.rotation = -Math.PI / 2;
      this.crownOn(this.cCrown, 3.6, 1 + bob, -Math.PI / 2, 12);
      this.consortAt = [3.6, 1 + bob];
      this.glow.alpha = 0.45 + 0.1 * Math.sin(t * 3);
    }
  }

  private eggCentre(i: number): [number, number] {
    const g = this.g;
    const c = i < g.size[1] ? g.offset[1] + i : g.offset[2] + (i - g.size[1]);
    return cellCentre(g, c);
  }
}
