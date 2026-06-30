require('dotenv').config();
// Note: Express 5 (installed here) natively forwards rejected promises from
// async route handlers to the error-handling middleware — the
// express-async-errors shim (built for Express 4's internals) is not
// needed and is incompatible with Express 5's restructured Router/Layer
// classes, so it is intentionally not used.

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');

const { pool } = require('./src/config/database');
const { errorHandler } = require('./src/middleware/errorHandler');
const { rateLimiter } = require('./src/middleware/rateLimiter');

const { runShiftAutoStart } = require('./src/jobs/shiftStart');
const { runBadgeExpiryCheck } = require('./src/jobs/badgeExpiry');
const { runOverdueReceivingCheck } = require('./src/jobs/overdueReceiving');

const app = express();

// ── Core middleware ──────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ALLOWED_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(rateLimiter({ windowMs: 60_000, max: 300 }));

// ── Health check (no auth — used by nginx/PM2/uptime monitors) ─────────────
app.get('/api/v1/health', async (req, res) => {
  let dbStatus = 'unknown';
  let activeUids = null;
  try {
    const result = await pool.query('SELECT 1');
    dbStatus = result ? 'connected' : 'error';
    const uidCount = await pool.query(`SELECT COUNT(*) AS c FROM uids WHERE status = 'active'`);
    activeUids = Number(uidCount.rows[0].c);
  } catch (e) {
    dbStatus = 'error';
  }
  res.json({
    success: true,
    status: 'ok',
    database: dbStatus,
    active_uids: activeUids,
    uptime_seconds: Math.floor(process.uptime()),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// ── Routes ───────────────────────────────────────────────────────────────────
const API_PREFIX = '/api/v1';

app.use(`${API_PREFIX}/auth`, require('./src/routes/auth'));
app.use(`${API_PREFIX}/uids`, require('./src/routes/uids'));
app.use(`${API_PREFIX}/cycles`, require('./src/routes/cycles'));
app.use(`${API_PREFIX}/jobs`, require('./src/routes/jobs'));
app.use(`${API_PREFIX}/faridabad`, require('./src/routes/faridabad'));
app.use(`${API_PREFIX}/receiving`, require('./src/routes/receiving'));
app.use(`${API_PREFIX}/shifts`, require('./src/routes/shifts'));
app.use(`${API_PREFIX}/employees`, require('./src/routes/employees'));
app.use(`${API_PREFIX}/mos`, require('./src/routes/mos'));
app.use(`${API_PREFIX}/qc`, require('./src/routes/qc'));
app.use(`${API_PREFIX}/reports`, require('./src/routes/reports'));
app.use(`${API_PREFIX}/service`, require('./src/routes/service'));
app.use(`${API_PREFIX}/master`, require('./src/routes/master'));
app.use(`${API_PREFIX}/admin`, require('./src/routes/admin'));
app.use(`${API_PREFIX}/alerts`, require('./src/routes/alerts'));
app.use(`${API_PREFIX}/workstation-assignments`, require('./src/routes/workstationAssignments'));
// batches.js internally covers two resource families under one router
// (/furnace-batches/* and /grinding/*) via scoped sub-routers, so it is
// mounted at the bare API prefix rather than a single named sub-path.
app.use(`${API_PREFIX}`, require('./src/routes/batches'));

// ── 404 for unmatched API routes ────────────────────────────────────────────
app.use(`${API_PREFIX}`, (req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` } });
});

// ── Error handler (must be last) ────────────────────────────────────────────
app.use(errorHandler);

// ── Background jobs ──────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  cron.schedule('* * * * *', () => runShiftAutoStart().catch((e) => console.error('[cron] shiftStart failed', e)));
  cron.schedule('0 * * * *', () => runBadgeExpiryCheck().catch((e) => console.error('[cron] badgeExpiry failed', e)));
  cron.schedule('*/5 * * * *', () => runOverdueReceivingCheck().catch((e) => console.error('[cron] overdueReceiving failed', e)));
}

// ── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`CPCMS backend listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  });
}

module.exports = app;
