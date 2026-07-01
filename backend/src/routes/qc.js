const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');
const { createAlert } = require('../utils/alerts');

const router = express.Router();
router.use(authenticate, auditContext);

// QC-relevant steps per the instructions: 7 (post-quench), 12 (surface grind check), 26 (final QC inspection)
const QC_STEPS = ['7', '12', '26'];

/** GET /api/v1/qc/pending */
router.get('/pending', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const { rows } = await query(
    `SELECT u.uid_code, u.current_step, u.priority, sl.qc_result, sl.qc_value, sl.id AS step_log_id,
            EXTRACT(EPOCH FROM (now() - sl.started_at)) AS waiting_seconds
     FROM uids u
     LEFT JOIN uid_step_logs sl ON sl.uid_id = u.id AND sl.step_number = u.current_step AND sl.closed_at IS NULL
     WHERE u.current_step = ANY($1) AND u.status = 'active'
     ORDER BY CASE u.priority WHEN 'High' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END, u.created_at`,
    [QC_STEPS]
  );
  return res.json({ success: true, data: rows });
});

/**
 * POST /api/v1/qc/sign-off
 * body: { uidCode, result: 'Pass'|'Fail', notes? }
 */
router.post('/sign-off', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { uidCode, result, notes } = req.body;
  if (!['Pass', 'Fail'].includes(result)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_RESULT', message: "result must be 'Pass' or 'Fail'." } });
  }

  const outcome = await withTransaction(async (client) => {
    const { rows: uidRows } = await client.query(`SELECT * FROM uids WHERE uid_code = $1 FOR UPDATE`, [uidCode]);
    const uid = uidRows[0];
    if (!uid) throw Object.assign(new Error('UID not found'), { status: 404, code: 'UID_NOT_FOUND' });

    await client.query(
      `UPDATE uid_step_logs SET closed_at = now(), qc_result = $1, notes = $2
       WHERE uid_id = $3 AND step_number = $4 AND closed_at IS NULL`,
      [result, notes || null, uid.id, uid.current_step]
    );

    if (result === 'Fail') {
      await client.query(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`, [`QC failed at step ${uid.current_step}`, uid.id]);
      await createAlert(client.query.bind(client), {
        type: 'qc_fail', severity: 'critical', uidId: uid.id,
        message: `QC FAIL — ${uid.uid_code} held at step ${uid.current_step}`,
        targetRole: 'supervisor', linkPage: 'qc', linkRecordId: uid.uid_code,
      });
      return { uidCode, result: 'Fail' };
    }

    const { rows: stepRows } = await client.query(`SELECT * FROM cycle_steps WHERE cycle_version_id = $1 AND step_number = $2`, [uid.cycle_version_id, uid.current_step]);
    const { rows: allSteps } = await client.query(
      `SELECT step_number, sequence_order FROM cycle_steps WHERE cycle_version_id = $1 ORDER BY sequence_order`, [uid.cycle_version_id]
    );
    const idx = allSteps.findIndex((s) => s.step_number === uid.current_step);
    const next = allSteps[idx + 1];

    if (next) {
      await client.query(`UPDATE uids SET current_step = $1, current_storage_id = $2 WHERE id = $3`, [next.step_number, stepRows[0].dest_storage_id, uid.id]);
    } else {
      await client.query(`UPDATE uids SET status = 'done' WHERE id = $1`, [uid.id]);
    }
    return { uidCode, result: 'Pass', nextStep: next ? next.step_number : null };
  });

  await req.audit({ tableName: 'uids', recordId: uidCode, action: 'UPDATE', after: outcome });
  return res.json({ success: true, data: outcome });
});

/**
 * POST /api/v1/qc/log
 * Operator logs a measurement before Supervisor sign-off.
 * body: { uidCode, checkType, value, result: 'Pass'|'Fail'|'Borderline' }
 */
router.post('/log', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const { uidCode, checkType, value, result } = req.body;
  const { rows: uidRows } = await query(`SELECT * FROM uids WHERE uid_code = $1`, [uidCode]);
  if (!uidRows[0]) return res.status(404).json({ success: false, error: { code: 'UID_NOT_FOUND', message: `UID ${uidCode} not found.` } });
  const uid = uidRows[0];

  await query(
    `UPDATE uid_step_logs SET qc_check_type = $1, qc_value = $2, qc_result = $3
     WHERE uid_id = $4 AND step_number = $5 AND closed_at IS NULL`,
    [checkType, value, result, uid.id, uid.current_step]
  );

  if (result === 'Fail') {
    await query(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`, [`QC failed: ${checkType}`, uid.id]);
    await createAlert(query, {
      type: 'qc_fail', severity: 'critical', uidId: uid.id,
      message: `QC FAIL (${checkType}) — ${uid.uid_code} held at step ${uid.current_step}`,
      targetRole: 'supervisor', linkPage: 'qc', linkRecordId: uid.uid_code,
    });
  }

  await req.audit({ tableName: 'uid_step_logs', recordId: uidCode, action: 'UPDATE', after: { checkType, value, result } });
  return res.json({ success: true, data: { uidCode, checkType, value, result } });
});

/**
 * POST /api/v1/qc/rework
 * body: { uidCode, targetStep, reason }
 */
router.post('/rework', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { uidCode, targetStep, reason } = req.body;
  if (!reason) return res.status(400).json({ success: false, error: { code: 'REASON_REQUIRED', message: 'A rework reason is required.' } });

  const { rows: stepRows } = await query(
    `SELECT cs.source_storage_id FROM cycle_steps cs
     JOIN uids u ON u.cycle_version_id = cs.cycle_version_id
     WHERE u.uid_code = $1 AND cs.step_number = $2`,
    [uidCode, targetStep]
  );

  const { rows } = await query(
    `UPDATE uids SET current_step = $1, current_storage_id = $2, status = 'active' WHERE uid_code = $3 RETURNING *`,
    [targetStep, stepRows[0] ? stepRows[0].source_storage_id : null, uidCode]
  );
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'UID_NOT_FOUND', message: `UID ${uidCode} not found.` } });

  await req.audit({ tableName: 'uids', recordId: rows[0].id, action: 'UPDATE', after: { rework: true, targetStep, reason } });
  return res.json({ success: true, data: rows[0] });
});

// ── Random HRC inspection samples ────────────────────────────────────────────

/** GET /api/v1/qc/hrc-samples — pending (or all) HRC inspection samples. */
router.get('/hrc-samples', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const status = req.query.status || 'pending';
  const params = [];
  let where = '';
  if (status !== 'all') { params.push(status); where = `WHERE s.status = $1`; }
  const { rows } = await query(
    `SELECT s.*, u.uid_code, u.current_step, e.full_name AS inspected_by_name
     FROM hrc_inspection_samples s
     JOIN uids u ON u.id = s.uid_id
     LEFT JOIN employees e ON e.id = s.inspected_by
     ${where}
     ORDER BY s.selected_at ASC`,
    params
  );
  return res.json({ success: true, data: rows });
});

/** POST /api/v1/qc/hrc-samples/:id/result — record the HRC reading.
 *  body: { hrcValue, result: 'Pass'|'Fail', notes? }. A Fail holds the UID. */
router.post('/hrc-samples/:id/result', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const { hrcValue, result, notes } = req.body || {};
  const status = String(result || '').toLowerCase() === 'fail' ? 'fail' : 'pass';

  const out = await withTransaction(async (client) => {
    const { rows: sRows } = await client.query(`SELECT * FROM hrc_inspection_samples WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const sample = sRows[0];
    if (!sample) throw Object.assign(new Error('HRC sample not found'), { status: 404, code: 'SAMPLE_NOT_FOUND' });

    const { rows } = await client.query(
      `UPDATE hrc_inspection_samples
         SET status = $1, hrc_value = $2, notes = $3, inspected_by = $4, inspected_at = now()
       WHERE id = $5 RETURNING *`,
      [status, hrcValue == null || hrcValue === '' ? null : Number(hrcValue), notes || null, req.user.sub, sample.id]
    );

    // A failed HRC sample holds the piece for the supervisor.
    if (status === 'fail') {
      await client.query(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`,
        [`HRC sample failed (${hrcValue ?? '—'} HRC)`, sample.uid_id]);
      await createAlert(client.query.bind(client), {
        type: 'qc_fail', severity: 'critical', uidId: sample.uid_id,
        message: `HRC FAIL (${hrcValue ?? '—'} HRC) — sample held for review`,
        targetRole: 'supervisor', linkPage: 'qc', linkRecordId: String(sample.uid_id),
      });
    }
    return rows[0];
  });

  await req.audit({ tableName: 'hrc_inspection_samples', recordId: out.id, action: 'UPDATE', after: out });
  return res.json({ success: true, data: out });
});

module.exports = router;
