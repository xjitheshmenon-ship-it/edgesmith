import { Router } from 'express';
import { query, one } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireAdmin, HttpError } from '../middleware/auth.js';

const router = Router();

function wsOut(w) {
  return {
    id: w.id,
    code: w.code,
    name: w.name,
    category: w.category,
    is_active: w.is_active,
    factory_location_id: w.factory_location_id,
  };
}

// ── Factory Locations ──────────────────────────────────────────────────────
router.get(
  '/locations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT * FROM factory_locations WHERE is_active = TRUE ORDER BY id');
    res.json(rows.map((l) => ({ id: l.id, code: l.code, name: l.name })));
  })
);

router.post(
  '/locations',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { code, name } = req.body || {};
    const l = await one('INSERT INTO factory_locations (code, name) VALUES ($1,$2) RETURNING *', [code, name]);
    res.status(201).json({ id: l.id, code: l.code, name: l.name });
  })
);

router.patch(
  '/locations/:locId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.locId, 10);
    const loc = await one('SELECT * FROM factory_locations WHERE id = $1', [id]);
    if (!loc) throw new HttpError(404, 'Location not found');
    const sets = [];
    const vals = [];
    let i = 1;
    for (const f of ['name', 'code']) {
      if (req.body[f] !== undefined && req.body[f] !== null) {
        sets.push(`${f} = $${i++}`);
        vals.push(req.body[f]);
      }
    }
    if (sets.length) {
      vals.push(id);
      await query(`UPDATE factory_locations SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    }
    const l = await one('SELECT * FROM factory_locations WHERE id = $1', [id]);
    res.json({ id: l.id, code: l.code, name: l.name });
  })
);

// ── Workstations ───────────────────────────────────────────────────────────
router.get(
  '/workstations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const locationId = req.query.location_id ? parseInt(req.query.location_id, 10) : null;
    let rows;
    if (locationId) {
      rows = await query(
        'SELECT * FROM workstations WHERE is_active = TRUE AND (factory_location_id = $1 OR factory_location_id IS NULL) ORDER BY id',
        [locationId]
      );
    } else {
      rows = await query('SELECT * FROM workstations WHERE is_active = TRUE ORDER BY id');
    }
    res.json(rows.map(wsOut));
  })
);

router.post(
  '/workstations',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { code, name, category = 'Other', factory_location_id = null } = req.body || {};
    const w = await one(
      'INSERT INTO workstations (code, name, category, factory_location_id) VALUES ($1,$2,$3,$4) RETURNING *',
      [code, name, category, factory_location_id]
    );
    res.status(201).json(wsOut(w));
  })
);

router.patch(
  '/workstations/:wsId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.wsId, 10);
    const ws = await one('SELECT * FROM workstations WHERE id = $1', [id]);
    if (!ws) throw new HttpError(404, 'Workstation not found');
    const sets = [];
    const vals = [];
    let i = 1;
    for (const f of ['name', 'category', 'factory_location_id', 'is_active']) {
      if (req.body[f] !== undefined && req.body[f] !== null) {
        sets.push(`${f} = $${i++}`);
        vals.push(req.body[f]);
      }
    }
    if (sets.length) {
      vals.push(id);
      await query(`UPDATE workstations SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    }
    const w = await one('SELECT * FROM workstations WHERE id = $1', [id]);
    res.json(wsOut(w));
  })
);

// ── Storage Locations ──────────────────────────────────────────────────────
router.get(
  '/storage',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT * FROM storage_locations WHERE is_active = TRUE ORDER BY id');
    res.json(rows.map((l) => ({ id: l.id, code: l.code, name: l.name, factory_location_id: l.factory_location_id })));
  })
);

router.post(
  '/storage',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { code, name = null, factory_location_id = null } = req.body || {};
    const s = await one(
      'INSERT INTO storage_locations (code, name, factory_location_id) VALUES ($1,$2,$3) RETURNING *',
      [code, name, factory_location_id]
    );
    res.status(201).json({ id: s.id, code: s.code, name: s.name, factory_location_id: s.factory_location_id });
  })
);

export default router;
