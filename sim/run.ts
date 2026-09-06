/**
 * Batch runner. Plays many rounds headlessly and reports whether the board is
 * a game or a lottery.
 *
 * The number that matters is the win rate of `bore` — the bot that steps inward
 * every cooldown and thinks about nothing. If it wins its uniform share, then
 * skill is not expressed and the design needs changing, not shipping.
 *
 *   node sim/run.ts --rounds 500 --bees 50
 */

import { chooseAction, STRATEGIES } from "../frontend/src/game/bots.ts";
import {
  type Bee,
  type Rules,
  DEFAULT_RULES,
  apply,
  makeGeometry,
  makeRound,
  mulberry32,
  progress,
  ringOf,
} from "../frontend/src/game/rules.ts";

const TICK_MS = 100;

interface Arg {
  rounds: number;
  bees: number;
  cooldown: number;
  digCost: number;
  collapseCost: number;
  flowers: number;
  ringWall: number;
  meadow: number;
  sabotage: number;
  digDelay: number;
  collapseTicks: number;
  cellW: number;
  stagger: number;
  hard: number;
  seed: number;
}

function args(): Arg {
  const a = process.argv.slice(2);
  const num = (k: string, d: number) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 && a[i + 1] ? Number(a[i + 1]) : d;
  };
  return {
    rounds: num("rounds", 400),
    bees: num("bees", 50),
    cooldown: num("cooldown", 20),
    digCost: num("dig", 3),
    collapseCost: num("collapse", 8),
    flowers: num("flowers", 24),
    ringWall: num("wall", 13),
    meadow: num("meadow", 4),
    sabotage: num("sabotage", 0.25),
    digDelay: num("digdelay", 40),
    collapseTicks: num("collapseticks", 0),
    cellW: num("cellw", 1.4),
    stagger: num("stagger", 0),
    hard: num("hard", 0.08),
    seed: num("seed", 1),
  };
}

interface RoundResult {
  ticks: number;
  winner: string;
  decided: boolean;
  moves: number;
  meadowMoves: number;
  collapses: number;
  firstCollapseTick: number;
  spendByStrategy: Map<string, number>;
  winnerSpend: number;
  meadowTicks: number;
  winnerMeadowShare: number;
  turnSwitches: number;
  netTurn: number;
  tunnelMoves: number;
}

function playOne(cfg: Arg, seed: number): RoundResult {
  const rng = mulberry32(seed);
  const rules: Rules = {
    ...DEFAULT_RULES,
    cooldownTicks: cfg.cooldown,
    digDelayTicks: cfg.digDelay,
    collapseTicks: cfg.collapseTicks,
    staggerRequired: cfg.stagger > 0,
    blockShare: cfg.hard,
    costs: { fly: 1, dig: cfg.digCost, collapse: cfg.collapseCost },
  };
  const g = makeGeometry(cfg.ringWall, cfg.meadow, cfg.cellW);
  const strategies = Array.from(
    { length: cfg.bees },
    (_, i) => STRATEGIES[i % STRATEGIES.length] as string,
  );
  const round = makeRound(strategies, rules, rng, g);

  let firstCollapseTick = -1;
  let collapses = 0;
  // When the last bee left the meadow — the share of a round spent on the half
  // with the fewest decisions in it.
  let meadowTicks = 0;

  while (round.tick < rules.maxTicks && round.winner < 0) {
    const due = round.bees.filter((b) => b.phase !== "done" && b.nextMoveTick <= round.tick);
    // Shuffle, or index order becomes a standing advantage in every tie.
    for (let i = due.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [due[i], due[j]] = [due[j], due[i]];
    }
    for (const bee of due) {
      const before = bee.collapses;
      apply(round, bee, chooseAction(round, bee, { sabotageRate: cfg.sabotage }));
      if (bee.collapses > before) {
        collapses++;
        if (firstCollapseTick < 0) firstCollapseTick = round.tick;
      }
    }
    round.tick++;
  }

  // A round that hit the ceiling still has a winner: the bee nearest the queen.
  let winnerBee: Bee | undefined = round.bees.find((b) => b.id === round.winner);
  const decided = !!winnerBee;
  if (!winnerBee) {
    winnerBee = [...round.bees].sort(
      (x, y) => progress(round.board, x, rules) - progress(round.board, y, rules),
    )[0];
  }

  const spendByStrategy = new Map<string, number>();
  let moves = 0;
  let meadowMoves = 0;
  for (const b of round.bees) {
    spendByStrategy.set(b.strategy, (spendByStrategy.get(b.strategy) ?? 0) + b.spend);
    moves += b.moves;
    meadowMoves += b.meadowMoves;
  }

  const entered = round.bees.map((b) => b.enteredHiveTick).filter((t) => t >= 0).sort((a, b) => a - b);
  meadowTicks = entered.length ? entered[Math.floor(entered.length / 2)] : round.tick;

  return {
    ticks: round.tick,
    winner: winnerBee.strategy,
    decided,
    moves,
    meadowMoves,
    collapses,
    firstCollapseTick,
    spendByStrategy,
    winnerSpend: winnerBee.spend,
    meadowTicks,
    winnerMeadowShare: winnerBee.meadowMoves / Math.max(1, winnerBee.moves),
    turnSwitches: winnerBee.turnSwitches,
    netTurn: Math.abs(winnerBee.netTurn),
    tunnelMoves: winnerBee.moves - winnerBee.meadowMoves,
  };
}

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))];
}

function main() {
  const cfg = args();
  const perStrategy = cfg.bees / STRATEGIES.length;
  const results: RoundResult[] = [];
  const t0 = Date.now();
  for (let i = 0; i < cfg.rounds; i++) results.push(playOne(cfg, cfg.seed + i * 7919));
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const wins = new Map<string, number>();
  for (const s of STRATEGIES) wins.set(s, 0);
  for (const r of results) wins.set(r.winner, (wins.get(r.winner) ?? 0) + 1);

  const durations = results.map((r) => (r.ticks * TICK_MS) / 1000);
  const decided = results.filter((r) => r.decided).length;
  const meadowShare = results.reduce((a, r) => a + r.meadowMoves / Math.max(1, r.moves), 0) / results.length;
  const meadowTimeShare = results.reduce((a, r) => a + r.meadowTicks / Math.max(1, r.ticks), 0) / results.length;
  const winnerMeadow = results.reduce((a, r) => a + r.winnerMeadowShare, 0) / results.length;
  const collapses = results.reduce((a, r) => a + r.collapses, 0) / results.length;
  const withCollapse = results.filter((r) => r.firstCollapseTick >= 0);
  const firstCollapseShare =
    withCollapse.reduce((a, r) => a + r.firstCollapseTick / Math.max(1, r.ticks), 0) /
    Math.max(1, withCollapse.length);

  const baseline = 100 / STRATEGIES.length;

  console.log(`\nThe Bee's Knees — ${cfg.rounds} rounds, ${cfg.bees} bees (${perStrategy} per strategy)`);
  console.log(
    `cooldown ${(cfg.cooldown * TICK_MS) / 1000}s · a dig also costs ${(cfg.digDelay / cfg.cooldown).toFixed(1)} extra cooldowns · wall ${cfg.ringWall} · cellW ${cfg.cellW} · stagger ${cfg.stagger ? 'ON' : 'off'} · blocked ${(cfg.hard*100).toFixed(0)}% · ${makeGeometry(cfg.ringWall, cfg.meadow, cfg.cellW).cells} cells · ${elapsed}s\n`,
  );

  console.log("WIN RATE            share   vs uniform   mean spend");
  const rows = [...wins.entries()].sort((a, b) => b[1] - a[1]);
  for (const [s, w] of rows) {
    const share = (w / cfg.rounds) * 100;
    const lift = share / baseline;
    const spend =
      results.reduce((a, r) => a + (r.spendByStrategy.get(s) ?? 0), 0) /
      (cfg.rounds * perStrategy);
    const bar = "█".repeat(Math.round(share / 2)).padEnd(26);
    console.log(
      `  ${s.padEnd(10)} ${share.toFixed(1).padStart(5)}%  ${lift.toFixed(2)}x   ${spend.toFixed(0).padStart(6)}   ${bar}`,
    );
  }
  console.log(`  ${"(uniform)".padEnd(10)} ${baseline.toFixed(1).padStart(5)}%\n`);

  console.log("ROUND LENGTH");
  console.log(
    `  p10 ${pct(durations, 10).toFixed(0)}s · median ${pct(durations, 50).toFixed(0)}s · p90 ${pct(durations, 90).toFixed(0)}s`,
  );
  console.log(
    `  reached the queen: ${((decided / cfg.rounds) * 100).toFixed(0)}%  (the rest hit the ceiling)\n`,
  );

  console.log("WHERE THE ROUND GOES");
  console.log(`  meadow share of the winner's moves: ${(winnerMeadow * 100).toFixed(0)}%`);
  console.log(`  median bee is inside the wall by:    ${(meadowTimeShare * 100).toFixed(0)}% of the round\n`);

  const sw = results.reduce((a, r) => a + r.turnSwitches, 0) / results.length;
  const net = results.reduce((a, r) => a + r.netTurn, 0) / results.length;
  const tun = results.reduce((a, r) => a + r.tunnelMoves, 0) / results.length;
  console.log("THE WINNER'S PATH THROUGH THE COMB");
  console.log(`  moves inside the hive:   ${tun.toFixed(0)}`);
  console.log(`  reversals of direction:  ${sw.toFixed(1)}  ` +
    (sw < 1 ? "— A PURE SPIRAL, it never turns back" : "— it genuinely changes its mind"));
  console.log(`  net cells travelled round: ${net.toFixed(1)}` +
    (net > tun * 0.6 ? "  (mostly going round, not in)" : "") + "\n");

  console.log("COLLAPSE");
  console.log(`  per round: ${collapses.toFixed(1)}`);
  console.log(
    `  first one lands at ${(firstCollapseShare * 100).toFixed(0)}% through the round` +
      ` (${withCollapse.length}/${cfg.rounds} rounds saw one)\n`,
  );

  // Two different questions, and conflating them flatters the design.
  // `random` is incompetence: if it ever wins, the board is noise. `bore` is a
  // PERFECTLY REASONABLE heuristic — head for the goal — so beating it is what
  // "skill is rewarded" actually means, and it is the harder bar by far.
  const boreShare = ((wins.get("bore") ?? 0) / cfg.rounds) * 100;
  const randomShare = ((wins.get("random") ?? 0) / cfg.rounds) * 100;
  const best = rows[0];
  const bestShare = (best[1] / cfg.rounds) * 100;

  console.log("VERDICT");
  console.log(
    `  punishes bad play:   random wins ${randomShare.toFixed(1)}%  ` +
      (randomShare < 2 ? "— yes" : "— NO, the board is noise"),
  );
  console.log(
    `  rewards good play:   ${best[0]} ${bestShare.toFixed(1)}% vs bore ${boreShare.toFixed(1)}%  ` +
      `(${(bestShare / Math.max(0.1, boreShare)).toFixed(2)}x over a decent heuristic, ` +
      `${(bestShare / baseline).toFixed(2)}x over uniform)`,
  );
  console.log(
    `  ${bestShare / baseline >= 1.8 ? "SKILL SHOWS" : "SKILL IS THIN — a good player barely out-runs an adequate one"}\n`,
  );
}

main();
