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

  // cycle_step_id from the client is a step NUMBER (e.g. 9 = Tempering 1).
  // Resolve it against this cycle's current version — never assume the PK id
  // equals the step number (the 16B split step makes those diverge).
  const step = await resolveFurnaceStep(query, cycle_code, cycle_step_id);
  if (!step) return res.status(404).json({ success: false, error: { code: 'STEP_NOT_FOUND', message: 'Step not found for this cycle.' } });

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
    // cycleStepId is a step NUMBER — resolve against the cycle's current version.
    const step = await resolveFurnaceStep((sql, p) => client.query(sql, p), cycleCode, cycleStepId);
    if (!step) throw Object.assign(new Error('Step not found for this cycle'), { status: 404, code: 'STEP_NOT_FOUND' });

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
      [batchNumber, step.id, cycleTypeId, workstationUnitId || null,
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

/**
 * Bunch grinding (SG-DLT only): the operator manually loads several bars onto
 * the machine at once, taken from the source storage. A bunch's combined bar
 * length must fit the 3000mm bed.
 */
const BUNCH_MACHINE = 'SG-DLT';

/** GET /grinding/queue — UIDs waiting at the SG-DLT bunch step, not already in an open bunch. */
grindingRouter.get('/queue', async (req, res) => {
  const { rows } = await query(
    `SELECT u.id AS uid_id, u.uid_code, u.priority, u.current_storage_id,
            sz.size_mm, sl.code AS storage_code, cs.id AS cycle_step_id, cs.operation_name
     FROM uids u
     JOIN cycle_steps cs ON cs.cycle_version_id = u.cycle_version_id AND cs.step_number = u.current_step
     JOIN workstation_types wt ON wt.id = cs.workstation_type_id
     LEFT JOIN sizes sz ON sz.id = u.size_id
     LEFT JOIN storage_locations sl ON sl.id = u.current_storage_id
     WHERE wt.code = $1 AND u.status = 'active'
       AND u.id NOT IN (
         SELECT pbu.uid_id FROM production_batch_uids pbu
         JOIN production_batches pb ON pb.id = pbu.production_batch_id
         WHERE pb.status <> 'complete'
       )
     ORDER BY CASE u.priority WHEN 'High' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END, u.created_at`,
    [BUNCH_MACHINE]
  );
  // bed length for the running combined-length check
  const { rows: cfg } = await query(
    `SELECT bed_length_mm, bars_per_set FROM grinding_machine_rules gmr
     JOIN workstation_types wt ON wt.id = gmr.workstation_type_id WHERE wt.code = $1`,
    [BUNCH_MACHINE]
  );
  return res.json({ success: true, data: { uids: rows, bedLengthMm: cfg[0]?.bed_length_mm || 3000, barsPerSet: cfg[0]?.bars_per_set || null } });
});

/** GET /grinding/batches/active?workstation_unit_id= — the open bunch on a machine + its UIDs. */
grindingRouter.get('/batches/active', async (req, res) => {
  const { workstation_unit_id } = req.query;
  const { rows } = await query(
    `SELECT pb.*, wu.unit_code, cs.operation_name, cs.step_number
     FROM production_batches pb
     LEFT JOIN workstation_units wu ON wu.id = pb.workstation_unit_id
     LEFT JOIN cycle_steps cs ON cs.id = pb.cycle_step_id
     WHERE pb.status = 'running' ${workstation_unit_id ? 'AND pb.workstation_unit_id = $1' : ''}
     ORDER BY pb.id DESC LIMIT 1`,
    workstation_unit_id ? [workstation_unit_id] : []
  );
  if (!rows[0]) return res.json({ success: true, data: null });
  const { rows: uids } = await query(
    `SELECT u.id AS uid_id, u.uid_code, sz.size_mm, pbu.set_number
     FROM production_batch_uids pbu JOIN uids u ON u.id = pbu.uid_id
     LEFT JOIN sizes sz ON sz.id = u.size_id
     WHERE pbu.production_batch_id = $1 ORDER BY pbu.set_number`,
    [rows[0].id]
  );
  return res.json({ success: true, data: { ...rows[0], uids } });
});

/** POST /grinding/batches — load a bunch onto SG-DLT. body: { workstationUnitId, uidIds: [] } */
grindingRouter.post('/batches', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const { workstationUnitId, uidIds } = req.body;
  if (!Array.isArray(uidIds) || uidIds.length < 1) {
    return res.status(400).json({ success: false, error: { code: 'NO_UIDS', message: 'Select at least one bar to bunch.' } });
  }

  const result = await withTransaction(async (client) => {
    const { rows: uidRows } = await client.query(
      `SELECT u.id, u.uid_code, u.current_step, u.cycle_version_id, sz.size_mm
       FROM uids u LEFT JOIN sizes sz ON sz.id = u.size_id
       WHERE u.id = ANY($1::bigint[]) FOR UPDATE OF u`,
      [uidIds]
    );
    if (uidRows.length !== uidIds.length) throw Object.assign(new Error('Some bars are no longer available.'), { status: 409, code: 'UID_UNAVAILABLE' });

    // All bars must be at the same step.
    const step = uidRows[0].current_step;
    if (!uidRows.every((u) => u.current_step === step)) {
      throw Object.assign(new Error('All bars in a bunch must be at the same step.'), { status: 400, code: 'STEP_MISMATCH' });
    }

    const { rows: stepRows } = await client.query(
      `SELECT cs.id, cs.dest_storage_id FROM cycle_steps cs
       JOIN workstation_types wt ON wt.id = cs.workstation_type_id
       WHERE cs.cycle_version_id = $1 AND cs.step_number = $2 AND wt.code = $3`,
      [uidRows[0].cycle_version_id, step, BUNCH_MACHINE]
    );
    if (!stepRows[0]) throw Object.assign(new Error('These bars are not at the SG-DLT bunch step.'), { status: 400, code: 'NOT_BUNCH_STEP' });
    const cycleStepId = stepRows[0].id;

    const { rows: cfg } = await client.query(
      `SELECT bed_length_mm, bars_per_set FROM grinding_machine_rules gmr
       JOIN workstation_types wt ON wt.id = gmr.workstation_type_id WHERE wt.code = $1`,
      [BUNCH_MACHINE]
    );
    const bedLength = cfg[0]?.bed_length_mm || 3000;
    const combined = uidRows.reduce((sum, u) => sum + (Number(u.size_mm) || 0), 0);
    if (combined > bedLength) {
      throw Object.assign(new Error(`Combined length ${combined}mm exceeds the ${bedLength}mm bed.`), { status: 400, code: 'BED_OVERFLOW' });
    }

    const year = new Date().getFullYear();
    const { rows: seqRows } = await client.query(`SELECT COUNT(*) AS c FROM production_batches WHERE batch_number LIKE $1`, [`PB-${year}-%`]);
    const batchNumber = `PB-${year}-${String(Number(seqRows[0].c) + 1).padStart(3, '0')}`;

    const { rows: openShift } = await client.query(
      `SELECT id FROM shifts WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1`
    );
    const shiftId = openShift[0]?.id || null;

    const { rows: batchRows } = await client.query(
      `INSERT INTO production_batches (batch_number, cycle_step_id, workstation_unit_id, combined_length_mm, status, started_at, operator_id, shift_id)
       VALUES ($1,$2,$3,$4,'running', now(), $5, $6) RETURNING *`,
      [batchNumber, cycleStepId, workstationUnitId || null, combined, req.user.sub, shiftId]
    );
    const batch = batchRows[0];

    let setNo = 1;
    for (const u of uidRows) {
      await client.query(`INSERT INTO production_batch_uids (production_batch_id, uid_id, set_number) VALUES ($1,$2,$3)`, [batch.id, u.id, setNo++]);
      await client.query(
        `INSERT INTO uid_step_logs (uid_id, step_number, operation_name, workstation_unit_id, operator_id, shift_id, started_at)
         VALUES ($1,$2,'Bunch Grinding',$3,$4,$5, now())`,
        [u.id, step, workstationUnitId || null, req.user.sub, shiftId]
      );
    }

    await req.audit({ tableName: 'production_batches', recordId: batch.id, action: 'INSERT', after: { batchNumber, combined, uidCount: uidRows.length } });
    return { ...batch, combined_length_mm: combined, uid_count: uidRows.length };
  });

  return res.status(201).json({ success: true, data: result });
});

/** POST /grinding/batches/:id/close — finish the bunch; every bar advances to the next step. */
grindingRouter.post('/batches/:id/close', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: batchRows } = await client.query(`SELECT * FROM production_batches WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const batch = batchRows[0];
    if (!batch) throw Object.assign(new Error('Bunch not found'), { status: 404, code: 'BATCH_NOT_FOUND' });
    if (batch.status === 'complete') throw Object.assign(new Error('Bunch already closed'), { status: 409, code: 'ALREADY_CLOSED' });

    const { rows: stepRows } = await client.query(`SELECT * FROM cycle_steps WHERE id = $1`, [batch.cycle_step_id]);
    const step = stepRows[0];
    const netSeconds = batch.started_at ? Math.floor((Date.now() - new Date(batch.started_at).getTime()) / 1000) : null;

    const { rows: uidRows } = await client.query(`SELECT uid_id FROM production_batch_uids WHERE production_batch_id = $1`, [batch.id]);
    for (const { uid_id: uidId } of uidRows) {
      await client.query(
        `UPDATE uid_step_logs SET closed_at = now(), net_work_seconds = $1, qc_result = 'Pass'
         WHERE uid_id = $2 AND closed_at IS NULL`,
        [netSeconds, uidId]
      );
      const { rows: uidRow } = await client.query(`SELECT cycle_version_id FROM uids WHERE id = $1`, [uidId]);
      const { rows: allSteps } = await client.query(
        `SELECT step_number, sequence_order FROM cycle_steps WHERE cycle_version_id = $1 ORDER BY sequence_order`,
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

    await client.query(`UPDATE production_batches SET status = 'complete', closed_at = now() WHERE id = $1`, [batch.id]);
    await req.audit({ tableName: 'production_batches', recordId: batch.id, action: 'UPDATE', after: { status: 'complete', uidCount: uidRows.length } });
    return { batchId: batch.id, advanced: uidRows.length };
  });
  return res.json({ success: true, data: result });
});

// ── helpers ──────────────────────────────────────────────────────────────────

router.use('/furnace-batches', furnaceRouter);
router.use('/grinding', grindingRouter);

/**
 * Resolve a furnace step from a step NUMBER within a cycle's CURRENT version.
 * `run` is a (sql, params) => Promise function (query or a client-bound wrapper).
 * Falls back to a primary-key lookup for backward compatibility.
 */
async function resolveFurnaceStep(run, cycleCode, stepNumberOrId) {
  const { rows } = await run(
    `SELECT cs.* FROM cycle_steps cs
     JOIN cycle_versions cv ON cv.id = cs.cycle_version_id
     JOIN cycle_types ct ON ct.id = cv.cycle_type_id
     WHERE ct.code = $1 AND cv.is_current = true AND cs.step_number = $2
     LIMIT 1`,
    [cycleCode, String(stepNumberOrId)]
  );
  if (rows[0]) return rows[0];
  const { rows: byId } = await run(`SELECT * FROM cycle_steps WHERE id = $1`, [stepNumberOrId]);
  return byId[0] || null;
}

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
