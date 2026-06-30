const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, auditContext);

/** GET /api/v1/mos */
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT mo.*, sz.size_mm, d.code AS design_code,
            (SELECT COUNT(*) FROM uids u WHERE u.mo_id = mo.id) AS uids_linked,
            (SELECT COUNT(*) FROM uids u WHERE u.mo_id = mo.id AND u.status = 'done') AS uids_dispatched
     FROM manufacturing_orders mo
     LEFT JOIN sizes sz ON sz.id = mo.size_id
     LEFT JOIN designs d ON d.id = mo.design_id
     ORDER BY mo.created_at DESC`
  );
  return res.json({ success: true, data: rows });
});

/** POST /api/v1/mos (Admin/Manager) */
router.post('/', requireRole(['admin', 'manager']), async (req, res) => {
  const { moNumber, customer, quantity, sizeId, designId, priority, requiredDeliveryDate, notes } = req.body;
  if (!moNumber) return res.status(400).json({ success: false, error: { code: 'MISSING_MO_NUMBER', message: 'moNumber is required.' } });

  const { rows } = await query(
    `INSERT INTO manufacturing_orders (mo_number, customer, quantity, size_id, design_id, priority, required_delivery_date, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [moNumber, customer || null, quantity || null, sizeId || null, designId || null, priority || 'Normal', requiredDeliveryDate || null, notes || null, req.user.sub]
  );
  await req.audit({ tableName: 'manufacturing_orders', recordId: rows[0].id, action: 'INSERT', after: rows[0] });
  return res.status(201).json({ success: true, data: rows[0] });
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
