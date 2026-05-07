# 🐄 RanchoFinanzas

App PWA de finanzas para ranchos. Control de ingresos y gastos con sincronización offline-first, backend FastAPI y Google Sheets como integración operativa.

## Características

- **PWA instalable** en Android, iOS y escritorio
- **Offline-first** — funciona sin internet, sincroniza cuando hay conexión
- **Interfaz ultra-simple** — dos botones: Ingreso y Gasto
- **Reportes** — gráficas diarias, semanales y mensuales
- **Google Sheets** — integración operativa y exportación de datos
- **Supabase/Postgres** — fuente de verdad en la nueva arquitectura de sincronización
- **Multi-usuario** — varios usuarios del rancho pueden registrar transacciones

## Inicio Rápido

### Frontend (PWA)

```bash
cd d:\Proyects\Finanzas
npm install
npm run dev
```

Abre http://localhost:5173 en tu navegador.

### Backend (Python)

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

El API corre en http://localhost:8000

### Entorno Local con Conda

```bash
conda env create -f environment.yml
conda activate ranch-finance
cd backend
python main.py
```

Si actualizas [backend/requirements.txt](backend/requirements.txt), recrea el entorno o actualiza sus paquetes para mantenerlo alineado.

### Configurar Google Sheets

1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Crea un proyecto nuevo
3. Habilita la **Google Sheets API** y **Google Drive API**
4. Crea una **cuenta de servicio** y descarga el JSON
5. Guárdalo como `backend/credentials.json`
6. Crea una hoja de cálculo en Google Sheets y compártela con el email de la cuenta de servicio

## Stack Tecnológico

| Componente | Tecnología |
|---|---|
| Frontend | Vite + Vanilla JS |
| PWA | Workbox (vite-plugin-pwa) |
| DB Local | Dexie.js (IndexedDB) |
| Gráficas | Chart.js |
| Backend | FastAPI (Python) |
| Base de datos | Supabase/Postgres + Google Sheets |

## Supabase

El backend ya incluye un esquema inicial para Supabase en [backend/sql/supabase_schema.sql](backend/sql/supabase_schema.sql). Ese archivo crea:

- tabla principal de transacciones
- tabla de auditoría de cambios
- tabla de clientes de sincronización
- tabla global de estado de sincronización
- índices para pulls incrementales
- triggers para updated_at, sync_version y auditoría

Para usarlo en Supabase SQL Editor:

```sql
-- Pega el contenido de backend/sql/supabase_schema.sql y ejecútalo
```

Variables de entorno relevantes en backend:

- DATA_PROVIDER=supabase
- SUPABASE_DB_URL para conexión directa a Postgres
- SUPABASE_URL y SUPABASE_KEY como alternativa para futuras integraciones

## Estructura

```
Finanzas/
├── src/                  # Frontend
│   ├── main.js           # Entrada principal
│   ├── db.js             # IndexedDB
│   ├── sync.js           # Sincronización
│   ├── router.js         # Router SPA
│   ├── utils.js          # Utilidades
│   ├── styles.css        # Estilos
│   └── views/            # Vistas
│       ├── home.js       # Pantalla principal
│       ├── form.js       # Formulario
│       ├── reports.js    # Reportes
│       └── settings.js   # Configuración
├── backend/              # Servidor Python
│   ├── main.py           # FastAPI
│   ├── sheets.py         # Google Sheets
│   ├── models.py         # Modelos
│   └── requirements.txt
├── index.html
├── vite.config.js
└── package.json
```
