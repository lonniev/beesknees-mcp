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
    blocked_cells,
    can_seal,
    idx,
    initial_state,
    inward,
    is_meadow,
    make_geometry,
    mouth_cells,
    mulberry32,
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


# Draws taken from the TypeScript engine and pasted here on purpose.
#
# Obstructions are generated from a match seed on BOTH sides rather than stored
# and shipped, so the two generators must agree bit for bit. A near-enough
# random would put a wall on the server that the player cannot see, and reject
# moves for no reason anyone could work out from the screen. Golden values are
# the only way to catch a drift that produces perfectly plausible numbers.
_TS_DRAWS: dict[int, list[float]] = {
    1: [0.627073940588, 0.00273572118, 0.52744703996, 0.981050967472, 0.968377898214, 0.281103502959, 0.612838860601, 0.720743141137],
    42: [0.60110375192, 0.448290558998, 0.85246579349, 0.669734041439, 0.174813898746, 0.526592542185, 0.27322799433, 0.624744653935],
    999: [0.969905822305, 0.634779409738, 0.309331906959, 0.772693989333, 0.456634212285, 0.576896743849, 0.047645400977, 0.579938591924],
    123456789: [0.257790743839, 0.970772111556, 0.785328014288, 0.206164579839, 0.303071887465, 0.747066047043, 0.778733652085, 0.284509629011],
}


def test_the_prng_matches_the_client_exactly() -> None:
    for seed, expected in _TS_DRAWS.items():
        rnd = mulberry32(seed)
        got = [round(rnd(), 12) for _ in expected]
        assert got == expected, f"seed {seed} drifted from the client"


def test_obstructions_never_wall_the_queen_in() -> None:
    """A round nobody can win is worse than a boring one."""
    g = make_geometry()
    for seed in range(60):
        blocked = blocked_cells(g, seed)
        seen = {0}
        stack = [0]
        while stack:
            for nb in neighbors(g, stack.pop()):
                if nb not in seen and nb not in blocked:
                    seen.add(nb)
                    stack.append(nb)
        # Every cell that is not itself an obstruction must be reachable.
        stranded = [c for c in range(g.cells) if c not in blocked and c not in seen]
        assert not stranded, f"seed {seed} stranded {len(stranded)} cells"


def test_obstructions_are_sparse_enough_to_finish_a_round() -> None:
    """Five percent was measured; ten pushes rounds into the ceiling."""
    g = make_geometry()
    shares = [len(blocked_cells(g, s)) / g.cells for s in range(40)]
    assert max(shares) < 0.09, f"too dense: {max(shares):.3f}"
