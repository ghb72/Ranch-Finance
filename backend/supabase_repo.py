"""Minimal PostgreSQL access layer for Supabase-backed sync features."""

from __future__ import annotations

from config import SUPABASE_DB_URL


def get_sync_state() -> dict[str, str]:
    """Read the global sync state from PostgreSQL.

    The SQL schema exposes a get_sync_state() database function so the backend
    can start using Supabase incrementally before the full repository layer
    exists.
    """

    if not SUPABASE_DB_URL:
        raise ValueError("SUPABASE_DB_URL no configurado")

    import psycopg

    with psycopg.connect(SUPABASE_DB_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select version, modified_at from get_sync_state()")
            row = cursor.fetchone()

    if row is None:
        raise RuntimeError("No existe estado de sincronización global en la base de datos")

    version, modified_at = row
    return {
        "version": str(version),
        "modified_at": modified_at.isoformat(),
    }