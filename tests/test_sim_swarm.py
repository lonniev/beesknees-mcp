"""Who the swarm seats, and — the important half — who it refuses to seat for.

`seats_wanted` was pulled out of `Swarm.top_up` so this file can exist at all:
everything around it mints keys, redeems coupons and joins a live match, and
the policy was reachable only by running one.
"""

from __future__ import annotations

import pytest

from beesknees_mcp.sim_swarm import (
    GREETERS,
    HIVES,
    MAX_BEES,
    QUORUM,
    is_sim,
    seats_wanted,
)


def bee(hive: int, label: str) -> dict:
    return {"hive": hive, "seat": 0, "npub": f"npub1{label}", "label": label}


def forming(*bees: dict, **extra) -> dict:
    return {"state": "forming", "bees": list(bees), **extra}


# ── Nobody wants to be first ─────────────────────────────────────────────


def test_an_empty_room_gets_one_bee():
    """The whole point. A visitor arriving at eight empty combs is being asked
    to start something; almost nobody wants to lead, and everybody will follow."""
    assert seats_wanted(forming(), 0) == GREETERS
    assert GREETERS == 1, "a second bot would be making up numbers"


def test_the_greeter_is_seated_for_nobody_and_only_once():
    # Seated, the room is no longer empty — and holds no people — so the next
    # look asks for nothing. Without this, every poll would add another.
    after = forming(bee(0, "sim-digger-0"))
    assert seats_wanted(after, 1) == 0


def test_a_room_of_sims_is_never_filled_out():
    """The rule that makes the greeter safe.

    A greeter reads exactly like a bee waiting. If that were enough to trigger
    a top-up, the swarm would fill the board around it and run a match of forty
    bots and no players — spending a shift, settling a pot and producing a
    result nobody was present for.
    """
    all_sims = forming(*(bee(h, f"sim-cautious-{h}") for h in range(HIVES)))
    assert seats_wanted(all_sims, 5) == 0


# ── Once somebody is actually there ──────────────────────────────────────


def test_one_person_waiting_is_topped_up_to_a_full_board():
    # Seats are dealt to the EMPTIEST hive, so a hive reaches quorum only when
    # the whole board is nearly full. What is needed is every hive's shortfall.
    want = seats_wanted(forming(bee(0, "ab12cd34")), 0)
    assert want == HIVES * QUORUM - 1


def test_a_person_beside_the_greeter_still_counts():
    room = forming(bee(0, "sim-digger-0"), bee(1, "ab12cd34"))
    assert seats_wanted(room, 1) == HIVES * QUORUM - 2


def test_a_hive_at_quorum_needs_nothing_more():
    full = forming(*(bee(0, f"p{i}") for i in range(QUORUM)))
    assert seats_wanted(full, 0) == 0


def test_a_full_hive_is_not_charged_for_seats_it_cannot_take():
    # Seven in one hive and one person in another: the shortfall counts what
    # each hive is missing, not `QUORUM * HIVES` less the heads.
    room = forming(*(bee(0, f"p{i}") for i in range(7)), bee(1, "q"))
    assert seats_wanted(room, 0) == (QUORUM - 7) + (QUORUM - 1) + (QUORUM * 3)


@pytest.mark.parametrize("state", ["running", "ended", "settled", "abandoned"])
def test_nothing_is_seated_into_a_match_that_is_not_forming(state):
    assert seats_wanted({"state": state, "bees": []}, 0) == 0
    assert seats_wanted({"state": state, "bees": [bee(0, "p")]}, 0) == 0


def test_a_shift_never_exceeds_its_own_ceiling():
    assert seats_wanted(forming(bee(0, "p")), MAX_BEES) == 0
    assert seats_wanted(forming(bee(0, "p")), MAX_BEES - 3) == 3
    # And the greeter is bound by it too, rather than being a special case
    # that walks past the cap.
    assert seats_wanted(forming(), MAX_BEES) == 0


# ── Telling a bot from a person ──────────────────────────────────────────


def test_a_sim_is_known_by_its_label():
    # By label, not by npub: the greeter this shift must not mistake for a
    # person was very likely seated by the shift before it, and only the label
    # travels in `match_state`.
    assert is_sim({"label": "sim-digger-3"})
    assert not is_sim({"label": "ab12cd34"})


def test_a_bee_with_no_label_is_treated_as_a_person():
    """The safe direction. Read as a sim, a person with a missing label would
    have the room left unfilled around them and wait for nobody."""
    assert not is_sim({})
    assert not is_sim({"label": None})
    assert seats_wanted(forming({"hive": 0, "seat": 0, "npub": "npub1x"}), 0) > 0


# ── A pass is not a queue ────────────────────────────────────────────────


class FakeHive:
    """A hive whose calls take real (tiny) time, so serial and concurrent differ."""

    LATENCY_S = 0.05

    def __init__(self, clock: list[float]) -> None:
        self.clock = clock
        self.calls: list[dict] = []

    async def call(self, tool: str, **kw):
        import asyncio
        import time as _t

        start = _t.monotonic()
        await asyncio.sleep(self.LATENCY_S)
        self.calls.append({"tool": tool, "started": start, **kw})
        return {"moved": True}

    async def aclose(self) -> None:
        return None


def _running_board(n: int) -> tuple[dict, list]:
    """`n` sim bees, all due, all on a board that is under way."""
    from beesknees_mcp.sim_swarm import SimBee

    bees, rows = [], []
    for i in range(n):
        npub = f"npub1sim{i}"
        bees.append(SimBee(nsec="", npub=npub, strategy="digger",
                           hive=FakeHive([]), hive_id=0, seat=i,
                           next_at=0.0, label=f"sim-digger-{i}"))
        rows.append({"hive": 0, "seat": i, "npub": npub, "label": f"sim-digger-{i}",
                     "cell": 200 + i, "phase": "forage"})
    state = {"state": "running", "seed": 7, "bees": rows,
             "open_cells": [], "taken_pollen": []}
    return state, bees


@pytest.mark.asyncio
async def test_a_pass_does_not_cost_the_sum_of_its_round_trips():
    """THE BUG the patron saw: a board of forty where only their own bee moved.

    Moves were awaited one after another, so a pass took the SUM of the round
    trips — measured at 44s against the live service — and a bee moves at most
    once per pass. `human_pause` puts a move every 1.2-2.25s and was tuned twice
    for feeling sleepy; it was never what set the pace.
    """
    import time as _t

    from beesknees_mcp.sim_swarm import MOVE_BATCH, Swarm

    n = 20
    state, bees = _running_board(n)
    swarm = Swarm(url="", bees=bees)

    start = _t.monotonic()
    moved = await swarm.play_once(state)
    elapsed = _t.monotonic() - start

    assert moved == n, f"only {moved} of {n} bees moved"
    serial = n * FakeHive.LATENCY_S
    assert elapsed < serial / 2, (
        f"a pass over {n} bees took {elapsed:.2f}s; serial would be {serial:.2f}s. "
        "The moves are still queued behind one another."
    )
    assert MOVE_BATCH >= n, "this test is meant to fit in one batch"


@pytest.mark.asyncio
async def test_every_bee_still_gets_its_own_human_beat():
    """Concurrency must not hand the pacing back to the machine.

    The cooldown stops money buying speed and `human_pause` stops silicon
    buying it. A batched pass that forgot to re-arm each bee would let the
    whole board act again on the next tick.
    """
    state, bees = _running_board(6)
    from beesknees_mcp.sim_swarm import Swarm

    swarm = Swarm(url="", bees=bees)
    await swarm.play_once(state)
    for b in bees:
        assert b.next_at > 0, f"{b.label} was left free to act immediately"


@pytest.mark.asyncio
async def test_a_bee_that_is_not_due_is_left_alone():
    import time as _t

    from beesknees_mcp.sim_swarm import Swarm

    state, bees = _running_board(4)
    for b in bees[:2]:
        b.next_at = _t.monotonic() + 999
    assert await Swarm(url="", bees=bees).play_once(state) == 2


@pytest.mark.asyncio
async def test_nothing_moves_in_a_match_that_is_not_running():
    from beesknees_mcp.sim_swarm import Swarm

    state, bees = _running_board(4)
    state["state"] = "forming"
    assert await Swarm(url="", bees=bees).play_once(state) == 0
