"""The board, and nothing else.

A polar cell grid: ring 0 is the queen's chamber, ring ``R`` is the hive wall,
and the rings above it are open meadow. Cells in a ring scale with its
circumference, so the field NARROWS toward the queen. That funnel is the reason
the hive is round rather than square — fifty bees spread along a wall converge
into a scrum at the centre, and the pinch is where sealing a rival's shaft
finally bites.

**This module is one of three copies of the same arithmetic.** The other two are
``frontend/src/game/rules.ts`` (the client's engine) and
``frontend/src/lib/polar.ts`` (the renderer). They must agree exactly: a server
that thinks two cells are neighbours while the client does not produces moves
that are rejected for no reason a player can see. ``tests/test_geometry.py``
asserts the same invariants as ``rules.test.ts``, deliberately, so the pair fail
together when one drifts.

No identity, no billing, no I/O. A frost calculation has no business holding an
npub and neither does a hex grid.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# Settled by simulation rather than by taste — see the batch runner in `sim/`.
# Fourteen rings and the stagger rule together give 365 cells, a round near two
# and a half minutes, a good player winning about 3.5x their uniform share, and
# a straight-line driller winning nothing at all.
WALL_RING = 14
MEADOW_RINGS = 4
CELL_WIDTH = 3.0

COMB = 0
OPEN = 1

# No two inward moves in a row: a bee must step sideways between them.
#
# Without this a bee can drill a straight radial shaft while a smarter one
# carves an arc, and the driller wins on raw distance — measured at 22% of
# rounds before the rule and 0% after. The stagger is the hive changing level:
# cut down, shift along, cut down again.
STAGGER_REQUIRED = True

# Share of comb that is impassable — capped brood, stone-hard old wax.
#
# Without it the comb is uniform, and a uniform comb has one gradient: radial.
# Every sideways step is then as good as every other, so a bee under the stagger
# rule simply spirals — measured at 18 cells travelled round with 0.7 reversals
# of direction. Five percent takes that to 5.4 reversals with the round length
# unchanged; ten begins pushing rounds into the ceiling.
BLOCK_SHARE = 0.05


@dataclass(frozen=True)
class Geometry:
    """Ring sizes and flat-index offsets for one hive."""

    wall: int
    meadow_rings: int
    max_ring: int
    size: tuple[int, ...]
    offset: tuple[int, ...]
    cells: int


def make_geometry(
    wall: int = WALL_RING,
    meadow_rings: int = MEADOW_RINGS,
    cell_width: float = CELL_WIDTH,
) -> Geometry:
    """Build a hive's geometry."""
    max_ring = wall + meadow_rings
    size: list[int] = []
    offset: list[int] = []
    total = 0
    for r in range(max_ring + 1):
        # Ring 0 is a single chamber. Everything else scales with circumference,
        # floored at 6 so the innermost rings stay navigable rather than
        # degenerate into a two-cell bottleneck nobody can route around.
        n = 1 if r == 0 else max(6, round((2 * math.pi * r) / cell_width))
        offset.append(total)
        size.append(n)
        total += n
    return Geometry(wall, meadow_rings, max_ring, tuple(size), tuple(offset), total)


def mulberry32(seed: int):
    """The client's PRNG, ported exactly.

    Obstructions are generated from the match's seed on BOTH sides rather than
    stored and shipped — which means the two generators have to agree bit for
    bit. A near-enough random would put a wall on the server that the player
    cannot see, and reject moves for no visible reason.
    """
    a = seed & 0xFFFFFFFF

    def rnd() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = (t ^ (t >> 15)) * (1 | t) & 0xFFFFFFFF
        t = (t + ((t ^ (t >> 7)) * (61 | t) & 0xFFFFFFFF)) & 0xFFFFFFFF ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rnd


def idx(g: Geometry, r: int, i: int) -> int:
    """Flat index of a cell, wrapping the slot around its ring."""
    return g.offset[r] + (i % g.size[r])


def ring_of(g: Geometry, cell: int) -> int:
    """Which ring a flat index falls in."""
    for r in range(g.max_ring, -1, -1):
        if cell >= g.offset[r]:
            return r
    return 0


def slot_of(g: Geometry, cell: int) -> int:
    """Which slot within its ring."""
    return cell - g.offset[ring_of(g, cell)]


def inward(g: Geometry, r: int, i: int) -> int | None:
    """The single cell one ring closer to the queen, or None from the chamber.

    Rings shrink as they descend, so this map is many-to-one: several outer
    cells funnel into one inner cell. That is the contention the game is built
    on, not an artefact of the index arithmetic.
    """
    if r == 0:
        return None
    return idx(g, r - 1, (i * g.size[r - 1]) // g.size[r])


def outward(g: Geometry, r: int, i: int) -> list[int]:
    """Every cell one ring out that funnels into this one. Usually one or two."""
    if r >= g.max_ring:
        return []
    n = g.size[r + 1]
    return [idx(g, r + 1, j) for j in range(n) if (j * g.size[r]) // n == i]


def arms_stagger(g: Geometry, from_cell: int, to_cell: int) -> bool:
    """Whether this move arms the stagger for the next one.

    Passing through a DOOR does not: it is not cutting down a level. Counting it
    deadlocked every bee at the threshold, unable to go inward (stagger) or
    sideways (the wall is uncuttable).
    """
    return ring_of(g, to_cell) < ring_of(g, from_cell) and ring_of(g, from_cell) <= g.wall


def may_move(g: Geometry, from_cell: int, to_cell: int, came_inward: bool) -> bool:
    """Whether the stagger rule permits this step.

    Applies to flying as well as digging — otherwise a bee simply rides a
    straight shaft somebody else cut and the rule buys nothing.
    """
    if not STAGGER_REQUIRED:
        return True
    if not came_inward:
        return True
    return ring_of(g, to_cell) >= ring_of(g, from_cell)


def neighbors(g: Geometry, cell: int) -> list[int]:
    """Inward, outward, and the two cells alongside.

    Tangential movement is what makes this a maze rather than a set of lanes:
    it is how a bee slides sideways onto somebody else's open shaft, or steps
    out from under a collapse.
    """
    r = ring_of(g, cell)
    i = cell - g.offset[r]
    out: list[int] = []
    inw = inward(g, r, i)
    if inw is not None:
        out.append(inw)
    out.extend(outward(g, r, i))
    if g.size[r] > 1:
        out.append(idx(g, r, i + 1))
        if g.size[r] > 2:
            out.append(idx(g, r, i - 1))
    return out


def is_wall(g: Geometry, cell: int) -> bool:
    """The hive's outer ring, which cannot be cut — only its doors let you in.

    Measured before the rule existed: 80% of bees chopped their own hole rather
    than fly to a mouth, which made the doors decoration and left the hive with
    no chokepoint at all.
    """
    return ring_of(g, cell) == g.wall


def is_meadow(g: Geometry, cell: int) -> bool:
    """Open air, above the wall — never dug, never sealed."""
    return ring_of(g, cell) > g.wall


def blocked_cells(g: Geometry, seed: int, share: float = BLOCK_SHARE) -> set[int]:
    """The impassable cells for a match, from its seed.

    Ring 1 is never blocked: with only six cells there, two obstructions could
    wall the queen in and end a round nobody could win. The reachability sweep
    afterwards opens the fewest cells that restore the connection.
    """
    rnd = mulberry32(seed)
    blocked: set[int] = set()
    for r in range(2, g.wall + 1):
        for i in range(g.size[r]):
            if rnd() < share:
                blocked.add(idx(g, r, i))
    _open_until_queen_is_reachable(g, blocked)
    return blocked


def _open_until_queen_is_reachable(g: Geometry, blocked: set[int]) -> None:
    """Unblock the fewest cells that reconnect the chamber to the board."""
    for _ in range(200):
        seen = {0}
        stack = [0]
        while stack:
            for nb in neighbors(g, stack.pop()):
                if nb not in seen and nb not in blocked:
                    seen.add(nb)
                    stack.append(nb)
        if all(c in seen or c in blocked for c in range(g.cells)) and len(seen) > g.cells // 2:
            return
        for c in sorted(blocked):
            if any(nb in seen for nb in neighbors(g, c)):
                blocked.discard(c)
                break
        else:
            return


def initial_state(g: Geometry, mouths: int = 4) -> bytearray:
    """A fresh board: meadow open, hive solid, a few doors in the wall.

    The mouths are a convenience rather than a gate — a bee may always pay to
    cut its own door — but they are where the first traffic jams form, which is
    what makes them worth having.
    """
    state = bytearray(g.cells)
    for r in range(g.wall + 1, g.max_ring + 1):
        for i in range(g.size[r]):
            state[idx(g, r, i)] = OPEN
    for m in range(mouths):
        state[idx(g, g.wall, (m * g.size[g.wall]) // mouths)] = OPEN
    return state


def mouth_cells(g: Geometry, mouths: int = 4) -> list[int]:
    """The doors, so a caller can tell a door from a shaft somebody cut."""
    return [idx(g, g.wall, (m * g.size[g.wall]) // mouths) for m in range(mouths)]


def can_seal(g: Geometry, cell: int, mouths: int = 4) -> bool:
    """Whether a cell is one a bee may bring down at all.

    The meadow is air and the queen's chamber is the prize: burying either would
    end a round nobody could win. Doors are excluded too, or a single seal early
    on could wall the whole field out of its own hive.
    """
    r = ring_of(g, cell)
    return 1 <= r <= g.wall and cell not in mouth_cells(g, mouths)
