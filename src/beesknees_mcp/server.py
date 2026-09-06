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

from fastmcp import FastMCP
from tollbooth.credential_templates import CredentialTemplate, FieldSpec
from tollbooth.credential_validators import validate_btcpay_creds
from tollbooth.runtime import OperatorRuntime, register_standard_tools
from tollbooth.tool_identity import STANDARD_IDENTITIES, ToolIdentity

from beesknees_mcp import __version__

logger = logging.getLogger(__name__)

SITE = "https://beesknees.tollbooth-dpyc.com"

mcp = FastMCP(
    "beesknees-mcp",
    instructions=(
        "The Bee's Knees — a race to the queen, monetized via Tollbooth DPYC "
        "Bitcoin Lightning micropayments.\n\n"
        "## How a round goes\n"
        "Buy a worker bee a seat with beesknees_join_match. Four hives run at "
        "once, twelve seats each, and the match begins as soon as any hive "
        "holds eight bees.\n\n"
        "Your bee has three acts: reach a flower, carry the pollen back through "
        "the hive wall, then tunnel inward to the queen. The first bee to reach "
        "a queen — in ANY of the four hives — takes the round.\n\n"
        "## The one real choice\n"
        "Cutting fresh comb is slow, and the cell you cut is open to everyone "
        "afterwards. Riding a shaft somebody else paid for is fast, and they "
        "can bring it down on you. beesknees_fly moves through open ground, "
        "beesknees_dig cuts new, and beesknees_seal buries an open cell.\n\n"
        "A bee acts once per cooldown, measured on the clock, so no amount of "
        "spending buys a faster bee. What spending buys is interference.\n\n"
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
#
# None yet. The catalog above is frozen and the runtime is wired, but every
# domain tool needs the shared board in Neon — a match is cross-patron state,
# which is new for this fleet, and each motion has to land as a single fenced
# statement because the Neon HTTP driver gives us no transaction to wrap two in.
#
# Registering them ahead of that store would put tools on the wire that take a
# fare and then fail, which is worse than tools that are not there yet. The
# identities are declared now so their UUIDs are minted once and never move.


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
