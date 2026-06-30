const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { resolveLocation } = require('../middleware/rbac');

const router = express.Router();
router.use(authenticate);

const LOCATION_CODE_TO_ID = { dharmapuri: 1, faridabad: 2 };

/** GET /api/v1/reports/production?from=&to=&location= */
router.get('/production', requireRole(['admin', 'manager']), async (req, res) => {
  const { from, to } = req.query;
  const params = [from || '2000-01-01', to || '2100-01-01'];

  const created = await query(
    `SELECT COUNT(*) AS c FROM uids WHERE created_at::date BETWEEN $1 AND $2`, params
  );
  const dispatched = await query(
    `SELECT COUNT(*) AS c FROM uids WHERE status = 'done' AND updated_at::date BETWEEN $1 AND $2`, params
  );
  const inProduction = await query(`SELECT COUNT(*) AS c FROM uids WHERE status = 'active'`);
  const perStep = await query(
    `SELECT step_number, COUNT(*) AS completed, AVG(net_work_seconds) AS avg_seconds
     FROM uid_step_logs WHERE closed_at::date BETWEEN $1 AND $2
     GROUP BY step_number ORDER BY step_number`, params
  );

  return res.json({
    success: true,
    data: {
      uidsCreated: Number(created.rows[0].c),
      uidsDispatched: Number(dispatched.rows[0].c),
      inProduction: Number(inProduction.rows[0].c),
      perStep: perStep.rows,
    },
  });
});

/** GET /api/v1/reports/wip */
router.get('/wip', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const byStorage = await query(
    `SELECT sl.code, COUNT(u.id) AS count FROM storage_locations sl
     LEFT JOIN uids u ON u.current_storage_id = sl.id AND u.status IN ('active','hold')
     GROUP BY sl.code, sl.id ORDER BY sl.id`
  );
  const byCycle = await query(
    `SELECT ct.code, COUNT(u.id) AS count FROM cycle_types ct
     LEFT JOIN cycle_versions cv ON cv.cycle_type_id = ct.id
     LEFT JOIN uids u ON u.cycle_version_id = cv.id AND u.status = 'active'
     GROUP BY ct.code`
  );
  const onHold = await query(`SELECT uid_code, hold_reason FROM uids WHERE status = 'hold'`);
  const avgCycleTime = await query(
    `SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) AS avg_seconds FROM uids WHERE status = 'done'`
  );

  return res.json({
    success: true,
    data: { byStorage: byStorage.rows, byCycle: byCycle.rows, onHold: onHold.rows, avgCycleTimeSeconds: avgCycleTime.rows[0].avg_seconds },
  });
});

/** GET /api/v1/reports/furnace?from=&to=&step= */
router.get('/furnace', requireRole(['admin', 'manager']), async (req, res) => {
  const { from, to, step } = req.query;
  const conditions = ['fb.created_at::date BETWEEN $1 AND $2'];
  const params = [from || '2000-01-01', to || '2100-01-01'];
  let p = 3;
  if (step) { conditions.push(`cs.step_number = $${p++}`); params.push(step); }

  const { rows } = await query(
    `SELECT fb.batch_number, cs.step_number, ct.code AS cycle_code,
            (SELECT COUNT(*) FROM furnace_batch_uids fbu WHERE fbu.furnace_batch_id = fb.id) AS uid_count,
            fb.target_temp_c, fb.actual_temp_c, fb.target_soak_min, fb.actual_soak_min, fb.deviation_flag,
            fb.created_at, e.full_name AS operator_name
     FROM furnace_batches fb
     JOIN cycle_steps cs ON cs.id = fb.cycle_step_id
     JOIN cycle_types ct ON ct.id = fb.cycle_type_id
     LEFT JOIN employees e ON e.id = fb.operator_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY fb.created_at DESC`,
    params
  );

  const total = rows.length;
  const deviations = rows.filter((r) => r.deviation_flag).length;

  return res.json({
    success: true,
    data: { batches: rows, totalBatches: total, deviationCount: deviations, withinTolerancePct: total ? Math.round(((total - deviations) / total) * 100) : 100 },
  });
});

/** GET /api/v1/reports/scrap */
router.get('/scrap', requireRole(['admin', 'manager']), async (req, res) => {
  const { rows } = await query(
    `SELECT se.*, u.uid_code AS parent_uid_code FROM split_events se JOIN uids u ON u.id = se.parent_uid_id ORDER BY se.created_at DESC`
  );
  const totalInput = rows.reduce((a, r) => a + r.input_length_mm, 0);
  const totalScrap = rows.reduce((a, r) => a + r.scrap_mm, 0);
  const yieldPct = totalInput ? Math.round(((totalInput - totalScrap) / totalInput) * 100 * 100) / 100 : 100;

  return res.json({ success: true, data: { events: rows, totalInputMm: totalInput, totalScrapMm: totalScrap, yieldPct } });
});

/** GET /api/v1/reports/mo-fulfilment */
router.get('/mo-fulfilment', requireRole(['admin', 'manager']), async (req, res) => {
  const { rows } = await query(
    `SELECT mo.mo_number, mo.customer, mo.quantity, mo.required_delivery_date, mo.status,
            COUNT(u.id) AS linked, COUNT(u.id) FILTER (WHERE u.status = 'done') AS dispatched
     FROM manufacturing_orders mo LEFT JOIN uids u ON u.mo_id = mo.id
     GROUP BY mo.id ORDER BY mo.created_at DESC`
  );
  return res.json({ success: true, data: rows });
});

/** GET /api/v1/reports/quality */
router.get('/quality', requireRole(['admin', 'manager']), async (req, res) => {
  const { rows } = await query(
    `SELECT step_number, qc_check_type, qc_result, COUNT(*) AS count
     FROM uid_step_logs WHERE qc_result IS NOT NULL
     GROUP BY step_number, qc_check_type, qc_result ORDER BY step_number`
  );
  return res.json({ success: true, data: rows });
});

/** GET /api/v1/reports/traceability?heat= or supplier= or batch= */
router.get('/traceability', requireRole(['admin', 'manager', 'service']), async (req, res) => {
  const { heat, batch } = req.query;
  let sql = `
    SELECT u.uid_code, u.status, cd.batch_reference, cd.possible_alloy_heats, cd.possible_ms_heats, mo.mo_number
    FROM uids u
    LEFT JOIN contractor_dispatches cd ON cd.id = u.dispatch_batch_id
    LEFT JOIN manufacturing_orders mo ON mo.id = u.mo_id
    WHERE 1=1`;
  const params = [];
  let p = 1;
  if (heat) { sql += ` AND ($${p} = ANY(cd.possible_alloy_heats) OR $${p} = ANY(cd.possible_ms_heats))`; params.push(heat); p++; }
  if (batch) { sql += ` AND cd.batch_reference = $${p++}`; params.push(batch); }

  const { rows } = await query(sql, params);
  return res.json({ success: true, data: rows });
});

/** GET /api/v1/reports/shift?location=&from=&to= */
router.get('/shift', requireRole(['admin', 'manager']), async (req, res) => {
  const { from, to, location } = req.query;
  const conditions = ['s.shift_date BETWEEN $1 AND $2'];
  const params = [from || '2000-01-01', to || '2100-01-01'];
  let p = 3;
  if (location && location !== 'both') { conditions.push(`l.code = $${p++}`); params.push(location); }

  const { rows } = await query(
    `SELECT s.id, s.shift_date, s.shift_number, l.code AS location_code, e.full_name AS supervisor_name,
            (SELECT COUNT(*) FROM jobs j WHERE j.shift_id = s.id AND j.status = 'closed') AS jobs_completed,
            (SELECT COUNT(DISTINCT employee_id) FROM workstation_assignments wa WHERE wa.shift_id = s.id) AS operator_count
     FROM shifts s
     JOIN locations l ON l.id = s.location_id
     LEFT JOIN employees e ON e.id = s.supervisor_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.shift_date DESC, s.shift_number DESC`,
    params
  );
  return res.json({ success: true, data: rows });
});

/** GET /api/v1/reports/capacity */
router.get('/capacity', requireRole(['admin', 'manager']), async (req, res) => {
  const { rows } = await query(
    `SELECT wt.code, wt.name,
            COUNT(wu.id) AS unit_count,
            COUNT(wu.id) FILTER (WHERE wu.status = 'active') AS active_units,
            COUNT(wu.id) FILTER (WHERE wu.status = 'maintenance') AS maintenance_units
     FROM workstation_types wt LEFT JOIN workstation_units wu ON wu.workstation_type_id = wt.id
     GROUP BY wt.id ORDER BY wt.code`
  );
  return res.json({ success: true, data: rows });
});

module.exports = router;
