"""
models.py - Pydantic models for request/response validation.
"""
from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class TransactionType(str, Enum):
    """Allowed transaction types."""
    INGRESO = "ingreso"
    GASTO = "gasto"


class PaymentMethod(str, Enum):
    """Allowed payment methods."""
    EFECTIVO = "efectivo"
    TRANSFERENCIA = "transferencia"
    TARJETA = "tarjeta"
    CHEQUE = "cheque"


class TransactionIn(BaseModel):
    """Transaction received from the frontend."""
    id: str = Field(..., min_length=1, description="UUID from client")
    tipo: TransactionType
    monto: float = Field(..., gt=0, description="Amount in MXN")
    fecha: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    descripcion: Optional[str] = ""
    metodoPago: PaymentMethod = PaymentMethod.EFECTIVO
    usuario: Optional[str] = "Usuario"
    createdAt: Optional[str] = None


class SyncRequest(BaseModel):
    """Batch of transactions to sync."""
    transactions: list[TransactionIn] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="1-100 transactions per sync batch",
    )


class SyncResponse(BaseModel):
    """Response after syncing."""
    synced: int
    message: str


class SummaryResponse(BaseModel):
    """Period summary."""
    totalIngresos: float
    totalGastos: float
    balance: float
    transacciones: int
