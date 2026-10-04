# CPCMS — System Architecture (v1.4)
Edgesmith Tooling · two-plant manufacturing execution system · cpcms.edgesmith.in

## 1. Principles
- **Modular monolith now, services never (until forced).** One Node process on one VPS serves everything. A 2-plant, <100-user MES does not need microservices; it needs uptime and a solo-maintainable codebase. Scale path is documented, not prematurely built.
- **The server owns truth.** v1.4 introduces server-persisted state: everything entered in the app survives refresh, device changes, and restarts, and is covered by the existing snapshot backups.
- **Strangler migration.** The 17k-line EdgeUI2.1 frontend keeps running as-is. Each module is ported to real relational endpoints one vertical at a time (Assign first), replacing slices of the synced document with typed tables. No big-bang rewrite.
- **Everything derives from masters.** Products, BOM, cycles are the only sources; storages, intake sizes, roll maps, reorder lines derive. (Already enforced in the UI layer.)

## 2. System architecture

```
                        ┌────────────────────────────────────────────┐
  Browser (any device)  │  Hostinger VPS · Ubuntu 24 · PM2 · nginx   │
 ┌───────────────────┐  │  ┌──────────────────────────────────────┐  │
 │ React SPA (Vite)  │  │  │ Fastify app (Node 20)                │  │
 │  EdgeUI2.1 store  │◄─┼──┤  /api/auth      sessions, JWT        │  │
 │  hydrate + autosave  │  │  /api/users     accounts, phone/email│  │
 │  (debounced sync) │──┼─►│  /api/state     persisted app state  │  │
 └───────────────────┘  │  │  /api/admin     backups, restore     │  │
        HTTPS (LE)      │  │  static: frontend/dist (SPA fallback)│  │
                        │  └───────────────┬──────────────────────┘  │
                        │      better-sqlite3 (WAL)                  │
                        │  ┌───────────────▼──────────────────────┐  │
                        │  │ data/cpcms.db  · data/backups/*.db   │  │
                        │  └──────────────────────────────────────┘  │
                        │  Zoho SMTP (invites/resets) · cron: 02:00  │
                        └────────────────────────────────────────────┘
```

**Why SQLite:** single-writer workload, one box, zero ops, atomic file backups, WAL for concurrent reads. **When it changes:** >1 app server, or heavy concurrent writers → Postgres (schema below is Postgres-compatible on purpose).

## 3. File structure

```
cpcms/
├── backend/
│   ├── src/
│   │   ├── server.js        # composition root: plugins, static, schedule
│   │   ├── db.js            # connection, migrations, lookups
│   │   ├── auth.js          # login (email/phone), invites, set/forgot password
│   │   ├── admin.js         # snapshots: backup/list/download/restore
│   │   ├── state.js         # persisted app state (v1.4)
│   │   └── mailer.js        # Zoho SMTP templates
│   ├── data/                # cpcms.db + backups/   (never in git)
│   ├── ecosystem.config.cjs # PM2
│   └── .env                 # secrets (JWT, SMTP)
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── api.ts           # fetch wrapper, token
│   │   └── App.tsx          # EdgeUI2.1 (to be split per §6)
│   └── dist/                # served by backend
└── ARCHITECTURE.md
```

Target frontend split (progressive, one module per extraction — no behaviour change per step):
```
src/
├── design/     tokens.ts components.tsx icons.tsx motion.css
├── store/      store.ts (class) + slices: jobs.ts far.ts products.ts qc.ts workforce.ts logistics.ts
├── sync/       persist.ts (hydrate/autosave)
├── auth/       Login.tsx SetPassword.tsx session.ts
└── modules/    landing/ manufacturing/ inventory/ logistics/ workforce/ admin/
```

## 4. Database schema

### Live today (v1.4)
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  email TEXT UNIQUE COLLATE NOCASE, phone TEXT UNIQUE,       -- login = either
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin','Director','Manager','Supervisor','Operator','Service','Shopfloor Display')),
  location TEXT NOT NULL CHECK (location IN ('DHARMAPURI','FARIDABAD','BOTH')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','INVITED')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  CHECK (email IS NOT NULL OR phone IS NOT NULL));
CREATE TABLE tokens   (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE auth_log (ts INTEGER NOT NULL, email TEXT, event TEXT NOT NULL, detail TEXT);
CREATE TABLE app_state(                       -- v1.4: the persisted application
  id TEXT PRIMARY KEY,                        -- 'main'
  doc TEXT NOT NULL,                          -- JSON of whitelisted store slices
  version INTEGER NOT NULL DEFAULT 1,        -- optimistic concurrency
  updated_by TEXT, updated_at INTEGER NOT NULL);
```

### Target relational schema (per-module migration; each vertical moves out of app_state into these)
```sql
-- masters
CREATE TABLE product_types (id TEXT PRIMARY KEY, plant TEXT, name TEXT, prefix TEXT, cat TEXT,
  spec_shape TEXT, unit TEXT, attrs TEXT, meta TEXT, created_at INTEGER);
CREATE TABLE products      (sku TEXT PRIMARY KEY, type_id TEXT REFERENCES product_types(id),
  spec TEXT, rate REAL, reorder INTEGER, meta TEXT);
CREATE TABLE bom_lines     (id TEXT PRIMARY KEY, plant TEXT, product_sku TEXT, op TEXT,
  component_sku TEXT, qty_per REAL, yield REAL, loss_mm REAL, variable INTEGER, alt INTEGER, child_uid INTEGER, note TEXT);
CREATE TABLE workstations  (code TEXT PRIMARY KEY, plant TEXT, name TEXT, category TEXT, spec TEXT);
CREATE TABLE cycle_steps   (plant TEXT, step INTEGER, operation TEXT, ws TEXT, src TEXT, dst TEXT,
  rule TEXT, model TEXT, PRIMARY KEY (plant, step));
CREATE TABLE std_times     (plant TEXT, operation TEXT, seconds INTEGER, PRIMARY KEY (plant, operation));

-- execution (event-sourced: state derives from events, audits itself)
CREATE TABLE jobs       (uid TEXT PRIMARY KEY, plant TEXT, cycle TEXT, length_mm INTEGER,
  current_step INTEGER, status TEXT, target_fg INTEGER, storage TEXT, updated_at INTEGER);
CREATE TABLE job_events (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, ts INTEGER, kind TEXT,
  step INTEGER, ws TEXT, operator TEXT, payload TEXT);                     -- ASSIGN/START/PAUSE/DONE/HOLD/QC/CONVERT
CREATE INDEX ix_job_events_uid ON job_events(uid, ts);
CREATE TABLE batches    (batch_id TEXT PRIMARY KEY, plant TEXT, kind TEXT, status TEXT, doc TEXT, updated_at INTEGER);
CREATE TABLE movements  (ref TEXT PRIMARY KEY, plant TEXT, leg TEXT, dir TEXT, vendor TEXT,
  lines TEXT, status TEXT, ts INTEGER);
CREATE TABLE stock_adjust (plant TEXT, sku TEXT, variant TEXT, delta INTEGER, why TEXT, by TEXT, ts INTEGER);
```

## 5. API endpoints

### Live (v1.4)
```
POST /api/auth/login            email OR phone + password → JWT (7d)
GET  /api/auth/me               session restore
POST /api/auth/change-password
POST /api/auth/set-password     invite/reset token flow
POST /api/auth/forgot           emails reset link (Zoho)
GET  /api/config                { mail: bool }
GET/POST /api/users             admin: list/create (email or phone)
PATCH /api/users/:id            role/location/status
POST /api/users/:id/reset-password
POST /api/users/invite          emailed set-password link
GET  /api/state                 { doc, version }          ← v1.4
PUT  /api/state                 { doc, version } → 409 on stale version
GET/POST /api/admin/backup(s)   snapshots; GET :file downloads
POST /api/admin/restore         confirmed; safety snapshot; restart
GET  /api/health
```

### Planned per vertical (replaces its slice of /api/state when ported)
```
/api/products /api/bom /api/workstations /api/cycles /api/std-times      (masters)
/api/jobs  POST /api/jobs/:uid/events  GET /api/assign/queue/:ws          (Assign vertical — first)
/api/batches /api/movements /api/qc /api/roster /api/reports/…
```

## 6. UI architecture
- **Shell:** Landing (no plant toggle) → ModuleShell (top bar owns plant switch, role badge, ⌘K) → module rail → screens.
- **State:** one observable store (class + module extensions). v1.4 adds `sync/persist.ts`: on sign-in, hydrate whitelisted slices from `/api/state`; every store emit autosaves (debounced 1.5s, flush on tab close); version conflicts re-hydrate.
- **Extraction rule:** a module leaves App.tsx only when its vertical gets real endpoints; the screen then reads React Query-style fetches instead of store slices. Design tokens/components extract first (zero risk).
- **Roles:** capabilities (`can.*`) bound to built-in roles; page visibility per role editable in Admin.

## 7. Production practices
- **Process:** PM2 (`cpcms`), auto-restart, `pm2 save` + startup hook. nginx TLS (Let's Encrypt auto-renew) → 127.0.0.1:3001.
- **Data safety:** WAL SQLite; snapshots on demand + daily 02:00 IST, 30 retained, downloadable; restore = confirm + safety snapshot + supervised restart. `app_state` rides in the same file ⇒ all entered data is inside every snapshot.
- **Security:** bcrypt(10), JWT HS256 (secret in .env), rate limits (login 10/min, global 300/min), admin-only guards, no secrets in git, single-use expiring tokens for invite/reset.
- **Scale path (in order, only when a limit is hit):** 1) PM2 cluster + move sessions stateless (already JWT) → 2) SQLite→Postgres via the schema in §4 → 3) reports to read replicas → 4) object storage for documents → 5) queue for schedulers. Millions of users never hit one plant's MES; the ceiling that matters is per-plant write volume, and Postgres covers it.
```
