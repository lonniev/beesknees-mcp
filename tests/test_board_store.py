"""The board's fences, tested against a vault that behaves like Postgres.

The point of these is not that the SQL parses — it is that a LOSING write loses.
There are no transactions here, so every mutation is a single fenced statement
and the only thing standing between sixty patrons and a corrupt board is that
each one correctly reports whether it actually landed.

The fake vault below is deliberately strict about the two behaviours the real
statements rely on: a primary-key conflict makes exactly one INSERT win, and a
DELETE returns whether a row was there to remove.

**What these do NOT prove.** The fake is code in this repo, so a test that passes
here says the store's DECISIONS are right — adjacency, phases, fences, the
error paths — and says nothing whatever about whether the SQL is valid
PostgreSQL or whether a real CTE behaves as assumed. Only a live Neon can
answer that, and `tests/test_geometry.py` plus a deployment probe are what
cover it. A green run here is necessary and not sufficient.
"""

from __future__ import annotations

import asyncio

import pytest

from beesknees_mcp import board_store as store
from beesknees_mcp import geometry as geo
from beesknees_mcp import match_flow


class FakeVault:
    """Enough Postgres to hold the store honest, and no more.

    Rather than parse SQL, this recognises the handful of statements the store
    actually issues and applies their real semantics — including the ON CONFLICT
    and the fences, which is the part being tested.
    """

    def __init__(self) -> None:
        self.matches: dict[str, dict] = {}
        self.bees: dict[tuple, dict] = {}
        self.cells: set[tuple] = set()
        self.fares: list[dict] = []
        self.settlements: dict[str, dict] = {}

    def _t(self, table: str) -> str:
        return table

    async def _execute(self, sql: str, params=None):
        p = params or []
        s = " ".join(sql.split())

        if s.startswith(("CREATE", "ALTER")):
            return {"rows": [], "rowCount": 0}

        if s.startswith(f"INSERT INTO {store.MATCHES}"):
            self.matches[p[0]] = {"match_id": p[0], "state": "forming", "seq": 0,
                                  "quorum_at": None, "started_at": None,
                                  "winner_npub": None, "winner_hive": None}
            return {"rows": [], "rowCount": 1}

        if s.startswith(f"SELECT * FROM {store.MATCHES} WHERE state = 'forming'"):
            rows = [m for m in self.matches.values() if m["state"] == "forming"]
            return {"rows": rows[:1], "rowCount": len(rows[:1])}

        if s.startswith(f"SELECT * FROM {store.MATCHES} WHERE match_id"):
            m = self.matches.get(p[0])
            return {"rows": [m] if m else [], "rowCount": 1 if m else 0}

        if s.startswith(f"SELECT * FROM {store.MATCHES} WHERE state IN"):
            rows = [m for m in self.matches.values() if m["state"] in ("forming", "running")]
            return {"rows": rows, "rowCount": len(rows)}

        if s.startswith(f"UPDATE {store.MATCHES} SET seq = seq + 1"):
            m = self.matches[p[0]]
            m["seq"] += 1
            return {"rows": [{"seq": m["seq"]}], "rowCount": 1}

        if s.startswith("SELECT hive, count(*)"):
            counts: dict[int, int] = {}
            for mid, h, _s in self.bees:
                if mid == p[0]:
                    counts[h] = counts.get(h, 0) + 1
            return {"rows": [{"hive": h, "n": n} for h, n in counts.items()], "rowCount": len(counts)}

        if s.startswith(f"INSERT INTO {store.BEES}"):
            key = (p[0], p[1], p[2])
            if key in self.bees:
                return {"rows": [], "rowCount": 0}  # ON CONFLICT DO NOTHING
            self.bees[key] = {"match_id": p[0], "hive": p[1], "seat": p[2], "npub": p[3],
                              "label": p[4], "cell": p[5], "phase": "forage",
                              "ready": True, "moves": 0, "digs": 0, "seals": 0,
                              "finished_at": None}
            return {"rows": [{"hive": p[1], "seat": p[2]}], "rowCount": 1}

        if s.startswith(f"SELECT * FROM {store.BEES} WHERE match_id") and "npub = $2" in s:
            hits = [b for b in self.bees.values() if b["match_id"] == p[0] and b["npub"] == p[1]]
            return {"rows": hits[:1], "rowCount": len(hits[:1])}

        if s.startswith("SELECT hive, seat, npub"):
            hits = [b for b in self.bees.values() if b["match_id"] == p[0]]
            return {"rows": hits, "rowCount": len(hits)}

        if s.startswith("SELECT hive, cell FROM"):
            hits = [{"hive": h, "cell": c} for (m, h, c) in sorted(self.cells) if m == p[0]]
            return {"rows": hits, "rowCount": len(hits)}

        if s.startswith(f"INSERT INTO {store.CELLS}") and "VALUES ($1," in s:
            # seed_mouths: many tuples, one param
            import re

            for h, c in re.findall(r"\(\$1, (\d+), (\d+), 'mouth'\)", s):
                self.cells.add((p[0], int(h), int(c)))
            return {"rows": [], "rowCount": 0}

        if s.startswith(f"UPDATE {store.BEES} SET cell = $3"):  # fly
            hits = [b for b in self.bees.values()
                    if b["match_id"] == p[0] and b["npub"] == p[1]
                    and b["cell"] == p[4] and b["ready"] and b["phase"] != "done"]
            if hits and "EXISTS" in s:
                hits = [b for b in hits if (p[0], p[5], p[2]) in self.cells]
            if not hits:
                return {"rows": [], "rowCount": 0}
            b = hits[0]
            b.update(cell=p[2], phase=p[3], moves=b["moves"] + 1, ready=False)
            return {"rows": [{"hive": b["hive"], "seat": b["seat"], "cell": b["cell"],
                              "phase": b["phase"]}], "rowCount": 1}

        if s.startswith("WITH ok AS") and "INSERT INTO" in s:  # dig
            eligible = [b for b in self.bees.values()
                        if b["match_id"] == p[0] and b["npub"] == p[1]
                        and b["cell"] == p[4] and b["ready"] and b["phase"] == "tunnel"]
            cut = 0
            if eligible and (p[0], p[5], p[2]) not in self.cells:
                self.cells.add((p[0], p[5], p[2]))
                cut = 1
            moved = 0
            if cut and eligible:
                b = eligible[0]
                b.update(cell=p[2], phase=p[3], moves=b["moves"] + 1,
                         digs=b["digs"] + 1, ready=False)
                moved = 1
            return {"rows": [{"cut": cut, "moved": moved}], "rowCount": 1}

        if s.startswith("WITH ok AS") and "DELETE FROM" in s:  # seal
            eligible = [b for b in self.bees.values()
                        if b["match_id"] == p[0] and b["npub"] == p[1]
                        and b["ready"] and b["phase"] == "tunnel"]
            occupied = any(b["match_id"] == p[0] and b["hive"] == p[2] and b["cell"] == p[3]
                           for b in self.bees.values())
            gone = 0
            if eligible and not occupied and (p[0], p[2], p[3]) in self.cells:
                self.cells.discard((p[0], p[2], p[3]))
                gone = 1
            return {"rows": [{"gone": gone}], "rowCount": 1}

        if s.startswith(f"INSERT INTO {store.FARES}"):
            self.fares.append({"match_id": p[0], "npub": p[1], "tool": p[2], "sats": p[3]})
            return {"rows": [], "rowCount": 1}

        if "sum(sats)" in s:
            total = sum(f["sats"] for f in self.fares if f["match_id"] == p[0])
            return {"rows": [{"pot": total}], "rowCount": 1}

        if s.startswith(f"INSERT INTO {store.SETTLEMENTS}"):
            if p[0] in self.settlements:
                return {"rows": [], "rowCount": 0}  # ON CONFLICT DO NOTHING
            self.settlements[p[0]] = {"match_id": p[0], "pot_sats": p[1], "charity_sats": p[2],
                                      "winner_sats": p[3], "operator_sats": p[4],
                                      "winner_npub": p[5], "beneficiary": p[6],
                                      "prize_state": "unclaimed"}
            return {"rows": [{"match_id": p[0]}], "rowCount": 1}

        if "sum(charity_sats)" in s:
            return {"rows": [{"owed": sum(x["charity_sats"] for x in self.settlements.values())}],
                    "rowCount": 1}

        if s.startswith(f"SELECT * FROM {store.SETTLEMENTS}"):
            return {"rows": list(self.settlements.values()), "rowCount": len(self.settlements)}

        if "winner_npub AS npub" in s:
            return {"rows": [], "rowCount": 0}

        if s.startswith(f"UPDATE {store.MATCHES} SET quorum_at"):
            m = self.matches[p[0]]
            if m["state"] == "forming" and m["quorum_at"] is None:
                m["quorum_at"] = "now"
            return {"rows": [], "rowCount": 1}

        if s.startswith(f"UPDATE {store.MATCHES} SET state = 'running'"):
            return {"rows": [], "rowCount": 0}

        return {"rows": [], "rowCount": 0}


@pytest.fixture
def vault(monkeypatch):
    v = FakeVault()
    store._vault = v
    store._schema_done = True
    yield v
    store._vault = None
    store._schema_done = False


def ready(v: FakeVault, npub: str) -> None:
    """Let a bee's cooldown lapse."""
    for b in v.bees.values():
        if b["npub"] == npub:
            b["ready"] = True


async def _seat(v: FakeVault, npub: str, cell: int, phase: str = "tunnel") -> str:
    mid = await store.open_match()
    await store.seed_mouths(mid)
    await store.take_seat(mid, npub, npub, 0)
    b = await store.bee_of(mid, npub)
    v.bees[(mid, 0, int(b["seat"]))].update(cell=cell, phase=phase, ready=True)
    return mid


# ── The fences ───────────────────────────────────────────────────────────


async def test_two_bees_racing_for_one_cell_only_one_wins(vault):
    """The whole reason the dig is a CTE.

    Both diggers see themselves as eligible; the primary key settles it. If both
    could win, two bees would occupy one cell and the board would be corrupt in
    a way nothing downstream could detect.
    """
    g = geo.make_geometry()
    start = geo.idx(g, g.wall, 0)
    target = geo.inward(g, g.wall, 0)
    assert target is not None

    mid = await _seat(vault, "npubA", start)
    await store.take_seat(mid, "npubB", "B", 0)
    b = await store.bee_of(mid, "npubB")
    vault.bees[(mid, 0, int(b["seat"]))].update(cell=start, phase="tunnel", ready=True)

    a, bres = await asyncio.gather(
        store.dig(mid, "npubA", target),
        store.dig(mid, "npubB", target),
    )
    winners = [r for r in (a, bres) if r.get("moved")]
    assert len(winners) == 1, f"exactly one bee may cut a cell: {a} {bres}"

    # And the board must AGREE — assert the stored state, not the return value.
    assert (mid, 0, target) in vault.cells
    occupants = [x for x in vault.bees.values() if x["cell"] == target]
    assert len(occupants) == 1


async def test_a_bee_on_cooldown_cannot_move(vault):
    g = geo.make_geometry()
    start = geo.idx(g, g.wall, 0)
    target = geo.inward(g, g.wall, 0)
    mid = await _seat(vault, "npubA", start)

    first = await store.dig(mid, "npubA", target)
    assert first["moved"]
    again = await store.fly(mid, "npubA", start)
    assert not again["moved"], "the cooldown fence is what stops a spammer"


async def test_a_move_must_be_to_a_neighbour(vault):
    mid = await _seat(vault, "npubA", geo.idx(geo.make_geometry(), 10, 3))
    with pytest.raises(store.BoardError):
        await store.fly(mid, "npubA", 0)  # the queen, nowhere near


async def test_flying_into_solid_comb_does_nothing(vault):
    g = geo.make_geometry()
    start = geo.idx(g, g.wall, 0)
    target = geo.inward(g, g.wall, 0)
    mid = await _seat(vault, "npubA", start)
    out = await store.fly(mid, "npubA", target)
    assert not out["moved"], "comb has to be dug, not flown through"


async def test_a_dug_cell_is_open_to_everyone(vault):
    """The freeloader's whole opportunity, and the reason sealing exists."""
    g = geo.make_geometry()
    start = geo.idx(g, g.wall, 0)
    target = geo.inward(g, g.wall, 0)
    mid = await _seat(vault, "npubA", start)
    await store.dig(mid, "npubA", target)

    await store.take_seat(mid, "npubB", "B", 0)
    b = await store.bee_of(mid, "npubB")
    vault.bees[(mid, 0, int(b["seat"]))].update(cell=start, phase="tunnel", ready=True)
    out = await store.fly(mid, "npubB", target)
    assert out["moved"], "a cut cell is public — that is the point of it"


async def test_you_cannot_seal_a_cell_a_bee_is_standing_in(vault):
    g = geo.make_geometry()
    start = geo.idx(g, g.wall, 0)
    target = geo.inward(g, g.wall, 0)
    mid = await _seat(vault, "npubA", start)
    await store.dig(mid, "npubA", target)   # A now stands in `target`
    ready(vault, "npubA")
    out = await store.seal(mid, "npubA", target)
    assert not out["sealed"]
    assert (mid, 0, target) in vault.cells


async def test_the_queen_and_the_meadow_can_never_be_sealed(vault):
    g = geo.make_geometry()
    mid = await _seat(vault, "npubA", geo.idx(g, 5, 2))
    with pytest.raises(store.BoardError):
        await store.seal(mid, "npubA", 0)
    with pytest.raises(store.BoardError):
        await store.seal(mid, "npubA", geo.idx(g, g.max_ring, 4))


async def test_sealing_reopens_the_comb(vault):
    g = geo.make_geometry()
    start = geo.idx(g, g.wall, 0)
    target = geo.inward(g, g.wall, 0)
    mid = await _seat(vault, "npubA", start)
    await store.dig(mid, "npubA", target)
    ready(vault, "npubA")

    # Move A off the cell so it is sealable, then bring it down.
    vault.bees[(mid, 0, 0)].update(cell=start, ready=True)
    out = await store.seal(mid, "npubA", target)
    assert out["sealed"]
    assert (mid, 0, target) not in vault.cells, "sealing must actually close the cell"


# ── Seats and the pot ────────────────────────────────────────────────────


async def test_two_patrons_arriving_together_get_different_seats(vault):
    mid = await store.open_match()
    a, b = await asyncio.gather(
        store.take_seat(mid, "npubA", "A", 0),
        store.take_seat(mid, "npubB", "B", 0),
    )
    assert a["seat"] != b["seat"], "a shared seat would be two bees in one body"


async def test_the_pot_is_the_sum_of_what_was_charged(vault):
    mid = await store.open_match()
    for n, sats in (("a", 5), ("b", 7), ("a", 3)):
        await store.record_fare(mid, n, "fly", sats)
    assert await store.pot_of(mid) == 15


async def test_a_free_tool_adds_nothing_to_the_pot(vault):
    mid = await store.open_match()
    await store.record_fare(mid, "a", "match_state", 0)
    assert await store.pot_of(mid) == 0


async def test_settling_twice_pays_once(vault):
    """The cron fires more than once. Paying a prize twice is not recoverable."""
    mid = await store.open_match()
    await store.record_fare(mid, "a", "fly", 1000)
    first = await store.record_settlement(mid, pot=1000, charity=800, winner=100,
                                          operator=100, winner_npub="a", beneficiary="X")
    second = await store.record_settlement(mid, pot=1000, charity=800, winner=100,
                                           operator=100, winner_npub="a", beneficiary="X")
    assert first is True
    assert second is False, "the second settlement must know it is a repeat"
    assert len(vault.settlements) == 1


async def test_the_split_never_loses_a_sat_and_rounding_favours_the_charity():
    for pot in (0, 1, 3, 7, 99, 1000, 12345, 999999):
        s = match_flow.split_pot(pot)
        assert s["charity"] + s["winner"] + s["operator"] == pot
        assert s["charity"] >= int(pot * match_flow.CHARITY_SHARE)


async def test_a_full_hive_turns_a_patron_away(vault):
    mid = await store.open_match()
    for i in range(store.SEATS):
        await store.take_seat(mid, f"npub{i}", str(i), 0)
    with pytest.raises(store.BoardError):
        await store.take_seat(mid, "onemore", "late", 0)


async def test_joining_fills_the_fullest_hive_so_quorum_is_reachable(vault):
    """Spreading evenly would leave no hive with eight and nothing would start."""
    for i in range(store.QUORUM):
        await match_flow.join(f"npub{i}", f"P{i}")
    m = await store.forming_match()
    counts = await store.seat_counts(str(m["match_id"]))
    assert max(counts.values()) == store.QUORUM
    assert m["quorum_at"] is not None, "reaching quorum must start the grace clock"
