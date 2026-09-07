"""The swarm: when to join a thin hive, and how slowly to play it.

Two rules, and the second is the one that matters.

**Only join a hive that needs it.** A match starts when one hive reaches its
quorum, so a lone patron who has paid for a bee would otherwise sit in a lobby
waiting for seven strangers who are not coming. Sim bees make up the shortfall
and no more: they are there so a real player can play, not to fill the room.

**Never move faster than a person could.** A bot decides in microseconds; the
cooldown exists so money cannot buy speed, and it is undone entirely by an
opponent that answers the instant it is allowed to. Each bee waits a human beat
on top of its cooldown, jittered, so the eight of them do not move in lockstep.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any

from beesknees_mcp import geometry as geo
from beesknees_mcp import sim_bees
from beesknees_mcp.sim_client import Hive, new_key

logger = logging.getLogger(__name__)

#: Seats a hive needs before a match starts. Mirrors board_store.QUORUM.
QUORUM = 8
#: Leave a real room room to fill itself before propping it up. A hive that has
#: had a human in it for this long is not going to reach eight on its own.
PATIENCE_S = 45.0
#: Never seat more than this many, however empty the room is. A match of eight
#: robots is not a game anybody is playing.
MAX_BEES = QUORUM - 1


@dataclass
class SimBee:
    nsec: str
    npub: str
    strategy: str
    hive: Hive
    seat: int = -1
    hive_id: int = -1
    #: Wall clock before which this bee will not act, even if the board allows.
    next_at: float = 0.0
    label: str = ""


@dataclass
class Swarm:
    url: str
    coupon: str = ""
    rng: random.Random = field(default_factory=random.Random)
    bees: list[SimBee] = field(default_factory=list)

    async def aclose(self) -> None:
        for b in self.bees:
            await b.hive.aclose()

    async def _mint(self, strategy: str, n: int) -> SimBee:
        nsec, npub = new_key()
        bee = SimBee(
            nsec=nsec,
            npub=npub,
            strategy=strategy,
            hive=Hive(self.url, nsec, npub),
            label=f"sim-{strategy}-{n}",
        )
        if self.coupon:
            # Free to play, by coupon rather than by exemption. The fares are
            # still computed, still recorded, and still land in the pot — they
            # are simply discounted to nothing, so a match part-filled by sim
            # bees does not quietly inflate what the pot claims to have raised.
            r = await bee.hive.call("redeem_coupon", code=self.coupon)
            if not r.get("success"):
                logger.warning("%s could not redeem %s: %s", bee.label, self.coupon, r.get("error"))
        return bee

    async def top_up(self, state: dict[str, Any]) -> int:
        """Seat enough bees to give the fullest hive its quorum. Returns how many."""
        if str(state.get("state")) != "forming":
            return 0
        seated = state.get("bees") or []
        if not seated:
            return 0  # nobody is waiting, so nobody needs company

        per: dict[int, int] = {}
        for b in seated:
            per[int(b["hive"])] = per.get(int(b["hive"]), 0) + 1
        fullest = max(per.values())
        short = QUORUM - fullest
        if short <= 0:
            return 0

        want = min(short, MAX_BEES - len(self.bees))
        for i in range(max(0, want)):
            strategy = sim_bees.STRATEGIES[(len(self.bees) + i) % len(sim_bees.STRATEGIES)]
            bee = await self._mint(strategy, len(self.bees) + i)
            r = await bee.hive.call("join_match", label=bee.label)
            if not r.get("success"):
                logger.warning("%s could not take a seat: %s", bee.label, r.get("error"))
                await bee.hive.aclose()
                continue
            bee.hive_id, bee.seat = int(r.get("hive", 0)), int(r.get("seat", -1))
            bee.next_at = time.monotonic() + sim_bees.human_pause(self.rng)
            self.bees.append(bee)
            logger.info("%s took hive %d seat %d", bee.label, bee.hive_id, bee.seat)
        return len(self.bees)

    def _board(self, state: dict[str, Any], hive_id: int) -> sim_bees.Board:
        g = geo.make_geometry()
        seed = int(state.get("seed") or 0)
        layout = geo.hive_board(g, (seed * 31 + hive_id * 7919) % (2**31))
        return sim_bees.Board(
            g=g,
            layout=layout,
            open_cells=frozenset(
                int(c["cell"]) for c in state.get("open_cells") or [] if int(c["hive"]) == hive_id
            ),
            taken_pollen=frozenset(
                int(c["cell"]) for c in state.get("taken_pollen") or [] if int(c["hive"]) == hive_id
            ),
            occupied=frozenset(
                int(b["cell"])
                for b in state.get("bees") or []
                if int(b["hive"]) == hive_id and str(b["phase"]) != "done"
            ),
        )

    async def play_once(self, state: dict[str, Any]) -> int:
        """Move every sim bee whose own clock has come round. Returns moves made."""
        if str(state.get("state")) != "running":
            return 0
        by_npub = {str(b["npub"]): b for b in state.get("bees") or []}
        now = time.monotonic()
        moves = 0

        for bee in self.bees:
            row = by_npub.get(bee.npub)
            if not row or str(row["phase"]) == "done" or now < bee.next_at:
                continue

            board = self._board(state, int(row["hive"]))
            # A bee is not an obstacle to itself.
            board = sim_bees.Board(
                g=board.g,
                layout=board.layout,
                open_cells=board.open_cells,
                taken_pollen=board.taken_pollen,
                occupied=board.occupied - {int(row["cell"])},
            )
            move = sim_bees.choose(board, row, bee.strategy, self.rng)
            if move.kind == "wait":
                bee.next_at = now + sim_bees.human_pause(self.rng)
                continue

            if move.kind == "seal":
                r = await bee.hive.call("seal", at_cell=move.cell)
            else:
                r = await bee.hive.call(move.kind, to_cell=move.cell)

            # However it went, the bee waits a human beat before trying again —
            # including after a refusal, or a bot that is being turned away would
            # hammer the board at machine speed for as long as it stayed blocked.
            bee.next_at = time.monotonic() + sim_bees.human_pause(self.rng)
            if r.get("moved"):
                moves += 1
            elif r.get("refused") or r.get("reason"):
                logger.debug("%s: %s", bee.label, r.get("refused") or r.get("reason"))
        return moves

    def forget_finished(self, state: dict[str, Any]) -> None:
        """A round is over; the bees that played it are spent."""
        if str(state.get("state")) in ("ended", "settled"):
            self.bees.clear()


async def run(url: str, coupon: str, seconds: float, log: Any = logger) -> dict[str, int]:
    """Watch one service for `seconds`, filling thin hives and playing them."""
    swarm = Swarm(url=url, coupon=coupon)
    # One throwaway identity just to read the board. `match_state` is free and
    # needs no seat, so the watcher never joins anything and never spends.
    reader = Hive(url, *new_key())
    started = time.monotonic()
    first_seen: float | None = None
    tally = {"joined": 0, "moves": 0, "polls": 0}
    try:
        while time.monotonic() - started < seconds:
            state = await reader.call("match_state")
            tally["polls"] += 1
            if not state.get("success"):
                await asyncio.sleep(3)
                continue

            if str(state.get("state")) == "forming" and (state.get("bees") or []):
                first_seen = first_seen or time.monotonic()
                # Give the room a chance to fill itself before propping it up.
                if time.monotonic() - first_seen >= PATIENCE_S:
                    tally["joined"] = await swarm.top_up(state)
            else:
                first_seen = None

            tally["moves"] += await swarm.play_once(state)
            swarm.forget_finished(state)
            await asyncio.sleep(0.7)
    finally:
        await reader.aclose()
        await swarm.aclose()
    return tally
