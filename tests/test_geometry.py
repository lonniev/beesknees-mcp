"""The board's invariants, asserted the same way the TypeScript asserts them.

These deliberately mirror `frontend/src/game/rules.test.ts`. Three copies of the
same arithmetic exist — this module, the client's engine, and the renderer — and
nothing in the running system reports that they have drifted. The game simply
starts rejecting moves a player can see are legal. Keeping the assertions
parallel is what makes a drift fail a build instead of a match.
"""

from __future__ import annotations

import pytest

from beesknees_mcp.geometry import (
    COMB,
    OPEN,
    Geometry,
    can_seal,
    idx,
    initial_state,
    inward,
    is_meadow,
    make_geometry,
    mouth_cells,
    neighbors,
    outward,
    ring_of,
    slot_of,
)


@pytest.fixture
def g() -> Geometry:
    return make_geometry()


def test_rings_narrow_toward_the_queen(g: Geometry) -> None:
    """The funnel is the reason the board is round. Assert it is really there."""
    for r in range(2, g.max_ring + 1):
        assert g.size[r] >= g.size[r - 1], f"ring {r} is narrower than ring {r - 1}"
    # And that it BITES, expressed against the thing that makes it matter — the
    # number of bees — rather than a ratio tuned to one board. An earlier version
    # asserted "> 6", which was calibrated to a 24-ring hive and failed the
    # moment the board was retuned to 14, for no gameplay reason at all.
    #
    # The wall must seat everyone with room to spare, and the last ring before
    # the chamber must hold fewer cells than there are bees, so arriving is
    # contested rather than parallel.
    seats = 12
    assert g.size[g.wall] >= seats, "the wall must fit a full hive spread out"
    assert g.size[1] < seats, "the innermost ring must be narrower than the field"
    assert g.size[0] == 1, "the queen's chamber is one cell"


def test_the_shipped_board_is_the_one_that_was_measured(g: Geometry) -> None:
    """A silent change here retunes the game without retuning the simulation.

    Fourteen rings is not a taste: with the stagger rule it gives a round near
    two and a half minutes, a good player winning about 3.5x their uniform
    share, and the straight-line driller winning nothing at all.
    """
    assert (g.wall, g.meadow_rings) == (14, 4)
    assert g.cells == 365


def test_every_cell_round_trips_through_ring_and_slot(g: Geometry) -> None:
    for c in range(g.cells):
        assert idx(g, ring_of(g, c), slot_of(g, c)) == c


def test_inward_and_outward_are_consistent_inverses(g: Geometry) -> None:
    for r in range(1, g.max_ring + 1):
        for i in range(g.size[r]):
            inw = inward(g, r, i)
            assert inw is not None
            back = outward(g, ring_of(g, inw), slot_of(g, inw))
            assert idx(g, r, i) in back, f"ring {r} slot {i} lost on the way back"


def test_adjacency_is_symmetric(g: Geometry) -> None:
    """No one-way passages: a bee that can step in can always step back out."""
    for c in range(g.cells):
        for n in neighbors(g, c):
            assert c in neighbors(g, n), f"{c} -> {n} is one-way"


def test_tangential_movement_wraps_the_ring(g: Geometry) -> None:
    r = 10
    first = idx(g, r, 0)
    last = idx(g, r, g.size[r] - 1)
    assert last in neighbors(g, first), "a ring must close on itself"


def test_the_queen_has_no_inward_neighbour(g: Geometry) -> None:
    assert inward(g, 0, 0) is None


def test_a_fresh_board_is_solid_hive_and_open_meadow(g: Geometry) -> None:
    state = initial_state(g)
    for r in range(g.wall + 1, g.max_ring + 1):
        for i in range(g.size[r]):
            assert state[idx(g, r, i)] == OPEN
    for r in range(g.wall):
        for i in range(g.size[r]):
            assert state[idx(g, r, i)] == COMB, f"ring {r} should start solid"
    assert sum(state[c] == OPEN for c in range(g.offset[g.wall], g.offset[g.wall] + g.size[g.wall])) == 4


def test_the_meadow_is_everything_above_the_wall(g: Geometry) -> None:
    assert not is_meadow(g, idx(g, g.wall, 0))
    assert is_meadow(g, idx(g, g.wall + 1, 0))
    assert is_meadow(g, idx(g, g.max_ring, 0))


def test_the_prize_and_the_air_can_never_be_sealed(g: Geometry) -> None:
    """Burying either would end a round that nobody could then win."""
    assert not can_seal(g, 0), "the queen's chamber must stay reachable"
    assert not can_seal(g, idx(g, g.max_ring, 3)), "air is not diggable"
    assert not can_seal(g, idx(g, g.wall + 1, 0))


def test_doors_cannot_be_sealed_shut(g: Geometry) -> None:
    """One early seal on a door would wall the field out of its own hive."""
    for m in mouth_cells(g):
        assert not can_seal(g, m)
    # A cell of wall that is not a door is fair game once somebody cuts it.
    wall_slots = {slot_of(g, m) for m in mouth_cells(g)}
    other = next(i for i in range(g.size[g.wall]) if i not in wall_slots)
    assert can_seal(g, idx(g, g.wall, other))


def test_a_bee_can_always_reach_the_queen_by_digging(g: Geometry) -> None:
    """There is no cell the board can strand somebody in.

    Solid comb is passable at a price, so connectivity has to hold over the
    whole grid rather than over the open cells only.
    """
    seen = {0}
    frontier = [0]
    while frontier:
        cell = frontier.pop()
        for n in neighbors(g, cell):
            if n not in seen:
                seen.add(n)
                frontier.append(n)
    assert len(seen) == g.cells, f"{g.cells - len(seen)} cells unreachable from the queen"
