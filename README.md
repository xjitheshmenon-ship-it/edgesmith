# CPCMS — Configurable Production Cycle Management System
### Edgesmith Tooling India Pvt Ltd

**Implementation: Option A — Standalone Webapp**
FastAPI backend · PostgreSQL · React 18 + TypeScript + Tailwind

---

## Quick Start

```bash
cp .env.example .env
docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

## Default Accounts

| Username    | Password     | Role       |
|-------------|--------------|------------|
| admin       | admin123     | Admin      |
| manager1    | manager123   | Manager    |
| supervisor1 | super123     | Supervisor (F1) |
| supervisor2 | super123     | Supervisor (F2) |
| operator1   | op123        | Operator (F1) |
| operator2   | op123        | Operator (F2) |
| service1    | svc123       | Service    |

## Features

### UID Tracking
- 12,000+ UIDs across two factory locations
- Full step history, permanent manufacturing record
- UID lookup for service team (field service calls)
- Bulk create (Manager/Admin) — up to 500 at a time
- Cycle type changeable in bulk before any steps are completed
- Inter-location transfer with reason and timestamp

### Production Cycles
- EAT cycle — 26 steps — fully pre-loaded from spec
- SWAN and OVEN — configured by Admin via interface
- Cycle versioning: edits create new versions, in-progress UIDs follow their original version
- Export/import cycle definitions as JSON (share between locations, offline config, backup)

### Converting (Step 16)
- Parent UID frozen, 2–4 child UIDs created (E042-A, E042-B, etc.)
- Each child can follow a different cycle type
- Conversion patterns (Pattern A, Pattern B) pre-loaded
- Scrap auto-calculated; blocked if negative

### Design Enforcement
- Design must be confirmed before Step 16
- Alert at Step 15 if missing; hold at Step 16 until Manager confirms
- Invalid size-design combinations blocked by system

### Shopfloor Display
- Live workstation and storage counts per location
- Auto-refreshes every 20 seconds — no login required
- Wall-screen ready (open /shopfloor directly)

### Manufacturing Orders
- Create and link MOs to UIDs
- MO number, customer, quantity, size, design

### Role-Based Access
- Admin, Manager, Supervisor, Operator, Service, Shopfloor
- Operators see only their location's queue
- Supervisors and Managers can view both locations
- Service role: read-only UID lookup only

## Architecture

```
edgesmith/
├── backend/          # FastAPI + SQLAlchemy + PostgreSQL
│   └── app/
│       ├── models/   # All DB models (users, factory, cycle, uid, manufacturing)
│       ├── routers/  # REST API routes
│       ├── services/ # Business logic (UID gen, cycle versioning, converting)
│       ├── auth.py   # JWT authentication
│       ├── seed.py   # Initial data (EAT cycle, workstations, designs, users)
│       └── main.py
├── frontend/         # React 18 + TypeScript + Tailwind
│   └── src/
│       ├── pages/    # Dashboard, UIDLookup, Shopfloor, Queue, UIDs, Cycles, Config, Users
│       ├── components/
│       ├── api/      # axios API clients
│       └── types/
└── docker-compose.yml
```

## Odoo Integration

Designed for future Odoo sync. MO numbers are entered manually today.
The data layer is structured so a sync module can be added without restructuring
core tables — MOs reference an `mo_number` string that maps directly to Odoo's
`sale.order` or `mrp.production` record. Step completion events are logged with
full timestamps and workstation references, ready to sync back to Odoo work orders.
