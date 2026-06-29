import { Router } from 'express';
import { query, one, tx } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireManager, requireSupervisor, requireOperator, HttpError } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { UID_SELECT, serializeUid, getUid } from '../utils/serializers.js';
import { bulkCreateUids, completeStep, doConverting, qcSignoff } from '../services/uidService.js';

const router = Router();

// ── Lookup (service team + all) ────────────────────────────────────────────
router.get(
  '/lookup/:code',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await getUid({ code: req.params.code.toUpperCase(), includeHistory: true });
    if (!data) throw new HttpError(404, 'UID not found');
    res.json(data);
  })
);

// ── Operator queue ─────────────────────────────────────────────────────────
router.get(
  '/queue/operator',
  requireAuth,
  asyncHandler(async (req, res) => {
    const locId = req.query.location_id ? parseInt(req.query.location_id, 10) : req.user.primary_location_id;
    const params = [];
    let where = "u.status = 'active'";
    if (locId) {
      params.push(locId);
      where += ` AND u.factory_location_id = $${params.length}`;
    }
    const rows = await query(
      `${UID_SELECT} WHERE ${where} ORDER BY u.priority DESC, u.created_at LIMIT 200`,
      params
    );
    res.json(rows.map(serializeUid));
  })
);

// ── QC pending queue ─────────────────────────────────────────────────────────
// UIDs whose current step is a QC step and which are still active.
// Ordered before the /:id routes so /qc/pending is matched as a literal path.
router.get(
  '/qc/pending',
  requireAuth,
  asyncHandler(async (req, res) => {
    const params = [];
    let where = "u.status = 'active' AND cs.is_qc_step = TRUE";
    if (req.query.location_id) {
      params.push(parseInt(req.query.location_id, 10));
      where += ` AND u.factory_location_id = $${params.length}`;
    }
    const rows = await query(
      `${UID_SELECT} WHERE ${where} ORDER BY u.priority DESC, u.created_at LIMIT 200`,
      params
    );
    res.json(rows.map(serializeUid));
  })
);

// ── QC sign-off ──────────────────────────────────────────────────────────────
router.post(
  '/:uidId/qc-signoff',
  requireOperator,
  asyncHandler(async (req, res) => {
    const uidId = parseInt(req.params.uidId, 10);
    const b = req.body || {};
    if (!['pass', 'fail', 'borderline'].includes(b.result)) {
      throw new HttpError(400, "result must be 'pass', 'fail', or 'borderline'");
    }
    await qcSignoff({
      uidId,
      performedById: req.user.id,
      result: b.result,
      values: b.values ?? null,
      notes: b.notes ?? null,
      workstationId: b.workstation_id ?? null,
    });
    await writeAudit(req.user.id, 'qc-signoff', 'uids', uidId, null, { result: b.result });
    res.json(await getUid({ id: uidId }));
  })
);

// ── List / search ──────────────────────────────────────────────────────────
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { location_id, cycle_type_id, status, search } = req.query;
    const skip = parseInt(req.query.skip || '0', 10);
    const limit = parseInt(req.query.limit || '100', 10);

    const conds = [];
    const params = [];
    if (location_id) { params.push(parseInt(location_id, 10)); conds.push(`u.factory_location_id = $${params.length}`); }
    if (cycle_type_id) { params.push(parseInt(cycle_type_id, 10)); conds.push(`u.cycle_type_id = $${params.length}`); }
    if (status) { params.push(status); conds.push(`u.status = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conds.push(`u.code ILIKE $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const totalRow = await one(`SELECT COUNT(*)::int AS n FROM uids u ${where}`, params);
    const rows = await query(
      `${UID_SELECT} ${where} ORDER BY u.id DESC OFFSET $${params.length + 1} LIMIT $${params.length + 2}`,
      [...params, skip, limit]
    );
    res.json({ total: totalRow.n, items: rows.map(serializeUid) });
  })
);

// ── Bulk create ────────────────────────────────────────────────────────────
router.post(
  '/bulk-create',
  requireManager,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!b.quantity || b.quantity < 1 || b.quantity > 500) throw new HttpError(400, 'Quantity must be 1–500');
    const uids = await bulkCreateUids({
      quantity: b.quantity,
      cycleTypeId: b.cycle_type_id,
      factoryLocationId: b.factory_location_id,
      createdById: req.user.id,
      productTypeId: b.product_type_id ?? null,
      sizeId: b.size_id ?? null,
      designId: b.design_id ?? null,
      priority: b.priority ?? 'normal',
      moId: b.mo_id ?? null,
      receivingEventId: b.receiving_event_id ?? null,
    });
    await writeAudit(req.user.id, 'bulk-create', 'uids', null, null, { codes: uids.map((u) => u.code) });
    res.status(201).json({ created: uids.length, uids });
  })
);

// ── Bulk cycle change (before any steps) ───────────────────────────────────
router.post(
  '/bulk-change-cycle',
  requireManager,
  asyncHandler(async (req, res) => {
    const { uid_ids = [], new_cycle_type_id } = req.body || {};
    const updated = await tx(async (c) => {
      const newVersion = await c.one(
        'SELECT * FROM cycle_versions WHERE cycle_type_id = $1 AND is_current = TRUE',
        [new_cycle_type_id]
      );
      if (!newVersion) throw new HttpError(404, 'Cycle type or version not found');
      const out = [];
      for (const uidId of uid_ids) {
        const uid = await c.one('SELECT * FROM uids WHERE id = $1', [uidId]);
        if (!uid) continue;
        const hist = await c.one('SELECT 1 FROM uid_step_history WHERE uid_id = $1 LIMIT 1', [uidId]);
        if (hist) throw new HttpError(400, `UID ${uid.code} has steps completed — cannot change cycle`);
        await c.query('UPDATE uids SET cycle_type_id = $1, cycle_version_id = $2 WHERE id = $3', [
          new_cycle_type_id,
          newVersion.id,
          uidId,
        ]);
        out.push(uid.code);
      }
      return out;
    });
    res.json({ updated });
  })
);

// ── Step completion ────────────────────────────────────────────────────────
router.post(
  '/:uidId/complete-step',
  requireOperator,
  asyncHandler(async (req, res) => {
    const uidId = parseInt(req.params.uidId, 10);
    const b = req.body || {};
    await completeStep({
      uidId,
      performedById: req.user.id,
      workstationId: b.workstation_id,
      qcResult: b.qc_result ?? null,
      qcValues: b.qc_values ?? null,
      notes: b.notes ?? null,
    });
    res.json(await getUid({ id: uidId }));
  })
);

// ── Converting ─────────────────────────────────────────────────────────────
router.post(
  '/:uidId/convert',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const uidId = parseInt(req.params.uidId, 10);
    const b = req.body || {};
    const childIds = await doConverting({
      parentUidId: uidId,
      supervisorId: req.user.id,
      children: b.children || [],
      patternId: b.pattern_id ?? null,
    });
    const children = [];
    for (const id of childIds) children.push(await getUid({ id }));
    await writeAudit(req.user.id, 'convert', 'uids', uidId, null, { children: children.map((c) => c.code) });
    res.json({ parent_uid_id: uidId, children });
  })
);

// ── Design confirmation ────────────────────────────────────────────────────
router.post(
  '/:uidId/confirm-design',
  requireManager,
  asyncHandler(async (req, res) => {
    const uidId = parseInt(req.params.uidId, 10);
    const { design_id, size_id = null } = req.body || {};
    const uid = await one('SELECT * FROM uids WHERE id = $1', [uidId]);
    if (!uid) throw new HttpError(404, 'UID not found');
    if (uid.design_locked) throw new HttpError(400, 'Design is locked — cannot change after Step 17');

    let setSize = '';
    const params = [design_id];
    if (size_id) {
      const valid = await one(
        'SELECT 1 FROM design_size_validity WHERE design_id = $1 AND size_id = $2',
        [design_id, size_id]
      );
      if (!valid) throw new HttpError(400, 'Invalid design-size combination');
      params.push(size_id);
      setSize = `, size_id = $${params.length}`;
    }
    const statusReset = uid.status === 'on_hold' ? ", status = 'active'" : '';
    params.push(uidId);
    await query(
      `UPDATE uids SET design_id = $1, design_confirmed = TRUE${setSize}${statusReset} WHERE id = $${params.length}`,
      params
    );
    await writeAudit(req.user.id, 'confirm-design', 'uids', uidId, { design_id: uid.design_id }, { design_id });
    res.json(await getUid({ id: uidId }));
  })
);

// ── MO linking ─────────────────────────────────────────────────────────────
router.post(
  '/:uidId/link-mo/:moId',
  requireManager,
  asyncHandler(async (req, res) => {
    const uidId = parseInt(req.params.uidId, 10);
    const moId = parseInt(req.params.moId, 10);
    const uid = await one('SELECT id FROM uids WHERE id = $1', [uidId]);
    if (!uid) throw new HttpError(404, 'UID not found');
    await query('UPDATE uids SET mo_id = $1 WHERE id = $2', [moId, uidId]);
    res.json({ uid_id: uidId, mo_id: moId });
  })
);

// ── Inter-location transfer ────────────────────────────────────────────────
router.post(
  '/:uidId/transfer',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const uidId = parseInt(req.params.uidId, 10);
    const { to_location_id, reason } = req.body || {};
    await tx(async (c) => {
      const uid = await c.one('SELECT * FROM uids WHERE id = $1', [uidId]);
      if (!uid) throw new HttpError(404, 'UID not found');
      await c.query(
        `INSERT INTO uid_transfers (uid_id, from_location_id, to_location_id, transferred_by_id, reason)
         VALUES ($1,$2,$3,$4,$5)`,
        [uidId, uid.factory_location_id, to_location_id, req.user.id, reason]
      );
      await c.query('UPDATE uids SET factory_location_id = $1 WHERE id = $2', [to_location_id, uidId]);
    });
    res.json({ transferred: true, new_location_id: to_location_id });
  })
);

export default router;
