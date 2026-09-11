- **A till on the board, climbing as the round raises.** Every fare paid in a
  round lands in one pot and is split at the end — most of it to the
  pollinators, a tenth to the bee that reaches a queen first — and that was
  only ever visible afterwards, in the ledger. A player spending sats could
  watch the board move and never see the thing the spending was for. It sits in
  the right-hand gutter above the rival hives, which was empty space; the hint
  has the left column's foot, so the two end up diagonally opposite rather than
  stacked down one side.

- **The split is the service's, not the screen's.** `match_state` now returns
  the running pot already divided by `split_pot` — the same function that
  writes the settlement — so what climbs on screen and what is written into the
  books are one arithmetic. A frontend doing its own 80/10 would be a second
  opinion about money, and the rounding, which always falls to the charity
  rather than the operator, is exactly the part a reimplementation gets wrong.

- **It costs no extra query.** `match_state` is the hottest tool in the service
  — every player, about once a second — and it is `free` so it stays cheap. The
  pot rides the match row as a scalar subquery over the fares, so a poll that
  already fetches that row now carries the figure too.

- **Practice shows no till.** There is no money in a practice round, and a
  counter full of sats nobody paid is the fabricated figure this screen is
  careful never to show.

- The fake vault in `test_board_store` matched match rows on the literal prefix
  `SELECT * FROM bk_matches`, so adding one column to the select list stopped
  three branches matching at once. It now matches on the `WHERE` and computes
  `pot_sats` from its own fares — a fake that merely tolerated the new SQL would
  have passed while the pot read zero for ever.

- `split_pot(1000)` is **801/100/99**, not 800/100/100: the operator share is
  `int(1000 * (1.0 - 0.80 - 0.10))` and that subtraction is `0.0999…8` in binary
  floating point. The direction is the one the design asks for — rounding falls
  to the charity, never the operator — so the test asserts that invariant rather
  than three numbers, which would have pinned a bug that is not there.
