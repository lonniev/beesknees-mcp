- An empty lobby gets one sim bee straight away. The first visitor to a room of
  eight empty combs is being asked to start something and almost nobody wants to
  lead — they will happily be the second. The swarm's rule was
  `if not seated: return 0  # nobody is waiting, so nobody needs company`, which
  is the right instinct and left the one room that most needs company empty.

- **A room holding sims and no people is not filled out.** This is the half that
  makes the greeter safe: a greeter reads exactly like a bee waiting, so without
  it the swarm would fill the board around one and run a match of forty bots and
  no players. `seats_wanted` is now a pure function of the board — the policy was
  previously reachable only by minting keys and joining a live match, and
  `tests/test_sim_swarm.py` holds it.

- The swarm's patience clock measures how long a PERSON has waited. The server's
  `waiting_s` is the age of the longest-seated bee, which after a greeter is the
  greeter — a figure with nothing to do with anybody's patience. It is still used
  when every bee in the room is a person, which is what it was added for.
