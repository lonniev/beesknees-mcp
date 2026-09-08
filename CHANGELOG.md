# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Fixed

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

### Fixed

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

### Notes

- No domain tool is registered yet. Each one needs the shared board in Neon —
  cross-patron state, which is new for this fleet — and a tool that takes a fare
  and then fails is worse than a tool that is not there. The identities are
  declared now so their UUIDs are minted once.
