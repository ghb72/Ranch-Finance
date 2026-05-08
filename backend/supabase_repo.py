"""Supabase-backed repository for transaction sync and reporting."""

from __future__ import annotations

import socket
from datetime import UTC, date, datetime
from decimal import Decimal
from functools import lru_cache
from typing import Any
from urllib.parse import urlparse

from config import SUPABASE_DB_URL, SUPABASE_KEY, SUPABASE_URL


def _has_http_config() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)


def _has_db_config() -> bool:
    return bool(SUPABASE_DB_URL)


def _is_direct_supabase_host(hostname: str) -> bool:
    return hostname.startswith("db.") and hostname.endswith(".supabase.co")


def _has_ipv4_address(hostname: str) -> bool:
    try:
        records = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return False

    return any(record[0] == socket.AF_INET for record in records)


def _raise_missing_config() -> None:
    raise ValueError(
        "Supabase is not configured. Set SUPABASE_DB_URL or SUPABASE_URL with SUPABASE_KEY."
    )


def _raise_db_connection_error(exc: Exception) -> None:
    if "[" in SUPABASE_DB_URL and "]" in SUPABASE_DB_URL and "@db." in SUPABASE_DB_URL:
        raise ValueError(
            "SUPABASE_DB_URL looks malformed. Remove the square brackets around the database "
            "password placeholder, then use the Supabase pooler connection string instead of the "
            "direct db.<project>.supabase.co:5432 host in IPv4-only environments."
        ) from exc

    parsed = urlparse(SUPABASE_DB_URL)
    hostname = parsed.hostname or ""
    port = parsed.port or 5432

    if port == 5432 and _is_direct_supabase_host(hostname) and not _has_ipv4_address(hostname):
        raise ValueError(
            "SUPABASE_DB_URL is using the direct Supabase database host on port 5432, "
            "but this environment only resolves that host over IPv6. Replace it with the "
            "Supabase pooler connection string from Connect -> Session mode or use "
            "SUPABASE_URL and SUPABASE_KEY for HTTPS access."
        ) from exc

    raise ValueError(f"Could not connect to Supabase PostgreSQL: {exc}") from exc


def _connect():
    if not _has_db_config():
        _raise_missing_config()

    import psycopg
    from psycopg.rows import dict_row

    try:
        return psycopg.connect(SUPABASE_DB_URL, row_factory=dict_row)
    except psycopg.OperationalError as exc:
        _raise_db_connection_error(exc)


@lru_cache(maxsize=1)
def _get_supabase_client():
    if not _has_http_config():
        _raise_missing_config()

    try:
        from supabase import Client, create_client
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "The supabase package is required for HTTPS access. Install backend requirements first."
        ) from exc

    client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return client


def _prefer_http_api() -> bool:
    return _has_http_config() and not _has_db_config()


def _coerce_int(value: Any) -> int | None:
    if value is None:
        return None
    return int(value)


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def _normalize_transaction_payload(transaction: dict[str, Any]) -> dict[str, Any]:
    user_name = transaction.get("usuario") or "User"

    return {
        "id": transaction["id"],
        "tipo": transaction["tipo"],
        "monto": transaction["monto"],
        "fecha": transaction["fecha"],
        "descripcion": transaction.get("descripcion") or "",
        "categoria": transaction.get("categoria") or "general",
        "metodo_pago": transaction.get("metodoPago") or transaction.get("metodo_pago") or "efectivo",
        "usuario": user_name,
        "source_client_id": transaction.get("sourceClientId") or transaction.get("source_client_id"),
        "created_by": transaction.get("createdBy") or transaction.get("created_by") or user_name,
        "updated_by": transaction.get("updatedBy") or transaction.get("updated_by") or user_name,
        "created_at": transaction.get("createdAt") or transaction.get("created_at") or _utcnow_iso(),
        "updated_at": transaction.get("updatedAt") or transaction.get("updated_at") or transaction.get("createdAt") or transaction.get("created_at") or _utcnow_iso(),
        "deleted_at": transaction.get("deletedAt") or transaction.get("deleted_at"),
    }


def _http_get_sync_state() -> dict[str, str]:
    client = _get_supabase_client()
    response = client.rpc("get_sync_state", {"sync_scope": "global"}).execute()
    rows = response.data or []
    if not rows:
        raise RuntimeError("The global synchronization state does not exist in the database")

    row = rows[0]
    return {
        "version": str(row["version"]),
        "modified_at": row["modified_at"],
    }


def _http_get_global_version() -> str | None:
    return _http_get_sync_state().get("version")


def _http_list_transactions(
    start_date: str | None = None,
    end_date: str | None = None,
    since_version: int | None = None,
    include_deleted: bool = False,
) -> tuple[list[dict[str, Any]], str | None]:
    client = _get_supabase_client()
    query = (
        client.table("transactions")
        .select(
            "id,tipo,monto,fecha,descripcion,categoria,metodo_pago,usuario,created_at,updated_at,deleted_at,sync_version,source_client_id,created_by,updated_by"
        )
        .order("fecha", desc=True)
        .order("created_at", desc=True)
    )

    if start_date:
        query = query.gte("fecha", start_date)
    if end_date:
        query = query.lte("fecha", end_date)
    if since_version is not None:
        query = query.gt("sync_version", since_version)
    if not include_deleted:
        query = query.is_("deleted_at", "null")

    response = query.execute()
    rows = response.data or []
    version = _http_get_global_version()
    return ([_serialize_transaction_row(row) for row in rows], version)


def _http_get_transaction(transaction_id: str) -> dict[str, Any] | None:
    client = _get_supabase_client()
    response = (
        client.table("transactions")
        .select(
            "id,tipo,monto,fecha,descripcion,categoria,metodo_pago,usuario,created_at,updated_at,deleted_at,sync_version,source_client_id,created_by,updated_by"
        )
        .eq("id", transaction_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    if not rows:
        return None
    return _serialize_transaction_row(rows[0])


def _http_upsert_transactions(transactions: list[dict[str, Any]]) -> tuple[int, str | None]:
    if not transactions:
        return 0, None

    client = _get_supabase_client()

    clients_payload: list[dict[str, Any]] = []
    for transaction in transactions:
        source_client_id = transaction.get("sourceClientId") or transaction.get("source_client_id")
        user_name = transaction.get("usuario") or "User"
        if source_client_id:
            clients_payload.append(
                {
                    "client_id": source_client_id,
                    "user_name": user_name,
                    "display_name": user_name,
                    "last_seen_at": _utcnow_iso(),
                }
            )

    if clients_payload:
        client.table("sync_clients").upsert(clients_payload, on_conflict="client_id").execute()

    payload = [_normalize_transaction_payload(transaction) for transaction in transactions]
    client.table("transactions").upsert(payload, on_conflict="id").execute()
    version = _http_get_global_version()
    return len(payload), version


def _http_update_transaction(
    transaction_id: str,
    transaction: dict[str, Any],
) -> tuple[dict[str, Any] | None, str | None]:
    client = _get_supabase_client()
    payload = _normalize_transaction_payload({**transaction, "id": transaction_id})
    payload.pop("created_at", None)
    payload.pop("created_by", None)

    response = client.table("transactions").update(payload).eq("id", transaction_id).execute()
    rows = response.data or []
    if not rows:
        return None, None

    stored = _serialize_transaction_row(rows[0])
    return stored, _http_get_global_version()


def _http_soft_delete_transaction(transaction_id: str, deleted_by: str | None = None) -> tuple[bool, str | None]:
    client = _get_supabase_client()
    existing = (
        client.table("transactions")
        .select("id")
        .eq("id", transaction_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    rows = existing.data or []
    if not rows:
        return False, None

    client.table("transactions").update(
        {
            "deleted_at": _utcnow_iso(),
            "updated_by": deleted_by or None,
            "updated_at": _utcnow_iso(),
        }
    ).eq("id", transaction_id).execute()

    return True, _http_get_global_version()


def _http_get_summary(start_date: str | None = None, end_date: str | None = None) -> dict[str, float | int]:
    transactions, _ = _http_list_transactions(
        start_date=start_date,
        end_date=end_date,
        include_deleted=False,
    )
    total_ingresos = sum(float(tx["monto"]) for tx in transactions if tx["tipo"] == "ingreso")
    total_gastos = sum(float(tx["monto"]) for tx in transactions if tx["tipo"] == "gasto")

    return {
        "totalIngresos": total_ingresos,
        "totalGastos": total_gastos,
        "balance": total_ingresos - total_gastos,
        "transacciones": len(transactions),
    }


def _isoformat_nullable(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _serialize_transaction_row(row: dict[str, Any]) -> dict[str, Any]:
    amount = row["monto"]
    if isinstance(amount, Decimal):
        amount = float(amount)

    tx_date = row["fecha"]
    if isinstance(tx_date, date):
        tx_date = tx_date.isoformat()
    else:
        tx_date = str(tx_date)

    return {
        "id": str(row["id"]),
        "tipo": row["tipo"],
        "monto": amount,
        "fecha": tx_date,
        "descripcion": row.get("descripcion") or "",
        "categoria": row.get("categoria") or "general",
        "metodoPago": row.get("metodo_pago") or "efectivo",
        "usuario": row.get("usuario") or "User",
        "createdAt": _isoformat_nullable(row.get("created_at")),
        "updatedAt": _isoformat_nullable(row.get("updated_at")),
        "deletedAt": _isoformat_nullable(row.get("deleted_at")),
        "syncVersion": row.get("sync_version"),
        "sourceClientId": row.get("source_client_id"),
        "createdBy": row.get("created_by"),
        "updatedBy": row.get("updated_by"),
    }


def _get_global_version(cursor) -> str | None:
    cursor.execute("select version from sync_state where scope = 'global'")
    row = cursor.fetchone()
    if row is None:
        return None
    return str(row["version"])


def _build_where_clause(
    start_date: str | None,
    end_date: str | None,
    include_deleted: bool,
    since_version: int | None = None,
) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []

    if start_date:
        clauses.append("fecha >= %s")
        params.append(start_date)
    if end_date:
        clauses.append("fecha <= %s")
        params.append(end_date)
    if since_version is not None:
        clauses.append("sync_version > %s")
        params.append(since_version)
    if not include_deleted:
        clauses.append("deleted_at is null")

    if not clauses:
        return "", params
    return f" where {' and '.join(clauses)}", params


def get_sync_state() -> dict[str, str]:
    """Read the global sync state from PostgreSQL."""

    if _prefer_http_api():
        return _http_get_sync_state()

    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute("select version, modified_at from get_sync_state()")
            row = cursor.fetchone()

    if row is None:
        raise RuntimeError("The global synchronization state does not exist in the database")

    return {
        "version": str(row["version"]),
        "modified_at": row["modified_at"].isoformat(),
    }


def register_client_seen(client_id: str | None, user_name: str | None = None) -> None:
    """Upsert client presence metadata."""

    if _prefer_http_api():
        if not client_id:
            return

        client = _get_supabase_client()
        client.table("sync_clients").upsert(
            {
                "client_id": client_id,
                "user_name": user_name,
                "display_name": user_name,
                "last_seen_at": _utcnow_iso(),
            },
            on_conflict="client_id",
        ).execute()
        return

    if not client_id:
        return

    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                insert into sync_clients (client_id, user_name, display_name, last_seen_at)
                values (%s, %s, %s, timezone('utc', now()))
                on conflict (client_id) do update
                set user_name = excluded.user_name,
                    display_name = excluded.display_name,
                    last_seen_at = timezone('utc', now())
                """,
                (client_id, user_name, user_name),
            )
        connection.commit()


def upsert_transactions(transactions: list[dict[str, Any]]) -> tuple[int, str | None]:
    """Insert or update a batch of client transactions."""

    if _prefer_http_api():
        return _http_upsert_transactions(transactions)

    if not transactions:
        return 0, None

    with _connect() as connection:
        with connection.cursor() as cursor:
            synced = 0
            for tx in transactions:
                source_client_id = tx.get("sourceClientId") or tx.get("source_client_id")
                user_name = tx.get("usuario") or "User"
                if source_client_id:
                    cursor.execute(
                        """
                        insert into sync_clients (client_id, user_name, display_name, last_seen_at)
                        values (%s, %s, %s, timezone('utc', now()))
                        on conflict (client_id) do update
                        set user_name = excluded.user_name,
                            display_name = excluded.display_name,
                            last_seen_at = timezone('utc', now())
                        """,
                        (source_client_id, user_name, user_name),
                    )

                cursor.execute(
                    """
                    insert into transactions (
                        id,
                        tipo,
                        monto,
                        fecha,
                        descripcion,
                        categoria,
                        metodo_pago,
                        usuario,
                        source_client_id,
                        created_by,
                        updated_by,
                        created_at,
                        updated_at,
                        deleted_at
                    ) values (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        coalesce(%s::timestamptz, timezone('utc', now())),
                        coalesce(%s::timestamptz, timezone('utc', now())),
                        %s::timestamptz
                    )
                    on conflict (id) do update
                    set tipo = excluded.tipo,
                        monto = excluded.monto,
                        fecha = excluded.fecha,
                        descripcion = excluded.descripcion,
                        categoria = excluded.categoria,
                        metodo_pago = excluded.metodo_pago,
                        usuario = excluded.usuario,
                        source_client_id = excluded.source_client_id,
                        updated_by = excluded.updated_by,
                        updated_at = excluded.updated_at,
                        deleted_at = excluded.deleted_at
                    """,
                    (
                        tx["id"],
                        tx["tipo"],
                        tx["monto"],
                        tx["fecha"],
                        tx.get("descripcion") or "",
                        tx.get("categoria") or "general",
                        tx.get("metodoPago") or tx.get("metodo_pago") or "efectivo",
                        user_name,
                        source_client_id,
                        tx.get("createdBy") or tx.get("created_by") or user_name,
                        tx.get("updatedBy") or tx.get("updated_by") or user_name,
                        tx.get("createdAt") or tx.get("created_at"),
                        tx.get("updatedAt") or tx.get("updated_at") or tx.get("createdAt") or tx.get("created_at"),
                        tx.get("deletedAt") or tx.get("deleted_at"),
                    ),
                )
                synced += 1

            version = _get_global_version(cursor)
        connection.commit()

    return synced, version


def list_transactions(
    start_date: str | None = None,
    end_date: str | None = None,
    since_version: int | None = None,
    include_deleted: bool = False,
) -> tuple[list[dict[str, Any]], str | None]:
    """List transactions ordered by business date descending."""

    if _prefer_http_api():
        return _http_list_transactions(start_date, end_date, since_version, include_deleted)

    where_clause, params = _build_where_clause(start_date, end_date, include_deleted, since_version)

    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                select
                    id,
                    tipo,
                    monto,
                    fecha,
                    descripcion,
                    categoria,
                    metodo_pago,
                    usuario,
                    created_at,
                    updated_at,
                    deleted_at,
                    sync_version,
                    source_client_id,
                    created_by,
                    updated_by
                from transactions
                {where_clause}
                order by fecha desc, created_at desc
                """,
                params,
            )
            rows = cursor.fetchall()
            version = _get_global_version(cursor)

    return ([_serialize_transaction_row(row) for row in rows], version)


def get_transaction(transaction_id: str) -> dict[str, Any] | None:
    """Fetch a single transaction by id."""

    if _prefer_http_api():
        return _http_get_transaction(transaction_id)

    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select
                    id,
                    tipo,
                    monto,
                    fecha,
                    descripcion,
                    categoria,
                    metodo_pago,
                    usuario,
                    created_at,
                    updated_at,
                    deleted_at,
                    sync_version,
                    source_client_id,
                    created_by,
                    updated_by
                from transactions
                where id = %s
                """,
                (transaction_id,),
            )
            row = cursor.fetchone()

    if row is None:
        return None
    return _serialize_transaction_row(row)


def create_transaction(transaction: dict[str, Any]) -> tuple[dict[str, Any], str | None]:
    """Create one transaction and return the stored record."""

    synced, version = upsert_transactions([transaction])
    if synced != 1:
        raise RuntimeError("Failed to create transaction")

    stored = get_transaction(transaction["id"])
    if stored is None:
        raise RuntimeError("The created transaction could not be fetched")
    return stored, version


def update_transaction(transaction_id: str, transaction: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    """Update an existing transaction."""

    if _prefer_http_api():
        return _http_update_transaction(transaction_id, transaction)

    payload = dict(transaction)
    payload["id"] = transaction_id

    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                update transactions
                set tipo = %s,
                    monto = %s,
                    fecha = %s,
                    descripcion = %s,
                    categoria = %s,
                    metodo_pago = %s,
                    usuario = %s,
                    source_client_id = %s,
                    updated_by = %s,
                    updated_at = coalesce(%s::timestamptz, timezone('utc', now())),
                    deleted_at = %s::timestamptz
                where id = %s
                returning
                    id,
                    tipo,
                    monto,
                    fecha,
                    descripcion,
                    categoria,
                    metodo_pago,
                    usuario,
                    created_at,
                    updated_at,
                    deleted_at,
                    sync_version,
                    source_client_id,
                    created_by,
                    updated_by
                """,
                (
                    payload["tipo"],
                    payload["monto"],
                    payload["fecha"],
                    payload.get("descripcion") or "",
                    payload.get("categoria") or "general",
                    payload.get("metodoPago") or payload.get("metodo_pago") or "efectivo",
                    payload.get("usuario") or "User",
                    payload.get("sourceClientId") or payload.get("source_client_id"),
                    payload.get("updatedBy") or payload.get("updated_by") or payload.get("usuario") or "User",
                    payload.get("updatedAt") or payload.get("updated_at"),
                    payload.get("deletedAt") or payload.get("deleted_at"),
                    transaction_id,
                ),
            )
            row = cursor.fetchone()
            version = _get_global_version(cursor) if row is not None else None
        connection.commit()

    if row is None:
        return None, None
    return _serialize_transaction_row(row), version


def soft_delete_transaction(transaction_id: str, deleted_by: str | None = None) -> tuple[bool, str | None]:
    """Soft-delete a transaction."""

    if _prefer_http_api():
        return _http_soft_delete_transaction(transaction_id, deleted_by)

    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                update transactions
                set deleted_at = timezone('utc', now()),
                    updated_by = coalesce(%s, updated_by, usuario)
                where id = %s and deleted_at is null
                returning id
                """,
                (deleted_by, transaction_id),
            )
            row = cursor.fetchone()
            version = _get_global_version(cursor) if row is not None else None
        connection.commit()

    return row is not None, version


def get_summary(start_date: str | None = None, end_date: str | None = None) -> dict[str, float | int]:
    """Compute summary from active transactions."""

    if _prefer_http_api():
        return _http_get_summary(start_date, end_date)

    where_clause, params = _build_where_clause(start_date, end_date, include_deleted=False)

    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                select
                    coalesce(sum(case when tipo = 'ingreso' then monto else 0 end), 0) as total_ingresos,
                    coalesce(sum(case when tipo = 'gasto' then monto else 0 end), 0) as total_gastos,
                    count(*) as transacciones
                from transactions
                {where_clause}
                """,
                params,
            )
            row = cursor.fetchone()

    total_ingresos = row["total_ingresos"]
    total_gastos = row["total_gastos"]
    if isinstance(total_ingresos, Decimal):
        total_ingresos = float(total_ingresos)
    if isinstance(total_gastos, Decimal):
        total_gastos = float(total_gastos)

    return {
        "totalIngresos": float(total_ingresos),
        "totalGastos": float(total_gastos),
        "balance": float(total_ingresos) - float(total_gastos),
        "transacciones": int(row["transacciones"]),
    }