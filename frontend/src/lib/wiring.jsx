import { useNavigate } from 'react-router-dom';

/**
 * Central page-to-page wiring for CPCMS (Final Instruction Appendix F.1).
 *
 * Every clickable entity in the app routes through here so the target routes
 * and the data passed on the query string stay consistent. Destinations read
 * the matching query param (via useSearchParams) to pre-select / pre-filter:
 *   - UID detail   → /uid/:code            (UidDetail, useParams)
 *   - UID list     → /uid?status=&search=  (UidLookup)
 *   - Employee     → /employees?employee=  (EmployeeProfiles)
 *   - Batch        → /batch?ref=           (BatchManagement / Batch Tracker)
 *   - MO           → /mo?mo=               (Manufacturing Orders)
 *   - Shift        → /shift?shift=         (Shift Planner)
 *   - Prod. Floor  → /floor?storage=       (Production Floor)
 */
export const routes = {
  uid: (code) => `/uid/${encodeURIComponent(code)}`,
  uidList: (q = {}) => `/uid?${new URLSearchParams(clean(q))}`,
  employee: (id) => `/employees?employee=${encodeURIComponent(id)}`,
  batch: (ref) => `/batch?ref=${encodeURIComponent(ref)}`,
  mo: (num) => `/mo?mo=${encodeURIComponent(num)}`,
  shift: (id) => `/shift?shift=${encodeURIComponent(id)}`,
  floor: (q = {}) => `/floor?${new URLSearchParams(clean(q))}`,
};

function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  return out;
}

const LINK_BLUE = 'var(--status-blue, #2d6fb5)';

/**
 * A clickable entity reference (UID code, operator name, batch ref, MO, …).
 * Renders as inline text that navigates on click. When `to` is falsy it
 * degrades to plain, non-interactive text so callers can pass a link only when
 * the id is actually available.
 *
 * `stop` (default true) stops event propagation so a link inside a clickable
 * row/card doesn't also trigger the row's own onClick.
 */
export function EntityLink({ to, children, mono = false, title, style, stop = true, disabled = false }) {
  const navigate = useNavigate();
  if (!to || disabled) {
    return <span style={{ fontFamily: mono ? "'IBM Plex Mono', monospace" : 'inherit', ...style }}>{children}</span>;
  }
  return (
    <button
      type="button"
      title={title || 'Open'}
      onClick={(e) => { if (stop) e.stopPropagation(); navigate(to); }}
      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
      style={{
        background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer',
        color: LINK_BLUE, fontWeight: 600, fontSize: 'inherit', lineHeight: 'inherit',
        fontFamily: mono ? "'IBM Plex Mono', monospace" : 'inherit', textAlign: 'left',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
