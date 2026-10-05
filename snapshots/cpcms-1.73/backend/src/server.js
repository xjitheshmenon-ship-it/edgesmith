import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedAdmin, DB_PATH } from "./db.js";
import authRoutes from "./auth.js";
import adminRoutes, { startBackupSchedule } from "./admin.js";
import stateRoutes from "./state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
await app.register(authRoutes);
await app.register(adminRoutes);
await app.register(stateRoutes);

// Every error leaves as the same envelope the routes use — clients parse one shape.
app.setErrorHandler((err, req, reply) => {
  const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (code >= 500) req.log.error(err);
  reply.code(code).send({ ok: false, error: code >= 500 ? "Server error — try again." : err.message });
});

app.get("/api/health", async () => ({ ok: true, service: "cpcms", ts: Date.now() }));

// In production the same process serves the built frontend, so one PM2 process
// and one port is the whole deployment. If frontend/dist isn't there (dev mode,
// where Vite serves it), this block simply doesn't register.
const dist = path.join(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  // SPA fallback — any non-API path returns index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith("/api/")) return reply.code(404).send({ ok: false, error: "Not found." });
    return reply.sendFile("index.html");
  });
}

try { fs.unlinkSync(DB_PATH + ".restore-staged"); } catch {}   // leftover from an interrupted restore
const seeded = seedAdmin();
if (seeded) {
  app.log.info(`Admin account created: ${seeded.email}`);
  if (seeded.generated) app.log.warn(`Generated admin password (change it after first sign-in): ${seeded.password}`);
}

startBackupSchedule((m) => app.log.info(m));

const port = Number(process.env.PORT || 3001);
app.listen({ port, host: "0.0.0.0" }).catch((err) => { app.log.error(err); process.exit(1); });
