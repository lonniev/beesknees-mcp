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
