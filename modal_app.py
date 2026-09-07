"""The sim bees' home: a Modal app that keeps thin hives playable.

A match starts when one hive reaches its quorum of eight. A lone patron who has
paid for a bee would otherwise sit in a lobby waiting for seven strangers who
are not coming — so this watches for a room that has waited long enough, seats
just enough bees to start it, and plays them.

**Three things it deliberately is not.**

It is not privileged. Each sim bee is an ordinary patron with its own key,
signing its own proof, charged the same fares and refused by the same fences.

It is not free by exemption. It is free by COUPON, so the fares are still
computed and still recorded — a match part-filled by sim bees does not quietly
inflate what the pot claims to have raised. Minting that coupon needs the
operator's proof and therefore the operator's nsec, which never comes near this
runner: the operator mints it once and Modal is told only the code.

It is not fast. A bot decides in microseconds and a person cannot, so an
opponent that acts the instant it is allowed to has undone the cooldown
entirely. Every sim bee waits a human beat on top of its rest — see
`sim_bees.human_pause` — and that pause is the feature, not an oversight.

Deploy:  modal deploy modal_app.py
"""

from __future__ import annotations

import logging
import os

import modal

APP_NAME = "beesknees-sim-bees"

app = modal.App(APP_NAME)

image = (
    modal.Image.debian_slim(python_version="3.12")
    # The same pins the MCP itself runs, from the one source of truth. A second
    # dependency list here would drift from pyproject.toml and surface as a
    # version-skew bug months later, inside a live match.
    .pip_install_from_pyproject("pyproject.toml")
    .add_local_python_source("src")
)

#: The service to play on, and the coupon that makes it free. Neither is a
#: secret — the URL is public and a coupon code is a discount, not a key — but
#: they live in a Modal Secret so they can be changed without a redeploy.
config = modal.Secret.from_name("beesknees-sim", required_keys=["BEESKNEES_URL"])


@app.function(
    image=image,
    secrets=[config],
    # A shift SEES ITS ROUND OUT.
    #
    # The bees a shift seats live in its process, so a shift that ends mid-round
    # strands them where they stood. Simply making the shift long enough was not
    # enough: a twelve-minute shift only covers a round that starts near the
    # beginning of it, and a match starting at minute eleven still got one.
    #
    # So the shift takes new work for five minutes and then plays out whatever it
    # committed to, and it refuses a lobby it has not the time left to finish.
    # The timeout is the outermost ring and must sit outside the hard cap in
    # `run`, or Modal kills a shift that has bees still out.
    schedule=modal.Period(minutes=6),
    timeout=900,
    # Entirely I/O bound: it waits on HTTP and on its own deliberate pauses.
    cpu=0.5,
    memory=512,
)
def tend_hives() -> dict[str, int]:
    """One shift: watch the board, fill a thin hive, play the bees that are due."""
    import asyncio
    import sys

    sys.path.insert(0, "/root/src")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    log = logging.getLogger(APP_NAME)

    from beesknees_mcp.sim_swarm import run

    url = os.environ["BEESKNEES_URL"]
    coupon = os.environ.get("BEESKNEES_SIM_COUPON", "")
    if not coupon:
        log.warning(
            "no BEESKNEES_SIM_COUPON set — sim bees will be charged like anybody "
            "else and will stop the moment their balance runs out"
        )

    # Five minutes of taking matches; up to fourteen of playing them, which is
    # the ten-minute ceiling plus room to settle, inside the 900s timeout.
    tally = asyncio.run(run(url, coupon, seconds=5 * 60, hard_cap=840))
    log.info("shift over: %s", tally)
    return tally


@app.local_entrypoint()
def main() -> None:
    """Run one shift from a laptop, against whatever BEESKNEES_URL points at."""
    print(tend_hives.remote())
