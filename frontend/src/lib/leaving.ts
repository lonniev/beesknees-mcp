// Whether the player is still leaving the round they read.
//
// `match_state` keeps a finished round answerable to its own players for three
// minutes so the coronation can be watched and the prize claimed. `next_round`
// is how a client says it has read the result — and the question this file
// answers is how long it must keep saying so.
//
// "Until a different match answers" was wrong, and wrong in a way that looked
// like the fix working: one poll went out with the flag, the lobby came back,
// the flag was dropped, and the very next poll asked the ordinary question
// again — so the server handed over the finished round it is still holding and
// the coronation returned. The button undid itself once per poll.

export interface Seated {
  npub: string;
}

export interface Board {
  match_id?: string;
  bees?: Seated[];
}

/**
 * The match id still being left, given what just came back.
 *
 * Empty once the player is IN a round again — seeing their own bee on the
 * board is what says so. Being HANDED a lobby is not the same thing: a lobby
 * they have not joined is exactly where they will sit while the server goes on
 * holding their old result.
 */
export function stillLeaving(leaving: string, board: Board, me: string): string {
  if (!leaving) return "";
  if (!board.match_id || board.match_id === leaving) return leaving;
  const seated = (board.bees ?? []).some((b) => b.npub === me);
  return seated ? "" : leaving;
}
