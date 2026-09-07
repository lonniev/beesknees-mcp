"""How a sim bee talks to the hive: as a patron, over MCP, like anybody else.

No privileged path and no back door into the board. Each bee has its own key,
signs its own kind-27235 proof per call, and is charged the same fares as a
person — it simply holds a coupon that discounts them to nothing.

The coupon is a CODE, not a secret. Minting one needs the operator's proof and
therefore the operator's nsec, which never comes near this runner: the operator
mints `SIM_COUPON` once and the runner only ever redeems it.
"""

from __future__ import annotations

import json
import logging
import secrets
from typing import Any

import httpx

logger = logging.getLogger(__name__)

SLUG = "beesknees"


def new_key() -> tuple[str, str]:
    """A fresh throwaway identity: (nsec, npub)."""
    from pynostr.key import PrivateKey  # type: ignore[import-untyped]

    pk = PrivateKey(secrets.token_bytes(32))
    return pk.bech32(), pk.public_key.bech32()


class Hive:
    """One sim bee's connection to the service."""

    def __init__(self, url: str, nsec: str, npub: str, timeout: float = 30.0) -> None:
        self.url = url
        self.nsec = nsec
        self.npub = npub
        self._client = httpx.AsyncClient(timeout=timeout)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def call(self, tool: str, **args: Any) -> dict[str, Any]:
        """One tool call, with a fresh proof. Never raises for a game refusal.

        A refusal is an answer — "another bee is standing there" is the board
        working — so it comes back as data. Only a transport failure is an
        exception, and even that is returned rather than thrown, because one bee
        losing its connection must not stop the other seven playing.
        """
        from tollbooth.identity_proof import create_proof

        body = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": f"{SLUG}_{tool}",
                "arguments": {
                    "npub": self.npub,
                    "dpop_token": create_proof(self.nsec, f"{SLUG}_{tool}"),
                    **args,
                },
            },
        }
        try:
            r = await self._client.post(
                self.url,
                json=body,
                headers={"Accept": "application/json, text/event-stream"},
            )
        except httpx.HTTPError as exc:
            logger.warning("%s: transport failed: %s", tool, exc)
            return {"success": False, "error": str(exc)}

        for line in r.text.splitlines():
            if not line.startswith("data: "):
                continue
            payload = json.loads(line[6:])
            result = payload.get("result") or {}
            if "structuredContent" in result:
                return dict(result["structuredContent"])
            content = (result.get("content") or [{}])[0].get("text")
            if content:
                try:
                    return dict(json.loads(content))
                except (ValueError, TypeError):
                    return {"success": False, "error": content}
            return {"success": False, "error": json.dumps(payload.get("error") or payload)[:300]}
        return {"success": False, "error": f"no answer: {r.text[:200]}"}
