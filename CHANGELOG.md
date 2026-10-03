# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Released versions appear below. **Unreleased changes live in `changelog.d/`,
one file per change** — see the README there for why, and
`scripts/changelog.py` for what folds them in at release time.

## [0.3.0] — 2026-10-03

### Added

- **The wedding, on the board.** The end of a race was two rings and some
  flecks over the hive, then a card. Now the queen rises from her chamber,
  crowned and bigger than any bee; the consort comes to her flank wearing his
  (and your halo rides with him when it is you); the two fly a royal circuit out
  to the wall and back, trailing gold and petals, with the hive falling in behind
  in train; the comb dims to a spotlight as they retire, the court settles in a
  ring around them, and the brood is laid cell by cell in the two rings around
  the chamber. Yours gets a lap and a half in gold; a rival's one lap in red.
  Reduced motion goes straight to the final tableau. The card that follows
  keeps the words and Play Again; its small tableau is gone, the board has it.

## [0.2.1] — 2026-10-03

### Fixed

- **A bee behind a rival no longer dances forward and back.** Your route was
  planned with other bees as walls, so a rival stepping into the next cell
  flipped the whole shortest way to a detour — often outward — and their
  stepping out flipped it back, a fare paid each way; under cruise control that
  was a bee pacing between two cells. A body is now a jam with a price (the
  wait it usually is): a short one is waited out, which costs you nothing, and
  a long one is gone round. A step must get strictly nearer or the bee stands
  still, and the drawn route starts with the step the bee will actually take.

## [0.2.0] — 2026-10-03

### Added

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

- **Cruise control.** A third cell in the tactic tray, offered once your bee is
  inside the hive: with it on, the bee takes each move toward your aim the
  moment it is ready — cuts included — and on the real board pays for each as
  it goes. It never chooses an aim: reach it, lose it, or have nothing that
  gets you closer, and it simply waits for your next tap. It switches itself
  off when continuing would be wrong — the round over, a refusal, an empty
  balance, or two lost races in a row — and never acts twice on one read of the
  board. Off on every new round.
- Both boards now drop an aim the moment the bee stands on it (the hint used to
  say "Held up" over a bee exactly where it was sent), and the live board drops
  it on a phase change as the practice board always has.

- **The focused hive is drawn in WebGL.** Bees are painted sprites, seen from
  above, that fly between cells along the shaft they actually used rather than
  appearing in the next one; pollen trails a bee carrying it home; a dig throws
  comb and a seal caps the cell in wax; the wall glows red once anyone is
  within three rings of the queen; flowers sway, and fade to lavender once
  emptied. The SVG board stays underneath as the first paint and the fallback —
  no WebGL, or a context lost to memory pressure, and the game carries on
  exactly as before. Thumbnails stay SVG, so a phone holds one WebGL context.
  PixiJS loads only when a board mounts; the pages of prose pay nothing for it.
- **One painted bee for the whole site.** The foragers drifting over the page
  are the same bee as the racers on the board, from the same painter — the 🐝
  glyph was a different insect on every platform.

- **The prose is in the response body now.** A fetcher — a crawler, a link
  preview, an AI agent — gets one HTTP GET and runs no JavaScript, so from a
  single-page app it received `<div id="root">` and a script tag. Everything a
  program could say about this site came from the `<head>`; the whole Why
  argument, which is the reason the game exists, was invisible to every reader
  that does not hydrate.

  The fix was nearly free, because the app was already being server-rendered on
  every build. `scripts/routes.mjs` renders each route through Vite's SSR
  loader to prove the page is not blank, then discarded 29KB of good HTML.
  `scripts/prerender.mjs` stops discarding it: `/` and `/about` are written into
  the build as real pages, and `main.tsx` mounts with `createRoot`, which clears
  the container — so there is no hydration contract to honour and no mismatch to
  chase.

- **`beesknees_guide` (free) returns the agent guide through the MCP door**, so
  an agent that arrives by tool call does not have to fetch the website to find
  out where it is. Free deliberately: it is the document that says what
  everything else costs, and a price on it is a toll on the price list.

- **`llms.txt` exists once.** It moved from `frontend/public/` into the Python
  package, where it has to be anyway to ship inside the wheel, and the frontend
  build copies it into the output — so the site still serves it at the same URL
  and the two publications cannot drift into two documents.

- **`/ledger` and `/play` are deliberately NOT prerendered.** The ledger is
  money: what has been raised, and what has reached the charity. A build-time
  snapshot would serve figures that were true at deploy as though they were
  true now, which is worse than serving none. Those routes keep the SPA
  fallback and llms.txt points an agent at `beesknees_settlement_history`,
  which is free and current.

- **`/about` is served as `about.html`, not `about/index.html`.** Given a
  directory, Pages answers a bare `/about` with **308 → /about/** — and the
  sitemap, the nav and every link on the site say `/about`, so the directory
  form would have made the advertised URL a redirect to a different one.
  Measured against `wrangler pages dev`, not assumed.

- **The SPA fallback stays pointed at `/index.html`.** Pages special-cases
  exactly that path as the single-page-app fallback, applied only when no asset
  matches. Pointed at any other `.html`, the rule stops being a fallback: in the
  local Pages emulation `/* /app.html 200` answered `/`, `/about`, `/robots.txt`
  and `/llms.txt` alike with a 308, and `/* /app 200` served all four the same
  shell. Either would have handed a crawler HTML where it asked for robots.txt —
  the exact bug the robots.txt file was added to fix. A test holds the rule.

### Changed

- Wallet of Satoshi leads the wallet list in the first-timer explainer, on the
  operator's own experience of it: it is the one with the least to understand
  before it works. Cash App comes off — it filled the same "easiest" slot, and
  three of a kind is not a list. Phoenix and Blue Wallet stay for the reader who
  decides they would rather hold their own keys. The note now says the list is
  easiest-first and that availability differs by country.
- **"How it is played" shows the board's own marks in the sentences that name
  them** (`components/Marks.tsx`): fly, crawl and mound; a flower with pollen
  and one already plucked; a bee, the queen on her chamber, and your own bee in
  its halo; and a doorway drawn as what it actually is — a break in the wall
  with the mouth filling it. Every mark is the mark the board draws, in the
  colours it draws it, because a picture in the instructions that is merely
  LIKE the thing on screen teaches somebody to look for something that is not
  there.
- The same section now says how to move at all: you tap where the bee should
  end up, the board plans the best route it can and draws it as a dotted line,
  and each press takes one step along it — with the caution that the route is
  the best one through what is there at that moment rather than a promise.
- In-game hints are bold, and the two that name something on the board carry
  it: the flower with pollen, and the doorway.

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

- **A round is named, not numbered.** Every match id was
  `secrets.token_urlsafe(9)` — `xQ7f-2bKpLm9` — and that string is what the
  ledger printed, what a tool response carried, and what an agent had to pass
  back into `join_match`. Ids are now three words, the way a
  `tollbooth-shortlinks` slug is: `swift-otter-digs`. The name IS the id, not a
  display column beside one, because two names for one round is two things to
  keep in step.

- **The ledger's Match column reads as words.** It was monospaced because the
  old ids were runs of characters somebody had to compare by eye; it is set in
  the page's own face now. The string is unchanged from the one a tool call
  takes, so it still pastes.

- **An insert that loses the name is believed.** Three words out of these lists
  is about half a million rounds rather than 2**72 — plenty for a name nobody
  has to keep secret, and far too few to insert and walk away from. `open_match`
  inserts `ON CONFLICT DO NOTHING RETURNING` and draws again, five times before
  it gives up, which is the same fence every other write in `board_store` has.
  The fake vault honours the conflict now; one that always claimed to have
  inserted would have passed while two rounds shared a board.

- Matches settled before this keep the ids they were played under. The ledger
  shows what actually happened, and rewriting the column would make it show
  something else.

- **`Play!` leads the bar, and `/` opens on the game.** A visitor who came to
  play had to cross three questions to reach it. The first tab and the bare
  domain are now the same door, and an unknown path lands there too.

- **The Why page moved to `/why`, and that is the load-bearing half.** It had no
  URL of its own — it was simply what `/` rendered. Letting Play take the root
  without giving it one would have deleted the pollinator argument from the
  readable web: a fetcher runs no JavaScript and follows only links it has been
  shown, so a page that exists solely as a router rotation cannot be crawled,
  cited or listed. `/why` is prerendered, in `sitemap.xml`, and named in
  `llms.txt`. `/play` is kept alongside `/` because it is in the sitemap, in the
  guide, and in links already sent.

- A probe pattern carrying a literal apostrophe matches nothing in
  server-rendered markup — React escapes it to `&#x27;` — so a page that
  rendered perfectly reads as a failure. Both route probes now spell it either
  way, and say why.

- **Unreleased entries live in `changelog.d/`, one file per change.**
  `CHANGELOG.md` was the most conflict-prone file in the repository, and not
  through carelessness: every PR appended to the same `### Added` / `### Fixed`
  anchors of the same `## [Unreleased]` section, so any two concurrent PRs
  collided there even when their code touched nothing in common. Six did in one
  day. `scripts/changelog.py fold X.Y.Z` gathers the fragments into a dated
  section at release, in Keep a Changelog order, and deletes them.

- **One bee for the whole site.** The bee, the daisy and the crown are described
  once as shapes (`frontend/src/art/`) and drawn from there everywhere: as
  textures on the WebGL board, as the foragers over the page, and as SVG marks
  in the nav, the scoreboard, the thumbnails, the lobby's seats, the result
  card, the coronation and the sentences on About. The platform's 🐝 — a
  different insect on every device — is gone from the site.
- **The controls in wax.** The tactics sit in a sunk tray with the chosen one
  raised in purple; the action button is lime wax with the rest rising across it
  as the wait runs down, and the verb that caused the wait rides the label.
  Not one hue changed — lime is still you acting now, purple the standing
  tactic, wax money and celebration — and every text-on-material pair measures
  above 4.5:1. Both boards read their verbs and their button words from one
  source, with a test holding the words still.
- The seal verb is "Fill" on About as it is on the button. Stray amber and red
  utility colours in Winnings, the lobby and the session strip are the page's
  own tokens now.

- **The Play page opens by saying what the site is.** It opened with "The same
  board either way", which compares two things the reader has not been told
  about yet — a sentence written for somebody who already knows the game. The
  code owner's replacement names the site, then the two doors, then what
  Practice costs, which is the order a first-time visitor needs it in.

- **Both doors wear the same border.** The real game had a coloured rim and
  Practice a grey one, which reads as a recommendation — and these are two
  doors, not a default and an alternative. The icon still carries the colour,
  and the dimming when a live round is out of reach still carries the state; a
  border is a poor place for either.

- **The move hint names the button rather than the gesture.** "Press to crawl
  the line" described the input while the button said "Crawl!", leaving the
  reader to match a sentence about pressing to a word that was not on it. It
  now reads "Crawl! to follow the path" — and "Fly! to follow the path" out in
  the meadow.

- The Practice card says what a visitor **gets**, not what the board contains.
  "Eleven bots, no sats, nothing at stake" led with a fact about the simulation
  and then named two absences — and an absence is a poor pitch for the door a
  first-time visitor should actually go through. It now reads "Watch and learn
  how to play without having to purchase anything. Come practice anytime."

- **The Profile page is `AccountPage` from `@tollbooth-dpyc/web` 1.5.0.** The
  package draws the Nostr profile, session key, last 30 days and time zone in
  the fleet's one order; the hive's own panels sit where they did — Balance
  after the session key, "If you win" after the month, the signing note and
  Sign out last. It looks the same: every class is still the hive's.

- **Refresh is the package's `RefreshButton`** on the Balance card and the
  operator's books. It spins while the read runs and cannot start a second one.

- **The front end is on `@tollbooth-dpyc/web` 1.2.0.** The Ledger's sort
  headers and paging are the package's `SortHeader` / `PageControls` in this
  site's classes (paging now reads First / Prev / Page N of M / Next / Last);
  the Profile top-up runs on `useTopUp`, so an open invoice settles on its own
  without "I've paid"; the operator gate asks `listCanonicalIdentities`; the
  lapsed-session strip's Dismiss clears the notice (`dismissNotice`) instead of
  re-reading the session. The site's colour overrides also cover the package's
  new `:root[data-theme="dark"]` block, so the app stays light.

### Removed

- `Sprigs` — ten emoji in the margins, which existed for the same stated reason
  the meadow does ("a wait on an empty screen reads as a page that failed to
  load"). Two answers to one question, in two vocabularies, on the same screen.
  The drawn one stays.

- The drifting bees fly over the reading pages too — the welcome, About and the
  ledger. Split out of `Meadowscape` as `DriftingBees`, so a page can have the
  life without the landscape: a hill under three screens of prose about colony
  loss would be scenery arguing with the argument. Hidden below `lg`, because
  the bees fly at 8% and 90% of the viewport — margin on a wide screen, and the
  middle of a sentence where the reading column is the whole width.

- A meadow behind the sign-in screen (`components/Meadowscape.tsx`). One card
  in the middle of a very large lavender field read as a page that had failed
  to load rather than a page that was calm. Rolling ground, grass in tufts,
  clover and dandelion, and four bees drifting in the margins — drawn as SVG
  paths, so it is as sharp on a 3x tablet as on a laptop and costs one request
  rather than an asset set per density. It takes no taps, holds no text, keeps
  clear of the reading column, and stops moving under
  `prefers-reduced-motion`.
- Scenery greens as tokens (`--color-far`, `--color-mid`, `--color-near`,
  `--color-stem`). The first attempt reused `--color-meadow`, which is #584461
  — the dusty violet the BOARD paints its open ground with, and a purple hill
  anywhere a landscape is meant.

- The welcome page now starts from nothing. It opened with "A race to the
  queen. Most of what a round collects goes to pollinator conservation." —
  two sentences that both assume a game the reader has not been told about
  yet. The introduction is the code owner's own, in his words: what the game
  is, what a move costs, where the pot goes, and a pointer to About for
  strategy and technology.

### Fixed

- The real-game card no longer refuses a stranger with "Sign in with an npub to
  buy a bee" — a word the visitor has not met, refusing them something they have
  not been told the shape of. It is also the FIRST wall: the lobby's Fund a Bee
  button, where this explanation was asked for, sits behind it and a signed-out
  visitor never reaches it at all. An empty balance keeps its plain refusal;
  that person already knows what a bee costs.

- `robots.txt` and `sitemap.xml`. Both existed only as a 200 of the app's own
  index.html — the SPA fallback in `_redirects` answers every unknown path with
  the page — so a crawler asking for robots.txt was handed HTML and a success
  code, which is worse than a 404 because a 404 is a plain answer.

- Structured data (schema.org `WebApplication`), so a reader that parses rather
  than reads knows what this is. It deliberately carries **no beneficiary name
  and no fare**: both are the operator's to change at runtime, and a figure
  baked into a static file goes on being served long after it stops being true.
  `beesknees_charity` and `beesknees_get_pricing_model` are the live answers.


- The Play chooser gets the meadow and the wandering bees. `/play` was excluded
  from the app-wide scenery to keep loose bees away from a board — but the route
  is a CHOICE before it is a board, two cards and a lot of empty meadow, so the
  exclusion left the one screen that most looks like it wants scenery without
  any. The page mounts its own while it is a chooser, which is the component
  that actually knows; the route stays excluded so the two cannot double up, and
  a board still gets nothing but the foragers inside its own playfield.

- The X card is stated rather than inferred. `summary_large_image` was declared
  with no `twitter:image`, `twitter:title` or `twitter:description`, relying on
  X falling back to the `og:` namespace — which works until it does not, and a
  card that degrades to a bare link is invisible in the one place this game is
  meant to spread. Also `og:image:type` and the iOS status-bar style, both of
  which the sibling site had and this one did not.


- "Raised across all matches" is a server-side sum over the whole table. It was
  totalled in the browser from the rows it happened to have — correct while
  that was all of them, false the moment the ledger was paged, and already
  wrong for anybody past the fiftieth settled match.
- `claim_prize` reads its settlement by id instead of scanning a 200-row page
  for it. That is the same fault `settlement_of` was written to fix on the
  payout path: a match older than the page is one the page cannot see, and its
  winner was told the prize was not theirs.

- The controls are exactly as wide as the hive above them, and centred on the
  same axis: "Tactic?" begins where the meadow begins and the action button
  ends where it ends. The row spanned the whole window, which on a tablet put
  the button out at the far right with a third of the screen between it and the
  board it acts on — the eye had to leave the game to find the verb. Measured
  rather than derived, because the drawn hive is `min(width, height)` of a box
  whose height nothing in CSS can tell the row about.
- The hint has two homes and is never in both. Wide: the empty gutter under the
  last rival tile. Narrow: **below** the controls, because a short screen has to
  cut something and the order down the page should be the order of what can be
  spared — the board, then the thing you press, then a sentence you can play
  without.

- The tactic toggle is no longer the action button's colour. Both were
  `--color-you` lime, so a standing choice and a thing-you-do-now read as one
  control in two halves. The tactic is purple (`--color-tactic`), the two groups
  are prefixed **Tactic?** and **Now?**, and a flexible gap separates them
  instead of leaving them shoulder to shoulder.

- The nav reads **Why? · About? · Ledger · Play!** left to right, each with a
  Material Design glyph, spread evenly across the bar rather than huddled at the
  right-hand end. Three of them ask something; `Play!` is the only imperative.
  Below `sm` the words drop and the icons carry the bar — five labelled
  destinations plus a wordmark do not fit 390px, and the bar is the one thing on
  the board screen that must not steal height from the board. Every tab keeps
  its `title` and `aria-label`, because a help circle and an info circle are a
  poor pair to tell apart at 18px.


- "Queue for the next round" works. It called `refresh`, and a finished round
  answers its own players for three minutes so the result can be read — so the
  refresh fetched the very round the button exists to escape, and the button
  read as frozen. `match_state` takes `next_round`, which is how a client says
  it has read the result; `useLiveMatch.leave` keeps sending it until a
  DIFFERENT match answers, because one poll is not enough when the lobby handed
  over is still forming.


- The greeter gives up its seat when a person arrives. A stand-in seated into an
  empty room is bait — it exists so the next visitor is not asked to be the one
  who starts something — and it cannot race: a bee is played by whichever worker
  minted its key, that key is held in memory and written down nowhere, and a
  worker lives fifteen minutes at the outside. Bait waits for a human, which can
  take hours, so by the time somebody arrives the bee that drew them in is an
  orphan. Every race formed after a quiet spell carried one bee that never moved.

  The server releases it, because only the server can: nothing else can act for
  a bee whose key is gone. Only when there is no person in the room — a
  stand-in seated to TOP UP is wanted, and a room of nothing but stand-ins can
  only have come from baiting.

- The sim bees move at the pace they were tuned to. Every move in a pass was
  awaited one after another, so a pass cost the SUM of its round trips —
  measured at **44 seconds** over thirty-nine bees against the live service —
  and a bee moves at most once per pass. `human_pause` puts a move every
  1.2–2.25s and had been loosened twice for reading as sleepy; it was never what
  set the pace. The loop was, at twenty times the interval, and a patron in a
  forty-bee match watched a board where only their own bee moved.

  `top_up` learned this for SEATING — "eighty round trips of work that has no
  order to it" — and fixed it with a bounded `gather`. Playing kept the defect.
  Deciding stays serial and reads one snapshot, exactly as before, so two bees
  are no likelier to choose one cell than they already were; only the calls go
  together.

- The winner sees they won. `match_state` kept a finished round answerable to
  its own players for three minutes so the result could be read and the prize
  claimed — and accepted only the states `running` and `ended`. `advance` sets
  `ended` and calls `settle` one statement later, so no client ever polls fast
  enough to see `ended`: a match is running, and then for the rest of its life
  it is `settled`. The winner's own round was thrown away, the fall-through
  picked the freshly opened forming match, and `LiveBoard` renders a lobby for
  anything forming. The coronation, the tap to finish looking, the tableau and
  "Queue for the next round" were all built and all unreachable, and
  `RESULT_LINGER_S` guarded a state that lasts for one statement.


- **A thin lobby is never left uncovered.** The swarm does re-check and top up
  on every poll — that part was right — but a shift only seats while it could
  still see a whole round out, which is `elapsed + 660 <= 840`, or its first
  180 seconds. Shifts started every 360, so **180 seconds of every 360 had no
  shift willing to seat a bee at all**, and somebody arriving in one of those
  holes waited the gap out in front of an empty lobby. Shifts now start every
  three minutes, so the windows abut; the handover is staggered by
  `PATIENCE_S`, so two shifts never seat into one lobby. It went from a
  nuisance to a wall the moment quorum became per-hive: a room used to need
  seven bees and now needs about forty.
- Retiring a cohort closes its connections. `forget_finished` cleared the list
  and left every bee's `httpx.AsyncClient` open — harmless at seven bees a
  match, less so at forty across several rounds, and a cleared list is one
  `aclose()` can no longer reach.
- **The simulated bees arrive in about a fifth of the time.** A human alone in
  a lobby waited close to three minutes, assembled out of three parts that each
  looked reasonable: 45 seconds of deliberate patience, half a minute of
  seating forty bees one at a time, and twenty of grace. Patience drops to 12
  seconds and is now measured against how long the LOBBY has waited rather than
  how long the current shift has been watching — a shift that starts beside a
  room already waiting seats at once instead of restarting somebody else's
  clock. Seating happens in batches of eight rather than one after another;
  bounded rather than unbounded, because forty simultaneous joins is a
  thundering herd aimed at the service the patron is waiting on.
- `match_state` reports `waiting_s` for a forming match: the age of the
  longest-seated bee, which is what a patron experiences as waiting. The
  match's own age is the wrong clock — a forming match is opened the moment the
  previous one starts and may sit empty for minutes.

- `sim/run.ts` played four hundred rounds and printed a full report whenever
  anything imported it; `main()` is now guarded so it runs only when the file
  is run. Two dead locals went with it, which nothing had type-checked because
  no test had ever pulled the file into the project.

- The About page explains its own jargon. Every term it cannot avoid saying —
  MCP, Nostr, satoshi, serverless, stateless, KYC — carries a short definition
  on a dotted underline, opened by hover, by keyboard focus, or by a tap. The
  idea is optionality-mcp's `annotate`; three things differ, and each is a
  fault the original would have had here: a tap opens it (this site is read on
  an iPad, where there is no hover at all), the popover measures itself and
  stays on screen instead of hanging off the edge, and a term is marked once
  per page rather than once per paragraph.
- A "How it is built" section on the About page: tools rather than screens, a
  board playable without seeing it, a stateless service over serverless
  Postgres, one fenced statement per contended move, identity as a key with no
  KYC, settlement over Lightning, and the scheduled swarm that keeps a thin
  hive playable.
- The board, the rules and the clock (`frontend/src/game/`) — a polar cell grid where
  rings narrow toward the queen, three acts (forage, return, tunnel), and three motions
  (fly, dig, seal).
- Four hives of twelve, a match starting once any hive holds eight bees
  (`frontend/src/game/match.ts`).
- Solo mode — the whole match filled with bots but one seat, so the interface can be
  played before anybody has paid for anything.
- Batch runner (`sim/run.ts`) that reports whether the board is a game or a lottery.
- Tollbooth operator scaffold: `OperatorRuntime`, the BTCPay credential template,
  and eleven frozen capability UUIDs minted once and never to be changed.
- `geometry.py` — the board, ported from the client's engine, with tests that
  mirror `rules.test.ts` assertion for assertion so a drift between the three
  copies of the rules fails a build rather than a match.
- Cloudflare Pages front end: `functions/mcp.js` proxying `/mcp` same-origin, and
  a deploy workflow that self-provisions both the Pages project and the domain.
- Shared fleet contracts: `mcp-ci` composite action, the reusable release
  workflow, MCP registry publish, and Renovate against the community preset.

- The board store: five tables, every motion a single fenced statement, cells
  stored sparsely so a match starts with twenty rows rather than four thousand.
- Match lifecycle — forming, quorum, grace, ceiling, settlement — owned by the
  server so a patron's sleeping tab cannot stop the world.
- All eleven domain tools registered and live.
- `useLiveMatch`: polls the board at the cadence the server asks for, and
  simulates nothing.
- Pages: the welcome story, a public ledger of what every match raised, and an
  about page that reports the running deployment.
- A cron worker that settles matches nobody is watching. It holds no secrets.


- **A cached DM proof is a proof, and the operator console now agrees.** It
  gated its buttons on holding a session *key*, on the stated grounds that a
  restricted call needs a signature from the operator's nsec. The runtime asks
  no such thing: `require_proof` takes the cached `dpop_token` phrase first,
  hashed against the proven-npub cache, and only then looks for an inline
  kind-27235 event. So an operator who answered the DM challenge — exactly as
  the sign-in screen instructs — was locked out of their own books, and the
  banner told them so in a sentence that was not true. The gate secured nothing
  either: whoever holds the token can call the tool directly.
- **The pot now holds what was paid, not what it lists at.** The first match
  played for real raised 8 sats and owed the charity 8 — one bee was a person
  paying a sat, the other seven were simulated and playing on a 100%-off
  coupon. `_charged` priced each call from the operator's own pricing model,
  which is retail: the figure before any constraint runs. It did that to dodge
  a genuine race on the runtime's single `_last_debit_cost` slot, and traded a
  race for a certainty — the pot could only ever be too big, and 80% of too big
  is a promise to a charity out of the operator's own pocket. The fare is now
  read from the runtime synchronously at the top of the tool body, before the
  first `await`, where the value provably belongs to this call.
- A refused move refunds what was taken, not the list price.
  `runtime.rollback_debit` credits `pricing.compute(...)` — the base price —
  so a bee on a full-discount coupon paid nothing and was handed a sat back.
  Refusals are ordinary in this game, so that was a slow mint, not a rounding
  error.
- Text left in dark-theme amber after the palette went light lavender.
  `amber-300` measures **1.19:1** on the page ground; links, the session
  notice, avatar initials and the charity glyph all carried it. One measured
  token (`lib/ink.ts`), and a test that reads the hex out of `index.css`
  rather than restating it.
- **A match begins when a HIVE holds eight, which is what the About page has
  always said.** It was briefly counted across the match instead — a shortcut
  taken when round-robin seating arrived, on the reasoning that spreading seats
  evenly means no hive ever fills. Eight bees dealt over five hives is one or
  two each: a race between strangers who never meet, and an interface that had
  become untrue about its own rule. The two rules do fit together, and the cost
  is stated rather than dodged: a hive reaches eight only when the board is
  nearly full, so a match needs around forty bees, and topping the room up to
  that is what the simulated swarm is for. `top_up` now asks for the seats that
  bring EVERY hive to quorum — `QUORUM - fullest` was arithmetic for the
  match-wide rule, and under round-robin it seated seven bees and left the
  lobby exactly as shut as it found it.
- The reward tableau waits to be dismissed. The coronation runs about two
  seconds and the opaque result card faded over it at 1.15 — so a bee crossed a
  meadow, queued at a door and cut thirty cells of comb, and its reward was cut
  off half way through by a button. The card now arrives on a tap.

- The winner's 10% now reaches the charity whenever no person keeps it. It used
  to sit `unclaimed` for ever in three cases that produce no claimant — a round
  with no winner, a round won by a simulated bee whose key stops existing when
  the swarm does, and a winner who never comes back — and a fourth that leaked
  the other way: a winner who chose to *donate* moved the prize to `donated`,
  which nothing counted anywhere, so the gift reached the charity's books as
  zero. One rule now covers all four: the winner's share belongs to the charity
  unless a person actually kept it (`charity_due`).
- Matches abandoned when the board's geometry changed are now settled instead of
  deleted. They kept their fares precisely because somebody paid them, but
  nothing ever worked out to whom the pot was owed, and the retention sweep
  removed the match and its fares a week later — so the money was not merely
  unpaid, it stopped being countable.
- A prize the charity receives is a payout leg of its own (`prize:<match>`)
  rather than being folded into the charity leg. The two fall due days apart,
  and an amount already claimed under `charity:<match>` could never be claimed
  again.
- Operator console: text left in dark-theme amber and emerald after the palette
  moved to light lavender, sitting near 1.5:1 against the card.
- **A challenge nobody answered no longer counts as a sign-in.** The npub was
  written to storage the moment the proof DM was *sent* — so the field would be
  prefilled next time — and the shell read "signed in" as "we know an npub".
  Someone who asked for a DM and did not reply was let in on the next render,
  unproven. `mcp.isLoggedIn()` had the correct rule all along; `useSession`
  had quietly written a weaker second one. Both now come from one pure
  predicate (`lib/signedIn.ts`), the identity is stored only once the reply
  lands, and the prefill lives in a key of its own. A lapsed proof now ends the
  session instead of leaving a signed-in person whose every paid call is
  refused. The server was never fooled — every paid tool proves its caller —
  but the interface was.
- Sign-in now reads a waking service as a wait, not a fault. A cold container
  that cannot reach the Oracle for its relay set showed the patron the SDK's
  own diagnosis (`asyncio.run() cannot be called from a running event loop`),
  which reads as "your key is broken" when the next attempt usually works. The
  service's exact words are kept underneath, because interpreting an error is
  not hiding it.

- "Queue for the next round" stays queued. `next_round` tells the server the
  result has been read, and the client dropped it on the first answer that
  named a different match — so one poll carried the flag, the lobby came back,
  the flag went, and the very next poll asked the ordinary question again. The
  server, still holding that finished round for three minutes, handed it back
  and the coronation returned. The button worked for exactly one poll and then
  undid itself, which from the outside is a button that does nothing.

  Being handed a lobby is not the same as having left one. What ends the
  leaving is being IN a round again, and the player's own bee on the board is
  what says so. The decision is in `lib/leaving.ts` now, as a pure function —
  this condition has been wrong twice in the same file, both times by choosing
  a signal that fires one poll too early, and both times it was unreachable by
  a test because it lived in a ref inside a hook.

- **The live board now gives the same hints the practice board does.** It had a
  two-way ternary — one sentence before you aimed, one after — for an entire
  round: "Tap where you want to end up." and "Press to move." Neither says which
  of the things on screen to tap, or what the bee is trying to do. So the board
  that costs sats was the one helping least, and the newcomer who had just come
  from Practice lost the guidance at the moment it started mattering.

  `SoloBoard` had the phase-aware version all along — the one that names a
  flower with pollen and shows the mark for it, names a door and shows one, and
  says what the next press costs. That is now `game/nextStep.ts`, pure and read
  by both boards through one component.

- The regression was two implementations rather than a bad string, so the guard
  is on that: `nextStep.test.ts` asserts both boards render the shared hint and
  that neither carries its own. Proven by putting the old ternary back — one
  failure, naming the file.

### Notes

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
