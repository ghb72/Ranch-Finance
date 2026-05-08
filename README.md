# 🐄 RanchoFinanzas

A finance PWA for ranch operations. Track income and expenses with offline-first synchronization, a FastAPI backend, and Google Sheets as an operational integration.

## Features

- **Installable PWA** for Android, iOS, and desktop
- **Offline-first** — works without internet and syncs when connectivity returns
- **Ultra-simple interface** — two main actions: Income and Expense
- **Reports** — daily, weekly, monthly, and yearly charts
- **Google Sheets** — operational integration and data export
- **Supabase/Postgres** — source of truth in the new sync architecture
- **Multi-user** — multiple ranch users can record transactions

## Quick Start

### Frontend (PWA)

```bash
cp .env.example .env
cd /home/guill/projects/Ranch-Finance
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

Frontend environment variables:

- VITE_API_URL with the backend base URL, for example http://localhost:8000

### Backend (Python)

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

The API runs at http://localhost:8000

### Local Conda Environment

```bash
conda env create -f environment.yml
conda activate ranch-finance
cd backend
python main.py
```

If you update [backend/requirements.txt](backend/requirements.txt), recreate the environment or update its packages to keep it aligned.

### Configure Google Sheets

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
| Database | Supabase/Postgres + Google Sheets |

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

The backend supports two server-side Supabase access modes:

- Preferred for stable backend environments: use SUPABASE_DB_URL.
- If your local environment does not have IPv6 connectivity, do not use the direct db....supabase.co:5432 host. Use the Supabase pooler connection string instead.
- If you prefer HTTPS-only server access, set SUPABASE_URL and SUPABASE_KEY and the backend will use the Supabase API instead of psycopg.
- Keep that DSN only in the backend environment, never in the frontend.

## Structure

```
Finanzas/
├── src/                  # Frontend
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
│   └── requirements.txt
├── index.html
├── vite.config.js
└── package.json
```
