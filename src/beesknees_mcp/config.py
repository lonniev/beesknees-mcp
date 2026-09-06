"""Settings for the beesknees race service.

With nsec-only bootstrap, Settings contains only the operator's Nostr
identity and tuning parameters with sensible defaults.  All secrets
(BTCPay, etc.) are delivered via Secure Courier credential templates.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Environment-driven configuration.

    Only one env var is required to boot: TOLLBOOTH_NOSTR_OPERATOR_NSEC.
    Everything else has sensible defaults or is delivered via Secure Courier.
    """

    # ── Nostr identity (one env var to boot) ─────────────────────────
    tollbooth_nostr_operator_nsec: str | None = None

    # ── Credit economics (tuning with defaults) ──────────────────────
    seed_balance_sats: int = 25
    credit_ttl_seconds: int = 604800  # 7 days

    # ── Constraint Engine (opt-in) ───────────────────────────────────
    constraints_enabled: bool = False
    constraints_config: str | None = None  # JSON string

    # ── Nostr relays (optional override) ─────────────────────────────
    tollbooth_nostr_relays: str | None = None

    model_config = {"env_prefix": "", "env_file": ".env"}


# Lazy singleton — avoids loading env vars at import time.
_settings: Settings | None = None


def get_settings() -> Settings:
    """Return the cached Settings singleton."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
