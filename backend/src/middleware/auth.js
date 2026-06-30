const { verifyToken } = require('../config/jwt');

/**
 * Verifies the JWT cookie/header on every protected request.
 * Populates req.user = { sub, employee_code, full_name, role, location_id }.
 */
function authenticate(req, res, next) {
  const token =
    (req.cookies && req.cookies.cpcms_token) ||
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: { code: 'NO_TOKEN', message: 'Authentication required.' },
    });
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Session expired or invalid. Please log in again.' },
    });
  }
}

module.exports = { authenticate };
