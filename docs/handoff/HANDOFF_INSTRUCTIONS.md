# CPCMS — Backend & Frontend Handoff Instructions
## For Claude Code
## Edgesmith Tooling India Pvt Ltd

---

## WHAT THIS PACKAGE CONTAINS

```
cpcms/
  backend/    — COMPLETE. Tested, working, ready to deploy.
  frontend/   — FOUNDATION ONLY. Does not build/run yet. See "What's Missing" below.
```

This is a real engineering handoff, not a spec document. Read this file fully before touching code — it tells you exactly what is finished, what is verified, what is missing, and what decisions were already made so you don't redo or contradict them.

---

## BACKEND — COMPLETE (36 files, ~4,400 lines)

### Status: tested and working

Everything below was actually verified, not just written:

- **Schema validated** against the real PostgreSQL grammar parser (`pgsql-parser`, which wraps `libpg_query`, the same C library Postgres itself uses). 46 tables, no duplicates, confirmed syntactically valid SQL. Run `npm run validate-schema` to re-check after any edits.
- **All business logic unit-tested** with assertions: UID series generator (including letter-rollover-skipping-used-letters), scrap calculator (both worked examples from the instructions: Pattern A → 67mm scrap, Pattern B → 70mm scrap), furnace capacity scaling formula (HT70/HT80 base 6 → 3 at 2750mm; HT90 base 80 → 43 at 2750mm; capped correctly at 1424mm), grinding length-pairing validation, bunch grinding set math, deviation checker.
- **Full app loads cleanly** — every route file's `require()` resolves, no missing exports, verified via `node -e "require('./app.js')"`.
- **Live HTTP smoke-tested** — spun up the server, hit real endpoints, verified 401 on no-auth, 404 on unknown routes, graceful 500 (not a crash) when DB is unreachable, server stays responsive after errors.
- **One real bug found and fixed during testing**: `batches.js` originally had a blanket `router.use(authenticate)` while mounted at the bare `/api/v1` prefix, which caused it to intercept and 401 every unmatched route before the global 404 handler could fire. Fixed by splitting it into two properly-scoped sub-routers (`furnaceRouter` at `/furnace-batches`, `grindingRouter` at `/grinding`). Verified fixed via repeat HTTP test.

### What you cannot verify without a live Postgres instance

The sandbox this was built in had no network access to install PostgreSQL (`apt-get install postgresql` failed on a 404 from the security mirror — environment-specific, not a real blocker). The schema is syntax-validated but **has never actually run against a live database**. Before deploying:

```bash
cd backend
npm install
cp .env.example .env   # fill in real DATABASE_URL, JWT_SECRET (generate with the command in the file)
npm run migrate         # applies migrations/001_init_schema.sql
npm run seed             # populates workstations, EAT cycle (27 steps), admin user, etc.
npm run dev               # starts on :3001
curl http://localhost:3001/api/v1/health   # should show "database":"connected"
```

If migration fails, it is almost certainly a real bug in the SQL that the parser didn't catch (parser checks syntax, not runtime semantics like circular FK ordering) — work through it methodically, the schema is large but was written carefully.

### Backend structure

```
backend/
  app.js                          — Express app entrypoint, all routes mounted, cron jobs, health check
  migrations/001_init_schema.sql  — Full schema, 46 tables
  seeds/seed.js                   — Admin user, 19 Dharmapuri workstations + WELD-01,
                                     workstation units (incl. 2x MM22), full EAT cycle (27 steps,
                                     correct storage flow), tempering params (EAT only — review before
                                     production use, values are realistic placeholders), grinding
                                     rules, color codes, default truck capacity, sample suppliers/contractors
  scripts/migrate.js              — Migration runner (idempotent, tracks applied migrations)
  scripts/validate_schema.js      — Re-run schema validation any time you edit the SQL
  src/config/                     — database.js (pg pool), jwt.js, shifts.js (3-shift logic)
  src/middleware/                 — auth.js (JWT), rbac.js (role + LOCATION SCOPING — read this file,
                                     it's the server-side guarantee that Faridabad/Dharmapuri separation
                                     is real, not cosmetic), audit.js, errorHandler.js, rateLimiter.js
  src/controllers/uidsController.js — UID business logic (the most complex single file — list, detail,
                                     bulk create, advance, hold/release, Converting/split, lineage)
  src/utils/                      — uidGenerator.js, scrapCalculator.js, deviationChecker.js,
                                     cycleVersioning.js — all pure functions, all unit-tested
  src/routes/                     — one file per resource (auth, uids, cycles, batches, jobs, faridabad,
                                     receiving, shifts, employees, mos, qc, reports, service, master,
                                     admin, alerts, workstationAssignments)
  src/jobs/                       — 3 cron jobs: shiftStart (every minute), badgeExpiry (hourly),
                                     overdueReceiving (every 5 min)
```

### Key architectural decisions already made — do not redo these

1. **Express 5**, not Express 4. This matters: Express 5 natively forwards rejected promises from `async` route handlers to error middleware — **verified this empirically**, not assumed. Do not add `express-async-errors`, it's built for Express 4's internals and is unnecessary/incompatible here.
2. **Raw SQL via `pg`**, no ORM. Every query is hand-written. `src/config/database.js` exports `query()` for simple calls and `withTransaction(fn)` for anything needing atomicity (most write operations use this).
3. **JWT in httpOnly cookie**, not localStorage, not Authorization header as primary (though Bearer token is also accepted as a fallback — see `middleware/auth.js`).
4. **Location scoping is enforced server-side independently of what the frontend sends.** `middleware/rbac.js` → `enforceLocationScope` and `resolveLocation`. Supervisor/Operator JWTs carry their fixed `location_id`; any request implying a different location is rejected regardless of UI state. Admin/Manager have `location_id: null` and can query any location.
5. **Audit logging is explicit, not a global hook.** Controllers call `req.audit({...})` deliberately around business-meaningful writes — not every read, not every polling call. See `middleware/audit.js`.
6. **Soft-delete only.** The generic Master Lists CRUD factory (`routes/master.js` → `simpleResource()`) implements DELETE as `UPDATE ... SET status = 'archived'`, never a real DROP. Nothing in this system is ever hard-deleted, per the instructions.
7. **Furnace batches enforce single-cycle-type as a hard rule with no override** (`routes/batches.js` → `POST /furnace-batches`) — mismatched cycle types throw `CYCLE_MIX_NOT_ALLOWED`, period. The minimum-queue-threshold check, by contrast, *can* be overridden by a Supervisor with a logged reason (`overrideThreshold`/`overrideReason`) — these are two different rules with two different override policies, don't conflate them.
8. **Faridabad has no individual block tracking.** `faridabad_weld_log` rows feed a running tally per cycle type; the batch (and its color code, possible-heat-numbers list) is only created at `POST /faridabad/dispatches`. Do not reintroduce per-block IDs — this was a deliberate correction after the original design assumed exact traceability that isn't physically achievable (rolling erases individual block identity).
9. **Heat number traceability is honest, not exact.** Service lookup and UID detail show `possible_alloy_heats` / `possible_ms_heats` as arrays with an explicit caveat string, never a single definitive value.

### Environment setup

`backend/.env.example` has every variable with inline guidance. Copy to `.env` and fill in. `JWT_SECRET` must be 64+ characters — the file shows the exact `node -e` command to generate one.

---

## FRONTEND — FOUNDATION ONLY (13 files). Does not build or run yet.

### What exists and is genuinely finished

- **Vite + React 19 + React Router 7** scaffold (`vite.config.js`, `index.html`, `package.json` with exact dependency versions already resolved — use these versions, don't downgrade).
- **`src/styles/tokens.css`** — every color, font, radius, shadow value extracted directly from the locked Claude Design file (`CPCMS_dc__7_.html` — not included in this package, but every value here was read directly from it, not approximated). This is the single source of truth for visual styling. Component CSS classes already defined: `.card`, `.btn` / `.btn-primary` / `.btn-danger`, `.badge`, `.status-pill`, `.form-input` / `.form-select` / `.form-label`, `.tab-strip`.
- **`src/api/client.js`** — fetch wrapper matching the backend's exact response envelope (`{success, data, meta?}` / `{success:false, error:{code,message,details?}}`), `credentials:'include'` for the cookie, a typed `ApiError` class.
- **`src/api/*.js`** (auth.js, uids.js, jobs.js, batches.js, resources.js) — one function per backend endpoint, all 80+ endpoints covered, naming and parameters match the backend routes exactly. **Read these before writing any page** — they are the contract.
- **`src/store/AuthContext.jsx`** — login/logout, persists non-sensitive display info (name, role, location_id) to localStorage for UI purposes only (the real session is the httpOnly cookie), silent token refresh on a timer, role-check booleans (`isAdmin`, `isOperator`, etc.) and `canSwitchLocation`.
- **`src/store/AppContext.jsx`** — **this is the central location toggle mechanism.** One piece of state (`location: 'dharmapuri'|'faridabad'|'both'`), settable only if `canSwitchLocation`, auto-locked to the user's own location for Supervisor/Operator. Every page that needs to be location-aware reads `useApp().location` — there must never be a second, page-local location toggle anywhere (this was an explicit, repeated correction during design review — Reports originally had its own separate toggle and had to be fixed to read this shared one instead; do not reintroduce that mistake).
- **`src/hooks/usePolling.js`** — generic 30-second polling hook (configurable via `VITE_POLLING_INTERVAL_MS`), pauses when tab is hidden, feeds the status bar's "updated Ns ago" ticker via `AppContext.markRefreshed()`.
- **`src/components/common/Icon.jsx`** — 24 icons as exact SVG path strings extracted from the locked design (don't substitute an icon library — use these, more can be added in the same format if a page needs one not yet here).
- **`src/components/common/Badges.jsx`** — `CycleBadge`, `StatusPill`, `PriorityBadge`, `LocationBadge` — exact colors matching the design's `cycleBadge()`/`statusPill()` helper functions.
- **`src/components/layout/nav.js`** — the sidebar navigation structure (`NAV` array: 5 sections, 22 pages total) and `SECTIONS_BY_ROLE` (which sections each of the 6 roles sees). Operators see only `jobexec` and `qc` even within their visible section — see `OPERATOR_ALLOWED_ROUTES`.

### What is MISSING — this is the actual remaining work

**Nothing renders yet.** There is no `App.jsx`, no router setup, no Login page, no shell components (Sidebar, Topbar, StatusBar), and none of the 22 content pages exist. `npm run dev` will fail immediately because `main.jsx` imports `./App.jsx`, which does not exist.

Build in this order:

**1. Shell components** (`src/components/layout/`)
   - `Sidebar.jsx` — renders `NAV` filtered by `SECTIONS_BY_ROLE[role]`, collapsible (`useApp().sidebarCollapsed`), badge counts on nav items pulled from a lightweight alerts/queue summary call
   - `Topbar.jsx` — brand block, the location toggle pills (read/write `useApp().location`, disabled visually if `!canSwitchLocation`), shift indicator, alert bell, user menu, live clock
   - `StatusBar.jsx` — active/hold/in-furnace counts, current shift summary, "updated Ns ago" (`useApp().lastRefreshSeconds`), connection dot (`useApp().online`)
   - `AppShell.jsx` — composes the three above around an `<Outlet />` for the routed page content; this is what every authenticated route renders inside

**2. `src/App.jsx`** — wraps everything in `AuthProvider` → `AppProvider` → `BrowserRouter`. Routes: `/login` (public), everything else behind an `AppShell` + an auth guard that redirects to `/login` if `!isAuthenticated`. Role-based route restriction should reuse `SECTIONS_BY_ROLE`/`OPERATOR_ALLOWED_ROUTES` from `nav.js` rather than duplicating the logic.

**3. `src/pages/Login.jsx`** — username/password form calling `useAuth().login()`.

**4. The 22 content pages**, one component per `NAV` route key, in `src/pages/`. Suggested build order — easiest/most foundational first, so each page validates the API client and shell before tackling something more complex:

   1. `Dashboard.jsx` — read-only, good first page to prove the polling hook + API client work end to end
   2. `UidRegistry` / `UidDetail` (the `uid` route — likely two views: a list and a detail drill-in)
   3. `ProductionFloor.jsx` (`floor`) — uses `uidsApi.stationSummary()`, location-aware
   4. `MyWorkstation.jsx` (`jobexec`) — the Start/Pause/Resume/Close timer UI, wired to `jobsApi`. This is the most interaction-heavy page; budget the most time here.
   5. `BatchManagement.jsx` (`batch`) — furnace queue/threshold UI (`batchesApi.furnaceQueue`), the hard same-cycle-type rule should be reflected in the UI (disable mixing, not just rely on the backend 409)
   6. `QC.jsx`, `JobAssignment.jsx` (`jobs`), `ShiftManagement.jsx` (`shift`)
   7. Faridabad pages: `RawMaterialIntake.jsx` (`intake`), `JoiningOperation.jsx` (`joining` — read-only running tally, no per-block form, see backend `faridabad.js` comments), `ContractorDispatch.jsx` (`dispatch` — color code + truck capacity + possible-heats display)
   8. `Receiving.jsx` — includes the color-mismatch-confirmation flow (`receivingApi.confirmMismatch`)
   9. `MoLinking.jsx` (`mo`), `Reports.jsx` (9 report types, all location-aware via shared `useApp().location`, no local toggle), `ServiceLookup.jsx` (`service`)
   10. Admin/config pages: `CycleBuilder.jsx`, `MasterLists.jsx`, `TemperingParameters.jsx`, `EmployeeProfiles.jsx`, `UsersRoles.jsx`, `BackupRestore.jsx`
   11. `ShopfloorDisplay.jsx` — full-screen dark display, no sidebar/topbar, auto-refreshing, this one intentionally does NOT render inside `AppShell`

**5. `.env.example` for the frontend** — at minimum `VITE_API_BASE_URL` (defaults to `/api/v1` via Vite's dev proxy already configured in `vite.config.js`) and `VITE_POLLING_INTERVAL_MS`.

### Design fidelity note

The locked Claude Design file (`CPCMS_dc__7_.html`) is the visual source of truth but uses a proprietary templating syntax (`<x-dc>`, `<sc-if>`, `{{ }}` interpolation via a custom `support.js` runtime) — it is **not** directly portable to JSX by find-and-replace. Treat it as a detailed visual/structural reference (exact layout, copy, field names, table columns, button placement) and rebuild each page as proper React, not as a mechanical syntax translation. The CSS tokens file already captures every color/spacing value precisely, so visual fidelity should be achievable without needing to re-open that file for colors — only for layout/copy/structure per page.

---

## REFERENCE: PAGE INSTRUCTIONS

The full page-by-page functional specification (what each of the 22 pages shows, every field, every button, every interconnection between pages, the complete Faridabad model including the color-code/possible-heat-numbers traceability approach, the queue-threshold/auto-assign mechanics, shift handover workflow, badge validation rules, drag-and-drop specifications for Job Assignment and Production Floor) is in the accompanying document `CPCMS_Page_Instructions.md`. Read the relevant section before building each page — it is long (3,700+ lines) because it answers most of the "what exactly should this button do" questions before you have to ask them.

The core business-logic and Faridabad-model documents (`CPCMS_Instructions.md` and the design-correction round files) explain *why* the rules are what they are, useful if anything in the page instructions seems surprising (e.g. why Faridabad has no per-block tracking, why furnace batches can't mix cycle types).

EOF
