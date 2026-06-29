// Job-execution timing: start / pause / resume / complete events per UID, plus
// the admin-tunable pause threshold. Events feed an active/paused-seconds
// computation derived by walking the ordered start/pause/resume/complete trail.
import { Router } from 'express';
import { query, one } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireAdmin, HttpError } from '../middleware/auth.js';

const router = Router();

const DEFAULT_MAX_PAUSE_MINUTES = 30;

const EVENT_SELECT = `
  SELECT e.id, e.uid_id, e.cycle_step_id, e.workstation_id, e.operator_id,
         e.event_type, e.reason, e.created_at,
         op.username AS op_username, op.full_name AS op_full_name
    FROM job_events e
    LEFT JOIN users op ON op.id = e.operator_id
`;

function eventOut(e) {
  return {
    id: e.id,
    uid_id: e.uid_id,
    cycle_step_id: e.cycle_step_id,
    workstation_id: e.workstation_id,
    operator_id: e.operator_id,
    operator_name: e.op_full_name || e.op_username || null,
    event_type: e.event_type,
    reason: e.reason,
    created_at: e.created_at,
  };
}

// Resolve a UID's current step + the workstation that step runs on.
async function loadUidContext(uidId) {
  const id = parseInt(uidId, 10);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid UID id');
  const ctx = await one(
    `SELECT u.id AS uid_id, u.current_step_id, cs.workstation_id
       FROM uids u
       LEFT JOIN cycle_steps cs ON cs.id = u.current_step_id
      WHERE u.id = $1`,
    [id]
  );
  if (!ctx) throw new HttpError(404, 'UID not found');
  return ctx;
}

// Insert a job_event for the UID's current step and return the enriched row.
async function recordEvent(uidId, eventType, operatorId, reason) {
  const ctx = await loadUidContext(uidId);
  const created = await one(
    `INSERT INTO job_events (uid_id, cycle_step_id, workstation_id, operator_id, event_type, reason)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [ctx.uid_id, ctx.current_step_id, ctx.workstation_id, operatorId, eventType, reason ?? null]
  );
  const row = await one(`${EVENT_SELECT} WHERE e.id = $1`, [created.id]);
  return eventOut(row);
}

// Walk the ordered events accumulating active-work and paused seconds.
// start/resume open an active interval; pause/complete close it. The gap
// between a pause and the next resume counts as paused time. Robust to
// malformed sequences (double starts, missing resume, etc.).
function computeTiming(events) {
  let active = 0;
  let paused = 0;
  let activeOpenedAt = null; // timestamp ms when current active interval began
  let pausedOpenedAt = null; // timestamp ms when current pause began

  for (const e of events) {
    const t = new Date(e.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    switch (e.event_type) {
      case 'start':
      case 'resume':
        // Closing any open pause interval.
        if (pausedOpenedAt != null) {
          paused += Math.max(0, t - pausedOpenedAt);
          pausedOpenedAt = null;
        }
        // Open a fresh active interval (ignore if one is already open).
        if (activeOpenedAt == null) activeOpenedAt = t;
        break;
      case 'pause':
        if (activeOpenedAt != null) {
          active += Math.max(0, t - activeOpenedAt);
          activeOpenedAt = null;
        }
        if (pausedOpenedAt == null) pausedOpenedAt = t;
        break;
      case 'complete':
        if (activeOpenedAt != null) {
          active += Math.max(0, t - activeOpenedAt);
          activeOpenedAt = null;
        }
        if (pausedOpenedAt != null) {
          paused += Math.max(0, t - pausedOpenedAt);
          pausedOpenedAt = null;
        }
        break;
      default:
        break;
    }
  }

  return {
    active_seconds: Math.round(active / 1000),
    paused_seconds: Math.round(paused / 1000),
  };
}

function statusFromLast(events) {
  if (!events.length) return 'idle';
  const last = events[events.length - 1].event_type;
  if (last === 'start' || last === 'resume') return 'running';
  if (last === 'pause') return 'paused';
  if (last === 'complete') return 'complete';
  return 'idle';
}

async function readMaxPauseMinutes() {
  const row = await one('SELECT value FROM app_settings WHERE key = $1', ['max_pause_minutes']);
  if (!row || row.value == null) return DEFAULT_MAX_PAUSE_MINUTES;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : DEFAULT_MAX_PAUSE_MINUTES;
}

// ── Timing events ───────────────────────────────────────────────────────────
router.post(
  '/:uidId/start',
  requireAuth,
  asyncHandler(async (req, res) => {
    const event = await recordEvent(req.params.uidId, 'start', req.user.id, null);
    res.json(event);
  })
);

router.post(
  '/:uidId/pause',
  requireAuth,
  asyncHandler(async (req, res) => {
    const reason = (req.body || {}).reason ?? null;
    const event = await recordEvent(req.params.uidId, 'pause', req.user.id, reason);
    res.json(event);
  })
);

router.post(
  '/:uidId/resume',
  requireAuth,
  asyncHandler(async (req, res) => {
    const event = await recordEvent(req.params.uidId, 'resume', req.user.id, null);
    res.json(event);
  })
);

router.post(
  '/:uidId/complete',
  requireAuth,
  asyncHandler(async (req, res) => {
    const reason = (req.body || {}).reason ?? null;
    const event = await recordEvent(req.params.uidId, 'complete', req.user.id, reason);
    res.json(event);
  })
);

router.get(
  '/:uidId/events',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.uidId, 10);
    if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid UID id');
    const rows = await query(
      `${EVENT_SELECT} WHERE e.uid_id = $1 ORDER BY e.created_at ASC, e.id ASC`,
      [id]
    );
    const { active_seconds, paused_seconds } = computeTiming(rows);
    res.json({
      events: rows.map(eventOut),
      active_seconds,
      paused_seconds,
      status: statusFromLast(rows),
    });
  })
);

// ── Pause threshold setting ─────────────────────────────────────────────────
router.get(
  '/settings/pause-threshold',
  requireAuth,
  asyncHandler(async (req, res) => {
    const max_pause_minutes = await readMaxPauseMinutes();
    res.json({ max_pause_minutes });
  })
);

router.put(
  '/settings/pause-threshold',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const raw = (req.body || {}).max_pause_minutes;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'max_pause_minutes must be a non-negative number');
    await query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      ['max_pause_minutes', JSON.stringify(n)]
    );
    res.json({ max_pause_minutes: n });
  })
);

export default router;
