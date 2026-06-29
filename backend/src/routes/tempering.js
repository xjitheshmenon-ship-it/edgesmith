import { Router } from 'express';
import { query, one, tx } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireAdmin, requireSupervisor, HttpError } from '../middleware/auth.js';

const router = Router();

const PARAM_SELECT = `
  SELECT p.*, ct.name AS cycle_type_name, cs.step_number, cs.operation_name
  FROM tempering_parameters p
  LEFT JOIN cycle_types ct ON ct.id = p.cycle_type_id
  LEFT JOIN cycle_steps cs ON cs.id = p.cycle_step_id
`;

function paramOut(p) {
  return {
    id: p.id,
    cycle_type_id: p.cycle_type_id,
    cycle_type_name: p.cycle_type_name,
    cycle_step_id: p.cycle_step_id,
    step_number: p.step_number,
    operation_name: p.operation_name,
    target_temp_c: p.target_temp_c,
    target_soak_minutes: p.target_soak_minutes,
    tolerance_temp_c: p.tolerance_temp_c,
    tolerance_soak_minutes: p.tolerance_soak_minutes,
    updated_at: p.updated_at,
  };
}

const BATCH_SELECT = `
  SELECT b.*, ct.name AS cycle_type_name, cs.step_number, cs.operation_name,
    (SELECT COUNT(*)::int FROM furnace_batch_uids fbu WHERE fbu.furnace_batch_id = b.id) AS uid_count
  FROM furnace_batches b
  LEFT JOIN cycle_types ct ON ct.id = b.cycle_type_id
  LEFT JOIN cycle_steps cs ON cs.id = b.cycle_step_id
`;

async function batchOut(b, includeUids = false) {
  const data = {
    id: b.id,
    batch_number: b.batch_number,
    cycle_type_id: b.cycle_type_id,
    cycle_type_name: b.cycle_type_name,
    cycle_step_id: b.cycle_step_id,
    step_number: b.step_number,
    operation_name: b.operation_name,
    target_temp_c: b.target_temp_c,
    target_soak_minutes: b.target_soak_minutes,
    actual_temp_c: b.actual_temp_c,
    actual_soak_minutes: b.actual_soak_minutes,
    actuals_recorded: b.actuals_recorded,
    deviation_flagged: b.deviation_flagged,
    deviation_notes: b.deviation_notes,
    started_at: b.started_at,
    ended_at: b.ended_at,
    uid_count: b.uid_count,
    created_at: b.created_at,
  };
  if (includeUids) {
    const rows = await query(
      `SELECT fbu.uid_id, u.code AS uid_code FROM furnace_batch_uids fbu
         LEFT JOIN uids u ON u.id = fbu.uid_id WHERE fbu.furnace_batch_id = $1`,
      [b.id]
    );
    data.uids = rows.map((r) => ({ uid_id: r.uid_id, uid_code: r.uid_code }));
  }
  return data;
}

// ── Parameters (Admin) ─────────────────────────────────────────────────────
router.get(
  '/parameters',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctId = req.query.cycle_type_id ? parseInt(req.query.cycle_type_id, 10) : null;
    const rows = ctId
      ? await query(`${PARAM_SELECT} WHERE p.cycle_type_id = $1 ORDER BY p.id`, [ctId])
      : await query(`${PARAM_SELECT} ORDER BY p.id`);
    res.json(rows.map(paramOut));
  })
);

router.post(
  '/parameters',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const id = await tx(async (c) => {
      const existing = await c.one(
        'SELECT id FROM tempering_parameters WHERE cycle_type_id = $1 AND cycle_step_id = $2',
        [b.cycle_type_id, b.cycle_step_id]
      );
      let paramId;
      if (existing) {
        await c.query(
          `UPDATE tempering_parameters SET target_temp_c=$1, target_soak_minutes=$2,
             tolerance_temp_c=$3, tolerance_soak_minutes=$4, updated_at=now(), updated_by_id=$5
           WHERE id=$6`,
          [b.target_temp_c, b.target_soak_minutes, b.tolerance_temp_c ?? 5, b.tolerance_soak_minutes ?? 5, req.user.id, existing.id]
        );
        paramId = existing.id;
      } else {
        const p = await c.one(
          `INSERT INTO tempering_parameters
             (cycle_type_id, cycle_step_id, target_temp_c, target_soak_minutes, tolerance_temp_c, tolerance_soak_minutes, updated_by_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [b.cycle_type_id, b.cycle_step_id, b.target_temp_c, b.target_soak_minutes, b.tolerance_temp_c ?? 5, b.tolerance_soak_minutes ?? 5, req.user.id]
        );
        paramId = p.id;
      }
      // Snapshot the new values into the version history (timestamp + changed-by).
      await c.query(
        `INSERT INTO tempering_parameter_versions
           (parameter_id, cycle_type_id, cycle_step_id, target_temp_c, target_soak_minutes,
            tolerance_temp_c, tolerance_soak_minutes, changed_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [paramId, b.cycle_type_id, b.cycle_step_id, b.target_temp_c, b.target_soak_minutes, b.tolerance_temp_c ?? 5, b.tolerance_soak_minutes ?? 5, req.user.id]
      );
      return paramId;
    });
    const row = await one(`${PARAM_SELECT} WHERE p.id = $1`, [id]);
    res.status(201).json(paramOut(row));
  })
);

router.get(
  '/parameters/:id/versions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const paramId = parseInt(req.params.id, 10);
    const rows = await query(
      `SELECT v.*, u.full_name AS changed_by_name
         FROM tempering_parameter_versions v
         LEFT JOIN users u ON u.id = v.changed_by_id
        WHERE v.parameter_id = $1
        ORDER BY v.changed_at DESC, v.id DESC`,
      [paramId]
    );
    res.json(
      rows.map((v) => ({
        id: v.id,
        parameter_id: v.parameter_id,
        cycle_type_id: v.cycle_type_id,
        cycle_step_id: v.cycle_step_id,
        target_temp_c: v.target_temp_c,
        target_soak_minutes: v.target_soak_minutes,
        tolerance_temp_c: v.tolerance_temp_c,
        tolerance_soak_minutes: v.tolerance_soak_minutes,
        changed_by_id: v.changed_by_id,
        changed_by_name: v.changed_by_name,
        changed_at: v.changed_at,
      }))
    );
  })
);

// ── Furnace batches ────────────────────────────────────────────────────────
router.get(
  '/available-uids',
  requireAuth,
  asyncHandler(async (req, res) => {
    const cycleStepId = parseInt(req.query.cycle_step_id, 10);
    const rows = await query(
      `SELECT u.id, u.code, u.status, sl.code AS current_storage_code
         FROM uids u LEFT JOIN storage_locations sl ON sl.id = u.current_storage_id
        WHERE u.current_step_id = $1 AND u.status IN ('active','on_hold')
        ORDER BY u.created_at`,
      [cycleStepId]
    );
    res.json(rows.map((u) => ({ id: u.id, code: u.code, status: u.status, current_storage_code: u.current_storage_code })));
  })
);

router.get(
  '/batches',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctId = req.query.cycle_type_id ? parseInt(req.query.cycle_type_id, 10) : null;
    const rows = ctId
      ? await query(`${BATCH_SELECT} WHERE b.cycle_type_id = $1 ORDER BY b.created_at DESC LIMIT 100`, [ctId])
      : await query(`${BATCH_SELECT} ORDER BY b.created_at DESC LIMIT 100`);
    res.json(await Promise.all(rows.map((b) => batchOut(b))));
  })
);

router.get(
  '/batches/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const b = await one(`${BATCH_SELECT} WHERE b.id = $1`, [parseInt(req.params.id, 10)]);
    if (!b) throw new HttpError(404, 'Batch not found');
    res.json(await batchOut(b, true));
  })
);

router.post(
  '/batches',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const batchId = await tx(async (c) => {
      let uids;
      if (b.uid_ids && b.uid_ids.length) {
        uids = await c.query(
          `SELECT id FROM uids WHERE id = ANY($1) AND current_step_id = $2 AND status IN ('active','on_hold')`,
          [b.uid_ids, b.cycle_step_id]
        );
      } else {
        const lim = b.intake_count != null ? ' LIMIT ' + parseInt(b.intake_count, 10) : '';
        uids = await c.query(
          `SELECT id FROM uids WHERE current_step_id = $1 AND status IN ('active','on_hold') ORDER BY created_at${lim}`,
          [b.cycle_step_id]
        );
      }
      if (!uids.length) throw new HttpError(400, 'No UIDs available at this tempering step');

      const param = await c.one(
        'SELECT * FROM tempering_parameters WHERE cycle_type_id = $1 AND cycle_step_id = $2',
        [b.cycle_type_id, b.cycle_step_id]
      );

      const countRow = await c.one('SELECT COUNT(*)::int AS n FROM furnace_batches');
      const yearRow = await c.one("SELECT to_char(now(), 'YYYY') AS y");
      const batchNumber = `HT90-${yearRow.y}-${String(countRow.n + 1).padStart(3, '0')}`;

      const batch = await c.one(
        `INSERT INTO furnace_batches
           (batch_number, cycle_type_id, cycle_step_id, tempering_parameter_id, target_temp_c, target_soak_minutes, started_at, created_by_id)
         VALUES ($1,$2,$3,$4,$5,$6, now(), $7) RETURNING id`,
        [
          batchNumber,
          b.cycle_type_id,
          b.cycle_step_id,
          param ? param.id : null,
          param ? param.target_temp_c : null,
          param ? param.target_soak_minutes : null,
          req.user.id,
        ]
      );
      for (const u of uids) {
        await c.query('INSERT INTO furnace_batch_uids (furnace_batch_id, uid_id) VALUES ($1,$2)', [batch.id, u.id]);
      }
      return batch.id;
    });
    const row = await one(`${BATCH_SELECT} WHERE b.id = $1`, [batchId]);
    res.status(201).json(await batchOut(row, true));
  })
);

router.post(
  '/batches/:id/complete',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    const b = await one('SELECT * FROM furnace_batches WHERE id = $1', [id]);
    if (!b) throw new HttpError(404, 'Batch not found');
    if (b.ended_at) throw new HttpError(400, 'Batch already completed');

    let deviationFlagged = false;
    let deviationNotes = body.notes || null;
    let actualsRecorded = false;

    if (body.actual_temp_c != null || body.actual_soak_minutes != null) {
      actualsRecorded = true;
      const flags = [];
      const param = b.tempering_parameter_id
        ? await one('SELECT * FROM tempering_parameters WHERE id = $1', [b.tempering_parameter_id])
        : null;
      const tolT = param ? param.tolerance_temp_c : 5;
      const tolS = param ? param.tolerance_soak_minutes : 5;
      if (b.target_temp_c != null && body.actual_temp_c != null && Math.abs(body.actual_temp_c - b.target_temp_c) > tolT) {
        flags.push(`Temp deviation: target ${b.target_temp_c}°C, actual ${body.actual_temp_c}°C`);
      }
      if (b.target_soak_minutes != null && body.actual_soak_minutes != null && Math.abs(body.actual_soak_minutes - b.target_soak_minutes) > tolS) {
        flags.push(`Soak deviation: target ${b.target_soak_minutes}min, actual ${body.actual_soak_minutes}min`);
      }
      if (flags.length) {
        deviationFlagged = true;
        deviationNotes = flags.join('; ');
      }
    }

    await query(
      `UPDATE furnace_batches SET ended_at = now(), operator_id = $1, actual_temp_c = $2, actual_soak_minutes = $3,
         actuals_recorded = $4, deviation_flagged = $5, deviation_notes = $6 WHERE id = $7`,
      [req.user.id, body.actual_temp_c ?? null, body.actual_soak_minutes ?? null, actualsRecorded, deviationFlagged, deviationNotes, id]
    );
    const row = await one(`${BATCH_SELECT} WHERE b.id = $1`, [id]);
    res.json(await batchOut(row, true));
  })
);

export default router;
