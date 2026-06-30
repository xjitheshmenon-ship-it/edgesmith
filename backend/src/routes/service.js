const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();
router.use(authenticate);

/**
 * GET /api/v1/service/uid/:code
 * Read-only lifetime record. Available to Admin, Manager, Supervisor, Service.
 * Honest traceability — heat numbers always shown as a "possible" list,
 * never presented as a single definitive value (see Faridabad model
 * corrections: rolling erases individual block identity).
 */
router.get('/uid/:code', requireRole(['admin', 'manager', 'supervisor', 'service']), async (req, res) => {
  const { code } = req.params;

  const { rows } = await query(
    `SELECT u.uid_code, u.status, u.current_step, u.created_at, u.updated_at,
            ct.code AS cycle_code, sz.size_mm, d.code AS design_code,
            mo.mo_number, mo.customer,
            cd.batch_reference AS dispatch_batch_reference, cd.possible_alloy_heats, cd.possible_ms_heats,
            cd.date_dispatched, cont.name AS contractor_name, cc.name AS color_name,
            re.date_received AS received_at_dharmapuri,
            p.uid_code AS parent_uid_code
     FROM uids u
     JOIN cycle_versions cv ON cv.id = u.cycle_version_id
     JOIN cycle_types ct ON ct.id = cv.cycle_type_id
     LEFT JOIN sizes sz ON sz.id = u.size_id
     LEFT JOIN designs d ON d.id = u.design_id
     LEFT JOIN manufacturing_orders mo ON mo.id = u.mo_id
     LEFT JOIN contractor_dispatches cd ON cd.id = u.dispatch_batch_id
     LEFT JOIN contractors cont ON cont.id = cd.contractor_id
     LEFT JOIN color_codes cc ON cc.id = cd.color_code_id
     LEFT JOIN receiving_events re ON re.id = u.receiving_event_id
     LEFT JOIN uids p ON p.id = u.parent_uid_id
     WHERE u.uid_code = $1`,
    [code]
  );

  if (!rows[0]) {
    return res.status(404).json({ success: false, error: { code: 'UID_NOT_FOUND', message: `No record found for UID ${code}.` } });
  }
  const uid = rows[0];

  const stepHistory = await query(
    `SELECT sl.step_number, sl.operation_name, wu.unit_code, e.full_name AS operator_name,
            sl.closed_at, sl.qc_result, sl.qc_value,
            fb.batch_number AS furnace_batch_number, fb.target_temp_c, fb.target_soak_min,
            fb.actual_temp_c, fb.actual_soak_min, fb.deviation_flag
     FROM uid_step_logs sl
     LEFT JOIN workstation_units wu ON wu.id = sl.workstation_unit_id
     LEFT JOIN employees e ON e.id = sl.operator_id
     LEFT JOIN furnace_batches fb ON fb.id = sl.furnace_batch_id
     WHERE sl.uid_id = (SELECT id FROM uids WHERE uid_code = $1)
     ORDER BY sl.closed_at ASC NULLS LAST`,
    [code]
  );

  const siblings = await query(
    `SELECT uid_code, status FROM uids
     WHERE parent_uid_id = (SELECT parent_uid_id FROM uids WHERE uid_code = $1) AND uid_code != $1`,
    [code]
  );

  const children = await query(`SELECT uid_code, status FROM uids WHERE parent_uid_id = (SELECT id FROM uids WHERE uid_code = $1)`, [code]);

  return res.json({
    success: true,
    data: {
      ...uid,
      possible_alloy_heats_note: 'Individual traceability is not available past the rolling stage. This batch may contain material from any of the heat numbers listed.',
      step_history: stepHistory.rows,
      siblings: siblings.rows,
      children: children.rows,
    },
  });
});

module.exports = router;
