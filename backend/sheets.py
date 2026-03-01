"""
sheets.py - Google Sheets integration

Handles reading and writing transactions to a Google Spreadsheet.
Uses gspread with service-account credentials.

Setup:
    1. Create a project in Google Cloud Console
    2. Enable Google Sheets API
    3. Create a service account and download credentials.json
    4. Share the spreadsheet with the service account email
"""
import gspread
from google.oauth2.service_account import Credentials
import os
import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

SPREADSHEET_NAME = os.getenv("SPREADSHEET_NAME", "RanchoFinanzas")
CREDENTIALS_FILE = os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json")

HEADERS = [
    "ID", "Tipo", "Monto", "Fecha",
    "Descripción", "Categoría", "Método de Pago",
    "Usuario", "Creado",
]

_client: gspread.Client | None = None
_sheet: gspread.Worksheet | None = None


def _get_credentials() -> Credentials:
    """Get credentials from env var (deploy) or local file (dev)."""
    creds_json = os.getenv("GOOGLE_CREDENTIALS_JSON")
    if creds_json:
        info = json.loads(creds_json)
        return Credentials.from_service_account_info(info, scopes=SCOPES)
    if os.path.exists(CREDENTIALS_FILE):
        return Credentials.from_service_account_file(
            CREDENTIALS_FILE,
            scopes=SCOPES,
        )
    raise FileNotFoundError(
        "No Google credentials found. "
        "Set GOOGLE_CREDENTIALS_JSON env var or provide credentials.json"
    )


def get_client() -> gspread.Client:
    """Get or create a gspread client (singleton)."""
    global _client
    if _client is None:
        creds = _get_credentials()
        _client = gspread.authorize(creds)
        logger.info("Google Sheets client authorized")
    return _client


def get_sheet() -> gspread.Worksheet:
    """Get or create the 'Transacciones' worksheet."""
    global _sheet
    if _sheet is not None:
        return _sheet

    client = get_client()
    try:
        spreadsheet = client.open(SPREADSHEET_NAME)
        logger.info("Opened spreadsheet: %s", SPREADSHEET_NAME)
    except gspread.SpreadsheetNotFound:
        spreadsheet = client.create(SPREADSHEET_NAME)
        logger.info("Created new spreadsheet: %s", SPREADSHEET_NAME)
        share_email = os.getenv("SHARE_EMAIL")
        if share_email:
            spreadsheet.share(share_email, perm_type="user", role="writer")
            logger.info("Shared spreadsheet with %s", share_email)

    try:
        _sheet = spreadsheet.worksheet("Transacciones")
    except gspread.WorksheetNotFound:
        _sheet = spreadsheet.add_worksheet(
            title="Transacciones",
            rows=1000,
            cols=len(HEADERS),
        )
        _sheet.append_row(HEADERS)
        logger.info("Created 'Transacciones' worksheet with headers")

    return _sheet


def append_transactions(transactions: list[dict]) -> int:
    """
    Append transactions to the spreadsheet, skipping duplicates.

    Args:
        transactions: List of transaction dicts from the frontend.

    Returns:
        Number of rows actually added.
    """
    sheet = get_sheet()

    existing_ids: set[str] = set()
    try:
        id_column = sheet.col_values(1)
        existing_ids = set(id_column[1:])  # Skip header
    except Exception:
        logger.warning("Could not read existing IDs, proceeding anyway")

    rows_to_add = []
    for t in transactions:
        if t["id"] in existing_ids:
            continue
        rows_to_add.append([
            t["id"],
            t["tipo"],
            t["monto"],
            t["fecha"],
            t.get("descripcion", ""),
            t.get("categoria", "general"),
            t.get("metodoPago", "efectivo"),
            t.get("usuario", "Usuario"),
            t.get("createdAt", datetime.now().isoformat()),
        ])

    if rows_to_add:
        sheet.append_rows(rows_to_add)
        logger.info("Appended %d row(s) to spreadsheet", len(rows_to_add))

    return len(rows_to_add)


def get_all_transactions() -> list[dict]:
    """Get all transactions from the spreadsheet as list of dicts."""
    sheet = get_sheet()
    return sheet.get_all_records()


def get_transactions_by_date_range(
    start_date: str,
    end_date: str,
) -> list[dict]:
    """Get transactions filtered by date range (YYYY-MM-DD strings)."""
    all_records = get_all_transactions()
    return [
        r for r in all_records
        if start_date <= r.get("Fecha", "") <= end_date
    ]
