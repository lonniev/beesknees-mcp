"""The shared board, in Neon.

This is the first thing in the fleet with genuinely cross-patron state: sixty
people writing one match. Two facts shape every line below.

**There are no transactions.** The Neon HTTP driver sends one statement per
request, so anything that must happen together has to be a single statement —
a CTE where two tables are involved. `rowCount` (camelCase) is how we learn
whether we won.

**A losing write must be believed.** Every mutation is fenced on the state it
expects, and returns whether it actually landed. `False` means somebody else got
there first and we must not pretend otherwise, exactly as excalibur's publisher
learned when a stamp that was not a gate let a post go out twice.

**Cells are stored sparsely.** A match is five hives of 857 cells, which would be
4,285 rows of mostly "still solid". Instead a row in `bk_cells` *means* the cell
is open: digging INSERTs, sealing DELETEs, and the meadow needs no rows at all
because it is open by geometry. A fresh match starts with twenty rows — the
mouths — rather than four thousand.

Nothing here is encrypted. The board is not PII and not financial data, and
sealing it would cost exactly the sorting and indexing the game needs, which is
the lesson Good Earth's over-encrypted rows already paid for.
"""

from __future__ import annotations

import logging
import re
import secrets
from typing import Any

from beesknees_mcp import geometry as geo

logger = logging.getLogger(__name__)

MATCHES = "bk_matches"
BEES = "bk_bees"
CELLS = "bk_cells"
FARES = "bk_fares"
SETTLEMENTS = "bk_settlements"

HIVES = 5
SEATS = 12
QUORUM = 8
"""Bees in any one hive that get a match moving."""

# Motion timing, in seconds. Digging costs TIME and not merely a larger fare:
# with one uniform cooldown, fares do not win races, so riding a rival's shaft
# was strictly worse than boring your own and the whole dig-or-ride choice was
# inert. Measured in `sim/`, not chosen by taste.
COOLDOWN_S = 2.0
DIG_EXTRA_S = 6.0
SEAL_S = 2.0
"""One cooldown, the same as a move.

Sealing was free in time, as the one place spending bought position outright.
Bees having BODIES changed that: a seal now traps a rival where it also blocks
everyone behind it, and free sealing took 57% of rounds against the digger's
33%. One cooldown gives 48.5% against 40.5% and tightens the p90 round from
6:14 to 4:22. Spending still buys position — one move to set a rival back
several — it is simply not free while doing it."""

ROUND_CEILING_S = 600
"""A stalled match still ends, with the bee nearest a queen taking it."""

FORMING_GRACE_S = 20
"""Once a hive reaches quorum, the wait before the match starts."""


class BoardError(ValueError):
    """Something the caller got wrong, and can see the reason for."""


_vault: Any = None
_schema_done = False

_DDL: list[str] = [
    (
        f"CREATE TABLE IF NOT EXISTS {MATCHES} ("
        "  match_id TEXT PRIMARY KEY,"
        "  state TEXT NOT NULL DEFAULT 'forming',"
        # The obstructions are generated from this on BOTH sides rather than
        # stored, so a match is reproducible and the client can draw the walls
        # without fetching them.
        "  seed BIGINT NOT NULL DEFAULT 0,"
        # Every mutation bumps this. A client polls with the last one it saw, so
        # it can be told "nothing has changed" without shipping the whole board.
        "  seq BIGINT NOT NULL DEFAULT 0,"
        "  winner_npub TEXT,"
        "  winner_hive INTEGER,"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  started_at TIMESTAMPTZ,"
        "  quorum_at TIMESTAMPTZ,"
        "  ended_at TIMESTAMPTZ,"
        "  settled_at TIMESTAMPTZ)"
    ),
    (
        f"CREATE TABLE IF NOT EXISTS {BEES} ("
        "  match_id TEXT NOT NULL,"
        "  hive INTEGER NOT NULL,"
        "  seat INTEGER NOT NULL,"
        "  npub TEXT NOT NULL,"
        "  label TEXT NOT NULL DEFAULT '',"
        "  cell INTEGER NOT NULL,"
        "  phase TEXT NOT NULL DEFAULT 'forage',"
        "  next_move_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  moves INTEGER NOT NULL DEFAULT 0,"
        "  came_inward BOOLEAN NOT NULL DEFAULT FALSE,"
        "  digs INTEGER NOT NULL DEFAULT 0,"
        "  seals INTEGER NOT NULL DEFAULT 0,"
        "  finished_at TIMESTAMPTZ,"
        "  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  PRIMARY KEY (match_id, hive, seat))"
    ),
    (
        # A row here MEANS the cell is open. No row, no tunnel.
        f"CREATE TABLE IF NOT EXISTS {CELLS} ("
        "  match_id TEXT NOT NULL,"
        "  hive INTEGER NOT NULL,"
        "  cell INTEGER NOT NULL,"
        "  dug_by TEXT NOT NULL DEFAULT '',"
        "  dug_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  PRIMARY KEY (match_id, hive, cell))"
    ),
    (
        # The pot, recorded as it is charged. The SDK keeps no per-debit row and
        # credits no operator account, so a fare not written here is a fare that
        # cannot be reconstructed afterwards.
        f"CREATE TABLE IF NOT EXISTS {FARES} ("
        "  id BIGSERIAL PRIMARY KEY,"
        "  match_id TEXT NOT NULL,"
        "  npub TEXT NOT NULL,"
        "  tool TEXT NOT NULL,"
        "  sats INTEGER NOT NULL,"
        "  at TIMESTAMPTZ NOT NULL DEFAULT now())"
    ),
    (
        f"CREATE TABLE IF NOT EXISTS {SETTLEMENTS} ("
        "  match_id TEXT PRIMARY KEY,"
        "  pot_sats INTEGER NOT NULL,"
        "  charity_sats INTEGER NOT NULL,"
        "  winner_sats INTEGER NOT NULL,"
        "  operator_sats INTEGER NOT NULL,"
        "  winner_npub TEXT,"
        "  beneficiary TEXT NOT NULL DEFAULT '',"
        "  event_id TEXT,"
        "  prize_state TEXT NOT NULL DEFAULT 'unclaimed',"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
    ),
]

_MIGRATIONS: list[str] = [
    # CREATE TABLE IF NOT EXISTS is a no-op on an existing table, so a new
    # column needs its own ALTER. This is precisely the gap that broke operator
    # adoption fleet-wide for ten weeks.
    f"ALTER TABLE {BEES} ADD COLUMN IF NOT EXISTS came_inward BOOLEAN NOT NULL DEFAULT FALSE",
    f"ALTER TABLE {MATCHES} ADD COLUMN IF NOT EXISTS seed BIGINT NOT NULL DEFAULT 0",
    f"CREATE INDEX IF NOT EXISTS bk_matches_state_idx ON {MATCHES} (state, created_at DESC)",
    f"CREATE INDEX IF NOT EXISTS bk_bees_npub_idx ON {BEES} (npub, match_id)",
    f"CREATE INDEX IF NOT EXISTS bk_fares_match_idx ON {FARES} (match_id)",
]


def _t(sql: str) -> str:
    """Qualify every table name through the vault's own helper.

    Index names are NOT built from the table constants and must not be
    qualified — an index name may not carry a schema at all.
    """
    qualify = getattr(_vault, "_t", None)
    if not callable(qualify):
        return sql
    out = sql
    for table in (MATCHES, BEES, CELLS, FARES, SETTLEMENTS):
        out = re.sub(rf"\b{re.escape(table)}\b", qualify(table), out)
    return out


async def vault() -> Any:
    """The vault, with the schema present.

    Every statement is tried on its own: one failing ALTER must not stop the
    index after it, nor leave the flag False so the whole block re-runs on every
    later request.
    """
    global _vault, _schema_done
    if _vault is None:
        from beesknees_mcp.server import runtime

        _vault = await runtime.vault()
    if not _schema_done:
        ok = True
        for stmt in (*_DDL, *_MIGRATIONS):
            try:
                await _vault._execute(_t(stmt))
            except Exception as exc:  # noqa: BLE001
                ok = False
                logger.error("board schema statement failed: %s — %s", stmt[:70], exc)
        _schema_done = ok
    return _vault


async def _exec(sql: str, params: list[Any] | None = None) -> dict[str, Any]:
    v = await vault()
    return await v._execute(_t(sql), params or [])


def _rows(result: dict[str, Any]) -> list[dict[str, Any]]:
    return [dict(r) for r in (result.get("rows") or [])]


def _count(result: dict[str, Any]) -> int:
    # camelCase, and the fleet has been bitten by assuming otherwise.
    return int(result.get("rowCount") or 0)


# ── Matches ──────────────────────────────────────────────────────────────


def new_match_id() -> str:
    return secrets.token_urlsafe(9)


async def open_match() -> str:
    """Start a match forming, with the seed that shapes its hives."""
    mid = new_match_id()
    seed = secrets.randbelow(2**31)
    await _exec(
        f"INSERT INTO {MATCHES} (match_id, state, seed) VALUES ($1, 'forming', $2)", [mid, seed]
    )
    return mid


def obstructions(seed: int, hive: int) -> set[int]:
    """The impassable cells of one hive.

    Each hive gets its own derived seed, so the five boards in a match differ —
    which is the variability the obstructions exist for. Cached because this is
    consulted on every single move.
    """
    key = (int(seed), int(hive))
    hit = _obstruction_cache.get(key)
    if hit is None:
        hit = geo.blocked_cells(geo.make_geometry(), (int(seed) * 31 + int(hive) * 7919) % (2**31))
        _obstruction_cache[key] = hit
    return hit


_obstruction_cache: dict[tuple[int, int], set[int]] = {}


async def forming_match() -> dict[str, Any] | None:
    """The match currently taking seats, if any."""
    r = await _exec(
        f"SELECT * FROM {MATCHES} WHERE state = 'forming' ORDER BY created_at LIMIT 1"
    )
    rows = _rows(r)
    return rows[0] if rows else None


async def get_match(match_id: str) -> dict[str, Any] | None:
    r = await _exec(f"SELECT * FROM {MATCHES} WHERE match_id = $1", [match_id])
    rows = _rows(r)
    return rows[0] if rows else None


async def live_matches() -> list[dict[str, Any]]:
    r = await _exec(
        f"SELECT * FROM {MATCHES} WHERE state IN ('forming','running') ORDER BY created_at"
    )
    return _rows(r)


async def bump(match_id: str) -> int:
    """Advance the match's sequence, so pollers know something happened."""
    r = await _exec(
        f"UPDATE {MATCHES} SET seq = seq + 1 WHERE match_id = $1 RETURNING seq", [match_id]
    )
    rows = _rows(r)
    return int(rows[0]["seq"]) if rows else 0


# ── Seats ────────────────────────────────────────────────────────────────


async def seat_counts(match_id: str) -> dict[int, int]:
    r = await _exec(
        f"SELECT hive, count(*) AS n FROM {BEES} WHERE match_id = $1 GROUP BY hive", [match_id]
    )
    return {int(row["hive"]): int(row["n"]) for row in _rows(r)}


def _start_cell(g: geo.Geometry, seat: int) -> int:
    """A corner of the meadow, as far from every door as the board allows.

    Evenly spaced around a ring put somebody directly in front of each door —
    a free entrance for whoever drew that seat — and left the corners of the
    square empty. `geo.corner_starts` is the client's own function, ported, so
    the bee the server places is the bee the client draws.
    """
    starts = geo.corner_starts(g, SEATS)
    return starts[seat] if seat < len(starts) else starts[-1]


async def take_seat(match_id: str, npub: str, label: str, hive: int) -> dict[str, Any]:
    """Claim one seat in a hive, atomically.

    The seat number is computed from the count inside the same statement, so two
    patrons arriving together cannot be handed the same seat: the primary key
    rejects the loser, who retries into the next seat.
    """
    g = geo.make_geometry()
    for _ in range(SEATS + 2):
        counts = await seat_counts(match_id)
        seat = counts.get(hive, 0)
        if seat >= SEATS:
            raise BoardError(f"hive {hive} is full")
        r = await _exec(
            f"INSERT INTO {BEES} (match_id, hive, seat, npub, label, cell, next_move_at) "
            "VALUES ($1, $2, $3, $4, $5, $6, now()) "
            "ON CONFLICT (match_id, hive, seat) DO NOTHING "
            "RETURNING hive, seat",
            [match_id, hive, seat, npub, label, _start_cell(g, seat)],
        )
        rows = _rows(r)
        if rows:
            await bump(match_id)
            return {"hive": hive, "seat": seat}
    raise BoardError("could not find a free seat")


async def bee_of(match_id: str, npub: str) -> dict[str, Any] | None:
    r = await _exec(
        f"SELECT * FROM {BEES} WHERE match_id = $1 AND npub = $2 LIMIT 1", [match_id, npub]
    )
    rows = _rows(r)
    return rows[0] if rows else None


async def bees_in(match_id: str) -> list[dict[str, Any]]:
    r = await _exec(
        f"SELECT hive, seat, npub, label, cell, phase, moves, digs, seals, "
        f"finished_at, next_move_at FROM {BEES} WHERE match_id = $1 ORDER BY hive, seat",
        [match_id],
    )
    return _rows(r)


async def open_cells(match_id: str) -> list[dict[str, Any]]:
    r = await _exec(
        f"SELECT hive, cell FROM {CELLS} WHERE match_id = $1 ORDER BY hive, cell", [match_id]
    )
    return _rows(r)


async def seed_mouths(match_id: str) -> None:
    """Open the doors in every hive's wall.

    The mouths are the only cells a match starts with — the rest of the comb is
    absent from the table and therefore solid.
    """
    g = geo.make_geometry()
    mouths = geo.mouth_cells(g)
    values = ", ".join(
        f"($1, {h}, {c}, 'mouth')" for h in range(HIVES) for c in mouths
    )
    await _exec(
        f"INSERT INTO {CELLS} (match_id, hive, cell, dug_by) VALUES {values} "
        "ON CONFLICT DO NOTHING",
        [match_id],
    )


# ── Motion — every one a single fenced statement ─────────────────────────


def _phase_after(g: geo.Geometry, phase: str, cell: int, on_flower: bool) -> str:
    """The three acts, resolved from where the bee now stands."""
    r = geo.ring_of(g, cell)
    if phase == "forage" and on_flower:
        return "return"
    if phase == "return" and r <= g.wall:
        return "tunnel"
    if phase == "tunnel" and r == 0:
        return "done"
    return phase


async def fly(
    match_id: str, npub: str, to_cell: int, *, on_flower: bool = False
) -> dict[str, Any]:
    """Move into a cell that is already open.

    Fenced on the bee's current cell and its cooldown. In the hive the target
    must have a row in `bk_cells`; in the meadow it needs none, because air is
    open by geometry.
    """
    bee = await bee_of(match_id, npub)
    if not bee:
        raise BoardError("you have no bee in this match")
    g = geo.make_geometry()
    cur = int(bee["cell"])
    _require_adjacent(g, cur, to_cell)
    _require_stagger(g, bee, to_cell)
    await _require_unoccupied(match_id, g, bee, to_cell)
    m = await get_match(match_id)
    seed = int((m or {}).get("seed") or 0)

    if is_blocked(seed, int(bee["hive"]), to_cell):
        raise BoardError("that cell is capped brood — nothing flies through it")

    phase = _phase_after(g, str(bee["phase"]), to_cell, on_flower)
    needs_open = not geo.is_meadow(g, to_cell)
    gate = (
        f" AND EXISTS (SELECT 1 FROM {CELLS} c WHERE c.match_id = $1 "
        "AND c.hive = $6 AND c.cell = $3)"
        if needs_open
        else ""
    )
    r = await _exec(
        f"UPDATE {BEES} SET cell = $3, phase = $4, moves = moves + 1, came_inward = $7, "
        f"    next_move_at = now() + interval '{COOLDOWN_S} seconds', "
        "    finished_at = CASE WHEN $4 = 'done' THEN now() ELSE finished_at END "
        "WHERE match_id = $1 AND npub = $2 "
        "  AND cell = $5 AND next_move_at <= now() AND phase <> 'done'"
        f"{gate} "
        "RETURNING hive, seat, cell, phase",
        [match_id, npub, to_cell, phase, cur, int(bee["hive"]),
         geo.arms_stagger(g, cur, to_cell)],
    )
    rows = _rows(r)
    if not rows:
        return {"moved": False, "reason": "not your turn, or the way is not open"}
    await bump(match_id)
    return {"moved": True, **rows[0]}


async def dig(match_id: str, npub: str, to_cell: int) -> dict[str, Any]:
    """Cut fresh comb and step into it.

    One statement, because opening the cell and moving the bee must not come
    apart: a dig that opened a cell without moving anybody would hand a free
    tunnel to whoever asked for it while on cooldown.

    `ok` reads the bee's eligibility from the pre-statement snapshot and gates
    the INSERT; the INSERT's primary key settles a race between two diggers; and
    the UPDATE only fires for whoever's INSERT actually landed.
    """
    bee = await bee_of(match_id, npub)
    if not bee:
        raise BoardError("you have no bee in this match")
    g = geo.make_geometry()
    cur = int(bee["cell"])
    _require_adjacent(g, cur, to_cell)
    _require_stagger(g, bee, to_cell)
    if geo.is_meadow(g, to_cell):
        raise BoardError("there is nothing to dig in open air")
    if geo.is_wall(g, to_cell):
        raise BoardError("the hive wall cannot be cut — go in through a door")

    m = await get_match(match_id)
    seed = int((m or {}).get("seed") or 0)

    if is_blocked(seed, int(bee["hive"]), to_cell):
        # Charged, and it burns a cooldown. The player could see the obstruction
        # and swung at it anyway — that is a move that happened, not a malformed
        # request, and it is where a lot of the outcome variability lives: some
        # people will try to cut a wall away before they believe it.
        spent = await _exec(
            f"UPDATE {BEES} SET next_move_at = now() + interval '{COOLDOWN_S} seconds' "
            "WHERE match_id = $1 AND npub = $2 AND next_move_at <= now() RETURNING seat",
            [match_id, npub],
        )
        if not _rows(spent):
            raise BoardError("not your turn yet")
        await bump(match_id)
        return {"moved": False, "blocked": True,
                "reason": "capped brood — your mandibles will not go through it"}

    phase = _phase_after(g, str(bee["phase"]), to_cell, False)
    r = await _exec(
        "WITH ok AS ("
        f"  SELECT 1 FROM {BEES} WHERE match_id = $1 AND npub = $2 "
        "    AND cell = $5 AND next_move_at <= now() AND phase = 'tunnel'"
        "), cut AS ("
        f"  INSERT INTO {CELLS} (match_id, hive, cell, dug_by) "
        "  SELECT $1, $6, $3, $2 WHERE EXISTS (SELECT 1 FROM ok) "
        "  ON CONFLICT (match_id, hive, cell) DO NOTHING RETURNING cell"
        "), moved AS ("
        f"  UPDATE {BEES} SET cell = $3, phase = $4, moves = moves + 1, digs = digs + 1, came_inward = $7, "
        f"      next_move_at = now() + interval '{COOLDOWN_S + DIG_EXTRA_S} seconds', "
        "      finished_at = CASE WHEN $4 = 'done' THEN now() ELSE finished_at END "
        "  WHERE match_id = $1 AND npub = $2 AND cell = $5 "
        "    AND EXISTS (SELECT 1 FROM cut) RETURNING seat"
        ") SELECT (SELECT count(*) FROM cut) AS cut, (SELECT count(*) FROM moved) AS moved",
        [match_id, npub, to_cell, phase, cur, int(bee["hive"]),
         geo.arms_stagger(g, cur, to_cell)],
    )
    rows = _rows(r)
    won = bool(rows and int(rows[0]["moved"]) > 0)
    if not won:
        return {"moved": False, "reason": "not your turn, or another bee cut it first"}
    await bump(match_id)
    return {"moved": True, "cell": to_cell, "phase": phase, "hive": int(bee["hive"])}


async def seal(match_id: str, npub: str, at_cell: int) -> dict[str, Any]:
    """Bring an open tunnel down.

    Deleting the row is what closes the cell. Refused on an occupied cell —
    burying a bee is an edge case worth designing out rather than handling — and
    on the queen's chamber, the mouths, and the meadow, any of which would end a
    round nobody could then win.
    """
    bee = await bee_of(match_id, npub)
    if not bee:
        raise BoardError("you have no bee in this match")
    g = geo.make_geometry()
    if not geo.can_seal(g, at_cell):
        raise BoardError("that is not a cell you can bring down")
    hive = int(bee["hive"])

    r = await _exec(
        "WITH ok AS ("
        f"  SELECT 1 FROM {BEES} WHERE match_id = $1 AND npub = $2 "
        "    AND next_move_at <= now() AND phase = 'tunnel'"
        "), clear AS ("
        f"  SELECT 1 FROM {BEES} WHERE match_id = $1 AND hive = $3 AND cell = $4"
        "), gone AS ("
        f"  DELETE FROM {CELLS} WHERE match_id = $1 AND hive = $3 AND cell = $4 "
        "    AND EXISTS (SELECT 1 FROM ok) AND NOT EXISTS (SELECT 1 FROM clear) "
        "  RETURNING cell"
        "), charged AS ("
        f"  UPDATE {BEES} SET seals = seals + 1, "
        f"      next_move_at = now() + interval '{SEAL_S} seconds' "
        "  WHERE match_id = $1 AND npub = $2 AND EXISTS (SELECT 1 FROM gone) RETURNING seat"
        ") SELECT (SELECT count(*) FROM gone) AS gone",
        [match_id, npub, hive, at_cell],
    )
    rows = _rows(r)
    if not (rows and int(rows[0]["gone"]) > 0):
        return {"sealed": False, "reason": "not your turn, already solid, or a bee is standing there"}
    await bump(match_id)
    return {"sealed": True, "cell": at_cell, "hive": hive}


def _require_adjacent(g: geo.Geometry, cur: int, to_cell: int) -> None:
    if to_cell not in geo.neighbors(g, cur):
        raise BoardError("a bee moves one cell at a time")


def is_blocked(seed: int, hive: int, cell: int) -> bool:
    return cell in obstructions(seed, hive)


async def _require_unoccupied(match_id: str, g: geo.Geometry, bee: dict[str, Any], to_cell: int) -> None:
    """A bee has a body: inside the hive, one cell holds one of them.

    The meadow is exempt — bees pass each other in the air, and enforcing it
    above ground gridlocks the start, where all twelve begin on one ring.
    """
    if geo.ring_of(g, to_cell) > g.wall:
        return
    r = await _exec(
        f"SELECT 1 FROM {BEES} WHERE match_id = $1 AND hive = $2 AND cell = $3 "
        "AND npub <> $4 AND phase <> 'done' LIMIT 1",
        [match_id, int(bee["hive"]), to_cell, str(bee["npub"])],
    )
    if _rows(r):
        raise BoardError("another bee is standing there — go round it, or bury it")


def _require_stagger(g: geo.Geometry, bee: dict[str, Any], to_cell: int) -> None:
    """Enforce the stagger server-side, where it actually counts.

    The client knows the rule and will not offer an illegal move, but a client
    is not a authority — anything that only the browser checks is a rule that
    only honest players follow.
    """
    if not geo.may_move(g, int(bee["cell"]), to_cell, bool(bee.get("came_inward"))):
        raise BoardError("the comb steps down a level — move sideways before cutting deeper")


# ── The pot ──────────────────────────────────────────────────────────────


async def record_fare(match_id: str, npub: str, tool: str, sats: int) -> None:
    """Write down what was charged.

    The SDK keeps no per-debit row and credits no operator account, so the pot
    exists only because this runs. A fare not written here cannot be recovered
    from anywhere afterwards.
    """
    if sats <= 0:
        return
    await _exec(
        f"INSERT INTO {FARES} (match_id, npub, tool, sats) VALUES ($1, $2, $3, $4)",
        [match_id, npub, tool, int(sats)],
    )


async def pot_of(match_id: str) -> int:
    r = await _exec(f"SELECT coalesce(sum(sats), 0) AS pot FROM {FARES} WHERE match_id = $1", [match_id])
    rows = _rows(r)
    return int(rows[0]["pot"]) if rows else 0


async def charity_owed() -> dict[str, int]:
    """Everything accrued to the charity, and what has been settled against it."""
    r = await _exec(f"SELECT coalesce(sum(charity_sats), 0) AS owed FROM {SETTLEMENTS}")
    rows = _rows(r)
    return {"accrued_sats": int(rows[0]["owed"]) if rows else 0}


async def settlements(limit: int = 50) -> list[dict[str, Any]]:
    r = await _exec(
        f"SELECT * FROM {SETTLEMENTS} ORDER BY created_at DESC LIMIT {max(1, min(limit, 200))}"
    )
    return _rows(r)


async def record_settlement(
    match_id: str,
    *,
    pot: int,
    charity: int,
    winner: int,
    operator: int,
    winner_npub: str,
    beneficiary: str,
) -> bool:
    """Write a match's split, once.

    `ON CONFLICT DO NOTHING` is the idempotency guard: settlement runs from a
    cron that can fire twice, and paying a prize twice is not a mistake anyone
    gets to make quietly.
    """
    r = await _exec(
        f"INSERT INTO {SETTLEMENTS} "
        "(match_id, pot_sats, charity_sats, winner_sats, operator_sats, winner_npub, beneficiary) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (match_id) DO NOTHING "
        "RETURNING match_id",
        [match_id, pot, charity, winner, operator, winner_npub, beneficiary],
    )
    return bool(_rows(r))


async def leaderboard(limit: int = 10) -> list[dict[str, Any]]:
    """Most sats won, by npub.

    Read across every patron with no npub predicate — this is a public
    scoreboard, and the entry fee bought a place in it.
    """
    r = await _exec(
        f"SELECT winner_npub AS npub, sum(winner_sats)::int AS sats, count(*)::int AS wins "
        f"FROM {SETTLEMENTS} WHERE winner_npub IS NOT NULL AND winner_npub <> '' "
        f"GROUP BY winner_npub ORDER BY sats DESC LIMIT {max(1, min(limit, 100))}"
    )
    return _rows(r)
