// Persisted application state — everything the app's store holds (products,
// BOM, jobs, batches, dispatches …) lives here as one versioned JSON document,
// so nothing entered in the browser is ever lost. Rides inside cpcms.db, so
// every snapshot backs it up too. Modules migrate OUT of this document into
// real tables one vertical at a time (see ARCHITECTURE.md).
import crypto from "node:crypto";
import { db } from "./db.js";
import { requireAuth } from "./auth.js";

db.exec(`CREATE TABLE IF NOT EXISTS app_state (
  id         TEXT PRIMARY KEY,
  doc        TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  hash       TEXT,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);`);
try { db.exec("ALTER TABLE app_state ADD COLUMN hash TEXT"); } catch {}  // older DBs

const MAX_BYTES = 8 * 1024 * 1024;

export default async function stateRoutes(app) {
  app.get("/api/state", { preHandler: requireAuth }, async (req, reply) => {
    const row = db.prepare("SELECT doc, version, updated_at FROM app_state WHERE id = 'main'").get();
    if (!row) return { ok: true, doc: null, version: 0 };
    reply.type("application/json");                     // raw passthrough — the doc is already JSON
    return `{"ok":true,"version":${row.version},"updated_at":${row.updated_at},"doc":${row.doc}}`;
  });

  app.put("/api/state", {
    preHandler: requireAuth,
    bodyLimit: MAX_BYTES + 65536,
  }, async (req, reply) => {
    const { doc, version } = req.body || {};
    if (doc == null || typeof version !== "number")
      return reply.code(400).send({ ok: false, error: "doc and version are required." });
    const raw = JSON.stringify(doc);
    if (raw.length > MAX_BYTES) return reply.code(413).send({ ok: false, error: "State too large." });
    const row = db.prepare("SELECT version, hash FROM app_state WHERE id = 'main'").get();
    const current = row?.version || 0;
    if (version !== current)
      return reply.code(409).send({ ok: false, error: "Someone saved newer data.", version: current });
    const hash = crypto.createHash("sha1").update(raw).digest("hex");
    if (row && row.hash === hash) return { ok: true, version: current, unchanged: true };
    const next = current + 1;
    db.prepare(`INSERT INTO app_state (id, doc, version, hash, updated_by, updated_at) VALUES ('main', ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, version = excluded.version, hash = excluded.hash,
                updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(raw, next, hash, req.user.email || req.user.phone, Date.now());
    return { ok: true, version: next };
  });
}
