"""
models.py - Pydantic models for request/response validation.
"""
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional
from enum import Enum


class TransactionType(str, Enum):
    """Allowed transaction types."""
    INGRESO = "ingreso"
    GASTO = "gasto"


class Category(str, Enum):
    """Allowed transaction categories."""
    AGRICULTURA = "agricultura"
    ENGORDA = "engorda"
    SIERRA = "sierra"
    GENERAL = "general"


class PaymentMethod(str, Enum):
    """Allowed payment methods."""
    EFECTIVO = "efectivo"
    TRANSFERENCIA = "transferencia"
    TARJETA = "tarjeta"
    CHEQUE = "cheque"


class ReportGenerationMode(str, Enum):
    """How a cash-flow report was generated."""

    MANUAL = "manual"
    SCHEDULED = "scheduled"


class TransactionIn(BaseModel):
    """Transaction received from the frontend."""
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(..., min_length=1, description="UUID from client")
    tipo: TransactionType
    monto: float = Field(..., gt=0, description="Amount in MXN")
    fecha: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    descripcion: Optional[str] = ""
    categoria: Category = Category.GENERAL
    metodoPago: PaymentMethod = Field(default=PaymentMethod.EFECTIVO, alias="metodo_pago")
    usuario: Optional[str] = "User"
    createdAt: Optional[str] = Field(default=None, alias="created_at")
    updatedAt: Optional[str] = Field(default=None, alias="updated_at")
    deletedAt: Optional[str] = Field(default=None, alias="deleted_at")
    syncVersion: Optional[int] = Field(default=None, alias="sync_version")
    sourceClientId: Optional[str] = Field(default=None, alias="source_client_id")
    createdBy: Optional[str] = Field(default=None, alias="created_by")
    updatedBy: Optional[str] = Field(default=None, alias="updated_by")


class TransactionOut(TransactionIn):
    """Transaction returned by the sync API with server metadata."""
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    comprobanteUrl: Optional[str] = Field(default=None, alias="comprobante_url")


class SyncRequest(BaseModel):
    """Batch of transactions to sync."""
    transactions: list[TransactionIn] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="1-100 transactions per sync batch",
    )


class LoginRequest(BaseModel):
    """Login request used to validate the shared app token."""

    token: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    """Simple validation response for the shared app token."""

    valid: bool


class SyncResponse(BaseModel):
    """Response after syncing."""
    synced: int
    message: str
    version: Optional[str] = None


class SyncStateResponse(BaseModel):
    """Version stamp used by clients to skip unnecessary pulls."""

    version: str
    modified_at: str
    provider: str


class TransactionListResponse(BaseModel):
    """List response for incremental pull implementations."""

    transactions: list[TransactionOut]
    total: int
    version: Optional[str] = None


class TransactionSummary(BaseModel):
    """Single transaction response."""

    transaction: TransactionOut


class DeleteResponse(BaseModel):
    """Response for soft-delete operations."""

    deleted: bool
    version: Optional[str] = None


class SummaryResponse(BaseModel):
    """Period summary."""
    totalIngresos: float
    totalGastos: float
    balance: float
    transacciones: int


class ReportScheduleUpdateRequest(BaseModel):
    """Update the globally shared next report date."""

    model_config = ConfigDict(populate_by_name=True)

    nextReportDate: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$", alias="next_report_date")
    updatedBy: Optional[str] = Field(default=None, alias="updated_by")


class ReportScheduleResponse(BaseModel):
    """Current state of the shared cash-flow report schedule."""

    nextReportDate: Optional[str] = Field(default=None, alias="next_report_date")
    updatedAt: Optional[str] = Field(default=None, alias="updated_at")
    updatedBy: Optional[str] = Field(default=None, alias="updated_by")
    needsAttention: bool = Field(default=False, alias="needs_attention")
    generatedReportId: Optional[str] = Field(default=None, alias="generated_report_id")
    generatedReportDate: Optional[str] = Field(default=None, alias="generated_report_date")


class CashFlowReportTransaction(TransactionOut):
    """Transaction snapshot embedded inside a stored cash-flow report."""


class CashFlowReportOut(BaseModel):
    """Stored cash-flow report snapshot."""

    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: str = Field(..., min_length=1)
    reportDate: str = Field(..., alias="report_date")
    periodStart: str = Field(..., alias="period_start")
    periodEnd: str = Field(..., alias="period_end")
    openingBalance: float = Field(..., alias="opening_balance")
    totalIngresos: float = Field(..., alias="total_ingresos")
    totalGastos: float = Field(..., alias="total_gastos")
    closingBalance: float = Field(..., alias="closing_balance")
    transactionCount: int = Field(..., alias="transaction_count")
    generationMode: ReportGenerationMode = Field(..., alias="generation_mode")
    generatedBy: Optional[str] = Field(default=None, alias="generated_by")
    createdAt: Optional[str] = Field(default=None, alias="created_at")
    updatedAt: Optional[str] = Field(default=None, alias="updated_at")
    syncVersion: Optional[int] = Field(default=None, alias="sync_version")
    snapshotData: dict = Field(default_factory=dict, alias="snapshot_data")


class CashFlowReportListResponse(BaseModel):
    """List of stored cash-flow reports."""

    reports: list[CashFlowReportOut]
    total: int
    version: Optional[str] = None


class GenerateCashFlowReportRequest(BaseModel):
    """Manual cash-flow report generation request."""

    model_config = ConfigDict(populate_by_name=True)

    reportDate: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$", alias="report_date")
    generatedBy: Optional[str] = Field(default=None, alias="generated_by")


class CashFlowReportSummary(BaseModel):
    """Response payload for generated cash-flow reports."""

    report: CashFlowReportOut
    version: Optional[str] = None
