"""The winner gets to see they won.

A player reported that winning a round dropped them straight into the next
lobby — no coronation, no tableau, no button back to the queue. All three were
built. `match_state` was handing them the next forming match instead of their
own finished one.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from beesknees_mcp.server import RESULT_LINGER_S, still_yours

NOW = datetime(2026, 9, 9, 3, 0, 0, tzinfo=UTC)


def match(state: str, **stamps) -> dict:
    return {"match_id": "m1", "state": state, **stamps}


def test_a_settled_round_is_still_the_players_round():
    """THE BUG. `advance` sets `ended` and calls `settle` one statement later,
    so no client ever polls fast enough to see `ended` — a match is running, and
    then for the rest of its life it is `settled`. The old whitelist accepted
    `running` and `ended` only, threw the settled round away, and fell through
    to the freshly opened forming match, which `LiveBoard` renders as a lobby."""
    just_won = match("settled", ended_at=NOW - timedelta(seconds=2),
                     settled_at=NOW - timedelta(seconds=2))
    assert still_yours(just_won, NOW) is True


def test_the_round_is_let_go_once_it_has_been_read():
    old = match("settled", ended_at=NOW - timedelta(seconds=RESULT_LINGER_S + 1))
    assert still_yours(old, NOW) is False


def test_the_linger_is_measured_from_the_end_not_the_settlement():
    """Settlement can lag the finish — a prize resolves, a payout is attempted.
    The player's clock started when the race did, so `ended_at` wins."""
    m = match(
        "settled",
        ended_at=NOW - timedelta(seconds=RESULT_LINGER_S + 30),
        settled_at=NOW - timedelta(seconds=1),
    )
    assert still_yours(m, NOW) is False, "a settlement stamp revived a stale result"


def test_an_abandoned_round_falls_back_to_when_it_settled():
    """`settle_abandoned` never sets `ended_at`. Without the fallback the player
    is dropped into the lobby with no word about the round they were in."""
    m = match("settled", settled_at=NOW - timedelta(seconds=5))
    assert still_yours(m, NOW) is True


def test_a_finished_round_with_no_stamp_at_all_is_not_held_for_ever():
    """The safe direction. An unbounded linger pins a player to a result they
    have already read, with no way back to a queue."""
    assert still_yours(match("settled"), NOW) is False
    assert still_yours(match("ended"), NOW) is False


def test_a_running_round_needs_no_stamp():
    assert still_yours(match("running"), NOW) is True


@pytest.mark.parametrize("state", ["forming", "abandoned", ""])
def test_nothing_else_takes_over_the_screen(state):
    # `forming` especially: that is the NEXT match, and answering with it is
    # exactly what put the winner in a lobby.
    assert still_yours(match(state, ended_at=NOW), NOW) is False


def test_no_match_is_not_a_match():
    assert still_yours(None, NOW) is False


def test_a_junk_timestamp_does_not_take_the_tool_down():
    # Neon hands timestamps back as strings over HTTP, and this runs inside the
    # one tool every client polls on a loop.
    assert still_yours(match("settled", ended_at="not a date"), NOW) is False
