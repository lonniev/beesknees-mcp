# The Bee's Knees

A race to the queen, monetized with Tollbooth DPYC™ Bitcoin Lightning
micropayments — and run for the benefit of pollinators.

Buy a drone a seat. Fly it to a flower, carry the pollen home through the
hive wall, then tunnel inward. The first bee to reach a queen takes the round.
Most of what the round collects goes to pollinator welfare; the winner and the
operator each take a small share.

## What you're building

```
      YOU (operator, human in the loop)
        │                         │
        │ set & tune prices       │ drive credential intake
        ▼                         ▼
  ┌───────────────┐        ┌──────────────────────────────────────────────┐
  │ Pricing Studio│ prices │   The Bee's Knees — OPERATOR MCP              │
  │    (iOS)      ├───────▶│   FastMCP · deployed on Horizon               │
  └───────────────┘  Neon  │  ┌────────────────────────────────────────┐  │
                           │  │ geometry · board · match · settlement   │  │
   Patron (Citizen)        │  │ @runtime.paid_tool(FROZEN_UUID) tools   │  │
   + MCP client  ─────────▶│  ├────────────────────────────────────────┤  │
   (Claude, the SPA) npub  │  │ tollbooth-dpyc SDK (the wheel)          │  │
                    +sats  │  │  ledger · vault (AES-256-GCM) · pricing │  │
                           │  │  ConstraintGate · Secure Courier·audit  │  │
                           │  └────────────────────────────────────────┘  │
                           └───┬─────────┬──────────┬───────────┬─────────┘
                               ▼         ▼          ▼           ▼
                         Neon Postgres  BTCPay▶  Sponsor     Nostr relays
                         (your schema)  Lightning Authority   proofs·courier
                         ledger+board   invoices  certify +    DMs·audit
                                                  provision        │
                                                      │            ▼
                                                      └──▶ DPYC Oracle +
                                                            dpyc-community
```

## The board

**A hive is round because the field has to narrow.** Ring 0 is the queen's
chamber and ring 14 is the hive wall. Cells scale with circumference, so the
wall holds 29 and the last ring before the chamber holds six. Everyone starts
spread out and converges into a scrum — 226 cells of comb in all.

Outside the wall the meadow is a square lattice, sixteen cells to a side less
the squares the hive covers, and the wall's doors are the only way between the
two. A bee crosses the meadow toward a hive it can see from anywhere; inside,
the rings funnel every bee toward one cell.

Movement is inward, outward, or sideways along a ring. Sideways is what makes it
a maze rather than a set of lanes: it is how you slide onto somebody else's open
shaft, or step out from under a collapse. A bee may not move inward twice in a
row — it steps sideways between — so a straight radial shaft does not pay, and a
small share of the comb is impassable.

## The one real choice

> **Cut your own shaft — slow, and open to everyone the moment it exists.
> Or ride one somebody else paid for — fast, and they can bring it down on you.**

Three motions carry it. `fly` moves through open ground. `dig` cuts fresh comb
and costs several cooldowns rather than one. `seal` buries an open cell so the
bees behind must cut it again.

A bee acts once per cooldown, measured on the clock, so **no amount of spending
buys a faster bee**. What spending buys is interference.

## Why five hives and not one

Five hives of twelve, and a match starts the moment any hive holds eight.
Seats go into the emptiest hive, so the five fill evenly.

That is a measured decision, not a taste one. Racing fifty near-identical bees
to a single queen is close to a lottery: first-past-the-post among fifty is an
extreme-value draw, and those are settled by variance rather than by skill. The
batch runner in `sim/` puts a good strategy at **1.4x** uniform with fifty bees
in one hive and **2.1x** with twelve. Winning your own hive is skill-weighted;
which of the five leaders finishes first is a fair draw, so the signal survives.

```bash
node sim/run.ts --rounds 400 --bees 12    # re-measure before changing a rule
```

## Where the money goes

Most of what a round collects goes to pollinator conservation. The default
beneficiary is **[Pollinator Partnership](https://www.pollinator.org/)** —
chosen over the honeybee-focused charities on purpose, because managed honeybees are livestock
and are not the ones in trouble; native and wild pollinators are, and they are
what Pollinator Partnership covers.

### How the money leaves

Each settled match records its split: 80% to the charity and 10% each to the
winner and the operator, with any rounding going to the charity. The operator
pays the shares out over **Lightning**, and nothing pays on a timer — a payment
leaves when the operator asks for it.

- `beesknees_pay_charity` sends everything owed to the charity in one payment
  to its Lightning address. The share accrues match by match and settles as a
  batch, because a single match's share can be smaller than the fee to route
  it.
- `beesknees_pay_out` pays one settled match's charity or winner share.
- Every unpaid share is claimed in the database before the sats move, so a
  retry or a second press cannot pay the same match twice.
- `beesknees_treasury` shows what the wallet can send against what is owed.
- A player says before the round what happens to a win
  (`beesknees_set_payout`). Donating is the default; keeping it needs a
  Lightning address.

`beesknees_settlement_history` serves what every settled match paid and to
whom, and `beesknees_payout_history` lists every payment attempted, failures
included. Both are free, because a claim about where the money went that costs
money to check is not a claim anybody should believe.

The beneficiary is stored, not compiled in, so it can change: the operator
names it, its website and its Lightning address with `beesknees_set_charity`,
and `beesknees_charity` shows it to anyone, free. Every settlement
records the beneficiary it actually paid, so history stays true even when the
current one changes — a patron who played because of where the money went can
always check where it went.

## Layout

| Path | What lives there |
|---|---|
| `src/beesknees_mcp/geometry.py` | The board. Pure arithmetic, no identity, no billing |
| `src/beesknees_mcp/server.py` | Frozen tool catalog + `OperatorRuntime` bootstrap |
| `src/beesknees_mcp/board_store.py` | The shared board and the settlements, in Neon |
| `src/beesknees_mcp/payouts.py` | Sending the charity and winner shares over Lightning |
| `scheduler-worker/` | Cloudflare cron that asks the hives to advance every minute (`beesknees_check_now`, free, no secrets) |
| `modal_app.py` | The sim bees: seats just enough ordinary, coupon-funded bees to start a thin hive |
| `frontend/src/game/` | The same rules in TypeScript — the client's engine |
| `frontend/src/lib/polar.ts` | Cell ⇄ wedge, and the tap hit test |
| `frontend/src/lib/stageMath.ts` | What changed between two looks at a hive — the WebGL board's diff |
| `frontend/src/art/` | The bee, the daisy, the crown as shapes — painted for the board, `<symbol>`s for the page |
| `frontend/src/stage/` | The focused hive in WebGL (PixiJS). Reached only by dynamic import |
| `sim/run.ts` | Batch runner: is this a game or a lottery? |

**The rules exist in three copies** — this Python, the client's TypeScript, and
the renderers — and nothing at runtime reports that they have drifted; the game
simply starts rejecting moves a player can see are legal. `tests/test_geometry.py`
and `frontend/src/game/rules.test.ts` assert the same invariants on purpose, so
a drift fails a build instead of a match.

## Onboarding roadmap

1. **Nostr keypair** — generate one (`nak key generate`); the nsec is the single
   env var the server needs (`TOLLBOOTH_NOSTR_OPERATOR_NSEC`).
2. **Sponsor Authority** — register; it provisions your Neon database.
3. **Secure Courier** — deliver `btcpay_host`, `btcpay_api_key`,
   `btcpay_store_id` via `beesknees_request_credential_channel`. Never as env
   vars, never in code.
4. **Set prices in Pricing Studio** — new tools start unpriced, and nobody can
   call an unpriced tool.
5. **Deploy on Horizon** — `fastmcp.json` is already wired.

**Get [Pricing Studio](https://github.com/lonniev/tollbooth-pricing-studio)
(iOS).** It reads and writes the pricing model live in Neon, so prices never
live in code — surge, happy-hour, loyalty discounts and free trials are the
thing a flat paywall can never give you.

## The app

`frontend/` carries the Bee's Knees app, deployed to Cloudflare Pages with
`functions/mcp.js` proxying `/mcp` same-origin. It runs a **solo mode** against
the local engine — the whole match filled with bots but one seat — so the
interface can be played before anybody has paid for anything.

The focused hive is drawn in WebGL on top of an SVG first paint. The SVG is
what the server-side smoke and prerender checks see, what a browser shows on
its first frame, and what the game falls back to if WebGL is lost; the stage
takes over once PixiJS has loaded and drawn. Nothing about the game lives in
the stage — it renders what both engines already compute.

## Develop

```bash
uv venv --python python3.12          # coincurve has no 3.14 wheel
uv pip install -e ".[dev]"
ruff check . && pytest -v
python -m beesknees_mcp.server       # runs the validate_operator_tools guard

cd frontend && npm install
npm run dev                          # solo mode on http://localhost:5180
npm test && npm run smoke            # invariants, then a real first paint (the SVG one)
```


## License

Apache-2.0
