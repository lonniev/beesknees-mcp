"""The solvency rule.

Pure arithmetic, deliberately: this is the gate between "the ledger says 800
sats are owed" and "800 sats have left the building", and it is the one piece
of this service that must be checkable without a node, a vault or a network.
"""

import json

from beesknees_mcp import treasury as t


def _ledger(sats: int) -> str:
    return json.dumps({"balance_api_sats": sats, "tranches": []})


def test_a_node_balance_is_not_the_operators_money() -> None:
    """Patrons pre-funded; most of what is on the node is still theirs.

    This is the whole point. A node holding 100,000 sats where patrons are
    owed 90,000 of it is an operator with 10,000 to spend, and an operator who
    reads the node balance as their own is spending deposits.
    """
    s = t.solvency(
        sendable_sats=100_000,
        ledgers=[("npub1a", _ledger(60_000)), ("npub1b", _ledger(30_000))],
        unpaid_obligations_sats=0,
    )
    assert s.patron_float_sats == 90_000
    assert s.payable_sats == 10_000

    ok, why = t.may_pay(s, 10_000)
    assert ok, why
    ok, why = t.may_pay(s, 10_001)
    assert not ok
    assert "patrons' unspent credit" in why


def test_money_already_owed_elsewhere_is_not_available_twice() -> None:
    """Two settled matches cannot both be paid out of the same sats.

    Without this, payouts are first-come-first-served and the last charity in
    the queue discovers the shortfall.
    """
    s = t.solvency(
        sendable_sats=50_000,
        ledgers=[("npub1a", _ledger(0))],
        unpaid_obligations_sats=45_000,
    )
    assert s.payable_sats == 5_000
    ok, _ = t.may_pay(s, 6_000)
    assert not ok


def test_an_unknown_balance_is_a_refusal_not_an_optimistic_yes() -> None:
    """The node being unreachable is not the same as the node being funded.

    `sendable_sats=None` is what a missing permission or a down node looks
    like. Treating it as anything but a refusal means the first real payout
    attempt happens blind.
    """
    s = t.solvency(sendable_sats=None, ledgers=[], unpaid_obligations_sats=0)
    assert not s.trustworthy
    assert s.payable_sats == 0
    ok, why = t.may_pay(s, 1)
    assert not ok
    assert "did not report a balance" in why


def test_one_unreadable_ledger_stops_everything() -> None:
    """A float that is a floor is not a figure, and you cannot spend against a floor.

    If four patrons' balances will not parse, the true float is larger than
    what was counted — so the payable figure is an OVERestimate, which is the
    dangerous direction.
    """
    s = t.solvency(
        sendable_sats=100_000,
        ledgers=[("npub1a", _ledger(1_000)), ("npub1b", "{not json")],
        unpaid_obligations_sats=0,
    )
    assert s.unreadable_ledgers == 1
    assert not s.trustworthy
    ok, why = t.may_pay(s, 10)
    assert not ok
    assert "unreadable" in why


def test_a_payment_must_also_be_able_to_afford_its_own_route() -> None:
    """A routing fee is charged ON TOP, so paying exactly the balance fails.

    Sending 10,000 sats out of exactly 10,000 leaves nothing for the fee, and
    the payment fails halfway through a settlement rather than before it.
    """
    s = t.solvency(
        sendable_sats=10_000,
        ledgers=[],
        unpaid_obligations_sats=0,
        about_to_pay_sats=10_000,
    )
    assert s.reserve_sats == t.fee_allowance(10_000) > 0
    ok, _ = t.may_pay(s, 10_000)
    assert not ok, "a payment that cannot pay its own fee must be refused"


def test_the_fee_reserve_has_a_floor_because_a_percentage_of_little_is_nothing() -> None:
    """2% of 50 sats is 1 sat, which routes nowhere. Base fees are per hop."""
    assert t.fee_allowance(50) == t.FEE_FLOOR_SATS
    assert t.fee_allowance(100_000) == 2_000


def test_a_ledger_of_tranches_is_read_when_there_is_no_running_total() -> None:
    """Somebody else's format, and it is money — so read it more than one way."""
    blob = json.dumps(
        {"tranches": [{"remaining_api_sats": 400}, {"remaining_api_sats": 350}]}
    )
    assert t.patron_float([("npub1a", blob)]) == 750
