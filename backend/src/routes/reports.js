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

/* ──────────────────────────────────────────────────────────────────────────
   EMPLOYEE PERFORMANCE
   Operator + supervisor performance over a date range. Built entirely on
   real, timestamped fact tables (uid_step_logs, uid_pauses, shifts,
   shift_handovers, audit_log, alerts). Metrics with no data source (escalations,
   miscount events) are deliberately absent rather than fabricated.
   Role scope: operator → self only · supervisor → operators on their shifts ·
   manager → their location · admin → all (honours ?location=).
   ────────────────────────────────────────────────────────────────────────── */

function dateRange(req) {
  const from = req.query.date_from || req.query.from || '2000-01-01';
  const to = req.query.date_to || req.query.to || '2100-01-01';
  return { from, to };
}

/* Employee ids the caller is allowed to see (null = unrestricted by id). */
async function scopedEmployeeFilter(user, locationCode) {
  // returns { sql, params } fragment applied to an `e` (employees) alias
  if (user.role === 'operator') return { extra: `AND e.id = ${Number(user.sub)}` };
  if (user.role === 'supervisor') {
    // operators who worked a shift this supervisor ran, plus the supervisor themselves
    return { extra: `AND (e.id = ${Number(user.sub)} OR e.id IN (
      SELECT DISTINCT usl.operator_id FROM uid_step_logs usl JOIN shifts s ON s.id = usl.shift_id
      WHERE s.supervisor_id = ${Number(user.sub)}))` };
  }
  if (user.role === 'manager') {
    const loc = user.location_id ? Number(user.location_id) : null;
    return { extra: loc ? `AND (e.location_id = ${loc} OR e.location_id IS NULL)` : '' };
  }
  // admin — optional location filter
  const locId = LOCATION_CODE_TO_ID[locationCode];
  return { extra: locId ? `AND (e.location_id = ${locId} OR e.location_id IS NULL)` : '' };
}

/** GET /api/v1/reports/employee-performance?date_from=&date_to=&location= */
router.get('/employeePerformance', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const { from, to } = dateRange(req);
  const scope = await scopedEmployeeFilter(req.user, req.query.location);
  const params = [from, to];

  // ── OPERATORS ──
  const operators = (await query(
    `SELECT e.id, e.full_name, e.employee_code,
            COUNT(DISTINCT usl.shift_id) AS shifts,
            COUNT(usl.id) AS jobs_closed,
            AVG(usl.net_work_seconds)::int AS avg_net_seconds,
            COUNT(usl.id) FILTER (WHERE usl.qc_result = 'Fail') AS fails,
            COUNT(DISTINCT wu.workstation_type_id) AS workstations,
            (SELECT COUNT(*) FROM uid_pauses p JOIN uid_step_logs l2 ON l2.id = p.step_log_id
               WHERE l2.operator_id = e.id AND p.paused_at::date BETWEEN $1 AND $2) AS pauses
     FROM employees e
     JOIN uid_step_logs usl ON usl.operator_id = e.id AND usl.closed_at IS NOT NULL AND usl.closed_at::date BETWEEN $1 AND $2
     LEFT JOIN workstation_units wu ON wu.id = usl.workstation_unit_id
     WHERE e.role = 'operator' ${scope.extra}
     GROUP BY e.id, e.full_name, e.employee_code
     ORDER BY jobs_closed DESC`, params
  )).rows;

  // best station (min avg net time) per operator
  const bestRows = (await query(
    `SELECT usl.operator_id, wt.code, AVG(usl.net_work_seconds) AS avg_net
     FROM uid_step_logs usl JOIN workstation_units wu ON wu.id = usl.workstation_unit_id
     JOIN workstation_types wt ON wt.id = wu.workstation_type_id
     WHERE usl.closed_at::date BETWEEN $1 AND $2 AND usl.net_work_seconds IS NOT NULL
     GROUP BY usl.operator_id, wt.code`, params
  )).rows;
  const bestByOp = {};
  for (const r of bestRows) {
    const cur = bestByOp[r.operator_id];
    if (!cur || Number(r.avg_net) < cur.avg) bestByOp[r.operator_id] = { code: r.code, avg: Number(r.avg_net) };
  }

  // trend — jobs in the equal-length window immediately before [from,to]
  const prev = (await query(
    `SELECT usl.operator_id, COUNT(*) AS jobs FROM uid_step_logs usl
     WHERE usl.closed_at IS NOT NULL
       AND usl.closed_at::date BETWEEN ($1::date - ($2::date - $1::date) - 1) AND ($1::date - 1)
     GROUP BY usl.operator_id`, params
  )).rows;
  const prevByOp = {}; for (const r of prev) prevByOp[r.operator_id] = Number(r.jobs);

  const operatorRows = operators.map((o) => {
    const jobs = Number(o.jobs_closed) || 0;
    const prevJobs = prevByOp[o.id] || 0;
    const trend = jobs > prevJobs * 1.1 ? 'up' : jobs < prevJobs * 0.9 ? 'down' : 'flat';
    return {
      id: o.id, name: o.full_name, employeeCode: o.employee_code,
      shifts: Number(o.shifts) || 0, jobsClosed: jobs,
      avgNetSeconds: Number(o.avg_net_seconds) || 0,
      holdRate: jobs ? Number(o.fails) / jobs : 0,
      pauses: Number(o.pauses) || 0,
      workstations: Number(o.workstations) || 0,
      bestStation: bestByOp[o.id]?.code || null,
      trend,
    };
  });

  // ── SUPERVISORS ── (skip for operator self-view)
  let supervisorRows = [];
  if (req.user.role !== 'operator') {
    const sups = (await query(
      `SELECT e.id, e.full_name, e.employee_code,
              COUNT(DISTINCT s.id) AS shifts,
              COUNT(DISTINCT h.id) FILTER (WHERE h.submitted_at IS NOT NULL) AS handovers_submitted,
              COUNT(DISTINCT h.id) FILTER (WHERE h.submitted_at IS NOT NULL AND (s.ended_at IS NULL OR h.submitted_at <= s.ended_at)) AS handovers_on_time
       FROM employees e
       JOIN shifts s ON s.supervisor_id = e.id AND s.shift_date BETWEEN $1 AND $2
       LEFT JOIN shift_handovers h ON h.shift_id = s.id AND h.outgoing_supervisor_id = e.id
       WHERE e.role = 'supervisor' ${scope.extra}
       GROUP BY e.id, e.full_name, e.employee_code
       ORDER BY shifts DESC`, params
    )).rows;

    // overrides + holds-resolved from the audit trail (JSONB), attributed by actor.
    const overrides = (await query(
      `SELECT employee_id, COUNT(*) AS c FROM audit_log
       WHERE created_at::date BETWEEN $1 AND $2 AND after_value ->> 'override' = 'true'
       GROUP BY employee_id`, params
    )).rows;
    const ovByEmp = {}; for (const r of overrides) ovByEmp[r.employee_id] = Number(r.c);

    const holds = (await query(
      `SELECT employee_id, COUNT(*) AS c FROM audit_log
       WHERE created_at::date BETWEEN $1 AND $2 AND table_name = 'uids' AND after_value ->> 'released' IS NOT NULL
       GROUP BY employee_id`, params
    )).rows;
    const holdByEmp = {}; for (const r of holds) holdByEmp[r.employee_id] = Number(r.c);

    const acks = (await query(
      `SELECT acknowledged_by, COUNT(*) AS c, AVG(EXTRACT(EPOCH FROM (dismissed_at - created_at)))::int AS avg_ack
       FROM alerts WHERE acknowledged_by IS NOT NULL AND dismissed_at::date BETWEEN $1 AND $2
       GROUP BY acknowledged_by`, params
    )).rows;
    const ackByEmp = {}; for (const r of acks) ackByEmp[r.acknowledged_by] = { count: Number(r.c), avg: Number(r.avg_ack) };

    supervisorRows = sups.map((s) => ({
      id: s.id, name: s.full_name, employeeCode: s.employee_code,
      shifts: Number(s.shifts) || 0,
      handoversSubmitted: Number(s.handovers_submitted) || 0,
      handoversOnTime: Number(s.handovers_on_time) || 0,
      overrides: ovByEmp[s.id] || 0,
      holdsResolved: holdByEmp[s.id] || 0,
      alertsAcknowledged: ackByEmp[s.id]?.count || 0,
      avgAckSeconds: ackByEmp[s.id]?.avg || null,
    }));
  }

  return res.json({ success: true, data: { period: { from, to }, role: req.user.role, operators: operatorRows, supervisors: supervisorRows } });
});

/** GET /api/v1/reports/employee-performance/:employeeId?date_from=&date_to= */
router.get('/employeePerformance/:employeeId', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const { from, to } = dateRange(req);
  const empId = Number(req.params.employeeId);
  const params = [from, to, empId];

  const emp = (await query(`SELECT id, full_name, employee_code, role, location_id FROM employees WHERE id = $1`, [empId])).rows[0];
  if (!emp) return res.status(404).json({ success: false, error: { code: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found.' } });

  // access control
  if (req.user.role === 'operator' && Number(req.user.sub) !== empId) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Operators can only view their own performance.' } });
  }
  if (req.user.role === 'manager' && req.user.location_id && emp.location_id && Number(emp.location_id) !== Number(req.user.location_id)) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Out of your location scope.' } });
  }

  if (emp.role === 'supervisor') {
    const shifts = (await query(
      `SELECT s.id, s.shift_date, s.shift_number, s.started_at, s.ended_at,
              h.submitted_at, h.acknowledged_at,
              (SELECT COUNT(DISTINCT employee_id) FROM workstation_assignments wa WHERE wa.shift_id = s.id) AS operator_count
       FROM shifts s LEFT JOIN shift_handovers h ON h.shift_id = s.id AND h.outgoing_supervisor_id = s.supervisor_id
       WHERE s.supervisor_id = $3 AND s.shift_date BETWEEN $1 AND $2
       ORDER BY s.shift_date DESC, s.shift_number DESC`, params
    )).rows;
    const overrides = (await query(
      `SELECT created_at, table_name, record_id, after_value FROM audit_log
       WHERE employee_id = $3 AND created_at::date BETWEEN $1 AND $2 AND after_value ->> 'override' = 'true'
       ORDER BY created_at DESC LIMIT 100`, params
    )).rows.map((r) => ({
      date: r.created_at, target: `${r.table_name}#${r.record_id}`,
      type: r.after_value?.workstationCode ? 'Badge override' : 'Threshold override',
      reason: r.after_value?.reason || null,
    }));
    const holds = (await query(
      `SELECT a.created_at, a.record_id, a.after_value, u.uid_code FROM audit_log a
       LEFT JOIN uids u ON u.id::text = a.record_id
       WHERE a.employee_id = $3 AND a.created_at::date BETWEEN $1 AND $2 AND a.table_name = 'uids' AND a.after_value ->> 'released' IS NOT NULL
       ORDER BY a.created_at DESC LIMIT 100`, params
    )).rows.map((r) => ({ date: r.created_at, uidCode: r.uid_code, reason: r.after_value?.reason || null }));
    const ack = (await query(
      `SELECT COUNT(*) AS c, AVG(EXTRACT(EPOCH FROM (dismissed_at - created_at)))::int AS avg_ack
       FROM alerts WHERE acknowledged_by = $3 AND dismissed_at::date BETWEEN $1 AND $2`, params
    )).rows[0];

    const onTime = shifts.filter((s) => s.submitted_at && (!s.ended_at || new Date(s.submitted_at) <= new Date(s.ended_at))).length;
    return res.json({ success: true, data: {
      role: 'supervisor', employee: { id: emp.id, name: emp.full_name, employeeCode: emp.employee_code },
      shifts, shiftsWorked: shifts.length, onTimeHandovers: onTime,
      overrides, holds,
      alerts: { acknowledged: Number(ack.c) || 0, avgAckSeconds: Number(ack.avg_ack) || null },
    } });
  }

  // ── OPERATOR detail ──
  const perWorkstation = (await query(
    `SELECT wt.code, wt.name,
            COUNT(usl.id) AS jobs, AVG(usl.net_work_seconds)::int AS avg_net,
            COUNT(usl.id) FILTER (WHERE usl.qc_result = 'Fail') AS fails,
            (SELECT COUNT(*) FROM uid_pauses p JOIN uid_step_logs l2 ON l2.id = p.step_log_id
               JOIN workstation_units w2 ON w2.id = l2.workstation_unit_id
               WHERE l2.operator_id = $3 AND w2.workstation_type_id = wt.id AND p.paused_at::date BETWEEN $1 AND $2) AS pauses
     FROM uid_step_logs usl JOIN workstation_units wu ON wu.id = usl.workstation_unit_id
     JOIN workstation_types wt ON wt.id = wu.workstation_type_id
     WHERE usl.operator_id = $3 AND usl.closed_at::date BETWEEN $1 AND $2
     GROUP BY wt.id, wt.code, wt.name ORDER BY jobs DESC`, params
  )).rows.map((r) => ({ code: r.code, name: r.name, jobs: Number(r.jobs), avgNetSeconds: Number(r.avg_net) || 0, holdRate: r.jobs ? Number(r.fails) / Number(r.jobs) : 0, pauses: Number(r.pauses) || 0 }));

  const perStep = (await query(
    `SELECT usl.step_number, MAX(usl.operation_name) AS operation, COUNT(*) AS jobs,
            AVG(usl.net_work_seconds)::int AS avg_net,
            COUNT(*) FILTER (WHERE usl.qc_result = 'Pass') AS qc_pass,
            COUNT(*) FILTER (WHERE usl.qc_result IS NOT NULL) AS qc_total,
            (SELECT AVG(net_work_seconds)::int FROM uid_step_logs a WHERE a.step_number = usl.step_number AND a.closed_at::date BETWEEN $1 AND $2) AS shift_avg
     FROM uid_step_logs usl
     WHERE usl.operator_id = $3 AND usl.closed_at::date BETWEEN $1 AND $2
     GROUP BY usl.step_number ORDER BY usl.step_number`, params
  )).rows.map((r) => ({ step: r.step_number, operation: r.operation, jobs: Number(r.jobs), avgNetSeconds: Number(r.avg_net) || 0, shiftAvgSeconds: Number(r.shift_avg) || 0, qcPass: Number(r.qc_pass) || 0, qcTotal: Number(r.qc_total) || 0 }));

  const pausesRows = (await query(
    `SELECT p.reason, COUNT(*) AS c, AVG(p.duration_seconds)::int AS avg_dur, MAX(p.duration_seconds) AS max_dur
     FROM uid_pauses p JOIN uid_step_logs l ON l.id = p.step_log_id
     WHERE l.operator_id = $3 AND p.paused_at::date BETWEEN $1 AND $2
     GROUP BY p.reason ORDER BY c DESC`, params
  )).rows;
  const pauseTotal = pausesRows.reduce((s, r) => s + Number(r.c), 0);
  const longest = (await query(
    `SELECT p.duration_seconds, p.reason, p.paused_at, wt.code FROM uid_pauses p
     JOIN uid_step_logs l ON l.id = p.step_log_id
     LEFT JOIN workstation_units wu ON wu.id = l.workstation_unit_id LEFT JOIN workstation_types wt ON wt.id = wu.workstation_type_id
     WHERE l.operator_id = $3 AND p.paused_at::date BETWEEN $1 AND $2 AND p.duration_seconds IS NOT NULL
     ORDER BY p.duration_seconds DESC LIMIT 1`, params
  )).rows[0] || null;

  const daily = (await query(
    `SELECT usl.closed_at::date AS day, COUNT(*) AS jobs FROM uid_step_logs usl
     WHERE usl.operator_id = $3 AND usl.closed_at::date BETWEEN $1 AND $2
     GROUP BY day ORDER BY day`, params
  )).rows.map((r) => ({ date: r.day, jobs: Number(r.jobs) }));

  const incidents = (await query(
    `SELECT usl.closed_at AS date, u.uid_code, usl.step_number, usl.qc_check_type, usl.qc_value
     FROM uid_step_logs usl JOIN uids u ON u.id = usl.uid_id
     WHERE usl.operator_id = $3 AND usl.qc_result = 'Fail' AND usl.closed_at::date BETWEEN $1 AND $2
     ORDER BY usl.closed_at DESC LIMIT 50`, params
  )).rows.map((r) => ({ date: r.date, uidCode: r.uid_code, step: r.step_number, reason: r.qc_check_type ? `${r.qc_check_type}${r.qc_value ? ` (${r.qc_value})` : ''}` : 'QC fail' }));

  return res.json({ success: true, data: {
    role: 'operator', employee: { id: emp.id, name: emp.full_name, employeeCode: emp.employee_code },
    perWorkstation, perStep,
    pauses: { total: pauseTotal, byReason: pausesRows.map((r) => ({ reason: r.reason, count: Number(r.c), avgSeconds: Number(r.avg_dur) || 0 })), longest: longest ? { seconds: Number(longest.duration_seconds), reason: longest.reason, date: longest.paused_at, station: longest.code } : null },
    daily, incidents,
  } });
});

module.exports = router;
