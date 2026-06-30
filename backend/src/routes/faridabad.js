const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');
const { calculateMsBalance } = require('../utils/msBalance');

const router = express.Router();
router.use(authenticate, auditContext);

/**
 * GET /api/v1/faridabad/intakes
 */
router.get('/intakes', async (req, res) => {
  const { material_type } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;
  if (material_type) { conditions.push(`ri.material_type = $${p++}`); params.push(material_type); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT ri.*, s.name AS supplier_name, ct.code AS cycle_code
     FROM raw_material_intakes ri
     JOIN suppliers s ON s.id = ri.supplier_id
     LEFT JOIN cycle_types ct ON ct.id = ri.cycle_type_id
     ${where} ORDER BY ri.created_at DESC`,
    params
  );
  return res.json({ success: true, data: rows });
});

/**
 * POST /api/v1/faridabad/intakes
 * For alloy_steel: grade determines cycle_type_id via alloy_grade_cycle_map (auto-derived, read-only on frontend).
 * body: { materialType, supplierId, heatNumber, grade?, weightKg, barCount, dimensionsMm, dateReceived, poReference?, notes? }
 */
router.post('/intakes', requireRole(['admin', 'manager']), async (req, res) => {
  const { materialType, supplierId, heatNumber, grade, weightKg, barCount, dimensionsMm, dateReceived, poReference, notes } = req.body;

  if (!materialType || !supplierId || !heatNumber || !weightKg || !barCount || !dateReceived) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'materialType, supplierId, heatNumber, weightKg, barCount, dateReceived are required.' } });
  }

  let cycleTypeId = null;
  if (materialType === 'alloy_steel' && grade) {
    const { rows: mapRows } = await query(
      `SELECT ct.id FROM alloy_grade_cycle_map m JOIN cycle_types ct ON ct.code = m.cycle_type_code
       WHERE m.alloy_grade = $1 AND m.status = 'active'`,
      [grade]
    );
    cycleTypeId = mapRows[0] ? mapRows[0].id : null;
  }

  const { rows } = await query(
    `INSERT INTO raw_material_intakes
       (material_type, supplier_id, heat_number, grade, cycle_type_id, weight_kg, bar_count, dimensions_mm, date_received, po_reference, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [materialType, supplierId, heatNumber, grade || null, cycleTypeId, weightKg, barCount, dimensionsMm || null, dateReceived, poReference || null, notes || null, req.user.sub]
  );

  await req.audit({ tableName: 'raw_material_intakes', recordId: rows[0].id, action: 'INSERT', after: rows[0] });
  return res.status(201).json({ success: true, data: rows[0] });
});

/**
 * GET /api/v1/faridabad/weld-tally
 * Read-only running tally per cycle type since the last dispatch — feeds
 * the Joining Operation page. Individual blocks are never exposed —
 * rolling erases identity downstream, so only the count matters.
 */
router.get('/weld-tally', async (req, res) => {
  const { rows } = await query(
    `SELECT ct.code AS cycle_code,
            COUNT(*) FILTER (WHERE wl.dispatched = false) AS accumulated,
            array_agg(DISTINCT ri.heat_number) FILTER (WHERE wl.dispatched = false AND ri.material_type = 'alloy_steel') AS alloy_heats
     FROM cycle_types ct
     LEFT JOIN faridabad_weld_log wl ON wl.cycle_type_id = ct.id
     LEFT JOIN raw_material_intakes ri ON ri.id = wl.alloy_intake_id
     GROUP BY ct.code`
  );
  return res.json({ success: true, data: rows });
});

/**
 * POST /api/v1/faridabad/weld
 * Creates one weld_log row (no individual block tracking retained — this
 * just feeds the tally and is the record a My Workstation "Close — Log Weld"
 * action writes to). Typically called by jobs.js close handler, but exposed
 * directly too for flexibility / testing.
 */
router.post('/weld', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const { cycleCode, alloyIntakeId, msIntakeId, workstationUnitId, sizeMm } = req.body;
  const { rows: cycleRows } = await query(`SELECT id FROM cycle_types WHERE code = $1`, [cycleCode]);
  if (!cycleRows[0]) return res.status(400).json({ success: false, error: { code: 'UNKNOWN_CYCLE', message: 'Unknown cycle type.' } });

  const { rows } = await query(
    `INSERT INTO faridabad_weld_log (cycle_type_id, alloy_intake_id, ms_intake_id, operator_id, workstation_unit_id, size_mm, started_at)
     VALUES ($1,$2,$3,$4,$5,$6, now()) RETURNING *`,
    [cycleRows[0].id, alloyIntakeId || null, msIntakeId || null, req.user.sub, workstationUnitId || null, sizeMm || null]
  );
  return res.status(201).json({ success: true, data: rows[0] });
});

/**
 * GET /api/v1/faridabad/dispatches
 */
router.get('/dispatches', async (req, res) => {
  const { rows } = await query(
    `SELECT cd.*, ct.code AS cycle_code, cc.name AS color_name, cc.hex_swatch, cont.name AS contractor_name
     FROM contractor_dispatches cd
     JOIN cycle_types ct ON ct.id = cd.cycle_type_id
     JOIN color_codes cc ON cc.id = cd.color_code_id
     JOIN contractors cont ON cont.id = cd.contractor_id
     ORDER BY cd.created_at DESC`
  );
  return res.json({ success: true, data: rows });
});

/**
 * POST /api/v1/faridabad/dispatches
 * Creates the dispatch batch — THIS is the point individual welds become a
 * batch (per the corrected Faridabad model). Color code auto-picked unless
 * overridden. Possible heat numbers pulled from all undispatched intakes
 * for this cycle type (honest "possible", not exact per block).
 * body: { cycleCode, blockCount, contractorId, colorCodeId?, dateDispatched, expectedDeliveryDate?, challanReference? }
 */
router.post('/dispatches', requireRole(['admin', 'manager']), async (req, res) => {
  const { cycleCode, blockCount, contractorId, colorCodeId, dateDispatched, expectedDeliveryDate, challanReference } = req.body;

  if (!cycleCode || !blockCount || !contractorId || !dateDispatched) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'cycleCode, blockCount, contractorId, dateDispatched are required.' } });
  }

  const result = await withTransaction(async (client) => {
    const { rows: cycleRows } = await client.query(`SELECT id FROM cycle_types WHERE code = $1`, [cycleCode]);
    if (!cycleRows[0]) throw Object.assign(new Error('Unknown cycle'), { status: 400, code: 'UNKNOWN_CYCLE' });
    const cycleTypeId = cycleRows[0].id;

    // Check available tally
    const { rows: tallyRows } = await client.query(
      `SELECT COUNT(*) AS c FROM faridabad_weld_log WHERE cycle_type_id = $1 AND dispatched = false`,
      [cycleTypeId]
    );
    const available = Number(tallyRows[0].c);
    if (blockCount > available) {
      throw Object.assign(new Error('Not enough blocks accumulated'), {
        status: 409, code: 'INSUFFICIENT_TALLY', meta: { available, requested: blockCount },
      });
    }

    // Truck capacity check (informational, not a hard block — partial dispatch allowed)
    const { rows: capRows } = await client.query(
      `SELECT max_blocks FROM truck_capacity WHERE (contractor_id = $1 OR contractor_id IS NULL) AND status = 'active' ORDER BY contractor_id NULLS LAST LIMIT 1`,
      [contractorId]
    );
    const maxBlocks = capRows[0] ? capRows[0].max_blocks : null;

    // Auto-pick color code if not provided
    let finalColorCodeId = colorCodeId;
    if (!finalColorCodeId) {
      const { rows: lastUsed } = await client.query(
        `SELECT color_code_id FROM contractor_dispatches ORDER BY id DESC LIMIT 1`
      );
      const { rows: allColors } = await client.query(`SELECT id FROM color_codes WHERE status = 'active' ORDER BY id`);
      if (!allColors.length) throw Object.assign(new Error('No color codes configured'), { status: 409, code: 'NO_COLORS' });
      if (!lastUsed[0]) {
        finalColorCodeId = allColors[0].id;
      } else {
        const idx = allColors.findIndex((c) => c.id === lastUsed[0].color_code_id);
        finalColorCodeId = allColors[(idx + 1) % allColors.length].id;
      }
    }

    // Possible heat numbers — honest list, not exact-per-block
    const { rows: heatRows } = await client.query(
      `SELECT DISTINCT ri.heat_number, ri.material_type FROM faridabad_weld_log wl
       JOIN raw_material_intakes ri ON ri.id = wl.alloy_intake_id OR ri.id = wl.ms_intake_id
       WHERE wl.cycle_type_id = $1 AND wl.dispatched = false`,
      [cycleTypeId]
    );
    const possibleAlloyHeats = heatRows.filter((h) => h.material_type === 'alloy_steel').map((h) => h.heat_number);
    const possibleMsHeats = heatRows.filter((h) => h.material_type === 'ms').map((h) => h.heat_number);

    const year = new Date().getFullYear();
    const { rows: seqRows } = await client.query(`SELECT COUNT(*) AS c FROM contractor_dispatches WHERE batch_reference LIKE $1`, [`FAR-DISP-${year}-%`]);
    const seq = Number(seqRows[0].c) + 1;
    const batchReference = `FAR-DISP-${year}-${String(seq).padStart(3, '0')}`;

    const { rows: dispatchRows } = await client.query(
      `INSERT INTO contractor_dispatches
         (batch_reference, cycle_type_id, color_code_id, block_count, contractor_id,
          possible_alloy_heats, possible_ms_heats, date_dispatched, expected_delivery_date, challan_reference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [batchReference, cycleTypeId, finalColorCodeId, blockCount, contractorId,
        possibleAlloyHeats, possibleMsHeats, dateDispatched, expectedDeliveryDate || null, challanReference || null, req.user.sub]
    );
    const dispatch = dispatchRows[0];

    // Mark `blockCount` weld log rows as dispatched (oldest first)
    const { rows: toMark } = await client.query(
      `SELECT id FROM faridabad_weld_log WHERE cycle_type_id = $1 AND dispatched = false ORDER BY created_at ASC LIMIT $2`,
      [cycleTypeId, blockCount]
    );
    for (const r of toMark) {
      await client.query(`UPDATE faridabad_weld_log SET dispatched = true, dispatch_batch_id = $1 WHERE id = $2`, [dispatch.id, r.id]);
    }

    return { dispatch, truckCapacityNote: maxBlocks ? `${blockCount} / ${maxBlocks} truck capacity` : null };
  });

  await req.audit({ tableName: 'contractor_dispatches', recordId: result.dispatch.id, action: 'INSERT', after: result.dispatch });
  return res.status(201).json({ success: true, data: result });
});

// ── Batch Management — two-leg dispatch journey ──────────────────────────────

const ROLLING_ALERT_DAYS = 15;

/**
 * GET /faridabad/batches — every dispatch batch with its derived two-leg status:
 *   Dispatched to Rolling/At Rolling → Dispatched to Dharmapuri → Received.
 * Receipt is read live from Dharmapuri's receiving events (no duplicate entry).
 */
router.get('/batches', async (req, res) => {
  const { rows } = await query(
    `SELECT cd.id, cd.batch_reference, cd.block_count, cd.date_dispatched, cd.expected_delivery_date,
            cd.possible_alloy_heats, cd.possible_ms_heats,
            ct.code AS cycle_code, cc.name AS color_name, cc.hex_swatch, cont.name AS contractor_name,
            l2.dispatched_date AS onward_date, l2.notes AS onward_notes,
            (SELECT COUNT(*) FROM receiving_events re WHERE re.dispatch_batch_id = cd.id) AS receiving_count,
            (SELECT min(re.date_received) FROM receiving_events re WHERE re.dispatch_batch_id = cd.id) AS date_received
     FROM contractor_dispatches cd
     JOIN cycle_types ct ON ct.id = cd.cycle_type_id
     JOIN color_codes cc ON cc.id = cd.color_code_id
     JOIN contractors cont ON cont.id = cd.contractor_id
     LEFT JOIN batch_dispatch_legs l2 ON l2.dispatch_batch_id = cd.id AND l2.leg = 2
     ORDER BY cd.created_at DESC`
  );

  const today = new Date();
  const daysBetween = (a, b) => Math.max(0, Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000));

  const data = rows.map((b) => {
    const received = Number(b.receiving_count) > 0;
    const dispatchedOnward = !!b.onward_date;
    let status;
    if (received) status = 'Received at Dharmapuri';
    else if (dispatchedOnward) status = 'Dispatched to Dharmapuri';
    else status = 'At Rolling';
    // Days at rolling: from leg-1 dispatch until it left rolling (onward/received) or now.
    const endRef = received ? b.date_received : dispatchedOnward ? b.onward_date : today;
    const daysAtRolling = b.date_dispatched ? daysBetween(b.date_dispatched, endRef) : 0;
    const rollingOverdue = status === 'At Rolling' && daysAtRolling > ROLLING_ALERT_DAYS;
    return { ...b, status, days_at_rolling: daysAtRolling, rolling_overdue: rollingOverdue, rolling_alert_days: ROLLING_ALERT_DAYS };
  });

  return res.json({ success: true, data });
});

/**
 * POST /faridabad/batches/:id/dispatch-onward — Step 10: the rolling contractor
 * ships the block onward to Dharmapuri (it never returns to Faridabad).
 * body: { dispatchedDate, notes? }
 */
router.post('/batches/:id/dispatch-onward', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { dispatchedDate, notes } = req.body || {};
  if (!dispatchedDate) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_DATE', message: 'dispatchedDate is required.' } });
  }
  const { rows: cd } = await query(`SELECT id FROM contractor_dispatches WHERE id = $1`, [req.params.id]);
  if (!cd[0]) return res.status(404).json({ success: false, error: { code: 'BATCH_NOT_FOUND', message: 'Batch not found.' } });

  const { rows } = await query(
    `INSERT INTO batch_dispatch_legs (dispatch_batch_id, leg, dispatched_date, notes, created_by)
     VALUES ($1, 2, $2, $3, $4)
     ON CONFLICT (dispatch_batch_id, leg) DO UPDATE SET dispatched_date = EXCLUDED.dispatched_date, notes = EXCLUDED.notes
     RETURNING *`,
    [req.params.id, dispatchedDate, notes || null, req.user.sub]
  );
  await req.audit({ tableName: 'batch_dispatch_legs', recordId: rows[0].id, action: 'INSERT', after: rows[0] });
  return res.status(201).json({ success: true, data: rows[0] });
});

// ── MS sheet cutting balance (calculated, never measured) ────────────────────

/** POST /faridabad/ms-cutting/calculate — preview the balance for a cut run. */
router.post('/ms-cutting/calculate', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const { sheet, pieces } = req.body || {};
  if (!sheet || !Array.isArray(pieces) || !pieces.length) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'sheet dimensions and at least one piece spec are required.' } });
  }
  try {
    const result = calculateMsBalance(sheet, pieces);
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(400).json({ success: false, error: { code: 'CALC_ERROR', message: e.message } });
  }
});

/** POST /faridabad/ms-cutting/runs — record a cut run with its calculated balance. */
router.post('/ms-cutting/runs', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const { sheet, pieces, msIntakeId } = req.body || {};
  if (!sheet || !Array.isArray(pieces) || !pieces.length) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'sheet dimensions and piece specs are required.' } });
  }
  let balance;
  try {
    balance = calculateMsBalance(sheet, pieces);
  } catch (e) {
    return res.status(400).json({ success: false, error: { code: 'CALC_ERROR', message: e.message } });
  }
  const { rows } = await query(
    `INSERT INTO ms_sheet_cutting_runs
       (ms_intake_id, sheet_length_mm, sheet_width_mm, sheet_height_mm, pieces, strips, total_balance_weight_kg, operator_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [msIntakeId || null, sheet.length_mm, sheet.width_mm, sheet.height_mm,
      JSON.stringify(pieces), JSON.stringify(balance.strips), balance.totalBalanceWeightKg, req.user.sub]
  );
  await req.audit({ tableName: 'ms_sheet_cutting_runs', recordId: rows[0].id, action: 'INSERT', after: rows[0] });
  return res.status(201).json({ success: true, data: { ...rows[0], balance } });
});

/** GET /faridabad/ms-cutting/runs — recent cut runs with balance weights. */
router.get('/ms-cutting/runs', async (req, res) => {
  const { rows } = await query(
    `SELECT r.*, e.full_name AS operator_name FROM ms_sheet_cutting_runs r
     LEFT JOIN employees e ON e.id = r.operator_id ORDER BY r.id DESC LIMIT 200`
  );
  return res.json({ success: true, data: rows });
});

module.exports = router;
