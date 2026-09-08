"""How a match begins, ends, and pays out.

The clock lives here and not in anybody's browser. A patron's tab sleeping, or
closing, or never coming back must not stop the world: matches form, run and
settle on the server, and a bee whose owner has stopped acting simply stops
moving while the rest race past it.

`advance()` is safe to call from anywhere and often — the cron worker, a free
poke from any patron, or opportunistically off another tool call. Everything it
does is idempotent or fenced, because "called twice" is the normal case rather
than the exceptional one.
"""

from __future__ import annotations

import logging
from typing import Any

from beesknees_mcp import board_store as store
from beesknees_mcp import geometry as geo

logger = logging.getLogger(__name__)

# The split, as fractions of the pot. The remainder from integer division goes
# to the charity, never to the operator — rounding should not be a revenue
# stream, and the direction of the error is the whole point.
CHARITY_SHARE = 0.80
WINNER_SHARE = 0.10

#: The fallback beneficiary, for a service whose operator has not named one yet.
#: `set_charity` is the real source; this only keeps a settlement honest before
#: anybody has been asked.
BENEFICIARY = "Pollinator Partnership"
"""Stored rather than compiled in would be better; this is the default until an
operator sets one. Every settlement records the beneficiary it actually paid, so
history stays true if this ever changes."""


def split_pot(pot: int) -> dict[str, int]:
    """Divide a pot three ways, losing nothing.

    The operator and the winner are computed and the charity takes what is
    left, so the three parts always sum to exactly the pot no matter how the
    rounding falls.
    """
    winner = int(pot * WINNER_SHARE)
    operator = int(pot * (1.0 - CHARITY_SHARE - WINNER_SHARE))
    charity = pot - winner - operator
    return {"pot": pot, "charity": charity, "winner": winner, "operator": operator}


# ── Forming ──────────────────────────────────────────────────────────────


async def ensure_forming() -> dict[str, Any]:
    """There is always a match taking seats."""
    m = await store.forming_match()
    if m:
        return m
    mid = await store.open_match()
    await store.seed_mouths(mid)
    return await store.get_match(mid) or {"match_id": mid, "state": "forming"}


async def join(npub: str, label: str) -> dict[str, Any]:
    """Buy a seat in the next match.

    Seats go round-robin — always into the emptiest hive — so the five hives
    stay within one seat of each other and the whole board is underway rather
    than one hive playing while four sit dark.

    This replaces filling the FULLEST hive first, which existed because quorum
    used to mean "some hive reached eight": spread evenly, no hive ever did, and
    nothing would have started. Quorum is now counted across the match (see
    `seated_total`), so the two rules had to change together — round-robin with
    a per-hive quorum is a lobby that never opens.

    Balance is what makes thin attendance fair rather than merely thin. Twelve
    bees dealt round-robin is two or three per hive: everyone has a rival and
    nobody races an empty board. The same twelve dealt fullest-first is one hive
    of twelve and four empty ones — and an empty hive's single occupant, once
    one arrives, wins almost by walking.
    """
    m = await ensure_forming()
    mid = str(m["match_id"])

    existing = await store.bee_of(mid, npub)
    if existing:
        return {"match_id": mid, "already_seated": True, **existing}

    counts = await store.seat_counts(mid)
    open_hives = [h for h in range(store.HIVES) if counts.get(h, 0) < store.SEATS]
    if not open_hives:
        raise store.BoardError("every hive is full — the next match opens shortly")
    # Emptiest first; hive id breaks ties, so the deal is deterministic and a
    # replay of the same joins produces the same board.
    hive = min(open_hives, key=lambda h: (counts.get(h, 0), h))

    seat = await store.take_seat(mid, npub, label, hive)
    if sum((await store.seat_counts(mid)).values()) >= store.QUORUM:
        await _mark_quorum(mid)
    return {"match_id": mid, "already_seated": False, **seat}


async def _mark_quorum(match_id: str) -> None:
    """Stamp the moment a hive filled, once. The grace period runs from it."""
    await store._exec(
        f"UPDATE {store.MATCHES} SET quorum_at = now() "
        "WHERE match_id = $1 AND state = 'forming' AND quorum_at IS NULL",
        [match_id],
    )


# ── The clock ────────────────────────────────────────────────────────────


async def advance() -> dict[str, Any]:
    """Move every live match along. Safe to call from anywhere, often."""
    acted: list[str] = []
    for m in await store.live_matches():
        mid = str(m["match_id"])
        if str(m["state"]) == "forming":
            if await _maybe_start(m):
                acted.append(f"started {mid}")
        elif str(m["state"]) == "running":
            done = await _maybe_finish(m)
            if done:
                acted.append(f"ended {mid}")
    await ensure_forming()
    return {"acted": acted}


async def _maybe_start(m: dict[str, Any]) -> bool:
    """Start once a hive has quorum and the grace period has run out.

    The grace exists so the eighth arrival does not slam the door on a ninth who
    was two seconds behind them.
    """
    if not m.get("quorum_at"):
        return False
    r = await store._exec(
        f"UPDATE {store.MATCHES} SET state = 'running', started_at = now(), seq = seq + 1 "
        "WHERE match_id = $1 AND state = 'forming' AND quorum_at IS NOT NULL "
        f"  AND quorum_at <= now() - interval '{store.FORMING_GRACE_S} seconds' "
        "RETURNING match_id",
        [str(m["match_id"])],
    )
    return bool(store._rows(r))


async def _maybe_finish(m: dict[str, Any]) -> bool:
    """End a match when somebody reaches a queen, or when the ceiling falls."""
    mid = str(m["match_id"])

    # A bee in the queen's chamber has won. Earliest arrival takes it.
    r = await store._exec(
        f"SELECT npub, hive FROM {store.BEES} "
        "WHERE match_id = $1 AND phase = 'done' ORDER BY finished_at LIMIT 1",
        [mid],
    )
    rows = store._rows(r)

    if not rows:
        # Ceiling. The bee nearest a queen takes it, so a stalled match still
        # has a winner rather than simply failing to have one.
        over = await store._exec(
            f"SELECT match_id FROM {store.MATCHES} WHERE match_id = $1 AND state = 'running' "
            f"  AND started_at <= now() - interval '{store.ROUND_CEILING_S} seconds'",
            [mid],
        )
        if not store._rows(over):
            return False
        rows = await _nearest_to_a_queen(mid)
        if not rows:
            rows = [{"npub": "", "hive": 0}]

    won = rows[0]
    ended = await store._exec(
        f"UPDATE {store.MATCHES} SET state = 'ended', ended_at = now(), "
        "    winner_npub = $2, winner_hive = $3, seq = seq + 1 "
        "WHERE match_id = $1 AND state = 'running' RETURNING match_id",
        [mid, won.get("npub") or "", int(won.get("hive") or 0)],
    )
    if not store._rows(ended):
        return False
    await settle(mid)
    return True


async def _nearest_to_a_queen(match_id: str) -> list[dict[str, Any]]:
    """Ranked by ring, then by phase — the ordering the game itself uses."""
    bees = await store.bees_in(match_id)
    g = geo.make_geometry()
    order = {"done": 0, "tunnel": 1, "return": 2, "forage": 3}
    ranked = sorted(
        bees,
        key=lambda b: (order.get(str(b["phase"]), 9), geo.ring_of(g, int(b["cell"]))),
    )
    return [{"npub": b["npub"], "hive": b["hive"]} for b in ranked[:1]]


# ── Settlement ───────────────────────────────────────────────────────────


async def settle(match_id: str) -> dict[str, Any]:
    """Close the books on a match.

    Recorded before anything is paid, and guarded on the match id, so a cron
    that fires twice cannot pay a prize twice. `record_settlement` returning
    False means somebody already did this — which is a success, not an error.
    """
    m = await store.get_match(match_id)
    if not m:
        raise store.BoardError("no such match")

    pot = await store.pot_of(match_id)
    parts = split_pot(pot)
    winner_npub = str(m.get("winner_npub") or "")

    # Who the money goes to is the OPERATOR'S, not the source's. The constant is
    # only a fallback for a service nobody has configured yet, and a settlement
    # records the beneficiary it actually paid so history stays true when this
    # changes.
    charity = await store.get_charity()
    beneficiary = charity["name"] or BENEFICIARY

    first = await store.record_settlement(
        match_id,
        pot=parts["pot"],
        charity=parts["charity"],
        winner=parts["winner"],
        operator=parts["operator"],
        winner_npub=winner_npub,
        beneficiary=beneficiary,
    )
    await store._exec(
        f"UPDATE {store.MATCHES} SET state = 'settled', settled_at = now(), seq = seq + 1 "
        "WHERE match_id = $1 AND state IN ('ended', 'abandoned')",
        [match_id],
    )
    state = "unclaimed"
    if winner_npub and parts["winner"] > 0:
        if first:
            state = await resolve_prize(match_id, winner_npub, parts["winner"])
    else:
        # Nobody won it, so nobody can claim it. The share is the charity's from
        # the moment the books close rather than sitting `unclaimed` for a
        # winner who does not exist.
        await store.set_prize_state(match_id, "forfeited")
        state = "forfeited"

    if first:
        # The pot is in the settlement now, so the rows that added up to it have
        # done their job. They are 93% of everything this service writes, and
        # keeping them would mean carrying a move-by-move record of every round
        # ever played for the sake of a number already stored.
        #
        # After the settlement, never before: `record_settlement` returning
        # False means somebody else got there first, and deleting their evidence
        # on the way past would be worse than useless.
        await store.roll_up_fares(match_id)
    return {
        "match_id": match_id,
        "first_time": first,
        **parts,
        "beneficiary": beneficiary,
        "prize_state": state,
    }


async def settle_abandoned() -> int:
    """Close the books on matches that were abandoned mid-play.

    A match is abandoned when the board it was played on stopped existing, and
    it keeps its fares precisely because somebody paid them. Those fares are a
    pot; a pot has a split; and with no winner the winner's share is the
    charity's too. Without this the fares were simply deleted a week later.
    """
    done = 0
    for mid in await store.abandoned_with_fares():
        try:
            await settle(mid)
            done += 1
        except Exception as exc:  # noqa: BLE001 — one bad match must not stop the rest
            logger.error("could not settle abandoned match %s: %s", mid, exc)
    if done:
        logger.info("settled %d abandoned match(es)", done)
    return done


async def resolve_prize(match_id: str, npub: str, sats: int) -> str:
    """Settle the winner's share the way they already said to.

    A winner who has set a preference is not asked again — the whole point of
    deciding beforehand is that nobody has to make a decision about money with a
    trophy on the screen. A winner who has never said anything keeps the choice:
    the share is held, not credited, so `claim_prize` still has something to
    decide, and so donating actually donates rather than leaving a credit the
    patron already has.
    """
    pref = await store.get_payout(npub)
    if not pref["set"]:
        return "unclaimed"
    if pref["donate"]:
        await store.set_prize_state(match_id, "donated")
        return "donated"
    if await award_prize(match_id, npub, sats):
        await store.set_prize_state(match_id, "kept")
    return "kept"


async def award_prize(match_id: str, npub: str, sats: int) -> bool:
    """Credit the winner's balance.

    Nothing in the SDK is a purpose-built "award credits" tool. `restore_credits`
    needs a settled BTCPay invoice and refuses cross-patron moves; a coupon caps
    at 100% off and can never pay anybody. `LedgerCache.credit` is the honest
    path, and it is NOT idempotent on its own — so the match id becomes the
    synthetic invoice id, and a ledger that already carries that tranche is left
    alone. Copied from the SDK's own restore path, which guards the same way.
    """
    from beesknees_mcp.server import runtime

    key = f"prize:{match_id}"
    try:
        cache = await runtime.ledger_cache()
    except Exception as exc:  # noqa: BLE001
        logger.error("prize for %s could not reach the ledger: %s", match_id, exc)
        return False

    def _credit(ledger: Any) -> bool:
        if any(getattr(t, "invoice_id", None) == key for t in getattr(ledger, "tranches", [])):
            return False  # already paid; mutate() writes nothing
        ledger.credit_deposit(int(sats), key)
        return True

    try:
        paid = await cache.mutate(npub, _credit)
    except Exception as exc:  # noqa: BLE001
        logger.error("prize credit failed for %s: %s", match_id, exc)
        return False
    if paid:
        logger.info("prize settled for match %s", match_id)
    return bool(paid)
