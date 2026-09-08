# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
