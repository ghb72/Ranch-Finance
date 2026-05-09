"""
main.py - FastAPI backend for RanchoFinanzas

Handles sync between the PWA and Supabase.

Usage:
    uvicorn main:app --reload --port 8000
"""
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from contextlib import asynccontextmanager
import os
import logging

from dotenv import load_dotenv
from auth import is_valid_AUTH_TOKEN, require_AUTH_TOKEN
from config import get_data_provider, is_supabase_enabled
from models import (
    DeleteResponse,
    LoginRequest,
    LoginResponse,
    SyncRequest,
    SyncResponse,
    SyncStateResponse,
    SummaryResponse,
    TransactionIn,
    TransactionListResponse,
    TransactionOut,
    TransactionSummary,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


# --- Custom CORS middleware (replaces Starlette CORSMiddleware) ---

ALLOWED_ORIGINS_RAW = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = [
    o.strip() for o in ALLOWED_ORIGINS_RAW.split(",") if o.strip()
] or ["*"]

logger.info("CORS allow_origins = %s", ALLOWED_ORIGINS)


class CORSMiddleware(BaseHTTPMiddleware):
    """Manual CORS handler to guarantee headers on every response."""

    async def dispatch(self, request: Request, call_next):
        origin = request.headers.get("origin", "*")

        # Determine allowed origin header value
        if "*" in ALLOWED_ORIGINS:
            allow_origin = "*"
        elif origin in ALLOWED_ORIGINS:
            allow_origin = origin
        else:
            allow_origin = "*"  # permissive fallback

        # Handle preflight OPTIONS immediately
        if request.method == "OPTIONS":
            return Response(
                status_code=204,
                headers={
                    "Access-Control-Allow-Origin": allow_origin,
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Max-Age": "86400",
                },
            )

        # Process normal request and inject CORS headers
        response = await call_next(request)
        response.headers["Access-Control-Allow-Origin"] = allow_origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "*"
        return response


# --- App setup ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown events."""
    logger.info("Finance PWA Backend starting...")
    yield
    logger.info("Finance PWA Backend stopped.")


app = FastAPI(
    title="RanchoFinanzas API",
    description="Backend for syncing the RanchoFinanzas PWA with Supabase",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(CORSMiddleware)


def ensure_supabase_ready() -> None:
    """Fail fast when the backend is not configured for Supabase."""

    provider = get_data_provider()
    if provider != "supabase":
        raise HTTPException(
            status_code=500,
            detail="The backend no longer uses the legacy provider. Set DATA_PROVIDER=supabase.",
        )
    if not is_supabase_enabled():
        raise HTTPException(
            status_code=503,
            detail="Supabase is not configured. Set SUPABASE_DB_URL or SUPABASE_URL with SUPABASE_KEY.",
        )


# --- Routes ---

@app.api_route("/", methods=["GET", "HEAD"])
async def root():
    """Root endpoint for platform health checks (GET + HEAD)."""
    return {"status": "ok", "service": "RanchoFinanzas API"}


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "RanchoFinanzas API",
        "version": "1.0.0",
        "data_provider": get_data_provider(),
        "supabase_configured": is_supabase_enabled(),
    }


@app.post("/api/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Validate the shared access token without creating a session."""

    return LoginResponse(valid=is_valid_AUTH_TOKEN(request.token))


@app.get("/api/sync/state", response_model=SyncStateResponse)
async def get_sync_state(_auth: str = Depends(require_AUTH_TOKEN)):
    """Return the current remote sync state.

    Supabase is the only supported source of truth for synchronization.
    """

    ensure_supabase_ready()
    try:
        from supabase_repo import get_sync_state as get_supabase_sync_state

        sync_state = get_supabase_sync_state()
        return SyncStateResponse(
            version=sync_state["version"],
            modified_at=sync_state["modified_at"],
            provider="supabase",
        )
    except ModuleNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail="Install backend requirements to enable Supabase access from the backend.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error fetching sync state")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/sync", response_model=SyncResponse)
async def sync_transactions(request: SyncRequest, _auth: str = Depends(require_AUTH_TOKEN)):
    """
    Receive pending transactions from the PWA and upsert them in Supabase.
    """
    ensure_supabase_ready()

    try:
        from supabase_repo import upsert_transactions

        transactions_data = [t.model_dump(by_alias=False) for t in request.transactions]
        synced_count, version = upsert_transactions(transactions_data)
        logger.info("Synced %d transaction(s)", synced_count)

        return SyncResponse(
            synced=synced_count,
            message=f"✅ {synced_count} transaction(s) synced",
            version=version,
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Sync error")
        raise HTTPException(
            status_code=500,
            detail=f"Synchronization error: {exc}",
        ) from exc


@app.get("/api/transactions", response_model=TransactionListResponse, response_model_by_alias=False)
async def get_transactions(
    _auth: str = Depends(require_AUTH_TOKEN),
    start_date: str = Query(None, description="YYYY-MM-DD"),
    end_date: str = Query(None, description="YYYY-MM-DD"),
    since_version: int = Query(None, description="Only return records with sync_version greater than this value"),
    include_deleted: bool = Query(False, description="Include soft-deleted records in the result"),
):
    """
    Get transactions from Supabase.
    """
    ensure_supabase_ready()

    try:
        from supabase_repo import list_transactions

        transactions, version = list_transactions(
            start_date=start_date,
            end_date=end_date,
            since_version=since_version,
            include_deleted=include_deleted,
        )
        return TransactionListResponse(
            transactions=[TransactionOut.model_validate(transaction) for transaction in transactions],
            total=len(transactions),
            version=version,
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error fetching transactions")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/transactions/{transaction_id}", response_model=TransactionSummary, response_model_by_alias=False)
async def get_transaction(transaction_id: str, _auth: str = Depends(require_AUTH_TOKEN)):
    """Get a single transaction from Supabase."""

    ensure_supabase_ready()

    try:
        from supabase_repo import get_transaction as repo_get_transaction

        transaction = repo_get_transaction(transaction_id)
        if transaction is None:
            raise HTTPException(status_code=404, detail="Transaction not found")
        return TransactionSummary(transaction=TransactionOut.model_validate(transaction))
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error fetching transaction")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/transactions", response_model=TransactionSummary, response_model_by_alias=False)
async def create_transaction(request: TransactionIn, _auth: str = Depends(require_AUTH_TOKEN)):
    """Create one transaction in Supabase."""

    ensure_supabase_ready()

    try:
        from supabase_repo import create_transaction as repo_create_transaction

        transaction, _version = repo_create_transaction(request.model_dump(by_alias=False))
        return TransactionSummary(transaction=TransactionOut.model_validate(transaction))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error creating transaction")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.put("/api/transactions/{transaction_id}", response_model=TransactionSummary, response_model_by_alias=False)
async def update_transaction(
    transaction_id: str,
    request: TransactionIn,
    _auth: str = Depends(require_AUTH_TOKEN),
):
    """Update one transaction in Supabase."""

    ensure_supabase_ready()

    try:
        from supabase_repo import update_transaction as repo_update_transaction

        transaction, _version = repo_update_transaction(
            transaction_id,
            request.model_dump(by_alias=False),
        )
        if transaction is None:
            raise HTTPException(status_code=404, detail="Transaction not found")
        return TransactionSummary(transaction=TransactionOut.model_validate(transaction))
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error updating transaction")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.delete("/api/transactions/{transaction_id}", response_model=DeleteResponse)
async def delete_transaction(
    transaction_id: str,
    _auth: str = Depends(require_AUTH_TOKEN),
    deleted_by: str = Query(None, description="User performing the delete"),
):
    """Soft-delete one transaction in Supabase."""

    ensure_supabase_ready()

    try:
        from supabase_repo import soft_delete_transaction

        deleted, version = soft_delete_transaction(transaction_id, deleted_by=deleted_by)
        if not deleted:
            raise HTTPException(status_code=404, detail="Transaction not found")
        return DeleteResponse(deleted=True, version=version)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error deleting transaction")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/summary", response_model=SummaryResponse)
async def get_summary(
    _auth: str = Depends(require_AUTH_TOKEN),
    start_date: str = Query(None, description="YYYY-MM-DD"),
    end_date: str = Query(None, description="YYYY-MM-DD"),
):
    """Get a financial summary for a date range."""
    ensure_supabase_ready()

    try:
        from supabase_repo import get_summary as repo_get_summary

        summary = repo_get_summary(start_date=start_date, end_date=end_date)
        return SummaryResponse(
            totalIngresos=float(summary["totalIngresos"]),
            totalGastos=float(summary["totalGastos"]),
            balance=float(summary["balance"]),
            transacciones=int(summary["transacciones"]),
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error computing summary")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
