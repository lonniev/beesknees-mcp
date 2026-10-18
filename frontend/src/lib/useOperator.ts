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
 * A **DM sign-in is a proof.** The runtime accepts the operator's npub from a
 * request signed with its key or from a connection that holds it after the DM
 * challenge, so an operator who answered the DM, exactly as the sign-in screen
 * told them to, may use their own console. This hook asks for nothing more
 * than the service does.
 */

import { useEffect, useState } from "react";
import { listCanonicalIdentities } from "@tollbooth-dpyc/web";

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
    listCanonicalIdentities({ bestEffort: true })
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
