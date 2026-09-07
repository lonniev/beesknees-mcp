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


def test_sim_bees_never_hurry() -> None:
    """The pause is the feature.

    A bot reads the board and decides in microseconds; a person cannot. The
    cooldown stops money buying speed and this stops silicon buying it — so a sim
    bee always waits a human beat on top of its rest, and never less.
    """
    rng = random.Random(0)
    pauses = [sim_bees.human_pause(rng) for _ in range(500)]
    assert min(pauses) >= 0.5, "a sim bee moved quicker than a person could tap"
    assert max(pauses) <= 3.0
    assert len({round(p, 3) for p in pauses}) > 100, "jittered, or eight bees move in lockstep"


def test_the_swarm_only_props_up_a_room_that_needs_it() -> None:
    """Sim bees exist so a real player can play, not to fill the room."""
    import asyncio

    from beesknees_mcp.sim_swarm import MAX_BEES, QUORUM, Swarm

    s = Swarm(url="http://unused", rng=random.Random(1))

    # Nobody is waiting, so nobody needs company.
    assert asyncio.run(s.top_up({"state": "forming", "bees": []})) == 0
    # A hive that already has its quorum is about to start on its own.
    full = {"state": "forming", "bees": [{"hive": 0} for _ in range(QUORUM)]}
    assert asyncio.run(s.top_up(full)) == 0
    # A running match is not a lobby.
    assert asyncio.run(s.top_up({"state": "running", "bees": [{"hive": 0}]})) == 0

    # And a match is never all robots: one seat is always somebody's.
    assert MAX_BEES == QUORUM - 1
