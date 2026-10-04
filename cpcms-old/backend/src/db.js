// SQLite via better-sqlite3 — one file on disk, zero services to babysit.
// The DB lives next to the code in ./data/cpcms.db (git-ignored).
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "cpcms.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('Admin','Director','Supervisor','Operator')),
  location      TEXT NOT NULL CHECK (location IN ('DHARMAPURI','FARIDABAD')),
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_log (
  ts     INTEGER NOT NULL,
  email  TEXT,
  event  TEXT NOT NULL,   -- LOGIN_OK | LOGIN_FAIL | PASSWORD_CHANGE | USER_CREATE | USER_UPDATE
  detail TEXT
);
`);

// ── First-run admin seed ──────────────────────────────────────────────────────
// Credentials come from .env so nothing secret is in the code. If the users
// table is empty and no env credentials are set, a random password is generated
// and printed ONCE to the console — change it after first sign-in.
export function seedAdmin() {
  const count = db.prepare("SELECT COUNT(*) n FROM users").get().n;
  if (count > 0) return null;
  const email = process.env.ADMIN_EMAIL || "admin@edgesmith.in";
  const password = process.env.ADMIN_PASSWORD || Math.random().toString(36).slice(2, 12);
  const now = Date.now();
  db.prepare(`INSERT INTO users (id, name, email, password_hash, role, location, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'Admin', 'DHARMAPURI', 'ACTIVE', ?, ?)`)
    .run("DHA-ADM-001", process.env.ADMIN_NAME || "System Administrator", email, bcrypt.hashSync(password, 10), now, now);
  return { email, password, generated: !process.env.ADMIN_PASSWORD };
}

export const publicUser = (u) => u && ({ id: u.id, name: u.name, email: u.email, role: u.role, location: u.location, status: u.status });

export const findByEmail = (email) =>
  db.prepare("SELECT * FROM users WHERE email = ?").get(String(email || "").trim());

export const findById = (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id);

export const log = (email, event, detail = "") =>
  db.prepare("INSERT INTO auth_log (ts, email, event, detail) VALUES (?, ?, ?, ?)").run(Date.now(), email, event, detail);
