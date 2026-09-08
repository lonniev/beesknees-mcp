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
import contextlib
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any

from beesknees_mcp import geometry as geo
from beesknees_mcp import sim_bees
from beesknees_mcp.sim_client import Hive, new_key

logger = logging.getLogger(__name__)

#: Seats a HIVE needs before a match starts. Mirrors board_store.QUORUM.
QUORUM = 8

#: Hives on the board. Mirrors board_store.HIVES.
HIVES = 5
#: Leave a real room room to fill itself before propping it up. A hive that has
#: had a human in it for this long is not going to reach eight on its own.
PATIENCE_S = 45.0
#: Never seat more than this many, however empty the room is. A match of eight
#: robots is not a game anybody is playing.
#: The most bees one shift will ever seat.
#:
#: It was `QUORUM - 1` — seven, exactly enough to complete a match-wide quorum
#: of eight around one human. Quorum belongs to a hive again, and seats are
#: dealt round-robin, so a hive reaches eight only when the whole board is
#: nearly full. One short of a full board is the honest ceiling now.
MAX_BEES = HIVES * QUORUM - 1


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
        """Seat enough bees to bring a hive to quorum. Returns how many.

        `QUORUM - fullest` was the old sum, and it was right for a quorum
        counted across the match: one bee waiting, seven seated, eight, go.
        Quorum belongs to a HIVE again and the server deals seats to the
        emptiest hive, so bees added here do not pile onto the fullest one —
        they spread. Seating `QUORUM - fullest` of them raises the fullest hive
        by about a fifth of that, and the lobby never opens.

        What is actually needed is the seats that bring EVERY hive to quorum,
        because that is how many the deal will absorb before any one hive gets
        there. A hive already over quorum contributes nothing, so a lopsided
        board is not charged for its full hives.
        """
        if str(state.get("state")) != "forming":
            return 0
        seated = state.get("bees") or []
        if not seated:
            return 0  # nobody is waiting, so nobody needs company

        per: dict[int, int] = {}
        for b in seated:
            per[int(b["hive"])] = per.get(int(b["hive"]), 0) + 1
        if max(per.values()) >= QUORUM:
            return 0
        short = sum(max(0, QUORUM - per.get(h, 0)) for h in range(HIVES))

        want = min(short, MAX_BEES - len(self.bees))
        for i in range(max(0, want)):
            # `len(self.bees)` alone: it grows with each append, so adding `i`
            # as well advanced the cycle twice a bee and only ever produced
            # diggers and sealers — the rider and the driller, half the field the
            # simulation was tuned against, never appeared at all.
            strategy = sim_bees.STRATEGIES[len(self.bees) % len(sim_bees.STRATEGIES)]
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

    async def forget_finished(self, state: dict[str, Any]) -> int:
        """A round is over; the bees that played it are spent. Returns how many.

        Their connections go with them. This used to `clear()` the list and
        leave every bee's `httpx.AsyncClient` open with its own pool — harmless
        at the seven bees a match-wide quorum needed, and not harmless now that
        a per-hive quorum wants about forty and a shift plays several rounds.
        A cleared list is also an unreachable one: `aclose()` at the end of the
        shift could only close the cohort still in it.
        """
        if str(state.get("state")) not in ("ended", "settled"):
            return 0
        spent = self.bees
        self.bees = []
        for b in spent:
            with contextlib.suppress(Exception):
                await b.hive.aclose()
        return len(spent)


#: How long a round can possibly last: the server's ceiling, plus room to settle.
ROUND_CEILING_S = 11 * 60


async def run(
    url: str, coupon: str, seconds: float, hard_cap: float = 840.0, log: Any = logger
) -> dict[str, int]:
    """Take work for `seconds`, then SEE IT THROUGH — up to `hard_cap`.

    The bees a shift seats exist only in this process, so a shift that ends
    mid-round strands them: they stop wherever they stood and the hive fills with
    bees that arrived and went to sleep.

    Making the shift longer than a round was not enough, and the reason is worth
    stating because it is the sort of thing that reads as fixed. A twelve-minute
    shift only covers a round that starts near the beginning of it — a match
    beginning at minute eleven still got one minute. The bees froze wherever they
    were, which looked like a bug about doors because a door is where a bee is a
    minute into a round.

    So the shift has two clocks. It stops TAKING new work after `seconds`, and
    then keeps playing whatever it already committed to until that round ends —
    bounded by `hard_cap`, which must sit inside Modal's own timeout. It never
    joins a match it cannot see through.
    """
    swarm = Swarm(url=url, coupon=coupon)
    # One throwaway identity just to read the board. `match_state` is free and
    # needs no seat, so the watcher never joins anything and never spends.
    reader = Hive(url, *new_key())
    started = time.monotonic()
    first_seen: float | None = None
    tally = {"joined": 0, "moves": 0, "polls": 0, "retired": 0}
    try:
        while True:
            state = await reader.call("match_state")
            tally["polls"] += 1
            if not state.get("success"):
                await asyncio.sleep(3)
                continue

            elapsed = time.monotonic() - started
            running = str(state.get("state")) == "running"
            committed = bool(swarm.bees) and running

            if str(state.get("state")) == "forming" and (state.get("bees") or []):
                first_seen = first_seen or time.monotonic()
                # Two conditions, and the second is the one that stops bees being
                # stranded: give the room a chance to fill itself, AND only take
                # a match there is time left to see through.
                room_to_finish = elapsed + ROUND_CEILING_S <= hard_cap
                if time.monotonic() - first_seen >= PATIENCE_S and room_to_finish:
                    tally["joined"] = await swarm.top_up(state)
                elif not room_to_finish and not swarm.bees:
                    logger.info("leaving this lobby to the next shift — not enough of mine left")
            else:
                first_seen = None

            tally["moves"] += await swarm.play_once(state)
            tally["retired"] += await swarm.forget_finished(state)

            # Stop taking work after the window, but never walk out on bees that
            # are still playing.
            if elapsed >= seconds and not committed:
                break
            if elapsed >= hard_cap:
                logger.warning("hard cap reached with %d bees still out", len(swarm.bees))
                break

            # The SERVER says how often to ask — a second while a match is
            # running, four while a lobby waits. Honouring it means one cadence
            # algorithm rather than every client inventing its own, and it is a
            # valve the operator can turn under load. A shift is long, so a fixed
            # fast poll would be thousands of requests an hour to watch nothing.
            await asyncio.sleep(max(0.5, float(state.get("poll_after_ms") or 1000) / 1000))
    finally:
        await reader.aclose()
        await swarm.aclose()
    return tally
