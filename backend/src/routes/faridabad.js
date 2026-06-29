import { Router } from 'express';
import { query, one } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireAdmin, requireManager, HttpError } from '../middleware/auth.js';

const router = Router();

// ── Rolling Contractors ────────────────────────────────────────────────────
router.get(
  '/contractors',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT * FROM rolling_contractors WHERE is_active = TRUE ORDER BY id');
    res.json(rows.map((c) => ({ id: c.id, name: c.name, contact_info: c.contact_info, is_active: c.is_active })));
  })
);

router.post(
  '/contractors',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, contact_info = null } = req.body || {};
    const c = await one('INSERT INTO rolling_contractors (name, contact_info) VALUES ($1,$2) RETURNING *', [name, contact_info]);
    res.status(201).json({ id: c.id, name: c.name, contact_info: c.contact_info, is_active: c.is_active });
  })
);

router.patch(
  '/contractors/:contractorId/archive',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.contractorId, 10);
    const c = await one('SELECT id FROM rolling_contractors WHERE id = $1', [id]);
    if (!c) throw new HttpError(404, 'Contractor not found');
    await query('UPDATE rolling_contractors SET is_active = FALSE WHERE id = $1', [id]);
    res.json({ ok: true });
  })
);

// ── Serializers ────────────────────────────────────────────────────────────
function intakeOut(r) {
  return {
    id: r.id,
    material_type: r.material_type,
    supplier_name: r.supplier_name,
    heat_number: r.heat_number,
    steel_grade: r.steel_grade,
    weight_kg: r.weight_kg,
    date_received: r.date_received,
    num_bars: r.num_bars,
    bar_dimensions_mm: r.bar_dimensions_mm,
    notes: r.notes,
    created_at: r.created_at,
  };
}

function joiningOut(j) {
  return {
    id: j.id,
    alloy_intake_id: j.alloy_intake_id,
    alloy_heat_number: j.alloy_heat_number,
    alloy_supplier: j.alloy_supplier,
    ms_intake_id: j.ms_intake_id,
    ms_heat_number: j.ms_heat_number,
    ms_supplier: j.ms_supplier,
    num_billets_produced: j.num_billets_produced,
    output_billet_dimensions_mm: j.output_billet_dimensions_mm,
    operator_name: j.operator_name,
    date_joined: j.date_joined,
    notes: j.notes,
    created_at: j.created_at,
  };
}

function dispatchOut(d) {
  return {
    id: d.id,
    batch_reference: d.batch_reference,
    joining_operation_id: d.joining_operation_id,
    rolling_contractor_name: d.rolling_contractor_name,
    num_billets_dispatched: d.num_billets_dispatched,
    date_dispatched: d.date_dispatched,
    billet_dimensions_mm: d.billet_dimensions_mm,
    notes: d.notes,
    created_at: d.created_at,
    receiving_count: d.receiving_count != null ? Number(d.receiving_count) : 0,
    total_received: d.total_received != null ? Number(d.total_received) : 0,
  };
}

function receivingOut(r) {
  return {
    id: r.id,
    faridabad_dispatch_id: r.faridabad_dispatch_id,
    batch_reference: r.batch_reference,
    rolling_contractor_name: r.rolling_contractor_name,
    date_received: r.date_received,
    num_billets_received: r.num_billets_received,
    condition: r.condition,
    received_by: r.received_by,
    notes: r.notes,
    created_at: r.created_at,
  };
}

const DISPATCH_SELECT = `
  SELECT d.*,
    (SELECT COUNT(*)::int FROM receiving_events r WHERE r.faridabad_dispatch_id = d.id) AS receiving_count,
    COALESCE((SELECT SUM(num_billets_received) FROM receiving_events r WHERE r.faridabad_dispatch_id = d.id), 0) AS total_received
  FROM faridabad_dispatches d
`;

const RECEIVING_SELECT = `
  SELECT r.*, d.batch_reference, d.rolling_contractor_name
  FROM receiving_events r
  LEFT JOIN faridabad_dispatches d ON d.id = r.faridabad_dispatch_id
`;

// ── Raw Material Intake ─────────────────────────────────────────────────────
router.get(
  '/intakes',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { material_type } = req.query;
    const rows = material_type
      ? await query('SELECT * FROM raw_material_intakes WHERE material_type = $1 ORDER BY date_received DESC', [material_type])
      : await query('SELECT * FROM raw_material_intakes ORDER BY date_received DESC');
    res.json(rows.map(intakeOut));
  })
);

router.post(
  '/intakes',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const r = await one(
      `INSERT INTO raw_material_intakes
         (material_type, supplier_name, heat_number, steel_grade, weight_kg, date_received, num_bars, bar_dimensions_mm, notes, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [b.material_type, b.supplier_name, b.heat_number, b.steel_grade, b.weight_kg ?? null, b.date_received, b.num_bars ?? null, b.bar_dimensions_mm ?? null, b.notes ?? null, req.user.id]
    );
    res.status(201).json(intakeOut(r));
  })
);

// ── Joining Operations ──────────────────────────────────────────────────────
const JOINING_SELECT = `
  SELECT j.*,
    a.heat_number AS alloy_heat_number, a.supplier_name AS alloy_supplier,
    m.heat_number AS ms_heat_number, m.supplier_name AS ms_supplier
  FROM joining_operations j
  LEFT JOIN raw_material_intakes a ON a.id = j.alloy_intake_id
  LEFT JOIN raw_material_intakes m ON m.id = j.ms_intake_id
`;

router.get(
  '/joinings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(`${JOINING_SELECT} ORDER BY j.date_joined DESC`);
    res.json(rows.map(joiningOut));
  })
);

router.post(
  '/joinings',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const alloy = await one("SELECT id FROM raw_material_intakes WHERE id = $1 AND material_type = 'Alloy Steel'", [b.alloy_intake_id]);
    const ms = await one("SELECT id FROM raw_material_intakes WHERE id = $1 AND material_type = 'MS'", [b.ms_intake_id]);
    if (!alloy) throw new HttpError(400, 'Alloy steel intake not found');
    if (!ms) throw new HttpError(400, 'MS intake not found');
    const created = await one(
      `INSERT INTO joining_operations
         (alloy_intake_id, ms_intake_id, num_billets_produced, output_billet_dimensions_mm, operator_name, date_joined, notes, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [b.alloy_intake_id, b.ms_intake_id, b.num_billets_produced, b.output_billet_dimensions_mm ?? null, b.operator_name ?? null, b.date_joined, b.notes ?? null, req.user.id]
    );
    const j = await one(`${JOINING_SELECT} WHERE j.id = $1`, [created.id]);
    res.status(201).json(joiningOut(j));
  })
);

// ── Dispatch ────────────────────────────────────────────────────────────────
router.get(
  '/dispatches',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(`${DISPATCH_SELECT} ORDER BY d.date_dispatched DESC`);
    res.json(rows.map(dispatchOut));
  })
);

router.get(
  '/dispatches/:dispatchId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.dispatchId, 10);
    const d = await one(`${DISPATCH_SELECT} WHERE d.id = $1`, [id]);
    if (!d) throw new HttpError(404, 'Dispatch not found');
    const events = await query(`${RECEIVING_SELECT} WHERE r.faridabad_dispatch_id = $1 ORDER BY r.date_received`, [id]);
    res.json({ ...dispatchOut(d), receiving_events: events.map(receivingOut) });
  })
);

router.post(
  '/dispatches',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const countRow = await one('SELECT COUNT(*)::int AS n FROM faridabad_dispatches');
    const dateRow = await one("SELECT to_char(now(), 'YYYYMMDD') AS d");
    const batchRef = `FAR-${dateRow.d}-${String(countRow.n + 1).padStart(4, '0')}`;
    const created = await one(
      `INSERT INTO faridabad_dispatches
         (batch_reference, joining_operation_id, rolling_contractor_name, num_billets_dispatched, date_dispatched, billet_dimensions_mm, notes, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [batchRef, b.joining_operation_id, b.rolling_contractor_name, b.num_billets_dispatched, b.date_dispatched, b.billet_dimensions_mm ?? null, b.notes ?? null, req.user.id]
    );
    const d = await one(`${DISPATCH_SELECT} WHERE d.id = $1`, [created.id]);
    res.status(201).json(dispatchOut(d));
  })
);

// ── Receiving Events ────────────────────────────────────────────────────────
router.get(
  '/receivings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(`${RECEIVING_SELECT} ORDER BY r.date_received DESC`);
    res.json(rows.map(receivingOut));
  })
);

router.post(
  '/receivings',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const d = await one('SELECT id FROM faridabad_dispatches WHERE id = $1', [b.faridabad_dispatch_id]);
    if (!d) throw new HttpError(404, 'Dispatch not found');
    const created = await one(
      `INSERT INTO receiving_events
         (faridabad_dispatch_id, date_received, num_billets_received, condition, received_by, notes, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [b.faridabad_dispatch_id, b.date_received, b.num_billets_received, b.condition ?? null, b.received_by ?? null, b.notes ?? null, req.user.id]
    );
    const r = await one(`${RECEIVING_SELECT} WHERE r.id = $1`, [created.id]);
    res.status(201).json(receivingOut(r));
  })
);

export default router;
