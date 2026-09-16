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
