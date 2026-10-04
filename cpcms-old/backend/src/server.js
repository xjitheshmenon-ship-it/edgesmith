import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedAdmin } from "./db.js";
import authRoutes from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
await app.register(authRoutes);

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

const seeded = seedAdmin();
if (seeded) {
  app.log.info(`Admin account created: ${seeded.email}`);
  if (seeded.generated) app.log.warn(`Generated admin password (change it after first sign-in): ${seeded.password}`);
}

const port = Number(process.env.PORT || 3001);
app.listen({ port, host: "0.0.0.0" }).catch((err) => { app.log.error(err); process.exit(1); });
