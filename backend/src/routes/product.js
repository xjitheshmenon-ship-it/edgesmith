import { Router } from 'express';
import { query, one, tx } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireAdmin, HttpError } from '../middleware/auth.js';

const router = Router();

// ── Sizes ──────────────────────────────────────────────────────────────────
router.get(
  '/sizes',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT * FROM sizes WHERE is_active = TRUE ORDER BY value_mm');
    res.json(rows.map((s) => ({ id: s.id, value_mm: s.value_mm, is_active: s.is_active })));
  })
);

router.post(
  '/sizes',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { value_mm } = req.body || {};
    const s = await one('INSERT INTO sizes (value_mm) VALUES ($1) RETURNING *', [value_mm]);
    res.status(201).json({ id: s.id, value_mm: s.value_mm });
  })
);

// ── Designs ────────────────────────────────────────────────────────────────
async function designOut(d) {
  const valid = await query(
    `SELECT dv.size_id, s.value_mm FROM design_size_validity dv
       JOIN sizes s ON s.id = dv.size_id WHERE dv.design_id = $1`,
    [d.id]
  );
  return {
    id: d.id,
    code: d.code,
    description: d.description,
    is_active: d.is_active,
    valid_size_ids: valid.map((v) => v.size_id),
    valid_sizes_mm: valid.map((v) => v.value_mm),
  };
}

router.get(
  '/designs',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT * FROM designs WHERE is_active = TRUE ORDER BY id');
    res.json(await Promise.all(rows.map(designOut)));
  })
);

router.post(
  '/designs',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { code, description = null, valid_size_ids = [] } = req.body || {};
    const d = await tx(async (c) => {
      const design = await c.one('INSERT INTO designs (code, description) VALUES ($1,$2) RETURNING *', [code, description]);
      for (const sizeId of valid_size_ids) {
        await c.query('INSERT INTO design_size_validity (design_id, size_id) VALUES ($1,$2)', [design.id, sizeId]);
      }
      return design;
    });
    res.status(201).json(await designOut(d));
  })
);

router.put(
  '/designs/:designId/valid-sizes',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.designId, 10);
    const design = await one('SELECT * FROM designs WHERE id = $1', [id]);
    if (!design) throw new HttpError(404, 'Design not found');
    const sizeIds = Array.isArray(req.body) ? req.body : req.body.size_ids || [];
    await tx(async (c) => {
      await c.query('DELETE FROM design_size_validity WHERE design_id = $1', [id]);
      for (const sizeId of sizeIds) {
        await c.query('INSERT INTO design_size_validity (design_id, size_id) VALUES ($1,$2)', [id, sizeId]);
      }
    });
    res.json(await designOut(design));
  })
);

// ── Product Types ──────────────────────────────────────────────────────────
async function productTypeOut(p) {
  const cts = await query('SELECT cycle_type_id FROM product_cycle_types WHERE product_type_id = $1', [p.id]);
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    is_active: p.is_active,
    default_cycle_type_id: p.default_cycle_type_id,
    valid_cycle_type_ids: cts.map((c) => c.cycle_type_id),
  };
}

router.get(
  '/types',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT * FROM product_types WHERE is_active = TRUE ORDER BY id');
    res.json(await Promise.all(rows.map(productTypeOut)));
  })
);

router.post(
  '/types',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { code, name, valid_cycle_type_ids = [], default_cycle_type_id = null } = req.body || {};
    const p = await tx(async (c) => {
      const prod = await c.one(
        'INSERT INTO product_types (code, name, default_cycle_type_id) VALUES ($1,$2,$3) RETURNING *',
        [code, name, default_cycle_type_id]
      );
      for (const ctId of valid_cycle_type_ids) {
        await c.query('INSERT INTO product_cycle_types (product_type_id, cycle_type_id) VALUES ($1,$2)', [prod.id, ctId]);
      }
      return prod;
    });
    res.status(201).json(await productTypeOut(p));
  })
);

router.patch(
  '/types/:typeId/archive',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.typeId, 10);
    const p = await one('SELECT id FROM product_types WHERE id = $1', [id]);
    if (!p) throw new HttpError(404, 'Not found');
    await query('UPDATE product_types SET is_active = FALSE WHERE id = $1', [id]);
    res.json({ ok: true });
  })
);

export default router;
