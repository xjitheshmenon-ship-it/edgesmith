// Master-list management: workstation units + app settings (Admin).
import { Router } from 'express';
import { query, one } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireAdmin, HttpError } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';

const router = Router();

const UNIT_SELECT = `
  SELECT u.*, w.code AS workstation_code, w.name AS workstation_name, fl.code AS location_code
  FROM workstation_units u
  LEFT JOIN workstations w ON w.id = u.workstation_id
  LEFT JOIN factory_locations fl ON fl.id = u.factory_location_id
`;

function unitOut(u) {
  return {
    id: u.id,
    unit_code: u.unit_code,
    workstation_id: u.workstation_id,
    workstation_code: u.workstation_code,
    workstation_name: u.workstation_name,
    name: u.name,
    factory_location_id: u.factory_location_id,
    location_code: u.location_code,
    status: u.status,
    created_at: u.created_at,
  };
}

// ── Workstation units ───────────────────────────────────────────────────────
router.get(
  '/workstation-units',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { workstation_id, status } = req.query;
    const conds = [];
    const params = [];
    if (workstation_id) { params.push(parseInt(workstation_id, 10)); conds.push(`u.workstation_id = $${params.length}`); }
    if (status) { params.push(status); conds.push(`u.status = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await query(`${UNIT_SELECT} ${where} ORDER BY u.unit_code`, params);
    res.json(rows.map(unitOut));
  })
);

router.post(
  '/workstation-units',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { unit_code, workstation_id, name = null, factory_location_id = null, status = 'active' } = req.body || {};
    if (!unit_code || !workstation_id) throw new HttpError(400, 'unit_code and workstation_id are required');
    const created = await one(
      `INSERT INTO workstation_units (unit_code, workstation_id, name, factory_location_id, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [unit_code, workstation_id, name, factory_location_id, status]
    );
    const u = await one(`${UNIT_SELECT} WHERE u.id = $1`, [created.id]);
    await writeAudit(req.user.id, 'create', 'workstation_units', created.id, null, unitOut(u));
    res.status(201).json(unitOut(u));
  })
);

router.patch(
  '/workstation-units/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await one('SELECT id FROM workstation_units WHERE id = $1', [id]);
    if (!existing) throw new HttpError(404, 'Workstation unit not found');
    const sets = [];
    const vals = [];
    let i = 1;
    for (const f of ['unit_code', 'workstation_id', 'name', 'factory_location_id', 'status']) {
      if (req.body[f] !== undefined && req.body[f] !== null) { sets.push(`${f} = $${i++}`); vals.push(req.body[f]); }
    }
    if (sets.length) { vals.push(id); await query(`UPDATE workstation_units SET ${sets.join(', ')} WHERE id = $${i}`, vals); }
    const u = await one(`${UNIT_SELECT} WHERE u.id = $1`, [id]);
    res.json(unitOut(u));
  })
);

router.delete(
  '/workstation-units/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const u = await one('SELECT id FROM workstation_units WHERE id = $1', [id]);
    if (!u) throw new HttpError(404, 'Workstation unit not found');
    await query("UPDATE workstation_units SET status = 'archived' WHERE id = $1", [id]);
    res.json({ archived: true });
  })
);

// ── App settings ────────────────────────────────────────────────────────────
router.get(
  '/settings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT key, value, updated_at FROM app_settings ORDER BY key');
    res.json(rows);
  })
);

router.patch(
  '/settings/:key',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { key } = req.params;
    const value = req.body?.value;
    if (value === undefined) throw new HttpError(400, 'value is required');
    await query(
      `INSERT INTO app_settings (key, value, updated_by_id) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by_id = EXCLUDED.updated_by_id`,
      [key, JSON.stringify(value), req.user.id]
    );
    const row = await one('SELECT key, value, updated_at FROM app_settings WHERE key = $1', [key]);
    res.json(row);
  })
);

export default router;
