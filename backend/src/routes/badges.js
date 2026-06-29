// Employee skill badges (certifications with expiry). Mounted at /api/badges.
import { Router } from 'express';
import { query, one } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireRoles, requireAdmin, HttpError } from '../middleware/auth.js';

const router = Router();

const BADGE_SELECT = `
  SELECT b.*,
         u.full_name AS operator_name,
         u.username  AS operator_username,
         w.code      AS workstation_code,
         w.name      AS workstation_name
  FROM employee_badges b
  LEFT JOIN users u ON u.id = b.user_id
  LEFT JOIN workstations w ON w.id = b.workstation_id
`;

function badgeStatus(expires_at) {
  if (!expires_at) return 'valid';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expires_at);
  exp.setHours(0, 0, 0, 0);
  const in30 = new Date(today);
  in30.setDate(in30.getDate() + 30);
  if (exp < today) return 'expired';
  if (exp <= in30) return 'expiring';
  return 'valid';
}

function badgeOut(b) {
  return {
    id: b.id,
    user_id: b.user_id,
    operator_name: b.operator_name,
    operator_username: b.operator_username,
    badge_code: b.badge_code,
    badge_name: b.badge_name,
    workstation_id: b.workstation_id,
    workstation_code: b.workstation_code,
    workstation_name: b.workstation_name,
    certified_at: b.certified_at,
    expires_at: b.expires_at,
    certified_by_id: b.certified_by_id,
    is_active: b.is_active,
    notes: b.notes,
    created_at: b.created_at,
    status: badgeStatus(b.expires_at),
  };
}

// ── List badges ─────────────────────────────────────────────────────────────
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user_id } = req.query;
    const conds = [];
    const params = [];
    if (user_id) { params.push(parseInt(user_id, 10)); conds.push(`b.user_id = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await query(`${BADGE_SELECT} ${where} ORDER BY b.user_id, b.badge_code`, params);
    res.json(rows.map(badgeOut));
  })
);

// ── Count of badges expiring within 30 days ─────────────────────────────────
router.get(
  '/expiring',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await one(
      `SELECT COUNT(*)::int AS count FROM employee_badges
       WHERE is_active = TRUE
         AND expires_at IS NOT NULL
         AND expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`
    );
    res.json({ count: row ? row.count : 0 });
  })
);

// ── Create badge ────────────────────────────────────────────────────────────
router.post(
  '/',
  requireRoles('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const {
      user_id,
      badge_code,
      badge_name,
      workstation_id = null,
      certified_at = null,
      expires_at = null,
      notes = null,
    } = req.body || {};
    if (!user_id || !badge_code || !badge_name) {
      throw new HttpError(400, 'user_id, badge_code and badge_name are required');
    }
    const created = await one(
      `INSERT INTO employee_badges
         (user_id, badge_code, badge_name, workstation_id, certified_at, expires_at, certified_by_id, notes)
       VALUES ($1,$2,$3,$4,COALESCE($5, CURRENT_DATE),$6,$7,$8)
       RETURNING id`,
      [user_id, badge_code, badge_name, workstation_id, certified_at, expires_at, req.user.id, notes]
    );
    const b = await one(`${BADGE_SELECT} WHERE b.id = $1`, [created.id]);
    res.status(201).json(badgeOut(b));
  })
);

// ── Update badge ────────────────────────────────────────────────────────────
router.patch(
  '/:id',
  requireRoles('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await one('SELECT id FROM employee_badges WHERE id = $1', [id]);
    if (!existing) throw new HttpError(404, 'Badge not found');
    const fields = ['badge_name', 'workstation_id', 'certified_at', 'expires_at', 'is_active', 'notes'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(req.body[f]); }
    }
    if (sets.length) {
      vals.push(id);
      await query(`UPDATE employee_badges SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    }
    const b = await one(`${BADGE_SELECT} WHERE b.id = $1`, [id]);
    res.json(badgeOut(b));
  })
);

// ── Soft-archive badge ──────────────────────────────────────────────────────
router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = await one('SELECT id FROM employee_badges WHERE id = $1', [id]);
    if (!b) throw new HttpError(404, 'Badge not found');
    await query('UPDATE employee_badges SET is_active = FALSE WHERE id = $1', [id]);
    res.json({ success: true });
  })
);

export default router;
