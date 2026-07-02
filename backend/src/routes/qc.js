const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');
const { createAlert } = require('../utils/alerts');
const { classifyHrc, OUTCOME_LABEL } = require('../utils/hrcEngine');

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

/** POST /api/v1/qc/hrc-samples/:id/result — record the HRC reading and apply the
 *  cycle change. body: { hrcValue, result?, notes? }.
 *
 *  When the UID's cycle type has HRC parameters, the numeric reading is SCORED
 *  against the target band and drives the outcome automatically:
 *    in_range     → continue
 *    slightly_low → re-temper at the configured step (retreat +1)
 *    very_low     → hold for external annealing (retreat +1)
 *    high         → re-temper from Tempering 1 (retreat +1)
 *  A re-treatment ceiling holds the piece instead of routing once reached.
 *  With no params/numeric value it falls back to the old result-based hold. */
router.post('/hrc-samples/:id/result', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const { hrcValue, result, notes } = req.body || {};
  const numeric = hrcValue == null || hrcValue === '' ? null : Number(hrcValue);

  const out = await withTransaction(async (client) => {
    const { rows: sRows } = await client.query(`SELECT * FROM hrc_inspection_samples WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const sample = sRows[0];
    if (!sample) throw Object.assign(new Error('HRC sample not found'), { status: 404, code: 'SAMPLE_NOT_FOUND' });

    const { rows: uRows } = await client.query(
      `SELECT u.id, u.uid_code, u.retreatment_count, u.cycle_version_id, cv.cycle_type_id, ct.code AS cycle_code
       FROM uids u JOIN cycle_versions cv ON cv.id = u.cycle_version_id JOIN cycle_types ct ON ct.id = cv.cycle_type_id
       WHERE u.id = $1 FOR UPDATE`, [sample.uid_id]);
    const uid = uRows[0];
    const params = uid ? (await client.query(`SELECT * FROM hrc_parameters WHERE cycle_type_id = $1`, [uid.cycle_type_id])).rows[0] || null : null;

    const cls = classifyHrc(numeric, params);
    const sampleStatus = cls.outcome === 'unknown'
      ? (String(result || '').toLowerCase() === 'fail' ? 'fail' : 'pass')
      : (cls.isPass ? 'pass' : 'fail');
    const outcomeNote = cls.outcome !== 'unknown' ? `HRC ${OUTCOME_LABEL[cls.outcome]}` : null;
    const combinedNotes = [notes, outcomeNote].filter(Boolean).join(' · ') || null;

    const { rows: updated } = await client.query(
      `UPDATE hrc_inspection_samples SET status = $1, hrc_value = $2, notes = $3, inspected_by = $4, inspected_at = now()
       WHERE id = $5 RETURNING *`,
      [sampleStatus, numeric, combinedNotes, req.user.sub, sample.id]
    );

    const escalate = async (type, severity, message) => {
      for (const role of ['supervisor', 'manager']) {
        // eslint-disable-next-line no-await-in-loop
        await createAlert(client.query.bind(client), { type, severity, uidId: uid.id, message, targetRole: role, linkPage: 'qc', linkRecordId: String(uid.id) });
      }
    };
    const targetStorage = async (stepNumber) => (await client.query(
      `SELECT source_storage_id FROM cycle_steps WHERE cycle_version_id = $1 AND step_number = $2`, [uid.cycle_version_id, stepNumber]
    )).rows[0]?.source_storage_id ?? null;
    const firstTemperStep = async () => (await client.query(
      `SELECT step_number FROM cycle_steps WHERE cycle_version_id = $1 AND step_type = 'temper' ORDER BY sequence_order LIMIT 1`, [uid.cycle_version_id]
    )).rows[0]?.step_number ?? null;

    let action = { outcome: cls.outcome, action: 'continue' };

    if (sampleStatus === 'fail' && uid) {
      const hrcTxt = numeric != null ? `${numeric} HRC` : 'HRC';
      if (cls.outcome === 'unknown') {
        await client.query(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`, [`HRC sample failed (${hrcTxt})`, uid.id]);
        await createAlert(client.query.bind(client), { type: 'qc_fail', severity: 'critical', uidId: uid.id, message: `HRC FAIL (${hrcTxt}) — sample held for review`, targetRole: 'supervisor', linkPage: 'qc', linkRecordId: String(uid.id) });
        action = { outcome: 'unknown', action: 'hold' };
      } else if ((uid.retreatment_count || 0) >= (params.max_retreatments || 3)) {
        await client.query(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`, [`Maximum re-treatments reached (${uid.retreatment_count}/${params.max_retreatments})`, uid.id]);
        await escalate('max_retreat', 'critical', `${uid.uid_code}: max re-treatments reached (${uid.retreatment_count}/${params.max_retreatments}) — needs Manager/Admin decision`);
        action = { outcome: cls.outcome, action: 'max_reached', retreatmentCount: uid.retreatment_count, maxRetreatments: params.max_retreatments };
      } else if (cls.outcome === 'very_low') {
        await client.query(`UPDATE uids SET status = 'hold', hold_reason = $1, retreatment_count = retreatment_count + 1 WHERE id = $2`, ['HRC critically low — sent for third-party Annealing', uid.id]);
        await escalate('annealing', 'critical', `${uid.uid_code}: HRC very low (${hrcTxt}) — requires external annealing`);
        action = { outcome: 'very_low', action: 'annealing_hold', retreatmentCount: (uid.retreatment_count || 0) + 1 };
      } else {
        // slightly_low → configured re-temper step; high → re-temper from Tempering 1
        let targetStep = cls.outcome === 'slightly_low' ? params.slightly_low_retemper_step : null;
        if (!targetStep) targetStep = await firstTemperStep();
        const storage = targetStep ? await targetStorage(targetStep) : null;
        await client.query(`UPDATE uids SET current_step = $1, current_storage_id = $2, status = 'active', retreatment_count = retreatment_count + 1 WHERE id = $3`, [targetStep, storage, uid.id]);
        await createAlert(client.query.bind(client), { type: 'hrc_retreat', severity: 'warning', uidId: uid.id, message: `${uid.uid_code}: HRC ${cls.outcome === 'high' ? 'high' : 'slightly low'} (${hrcTxt}) — re-temper → step ${targetStep}`, targetRole: 'supervisor', linkPage: 'qc', linkRecordId: String(uid.id) });
        action = { outcome: cls.outcome, action: 're_temper', targetStep, retreatmentCount: (uid.retreatment_count || 0) + 1 };
      }
    }
    return { sample: updated[0], ...action };
  });

  await req.audit({ tableName: 'hrc_inspection_samples', recordId: out.sample.id, action: 'UPDATE', after: out });
  return res.json({ success: true, data: out });
});

module.exports = router;
