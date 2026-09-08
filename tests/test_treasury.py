"""The payout gate.

One comparison, kept pure so it can be checked without a node or a network:
can the wallet cover this payment and the fee it will cost to route.
"""

from beesknees_mcp import treasury as t


def test_a_payment_must_also_afford_its_own_route() -> None:
    """A routing fee is charged ON TOP, so paying exactly the balance fails.

    Sending 10,000 out of exactly 10,000 leaves nothing for the fee, and the
    payment then fails partway through a settlement rather than before it.
    """
    w = t.Wallet(sendable_sats=10_000, owed_sats=0)
    ok, why = t.may_pay(w, 10_000)
    assert not ok
    assert "routing" in why

    ok, _ = t.may_pay(t.Wallet(10_000 + t.fee_allowance(10_000), 0), 10_000)
    assert ok


def test_an_unknown_balance_is_a_refusal_not_an_optimistic_yes() -> None:
    """`None` is an unreachable node or a key without permission to ask.

    It is not zero and it is not "probably fine". Treating it as anything but a
    refusal means the first real payout happens blind.
    """
    ok, why = t.may_pay(t.Wallet(sendable_sats=None, owed_sats=0), 100)
    assert not ok
    assert "did not report a balance" in why


def test_owing_more_elsewhere_does_not_block_this_payment() -> None:
    """Reported, not enforced.

    If two charities are owed and the wallet covers one, refusing to pay either
    helps neither. The operator sees the shortfall via `covers_everything_owed`.
    """
    ok, _ = t.may_pay(t.Wallet(sendable_sats=50_000, owed_sats=900_000), 1_000)
    assert ok


def test_nothing_is_not_a_payment() -> None:
    ok, why = t.may_pay(t.Wallet(50_000, 0), 0)
    assert not ok
    assert "nothing to pay" in why


def test_the_fee_reserve_has_a_floor_because_a_percentage_of_little_is_nothing() -> None:
    """2% of 50 sats is 1 sat, which routes nowhere. Base fees are per hop."""
    assert t.fee_allowance(50) == t.FEE_FLOOR_SATS
    assert t.fee_allowance(100_000) == 2_000
