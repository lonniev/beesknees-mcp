"""What the operator may actually pay out, and what it must not.

The pot is an accounting fiction until somebody sends sats. A match records
that 80% is owed to a charity and 10% to a winner, but those figures live in
this service's own tables; the sats live on a Lightning node, and the two have
never been compared. This module compares them.

── Why a node balance is not spendable money ──────────────────────────────

Patrons pre-fund by paying a Lightning invoice, so their sats really do arrive
at the operator's node. What they get back is CREDIT, which they can spend on
tool calls whenever they like. So at any moment the node holds:

    unspent patron credit    — other people's money, held on their behalf
    unpaid obligations       — charity shares and winners' shares already owed
    the operator's own share — earned, and the only part that is theirs

Paying a winner out of unspent patron credit is not generosity, it is spending
a deposit. So the payable figure subtracts the float and the outstanding
obligations before it says yes to anything:

    payable = sendable − patron_float − other_unpaid − fee_reserve

Every term is measured rather than assumed, and a term that cannot be measured
makes the answer `unknown` rather than optimistic. An operator told "you have
enough" on an unmeasured balance would find out at the worst moment.

── Fees ───────────────────────────────────────────────────────────────────

A routing fee is charged on top of the payment, so sending N sats costs more
than N. The reserve is deliberately generous: refusing a payout that would
have squeaked through costs a retry, and attempting one that cannot pay its
own fee costs a failure in the middle of settlement.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any

#: Share of a payment set aside for routing, on top of the payment itself.
#:
#: Lightning fees are typically far below this. It is the ceiling handed to
#: BTCPay as `maxFeePercent`, so it is also the most a route is allowed to
#: cost — a payout that could only be routed at 5% is one the operator should
#: look at rather than one this should quietly pay.
FEE_PERCENT = 2.0

#: A floor under the fee reserve, because a percentage of a small payout is
#: not enough to route it. A few sats of base fee per hop is normal.
FEE_FLOOR_SATS = 12


def fee_allowance(amount_sats: int) -> int:
    """The most a payment of this size may cost to route, on top of itself."""
    return max(FEE_FLOOR_SATS, math.ceil(amount_sats * FEE_PERCENT / 100))


def patron_float(ledgers: list[tuple[str, str]]) -> int:
    """Everybody's unspent credit, in sats.

    Takes the vault's own `(npub, ledger_json)` rows. A ledger that will not
    parse is counted as zero and NOT skipped silently by the caller — see
    `solvency`, which reports how many were unreadable, because "we could not
    read four patrons' balances" is a reason to refuse a payout rather than a
    detail to round away.
    """
    total = 0
    for _npub, blob in ledgers:
        total += _unspent(blob)
    return total


def unreadable_ledgers(ledgers: list[tuple[str, str]]) -> int:
    """How many ledgers could not be understood. Any at all means the float is a
    floor rather than a figure, and a floor is not something to spend against."""
    bad = 0
    for _npub, blob in ledgers:
        try:
            _parse(blob)
        except (ValueError, TypeError):
            bad += 1
    return bad


def _parse(blob: str) -> dict[str, Any]:
    data = json.loads(blob) if isinstance(blob, str) else blob
    if not isinstance(data, dict):
        raise TypeError("a ledger is an object")
    return data


def _unspent(blob: str) -> int:
    """One patron's remaining credit.

    The ledger is the SDK's own `UserLedger.to_json()`: tranches, each with an
    amount and a spent count. Read defensively — this is somebody else's
    format, and it is money.
    """
    try:
        data = _parse(blob)
    except (ValueError, TypeError):
        return 0

    # The SDK keeps a running figure; prefer it, and fall back to the tranches
    # it was computed from rather than guessing zero.
    for key in ("balance_api_sats", "balance", "remaining_api_sats"):
        v = data.get(key)
        if isinstance(v, (int, float)):
            return max(0, int(v))

    total = 0
    for t in data.get("tranches", []) or []:
        if not isinstance(t, dict):
            continue
        amount = t.get("remaining_api_sats", t.get("amount_api_sats", t.get("amount", 0)))
        if isinstance(amount, (int, float)):
            total += max(0, int(amount))
    return total


@dataclass(frozen=True)
class Solvency:
    """What the operator can pay right now, and why it is not more than that."""

    sendable_sats: int
    patron_float_sats: int
    unpaid_obligations_sats: int
    reserve_sats: int
    payable_sats: int
    unreadable_ledgers: int
    #: False when any input was missing or unreadable. A payout must refuse.
    trustworthy: bool
    note: str


def solvency(
    *,
    sendable_sats: int | None,
    ledgers: list[tuple[str, str]] | None,
    unpaid_obligations_sats: int,
    about_to_pay_sats: int = 0,
) -> Solvency:
    """Whether there is honestly enough, with the arithmetic shown.

    `sendable_sats` is None when the node could not be reached or the API key
    lacks permission to ask. That is NOT zero and it is not "probably fine": it
    is an unknown, and an unknown balance is a refusal.

    `about_to_pay_sats` is excluded from `unpaid_obligations_sats` by the
    caller — the payment being considered is not also a reason to refuse
    itself — and its own fee reserve is added on top.
    """
    if sendable_sats is None:
        return Solvency(
            sendable_sats=0,
            patron_float_sats=0,
            unpaid_obligations_sats=unpaid_obligations_sats,
            reserve_sats=0,
            payable_sats=0,
            unreadable_ledgers=0,
            trustworthy=False,
            note="the node did not report a balance, so nothing may be paid",
        )

    if ledgers is None:
        return Solvency(
            sendable_sats=sendable_sats,
            patron_float_sats=0,
            unpaid_obligations_sats=unpaid_obligations_sats,
            reserve_sats=0,
            payable_sats=0,
            unreadable_ledgers=0,
            trustworthy=False,
            note="patron balances could not be read, so the float is unknown",
        )

    bad = unreadable_ledgers(ledgers)
    held = patron_float(ledgers)
    reserve = fee_allowance(about_to_pay_sats) if about_to_pay_sats else 0
    payable = sendable_sats - held - unpaid_obligations_sats - reserve

    note = "clear"
    if bad:
        note = f"{bad} patron ledger(s) unreadable, so the float is a floor, not a figure"
    elif payable < 0:
        note = "obligations exceed what the node can send"

    return Solvency(
        sendable_sats=sendable_sats,
        patron_float_sats=held,
        unpaid_obligations_sats=unpaid_obligations_sats,
        reserve_sats=reserve,
        payable_sats=max(0, payable),
        unreadable_ledgers=bad,
        trustworthy=bad == 0,
        note=note,
    )


def may_pay(s: Solvency, amount_sats: int) -> tuple[bool, str]:
    """The gate. One place, so no caller can decide it differently."""
    if amount_sats <= 0:
        return False, "there is nothing to pay"
    if not s.trustworthy:
        return False, s.note
    if s.payable_sats < amount_sats:
        return False, (
            f"the node can send {s.sendable_sats} sats but {s.patron_float_sats} of that is "
            f"patrons' unspent credit and {s.unpaid_obligations_sats} is already owed "
            f"elsewhere, leaving {s.payable_sats} — short of {amount_sats}"
        )
    return True, "clear"
