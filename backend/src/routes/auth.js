import { Router } from 'express';
import { one } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, verifyPassword, createAccessToken, HttpError } from '../middleware/auth.js';

const router = Router();

// OAuth2 password flow — accepts x-www-form-urlencoded { username, password }.
router.post(
  '/token',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    const user = await one('SELECT * FROM users WHERE username = $1 AND is_active = TRUE', [username]);
    if (!user || !verifyPassword(password || '', user.hashed_password)) {
      throw new HttpError(401, 'Incorrect username or password');
    }
    const token = createAccessToken({ sub: user.username });
    res.json({
      access_token: token,
      token_type: 'bearer',
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        primary_location_id: user.primary_location_id,
      },
    });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const u = req.user;
    res.json({
      id: u.id,
      username: u.username,
      full_name: u.full_name,
      role: u.role,
      primary_location_id: u.primary_location_id,
    });
  })
);

export default router;
