- **A first-timer is shown the way instead of being turned away.** Pressing the
  real game with no key opens a plain explanation: what a Lightning wallet is
  and why an ordinary bitcoin payment cannot carry a fraction of a penny, three
  wallets people commonly start with, what a Nostr key is and why you only make
  it once — then two buttons, "Make me a key" and "I already have one".
  `NpubGate` accepts `startFresh`, so somebody promised a key arrives with one
  rather than at an empty form.


- `deploy-modal.yml` — merging a change to the swarm now ships it. Nothing did.
  `modal_app.py` was pushed by hand four times on 2026-09-07, each from an
  uncommitted tree, and then main moved fifty commits; six of them touched the
  swarm, including the greeter. The lobby sat at 0/8 with the fix merged, green
  and inert, and the obvious reading was that the sim bees still wait for a
  human. They did — in the code that was RUNNING.

  Carries the scars of both siblings that already had this workflow: the runner's
  Python must match `debian_slim(python_version=)` or the resolve builds from
  sdist and dies; the PyPI wait polls the SIMPLE index, because the JSON API
  publishes ahead of what pip resolves from; and every command goes through
  `uv run`, because a bare `modal` is the runner's system interpreter — which is
  how optionality shipped eight days of "deployed" that never left the runner.
  It verifies the live version carries the commit, and treats Modal's "no changes
  detected" as the invariant holding rather than failing.

- The lobby says what the wait is FOR: the standings, the charity by name, what
  every pot has raised, and what is still owed to the charity and waiting to be
  paid. All of it lived on the ledger, one navigation away, and the lobby is the
  one screen somebody is certain to read all of because they cannot do anything
  else. `components/Standings.tsx` now holds the pieces and both screens render
  them.

- Your own bee wears its halo in the hive stack — the same breathing disc and
  ring the board draws around it, so the lobby is not teaching a mark the race
  will not use. The seat is exact: `seat` is the index within the hive and the
  column fills bottom-up. The hive LABEL was tinted before, which told you which
  column to look at and left you counting bees in it.

- Once a bee is seated: "You can leave this page while waiting but make sure to
  get back before the game begins." Said only when there is something to come
  back to.

- The reading pages end on the meadow. `Meadowscape` gains an `anchor`: pinned
  to the viewport for a page that is one card in a lot of sky (sign-in, the
  lobby), and in FLOW at the foot for a long read. The note that split the bees
  out of this file was right that "a hill under three screens of prose about
  colony loss would be scenery arguing with the argument" — pinned to the
  viewport it sits under the last third of every screenful for the whole
  scroll. At the foot it is not under the argument; it is where the argument
  stops, and you arrive at it.

  Mounted from `App` inside the scroller rather than by each page: these pages
  are a narrow reading column and the ground is not, and reaching full width
  from inside the column wants `100vw`, which overshoots the scroller by the
  width of its own scrollbar.
