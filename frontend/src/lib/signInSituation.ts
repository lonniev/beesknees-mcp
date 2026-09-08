/**
 * Reading a sign-in failure back to the human who caused none of it.
 *
 * Every operator in this fleet draws its Nostr relay set from the DPYC Oracle
 * at cold start and caches it in process. The cache protects against an Oracle
 * outage — but only once it has something in it, and a container that has just
 * cold-started has nothing. So the first sign-in against a freshly woken
 * service is one Oracle blip away from failing, and what the patron was shown
 * was the SDK's internal diagnosis:
 *
 *   Relay registry unreachable and no cached relays: get_relays() called from
 *   an async context (asyncio.run() cannot be called from a running event
 *   loop); seed the registry or await the Oracle client directly.
 *
 * That sentence is addressed to whoever maintains the SDK. To the person
 * signing in it reads as "your key is broken", which it is not: the next
 * attempt usually works, because the second one finds the service awake.
 *
 * So: lead with what happened and what to do, and keep the original text
 * underneath rather than swallowing it. Interpreting an error is not hiding
 * it — the detail is what makes a bug report worth reading.
 */

export type Situation = {
  /** What to say first. One sentence, addressed to the person, not the log. */
  lead: string;
  /** True when trying the same thing again is genuinely likely to work. */
  retryable: boolean;
  /** The service's own words, kept verbatim. */
  detail: string;
};

/** Substrings that identify a service that is awake but not yet ready. */
const WARMING = [
  // The relay directory could not be reached from a cold container.
  "relay registry unreachable",
  "cannot reach oracle",
  // The serverless host answered before the app finished starting.
  "persistence layer unreachable",
  "service unavailable",
  "only bootstrap tools",
];

const UNREACHABLE = ["failed to fetch", "networkerror", "load failed", "timeout", "timed out"];

export function readSignInFailure(raw: string): Situation {
  const detail = (raw || "").trim() || "The service gave no reason.";
    const hay = detail.toLowerCase();

  if (WARMING.some((s) => hay.includes(s))) {
    return {
      lead:
        "The hive was still waking up and could not reach the relay directory. " +
        "Nothing is wrong with your key — try again in a few seconds.",
      retryable: true,
      detail,
    };
  }

  if (UNREACHABLE.some((s) => hay.includes(s))) {
    return {
      lead: "The hive could not be reached from this device. Check the connection and try again.",
      retryable: true,
      detail,
    };
  }

  return { lead: detail, retryable: false, detail: "" };
}
