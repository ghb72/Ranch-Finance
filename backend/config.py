"""Application configuration helpers for backend data providers."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent

# Load backend-local dotenv files before reading environment variables so
# module-level constants reflect local development configuration.
load_dotenv(BASE_DIR / '.env')
load_dotenv(BASE_DIR / '.env.development')


DATA_PROVIDER = os.getenv("DATA_PROVIDER", "supabase").strip().lower() or "supabase"
SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL", "").strip()
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()


def is_supabase_enabled() -> bool:
    """Return whether the backend has any usable Supabase server configuration."""
    return bool(SUPABASE_DB_URL or (SUPABASE_URL and SUPABASE_KEY))


def get_data_provider() -> str:
    """Return the configured persistence provider."""
    if DATA_PROVIDER in {"sheets", "supabase"}:
        return DATA_PROVIDER
    return "supabase"