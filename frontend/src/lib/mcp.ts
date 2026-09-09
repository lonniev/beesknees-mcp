/**
 * The Bee's Knees MCP client.
 *
 * Pattern modeled on optionality-mcp/frontend/src/lib/mcp.ts:
 *
 * 1. One singleton @modelcontextprotocol/sdk Client over the
 *    StreamableHTTPClientTransport. The SDK handles the initialize
 *    handshake, SSE session tracking, and reconnection.
 * 2. Auth = uniform npub-proof. Two tactics, transparent to callers:
 *      - session nsec in browser → fresh kind-27235 inline proof per call
 *        (signInlineProof), scoped to the runtime tool name.
 *      - npub + DM login → the poison-phrase proof_token the wheel cached
 *        at receive_npub_proof time, sent verbatim.
 * 3. Bootstrap/auth/balance tools are free and pre-login-safe.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { clearSessionNsec, hasSessionNsec, sessionNsecNpub } from "./sessionNsec";
import { isProven, type Claim } from "./signedIn";
import { debugPush } from "./debugLog";
import { signInlineProof } from "./inlineProof";

const SLUG = "beesknees";

const _envUrl = (import.meta.env.VITE_MCP_URL as string | undefined) ?? "";
// Resolved lazily: this module is imported by components that a server render
// touches, and `window` does not exist there. Reading it at module scope threw
// before any component had a chance to run.
const MCP_URL = _envUrl.startsWith("/")
  ? typeof window === "undefined"
    ? _envUrl
    : `${window.location.origin}${_envUrl}`
  : _envUrl;

const NPUB_STORAGE_KEY = "beesknees:patron_npub:v1";
const PROOF_STORAGE_KEY = "beesknees:proof_token:v1";
const LAST_TYPED_KEY = "beesknees:last_typed_npub:v1";

let client: Client | null = null;
let connecting: Promise<void> | null = null;

function requireUrl(): string {
  if (!MCP_URL) {
    throw new Error("VITE_MCP_URL is not configured. Set it in .env (e.g. /mcp).");
  }
  return MCP_URL;
}

async function getClient(): Promise<Client> {
  if (client) return client;
  if (connecting) {
    await connecting;
    return client!;
  }
  connecting = (async () => {
    const url = requireUrl();
    const c = new Client({ name: "beesknees-frontend", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(url));
    await c.connect(transport);
    client = c;
    connecting = null;
  })();
  await connecting;
  return client!;
}

// ─── Stored identity ─────────────────────────────────────────────────────
//
// Every read and write goes through these two, because `localStorage` is not
// the certainty it looks like. It is absent when the app is rendered off a
// browser (the route check does exactly that, and this file used to throw), and
// merely TOUCHING it raises in a browser with site data blocked or in some
// privacy modes. An identity helper that can take down the whole page on a
// setting the visitor chose is not one worth having, so a failure here reads as
// "nothing stored" and the app carries on asking them to sign in.

function readStored(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* a visitor who blocks site data simply signs in again next time */
  }
}

export function getStoredNpub(): string {
  return readStored(NPUB_STORAGE_KEY);
}

export function setStoredNpub(npub: string): void {
  writeStored(NPUB_STORAGE_KEY, npub);
}

export function getStoredProof(): string {
  return readStored(PROOF_STORAGE_KEY);
}

export function setStoredProof(proof: string): void {
  writeStored(PROOF_STORAGE_KEY, proof);
}

// ─── Recent logins (skip the DM on return) ───────────────────────────────
// Ported from optionality-mcp's proven pattern: cache (npub, proof_token,
// expiresAt) tuples so a returning patron re-enters on the cached proof
// until the server-side cache actually expires.

const RECENT_LOGINS_KEY = "beesknees:recent-logins:v1";
const MAX_RECENT_LOGINS = 5;

export interface RecentLogin {
  npub: string;
  proof: string;
  expiresAt: number; // unix ms
  lastUsed: number; // unix ms
}

function readRecentLogins(): RecentLogin[] {
  try {
    const raw = window.localStorage.getItem(RECENT_LOGINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentLogin =>
        typeof e === "object" && e !== null &&
        typeof e.npub === "string" && typeof e.proof === "string" &&
        typeof e.expiresAt === "number" && typeof e.lastUsed === "number",
    );
  } catch {
    return [];
  }
}

function writeRecentLogins(entries: RecentLogin[]): void {
  window.localStorage.setItem(RECENT_LOGINS_KEY, JSON.stringify(entries));
}

/// Unexpired recent logins, MRU-sorted. Prunes expired entries as a side effect.
export function getValidRecentLogins(): RecentLogin[] {
  const now = Date.now();
  const entries = readRecentLogins();
  const valid = entries.filter((e) => e.expiresAt > now);
  if (valid.length !== entries.length) writeRecentLogins(valid);
  valid.sort((a, b) => b.lastUsed - a.lastUsed);
  return valid;
}

/// Record (or refresh) a successful login. Derate the TTL by 30s so a
/// straggler can't serve an already-expired token to the next paid call.
export function recordRecentLogin(npub: string, proof: string, expiresInSec: number): void {
  const safeTtl = Math.max(0, expiresInSec - 30);
  const next: RecentLogin = {
    npub,
    proof,
    expiresAt: Date.now() + safeTtl * 1000,
    lastUsed: Date.now(),
  };
  const others = readRecentLogins().filter((e) => e.npub !== npub);
  writeRecentLogins(
    [next, ...others].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_RECENT_LOGINS),
  );
}

export function forgetRecentLogin(npub: string): void {
  writeRecentLogins(readRecentLogins().filter((e) => e.npub !== npub));
}

/// The claim this browser is making, and what backs it. Read once and handed
/// to the pure predicates in `signedIn.ts`, so the shell and this module
/// cannot drift into two different ideas of who is signed in — which is
/// exactly what happened.
export function currentClaim(): Claim {
  return {
    npub: getStoredNpub(),
    proof: getStoredProof(),
    sessionNpub: hasSessionNsec() ? sessionNsecNpub() : null,
  };
}

/// "Logged in" = we have the patron's npub AND a way to prove ownership:
/// either a cached DM proof_token, or a session nsec whose npub matches.
export function isLoggedIn(): boolean {
  return isProven(currentClaim());
}

/// The npub the person typed last, remembered ONLY to prefill the field.
/// Deliberately not `NPUB_STORAGE_KEY`: that one is the identity the app acts
/// as, and writing a name there before it is proven is what let an unanswered
/// challenge become a session.
export function getLastTypedNpub(): string {
  return readStored(LAST_TYPED_KEY);
}

export function setLastTypedNpub(npub: string): void {
  writeStored(LAST_TYPED_KEY, npub);
}

export function logOut(): void {
  window.localStorage.removeItem(NPUB_STORAGE_KEY);
  window.localStorage.removeItem(PROOF_STORAGE_KEY);
  try {
    clearSessionNsec();
  } catch {
    /* noop */
  }
}

/// Resolve the proof for a paid call: prefer a fresh inline proof signed
/// by the session nsec (if it matches the stored npub), else the cached
/// DM proof_token. Stale session-nsec entries (from a prior identity) are
/// evicted so they don't poison the call.
function getCachedProof(toolName: string): string {
  try {
    const currentNpub = getStoredNpub();
    const sessionNpub = hasSessionNsec() ? sessionNsecNpub() : null;
    if (sessionNpub && sessionNpub === currentNpub) {
      return signInlineProof(`${SLUG}_${toolName}`);
    }
    if (sessionNpub && sessionNpub !== currentNpub) {
      clearSessionNsec();
    }
  } catch {
    /* fall through to the cached poison token */
  }
  return getStoredProof();
}

// ─── callTool ────────────────────────────────────────────────────────────

interface ToolResultText {
  type: string;
  text?: string;
}

interface ToolResult {
  isError?: boolean;
  content?: ToolResultText[];
  structuredContent?: unknown;
}

/// Thrown when the server rejects a paid call because the proof expired or
/// was never sent. The gate catches this and bounces the user to sign-in.
export class ProofRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofRequiredError";
  }
}

// ─── Proof-expiry signal ───────────────────────────────────────────────────
// A paid call can bounce for an expired proof from anywhere (Posts, editor,
// wallet). `callTool` clears the stale token synchronously, but the React tree
// needs to KNOW so it can re-present sign-in — otherwise the user is stranded
// on a page whose data won't load, staring at a red banner. Any component
// (App) subscribes; the tool layer fires on every proof bounce.

type ProofExpiredListener = (message: string) => void;
const proofExpiredListeners = new Set<ProofExpiredListener>();

/// Subscribe to proof-expiry bounces. Returns an unsubscribe fn. App wires this
/// to drop the user back to the sign-in gate when the cached DM proof lapses.
export function onProofExpired(cb: ProofExpiredListener): () => void {
  proofExpiredListeners.add(cb);
  return () => proofExpiredListeners.delete(cb);
}

function emitProofExpired(message: string): void {
  for (const cb of proofExpiredListeners) {
    try {
      cb(message);
    } catch {
      /* a listener error must not swallow the throw that follows */
    }
  }
}

/// Tools whose wheel signature takes no npub/proof envelope. Pydantic
/// strict mode rejects unexpected kwargs, so we must NOT inject them here.
const BOOTSTRAP_TOOLS = new Set([
  "request_npub_proof",
  "receive_npub_proof",
  "service_status",
  // Takes an explicit patron_npub, no proof envelope (free readiness probe).
  "session_status",
  // Public kind-0 profile reads/relays — take explicit npub, no proof envelope.
  "get_nostr_profile",
  "publish_nostr_profile",
  // Free operator diagnostics — no npub/proof envelope (operator identity is
  // the process's own nsec; a patron calling these just sees empty/error).
  "get_operator_onboarding_status",
  "check_authority_balance",
  // Reports the operator's own npub so the app can decide whether to DRAW the
  // operator console. Free, and takes no envelope — a guest must be able to ask
  // without an npub, or the gate cannot be evaluated before sign-in.
  "list_canonical_identities",
  // Takes explicit patron_npub + dpop_token (the cached phrase), not the
  // injected envelope — same shape as receive_npub_proof.
  "check_proof_status",
  // Patron credential flow: explicit sender_npub / patron_npub + phrase, never
  // the injected envelope. Same shape as check_proof_status.
  "get_patron_onboarding_status",
  "request_patron_credentials",
  "receive_patron_credentials",
]);

/// Tools too noisy/background to clutter the debug log (polled liveness +
/// profile hydration). Everything else — posting, OAuth, posts, snippets,
/// credits — is logged so the panel shows what the FE is actually doing.
const QUIET_TOOLS = new Set([
  "service_status",
  "get_nostr_profile",
  // The scheduler-log poll feeds the debug panel its own synthesized entries;
  // logging the poll call itself would just be noise.
  "get_scheduler_log",
  // Background personalization hydration (the editor's @handle) — not noteworthy.
  "get_x_profile",
  // NOTE: `fetch_dynamic_block` (the claim-check poll for a resolving dynamic
  // block) is intentionally NOT quiet. Each poll's status (pending → done/error)
  // must be visible in the debug panel — otherwise a resolve looks like it never
  // calls back, and a silent poll failure (e.g. a proof bounce) is undiagnosable.
]);

/**
 * Exported so the live board can drive the polling hook, which takes a caller
 * rather than importing every tool it might need.
 */
export async function callTool<T = unknown>(
  toolName: string,
  args: Record<string, unknown> = {},
  opts: { bestEffort?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const quiet = QUIET_TOOLS.has(toolName);
  // `args` holds only the wrapper's own params — never npub/proof (those are
  // injected below), so it is safe to log verbatim.
  if (!quiet) debugPush("call", `${SLUG}_${toolName}(${JSON.stringify(args).slice(0, 140)})`);

  const c = await getClient();
  const merged: Record<string, unknown> = BOOTSTRAP_TOOLS.has(toolName)
    ? { ...args }
    : { npub: getStoredNpub(), dpop_token: getCachedProof(toolName), ...args };

  let result: ToolResult;
  try {
    result = (await c.callTool(
      { name: `${SLUG}_${toolName}`, arguments: merged },
      undefined,
      { timeout: opts.timeoutMs ?? 120_000 },
    )) as ToolResult;
  } catch (e) {
    if (!quiet) debugPush("error", `${SLUG}_${toolName}: ${(e as Error).message}`);
    throw new Error(`${SLUG}_${toolName}: ${(e as Error).message}`);
  }

  if (result.isError) {
    const errText = (result.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => String(b.text))
      .join("\n") || "Tool call failed";
    if (!quiet) debugPush("error", `${SLUG}_${toolName}: ${errText.slice(0, 200)}`);
    throw new Error(errText);
  }

  let payload: unknown;
  if (result.structuredContent !== undefined) {
    payload = result.structuredContent;
  } else {
    const textBlocks = (result.content ?? []).filter((b) => b.type === "text");
    if (textBlocks.length > 0) {
      const text = String(textBlocks[0].text ?? "");
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    } else {
      payload = result;
    }
  }

  if (!quiet) {
    const preview = typeof payload === "string" ? payload : JSON.stringify(payload);
    const p = payload as Record<string, unknown> | null;
    const failed = p && typeof p === "object" && (p.success === false || p.error);
    debugPush(failed ? "error" : "result", `${SLUG}_${toolName} → ${String(preview).slice(0, 220)}`);
  }

  // Soft proof failures arrive as {success:false, error_code:...} with no
  // isError flag. Treat them as auth bounces: clear the stale token and let the
  // gate re-arm sign-in. NOT for best-effort calls (personalization/diagnostics)
  // — a non-essential tool must never be able to log the user out of everything.
  if (!opts.bestEffort && payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    // The wheel's ErrorCode values are lowercase snake_case ("proof_required",
    // "proof_refresh_needed") — normalize before comparing. (A prior uppercase
    // comparison never matched, so the bounce silently never fired and the raw
    // "cache entry is no longer valid" text just landed in an inline banner.)
    const errCode = String(p.error_code ?? "").toLowerCase();
    if (p.success === false && (errCode === "proof_required" || errCode === "proof_refresh_needed")) {
      // The cached DM proof_token the server just rejected is the SAME token the
      // recent-login one-tap would replay — evict it too, or the returning-user
      // shortcut immediately re-bounces. (nsec sessions don't record a recent
      // login and re-sign inline, so this only touches DM-login users.)
      const bouncedNpub = getStoredNpub();
      window.localStorage.removeItem(PROOF_STORAGE_KEY);
      if (bouncedNpub) forgetRecentLogin(bouncedNpub);
      const msg = String(p.error ?? "Sign-in required.");
      emitProofExpired(msg);
      throw new ProofRequiredError(msg);
    }
  }
  return payload as T;
}

// ─── Service / auth (free) ───────────────────────────────────────────────

export interface ServiceStatus {
  operator_npub_hash?: string;
  lifecycle?: string;
  message?: string;
  version?: string;
  tollbooth_dpyc_version?: string;
  process_id?: number;
  service?: string;
  slug?: string;
  vault_configured?: boolean;
  courier_has_vault?: boolean;
  // Durable long-runner diagnostics (operator only; present when op_npub resolves).
  durable_jobs?: {
    key_id?: string;
    closure_key_block?: string;
    deployment?: string;
    detached_executor_active?: boolean;
    detached_executor_resolved?: boolean;
    detached_executor_error?: string | null;
  };
  // FastMCP Docket backend — durable_across_recycles is the real signal.
  async_jobs?: {
    docket_url_set?: boolean;
    backend?: string;
    durable_across_recycles?: boolean;
  };
  build_info?: {
    fastmcp_cloud_url?: string;
    fastmcp_cloud_git_commit_sha?: string;
    fastmcp_cloud_git_repo?: string;
  };
}

export async function serviceStatus(): Promise<ServiceStatus> {
  return callTool<ServiceStatus>("service_status", {});
}

export interface NpubProofResult {
  success?: boolean;
  proven_npub?: string;
  verified?: boolean; // legacy field; current wheel uses `success`
  status?: string;
  message?: string;
  dpop_token?: string; // wheel 0.57.0+ (was proof_token)
  popped_dms?: number;
  expires_in_seconds?: number;
  expires_at?: string;
  error?: string;
  error_code?: string;
}

/// Step 1 of DM login. Sends a Secure Courier challenge DM to the npub.
/// The user replies in their own Nostr client. Free.
///
/// `verifyAt` is the OAuth2 Device-Grant `verification_uri` (RFC 8628): the
/// place where THIS app displays the session phrase. The DM names it so the
/// human can cross-check — "the code in this DM was shown to you at <verifyAt>;
/// approve only if it matches." Trust rests on that two-surface match, so we
/// pass this app's own URL: an impostor firing the same tool from elsewhere
/// cannot make the human's open Bee's Knees tab show the attacker's code.
export async function requestNpubProof(
  patronNpub: string,
  verifyAt?: string,
  reason?: string,
): Promise<NpubProofResult> {
  return callTool<NpubProofResult>("request_npub_proof", {
    patron_npub: patronNpub,
    ...(verifyAt ? { verify_at: verifyAt } : {}),
    ...(reason ? { reason } : {}),
  });
}

/// Step 2 of DM login. Destructively drains DMs looking for the signed
/// reply to step 1. Call ONLY after the user has actually replied — do not
/// poll or speculatively retry (feedback_human_in_loop_courier). `dpopToken`
/// is the dpop_token from step 1 (wheel 0.57.0+; was the poison/proof_token).
export async function receiveNpubProof(patronNpub: string, dpopToken: string): Promise<NpubProofResult> {
  return callTool<NpubProofResult>("receive_npub_proof", {
    patron_npub: patronNpub,
    dpop_token: dpopToken,
  });
}

export interface CreditTranche {
  id: string;
  amount_sats: number;
  remaining_sats: number;
  expires_at: string | null;
  created_at: string | null;
}

export interface CheckBalanceResult {
  success?: boolean;
  balance_api_sats?: number;
  total_deposited_api_sats?: number;
  total_consumed_api_sats?: number;
  active_tranches?: number;
  tranches?: CreditTranche[];
  next_expiration_iso?: string;
  /** Sats in active tranches that expire within 24h (wheel check_balance). */
  expiring_within_24h_sats?: number;
  total_expired_api_sats?: number;
  seed_balance_granted?: boolean;
  vault_unavailable?: boolean;
  warning?: string;
  npub?: string;
  error?: string;
  error_code?: string;
}

export async function checkBalance(): Promise<CheckBalanceResult> {
  return callTool<CheckBalanceResult>("check_balance", {});
}

// ─── Funding / credential status probes (compose into StatusSurface) ─────────
// All free. Patron rows use check_balance + session_status + check_proof_status.
// Operator rows use service_status + get_operator_onboarding_status +
// check_authority_balance, gated client-side to the operator npub the same way
// scheduler_pending is (getSchedulerStatus().operator_npub === stored npub).

export interface ProofStatusResult {
  success?: boolean;
  status?: "valid" | "expired" | "unknown" | string;
  expires_in_seconds?: number | null;
  message?: string;
  error?: string;
  error_code?: string;
}

/// Whether the cached DM proof_token is still accepted. For session-nsec logins
/// there is nothing to check (fresh inline proof each call) — callers should
/// skip this and treat the proof row as ok. Free; takes explicit args so the
/// envelope is not double-injected.
export async function checkProofStatus(
  patronNpub: string,
  dpopToken: string,
): Promise<ProofStatusResult> {
  return callTool<ProofStatusResult>(
    "check_proof_status",
    { patron_npub: patronNpub, dpop_token: dpopToken },
    { bestEffort: true },
  );
}

export interface OnboardingField {
  field: string;
  category?: string;
  status?: string;
  lifecycle?: string;
  how?: string;
}

export interface OperatorOnboardingResult {
  ready?: boolean;
  configured?: OnboardingField[];
  missing?: OnboardingField[];
  optional_missing?: OnboardingField[];
  summary?: string;
  bootstrap_error?: string;
  vault_ok?: boolean;
  credential_service?: string;
  operator_name?: string;
  error?: string;
}

/// Operator credential readiness (BTCPay / X app / llm_api_key present-or-not).
/// Free, no proof. A non-operator still gets the structural answer; the FE hides
/// the panel unless the viewer is the operator npub.
export async function getOperatorOnboardingStatus(): Promise<OperatorOnboardingResult> {
  return callTool<OperatorOnboardingResult>(
    "get_operator_onboarding_status",
    {},
    { bestEffort: true },
  );
}

export interface AuthorityBalanceResult {
  success?: boolean;
  balance_api_sats?: number;
  balance_sats?: number;
  error?: string;
  message?: string;
}

/// This operator's tax balance at the Authority (sats available to certify
/// patron purchases). Free. Best-effort — a failure is itself a status signal.
export async function checkAuthorityBalance(): Promise<AuthorityBalanceResult> {
  return callTool<AuthorityBalanceResult>(
    "check_authority_balance",
    {},
    { bestEffort: true },
  );
}

export interface SessionLifecycleResult {
  success?: boolean;
  lifecycle?: string;
  message?: string;
  detail?: string;
  operator_npub?: string;
}

/// Operator lifecycle (ready / warming_up / misconfigured / quota_exceeded / …).
/// Free. Optional patron_npub also yields upstream_oauth (used by getXConnection).
export async function getSessionLifecycle(
  patronNpub?: string,
): Promise<SessionLifecycleResult> {
  return callTool<SessionLifecycleResult>(
    "session_status",
    patronNpub ? { patron_npub: patronNpub } : {},
    { bestEffort: true },
  );
}

export interface CheckPriceResult {
  success: boolean;
  tool_id?: string;
  tool_name?: string;
  base_cost?: number;
  effective_cost?: number;
  cost?: number;
  error?: string;
  error_code?: string;
}

export async function checkPrice(
  toolCapability: string,
  toolKwargs: Record<string, unknown> = {},
): Promise<CheckPriceResult> {
  return callTool<CheckPriceResult>("check_price", {
    tool_id: toolCapability,
    tool_kwargs: JSON.stringify(toolKwargs),
  });
}

export interface PurchaseCreditsResult {
  success?: boolean;
  invoice_id?: string;
  checkout_link?: string;
  lightning_invoice?: string;
  payment_request?: string;
  expires_at?: string;
  amount_sats?: number;
  error?: string;
  error_code?: string;
}

export async function purchaseCredits(sats: number): Promise<PurchaseCreditsResult> {
  return callTool<PurchaseCreditsResult>("purchase_credits", { amount_sats: sats });
}

export interface CheckPaymentResult {
  success?: boolean;
  status?: "New" | "Processing" | "Settled" | "Expired" | "Invalid" | string;
  message?: string;
  invoice_id?: string;
  credits_granted?: number;
  balance_api_sats?: number;
  error?: string;
  error_code?: string;
}

export async function checkPayment(invoiceId: string): Promise<CheckPaymentResult> {
  return callTool<CheckPaymentResult>("check_payment", { invoice_id: invoiceId });
}

export interface AccountStatementResult {
  success?: boolean;
  npub?: string;
  balance_api_sats?: number;
  total_deposited_api_sats?: number;
  total_consumed_api_sats?: number;
  total_expired_api_sats?: number;
  active_tranches?: number;
  today_usage?: Record<string, { calls: number; api_sats: number }>;
  error?: string;
}

export async function getAccountStatement(days = 30): Promise<AccountStatementResult> {
  return callTool<AccountStatementResult>("account_statement", { days });
}

// ─── Posts CRUD (paid) ───────────────────────────────────────────────────

export interface Kind0 {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  website?: string;
  lud16?: string;
}

export interface GetNostrProfileResult {
  success: boolean;
  npub?: string;
  profile?: Kind0;
  error?: string;
}

/// Read an npub's public kind-0 profile via the operator MCP (free, no proof).
export async function getNostrProfile(npub: string): Promise<GetNostrProfileResult> {
  return callTool<GetNostrProfileResult>("get_nostr_profile", { npub });
}

export interface PublishNostrProfileResult {
  success: boolean;
  ok?: number;
  total?: number;
  errors?: string[];
  error?: string;
}

/// Relay a CLIENT-signed kind-0 event through the operator MCP. The FE signs;
/// the wheel verifies pubkey+signature and fans out to relays.
export async function publishNostrProfile(
  npub: string,
  signedEvent: string,
): Promise<PublishNostrProfileResult> {
  return callTool<PublishNostrProfileResult>("publish_nostr_profile", {
    npub,
    signed_event: signedEvent,
  });
}

// ─── Coupons (wheel 0.41.0+) ─────────────────────────────────────────────

export interface PatronCoupon {
  coupon_id: string;
  name: string;
  discount_percent: number;
  valid_from: string;
  valid_until: string;
  uses_per_patron: number | null;
  use_count: number;
  uses_remaining: number | null;
  total_uses: number | null;
  total_remaining: number | null;
  status: string; // active | window_closed | window_not_started | patron_limit | total_limit
}

export interface ListMyCouponsResult {
  success: boolean;
  count: number;
  coupons: PatronCoupon[];
  error?: string;
}

export interface RedeemCouponResult {
  success: boolean;
  coupon_id?: string;
  name?: string;
  discount_percent?: number;
  valid_until?: string;
  uses_remaining?: number | null;
  uses_per_patron?: number | null;
  error?: string;
}

export interface ForgetCouponResult {
  success: boolean;
  coupon_id?: string;
  error?: string;
}

export async function listMyCoupons(): Promise<ListMyCouponsResult> {
  return callTool<ListMyCouponsResult>("list_my_coupons", {});
}

export async function redeemCoupon(code: string): Promise<RedeemCouponResult> {
  return callTool<RedeemCouponResult>("redeem_coupon", { code });
}

export async function forgetCoupon(couponId: string): Promise<ForgetCouponResult> {
  return callTool<ForgetCouponResult>("forget_coupon", { coupon_id: couponId });
}

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
