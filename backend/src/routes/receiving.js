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
            arrival.name AS arrival_color_name
     FROM receiving_events re
     JOIN contractor_dispatches cd ON cd.id = re.dispatch_batch_id
     JOIN cycle_types ct ON ct.id = cd.cycle_type_id
     LEFT JOIN color_codes dc ON dc.id = cd.color_code_id
     LEFT JOIN color_codes arrival ON arrival.id = re.color_code_on_arrival_id
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
  const { dispatchBatchId, blockCount, colorCodeOnArrivalId, condition, conditionNotes, dateReceived } = req.body;

  if (!dispatchBatchId || !blockCount || !dateReceived) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'dispatchBatchId, blockCount, dateReceived are required.' } });
  }

  const result = await withTransaction(async (client) => {
    const { rows: dispatchRows } = await client.query(`SELECT * FROM contractor_dispatches WHERE id = $1 FOR UPDATE`, [dispatchBatchId]);
    const dispatch = dispatchRows[0];
    if (!dispatch) throw Object.assign(new Error('Dispatch not found'), { status: 404, code: 'DISPATCH_NOT_FOUND' });

    const colorMatch = colorCodeOnArrivalId ? colorCodeOnArrivalId === dispatch.color_code_id : null;

    const year = new Date().getFullYear();
    const { rows: seqRows } = await client.query(`SELECT COUNT(*) AS c FROM receiving_events WHERE receiving_reference LIKE $1`, [`DHR-RCV-${year}-%`]);
    const seq = Number(seqRows[0].c) + 1;
    const receivingReference = `DHR-RCV-${year}-${String(seq).padStart(3, '0')}`;

    const { rows: recRows } = await client.query(
      `INSERT INTO receiving_events
         (receiving_reference, dispatch_batch_id, block_count, color_code_on_arrival_id, color_match,
          condition, condition_notes, received_by, date_received)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [receivingReference, dispatchBatchId, blockCount, colorCodeOnArrivalId || null, colorMatch,
        condition || 'good', conditionNotes || null, req.user.sub, dateReceived]
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
  const { rows } = await query(
    `UPDATE receiving_events SET status = 'in_production' WHERE id = $1 AND color_match = false RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No mismatched receiving event found with this id.' } });
  await req.audit({ tableName: 'receiving_events', recordId: req.params.id, action: 'UPDATE', after: { mismatchConfirmed: true } });
  return res.json({ success: true, data: rows[0] });
});

module.exports = router;
