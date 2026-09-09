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
