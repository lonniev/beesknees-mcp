- **Unreleased entries live in `changelog.d/`, one file per change.**
  `CHANGELOG.md` was the most conflict-prone file in the repository, and not
  through carelessness: every PR appended to the same `### Added` / `### Fixed`
  anchors of the same `## [Unreleased]` section, so any two concurrent PRs
  collided there even when their code touched nothing in common. Six did in one
  day. `scripts/changelog.py fold X.Y.Z` gathers the fragments into a dated
  section at release, in Keep a Changelog order, and deletes them.
