const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole, enforceLocationScope } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');
const { currentShiftNumber } = require('../config/shifts');

const router = express.Router();
// §10.7 — a restricted role cannot request another location via ?location=.
router.use(authenticate, auditContext, enforceLocationScope);

/**
 * GET /api/v1/shifts/current?location=dharmapuri
 * Auto-creates today's shift row if it doesn't exist yet (background job
 * also does this every minute — see jobs/shiftStart.js — this is the
 * on-demand fallback so the page never shows nothing).
 */
router.get('/current', async (req, res) => {
  const locationCode = req.user.role === 'admin' || req.user.role === 'manager'
    ? (req.query.location || 'dharmapuri')
    : (req.user.location_id === 1 ? 'dharmapuri' : 'faridabad');

  const { rows: locRows } = await query(`SELECT id FROM locations WHERE code = $1`, [locationCode]);
  if (!locRows[0]) return res.status(400).json({ success: false, error: { code: 'UNKNOWN_LOCATION', message: 'Unknown location.' } });
  const locationId = locRows[0].id;

  const shiftNumber = currentShiftNumber();
  const today = new Date().toISOString().slice(0, 10);

  let { rows: shiftRows } = await query(
    `SELECT * FROM shifts WHERE shift_date = $1 AND shift_number = $2 AND location_id = $3`,
    [today, shiftNumber, locationId]
  );

  if (!shiftRows[0]) {
    const { rows: schedRows } = await query(
      `SELECT supervisor_id, operator_ids FROM shift_schedule WHERE shift_date = $1 AND shift_number = $2 AND location_id = $3`,
      [today, shiftNumber, locationId]
    );
    const supervisorId = schedRows[0] ? schedRows[0].supervisor_id : null;

    const created = await query(
      `INSERT INTO shifts (shift_date, shift_number, location_id, supervisor_id, started_at)
       VALUES ($1,$2,$3,$4, now()) RETURNING *`,
      [today, shiftNumber, locationId, supervisorId]
    );
    shiftRows = created.rows;
  }

  const { rows: opCount } = await query(
    `SELECT COUNT(DISTINCT employee_id) AS c FROM workstation_assignments WHERE shift_id = $1 AND unassigned_at IS NULL`,
    [shiftRows[0].id]
  );
  const { rows: supRows } = await query(`SELECT full_name FROM employees WHERE id = $1`, [shiftRows[0].supervisor_id]);

  return res.json({
    success: true,
    data: {
      ...shiftRows[0],
      location_code: locationCode,
      supervisor_name: supRows[0] ? supRows[0].full_name : null,
      operators_clocked_in: Number(opCount[0].c),
    },
  });
});

/** GET /api/v1/shifts?location=&from=&to= */
router.get('/', async (req, res) => {
  const { location, from, to } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;
  if (location && location !== 'both') {
    conditions.push(`l.code = $${p++}`);
    params.push(location);
  } else if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    conditions.push(`l.id = $${p++}`);
    params.push(req.user.location_id);
  }
  if (from) { conditions.push(`s.shift_date >= $${p++}`); params.push(from); }
  if (to) { conditions.push(`s.shift_date <= $${p++}`); params.push(to); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT s.*, l.code AS location_code, e.full_name AS supervisor_name,
            (SELECT COUNT(*) FROM jobs j WHERE j.shift_id = s.id AND j.status = 'closed') AS jobs_completed,
            h.submitted_at AS handover_submitted, h.acknowledged_at AS handover_acknowledged
     FROM shifts s
     JOIN locations l ON l.id = s.location_id
     LEFT JOIN employees e ON e.id = s.supervisor_id
     LEFT JOIN shift_handovers h ON h.shift_id = s.id
     ${where}
     ORDER BY s.shift_date DESC, s.shift_number DESC`,
    params
  );
  return res.json({ success: true, data: rows });
});

/**
 * GET /api/v1/shifts/schedule?location=&from=&to=
 */
router.get('/schedule', async (req, res) => {
  const { location, from, to } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;
  if (location && location !== 'both') { conditions.push(`l.code = $${p++}`); params.push(location); }
  if (from) { conditions.push(`ss.shift_date >= $${p++}`); params.push(from); }
  if (to) { conditions.push(`ss.shift_date <= $${p++}`); params.push(to); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT ss.*, l.code AS location_code, e.full_name AS supervisor_name
     FROM shift_schedule ss
     JOIN locations l ON l.id = ss.location_id
     LEFT JOIN employees e ON e.id = ss.supervisor_id
     ${where} ORDER BY ss.shift_date, ss.shift_number`,
    params
  );
  return res.json({ success: true, data: rows });
});

/** PUT /api/v1/shifts/schedule — upsert one cell. body: { shiftDate, shiftNumber, locationCode, supervisorId, operatorIds } */
router.put('/schedule', requireRole(['admin', 'manager']), async (req, res) => {
  const { shiftDate, shiftNumber, locationCode, supervisorId, operatorIds } = req.body;
  const { rows: locRows } = await query(`SELECT id FROM locations WHERE code = $1`, [locationCode]);
  if (!locRows[0]) return res.status(400).json({ success: false, error: { code: 'UNKNOWN_LOCATION', message: 'Unknown location.' } });

  const { rows } = await query(
    `INSERT INTO shift_schedule (shift_date, shift_number, location_id, supervisor_id, operator_ids, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (shift_date, shift_number, location_id)
     DO UPDATE SET supervisor_id = EXCLUDED.supervisor_id, operator_ids = EXCLUDED.operator_ids
     RETURNING *`,
    [shiftDate, shiftNumber, locRows[0].id, supervisorId || null, operatorIds || [], req.user.sub]
  );
  await req.audit({ tableName: 'shift_schedule', recordId: rows[0].id, action: 'UPDATE', after: rows[0] });
  return res.json({ success: true, data: rows[0] });
});

/** POST /api/v1/shifts/schedule/publish — body: { from, to, locationCode } */
router.post('/schedule/publish', requireRole(['admin', 'manager']), async (req, res) => {
  const { from, to, locationCode } = req.body;
  const { rows: locRows } = await query(`SELECT id FROM locations WHERE code = $1`, [locationCode]);
  const { rows } = await query(
    `UPDATE shift_schedule SET published = true WHERE shift_date BETWEEN $1 AND $2 AND location_id = $3 RETURNING id`,
    [from, to, locRows[0].id]
  );
  return res.json({ success: true, data: { publishedCount: rows.length } });
});

/**
 * POST /api/v1/shifts/:id/handover
 * Outgoing supervisor submits. Snapshots are computed server-side, not
 * trusted from the client, so the handover record is accurate even if the
 * frontend's local state is stale.
 */
router.post('/:id/handover', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { equipmentIssues, urgentNotes, incomingSupervisorId } = req.body;
  const shiftId = req.params.id;

  const result = await withTransaction(async (client) => {
    const { rows: shiftRows } = await client.query(`SELECT * FROM shifts WHERE id = $1`, [shiftId]);
    if (!shiftRows[0]) throw Object.assign(new Error('Shift not found'), { status: 404, code: 'SHIFT_NOT_FOUND' });

    const wsSnapshot = await client.query(
      `SELECT wt.code, COUNT(j.id) FILTER (WHERE j.status = 'in_progress') AS active_jobs
       FROM workstation_assignments wa
       JOIN workstation_types wt ON wt.id = wa.workstation_type_id
       LEFT JOIN jobs j ON j.workstation_unit_id IN (SELECT id FROM workstation_units WHERE workstation_type_id = wt.id) AND j.shift_id = $1
       WHERE wa.shift_id = $1 AND wa.unassigned_at IS NULL
       GROUP BY wt.code`,
      [shiftId]
    );

    const furnaceSnapshot = await client.query(
      `SELECT batch_number, status, cycle_type_id FROM furnace_batches WHERE shift_id = $1 AND status IN ('running','ready')`,
      [shiftId]
    );

    const holdsSnapshot = await client.query(
      `SELECT u.uid_code, u.hold_reason FROM uids u WHERE u.status = 'hold'`
    );

    const { rows } = await client.query(
      `INSERT INTO shift_handovers
         (shift_id, outgoing_supervisor_id, incoming_supervisor_id, workstation_status_snapshot,
          furnace_batches_in_progress, holds_summary, equipment_issues, urgent_notes, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now()) RETURNING *`,
      [shiftId, req.user.sub, incomingSupervisorId || null, JSON.stringify(wsSnapshot.rows),
        JSON.stringify(furnaceSnapshot.rows), JSON.stringify(holdsSnapshot.rows), equipmentIssues || null, urgentNotes || null]
    );

    return rows[0];
  });

  await req.audit({ tableName: 'shift_handovers', recordId: result.id, action: 'INSERT', after: result });
  return res.status(201).json({ success: true, data: result });
});

/** POST /api/v1/shifts/:id/acknowledge */
router.post('/:id/acknowledge', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { rows } = await query(
    `UPDATE shift_handovers SET incoming_supervisor_id = $1, acknowledged_at = now()
     WHERE shift_id = $2 AND acknowledged_at IS NULL RETURNING *`,
    [req.user.sub, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'NO_PENDING_HANDOVER', message: 'No pending handover for this shift.' } });

  await query(`UPDATE shifts SET ended_at = now() WHERE id = $1`, [req.params.id]);
  await req.audit({ tableName: 'shift_handovers', recordId: rows[0].id, action: 'UPDATE', after: { acknowledged: true } });
  return res.json({ success: true, data: rows[0] });
});

module.exports = router;
