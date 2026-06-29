// Grinding batch helpers: machine list, batch validation, and pairing/bunch
// suggestions for the supervisor building grinding runs.
import { Router } from 'express';
import { query, one } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireSupervisor, HttpError } from '../middleware/auth.js';
import { validateGrindingBatch, suggestPairings, suggestBunchRuns } from '../utils/grinding.js';

const router = Router();

// Resolve a set of bar items ({id, code, length}) from explicit lengths or uid_ids.
async function resolveItems(body) {
  if (Array.isArray(body.items) && body.items.length) {
    return body.items.map((it) => ({ id: it.id ?? null, code: it.code ?? null, length: Number(it.length) }));
  }
  if (Array.isArray(body.lengths) && body.lengths.length) {
    return body.lengths.map((l, i) => ({ id: null, code: null, length: Number(l), idx: i }));
  }
  if (Array.isArray(body.uid_ids) && body.uid_ids.length) {
    const rows = await query(
      `SELECT u.id, u.code, s.value_mm AS length FROM uids u
         LEFT JOIN sizes s ON s.id = u.size_id WHERE u.id = ANY($1)`,
      [body.uid_ids]
    );
    const missing = rows.filter((r) => r.length == null).map((r) => r.code);
    if (missing.length) {
      throw new HttpError(400, `UIDs without a known length (set size first or pass lengths): ${missing.join(', ')}`);
    }
    return rows.map((r) => ({ id: r.id, code: r.code, length: Number(r.length) }));
  }
  throw new HttpError(400, 'Provide items, lengths, or uid_ids');
}

async function machineMaxFor(workstationId) {
  const w = await one('SELECT id, code, name, max_bar_length_mm FROM workstations WHERE id = $1', [workstationId]);
  if (!w) throw new HttpError(404, 'Workstation not found');
  if (w.max_bar_length_mm == null) throw new HttpError(400, `${w.code} is not a length-limited grinding machine`);
  return w;
}

async function settingNumber(key, fallback) {
  const row = await one('SELECT value FROM app_settings WHERE key = $1', [key]);
  return row ? Number(row.value) : fallback;
}

// List grinding machines with their length limit + active unit count.
router.get(
  '/machines',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT w.id, w.code, w.name, w.max_bar_length_mm,
              (SELECT COUNT(*)::int FROM workstation_units wu WHERE wu.workstation_id = w.id AND wu.status = 'active') AS active_units
         FROM workstations w
        WHERE w.max_bar_length_mm IS NOT NULL AND w.is_active = TRUE
        ORDER BY w.code`
    );
    res.json(rows);
  })
);

// Validate a proposed grinding batch on a given machine.
router.post(
  '/validate',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const w = await machineMaxFor(req.body.workstation_id);
    const items = await resolveItems(req.body);
    const result = validateGrindingBatch(w.max_bar_length_mm, items.map((it) => it.length));
    res.json({ workstation_code: w.code, items, ...result });
  })
);

// Suggest combined pairings for surface/angle grinding.
router.post(
  '/suggest',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const w = await machineMaxFor(req.body.workstation_id);
    const items = await resolveItems(req.body);
    res.json({ workstation_code: w.code, ...suggestPairings(w.max_bar_length_mm, items) });
  })
);

// Suggest bunch-grinding runs (Step 4, SG-DLT). bars_per_set is admin-configurable.
router.post(
  '/bunch-suggest',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const items = await resolveItems(req.body);
    const barsPerSet = req.body.bars_per_set != null
      ? parseInt(req.body.bars_per_set, 10)
      : await settingNumber('bunch_grinding_bars_per_set', 5);
    const bedMm = await settingNumber('bunch_grinding_bed_mm', 3000);
    res.json(suggestBunchRuns(barsPerSet, bedMm, items));
  })
);

export default router;
