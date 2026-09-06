/**
 * What this service is, and what it is doing right now.
 *
 * Figures come from the operator's own `service_status`, so this page reports
 * the running deployment rather than what the repository claims about it.
 */

import { useEffect, useState } from "react";
import { serviceStatus } from "../lib/mcp";

export default function About() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let alive = true;
    serviceStatus()
      .then((s) => alive && setStatus(s as Record<string, unknown>))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const rows: [string, string][] = status
    ? [
        ["Service", String(status.service ?? "—")],
        ["Version", String(status.version ?? "—")],
        ["Tollbooth SDK", String(status.tollbooth_dpyc_version ?? "—")],
        ["Persistence", status.vault_configured ? "configured" : "not configured"],
      ]
    : [];

  return (
    <div className="mx-auto max-w-2xl px-5 py-8 leading-relaxed">
      <h1 className="text-2xl font-semibold tracking-tight">About</h1>

      <p className="mt-4 text-[15px] text-white/80">
        The Bee's Knees is an MCP service on the DPYC network. Every motion your bee makes is a
        tool call priced by the operator, paid from a pre-funded balance in satoshis — no accounts,
        no card, no interruption mid-match. Your identity is a Nostr key, not an email address.
      </p>

      <p className="mt-4 text-[15px] text-white/80">
        Because it is an MCP service, an AI agent can play it as readily as a browser can. The
        board, the rules and the clock all live on the server; a client only asks what the board
        looks like and says what it wants to do next.
      </p>

      <h2 className="mt-8 text-sm font-semibold text-white/80">This deployment</h2>
      <dl className="mt-3 divide-y divide-white/5 rounded-xl bg-white/5 text-sm">
        {rows.length ? (
          rows.map(([k, v]) => (
            <div key={k} className="flex justify-between px-4 py-2.5">
              <dt className="text-white/50">{k}</dt>
              <dd className="font-mono text-[12px]">{v}</dd>
            </div>
          ))
        ) : (
          <div className="px-4 py-2.5 text-white/40">Asking the hive…</div>
        )}
      </dl>

      <h2 className="mt-8 text-sm font-semibold text-white/80">The board</h2>
      <p className="mt-2 text-[15px] text-white/80">
        A hive is a ring of cells that narrows toward its queen — the wall holds about fifty, the
        last ring before the chamber holds six. Everyone starts spread around the outside and
        converges. Cutting fresh comb is slow and opens the way for everyone behind you; riding a
        shaft somebody else paid for is fast, and they can bring it down on you.
      </p>
      <p className="mt-3 text-[15px] text-white/80">
        A bee acts once per cooldown, measured on the clock, so no amount of spending buys a faster
        bee. What spending buys is interference.
      </p>

      <p className="mt-8 text-xs text-white/35">
        Five hives run at once with twelve seats each, and a match begins as soon as any hive holds
        eight bees. Five rather than one because a race between sixty near-identical bees to a
        single queen is decided by variance rather than by skill — the split is measured, not a
        matter of taste.
      </p>
    </div>
  );
}
