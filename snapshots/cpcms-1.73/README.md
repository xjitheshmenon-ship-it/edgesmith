# CPCMS v1.73 — project snapshot (archival)

This folder is a **verbatim, read-only snapshot** of an earlier standalone CPCMS
prototype (version 1.73), imported for reference. It is **not** part of the
edgesmith application and is not built, tested, deployed, or imported by the
app — it lives under `snapshots/` purely as an archival record.

## Contents

- `frontend/` — a single-file React + TypeScript prototype (`src/App.tsx`, ~1.3 MB)
  plus its `api.ts`, Vite config, and a prebuilt `dist/` bundle captured at export time.
- `backend/` — a small Node/Express service (`auth.js`, `admin.js`, `server.js`,
  `mailer.js`, `db.js`, `state.js`).
- `ARCHITECTURE.md`, `CODE_REVIEW.md`, `DEBUG_REPORT.md`, `HOSTINGER-DEPLOY.md` —
  the prototype's own docs, as shipped.

## Provenance

Imported from a base64-encoded zip archive (`CPCMS1.73.txt`). File timestamps in
the archive range from 2026-09-16 to 2026-10-04.

## Relationship to edgesmith

This prototype is structurally unrelated to the current edgesmith build (which is a
multi-page app under `frontend/src/pages/` with a Postgres-backed backend). Treat
this snapshot as historical context only; do not wire it into the live app.
