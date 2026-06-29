import { Router } from 'express';
import { query, one } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireManager, requireAdmin, HttpError } from '../middleware/auth.js';
import { UID_SELECT, serializeUid } from '../utils/serializers.js';

const router = Router();

// ── Manufacturing Orders ───────────────────────────────────────────────────
async function moOut(m) {
  const cnt = await one('SELECT COUNT(*)::int AS n FROM uids WHERE mo_id = $1', [m.id]);
  return {
    id: m.id,
    mo_number: m.mo_number,
    customer: m.customer,
    quantity: m.quantity,
    status: m.status,
    size_id: m.size_id,
    size_mm: m.size_mm,
    design_id: m.design_id,
    design_code: m.design_code,
    uid_count: cnt.n,
    notes: m.notes,
    created_at: m.created_at,
  };
}

const MO_SELECT = `
  SELECT mo.*, sz.value_mm AS size_mm, d.code AS design_code
  FROM manufacturing_orders mo
  LEFT JOIN sizes sz ON sz.id = mo.size_id
  LEFT JOIN designs d ON d.id = mo.design_id
`;

router.get(
  '/orders',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const rows = status
      ? await query(`${MO_SELECT} WHERE mo.status = $1 ORDER BY mo.id DESC`, [status])
      : await query(`${MO_SELECT} ORDER BY mo.id DESC`);
    res.json(await Promise.all(rows.map(moOut)));
  })
);

router.post(
  '/orders',
  requireManager,
  asyncHandler(async (req, res) => {
    const { mo_number, customer, quantity, size_id = null, design_id = null, notes = null } = req.body || {};
    const dup = await one('SELECT id FROM manufacturing_orders WHERE mo_number = $1', [mo_number]);
    if (dup) throw new HttpError(400, 'MO number already exists');
    const created = await one(
      `INSERT INTO manufacturing_orders (mo_number, customer, quantity, size_id, design_id, notes, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [mo_number, customer, quantity, size_id, design_id, notes, req.user.id]
    );
    const m = await one(`${MO_SELECT} WHERE mo.id = $1`, [created.id]);
    res.status(201).json(await moOut(m));
  })
);

router.get(
  '/orders/:moId/uids',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.moId, 10);
    const mo = await one('SELECT id FROM manufacturing_orders WHERE id = $1', [id]);
    if (!mo) throw new HttpError(404, 'MO not found');
    const rows = await query(`${UID_SELECT} WHERE u.mo_id = $1 ORDER BY u.id`, [id]);
    res.json(rows.map(serializeUid));
  })
);

router.patch(
  '/orders/:moId/status',
  requireManager,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.moId, 10);
    const status = req.query.status || (req.body && req.body.status);
    const mo = await one('SELECT id FROM manufacturing_orders WHERE id = $1', [id]);
    if (!mo) throw new HttpError(404, 'MO not found');
    await query('UPDATE manufacturing_orders SET status = $1 WHERE id = $2', [status, id]);
    const m = await one(`${MO_SELECT} WHERE mo.id = $1`, [id]);
    res.json(await moOut(m));
  })
);

// ── Conversion Patterns ────────────────────────────────────────────────────
function patternOut(p) {
  const outputs = p.output_lengths_mm || [];
  const numCuts = outputs.length - 1;
  const scrap = p.input_length_mm - outputs.reduce((a, b) => a + b, 0) - numCuts * p.kerf_mm;
  return {
    id: p.id,
    name: p.name,
    input_length_mm: p.input_length_mm,
    output_lengths_mm: outputs,
    kerf_mm: p.kerf_mm,
    num_cuts: numCuts,
    scrap_mm: scrap,
    is_active: p.is_active,
  };
}

router.get(
  '/patterns',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT * FROM conversion_patterns WHERE is_active = TRUE ORDER BY id');
    res.json(rows.map(patternOut));
  })
);

router.post(
  '/patterns',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, input_length_mm, output_lengths_mm, kerf_mm = 3 } = req.body || {};
    const scrap = input_length_mm - output_lengths_mm.reduce((a, b) => a + b, 0) - (output_lengths_mm.length - 1) * kerf_mm;
    if (scrap < 0) throw new HttpError(400, `Pattern results in negative scrap (${scrap}mm)`);
    const p = await one(
      'INSERT INTO conversion_patterns (name, input_length_mm, output_lengths_mm, kerf_mm) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, input_length_mm, JSON.stringify(output_lengths_mm), kerf_mm]
    );
    res.status(201).json(patternOut(p));
  })
);

router.patch(
  '/patterns/:patternId/archive',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.patternId, 10);
    const p = await one('SELECT id FROM conversion_patterns WHERE id = $1', [id]);
    if (!p) throw new HttpError(404, 'Pattern not found');
    await query('UPDATE conversion_patterns SET is_active = FALSE WHERE id = $1', [id]);
    res.json({ archived: true });
  })
);

export default router;
