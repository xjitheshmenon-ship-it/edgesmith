const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, auditContext);

/**
 * GET /api/v1/activity
 * A unified operation-close activity feed across both factories: who closed each
 * job/operation, on which piece, at which step, with what inputs, and when.
 * Sources: uid_step_logs (Dharmapuri) + faridabad_item_logs (Faridabad).
 * Query: ?factory=dharmapuri|faridabad ?operatorId= ?ref=<uid or #item> ?limit=
 */
router.get('/', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const factory = req.query.factory;
  const operatorId = req.query.operatorId ? Number(req.query.operatorId) : null;
  const ref = req.query.ref ? String(req.query.ref).trim() : null;
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));

  const parts = [];
  const params = [];

  if (!factory || factory === 'dharmapuri') {
    const conds = ['l.closed_at IS NOT NULL'];
    if (operatorId) { params.push(operatorId); conds.push(`l.operator_id = $${params.length}`); }
    if (ref) { params.push(`%${ref}%`); conds.push(`u.uid_code ILIKE $${params.length}`); }
    parts.push(
      `SELECT 'dharmapuri' AS factory, l.closed_at, u.uid_code AS ref, l.step_number, l.operation_name,
              e.full_name AS actor, l.net_work_seconds,
              l.qc_check_type::text AS qc_check_type, l.qc_value::text AS qc_value, l.qc_result::text AS qc_result, l.notes::text AS notes, NULL::int AS ms_cutting_run_id
       FROM uid_step_logs l
       JOIN uids u ON u.id = l.uid_id
       LEFT JOIN employees e ON e.id = l.operator_id
       WHERE ${conds.join(' AND ')}`
    );
  }

  if (!factory || factory === 'faridabad') {
    const conds = ['fl.closed_at IS NOT NULL'];
    if (operatorId) { params.push(operatorId); conds.push(`fl.operator_id = $${params.length}`); }
    if (ref) { params.push(`%${ref.replace(/^#/, '')}%`); conds.push(`fl.item_id::text ILIKE $${params.length}`); }
    parts.push(
      `SELECT 'faridabad' AS factory, fl.closed_at, ('#' || fl.item_id)::text AS ref, fl.step_number, fl.operation_name,
              e.full_name AS actor, fl.net_work_seconds,
              NULL::text AS qc_check_type, NULL::text AS qc_value, NULL::text AS qc_result, NULL::text AS notes,
              fl.ms_cutting_run_id
       FROM faridabad_item_logs fl
       LEFT JOIN employees e ON e.id = fl.operator_id
       WHERE ${conds.join(' AND ')}`
    );
  }

  if (!parts.length) return res.json({ success: true, data: [] });

  params.push(limit);
  const sql = `${parts.join(' UNION ALL ')} ORDER BY closed_at DESC LIMIT $${params.length}`;
  const { rows } = await query(sql, params);

  // Build a human-readable inputs summary per row.
  const data = rows.map((r) => {
    const inputs = [];
    if (r.qc_check_type) inputs.push(`${r.qc_check_type}${r.qc_value != null ? `: ${r.qc_value}` : ''}`);
    if (r.qc_result) inputs.push(r.qc_result);
    if (r.ms_cutting_run_id) inputs.push('MS cut recorded');
    if (r.notes) inputs.push(r.notes);
    return { ...r, inputs: inputs.join(' · ') || '—' };
  });

  return res.json({ success: true, data });
});

module.exports = router;
