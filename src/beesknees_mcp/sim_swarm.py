"""The swarm: when to join a thin hive, and how slowly to play it.

Two rules, and the second is the one that matters.

**Only join a hive that needs it.** A match starts when one hive reaches its
quorum, so a lone patron who has paid for a bee would otherwise sit in a lobby
waiting for seven strangers who are not coming. Sim bees make up the shortfall
and no more: they are there so a real player can play, not to fill the room.

**Except one.** An EMPTY lobby gets a single bee straight away, before anybody
arrives — because the first visitor to a room of eight empty combs is being
asked to be the one who starts something, and almost nobody wants to lead. They
will happily be the second. That bee is the only one seated for nobody, and the
rule that follows from it is the important half: a room holding sims and no
people is NOT topped up. Without that, a greeter would read as "a bee is
waiting", the swarm would fill the board around it, and a match of forty bots
and no players would run itself.

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
#: How long a LOBBY may sit before the sims prop it up.
#:
#: It was 45 seconds, on the reasoning that a real room should be given a chance
#: to fill itself. At this attendance that reasoning is backwards: almost every
#: room needs almost all of them, and the wait was only ever a human staring at
#: an empty meadow. Forty-five seconds of that, plus half a minute of seating
#: and twenty of grace, is how a three-minute wait was assembled out of parts
#: that each looked reasonable.
#:
#: Measured against the LOBBY's age rather than against how long this shift has
#: been watching, so a shift that starts beside a room already waiting seats at
#: once instead of restarting the clock on somebody else's patience.
PATIENCE_S = 12.0

#: How many bees are seated at a time.
#:
#: Seating was serial: a key minted, a coupon redeemed and a seat taken, forty
#: times over, which is eighty round trips of work that has no order to it —
#: half a minute with a human watching. Bounded rather than unbounded because
#: forty simultaneous joins, each debiting a fare and fencing a seat, is a
#: thundering herd aimed at the one service the patron is waiting on.
SEAT_BATCH = 8

#: How a sim bee is recognised in a board the server hands back.
#:
#: A shift knows its OWN bees by npub, and that is not the question here: the
#: greeter this shift must not mistake for a person was very likely seated by
#: the shift before it. The label is what travels. Patrons do not choose theirs
#: — the app sends eight characters of their npub — so a human labelled `sim-`
#: takes a deliberate direct call to `join_match`, and the only consequence is
#: that the swarm declines to fill the room around them.
SIM_LABEL = "sim-"

#: Bees seated into a room that is completely empty.
#:
#: One. The point is that nobody has to be first, and a second bot would start
#: making up numbers — which is the thing this module says it does not do.
GREETERS = 1

#: How many bees move at once in one pass.
#:
#: Moves used to be awaited one after another, in a plain `for` loop over every
#: bee. `top_up` learned this lesson for SEATING and fixed it; playing kept the
#: defect. The arithmetic is the same and so is the reason it has no order to
#: it: each bee acts on its own hive, on its own cooldown, and none of them is
#: waiting on the answer another one gets.
#:
#: Measured against the live service on 2026-09-08: one MCP round trip is about
#: 1.1s, so a serial pass over thirty-nine bees took **44 seconds** — and a bee
#: can only move once per pass. `human_pause` is tuned to put a move every
#: 1.2–2.25s and had been tuned twice, in the same direction, for feeling
#: sleepy. It was never the thing setting the pace. The loop was, at twenty
#: times the interval, and the patron watching saw a board where only their own
#: bee moved.
#:
#: Twenty rather than all forty: a pass then costs about two round trips, which
#: keeps `human_pause` the binding constraint again without aiming the whole
#: board's writes at a serverless host in one instant. Raising it shortens the
#: pass further; the ceiling that matters is the pause, not this.
MOVE_BATCH = 20

#: The most bees one shift will ever seat.
#:
#: It was `QUORUM - 1` — seven, exactly enough to complete a match-wide quorum
#: of eight around one human. Quorum belongs to a hive again, and seats are
#: dealt round-robin, so a hive reaches eight only when the whole board is
#: nearly full. One short of a full board is the honest ceiling now.
MAX_BEES = HIVES * QUORUM - 1


def is_sim(bee: dict[str, Any]) -> bool:
    """Was this bee seated by a swarm rather than by a person?"""
    return str((bee or {}).get("label") or "").startswith(SIM_LABEL)


def seats_wanted(state: dict[str, Any], mine: int) -> int:
    """How many bees to seat right now, given a board and what this shift holds.

    Pulled out of `top_up` because it is the whole policy and it used to be
    unreachable by a test: everything around it mints keys, redeems coupons and
    joins a live match.

    Three answers, in order:

    * a room that is not forming, or one where a hive has already reached
      quorum, needs nothing;
    * an EMPTY room gets one bee, so the next person through the door is not
      asked to be the first;
    * a room with people in it gets the seats that bring EVERY hive to quorum,
      because seats are dealt to the emptiest hive and that is how many the
      deal will absorb before any one hive gets there. A hive already over
      quorum contributes nothing, so a lopsided board is not charged for its
      full hives.

    And the one that is a refusal rather than an answer: a room holding only
    sims is left alone. It is what stops the greeter reading as somebody
    waiting and the swarm filling a board that no person is sitting at.
    """
    if str(state.get("state")) != "forming":
        return 0
    room = max(0, MAX_BEES - mine)
    seated = state.get("bees") or []

    if not seated:
        return min(GREETERS, room)
    if not any(not is_sim(b) for b in seated):
        return 0

    per: dict[int, int] = {}
    for b in seated:
        per[int(b["hive"])] = per.get(int(b["hive"]), 0) + 1
    if max(per.values()) >= QUORUM:
        return 0
    short = sum(max(0, QUORUM - per.get(h, 0)) for h in range(HIVES))
    return max(0, min(short, room))


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
        """Seat the bees `seats_wanted` asks for. Returns how many are out.

        The policy is in `seats_wanted`, which is a pure function of the board
        and can be read and tested without minting a key or joining a match.
        Everything below here is the doing of it.
        """
        want = seats_wanted(state, len(self.bees))
        if not want:
            return len(self.bees)

        # Strategies dealt UP FRONT, off `len(self.bees)` before anybody is
        # appended. That counter is what the round-robin used to read, and it
        # cannot be read concurrently: forty coroutines all seeing the same
        # length would every one of them be a digger.
        base = len(self.bees)
        plan = [
            (sim_bees.STRATEGIES[(base + i) % len(sim_bees.STRATEGIES)], base + i)
            for i in range(want)
        ]

        async def seat(strategy: str, n: int) -> SimBee | None:
            bee = await self._mint(strategy, n)
            r = await bee.hive.call("join_match", label=bee.label)
            if not r.get("success"):
                logger.warning("%s could not take a seat: %s", bee.label, r.get("error"))
                with contextlib.suppress(Exception):
                    await bee.hive.aclose()
                return None
            bee.hive_id, bee.seat = int(r.get("hive", 0)), int(r.get("seat", -1))
            bee.next_at = time.monotonic() + sim_bees.human_pause(self.rng)
            logger.info("%s took hive %d seat %d", bee.label, bee.hive_id, bee.seat)
            return bee

        # In batches, because a HUMAN IS WAITING and this used to be serial.
        # Forty bees is eighty round trips — a key minted, a coupon redeemed and
        # a seat taken, one after another — which is half a minute of somebody
        # watching an empty lobby for work that has no order to it.
        #
        # Bounded rather than all at once: forty simultaneous joins against a
        # serverless host, each debiting a fare and fencing a seat, is a
        # thundering herd aimed at the very service the patron is waiting on.
        for i in range(0, len(plan), SEAT_BATCH):
            done = await asyncio.gather(
                *(seat(st, n) for st, n in plan[i : i + SEAT_BATCH]),
                return_exceptions=True,
            )
            for got in done:
                if isinstance(got, SimBee):
                    self.bees.append(got)
                elif isinstance(got, BaseException):
                    logger.warning("a bee could not be seated: %s", got)
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

        # DECIDING is local and stays serial: it is arithmetic on a board
        # already in hand, and every bee reads the SAME snapshot whether the
        # calls that follow go one at a time or together. That matters for
        # correctness — batching does not make two bees likelier to choose one
        # cell than the old loop did, because the old loop never refetched
        # between moves either. The server fences the cell and refuses the
        # loser, exactly as before.
        plan: list[tuple[SimBee, Any]] = []
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
            plan.append((bee, move))

        async def act(bee: SimBee, move: Any) -> int:
            if move.kind == "seal":
                r = await bee.hive.call("seal", at_cell=move.cell)
            else:
                r = await bee.hive.call(move.kind, to_cell=move.cell)

            # However it went, the bee waits a human beat before trying again —
            # including after a refusal, or a bot that is being turned away
            # would hammer the board at machine speed for as long as it stayed
            # blocked.
            bee.next_at = time.monotonic() + sim_bees.human_pause(self.rng)
            if r.get("moved"):
                return 1
            if r.get("refused") or r.get("reason"):
                logger.debug("%s: %s", bee.label, r.get("refused") or r.get("reason"))
            return 0

        # ACTING goes together. Forty bees each waiting on the previous one's
        # round trip is a pass that takes as long as the sum of them, and a bee
        # moves at most once per pass.
        for i in range(0, len(plan), MOVE_BATCH):
            done = await asyncio.gather(
                *(act(bee, move) for bee, move in plan[i : i + MOVE_BATCH]),
                return_exceptions=True,
            )
            for got in done:
                if isinstance(got, int):
                    moves += got
                elif isinstance(got, BaseException):
                    logger.warning("a bee could not move: %s", got)
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

            if str(state.get("state")) == "forming":
                seated = state.get("bees") or []
                crowd = [b for b in seated if not is_sim(b)]
                empty = not seated

                # How long a PERSON has been waiting, which is neither how long
                # this shift has watched nor how old the oldest bee is. The
                # server's `waiting_s` measures the longest-seated bee, and
                # after a greeter that is the greeter — a figure with nothing to
                # do with anybody's patience. It is still the better number when
                # every bee in the room is a person, which is what it was added
                # for: a shift starting beside a room already waiting should not
                # restart the clock on somebody else's patience.
                first_seen = (first_seen or time.monotonic()) if crowd else None
                server_wait = (
                    float(state.get("waiting_s") or 0.0) if len(crowd) == len(seated) else 0.0
                )
                waited = max(server_wait, time.monotonic() - first_seen) if first_seen else 0.0

                # Only take a match there is time left to see through.
                room_to_finish = elapsed + ROUND_CEILING_S <= hard_cap
                # A greeter waits for nothing. The patience exists to give a
                # room a chance to fill itself, and an empty room has nobody in
                # it to do that — twelve seconds of an empty meadow is the
                # thing the greeter is for. `seats_wanted` decides WHAT to seat
                # and refuses a room of sims; this only decides WHEN to ask.
                if room_to_finish and (empty or waited >= PATIENCE_S):
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
