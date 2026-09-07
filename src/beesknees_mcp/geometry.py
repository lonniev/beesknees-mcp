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
# Fourteen rings and the stagger rule together: a good player wins about 2.1x
# their uniform share, and a straight-line driller wins nothing at all.
WALL_RING = 14
# The meadow is a SQUARE LATTICE this many cells to a side, minus the squares the
# hive covers. See `Geometry` for why the board carries two grids rather than one.
GRID_N = 16
CELL_WIDTH = 3.0

# The square field is 200 view units across, and the hive takes this share of the
# half-width. Mirrors HIVE_SHARE in the client's rules.ts.
VIEW_HALF = 100.0
HIVE_SHARE = 0.8

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
    """TWO geometries, joined at the doors.

    The meadow is a square lattice and the hive is concentric rings, because the
    two halves of this game want opposite things of a grid. Outside, a bee crosses
    open ground toward a hive it can see from anywhere, and what matters is
    heading and distance — which is what a square lattice measures and what makes
    a far corner genuinely far. Inside, every bee converges on one cell at the
    centre and the field has to NARROW as they close on it; that funnel is what
    rings are for.

    One geometry across both jobs was wrong in both directions. Rings that stop
    at the hive leave the square's corners painted and uninhabited; rings pushed
    out to the corners put 140 of 491 cells off-screen, where they had to be
    blocked, skipped by the reachability sweep, and hidden from the eye.

    Cell ids run hive-first: ``0 .. hive_cells - 1`` are polar, the rest meadow.
    """

    wall: int
    #: The ring number reported for EVERY meadow cell. The meadow has no rings.
    max_ring: int
    size: tuple[int, ...]
    offset: tuple[int, ...]
    hive_cells: int
    grid_n: int
    step: float
    #: Lattice slot (row * grid_n + col) -> cell id, or -1 where the hive covers it.
    slot_cell: tuple[int, ...]
    #: Meadow cell id minus ``hive_cells`` -> its lattice slot.
    cell_slot: tuple[int, ...]
    meadow_cells: int
    cells: int
    #: Wall slot -> the meadow square beyond it. The seam, and the only way through.
    door_out: tuple[int, ...]
    #: Meadow cell id -> the wall cells that open onto it.
    door_in: dict[int, tuple[int, ...]]


def make_geometry(
    wall: int = WALL_RING,
    grid_n: int = GRID_N,
    cell_width: float = CELL_WIDTH,
) -> Geometry:
    """Build a hive's geometry: polar rings inside, a square lattice outside."""
    size: list[int] = []
    offset: list[int] = []
    hive_cells = 0
    for r in range(wall + 1):
        # Ring 0 is a single chamber. Everything else scales with circumference,
        # floored at 6 so the innermost rings stay navigable rather than
        # degenerate into a two-cell bottleneck nobody can route around.
        n = 1 if r == 0 else max(6, round((2 * math.pi * r) / cell_width))
        offset.append(hive_cells)
        size.append(n)
        hive_cells += n

    step = (2 * VIEW_HALF) / grid_n
    hive_r = HIVE_SHARE * VIEW_HALF
    slot_cell = [-1] * (grid_n * grid_n)
    cell_slot: list[int] = []
    for row in range(grid_n):
        for col in range(grid_n):
            x = -VIEW_HALF + step * (col + 0.5)
            y = -VIEW_HALF + step * (row + 0.5)
            # A square with the hive under its middle is not meadow. The hive is
            # painted over the lattice, so the ragged seam never shows.
            if math.hypot(x, y) <= hive_r:
                continue
            slot_cell[row * grid_n + col] = hive_cells + len(cell_slot)
            cell_slot.append(row * grid_n + col)

    def meadow_at(x: float, y: float) -> int | None:
        col = math.floor((x + VIEW_HALF) / step)
        row = math.floor((y + VIEW_HALF) / step)
        if not (0 <= col < grid_n and 0 <= row < grid_n):
            return None
        c = slot_cell[row * grid_n + col]
        return None if c < 0 else c

    # The seam. Each wall cell opens onto the lattice square beyond its middle,
    # found by probing outward — the first square out is occasionally one the
    # hive swallowed, and a door onto nothing is a door nobody can use.
    door_out = [-1] * size[wall]
    door_in: dict[int, list[int]] = {}
    for i in range(size[wall]):
        a = ((i + 0.5) / size[wall]) * 2 * math.pi - math.pi / 2
        d = 0.6
        while d < 4:
            reach = hive_r + step * d
            c = meadow_at(math.cos(a) * reach, math.sin(a) * reach)
            if c is not None:
                door_out[i] = c
                door_in.setdefault(c, []).append(offset[wall] + i)
                break
            d += 0.5

    return Geometry(
        wall=wall,
        max_ring=wall + 1,
        size=tuple(size),
        offset=tuple(offset),
        hive_cells=hive_cells,
        grid_n=grid_n,
        step=step,
        slot_cell=tuple(slot_cell),
        cell_slot=tuple(cell_slot),
        meadow_cells=len(cell_slot),
        cells=hive_cells + len(cell_slot),
        door_out=tuple(door_out),
        door_in={k: tuple(v) for k, v in door_in.items()},
    )


def is_hive(g: Geometry, cell: int) -> bool:
    """Is this cell in the hive rather than the meadow?"""
    return cell < g.hive_cells


def row_col(g: Geometry, cell: int) -> tuple[int, int]:
    """Lattice row and column of a meadow cell."""
    slot = g.cell_slot[cell - g.hive_cells]
    return divmod(slot, g.grid_n)


def cell_centre(g: Geometry, cell: int) -> tuple[float, float]:
    """Centre of a cell in view coordinates, whichever geometry it belongs to."""
    if not is_hive(g, cell):
        row, col = row_col(g, cell)
        return (-VIEW_HALF + g.step * (col + 0.5), -VIEW_HALF + g.step * (row + 0.5))
    r = ring_of(g, cell)
    if r == 0:
        return (0.0, 0.0)
    i = cell - g.offset[r]
    mid = (ring_r(g, r) + ring_r(g, r + 1)) / 2
    a = ((i + 0.5) / g.size[r]) * 2 * math.pi - math.pi / 2
    return (mid * math.cos(a), mid * math.sin(a))


def ring_r(g: Geometry, r: int) -> float:
    """Radius of a hive ring's inner edge, in view units."""
    return (min(r, g.wall + 1) / (g.wall + 1)) * HIVE_SHARE * VIEW_HALF


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
    """Ring of a hive cell; ``max_ring`` for anything out in the meadow."""
    if cell >= g.hive_cells:
        return g.max_ring
    for r in range(g.wall, -1, -1):
        if cell >= g.offset[r]:
            return r
    return 0


def slot_of(g: Geometry, cell: int) -> int:
    """Slot within its ring, or -1 for a meadow cell, which has no ring."""
    if cell >= g.hive_cells:
        return -1
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
    """Every cell one step out from a hive cell. Usually one or two.

    Out of the WALL there is no ring, only the seam: the square beyond this
    door. Whether it may be crossed is the cell's state, not its geometry.
    """
    if r >= g.wall:
        c = g.door_out[i]
        return [] if c < 0 else [c]
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
    """Neighbours of a cell, in whichever geometry it lives.

    In the hive: inward, outward and the two cells alongside. Tangential
    movement is what makes it a maze rather than a set of lanes — it is how a
    bee slides onto somebody else's open shaft, or steps out from under a
    collapse.

    In the meadow: all eight compass directions, because a bee flies and a
    flight that can only turn right angles reads as a machine. Plus any door
    that opens onto this square, which is the only place the two grids touch.
    """
    if not is_hive(g, cell):
        row, col = row_col(g, cell)
        out: list[int] = []
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                r2, c2 = row + dr, col + dc
                if not (0 <= r2 < g.grid_n and 0 <= c2 < g.grid_n):
                    continue
                n = g.slot_cell[r2 * g.grid_n + c2]
                if n >= 0:
                    out.append(n)
        out.extend(g.door_in.get(cell, ()))
        return out

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

    Three places never get one, each for a reason a player would recognise from
    the board:

    - Ring 1. Six cells wide, so two obstructions could wall the queen in and
      end a round nobody could win.
    - The WALL itself. Already impassable everywhere except its doors, so an
      obstruction there does nothing at all — except on a door, where it
      silently deletes an entrance. Measured at 18 of 240 doors bricked shut.
    - The cell just inside a door. That is a doorway's only way ON, because the
      wall to either side cannot be cut, so blocking it makes a door a bee can
      enter and then only reverse out of. 7 of 240 doors landed on one.

    The reachability sweep afterwards opens the fewest cells that restore the
    connection.
    """
    rnd = mulberry32(seed)
    spared = {
        n
        for m in mouth_cells(g)
        for n in neighbors(g, m)
        if ring_of(g, n) < ring_of(g, m)
    }
    blocked: set[int] = set()
    for r in range(2, g.wall):
        for i in range(g.size[r]):
            # The die is rolled for every candidate either way, so the sequence
            # stays identical to rules.ts's — a spared cell must still consume
            # its draw.
            hit = rnd() < share
            c = idx(g, r, i)
            if hit and c not in spared:
                blocked.add(c)
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
    for c in range(g.hive_cells, g.cells):
        state[c] = OPEN
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


def corner_starts(g: Geometry, seats: int) -> list[int]:
    """Where bees begin: out at the corners, never in front of a door.

    Doors sit at the cardinal points of the wall, so a corner is as far from
    every one of them as the board allows — nobody is handed an entrance, and
    the flight in is a real journey rather than a step off the wall. Seats are
    dealt round-robin so the four corners fill evenly, and each takes the
    nearest square still free, which spreads them without stacking.

    Ported from ``cornerStarts`` in the client's rules.ts and must stay exactly
    equal to it: the server decides where a bee stands and the client draws it.
    """
    corners = [
        (VIEW_HALF, -VIEW_HALF),
        (VIEW_HALF, VIEW_HALF),
        (-VIEW_HALF, VIEW_HALF),
        (-VIEW_HALF, -VIEW_HALF),
    ]
    usable = range(g.hive_cells, g.cells)
    taken: set[int] = set()
    out: list[int] = []
    for i in range(seats):
        cx, cy = corners[i % len(corners)]
        best, best_d = -1, float("inf")
        for c in usable:
            if c in taken:
                continue
            x, y = cell_centre(g, c)
            d = (x - cx) ** 2 + (y - cy) ** 2
            if d < best_d:
                best_d, best = d, c
        if best < 0:
            break
        taken.add(best)
        out.append(best)
    return out
