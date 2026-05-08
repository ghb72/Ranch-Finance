# 🐄 RanchoFinanzas

A finance PWA for ranch operations. Track income and expenses with offline-first synchronization, a FastAPI backend, and Supabase/Postgres as the source of truth.

## Features

- **Installable PWA** for Android, iOS, and desktop
- **Offline-first** — works without internet and syncs when connectivity returns
- **Ultra-simple interface** — two main actions: Income and Expense
- **Reports** — daily, weekly, monthly, and yearly charts
- **Supabase/Postgres** — source of truth for synchronization and storage
- **Google Sheets** — optional operational integration and data export
- **Multi-user** — multiple ranch users can record transactions

## Sync Architecture

The app uses an offline-first push/pull sync model:

- Local writes are stored first in IndexedDB.
- Pending local changes are pushed to the backend before pulling remote changes.
- Remote pulls are incremental and use the latest sync version.
- Automatic polling runs every 60 seconds while the tab is visible.
- Polling pauses when the tab is hidden and resumes on focus or when connectivity returns.

## Quick Start

### Frontend (PWA)

```bash
cd /home/guill/projects/Ranch-Finance/frontend
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

Frontend environment variables:

- VITE_API_URL with the backend base URL, for example http://localhost:8000
- You can provide more than one backend URL separated by commas for local fallback resolution.

### Backend (Python)

```bash
cp backend/.env.example backend/.env
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API runs at http://localhost:8000

Before starting the backend, configure Supabase in backend/.env:

- Set DATA_PROVIDER=supabase
- Set SUPABASE_DB_URL to the Supabase pooler DSN for normal backend usage
- Or set SUPABASE_URL and SUPABASE_KEY for HTTPS-based backend access

### Local Conda Environment

```bash
conda env create -f environment.yml
conda activate ranch-finance
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

If you update [backend/requirements.txt](backend/requirements.txt), recreate the environment or update its packages to keep it aligned.

### Configure Google Sheets

Google Sheets is no longer the source of truth for synchronization. Configure it only if you want to use the operational export/integration path.

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project
3. Enable the **Google Sheets API** and **Google Drive API**
4. Create a **service account** and download the JSON credentials
5. Save it as `backend/credentials.json`
6. Create a Google Sheet and share it with the service account email

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | Vite + Vanilla JS |
| PWA | Workbox (vite-plugin-pwa) |
| Local DB | Dexie.js (IndexedDB) |
| Charts | Chart.js |
| Backend | FastAPI (Python) |
| Database | Supabase/Postgres |
| Operational export | Google Sheets |

## Supabase

The backend already includes an initial Supabase schema in [backend/sql/supabase_schema.sql](backend/sql/supabase_schema.sql). That file creates:

- main transactions table
- change audit log table
- sync clients table
- global sync state table
- indexes for incremental pulls
- triggers for updated_at, sync_version, and auditing

To use it in the Supabase SQL Editor:

```sql
-- Paste the contents of backend/sql/supabase_schema.sql and execute it
```

Relevant backend environment variables:

- DATA_PROVIDER=supabase
- SUPABASE_DB_URL for the backend PostgreSQL connection
- SUPABASE_URL and SUPABASE_KEY for the backend HTTPS API path
- PORT for the FastAPI server port
- ALLOWED_ORIGINS for backend CORS configuration

The backend supports two server-side Supabase access modes:

- Preferred for stable backend environments: use SUPABASE_DB_URL.
- If your local environment does not have IPv6 connectivity, do not use the direct db....supabase.co:5432 host. Use the Supabase pooler connection string instead.
- If you prefer HTTPS-only server access, set SUPABASE_URL and SUPABASE_KEY and the backend will use the Supabase API instead of psycopg.
- Keep that DSN only in the backend environment, never in the frontend.

Recommended local setup:

- Frontend: use VITE_API_URL in frontend/.env.
- Backend: use the Supabase pooler DSN in backend/.env.
- Do not expose server-side Supabase credentials in the frontend.

## Structure

```
Ranch-Finance/
├── frontend/             # Frontend app root (Vite)
│   ├── index.html        # HTML entry point
│   ├── package.json      # Frontend scripts and deps
│   ├── vite.config.js    # Vite + PWA config
│   ├── public/           # Static assets
│   ├── scripts/          # Frontend utility scripts
│   ├── main.js           # Application entry point
│   ├── db.js             # IndexedDB layer
│   ├── sync.js           # Synchronization engine
│   ├── router.js         # SPA router
│   ├── utils.js          # Utilities
│   ├── styles.css        # Styles
│   └── views/            # Views
│       ├── home.js       # Home screen
│       ├── form.js       # Transaction form
│       ├── reports.js    # Reports
│       └── settings.js   # Settings
├── backend/              # Python server
│   ├── main.py           # FastAPI
│   ├── sheets.py         # Google Sheets
│   ├── models.py         # Data models
│   ├── requirements.txt
│   └── sql/
│       └── supabase_schema.sql
├── environment.yml
└── README.md
```
