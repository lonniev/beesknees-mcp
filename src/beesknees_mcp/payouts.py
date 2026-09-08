"""Sending the sats.

Everything up to here has been bookkeeping: the pot is a sum over a fares
table, the split is arithmetic, and the settlement row is a promise. This is
where the promise is kept, and it is the only part of this service that cannot
be undone by writing another row.

The order is deliberate and is the whole design:

    1. read what is owed, from THIS service's own settlement row
    2. resolve the destination address to an invoice for exactly that amount
    3. ask whether the operator can honestly afford it        (treasury)
    4. CLAIM the payment in the database, before any sats move (board_store)
    5. pay
    6. record what happened

Step 4 before step 5 is what makes a double-payment impossible: two attempts
collide on a primary key rather than at the node. Step 3 before step 4 is what
stops the operator paying a winner out of another patron's unspent deposit.

Nothing here runs on a timer. A payment leaves only because the operator asked
for it, which is a deliberately conservative default for the first money this
service has ever sent: automatic settlement is a small change once the manual
path has been watched working, and there is no undoing an automatic one that
was wrong.
"""

from __future__ import annotations

import logging
from typing import Any

from tollbooth.btcpay_client import BTCPayError
from tollbooth.lnurl import LnurlResolutionError, resolve_lightning_address

from beesknees_mcp import board_store as store
from beesknees_mcp import treasury

logger = logging.getLogger(__name__)

#: What a payment may be. `winner` goes to the patron who reached the queen and
#: chose to keep their share; `charity` goes to the beneficiary the operator
#: named. Nothing else is payable — an operator's own earnings leave the node
#: the way any other wallet's do, not through this service.
KINDS = ("charity", "winner")


async def _btcpay() -> Any:
    """The operator's BTCPay client, or None if it is not configured.

    None is not an error here — an operator who has not delivered BTCPay
    credentials simply cannot pay yet, and saying so plainly beats an
    AttributeError from inside a payment.
    """
    from beesknees_mcp.server import runtime

    try:
        return await runtime.ensure_cashier()
    except Exception as exc:  # noqa: BLE001 — any failure means "cannot pay"
        logger.warning("no BTCPay client available: %s", exc)
        return None


async def look() -> dict[str, Any]:
    """What the wallet can send, and what is owed out of it.

    Free of side effects on purpose: an operator should be able to ask this
    before, during and after a payout without changing anything, and these are
    the same numbers `send` gates on — one rule, read from one place, so the
    answer cannot disagree with the decision.
    """
    obligations = await store.obligations()

    sendable: int | None = None
    why = ""
    client = await _btcpay()
    if client is None:
        why = "BTCPay credentials are not available to this process"
    else:
        try:
            sendable = int((await client.get_lightning_balance())["sendable_sats"])
        except BTCPayError as exc:
            # Worth naming rather than flattening to "unavailable": an
            # invoice-only API key cannot read a node balance, and that reads
            # identically to an outage unless the error is passed through.
            why = f"the node did not answer: {exc}"
            logger.warning("lightning balance unavailable: %s", exc)

    w = treasury.Wallet(sendable_sats=sendable, owed_sats=obligations["unpaid_sats"])
    return {
        "node_reachable": sendable is not None,
        "sendable_sats": sendable or 0,
        "owed_sats": w.owed_sats,
        "owed_charity_sats": obligations["charity_unpaid_sats"],
        "owed_prizes_sats": obligations["prizes_unpaid_sats"],
        # Reported, not enforced. An operator should see that they owe more than
        # they hold; refusing one charity because a second is also owed helps
        # neither of them.
        "covers_everything_owed": sendable is not None and sendable >= w.owed_sats,
        "note": why or "clear",
    }


async def _owed(kind: str, match_id: str) -> tuple[int, str, str]:
    """What this match owes on this leg, and where it goes.

    Read from the settlement row rather than recomputed, so a payment can never
    be for an amount the ledger does not already say — and from the row's OWN
    beneficiary for the charity leg, so a match settled under a previous
    charity pays the charity it actually recorded.
    """
    row = await store.settlement_of(match_id)
    if row is None:
        raise store.BoardError("no settled match with that id")

    if kind == "charity":
        # The charity's OWN share only. A winner's share that came to the
        # charity — donated, or forfeited because nobody claimed it — is a
        # separate leg, paid by `send_charity_arrears`, because it falls due
        # long after this one does.
        charity = await store.get_charity()
        return int(row["charity_sats"]), charity["lightning_address"], charity["name"]

    npub = str(row.get("winner_npub") or "")
    if not npub:
        raise store.BoardError("that match has no winner")
    if str(row.get("prize_state")) != "kept":
        raise store.BoardError(
            "that winner did not keep their share — nothing is owed to them"
        )
    pref = await store.get_payout(npub)
    return int(row["winner_sats"]), pref["lightning_address"], npub[:12]


async def send(kind: str, match_id: str) -> dict[str, Any]:
    """Pay one leg of one settled match. Idempotent by construction."""
    if kind not in KINDS:
        return {"success": False, "error": f"payable kinds are {', '.join(KINDS)}"}

    amount, address, who = await _owed(kind, match_id)
    if amount <= 0:
        return {"success": False, "error_code": "nothing_owed",
                "error": "that leg is settled at zero — there is nothing to send"}
    if not address:
        return {"success": False, "error_code": "no_address",
                "error": f"no Lightning address on file for {who}"}

    # Can the wallet actually do it?
    client = await _btcpay()
    if client is None:
        return {"success": False, "error_code": "no_btcpay",
                "error": "BTCPay credentials are not available to this process"}
    try:
        sendable = int((await client.get_lightning_balance())["sendable_sats"])
    except BTCPayError as exc:
        return {"success": False, "error_code": "node_unreachable",
                "error": f"the node did not report a balance, so nothing was sent: {exc}"}

    owed = (await store.obligations())["unpaid_sats"]
    ok, why = treasury.may_pay(treasury.Wallet(sendable, owed), amount)
    if not ok:
        return {"success": False, "error_code": "insufficient_funds", "error": why,
                "sendable_sats": sendable, "amount_sats": amount}

    # An invoice for exactly what is owed, from the address that will receive
    # it. Resolved BEFORE the claim, so an unreachable wallet does not burn the
    # one claim this payment gets.
    try:
        bolt11 = await resolve_lightning_address(
            address, amount, comment=f"The Bee's Knees — {kind} share, match {match_id[:8]}"
        )
    except LnurlResolutionError as exc:
        return {"success": False, "error_code": "address_unresolvable",
                "error": f"{address} did not return an invoice: {exc}"}

    if not await store.claim_payout(kind, match_id, address, amount):
        existing = await store.payout_of(kind, match_id)
        return {"success": True, "already": str(existing["state"]) if existing else "claimed",
                "match_id": match_id, "kind": kind,
                "note": "this payment was already made or is in flight"}

    try:
        result = await client.pay_lightning_invoice(
            bolt11, max_fee_sats=treasury.fee_allowance(amount),
            max_fee_percent=treasury.FEE_PERCENT,
        )
    except BTCPayError as exc:
        # The claim stays, marked failed, so the failure is on the record and
        # a retry is a deliberate act rather than an accident of a rerun.
        await store.finish_payout(kind, match_id, state="failed", detail=str(exc)[:400])
        return {"success": False, "error_code": "payment_failed", "error": str(exc)}

    status = str(result.get("status") or "").lower()
    # "Complete" is settled. Anything else — Pending especially — is UNDER WAY,
    # and calling that paid is how a payment gets sent a second time.
    state = "paid" if status == "complete" else "sending"
    await store.finish_payout(
        kind, match_id, state=state,
        payment_hash=str(result.get("paymentHash") or ""),
        detail=status or "no status returned",
    )
    return {
        "success": True, "match_id": match_id, "kind": kind, "to": who,
        "amount_sats": amount, "state": state, "status": status,
        "payment_hash": str(result.get("paymentHash") or ""),
        "settled": state == "paid",
    }


async def send_charity_arrears() -> dict[str, Any]:
    """Pay everything owed to the charity, in one payment.

    The charity share accrues match by match and is settled in a batch, which
    is the shape this always needed: a single match's share can be smaller than
    the fee floor it would cost to route, so paying per match can cost more than
    it delivers.

    The accounting stays per match — one claimed row each, so `obligations()`
    still counts honestly and `payout_history` still shows which matches were
    covered — while the sats move once. Claims happen before the payment, on the
    same primary key a single-match `pay_out` uses, so the two cannot pay the
    same leg twice.

    A failure after the claim marks those legs `failed` rather than deleting
    them: `obligations()` counts only `sending` and `paid`, so the debt comes
    back on its own, and the attempt stays on the record.
    """
    charity = await store.get_charity()
    address = charity["lightning_address"]
    if not charity["name"]:
        return {"success": False, "error_code": "no_charity",
                "error": "no beneficiary is named — call set_charity first"}
    if not address:
        return {"success": False, "error_code": "no_address",
                "error": f"no Lightning address on file for {charity['name']}"}

    client = await _btcpay()
    if client is None:
        return {"success": False, "error_code": "no_btcpay",
                "error": "BTCPay credentials are not available to this process"}
    try:
        sendable = int((await client.get_lightning_balance())["sendable_sats"])
    except BTCPayError as exc:
        return {"success": False, "error_code": "node_unreachable",
                "error": f"the node did not report a balance, so nothing was sent: {exc}"}

    owed = (await store.obligations())["charity_unpaid_sats"]
    ok, why = treasury.may_pay(treasury.Wallet(sendable, owed), owed)
    if not ok:
        return {"success": False, "error_code": "insufficient_funds", "error": why,
                "sendable_sats": sendable, "amount_sats": owed}

    # Resolved BEFORE the claim, so an unreachable wallet does not leave a batch
    # of legs claimed against a payment that was never attempted.
    try:
        bolt11 = await resolve_lightning_address(
            address, owed, comment=f"The Bee's Knees — charity arrears for {charity['name']}"
        )
    except LnurlResolutionError as exc:
        return {"success": False, "error_code": "address_unresolvable",
                "error": f"{address} did not return an invoice: {exc}"}

    claimed = await store.claim_charity_arrears(address)
    if not claimed:
        return {"success": True, "matches": 0, "amount_sats": 0,
                "note": "nothing is owed to the charity"}

    # Payout ids, because a match can owe the charity on two legs and only the
    # payout id tells them apart.
    ids = [str(c["payout_id"]) for c in claimed]
    matches = len({str(c["match_id"]) for c in claimed})
    total = sum(int(c["amount_sats"]) for c in claimed)
    if total != owed:
        # The books moved between the quote and the claim — a match settled in
        # the gap. Pay what was actually claimed, never what was quoted.
        try:
            bolt11 = await resolve_lightning_address(
                address, total, comment=f"The Bee's Knees — charity arrears for {charity['name']}"
            )
        except LnurlResolutionError as exc:
            await store.finish_charity_arrears(ids, state="failed", detail=str(exc)[:400])
            return {"success": False, "error_code": "address_unresolvable",
                    "error": f"{address} did not return an invoice for {total}: {exc}"}

    try:
        result = await client.pay_lightning_invoice(
            bolt11, max_fee_sats=treasury.fee_allowance(total),
            max_fee_percent=treasury.FEE_PERCENT,
        )
    except BTCPayError as exc:
        await store.finish_charity_arrears(ids, state="failed", detail=str(exc)[:400])
        return {"success": False, "error_code": "payment_failed", "error": str(exc),
                "matches": matches, "amount_sats": total}

    status = str(result.get("status") or "").lower()
    state = "paid" if status == "complete" else "sending"
    await store.finish_charity_arrears(
        ids, state=state, payment_hash=str(result.get("paymentHash") or ""),
        detail=status or "no status returned",
    )
    return {"success": True, "to": charity["name"], "matches": matches,
            "amount_sats": total, "state": state, "status": status,
            "payment_hash": str(result.get("paymentHash") or ""),
            "settled": state == "paid"}
