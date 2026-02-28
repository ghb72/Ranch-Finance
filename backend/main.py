"""
main.py - FastAPI backend for RanchoFinanzas

Handles sync between the PWA and Google Sheets.

Usage:
    uvicorn main:app --reload --port 8000
"""
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
import logging

from dotenv import load_dotenv
from models import SyncRequest, SyncResponse, SummaryResponse

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


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

# CORS configuration
# - Dev: ALLOWED_ORIGINS=* (credentials disabled)
# - Prod: explicit origins (credentials enabled)
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "*")
allowed_origins = [
    origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()
]

if not allowed_origins:
    allowed_origins = ["*"]

allow_all_origins = "*" in allowed_origins
allow_credentials = not allow_all_origins
allowed_origin_regex = os.getenv("ALLOWED_ORIGIN_REGEX")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all_origins else allowed_origins,
    allow_origin_regex=allowed_origin_regex,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Routes ---

@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "RanchoFinanzas API",
        "version": "1.0.0",
    }


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
