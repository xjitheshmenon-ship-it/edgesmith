import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, findByEmail, findById, publicUser, log } from "./db.js";

const SECRET = process.env.JWT_SECRET || "change-me-in-env";
const TOKEN_DAYS = Number(process.env.TOKEN_DAYS || 7);

const sign = (u) => jwt.sign({ sub: u.id, role: u.role }, SECRET, { expiresIn: `${TOKEN_DAYS}d` });

// preHandler: verifies the Bearer token and attaches req.user
export function requireAuth(req, reply, done) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) { reply.code(401).send({ ok: false, error: "Not signed in." }); return; }
  try {
    const payload = jwt.verify(token, SECRET);
    const u = findById(payload.sub);
    if (!u || u.status !== "ACTIVE") { reply.code(401).send({ ok: false, error: "Account not active." }); return; }
    req.user = u;
    done();
  } catch {
    reply.code(401).send({ ok: false, error: "Session expired — sign in again." });
  }
}

export function requireAdmin(req, reply, done) {
  requireAuth(req, reply, () => {
    if (req.user.role !== "Admin") { reply.code(403).send({ ok: false, error: "Admin only." }); return; }
    done();
  });
}

export default async function authRoutes(app) {
  // Sign in — tighter rate limit than the rest of the API
  app.post("/api/auth/login", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const { email, password } = req.body || {};
    if (!email || !password) return reply.code(400).send({ ok: false, error: "Enter your email and password." });
    const u = findByEmail(email);
    if (!u || !bcrypt.compareSync(password, u.password_hash)) {
      log(email, "LOGIN_FAIL");
      return reply.code(401).send({ ok: false, error: "Wrong email or password." });
    }
    if (u.status !== "ACTIVE") {
      log(email, "LOGIN_FAIL", "disabled");
      return reply.code(403).send({ ok: false, error: "This account is disabled — ask an administrator." });
    }
    log(email, "LOGIN_OK");
    return { ok: true, token: sign(u), user: publicUser(u) };
  });

  // Who am I — used by the frontend to restore a session on page load
  app.get("/api/auth/me", { preHandler: requireAuth }, async (req) => ({ ok: true, user: publicUser(req.user) }));

  // Change own password
  app.post("/api/auth/change-password", { preHandler: requireAuth }, async (req, reply) => {
    const { current, next } = req.body || {};
    if (!next || String(next).length < 8) return reply.code(400).send({ ok: false, error: "New password must be at least 8 characters." });
    if (!bcrypt.compareSync(current || "", req.user.password_hash)) return reply.code(401).send({ ok: false, error: "Current password is wrong." });
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(bcrypt.hashSync(next, 10), Date.now(), req.user.id);
    log(req.user.email, "PASSWORD_CHANGE");
    return { ok: true };
  });

  // ── Admin: user management ──────────────────────────────────────────────────
  app.get("/api/users", { preHandler: requireAdmin }, async () =>
    ({ ok: true, users: db.prepare("SELECT * FROM users ORDER BY created_at").all().map(publicUser) }));

  app.post("/api/users", { preHandler: requireAdmin }, async (req, reply) => {
    const { id, name, email, password, role, location } = req.body || {};
    if (!id || !name || !email || !password || !role || !location)
      return reply.code(400).send({ ok: false, error: "id, name, email, password, role and location are all required." });
    if (String(password).length < 8) return reply.code(400).send({ ok: false, error: "Password must be at least 8 characters." });
    try {
      const now = Date.now();
      db.prepare(`INSERT INTO users (id, name, email, password_hash, role, location, status, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`)
        .run(id, name, email, bcrypt.hashSync(password, 10), role, location, now, now);
      log(req.user.email, "USER_CREATE", `${id} ${email} ${role}`);
      return { ok: true, user: publicUser(findById(id)) };
    } catch (e) {
      return reply.code(409).send({ ok: false, error: /UNIQUE/.test(String(e)) ? "That email or ID is already in use." : "Could not create the user." });
    }
  });

  app.patch("/api/users/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const u = findById(req.params.id);
    if (!u) return reply.code(404).send({ ok: false, error: "No such user." });
    const { name, role, location, status } = req.body || {};
    if (u.id === req.user.id && status === "DISABLED") return reply.code(400).send({ ok: false, error: "You cannot disable your own account." });
    db.prepare("UPDATE users SET name = ?, role = ?, location = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(name ?? u.name, role ?? u.role, location ?? u.location, status ?? u.status, Date.now(), u.id);
    log(req.user.email, "USER_UPDATE", u.id);
    return { ok: true, user: publicUser(findById(u.id)) };
  });

  app.post("/api/users/:id/reset-password", { preHandler: requireAdmin }, async (req, reply) => {
    const u = findById(req.params.id);
    if (!u) return reply.code(404).send({ ok: false, error: "No such user." });
    const { password } = req.body || {};
    if (!password || String(password).length < 8) return reply.code(400).send({ ok: false, error: "Password must be at least 8 characters." });
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(bcrypt.hashSync(password, 10), Date.now(), u.id);
    log(req.user.email, "PASSWORD_CHANGE", `admin reset for ${u.id}`);
    return { ok: true };
  });
}
