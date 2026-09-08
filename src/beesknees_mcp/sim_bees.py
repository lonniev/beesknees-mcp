"""The sim bees' brains — the same decisions `bots.ts` makes, in Python.

These fill a hive that is short of players so a match can start rather than
leaving one paying patron staring at a lobby. They are ordinary patrons: their
own keys, their own seats, the same rules, the same fenced writes. What makes
them free is a coupon, not a privilege.

**They are deliberately not quick.** A bot can decide in microseconds and a
person cannot, so the whole point of the cooldown is undone by an opponent that
answers the instant it is allowed to. These wait a human-ish beat on top of the
cooldown — see `human_pause` — and the pause is the feature.

This is a PORT of `bots.ts` and the two must agree, so `descend` is written to
mirror `descend` there step for step rather than to be idiomatic here.
`tests/test_sim_bees.py` diffs the two across a spread of boards; when they
disagree, that test is the one telling the truth.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Any

from beesknees_mcp import geometry as geo

#: Ticks are the client's unit; the server's is seconds. One move, one second.
COOLDOWN_S = 1.0
DIG_EXTRA_S = 7.0

STRATEGIES = ("digger", "rider", "sealer", "bore")


@dataclass(frozen=True)
class Move:
    """What a sim bee wants to do. `cell` is the target; `kind` names the tool."""

    kind: str  # "fly" | "dig" | "seal" | "wait"
    cell: int = -1


@dataclass(frozen=True)
class Board:
    """One hive, as the sim bee sees it: derived layout plus what the server said."""

    g: geo.Geometry
    layout: geo.HiveBoard
    open_cells: frozenset[int]
    taken_pollen: frozenset[int]
    occupied: frozenset[int]

    def is_open(self, cell: int) -> bool:
        """Meadow is air; comb is open only where somebody has cut it."""
        return geo.is_meadow(self.g, cell) or cell in self.open_cells

    def has_pollen(self, cell: int) -> bool:
        return cell in self.layout.flowers and cell not in self.taken_pollen


def goals(board: Board, phase: str) -> list[int]:
    """The cells that end the current act. Mirrors `goals` in bots.ts."""
    g = board.g
    if phase == "forage":
        holding = [c for c in board.layout.flowers if board.has_pollen(c)]
        return holding or list(board.layout.flowers)
    if phase == "return":
        # The DOORS, not the whole wall: the wall cannot be cut, so a bee that
        # aims at it flies to a spot it can never enter.
        return geo.mouth_cells(g)
    return [0]


def cost_field(board: Board, sources: list[int], fly_w: float, dig_w: float) -> list[float]:
    """Cost to reach every cell from `sources`. Mirrors `field` in rules.ts.

    A bucket queue rather than a heap, because the weights are small integers and
    this runs once per bee per move.
    """
    g = board.g
    inf = math.inf
    dist = [inf] * g.cells
    buckets: dict[int, list[int]] = {}

    def push(cell: int, d: float) -> None:
        if d >= dist[cell]:
            return
        dist[cell] = d
        buckets.setdefault(int(d), []).append(cell)

    for s in sources:
        push(s, 0)

    d = 0
    while buckets:
        bucket = buckets.pop(d, None)
        if bucket is None:
            if d > g.cells * 100:
                break
            d += 1
            continue
        for cell in bucket:
            if dist[cell] != d:
                continue
            for n in geo.neighbors(g, cell):
                if n in board.layout.blocked:
                    continue
                push(n, d + (fly_w if board.is_open(n) else dig_w))
        d += 1
    return dist


def descend(board: Board, bee: dict[str, Any], dig_w: float) -> Move:
    """Step to whichever legal neighbour sits lowest in the field.

    Only moves the RULES would allow are considered. A bot that picks a cell the
    stagger forbids simply stalls, and on a one-second clock that reads as the
    rule being punishing when it is the bot being stupid.
    """
    g = board.g
    field = cost_field(board, goals(board, str(bee["phase"])), COOLDOWN_S, dig_w)
    cur = int(bee["cell"])
    came_inward = bool(bee.get("came_inward"))

    best, best_d = -1, math.inf
    for n in geo.neighbors(g, cur):
        if n in board.layout.blocked or n in board.occupied:
            continue
        if not geo.may_move(g, cur, n, came_inward):
            continue
        # The wall cannot be cut; only its doors let anyone in.
        if not board.is_open(n) and geo.is_wall(g, n):
            continue
        if field[n] < best_d:
            best_d, best = field[n], n

    if best < 0 or best_d == math.inf:
        return Move("wait")
    return Move("fly" if board.is_open(best) else "dig", best)


def choose(board: Board, bee: dict[str, Any], strategy: str, rng: random.Random) -> Move:
    """One bee's move. Mirrors `chooseAction` in bots.ts."""
    phase = str(bee["phase"])
    if phase == "done":
        return Move("wait")

    if strategy == "rider":
        # The truthful weight: a cut costs what it costs, so it walks a long way
        # to reach a shaft somebody else already made.
        return descend(board, bee, COOLDOWN_S + DIG_EXTRA_S)

    if strategy == "bore":
        # Straight at the queen and no plan for anything else. It stays the dumb
        # control: when the drill is barred it shuffles blindly rather than
        # routing round, because "drill, and plan when you cannot" is a GOOD
        # strategy and this bot exists to be the baseline, not to win.
        g = board.g
        cur = int(bee["cell"])
        if phase == "tunnel" and geo.is_hive(g, cur):
            r = geo.ring_of(g, cur)
            inward = geo.inward(g, r, cur - g.offset[r])
            if inward is not None and inward not in board.layout.blocked \
               and inward not in board.occupied \
               and geo.may_move(g, cur, inward, bool(bee.get("came_inward"))):
                return Move("fly" if board.is_open(inward) else "dig", inward)
            return _blind_step(board, bee, rng)
        return descend(board, bee, COOLDOWN_S)

    if strategy == "sealer" and phase == "tunnel" and rng.random() < 0.25:
        seal = _seal_behind(board, bee)
        if seal is not None:
            return Move("seal", seal)

    # digger, and sealer when it is not sabotaging: undervalue the dig, so it
    # happily cuts its own line wherever the geometry is shortest.
    return descend(board, bee, COOLDOWN_S)


def _blind_step(board: Board, bee: dict[str, Any], rng: random.Random) -> Move:
    g = board.g
    options = [
        n
        for n in geo.neighbors(g, int(bee["cell"]))
        if n not in board.layout.blocked
        and n not in board.occupied
        and geo.may_move(g, int(bee["cell"]), n, bool(bee.get("came_inward")))
        and not (not board.is_open(n) and geo.is_wall(g, n))
    ]
    if not options:
        return Move("wait")
    n = options[rng.randrange(len(options))]
    return Move("fly" if board.is_open(n) else "dig", n)


def _seal_behind(board: Board, bee: dict[str, Any]) -> int | None:
    """The cell just vacated, if burying it is allowed and worth doing."""
    prev = bee.get("prev_cell")
    if prev is None or int(prev) < 0:
        return None
    cell = int(prev)
    if not geo.can_seal(board.g, cell) or cell not in board.open_cells:
        return None
    if cell in board.occupied:
        return None
    return cell


def human_pause(rng: random.Random) -> float:
    """How long a sim bee waits AFTER its cooldown, in seconds.

    The cooldown is what stops money buying speed; this is what stops silicon
    buying it. A bot can read the board and decide in microseconds, and a person
    cannot — so an opponent that acts the instant it is allowed to is not playing
    the same game, however identical the rules are.

    Between a fifth of a second and one and a quarter — on top of a one-second
    cooldown, so a move lands every 1.2s to 2.25s. An attentive person who has
    already decided taps in something like 1.2s, which now sits at the FAST end
    of a sim bee's range rather than beyond it: a sharp human still edges the
    field, and a dawdling one is genuinely overtaken.

    Loosened twice, in the same direction, for the same reason. It began at half
    a second to three, which read as sleepy — a mean of 2.75s a move against a
    human's 1.2s is not an opponent, it is scenery. Then 0.4–1.8, which was
    unhurried but still conceded every race to anyone paying attention. The
    point is a bee that could plausibly be somebody, and somebody is not a
    creature that always loses.

    This is the floor of the range, not the mean, that matters: at 0.2s the
    quickest sim bee is still slower than the cooldown it is waiting on, so it
    can never act more often than the rules allow anybody.
    """
    return rng.uniform(0.2, 1.25)
