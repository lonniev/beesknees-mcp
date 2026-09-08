/**
 * What this service is, and what it is doing right now.
 *
 * Figures come from the operator's own `service_status`, so this page reports
 * the running deployment rather than what the repository claims about it.
 *
 * Every word here that is jargon carries its own definition on a dotted
 * underline (see `lib/glossary`). The page has to say MCP, Nostr, satoshi and
 * serverless to be truthful, and each of them is a wall to somebody who came
 * for a game about bees.
 */

import { useEffect, useState } from "react";
import { annotate } from "../lib/glossary.tsx";
import { serviceStatus } from "../lib/mcp";

/** One paragraph, with the jargon in it explained. */
function P({ text, seen, className = "" }: { text: string; seen: Set<string>; className?: string }) {
  return <p className={`text-[15px] text-ink/90 ${className}`}>{annotate(text, seen)}</p>;
}

const PLAY = [
  "Your bee begins in the meadow outside the wall and has three things to do, in order: reach a " +
    "flower and take its pollen, carry that pollen home through one of the few doors in the hive " +
    "wall, and then cut its way inward through the comb until it reaches the queen. The first bee " +
    "to her takes the round.",
  "The meadow is open air and nearly free of decisions, which is deliberate: it spreads everyone " +
    "out before the part that matters. The wall is the first real constraint. It cannot be cut — " +
    "only the handful of doors get you in — so every bee in a hive converges on a few cells at " +
    "roughly the same moment, and a door that somebody is standing in is a door you are not " +
    "coming through. Once you are in with your pollen you are committed, and cannot step back out " +
    "into the meadow to try a different one.",
  "Inside, the comb is solid and the rings narrow as they approach her: the wall holds about " +
    "fifty cells and the last ring before the chamber holds six. The board therefore funnels. " +
    "Everyone starts spread around the outside and ends in the same scrum, which is where the " +
    "game actually happens.",
  "That is where the only real choice lives. Cutting fresh comb is slow and it opens the way for " +
    "everyone behind you — you pay for a shaft and your rivals ride it for nothing. Riding one " +
    "somebody else cut is fast and cheap, and they can bring it down on top of you: a sealed cell " +
    "sets you back several moves, and a bee has a body, so the one stuck behind it is a wall for " +
    "everybody behind them. Neither answer is right. Which one is right depends on where the " +
    "other bees are, and that is the judgement the round is asking you for.",
  "Two rules stop the obvious exploits. A bee may not move inward twice in a row, so nobody " +
    "simply drills a straight line to the middle; you make ground, then you make room. And a bee " +
    "acts once per cooldown, measured on the clock rather than on your balance, so no amount of " +
    "spending buys a faster bee. What spending buys is interference.",
];

const PROOF = [
  [
    "The board was tuned before the service existed",
    "The rules were written as a standalone simulation first and thrown at batches of four " +
      "hundred rounds, with bots playing to fixed strategies: one that cuts its own shaft, one " +
      "that rides other bees' work, one that seals, one that bores straight in, and one that " +
      "moves at random. If the strategies land near each other, there is no game — only a " +
      "lottery wearing a board.",
  ],
  [
    "Skill has to beat a coin, and it does",
    "On the shipped rules, the digger takes about 37% of rounds against a uniform share of 20% " +
      "— roughly 1.9 times its share, and about 2.4 times the straight-line borer's 16%. The " +
      "bee that moves at random wins nothing at all: not rarely, but zero times in four hundred " +
      "rounds. Good play is rewarded and bad play is punished, which is the whole test.",
  ],
  [
    "Two rules exist only because measurement demanded them",
    "The hive wall was cuttable at first, and 80% of bees simply chopped their own hole rather " +
      "than fly to a door — which made the doors decoration and removed the chokepoint the " +
      "middle of the game depends on. Separately, bees that had crossed a door kept stepping " +
      "back out: over 1,218 measured crossings, 52.6% did, every one of them already carrying " +
      "pollen with no business outside. Neither was visible by playing. Both were obvious in a " +
      "batch of four hundred.",
  ],
  [
    "The cohort size is a finding, not a preference",
    "Sixty bees racing to one queen is close to a lottery, because first past the post among " +
      "that many near-identical racers is an extreme-value draw, and those are decided by " +
      "variance. Five hives of twelve puts the judgement back: winning your own hive is " +
      "skill-weighted, and which of five leaders arrives first is an unbiased second stage that " +
      "does not erode the first.",
  ],
  [
    "A round ends, and ends in time",
    "Every round in the batch reaches a queen rather than stalling, and the median runs about " +
      "three and a quarter minutes. The winner's path inside the comb is 67 moves with 15 " +
      "reversals of direction — it genuinely changes its mind — and a collapse lands in 398 of " +
      "400 rounds. The mechanics are used, not merely available.",
  ],
  [
    "It is a build step, not a report",
    "The batch runner is in the repository and draws every default from the same rules module " +
      "the game plays by, so it cannot describe a board nobody plays. A short seeded version of " +
      "it runs with the tests: it does not pin today's exact win rate, which would fail on any " +
      "honest tuning, but it fails if judgement stops beating a heuristic or if a bee moving at " +
      "random starts winning.",
  ],
];

const TECH = [
  [
    "It is tools, not screens",
    "Every motion is a named tool call on an MCP server, so an agent plays it exactly as this " +
      "page does — same calls, same prices, same rules. The interface is one client among " +
      "several, not the game.",
  ],
  [
    "It can be played blind",
    "Nothing about a move requires seeing it. The board comes back as data — which cells are " +
      "open, where every bee stands, whose turn has come round — so a program with no screen " +
      "competes on equal terms. The simulated bees that fill a thin hive are exactly that.",
  ],
  [
    "The service remembers nothing",
    "It is stateless. Every board, bee and fare lives in serverless Postgres, and each request " +
      "reads it fresh, so two calls a second apart can land on two different machines and " +
      "neither can tell. Between rounds the whole thing costs nothing to keep running.",
  ],
  [
    "The state is shared, and contended",
    "Fifty bees writing to one board is the hard part. Every move is a single fenced statement " +
      "that either wins the cell or does not — no locks, no transaction, and no way for two " +
      "bees to occupy the same cell because both were told they could.",
  ],
  [
    "Your name is a key",
    "Identity is a Nostr npub, generated by you and proven by a signature. There is no account " +
      "to create, no password to lose, and no KYC — a key is enough to play.",
  ],
  [
    "Money is bitcoin, and it moves",
    "Fares are satoshis from a balance you top up in advance. The pot is split when a round " +
      "settles and paid over Lightning: to the beneficiary, and to a winner who chose to keep " +
      "their share rather than donate it.",
  ],
  [
    "The hives are kept warm on demand",
    "A scheduled service seats simulated bees when a hive is thin, so somebody who arrives " +
      "alone still gets a race. They hold their own keys, pay their own fares, and play through " +
      "the same public tools as anyone else — they are opponents, not scenery.",
  ],
];

export default function About() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  // One page, one pass: a term is marked the first time it appears and left
  // alone after that. Six dotted underlines of "MCP" reads as spam.
  const seen = new Set<string>();

  useEffect(() => {
    let alive = true;
    serviceStatus()
      .then((s) => alive && setStatus(s as Record<string, unknown>))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const rows: [string, string][] = status
    ? [
        ["Service", String(status.service ?? "—")],
        ["Version", String(status.version ?? "—")],
        ["Tollbooth SDK", String(status.tollbooth_dpyc_version ?? "—")],
        ["Persistence", status.vault_configured ? "configured" : "not configured"],
      ]
    : [];

  return (
    <div className="mx-auto max-w-2xl px-5 py-8 leading-relaxed">
      <h1 className="text-2xl font-semibold tracking-tight">About</h1>

      <P
        seen={seen}
        className="mt-4"
        text={
          "The Bee's Knees is an MCP service on the DPYC network. Every motion your bee makes " +
          "is a tool call priced by the operator, paid from a pre-funded balance in satoshis — " +
          "no accounts, no card, no interruption mid-match. Your identity is a Nostr key, not " +
          "an email address."
        }
      />

      <P
        seen={seen}
        className="mt-4"
        text={
          "Because it is an MCP service, an AI agent can play it as readily as a browser can. " +
          "The board, the rules and the clock all live on the server; a client only asks what " +
          "the board looks like and says what it wants to do next."
        }
      />

      <p className="mt-4 text-[13px] text-ink/65">
        Underlined words carry a short definition — hover one, or tap it on a touch screen.
      </p>

      <h2 className="mt-9 text-lg font-semibold tracking-tight">How it is played</h2>
      {PLAY.map((para, i) => (
        <P key={i} seen={seen} className="mt-3" text={para} />
      ))}

      <h2 className="mt-9 text-lg font-semibold tracking-tight">How we know it is a game</h2>
      <p className="mt-3 text-[15px] text-ink/90">
        Designing something playable is not the same as designing something that runs. A board can
        obey every rule it was given and still be a lottery — and you cannot tell by playing it,
        because a handful of rounds looks the same either way. So the rules were measured before
        any of this was monetised, and a small seeded batch now runs on every commit — a change
        that flattens the skill gap fails the build rather than reaching a player.
      </p>
      <dl className="mt-4 space-y-4">
        {PROOF.map(([title, para]) => (
          <div key={title}>
            <dt className="text-[15px] font-semibold text-ink/90">{title}</dt>
            <dd className="mt-1 text-[15px] text-ink/78">{annotate(para, seen)}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-9 text-lg font-semibold tracking-tight">What it raises</h2>
      <p className="mt-3 text-[15px] text-ink/90">
        Every pot is split 80% to the beneficiary, 10% to the winner and 10% to the operator, and
        the integer remainder always falls to the beneficiary rather than to the house. A winner
        may take their share over Lightning or pass it on; a share nobody claims goes to the
        beneficiary too.
      </p>
      <p className="mt-3 text-[15px] text-ink/90">
        What is proven about the money is narrower than it sounds, and worth stating exactly. The
        pot holds what was actually charged, not the list price — a bee playing on a full-discount
        coupon adds nothing to it, which it did not always do, and the operator briefly owed the
        beneficiary eight satoshis on one satoshi collected. The three shares sum to the pot with
        nothing lost to rounding. A refused move returns exactly the fare it took. Each of those is
        a test rather than an assurance.
      </p>
      <p className="mt-3 text-[15px] text-ink/90">
        Whether it is profitable is arithmetic, not a claim, and it waits on two numbers. One is
        the price of a motion, which the operator sets. The other is how many people are playing,
        which nobody sets. The simulation supplies the multiplier in between: a bee that plays well
        spends about 89 tool calls to win a round, and one that plays badly spends 140 to 220. The
        operator's own share is the smallest of the three on purpose — this is not built to
        maximise it.
      </p>

      <h2 className="mt-9 text-lg font-semibold tracking-tight">The technology</h2>
      <p className="mt-3 text-[15px] text-ink/90">
        A game is an unkind thing to build this way — shared state, many writers, and a second is
        a long time. That is most of why it is worth building.
      </p>
      <dl className="mt-4 space-y-4">
        {TECH.map(([title, body]) => (
          <div key={title}>
            <dt className="text-[15px] font-semibold text-ink/90">{title}</dt>
            <dd className="mt-1 text-[15px] text-ink/78">{annotate(body, seen)}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-7 text-sm font-semibold text-ink/90">This deployment</h3>
      <p className="mt-1 text-[13px] text-ink/65">
        Read from the running service rather than from the repository, so this says what is
        actually answering you.
      </p>
      <dl className="mt-3 divide-y divide-ink/10 rounded-xl bg-ink/4 text-sm">
        {rows.length ? (
          rows.map(([k, v]) => (
            <div key={k} className="flex justify-between px-4 py-2.5">
              <dt className="text-ink/70">{k}</dt>
              <dd className="font-mono text-[12px]">{v}</dd>
            </div>
          ))
        ) : (
          <div className="px-4 py-2.5 text-ink/65">Asking the hive…</div>
        )}
      </dl>

      <p className="mt-8 text-xs text-ink/65">
        Five hives run at once with twelve seats each, and a match begins as soon as one hive
        holds its quorum of eight bees.
      </p>
    </div>
  );
}
