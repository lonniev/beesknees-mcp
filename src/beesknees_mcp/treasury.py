"""Can the operator actually send this?

One comparison. The wallet's spendable balance against the payment plus what it
will cost to route.

── What this deliberately does NOT do ──────────────────────────────────────

An earlier version totalled every patron's unspent credit, to work out how much
of the node balance was the operator's own money rather than deposits held on
somebody's behalf. That was the wrong instrument for three reasons, and they are
worth writing down so it does not come back:

  * The balance it subtracted from is not ours to apportion. The Lightning
    endpoint reports the NODE's balance, and on a BTCPay instance the internal
    node is shared by every store on it. Subtracting one service's float from
    every service's balance is not a quantity.

  * The pot is already known exactly. Every priced move writes a fare row, so
    the pool is an accumulator that has been running all along — there is
    nothing to reconstruct by subtraction.

  * It read 123 patrons' encrypted ledgers to answer a question about the
    operator's own wallet, and got slower with every patron who ever played.

The obligations figure is still reported, because an operator ought to see that
they owe more than they hold. It does not gate a single payment: refusing to pay
one charity because a second is also owed helps neither of them.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

#: Share of a payment set aside for routing, on top of the payment itself.
#:
#: Also handed to BTCPay as `maxFeePercent`, so it is the most a route may cost.
#: A payout only routable at 5% is one the operator should look at rather than
#: one this should quietly pay.
FEE_PERCENT = 2.0

#: A floor under the reserve, because a percentage of a small payout will not
#: route it — base fees are per hop and do not scale down.
FEE_FLOOR_SATS = 12


def fee_allowance(amount_sats: int) -> int:
    """The most a payment of this size may cost to route, on top of itself."""
    return max(FEE_FLOOR_SATS, math.ceil(amount_sats * FEE_PERCENT / 100))


@dataclass(frozen=True)
class Wallet:
    """What the wallet holds, and what is owed out of it."""

    #: None when the node could not be asked. NOT zero — see `may_pay`.
    sendable_sats: int | None
    owed_sats: int


def may_pay(w: Wallet, amount_sats: int) -> tuple[bool, str]:
    """The gate. One place, so no caller can decide it differently.

    An unknown balance is a refusal. A node that could not be reached, or an API
    key without permission to ask, is not the same as a funded one, and the
    difference matters most at exactly the moment somebody is about to send.
    """
    if amount_sats <= 0:
        return False, "there is nothing to pay"
    if w.sendable_sats is None:
        return False, "the node did not report a balance, so nothing may be sent"

    needed = amount_sats + fee_allowance(amount_sats)
    if w.sendable_sats < needed:
        return False, (
            f"the wallet can send {w.sendable_sats} sats and this needs {needed} "
            f"({amount_sats} plus routing)"
        )
    return True, "clear"
