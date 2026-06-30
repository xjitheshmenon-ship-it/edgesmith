const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, auditContext);

/**
 * Generic CRUD factory for simple reference tables. Keeps this file from
 * being 15 near-identical copy-pasted route blocks.
 */
function simpleResource(tableName, { fields, writableRoles = ['admin'] }) {
  const sub = express.Router();

  sub.get('/', async (req, res) => {
    const { rows } = await query(`SELECT * FROM ${tableName} ORDER BY id`);
    return res.json({ success: true, data: rows });
  });

  sub.post('/', requireRole(writableRoles), async (req, res) => {
    const cols = fields.filter((f) => req.body[f.key] !== undefined);
    if (!cols.length) return res.status(400).json({ success: false, error: { code: 'NO_FIELDS', message: 'No fields provided.' } });
    const colNames = cols.map((f) => f.column).join(', ');
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const values = cols.map((f) => req.body[f.key]);
    const { rows } = await query(`INSERT INTO ${tableName} (${colNames}) VALUES (${placeholders}) RETURNING *`, values);
    await req.audit({ tableName, recordId: rows[0].id, action: 'INSERT', after: rows[0] });
    return res.status(201).json({ success: true, data: rows[0] });
  });

  sub.patch('/:id', requireRole(writableRoles), async (req, res) => {
    const cols = fields.filter((f) => req.body[f.key] !== undefined);
    if (!cols.length) return res.status(400).json({ success: false, error: { code: 'NO_FIELDS', message: 'No fields provided.' } });
    const sets = cols.map((f, i) => `${f.column} = $${i + 1}`).join(', ');
    const values = cols.map((f) => req.body[f.key]);
    values.push(req.params.id);
    const { rows } = await query(`UPDATE ${tableName} SET ${sets} WHERE id = $${values.length} RETURNING *`, values);
    if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Record not found.' } });
    await req.audit({ tableName, recordId: req.params.id, action: 'UPDATE', after: rows[0] });
    return res.json({ success: true, data: rows[0] });
  });

  sub.delete('/:id', requireRole(writableRoles), async (req, res) => {
    // Soft-delete pattern — archive, never hard delete (per "nothing is ever permanently deleted" rule)
    const { rows } = await query(`UPDATE ${tableName} SET status = 'archived' WHERE id = $1 RETURNING *`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Record not found.' } });
    await req.audit({ tableName, recordId: req.params.id, action: 'UPDATE', after: { status: 'archived' } });
    return res.json({ success: true, data: rows[0] });
  });

  return sub;
}

router.use('/workstation-types', simpleResource('workstation_types', {
  fields: [{ key: 'code', column: 'code' }, { key: 'name', column: 'name' }, { key: 'category', column: 'category' }, { key: 'locationId', column: 'location_id' }, { key: 'status', column: 'status' }],
}));

router.use('/workstation-units', simpleResource('workstation_units', {
  fields: [{ key: 'workstationTypeId', column: 'workstation_type_id' }, { key: 'unitCode', column: 'unit_code' }, { key: 'unitName', column: 'unit_name' }, { key: 'status', column: 'status' }],
  writableRoles: ['admin'],
}));

router.use('/products', simpleResource('products', {
  fields: [{ key: 'name', column: 'name' }, { key: 'code', column: 'code' }, { key: 'defaultCycleTypeId', column: 'default_cycle_type_id' }, { key: 'status', column: 'status' }],
}));

router.use('/sizes', simpleResource('sizes', {
  fields: [{ key: 'sizeMm', column: 'size_mm' }, { key: 'description', column: 'description' }, { key: 'status', column: 'status' }],
}));

router.use('/suppliers', simpleResource('suppliers', {
  fields: [{ key: 'name', column: 'name' }, { key: 'materialType', column: 'material_type' }, { key: 'contactDetails', column: 'contact_details' }, { key: 'status', column: 'status' }],
}));

router.use('/contractors', simpleResource('contractors', {
  fields: [{ key: 'name', column: 'name' }, { key: 'contactDetails', column: 'contact_details' }, { key: 'status', column: 'status' }],
}));

router.use('/color-codes', simpleResource('color_codes', {
  fields: [{ key: 'name', column: 'name' }, { key: 'hexSwatch', column: 'hex_swatch' }, { key: 'status', column: 'status' }],
}));

router.use('/truck-capacity', simpleResource('truck_capacity', {
  fields: [{ key: 'contractorId', column: 'contractor_id' }, { key: 'maxBlocks', column: 'max_blocks' }, { key: 'status', column: 'status' }],
}));

router.use('/grade-cycle-map', simpleResource('alloy_grade_cycle_map', {
  fields: [{ key: 'alloyGrade', column: 'alloy_grade' }, { key: 'cycleTypeCode', column: 'cycle_type_code' }, { key: 'status', column: 'status' }],
}));

router.use('/conversion-patterns', simpleResource('conversion_patterns', {
  fields: [{ key: 'name', column: 'name' }, { key: 'inputLengthMm', column: 'input_length_mm' }, { key: 'childLengthsMm', column: 'child_lengths_mm' }, { key: 'kerfMm', column: 'kerf_mm' }, { key: 'status', column: 'status' }],
}));

router.use('/storage-locations', simpleResource('storage_locations', {
  fields: [{ key: 'code', column: 'code' }, { key: 'name', column: 'name' }, { key: 'locationId', column: 'location_id' }, { key: 'status', column: 'status' }],
}));

// Designs need their valid-sizes relationship handled specially
router.get('/designs', async (req, res) => {
  const { rows } = await query(
    `SELECT d.*, array_agg(sz.size_mm) FILTER (WHERE sz.size_mm IS NOT NULL) AS valid_sizes
     FROM designs d
     LEFT JOIN design_valid_sizes dvs ON dvs.design_id = d.id
     LEFT JOIN sizes sz ON sz.id = dvs.size_id
     GROUP BY d.id ORDER BY d.id`
  );
  return res.json({ success: true, data: rows });
});

router.post('/designs', requireRole(['admin']), async (req, res) => {
  const { code, description, validSizeIds } = req.body;
  const { rows } = await query(`INSERT INTO designs (code, description) VALUES ($1,$2) RETURNING *`, [code, description || null]);
  if (Array.isArray(validSizeIds)) {
    for (const sizeId of validSizeIds) {
      await query(`INSERT INTO design_valid_sizes (design_id, size_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [rows[0].id, sizeId]);
    }
  }
  await req.audit({ tableName: 'designs', recordId: rows[0].id, action: 'INSERT', after: rows[0] });
  return res.status(201).json({ success: true, data: rows[0] });
});

router.patch('/designs/:id', requireRole(['admin']), async (req, res) => {
  const { code, description, status, validSizeIds } = req.body;
  const sets = [];
  const values = [];
  if (code !== undefined) { values.push(code); sets.push(`code = $${values.length}`); }
  if (description !== undefined) { values.push(description); sets.push(`description = $${values.length}`); }
  if (status !== undefined) { values.push(status); sets.push(`status = $${values.length}`); }
  let design;
  if (sets.length) {
    values.push(req.params.id);
    const { rows } = await query(`UPDATE designs SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Design not found.' } });
    design = rows[0];
  } else {
    const { rows } = await query(`SELECT * FROM designs WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Design not found.' } });
    design = rows[0];
  }
  // Replace the valid-sizes set when provided.
  if (Array.isArray(validSizeIds)) {
    await query(`DELETE FROM design_valid_sizes WHERE design_id = $1`, [design.id]);
    for (const sizeId of validSizeIds) {
      await query(`INSERT INTO design_valid_sizes (design_id, size_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [design.id, sizeId]);
    }
  }
  await req.audit({ tableName: 'designs', recordId: design.id, action: 'UPDATE', after: design });
  return res.json({ success: true, data: design });
});

router.delete('/designs/:id', requireRole(['admin']), async (req, res) => {
  const { rows } = await query(`UPDATE designs SET status = 'archived' WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Design not found.' } });
  await req.audit({ tableName: 'designs', recordId: req.params.id, action: 'UPDATE', after: { status: 'archived' } });
  return res.json({ success: true, data: rows[0] });
});

router.get('/designs/validity-matrix', async (req, res) => {
  const { rows } = await query(
    `SELECT sz.size_mm, d.code AS design_code, true AS valid
     FROM design_valid_sizes dvs JOIN sizes sz ON sz.id = dvs.size_id JOIN designs d ON d.id = dvs.design_id`
  );
  return res.json({ success: true, data: rows });
});

// Grinding machine rules — read-only list + Admin edit
router.get('/grinding-rules', async (req, res) => {
  const { rows } = await query(
    `SELECT gmr.*, wt.code AS workstation_code FROM grinding_machine_rules gmr JOIN workstation_types wt ON wt.id = gmr.workstation_type_id`
  );
  return res.json({ success: true, data: rows });
});

router.patch('/grinding-rules/:id', requireRole(['admin']), async (req, res) => {
  const { maxLengthMm, barsPerSet, bedLengthMm } = req.body;
  const sets = []; const params = []; let p = 1;
  if (maxLengthMm !== undefined) { sets.push(`max_length_mm = $${p++}`); params.push(maxLengthMm); }
  if (barsPerSet !== undefined) { sets.push(`bars_per_set = $${p++}`); params.push(barsPerSet); }
  if (bedLengthMm !== undefined) { sets.push(`bed_length_mm = $${p++}`); params.push(bedLengthMm); }
  if (!sets.length) return res.status(400).json({ success: false, error: { code: 'NO_FIELDS', message: 'No fields provided.' } });
  params.push(req.params.id);
  const { rows } = await query(`UPDATE grinding_machine_rules SET ${sets.join(', ')} WHERE id = $${p} RETURNING *`, params);
  await req.audit({ tableName: 'grinding_machine_rules', recordId: req.params.id, action: 'UPDATE', after: rows[0] });
  return res.json({ success: true, data: rows[0] });
});

module.exports = router;
