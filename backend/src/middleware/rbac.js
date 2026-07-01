/**
 * Role hierarchy reference (for documentation; not used for inequality checks
 * since permissions are not strictly nested — each route declares exact roles).
 *   admin > manager > supervisor > operator > service / shopfloor
 */
const ALL_ROLES = ['admin', 'manager', 'supervisor', 'operator', 'service', 'shopfloor'];

/**
 * requireRole(['admin','manager']) — blocks the request unless req.user.role
 * is in the allowed list. Must run after authenticate().
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: { code: 'NO_TOKEN', message: 'Authentication required.' } });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Role '${req.user.role}' is not permitted to perform this action.`,
        },
      });
    }
    return next();
  };
}

/**
 * Location scoping — the central rule that makes Faridabad/Dharmapuri
 * separation real rather than cosmetic.
 *
 * - admin: location_id = null on their JWT -> always allowed, any location.
 * - manager: location_id = null on their JWT -> always allowed, any location
 *            (managers in this system are cross-location per the spec).
 * - supervisor / operator: location_id is fixed on their JWT (their assigned
 *   location). Any request specifying a *different* location is rejected,
 *   regardless of what the frontend sent — this is the server-side guarantee
 *   that the topbar toggle cannot be used to see/act on the other location.
 *
 * Usage: attach as middleware after authenticate(). Routes that accept a
 * `?location=` query param or a `location_id` in the body should call
 * `resolveLocation(req)` (below) to get the *effective* location to filter by.
 */
const LOCATION_CODE_TO_ID = { dharmapuri: 1, faridabad: 2 };

function enforceLocationScope(req, res, next) {
  const role = req.user.role;
  if (role === 'admin' || role === 'manager') return next(); // unrestricted

  // supervisor/operator/service/shopfloor are locked to their own location_id.
  // The request may name a location as a code ('dharmapuri') or an id (1); a
  // missing param falls through (resolveLocation scopes it). Anything that
  // isn't the caller's own location — including 'both' — is rejected.
  const requested = req.query.location || (req.body && req.body.location_id) || null;
  if (!requested) return next();
  const requestedId = LOCATION_CODE_TO_ID[String(requested).toLowerCase()] || Number(requested) || null;
  if (String(requestedId) !== String(req.user.location_id)) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'LOCATION_FORBIDDEN',
        message: 'You are not permitted to access data for this location.',
      },
    });
  }
  return next();
}

/**
 * requireLocationAccess(locationId) — a router-level guard for single-location
 * domains (e.g. /faridabad, or the Dharmapuri-only /jobs and /uids). Admin and
 * Manager are cross-location and always pass; everyone else must belong to that
 * location. Must run after authenticate().
 */
function requireLocationAccess(locationId) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: { code: 'NO_TOKEN', message: 'Authentication required.' } });
    }
    const role = req.user.role;
    if (role === 'admin' || role === 'manager') return next();
    if (String(req.user.location_id) === String(locationId)) return next();
    return res.status(403).json({
      success: false,
      error: { code: 'LOCATION_FORBIDDEN', message: "This location's data is not available to your account." },
    });
  };
}

/**
 * Given a request, resolve which location_id(s) a query should filter by.
 * Returns: { mode: 'all' } | { mode: 'one', locationId } | { mode: 'list', locationIds: [...] }
 *
 * - admin/manager with no ?location= param or ?location=both -> mode 'all'
 * - admin/manager with ?location=dharmapuri|faridabad -> mode 'one'
 * - supervisor/operator -> always mode 'one', forced to their own location_id
 *   (ignores any query param — enforced server-side regardless of frontend state)
 */
function resolveLocation(req, locationCodeToId) {
  const role = req.user.role;
  if (role !== 'admin' && role !== 'manager') {
    return { mode: 'one', locationId: req.user.location_id };
  }
  const q = (req.query.location || 'both').toLowerCase();
  if (q === 'both' || q === 'all') return { mode: 'all' };
  const locationId = locationCodeToId[q];
  if (!locationId) return { mode: 'all' };
  return { mode: 'one', locationId };
}

module.exports = { ALL_ROLES, requireRole, enforceLocationScope, requireLocationAccess, resolveLocation };
