import { Router } from 'express';
import { query, one } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAdmin, hashPassword, HttpError } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';

const router = Router();

function userOut(u) {
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    email: u.email,
    role: u.role,
    is_active: u.is_active,
    primary_location_id: u.primary_location_id,
  };
}

router.get(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT * FROM users ORDER BY id');
    res.json(rows.map(userOut));
  })
);

router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { username, full_name, email = null, password, role = 'operator', primary_location_id = null } = req.body || {};
    const existing = await one('SELECT id FROM users WHERE username = $1', [username]);
    if (existing) throw new HttpError(400, 'Username already exists');
    const user = await one(
      `INSERT INTO users (username, full_name, email, hashed_password, role, primary_location_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [username, full_name, email, hashPassword(password), role, primary_location_id]
    );
    await writeAudit(req.user.id, 'create', 'users', user.id, null, userOut(user));
    res.status(201).json(userOut(user));
  })
);

router.patch(
  '/:userId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.userId, 10);
    const user = await one('SELECT * FROM users WHERE id = $1', [id]);
    if (!user) throw new HttpError(404, 'User not found');

    const fields = ['full_name', 'email', 'role', 'primary_location_id', 'is_active'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined && req.body[f] !== null) {
        sets.push(`${f} = $${i++}`);
        vals.push(req.body[f]);
      }
    }
    if (sets.length) {
      vals.push(id);
      await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    }
    const updated = await one('SELECT * FROM users WHERE id = $1', [id]);
    await writeAudit(req.user.id, 'update', 'users', id, userOut(user), userOut(updated));
    res.json(userOut(updated));
  })
);

export default router;
