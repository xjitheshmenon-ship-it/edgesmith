# CPCMS — Configurable Production Cycle Management System
### Edgesmith Tooling India Pvt Ltd

**Standalone webapp** — Node.js (Express) + PostgreSQL backend · React 18 + TypeScript + Tailwind frontend.

The backend is a stateless REST API (raw SQL via `pg`, numbered migrations, JWT auth,
RBAC + audit log, in-process background jobs). It replaces the manufacturing module of
Odoo for the Dharmapuri production floor and Faridabad raw-material tracking.

---

## Quick Start (Docker)

```bash
cp .env.example .env
docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- Health: http://localhost:8000/api/v1/health

## Local development (without Docker)

```bash
# Backend (needs a local PostgreSQL on 5432)
cd backend
npm install
cp .env.example .env          # edit DATABASE_URL / SECRET_KEY
npm run migrate               # apply numbered SQL migrations
npm run seed                  # seed master data, EAT cycle, default users
npm start                     # → http://localhost:8000

# Frontend
cd frontend
npm install
npm run dev                   # → http://localhost:3000 (proxies /api to :8000)
```

On `npm start` the server also runs migrations + seed automatically, so a fresh
database is ready without separate steps.

## Default Accounts

| Username    | Password   | Role                |
|-------------|------------|---------------------|
| admin       | admin123   | Admin               |
| manager1    | manager123 | Manager             |
| supervisor1 | super123   | Supervisor (Dharmapuri) |
| supervisor2 | super123   | Supervisor (Faridabad)  |
| operator1   | op123      | Operator (Dharmapuri)   |
| operator2   | op123      | Operator (Faridabad)    |
| service1    | svc123     | Service             |
| shopfloor   | floor123   | Shopfloor display   |

## Environment variables

**Backend** (`backend/.env`)

| Var | Purpose |
|-----|---------|
| `NODE_ENV` | `development` / `production` |
| `PORT` | API port (default 8000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `SECRET_KEY` | JWT signing secret (use a long random value in prod) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token lifetime (default 480 = 8h) |
| `CORS_ORIGINS` | Comma-separated allowed origins |

**Frontend** — `VITE_API_URL` (base URL of the backend; omit to use the dev proxy).

## Architecture

```
edgesmith/
├── backend/                 # Node.js (Express) + PostgreSQL
│   ├── app.js               # entry point: migrate → seed → start
│   ├── migrations/          # numbered SQL + runner (npm run migrate)
│   ├── seeds/               # seed master data + 27-step EAT cycle (npm run seed)
│   └── src/
│       ├── config/          # env config
│       ├── db/              # pg pool + raw-SQL helpers (query/one/tx)
│       ├── middleware/      # auth (JWT), rbac, audit, error handling
│       ├── routes/          # one router per resource group (/api/*)
│       ├── services/        # UID generation, step completion, converting, versioning
│       ├── utils/           # shared serializers
│       └── jobs/            # in-process cron background jobs
├── frontend/                # React 18 + TypeScript + Tailwind
└── docker-compose.yml
```

## Production cycle

The EAT cycle is **27 steps** (plus the 16B child-marking sub-step), pre-loaded from
the CPCMS spec, including the four tempering operations on HT90
(Tempering 1, 2, 3, and 4 — Stress Relief). SWAN and OVEN are seeded as placeholders
and configured by Admin via the Cycle Builder. Cycle edits create a new version;
in-progress UIDs keep the version they were created on.

## How to run / update migrations

```bash
cd backend
npm run migrate      # applies any new backend/migrations/*.sql not yet recorded
```

Migrations are tracked in a `schema_migrations` table and applied in filename order,
each in its own transaction. Add new schema changes as `002_*.sql`, `003_*.sql`, etc.

## Deployment

### Render (current test environment)
`render.yaml` provisions a Docker web service + free PostgreSQL. The backend's
`Dockerfile` builds the Node app; migrations and seed run on boot. Health check at
`/api/v1/health`.

### Hetzner / PM2 (future production — see CPCMS Technical Instructions)
`backend/ecosystem.config.js` provides a PM2 cluster config. Deploy steps:
build the frontend (`npm run build` → static files served by nginx), copy the backend,
`npm install --omit=dev`, `npm run migrate`, then `pm2 start ecosystem.config.js`.

## Odoo relationship

MO numbers originate in Odoo and are entered manually for now. The data layer keeps
`mo_number` as a string that maps to Odoo's `sale.order` / `mrp.production`, and every
step completion is logged with workstation + timestamp, so an Odoo sync module can be
added later without restructuring the core tables. No API calls today.

See `docs/api.md` for the full endpoint reference, and
`docs/CPCMS_Rules_Calculations.md` for the business rule book (UID, cycle,
furnace, grinding, badge, shift, and calculation rules).
