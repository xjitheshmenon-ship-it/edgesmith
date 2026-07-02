const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');
const { createAlert } = require('../utils/alerts');
const { classifyHrc, OUTCOME_LABEL } = require('../utils/hrcEngine');
const { sampleCount, classifyScenario, decideAction } = require('../utils/batchSampling');

const router = express.Router();
router.use(authenticate, auditContext);

// QC-relevant steps per the instructions: 7 (post-quench), 12 (surface grind check), 26 (final QC inspection)
const QC_STEPS = ['7', '12', '26'];

// Which finished-good dimension a check reads, so a below-minimum measurement can
// raise the right concession (and pick the matching box colour).
function concessionDimension(checkType) {
  const t = String(checkType || '').toLowerCase();
  if (t.includes('width')) return 'width';
  if (t.includes('thick')) return 'thickness';
  return null;
}

// Look up the finished-good tolerance floor for a dimension from dimension_standards
// (category fg_knife). Returns the min mm, or null if no standard is configured.
async function fgMinFor(q, dimension) {
  const col = dimension === 'width' ? 'width_tol_min' : 'thickness_tol_min';
  const { rows } = await q(
    `SELECT ${col} AS min_val FROM dimension_standards
     WHERE category = 'fg_knife' AND status = 'active' AND ${col} IS NOT NULL
     ORDER BY id LIMIT 1`
  );
  return rows[0] && rows[0].min_val != null ? Number(rows[0].min_val) : null;
}

// Pick the concession colour-code that matches a dimension (Blue=width, Red=thickness).
async function concessionColorFor(q, dimension) {
  const like = dimension === 'width' ? '%width%' : '%thick%';
  const { rows } = await q(
    `SELECT id FROM concession_color_codes WHERE lower(exception_type) LIKE $1 AND status = 'active' ORDER BY id LIMIT 1`,
    [like]
  );
  return rows[0] ? rows[0].id : null;
}

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

  const out = await withTransaction(async (client) => {
    const q = client.query.bind(client);
    const { rows: uidRows } = await q(`SELECT * FROM uids WHERE uid_code = $1 FOR UPDATE`, [uidCode]);
    if (!uidRows[0]) throw Object.assign(new Error(`UID ${uidCode} not found.`), { status: 404, code: 'UID_NOT_FOUND' });
    const uid = uidRows[0];

    const { rows: logRows } = await q(
      `UPDATE uid_step_logs SET qc_check_type = $1, qc_value = $2, qc_result = $3
       WHERE uid_id = $4 AND step_number = $5 AND closed_at IS NULL
       RETURNING id, operation_name`,
      [checkType, value, result, uid.id, uid.current_step]
    );
    const stepLog = logRows[0] || {};

    let concession = null;
    if (result === 'Fail') {
      // A below-finished-good-minimum dimension is a concession candidate: hold the
      // piece and raise a concession request for a Manager/Admin decision, rather
      // than a plain fail. Anything else is a straight QC fail.
      const dim = concessionDimension(checkType);
      const measured = Number(value);
      const min = dim && Number.isFinite(measured) ? await fgMinFor(q, dim) : null;
      if (dim && min != null && Number.isFinite(measured) && measured < min) {
        const colorId = await concessionColorFor(q, dim);
        const { rows: cRows } = await q(
          `INSERT INTO concession_requests
             (uid_id, uid_code, uid_step_log_id, step_number, operation_name, dimension, measured_value, min_value, concession_color_id, raised_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [uid.id, uid.uid_code, stepLog.id || null, uid.current_step, stepLog.operation_name || checkType, dim, measured, min, colorId, req.user.sub]
        );
        concession = cRows[0];
        await q(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`, [`Concession pending — ${dim} ${measured}mm below ${min}mm`, uid.id]);
        await createAlert(q, {
          type: 'concession_request', severity: 'warning', uidId: uid.id,
          message: `CONCESSION REQUEST — ${uid.uid_code} ${dim} ${measured}mm (min ${min}mm) awaiting approval`,
          targetRole: 'manager', linkPage: 'qc', linkRecordId: uid.uid_code,
        });
      } else {
        await q(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`, [`QC failed: ${checkType}`, uid.id]);
        await createAlert(q, {
          type: 'qc_fail', severity: 'critical', uidId: uid.id,
          message: `QC FAIL (${checkType}) — ${uid.uid_code} held at step ${uid.current_step}`,
          targetRole: 'supervisor', linkPage: 'qc', linkRecordId: uid.uid_code,
        });
      }
    }
    return { uidCode, checkType, value, result, concession };
  });

  await req.audit({ tableName: 'uid_step_logs', recordId: uidCode, action: 'UPDATE', after: { checkType, value, result, concession: out.concession ? out.concession.id : null } });
  return res.json({ success: true, data: out });
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

// ── Batch-level HRC sampling (Type 2) ────────────────────────────────────────

/** Select `pct`% of the batch's not-yet-sampled pieces into the HRC queue for a
 *  round. Returns the created sample rows joined to uid codes. */
async function selectBatchSample(client, batch, round, pct) {
  const { rows: pool } = await client.query(
    `SELECT fbu.uid_id FROM furnace_batch_uids fbu
     WHERE fbu.furnace_batch_id = $1
       AND fbu.uid_id NOT IN (SELECT uid_id FROM hrc_inspection_samples WHERE furnace_batch_id = $1)
     ORDER BY random()`, [batch.id]
  );
  const n = sampleCount(pool.length, pct);
  const chosen = pool.slice(0, n).map((r) => r.uid_id);
  if (!chosen.length) return [];
  const { rows: srcRows } = await client.query(`SELECT step_number FROM cycle_steps WHERE id = $1`, [batch.cycle_step_id]);
  const srcStep = srcRows[0] ? srcRows[0].step_number : null;
  const created = [];
  for (const uidId of chosen) {
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await client.query(
      `INSERT INTO hrc_inspection_samples (uid_id, source_step_number, status, selected_at, furnace_batch_id, sample_round)
       VALUES ($1,$2,'pending',now(),$3,$4) RETURNING id, uid_id`,
      [uidId, srcStep, batch.id, round]
    );
    created.push(rows[0]);
  }
  return created;
}

/** POST /api/v1/qc/batches/:batchId/hrc-sample — start round-1 (10%) sampling. */
router.post('/batches/:batchId/hrc-sample', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const out = await withTransaction(async (client) => {
    const { rows: bRows } = await client.query(`SELECT * FROM furnace_batches WHERE id = $1 FOR UPDATE`, [req.params.batchId]);
    const batch = bRows[0];
    if (!batch) throw Object.assign(new Error('Batch not found'), { status: 404, code: 'BATCH_NOT_FOUND' });
    const { rows: existing } = await client.query(`SELECT COUNT(*)::int AS c FROM hrc_inspection_samples WHERE furnace_batch_id = $1 AND sample_round = 1`, [batch.id]);
    if (existing[0].c > 0) throw Object.assign(new Error('Round 1 already sampled for this batch'), { status: 409, code: 'ALREADY_SAMPLED' });
    const created = await selectBatchSample(client, batch, 1, 10);
    const codes = created.length ? (await client.query(`SELECT uid_code FROM uids WHERE id = ANY($1)`, [created.map((c) => c.uid_id)])).rows.map((r) => r.uid_code) : [];
    return { round: 1, selected: codes, count: created.length };
  });
  return res.status(201).json({ success: true, data: out });
});

/** GET /api/v1/qc/batches/:batchId/hrc-status — sample rounds + recommended action. */
router.get('/batches/:batchId/hrc-status', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const batchId = req.params.batchId;
  const { rows: batch } = await query(`SELECT id, batch_number, status, recall_status, recall_reason, batch_retreatment_count FROM furnace_batches WHERE id = $1`, [batchId]);
  if (!batch[0]) return res.status(404).json({ success: false, error: { code: 'BATCH_NOT_FOUND', message: 'Batch not found.' } });
  const { rows: total } = await query(`SELECT COUNT(*)::int AS c FROM furnace_batch_uids WHERE furnace_batch_id = $1`, [batchId]);
  const { rows: samples } = await query(
    `SELECT s.sample_round, s.status, s.hrc_value, u.uid_code
     FROM hrc_inspection_samples s JOIN uids u ON u.id = s.uid_id
     WHERE s.furnace_batch_id = $1 ORDER BY s.sample_round, s.id`, [batchId]
  );
  const rounds = {};
  for (const s of samples) {
    const r = rounds[s.sample_round] || (rounds[s.sample_round] = { round: s.sample_round, samples: [], pass: 0, fail: 0, pending: 0 });
    r.samples.push({ uidCode: s.uid_code, status: s.status, hrcValue: s.hrc_value });
    if (s.status === 'pass') r.pass++; else if (s.status === 'fail') r.fail++; else r.pending++;
  }
  const roundList = Object.values(rounds).sort((a, b) => a.round - b.round);
  const latest = roundList[roundList.length - 1];
  let recommended = null;
  if (latest && latest.pending === 0 && latest.samples.length) {
    const scenario = classifyScenario(latest.pass, latest.samples.length);
    recommended = { scenario, action: decideAction(latest.round, scenario) };
  }
  return res.json({ success: true, data: { batch: batch[0], totalPieces: total[0].c, rounds: roundList, recommended } });
});

/** POST /api/v1/qc/batches/:batchId/evaluate — apply the whole-batch decision
 *  from the latest completed sampling round. */
router.post('/batches/:batchId/evaluate', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const out = await withTransaction(async (client) => {
    const { rows: bRows } = await client.query(`SELECT * FROM furnace_batches WHERE id = $1 FOR UPDATE`, [req.params.batchId]);
    const batch = bRows[0];
    if (!batch) throw Object.assign(new Error('Batch not found'), { status: 404, code: 'BATCH_NOT_FOUND' });

    const { rows: rounds } = await client.query(
      `SELECT sample_round, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'pass')::int AS pass,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
       FROM hrc_inspection_samples WHERE furnace_batch_id = $1 GROUP BY sample_round ORDER BY sample_round DESC LIMIT 1`, [batch.id]
    );
    const latest = rounds[0];
    if (!latest) throw Object.assign(new Error('No HRC sample taken yet'), { status: 400, code: 'NO_SAMPLE' });
    if (latest.pending > 0) throw Object.assign(new Error('Some sampled pieces are still awaiting an HRC reading'), { status: 400, code: 'SAMPLE_INCOMPLETE' });

    const scenario = classifyScenario(latest.pass, latest.total);
    const action = decideAction(latest.sample_round, scenario);
    const escalate = async (type, severity, message, roles) => {
      for (const role of roles) {
        // eslint-disable-next-line no-await-in-loop
        await createAlert(client.query.bind(client), { type, severity, message, targetRole: role, linkPage: 'batch', linkRecordId: String(batch.id) });
      }
    };

    if (action === 'second_sample') {
      const created = await selectBatchSample(client, batch, latest.sample_round + 1, 5);
      const codes = created.length ? (await client.query(`SELECT uid_code FROM uids WHERE id = ANY($1)`, [created.map((c) => c.uid_id)])).rows.map((r) => r.uid_code) : [];
      await escalate('batch_sample', 'warning', `${batch.batch_number}: majority HRC fail — second sample of ${created.length} triggered`, ['supervisor', 'manager']);
      return { scenario, action, round: latest.sample_round + 1, selected: codes };
    }
    if (action === 'recall') {
      const { rows: uidRows } = await client.query(`SELECT uid_id FROM furnace_batch_uids WHERE furnace_batch_id = $1`, [batch.id]);
      const ids = uidRows.map((r) => r.uid_id);
      if (ids.length) await client.query(`UPDATE uids SET status = 'hold', hold_reason = 'Batch HRC failure — recall' WHERE id = ANY($1)`, [ids]);
      await client.query(`UPDATE furnace_batches SET recall_status = 'recalled', recall_reason = $2, batch_retreatment_count = batch_retreatment_count + 1 WHERE id = $1`, [batch.id, `HRC ${scenario} in round ${latest.sample_round}`]);
      await escalate('batch_recall', 'critical', `${batch.batch_number}: batch recalled — HRC ${scenario}. ${ids.length} pieces held for re-treatment.`, ['supervisor', 'manager', 'admin']);
      return { scenario, action, heldPieces: ids.length };
    }
    if (action === 'partial_warning') {
      await client.query(`UPDATE furnace_batches SET recall_status = 'partial_warning', recall_reason = 'Partial HRC failure — monitor closely' WHERE id = $1`, [batch.id]);
      await escalate('batch_sample', 'warning', `${batch.batch_number}: partial HRC failure — monitor closely`, ['supervisor']);
      return { scenario, action };
    }
    // continue | individual — failed sample pieces were already routed on recording
    return { scenario, action };
  });
  return res.json({ success: true, data: out });
});

// ── Annealing dispatch (very-low HRC → external anneal → re-enter at HT70) ────

/** GET /api/v1/qc/annealing?status= — list annealing dispatches. */
router.get('/annealing', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = '';
  if (status && status !== 'all') { params.push(status); where = 'WHERE ad.status = $1'; }
  const { rows } = await query(
    `SELECT ad.*, u.uid_code, u.status AS uid_status, c.name AS contractor_name
     FROM annealing_dispatches ad JOIN uids u ON u.id = ad.uid_id
     LEFT JOIN contractors c ON c.id = ad.contractor_id
     ${where} ORDER BY ad.status = 'dispatched' DESC, ad.dispatched_at DESC`, params
  );
  return res.json({ success: true, data: rows });
});

/** GET /api/v1/qc/annealing/candidates — UIDs held for annealing, not yet dispatched. */
router.get('/annealing/candidates', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.uid_code, u.hold_reason FROM uids u
     WHERE u.status = 'hold' AND u.hold_reason ILIKE '%anneal%'
       AND NOT EXISTS (SELECT 1 FROM annealing_dispatches ad WHERE ad.uid_id = u.id AND ad.status = 'dispatched')
     ORDER BY u.uid_code`
  );
  return res.json({ success: true, data: rows });
});

/** POST /api/v1/qc/annealing/dispatch — send a very-low piece for annealing.
 *  body: { uidCode, contractorId?, expectedReturnDate?, notes? } */
router.post('/annealing/dispatch', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { uidCode, contractorId, expectedReturnDate, notes } = req.body || {};
  if (!uidCode) return res.status(400).json({ success: false, error: { code: 'MISSING_UID', message: 'uidCode is required.' } });

  const out = await withTransaction(async (client) => {
    const { rows: uRows } = await client.query(`SELECT id, uid_code, status FROM uids WHERE uid_code = $1 FOR UPDATE`, [uidCode]);
    const uid = uRows[0];
    if (!uid) throw Object.assign(new Error('UID not found'), { status: 404, code: 'UID_NOT_FOUND' });

    const year = new Date().getFullYear();
    const { rows: seq } = await client.query(`SELECT COUNT(*)::int AS c FROM annealing_dispatches WHERE reference LIKE $1`, [`DHR-ANN-${year}-%`]);
    const reference = `DHR-ANN-${year}-${String(seq[0].c + 1).padStart(3, '0')}`;

    // Keep the piece on hold while it is away.
    await client.query(`UPDATE uids SET status = 'hold', hold_reason = 'At third-party annealing contractor' WHERE id = $1`, [uid.id]);
    const { rows } = await client.query(
      `INSERT INTO annealing_dispatches (reference, uid_id, contractor_id, expected_return_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [reference, uid.id, contractorId || null, expectedReturnDate || null, notes || null, req.user.sub]
    );
    await createAlert(client.query.bind(client), { type: 'annealing', severity: 'warning', uidId: uid.id, message: `${uid.uid_code} dispatched for annealing (${reference})`, targetRole: 'manager', linkPage: 'qc', linkRecordId: String(uid.id) });
    return rows[0];
  });
  await req.audit({ tableName: 'annealing_dispatches', recordId: out.id, action: 'INSERT', after: out });
  return res.status(201).json({ success: true, data: out });
});

/** POST /api/v1/qc/annealing/:id/return — piece back; re-enter the cycle at HT70. */
router.post('/annealing/:id/return', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const out = await withTransaction(async (client) => {
    const { rows: dRows } = await client.query(`SELECT * FROM annealing_dispatches WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const dispatch = dRows[0];
    if (!dispatch) throw Object.assign(new Error('Annealing dispatch not found'), { status: 404, code: 'DISPATCH_NOT_FOUND' });
    if (dispatch.status === 'returned') throw Object.assign(new Error('Already returned'), { status: 409, code: 'ALREADY_RETURNED' });

    const { rows: uRows } = await client.query(`SELECT id, uid_code, cycle_version_id FROM uids WHERE id = $1`, [dispatch.uid_id]);
    const uid = uRows[0];
    // Re-enter the cycle from Hardening (HT70) — first step run at the HT70 workstation.
    const { rows: hardStep } = await client.query(
      `SELECT cs.step_number, cs.source_storage_id FROM cycle_steps cs
       JOIN workstation_types wt ON wt.id = cs.workstation_type_id
       WHERE cs.cycle_version_id = $1 AND wt.code = 'HT70' ORDER BY cs.sequence_order LIMIT 1`, [uid.cycle_version_id]
    );
    const step = hardStep[0];
    await client.query(`UPDATE uids SET status = 'active', current_step = $1, current_storage_id = $2, hold_reason = NULL WHERE id = $3`,
      [step ? step.step_number : null, step ? step.source_storage_id : null, uid.id]);
    const { rows: rows } = await client.query(`UPDATE annealing_dispatches SET status = 'returned', returned_at = CURRENT_DATE WHERE id = $1 RETURNING *`, [dispatch.id]);
    await createAlert(client.query.bind(client), { type: 'annealing', severity: 'info', uidId: uid.id, message: `${uid.uid_code} returned from annealing — re-entering at Hardening (HT70)`, targetRole: 'supervisor', linkPage: 'qc', linkRecordId: String(uid.id) });
    return { dispatch: rows[0], reenterStep: step ? step.step_number : null };
  });
  await req.audit({ tableName: 'annealing_dispatches', recordId: out.dispatch.id, action: 'UPDATE', after: out.dispatch });
  return res.json({ success: true, data: out });
});

// ── QC DASHBOARD ─────────────────────────────────────────────────────────────
// Everything below is the read-only live dashboard plus the three admin/manager
// capabilities it exposes: override a result, decide a concession, and send a
// Supervisor an instruction.

const DASH_ROLES = ['admin', 'manager', 'supervisor'];

/**
 * GET /api/v1/qc/activity — live QC event feed (newest first).
 * Merges recorded step-log QC results, HRC sample readings, concession requests
 * and overrides into one stream. ?filter = all|operator|inspector|failed|pending|overridden
 */
router.get('/activity', requireRole(DASH_ROLES), async (req, res) => {
  const filter = String(req.query.filter || 'all').toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 80, 200);

  // 1. Dimensional / visual QC recorded on step logs.
  const { rows: stepEvents } = await query(
    `SELECT sl.id, sl.uid_id, u.uid_code, sl.step_number, sl.operation_name,
            sl.qc_check_type, sl.qc_value, sl.qc_result, sl.notes,
            COALESCE(sl.closed_at, sl.started_at) AS at,
            e.full_name AS operator_name, wu.unit_code,
            (SELECT o.new_result FROM qc_overrides o WHERE o.uid_step_log_id = sl.id ORDER BY o.created_at DESC LIMIT 1) AS override_result
     FROM uid_step_logs sl
     JOIN uids u ON u.id = sl.uid_id
     LEFT JOIN employees e ON e.id = sl.operator_id
     LEFT JOIN workstation_units wu ON wu.id = sl.workstation_unit_id
     WHERE sl.qc_result IS NOT NULL
     ORDER BY COALESCE(sl.closed_at, sl.started_at) DESC
     LIMIT $1`, [limit]
  );

  // 2. HRC sample readings (inspector-level).
  const { rows: hrcEvents } = await query(
    `SELECT s.id, s.uid_id, u.uid_code, s.source_step_number AS step_number,
            s.hrc_value, s.status, s.inspected_at, e.full_name AS inspector_name
     FROM hrc_inspection_samples s
     JOIN uids u ON u.id = s.uid_id
     LEFT JOIN employees e ON e.id = s.inspected_by
     WHERE s.hrc_value IS NOT NULL
     ORDER BY s.inspected_at DESC NULLS LAST
     LIMIT $1`, [limit]
  );

  // 3. Concession requests.
  const { rows: concEvents } = await query(
    `SELECT c.*, cc.color_name FROM concession_requests c
     LEFT JOIN concession_color_codes cc ON cc.id = c.concession_color_id
     ORDER BY c.created_at DESC LIMIT $1`, [limit]
  );

  // 4. Overrides.
  const { rows: overrideEvents } = await query(
    `SELECT o.*, e.full_name AS by_name FROM qc_overrides o
     LEFT JOIN employees e ON e.id = o.overridden_by
     ORDER BY o.created_at DESC LIMIT $1`, [limit]
  );

  const events = [];
  for (const s of stepEvents) {
    const level = String(s.qc_check_type || '').toLowerCase().includes('hrc') || s.step_number === '26' ? 'inspector' : 'operator';
    events.push({
      kind: 'qc_result', level, id: `sl-${s.id}`, stepLogId: s.id, uidCode: s.uid_code, uidId: s.uid_id,
      step: s.step_number, operation: s.operation_name, checkType: s.qc_check_type, value: s.qc_value,
      result: s.override_result || s.qc_result, originalResult: s.override_result ? s.qc_result : null,
      overridden: !!s.override_result, notes: s.notes, operator: s.operator_name, unit: s.unit_code, at: s.at,
    });
  }
  for (const h of hrcEvents) {
    events.push({
      kind: 'hrc', level: 'inspector', id: `hrc-${h.id}`, uidCode: h.uid_code, uidId: h.uid_id, step: h.step_number,
      checkType: 'HRC', value: h.hrc_value, result: h.status === 'pass' ? 'Pass' : h.status === 'fail' ? 'Fail' : 'Borderline',
      operator: h.inspector_name, at: h.inspected_at,
    });
  }
  for (const c of concEvents) {
    events.push({
      kind: 'concession', level: 'operator', id: `conc-${c.id}`, concessionId: c.id, uidCode: c.uid_code, uidId: c.uid_id,
      step: c.step_number, operation: c.operation_name, checkType: `${c.dimension} concession`, value: c.measured_value,
      min: c.min_value, colorName: c.color_name, status: c.status,
      result: c.status === 'approved' ? 'Concession' : c.status === 'rejected' ? 'Fail' : 'Pending', at: c.created_at,
    });
  }
  for (const o of overrideEvents) {
    events.push({
      kind: 'override', level: 'operator', id: `ovr-${o.id}`, uidCode: o.uid_code, uidId: o.uid_id, step: o.step_number,
      checkType: 'Override', originalResult: o.original_result, result: o.new_result, reason: o.reason,
      operator: o.by_name, overridden: true, at: o.created_at,
    });
  }

  events.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

  let filtered = events;
  if (filter === 'operator') filtered = events.filter((e) => e.level === 'operator' && e.kind !== 'override');
  else if (filter === 'inspector') filtered = events.filter((e) => e.level === 'inspector');
  else if (filter === 'failed') filtered = events.filter((e) => e.result === 'Fail');
  else if (filter === 'pending') filtered = events.filter((e) => e.result === 'Pending');
  else if (filter === 'overridden') filtered = events.filter((e) => e.overridden || e.kind === 'override');

  return res.json({ success: true, data: filtered.slice(0, limit) });
});

/** GET /api/v1/qc/summary — shift counters + pending/hold tallies. */
router.get('/summary', requireRole(DASH_ROLES), async (req, res) => {
  const { rows: resultRows } = await query(
    `SELECT qc_result AS result, COUNT(*)::int AS n
     FROM uid_step_logs
     WHERE qc_result IS NOT NULL AND COALESCE(closed_at, started_at) >= date_trunc('day', now())
     GROUP BY qc_result`
  );
  const results = { Pass: 0, Fail: 0, Borderline: 0 };
  for (const r of resultRows) if (r.result in results) results[r.result] = r.n;

  const { rows: concRows } = await query(`SELECT status, COUNT(*)::int AS n FROM concession_requests GROUP BY status`);
  const concessions = { pending: 0, approved: 0, rejected: 0 };
  for (const c of concRows) if (c.status in concessions) concessions[c.status] = c.n;

  const { rows: pendingRows } = await query(
    `SELECT COUNT(*)::int AS n FROM uids WHERE current_step = ANY($1) AND status = 'active'`, [QC_STEPS]
  );
  const { rows: hrcPending } = await query(`SELECT COUNT(*)::int AS n FROM hrc_inspection_samples WHERE status = 'pending'`);
  const { rows: holdRows } = await query(
    `SELECT COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE hold_reason ILIKE '%hrc%' OR hold_reason ILIKE '%anneal%')::int AS hrc_holds,
            COUNT(*) FILTER (WHERE hold_reason ILIKE '%concession%')::int AS concession_holds
     FROM uids WHERE status = 'hold'`
  );
  const { rows: batchRows } = await query(
    `SELECT id, batch_number, recall_status, recall_reason FROM furnace_batches WHERE recall_status IS NOT NULL ORDER BY id DESC LIMIT 10`
  );

  return res.json({
    success: true,
    data: {
      results, concessions,
      pendingInspection: pendingRows[0].n,
      hrcSamplesPending: hrcPending[0].n,
      holds: { total: holdRows[0].n, hrc: holdRows[0].hrc_holds, concession: holdRows[0].concession_holds },
      batchFlags: batchRows,
    },
  });
});

/** GET /api/v1/qc/concessions — concession requests (?status=pending|all). */
router.get('/concessions', requireRole(DASH_ROLES), async (req, res) => {
  const status = req.query.status;
  const params = [];
  let where = '';
  if (status && status !== 'all') { where = 'WHERE c.status = $1'; params.push(status); }
  const { rows } = await query(
    `SELECT c.*, cc.color_name, cc.hex, raiser.full_name AS raised_by_name, decider.full_name AS decided_by_name
     FROM concession_requests c
     LEFT JOIN concession_color_codes cc ON cc.id = c.concession_color_id
     LEFT JOIN employees raiser ON raiser.id = c.raised_by
     LEFT JOIN employees decider ON decider.id = c.decided_by
     ${where}
     ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.created_at DESC`,
    params
  );
  return res.json({ success: true, data: rows });
});

/** POST /api/v1/qc/concessions/:id/decide — approve or reject. body: { decision, note? } */
router.post('/concessions/:id/decide', requireRole(['admin', 'manager']), async (req, res) => {
  const decision = String(req.body.decision || '').toLowerCase();
  const note = req.body.note || null;
  if (!['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_DECISION', message: "decision must be 'approve' or 'reject'." } });
  }

  const out = await withTransaction(async (client) => {
    const q = client.query.bind(client);
    const { rows } = await q(`SELECT * FROM concession_requests WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const cr = rows[0];
    if (!cr) throw Object.assign(new Error('Concession request not found.'), { status: 404, code: 'NOT_FOUND' });
    if (cr.status !== 'pending') throw Object.assign(new Error('This concession has already been decided.'), { status: 409, code: 'ALREADY_DECIDED' });

    const status = decision === 'approve' ? 'approved' : 'rejected';
    const { rows: updated } = await q(
      `UPDATE concession_requests SET status = $1, decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $4 RETURNING *`,
      [status, req.user.sub, note, cr.id]
    );

    if (decision === 'approve') {
      // Accepted under concession — release the piece back into production; the
      // physical box is marked in the concession colour.
      await q(`UPDATE uids SET status = 'active', hold_reason = NULL WHERE id = $1`, [cr.uid_id]);
    }
    // On reject the piece stays on hold — no change to the UID.
    return updated[0];
  });

  await req.audit({ tableName: 'concession_requests', recordId: req.params.id, action: 'UPDATE', after: out });
  return res.json({ success: true, data: out });
});

/** GET /api/v1/qc/overrides — override history (for the OVERRIDDEN filter view). */
router.get('/overrides', requireRole(DASH_ROLES), async (req, res) => {
  const { rows } = await query(
    `SELECT o.*, e.full_name AS by_name FROM qc_overrides o
     LEFT JOIN employees e ON e.id = o.overridden_by
     ORDER BY o.created_at DESC LIMIT 200`
  );
  return res.json({ success: true, data: rows });
});

/** POST /api/v1/qc/overrides — admin overrides a QC result. body: { uidStepLogId, newResult, reason } */
router.post('/overrides', requireRole(['admin']), async (req, res) => {
  const { uidStepLogId, newResult, reason } = req.body || {};
  if (!['Pass', 'Fail', 'Borderline'].includes(newResult)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_RESULT', message: "newResult must be Pass, Fail or Borderline." } });
  }
  if (!reason || String(reason).trim().length < 20) {
    return res.status(400).json({ success: false, error: { code: 'REASON_REQUIRED', message: 'A reason of at least 20 characters is required.' } });
  }

  const out = await withTransaction(async (client) => {
    const q = client.query.bind(client);
    const { rows: slRows } = await q(
      `SELECT sl.*, u.uid_code, u.status AS uid_status FROM uid_step_logs sl JOIN uids u ON u.id = sl.uid_id WHERE sl.id = $1 FOR UPDATE`,
      [uidStepLogId]
    );
    const sl = slRows[0];
    if (!sl) throw Object.assign(new Error('Step log not found.'), { status: 404, code: 'NOT_FOUND' });

    const { rows: ovr } = await q(
      `INSERT INTO qc_overrides (uid_step_log_id, uid_id, uid_code, step_number, original_result, new_result, reason, overridden_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [sl.id, sl.uid_id, sl.uid_code, sl.step_number, sl.qc_result, newResult, String(reason).trim(), req.user.sub]
    );
    await q(`UPDATE uid_step_logs SET qc_result = $1 WHERE id = $2`, [newResult, sl.id]);

    // Overriding a fail to a pass releases a QC hold; overriding a pass to a fail holds it.
    if (newResult === 'Pass' && sl.uid_status === 'hold') {
      await q(`UPDATE uids SET status = 'active', hold_reason = NULL WHERE id = $1`, [sl.uid_id]);
    } else if (newResult === 'Fail' && sl.uid_status === 'active') {
      await q(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`, [`QC override to Fail at step ${sl.step_number}`, sl.uid_id]);
    }
    return ovr[0];
  });

  await req.audit({ tableName: 'qc_overrides', recordId: out.id, action: 'INSERT', after: { ...out, override: true } });
  return res.status(201).json({ success: true, data: out });
});

/** POST /api/v1/qc/instructions — admin sends the Supervisor an instruction (delivered as an alert). */
router.post('/instructions', requireRole(['admin']), async (req, res) => {
  const b = req.body || {};
  const message = String(b.message || '').trim();
  if (!message) return res.status(400).json({ success: false, error: { code: 'MESSAGE_REQUIRED', message: 'An instruction message is required.' } });
  const regarding = b.regarding ? String(b.regarding).trim() : null;
  const uidCode = b.uidCode ? String(b.uidCode).trim() : null;
  const targetEmployeeId = b.targetEmployeeId ? Number(b.targetEmployeeId) : null;

  let uidId = null;
  if (uidCode) {
    const { rows } = await query(`SELECT id FROM uids WHERE uid_code = $1`, [uidCode]);
    uidId = rows[0] ? rows[0].id : null;
  }

  const fullMessage = regarding ? `Re ${regarding}: ${message}` : message;
  const { rows } = await query(
    `INSERT INTO alerts (alert_type, severity, uid_id, message, target_role, target_employee_id, link_page, link_record_id)
     VALUES ('admin_instruction','info',$1,$2,'supervisor',$3,'qc',$4) RETURNING *`,
    [uidId, fullMessage, targetEmployeeId, uidCode]
  );
  await req.audit({ tableName: 'alerts', recordId: rows[0].id, action: 'INSERT', after: rows[0] });
  return res.status(201).json({ success: true, data: rows[0] });
});

module.exports = router;
