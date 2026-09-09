- Wallet of Satoshi leads the wallet list in the first-timer explainer, on the
  operator's own experience of it: it is the one with the least to understand
  before it works. Cash App comes off — it filled the same "easiest" slot, and
  three of a kind is not a list. Phoenix and Blue Wallet stay for the reader who
  decides they would rather hold their own keys. The note now says the list is
  easiest-first and that availability differs by country.

- A new preview card: a round in progress rather than an empty board — tunnels
  cut, a drone at a door, all five hives, and the action button. The alt text
  on both the `og:` and `twitter:` tags describes what is actually in it now.

- The ledger is titled "Funds Raised and Charity Payouts", which says what it
  is rather than gesturing at it.
- **`settlement_history` is paged and sorted by the server** — `page`,
  `page_size`, `sort_col`, `sort_dir`, and a `total` in the reply, on the same
  convention the rest of the fleet uses. This is the one table that grows
  without bound: a row per settled match, kept when everything else about the
  match is purged. The browser used to be sent the lot and cut it up itself.
- Every settled match shows the time of day, in the reader's own timezone. A
  date alone puts a match on a day and no closer, which is no use on a page
  whose job is to be checkable against somebody else's records.
- Sats now carry their dollars, to the penny and no finer, with the rate they
  were figured at stated on the page. The quote is fetched by the BROWSER from
  Coinbase's public spot endpoint — a new external dependency, and deliberately
  not on the service, because a third-party price feed must never sit in front
  of a Lightning node. No quote means no dollars rather than an invented rate.


- "Buy a bee and take a seat" is **"Fund a Bee"**.

- The lobby has ground under it and bees over it. It is the longest wait in the
  app — you sit there until forty bees have a seat — and it was the one screen
  with no life on it, while the sign-in card, a five-second stop, had the drawn
  meadow. Neither piece is new: `Meadowscape` shipped mounted on sign-in and
  nowhere else, and the foragers were kept off this screen by a guard on the
  PATH `/play`, which the lobby shares with the board that guard was written
  for. A lobby is not a board — `LiveBoard` renders either one or the other —
  so a forager here can never be a bee the rules know nothing about.


- The bees on the non-board pages are the **live foragers from the playfield**,
  not static SVGs on a CSS keyframe. The drifting pair were four copies of one
  arc repeating for ever; these steer, accelerate and work a patch, and the
  life on a reading page is now the same code as the life on the board rather
  than a second thing that would come to differ from it. They are on every page
  except `/play`, which runs the same foragers inside its own playfield where
  the hives paint over them — a second layer there would put loose bees beside
  the board with no such guarantee.
- `Meadow` handles a screen with no hives at all: with nowhere to come home to
  a bee wanders patch to patch rather than commuting, and it keeps out of the
  reading column. Returning to `{0.5, 0.5}`, which is what it used to do with
  no hives, sent every bee to the dead centre — the one place the words are.

- The racer is a **drone**, not a worker. Worker bees are female and never
  mate; drones are male and reaching the queen is the whole of what they are
  for — which is the game that was already built, coronation and all. One word
  fixes both the story and the biology, where "male worker bee" would have put
  a plainly false claim in the first paragraph of the page that argues for
  pollinator charity by being accurate about bees.

- The welcome page reads the operator's configured beneficiary rather than
  naming one in the markup. It hardcoded "Pollinator Partnership" while the
  service was in fact paying the Vermont Beekeepers Association, so the page
  argued for one charity and the ledger paid another.
- The meta and social descriptions were the old opening sentence; they now say
  what a stranger seeing the link would need to know.
- The route check for `/` asserted only that the page carried the site's name,
  which renders whether or not the page explains itself. It now requires the
  introduction to actually be there.

- The About page now leads with **how the game is played** — a narrative of the
  three acts, the wall and its doors, the funnel, and the one real choice
  between cutting your own shaft and riding somebody else's — and only then
  turns to the technology.
- **"How we know it is a game"**: the measurements behind the design, including
  the two rules that exist only because a batch of four hundred rounds demanded
  them (a cuttable wall that 80% of bees chopped through, and a doorway 52.6%
  of 1,218 crossings bounced back out of), and why five hives of twelve rather
  than one of sixty.
- **"What it raises"** states the money honestly: what is proven (the pot holds
  what was charged, the shares sum exactly, a refund returns the fare taken)
  and what is arithmetic still waiting on a price and on attendance. It does
  not claim to be profitable.
- A seeded playability guard runs with the tests (`game/playable.test.ts`). It
  does not pin today's win rate — that would fail on any honest tuning — but it
  fails if judgement stops beating a heuristic, or if a bee moving at random
  starts winning. The About page's claim that the rules are still measured is
  now true in the present tense.
