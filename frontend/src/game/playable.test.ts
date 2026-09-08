/**
 * The claim the About page makes, checked rather than remembered.
 *
 * A board can obey every rule it was given and still be a lottery, and you
 * cannot tell by playing it — a handful of rounds looks the same either way.
 * The batch runner in `sim/` is how that was settled before any of this was
 * monetised, and this is the small, seeded version of it that runs on every
 * commit, so a rule change that flattens the skill gap fails here rather than
 * being discovered by a player.
 *
 * Deliberately loose. It is not pinning today's exact win rate — that would
 * fail on any honest tuning change and teach everybody to delete it. It pins
 * the two things that must never stop being true: that judgement beats a
 * heuristic, and that flailing wins nothing.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { args, playOne } from "../../../sim/run.ts";

test("skill still beats a coin, on the rules as shipped", () => {
  // Every default is read from the shipped board by `args()`; no flags, so
  // this is the game as it actually is. Seeded, so it cannot flake.
  const cfg = { ...args(), rounds: 120 };
  const wins = new Map<string, number>();
  let decided = 0;

  for (let i = 0; i < cfg.rounds; i++) {
    const r = playOne(cfg, 1000 + i);
    if (!r.decided) continue;
    decided++;
    wins.set(r.winner, (wins.get(r.winner) ?? 0) + 1);
  }

  assert.ok(decided > cfg.rounds * 0.9, `only ${decided}/${cfg.rounds} rounds reached a queen`);

  const share = (s: string) => (wins.get(s) ?? 0) / decided;
  const digger = share("digger");
  const bore = share("bore");
  const random = share("random");

  // Judgement over a decent heuristic. The measured gap is around 2.4x; the
  // floor is set well under it so a real tuning change can move without
  // breaking the build, and a COLLAPSE of the gap still cannot pass.
  assert.ok(
    digger > bore * 1.5,
    `digger ${(digger * 100).toFixed(1)}% vs bore ${(bore * 100).toFixed(1)}% — the skill gap has gone`,
  );

  // And flailing must stay worthless. A random bee winning an appreciable
  // share means position, not play, is deciding the round.
  assert.ok(
    random < 0.05,
    `random wins ${(random * 100).toFixed(1)}% — the board has become a lottery`,
  );
});

test("the figures the About page quotes are the ones the rules recorded", () => {
  // Two of the page's claims come from measurements written down beside the
  // rules they caused. Quoting a number into prose is how it goes stale, so
  // the page is checked against the source rather than against my memory of it.
  const rules = readFileSync(fileURLToPath(new URL("./rules.ts", import.meta.url)), "utf8");
  const about = readFileSync(
    fileURLToPath(new URL("../pages/About.tsx", import.meta.url)),
    "utf8",
  );

  for (const figure of ["1,218", "52.6%", "80%"]) {
    assert.ok(rules.includes(figure), `${figure} is no longer recorded in rules.ts`);
    assert.ok(about.includes(figure), `About.tsx quotes a figure rules.ts no longer records`);
  }
});
