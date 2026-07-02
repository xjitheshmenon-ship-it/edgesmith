/**
 * CPCMS API Client
 *
 * Thin wrapper around fetch() that matches the backend's exact contract:
 *   - JWT sent via httpOnly cookie automatically (credentials: 'include')
 *   - All responses: { success: true, data, meta? } | { success: false, error: {code, message, details?} }
 *   - On 401, clears local auth state and redirects to /login (handled by AuthContext, not here,
 *     to avoid a circular import — this module throws, the caller/context decides what to do)
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const TOKEN_KEY = 'cpcms_token';

/**
 * Persist (or clear) the JWT used for Bearer auth. The web build authenticates
 * via the httpOnly cookie, but inside the Android (Capacitor) WebView the API
 * is cross-origin and third-party cookies are unreliable, so we also send the
 * token the backend returns on login as an Authorization: Bearer header.
 */
export function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable — fall back to cookie auth */ }
}

function getAuthToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

// The backend blocks every write by a Director (read-only role). We mirror that
// on the client so a Director gets an instant, friendly message instead of a
// round-trip 403 — set by AuthContext whenever the signed-in user changes.
let readOnlyMode = false;
export function setReadOnly(on) { readOnlyMode = !!on; }
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

class ApiError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, { body, params } = {}) {
  // Read-only (Director) short-circuit — never block auth lifecycle calls.
  if (readOnlyMode && MUTATING_METHODS.has(method) && !path.startsWith('/auth/')) {
    throw new ApiError('READ_ONLY_ROLE', 'Director is a read-only role — this action is not available.', 403);
  }

  let url = `${API_BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    if (qs) url += `?${qs}`;
  }

  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new ApiError('NETWORK_ERROR', 'Connection lost — changes cannot be saved.', 0);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('PARSE_ERROR', 'Unexpected response from server.', res.status);
  }

  if (!res.ok || json.success === false) {
    const err = json.error || {};
    throw new ApiError(err.code || 'UNKNOWN_ERROR', err.message || 'Something went wrong.', res.status, err.details);
  }

  return json; // { success, data, meta? }
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body) => request('POST', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  delete: (path) => request('DELETE', path),
};

export { ApiError };
