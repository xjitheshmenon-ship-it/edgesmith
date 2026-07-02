const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');
const { createAlert } = require('../utils/alerts');

const router = express.Router();
router.use(authenticate, auditContext);

const DEFAULT_INTERVAL = 60;
const NOTIFY_LEAD_MS = 5 * 60 * 1000; // 5-minute pre-slot notification window

// The current open shift for a location (Model-2 stations are all Dharmapuri).
async function currentShift(q, locationId = 1) {
  const { rows } = await q(
    `SELECT s.*, sc.start_time, sc.end_time
     FROM shifts s JOIN shifts_config sc ON sc.shift_number = s.shift_number
     WHERE s.ended_at IS NULL AND s.location_id = $1
     ORDER BY s.id DESC LIMIT 1`,
    [locationId]
  );
  return rows[0] || null;
}

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

// The [start, end) window of a shift as JS Dates, from its actual start (or the
// configured start time on the shift date) plus the configured duration.
function shiftWindow(shift) {
  const start = shift.started_at ? new Date(shift.started_at) : new Date(`${shift.shift_date}T${shift.start_time}`);
  let durMin = 480;
  const s = timeToMinutes(shift.start_time);
  const e = timeToMinutes(shift.end_time);
  if (s != null && e != null) {
    durMin = ((e - s) % 1440 + 1440) % 1440 || 480; // handle overnight wrap
  }
  const end = new Date(start.getTime() + durMin * 60000);
  return { start, end };
}

// Assigned operator pool for a workstation in a shift, with INSP-badge flag.
async function poolFor(q, workstationTypeId, shiftId) {
  const { rows } = await q(
    `SELECT wa.employee_id, e.full_name,
            EXISTS (
              SELECT 1 FROM employee_badges eb JOIN badge_types bt ON bt.id = eb.badge_type_id
              WHERE eb.employee_id = wa.employee_id AND bt.code = 'INSP' AND bt.status = 'active'
                AND eb.revoked_at IS NULL AND (eb.expiry_date IS NULL OR eb.expiry_date >= CURRENT_DATE)
            ) AS has_insp
     FROM workstation_assignments wa
     JOIN employees e ON e.id = wa.employee_id
     WHERE wa.workstation_type_id = $1 AND wa.shift_id = $2 AND wa.unassigned_at IS NULL
     ORDER BY wa.employee_id`,
    [workstationTypeId, shiftId]
  );
  return rows;
}

// (Re)generate the rotation slots for a schedule from the assigned pool.
// HRC-01 (isFixedStation): one INSP holder is present all shift; the rest rotate.
async function generateSlots(q, schedule, shift, workstation) {
  await q(`DELETE FROM swap_slots WHERE schedule_id = $1`, [schedule.id]);
  const pool = await poolFor(q, workstation.id, shift.id);
  if (!pool.length) return 0;

  const { start, end } = shiftWindow(shift);
  const intervalMs = (schedule.interval_minutes || DEFAULT_INTERVAL) * 60000;
  const isFixedStation = workstation.code === 'HRC-01';

  let rotating = pool;
  let fixed = null;
  if (isFixedStation) {
    fixed = pool.find((p) => p.has_insp) || pool[0];
    rotating = pool.filter((p) => p.employee_id !== fixed.employee_id);
    // The fixed INSP holder is present for the whole shift.
    await q(
      `INSERT INTO swap_slots (schedule_id, shift_id, workstation_type_id, employee_id, slot_index, starts_at, ends_at, is_fixed)
       VALUES ($1,$2,$3,$4,0,$5,$6,true)`,
      [schedule.id, shift.id, workstation.id, fixed.employee_id, start.toISOString(), end.toISOString()]
    );
  }

  let count = isFixedStation ? 1 : 0;
  if (rotating.length) {
    let k = 0;
    for (let t = start.getTime(); t < end.getTime(); t += intervalMs, k++) {
      const slotStart = new Date(t);
      const slotEnd = new Date(Math.min(t + intervalMs, end.getTime()));
      const op = rotating[k % rotating.length];
      await q(
        `INSERT INTO swap_slots (schedule_id, shift_id, workstation_type_id, employee_id, slot_index, starts_at, ends_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [schedule.id, shift.id, workstation.id, op.employee_id, k + 1, slotStart.toISOString(), slotEnd.toISOString()]
      );
      count++;
    }
  }
  return count;
}

async function upsertSchedule(q, shiftId, wtId, intervalMinutes, userId) {
  const { rows } = await q(
    `INSERT INTO swap_schedules (shift_id, workstation_type_id, interval_minutes, updated_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (shift_id, workstation_type_id)
       DO UPDATE SET interval_minutes = EXCLUDED.interval_minutes, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [shiftId, wtId, intervalMinutes || DEFAULT_INTERVAL, userId || null]
  );
  return rows[0];
}

/**
 * GET /api/v1/swap-pools — every Model-2 swap-pool workstation for the current
 * shift with its pool, current/next operator, slot countdown and interval.
 */
router.get('/', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const shift = await currentShift(query);
  const { rows: stations } = await query(
    `SELECT id, code, name, min_operators FROM workstation_types WHERE staffing_model = 2 ORDER BY code`
  );
  const now = Date.now();

  const data = [];
  for (const ws of stations) {
    const pool = shift ? await poolFor(query, ws.id, shift.id) : [];
    const min = Number(ws.min_operators) || 1;
    const understaffed = pool.length < min;

    let schedule = null, slots = [];
    if (shift) {
      const { rows: sch } = await query(`SELECT * FROM swap_schedules WHERE shift_id = $1 AND workstation_type_id = $2`, [shift.id, ws.id]);
      schedule = sch[0] || null;
      if (schedule) {
        const { rows: sl } = await query(
          `SELECT sl.*, e.full_name FROM swap_slots sl JOIN employees e ON e.id = sl.employee_id
           WHERE sl.schedule_id = $1 ORDER BY sl.is_fixed DESC, sl.starts_at`,
          [schedule.id]
        );
        slots = sl;
      }
    }

    const rotating = slots.filter((s) => !s.is_fixed);
    const fixed = slots.find((s) => s.is_fixed) || null;
    const current = rotating.find((s) => new Date(s.starts_at).getTime() <= now && now < new Date(s.ends_at).getTime()) || null;
    const upcoming = rotating.filter((s) => new Date(s.starts_at).getTime() > now).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const next = upcoming[0] || null;

    data.push({
      workstation_type_id: ws.id, code: ws.code, name: ws.name, min_operators: min,
      pool: pool.map((p) => ({ employee_id: p.employee_id, name: p.full_name, has_insp: p.has_insp })),
      understaffed,
      interval_minutes: schedule ? schedule.interval_minutes : DEFAULT_INTERVAL,
      has_schedule: !!schedule,
      fixed: fixed ? { employee_id: fixed.employee_id, name: fixed.full_name } : null,
      current: current ? { slot_id: current.id, employee_id: current.employee_id, name: current.full_name, ends_at: current.ends_at, remaining_seconds: Math.max(0, Math.round((new Date(current.ends_at).getTime() - now) / 1000)), confirmed: !!current.confirmed_at } : null,
      next: next ? { slot_id: next.id, employee_id: next.employee_id, name: next.full_name, starts_at: next.starts_at, notify_soon: (new Date(next.starts_at).getTime() - now) <= NOTIFY_LEAD_MS, confirmed: !!next.confirmed_at } : null,
    });
  }

  return res.json({ success: true, data: { shift_id: shift ? shift.id : null, pools: data } });
});

/** GET /api/v1/swap-pools/my-slots — the current user's active/upcoming swap slots. */
router.get('/my-slots', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const shift = await currentShift(query);
  if (!shift) return res.json({ success: true, data: [] });
  const now = Date.now();
  const { rows } = await query(
    `SELECT sl.id, sl.workstation_type_id, sl.starts_at, sl.ends_at, sl.is_fixed, sl.confirmed_at,
            wt.code AS ws_code, wt.name AS ws_name
     FROM swap_slots sl
     JOIN swap_schedules sc ON sc.id = sl.schedule_id
     JOIN workstation_types wt ON wt.id = sl.workstation_type_id
     WHERE sc.shift_id = $1 AND sl.employee_id = $2 AND sl.ends_at > now()
     ORDER BY sl.starts_at`,
    [shift.id, req.user.sub]
  );
  return res.json({ success: true, data: rows.map((r) => ({
    ...r,
    active: new Date(r.starts_at).getTime() <= now && now < new Date(r.ends_at).getTime(),
    notify_soon: (new Date(r.starts_at).getTime() - now) <= NOTIFY_LEAD_MS,
  })) });
});

/** GET /api/v1/swap-pools/:wtId/slots — full slot schedule for one workstation. */
router.get('/:wtId/slots', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const shift = await currentShift(query);
  if (!shift) return res.json({ success: true, data: [] });
  const { rows } = await query(
    `SELECT sl.*, e.full_name FROM swap_slots sl JOIN employees e ON e.id = sl.employee_id
     JOIN swap_schedules sc ON sc.id = sl.schedule_id
     WHERE sc.shift_id = $1 AND sl.workstation_type_id = $2 ORDER BY sl.is_fixed DESC, sl.starts_at`,
    [shift.id, req.params.wtId]
  );
  return res.json({ success: true, data: rows });
});

/** POST /api/v1/swap-pools/:wtId/generate — build the rotation for this shift. */
router.post('/:wtId/generate', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const intervalMinutes = Number(req.body && req.body.intervalMinutes) || DEFAULT_INTERVAL;
  const out = await withTransaction(async (client) => {
    const q = client.query.bind(client);
    const shift = await currentShift(q);
    if (!shift) throw Object.assign(new Error('No open shift to schedule.'), { status: 409, code: 'NO_OPEN_SHIFT' });
    const { rows: wsRows } = await q(`SELECT id, code, name, min_operators, staffing_model FROM workstation_types WHERE id = $1`, [req.params.wtId]);
    const ws = wsRows[0];
    if (!ws) throw Object.assign(new Error('Workstation not found.'), { status: 404, code: 'NOT_FOUND' });
    if (ws.staffing_model !== 2) throw Object.assign(new Error('This workstation is not a swap pool.'), { status: 409, code: 'NOT_SWAP_POOL' });

    const schedule = await upsertSchedule(q, shift.id, ws.id, intervalMinutes, req.user.sub);
    const count = await generateSlots(q, schedule, shift, ws);
    return { schedule, slots: count, workstation: ws.code };
  });
  await req.audit({ tableName: 'swap_schedules', recordId: out.schedule.id, action: 'INSERT', after: { generated: out.slots, interval: out.schedule.interval_minutes } });
  return res.status(201).json({ success: true, data: out });
});

/** PATCH /api/v1/swap-pools/:wtId/interval — Supervisor overrides the interval (this shift only, logged). */
router.patch('/:wtId/interval', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const intervalMinutes = Number(req.body && req.body.intervalMinutes);
  if (!intervalMinutes || intervalMinutes < 5 || intervalMinutes > 480) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_INTERVAL', message: 'intervalMinutes must be between 5 and 480.' } });
  }
  const out = await withTransaction(async (client) => {
    const q = client.query.bind(client);
    const shift = await currentShift(q);
    if (!shift) throw Object.assign(new Error('No open shift.'), { status: 409, code: 'NO_OPEN_SHIFT' });
    const { rows: wsRows } = await q(`SELECT id, code, name, staffing_model FROM workstation_types WHERE id = $1`, [req.params.wtId]);
    const ws = wsRows[0];
    if (!ws || ws.staffing_model !== 2) throw Object.assign(new Error('Not a swap-pool workstation.'), { status: 409, code: 'NOT_SWAP_POOL' });
    const schedule = await upsertSchedule(q, shift.id, ws.id, intervalMinutes, req.user.sub);
    const count = await generateSlots(q, schedule, shift, ws);
    return { schedule, slots: count, workstation: ws.code };
  });
  await req.audit({ tableName: 'swap_schedules', recordId: out.schedule.id, action: 'UPDATE', after: { override: true, interval: out.schedule.interval_minutes } });
  return res.json({ success: true, data: out });
});

/** POST /api/v1/swap-pools/slots/:id/confirm — operator confirms taking over their slot. */
router.post('/slots/:id/confirm', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const out = await withTransaction(async (client) => {
    const q = client.query.bind(client);
    const { rows } = await q(`SELECT * FROM swap_slots WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const slot = rows[0];
    if (!slot) throw Object.assign(new Error('Slot not found.'), { status: 404, code: 'NOT_FOUND' });
    if (req.user.role === 'operator' && slot.employee_id !== req.user.sub) {
      throw Object.assign(new Error('This is not your swap slot.'), { status: 403, code: 'NOT_YOUR_SLOT' });
    }
    const { rows: upd } = await q(
      `UPDATE swap_slots SET confirmed_at = now(), confirmed_by = $1 WHERE id = $2 RETURNING *`,
      [req.user.sub, slot.id]
    );
    return upd[0];
  });
  await req.audit({ tableName: 'swap_slots', recordId: req.params.id, action: 'UPDATE', after: { confirmed: true } });
  return res.json({ success: true, data: out });
});

module.exports = router;
