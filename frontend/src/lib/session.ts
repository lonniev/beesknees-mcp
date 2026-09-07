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
import { getStoredNpub, onProofExpired, setStoredNpub, setStoredProof } from "./mcp";
import { clearSessionNsec, hasSessionNsec } from "./sessionNsec";

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

function read(): { npub: string; canSign: boolean } {
  // Guarded because the shell is server-rendered by the smoke check, and there
  // is no localStorage on a server. A previous `window.location` at module
  // scope broke that render for exactly this reason.
  if (typeof window === "undefined") return { npub: "", canSign: false };
  return { npub: getStoredNpub(), canSign: hasSessionNsec() };
}

export function useSession(): Session {
  const [{ npub, canSign }, setState] = useState(read);
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
    setState({ npub: "", canSign: false });
    setNotice("");
  }, []);

  // A cached proof lapsing is routine, not a failure: it happens to anyone who
  // leaves a tab open for an hour. Say so calmly and let them sign in again.
  useEffect(
    () =>
      onProofExpired(() => {
        if (hasSessionNsec()) return; // this session signs its own; nothing lapsed
        setNotice("Your session lapsed while you were away. Sign in again to keep playing.");
        setState({ npub: getStoredNpub(), canSign: false });
      }),
    [],
  );

  return {
    npub,
    signedIn: Boolean(npub),
    canSign,
    notice,
    refresh,
    signOut,
    dismissNotice: () => setNotice(""),
  };
}
