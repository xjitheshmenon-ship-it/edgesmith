const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, auditContext);

/**
 * GET /api/v1/workstation-assignments?shift_id=X
 * Returns the operator board: which employees are assigned to which
 * workstations this shift, plus each workstation's current queue depth.
 */
router.get('/', async (req, res) => {
  const { shift_id } = req.query;
  if (!shift_id) return res.status(400).json({ success: false, error: { code: 'MISSING_SHIFT', message: 'shift_id is required.' } });

  const { rows } = await query(
    `SELECT wa.id, wa.employee_id, e.full_name, e.employee_code, wa.workstation_type_id, wt.code AS workstation_code, wt.category,
            (SELECT COUNT(*) FROM jobs j WHERE j.workstation_unit_id IN (SELECT id FROM workstation_units WHERE workstation_type_id = wt.id) AND j.shift_id = wa.shift_id AND j.status IN ('queued','in_progress','paused')) AS queue_depth
     FROM workstation_assignments wa
     JOIN employees e ON e.id = wa.employee_id
     JOIN workstation_types wt ON wt.id = wa.workstation_type_id
     WHERE wa.shift_id = $1 AND wa.unassigned_at IS NULL
     ORDER BY e.full_name, wt.code`,
    [shift_id]
  );
  return res.json({ success: true, data: rows });
});

/**
 * POST /api/v1/workstation-assignments
 * Supervisor drags a workstation onto an operator card.
 * body: { shiftId, employeeId, workstationTypeId, overrideBadgeWarning? }
 *
 * Enforces: furnace workstations (category = heat_treatment) can only be
 * assigned to Supervisor/Manager/Admin roles — never Operator, no override.
 */
router.post('/', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const b = req.body || {};
  // Tolerate camelCase or snake_case, and accept a workstation code or id.
  const shiftId = b.shiftId ?? b.shift_id;
  const employeeId = b.employeeId ?? b.employee_id ?? b.operatorId ?? b.operator_id;
  let workstationTypeId = b.workstationTypeId ?? b.workstation_type_id;
  const workstationCode = b.workstationCode ?? b.workstation_code;
  const overrideBadgeWarning = b.overrideBadgeWarning ?? b.override ?? b.override_badge_warning;
  const overrideReason = b.overrideReason ?? b.override_reason;

  if (!workstationTypeId && workstationCode) {
    const { rows: codeRows } = await query(`SELECT id FROM workstation_types WHERE code = $1`, [workstationCode]);
    if (codeRows[0]) workstationTypeId = codeRows[0].id;
  }

  if (!shiftId || !employeeId || !workstationTypeId) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'shiftId, employeeId, and a workstation (code or id) are required.' } });
  }

  const result = await withTransaction(async (client) => {
    const { rows: empRows } = await client.query(`SELECT role FROM employees WHERE id = $1`, [employeeId]);
    if (!empRows[0]) throw Object.assign(new Error('Employee not found'), { status: 404, code: 'EMPLOYEE_NOT_FOUND' });

    const { rows: wsRows } = await client.query(`SELECT category, code FROM workstation_types WHERE id = $1`, [workstationTypeId]);
    if (!wsRows[0]) throw Object.assign(new Error('Workstation not found'), { status: 404, code: 'WORKSTATION_NOT_FOUND' });

    const isFurnace = wsRows[0].category === 'heat_treatment';
    if (isFurnace && !['supervisor', 'manager', 'admin'].includes(empRows[0].role)) {
      throw Object.assign(new Error('Furnace workstations require Supervisor role'), { status: 409, code: 'FURNACE_REQUIRES_SUPERVISOR' });
    }

    // Badge check (warning, not a hard block — Supervisor can override with reason)
    const { rows: badgeRows } = await client.query(
      `SELECT eb.expiry_date FROM employee_badges eb JOIN badge_types bt ON bt.id = eb.badge_type_id
       WHERE eb.employee_id = $1 AND bt.workstation_type_id = $2`,
      [employeeId, workstationTypeId]
    );
    const hasBadgeRequirement = (await client.query(`SELECT 1 FROM badge_types WHERE workstation_type_id = $1`, [workstationTypeId])).rows.length > 0;
    const hasValidBadge = badgeRows.some((b) => !b.expiry_date || new Date(b.expiry_date) >= new Date());

    if (hasBadgeRequirement && !hasValidBadge && !overrideBadgeWarning) {
      throw Object.assign(new Error('Operator lacks required badge for this workstation'), {
        status: 409, code: 'BADGE_MISSING', meta: { workstationCode: wsRows[0].code },
      });
    }

    const { rows } = await client.query(
      `INSERT INTO workstation_assignments (shift_id, employee_id, workstation_type_id, assigned_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (shift_id, employee_id, workstation_type_id) DO UPDATE SET unassigned_at = NULL
       RETURNING *`,
      [shiftId, employeeId, workstationTypeId, req.user.sub]
    );

    if (overrideBadgeWarning) {
      await req.audit({
        tableName: 'workstation_assignments', recordId: rows[0].id, action: 'INSERT',
        after: { override: true, reason: overrideReason, workstationCode: wsRows[0].code },
      }, client);
    }

    return rows[0];
  });

  return res.status(201).json({ success: true, data: result });
});

/** DELETE /api/v1/workstation-assignments/:id — unassign */
router.delete('/:id', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { rows } = await query(`UPDATE workstation_assignments SET unassigned_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found.' } });
  await req.audit({ tableName: 'workstation_assignments', recordId: req.params.id, action: 'UPDATE', after: { unassigned: true } });
  return res.json({ success: true, data: rows[0] });
});

/**
 * GET /api/v1/workstation-assignments/my-workstations
 * Returns the workstations assigned to the CURRENT logged-in operator for
 * the active shift — this is what powers the My Workstation page tab strip.
 */
router.get('/my-workstations', async (req, res) => {
  const { rows } = await query(
    `SELECT wa.id, wt.id AS workstation_type_id, wt.code, wt.name, wt.category,
            (SELECT j.id FROM jobs j WHERE j.workstation_unit_id IN (SELECT id FROM workstation_units WHERE workstation_type_id = wt.id)
               AND j.operator_id = $1 AND j.status = 'in_progress' LIMIT 1) AS active_job_id,
            (SELECT j.id FROM jobs j WHERE j.workstation_unit_id IN (SELECT id FROM workstation_units WHERE workstation_type_id = wt.id)
               AND j.operator_id = $1 AND j.status = 'paused' LIMIT 1) AS paused_job_id,
            (SELECT COUNT(*) FROM jobs j WHERE j.workstation_unit_id IN (SELECT id FROM workstation_units WHERE workstation_type_id = wt.id)
               AND j.operator_id = $1 AND j.status = 'queued') AS queued_count
     FROM workstation_assignments wa
     JOIN workstation_types wt ON wt.id = wa.workstation_type_id
     JOIN shifts s ON s.id = wa.shift_id
     WHERE wa.employee_id = $1 AND wa.unassigned_at IS NULL AND s.ended_at IS NULL
     ORDER BY wt.code`,
    [req.user.sub]
  );
  return res.json({ success: true, data: rows });
});

/**
 * GET /api/v1/workstation-assignments/eligible-operators?workstation_code=&location=
 * Operators who may be assigned to a workstation: if the workstation type has a
 * badge requirement, only operators holding a valid (non-expired) badge for it;
 * otherwise all on-location operators. Used to filter the assign picker so only
 * certified operators are offered.
 */
router.get('/eligible-operators', async (req, res) => {
  const { workstation_code, workstation_type_id, location } = req.query;
  let typeId = workstation_type_id;
  if (!typeId && workstation_code) {
    const { rows } = await query(`SELECT id FROM workstation_types WHERE code = $1`, [workstation_code]);
    if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'WORKSTATION_NOT_FOUND', message: 'Unknown workstation.' } });
    typeId = rows[0].id;
  }
  if (!typeId) return res.status(400).json({ success: false, error: { code: 'MISSING_WORKSTATION', message: 'workstation_code or workstation_type_id is required.' } });

  const { rows: btRows } = await query(`SELECT name FROM badge_types WHERE workstation_type_id = $1 LIMIT 1`, [typeId]);
  const requiresBadge = btRows.length > 0;

  const params = [];
  let p = 1;
  const conds = [`e.role = 'operator'`, `e.status = 'active'`];
  if (location && location !== 'both') { conds.push(`(l.code = $${p++} OR e.location_id IS NULL)`); params.push(location); }
  if (requiresBadge) {
    conds.push(`EXISTS (SELECT 1 FROM employee_badges eb JOIN badge_types bt ON bt.id = eb.badge_type_id
                        WHERE eb.employee_id = e.id AND bt.workstation_type_id = $${p++}
                          AND (eb.expiry_date IS NULL OR eb.expiry_date >= CURRENT_DATE))`);
    params.push(typeId);
  }
  const { rows: ops } = await query(
    `SELECT e.id, e.employee_code, e.full_name FROM employees e
     LEFT JOIN locations l ON l.id = e.location_id
     WHERE ${conds.join(' AND ')} ORDER BY e.full_name`,
    params
  );
  return res.json({ success: true, data: { requiresBadge, badgeName: btRows[0]?.name || null, operators: ops } });
});

module.exports = router;
