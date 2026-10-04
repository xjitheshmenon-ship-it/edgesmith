// Backup & Restore — real snapshots of the server database.
// A backup COPIES the live database into data/backups/ (a snapshot file);
// restore replaces the live database with a chosen snapshot and restarts the
// process (PM2 brings it straight back up).
import fs from "node:fs";
import path from "node:path";
import { db, DB_PATH, BACKUP_DIR, log } from "./db.js";
import { requireAdmin } from "./auth.js";

const NAME_RE = /^cpcms-\d{8}-\d{6}-\d{3}\.db$/;
const RETAIN = 30;

const stamp = () => {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
};

export const listBackups = () =>
  fs.readdirSync(BACKUP_DIR).filter(f => NAME_RE.test(f))
    .map(f => { const st = fs.statSync(path.join(BACKUP_DIR, f)); return { file: f, size: st.size, ts: st.mtimeMs }; })
    .sort((a, b) => b.ts - a.ts);

export async function runBackup(reason = "manual") {
  const file = `cpcms-${stamp()}.db`;
  await db.backup(path.join(BACKUP_DIR, file));          // safe online copy
  // retention: keep the newest RETAIN snapshots
  listBackups().slice(RETAIN).forEach(b => fs.unlinkSync(path.join(BACKUP_DIR, b.file)));
  log("system", "BACKUP", `${file} · ${reason}`);
  return file;
}

// Daily schedule — fires once in the 02:00–02:09 IST window each day
export function startBackupSchedule(logInfo) {
  let lastDay = "";
  setInterval(() => {
    const ist = new Date(Date.now() + 5.5 * 3600e3);     // UTC → IST
    const day = ist.toISOString().slice(0, 10);
    if (ist.getUTCHours() === 2 && lastDay !== day) {
      lastDay = day;
      runBackup("scheduled").then(f => logInfo(`Scheduled backup: ${f}`)).catch(e => logInfo(`Backup failed: ${e}`));
    }
  }, 5 * 60e3);
}

export default async function adminRoutes(app) {
  app.get("/api/admin/backups", { preHandler: requireAdmin }, async () => ({ ok: true, backups: listBackups() }));

  app.post("/api/admin/backup", { preHandler: requireAdmin }, async (req) => {
    const file = await runBackup(`manual by ${req.user.email}`);
    return { ok: true, file, backups: listBackups() };
  });

  app.get("/api/admin/backups/:file", { preHandler: requireAdmin }, async (req, reply) => {
    const f = req.params.file;
    if (!NAME_RE.test(f) || !fs.existsSync(path.join(BACKUP_DIR, f)))
      return reply.code(404).send({ ok: false, error: "No such snapshot." });
    reply.header("Content-Disposition", `attachment; filename="${f}"`);
    reply.type("application/octet-stream");
    return reply.send(fs.createReadStream(path.join(BACKUP_DIR, f)));
  });

  app.post("/api/admin/restore", { preHandler: requireAdmin }, async (req, reply) => {
    const { file, confirm } = req.body || {};
    if (confirm !== "RESTORE") return reply.code(400).send({ ok: false, error: 'Type RESTORE to confirm.' });
    if (!NAME_RE.test(String(file)) || !fs.existsSync(path.join(BACKUP_DIR, file)))
      return reply.code(404).send({ ok: false, error: "No such snapshot." });
    // Stage the chosen snapshot FIRST: at the retention cap, the safety backup
    // below would otherwise prune the oldest file — which could be this one.
    const staged = DB_PATH + ".restore-staged";
    fs.copyFileSync(path.join(BACKUP_DIR, file), staged);
    // safety net: snapshot the current state before it is replaced
    const safety = await runBackup(`pre-restore safety by ${req.user.email || req.user.phone}`);
    log(req.user.email || req.user.phone, "RESTORE", `${file} (safety: ${safety})`);
    setTimeout(() => {
      let copied = false;
      try {
        db.close();
        for (const suffix of ["-wal", "-shm"]) { const p = DB_PATH + suffix; if (fs.existsSync(p)) fs.unlinkSync(p); }
        fs.copyFileSync(staged, DB_PATH); copied = true;
        fs.unlinkSync(staged);
      } finally {
        if (!copied) try { fs.unlinkSync(staged); } catch {}
        process.exit(0);                                  // PM2 restarts on the restored DB
      }
    }, 400);
    return { ok: true, restarting: true, safety };
  });
}
