# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend

```bash
cd frontend
pnpm install          # install deps and not use npm
pnpm run dev          # dev server at http://localhost:5173
pnpm run build        # production build (outputs to frontend/dist/)
pnpm run preview      # preview the production build
```

Set `VITE_API_URL` in `frontend/.env` to the backend URL (e.g. `http://localhost:8000`). Multiple comma-separated URLs are supported for local fallback resolution.

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Or with Conda (recommended for better dependency management):

```bash
conda env create -f environment.yml
conda activate ranch-finance
uvicorn main:app --reload --port 8000
```

Required backend env vars in `backend/.env`: `DATA_PROVIDER=supabase`, `AUTH_TOKEN`, and either `SUPABASE_DB_URL` (pooler DSN preferred) or `SUPABASE_URL` + `SUPABASE_KEY`.

Set `BACKEND_DEBUG=true` to expose exception details in API error responses.

## Architecture

### Frontend (Vanilla JS PWA, no framework)

- **Entry**: `frontend/main.js` — bootstraps the app, registers sync listeners, routes initial view
- **Router**: `frontend/router.js` — lightweight SPA router mapping hash paths to view modules
- **Views**: `frontend/views/` — `home.js`, `form.js`, `reports.js`, `settings.js` — each exports a render function
- **DB layer**: `frontend/db.js` — Dexie.js (IndexedDB) wrapper; all local reads/writes go through here
- **Sync engine**: `frontend/sync.js` — bidirectional offline-first sync; push pending → pull remote (incremental by `syncVersion`)
- **Auth**: `frontend/auth.js` — stores a shared `AUTH_TOKEN` in `localStorage`; all API calls go through `apiFetch()` which injects the Bearer token and handles 401s

### Sync model

Local transactions are written to IndexedDB with `synced=0`. On sync:
1. Push: `POST /api/sync` sends all `synced=0` records; response returns the new `syncVersion`
2. Pull: `GET /api/transactions?since_version=N&include_deleted=true` fetches only records newer than the last known version
3. `upsertRemoteTransaction` skips records with pending local edits (`synced=0`) to avoid overwriting uncommitted changes

Sync runs on: page load, tab focus/visibility restore, `online` event, and a 60-second poll (paused when tab is hidden).

Custom events on `window` communicate sync state to views: `sync-status` (syncing/synced/offline) and `sync-complete`.

### Backend (FastAPI + Supabase)

- **`main.py`** — all API routes; delegates DB work to `supabase_repo.py`
- **`supabase_repo.py`** — all Supabase access; supports two modes: `psycopg` via `SUPABASE_DB_URL` (preferred) or HTTPS via `SUPABASE_URL`/`SUPABASE_KEY`
- **`auth.py`** — `require_AUTH_TOKEN` FastAPI dependency that validates `Bearer <AUTH_TOKEN>` header
- **`config.py`** — reads env vars; imported by both `main.py` and `supabase_repo.py`
- **`models.py`** — Pydantic request/response models

### Database schema

Schema lives in `backend/sql/supabase_schema.sql`. Key design points:
- Soft deletes: `deletedAt` column, records are never hard-deleted from the backend
- Incremental sync: `syncVersion` is a monotonically increasing integer bumped by Postgres triggers on every write
- `sourceClientId` tracks which PWA client originated each transaction

### Authentication

Single shared `AUTH_TOKEN` for all users. The frontend stores the token in `localStorage` after validating it via `POST /api/auth/login`. There is no per-user session; the token identifies the app, not individual users. The `usuario` field on transactions identifies who recorded each entry.
