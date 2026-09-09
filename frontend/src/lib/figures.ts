/**
 * How a number and a key are written, in the one place that decides it.
 *
 * Both of these lived inside `pages/Ledger.tsx` as local helpers. They are the
 * house style for two things a reader compares ACROSS screens — a sat total on
 * the lobby against the same total on the ledger, a winner's key on one against
 * the same key on the other — and two copies of that style would be two
 * chances for the comparison to stop working.
 */

/** A sat figure, grouped. Never abbreviated: "12k sats" is not a receipt. */
export function sats(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US");
}

/**
 * An npub, short enough for a row and long enough to recognise.
 *
 * Head AND tail. A key truncated only at the end is unrecognisable — every
 * npub begins `npub1` — and one truncated only at the front loses the part a
 * person actually has memorised. Short keys are returned whole rather than
 * padded with an ellipsis that hides nothing.
 */
export function shortNpub(npub: string): string {
  const k = npub ?? "";
  return k.length > 16 ? `${k.slice(0, 10)}…${k.slice(-4)}` : k;
}
