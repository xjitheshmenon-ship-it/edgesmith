import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { db, findByEmail, findByLogin, findById, publicUser, log, normPhone } from "./db.js";
import { mailConfigured, sendInvite, sendReset } from "./mailer.js";

const makeToken = (userId, kind, hours) => {
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO tokens (token, user_id, kind, expires) VALUES (?, ?, ?, ?)")
    .run(token, userId, kind, Date.now() + hours * 3600e3);
  return token;
};
const takeToken = (token) => {
  const t = db.prepare("SELECT * FROM tokens WHERE token = ?").get(String(token || ""));
  if (!t || t.used || t.expires < Date.now()) return null;
  db.prepare("UPDATE tokens SET used = 1 WHERE token = ?").run(t.token);
  return t;
};

const SECRET = process.env.JWT_SECRET || "change-me-in-env";
const TOKEN_DAYS = Number(process.env.TOKEN_DAYS || 7);

// pwv ties the token to the CURRENT password hash: change or reset the
// password and every previously issued token dies immediately.
const pwv = (u) => String(u.password_hash || "").slice(-16);
const sign = (u) => jwt.sign({ sub: u.id, role: u.role, pwv: pwv(u) }, SECRET, { expiresIn: `${TOKEN_DAYS}d` });

// preHandler: verifies the Bearer token and attaches req.user
export function requireAuth(req, reply, done) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) { reply.code(401).send({ ok: false, error: "Not signed in." }); return; }
  try {
    const payload = jwt.verify(token, SECRET);
    const u = findById(payload.sub);
    if (!u || u.status !== "ACTIVE") { reply.code(401).send({ ok: false, error: "Account not active." }); return; }
    if (payload.pwv !== String(u.password_hash || "").slice(-16)) {
      reply.code(401).send({ ok: false, error: "Session expired — sign in again." }); return;
    }
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
    const { email, login, password } = req.body || {};
    const id = login || email;
    if (!id || !password) return reply.code(400).send({ ok: false, error: "Enter your email or phone, and password." });
    const u = findByLogin(id);
    // Status first: an invited account has no usable password yet, so a
    // password check would always answer "wrong password" and hide the truth.
    if (u && u.status === "INVITED") {
      log(id, "LOGIN_FAIL", "invited");
      return reply.code(403).send({ ok: false, error: "Invitation pending — set your password through the link that was emailed to you." });
    }
    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      log(id, "LOGIN_FAIL");
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
    if (!(await bcrypt.compare(current || "", req.user.password_hash))) return reply.code(401).send({ ok: false, error: "Current password is wrong." });
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(await bcrypt.hash(next, 10), Date.now(), req.user.id);
    log(req.user.email, "PASSWORD_CHANGE");
    return { ok: true };
  });

  // ── Admin: user management ──────────────────────────────────────────────────
  app.get("/api/users", { preHandler: requireAdmin }, async () =>
    ({ ok: true, users: db.prepare("SELECT * FROM users ORDER BY created_at").all().map(publicUser) }));

  app.post("/api/users", { preHandler: requireAdmin }, async (req, reply) => {
    const { id, name, email, phone, password, role, location } = req.body || {};
    const ph = normPhone(phone);
    if (!id || !name || (!email && !ph) || !password || !role || !location)
      return reply.code(400).send({ ok: false, error: "id, name, an email or phone, password, role and location are required." });
    if (email && !String(email).includes("@")) return reply.code(400).send({ ok: false, error: "That email is not valid — for a phone login, put it in the phone field." });
    if (ph && ph.length < 10) return reply.code(400).send({ ok: false, error: "Phone number must have at least 10 digits." });
    if (String(password).length < 8) return reply.code(400).send({ ok: false, error: "Password must be at least 8 characters." });
    try {
      const now = Date.now();
      db.prepare(`INSERT INTO users (id, name, email, phone, password_hash, role, location, status, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`)
        .run(id, name, email || null, ph, await bcrypt.hash(password, 10), role, location, now, now);
      log(req.user.email, "USER_CREATE", `${id} ${email || ph} ${role}`);
      return { ok: true, user: publicUser(findById(id)) };
    } catch (e) {
      return reply.code(409).send({ ok: false, error: /UNIQUE/.test(String(e)) ? "That email, phone or ID is already in use." : "Could not create the user." });
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

  // Whether email features are available — the frontend adapts its UI to this
  app.get("/api/config", async () => ({ ok: true, mail: mailConfigured(), userDelete: process.env.USER_DELETE !== "off" }));

  // ── Email invitation: creates the account as INVITED and emails a set-password link
  app.post("/api/users/invite", { preHandler: requireAdmin }, async (req, reply) => {
    if (!mailConfigured()) return reply.code(400).send({ ok: false, error: "Email is not configured on the server — add SMTP settings to .env, or use a temporary password instead." });
    const { id, name, email, role, location } = req.body || {};
    if (!email || !role || !location) return reply.code(400).send({ ok: false, error: "email, role and location are required." });
    let u = findByEmail(email);
    if (u && u.status === "ACTIVE") return reply.code(409).send({ ok: false, error: "That email already has an active account." });
    const now = Date.now();
    if (!u) {
      if (!id) return reply.code(400).send({ ok: false, error: "Employee ID is required." });
      db.prepare(`INSERT INTO users (id, name, email, password_hash, role, location, status, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, 'INVITED', ?, ?)`)
        .run(id, name || email.split("@")[0], email, crypto.randomBytes(24).toString("hex"), role, location, now, now);
      u = findById(id);
    } else {
      db.prepare("UPDATE users SET name = ?, role = ?, location = ?, status = 'INVITED', updated_at = ? WHERE id = ?")
        .run(name ?? u.name, role, location, now, u.id);
      u = findById(u.id);
    }
    try {
      await sendInvite(u.email, u.name, makeToken(u.id, "INVITE", 48));
    } catch (e) {
      req.log.error(e);
      return reply.code(502).send({ ok: false, error: "Could not send the email — check the SMTP settings in .env." });
    }
    log(req.user.email, "USER_INVITE", `${u.id} ${u.email} ${u.role}`);
    return { ok: true, user: publicUser(findById(u.id)) };
  });

  // ── The emailed link lands here: user sets their own password ──────────────
  app.post("/api/auth/set-password", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const { token, password } = req.body || {};
    if (!password || String(password).length < 8) return reply.code(400).send({ ok: false, error: "Password must be at least 8 characters." });
    const t = takeToken(token);
    if (!t) return reply.code(400).send({ ok: false, error: "This link has expired or was already used — ask an administrator to send a new one." });
    const u = findById(t.user_id);
    if (!u) return reply.code(400).send({ ok: false, error: "Account no longer exists." });
    db.prepare("UPDATE users SET password_hash = ?, status = 'ACTIVE', updated_at = ? WHERE id = ?")
      .run(await bcrypt.hash(password, 10), Date.now(), u.id);
    log(u.email, "PASSWORD_CHANGE", t.kind === "INVITE" ? "invite accepted" : "reset via email");
    return { ok: true, email: u.email };
  });

  // ── Forgot password: emails a reset link; never reveals whether the email exists
  app.post("/api/auth/forgot", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const generic = { ok: true, message: "If that email has an account, a reset link is on its way." };
    if (!mailConfigured()) return reply.code(400).send({ ok: false, error: "Email is not configured on this server — ask an administrator to reset your password." });
    const u = findByEmail((req.body || {}).email);
    if (u && u.status === "ACTIVE") {
      try { await sendReset(u.email, u.name, makeToken(u.id, "RESET", 1)); log(u.email, "RESET_REQUEST"); }
      catch (e) { req.log.error(e); }
    }
    return generic;
  });

  // Trial-period only: permanent removal. Set USER_DELETE=off in .env for
  // production and this endpoint refuses — disabling stays the only option.
  app.delete("/api/users/:id", { preHandler: requireAdmin }, async (req, reply) => {
    if (process.env.USER_DELETE === "off")
      return reply.code(403).send({ ok: false, error: "Deleting accounts is turned off — disable the account instead." });
    const u = findById(req.params.id);
    if (!u) return reply.code(404).send({ ok: false, error: "No such user." });
    if (u.id === req.user.id) return reply.code(400).send({ ok: false, error: "You cannot delete your own account." });
    if (u.role === "Admin") {
      const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'Admin' AND status = 'ACTIVE'").get().n;
      if (admins <= 1) return reply.code(400).send({ ok: false, error: "Cannot delete the last active Admin." });
    }
    db.prepare("DELETE FROM tokens WHERE user_id = ?").run(u.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    log(req.user.email || req.user.phone, "USER_DELETE", `${u.id} ${u.email || u.phone} ${u.role}`);
    return { ok: true };
  });

  app.post("/api/users/:id/reset-password", { preHandler: requireAdmin }, async (req, reply) => {
    const u = findById(req.params.id);
    if (!u) return reply.code(404).send({ ok: false, error: "No such user." });
    const { password } = req.body || {};
    if (!password || String(password).length < 8) return reply.code(400).send({ ok: false, error: "Password must be at least 8 characters." });
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(await bcrypt.hash(password, 10), Date.now(), u.id);
    log(req.user.email, "PASSWORD_CHANGE", `admin reset for ${u.id}`);
    return { ok: true };
  });
}
