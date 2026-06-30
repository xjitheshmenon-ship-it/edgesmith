const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');
const { furnaceCapacityForSize, validateGrindingCombination, bunchGrindingRunCapacity } = require('../utils/scrapCalculator');
const { checkDeviation } = require('../utils/deviationChecker');

const router = express.Router();

// NOTE: authenticate/auditContext are applied per-sub-router below (furnaceRouter,
// grindingRouter), NOT as a blanket router.use() here. This file is mounted at
// the bare /api/v1 prefix in app.js (because it serves two path families,
// /furnace-batches/* and /grinding/*, that don't share a clean common prefix),
// and a blanket middleware here would match every /api/v1/* request — including
// genuinely unknown routes — intercepting them with a 401 before they can ever
// reach the global 404 handler registered after this router in app.js.
const furnaceRouter = express.Router();
furnaceRouter.use(authenticate, auditContext);
const grindingRouter = express.Router();
grindingRouter.use(authenticate, auditContext);

/**
 * GET /api/v1/furnace-batches
 * Filters: status, step, cycle
 */
furnaceRouter.get('/', async (req, res) => {
  const { status, cycle_step_id, status: statusFilter } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;
  if (statusFilter) { conditions.push(`fb.status = $${p++}`); params.push(statusFilter); }
  if (cycle_step_id) { conditions.push(`fb.cycle_step_id = $${p++}`); params.push(cycle_step_id); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT fb.*, ct.code AS cycle_code, cs.operation_name, wu.unit_code,
            (SELECT COUNT(*) FROM furnace_batch_uids fbu WHERE fbu.furnace_batch_id = fb.id) AS uid_count
     FROM furnace_batches fb
     JOIN cycle_types ct ON ct.id = fb.cycle_type_id
     JOIN cycle_steps cs ON cs.id = fb.cycle_step_id
     LEFT JOIN workstation_units wu ON wu.id = fb.workstation_unit_id
     ${where}
     ORDER BY fb.created_at DESC`,
    params
  );
  return res.json({ success: true, data: rows });
});

/**
 * GET /api/v1/furnace-batches/queue?cycle_step_id=X
 * Returns the WAITING/READY state for a tempering/hardening/quenching step:
 * queued UIDs (filtered to ONE cycle type — hard rule, no mixing), how many
 * are needed to reach the minimum threshold, and whether auto-assign should fire.
 */
furnaceRouter.get('/queue', async (req, res) => {
  const { cycle_step_id, cycle_code } = req.query;
  if (!cycle_step_id || !cycle_code) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_PARAMS', message: 'cycle_step_id and cycle_code are required.' } });
  }

  const { rows: stepRows } = await query(`SELECT * FROM cycle_steps WHERE id = $1`, [cycle_step_id]);
  const step = stepRows[0];
  if (!step) return res.status(404).json({ success: false, error: { code: 'STEP_NOT_FOUND', message: 'Step not found.' } });

  // Queued UIDs at this step, this cycle type only (hard isolation rule)
  const { rows: queued } = await query(
    `SELECT u.id, u.uid_code, u.priority, u.created_at, sz.size_mm
     FROM uids u
     JOIN cycle_versions cv ON cv.id = u.cycle_version_id
     JOIN cycle_types ct ON ct.id = cv.cycle_type_id
     LEFT JOIN sizes sz ON sz.id = u.size_id
     WHERE u.current_step = $1 AND ct.code = $2 AND u.status = 'active'
       AND u.id NOT IN (SELECT uid_id FROM furnace_batch_uids fbu JOIN furnace_batches fb ON fb.id = fbu.furnace_batch_id WHERE fb.status != 'complete')
     ORDER BY CASE u.priority WHEN 'High' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END, u.created_at ASC`,
    [step.step_number, cycle_code]
  );

  // Compute effective capacity given the mix of sizes in queue (proportional rule).
  // Conservative: use the smallest derived capacity among sizes present, so the
  // threshold reflects the worst case (e.g. any 2750mm bars reduce the effective max).
  let effectiveCapacity = step.capacity_1500 || 0;
  if (step.capacity_basis === 'furnace_scaled' && queued.length) {
    const sizesPresent = [...new Set(queued.map((q) => q.size_mm).filter(Boolean))];
    const derivedCaps = sizesPresent.map((sz) => furnaceCapacityForSize(step.capacity_1500, sz));
    effectiveCapacity = derivedCaps.length ? Math.min(...derivedCaps) : step.capacity_1500;
  }

  const minThreshold = step.min_queue_threshold || 1;
  const ready = queued.length >= minThreshold;
  const batchSize = Math.min(queued.length, effectiveCapacity || queued.length);

  return res.json({
    success: true,
    data: {
      stepNumber: step.step_number,
      minThreshold,
      effectiveCapacity,
      queuedCount: queued.length,
      moreNeeded: Math.max(0, minThreshold - queued.length),
      ready,
      proposedBatch: queued.slice(0, batchSize).map((q) => ({ id: q.id, uid_code: q.uid_code, priority: q.priority, size_mm: q.size_mm })),
      fullQueue: queued.map((q) => ({ id: q.id, uid_code: q.uid_code, priority: q.priority, size_mm: q.size_mm, created_at: q.created_at })),
    },
  });
});

/**
 * POST /api/v1/furnace-batches
 * Create (and optionally auto-start) a furnace batch.
 * body: { cycleStepId, cycleCode, uidIds: [...], workstationUnitId, overrideThreshold?, overrideReason? }
 *
 * Enforces: single cycle type per batch (hard rule), capacity not exceeded.
 */
furnaceRouter.post('/', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { cycleStepId, cycleCode, uidIds, workstationUnitId, overrideThreshold, overrideReason } = req.body;

  if (!cycleStepId || !cycleCode || !Array.isArray(uidIds) || !uidIds.length) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'cycleStepId, cycleCode, and uidIds are required.' } });
  }

  const result = await withTransaction(async (client) => {
    const { rows: stepRows } = await client.query(`SELECT * FROM cycle_steps WHERE id = $1`, [cycleStepId]);
    const step = stepRows[0];
    if (!step) throw Object.assign(new Error('Step not found'), { status: 404, code: 'STEP_NOT_FOUND' });

    const { rows: cycleRows } = await client.query(`SELECT id FROM cycle_types WHERE code = $1`, [cycleCode]);
    if (!cycleRows[0]) throw Object.assign(new Error('Unknown cycle'), { status: 400, code: 'UNKNOWN_CYCLE' });
    const cycleTypeId = cycleRows[0].id;

    // Hard rule: every UID in this batch must belong to cycleCode — no mixing, no override possible
    const { rows: uidCheck } = await client.query(
      `SELECT u.id, ct.code AS cycle_code FROM uids u
       JOIN cycle_versions cv ON cv.id = u.cycle_version_id
       JOIN cycle_types ct ON ct.id = cv.cycle_type_id
       WHERE u.id = ANY($1::bigint[])`,
      [uidIds]
    );
    const mismatched = uidCheck.filter((u) => u.cycle_code !== cycleCode);
    if (mismatched.length) {
      throw Object.assign(new Error('Cannot mix cycle types in one furnace batch'), {
        status: 409, code: 'CYCLE_MIX_NOT_ALLOWED', meta: { mismatched: mismatched.map((m) => m.id) },
      });
    }

    if (uidIds.length < (step.min_queue_threshold || 1) && !overrideThreshold) {
      throw Object.assign(new Error('Minimum queue threshold not met'), {
        status: 409, code: 'THRESHOLD_NOT_MET', meta: { needed: step.min_queue_threshold, have: uidIds.length },
      });
    }

    const { rows: temperRows } = await client.query(
      `SELECT * FROM tempering_parameters WHERE cycle_type_id = $1 AND tempering_step = $2`,
      [cycleTypeId, mapStepToTemperingKey(step.step_number)]
    );
    const params = temperRows[0];

    const batchNumber = await generateBatchNumber(client, step.step_number, cycleCode);

    const { rows: batchRows } = await client.query(
      `INSERT INTO furnace_batches (batch_number, cycle_step_id, cycle_type_id, workstation_unit_id,
                                     target_temp_c, target_soak_min, status, started_at, operator_id)
       VALUES ($1,$2,$3,$4,$5,$6,'running', now(), $7) RETURNING *`,
      [batchNumber, cycleStepId, cycleTypeId, workstationUnitId || null,
        params ? params.target_temp_c : null, params ? params.target_soak_min : null, req.user.sub]
    );
    const batch = batchRows[0];

    for (const uidId of uidIds) {
      await client.query(`INSERT INTO furnace_batch_uids (furnace_batch_id, uid_id) VALUES ($1,$2)`, [batch.id, uidId]);
      await client.query(
        `INSERT INTO uid_step_logs (uid_id, step_number, operation_name, workstation_unit_id, operator_id, started_at, furnace_batch_id)
         VALUES ($1,$2,$3,$4,$5,now(),$6)`,
        [uidId, step.step_number, step.operation_name, workstationUnitId || null, req.user.sub, batch.id]
      );
    }

    if (overrideThreshold) {
      await req.audit({
        tableName: 'furnace_batches', recordId: batch.id, action: 'INSERT',
        after: { override: true, reason: overrideReason, queueSize: uidIds.length, required: step.min_queue_threshold },
      }, client);
    }

    return batch;
  });

  return res.status(201).json({ success: true, data: result });
});

/**
 * PATCH /api/v1/furnace-batches/:id/complete
 * Logs actuals, runs deviation check, closes the batch and all its UID step logs.
 * body: { actualTempC, actualSoakMin }
 */
furnaceRouter.patch('/:id/complete', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const { actualTempC, actualSoakMin } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: batchRows } = await client.query(`SELECT * FROM furnace_batches WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const batch = batchRows[0];
    if (!batch) throw Object.assign(new Error('Batch not found'), { status: 404, code: 'BATCH_NOT_FOUND' });

    const { rows: stepRows } = await client.query(`SELECT * FROM cycle_steps WHERE id = $1`, [batch.cycle_step_id]);
    const step = stepRows[0];

    const { rows: tolRows } = await client.query(
      `SELECT * FROM tempering_parameters WHERE cycle_type_id = $1 AND tempering_step = $2`,
      [batch.cycle_type_id, mapStepToTemperingKey(step.step_number)]
    );
    const tol = tolRows[0];

    const deviation = checkDeviation({
      targetTempC: batch.target_temp_c, toleranceTempC: tol ? tol.tolerance_temp_c : 5,
      actualTempC: actualTempC, targetSoakMin: batch.target_soak_min, toleranceSoakMin: tol ? tol.tolerance_soak_min : 5,
      actualSoakMin: actualSoakMin,
    });

    await client.query(
      `UPDATE furnace_batches SET actual_temp_c = $1, actual_soak_min = $2, deviation_flag = $3,
              status = 'complete', closed_at = now() WHERE id = $4`,
      [actualTempC || null, actualSoakMin || null, deviation.flagged, batch.id]
    );

    const { rows: uidRows } = await client.query(`SELECT uid_id FROM furnace_batch_uids WHERE furnace_batch_id = $1`, [batch.id]);

    for (const { uid_id: uidId } of uidRows) {
      await client.query(
        `UPDATE uid_step_logs SET closed_at = now(), qc_result = $1
         WHERE uid_id = $2 AND furnace_batch_id = $3 AND closed_at IS NULL`,
        [deviation.flagged ? 'Borderline' : 'Pass', uidId, batch.id]
      );
      if (!deviation.flagged) {
        // advance UID — find next step
        const { rows: uidRow } = await client.query(`SELECT * FROM uids WHERE id = $1`, [uidId]);
        const { rows: allSteps } = await client.query(
          `SELECT step_number, sequence_order, dest_storage_id FROM cycle_steps WHERE cycle_version_id = $1 ORDER BY sequence_order`,
          [uidRow[0].cycle_version_id]
        );
        const idx = allSteps.findIndex((s) => s.step_number === step.step_number);
        const next = allSteps[idx + 1];
        if (next) {
          await client.query(`UPDATE uids SET current_step = $1, current_storage_id = $2 WHERE id = $3`, [next.step_number, step.dest_storage_id, uidId]);
        } else {
          await client.query(`UPDATE uids SET status = 'done' WHERE id = $1`, [uidId]);
        }
      }
    }

    return { batch: { ...batch, actual_temp_c: actualTempC, actual_soak_min: actualSoakMin, deviation_flag: deviation.flagged }, deviation, uidCount: uidRows.length };
  });

  await req.audit({ tableName: 'furnace_batches', recordId: req.params.id, action: 'UPDATE', after: result });

  return res.json({ success: true, data: result });
});

/** POST /api/v1/furnace-batches/:id/acknowledge-deviation */
furnaceRouter.post('/:id/acknowledge-deviation', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { rows } = await query(
    `UPDATE furnace_batches SET deviation_acknowledged_by = $1 WHERE id = $2 RETURNING *`,
    [req.user.sub, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'BATCH_NOT_FOUND', message: 'Batch not found.' } });
  return res.json({ success: true, data: rows[0] });
});

/** GET /api/v1/furnace-batches/:id/uids */
furnaceRouter.get('/:id/uids', async (req, res) => {
  const { rows } = await query(
    `SELECT u.uid_code, u.status, u.current_step FROM furnace_batch_uids fbu
     JOIN uids u ON u.id = fbu.uid_id WHERE fbu.furnace_batch_id = $1`,
    [req.params.id]
  );
  return res.json({ success: true, data: rows });
});

/**
 * GET /api/v1/batches/grinding/options?step_id=X
 * Returns per-machine availability for length-based grinding (SG-DLT/AG-ALP/AG-BTA/AG-GMM).
 */
grindingRouter.get('/machines', async (req, res) => {
  const { rows } = await query(`SELECT gmr.*, wt.code AS workstation_code FROM grinding_machine_rules gmr JOIN workstation_types wt ON wt.id = gmr.workstation_type_id WHERE gmr.status = 'active'`);
  return res.json({ success: true, data: rows });
});

/** POST /api/v1/grinding/validate-combination — { barLengthsMm: [...], machineCode } */
grindingRouter.post('/validate-combination', async (req, res) => {
  const { barLengthsMm, machineCode } = req.body;
  const { rows } = await query(
    `SELECT gmr.max_length_mm FROM grinding_machine_rules gmr JOIN workstation_types wt ON wt.id = gmr.workstation_type_id WHERE wt.code = $1`,
    [machineCode]
  );
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'MACHINE_NOT_FOUND', message: 'Unknown grinding machine.' } });
  const result = validateGrindingCombination(barLengthsMm, rows[0].max_length_mm);
  return res.json({ success: true, data: result });
});

/** POST /api/v1/grinding/bunch-capacity — { barLengthMm } */
grindingRouter.post('/bunch-capacity', async (req, res) => {
  const { rows } = await query(
    `SELECT bed_length_mm, bars_per_set FROM grinding_machine_rules gmr JOIN workstation_types wt ON wt.id = gmr.workstation_type_id WHERE wt.code = 'SG-DLT' AND gmr.bars_per_set IS NOT NULL`
  );
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'CONFIG_NOT_FOUND', message: 'Bunch grinding config not set.' } });
  const result = bunchGrindingRunCapacity(req.body.barLengthMm, rows[0].bed_length_mm, rows[0].bars_per_set);
  return res.json({ success: true, data: result });
});

// ── helpers ──────────────────────────────────────────────────────────────────

router.use('/furnace-batches', furnaceRouter);
router.use('/grinding', grindingRouter);

function mapStepToTemperingKey(stepNumber) {
  const map = { '9': 'tempering_1', '10': 'tempering_2', '14': 'tempering_3', '23': 'tempering_4' };
  return map[stepNumber] || null;
}

async function generateBatchNumber(client, stepNumber, cycleCode) {
  const year = new Date().getFullYear();
  const prefixMap = { '6': 'HT70', '7': 'HT80', '9': 'HT90-T1', '10': 'HT90-T2', '14': 'HT90-T3', '23': 'HT90-T4' };
  const prefix = prefixMap[stepNumber] || 'BATCH';
  const { rows } = await client.query(
    `SELECT COUNT(*) AS c FROM furnace_batches WHERE batch_number LIKE $1`,
    [`${prefix}-${year}-%`]
  );
  const seq = Number(rows[0].c) + 1;
  return `${prefix}-${year}-${String(seq).padStart(3, '0')}`;
}

module.exports = router;
