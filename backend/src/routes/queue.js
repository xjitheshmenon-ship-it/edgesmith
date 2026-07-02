const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, auditContext);

// Queue management is a Supervisor/Manager/Admin tool (operators never modify queues).
const QUEUE_ROLES = ['admin', 'manager', 'supervisor'];
const PRIORITIES = ['High', 'Normal', 'Low'];

// The step numbers a workstation type handles in the current cycle versions.
async function stepsForWorkstation(code) {
  const { rows } = await query(
    `SELECT DISTINCT cs.step_number
     FROM cycle_steps cs
     JOIN workstation_types wt ON wt.id = cs.workstation_type_id
     JOIN cycle_versions cv ON cv.id = cs.cycle_version_id AND cv.is_current
     WHERE wt.code = $1`,
    [code]
  );
  return rows.map((r) => r.step_number);
}

/**
 * GET /api/v1/queue?workstationCode=SG-DLT
 * The UIDs waiting at a workstation, ordered High priority first then FIFO by
 * arrival, with wait time, source step and furnace-batch grouping.
 */
router.get('/', requireRole(QUEUE_ROLES), async (req, res) => {
  const code = req.query.workstationCode || req.query.workstation_code;
  if (!code) return res.status(400).json({ success: false, error: { code: 'MISSING_WORKSTATION', message: 'workstationCode is required.' } });

  const steps = await stepsForWorkstation(code);
  if (!steps.length) return res.json({ success: true, data: { workstationCode: code, items: [] } });

  const { rows } = await query(
    `SELECT u.id, u.uid_code, u.priority, u.status, u.hold_reason, u.created_at, u.current_step,
            sz.size_mm, ct.code AS cycle_code,
            last.closed_at AS arrival_at, last.step_number AS source_step, last.operation_name AS source_operation,
            fb.batch_number AS batch_ref,
            EXTRACT(EPOCH FROM (now() - COALESCE(last.closed_at, u.created_at)))::bigint AS wait_seconds,
            EXISTS (SELECT 1 FROM jobs j WHERE j.uid_id = u.id AND j.status IN ('queued','in_progress','paused')) AS has_job
     FROM uids u
     JOIN cycle_versions cv ON cv.id = u.cycle_version_id
     JOIN cycle_types ct ON ct.id = cv.cycle_type_id
     LEFT JOIN sizes sz ON sz.id = u.size_id
     LEFT JOIN LATERAL (
       SELECT sl.closed_at, sl.step_number, sl.operation_name, sl.furnace_batch_id
       FROM uid_step_logs sl WHERE sl.uid_id = u.id AND sl.closed_at IS NOT NULL
       ORDER BY sl.closed_at DESC LIMIT 1
     ) last ON true
     LEFT JOIN furnace_batches fb ON fb.id = last.furnace_batch_id
     WHERE u.current_step = ANY($1) AND u.status IN ('active','hold')
     ORDER BY CASE u.priority WHEN 'High' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END,
              COALESCE(last.closed_at, u.created_at) ASC`,
    [steps]
  );

  const items = rows.map((r, i) => ({
    position: i + 1,
    uid_id: r.id,
    uid_code: r.uid_code,
    size_mm: r.size_mm,
    cycle_code: r.cycle_code,
    priority: r.priority,
    status: r.status,
    hold_reason: r.hold_reason,
    wait_seconds: Number(r.wait_seconds) || 0,
    source_step: r.source_step,
    source_operation: r.source_operation,
    batch_ref: r.batch_ref,
    has_job: r.has_job,
  }));

  const highCount = items.filter((i) => i.priority === 'High' && i.status === 'active').length;
  const batchRefs = [...new Set(items.filter((i) => i.batch_ref).map((i) => i.batch_ref))];

  return res.json({ success: true, data: { workstationCode: code, items, highCount, batchGroups: batchRefs } });
});

/**
 * PATCH /api/v1/queue/priority
 * body: { uidCodes: [], priority } — bulk re-prioritise (logged). Used by a
 * single row's ↑↓ and by "Prioritise all" on a batch group.
 */
router.patch('/priority', requireRole(QUEUE_ROLES), async (req, res) => {
  const b = req.body || {};
  const codes = Array.isArray(b.uidCodes) ? b.uidCodes : (b.uidCode ? [b.uidCode] : []);
  const priority = b.priority;
  if (!codes.length || !PRIORITIES.includes(priority)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'uidCodes[] and a valid priority (High/Normal/Low) are required.' } });
  }
  const { rows } = await query(
    `UPDATE uids SET priority = $1 WHERE uid_code = ANY($2) RETURNING uid_code`,
    [priority, codes]
  );
  await req.audit({ tableName: 'uids', recordId: codes.join(','), action: 'UPDATE', after: { priority, uidCodes: rows.map((r) => r.uid_code) } });
  return res.json({ success: true, data: { updated: rows.map((r) => r.uid_code), priority } });
});

/**
 * POST /api/v1/queue/hold
 * body: { uidCodes: [], reason } — hold one or a whole batch from the queue.
 */
router.post('/hold', requireRole(QUEUE_ROLES), async (req, res) => {
  const b = req.body || {};
  const codes = Array.isArray(b.uidCodes) ? b.uidCodes : (b.uidCode ? [b.uidCode] : []);
  const reason = (b.reason || '').trim();
  if (!codes.length) return res.status(400).json({ success: false, error: { code: 'MISSING_UIDS', message: 'uidCodes[] is required.' } });
  if (!reason) return res.status(400).json({ success: false, error: { code: 'REASON_REQUIRED', message: 'A hold reason is required.' } });

  const { rows } = await query(
    `UPDATE uids SET status = 'hold', hold_reason = $1 WHERE uid_code = ANY($2) AND status = 'active' RETURNING uid_code`,
    [reason, codes]
  );
  await req.audit({ tableName: 'uids', recordId: codes.join(','), action: 'UPDATE', after: { held: rows.map((r) => r.uid_code), reason } });
  return res.json({ success: true, data: { held: rows.map((r) => r.uid_code), reason } });
});

/**
 * POST /api/v1/queue/assign
 * body: { uidCode, operatorId } — assign a specific UID directly to an operator's
 * My Workstation as their next job, bypassing normal queue order.
 */
router.post('/assign', requireRole(QUEUE_ROLES), async (req, res) => {
  const b = req.body || {};
  const uidCode = b.uidCode;
  const operatorId = Number(b.operatorId);
  if (!uidCode || !operatorId) return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'uidCode and operatorId are required.' } });

  const out = await withTransaction(async (client) => {
    const { rows: uidRows } = await client.query(`SELECT * FROM uids WHERE uid_code = $1`, [uidCode]);
    const uid = uidRows[0];
    if (!uid) throw Object.assign(new Error('UID not found.'), { status: 404, code: 'UID_NOT_FOUND' });
    if (uid.status === 'hold') throw Object.assign(new Error('UID is on hold — release it before assigning.'), { status: 409, code: 'UID_ON_HOLD' });

    const { rows: stepRows } = await client.query(
      `SELECT cs.id AS cycle_step_id, cs.workstation_type_id
       FROM cycle_steps cs WHERE cs.cycle_version_id = $1 AND cs.step_number = $2 LIMIT 1`,
      [uid.cycle_version_id, uid.current_step]
    );
    const step = stepRows[0];
    if (!step) throw Object.assign(new Error('No cycle step for this UID.'), { status: 409, code: 'NO_STEP' });

    const { rows: unitRows } = await client.query(
      `SELECT id FROM workstation_units WHERE workstation_type_id = $1 ORDER BY id LIMIT 1`, [step.workstation_type_id]
    );
    const unitId = unitRows[0] ? unitRows[0].id : null;

    const { rows: shiftRows } = await client.query(`SELECT id FROM shifts WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1`);
    const shiftId = shiftRows[0] ? shiftRows[0].id : null;
    if (!shiftId) throw Object.assign(new Error('No open shift to assign into.'), { status: 409, code: 'NO_OPEN_SHIFT' });

    // Clear any existing unassigned queued job for this UID, then create the
    // targeted one so it lands as the operator's job.
    await client.query(`DELETE FROM jobs WHERE uid_id = $1 AND status = 'queued' AND operator_id IS NULL`, [uid.id]);
    const { rows: jobRows } = await client.query(
      `INSERT INTO jobs (shift_id, uid_id, cycle_step_id, workstation_unit_id, operator_id, status, assigned_by, assignment_type)
       VALUES ($1,$2,$3,$4,$5,'queued',$6,'manual') RETURNING *`,
      [shiftId, uid.id, step.cycle_step_id, unitId, operatorId, req.user.sub]
    );
    return jobRows[0];
  });

  await req.audit({ tableName: 'jobs', recordId: out.id, action: 'INSERT', after: { assigned: true, uidCode, operatorId } });
  return res.status(201).json({ success: true, data: out });
});

module.exports = router;
