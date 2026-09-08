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
 * `canSign` matters as much as the npub. A restricted call needs a signature
 * from the operator's key, so somebody signed in on a cached proof is the
 * operator and still cannot act — which is worth telling them plainly rather
 * than letting every button fail.
 */

import { useEffect, useState } from "react";
import { canonicalIdentities } from "./mcp";

export interface OperatorStanding {
  /** The signed-in npub matches the service's operator. */
  isOperator: boolean;
  /** …and this session holds a key that can sign for it. */
  canAct: boolean;
  /** False until the service has answered; nothing is drawn before then. */
  known: boolean;
}

export function useOperator(npub: string, canSign: boolean): OperatorStanding {
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
  return { isOperator, canAct: isOperator && canSign, known };
}
