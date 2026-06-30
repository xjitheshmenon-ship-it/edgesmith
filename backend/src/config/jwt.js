const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  // eslint-disable-next-line no-console
  console.warn('[WARNING] JWT_SECRET is missing or too short. Set a strong secret (64+ chars) in .env before production.');
}

/**
 * Issue a JWT for an authenticated employee.
 * Payload kept minimal: id, role, location_id, employee_code.
 */
function signToken(employee) {
  return jwt.sign(
    {
      sub: employee.id,
      employee_code: employee.employee_code,
      full_name: employee.full_name,
      role: employee.role,
      location_id: employee.location_id, // null = both (admin/manager)
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { signToken, verifyToken, JWT_SECRET, JWT_EXPIRES_IN };
