import { Router } from 'express';
import { query, one } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireAdmin, HttpError } from '../middleware/auth.js';
import { createNewVersion, exportCycle } from '../services/cycleService.js';

const router = Router();

async function stepsForVersion(versionId) {
  const rows = await query(
    `SELECT cs.id, cs.step_number, cs.step_order, cs.operation_name,
            cs.workstation_id, w.code AS workstation_code, w.name AS workstation_name,
            cs.from_storage_id, fs.code AS from_storage_code,
            cs.to_storage_id, ts.code AS to_storage_code,
            cs.is_converting_step, cs.is_child_marking_step, cs.is_qc_step,
            cs.capacity_per_unit,
            (SELECT COUNT(*)::int FROM workstation_units wu
              WHERE wu.workstation_id = cs.workstation_id AND wu.status = 'active') AS active_units
       FROM cycle_steps cs
       LEFT JOIN workstations w ON w.id = cs.workstation_id
       LEFT JOIN storage_locations fs ON fs.id = cs.from_storage_id
       LEFT JOIN storage_locations ts ON ts.id = cs.to_storage_id
      WHERE cs.cycle_version_id = $1
      ORDER BY cs.step_order`,
    [versionId]
  );
  return rows.map((r) => ({
    ...r,
    total_capacity: r.capacity_per_unit != null ? r.capacity_per_unit * r.active_units : null,
  }));
}

async function versionOut(v) {
  return {
    id: v.id,
    version_number: v.version_number,
    is_current: v.is_current,
    created_at: v.created_at,
    change_notes: v.change_notes,
    steps: await stepsForVersion(v.id),
  };
}

async function cycleOut(c) {
  const current = await one(
    'SELECT * FROM cycle_versions WHERE cycle_type_id = $1 AND is_current = TRUE',
    [c.id]
  );
  const countRow = await one('SELECT COUNT(*)::int AS n FROM cycle_versions WHERE cycle_type_id = $1', [c.id]);
  return {
    id: c.id,
    name: c.name,
    letter_prefix: c.letter_prefix,
    description: c.description,
    is_active: c.is_active,
    is_archived: c.is_archived,
    current_version: current ? await versionOut(current) : null,
    version_count: countRow.n,
  };
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT * FROM cycle_types WHERE is_archived = FALSE ORDER BY id');
    res.json(await Promise.all(rows.map(cycleOut)));
  })
);

router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, letter_prefix, description = null } = req.body || {};
    const dup = await one('SELECT id FROM cycle_types WHERE letter_prefix = $1', [letter_prefix.toUpperCase()]);
    if (dup) throw new HttpError(400, 'Letter prefix already in use');
    const c = await one(
      'INSERT INTO cycle_types (name, letter_prefix, description) VALUES ($1,$2,$3) RETURNING *',
      [name, letter_prefix.toUpperCase(), description]
    );
    res.status(201).json(await cycleOut(c));
  })
);

router.post(
  '/import',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { data, update_existing = false } = req.body || {};
    const cycleName = data.cycle_name;
    const letterPrefix = data.cycle_letter_prefix;
    const stepsRaw = data.steps || [];

    let existing = await one('SELECT * FROM cycle_types WHERE name = $1', [cycleName]);
    if (existing && !update_existing) {
      throw new HttpError(400, `Cycle '${cycleName}' already exists. Set update_existing=true to create a new version.`);
    }

    const stepsData = [];
    for (const s of stepsRaw) {
      const ws = await one('SELECT id FROM workstations WHERE code = $1', [s.workstation_code]);
      const fromS = s.from_storage_code ? await one('SELECT id FROM storage_locations WHERE code = $1', [s.from_storage_code]) : null;
      const toS = s.to_storage_code ? await one('SELECT id FROM storage_locations WHERE code = $1', [s.to_storage_code]) : null;
      stepsData.push({
        ...s,
        workstation_id: ws ? ws.id : null,
        from_storage_id: fromS ? fromS.id : null,
        to_storage_id: toS ? toS.id : null,
      });
    }

    if (!existing) {
      existing = await one(
        'INSERT INTO cycle_types (name, letter_prefix, description) VALUES ($1,$2,$3) RETURNING *',
        [cycleName, letterPrefix, 'Imported from file']
      );
    }
    const versionId = await createNewVersion(existing.id, stepsData, req.user.id, 'Imported from file');
    const version = await one('SELECT * FROM cycle_versions WHERE id = $1', [versionId]);
    res.status(201).json({ cycle_id: existing.id, version_id: version.id, version_number: version.version_number });
  })
);

router.get(
  '/:cycleId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const c = await one('SELECT * FROM cycle_types WHERE id = $1', [parseInt(req.params.cycleId, 10)]);
    if (!c) throw new HttpError(404, 'Cycle not found');
    res.json(await cycleOut(c));
  })
);

router.get(
  '/:cycleId/versions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      'SELECT * FROM cycle_versions WHERE cycle_type_id = $1 ORDER BY version_number DESC',
      [parseInt(req.params.cycleId, 10)]
    );
    res.json(await Promise.all(rows.map(versionOut)));
  })
);

router.post(
  '/:cycleId/versions',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const cycleId = parseInt(req.params.cycleId, 10);
    const { steps = [], change_notes = null } = req.body || {};
    const versionId = await createNewVersion(cycleId, steps, req.user.id, change_notes);
    const version = await one('SELECT * FROM cycle_versions WHERE id = $1', [versionId]);
    res.status(201).json(await versionOut(version));
  })
);

router.get(
  '/:cycleId/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const versionId = req.query.version_id ? parseInt(req.query.version_id, 10) : null;
    const data = await exportCycle(parseInt(req.params.cycleId, 10), versionId);
    res.set('Content-Disposition', `attachment; filename="cycle_${data.cycle_name}_v${data.version_number}.json"`);
    res.json(data);
  })
);

export default router;
