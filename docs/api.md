# CPCMS API Reference

Base URL: `/api` (e.g. `https://<host>/api`). All responses are JSON.

## Auth

JWT issued on login, sent as `Authorization: Bearer <token>` on every other request.
Token lifetime is 8 hours (configurable). Errors return `{ "detail": "..." }` with an
appropriate HTTP status (400 / 401 / 403 / 404).

| Method | Path | Role | Body / notes |
|--------|------|------|--------------|
| POST | `/auth/token` | public | form-urlencoded `username`, `password` → `{ access_token, token_type, user }` |
| GET  | `/auth/me` | any | current user |

## UIDs (`/api/uids`)

| Method | Path | Role | Notes |
|--------|------|------|-------|
| GET | `/uids/` | any | list/search. Query: `location_id`, `cycle_type_id`, `status`, `search`, `skip`, `limit` → `{ total, items }` |
| GET | `/uids/lookup/:code` | any | full record + step history (service lookup) |
| GET | `/uids/queue/operator` | any | active UIDs for a location, priority-ordered |
| POST | `/uids/bulk-create` | Manager+ | `{ quantity (1–500), cycle_type_id, factory_location_id, size_id?, design_id?, priority?, mo_id?, product_type_id? }` |
| POST | `/uids/:id/complete-step` | Operator+ | `{ workstation_id, qc_result?, qc_values?, notes? }` — advances one step; holds at Step 16 if design unconfirmed |
| POST | `/uids/:id/convert` | Supervisor+ | `{ children: [{ length_mm?, cycle_type_id }], pattern_id? }` — split into 2–4 children (start at Step 17) |
| POST | `/uids/:id/confirm-design` | Manager+ | `{ design_id, size_id? }` — validates size-design matrix; releases hold |
| POST | `/uids/:id/link-mo/:moId` | Manager+ | link an MO |
| POST | `/uids/:id/transfer` | Supervisor+ | `{ to_location_id, reason }` |
| POST | `/uids/bulk-change-cycle` | Manager+ | `{ uid_ids, new_cycle_type_id }` — only before any step is completed |

## Cycles (`/api/cycles`)

| Method | Path | Role | Notes |
|--------|------|------|-------|
| GET | `/cycles/` | any | list with current version + steps |
| GET | `/cycles/:id` | any | one cycle |
| GET | `/cycles/:id/versions` | any | version history |
| POST | `/cycles/` | Admin | `{ name, letter_prefix, description? }` |
| POST | `/cycles/:id/versions` | Admin | `{ steps: [...], change_notes? }` — creates a new version |
| GET | `/cycles/:id/export` | any | JSON cycle definition (`version_id?` query) |
| POST | `/cycles/import` | Admin | `{ data, update_existing? }` |

## Manufacturing Orders & Patterns (`/api/manufacturing`)

| Method | Path | Role |
|--------|------|------|
| GET `/orders` (`status?`) · POST `/orders` (Manager+) · GET `/orders/:id/uids` · PATCH `/orders/:id/status` (Manager+) |
| GET `/patterns` · POST `/patterns` (Admin) · PATCH `/patterns/:id/archive` (Admin) |

## Tempering / Furnace Batches (`/api/tempering`)

| Method | Path | Role | Notes |
|--------|------|------|-------|
| GET | `/parameters` | any | `cycle_type_id?` |
| POST | `/parameters` | Admin | upsert target temp/soak + tolerances per step per cycle |
| GET | `/available-uids` | any | UIDs at a tempering step (`cycle_step_id`) |
| GET | `/batches` · `/batches/:id` | any | furnace batch list / detail |
| POST | `/batches` | Supervisor+ | `{ cycle_type_id, cycle_step_id, intake_count? | uid_ids? }` — auto batch number, groups UIDs |
| POST | `/batches/:id/complete` | Supervisor+ | `{ actual_temp_c?, actual_soak_minutes?, notes? }` — auto deviation flag vs tolerance |

## Faridabad & Receiving (`/api/faridabad`)

`contractors` (GET/POST Admin/archive) · `intakes` (GET/POST Manager+) ·
`joinings` (GET/POST Manager+) · `dispatches` (GET/GET :id/POST Manager+) ·
`receivings` (GET/POST Manager+). Dispatch batch references auto-generated; one
dispatch may have multiple receiving events.

## Shifts & Job Allotments (`/api/shifts`)

`assignments` (GET/POST/`:id/confirm`/DELETE, Supervisor+) ·
`allotments` (GET/POST/DELETE, Supervisor+; operators see only their own) ·
`allotments/auto-assign` (Supervisor+) · `queue-view` (any).

## Factory & Products (master data)

`/api/factory`: `locations`, `workstations`, `storage` (GET any; create/edit Admin).
`/api/products`: `sizes`, `designs` (+ `:id/valid-sizes`), `types` (GET any; create Admin).

## Users (`/api/users`)

GET `/` · POST `/` · PATCH `/:id` — all Admin only.

## Shopfloor & Dashboard (`/api/shopfloor`)

| Method | Path | Role | Notes |
|--------|------|------|-------|
| GET | `/status` | public | per-location workstation + storage counts (wall display) |
| GET | `/dashboard` | any | summary incl. the 6 metric cards: Active UIDs, On Hold, Awaiting Design Confirmation, Furnace Batches Running, UIDs Dispatched Today, Faridabad Batches in Transit |

## Workstation units, capacity & settings (`/api/master`)

| Method | Path | Role | Notes |
|--------|------|------|-------|
| GET | `/master/workstation-units` | any | physical units pooled under a workstation (`workstation_id?`, `status?`) |
| POST | `/master/workstation-units` | Admin | `{ unit_code, workstation_id, name?, factory_location_id?, status? }` |
| PATCH | `/master/workstation-units/:id` | Admin | edit unit |
| DELETE | `/master/workstation-units/:id` | Admin | archive unit |
| GET | `/master/settings` | any | app settings (e.g. `bunch_grinding_bars_per_set`) |
| PATCH | `/master/settings/:key` | Admin | `{ value }` |

Per-step capacity (authoritative capacity rules): each cycle step returns
`capacity_per_unit` (base/fixed count, or null when length/set-based), `capacity_type`
(`fixed` | `furnace` | `length_based` | `set_based`), `active_units`, `total_capacity`
(= base × active units), and for furnace steps `capacity_by_size` — the per-length
capacity from `min(base, floor(base × 1500 / size))`. Furnaces: HT70/HT80 base 6,
HT90 base 80; grinding/bunch steps are length/set-based. Admin sets the base in the
Cycle Builder; other sizes are derived.

## Grinding batches (`/api/grinding`)

| Method | Path | Role | Notes |
|--------|------|------|-------|
| GET | `/grinding/machines` | any | grinding machines with `max_bar_length_mm` + active unit count |
| POST | `/grinding/validate` | Supervisor+ | `{ workstation_id, lengths? | uid_ids? | items? }` → `{ valid, combined_length, machine_max, per_bar, reasons }` |
| POST | `/grinding/suggest` | Supervisor+ | combined pairings that fit the machine bed |
| POST | `/grinding/bunch-suggest` | Supervisor+ | bunch-grinding runs (same-length sets of `bars_per_set`, packed end-to-end into the bed) |

## Health

`GET /health` and `GET /api/v1/health` (the latter also verifies the DB connection).
