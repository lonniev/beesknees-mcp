/**
 * What `bots.ts` decides, for a spread of boards, as plain lines.
 *
 * `sim_bees.py` is a PORT of this file — the sim bees that fill a thin hive have
 * to be the same opponents as the ones the simulation was tuned against, or the
 * live game is not the game that was measured. Two implementations of one set of
 * decisions drift silently; this is what `tests/test_sim_bees.py` diffs them with.
 *
 * Only states a bee can actually be in: tunnelling means inside the hive,
 * foraging and returning mean out in the meadow.
 */
import { makeGeometry, hiveLayout, makeBoard, OPEN, COMB, DEFAULT_RULES, mulberry32, neighbors, ringOf, isHive, type Phase } from "../src/game/rules.ts";
import { chooseAction } from "../src/game/bots.ts";

const g = makeGeometry();
const out: string[] = [];
for (let seed = 1; seed <= 6; seed++) {
  const layout = hiveLayout(g, seed);
  const board = makeBoard(g, { mouths: 4, layout });
  // Cut a plausible shaft so the tunnel phase has something to reason about.
  for (let r = g.R - 1; r > g.R - 6; r--) board.state[(g.offset[r] ?? 0) + 2] = OPEN;
  board.version++;
  for (const strategy of ["digger", "rider", "bore"]) {
    for (const phase of ["forage", "return", "tunnel"] as Phase[]) {
      // Only states a bee can actually be in: tunnelling means inside the
      // hive, foraging and returning mean out in the meadow.
      const cells = phase === "tunnel"
        ? [g.offset[g.R] + 2, g.offset[g.R - 3] + 2]
        : [layout.starts[0], layout.starts[3]];
      for (const cell of cells) {
        for (const armed of [false, true]) {
          const bee = { id: 0, strategy, cell, prevCell: -1, cameInward: armed, lastAction: null,
            netTurn: 0, turnSwitches: 0, lastTurn: 0, phase, nextMoveTick: 0, spend: 0, moves: 0,
            meadowMoves: 0, digs: 0, collapses: 0, collapsedOn: 0, lastDelayTicks: 0,
            enteredHiveTick: -1, finishedTick: -1 };
          const round = { board, bees: [bee], rules: DEFAULT_RULES, tick: 0, winner: -1, rng: mulberry32(7) };
          const a = chooseAction(round as never, bee as never);
          const to = a.kind === "collapse" ? a.at : a.kind === "wait" ? -1 : a.to;
          out.push(`${seed}|${strategy}|${phase}|${cell}|${armed ? 1 : 0}|${a.kind}|${to}`);
        }
      }
    }
  }
}
console.log(out.join("\n"));
void [COMB, neighbors, ringOf, isHive];
