const express = require('express');
const bcrypt = require('bcrypt');
const { query } = require('../config/database');
const { signToken } = require('../config/jwt');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// In production the frontend (GitHub Pages) and the API (Render) are on
// different origins, so the auth cookie must be SameSite=None + Secure to be
// sent on cross-site requests. In local dev (same-site, http) we use Lax so the
// cookie still works without HTTPS. Override with COOKIE_SAMESITE if needed.
const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: process.env.COOKIE_SAMESITE || (IS_PROD ? 'none' : 'lax'),
  maxAge: 8 * 60 * 60 * 1000, // 8h, matches JWT_EXPIRES_IN
};

// clearCookie must be given matching sameSite/secure/httpOnly or the browser
// won't clear the cross-site cookie.
const CLEAR_OPTS = { httpOnly: COOKIE_OPTS.httpOnly, secure: COOKIE_OPTS.secure, sameSite: COOKIE_OPTS.sameSite };

/**
 * POST /api/v1/auth/login
 * body: { username, password }
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_CREDENTIALS', message: 'Username and password are required.' },
    });
  }

  const { rows } = await query(
    `SELECT id, employee_code, full_name, username, password_hash, role, location_id, status
     FROM employees WHERE username = $1`,
    [username]
  );
  const employee = rows[0];

  if (!employee || employee.status !== 'active') {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' },
    });
  }

  const match = await bcrypt.compare(password, employee.password_hash);
  if (!match) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' },
    });
  }

  const token = signToken(employee);
  res.cookie('cpcms_token', token, COOKIE_OPTS);

  return res.json({
    success: true,
    data: {
      token, // also returned in body for non-cookie clients (e.g. mobile webview edge cases)
      user: {
        id: employee.id,
        employee_code: employee.employee_code,
        full_name: employee.full_name,
        role: employee.role,
        location_id: employee.location_id,
      },
    },
  });
});

/**
 * POST /api/v1/auth/refresh
 * Re-issues a token with a fresh expiry, given a still-valid (not yet
 * expired) existing token. Frontend calls this silently when < 30 min remain.
 */
router.post('/refresh', authenticate, async (req, res) => {
  const { rows } = await query(
    `SELECT id, employee_code, full_name, role, location_id, status FROM employees WHERE id = $1`,
    [req.user.sub]
  );
  const employee = rows[0];
  if (!employee || employee.status !== 'active') {
    return res.status(401).json({ success: false, error: { code: 'INVALID_SESSION', message: 'Session no longer valid.' } });
  }
  const token = signToken(employee);
  res.cookie('cpcms_token', token, COOKIE_OPTS);
  return res.json({ success: true, data: { token } });
});

/**
 * POST /api/v1/auth/logout
 */
router.post('/logout', (req, res) => {
  res.clearCookie('cpcms_token', CLEAR_OPTS);
  return res.json({ success: true, data: { loggedOut: true } });
});

module.exports = router;
