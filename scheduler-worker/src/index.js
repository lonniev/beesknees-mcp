/**
 * The tick.
 *
 * It holds NO secrets. `beesknees_check_now` is free and carries no authority —
 * it can only cause work that was already due: start a match whose grace has
 * run out, end one whose ceiling has fallen, settle one that ended. There is
 * nothing here worth stealing and nothing to rotate, which is why this is fifty
 * lines rather than the proof dance the excalibur scheduler needs.
 *
 * The operator-only `tick` tool does the same work behind an operator proof.
 * This uses the free door deliberately: a gate that stops nobody who wants to
 * abuse it, while stopping a cron that should not be stopped, is fiction.
 */

const JSON_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

async function rpc(url, sessionId, body) {
  const headers = { ...JSON_HEADERS };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
}

/** Parse a plain JSON body or an SSE frame — the transport serves both. */
async function readResult(res) {
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  try {
    const msg = JSON.parse(line ? line.slice(6) : text);
    const r = msg.result ?? {};
    if (r.structuredContent) return r.structuredContent;
    if (r.content?.[0]?.text) return JSON.parse(r.content[0].text);
    return r;
  } catch {
    return null;
  }
}

async function tick(url) {
  const init = await rpc(url, null, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "beesknees-scheduler", version: "1" },
    },
  });
  if (!init.ok) throw new Error(`initialize failed (${init.status})`);
  // The session id is OPTIONAL. This operator answers statelessly and returns
  // no `mcp-session-id` at all; an earlier version of this treated its absence
  // as a failure and never ticked once, while the handshake underneath was
  // perfectly healthy. Carry it when offered, proceed when not.
  const sid = init.headers.get("mcp-session-id");

  await rpc(url, sid, { jsonrpc: "2.0", method: "notifications/initialized" });

  const res = await rpc(url, sid, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "beesknees_check_now", arguments: {} },
  });
  return readResult(res);
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      tick(env.MCP_URL)
        .then((r) => console.log("tick:", JSON.stringify(r?.acted ?? r)))
        // A failed tick is not an emergency: the next is a minute away, and any
        // player's move advances the clock in the meantime.
        .catch((e) => console.log("tick failed:", e.message)),
    );
  },

  /** A public poke, for checking the worker is alive without waiting a minute. */
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/tick") {
      try {
        return Response.json({ ok: true, ...(await tick(env.MCP_URL)) });
      } catch (e) {
        return Response.json({ ok: false, error: e.message }, { status: 502 });
      }
    }
    return Response.json({ ok: true, service: "beesknees-scheduler" });
  },
};
