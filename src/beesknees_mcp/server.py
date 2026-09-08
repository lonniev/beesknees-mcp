"""The Bee's Knees — a monetized multiplayer race to the queen.

Buy a worker bee a seat, fly it to a flower, carry the pollen home, then tunnel
through the comb. First bee to reach a queen takes the round.

Standard DPYC tools (check_balance, purchase_credits, Secure Courier, Oracle,
pricing, constraints) come from ``register_standard_tools`` in the tollbooth-dpyc
wheel. Only domain tools are defined here.

Run locally:
    python -m beesknees_mcp.server
"""

from __future__ import annotations

import contextlib
import logging
from datetime import UTC, datetime
from typing import Annotated, Any

from fastmcp import FastMCP
from pydantic import Field
from tollbooth.credential_templates import CredentialTemplate, FieldSpec
from tollbooth.credential_validators import validate_btcpay_creds
from tollbooth.runtime import OperatorRuntime, register_standard_tools
from tollbooth.tool_identity import STANDARD_IDENTITIES, ToolIdentity

from beesknees_mcp import __version__, board_store, geometry, match_flow
from beesknees_mcp import payouts as payouts_mod

logger = logging.getLogger(__name__)

SITE = "https://beesknees.tollbooth-dpyc.com"

mcp = FastMCP(
    "beesknees-mcp",
    instructions=(
        "The Bee's Knees — a race to the queen, monetized via Tollbooth DPYC "
        "Bitcoin Lightning micropayments.\n\n"
        "## How a round goes\n"
        "Buy a worker bee a seat with beesknees_join_match. Five hives run at "
        "once, twelve seats each, and the match begins as soon as any hive "
        "holds eight bees.\n\n"
        "Your bee has three acts: reach a flower, carry the pollen back through "
        "the hive wall, then tunnel inward to the queen. The first bee to reach "
        "a queen — in ANY of the five hives — takes the round.\n\n"
        "## The one real choice\n"
        "Cutting fresh comb is slow, and the cell you cut is open to everyone "
        "afterwards. Riding a shaft somebody else paid for is fast, and they "
        "can bring it down on you. beesknees_fly moves through open ground, "
        "beesknees_dig cuts new, and beesknees_seal buries an open cell.\n\n"
        "A bee acts once per cooldown, measured on the clock, so no amount of "
        "spending buys a faster bee. What spending buys is interference.\n\n"
        "A bee has a body. Inside the hive one cell holds one bee, so a bee in "
        "front of you is an obstacle to route around or to bury. The meadow is "
        "air and everyone passes freely.\n\n"
        "## Reading the board\n"
        "beesknees_match_state carries every hive since a sequence number and "
        "tells you when to ask again. Poll it rather than guessing a cadence.\n\n"
        "## Onboarding\n"
        "Call beesknees_get_operator_onboarding_status to check readiness.\n"
        "1. Register with an Authority (provides a Neon database automatically)\n"
        "2. Deliver operator secrets via Secure Courier:\n"
        "   - btcpay_host, btcpay_api_key, btcpay_store_id\n"
        "   Call beesknees_request_credential_channel to start.\n\n"
        "## Pricing\n"
        "Tool prices are set dynamically by the operator's pricing model. Use "
        "`beesknees_check_price` to preview costs and `beesknees_check_balance` "
        "to see your balance."
    ),
)

# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------

# Frozen UUIDs — minted once at tool birth via capability_uuid() and never
# changed. Renaming a capability later leaves these intact, so the pricing rows
# in Neon stay keyed correctly. The full catalog is declared here so each
# identity is minted exactly once; only the tools actually implemented are
# registered below.
MATCH_STATE_UUID = "60e56643-f91e-5a48-bd9f-2ce6535d7b94"
MY_BEE_UUID = "817b8e56-d1fc-5e39-a3f3-f6e1acef25d9"
MATCH_LIST_UUID = "50e68740-2b32-5831-8ceb-6f1636f7d415"
JOIN_MATCH_UUID = "bb086ff2-a23a-53a0-89a6-1c9177f2174c"
FLY_UUID = "7d81ddba-caf9-52b0-8230-67fe14444815"
DIG_UUID = "99f3e454-10d1-5471-b079-4ae30cecaee9"
SEAL_UUID = "49ee895f-5298-5da3-b5a7-e776067a9dca"
CLAIM_PRIZE_UUID = "ab5337ff-8e9d-5b36-ab2c-ca2a76e06767"
SETTLEMENT_HISTORY_UUID = "df0d8029-1532-5747-8796-4f0da905c9fc"
CHECK_NOW_UUID = "5008f509-81fe-5d05-980f-7ca6da410a00"
TICK_UUID = "0a3deb87-9fe0-5831-8732-32f39938f180"
SET_CHARITY_UUID = "3cef605a-f062-5d6f-8ac4-dd79bc1fbd0a"
SET_PAYOUT_UUID = "e23622d7-be8d-56ec-85cc-ed81c06dda22"
PAYOUT_UUID = "3b69029c-c9fa-5432-bd3d-95c23d1d919a"
TREASURY_UUID = "5b7d7180-f951-523e-8964-2fbf503def3c"
PAY_OUT_UUID = "324c5ea2-6215-5a8c-b2cd-f433b40f0c20"
PAYOUT_HISTORY_UUID = "a60cc83e-8fe8-561b-ae4c-15747876c318"
PAY_CHARITY_UUID = "530a2e01-5fc6-5e7f-a744-5499c5eaed7b"
CHARITY_UUID = "1ce08d38-d548-5c4b-aeea-5a3b564d8117"

_DOMAIN_TOOLS = [
    ToolIdentity(
        tool_id=MATCH_STATE_UUID,
        capability="match_state",
        # Free on purpose, and the reason is load rather than generosity: this is
        # the single most-called tool in the system — every player, about once a
        # second, for the whole match. `free` is the one category the runtime
        # answers without a Neon pricing lookup, which is what keeps a fifty-bee
        # match from putting fifty reads a second on the database just to let
        # people watch. The trade is real: a free tool has no dial in Pricing
        # Studio, ever.
        category="free",
        intent="The live board — every hive and every bee, since a sequence number",
    ),
    ToolIdentity(
        tool_id=MY_BEE_UUID,
        category="free",
        capability="my_bee",
        intent="Where your bee stands, what it is carrying, and when it may move again",
    ),
    ToolIdentity(
        tool_id=MATCH_LIST_UUID,
        category="free",
        capability="match_list",
        intent="Matches forming or running, and how many seats are left in each hive",
    ),
    ToolIdentity(
        tool_id=JOIN_MATCH_UUID,
        capability="join_match",
        category="write",
        intent="Buy a worker bee a seat in the next match",
    ),
    ToolIdentity(
        tool_id=FLY_UUID,
        capability="fly",
        category="write",
        intent="Move one cell through open air or an open tunnel",
    ),
    ToolIdentity(
        tool_id=DIG_UUID,
        capability="dig",
        category="write",
        intent="Cut one fresh cell of comb — slower than flying, and it opens the way for everyone",
    ),
    ToolIdentity(
        tool_id=SEAL_UUID,
        capability="seal",
        category="write",
        intent="Bring down an open tunnel cell, so the bees behind you must cut it again",
    ),
    ToolIdentity(
        tool_id=CLAIM_PRIZE_UUID,
        capability="claim_prize",
        category="write",
        intent="Take the winner's share as credit, or send it on to the charity",
    ),
    ToolIdentity(
        tool_id=SETTLEMENT_HISTORY_UUID,
        # Free on purpose: this is the receipt for the charity's share. A claim
        # about where the money went that costs money to check is not a claim
        # anybody should believe.
        category="free",
        capability="settlement_history",
        intent="What every settled round paid, and to whom",
    ),
    ToolIdentity(
        tool_id=CHECK_NOW_UUID,
        # Free, and carrying no authority: it can only cause work that was
        # already due. Gating it would stop nobody who wanted to abuse it and
        # exactly one person who should not have been stopped.
        category="free",
        capability="check_now",
        intent="Ask the hives to advance now rather than at the next tick",
    ),
    ToolIdentity(
        tool_id=TICK_UUID,
        capability="tick",
        # `restricted` is enforced by the runtime: the caller must be the
        # operator, proven. This is the cron entry point.
        category="restricted",
        intent="Operator: open, close and settle matches",
    ),
    ToolIdentity(
        tool_id=SET_CHARITY_UUID,
        capability="set_charity",
        # Who the money goes to is the operator's to name, and nobody else's.
        category="restricted",
        intent="Operator: name the beneficiary, its site and its wallet",
    ),
    ToolIdentity(
        tool_id=PAYOUT_UUID,
        capability="payout",
        # Free: reading back your own standing instruction is not a service, and
        # a screen that has to buy the setting it is about to show would show a
        # dash to anybody out of credit.
        category="free",
        intent="What you have said should happen to your winnings",
    ),
    ToolIdentity(
        tool_id=TREASURY_UUID,
        capability="treasury",
        # Restricted: what the operator holds is the operator's business, and
        # the figure includes other patrons' float.
        category="restricted",
        intent="Operator: what is held, what is owed, and what may be sent",
    ),
    ToolIdentity(
        tool_id=PAY_OUT_UUID,
        capability="pay_out",
        # The only tool in this service that moves real sats. Restricted, and
        # the runtime proves the caller is the operator before it runs.
        category="restricted",
        intent="Operator: send a settled match's charity or winner share",
    ),
    ToolIdentity(
        tool_id=PAY_CHARITY_UUID,
        capability="pay_charity",
        # Restricted: it sends the operator's sats.
        category="restricted",
        intent="Operator: pay everything owed to the charity, in one payment",
    ),
    ToolIdentity(
        tool_id=PAYOUT_HISTORY_UUID,
        capability="payout_history",
        # Free, and deliberately: a service that says 80% goes to a charity
        # should let anybody check that sats actually left, not just that a
        # row was written saying they were owed.
        category="free",
        intent="Every payment attempted, and how it went",
    ),
    ToolIdentity(
        tool_id=CHARITY_UUID,
        capability="charity",
        # Free, deliberately. Where the money goes is a claim players should be
        # able to check without paying to check it.
        category="free",
        intent="Who the charity share goes to",
    ),
    ToolIdentity(
        tool_id=SET_PAYOUT_UUID,
        capability="set_payout",
        category="write",
        intent="Say what should happen to your winnings",
    ),
]

TOOL_REGISTRY: dict[str, ToolIdentity] = {ti.tool_id: ti for ti in _DOMAIN_TOOLS}

# ---------------------------------------------------------------------------
# OperatorRuntime
# ---------------------------------------------------------------------------

runtime = OperatorRuntime(
    tool_registry={**STANDARD_IDENTITIES, **TOOL_REGISTRY},
    operator_credential_template=CredentialTemplate(
        service="beesknees-operator",
        version=1,
        description="Operator credentials for BTCPay Lightning payments",
        fields={
            "btcpay_host": FieldSpec(
                required=True,
                sensitive=True,
                description="The URL of your BTCPay Server instance (e.g. https://btcpay.example.com).",
            ),
            "btcpay_api_key": FieldSpec(
                required=True,
                sensitive=True,
                description="Your BTCPay Server API key. Generate one under Account > Manage Account > API Keys.",
            ),
            "btcpay_store_id": FieldSpec(
                required=True,
                sensitive=True,
                description="Your BTCPay Store ID. Find it under Stores > Settings > General.",
            ),
        },
    ),
    operator_credential_greeting=(
        "Hi — I'm The Bee's Knees, a race to the queen. "
        "You (or your AI agent) requested a credential channel."
    ),
    service_name="The Bee's Knees",
    credential_validator=validate_btcpay_creds,
)

tool = register_standard_tools(
    mcp,
    "beesknees",
    runtime,
    service_name="beesknees-mcp",
    service_version=__version__,
)

# ---------------------------------------------------------------------------
# Domain tools
# ---------------------------------------------------------------------------

NPUB_FIELD = Annotated[
    str, Field(description="Required. Your Nostr public key (npub1...) for credit billing.")
]


def fare_just_charged() -> int:
    """What the runtime ACTUALLY debited for the call now running.

    **Read this before the body's first `await`, or not at all.**

    `paid_tool` computes the effective cost, assigns it to `_last_debit_cost`
    on the runtime — one slot on a process-wide singleton — and then awaits the
    tool body. Entering that body and running it to its first `await` happens
    without yielding to the event loop, so a synchronous read at the top sees
    this call's own figure. A read after any `await` may see a figure belonging
    to whichever of the other fifty-nine bees moved in between.

    That race is why this used to price the tool from the pricing model
    instead. It avoided the race and introduced a worse fault: the model gives
    RETAIL, and retail is not what anybody paid. A coupon that made a call free
    still added full price to the pot, and the operator owed the charity 80% of
    money that never arrived — eight sats owed on one sat collected, in the
    first match ever played for real.
    """
    return int(getattr(runtime, "_last_debit_cost", 0) or 0)


async def _charged(npub: str, match_id: str, tool: str, sats: int) -> None:
    """Put what was actually paid into the pot.

    The pot is a promise: 80% of it is owed to a charity and will leave the
    operator's node as real sats. So it may only ever hold money that really
    came in. A fare of zero is still recorded — a coupon'd bee took part, and
    its zero is the honest account of what its taking part raised.
    """
    await board_store.record_fare(match_id, npub, tool, max(0, int(sats)))


def _upstream(exc: Exception, what: str) -> dict[str, Any]:
    logger.warning("%s failed: %s", what, exc)
    return {"success": False, "error": f"The hive did not answer: {exc}", "error_code": "upstream_unavailable"}


# ── Reading the board ────────────────────────────────────────────────────


@tool
@runtime.paid_tool(MATCH_STATE_UUID)
async def match_state(
    match_id: Annotated[str, Field(description="The match to read. Omit for the live one.")] = "",
    since_seq: Annotated[int, Field(description="Only answer if the board has moved past this.")] = -1,
    npub: NPUB_FIELD = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """The live board — every hive, every bee, and when to ask again.

    Poll this rather than guessing a cadence: the answer carries `poll_after_ms`,
    computed from how hot the match actually is. One algorithm, owned here, so
    sixty clients throttle themselves and the server keeps a valve it can turn.

    Args:
        match_id: The match to read. Omit for whichever one is live.
        since_seq: Pass the `seq` you last saw; an unchanged board answers small.
    """
    try:
        m = await board_store.get_match(match_id) if match_id else None
        if not m and npub:
            # YOUR match first, even once it has ended.
            #
            # A finished round leaves `live_matches` immediately, so the winner
            # was handed the next lobby before their own result ever reached the
            # screen — the board knew, the ledger knew, and the one person who
            # cared did not. A recently ended match stays answerable for a couple
            # of minutes so the result can be seen and the prize claimed.
            mine = await board_store.latest_match_for(npub)
            if mine and str(mine.get("state")) in ("running", "ended"):
                ended = mine.get("ended_at")
                fresh = True
                if str(mine.get("state")) == "ended" and ended:
                    with contextlib.suppress(Exception):
                        fresh = (
                            datetime.now(UTC) - _as_dt(ended)
                        ).total_seconds() < RESULT_LINGER_S
                if fresh:
                    m = mine
        if not m:
            live = await board_store.live_matches()
            m = live[0] if live else await match_flow.ensure_forming()
        mid = str(m["match_id"])
        seq = int(m.get("seq") or 0)

        # The tempo IS the cadence. A running match moves on a one-second
        # cooldown, so it is polled just inside that; a lobby only changes when
        # somebody pays, and can be asked far less often.
        state = str(m.get("state") or "forming")
        poll_ms = 700 if state == "running" else 4000

        # EQUAL, not "less than or equal". A match's `seq` only ever grows, so
        # a client whose `since_seq` is AHEAD of it is not up to date — it is
        # holding a sequence number from a different match, and answering
        # "unchanged" hands it nothing to correct itself with.
        #
        # That is how a player got stranded. A round ended, the next one formed
        # with a low seq, and the browser kept sending the finished match's
        # number. Every poll answered `unchanged`, carried no board, and left
        # the dead match on screen; a forming match nobody has joined never
        # bumps its seq, so the client never escaped. Meanwhile the buttons
        # answered "no match is running", because the server had long moved on.
        if since_seq >= 0 and seq == since_seq:
            return {"success": True, "match_id": mid, "seq": seq, "state": state,
                    "unchanged": True, "poll_after_ms": poll_ms}

        bees = await board_store.bees_in(mid)
        cells = await board_store.open_cells(mid)
        return {
            "success": True,
            "match_id": mid,
            "state": state,
            "seq": seq,
            "unchanged": False,
            "poll_after_ms": poll_ms,
            "winner_npub": m.get("winner_npub") or "",
            "hives": board_store.HIVES,
            "seats": board_store.SEATS,
            "bees": bees,
            "open_cells": cells,
            # The SEED, without which a client cannot draw this board at all.
            #
            # Obstructions, flowers and starting squares are all derived from it
            # and none of them are stored; the client runs the same generator on
            # the same number and gets the same hive. Sending them cell by cell
            # would be hundreds of integers per poll for something both sides can
            # compute — and leaving it out, which is what happened, meant a live
            # client drew a board with no capped brood and no flowers on it and
            # had moves refused for reasons nothing on screen explained.
            "seed": int(m.get("seed") or 0),
            # Placement is derived; the TAKING is not. This is the one piece of
            # meadow state a rival can change under you.
            "taken_pollen": await board_store.taken_pollen(mid),
            "geometry": {"wall": geometry.WALL_RING, "grid_n": geometry.GRID_N,
                         "cell_width": geometry.CELL_WIDTH},
        }
    except (OSError, RuntimeError) as exc:
        return _upstream(exc, "match_state")


@tool
@runtime.paid_tool(MY_BEE_UUID)
async def my_bee(
    match_id: Annotated[str, Field(description="The match to look in. Omit for the live one.")] = "",
    npub: NPUB_FIELD = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Where your bee stands, what it is carrying, and when it may move again.

    Args:
        match_id: The match to look in. Omit for whichever one is live.
    """
    try:
        m = await board_store.get_match(match_id) if match_id else None
        if not m:
            live = await board_store.live_matches()
            m = live[0] if live else None
        if not m:
            return {"success": True, "seated": False, "reason": "no match is running"}
        bee = await board_store.bee_of(str(m["match_id"]), npub)
        if not bee:
            return {"success": True, "seated": False, "match_id": m["match_id"]}
        g = geometry.make_geometry()
        return {"success": True, "seated": True, "match_id": m["match_id"],
                "ring": geometry.ring_of(g, int(bee["cell"])), **bee}
    except (OSError, RuntimeError) as exc:
        return _upstream(exc, "my_bee")


@tool
@runtime.paid_tool(MATCH_LIST_UUID)
async def match_list(npub: NPUB_FIELD = "", dpop_token: str = "") -> dict[str, Any]:
    """Matches forming or running, and how many seats are left in each hive."""
    try:
        out = []
        for m in await board_store.live_matches():
            counts = await board_store.seat_counts(str(m["match_id"]))
            out.append({
                "match_id": m["match_id"],
                "state": m["state"],
                "seated": sum(counts.values()),
                "seats_by_hive": {str(h): counts.get(h, 0) for h in range(board_store.HIVES)},
                "capacity": board_store.HIVES * board_store.SEATS,
                "quorum": board_store.QUORUM,
            })
        return {"success": True, "matches": out}
    except (OSError, RuntimeError) as exc:
        return _upstream(exc, "match_list")


@tool
@runtime.paid_tool(SETTLEMENT_HISTORY_UUID)
async def settlement_history(
    limit: Annotated[int, Field(description="How many settled matches to return.")] = 25,
    npub: NPUB_FIELD = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """What every settled match paid, and to whom.

    Free on purpose. A claim about where the money went that costs money to
    check is not a claim anybody should believe.

    Args:
        limit: How many settled matches to return.
    """
    try:
        rows = await board_store.settlements(limit)
        owed = await board_store.charity_owed()
        # The named beneficiary, with somewhere a player can go and check them.
        # A ledger that says where the money went should say who that is.
        charity = await board_store.get_charity()
        return {"success": True,
                "beneficiary": charity["name"] or match_flow.BENEFICIARY,
                "charity": {"name": charity["name"], "website": charity["website"]},
                "settlements": rows, **owed,
                "leaderboard": await board_store.leaderboard(10)}
    except (OSError, RuntimeError) as exc:
        return _upstream(exc, "settlement_history")


@tool
@runtime.paid_tool(CHECK_NOW_UUID)
async def check_now(npub: NPUB_FIELD = "", dpop_token: str = "") -> dict[str, Any]:
    """Ask the hives to advance now rather than at the next tick.

    Carries no authority: it can only cause work that was already due — start a
    match whose grace has run out, or end one whose ceiling has fallen.
    """
    try:
        return {"success": True, **await match_flow.advance()}
    except (OSError, RuntimeError) as exc:
        return _upstream(exc, "check_now")


# ── Taking part ──────────────────────────────────────────────────────────


@tool
@runtime.paid_tool(JOIN_MATCH_UUID)
async def join_match(
    label: Annotated[str, Field(description="The name your bee flies under.")] = "",
    npub: NPUB_FIELD = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Buy a worker bee a seat in the next match.

    Seats fill the fullest hive that still has room, so a match reaches its
    quorum and starts rather than leaving everyone waiting in five thin hives.

    Args:
        label: The name your bee flies under.
    """
    fare = fare_just_charged()  # FIRST. See `fare_just_charged`.
    seat = await match_flow.join(npub, label[:32] or "A bee")
    await _charged(npub, str(seat["match_id"]), "join_match", fare)
    await match_flow.advance()
    return {"success": True, **seat}


#: The motion tools, by capability name, so a refund can name its own tool.
_MOTION_UUIDS = {"fly": FLY_UUID, "dig": DIG_UUID, "seal": SEAL_UUID}


#: How long a finished round keeps answering its own players, so the result can
#: be read and the prize claimed before the next lobby takes over the screen.
RESULT_LINGER_S = 180


def _as_dt(v: Any) -> datetime:
    """Neon hands timestamps back as strings over HTTP."""
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=UTC)
    return datetime.fromisoformat(str(v).replace(" ", "T")).astimezone(UTC)


async def _refund(tool_name: str, npub: str, sats: int) -> None:
    """Give back exactly the fare that was taken.

    `paid_tool` only rolls back on the way out through an exception, and these
    paths RETURN a situation instead — which is the right shape for the caller
    and the wrong one for the ledger unless the refund is explicit.

    Not `runtime.rollback_debit`, which credits `pricing.compute(...)` — the
    BASE price, before any constraint. A bee playing on a 100%-off coupon paid
    nothing, and a refused move handed it a sat it never spent: a refund that
    MINTS. Refusals are ordinary here — a rival in the cell, the stagger — so
    that is not a rounding error, it is a slow leak with a coupon on the end of
    it. Nothing was taken when the fare was zero, so nothing goes back.
    """
    if sats <= 0 or tool_name not in _MOTION_UUIDS:
        return
    with contextlib.suppress(Exception):
        cache = await runtime.ledger_cache()
        await cache.credit(npub, int(sats), f"rollback:beesknees_{tool_name}")


async def _motion(npub: str, tool_name: str, run: Any) -> dict[str, Any]:
    """Shared shell for fly / dig / seal.

    Three outcomes, and they are not the same thing:

    - **The move happened.** Charged, and the board moved.
    - **A LOST RACE.** Returned, and charged: the board moved, the attempt was
      real, and somebody else simply got there first.
    - **The rules refused it** — not adjacent, a rival in the cell, capped brood,
      the stagger. Refunded, and the REASON is returned.

    That last case used to raise. `paid_tool` rolled the fare back, which was
    right, but the message died with it: every ordinary rejection reached the
    player as "Tool execution failed. Check operator logs.", which says nothing
    and reads like the service fell over. A bee refused for standing behind
    another bee is not a crash, and telling somebody their game broke when it
    did exactly what it should is worse than the refusal.
    """
    fare = fare_just_charged()  # FIRST. See `fare_just_charged`.
    live = await board_store.live_matches()
    running = [m for m in live if str(m["state"]) == "running"]
    if not running:
        raise ValueError("no match is running")
    mid = str(running[0]["match_id"])
    try:
        result = await run(mid)
    except board_store.BoardError as exc:
        await _refund(tool_name, npub, fare)
        return {"success": False, "match_id": mid, "moved": False, "refused": str(exc)}
    except (OSError, RuntimeError, ValueError, KeyError, TypeError) as exc:
        # Anything the persistence layer throws. It used to escape here and the
        # runtime flattened it to "Tool execution failed. Check operator logs.",
        # which tells a player nothing and cost a fare for a move that never
        # happened. Named, refunded, and reported — the patron can see whether
        # their game is broken or the hive is.
        await _refund(tool_name, npub, fare)
        logger.exception("%s failed against the board", tool_name)
        return {
            "success": False,
            "match_id": mid,
            "moved": False,
            "error": f"The hive could not move your bee: {type(exc).__name__}: {exc}",
            "error_code": "board_write_failed",
        }
    await _charged(npub, mid, tool_name, fare)
    await match_flow.advance()
    return {"success": True, "match_id": mid, **result}


@tool
@runtime.paid_tool(FLY_UUID)
async def fly(
    to_cell: Annotated[int, Field(description="The neighbouring cell to move into.")],
    npub: NPUB_FIELD = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Move one cell through open air or an open tunnel.

    Args:
        to_cell: The neighbouring cell to move into.
    """
    async def run(mid: str) -> dict[str, Any]:
        # Whether this lands on a flower is the SERVER's to know. It used to be
        # `is_meadow(to_cell)` — every square in the meadow counted, so a bee
        # loaded pollen on its first move and the whole forage act, the meadow's
        # only real decision, did not exist.
        return await board_store.fly(mid, npub, to_cell)

    return await _motion(npub, "fly", run)


@tool
@runtime.paid_tool(DIG_UUID)
async def dig(
    to_cell: Annotated[int, Field(description="The neighbouring cell of comb to cut.")],
    npub: NPUB_FIELD = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Cut one fresh cell of comb — slower than flying, and open to everyone after.

    Args:
        to_cell: The neighbouring cell of comb to cut.
    """
    return await _motion(npub, "dig", lambda mid: board_store.dig(mid, npub, to_cell))


@tool
@runtime.paid_tool(SEAL_UUID)
async def seal(
    at_cell: Annotated[int, Field(description="The open tunnel cell to bring down.")],
    npub: NPUB_FIELD = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Bring down an open tunnel cell, so the bees behind you must cut it again.

    Costs one move and a fare, and sets a rival back several — a bee has a body,
    so a bee stuck behind a seal is also a wall for everyone behind it.

    Args:
        at_cell: The open tunnel cell to bring down.
    """
    return await _motion(npub, "seal", lambda mid: board_store.seal(mid, npub, at_cell))


@tool
@runtime.paid_tool(CLAIM_PRIZE_UUID)
async def claim_prize(
    match_id: Annotated[str, Field(description="The match you won.")],
    choice: Annotated[str, Field(description="'donate' to pass it to the charity, or 'keep'.")] = "keep",
    npub: NPUB_FIELD = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Take the winner's share as credit, or send it on to the charity.

    Args:
        match_id: The match you won.
        choice: 'donate' to pass your share to the charity, or 'keep'.
    """
    rows = await board_store.settlements(200)
    mine = [r for r in rows if str(r["match_id"]) == match_id and str(r.get("winner_npub")) == npub]
    if not mine:
        raise ValueError("that match is not yours to claim")
    row = mine[0]
    state = str(row.get("prize_state"))
    if state == "forfeited":
        # Said plainly rather than as a bare state name: the window closed and
        # the share went to the charity, which is not a failure and not
        # something a retry will undo.
        return {"success": True, "already": state, "match_id": match_id,
                "outcome": f"unclaimed for {board_store.PRIZE_CLAIM_DAYS} days, "
                           "so it went to the charity"}
    if state != "unclaimed":
        return {"success": True, "already": state, "match_id": match_id}

    # An unstated choice is not a missing one: it is whatever the winner already
    # said in their profile, and donating is the default for somebody who has
    # never said anything at all.
    said = choice.strip().lower()
    donate = (await board_store.get_payout(npub))["donate"] if not said else said == "donate"

    if donate:
        await board_store.set_prize_state(match_id, "donated")
    else:
        # The share is only credited here, never at settlement, so donating
        # actually donates rather than leaving a credit the winner already has.
        if not await match_flow.award_prize(match_id, npub, int(row["winner_sats"])):
            return {"success": False, "error_code": "prize_credit_failed",
                    "error": "the ledger did not take the credit; try again shortly"}
        await board_store.set_prize_state(match_id, "kept")

    beneficiary = str(row.get("beneficiary") or "") or match_flow.BENEFICIARY
    return {"success": True, "match_id": match_id, "donated": donate,
            "outcome": f"donated to {beneficiary}" if donate else "kept as credit"}


# ── Operator ─────────────────────────────────────────────────────────────


@tool
@runtime.paid_tool(TICK_UUID)
async def tick(npub: NPUB_FIELD = "", dpop_token: str = "") -> dict[str, Any]:
    """Operator: open, close and settle matches.

    `restricted`, so the runtime requires the caller to be the operator, proven.
    This is the cron entry point; `check_now` is the same work without authority.
    """
    return {"success": True, **await match_flow.advance()}


# ── Where the money goes ─────────────────────────────────────────────────


@tool
@runtime.paid_tool(CHARITY_UUID)
async def charity(npub: NPUB_FIELD = "", dpop_token: str = "") -> dict[str, Any]:
    """Who the charity share goes to, and where to check them.

    Free on purpose. A claim about where somebody's money goes that costs money
    to verify is not a claim anybody should have to take on trust.
    """
    try:
        c = await board_store.get_charity()
        # Name and site only. Where the money is SENT is operational — it buys a
        # player nothing to see it, and this tool is unauthenticated.
        return {"success": True, "name": c["name"], "website": c["website"],
                "named": bool(c["name"])}
    except (OSError, RuntimeError) as exc:
        return _upstream(exc, "charity")


@tool
@runtime.paid_tool(TREASURY_UUID)
async def treasury(npub: NPUB_FIELD = "", dpop_token: str = "") -> dict[str, Any]:
    """Operator: what the wallet can send, and what is owed out of it.

    `restricted`, so the runtime requires the caller to be the operator, proven.

    `sendable_sats` is the local end of the node's channels — the only balance a
    Lightning payment can draw on. `owed_sats` is what this service's own
    settlements say is still to go out, computed from its own tables.

    `node_reachable: false` means the balance could not be asked for at all — an
    unreachable node, or an API key without `canuselightningnode` — and
    `pay_out` refuses on it. An unknown balance is not an optimistic one.

    `covers_everything_owed` is reported, not enforced: an operator should see
    that they owe more than they hold, but refusing to pay one charity because a
    second is also owed helps neither of them.
    """
    try:
        # The charity's own record, including the wallet, because this is the
        # operator's own console and they cannot confirm what they set from the
        # free `charity` tool — which deliberately omits it.
        c = await board_store.get_charity()
        return {"success": True, **await payouts_mod.look(), "charity": c}
    except (OSError, RuntimeError) as exc:
        return _upstream(exc, "treasury")


@tool
@runtime.paid_tool(PAY_OUT_UUID)
async def pay_out(
    match_id: Annotated[str, Field(description="The settled match to pay out.")],
    kind: Annotated[str, Field(description="'charity' or 'winner'.")] = "charity",
    npub: NPUB_FIELD = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Operator: send a settled match's charity or winner share over Lightning.

    `restricted`, so the runtime requires the caller to be the operator, proven.
    This is the only tool here that moves real sats, and the only one whose
    effect cannot be undone by writing another row.

    The amount is READ from the settlement, never recomputed, so a payment can
    never be for a figure the ledger does not already carry. The charity leg
    pays the beneficiary the match itself recorded, so a match settled under a
    previous charity still pays the charity it promised.

    Before anything moves the wallet is asked whether it can cover the payment
    plus its routing fee, and the payment is claimed in the database before the
    sats leave — so a retry, a double press, or two operators at once collide on
    a primary key rather than at the node. Calling it again after a success
    reports the existing payment rather than making a second.

    Nothing here is automatic. A payment leaves because somebody asked.

    Args:
        match_id: The settled match to pay out.
        kind: 'charity' or 'winner'.
    """
    try:
        return await payouts_mod.send(kind.strip().lower(), match_id)
    except board_store.BoardError as exc:
        return {"success": False, "error_code": "refused", "error": str(exc)}
    except (OSError, RuntimeError) as exc:
        return _upstream(exc, "pay_out")


@tool
@runtime.paid_tool(PAY_CHARITY_UUID)
async def pay_charity(npub: NPUB_FIELD = "", dpop_token: str = "") -> dict[str, Any]:
    """Operator: pay everything owed to the charity, in one Lightning payment.

    `restricted`, so the runtime requires the caller to be the operator, proven.

    The charity share accrues match by match and settles as a batch, which is
    the shape this always needed: a single match's share can be smaller than the
    fee floor it would cost to route, so paying per match can cost more than it
    delivers.

    Every unpaid leg is claimed in ONE statement before the sats move, on the
    same primary key a single-match `pay_out` uses — so the two cannot pay the
    same match twice, and a second press collides on the key rather than at the
    node. The accounting stays per match while the payment happens once.

    A failure after the claim marks those legs failed rather than deleting them,
    so the debt comes back on its own and the attempt stays on the record.
    """
    try:
        return await payouts_mod.send_charity_arrears()
    except board_store.BoardError as exc:
        return {"success": False, "error_code": "refused", "error": str(exc)}
    except (OSError, RuntimeError) as exc:
        return _upstream(exc, "pay_charity")


@tool
@runtime.paid_tool(PAYOUT_HISTORY_UUID)
async def payout_history(
    limit: Annotated[int, Field(description="How many payments to return.")] = 25,
    npub: NPUB_FIELD = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Every payment attempted, and how it went.

    Free on purpose. A service that says 80% of every pot goes to a charity
    should let anybody check that sats actually left, not merely that a row was
    written saying they were owed. Failures are listed too — a payout history
    that only shows successes is a claim, not a record.
    """
    try:
        rows = await board_store.payouts(limit)
        # The destination is a wallet address and stays the operator's business;
        # what a reader needs is that a payment of a size happened, to which leg.
        public = [
            {k: r[k] for k in
             ("payout_id", "kind", "match_id", "amount_sats", "state", "started_at")
             if k in r}
            for r in rows
        ]
        return {"success": True, "payouts": public, **await board_store.obligations()}
    except (OSError, RuntimeError) as exc:
        return _upstream(exc, "payout_history")


@tool
@runtime.paid_tool(SET_CHARITY_UUID)
async def set_charity(
    name: Annotated[str, Field(description="The beneficiary's name, as players should see it.")],
    website: Annotated[str, Field(description="Where a player can check them out.")] = "",
    lightning_address: Annotated[
        str, Field(description="Where the charity share is actually sent, e.g. name@wallet.com")
    ] = "",
    npub: NPUB_FIELD = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Operator: name the beneficiary, its website and its Lightning address.

    `restricted`, so the runtime requires the caller to be the operator, proven.

    It was a constant in the source, which made changing who the money goes to a
    deployment. A charity can be replaced, renamed, or rotate its wallet, and
    none of that should need anybody to touch code.

    Changing this never rewrites history: every settlement records the
    beneficiary it actually paid at the time, so a player can always check where
    the money went rather than where it goes now.

    Args:
        name: The beneficiary's name, as players should see it.
        website: Where a player can check them out.
        lightning_address: Where the charity share is actually sent.
    """
    if not name.strip():
        return {"success": False, "error": "a beneficiary needs a name"}
    try:
        c = await board_store.set_charity(
            name.strip(), website.strip(), lightning_address.strip()
        )
        return {"success": True, **c}
    except (OSError, RuntimeError) as exc:
        return _upstream(exc, "set_charity")


@tool
@runtime.paid_tool(PAYOUT_UUID)
async def payout(npub: NPUB_FIELD = "", dpop_token: str = "") -> dict[str, Any]:
    """What you have said should happen to your winnings.

    `set` is False for a patron who has never said — which still reads as
    `donate`, because that is the default, but lets a screen show the difference
    between a choice made and a choice never faced.
    """
    try:
        return {"success": True, **await board_store.get_payout(npub)}
    except (OSError, RuntimeError) as exc:
        return _upstream(exc, "payout")


@tool
@runtime.paid_tool(SET_PAYOUT_UUID)
async def set_payout(
    donate: Annotated[
        bool, Field(description="Give your winnings to the charity. True by default.")
    ] = True,
    lightning_address: Annotated[
        str, Field(description="Where to send your share if you are keeping it.")
    ] = "",
    npub: NPUB_FIELD = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Say now what should happen if you win.

    Decided BEFORE the round, deliberately. Asking in the moment is asking
    somebody to make a decision about money with a trophy on the screen, and a
    winner who has never thought about it should still end the round with their
    share settled rather than owed.

    Donating is the default. Keeping it needs somewhere to send it, so a patron
    who turns donation off without giving an address is told so rather than
    quietly left with an unclaimable prize.

    Args:
        donate: Give your winnings to the charity.
        lightning_address: Where to send your share if you are keeping it.
    """
    address = lightning_address.strip()
    if not donate and not address:
        return {
            "success": False,
            "error": "to keep your winnings, give a Lightning address to send them to",
            "error_code": "no_wallet",
        }
    try:
        return {"success": True, **await board_store.set_payout(npub, address, donate)}
    except (OSError, RuntimeError) as exc:
        return _upstream(exc, "set_payout")


def main() -> None:
    """Main entry point for the server."""
    from tollbooth import validate_operator_tools

    missing = validate_operator_tools(mcp, "beesknees")
    if missing:
        import sys

        print(f"⚠ Missing base-catalog tools: {', '.join(missing)}", file=sys.stderr)
    mcp.run()


if __name__ == "__main__":
    main()
