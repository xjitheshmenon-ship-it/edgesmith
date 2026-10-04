// One tiny API client. Same-origin in production (the backend serves the
// build); VITE_API_URL only matters if the two are ever hosted apart.
const BASE = (import.meta as any).env?.VITE_API_URL || "";
const KEY = "cpcms.token";

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t: string) => localStorage.setItem(KEY, t);
export const clearToken = () => localStorage.removeItem(KEY);

export async function api(path: string, opts: RequestInit = {}) {
  const headers: any = { ...(opts.headers || {}) };
  if (opts.body) headers["Content-Type"] = "application/json";   // no content-type on empty POSTs — Fastify 400s otherwise
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(BASE + path, { ...opts, headers });
  const data = await res.json().catch(() => ({ ok: false, error: "Bad response from server." }));
  return { status: res.status, ...data };
}
