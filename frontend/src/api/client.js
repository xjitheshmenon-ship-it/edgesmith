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

class ApiError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, { body, params } = {}) {
  let url = `${API_BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    if (qs) url += `?${qs}`;
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
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
