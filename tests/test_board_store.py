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
        self.pollen: set[tuple] = set()
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
                                  "seed": p[1] if len(p) > 1 else 0,
                                  "board": p[2] if len(p) > 2 else "",
                                  "winner_npub": None, "winner_hive": None}
            return {"rows": [], "rowCount": 1}

        if s.startswith(f"SELECT * FROM {store.MATCHES} WHERE state = 'forming'"):
            rows = [m for m in self.matches.values()
                    if m["state"] == "forming" and m.get("board") == p[0]]
            return {"rows": rows[:1], "rowCount": len(rows[:1])}

        if s.startswith(f"SELECT * FROM {store.MATCHES} WHERE match_id"):
            m = self.matches.get(p[0])
            return {"rows": [m] if m else [], "rowCount": 1 if m else 0}

        if s.startswith(f"SELECT * FROM {store.MATCHES} WHERE state IN"):
            rows = [m for m in self.matches.values()
                    if m["state"] in ("forming", "running") and m.get("board") == p[0]]
            return {"rows": rows, "rowCount": len(rows)}

        if s.startswith("SELECT m.match_id,"):
            rows = [{"match_id": m["match_id"],
                     "fares": sum(1 for f in self.fares if f["match_id"] == m["match_id"])}
                    for m in self.matches.values() if m.get("board") != p[0]]
            return {"rows": rows, "rowCount": len(rows)}

        if s.startswith(f"DELETE FROM {store.MATCHES} WHERE match_id"):
            gone = self.matches.pop(p[0], None)
            return {"rows": [], "rowCount": 1 if gone else 0}

        if s.startswith(f"DELETE FROM {store.BEES} WHERE match_id"):
            keys = [k for k, b in self.bees.items() if b["match_id"] == p[0]]
            for k in keys:
                del self.bees[k]
            return {"rows": [], "rowCount": len(keys)}

        if s.startswith(f"DELETE FROM {store.CELLS} WHERE match_id"):
            keys = [c for c in self.cells if c[0] == p[0]]
            for k in keys:
                self.cells.discard(k)
            return {"rows": [], "rowCount": len(keys)}

        if s.startswith(f"UPDATE {store.MATCHES} SET state = 'abandoned'"):
            n = 0
            for mid in p[0]:
                m = self.matches.get(mid)
                if m and m["state"] in ("forming", "running"):
                    m["state"] = "abandoned"
                    n += 1
            return {"rows": [], "rowCount": n}

        if s.startswith(f"UPDATE {store.MATCHES} SET seq = seq + 1"):
            m = self.matches[p[0]]
            m["seq"] += 1
            return {"rows": [{"seq": m["seq"]}], "rowCount": 1}

        # Why a fenced move lost — asked only after one does.
        if s.startswith(f"SELECT 1 FROM {store.BEES} WHERE match_id = $1 AND hive = $2"):
            hit = any(b["match_id"] == p[0] and b["hive"] == p[1] and b["cell"] == p[2]
                      and b["npub"] != p[3] and b["phase"] != "done" for b in self.bees.values())
            return {"rows": [{"n": 1}] if hit else [], "rowCount": 1 if hit else 0}

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

        # Named table, not a shape. Two tables answer "hive, cell" now, and the
        # looser match silently swallowed the pollen read.
        if s.startswith(f"SELECT hive, cell FROM {store.CELLS}"):
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
            # The hive gate is optional, and so is its parameter — it is now
            # LAST, so that dropping it in the meadow renumbers nothing.
            if hits and "EXISTS" in s:
                hits = [b for b in hits if (p[0], p[6], p[2]) in self.cells]
            if not hits:
                return {"rows": [], "rowCount": 0}
            b = hits[0]
            b.update(cell=p[2], phase=p[3], moves=b["moves"] + 1, ready=False)
            return {"rows": [{"hive": b["hive"], "seat": b["seat"], "cell": b["cell"],
                              "phase": b["phase"]}], "rowCount": 1}

        if s.startswith("WITH ok AS") and store.POLLEN in s:  # land on a flower
            eligible = [b for b in self.bees.values()
                        if b["match_id"] == p[0] and b["npub"] == p[1]
                        and b["cell"] == p[3] and b["ready"] and b["phase"] == "forage"]
            took = 0
            if eligible and (p[0], p[4], p[2]) not in self.pollen:
                self.pollen.add((p[0], p[4], p[2]))
                took = 1
            if not eligible:
                return {"rows": [{"took": 0, "hive": None, "seat": None,
                                  "cell": None, "phase": None}], "rowCount": 1}
            b = eligible[0]
            # The loser still MOVES — a wasted trip is a real trip.
            b.update(cell=p[2], moves=b["moves"] + 1, ready=False,
                     phase="return" if took else b["phase"])
            return {"rows": [{"took": took, "hive": b["hive"], "seat": b["seat"],
                              "cell": b["cell"], "phase": b["phase"]}], "rowCount": 1}

        if s.startswith(f"SELECT hive, cell FROM {store.POLLEN}"):
            hits = [{"hive": h, "cell": c} for (m, h, c) in sorted(self.pollen) if m == p[0]]
            return {"rows": hits, "rowCount": len(hits)}

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
        await store.seal(mid, "npubA", g.hive_cells + 4)


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


def test_a_match_on_a_board_that_no_longer_exists_is_cleared_away(vault) -> None:
    """A cell id only means a cell while the board that numbered it exists.

    This is not hypothetical: after the geometry was split into a square meadow
    and a polar hive, a live forming match was left holding cells 585..622 on a
    358-cell board — four doors nobody could ever open, waiting for the next
    patron to join it.
    """

    async def go():
        mid = await store.open_match()
        assert vault.matches[mid]["board"] == geo.board_fingerprint()
        assert (await store.forming_match())["match_id"] == mid

        # The board changes under it.
        vault.matches[mid]["board"] = "a-board-that-is-gone"

        # It is invisible to matchmaking IMMEDIATELY, before any sweep runs —
        # the filter is the guard; the sweep is only tidying.
        assert await store.forming_match() is None
        assert await store.live_matches() == []

        out = await store.retire_stale_boards()
        assert out == {"deleted": 1, "abandoned": 0}
        assert mid not in vault.matches, "a match nobody paid into leaves nothing behind"

    asyncio.run(go())


def test_a_stale_match_that_took_fares_is_abandoned_rather_than_deleted(vault) -> None:
    """Its pot is owed to somebody whatever happened to the board.

    That distinction is the entire reason the sweep is not a DELETE across the
    board: money that changed hands outlives the geometry it was spent on.
    """

    async def go():
        mid = await store.open_match()
        await store.record_fare(mid, "npub1payer", "beesknees_bee_fly", 7)
        vault.matches[mid]["board"] = "a-board-that-is-gone"

        out = await store.retire_stale_boards()
        assert out == {"deleted": 0, "abandoned": 1}
        assert mid in vault.matches, "a match that took fares is never deleted"
        assert vault.matches[mid]["state"] == "abandoned"
        assert [f["sats"] for f in vault.fares] == [7], "and its fares are untouched"

    asyncio.run(go())


def test_the_fingerprint_changes_when_the_board_does(monkeypatch) -> None:
    """Derived, not declared — a hand-bumped constant is only right while
    somebody remembers to bump it, and this board changed twice in one day."""
    before = geo.board_fingerprint()
    monkeypatch.setattr(geo, "GRID_N", geo.GRID_N + 1)
    assert geo.board_fingerprint() != before, "a different meadow is a different board"


def test_two_bees_racing_for_one_flower_only_one_gets_the_pollen(vault) -> None:
    """The meadow's one real decision, and it has to survive a dead heat.

    A flower is taken by whoever lands first. Two bees arriving together must
    not both leave loaded — but the loser must still MOVE, because flying to a
    flower a rival emptied is a legal wasted trip, and telling that patron their
    move was refused would be a lie about what happened to their fare.
    """

    async def go():
        mid = await store.open_match()
        g = geo.make_geometry()
        m = vault.matches[mid]
        flowers = geo.hive_board(g, store.hive_seed(int(m["seed"]), 0)).flowers
        flower = flowers[0]
        # Both bees one step short of the same flower, both due to move.
        neighbours = [n for n in geo.neighbors(g, flower) if geo.is_meadow(g, n)]
        for i, (npub, cell) in enumerate(zip(["npubA", "npubB"], neighbours[:2], strict=True)):
            await store.take_seat(mid, npub, f"bee{i}", 0)
            vault.bees[(mid, 0, i)].update(cell=cell, phase="forage", ready=True)

        a = await store.fly(mid, "npubA", flower)
        b = await store.fly(mid, "npubB", flower)

        assert a["moved"] and b["moved"], "both bees really did fly there"
        assert a["pollen"] is True, "the first to land takes it"
        assert b["pollen"] is False, "and the second finds it empty"
        assert a["phase"] == "return", "loaded, and heading home"
        assert b["phase"] == "forage", "unloaded, and must find another"
        assert len([x for x in vault.pollen if x[2] == flower]) == 1, "emptied exactly once"

        taken = await store.taken_pollen(mid)
        assert {"hive": 0, "cell": flower} in taken, "and the board says which"
        assert len(taken) == 1, f"only one flower should be spent, got {taken}"

    asyncio.run(go())


def test_a_statement_cannot_be_sent_more_values_than_it_uses() -> None:
    """The one defect class the fake vault is blind to, caught before the wire.

    PostgreSQL refuses a bind that supplies more values than the statement
    mentions, and it arrives as a driver error rather than a BoardError — so it
    escapes as an unhandled exception and reaches the patron as "Tool execution
    failed". `fly` built its hive gate conditionally but always sent `hive` as
    $6, so every move into the MEADOW shipped seven values for a six-parameter
    statement. Every foraging bee in the first live round was refused, and this
    suite stayed green throughout, because the fake reads parameters positionally
    and never looks at the SQL.
    """
    store._check_params("SELECT $1, $2", ["a", "b"])  # the honest case

    with pytest.raises(ValueError, match=r"uses \$1\.\.\$2 but was handed 3"):
        store._check_params("SELECT $1, $2", ["a", "b", "c"])

    with pytest.raises(ValueError, match=r"uses \$1\.\.\$2 but was handed 1"):
        store._check_params("SELECT $1, $2", ["a"])

    # A gap is just as fatal, and reads as a typo rather than a miscount.
    with pytest.raises(ValueError, match=r"never mentions"):
        store._check_params("SELECT $1, $3", ["a", "b", "c"])


def test_a_blocked_move_still_says_who_blocked_it(vault) -> None:
    """The fence enforces; the explanation comes after, and only on a loss.

    Occupancy used to be a SELECT before every move — a whole round trip on the
    happy path, and not even a fence: between that check and the write another
    bee could take the cell and both would land in it. It is enforced inside the
    statement now, so the check is asked only when a move actually loses, and it
    still has to name the rival rather than shrug.
    """

    async def go():
        mid = await store.open_match()
        g = geo.make_geometry()
        await store.take_seat(mid, "npubA", "a", 0)
        await store.take_seat(mid, "npubB", "b", 0)
        a, b = vault.bees[(mid, 0, 0)], vault.bees[(mid, 0, 1)]

        # B parks on a square A wants.
        target = next(n for n in geo.neighbors(g, a["cell"]) if geo.is_meadow(g, n))
        b.update(cell=target, phase="forage", ready=True)
        a.update(phase="forage", ready=True)

        out = await store.fly(mid, "npubA", target)
        assert out["moved"] is False
        assert "another bee is standing there" in out["reason"], out["reason"]
        assert a["cell"] != target, "the fence let a bee walk through another"

    asyncio.run(go())
