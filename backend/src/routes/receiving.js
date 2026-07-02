const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, auditContext);

/** GET /api/v1/receiving */
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT re.*, cd.batch_reference AS dispatch_reference, cd.cycle_type_id, ct.code AS cycle_code,
            cd.color_code_id AS dispatch_color_id, dc.name AS dispatch_color_name,
            arrival.name AS arrival_color_name, sz.size_mm AS post_rolling_size_mm
     FROM receiving_events re
     JOIN contractor_dispatches cd ON cd.id = re.dispatch_batch_id
     JOIN cycle_types ct ON ct.id = cd.cycle_type_id
     LEFT JOIN color_codes dc ON dc.id = cd.color_code_id
     LEFT JOIN color_codes arrival ON arrival.id = re.color_code_on_arrival_id
     LEFT JOIN sizes sz ON sz.id = re.post_rolling_size_id
     ORDER BY re.created_at DESC`
  );
  return res.json({ success: true, data: rows });
});

/** GET /api/v1/receiving/expected — dispatches not yet fully received */
router.get('/expected', async (req, res) => {
  const { rows } = await query(
    `SELECT cd.*, ct.code AS cycle_code, cont.name AS contractor_name,
            cd.block_count - COALESCE((SELECT SUM(re.block_count) FROM receiving_events re WHERE re.dispatch_batch_id = cd.id), 0) AS remaining
     FROM contractor_dispatches cd
     JOIN cycle_types ct ON ct.id = cd.cycle_type_id
     JOIN contractors cont ON cont.id = cd.contractor_id
     WHERE cd.status != 'fully_received'
     ORDER BY cd.date_dispatched ASC`
  );
  return res.json({ success: true, data: rows });
});

/** GET /api/v1/receiving/:id */
router.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT re.*, cd.batch_reference AS dispatch_reference, ct.code AS cycle_code
     FROM receiving_events re
     JOIN contractor_dispatches cd ON cd.id = re.dispatch_batch_id
     JOIN cycle_types ct ON ct.id = cd.cycle_type_id
     WHERE re.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'RECEIVING_NOT_FOUND', message: 'Receiving event not found.' } });
  return res.json({ success: true, data: rows[0] });
});

/**
 * POST /api/v1/receiving
 * body: { dispatchBatchId, blockCount, colorCodeOnArrivalId, condition?, conditionNotes?, dateReceived }
 *
 * Color verification: if colorCodeOnArrivalId does not match the dispatch
 * record's color, the response flags requiresSupervisorConfirmation = true.
 * The frontend should block proceeding to BSW-01 until a Supervisor
 * acknowledges (handled as a separate PATCH below).
 */
router.post('/', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const b = req.body || {};
  // Accept both the camelCase API contract and the snake_case names the
  // receiving form sends. Colour may arrive as an id or as a code/name string.
  const dispatchBatchId = b.dispatchBatchId ?? b.dispatch_id ?? b.dispatchId ?? null;
  const condition = b.condition || 'good';
  const conditionNotes = b.conditionNotes ?? b.notes ?? null;
  const dateReceived = b.dateReceived ?? b.date_received ?? null;
  const colorIdRaw = b.colorCodeOnArrivalId ?? b.color_code_on_arrival_id ?? null;
  const colorNameRaw = b.received_color_code ?? b.receivedColorCode ?? null;

  // A delivery can carry blocks at several post-rolling sizes. blockEntries is
  // [{ sizeId, count }]; block_count is the total, post_rolling_size_id keeps
  // the first size for single-size readers. Falls back to the single-size shape.
  const rawEntries = Array.isArray(b.blockEntries ?? b.block_entries) ? (b.blockEntries ?? b.block_entries) : null;
  let blockEntries = null;
  let blockCount = b.blockCount ?? b.billets_received ?? b.blocksReceived ?? b.block_count ?? null;
  let postRollingSizeId = b.postRollingSizeId != null && b.postRollingSizeId !== ''
    ? Number(b.postRollingSizeId)
    : (b.post_rolling_size_id != null && b.post_rolling_size_id !== '' ? Number(b.post_rolling_size_id) : null);

  if (rawEntries) {
    blockEntries = rawEntries
      .map((e) => ({ size_id: Number(e.sizeId ?? e.size_id) || null, count: Number(e.count ?? e.blockCount) || 0 }))
      .filter((e) => e.size_id && e.count > 0);
    if (!blockEntries.length) {
      return res.status(400).json({ success: false, error: { code: 'NO_ENTRIES', message: 'At least one block size with a count is required.' } });
    }
    blockCount = blockEntries.reduce((s, e) => s + e.count, 0);
    postRollingSizeId = blockEntries[0].size_id;
  }

  if (!dispatchBatchId || !blockCount || !dateReceived) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'dispatch, block count and date received are required.' } });
  }

  const result = await withTransaction(async (client) => {
    const { rows: dispatchRows } = await client.query(`SELECT * FROM contractor_dispatches WHERE id = $1 FOR UPDATE`, [dispatchBatchId]);
    const dispatch = dispatchRows[0];
    if (!dispatch) throw Object.assign(new Error('Dispatch not found'), { status: 404, code: 'DISPATCH_NOT_FOUND' });

    // Resolve the arrival colour to an id: explicit id wins, else look up by code/name.
    let colorCodeOnArrivalId = colorIdRaw != null && colorIdRaw !== '' ? Number(colorIdRaw) : null;
    if (!colorCodeOnArrivalId && colorNameRaw) {
      const { rows: ccRows } = await client.query(
        `SELECT id FROM color_codes WHERE lower(name) = lower($1) LIMIT 1`, [String(colorNameRaw).trim()]
      );
      colorCodeOnArrivalId = ccRows[0] ? ccRows[0].id : null;
    }
    const colorMatch = colorCodeOnArrivalId ? colorCodeOnArrivalId === dispatch.color_code_id : null;

    const year = new Date().getFullYear();
    const { rows: seqRows } = await client.query(`SELECT COUNT(*) AS c FROM receiving_events WHERE receiving_reference LIKE $1`, [`DHR-RCV-${year}-%`]);
    const seq = Number(seqRows[0].c) + 1;
    const receivingReference = `DHR-RCV-${year}-${String(seq).padStart(3, '0')}`;

    const { rows: recRows } = await client.query(
      `INSERT INTO receiving_events
         (receiving_reference, dispatch_batch_id, block_count, color_code_on_arrival_id, color_match,
          condition, condition_notes, post_rolling_size_id, block_entries, received_by, date_received)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [receivingReference, dispatchBatchId, blockCount, colorCodeOnArrivalId || null, colorMatch,
        condition, conditionNotes || null, postRollingSizeId, blockEntries ? JSON.stringify(blockEntries) : null, req.user.sub, dateReceived]
    );

    const { rows: totalRows } = await client.query(
      `SELECT COALESCE(SUM(block_count),0) AS total FROM receiving_events WHERE dispatch_batch_id = $1`,
      [dispatchBatchId]
    );
    const totalReceived = Number(totalRows[0].total);
    const newStatus = totalReceived >= dispatch.block_count ? 'fully_received' : 'partially_received';
    await client.query(`UPDATE contractor_dispatches SET status = $1 WHERE id = $2`, [newStatus, dispatchBatchId]);

    return { receiving: recRows[0], colorMatch, requiresSupervisorConfirmation: colorMatch === false };
  });

  await req.audit({ tableName: 'receiving_events', recordId: result.receiving.id, action: 'INSERT', after: result.receiving });
  return res.status(201).json({ success: true, data: result });
});

/**
 * PATCH /api/v1/receiving/:id/confirm-mismatch
 * Supervisor explicitly confirms proceeding despite a color mismatch.
 */
router.patch('/:id/confirm-mismatch', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const note = (req.body && (req.body.note ?? req.body.mismatchNote ?? req.body.notes)) || null;
  const { rows } = await query(
    `UPDATE receiving_events
       SET status = 'in_production', mismatch_note = $2, mismatch_confirmed_by = $3
     WHERE id = $1 AND color_match = false RETURNING *`,
    [req.params.id, note, req.user.sub]
  );
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No mismatched receiving event found with this id.' } });
  await req.audit({ tableName: 'receiving_events', recordId: req.params.id, action: 'UPDATE', after: { mismatchConfirmed: true, note } });
  return res.json({ success: true, data: rows[0] });
});

module.exports = router;
