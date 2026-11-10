"""The ledger and the charity are read by anyone, without saying who they are.

Both are the same for every caller. With an ``npub`` parameter, a caller that
named an npub it had not proven was refused ``proof_required``, so a signed-out
browser that still remembered one saw a ledger of zeros. They take no npub,
as ``service_status`` takes none, and the site lists them as bootstrap tools so
the client never adds one.
"""

import asyncio
import re
from pathlib import Path

from beesknees_mcp import server

PUBLIC = ("settlement_history", "charity")
ROOT = Path(__file__).resolve().parent.parent


def _schemas() -> dict[str, list[str]]:
    tools = asyncio.run(server.mcp.list_tools())
    return {t.name: list((t.parameters or {}).get("properties", {})) for t in tools}


def test_the_public_reads_take_no_npub():
    schemas = _schemas()
    for name in PUBLIC:
        assert "npub" not in schemas[f"beesknees_{name}"], name


def test_the_site_sends_them_no_npub():
    config = (ROOT / "frontend" / "src" / "tollbooth.ts").read_text()
    listed = re.search(r"extraBootstrapTools:\s*\[([^\]]*)\]", config)
    assert listed, "tollbooth.ts names no extraBootstrapTools"
    for name in PUBLIC:
        assert f'"{name}"' in listed.group(1), name
