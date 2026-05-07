"""
main.py - FastAPI backend for RanchoFinanzas

Handles sync between the PWA and Google Sheets.

Usage:
    uvicorn main:app --reload --port 8000
"""
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from contextlib import asynccontextmanager
import os
import logging

from dotenv import load_dotenv
from config import get_data_provider, is_supabase_enabled
from models import SyncRequest, SyncResponse, SyncStateResponse, SummaryResponse

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
    logger.info("🐄 RanchoFinanzas Backend starting...")
    yield
    logger.info("🐄 RanchoFinanzas Backend stopped.")


app = FastAPI(
    title="RanchoFinanzas API",
    description="Backend for syncing the RanchoFinanzas PWA with Google Sheets",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(CORSMiddleware)


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


@app.get("/api/sync/state", response_model=SyncStateResponse)
async def get_sync_state():
    """Return the current remote sync state.

    During migration, Google Sheets remains the legacy provider. Supabase is
    intentionally gated until its repository layer is implemented.
    """

    provider = get_data_provider()

    if provider == "supabase":
        if not is_supabase_enabled():
            raise HTTPException(
                status_code=503,
                detail="Supabase no configurado. Define SUPABASE_DB_URL o SUPABASE_URL/SUPABASE_KEY.",
            )

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
                detail="Falta la dependencia psycopg para usar Supabase desde el backend.",
            ) from exc
        except ValueError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Error fetching sync state from Supabase")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        from sheets import get_sync_state as get_sheets_sync_state

        sync_state = get_sheets_sync_state()
        return SyncStateResponse(
            version=sync_state["version"],
            modified_at=sync_state["modified_at"],
            provider="sheets",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error fetching sync state")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/sync", response_model=SyncResponse)
async def sync_transactions(request: SyncRequest):
    """
    Receive pending transactions from the PWA and write them to Google Sheets.
    Duplicate IDs are silently skipped.
    """
    try:
        from sheets import append_transactions

        transactions_data = [t.model_dump() for t in request.transactions]
        synced_count = append_transactions(transactions_data)
        logger.info("Synced %d transaction(s)", synced_count)

        return SyncResponse(
            synced=synced_count,
            message=f"✅ {synced_count} transacción(es) sincronizada(s)",
        )
    except FileNotFoundError as exc:
        logger.error("Google Sheets not configured: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=f"Google Sheets no configurado: {exc}",
        ) from exc
    except Exception as exc:
        logger.exception("Sync error")
        raise HTTPException(
            status_code=500,
            detail=f"Error de sincronización: {exc}",
        ) from exc


@app.get("/api/transactions")
async def get_transactions(
    start_date: str = Query(None, description="YYYY-MM-DD"),
    end_date: str = Query(None, description="YYYY-MM-DD"),
):
    """
    Get transactions from Google Sheets.
    Optionally filter by date range.
    """
    try:
        from sheets import get_all_transactions, get_transactions_by_date_range

        if start_date and end_date:
            records = get_transactions_by_date_range(start_date, end_date)
        else:
            records = get_all_transactions()

        normalized = []
        for r in records:
            normalized.append({
                "id": r.get("ID", ""),
                "tipo": r.get("Tipo", ""),
                "monto": float(r.get("Monto", 0)),
                "fecha": r.get("Fecha", ""),
                "descripcion": r.get("Descripción", ""),
                "categoria": r.get("Categoría", "general"),
                "metodoPago": r.get("Método de Pago", "efectivo"),
                "usuario": r.get("Usuario", ""),
                "createdAt": r.get("Creado", ""),
            })

        return {"transactions": normalized, "total": len(normalized)}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error fetching transactions")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/summary", response_model=SummaryResponse)
async def get_summary(
    start_date: str = Query(None, description="YYYY-MM-DD"),
    end_date: str = Query(None, description="YYYY-MM-DD"),
):
    """Get a financial summary for a date range."""
    try:
        from sheets import get_all_transactions, get_transactions_by_date_range

        if start_date and end_date:
            records = get_transactions_by_date_range(start_date, end_date)
        else:
            records = get_all_transactions()

        total_ingresos = 0.0
        total_gastos = 0.0

        for r in records:
            monto = float(r.get("Monto", 0))
            if r.get("Tipo", "").lower() == "ingreso":
                total_ingresos += monto
            else:
                total_gastos += monto

        return SummaryResponse(
            totalIngresos=total_ingresos,
            totalGastos=total_gastos,
            balance=total_ingresos - total_gastos,
            transacciones=len(records),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error computing summary")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
