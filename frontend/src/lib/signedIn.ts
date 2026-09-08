/**
 * What "signed in" means. One definition, because there were two.
 *
 * The app knew an npub the moment the proof DM was SENT — `begin()` stored it
 * so the field would be prefilled next time — and the shell's `useSession`
 * read "signed in" as "we know an npub". So a person who asked for a DM and
 * did not answer it was let in anyway on the next render: not as a stranger,
 * but as themselves, unproven. `mcp.isLoggedIn()` had the right rule all along
 * and the shell simply did not call it.
 *
 * Knowing a name is not knowing it is yours. An npub is public — it is on
 * every note its owner ever wrote — so the npub alone is a claim, never a
 * credential. Two things can back the claim:
 *
 *   - a **cached DM proof**, won by answering a Nostr challenge, or
 *   - a **session nsec** in this tab, which signs a fresh proof per call —
 *     and only counts for the npub it actually derives to, so a key left over
 *     from a previous identity proves nothing about this one.
 *
 * Pure and parameterised so it can be tested without a browser: everything
 * here is a decision, and the storage that feeds it lives in `mcp.ts`.
 */

export interface Claim {
  /** The npub the interface is showing, proven or not. */
  npub: string;
  /** A cached DM proof token, if one was won and has not lapsed. */
  proof: string;
  /** The npub this tab's session key derives to, if it holds one. */
  sessionNpub: string | null;
}

/** True only when the claimed npub is backed by something. */
export function isProven({ npub, proof, sessionNpub }: Claim): boolean {
  if (!npub) return false;
  if (proof) return true;
  return sessionNpub === npub;
}

/** True when this tab can sign a fresh proof for the npub it is claiming. */
export function canSignFor({ npub, sessionNpub }: Claim): boolean {
  return Boolean(npub) && sessionNpub === npub;
}
