const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, auditContext);

const TEMPERING_STEPS = ['tempering_1', 'tempering_2', 'tempering_3', 'tempering_4'];

/** GET /api/v1/admin/tempering-params */
router.get('/tempering-params', async (req, res) => {
  const { rows } = await query(
    `SELECT tp.*, ct.code AS cycle_code, e.full_name AS changed_by_name
     FROM tempering_parameters tp
     JOIN cycle_types ct ON ct.id = tp.cycle_type_id
     LEFT JOIN employees e ON e.id = tp.changed_by
     ORDER BY ct.code,
       CASE tp.tempering_step WHEN 'tempering_1' THEN 1 WHEN 'tempering_2' THEN 2 WHEN 'tempering_3' THEN 3 ELSE 4 END`
  );
  return res.json({ success: true, data: rows });
});

/**
 * PATCH /api/v1/admin/tempering-params/:cycleCode/:temperingStep (Admin only)
 * body: { targetTempC, targetSoakMin, toleranceTempC, toleranceSoakMin }
 * Historical furnace_batches already retain their target/actual at time of
 * run (denormalised onto the furnace_batches row itself), so changing this
 * config never rewrites history — only affects batches created after the change.
 */
router.patch('/tempering-params/:cycleCode/:temperingStep', requireRole(['admin']), async (req, res) => {
  const { cycleCode, temperingStep } = req.params;
  const { targetTempC, targetSoakMin, toleranceTempC, toleranceSoakMin } = req.body;

  if (!TEMPERING_STEPS.includes(temperingStep)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_STEP', message: `temperingStep must be one of ${TEMPERING_STEPS.join(', ')}` } });
  }

  const { rows: cycleRows } = await query(`SELECT id FROM cycle_types WHERE code = $1`, [cycleCode]);
  if (!cycleRows[0]) return res.status(404).json({ success: false, error: { code: 'UNKNOWN_CYCLE', message: 'Unknown cycle type.' } });

  const { rows } = await query(
    `INSERT INTO tempering_parameters (cycle_type_id, tempering_step, target_temp_c, target_soak_min, tolerance_temp_c, tolerance_soak_min, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (cycle_type_id, tempering_step)
     DO UPDATE SET target_temp_c = EXCLUDED.target_temp_c, target_soak_min = EXCLUDED.target_soak_min,
       tolerance_temp_c = EXCLUDED.tolerance_temp_c, tolerance_soak_min = EXCLUDED.tolerance_soak_min, changed_by = EXCLUDED.changed_by
     RETURNING *`,
    [cycleRows[0].id, temperingStep, targetTempC, targetSoakMin, toleranceTempC || 5, toleranceSoakMin || 5, req.user.sub]
  );

  await req.audit({ tableName: 'tempering_parameters', recordId: rows[0].id, action: 'UPDATE', after: rows[0] });
  return res.json({ success: true, data: rows[0] });
});

/** GET /api/v1/admin/users (Admin only) */
router.get('/users', requireRole(['admin']), async (req, res) => {
  const { rows } = await query(
    `SELECT e.id, e.employee_code, e.full_name, e.username, e.role, e.status, l.code AS location_code
     FROM employees e LEFT JOIN locations l ON l.id = e.location_id ORDER BY e.full_name`
  );
  return res.json({ success: true, data: rows });
});

/** GET /api/v1/admin/audit-log (Admin only) */
router.get('/audit-log', requireRole(['admin']), async (req, res) => {
  const { table, employeeId, from, to } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;
  if (table) { conditions.push(`table_name = $${p++}`); params.push(table); }
  if (employeeId) { conditions.push(`employee_id = $${p++}`); params.push(employeeId); }
  if (from) { conditions.push(`created_at >= $${p++}`); params.push(from); }
  if (to) { conditions.push(`created_at <= $${p++}`); params.push(to); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT al.*, e.full_name AS employee_name FROM audit_log al
     LEFT JOIN employees e ON e.id = al.employee_id
     ${where} ORDER BY al.created_at DESC LIMIT 500`,
    params
  );
  return res.json({ success: true, data: rows });
});

/** GET /api/v1/admin/shift-config */
router.get('/shift-config', async (req, res) => {
  const { rows } = await query(`SELECT * FROM shifts_config ORDER BY shift_number`);
  return res.json({ success: true, data: rows });
});

/** PATCH /api/v1/admin/shift-config (Admin only) */
router.patch('/shift-config', requireRole(['admin']), async (req, res) => {
  const { shiftNumber, startTime, endTime } = req.body;
  const { rows } = await query(`UPDATE shifts_config SET start_time = $1, end_time = $2 WHERE shift_number = $3 RETURNING *`, [startTime, endTime, shiftNumber]);
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'SHIFT_NOT_FOUND', message: 'Shift number not found.' } });
  await req.audit({ tableName: 'shifts_config', recordId: shiftNumber, action: 'UPDATE', after: rows[0] });
  return res.json({ success: true, data: rows[0] });
});

module.exports = router;
module.exports.TEMPERING_STEPS = TEMPERING_STEPS;
