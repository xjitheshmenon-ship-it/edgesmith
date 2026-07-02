const { verifyToken } = require('../config/jwt');

/**
 * Verifies the JWT cookie/header on every protected request.
 * Populates req.user = { sub, employee_code, full_name, role, location_id }.
 */
function authenticate(req, res, next) {
  // Collect every token the client offered. Order matters: the Authorization
  // header is checked FIRST because the SPA sets it explicitly from the freshest
  // login, whereas the httpOnly cookie can be a stale token the browser keeps
  // attaching cross-site (github.io → onrender.com) and cannot be cleared from
  // JS. Trying each candidate — rather than trusting the cookie alone — means a
  // valid Bearer token still authenticates even when a stale cookie lingers.
  const candidates = [];
  const authz = req.headers.authorization;
  if (authz && authz.startsWith('Bearer ')) candidates.push(authz.slice(7));
  if (req.cookies && req.cookies.cpcms_token) candidates.push(req.cookies.cpcms_token);

  if (!candidates.length) {
    return res.status(401).json({
      success: false,
      error: { code: 'NO_TOKEN', message: 'Authentication required.' },
    });
  }

  for (const token of candidates) {
    try {
      req.user = verifyToken(token);
      return next();
    } catch (err) {
      // try the next candidate before giving up
    }
  }

  return res.status(401).json({
    success: false,
    error: { code: 'INVALID_TOKEN', message: 'Session expired or invalid. Please log in again.' },
  });
}

module.exports = { authenticate };
