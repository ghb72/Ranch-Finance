"""Application configuration helpers for backend data providers."""

from __future__ import annotations

import os


DATA_PROVIDER = os.getenv("DATA_PROVIDER", "sheets").strip().lower() or "sheets"
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()
SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL", "").strip()


def is_supabase_enabled() -> bool:
    """Return whether enough configuration exists to use Supabase."""
    return bool(SUPABASE_DB_URL or (SUPABASE_URL and SUPABASE_KEY))


def get_data_provider() -> str:
    """Return the configured persistence provider."""
    if DATA_PROVIDER in {"sheets", "supabase"}:
        return DATA_PROVIDER
    return "sheets"