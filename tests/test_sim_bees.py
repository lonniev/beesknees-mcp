"""The sim bees must be the same opponents the simulation was tuned against.

`sim_bees.py` is a port of `frontend/src/game/bots.ts`. The bots that fill a thin
hive are the ones a paying patron actually plays, so if the port drifts, the live
game stops being the game that was measured — quietly, and in the direction
nobody chose.

Two implementations of one set of decisions do drift. So this runs both over the
same boards and diffs them.

**What is compared, and what is not.** The strategies are deterministic and must
match exactly. The BLIND fallback — `bore` shuffling when its drill is barred —
is a random pick from the legal moves, and `mulberry32` and Python's `Random` are
different streams: requiring those to agree would be requiring two PRNGs to be
the same PRNG. For those rows the test asserts the property that matters instead,
that the move offered is a legal one.
"""

from __future__ import annotations

import pathlib
import random
import shutil
import subprocess

import pytest

from beesknees_mcp import geometry as geo
from beesknees_mcp import sim_bees

FRONTEND = pathlib.Path(__file__).resolve().parents[1] / "frontend"
needs_node = pytest.mark.skipif(
    not (FRONTEND / "node_modules").is_dir() or shutil.which("npx") is None,
    reason="the client's toolchain is not installed here",
)


def _python_rows() -> list[str]:
    """The same matrix `scripts/botdump.ts` walks, decided by the Python port."""
    g = geo.make_geometry()
    rows: list[str] = []
    for seed in range(1, 7):
        layout = geo.hive_board(g, seed)
        open_cells = set(geo.mouth_cells(g))
        for r in range(g.wall - 1, g.wall - 6, -1):
            open_cells.add(g.offset[r] + 2)
        for strategy in ("digger", "rider", "bore"):
            for phase in ("forage", "return", "tunnel"):
                cells = (
                    (g.offset[g.wall] + 2, g.offset[g.wall - 3] + 2)
                    if phase == "tunnel"
                    else (layout.starts[0], layout.starts[3])
                )
                for cell in cells:
                    for armed in (False, True):
                        board = sim_bees.Board(
                            g=g,
                            layout=layout,
                            open_cells=frozenset(open_cells),
                            taken_pollen=frozenset(),
                            occupied=frozenset(),
                        )
                        bee = {"cell": cell, "phase": phase, "came_inward": armed, "prev_cell": -1}
                        m = sim_bees.choose(board, bee, strategy, random.Random(7))
                        target = m.cell if m.kind != "wait" else -1
                        rows.append(
                            f"{seed}|{strategy}|{phase}|{cell}|{1 if armed else 0}|{m.kind}|{target}"
                        )
    return rows


def _is_blind(row: str) -> bool:
    """Did `bore` shuffle rather than drill?

    It falls back whenever the cell below it is unavailable — barred by the
    stagger, capped brood, or a rival standing in it — and the fallback is a
    random pick from the legal moves. Detected by asking whether the move it
    made was in fact the drill, rather than by guessing at the reasons.
    """
    _, strategy, phase, cell, _, kind, target = row.split("|")
    if strategy != "bore" or phase != "tunnel" or kind == "wait":
        return False
    g = geo.make_geometry()
    c = int(cell)
    if not geo.is_hive(g, c):
        return True
    r = geo.ring_of(g, c)
    drill = geo.inward(g, r, c - g.offset[r])
    return drill is None or int(target) != drill


@needs_node
def test_the_sim_bees_decide_what_the_client_bots_decide() -> None:
    out = subprocess.run(
        ["npx", "tsx", "scripts/botdump.ts"],
        cwd=FRONTEND,
        capture_output=True,
        text=True,
        timeout=300,
        check=True,
    )
    ts = [ln for ln in out.stdout.splitlines() if ln.strip()]
    py = _python_rows()
    assert len(ts) == len(py), f"the two walked different matrices: {len(ts)} vs {len(py)}"

    mismatched = [
        (a, b) for a, b in zip(ts, py, strict=True) if a != b and not _is_blind(a)
    ]
    assert not mismatched, "the port has drifted:\n" + "\n".join(
        f"  client: {a}\n  server: {b}" for a, b in mismatched[:8]
    )


def test_a_blind_step_is_still_a_legal_step() -> None:
    """`bore` is allowed to be stupid. It is not allowed to be refused.

    It used to pick any neighbour at all, so a stagger-barred driller could offer
    the very move that had just been forbidden — a wasted cooldown, and on a
    one-second clock the whole turn.
    """
    g = geo.make_geometry()
    layout = geo.hive_board(g, 3)
    open_cells = set(geo.mouth_cells(g)) | {g.offset[r] + 2 for r in range(g.wall - 5, g.wall)}
    board = sim_bees.Board(
        g=g,
        layout=layout,
        open_cells=frozenset(open_cells),
        taken_pollen=frozenset(),
        occupied=frozenset(),
    )
    rng = random.Random(1)
    for cell in (g.offset[g.wall] + 2, g.offset[g.wall - 3] + 2):
        for _ in range(20):
            bee = {"cell": cell, "phase": "tunnel", "came_inward": True, "prev_cell": -1}
            m = sim_bees.choose(board, bee, "bore", rng)
            if m.kind == "wait":
                continue
            assert m.cell in geo.neighbors(g, cell), "a blind step must still be a step"
            assert m.cell not in layout.blocked, "it walked into capped brood"
            assert geo.may_move(g, cell, m.cell, True), "it offered a move the stagger bars"


def test_a_sim_bee_can_never_outpace_the_rules() -> None:
    """The pause is the feature, and the FLOOR is the pause.

    A bot reads the board and decides in microseconds; a person cannot. The
    cooldown stops money buying speed and this stops silicon buying it.

    Loosened to make sim bees more of a contest — an opponent that always loses
    to anyone paying attention is scenery, not a rival. What must not move is
    the guarantee underneath: even the quickest sim bee waits longer than zero
    on top of a cooldown it cannot skip, so it never acts more often than the
    rules allow a person to.
    """
    rng = random.Random(0)
    pauses = [sim_bees.human_pause(rng) for _ in range(500)]
    assert min(pauses) > 0, "a sim bee that waits nothing is acting at bot speed"
    # A human who has already decided taps in about 1.2s. The fast end of the
    # range now sits below that, so a sharp person edges the field rather than
    # walking it — but the cooldown, not this, is what caps anybody's rate.
    assert min(pauses) >= 0.2
    assert max(pauses) <= 1.25
    assert len({round(p, 3) for p in pauses}) > 100, "jittered, or eight bees move in lockstep"


def test_the_swarm_only_props_up_a_room_that_needs_it() -> None:
    """Sim bees exist so a real player can play, not to fill the room."""
    import asyncio

    from beesknees_mcp.sim_swarm import HIVES, MAX_BEES, QUORUM, Swarm

    s = Swarm(url="http://unused", rng=random.Random(1))

    # Nobody is waiting, so nobody needs company.
    assert asyncio.run(s.top_up({"state": "forming", "bees": []})) == 0
    # A hive that already has its quorum is about to start on its own.
    full = {"state": "forming", "bees": [{"hive": 0} for _ in range(QUORUM)]}
    assert asyncio.run(s.top_up(full)) == 0
    # A running match is not a lobby.
    assert asyncio.run(s.top_up({"state": "running", "bees": [{"hive": 0}]})) == 0

    # And a match is never all robots: one seat is always somebody's.
    assert MAX_BEES == HIVES * QUORUM - 1


def test_the_swarm_seats_enough_to_actually_open_the_lobby() -> None:
    """`QUORUM - fullest` was arithmetic for a quorum counted across the match.

    Quorum belongs to a HIVE, and the server deals each seat to the EMPTIEST
    hive — so bees added here spread rather than piling onto the fullest one.
    Asking for `QUORUM - fullest` of them raises the fullest hive by about a
    fifth of that, and the lobby never opens: the shift seats seven bees,
    reports success, and the room still has no hive of eight.

    What is needed is the seats that bring every hive to quorum, because that
    is how many the deal absorbs before any one hive gets there.
    """
    import asyncio

    from beesknees_mcp.sim_swarm import HIVES, QUORUM, Swarm

    seen: list[int] = []

    class Counting(Swarm):
        async def _mint(self, strategy: str, n: int):
            raise AssertionError("not reached — `want` is read before any minting")

    # One human waiting alone: the room needs the other thirty-nine seats.
    s = Counting(url="http://unused", rng=random.Random(1))
    lone = {"state": "forming", "bees": [{"hive": 2}]}
    try:
        asyncio.run(s.top_up(lone))
    except AssertionError as exc:
        seen.append(0)
        assert "not reached" in str(exc)

    # The arithmetic itself, stated where it can be read: every hive to quorum,
    # and a hive already over it contributes nothing.
    def needed(per: dict[int, int]) -> int:
        return sum(max(0, QUORUM - per.get(h, 0)) for h in range(HIVES))

    assert needed({2: 1}) == HIVES * QUORUM - 1
    assert needed({0: 8, 1: 8, 2: 8, 3: 8, 4: 7}) == 1
    assert needed({0: 12, 1: 1}) == (QUORUM - 1) + QUORUM * (HIVES - 2)


def test_a_shift_refuses_a_match_it_cannot_finish() -> None:
    """Better no bees than bees that stop halfway.

    A shift that ends mid-round strands the bees it seated: they stop where they
    stand and the hive fills with sleepers. Making the shift longer than a round
    was not enough — a twelve-minute shift only covers a round that STARTS near
    the beginning of it, and a match beginning at minute eleven still got one
    minute. So a shift will not take a lobby it has not the time to see through,
    and will not walk out on one it has.
    """
    from beesknees_mcp.sim_swarm import ROUND_CEILING_S

    hard_cap = 840.0
    # Early in the shift there is room for a whole round.
    assert 10 + ROUND_CEILING_S <= hard_cap
    # Late in it there is not, and the lobby is left to the next shift.
    assert not (200 + ROUND_CEILING_S <= hard_cap)
    # And the ceiling really is the server's, not a smaller guess.
    assert ROUND_CEILING_S >= 10 * 60, "a round can reach ten minutes"


def test_no_lobby_is_ever_left_uncovered() -> None:
    """A shift stops seating long before it stops running, so the SCHEDULE has
    to close the gap.

    A shift only takes a lobby it could still see a whole round out —
    `elapsed + ROUND_CEILING_S <= hard_cap` — which is the first 180 seconds of
    a fourteen-minute life. That is correct and it is not the bug. The bug was
    starting shifts every 360 seconds, which left a 180-second hole in every
    360 where NO shift would seat a bee at all: a patron arriving in one of
    those holes waited out the entire gap in front of an empty lobby, and the
    log filled with "leaving this lobby to the next shift".

    Every number here is READ from what ships. Restating them is how this
    arithmetic came to be wrong in the first place.
    """
    import ast
    import inspect
    import pathlib

    from beesknees_mcp import sim_swarm

    src = pathlib.Path(__file__).resolve().parents[1] / "modal_app.py"
    tree = ast.parse(src.read_text())

    # The shift's own clocks, found by the keyword rather than by the callee's
    # name — `asyncio.run(run(...))` puts two `run`s on that line and the outer
    # one carries no arguments at all.
    call = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.Call) and any(k.arg == "hard_cap" for k in n.keywords)
    )
    kw = {k.arg: k.value for k in call.keywords}
    hard_cap = float(ast.literal_eval(kw["hard_cap"]))

    # The schedule, from the decorator.
    period = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.Call) and getattr(n.func, "attr", "") == "Period"
    )
    every_s = float(ast.literal_eval(period.keywords[0].value)) * 60

    window = hard_cap - sim_swarm.ROUND_CEILING_S
    assert window > 0, "a shift that can never seat is not a shift"
    assert every_s <= window, (
        f"shifts start every {every_s:.0f}s but each only seats for its first "
        f"{window:.0f}s — {every_s - window:.0f}s of every {every_s:.0f} has nobody willing to seat"
    )

    # And the handover must not have two shifts seating into one lobby: an
    # arriving shift waits `PATIENCE_S` before its first top-up, by which time
    # the outgoing one must be out of its window.
    assert sim_swarm.PATIENCE_S > 0
    assert every_s + sim_swarm.PATIENCE_S > window, (
        "an arriving shift starts seating before the outgoing one stops"
    )

    # A sanity check on the source of the whole gate: the sim's estimate of a
    # round must actually cover the server's ceiling, or a shift takes a lobby
    # it cannot see out.
    from beesknees_mcp import board_store

    assert sim_swarm.ROUND_CEILING_S >= board_store.ROUND_CEILING_S, (
        "the shift budgets less for a round than the server allows one to take"
    )
    assert inspect.iscoroutinefunction(sim_swarm.Swarm.forget_finished), (
        "retiring a cohort closes its connections, so it has to be awaited"
    )
