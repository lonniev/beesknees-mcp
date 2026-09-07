"""The two halves of the game must agree about how long a move takes.

The client simulates a match locally and the server enforces one over Neon, and
each carries its own copy of the cadence. Nothing cross-checks them: retune the
client and the live game silently keeps the old pace, with every test on both
sides still green. This is the cheapest guard that exists short of the server
serving its cadence to the client — it reads the CLIENT's constants out of the
TypeScript and holds the Python to them.

It is deliberately not a restatement of the numbers. A test that says "2.0 == 2.0"
proves only that somebody typed the same thing twice, which is the failure it is
supposed to catch.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from beesknees_mcp import board_store as store

RULES_TS = Path(__file__).resolve().parents[1] / "frontend" / "src" / "game" / "rules.ts"


def _client() -> dict[str, float]:
    """The client's cadence, in seconds, read from its source."""
    src = RULES_TS.read_text()
    tick_ms = int(re.search(r"export const TICK_MS = (\d+)", src).group(1))
    block = re.search(r"export const DEFAULT_RULES[^{]*\{(.*?)\n\};", src, re.DOTALL).group(1)

    def ticks(name: str) -> float:
        m = re.search(rf"\b{name}:\s*(\d+)", block)
        assert m, f"{name} is not in DEFAULT_RULES any more"
        return int(m.group(1)) * tick_ms / 1000

    return {
        "cooldown": ticks("cooldownTicks"),
        "dig_extra": ticks("digDelayTicks"),
        "seal": ticks("collapseTicks"),
    }


@pytest.mark.skipif(not RULES_TS.exists(), reason="frontend not checked out")
def test_the_server_moves_at_the_speed_the_client_shows() -> None:
    c = _client()
    assert store.COOLDOWN_S == c["cooldown"], (
        f"a move takes {store.COOLDOWN_S}s here and {c['cooldown']}s in the client"
    )
    assert store.DIG_EXTRA_S == c["dig_extra"], (
        f"a dig costs {store.DIG_EXTRA_S}s extra here and {c['dig_extra']}s in the client"
    )
    assert store.SEAL_S == c["seal"], (
        f"a seal takes {store.SEAL_S}s here and {c['seal']}s in the client"
    )


@pytest.mark.skipif(not RULES_TS.exists(), reason="frontend not checked out")
def test_a_cut_costs_eight_times_a_crawl() -> None:
    """The ratio, not the pace, is what the game is built on.

    Riding somebody else's shaft is only worth the detour while cutting your own
    is dear, so the gap between crawling and digging IS the game's one real
    choice. Measured over 250 rounds a side: closing it to 4:1 drops the rider
    from 18% of wins to 13% and the routing from 13.7 changes of mind to 8.3;
    closing it further, to a 2s crawl against a 5s cut, puts the rider on 4%.
    Widening it to 8:1 gives the most contested field of anything tried.

    A change here is a change to the game, not a comfort setting.
    """
    total = store.COOLDOWN_S + store.DIG_EXTRA_S
    assert total / store.COOLDOWN_S == 8.0, f"a cut now costs {total / store.COOLDOWN_S} crawls"
    assert _client()["seal"] == store.COOLDOWN_S, "a seal costs exactly one move"
