/**
 * The Bee's Knees' own tools, called through @tollbooth-dpyc/web.
 *
 * The client core is the package's: the one MCP connection, the npub/proof
 * envelope (a fresh kind-27235 inline proof when this tab holds a session key,
 * else the cached DM proof), the proof-bounce signal, the identity storage and
 * the standard tools (balance, top-up, status, profile). What stays here is
 * the game's alone: the match, the prize, the charity and the operator's books.
 */

import { callTool } from "@tollbooth-dpyc/web";

// ─── The Bee's Knees ─────────────────────────────────────────────────────
//
// The board is the SERVER's. Nothing below simulates anything — these are the
// eleven ways a browser can ask the hive a question or tell it about a move.

export interface LiveBee {
  hive: number;
  seat: number;
  npub: string;
  label: string;
  cell: number;
  phase: string;
  moves: number;
  digs: number;
  seals: number;
  next_move_at: string | null;
  finished_at: string | null;
}

export interface MatchState {
  success: boolean;
  match_id: string;
  /**
   * The server's word for where the match is.
   *
   * `abandoned` belongs here and was missing: `retire_stale_boards` sets it on
   * a match whose board no longer exists, and the type said that could not
   * happen. So the board screen tested for `ended || settled`, an abandoned
   * match matched neither, and the player was left on a frozen board with an
   * enabled button that answered "no match is running".
   *
   * Treat this as OPEN. It is the server's vocabulary, not the browser's, and
   * a screen should ask "is it still going" rather than list the ways it might
   * have stopped.
   */
  state: "forming" | "running" | "ended" | "settled" | "abandoned";
  seq: number;
  unchanged?: boolean;
  poll_after_ms: number;
  winner_npub?: string;
  hives: number;
  seats: number;
  bees: LiveBee[];
  open_cells: { hive: number; cell: number }[];
}

/**
 * The live board.
 *
 * `bestEffort` matters more here than anywhere else in the app: this runs on a
 * loop for the whole match, and a single blip that bounced the proof would log
 * the player out mid-race. A diagnostic must never be able to do that.
 */
export async function matchState(sinceSeq = -1): Promise<MatchState> {
  return callTool<MatchState>("match_state", { since_seq: sinceSeq }, { bestEffort: true });
}

export async function myBee(): Promise<Record<string, unknown>> {
  return callTool("my_bee", {}, { bestEffort: true });
}

export async function matchList(): Promise<Record<string, unknown>> {
  return callTool("match_list", {}, { bestEffort: true });
}

export async function joinMatch(label: string): Promise<Record<string, unknown>> {
  return callTool("join_match", { label });
}

export async function fly(toCell: number): Promise<Record<string, unknown>> {
  return callTool("fly", { to_cell: toCell });
}

export async function dig(toCell: number): Promise<Record<string, unknown>> {
  return callTool("dig", { to_cell: toCell });
}

export async function seal(atCell: number): Promise<Record<string, unknown>> {
  return callTool("seal", { at_cell: atCell });
}

/**
 * Take the winner's share, or send it on.
 *
 * Omitting the choice is not a missing answer: the server falls back to
 * whatever the winner already set in their profile, so a player who has
 * decided once never has to decide again with a trophy on the screen.
 */
export async function claimPrize(matchId: string, choice?: "keep" | "donate") {
  return callTool("claim_prize", choice ? { match_id: matchId, choice } : { match_id: matchId });
}

export interface Charity {
  success: boolean;
  name: string;
  website: string;
  named: boolean;
}

/** Who the charity share goes to. Free, so a screen can always show it. */
export async function charity(): Promise<Charity> {
  return callTool<Charity>("charity", {}, { bestEffort: true });
}

export interface Payout {
  success: boolean;
  lightning_address: string;
  donate: boolean;
  /** False for somebody who has never said — which still means donate. */
  set: boolean;
}

export async function payout(): Promise<Payout> {
  return callTool<Payout>("payout", {}, { bestEffort: true });
}

export async function setPayout(donate: boolean, lightningAddress: string): Promise<Payout & { error?: string }> {
  return callTool("set_payout", { donate, lightning_address: lightningAddress });
}

export interface Settlement {
  match_id: string;
  pot_sats: number;
  charity_sats: number;
  winner_sats: number;
  operator_sats: number;
  winner_npub: string | null;
  beneficiary: string;
  prize_state: string;
  created_at: string;
}

export interface SettlementHistory {
  success: boolean;
  beneficiary: string;
  /** The configured charity, so the ledger can link out to them. */
  charity?: { name: string; website: string };
  accrued_sats: number;
  /** Everything ever raised, summed by the server over the whole table. */
  raised_sats: number;
  settlements: Settlement[];
  /** Every settled match there is, not the length of this page. */
  total: number;
  page: number;
  page_size: number;
  sort_col: string;
  sort_dir: string;
  leaderboard: { npub: string; sats: number; wins: number }[];
}

/** How the ledger may be ordered. Mirrors `SETTLEMENT_SORTS` on the server. */
export type LedgerSort = "settled" | "match" | "raised" | "charity" | "winner";

/**
 * The public receipt — free, because a claim that costs money to check is not
 * one — and paged by the server, because a row per settled match is a table
 * that only ever gets longer.
 */
export async function settlementHistory(
  page = 0,
  pageSize = 25,
  sortCol: LedgerSort = "settled",
  sortDir: "asc" | "desc" = "desc",
): Promise<SettlementHistory> {
  return callTool<SettlementHistory>(
    "settlement_history",
    { page, page_size: pageSize, sort_col: sortCol, sort_dir: sortDir },
    { bestEffort: true },
  );
}

export async function checkNow(): Promise<Record<string, unknown>> {
  return callTool("check_now", {}, { bestEffort: true });
}

// ── The operator's own console ────────────────────────────────────────────
//
// Every one of these except `canonicalIdentities` is `restricted`: the runtime
// proves the caller is the operator before it runs. The frontend's own gate is
// cosmetic — it decides what to DRAW, never what is allowed — so a patron who
// finds the route gets a page whose every button is refused by the service.

export interface Treasury {
  success: boolean;
  node_reachable: boolean;
  sendable_sats: number;
  owed_sats: number;
  owed_charity_sats: number;
  owed_prizes_sats: number;
  covers_everything_owed: boolean;
  note: string;
  /** The full record including the wallet — the free `charity` tool omits it. */
  charity?: { name: string; website: string; lightning_address: string };
  error?: string;
}

export async function treasury(): Promise<Treasury> {
  return callTool<Treasury>("treasury", {}, { bestEffort: true });
}

export async function setCharity(
  name: string,
  website: string,
  lightningAddress: string,
): Promise<{ success: boolean; error?: string }> {
  return callTool("set_charity", {
    name,
    website,
    lightning_address: lightningAddress,
  });
}

export interface CharityPayment {
  success: boolean;
  to?: string;
  matches?: number;
  amount_sats?: number;
  state?: string;
  settled?: boolean;
  note?: string;
  error?: string;
  error_code?: string;
}

/** Pay every outstanding charity leg, in one Lightning payment. */
export async function payCharity(): Promise<CharityPayment> {
  return callTool<CharityPayment>("pay_charity", {}, { timeoutMs: 180_000 });
}

/** Who the service believes its operator is. Free, so the gate can be drawn. */
export async function canonicalIdentities(): Promise<{ operator_npub?: string }> {
  return callTool("list_canonical_identities", {}, { bestEffort: true });
}
