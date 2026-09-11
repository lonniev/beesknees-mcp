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

#: Every match row carries its running pot, as a COLUMN rather than a second
#: query.
#:
#: `match_state` is the hottest tool in the service — every player, about once a
#: second, for a whole round — and it is `free` precisely so it can stay cheap:
#: free is the one category the runtime answers without a Neon pricing lookup.
#: Calling `pot_of` beside it would have added a third read to the busiest path
#: in the system, on every poll that carried a board. A scalar subquery on a row
#: already being fetched costs an index scan and no round trip at all.
_POT_COL = (
    f", (SELECT coalesce(sum(f.sats), 0) FROM {FARES} f "
    "WHERE f.match_id = m.match_id)::int AS pot_sats"
)
# A row here means that flower has been EMPTIED. No row, no rival got there first.
POLLEN = "bk_pollen"
#: Who the charity share goes to, and where a patron wants their own share sent.
CHARITY = "bk_charity"
PATRONS = "bk_patrons"
PAYOUTS = "bk_payouts"

HIVES = 5
SEATS = 12
QUORUM = 8
"""Bees in any one hive that get a match moving."""

# Motion timing, in seconds. Digging costs TIME and not merely a larger fare:
# with one uniform cooldown, fares do not win races, so riding a rival's shaft
# was strictly worse than boring your own and the whole dig-or-ride choice was
# inert. Measured in `sim/`, not chosen by taste.
#
# These MUST equal the client's DEFAULT_RULES in frontend/src/game/rules.ts:
# cooldownTicks 10, digDelayTicks 70, collapseTicks 10, at TICK_MS 100. They
# agree today by having been typed the same twice, which is not a mechanism —
# `tests/test_cadence.py` at least makes a change to one side fail loudly on
# this one, until the live board serves its cadence to the client outright.
COOLDOWN_S = 1.0
DIG_EXTRA_S = 7.0
SEAL_S = 1.0
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
        # Which BOARD this match is played on. Its cells are integers, and an
        # integer only means a cell while the board that numbered it exists.
        "  board TEXT NOT NULL DEFAULT '',"
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
        # The beneficiary, as ONE row the operator owns.
        #
        # It was a constant in the source, which made changing who the money goes
        # to a deployment. A charity is not a build artefact: it can be replaced,
        # renamed, or have its wallet rotated, and none of that should require
        # anybody to touch code. Every settlement still records the beneficiary
        # it actually paid, so history stays true when this changes.
        f"CREATE TABLE IF NOT EXISTS {CHARITY} ("
        "  id TEXT PRIMARY KEY DEFAULT 'current',"
        "  name TEXT NOT NULL,"
        "  website TEXT NOT NULL DEFAULT '',"
        # A Lightning address is a PUBLIC destination — it is how anyone sends
        # money — so it is a clear column. Nothing here unlocks anything.
        "  lightning_address TEXT NOT NULL DEFAULT '',"
        "  set_at TIMESTAMPTZ NOT NULL DEFAULT now())"
    ),
    (
        # What a winner wants done with their share, decided BEFORE they win.
        #
        # Asking in the moment is asking somebody to make a decision about money
        # while a trophy is on screen. A row here is a standing instruction, and
        # its absence means donate — the generous default for a game whose whole
        # point is the pollinators.
        f"CREATE TABLE IF NOT EXISTS {PATRONS} ("
        "  npub TEXT PRIMARY KEY,"
        "  lightning_address TEXT NOT NULL DEFAULT '',"
        "  donate BOOLEAN NOT NULL DEFAULT TRUE,"
        "  set_at TIMESTAMPTZ NOT NULL DEFAULT now())"
    ),
    (
        # A row MEANS the flower is spent. Placement is derived from the seed and
        # never stored — only the taking is a fact the board has to remember, and
        # it is the one piece of meadow state two bees can race for.
        f"CREATE TABLE IF NOT EXISTS {POLLEN} ("
        "  match_id TEXT NOT NULL,"
        "  hive INTEGER NOT NULL,"
        "  cell INTEGER NOT NULL,"
        "  taken_by TEXT NOT NULL DEFAULT '',"
        "  taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
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
        # One row per payment ATTEMPT, not per success.
        #
        # The primary key is what makes a double-payment impossible: a row is
        # claimed BEFORE the sats move, so a retry, a second cron tick, or an
        # operator pressing twice all collide on the key rather than on the
        # node. A row that ends up stuck in `sending` is a payment nobody can
        # prove either way, which is exactly the thing a human should look at —
        # so it stays stuck rather than being cleaned up automatically.
        f"CREATE TABLE IF NOT EXISTS {PAYOUTS} ("
        "  payout_id TEXT PRIMARY KEY,"          # f"{kind}:{match_id}"
        "  kind TEXT NOT NULL,"                  # 'charity' | 'winner'
        "  match_id TEXT NOT NULL,"
        "  destination TEXT NOT NULL,"           # the Lightning address paid
        "  amount_sats INTEGER NOT NULL,"
        "  state TEXT NOT NULL DEFAULT 'sending',"   # sending | paid | failed
        "  payment_hash TEXT NOT NULL DEFAULT '',"
        "  detail TEXT NOT NULL DEFAULT '',"
        "  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        "  finished_at TIMESTAMPTZ)"
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
    f"ALTER TABLE {MATCHES} ADD COLUMN IF NOT EXISTS board TEXT NOT NULL DEFAULT ''",
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
        if ok:
            # Once the columns exist, clear away anything played on a board that
            # no longer does. Here rather than on every read: it is a sweep, not
            # a guard — the guard is that every lookup filters on the board.
            try:
                await retire_stale_boards()
            except Exception as exc:  # noqa: BLE001
                logger.error("could not retire stale boards: %s", exc)
            # Then square the books, BEFORE anything is forgotten. A match
            # abandoned with fares in it has a pot and no settlement, and the
            # purge below would delete both — so it is settled here first, and
            # a prize nobody claimed is handed to the charity, which is where
            # the money was always going if no person took it.
            try:
                from beesknees_mcp import match_flow

                await match_flow.settle_abandoned()
                await forfeit_stale_prizes()
            except Exception as exc:  # noqa: BLE001
                logger.error("could not square the books: %s", exc)
            # And forget how old rounds were played. Same reasoning: a sweep,
            # not a guard, and bounded by a date rather than by how much has
            # piled up — so a quiet week and a viral one cost the same to run.
            try:
                await purge_old_details()
            except Exception as exc:  # noqa: BLE001
                logger.error("could not purge old match detail: %s", exc)
    return _vault


_PARAM = re.compile(r"\$(\d+)")


def _check_params(sql: str, params: list[Any]) -> None:
    """A statement must use exactly the parameters it is handed.

    PostgreSQL refuses a bind that supplies more values than the statement
    mentions, and the failure arrives as a driver error rather than anything
    this module raises — so it escapes as an unhandled exception and reaches the
    patron as "Tool execution failed".

    `fly` did exactly this: it built its hive gate conditionally but always sent
    `hive` as $6, so every move into the MEADOW shipped seven values for a
    six-parameter statement. Every foraging bee in the first live round was
    refused, and the whole suite stayed green — the fake vault reads parameters
    positionally and never looks at the SQL.

    Checked here rather than in a test that reads the source, because the
    parameter list is often built at runtime: a test that can only see literal
    lists cannot see the one function that got this wrong.
    """
    used = {int(m.group(1)) for m in _PARAM.finditer(sql)}
    if not used:
        return
    if max(used) != len(params):
        raise ValueError(
            f"statement uses $1..${max(used)} but was handed {len(params)} value(s): "
            f"{sql[:90]}"
        )
    missing = sorted(set(range(1, max(used) + 1)) - used)
    if missing:
        raise ValueError(
            f"statement never mentions {[f"${m}" for m in missing]}: {sql[:90]}"
        )


async def _exec(sql: str, params: list[Any] | None = None) -> dict[str, Any]:
    v = await vault()
    p = params or []
    _check_params(sql, p)
    return await v._execute(_t(sql), p)


def _rows(result: dict[str, Any]) -> list[dict[str, Any]]:
    return [dict(r) for r in (result.get("rows") or [])]


def _count(result: dict[str, Any]) -> int:
    # camelCase, and the fleet has been bitten by assuming otherwise.
    return int(result.get("rowCount") or 0)


# ── Matches ──────────────────────────────────────────────────────────────


def new_match_id() -> str:
    return secrets.token_urlsafe(9)


async def open_match() -> str:
    """Start a match forming, with the seed and the board that shape its hives."""
    mid = new_match_id()
    seed = secrets.randbelow(2**31)
    await _exec(
        f"INSERT INTO {MATCHES} (match_id, state, seed, board) VALUES ($1, 'forming', $2, $3)",
        [mid, seed, geo.board_fingerprint()],
    )
    return mid


async def retire_stale_boards() -> dict[str, int]:
    """Clear away matches played on a board that no longer exists.

    A match holds cell NUMBERS, and a number only means a cell while the board
    that numbered it exists. When the geometry changed, a live match was left
    holding cells 585..622 on a 358-cell board — four doors nobody could ever
    open, waiting for the next patron to join.

    A match with no fares recorded is deleted outright: nobody paid anything, so
    there is nothing to keep. A match that DID take fares is marked `abandoned`
    instead and never resumed, because its pot is owed to somebody whatever
    happened to the board it was played on. That distinction is the whole reason
    this is not a DELETE across the board.
    """
    board = geo.board_fingerprint()
    stale = _rows(
        await _exec(
            f"SELECT m.match_id, "
            f"  (SELECT count(*) FROM {FARES} f WHERE f.match_id = m.match_id) AS fares "
            f"FROM {MATCHES} m WHERE m.board <> $1",
            [board],
        )
    )
    if not stale:
        return {"deleted": 0, "abandoned": 0}

    drop = [r["match_id"] for r in stale if not int(r["fares"] or 0)]
    keep = [r["match_id"] for r in stale if int(r["fares"] or 0)]
    for mid in drop:
        # One statement per POST — the Neon HTTP driver has no transaction, so
        # these are ordered to leave nothing playable at any point in between:
        # the match row goes first, and the orphans after.
        await _exec(f"DELETE FROM {MATCHES} WHERE match_id = $1", [mid])
        await _exec(f"DELETE FROM {BEES} WHERE match_id = $1", [mid])
        await _exec(f"DELETE FROM {CELLS} WHERE match_id = $1", [mid])
    if keep:
        await _exec(
            f"UPDATE {MATCHES} SET state = 'abandoned', ended_at = now() "
            "WHERE match_id = ANY($1) AND state IN ('forming','running')",
            [keep],
        )
    logger.info("retired %d stale match(es), kept %d with fares", len(drop), len(keep))
    return {"deleted": len(drop), "abandoned": len(keep)}


def hive_seed(seed: int, hive: int) -> int:
    """Each hive gets its own derived seed, so the five boards in a match differ.

    The client derives it the same way from the match seed it is sent, which is
    the whole reason `match_state` sends one.
    """
    return (int(seed) * 31 + int(hive) * 7919) % (2**31)


def layout(seed: int, hive: int) -> geo.HiveBoard:
    """One hive's starts, flowers and obstructions. Cached: every move reads it."""
    key = (int(seed), int(hive))
    hit = _layout_cache.get(key)
    if hit is None:
        hit = geo.hive_board(geo.make_geometry(), hive_seed(seed, hive))
        _layout_cache[key] = hit
    return hit


def obstructions(seed: int, hive: int) -> frozenset[int]:
    """The impassable cells of one hive."""
    return layout(seed, hive).blocked


_layout_cache: dict[tuple[int, int], geo.HiveBoard] = {}


async def forming_match() -> dict[str, Any] | None:
    """The match currently taking seats, if any."""
    r = await _exec(
        f"SELECT m.*{_POT_COL} FROM {MATCHES} m "
        "WHERE m.state = 'forming' AND m.board = $1 "
        "ORDER BY m.created_at LIMIT 1",
        [geo.board_fingerprint()],
    )
    rows = _rows(r)
    return rows[0] if rows else None


async def get_match(match_id: str) -> dict[str, Any] | None:
    r = await _exec(
        f"SELECT m.*{_POT_COL} FROM {MATCHES} m WHERE m.match_id = $1", [match_id]
    )
    rows = _rows(r)
    return rows[0] if rows else None


async def latest_match_for(npub: str) -> dict[str, Any] | None:
    """The most recent match this patron had a bee in, whatever state it is in.

    `live_matches` only ever returns forming and running ones, so the instant a
    round ended it vanished from the poll and the next `match_state` handed back
    a fresh lobby. The winner never saw that they had won: the board detected it,
    settled it, recorded them and left a prize unclaimed, and the one party who
    cared was shown a countdown to the next round instead.
    """
    r = await _exec(
        f"SELECT m.*{_POT_COL} FROM {MATCHES} m JOIN {BEES} b ON b.match_id = m.match_id "
        "WHERE b.npub = $1 AND m.board = $2 ORDER BY m.created_at DESC LIMIT 1",
        [npub, geo.board_fingerprint()],
    )
    rows = _rows(r)
    return rows[0] if rows else None


async def live_matches() -> list[dict[str, Any]]:
    r = await _exec(
        f"SELECT m.*{_POT_COL} FROM {MATCHES} m "
        "WHERE m.state IN ('forming','running') AND m.board = $1 "
        "ORDER BY m.created_at",
        [geo.board_fingerprint()],
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


def _start_cell(starts: tuple[int, ...], seat: int) -> int:
    """A corner of the meadow, as far from every door as the board allows.

    Evenly spaced around a ring put somebody directly in front of each door — a
    free entrance for whoever drew that seat — and left the corners of the square
    empty. The list comes from `geo.hive_board`, the client's own layout ported,
    so the bee the server places is the bee the client draws.
    """
    return starts[seat] if seat < len(starts) else starts[-1]


#: How a stand-in bee is known, in the one place that decides it.
#:
#: The swarm labels its bees `sim-<strategy>-<n>` and the patron never chooses
#: a label — the app sends eight characters of their npub — so this is the only
#: signal that travels with a seated bee. `sim_swarm.is_sim` reads the same
#: constant from here, and a test holds the two together.
SIM_LABEL = "sim-"


def all_stand_ins(seated: list[dict[str, Any]]) -> bool:
    """Is every bee in this room a stand-in, with no person among them?

    The question the greeter creates. A sim seated to TOP UP a room is wanted:
    a person is waiting and it is there so they can play. A sim seated into an
    EMPTY room is bait — it exists so the next visitor is not asked to be the
    one who starts something — and its job is finished the moment that visitor
    arrives.

    A room of nothing but stand-ins can only have come from baiting, because
    topping up requires somebody to top up FOR. That is what makes this safe to
    act on: it cannot mistake a wanted bee for a spent one.
    """
    return bool(seated) and all(
        str(b.get("label") or "").startswith(SIM_LABEL) for b in seated
    )


async def release_bait(match_id: str) -> int:
    """Give a room's stand-ins their seats back. Returns how many left.

    Only when there is no person among them — see `all_stand_ins`.

    It has to be the SERVER that does this. A bee is played by whichever worker
    minted its key, that key is held in memory and written down nowhere, and a
    worker lives fifteen minutes at the outside. Bait waits for a human, which
    can take hours, so by the time somebody arrives the bee that drew them in
    is an orphan: a seat with no one able to sign for it. Left alone it takes a
    place in the race and never moves.
    """
    seated = await bees_in(match_id)
    if not all_stand_ins(seated):
        return 0
    await _exec(
        f"DELETE FROM {BEES} WHERE match_id = $1 AND label LIKE $2",
        [match_id, f"{SIM_LABEL}%"],
    )
    logger.info("released %d stand-in(s) from %s — a person arrived", len(seated), match_id)
    return len(seated)


async def take_seat(match_id: str, npub: str, label: str, hive: int) -> dict[str, Any]:
    """Claim one seat in a hive, atomically.

    The seat number is computed from the count inside the same statement, so two
    patrons arriving together cannot be handed the same seat: the primary key
    rejects the loser, who retries into the next seat.
    """
    m = await get_match(match_id)
    starts = layout(int((m or {}).get("seed") or 0), hive).starts
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
            [match_id, hive, seat, npub, label, _start_cell(starts, seat)],
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


async def lobby_waited_s(match_id: str) -> int:
    """How long the longest-waiting bee has been sitting in this lobby.

    The MATCH's age is the wrong clock: a forming match is opened the moment
    the previous one starts and may sit empty for minutes. What a patron
    experiences as waiting begins when they took a seat, so that is what this
    measures — and it is what the simulated swarm should be patient against,
    rather than against how long whichever shift happens to be running has
    been watching.
    """
    r = await _exec(
        "SELECT coalesce(extract(epoch from now() - min(joined_at)), 0)::int AS waited "
        f"FROM {BEES} WHERE match_id = $1",
        [match_id],
    )
    rows = _rows(r)
    return int(rows[0]["waited"]) if rows else 0


async def bees_in(match_id: str) -> list[dict[str, Any]]:
    r = await _exec(
        # `came_inward` matters to the CLIENT, not only to the fence.
        #
        # The stagger bars two inward moves in a row, and without this the client
        # cannot know whether a bee is already committed — so it offers the cut
        # anyway and the server refuses it. Refunded, but it still costs the
        # patron a whole cooldown to learn something the board already knew.
        # Measured in the first live round at six refusals in the first minute.
        f"SELECT hive, seat, npub, label, cell, phase, moves, digs, seals, "
        f"came_inward, finished_at, next_move_at FROM {BEES} "
        "WHERE match_id = $1 ORDER BY hive, seat",
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
    match_id: str, npub: str, to_cell: int
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
    _require_commitment(g, bee, to_cell)
    m = await get_match(match_id)
    seed = int((m or {}).get("seed") or 0)

    if is_blocked(seed, int(bee["hive"]), to_cell):
        raise BoardError("that cell is capped brood — nothing flies through it")

    # Is this a flower, and is it still holding? Placement comes from the seed;
    # only the TAKING is stored, because it is the one piece of meadow state two
    # bees can race each other for.
    hive = int(bee["hive"])
    lay = layout(seed, hive)
    on_flower = str(bee["phase"]) == "forage" and to_cell in lay.flowers

    if on_flower:
        return await _fly_and_take_pollen(match_id, npub, cur, to_cell, hive)

    phase = _phase_after(g, str(bee["phase"]), to_cell, False)
    needs_open = not geo.is_meadow(g, to_cell)

    # The hive gate is CONDITIONAL, so the parameters must be too.
    #
    # `hive` was always sent as $6 while $6 only appeared in the gate — so every
    # move into the meadow shipped seven parameters for a statement mentioning
    # six, and Postgres refuses that outright. It is a driver error rather than a
    # BoardError, so it escaped as an unhandled exception and every foraging bee
    # in the first live round was told "Tool execution failed". The fake vault
    # reads parameters positionally and never looks at the SQL, which is exactly
    # the gap its own docstring warns about.
    #
    # The optional parameter therefore goes LAST, so dropping it renumbers
    # nothing.
    params: list[Any] = [
        match_id, npub, to_cell, phase, cur, geo.arms_stagger(g, cur, to_cell), hive,
    ]
    gate = ""
    if needs_open:
        gate = (
            f" AND EXISTS (SELECT 1 FROM {CELLS} c WHERE c.match_id = $1 "
            "AND c.hive = $7 AND c.cell = $3)"
        )

    r = await _exec(
        f"UPDATE {BEES} SET cell = $3, phase = $4, moves = moves + 1, came_inward = $6, "
        f"    next_move_at = now() + interval '{COOLDOWN_S} seconds', "
        "    finished_at = CASE WHEN $4 = 'done' THEN now() ELSE finished_at END "
        "WHERE match_id = $1 AND npub = $2 "
        "  AND cell = $5 AND next_move_at <= now() AND phase <> 'done'"
        + _UNOCCUPIED.format(t=BEES, hive="$7", cell="$3")
        + f"{gate} "
        "RETURNING hive, seat, cell, phase",
        params,
    )
    rows = _rows(r)
    if not rows:
        return {"moved": False, "reason": await _why_refused(match_id, hive, npub, to_cell)}
    await bump(match_id)
    return {"moved": True, **rows[0]}


async def _fly_and_take_pollen(
    match_id: str, npub: str, cur: int, to_cell: int, hive: int
) -> dict[str, Any]:
    """Land on a flower and empty it, in ONE statement.

    A flower is taken by whoever reaches it first, so two bees arriving together
    must not both leave loaded. The insert is the fence: its primary key lets
    exactly one through, and the bee's phase only advances if that insert was
    the one that landed. The loser still MOVES — flying to a flower a rival
    emptied is a legal, wasted trip, and telling the patron their move was
    refused would be a lie about what happened.

    Ordered as claim-then-move inside one CTE for the same reason `dig` is: with
    no transaction available, two statements can leave the pollen spent and the
    bee still standing where it was.
    """
    r = await _exec(
        f"WITH ok AS ("
        f"  SELECT 1 FROM {BEES} WHERE match_id = $1 AND npub = $2 AND cell = $4"
        "   AND next_move_at <= now() AND phase = 'forage'), "
        f"took AS ("
        f"  INSERT INTO {POLLEN} (match_id, hive, cell, taken_by)"
        "   SELECT $1, $5, $3, $2 WHERE EXISTS (SELECT 1 FROM ok)"
        "   ON CONFLICT (match_id, hive, cell) DO NOTHING RETURNING cell), "
        f"moved AS ("
        f"  UPDATE {BEES} SET cell = $3, moves = moves + 1, came_inward = FALSE,"
        "     phase = CASE WHEN EXISTS (SELECT 1 FROM took) THEN 'return' ELSE phase END,"
        f"     next_move_at = now() + interval '{COOLDOWN_S} seconds'"
        "   WHERE match_id = $1 AND npub = $2 AND cell = $4"
        "     AND next_move_at <= now() AND phase = 'forage'"
        + _UNOCCUPIED.format(t=BEES, hive="$5", cell="$3")
        + "   RETURNING hive, seat, cell, phase) "
        "SELECT (SELECT count(*) FROM took) AS took, "
        "       (SELECT hive FROM moved) AS hive, (SELECT seat FROM moved) AS seat, "
        "       (SELECT cell FROM moved) AS cell, (SELECT phase FROM moved) AS phase",
        [match_id, npub, to_cell, cur, hive],
    )
    row = (_rows(r) or [{}])[0]
    if row.get("cell") is None:
        return {"moved": False, "reason": await _why_refused(match_id, hive, npub, to_cell)}
    await bump(match_id)
    return {
        "moved": True,
        "hive": row["hive"],
        "seat": row["seat"],
        "cell": row["cell"],
        "phase": row["phase"],
        "pollen": bool(int(row.get("took") or 0)),
    }


async def taken_pollen(match_id: str) -> list[dict[str, int]]:
    """Which flowers are already spent. An empty flower is information."""
    r = await _exec(
        f"SELECT hive, cell FROM {POLLEN} WHERE match_id = $1 ORDER BY hive, cell", [match_id]
    )
    return [{"hive": int(x["hive"]), "cell": int(x["cell"])} for x in _rows(r)]


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
    _require_commitment(g, bee, to_cell)
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
        "    AND EXISTS (SELECT 1 FROM cut)"
        + _UNOCCUPIED.format(t=BEES, hive="$6", cell="$3")
        + "    RETURNING seat"
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


#: A cell holds ONE bee. Spelled once, so every motion fences the same way.
#:
#: This used to be a SELECT of its own, run before the move — which is a check,
#: not a fence: between the two statements another bee could take the cell and
#: both would land in it. It also cost a round trip on every single move.
_UNOCCUPIED = (
    " AND NOT EXISTS (SELECT 1 FROM {t} o WHERE o.match_id = $1"
    "   AND o.hive = {hive} AND o.cell = {cell} AND o.npub <> $2 AND o.phase <> 'done')"
)


async def _why_refused(match_id: str, hive: int, npub: str, to_cell: int) -> str:
    """Name the reason a fenced move lost, AFTER it lost.

    The occupancy check used to run before every move — a whole round trip, on
    the happy path, to learn something the fence now enforces anyway. Asked here
    instead it costs nothing when the move lands, and still gives the player a
    sentence they can act on when it does not.
    """
    r = await _exec(
        f"SELECT 1 FROM {BEES} WHERE match_id = $1 AND hive = $2 AND cell = $3 "
        "AND npub <> $4 AND phase <> 'done' LIMIT 1",
        [match_id, hive, to_cell, npub],
    )
    if _rows(r):
        return "another bee is standing there — go round it, or bury it"
    return "not your turn — the clock had not come round yet"


async def _require_unoccupied(match_id: str, g: geo.Geometry, bee: dict[str, Any], to_cell: int) -> None:
    """A bee has a body, everywhere: one cell holds one of them.

    The meadow used to be exempt, on the grounds that enforcing bodies above
    ground would gridlock a start where all twelve bees stood on one ring. They
    start in the four corners now, on twelve distinct squares, so the reason is
    gone — and the exemption let five bees pile into the one square outside a
    door, which is what made a doorway look deadlocked.
    """
    r = await _exec(
        f"SELECT 1 FROM {BEES} WHERE match_id = $1 AND hive = $2 AND cell = $3 "
        "AND npub <> $4 AND phase <> 'done' LIMIT 1",
        [match_id, int(bee["hive"]), to_cell, str(bee["npub"])],
    )
    if _rows(r):
        raise BoardError("another bee is standing there — go round it, or bury it")


def _require_commitment(g: geo.Geometry, bee: dict[str, Any], to_cell: int) -> None:
    """Once in with your pollen, you are going to the queen.

    A bee that has crossed a door does not step back out into the meadow. It
    used to be free to, and over 1,218 simulated crossings 52.6% did — every one
    of them carrying pollen and heading for the queen, so with no business
    outside at all.

    The cause is a doorway under pressure: the cell inside is taken by whoever
    is queueing, the wall either side cannot be cut, and the only move left is
    back out. Leaving and returning costs two moves and hands the door to
    somebody else; waiting for it to clear costs one.

    Enforced here as well as in the browser for the usual reason — a rule only
    the client checks is a rule only honest players follow.
    """
    if str(bee.get("phase")) != "tunnel":
        return
    if geo.is_meadow(g, int(bee["cell"])):
        return
    if geo.is_meadow(g, to_cell):
        raise BoardError("your bee is carrying pollen and is not leaving the hive")


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


#: How long a winner has to say what to do with their share before it goes to
#: the charity. Long enough that somebody who played on a Friday and came back
#: the following weekend still has their prize; short enough that a share
#: nobody will ever claim does not sit in the books for ever.
PRIZE_CLAIM_DAYS = 14

#: Prize states in which the winner's share belongs to the charity. `donated`
#: is a winner who said so; `forfeited` is a share no person can take — a match
#: that ended with no human winner, or one nobody claimed inside the window.
CHARITY_PRIZE_STATES = ("donated", "forfeited")


def charity_due(alias: str = "") -> str:
    """SQL for what one settlement owes the charity.

    The charity's share plus the winner's, whenever no person kept the winner's.
    Written once and used by every place that counts, accrues or pays it,
    because three hand-written copies of this rule is three chances for the
    books to disagree about the same sats.
    """
    p = f"{alias}." if alias else ""
    states = ", ".join(f"'{s}'" for s in CHARITY_PRIZE_STATES)
    return (
        f"({p}charity_sats + CASE WHEN {p}prize_state IN ({states}) "
        f"THEN {p}winner_sats ELSE 0 END)"
    )


async def charity_owed() -> dict[str, int]:
    """Everything accrued to the charity, and everything ever raised.

    Both are sums over the WHOLE table rather than over a page. "Raised across
    all matches" was totalled in the browser from whatever rows it had been
    sent, which was right while it was sent all of them and became a false
    figure the moment the ledger was paged — and it had already been wrong for
    anybody past the fiftieth settled match.
    """
    r = await _exec(
        f"SELECT coalesce(sum({charity_due()}), 0)::int AS owed, "
        f"coalesce(sum(pot_sats), 0)::int AS raised FROM {SETTLEMENTS}"
    )
    rows = _rows(r)
    return {
        "accrued_sats": int(rows[0]["owed"]) if rows else 0,
        "raised_sats": int(rows[0]["raised"]) if rows else 0,
    }


#: Columns a reader may sort the ledger by, mapped to what they are in the row.
#:
#: A whitelist, not an escape: this is interpolated into SQL because a column
#: name cannot be a bound parameter, and the only safe way to interpolate one is
#: to refuse anything that is not on a list written here.
SETTLEMENT_SORTS = {
    "settled": "created_at",
    "match": "match_id",
    "raised": "pot_sats",
    "charity": "charity_sats",
    "winner": "winner_sats",
}


async def settlements(
    page: int = 0,
    page_size: int = 25,
    sort_col: str = "settled",
    sort_dir: str = "desc",
) -> dict[str, Any]:
    """One page of the ledger, sorted, with the total so a pager can be drawn.

    Sorted and paged HERE rather than in the browser. The client had the whole
    history and cut it up itself, which works until the history is longer than
    anybody wants to send — and this is the table that grows for ever, one row
    per settled match, kept when everything else about the match is purged.
    """
    col = SETTLEMENT_SORTS.get(sort_col, "created_at")
    direction = "ASC" if str(sort_dir).lower() == "asc" else "DESC"
    size = max(1, min(int(page_size), 200))
    offset = max(0, int(page)) * size

    total = _rows(await _exec(f"SELECT count(*)::int AS n FROM {SETTLEMENTS}"))
    rows = _rows(
        await _exec(
            # `match_id` breaks ties so a page boundary cannot show the same row
            # twice, or skip one, when several matches settle in the same second.
            f"SELECT * FROM {SETTLEMENTS} ORDER BY {col} {direction}, match_id {direction} "
            f"LIMIT {size} OFFSET {offset}"
        )
    )
    return {
        "settlements": rows,
        "total": int(total[0]["n"]) if total else 0,
        "page": max(0, int(page)),
        "page_size": size,
        "sort_col": sort_col if sort_col in SETTLEMENT_SORTS else "settled",
        "sort_dir": direction.lower(),
    }


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


# ── Who the money goes to ────────────────────────────────────────────────


async def get_charity() -> dict[str, str]:
    """The current beneficiary. Empty name means the operator has not named one."""
    r = await _exec(
        f"SELECT name, website, lightning_address FROM {CHARITY} WHERE id = 'current'"
    )
    rows = _rows(r)
    if not rows:
        return {"name": "", "website": "", "lightning_address": ""}
    row = rows[0]
    return {
        "name": str(row.get("name") or ""),
        "website": str(row.get("website") or ""),
        "lightning_address": str(row.get("lightning_address") or ""),
    }


async def set_charity(name: str, website: str, lightning_address: str) -> dict[str, str]:
    """Name the beneficiary. One row, replaced.

    History is unaffected: every settlement records the beneficiary it actually
    paid at the time, so changing this never rewrites where past money went.
    """
    await _exec(
        f"INSERT INTO {CHARITY} (id, name, website, lightning_address, set_at) "
        "VALUES ('current', $1, $2, $3, now()) "
        "ON CONFLICT (id) DO UPDATE SET name = $1, website = $2, "
        "  lightning_address = $3, set_at = now()",
        [name, website, lightning_address],
    )
    return await get_charity()


async def get_payout(npub: str) -> dict[str, Any]:
    """What this patron wants done with a win.

    No row means donate. That is the generous default for a game whose whole
    point is the pollinators, and it means a winner who has never thought about
    it still ends the round with the money settled rather than owed.
    """
    r = await _exec(
        f"SELECT lightning_address, donate FROM {PATRONS} WHERE npub = $1", [npub]
    )
    rows = _rows(r)
    if not rows:
        return {"lightning_address": "", "donate": True, "set": False}
    row = rows[0]
    return {
        "lightning_address": str(row.get("lightning_address") or ""),
        "donate": bool(row.get("donate")),
        "set": True,
    }


async def set_payout(npub: str, lightning_address: str, donate: bool) -> dict[str, Any]:
    """Record a standing instruction for this patron's winnings."""
    await _exec(
        f"INSERT INTO {PATRONS} (npub, lightning_address, donate, set_at) "
        "VALUES ($1, $2, $3, now()) "
        "ON CONFLICT (npub) DO UPDATE SET lightning_address = $2, donate = $3, "
        "  set_at = now()",
        [npub, lightning_address, donate],
    )
    return await get_payout(npub)


async def set_prize_state(match_id: str, state: str) -> None:
    """Record what became of the winner's share.

    Only ever moves a prize off `unclaimed`, so a settlement that runs twice
    cannot walk a donated share back into a claimable one.
    """
    await _exec(
        f"UPDATE {SETTLEMENTS} SET prize_state = $2 "
        "WHERE match_id = $1 AND prize_state = 'unclaimed'",
        [match_id, state],
    )


# ── Paying it out ────────────────────────────────────────────────────────


async def claim_payout(
    kind: str, match_id: str, destination: str, amount_sats: int
) -> bool:
    """Reserve the right to send this payment. True means it is yours to make.

    Claimed BEFORE the sats move, and on the primary key, so a retry or a
    second operator pressing the button collides here rather than at the node.
    False means somebody already has it — which includes a payment still in
    flight, and that is deliberately not a case this hands out again.
    """
    r = await _exec(
        f"INSERT INTO {PAYOUTS} (payout_id, kind, match_id, destination, amount_sats) "
        "VALUES ($1, $2, $3, $4, $5) ON CONFLICT (payout_id) DO NOTHING",
        [f"{kind}:{match_id}", kind, match_id, destination, int(amount_sats)],
    )
    return _count(r) == 1


async def finish_payout(
    kind: str, match_id: str, *, state: str, payment_hash: str = "", detail: str = ""
) -> None:
    """Record how it went. Only ever moves a payment off `sending`."""
    await _exec(
        f"UPDATE {PAYOUTS} SET state = $2, payment_hash = $3, detail = $4, "
        "finished_at = now() WHERE payout_id = $1 AND state = 'sending'",
        [f"{kind}:{match_id}", state, payment_hash[:120], detail[:400]],
    )


async def payouts(limit: int = 50) -> list[dict[str, Any]]:
    r = await _exec(
        f"SELECT * FROM {PAYOUTS} ORDER BY started_at DESC LIMIT {max(1, min(limit, 200))}"
    )
    return _rows(r)


async def obligations() -> dict[str, int]:
    """What is owed and has not been sent, in sats.

    Owed is what the settlements say; sent is what the payouts table says. The
    difference is the operator's outstanding liability, and it is the figure a
    payout check reports — a charity share counted as paid because somebody
    *meant* to pay it is how a node gets spent twice.

    A payment still `sending` counts as spent. It may yet fail, in which case
    the money comes back and the figure improves; assuming it failed would let
    the same sats be promised again while the first attempt is still in flight.

    Only a prize a person actually `kept` is owed to a person. Every other
    outcome — donated, or forfeited because no human won or nobody claimed —
    is counted with the charity, which is why `charity_due()` and this
    `prize_state = 'kept'` test are two halves of one rule and must stay so:
    loosen either and the same sats are owed twice.
    """
    r = await _exec(
        f"SELECT coalesce(sum({charity_due()}), 0)::int AS charity, "
        "coalesce(sum(CASE WHEN prize_state = 'kept' THEN winner_sats ELSE 0 END), 0)::int "
        f"AS prizes FROM {SETTLEMENTS}"
    )
    rows = _rows(r)
    owed_charity = int(rows[0]["charity"]) if rows else 0
    owed_prizes = int(rows[0]["prizes"]) if rows else 0

    p = await _exec(
        f"SELECT kind, coalesce(sum(amount_sats), 0)::int AS sent FROM {PAYOUTS} "
        "WHERE state IN ('sending', 'paid') GROUP BY kind"
    )
    sent = {str(row["kind"]): int(row["sent"]) for row in _rows(p)}

    charity = max(0, owed_charity - sent.get("charity", 0))
    prizes = max(0, owed_prizes - sent.get("winner", 0))
    return {
        "charity_unpaid_sats": charity,
        "prizes_unpaid_sats": prizes,
        "unpaid_sats": charity + prizes,
        "charity_accrued_sats": owed_charity,
        "prizes_accrued_sats": owed_prizes,
    }


async def settlement_of(match_id: str) -> dict[str, Any] | None:
    """One settlement, by id.

    A targeted read rather than a page scanned in Python. The page version was
    not merely wasteful: `settlements()` caps at 200 rows ordered by date, so a
    match older than the last 200 became invisible and the payout path reported
    "no settled match with that id" for a settlement sitting right there.
    """
    r = await _exec(f"SELECT * FROM {SETTLEMENTS} WHERE match_id = $1", [match_id])
    rows = _rows(r)
    return rows[0] if rows else None


async def payout_of(kind: str, match_id: str) -> dict[str, Any] | None:
    """One payment attempt, by leg. Same reason as `settlement_of`.

    Reading this from a capped page meant an older payment looked like no
    payment — which, on the path that decides whether sats have already been
    sent, is the worst possible way to be wrong.
    """
    r = await _exec(
        f"SELECT * FROM {PAYOUTS} WHERE payout_id = $1", [f"{kind}:{match_id}"]
    )
    rows = _rows(r)
    return rows[0] if rows else None


async def claim_charity_arrears(destination: str) -> list[dict[str, Any]]:
    """Claim every unpaid charity leg at once, and say which they were.

    One statement, so the whole claim is atomic on a driver that has no
    transactions. `NOT EXISTS` makes two concurrent batches claim disjoint sets
    rather than the same rows twice, and the per-match `payout_id` stays the
    primary key — so this and a single `pay_out` for one match still collide
    correctly instead of paying it twice.

    A row per match even though one payment covers them all: the accounting
    stays per match, which is what `obligations()` counts and what a reader of
    `payout_history` needs, while the sats move once. Paying each match
    separately would spend the routing fee floor on every one of them, and a
    match whose charity share is smaller than that fee would cost more to send
    than it delivers.

    Two legs per match, not one: the charity's own share under `charity:<id>`,
    and a winner's share that came to the charity under `prize:<id>`. They are
    separate rows because they become due at different times — a prize is
    donated or forfeited long after the match settled, and folding it into an
    amount already claimed under `charity:<id>` would mean it could never be
    claimed at all.
    """
    r = await _exec(
        f"INSERT INTO {PAYOUTS} (payout_id, kind, match_id, destination, amount_sats) "
        "SELECT legs.payout_id, 'charity', legs.match_id, $1, legs.amount FROM ("
        f"  SELECT 'charity:' || s.match_id AS payout_id, s.match_id, s.charity_sats AS amount "
        f"  FROM {SETTLEMENTS} s WHERE s.charity_sats > 0 "
        "  UNION ALL "
        f"  SELECT 'prize:' || s.match_id, s.match_id, s.winner_sats "
        f"  FROM {SETTLEMENTS} s WHERE s.winner_sats > 0 "
        f"    AND s.prize_state IN ({', '.join(repr(x) for x in CHARITY_PRIZE_STATES)})"
        ") legs "
        "WHERE NOT EXISTS ("
        f"  SELECT 1 FROM {PAYOUTS} p WHERE p.payout_id = legs.payout_id) "
        "RETURNING payout_id, match_id, amount_sats",
        [destination],
    )
    return _rows(r)


async def finish_charity_arrears(
    payout_ids: list[str], *, state: str, payment_hash: str = "", detail: str = ""
) -> int:
    """Record the outcome against exactly the legs this batch claimed.

    Scoped to the ids rather than to `kind='charity' AND state='sending'`,
    which would also stamp a concurrent batch's rows with this batch's result.

    Payout ids, not match ids: a match can owe the charity on two legs now, and
    deriving `charity:<match>` here would leave the prize leg of every match in
    the batch marked `sending` for ever — owed by the books, already paid by the
    node, and never reconcilable.
    """
    if not payout_ids:
        return 0
    holes = ", ".join(f"${i + 4}" for i in range(len(payout_ids)))
    r = await _exec(
        f"UPDATE {PAYOUTS} SET state = $1, payment_hash = $2, detail = $3, "
        f"finished_at = now() WHERE state = 'sending' AND payout_id IN ({holes})",
        [state, payment_hash[:120], detail[:400], *payout_ids],
    )
    return _count(r)


async def forfeit_stale_prizes(days: int = PRIZE_CLAIM_DAYS) -> int:
    """Give the charity a prize nobody came back for.

    A share sits `unclaimed` until its winner says what to do with it, and most
    of them never will: the simulated bees that fill a thin match hold throwaway
    keys that stop existing when the swarm does, and a human can simply not
    return. Left alone, that share is owed to nobody, paid to nobody, and
    counted by nothing — sats the game raised for the charity that the charity
    never sees.

    Only ever moves a prize off `unclaimed`, so a winner who already decided is
    never overruled by the clock.
    """
    r = await _exec(
        f"UPDATE {SETTLEMENTS} SET prize_state = 'forfeited' "
        "WHERE prize_state = 'unclaimed' AND winner_sats > 0 "
        f"  AND created_at < now() - interval '{int(days)} days'"
    )
    return _count(r)


async def abandoned_with_fares() -> list[str]:
    """Matches that took fares and were never settled.

    `retire_stale_boards` abandons a match whose board no longer exists, and
    said its pot 'is owed to somebody whatever happened to the board' — but
    nothing ever worked out to whom. `purge_old_details` then deleted the match
    and its fares a week later, so the money was not merely unpaid, it stopped
    being countable.
    """
    r = await _exec(
        f"SELECT m.match_id FROM {MATCHES} m WHERE m.state = 'abandoned' "
        f"  AND EXISTS (SELECT 1 FROM {FARES} f WHERE f.match_id = m.match_id) "
        f"  AND NOT EXISTS (SELECT 1 FROM {SETTLEMENTS} s WHERE s.match_id = m.match_id)"
    )
    return [str(row["match_id"]) for row in _rows(r)]


# ── Not hoarding old rounds ──────────────────────────────────────────────
#
# Nothing here reclaimed anything. The only DELETE was `retire_stale_boards`,
# which fires when the GEOMETRY changes — so a completed, settled, fully paid
# match was kept for ever along with every bee, every dug cell and every fare
# row that made up its pot.
#
# Measured over the simulator, one full round of five hives leaves about 6,758
# fare rows, 666 dug cells, 60 bees and 58 emptied flowers: roughly 1.9 MB once
# the tools are priced, of which the fares are 93%. Ten rounds a day is 6.6 GB a
# year and fifty is 33 GB. The danger is not the steady state — it is a good
# week, where the bill arrives before anybody has noticed the growth.

#: How long a finished round keeps its move-by-move detail.
#:
#: Long enough to look back at a recent game and to investigate a payment that
#: did not land; short enough that a viral fortnight does not become a permanent
#: bill. The MONEY is not on this clock — `bk_settlements` and `bk_payouts` are
#: never purged, so the ledger that says where every sat went outlives the board
#: it was won on.
DETAIL_RETENTION_DAYS = 7


async def roll_up_fares(match_id: str) -> int:
    """Drop the fare rows once their total is safely in the settlement.

    The pot is `sum(sats)` over these rows, and the moment `record_settlement`
    stores it they have done their whole job. They are 93% of everything this
    service writes, and the settlement they collapse into is the row anybody
    actually audits.

    Only ever called after a settlement is recorded FIRST — a replay finds the
    settlement already there, takes no second pass at the money, and reaches
    here with nothing left to delete.
    """
    r = await _exec(f"DELETE FROM {FARES} WHERE match_id = $1", [match_id])
    return _count(r)


async def purge_old_details(days: int = DETAIL_RETENTION_DAYS) -> dict[str, int]:
    """Forget how old rounds were played. Never forget what they paid.

    Bees, dug cells, emptied flowers and any surviving fares go; the match row
    goes last. `bk_settlements` and `bk_payouts` are untouched, so
    `settlement_history` and `payout_history` still answer for every round this
    service has ever run — which is the claim that matters, and the one a
    charity or a winner would come back to check.

    Children first and the match last, so an interrupted sweep leaves a match
    whose detail has been purged rather than orphans pointing at nothing.
    """
    where = (
        f"match_id IN (SELECT match_id FROM {MATCHES} "
        f"WHERE ended_at IS NOT NULL AND ended_at < now() - interval '{int(days)} days')"
    )
    out: dict[str, int] = {}
    for name, table in (("bees", BEES), ("cells", CELLS), ("pollen", POLLEN), ("fares", FARES)):
        out[name] = _count(await _exec(f"DELETE FROM {table} WHERE {where}"))
    out["matches"] = _count(
        await _exec(
            f"DELETE FROM {MATCHES} WHERE ended_at IS NOT NULL "
            f"AND ended_at < now() - interval '{int(days)} days'"
        )
    )
    return out
