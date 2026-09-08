/**
 * Is the person at the keyboard this service's operator?
 *
 * Answered by asking the service who its operator is, never by a build-time
 * constant: the npub lives in the running process and a hardcoded copy would
 * be one deploy away from being wrong.
 *
 * **This decides what to DRAW and nothing else.** Every tool on the operator
 * console is `restricted`, and the runtime proves the caller is the operator
 * before it runs — so a patron who types the route in gets a page whose every
 * button the service refuses. The gate here spares people a link that is not
 * theirs; it is not what stops them using it.
 *
 * A **cached DM proof is a proof.** This hook used to insist on a session key
 * as well, on the stated grounds that "a restricted call needs a signature from
 * the operator's key". That is not what the runtime asks. `require_proof`
 * accepts two tactics and takes the cached `dpop_token` phrase FIRST — hashing
 * it and checking the proven-npub cache — before it ever looks for an inline
 * kind-27235 event. So an operator who answered the DM challenge, exactly as
 * the sign-in screen told them to, was locked out of their own console by a
 * rule the service does not have.
 *
 * It could not have secured anything either. Whoever holds the token can call
 * the tool directly; a gate the server does not enforce only stops the honest
 * person using the interface.
 */

import { useEffect, useState } from "react";
import { canonicalIdentities } from "./mcp";

export interface OperatorStanding {
  /** The signed-in npub matches the service's operator. */
  isOperator: boolean;
  /** …and the session is proven, so the service will accept its calls. */
  canAct: boolean;
  /** False until the service has answered; nothing is drawn before then. */
  known: boolean;
}

export function useOperator(npub: string, signedIn: boolean): OperatorStanding {
  const [operatorNpub, setOperatorNpub] = useState<string | null>(null);
  const [known, setKnown] = useState(false);

  useEffect(() => {
    let alive = true;
    canonicalIdentities()
      .then((r) => alive && setOperatorNpub(r?.operator_npub ?? ""))
      .catch(() => alive && setOperatorNpub(""))
      .finally(() => alive && setKnown(true));
    return () => {
      alive = false;
    };
  }, []);

  const isOperator = Boolean(npub) && npub === operatorNpub;
  return { isOperator, canAct: isOperator && signedIn, known };
}
