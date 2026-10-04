# CPCMS — Code Review (fresh-eyes audit, v1.4 codebase)

## 1. Reverse-engineered architecture & data flow

```
Sign-in ──► JWT in localStorage ──► /api/auth/me on every load
                    │
App boot ──► startSync(): GET /api/state ──► hydrateState() writes ~60 data
             fields onto the singleton store ──► React renders from store
                    │
Any mutation ──► store method mutates field ──► _emit() ──► every subscribed
             component re-renders ──► queueSave (1.5s debounce) ──► serialize
             whole store ──► PUT /api/state {doc, version} ──► SQLite app_state
                    │
Backups: db.backup() snapshots cpcms.db (users + tokens + auth_log + app_state)
```

Frontend truth lives in one observable class-instance store (App.tsx, ~17k lines:
design system + store + 6 modules + ~70 screens). Backend is a thin trusted
shell: auth, users, state document, snapshots. All manufacturing logic
(advance job, QC, conversion, dispatch) executes client-side.

## 2. Findings

### Bad architecture decisions (ranked by blast radius)
1. **Business logic and authorization live in the browser.** Any authenticated
   user can PUT any /api/state doc — role gates (`can.*`) are client-side only.
   Acceptable for a trusted 2-plant team; unacceptable beyond it. The fix is the
   already-documented vertical migration (jobs → event-sourced endpoints with
   server-side role checks), not a patch.
2. **Whole-document persistence.** One JSON doc = whole-doc conflict granularity;
   two simultaneous editors resolve at "newer version wins". Fine solo; risky
   multi-writer. Migration per vertical shrinks the doc until it disappears.
3. **17k-line App.tsx.** Not wrong for a design prototype; wrong for a team.
   Extraction order (zero-risk first): design tokens/components → store slices →
   auth screens → one module per PR.

### Duplicate logic
- Plant identity appears as three notations: `"dharmapuri"|"faridabad"` (store),
  `DHARMAPURI|FARIDABAD|BOTH` (DB), display names — mapped ad-hoc in ≥6 places
  (`toLoc`, chips, SegSwitch options, `_catRows`, stores derivation). → single
  `PLANTS` map when extracting the store.
- Two HTTP paths: `api()` wrapper and a raw `fetch` in snapshot download
  (needed for blob, but headers logic is copy-pasted). → `apiBlob()` helper.
- ~150 inline `style={{…}}` blocks repeat the same card/row/label recipes
  already encoded in Panel/Field/Btn — screens predating the primitives. →
  sweep during module extraction, not before.

### Performance bottlenecks
- **`useJobStore` has no selectors**: every emit re-renders every mounted
  subscriber. Invisible at current data sizes; the first thing to hurt when a
  plant has thousands of jobs. Fix = `useSyncExternalStore` with per-screen
  selectors during extraction.
- **Autosave serializes the entire store** (deep JSON clone) after every
  change burst, and previously PUT even when nothing changed. *(Fixed in this
  pass: no-op saves skipped via last-saved comparison; server also skips
  identical writes.)*
- **GET /api/state parsed then re-stringified the doc** on every load — double
  O(doc) work. *(Fixed: raw passthrough.)*
- **bcrypt \*Sync in request handlers** blocked the event loop ~80ms per
  login/create/reset — a burst of logins stalls every request. *(Fixed: async.)*
- Derived getters (`storages`, `rollMap`, `alloyWT`) recompute per property
  access inside render. Cheap at current n; memoize behind `_v` when extracted.

### Scalability risks
- SQLite single-writer: correct today; the documented trigger for Postgres is
  a second app server or sustained concurrent writes.
- app_state doc growth: activity log and job history accumulate unbounded
  inside the doc → cap/ring-buffer them, or migrate to tables first.
- JWT has no revocation list; disabling a user takes effect on next /me check
  (≤ page load). Acceptable; note it.

### Maintainability issues
- One file, three languages of concern (design/system/state) — reviewed above.
- No automated tests; current safety net is the jsdom smoke + curl scripts used
  during development. → carry them into `backend/test/` and a Vitest smoke.
- Python-patch editing (how this file is maintained) demands unique anchors;
  extraction to modules removes that fragility.

## 3. Clean architecture target
Documented in ARCHITECTURE.md §3–§6: modular monolith, one store split into
slices, verticals migrating from app_state to relational tables + event log,
server-side authorization per endpoint. Order: Assign → QC → Inventory masters
→ Logistics → reports.

## 4. Refactoring strategy (no functionality change, in safe order)
1. ✅ Async bcrypt everywhere (this pass)
2. ✅ Consistent JSON error envelope from Fastify error handler (this pass)
3. ✅ /api/state: raw-doc GET, skip identical PUTs, ETag-style hash (this pass)
4. ✅ Frontend autosave: skip when serialized state unchanged (this pass)
5. Extract design tokens + primitives to files (pure moves, zero logic)
6. Extract store to store/ with slices; introduce selector-based useStore
7. Vertical migrations per ARCHITECTURE.md — each one deletes its slice from
   the persistence whitelist
8. Vitest: store unit tests + one jsdom render smoke in CI (GitHub Actions,
   free tier) before step 6 begins
