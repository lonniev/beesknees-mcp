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


def _limited(rows: list, sql: str) -> list:
    """Apply the statement's own LIMIT, the way Postgres would.

    A fake that returns every row no matter what the query said cannot show a
    caller falling off the end of a page — which is exactly the failure the
    payout path had.
    """
    import re

    m = re.search(r"LIMIT\s+(\d+)", sql)
    return rows[: int(m.group(1))] if m else rows


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

        # Occupancy is fenced INSIDE the statement now, so the fake has to
        # honour it or the tests quietly stop covering it — the guard moved
        # into the SQL and the coverage did not follow it.
        def occupied(match_id, hive, cell, npub):
            return any(b["match_id"] == match_id and b["hive"] == hive
                       and b["cell"] == cell and b["npub"] != npub
                       and b["phase"] != "done" for b in self.bees.values())

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

        # The retention sweep. A fake cannot do Postgres date arithmetic, so
        # the age predicate is modelled as a flag the test sets: what these
        # branches prove is the ORDER and the SURVIVORS, not the interval.
        if s.startswith(f"UPDATE {store.MATCHES} SET ended_at = now() - interval"):
            self.matches[p[0]]["_aged_out"] = True
            return {"rows": [], "rowCount": 1}

        if "IN (SELECT match_id FROM" in s and s.startswith("DELETE FROM "):
            table = s.split()[2]
            doomed = {k for k, v in self.matches.items() if v.get("_aged_out")}
            if table == store.BEES:
                n = len([b for b in self.bees.values() if b["match_id"] in doomed])
                self.bees = {k: b for k, b in self.bees.items() if b["match_id"] not in doomed}
            elif table == store.FARES:
                n = len([x for x in self.fares if x["match_id"] in doomed])
                self.fares = [x for x in self.fares if x["match_id"] not in doomed]
            else:
                n = 0
            return {"rows": [], "rowCount": n}

        if s.startswith(f"DELETE FROM {store.MATCHES} WHERE ended_at IS NOT NULL"):
            doomed = {k for k, v in self.matches.items() if v.get("_aged_out")}
            for k in doomed:
                del self.matches[k]
            return {"rows": [], "rowCount": len(doomed)}

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

        if s.startswith(f"SELECT name, website, lightning_address FROM {store.CHARITY}"):
            c = getattr(self, "charity", None)
            return {"rows": [c] if c else [], "rowCount": 1 if c else 0}

        if s.startswith(f"INSERT INTO {store.CHARITY}"):
            self.charity = {"name": p[0], "website": p[1], "lightning_address": p[2]}
            return {"rows": [], "rowCount": 1}

        if s.startswith(f"SELECT lightning_address, donate FROM {store.PATRONS}"):
            row = getattr(self, "patrons", {}).get(p[0])
            return {"rows": [row] if row else [], "rowCount": 1 if row else 0}

        if s.startswith(f"INSERT INTO {store.PATRONS}"):
            if not hasattr(self, "patrons"):
                self.patrons = {}
            self.patrons[p[0]] = {"lightning_address": p[1], "donate": p[2]}
            return {"rows": [], "rowCount": 1}

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
            # A cell holds one bee, and that is fenced INSIDE the statement now.
            if hits and "o.npub <> $2" in s and occupied(p[0], p[6], p[2], p[1]):
                hits = []
            # The hive gate is conditional; `hive` is $7 and always sent.
            if hits and f"FROM {store.CELLS} c" in s:
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
            if eligible and occupied(p[0], p[4], p[2], p[1]):
                eligible = []
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
            if eligible and occupied(p[0], p[5], p[2], p[1]):
                eligible = []
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

        if s.startswith(f"DELETE FROM {store.FARES} WHERE match_id"):
            before = len(self.fares)
            self.fares = [x for x in self.fares if x["match_id"] != p[0]]
            return {"rows": [], "rowCount": before - len(self.fares)}

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

        if s.startswith(f"UPDATE {store.SETTLEMENTS} SET prize_state"):
            row = self.settlements.get(p[0])
            if row and row["prize_state"] == "unclaimed":
                row["prize_state"] = p[1]
                return {"rows": [], "rowCount": 1}
            return {"rows": [], "rowCount": 0}

        if s.startswith(f"INSERT INTO {store.PAYOUTS} (payout_id, kind, match_id, destination, amount_sats) SELECT"):
            if not hasattr(self, "payouts"):
                self.payouts = {}
            out = []
            for row in self.settlements.values():
                pid = f"charity:{row['match_id']}"
                if row["charity_sats"] > 0 and pid not in self.payouts:
                    self.payouts[pid] = {"payout_id": pid, "kind": "charity",
                                         "match_id": row["match_id"], "destination": p[0],
                                         "amount_sats": row["charity_sats"],
                                         "state": "sending", "payment_hash": "",
                                         "detail": "", "started_at": "now"}
                    out.append({"match_id": row["match_id"],
                                "amount_sats": row["charity_sats"]})
            return {"rows": out, "rowCount": len(out)}

        if s.startswith(f"INSERT INTO {store.PAYOUTS}"):
            if not hasattr(self, "payouts"):
                self.payouts = {}
            if p[0] in self.payouts:
                return {"rows": [], "rowCount": 0}  # ON CONFLICT DO NOTHING
            self.payouts[p[0]] = {"payout_id": p[0], "kind": p[1], "match_id": p[2],
                                  "destination": p[3], "amount_sats": p[4],
                                  "state": "sending", "payment_hash": "", "detail": "",
                                  "started_at": "now"}
            return {"rows": [], "rowCount": 1}

        if "WHERE state = 'sending' AND payout_id IN" in s:
            n = 0
            for pid in p[3:]:
                row = getattr(self, "payouts", {}).get(pid)
                if row and row["state"] == "sending":
                    row.update(state=p[0], payment_hash=p[1], detail=p[2])
                    n += 1
            return {"rows": [], "rowCount": n}

        if s.startswith(f"UPDATE {store.PAYOUTS} SET state"):
            row = getattr(self, "payouts", {}).get(p[0])
            if row and row["state"] == "sending":
                row.update(state=p[1], payment_hash=p[2], detail=p[3])
                return {"rows": [], "rowCount": 1}
            return {"rows": [], "rowCount": 0}

        if s.startswith(f"SELECT * FROM {store.SETTLEMENTS} WHERE match_id"):
            row = self.settlements.get(p[0])
            return {"rows": [row] if row else [], "rowCount": 1 if row else 0}

        if s.startswith(f"SELECT * FROM {store.PAYOUTS} WHERE payout_id"):
            row = getattr(self, "payouts", {}).get(p[0])
            return {"rows": [row] if row else [], "rowCount": 1 if row else 0}

        if s.startswith(f"SELECT * FROM {store.PAYOUTS}"):
            rows = _limited(list(getattr(self, "payouts", {}).values()), s)
            return {"rows": rows, "rowCount": len(rows)}

        if "AS prizes FROM" in s:
            return {"rows": [{
                "charity": sum(x["charity_sats"] for x in self.settlements.values()),
                "prizes": sum(x["winner_sats"] for x in self.settlements.values()
                              if x["prize_state"] == "kept"),
            }], "rowCount": 1}

        if "AS sent FROM" in s:
            by: dict[str, int] = {}
            for row in getattr(self, "payouts", {}).values():
                if row["state"] in ("sending", "paid"):
                    by[row["kind"]] = by.get(row["kind"], 0) + row["amount_sats"]
            rows = [{"kind": k, "sent": v} for k, v in by.items()]
            return {"rows": rows, "rowCount": len(rows)}

        if "sum(charity_sats)" in s:
            return {"rows": [{"owed": sum(x["charity_sats"] for x in self.settlements.values())}],
                    "rowCount": 1}

        if s.startswith(f"SELECT * FROM {store.SETTLEMENTS}"):
            # The LIMIT is honoured, because it is the whole point: a page that
            # silently returns everything hides the bug where a row falls off
            # the end of it.
            rows = _limited(list(self.settlements.values()), s)
            return {"rows": rows, "rowCount": len(rows)}

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
    # A digs it and is now STANDING in it. The shaft is what outlives the digger,
    # not the space it happens to be occupying this second, so A moves on before
    # the freeloader arrives — otherwise this would be testing bodies, not tunnels.
    a = await store.bee_of(mid, "npubA")
    vault.bees[(mid, 0, int(a["seat"]))]["cell"] = start

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


async def test_seats_are_dealt_round_robin_so_every_hive_gets_underway(vault):
    """The whole board plays, and it plays balanced.

    Seats used to fill the FULLEST hive first, because quorum meant "some hive
    reached eight" and spreading would have left no hive with eight and nothing
    would ever have started. Quorum is now counted across the match, so the two
    rules changed together — round-robin with a per-hive quorum is a lobby that
    never opens.

    Balance is what makes thin attendance fair rather than merely thin: twelve
    bees dealt round-robin gives everyone a rival, while twelve dealt
    fullest-first gives one crowded hive and four empty boards where a lone
    arrival would win by walking.
    """
    for i in range(store.QUORUM):
        await match_flow.join(f"npub{i}", f"P{i}")
    m = await store.forming_match()
    counts = await store.seat_counts(str(m["match_id"]))

    assert sum(counts.values()) == store.QUORUM
    assert len(counts) == store.HIVES, "every hive should have taken a bee"
    assert max(counts.values()) - min(counts.values()) <= 1, (
        "round-robin must never leave one hive a seat richer than by one"
    )
    assert m["quorum_at"] is not None, "reaching quorum must start the grace clock"


async def test_quorum_counts_the_match_not_the_fullest_hive(vault):
    """One short of quorum must not start, however the bees are spread.

    With seats dealt round-robin no hive fills first, so a quorum that watched
    the fullest hive would sit one short for ever.
    """
    for i in range(store.QUORUM - 1):
        await match_flow.join(f"npub{i}", f"P{i}")
    m = await store.forming_match()
    assert m["quorum_at"] is None, "seven bees is not a quorum"

    await match_flow.join("npubLast", "the eighth")
    m = await store.forming_match()
    assert m["quorum_at"] is not None


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


def test_the_fingerprint_covers_the_flowers(monkeypatch) -> None:
    """Where the pollen goes is as much the board as where the walls are.

    The placer changed — flowers off the door gateways, two hops out — and
    nothing retired the matches laid out under the old rule, because the hash
    covered dimensions, doors and obstructions and not this. A match in flight
    was being played on a different meadow from the one it started on.
    """
    before = geo.board_fingerprint()
    monkeypatch.setattr(geo, "FLOWERS", geo.FLOWERS - 1)
    assert geo.board_fingerprint() != before, "moving the pollen is moving the board"


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

        assert a["moved"] and a["pollen"] is True, "the first to land takes it"
        assert a["phase"] == "return", "loaded, and heading home"
        # The second does not merely find it empty — it cannot land at all while
        # the first is still standing on it. A bee has a body, so the loser of a
        # dead heat hovers alongside until the square clears, by which time the
        # pollen is gone. `test_aiming_at_a_flower_reserves_nothing` walks that
        # whole sequence through.
        assert b["moved"] is False, "a bee cannot land on an occupied flower"
        assert "another bee is standing there" in b["reason"]
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


def test_aiming_at_a_flower_reserves_nothing(vault) -> None:
    """There is no remote lockout, and there must not be one.

    A player picks a flower and sets off; so does everybody else. Nothing is sent
    to the server when they aim, so nothing is held: pollen is taken by ARRIVING,
    inside the move statement, and the loser of a dead heat still moves — flying
    to an emptied flower is a legal wasted trip.

    A bee already STANDING on the flower is a different refusal, and the right
    one: the cell holds a body, so the second bee is turned away and must hover
    alongside until the square clears — by which time the pollen is gone.
    """

    async def go():
        mid = await store.open_match()
        g = geo.make_geometry()
        m = vault.matches[mid]
        flower = geo.hive_board(g, store.hive_seed(int(m["seed"]), 0)).flowers[0]
        around = [n for n in geo.neighbors(g, flower) if geo.is_meadow(g, n)]

        for i, npub in enumerate(("npubA", "npubB")):
            await store.take_seat(mid, npub, f"b{i}", 0)
            vault.bees[(mid, 0, i)].update(cell=around[i], phase="forage", ready=True)

        # Both aimed at it; neither holds it. Nothing is stored until one lands.
        assert await store.taken_pollen(mid) == [], "aiming must reserve nothing"

        first = await store.fly(mid, "npubA", flower)
        assert first["pollen"] is True and first["phase"] == "return"

        # A is still standing on it, so B is refused by the BODY, not the pollen.
        vault.bees[(mid, 0, 1)]["ready"] = True
        blocked = await store.fly(mid, "npubB", flower)
        assert blocked["moved"] is False
        assert "another bee is standing there" in blocked["reason"]

        # A moves on; B lands, and finds it empty.
        vault.bees[(mid, 0, 0)]["cell"] = around[0]
        vault.bees[(mid, 0, 1)]["ready"] = True
        late = await store.fly(mid, "npubB", flower)
        assert late["moved"] is True, "the trip is legal even though it is wasted"
        assert late["pollen"] is False
        assert late["phase"] == "forage", "unloaded, and must find another flower"

    asyncio.run(go())


def test_the_operator_names_the_charity_and_history_keeps_the_old_one(vault) -> None:
    """Who the money goes to is configuration, not a build artefact.

    It was a constant in the source, so changing the beneficiary meant a
    deployment. A charity can be replaced, renamed, or rotate its wallet, and
    none of that should need anybody to touch code — but a settlement must still
    record whoever it ACTUALLY paid, or history quietly rewrites itself every
    time the current one changes.
    """

    async def go():
        assert await store.get_charity() == {
            "name": "", "website": "", "lightning_address": "",
        }, "an unconfigured service names nobody rather than guessing"

        c = await store.set_charity(
            "Pollinator Partnership", "https://pollinator.org", "pollinators@getalby.com"
        )
        assert c["name"] == "Pollinator Partnership"
        assert c["lightning_address"] == "pollinators@getalby.com"

        # A settlement stamps the beneficiary of the day...
        mid = await store.open_match()
        await store.record_settlement(
            mid, pot=100, charity=80, winner=10, operator=10,
            winner_npub="npub1w", beneficiary=c["name"],
        )
        # ...and renaming the current one does not touch it.
        await store.set_charity("Somebody Else", "https://example.org", "other@wallet.com")
        rows = await store.settlements(10)
        assert rows[0]["beneficiary"] == "Pollinator Partnership", (
            "changing the charity rewrote where past money went"
        )

    asyncio.run(go())


def test_a_winner_says_before_the_round_what_becomes_of_their_share(vault) -> None:
    """Donating is the default, and the default has to work for somebody silent.

    Asking in the moment is asking somebody to decide about money with a trophy
    on screen. A patron who has never thought about it still ends the round with
    their share settled rather than owed.
    """

    async def go():
        # Nobody has said anything: donate, and we know it was not chosen.
        assert await store.get_payout("npub1quiet") == {
            "lightning_address": "", "donate": True, "set": False,
        }

        # Keeping it is a standing instruction with somewhere to send it.
        out = await store.set_payout("npub1keen", "me@wallet.com", donate=False)
        assert out == {"lightning_address": "me@wallet.com", "donate": False, "set": True}

        # And changing your mind is just saying so again.
        out = await store.set_payout("npub1keen", "me@wallet.com", donate=True)
        assert out["donate"] is True

    asyncio.run(go())


def test_a_standing_donation_is_honoured_without_asking_again(vault, monkeypatch) -> None:
    """The share is HELD, not credited, until the choice is actually resolved.

    Settlement used to credit the winner and then offer them a donate button,
    which donated nothing — the sats were already in their balance. So a winner
    who has said "donate" is never credited at all, and a winner who has never
    said keeps the choice with the share still unspent.
    """
    credited: list[tuple[str, int]] = []

    async def fake_award(match_id, npub, sats):
        credited.append((npub, sats))
        return True

    monkeypatch.setattr(match_flow, "award_prize", fake_award)

    async def go():
        await store.set_charity("Pollinator Partnership", "https://pollinator.org", "p@wallet.com")

        # Somebody who has said "donate": resolved on the spot, nothing credited.
        mid = await store.open_match()
        await store.set_payout("npub1giver", "", donate=True)
        await store.record_settlement(mid, pot=1000, charity=800, winner=100, operator=100,
                                      winner_npub="npub1giver", beneficiary="Pollinator Partnership")
        assert await match_flow.resolve_prize(mid, "npub1giver", 100) == "donated"
        assert credited == [], "a donated share must never reach the winner's balance"

        # Somebody who has said "keep": credited, and recorded as kept.
        mid2 = await store.open_match()
        await store.set_payout("npub1keeper", "me@wallet.com", donate=False)
        await store.record_settlement(mid2, pot=1000, charity=800, winner=100, operator=100,
                                      winner_npub="npub1keeper", beneficiary="Pollinator Partnership")
        assert await match_flow.resolve_prize(mid2, "npub1keeper", 100) == "kept"
        assert credited == [("npub1keeper", 100)]

        # Somebody who has never said: the share waits for them to choose.
        mid3 = await store.open_match()
        await store.record_settlement(mid3, pot=1000, charity=800, winner=100, operator=100,
                                      winner_npub="npub1quiet", beneficiary="Pollinator Partnership")
        assert await match_flow.resolve_prize(mid3, "npub1quiet", 100) == "unclaimed"
        assert credited == [("npub1keeper", 100)], "an unresolved share is not credited either"

    asyncio.run(go())


def test_a_resolved_prize_cannot_be_resolved_a_second_way(vault, monkeypatch) -> None:
    """A cron that fires twice must not turn a donation back into a claim."""

    async def fake_award(match_id, npub, sats):
        return True

    monkeypatch.setattr(match_flow, "award_prize", fake_award)

    async def go():
        mid = await store.open_match()
        await store.set_payout("npub1giver", "", donate=True)
        await store.record_settlement(mid, pot=1000, charity=800, winner=100, operator=100,
                                      winner_npub="npub1giver", beneficiary="Somebody")
        await match_flow.resolve_prize(mid, "npub1giver", 100)
        await store.set_prize_state(mid, "kept")  # a replay trying to take it back
        rows = await store.settlements(10)
        assert rows[0]["prize_state"] == "donated"

    asyncio.run(go())


def test_the_public_charity_answer_carries_no_wallet(vault) -> None:
    """`charity` is unauthenticated, and a wallet buys a player nothing.

    The name and the site ARE the claim — they are what a player checks. Where
    the sats are actually sent is the operator's plumbing, and putting it in a
    free tool means publishing it to anybody who asks.
    """
    from beesknees_mcp import server

    async def go():
        await store.set_charity("Pollinator Partnership", "https://pollinator.org", "p@wallet.com")
        # The undecorated body: the fare wrapper is the runtime's business, and
        # what this asserts is the SHAPE the tool hands back.
        out = await server.charity.__wrapped__(npub="npub1x")
        assert out["name"] == "Pollinator Partnership"
        assert out["website"] == "https://pollinator.org"
        assert "lightning_address" not in out, "the free answer must not carry the wallet"

        hist = await server.settlement_history.__wrapped__(limit=5, npub="npub1x")
        assert "lightning_address" not in hist["charity"]

    asyncio.run(go())


def test_a_payment_can_only_be_claimed_once(vault) -> None:
    """The claim is taken BEFORE the sats move, and that is the whole guard.

    A retry, a second operator pressing the button, and a rerun of the same
    cron all arrive here. They collide on a primary key rather than at the
    node, where the collision would be two payments.
    """

    async def go():
        mid = await store.open_match()
        assert await store.claim_payout("charity", mid, "p@wallet.com", 800) is True
        assert await store.claim_payout("charity", mid, "p@wallet.com", 800) is False, (
            "a second claim on the same leg must lose"
        )
        # The other leg of the same match is a different payment, not a repeat.
        assert await store.claim_payout("winner", mid, "me@wallet.com", 100) is True

    asyncio.run(go())


def test_a_payment_still_in_flight_counts_as_spent(vault) -> None:
    """It may yet fail, and then the money comes back and the figure improves.

    Assuming it failed would let the same sats be promised to somebody else
    while the first attempt is still moving.
    """

    async def go():
        mid = await store.open_match()
        await store.record_settlement(mid, pot=1000, charity=800, winner=100,
                                      operator=100, winner_npub="npub1w",
                                      beneficiary="Pollinator Partnership")

        assert (await store.obligations())["charity_unpaid_sats"] == 800

        await store.claim_payout("charity", mid, "p@wallet.com", 800)
        assert (await store.obligations())["charity_unpaid_sats"] == 0, (
            "an in-flight payment must not leave the same sats promised twice"
        )

        # And a failure puts it back, because nothing left.
        await store.finish_payout("charity", mid, state="failed", detail="no route")
        assert (await store.obligations())["charity_unpaid_sats"] == 800

    asyncio.run(go())


def test_only_a_kept_prize_is_owed_to_a_winner(vault) -> None:
    """A donated share is the charity's, and must not be counted twice."""

    async def go():
        mid = await store.open_match()
        await store.record_settlement(mid, pot=1000, charity=800, winner=100,
                                      operator=100, winner_npub="npub1w",
                                      beneficiary="Somebody")
        # Unclaimed: not yet owed to anybody in particular.
        assert (await store.obligations())["prizes_unpaid_sats"] == 0

        await store.set_prize_state(mid, "kept")
        assert (await store.obligations())["prizes_unpaid_sats"] == 100

    asyncio.run(go())


def test_a_settlement_is_found_by_id_not_by_scanning_a_capped_page(vault) -> None:
    """The payout path used to read the newest 200 settlements and filter in
    Python. That is not merely wasteful: a match older than the last 200 became
    invisible, and `pay_out` answered "no settled match with that id" about a
    settlement sitting right there in the table.
    """

    async def go():
        old = await store.open_match()
        await store.record_settlement(old, pot=1000, charity=800, winner=100,
                                      operator=100, winner_npub="npub1w",
                                      beneficiary="Pollinator Partnership")
        # Bury it under more settlements than any page would return.
        for _ in range(205):
            mid = await store.open_match()
            await store.record_settlement(mid, pot=10, charity=8, winner=1,
                                          operator=1, winner_npub="npub1x",
                                          beneficiary="Somebody")

        assert len(await store.settlements(200)) == 200, "the page is capped"
        found = await store.settlement_of(old)
        assert found is not None, "a buried settlement must still be payable"
        assert found["charity_sats"] == 800

    asyncio.run(go())


def test_an_older_payment_is_still_found_when_deciding_if_sats_already_went(vault) -> None:
    """The worst place to be wrong. Reading this from a capped page meant an
    older payment looked like NO payment, on the exact path that decides
    whether money has already left.
    """

    async def go():
        mid = await store.open_match()
        await store.claim_payout("charity", mid, "p@wallet.com", 800)
        await store.finish_payout("charity", mid, state="paid", payment_hash="abc")
        for _ in range(205):
            other = await store.open_match()
            await store.claim_payout("charity", other, "p@wallet.com", 8)

        found = await store.payout_of("charity", mid)
        assert found is not None and found["state"] == "paid"
        assert await store.payout_of("winner", mid) is None, "the other leg is its own payment"

    asyncio.run(go())


def test_the_charity_is_claimed_in_one_batch_and_never_twice(vault) -> None:
    """Every unpaid leg at once, on the same key a single payout would use.

    A match's charity share can be smaller than the fee floor it costs to
    route, so paying per match can cost more than it delivers. Batching is the
    point — but the accounting stays per match, so `obligations()` keeps
    counting honestly and a reader can see which matches a payment covered.
    """

    async def go():
        ids = []
        for _ in range(3):
            mid = await store.open_match()
            await store.record_settlement(mid, pot=1000, charity=800, winner=100,
                                          operator=100, winner_npub="npub1w",
                                          beneficiary="Pollinator Partnership")
            ids.append(mid)

        claimed = await store.claim_charity_arrears("p@wallet.com")
        assert len(claimed) == 3
        assert sum(int(c["amount_sats"]) for c in claimed) == 2400
        assert (await store.obligations())["charity_unpaid_sats"] == 0

        # A second press claims nothing — the legs are already spoken for.
        assert await store.claim_charity_arrears("p@wallet.com") == []

        # And a single-match payout cannot pay one of them again: same key.
        assert await store.claim_payout("charity", ids[0], "p@wallet.com", 800) is False

    asyncio.run(go())


def test_a_failed_batch_gives_the_debt_back(vault) -> None:
    """`obligations()` counts only `sending` and `paid`, so marking the legs
    failed restores the debt — without losing the record of the attempt."""

    async def go():
        mid = await store.open_match()
        await store.record_settlement(mid, pot=1000, charity=800, winner=100,
                                      operator=100, winner_npub="npub1w",
                                      beneficiary="Somebody")
        claimed = await store.claim_charity_arrears("p@wallet.com")
        assert (await store.obligations())["charity_unpaid_sats"] == 0

        n = await store.finish_charity_arrears(
            [str(c["match_id"]) for c in claimed], state="failed", detail="no route"
        )
        assert n == 1
        assert (await store.obligations())["charity_unpaid_sats"] == 800, (
            "a failed payment must not leave the charity looking paid"
        )
        assert [p["state"] for p in await store.payouts(10)] == ["failed"]

    asyncio.run(go())


def test_a_bee_carrying_pollen_does_not_leave_the_hive(vault) -> None:
    """The doorway rule, enforced where it counts.

    A bee that has crossed a door does not step back out. It used to be free
    to, and over 1,218 simulated crossings 52.6% did — every one carrying
    pollen and heading for the queen. The cause is a doorway under pressure:
    the cell inside is taken by whoever is queueing, the wall either side
    cannot be cut, and the only legal move left is back into the meadow.

    Asserted against the server rather than the browser because a rule only the
    client checks is a rule only honest players follow.
    """
    g = geo.make_geometry()
    door = next(c for c in range(g.hive_cells) if geo.ring_of(g, c) == g.wall)
    outside = next(
        (n for n in geo.neighbors(g, door) if geo.is_meadow(g, n)), None
    )
    assert outside is not None, "a door must open onto the meadow"

    # Carrying pollen, standing in the doorway: the meadow is behind you now.
    with pytest.raises(store.BoardError, match="not leaving the hive"):
        store._require_commitment(g, {"phase": "tunnel", "cell": door}, outside)

    # Still foraging, so the meadow is exactly where it should be going.
    store._require_commitment(g, {"phase": "forage", "cell": door}, outside)

    # And carrying pollen OUTSIDE, on its way in — untouched.
    store._require_commitment(g, {"phase": "tunnel", "cell": outside}, outside)

    # Inward is never what this rule is about.
    inward = geo.inward(g, geo.ring_of(g, door), door - g.offset[g.wall])
    if inward is not None:
        store._require_commitment(g, {"phase": "tunnel", "cell": door}, inward)


def test_settling_collapses_the_fares_into_the_pot(vault) -> None:
    """The rows that added up to the pot go; the pot stays.

    They are 93% of everything this service writes — about 6,758 per full
    round once the tools are priced — and the moment `record_settlement`
    stores their total they have done their whole job. Keeping them would mean
    carrying a move-by-move record of every round ever played for the sake of
    a number already stored.
    """

    async def go():
        mid = await store.open_match()
        for i in range(5):
            await store.record_fare(mid, f"npub{i}", "fly", 3)
        assert await store.pot_of(mid) == 15

        out = await match_flow.settle(mid)
        assert out["pot"] == 15, "the pot is read BEFORE the rows are dropped"
        assert await store.pot_of(mid) == 0, "the fare rows are gone"

        # And the money survives them, which is the whole point.
        rows = await store.settlements(10)
        assert rows[0]["pot_sats"] == 15
        # 13, not 12: the winner and the operator take floor(10%) — one sat
        # each — and the charity takes what is left. Rounding falls to the
        # charity by construction, never to the operator.
        assert rows[0]["charity_sats"] == 13
        assert sum(rows[0][k] for k in ("charity_sats", "winner_sats", "operator_sats")) == 15

    asyncio.run(go())


def test_a_replayed_settlement_does_not_delete_somebody_elses_evidence(vault) -> None:
    """`record_settlement` returning False means somebody got there first.

    Rolling up on that path would drop the fares of a match this call did not
    settle — deleting the evidence on the way past, which is worse than
    useless.
    """

    async def go():
        mid = await store.open_match()
        await store.record_fare(mid, "npub1a", "fly", 7)

        first = await match_flow.settle(mid)
        assert first["first_time"] is True
        assert await store.pot_of(mid) == 0

        # A second fare arrives late, after settlement. A replayed settle must
        # leave it alone rather than tidying it away.
        await store.record_fare(mid, "npub1b", "dig", 4)
        again = await match_flow.settle(mid)
        assert again["first_time"] is False
        assert await store.pot_of(mid) == 4, "a replay must not delete what it did not settle"

    asyncio.run(go())


def test_old_rounds_forget_how_they_were_played_but_not_what_they_paid(vault) -> None:
    """A retention window, because the danger is a good week and not a steady state.

    Nothing used to reclaim anything: the only DELETE fired when the geometry
    changed. A finished round kept every bee, every dug cell and every fare for
    ever — roughly 1.9 MB apiece once priced, which is 6.6 GB a year at ten
    rounds a day and 33 GB at fifty.

    What must NOT go is the money. `settlement_history` and `payout_history`
    are the claim a charity or a winner would come back and check, so they
    outlive the board the round was won on.

    The fake cannot do Postgres date arithmetic, so what this proves is the
    order and the survivors — detail goes, ledger stays — rather than that the
    interval is seven days. The interval is one constant in one statement.
    """

    async def go():
        old = await store.open_match()
        await store.record_settlement(old, pot=100, charity=80, winner=10, operator=10,
                                      winner_npub="npub1w", beneficiary="Pollinator Partnership")
        await store.take_seat(old, "npub1w", "W", 0)
        # Ended eight days ago — one day past the window.
        await store._exec(
            f"UPDATE {store.MATCHES} SET ended_at = now() - interval '8 days' WHERE match_id = $1",
            [old],
        )

        out = await store.purge_old_details()
        assert out["matches"] == 1 and out["bees"] == 1

        assert await store.get_match(old) is None, "the board is forgotten"
        rows = await store.settlements(10)
        assert len(rows) == 1 and rows[0]["charity_sats"] == 80, (
            "the ledger outlives the round it recorded"
        )

    asyncio.run(go())
