/**
 * What a satoshi is worth in dollars, right now.
 *
 * Fetched by the BROWSER, not by the service, and that is the whole design
 * decision. The MCP has money paths on it — invoices, payouts, a Lightning node
 * — and a third-party price feed that hangs must never be able to sit in front
 * of any of them. Here the worst a bad quote can do is leave a dash where a
 * dollar figure would have been.
 *
 * Coinbase's public spot endpoint: no key, CORS open, and a body of one number.
 * It is a NEW external dependency and so is named here rather than buried —
 * swapping it is a one-line change and nothing but this file knows about it.
 *
 * Failure shows nothing. A page that reports where charity money went may not
 * carry an invented exchange rate, and a stale one is an invented one: better a
 * figure in sats alone, which is what was actually moved, than dollars that
 * cannot be reproduced.
 */

import { useEffect, useState } from "react";

const SPOT = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
const SATS_PER_BTC = 100_000_000;

/** Dollars per bitcoin, or null while unknown. */
export async function fetchBtcUsd(signal?: AbortSignal): Promise<number | null> {
  try {
    const r = await fetch(SPOT, { signal });
    if (!r.ok) return null;
    const body = (await r.json()) as { data?: { amount?: string } };
    const n = Number(body?.data?.amount);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function useBtcUsd(): number | null {
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetchBtcUsd(ac.signal).then(setRate);
    return () => ac.abort();
  }, []);
  return rate;
}

/**
 * Sats as dollars, to the penny and no finer.
 *
 * Rounded to cents on purpose. Sub-cent precision on a charity receipt reads as
 * arithmetic rather than as money, and 0.0008 of a dollar is not a figure
 * anybody can hand to a treasurer. A sum too small to be a cent is shown as
 * "<$0.01" rather than as "$0.00", which would read as nothing at all.
 */
export function usd(satoshis: number, btcUsd: number | null): string | null {
  if (btcUsd === null || !Number.isFinite(satoshis)) return null;
  const dollars = (satoshis / SATS_PER_BTC) * btcUsd;
  if (dollars > 0 && dollars < 0.005) return "<$0.01";
  return `$${dollars.toFixed(2)}`;
}
