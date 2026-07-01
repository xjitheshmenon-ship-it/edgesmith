const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, auditContext);

// Aggregates each MO's line items into a JSON array. Reused by list + detail.
const LINE_ITEMS_SUBQUERY = `
  COALESCE((
    SELECT json_agg(json_build_object(
      'id', li.id, 'sizeId', li.size_id, 'sizeMm', lsz.size_mm,
      'designId', li.design_id, 'designCode', ld.code,
      'quantity', li.quantity, 'notes', li.notes
    ) ORDER BY li.id)
    FROM mo_line_items li
    LEFT JOIN sizes lsz ON lsz.id = li.size_id
    LEFT JOIN designs ld ON ld.id = li.design_id
    WHERE li.mo_id = mo.id
  ), '[]'::json) AS line_items`;

/** GET /api/v1/mos */
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT mo.*, sz.size_mm, d.code AS design_code,
            (SELECT COUNT(*) FROM uids u WHERE u.mo_id = mo.id) AS uids_linked,
            (SELECT COUNT(*) FROM uids u WHERE u.mo_id = mo.id AND u.status = 'done') AS uids_dispatched,
            ${LINE_ITEMS_SUBQUERY}
     FROM manufacturing_orders mo
     LEFT JOIN sizes sz ON sz.id = mo.size_id
     LEFT JOIN designs d ON d.id = mo.design_id
     ORDER BY mo.created_at DESC`
  );
  return res.json({ success: true, data: rows });
});

/** GET /api/v1/mos/:id — MO with its line items */
router.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT mo.*, sz.size_mm, d.code AS design_code, ${LINE_ITEMS_SUBQUERY}
     FROM manufacturing_orders mo
     LEFT JOIN sizes sz ON sz.id = mo.size_id
     LEFT JOIN designs d ON d.id = mo.design_id
     WHERE mo.id = $1`, [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'MO_NOT_FOUND', message: 'MO not found.' } });
  return res.json({ success: true, data: rows[0] });
});

/**
 * POST /api/v1/mos (Admin/Manager)
 * body: { moNumber, customer, priority, requiredDeliveryDate, notes,
 *         quantity?, sizeId?, designId?,                 // single-line convenience
 *         lineItems?: [{ sizeId, designId, quantity, notes }] }  // multi-line order
 * When lineItems are supplied, the top-level size/design/quantity are derived
 * from them (first line's size/design; quantity = sum of line quantities).
 */
router.post('/', requireRole(['admin', 'manager']), async (req, res) => {
  const { moNumber, customer, quantity, sizeId, designId, priority, requiredDeliveryDate, notes, lineItems } = req.body;
  if (!moNumber) return res.status(400).json({ success: false, error: { code: 'MISSING_MO_NUMBER', message: 'moNumber is required.' } });

  const lines = Array.isArray(lineItems) ? lineItems.filter((l) => l && (l.sizeId || l.designId || l.quantity)) : [];

  // Derive top-level fields from lines when present (keeps single-line consumers working).
  const topSizeId = sizeId || (lines[0] && lines[0].sizeId) || null;
  const topDesignId = designId || (lines[0] && lines[0].designId) || null;
  const topQuantity = quantity != null
    ? quantity
    : (lines.length ? lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0) : null);

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO manufacturing_orders (mo_number, customer, quantity, size_id, design_id, priority, required_delivery_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [moNumber, customer || null, topQuantity, topSizeId, topDesignId, priority || 'Normal', requiredDeliveryDate || null, notes || null, req.user.sub]
    );
    const mo = rows[0];
    const insertedLines = [];
    for (const l of lines) {
      const { rows: lr } = await client.query(
        `INSERT INTO mo_line_items (mo_id, size_id, design_id, quantity, notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [mo.id, l.sizeId || null, l.designId || null, l.quantity || null, l.notes || null]
      );
      insertedLines.push(lr[0]);
    }
    return { mo, lineItems: insertedLines };
  });

  await req.audit({ tableName: 'manufacturing_orders', recordId: result.mo.id, action: 'INSERT', after: result.mo });
  return res.status(201).json({ success: true, data: { ...result.mo, line_items: result.lineItems } });
});

/** PATCH /api/v1/mos/:id */
router.patch('/:id', requireRole(['admin', 'manager']), async (req, res) => {
  const allowed = ['customer', 'quantity', 'size_id', 'design_id', 'priority', 'required_delivery_date', 'status', 'notes'];
  const sets = []; const params = []; let p = 1;
  for (const key of allowed) {
    if (req.body[key] !== undefined) { sets.push(`${key} = $${p++}`); params.push(req.body[key]); }
  }
  if (!sets.length) return res.status(400).json({ success: false, error: { code: 'NO_FIELDS', message: 'No updatable fields provided.' } });
  params.push(req.params.id);
  const { rows } = await query(`UPDATE manufacturing_orders SET ${sets.join(', ')} WHERE id = $${p} RETURNING *`, params);
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'MO_NOT_FOUND', message: 'MO not found.' } });
  await req.audit({ tableName: 'manufacturing_orders', recordId: req.params.id, action: 'UPDATE', after: rows[0] });
  return res.json({ success: true, data: rows[0] });
});

/**
 * POST /api/v1/mos/:id/link-uids
 * body: { uidCodes: [...], applyMoValues: boolean }
 */
router.post('/:id/link-uids', requireRole(['admin', 'manager']), async (req, res) => {
  const { uidCodes, applyMoValues } = req.body;
  if (!Array.isArray(uidCodes) || !uidCodes.length) {
    return res.status(400).json({ success: false, error: { code: 'NO_UIDS', message: 'uidCodes array is required.' } });
  }

  const result = await withTransaction(async (client) => {
    const { rows: moRows } = await client.query(`SELECT * FROM manufacturing_orders WHERE id = $1`, [req.params.id]);
    if (!moRows[0]) throw Object.assign(new Error('MO not found'), { status: 404, code: 'MO_NOT_FOUND' });
    const mo = moRows[0];

    const updated = [];
    for (const code of uidCodes) {
      if (applyMoValues) {
        await client.query(
          `UPDATE uids SET mo_id = $1, size_id = COALESCE($2, size_id), design_id = COALESCE($3, design_id) WHERE uid_code = $4`,
          [mo.id, mo.size_id, mo.design_id, code]
        );
      } else {
        await client.query(`UPDATE uids SET mo_id = $1 WHERE uid_code = $2`, [mo.id, code]);
      }
      updated.push(code);
    }

    if (mo.status === 'open') {
      await client.query(`UPDATE manufacturing_orders SET status = 'active' WHERE id = $1`, [mo.id]);
    }

    return updated;
  });

  await req.audit({ tableName: 'manufacturing_orders', recordId: req.params.id, action: 'UPDATE', after: { linkedUids: result } });
  return res.json({ success: true, data: { linked: result } });
});

module.exports = router;
