const { query, withTransaction } = require('../config/database');
const { calculateScrap } = require('../utils/scrapCalculator');
const { previewUids, generateUids } = require('../utils/uidGenerator');
const { canViewFurnaceDetail, redactFurnaceFields } = require('../utils/skillGate');

const LOCATION_CODE_TO_ID = { dharmapuri: 1, faridabad: 2 };

/**
 * GET /api/v1/uids
 * Filters: status, step, storage, cycle, priority, location (admin/manager only), search, page, per_page
 */
async function listUids(req, res) {
  const { status, step, storage, cycle, priority, search } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = Math.min(200, Math.max(1, parseInt(req.query.per_page) || 50));
  const offset = (page - 1) * perPage;

  const conditions = [];
  const params = [];
  let p = 1;

  // Location scoping — non-admin/manager roles are pinned server-side
  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    conditions.push(`l.id = (SELECT location_id FROM cycle_types ct WHERE ct.id = cv.cycle_type_id)`);
  }

  if (status) { conditions.push(`u.status = $${p++}`); params.push(status); }
  if (step) { conditions.push(`u.current_step = $${p++}`); params.push(step); }
  if (storage) { conditions.push(`sl.code = $${p++}`); params.push(storage); }
  if (priority) { conditions.push(`u.priority = $${p++}`); params.push(priority); }
  if (cycle) { conditions.push(`ct.code = $${p++}`); params.push(cycle); }
  if (search) {
    conditions.push(`(u.uid_code ILIKE $${p} OR mo.mo_number ILIKE $${p} OR d.code ILIKE $${p})`);
    params.push(`%${search}%`);
    p++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT u.id, u.uid_code, u.parent_uid_id, u.current_step, u.priority, u.status,
           u.hold_reason, u.created_at,
           ct.code AS cycle_code, sl.code AS storage_code,
           sz.size_mm, d.code AS design_code, mo.mo_number
    FROM uids u
    JOIN cycle_versions cv ON cv.id = u.cycle_version_id
    JOIN cycle_types ct ON ct.id = cv.cycle_type_id
    LEFT JOIN storage_locations sl ON sl.id = u.current_storage_id
    LEFT JOIN sizes sz ON sz.id = u.size_id
    LEFT JOIN designs d ON d.id = u.design_id
    LEFT JOIN manufacturing_orders mo ON mo.id = u.mo_id
    ${where}
    ORDER BY
      CASE u.priority WHEN 'High' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END,
      u.created_at ASC
    LIMIT $${p} OFFSET $${p + 1}`;
  params.push(perPage, offset);

  const { rows } = await query(sql, params);
  const countResult = await query(
    `SELECT COUNT(*) FROM uids u
     JOIN cycle_versions cv ON cv.id = u.cycle_version_id
     JOIN cycle_types ct ON ct.id = cv.cycle_type_id
     LEFT JOIN storage_locations sl ON sl.id = u.current_storage_id
     LEFT JOIN designs d ON d.id = u.design_id
     LEFT JOIN manufacturing_orders mo ON mo.id = u.mo_id
     ${where}`,
    params.slice(0, params.length - 2)
  );

  return res.json({
    success: true,
    data: rows,
    meta: { total: Number(countResult.rows[0].count), page, per_page: perPage },
  });
}

/**
 * GET /api/v1/uids/:code
 * Full detail including step history, lineage, material origin.
 */
async function getUidDetail(req, res) {
  const { code } = req.params;
  const { rows } = await query(
    `SELECT u.*, ct.code AS cycle_code, sl.code AS storage_code,
            sz.size_mm, d.code AS design_code, mo.mo_number, p.uid_code AS parent_uid_code,
            re.receiving_reference, cd.batch_reference AS dispatch_batch_reference,
            cd.possible_alloy_heats, cd.possible_ms_heats, cd.color_code_id,
            cc.name AS color_name, cont.name AS contractor_name
     FROM uids u
     JOIN cycle_versions cv ON cv.id = u.cycle_version_id
     JOIN cycle_types ct ON ct.id = cv.cycle_type_id
     LEFT JOIN storage_locations sl ON sl.id = u.current_storage_id
     LEFT JOIN sizes sz ON sz.id = u.size_id
     LEFT JOIN designs d ON d.id = u.design_id
     LEFT JOIN manufacturing_orders mo ON mo.id = u.mo_id
     LEFT JOIN uids p ON p.id = u.parent_uid_id
     LEFT JOIN receiving_events re ON re.id = u.receiving_event_id
     LEFT JOIN contractor_dispatches cd ON cd.id = u.dispatch_batch_id
     LEFT JOIN color_codes cc ON cc.id = cd.color_code_id
     LEFT JOIN contractors cont ON cont.id = cd.contractor_id
     WHERE u.uid_code = $1`,
    [code]
  );

  if (!rows[0]) {
    return res.status(404).json({ success: false, error: { code: 'UID_NOT_FOUND', message: `UID ${code} not found.` } });
  }
  const uid = rows[0];

  const stepLogs = await query(
    `SELECT sl.*, wu.unit_code, e.full_name AS operator_name,
            fb.batch_number AS furnace_batch_number, fb.target_temp_c, fb.target_soak_min,
            fb.actual_temp_c, fb.actual_soak_min, fb.deviation_flag
     FROM uid_step_logs sl
     LEFT JOIN workstation_units wu ON wu.id = sl.workstation_unit_id
     LEFT JOIN employees e ON e.id = sl.operator_id
     LEFT JOIN furnace_batches fb ON fb.id = sl.furnace_batch_id
     WHERE sl.uid_id = $1
     ORDER BY sl.closed_at ASC NULLS LAST, sl.id ASC`,
    [uid.id]
  );

  const children = await query(`SELECT uid_code, status FROM uids WHERE parent_uid_id = $1`, [uid.id]);
  const siblings = uid.parent_uid_id
    ? await query(`SELECT uid_code, status FROM uids WHERE parent_uid_id = $1 AND id != $2`, [uid.parent_uid_id, uid.id])
    : { rows: [] };

  const splitEvent = await query(`SELECT * FROM split_events WHERE parent_uid_id = $1`, [uid.id]);

  // Rule Book §8.5 — gate furnace temperature detail by HT badge.
  const showFurnace = await canViewFurnaceDetail(query, req.user);
  const steps = showFurnace ? stepLogs.rows : stepLogs.rows.map(redactFurnaceFields);

  return res.json({
    success: true,
    data: {
      ...uid,
      step_history: steps,
      furnace_detail_visible: showFurnace,
      children: children.rows,
      siblings: siblings.rows,
      split_event: splitEvent.rows[0] || null,
    },
  });
}

/**
 * POST /api/v1/uids  (bulk create)
 * body: { cycleCode, quantity, sizeId?, designId?, priority?, moId?, receivingEventId? }
 */
async function bulkCreateUids(req, res) {
  const { cycleCode, quantity, sizeId, designId, priority, moId, receivingEventId, dispatchBatchId } = req.body;

  if (!cycleCode || !quantity || quantity < 1 || quantity > 5000) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: 'cycleCode and a quantity between 1 and 5000 are required.' },
    });
  }

  const result = await withTransaction(async (client) => {
    // Lock all series rows to prevent races between concurrent bulk creates
    const { rows: allSeriesRows } = await client.query(
      `SELECT ct.id AS cycle_type_id, us.current_letter, us.next_number, ct.code
       FROM uid_series us JOIN cycle_types ct ON ct.id = us.cycle_type_id
       ORDER BY ct.id FOR UPDATE`
    );
    const allSeries = allSeriesRows.map((r) => ({
      cycleTypeId: r.cycle_type_id, currentLetter: r.current_letter, nextNumber: r.next_number,
    }));
    const mySeriesRow = allSeriesRows.find((r) => r.code === cycleCode);
    if (!mySeriesRow) throw Object.assign(new Error('Unknown cycle type'), { status: 400, code: 'UNKNOWN_CYCLE' });

    const mySeries = { currentLetter: mySeriesRow.current_letter, nextNumber: mySeriesRow.next_number };
    const { codes, newState } = generateUids(mySeries, allSeries, quantity);

    await client.query(
      `UPDATE uid_series SET current_letter = $1, next_number = $2 WHERE cycle_type_id = $3`,
      [newState.currentLetter, newState.nextNumber, mySeriesRow.cycle_type_id]
    );

    const { rows: verRows } = await client.query(
      `SELECT id FROM cycle_versions WHERE cycle_type_id = $1 AND is_current = true LIMIT 1`,
      [mySeriesRow.cycle_type_id]
    );
    if (!verRows[0]) throw Object.assign(new Error('No current cycle version'), { status: 409, code: 'NO_CYCLE_VERSION' });
    const cycleVersionId = verRows[0].id;

    const { rows: rmqRows } = await client.query(`SELECT id FROM storage_locations WHERE code = 'RM-Q' LIMIT 1`);
    const rmqStorageId = rmqRows[0] ? rmqRows[0].id : null;

    const created = [];
    for (const code of codes) {
      if (code === 'ERR') continue;
      const { rows } = await client.query(
        `INSERT INTO uids (uid_code, cycle_version_id, current_step, current_storage_id,
                            size_id, design_id, mo_id, priority, status, receiving_event_id,
                            dispatch_batch_id, created_by)
         VALUES ($1,$2,'1',$3,$4,$5,$6,$7,'active',$8,$9,$10) RETURNING uid_code`,
        [code, cycleVersionId, rmqStorageId, sizeId || null, designId || null, moId || null,
          priority || 'Normal', receivingEventId || null, dispatchBatchId || null, req.user.sub]
      );
      created.push(rows[0].uid_code);
    }

    await req.audit({ tableName: 'uids', recordId: 'bulk', action: 'INSERT', after: { codes: created, qty: quantity, cycleCode } }, client);

    return created;
  });

  return res.status(201).json({ success: true, data: { created: result, count: result.length } });
}

/**
 * GET /api/v1/uids/preview?cycle=EAT&qty=5
 */
async function previewGeneration(req, res) {
  const cycleCode = req.query.cycle;
  const qty = Math.min(5000, Math.max(1, parseInt(req.query.qty) || 1));
  if (!cycleCode) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_CYCLE', message: 'cycle query param required.' } });
  }

  const { rows: allSeriesRows } = await query(
    `SELECT ct.id AS cycle_type_id, ct.code, us.current_letter, us.next_number
     FROM uid_series us JOIN cycle_types ct ON ct.id = us.cycle_type_id ORDER BY ct.id`
  );
  const allSeries = allSeriesRows.map((r) => ({ cycleTypeId: r.cycle_type_id, currentLetter: r.current_letter, nextNumber: r.next_number }));
  const mine = allSeriesRows.find((r) => r.code === cycleCode);
  if (!mine) return res.status(404).json({ success: false, error: { code: 'UNKNOWN_CYCLE', message: 'Unknown cycle type.' } });

  const preview = previewUids({ currentLetter: mine.current_letter, nextNumber: mine.next_number }, allSeries, qty);
  return res.json({
    success: true,
    data: { codes: preview, first: preview[0], last: preview[preview.length - 1], total: preview.length },
  });
}

/**
 * PATCH /api/v1/uids/:code
 * General update: priority, design, mo, hold/release.
 */
async function updateUid(req, res) {
  const { code } = req.params;
  const allowed = ['priority', 'design_id', 'mo_id', 'status', 'hold_reason'];
  const sets = [];
  const params = [];
  let p = 1;

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      sets.push(`${key} = $${p++}`);
      params.push(req.body[key]);
    }
  }
  if (!sets.length) return res.status(400).json({ success: false, error: { code: 'NO_FIELDS', message: 'No updatable fields provided.' } });

  const { rows: beforeRows } = await query(`SELECT * FROM uids WHERE uid_code = $1`, [code]);
  if (!beforeRows[0]) return res.status(404).json({ success: false, error: { code: 'UID_NOT_FOUND', message: `UID ${code} not found.` } });

  params.push(code);
  const { rows } = await query(`UPDATE uids SET ${sets.join(', ')} WHERE uid_code = $${p} RETURNING *`, params);

  await req.audit({ tableName: 'uids', recordId: rows[0].id, action: 'UPDATE', before: beforeRows[0], after: rows[0] });

  return res.json({ success: true, data: rows[0] });
}

/**
 * POST /api/v1/uids/:code/advance
 * Marks the current step complete and moves the UID to the next step,
 * updating storage. This is the core "Close Job" action from My Workstation.
 *
 * Enforces: design-lock-before-Step-16, hold placement.
 */
async function advanceUid(req, res) {
  const { code } = req.params;
  const { qcResult, qcType, qcValue, netWorkSeconds, totalElapsedSeconds, notes } = req.body;

  const result = await withTransaction(async (client) => {
    const { rows: uidRows } = await client.query(`SELECT * FROM uids WHERE uid_code = $1 FOR UPDATE`, [code]);
    const uid = uidRows[0];
    if (!uid) throw Object.assign(new Error('UID not found'), { status: 404, code: 'UID_NOT_FOUND' });
    if (uid.status === 'hold') throw Object.assign(new Error('UID is on hold'), { status: 409, code: 'UID_ON_HOLD' });

    const { rows: stepRows } = await client.query(
      `SELECT * FROM cycle_steps WHERE cycle_version_id = $1 AND step_number = $2`,
      [uid.cycle_version_id, uid.current_step]
    );
    const currentStepDef = stepRows[0];
    if (!currentStepDef) throw Object.assign(new Error('Step definition not found'), { status: 500, code: 'STEP_NOT_FOUND' });

    // Design lock: cannot proceed past step 15 into step 16 without a design
    const allSteps = await client.query(
      `SELECT step_number, sequence_order FROM cycle_steps WHERE cycle_version_id = $1 ORDER BY sequence_order`,
      [uid.cycle_version_id]
    );
    const idx = allSteps.rows.findIndex((s) => s.step_number === uid.current_step);
    const nextStepDef = allSteps.rows[idx + 1];

    if (nextStepDef && nextStepDef.step_number === '16' && !uid.design_id) {
      await client.query(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`, [
        'Design not confirmed — required before Converting (Step 16)', uid.id,
      ]);
      return { held: true, uid: { ...uid, status: 'hold' } };
    }

    // Close out the in-progress step log (if one exists and is still open)
    await client.query(
      `UPDATE uid_step_logs SET closed_at = now(), net_work_seconds = $1, total_elapsed_seconds = $2,
              qc_result = $3, qc_check_type = $4, qc_value = $5, notes = $6
       WHERE uid_id = $7 AND step_number = $8 AND closed_at IS NULL`,
      [netWorkSeconds || null, totalElapsedSeconds || null, qcResult || null, qcType || null, qcValue || null, notes || null, uid.id, uid.current_step]
    );

    if (qcResult === 'Fail') {
      await client.query(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`, ['QC failed at step ' + uid.current_step, uid.id]);
      return { held: true, qcFailed: true, uid: { ...uid, status: 'hold' } };
    }

    if (!nextStepDef) {
      // Final step completed (Packing and Dispatch) — UID is done
      await client.query(`UPDATE uids SET status = 'done' WHERE id = $1`, [uid.id]);
      return { done: true, uid: { ...uid, status: 'done' } };
    }

    await client.query(
      `UPDATE uids SET current_step = $1, current_storage_id = $2 WHERE id = $3`,
      [nextStepDef.step_number, currentStepDef.dest_storage_id, uid.id]
    );

    return { advanced: true, uid: { ...uid, current_step: nextStepDef.step_number } };
  });

  await req.audit({ tableName: 'uids', recordId: code, action: 'UPDATE', after: result });

  if (result.held) {
    return res.status(409).json({
      success: false,
      error: { code: 'HOLD_PLACED', message: result.qcFailed ? 'QC failed — UID placed on hold.' : 'Design not confirmed — UID placed on hold.' },
      data: result.uid,
    });
  }
  return res.json({ success: true, data: result.uid });
}

/**
 * POST /api/v1/uids/:code/hold
 */
async function holdUid(req, res) {
  const { code } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ success: false, error: { code: 'REASON_REQUIRED', message: 'A hold reason is required.' } });

  const { rows } = await query(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE uid_code = $2 RETURNING *`, [reason, code]);
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'UID_NOT_FOUND', message: `UID ${code} not found.` } });

  await req.audit({ tableName: 'uids', recordId: rows[0].id, action: 'UPDATE', after: { status: 'hold', reason } });
  return res.json({ success: true, data: rows[0] });
}

/**
 * POST /api/v1/uids/:code/release
 */
async function releaseUid(req, res) {
  const { code } = req.params;
  // Rule Book §7: hold release requires a reason, and that reason is logged.
  const reason = ((req.body && req.body.reason) || '').trim();
  if (!reason) {
    return res.status(400).json({ success: false, error: { code: 'REASON_REQUIRED', message: 'A release reason is required.' } });
  }
  const { rows } = await query(`UPDATE uids SET status = 'active', hold_reason = NULL WHERE uid_code = $1 RETURNING *`, [code]);
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'UID_NOT_FOUND', message: `UID ${code} not found.` } });

  await req.audit({ tableName: 'uids', recordId: rows[0].id, action: 'UPDATE', after: { status: 'active', releaseReason: reason } });
  return res.json({ success: true, data: rows[0] });
}

/**
 * POST /api/v1/uids/:code/converting
 * Step 16 split: parent frozen, children created.
 * body: { childLengthsMm: [1500,1500,1424], childCycleCodes: ['EAT','EAT','SWAN'], scrapReason, reasonNotes, conversionPatternId? }
 */
async function convertUid(req, res) {
  const { code } = req.params;
  const { childLengthsMm, childCycleCodes, scrapReason, reasonNotes, conversionPatternId } = req.body;

  // Converting can be a simple resize (e.g. 1500→1424 = 1 child, 1 cut, 73mm scrap)
  // through to a 4-way split — so 1 to 4 children.
  if (!Array.isArray(childLengthsMm) || childLengthsMm.length < 1 || childLengthsMm.length > 4) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_CHILDREN', message: 'Provide 1–4 child lengths.' } });
  }

  const result = await withTransaction(async (client) => {
    const { rows: parentRows } = await client.query(`SELECT * FROM uids WHERE uid_code = $1 FOR UPDATE`, [code]);
    const parent = parentRows[0];
    if (!parent) throw Object.assign(new Error('UID not found'), { status: 404, code: 'UID_NOT_FOUND' });
    if (parent.status === 'hold') throw Object.assign(new Error('Design not confirmed'), { status: 409, code: 'DESIGN_NOT_CONFIRMED' });
    if (!parent.design_id) throw Object.assign(new Error('Design not confirmed'), { status: 409, code: 'DESIGN_NOT_CONFIRMED' });

    const { rows: sizeRows } = await client.query(`SELECT size_mm FROM sizes WHERE id = $1`, [parent.size_id]);
    const inputMm = sizeRows[0] ? sizeRows[0].size_mm : null;
    if (!inputMm) throw Object.assign(new Error('Parent UID has no size set'), { status: 409, code: 'NO_SIZE' });

    const scrapCalc = calculateScrap(inputMm, childLengthsMm, 3);
    if (!scrapCalc.valid) {
      throw Object.assign(new Error('Child lengths exceed parent length'), { status: 400, code: 'NEGATIVE_SCRAP', meta: scrapCalc });
    }

    // Mark parent as done/frozen
    await client.query(`UPDATE uids SET status = 'done' WHERE id = $1`, [parent.id]);

    // Find step 17's storage as the children's starting storage (QC-Q typically)
    const { rows: step17 } = await client.query(
      `SELECT source_storage_id FROM cycle_steps WHERE cycle_version_id = $1 AND step_number = '17'`,
      [parent.cycle_version_id]
    );
    const childStorageId = step17[0] ? step17[0].source_storage_id : parent.current_storage_id;

    const childCodes = [];
    for (let i = 0; i < childLengthsMm.length; i++) {
      const suffix = String.fromCharCode(65 + i); // A, B, C, D
      const childCode = `${parent.uid_code}-${suffix}`;
      const cycleCode = (childCycleCodes && childCycleCodes[i]) || null;

      let childCycleVersionId = parent.cycle_version_id;
      if (cycleCode) {
        const { rows: cv } = await client.query(
          `SELECT cv.id FROM cycle_versions cv JOIN cycle_types ct ON ct.id = cv.cycle_type_id
           WHERE ct.code = $1 AND cv.is_current = true LIMIT 1`,
          [cycleCode]
        );
        if (cv[0]) childCycleVersionId = cv[0].id;
      }

      const { rows: sizeRow } = await client.query(`SELECT id FROM sizes WHERE size_mm = $1`, [childLengthsMm[i]]);
      const childSizeId = sizeRow[0] ? sizeRow[0].id : null;

      await client.query(
        `INSERT INTO uids (uid_code, parent_uid_id, cycle_version_id, current_step, current_storage_id,
                            size_id, design_id, mo_id, priority, status,
                            receiving_event_id, dispatch_batch_id, created_by)
         VALUES ($1,$2,$3,'17',$4,$5,$6,$7,$8,'active',$9,$10,$11)`,
        [childCode, parent.id, childCycleVersionId, childStorageId, childSizeId, parent.design_id,
          parent.mo_id, parent.priority, parent.receiving_event_id, parent.dispatch_batch_id, req.user.sub]
      );
      childCodes.push(childCode);
    }

    await client.query(
      `INSERT INTO split_events (parent_uid_id, split_step, conversion_pattern_id, input_length_mm,
                                  child_lengths_mm, cuts, kerf_total_mm, scrap_mm, scrap_reason,
                                  reason_notes, authorised_by)
       VALUES ($1,'16',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [parent.id, conversionPatternId || null, inputMm, childLengthsMm, scrapCalc.cuts,
        scrapCalc.kerfTotal, scrapCalc.scrapMm, scrapReason || null, reasonNotes || null, req.user.sub]
    );

    return { parentCode: parent.uid_code, childCodes, scrap: scrapCalc };
  });

  await req.audit({ tableName: 'uids', recordId: code, action: 'UPDATE', after: result });

  return res.status(201).json({ success: true, data: result });
}

/**
 * GET /api/v1/uids/:code/lineage
 */
async function getLineage(req, res) {
  const { code } = req.params;
  const { rows: uidRows } = await query(`SELECT id, parent_uid_id FROM uids WHERE uid_code = $1`, [code]);
  if (!uidRows[0]) return res.status(404).json({ success: false, error: { code: 'UID_NOT_FOUND', message: `UID ${code} not found.` } });

  const uid = uidRows[0];
  const parent = uid.parent_uid_id
    ? (await query(`SELECT uid_code, status FROM uids WHERE id = $1`, [uid.parent_uid_id])).rows[0]
    : null;
  const children = (await query(`SELECT uid_code, status FROM uids WHERE parent_uid_id = $1`, [uid.id])).rows;
  const siblings = uid.parent_uid_id
    ? (await query(`SELECT uid_code, status FROM uids WHERE parent_uid_id = $1 AND id != $2`, [uid.parent_uid_id, uid.id])).rows
    : [];

  return res.json({ success: true, data: { parent, children, siblings } });
}

/**
 * GET /api/v1/uids/summary/wip — count per storage location
 */
async function wipSummary(req, res) {
  const { rows } = await query(
    `SELECT sl.code, COUNT(u.id) AS count
     FROM storage_locations sl
     LEFT JOIN uids u ON u.current_storage_id = sl.id AND u.status IN ('active','hold')
     GROUP BY sl.code, sl.id ORDER BY sl.id`
  );
  return res.json({ success: true, data: rows.map((r) => ({ code: r.code, count: Number(r.count) })) });
}

/**
 * GET /api/v1/uids/summary/stations — count per workstation
 */
async function stationSummary(req, res) {
  const { rows } = await query(
    `SELECT wt.code, wt.name, COUNT(u.id) AS active_count
     FROM workstation_types wt
     LEFT JOIN cycle_steps cs ON cs.workstation_type_id = wt.id
     LEFT JOIN uids u ON u.current_step = cs.step_number AND u.cycle_version_id = cs.cycle_version_id AND u.status = 'active'
     GROUP BY wt.code, wt.name ORDER BY wt.code`
  );
  return res.json({ success: true, data: rows.map((r) => ({ code: r.code, name: r.name, active_count: Number(r.active_count) })) });
}

/**
 * GET /api/v1/uids/summary/shopfloor?location= — Active / Hold / Pause headline
 * counts for the wall display. Dharmapuri is UID/job based; Faridabad is item
 * based (no UID hold/pause concept there).
 */
async function shopfloorSummary(req, res) {
  const location = req.query.location;
  if (location === 'faridabad') {
    const { rows } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status <> 'done') AS active,
         COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
         0 AS hold, 0 AS paused
       FROM faridabad_items`
    );
    const r = rows[0] || {};
    return res.json({ success: true, data: { active: Number(r.active) || 0, hold: 0, paused: 0 } });
  }
  // Dharmapuri (default): active UIDs, UIDs on hold, paused jobs.
  const { rows: uidRows } = await query(
    `SELECT COUNT(*) FILTER (WHERE status = 'active') AS active,
            COUNT(*) FILTER (WHERE status = 'hold') AS hold
     FROM uids`
  );
  const { rows: jobRows } = await query(
    `SELECT COUNT(*) AS paused FROM jobs WHERE status = 'paused'`
  );
  return res.json({
    success: true,
    data: {
      active: Number(uidRows[0]?.active) || 0,
      hold: Number(uidRows[0]?.hold) || 0,
      paused: Number(jobRows[0]?.paused) || 0,
    },
  });
}

module.exports = {
  listUids, getUidDetail, bulkCreateUids, previewGeneration, updateUid,
  shopfloorSummary,
  advanceUid, holdUid, releaseUid, convertUid, getLineage, wipSummary, stationSummary,
  LOCATION_CODE_TO_ID,
};
