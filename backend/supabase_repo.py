"""PostgreSQL access layer for Supabase-backed transaction sync."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from psycopg.rows import dict_row

from config import SUPABASE_DB_URL


def _connect():
    if not SUPABASE_DB_URL:
        raise ValueError("SUPABASE_DB_URL no configurado")

    import psycopg

    return psycopg.connect(SUPABASE_DB_URL, row_factory=dict_row)


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
        "usuario": row.get("usuario") or "Usuario",
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

    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute("select version, modified_at from get_sync_state()")
            row = cursor.fetchone()

    if row is None:
        raise RuntimeError("No existe estado de sincronización global en la base de datos")

    return {
        "version": str(row["version"]),
        "modified_at": row["modified_at"].isoformat(),
    }


def register_client_seen(client_id: str | None, user_name: str | None = None) -> None:
    """Upsert client presence metadata."""

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

    if not transactions:
        return 0, None

    with _connect() as connection:
        with connection.cursor() as cursor:
            synced = 0
            for tx in transactions:
                source_client_id = tx.get("sourceClientId") or tx.get("source_client_id")
                user_name = tx.get("usuario") or "Usuario"
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
        raise RuntimeError("No se pudo crear la transacción")

    stored = get_transaction(transaction["id"])
    if stored is None:
        raise RuntimeError("La transacción creada no pudo recuperarse")
    return stored, version


def update_transaction(transaction_id: str, transaction: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    """Update an existing transaction."""

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
                    payload.get("usuario") or "Usuario",
                    payload.get("sourceClientId") or payload.get("source_client_id"),
                    payload.get("updatedBy") or payload.get("updated_by") or payload.get("usuario") or "Usuario",
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