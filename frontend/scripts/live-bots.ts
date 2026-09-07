/**
 * Field a hive of bots against the LIVE server, over MCP, as ordinary patrons.
 *
 * Not a simulation: each bot is a real npub with its own key, joining the real
 * match, paying the real fare and having its moves accepted or refused by the
 * real fenced writes. It is the only way to exercise the things the local suite
 * cannot — that the CTEs are valid PostgreSQL, that two bees racing for a cell
 * over the wire really do produce one winner, and what a tap-to-move round trip
 * actually costs against a one-second cooldown.
 *
 * It plays with the SAME `chooseAction` the solo bots use, reading a board
 * hydrated from `match_state`. So a bot here is exactly as good as a bot there,
 * and no better: it has no privileged view and waits out the same cooldown.
 *
 *   npm run live-bots -- --bots 7 --strategies digger,rider,sealer
 *
 * Keys are minted fresh each run and printed. They are throwaway identities for
 * a test; anything they win is won by a key that exists only in this process.
 */

import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { chooseAction } from "../src/game/bots.ts";
import { hydrate, hiveSeed } from "../src/game/live.ts";
import {
  DEFAULT_RULES,
  makeGeometry,
  type Action,
  type Bee,
  type Phase,
} from "../src/game/rules.ts";

const URL = process.env.BK_URL ?? "https://beesknees.tollbooth-dpyc.com/mcp";
const G = makeGeometry();

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const COUNT = Number(arg("bots", "7"));
const STRATS = arg("strategies", "digger,rider,sealer,bore").split(",");
const LABEL = arg("label", "swarm");

interface Bot {
  sk: Uint8Array;
  npub: string;
  strategy: string;
  hive: number;
  seat: number;
  label: string;
}

/** A fresh kind-27235 proof per call, scoped to the tool. What the wheel wants. */
function proof(sk: Uint8Array, tool: string): string {
  return JSON.stringify(
    finalizeEvent(
      { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [["u", `beesknees_${tool}`]], content: "" },
      sk,
    ),
  );
}

let calls = 0;
let totalMs = 0;
let slowest = 0;

async function call(bot: Bot | null, tool: string, args: Record<string, unknown> = {}) {
  const id = { npub: bot?.npub, dpop_token: bot ? proof(bot.sk, tool) : undefined };
  const t0 = Date.now();
  const r = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: `beesknees_${tool}`, arguments: { ...id, ...args } },
    }),
  });
  const text = await r.text();
  const ms = Date.now() - t0;
  calls++;
  totalMs += ms;
  slowest = Math.max(slowest, ms);
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const d = JSON.parse(line.slice(6));
    const sc = d.result?.structuredContent;
    if (sc) return { ...sc, _ms: ms };
    const t = d.result?.content?.[0]?.text ?? JSON.stringify(d.error ?? d.result);
    if (process.env.BK_RAW) console.log(`    RAW ${tool}: ${JSON.stringify(d).slice(0, 700)}`);
    try {
      return { ...JSON.parse(t), _ms: ms };
    } catch {
      return { raw: t, _ms: ms };
    }
  }
  return { raw: text.slice(0, 200), _ms: ms };
}

/** The server's thin bee, widened to what the rules module reasons about. */
function asBee(b: Record<string, unknown>): Bee {
  return {
    id: Number(b.seat),
    strategy: "human",
    cell: Number(b.cell),
    prevCell: -1,
    // The server tracks this; without it the client would offer moves the
    // stagger forbids and every one of them would come back refused.
    cameInward: Boolean(b.came_inward),
    lastAction: null,
    netTurn: 0,
    turnSwitches: 0,
    lastTurn: 0,
    phase: (b.phase as Phase) ?? "forage",
    nextMoveTick: 0,
    spend: 0,
    moves: Number(b.moves ?? 0),
    meadowMoves: 0,
    digs: Number(b.digs ?? 0),
    collapses: Number(b.seals ?? 0),
    collapsedOn: 0,
    lastDelayTicks: 0,
    enteredHiveTick: -1,
    finishedTick: -1,
  };
}

async function main() {
  const bots: Bot[] = [];
  console.log(`Minting ${COUNT} bees and taking seats…`);
  for (let i = 0; i < COUNT; i++) {
    const sk = generateSecretKey();
    const npub = nip19.npubEncode(getPublicKey(sk));
    const strategy = STRATS[i % STRATS.length];
    const bot: Bot = { sk, npub, strategy, hive: -1, seat: -1, label: `${LABEL}-${strategy}-${i}` };
    const r = (await call(bot, "join_match", { label: bot.label })) as Record<string, unknown>;
    if (r.success === false || r.error) {
      console.log(`  ${bot.label}: refused — ${r.error ?? r.reason}`);
      continue;
    }
    bot.hive = Number(r.hive);
    bot.seat = Number(r.seat);
    bots.push(bot);
    console.log(`  ${bot.label.padEnd(22)} hive ${bot.hive} seat ${bot.seat}  ${npub.slice(0, 14)}…`);
  }
  if (!bots.length) return console.log("no seats taken — nothing to drive");

  console.log(`\n${bots.length} bees seated. Playing until the round ends.\n`);
  const rules = DEFAULT_RULES;
  let lastState = "";

  for (let tick = 0; ; tick++) {
    const live = (await call(bots[0], "match_state", { since_seq: -1 })) as Record<string, unknown>;
    if (live.error || live.success === false) {
      console.log("match_state:", live.error ?? live.raw);
      await sleep(2000);
      continue;
    }
    const state = String(live.state);
    if (state !== lastState) {
      const per = new Map<number, number>();
      for (const b of live.bees as Record<string, unknown>[])
        per.set(Number(b.hive), (per.get(Number(b.hive)) ?? 0) + 1);
      console.log(`[${state}] ${(live.bees as unknown[]).length} bees · per hive ${[...per.entries()].map(([h, n]) => `${h}:${n}`).join(" ")}`);
      lastState = state;
    }
    if (state === "ended" || state === "settled") {
      console.log(`\nRound over. winner_npub=${live.winner_npub || "(none)"}`);
      break;
    }
    if (state !== "running") {
      // Somebody has to ask. `advance()` runs on a join and on every motion,
      // and a lobby full of waiting bees makes neither.
      await call(bots[0], "check_now");
      await sleep(2500);
      continue;
    }

    const hives = hydrate(live as never, G);
    const all = live.bees as Record<string, unknown>[];

    for (const bot of bots) {
      const mine = all.find((b) => b.npub === bot.npub);
      if (!mine || mine.phase === "done") continue;
      const due = !mine.next_move_at || Date.parse(String(mine.next_move_at)) <= Date.now();
      if (!due) continue;

      const board = hives[bot.hive].board;
      const round = {
        board,
        bees: hives[bot.hive].bees.map(asBee),
        rules,
        tick: 0,
        winner: -1,
        rng: Math.random,
      };
      const bee = asBee(mine);
      bee.strategy = bot.strategy;
      const a = chooseAction(round as never, bee) as Action;
      if (a.kind === "wait") continue;

      const res =
        a.kind === "collapse"
          ? await call(bot, "seal", { at_cell: a.at })
          : board.state[a.to] === 0
            ? await call(bot, "dig", { to_cell: a.to })
            : await call(bot, "fly", { to_cell: a.to });
      const r = res as Record<string, unknown>;
      if (r.error) console.log(`  ${bot.label}: ${String(r.error).slice(0, 90)}`);
      else if (r.refused) console.log(`  ${bot.label}: refused — ${r.refused}`);
      else if (r.moved === false) console.log(`  ${bot.label}: lost the race — ${r.reason}`);
      else if (r.pollen === true) console.log(`  ${bot.label}: took pollen at ${a.kind === "collapse" ? a.at : a.to}`);
    }

    if (tick % 20 === 0 && calls)
      console.log(`  … ${calls} calls · mean ${(totalMs / calls).toFixed(0)}ms · slowest ${slowest}ms`);
    await sleep(400);
  }

  console.log(`\nround trips: ${calls} · mean ${(totalMs / calls).toFixed(0)}ms · slowest ${slowest}ms`);
  console.log(`A one-second cooldown needs the mean comfortably under 1000ms.`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
main().catch((e) => console.error(e));
