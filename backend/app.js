// CPCMS — Configurable Production Cycle Management System
// Edgesmith Tooling India Pvt Ltd
//
// Implementation: Standalone webapp. Node.js (Express) REST API + PostgreSQL.
// Drop-in replacement for the prior backend — same /api/* contract for the SPA.
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { config } from './src/config/env.js';
import { pool } from './src/db/pool.js';
import { runMigrations } from './migrations/run.js';
import { seed } from './seeds/seed.js';
import { startJobs } from './src/jobs/index.js';
import { notFound, errorHandler } from './src/middleware/error.js';

import authRoutes from './src/routes/auth.js';
import usersRoutes from './src/routes/users.js';
import factoryRoutes from './src/routes/factory.js';
import cycleRoutes from './src/routes/cycle.js';
import productRoutes from './src/routes/product.js';
import uidRoutes from './src/routes/uid.js';
import manufacturingRoutes from './src/routes/manufacturing.js';
import shopfloorRoutes from './src/routes/shopfloor.js';
import shiftsRoutes from './src/routes/shifts.js';
import faridabadRoutes from './src/routes/faridabad.js';
import temperingRoutes from './src/routes/tempering.js';

const app = express();

app.use(
  cors({
    origin: config.corsOrigins.length ? config.corsOrigins : true,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true })); // OAuth2 password form login
app.use(cookieParser());

// Health checks
function healthHandler(req, res) {
  res.json({ success: true, status: 'ok', app: 'CPCMS', version: '1.0.0' });
}
app.get('/health', healthHandler);
app.get('/api/v1/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, status: 'ok', database: 'connected', version: '1.0.0' });
  } catch {
    res.status(503).json({ success: false, status: 'degraded', database: 'disconnected' });
  }
});

// API routes (contract preserved from the prior backend)
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/factory', factoryRoutes);
app.use('/api/cycles', cycleRoutes);
app.use('/api/products', productRoutes);
app.use('/api/uids', uidRoutes);
app.use('/api/manufacturing', manufacturingRoutes);
app.use('/api/shopfloor', shopfloorRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use('/api/faridabad', faridabadRoutes);
app.use('/api/tempering', temperingRoutes);

app.use(notFound);
app.use(errorHandler);

async function start() {
  try {
    await runMigrations();
    await seed();
  } catch (err) {
    console.error('[startup] migrate/seed failed:', err);
    process.exit(1);
  }
  startJobs();
  app.listen(config.port, () => {
    console.log(`[cpcms] backend listening on :${config.port} (${config.nodeEnv})`);
  });
}

start();

export default app;
