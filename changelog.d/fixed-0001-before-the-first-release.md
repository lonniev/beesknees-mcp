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
