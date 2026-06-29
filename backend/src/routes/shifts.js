import { Router } from 'express';
import { query, one, tx } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireRoles, HttpError } from '../middleware/auth.js';

const router = Router();
const requireSupervisor = requireRoles('admin', 'manager', 'supervisor');

const ASSIGN_SELECT = `
  SELECT a.*, w.code AS ws_code, w.name AS ws_name,
    op.username AS op_username, op.full_name AS op_full_name,
    ab.username AS assigned_by_username, cb.username AS confirmed_by_username
  FROM shift_assignments a
  LEFT JOIN workstations w ON w.id = a.workstation_id
  LEFT JOIN users op ON op.id = a.operator_id
  LEFT JOIN users ab ON ab.id = a.assigned_by_id
  LEFT JOIN users cb ON cb.id = a.confirmed_by_id
`;

function assignmentOut(a) {
  return {
    id: a.id,
    shift_date: a.shift_date,
    shift_period: a.shift_period,
    workstation_id: a.workstation_id,
    workstation_code: a.ws_code,
    workstation_name: a.ws_name,
    operator_id: a.operator_id,
    operator_username: a.op_username,
    operator_full_name: a.op_full_name,
    assigned_by: a.assigned_by_username,
    confirmed_by: a.confirmed_by_username,
    notes: a.notes,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

const ALLOT_SELECT = `
  SELECT j.*, u.code AS uid_code, u.status AS uid_status,
    cs.step_number AS current_step, cs.operation_name AS current_step_name,
    fs.code AS from_storage_code, ts.code AS to_storage_code,
    op.username AS op_username, op.full_name AS op_full_name,
    w.code AS ws_code, w.name AS ws_name, ab.username AS allotted_by_username
  FROM job_allotments j
  LEFT JOIN uids u ON u.id = j.uid_id
  LEFT JOIN cycle_steps cs ON cs.id = u.current_step_id
  LEFT JOIN storage_locations fs ON fs.id = cs.from_storage_id
  LEFT JOIN storage_locations ts ON ts.id = cs.to_storage_id
  LEFT JOIN users op ON op.id = j.operator_id
  LEFT JOIN workstations w ON w.id = j.workstation_id
  LEFT JOIN users ab ON ab.id = j.allotted_by_id
`;

function allotmentOut(j) {
  return {
    id: j.id,
    uid_id: j.uid_id,
    uid_code: j.uid_code,
    uid_status: j.uid_status,
    current_step: j.current_step,
    current_step_name: j.current_step_name,
    from_storage_code: j.from_storage_code,
    to_storage_code: j.to_storage_code,
    operator_id: j.operator_id,
    operator_username: j.op_username,
    operator_full_name: j.op_full_name,
    workstation_id: j.workstation_id,
    workstation_code: j.ws_code,
    workstation_name: j.ws_name,
    allotted_by: j.allotted_by_username,
    notes: j.notes,
    is_active: !!j.is_active,
    created_at: j.created_at,
  };
}

// ── Shift Assignments ───────────────────────────────────────────────────────
router.get(
  '/assignments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { shift_date, shift_period, workstation_id, location_id } = req.query;
    const conds = [];
    const params = [];
    if (shift_date) { params.push(shift_date); conds.push(`a.shift_date = $${params.length}`); }
    if (shift_period) { params.push(shift_period); conds.push(`a.shift_period = $${params.length}`); }
    if (workstation_id) { params.push(parseInt(workstation_id, 10)); conds.push(`a.workstation_id = $${params.length}`); }
    if (location_id) {
      params.push(parseInt(location_id, 10));
      conds.push(`a.workstation_id IN (SELECT id FROM workstations WHERE factory_location_id = $${params.length} OR factory_location_id IS NULL)`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await query(`${ASSIGN_SELECT} ${where} ORDER BY a.shift_date, a.shift_period`, params);
    res.json(rows.map(assignmentOut));
  })
);

router.post(
  '/assignments',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const d = req.body || {};
    const operator = await one('SELECT id, role FROM users WHERE id = $1', [d.operator_id]);
    if (!operator || operator.role !== 'operator') throw new HttpError(400, 'Selected user is not an operator');

    const canConfirm = ['admin', 'supervisor'].includes(req.user.role);
    const existing = await one(
      'SELECT id FROM shift_assignments WHERE shift_date = $1 AND shift_period = $2 AND workstation_id = $3',
      [d.shift_date, d.shift_period, d.workstation_id]
    );

    let id;
    if (existing) {
      await query(
        `UPDATE shift_assignments SET operator_id = $1, assigned_by_id = $2, notes = $3,
           confirmed_by_id = $4, updated_at = now() WHERE id = $5`,
        [d.operator_id, req.user.id, d.notes ?? null, canConfirm ? req.user.id : null, existing.id]
      );
      id = existing.id;
    } else {
      const created = await one(
        `INSERT INTO shift_assignments (shift_date, shift_period, workstation_id, operator_id, assigned_by_id, confirmed_by_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [d.shift_date, d.shift_period, d.workstation_id, d.operator_id, req.user.id, canConfirm ? req.user.id : null, d.notes ?? null]
      );
      id = created.id;
    }
    const a = await one(`${ASSIGN_SELECT} WHERE a.id = $1`, [id]);
    res.json(assignmentOut(a));
  })
);

router.post(
  '/assignments/:assignmentId/confirm',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.assignmentId, 10);
    const a = await one('SELECT id FROM shift_assignments WHERE id = $1', [id]);
    if (!a) throw new HttpError(404, 'Assignment not found');
    if (!['admin', 'supervisor'].includes(req.user.role)) throw new HttpError(403, 'Only supervisors can confirm assignments');
    await query('UPDATE shift_assignments SET confirmed_by_id = $1 WHERE id = $2', [req.user.id, id]);
    const row = await one(`${ASSIGN_SELECT} WHERE a.id = $1`, [id]);
    res.json(assignmentOut(row));
  })
);

router.delete(
  '/assignments/:assignmentId',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.assignmentId, 10);
    const a = await one('SELECT id FROM shift_assignments WHERE id = $1', [id]);
    if (!a) throw new HttpError(404, 'Assignment not found');
    await query('DELETE FROM shift_assignments WHERE id = $1', [id]);
    res.json({ ok: true });
  })
);

// ── Job Allotments ──────────────────────────────────────────────────────────
router.get(
  '/allotments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { operator_id, workstation_id } = req.query;
    const activeOnly = req.query.active_only === undefined ? true : req.query.active_only === 'true';
    const conds = [];
    const params = [];
    if (activeOnly) conds.push('j.is_active = 1');
    if (operator_id) { params.push(parseInt(operator_id, 10)); conds.push(`j.operator_id = $${params.length}`); }
    if (workstation_id) { params.push(parseInt(workstation_id, 10)); conds.push(`j.workstation_id = $${params.length}`); }
    if (req.user.role === 'operator') { params.push(req.user.id); conds.push(`j.operator_id = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await query(`${ALLOT_SELECT} ${where} ORDER BY j.created_at DESC`, params);
    res.json(rows.map(allotmentOut));
  })
);

router.post(
  '/allotments/auto-assign',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const { shift_date, shift_period } = req.body || {};
    const total = await tx(async (c) => {
      const assignments = await c.query(
        'SELECT * FROM shift_assignments WHERE shift_date = $1 AND shift_period = $2',
        [shift_date, shift_period]
      );
      if (!assignments.length) return -1;
      let count = 0;
      for (const a of assignments) {
        const uids = await c.query(
          `SELECT u.id FROM uids u JOIN cycle_steps cs ON cs.id = u.current_step_id
            WHERE cs.workstation_id = $1 AND u.status IN ('active','on_hold')`,
          [a.workstation_id]
        );
        for (const u of uids) {
          await c.query('UPDATE job_allotments SET is_active = 0 WHERE uid_id = $1 AND is_active = 1', [u.id]);
          await c.query(
            `INSERT INTO job_allotments (uid_id, operator_id, workstation_id, allotted_by_id, notes, is_active)
             VALUES ($1,$2,$3,$4,$5,1)`,
            [u.id, a.operator_id, a.workstation_id, req.user.id, `Auto-assigned for ${shift_date} ${shift_period}`]
          );
          count += 1;
        }
      }
      return count;
    });
    if (total === -1) return res.json({ allotted: 0, detail: 'No shift assignments found for this date/period' });
    res.json({ allotted: total });
  })
);

router.post(
  '/allotments',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const d = req.body || {};
    const id = await tx(async (c) => {
      const uid = await c.one('SELECT id, status FROM uids WHERE id = $1', [d.uid_id]);
      if (!uid) throw new HttpError(404, 'UID not found');
      if (!['active', 'on_hold'].includes(uid.status)) throw new HttpError(400, `UID is ${uid.status}, cannot allot`);
      await c.query('UPDATE job_allotments SET is_active = 0 WHERE uid_id = $1 AND is_active = 1', [d.uid_id]);
      const created = await c.one(
        `INSERT INTO job_allotments (uid_id, operator_id, workstation_id, allotted_by_id, notes, is_active)
         VALUES ($1,$2,$3,$4,$5,1) RETURNING id`,
        [d.uid_id, d.operator_id, d.workstation_id, req.user.id, d.notes ?? null]
      );
      return created.id;
    });
    const j = await one(`${ALLOT_SELECT} WHERE j.id = $1`, [id]);
    res.json(allotmentOut(j));
  })
);

router.delete(
  '/allotments/:allotmentId',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.allotmentId, 10);
    const j = await one('SELECT id FROM job_allotments WHERE id = $1', [id]);
    if (!j) throw new HttpError(404, 'Allotment not found');
    await query('UPDATE job_allotments SET is_active = 0 WHERE id = $1', [id]);
    res.json({ ok: true });
  })
);

// ── Queue View ──────────────────────────────────────────────────────────────
router.get(
  '/queue-view',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { shift_date, shift_period } = req.query;
    const assignments = await query(
      `${ASSIGN_SELECT} WHERE a.shift_date = $1 AND a.shift_period = $2`,
      [shift_date, shift_period]
    );

    const result = [];
    for (const a of assignments) {
      const allotted = await query(
        `${ALLOT_SELECT} WHERE j.workstation_id = $1 AND j.is_active = 1 ORDER BY j.created_at`,
        [a.workstation_id]
      );
      const allottedIds = allotted.map((j) => j.uid_id);

      const storageRows = await query(
        `SELECT DISTINCT fs.code AS from_code, ts.code AS to_code
           FROM cycle_steps cs
           LEFT JOIN storage_locations fs ON fs.id = cs.from_storage_id
           LEFT JOIN storage_locations ts ON ts.id = cs.to_storage_id
          WHERE cs.workstation_id = $1`,
        [a.workstation_id]
      );
      const fromCodes = [...new Set(storageRows.map((s) => s.from_code).filter(Boolean))];
      const toCodes = [...new Set(storageRows.map((s) => s.to_code).filter(Boolean))];

      const readyParams = [a.workstation_id];
      let readyWhere = `cs.workstation_id = $1 AND u.status IN ('active','on_hold')`;
      if (allottedIds.length) {
        readyParams.push(allottedIds);
        readyWhere += ` AND u.id <> ALL($2)`;
      }
      const ready = await query(
        `SELECT u.id, u.code, u.status, u.priority FROM uids u
           JOIN cycle_steps cs ON cs.id = u.current_step_id
          WHERE ${readyWhere} ORDER BY u.created_at`,
        readyParams
      );

      result.push({
        assignment_id: a.id,
        workstation_id: a.workstation_id,
        workstation_code: a.ws_code,
        workstation_name: a.ws_name,
        operator_id: a.operator_id,
        operator_name: a.op_full_name || a.op_username,
        confirmed: !!a.confirmed_by_id,
        from_storage: fromCodes,
        to_storage: toCodes,
        queue: allotted.map(allotmentOut),
        ready_count: ready.length,
        ready_uids: ready.slice(0, 50).map((u) => ({ id: u.id, code: u.code, status: u.status, priority: u.priority })),
      });
    }
    res.json(result);
  })
);

export default router;
