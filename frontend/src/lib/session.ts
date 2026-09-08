/**
 * Who is signed in, in one place.
 *
 * The identity components were copied in from sibling services and each one
 * reads localStorage directly, which is fine inside a form and useless to the
 * rest of the app: nothing re-renders when a person signs in, because nothing
 * was watching. This is the missing half — one hook that holds the answer and
 * tells every screen when it changes.
 *
 * Two ways to be signed in, and they are NOT the same thing:
 *
 *  - a **session nsec** in this tab, which can sign a fresh proof for every
 *    paid call and never lapses while the tab lives;
 *  - a **cached DM proof**, won by answering a Nostr challenge, which expires.
 *
 * Both give a usable npub, so the shell treats them alike; only `canSign` tells
 * them apart, and only the pages that spend money need to ask.
 */

import { useCallback, useEffect, useState } from "react";
import { currentClaim, onProofExpired, setStoredNpub, setStoredProof } from "./mcp";
import { canSignFor, isProven } from "./signedIn";
import { clearSessionNsec } from "./sessionNsec";

export interface Session {
  npub: string;
  signedIn: boolean;
  /** Can this session sign a proof itself, or is it living on a cached one? */
  canSign: boolean;
  /** A prompt to re-authenticate, set when a cached proof lapses. */
  notice: string;
  /** Call after a successful sign-in so the whole app notices. */
  refresh: () => void;
  signOut: () => void;
  dismissNotice: () => void;
}

function read(): { npub: string; signedIn: boolean; canSign: boolean } {
  // Guarded because the shell is server-rendered by the smoke check, and there
  // is no localStorage on a server. A previous `window.location` at module
  // scope broke that render for exactly this reason.
  if (typeof window === "undefined") return { npub: "", signedIn: false, canSign: false };
  const claim = currentClaim();
  // `isProven`, not `Boolean(npub)`. This module used to decide for itself
  // what signed in meant, and its answer was weaker than the one `mcp.ts`
  // already had: an npub with nothing behind it counted.
  return { npub: claim.npub, signedIn: isProven(claim), canSign: canSignFor(claim) };
}

export function useSession(): Session {
  const [{ npub, signedIn, canSign }, setState] = useState(read);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(() => {
    setState(read());
    setNotice("");
  }, []);

  const signOut = useCallback(() => {
    // Everything that says who you are goes, including the session key — a
    // "sign out" that leaves a usable signing key behind is not one.
    clearSessionNsec();
    setStoredNpub("");
    setStoredProof("");
    setState({ npub: "", signedIn: false, canSign: false });
    setNotice("");
  }, []);

  // A cached proof lapsing is routine, not a failure: it happens to anyone who
  // leaves a tab open for an hour. Say so calmly and let them sign in again.
  useEffect(
    () =>
      onProofExpired(() => {
        // A tab that can sign for THIS npub lost nothing. Merely holding a key
        // is not enough — one left over from a previous identity signs proofs
        // the service will refuse.
        if (canSignFor(currentClaim())) return;
        setNotice("Your session lapsed while you were away. Sign in again to keep playing.");
        // Re-read rather than patching a field: the proof is gone, so this is
        // no longer a session, and saying otherwise leaves the shell showing a
        // signed-in person whose every paid call will be refused.
        setState(read());
      }),
    [],
  );

  return {
    npub,
    signedIn,
    canSign,
    notice,
    refresh,
    signOut,
    dismissNotice: () => setNotice(""),
  };
}
