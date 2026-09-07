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

import logging
from typing import Annotated, Any

from fastmcp import FastMCP
from pydantic import Field
from tollbooth.credential_templates import CredentialTemplate, FieldSpec
from tollbooth.credential_validators import validate_btcpay_creds
from tollbooth.runtime import OperatorRuntime, register_standard_tools
from tollbooth.tool_identity import STANDARD_IDENTITIES, ToolIdentity

from beesknees_mcp import __version__, board_store, geometry, match_flow

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


async def _charged(npub: str, match_id: str, tool: str) -> None:
    """Record what this call cost, into the pot.

    The fare is read from the operator's own pricing model rather than from the
    runtime, deliberately: `_last_debit_cost` is a single slot on a process-wide
    singleton, so with sixty patrons moving at once two calls clobber each
    other's value before either body reads it. A pot built on that would be
    quietly wrong in exactly the situation the game is designed to create.
    """
    identity = next((t for t in _DOMAIN_TOOLS if t.capability == tool), None)
    sats = 0
    if identity is not None and identity.category != "free":
        try:
            cost, denial = await runtime._resolve_pricing(
                identity.tool_id, f"beesknees_{tool}", identity.category, None
            )
            sats = 0 if denial else int(cost)
        except Exception as exc:  # noqa: BLE001
            # A pot that silently loses fares is worse than a noisy one.
            logger.error("could not price %s for the pot: %s", tool, exc)
    await board_store.record_fare(match_id, npub, tool, sats)


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

        if since_seq >= 0 and seq <= since_seq:
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
        return {"success": True, "beneficiary": match_flow.BENEFICIARY,
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
    seat = await match_flow.join(npub, label[:32] or "A bee")
    await _charged(npub, str(seat["match_id"]), "join_match")
    await match_flow.advance()
    return {"success": True, **seat}


async def _motion(npub: str, tool_name: str, run: Any) -> dict[str, Any]:
    """Shared shell for fly / dig / seal.

    A malformed request RAISES, so `paid_tool` rolls the fare back — the patron
    got nothing and it would be trivially spammable. A LOST RACE returns instead
    and is charged: the board moved, the attempt was real, and somebody else
    simply got there first.
    """
    live = await board_store.live_matches()
    running = [m for m in live if str(m["state"]) == "running"]
    if not running:
        raise ValueError("no match is running")
    mid = str(running[0]["match_id"])
    result = await run(mid)
    await _charged(npub, mid, tool_name)
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
    if str(row.get("prize_state")) != "unclaimed":
        return {"success": True, "already": str(row["prize_state"]), "match_id": match_id}

    donate = choice.strip().lower() == "donate"
    await board_store._exec(
        f"UPDATE {board_store.SETTLEMENTS} SET prize_state = $2 WHERE match_id = $1",
        [match_id, "donated" if donate else "kept"],
    )
    return {"success": True, "match_id": match_id,
            "outcome": "donated to " + match_flow.BENEFICIARY if donate else "kept as credit"}


# ── Operator ─────────────────────────────────────────────────────────────


@tool
@runtime.paid_tool(TICK_UUID)
async def tick(npub: NPUB_FIELD = "", dpop_token: str = "") -> dict[str, Any]:
    """Operator: open, close and settle matches.

    `restricted`, so the runtime requires the caller to be the operator, proven.
    This is the cron entry point; `check_now` is the same work without authority.
    """
    return {"success": True, **await match_flow.advance()}


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
