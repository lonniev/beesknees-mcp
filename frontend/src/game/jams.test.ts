/**
 * A body in the way is a jam, not a wall. The player's bee never pays a fare
 * to step back from one, and it goes round only when going round is cheaper
 * than the wait.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { heldUp, routeToward, stepToward } from "./bots.ts";
import { DEFAULT_RULES, OPEN, idx, inward, makeGeometry, makeRound, mulberry32, neighbors, ringOf, type Phase } from "./rules.ts";

/** A round with a straight open shaft from the wall to the queen along slot 0 of each ring. */
function shaftRound(seed = 5) {
  const round = makeRound(["rider", "rider", "rider"], DEFAULT_RULES, mulberry32(seed), makeGeometry());
  const g = round.board.g;
  const shaft: number[] = [];
  let cell = idx(g, g.R, 0);
  for (let r = g.R; r > 0; r--) {
    round.board.state[cell] = OPEN;
    round.board.blocked[cell] = 0;
    shaft.push(cell);
    const i = cell - g.offset[r];
    cell = inward(g, r, i)!;
  }
  for (const b of round.bees) b.phase = "tunnel" as Phase;
  return { round, g, shaft };
}

test("a bee behind a rival in its shaft waits rather than stepping back", () => {
  const { round, shaft } = shaftRound();
  const [me, rival] = round.bees;
  me.cell = shaft[3];
  me.cameInward = false;
  rival.cell = shaft[4]; // one cell inward, in the way
  round.bees[2].cell = shaft[0];
  const step = stepToward(round, me, 0);
  // Either it waits, or it steps somewhere strictly nearer — never outward.
  if (step) {
    assert.ok(step.kind !== "wait" && step.kind !== "collapse");
    const to = (step as { to: number }).to;
    assert.ok(ringOf(round.board.g, to) <= ringOf(round.board.g, me.cell), "never a step back out");
    assert.notEqual(to, shaft[2], "and never the cell it just came down");
  }
  assert.ok(heldUp(round, me, 0), "the hint can say a body is the reason");
});

test("one body in a shaft walled by comb is waited out — cutting round costs more", () => {
  const { round, shaft } = shaftRound();
  const [me, r1, r2] = round.bees;
  me.cell = shaft[3];
  me.cameInward = false;
  r1.cell = shaft[4];
  r2.cell = shaft[0];
  assert.equal(stepToward(round, me, 0), null);
});

test("two bodies in the lane, with an open lane beside: go round, and the drawn route agrees", () => {
  const { round, g, shaft } = shaftRound();
  const [me, r1, r2] = round.bees;
  const open = (c: number) => { round.board.state[c] = OPEN; round.board.blocked[c] = 0; };
  // A wedge of open comb four slots wide, wall to queen.
  for (let r = g.R; r > 0; r--) for (let i = 0; i < Math.min(4, g.size[r]); i++) open(idx(g, r, i));
  me.cell = shaft[3];
  me.cameInward = false;
  me.prevCell = shaft[2];
  r1.cell = shaft[4];
  r2.cell = shaft[5];
  const step = stepToward(round, me, 0);
  assert.ok(step, "there is a way round");
  const to = (step as { to: number }).to;
  assert.ok(neighbors(g, me.cell).includes(to));
  assert.notEqual(to, shaft[2], "never the cell it came from");
  assert.ok(ringOf(g, to) <= ringOf(g, me.cell), "never outward");
  assert.equal(routeToward(round, me, 0)[0], to, "the route the player sees is the route the bee takes");
});
