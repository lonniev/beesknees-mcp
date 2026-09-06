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
