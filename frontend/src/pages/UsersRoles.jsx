import { useState, useEffect, useCallback, useMemo } from 'react';
import { adminApi } from '../api/resources';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { LocationBadge, hexToRgba } from '../components/common/Badges';
import Icon from '../components/common/Icon';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

// ── The six system roles ──────────────────────────────────────────────
// admin / manager are location-null (see all locations).
// supervisor / operator are location-scoped (carry a location_id, may
// optionally view the other location). service / shopfloor are special.
const ROLES = [
  { value: 'admin', label: 'Admin', scoped: false, accent: '#7a4fc0' },
  { value: 'manager', label: 'Manager', scoped: false, accent: '#2d6fb5' },
  { value: 'supervisor', label: 'Supervisor', scoped: true, accent: '#22a06b' },
  { value: 'operator', label: 'Operator', scoped: true, accent: '#1c7a52' },
  { value: 'service', label: 'Service', scoped: false, accent: '#d97a2b' },
  { value: 'shopfloor', label: 'Shopfloor View', scoped: false, accent: '#9aa0a6' },
];

const ROLE_MAP = Object.fromEntries(ROLES.map((r) => [r.value, r]));

const LOCATIONS = [
  { value: 'faridabad', label: 'Faridabad' },
  { value: 'dharmapuri', label: 'Dharmapuri' },
];

// Role → what the role can reach. Mirrors the "WHO SEES WHAT" access table.
const ROLE_BEHAVIOUR = {
  admin: 'Full access to every page across both locations, including Users & Roles.',
  manager: 'Sees both locations. All operational pages; view-only on master lists & cycle builder.',
  supervisor: 'Scoped to assigned location (may view the other). Receiving, UID, floor, QC, batches.',
  operator: 'Scoped to assigned location. Production Floor and QC log-only.',
  service: 'Service Call Lookup page only.',
  shopfloor: 'Shopfloor Display only — no login required (PIN or open access).',
};

// Page-level permission reference (from the WHO SEES WHAT table).
const PERMISSION_ROWS = [
  ['Dashboard', ['admin', 'manager', 'supervisor']],
  ['Raw Material Intake', ['admin', 'manager']],
  ['Joining Operation', ['admin', 'manager']],
  ['Contractor Dispatch', ['admin', 'manager']],
  ['Receiving', ['admin', 'manager', 'supervisor']],
  ['UID Creation', ['admin', 'manager', 'supervisor']],
  ['Production Floor', ['admin', 'manager', 'supervisor', 'operator']],
  ['Batch Management', ['admin', 'manager', 'supervisor']],
  ['QC', ['admin', 'manager', 'supervisor', 'operator']],
  ['Reports', ['admin', 'manager', 'supervisor']],
  ['Service Call Lookup', ['admin', 'manager', 'supervisor', 'service']],
  ['Shopfloor Display', ['shopfloor']],
  ['Cycle Builder', ['admin', 'manager']],
  ['Master Lists', ['admin', 'manager']],
  ['Tempering Parameters', ['admin']],
  ['Users and Roles', ['admin']],
];

// ── Field accessors (snake_case or camelCase from the API) ──────────────
const f = (u, ...keys) => {
  for (const k of keys) if (u != null && u[k] != null && u[k] !== '') return u[k];
  return undefined;
};
const userId = (u) => f(u, 'id', 'user_id', 'userId');
const userName = (u) => f(u, 'username', 'user_name');
const userFull = (u) => f(u, 'full_name', 'fullName', 'name');
const userRole = (u) => f(u, 'role', 'role_name');
const userLoc = (u) => f(u, 'location_id', 'locationId', 'location');
const userArchived = (u) =>
  Boolean(f(u, 'archived', 'is_archived', 'deleted_at', 'archived_at')) ||
  f(u, 'status', 'state') === 'inactive' ||
  f(u, 'active', 'is_active') === false;

// ── Small presentational helpers ───────────────────────────────────────
function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
        {children}
      </div>
      {right}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', padding: '14px 0' }}>
      {children}
    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-danger, #e5484d)', background: 'rgba(229,72,77,0.08)', border: '1px solid rgba(229,72,77,0.25)', borderRadius: 'var(--radius-md, 9px)', padding: '10px 12px' }}>
      <Icon name="alert" size={15} color="var(--status-danger, #e5484d)" />
      <span>{message}</span>
    </div>
  );
}

function SuccessBanner({ message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-success-dark, #1c7a52)', background: 'rgba(34,160,107,0.1)', border: '1px solid rgba(34,160,107,0.25)', borderRadius: 'var(--radius-md, 9px)', padding: '10px 12px' }}>
      <Icon name="check" size={15} color="var(--status-success-dark, #1c7a52)" />
      <span>{message}</span>
    </div>
  );
}

function RoleBadge({ role }) {
  const meta = ROLE_MAP[role];
  const color = meta?.accent || '#5d7188';
  const label = meta?.label || role || '—';
  return (
    <span className="badge" style={{ background: hexToRgba(color, 0.14), color }}>
      {String(label).toUpperCase()}
    </span>
  );
}

function StatusDot({ archived }) {
  const color = archived ? 'var(--status-neutral, #9aa0a6)' : 'var(--status-success, #22a06b)';
  return (
    <span className="status-pill" style={{ background: hexToRgba(archived ? '#9aa0a6' : '#22a06b', 0.14), color }}>
      {archived ? 'INACTIVE' : 'ACTIVE'}
    </span>
  );
}

// ── Create / Edit form ──────────────────────────────────────────────────
const BLANK = { username: '', full_name: '', role: 'operator', location_id: 'faridabad', password: '' };

function UserForm({ initial, onCancel, onSubmit, busy }) {
  const editing = Boolean(initial && userId(initial));
  const [form, setForm] = useState(() =>
    editing
      ? {
          username: userName(initial) || '',
          full_name: userFull(initial) || '',
          role: userRole(initial) || 'operator',
          location_id: userLoc(initial) || 'faridabad',
          password: '',
        }
      : { ...BLANK }
  );
  const [err, setErr] = useState(null);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const roleMeta = ROLE_MAP[form.role] || {};
  const scoped = Boolean(roleMeta.scoped);

  function submit(e) {
    e.preventDefault();
    setErr(null);
    if (!form.username.trim()) return setErr('Username is required.');
    if (!form.full_name.trim()) return setErr('Full name is required.');
    if (!editing && !form.password.trim()) return setErr('A password is required for new users.');

    const payload = {
      username: form.username.trim(),
      full_name: form.full_name.trim(),
      role: form.role,
      // Location only carried by scoped roles; admin/manager/etc. are location-null.
      location_id: scoped ? form.location_id : null,
    };
    if (form.password.trim()) payload.password = form.password.trim();
    onSubmit(payload, editing ? userId(initial) : null).then((apiErr) => {
      if (apiErr) setErr(apiErr);
    });
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <div>
        <label className="form-label">Full name</label>
        <input className="form-input" value={form.full_name} onChange={set('full_name')} placeholder="e.g. Priya Sharma" autoComplete="off" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
        <div>
          <label className="form-label">Username</label>
          <input className="form-input" value={form.username} onChange={set('username')} placeholder="login id" autoComplete="off" disabled={editing} />
        </div>
        <div>
          <label className="form-label">Role</label>
          <select className="form-select" value={form.role} onChange={set('role')}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
        <div>
          <label className="form-label">Location {scoped ? '(scoped)' : ''}</label>
          <select className="form-select" value={scoped ? form.location_id : ''} onChange={set('location_id')} disabled={!scoped}>
            {scoped ? (
              LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)
            ) : (
              <option value="">All locations</option>
            )}
          </select>
        </div>
        <div>
          <label className="form-label">Password {editing ? '(leave blank to keep)' : ''}</label>
          <input className="form-input" type="password" value={form.password} onChange={set('password')} placeholder={editing ? '••••••••' : 'set a password'} autoComplete="new-password" />
        </div>
      </div>

      <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary, #5d7188)', background: 'var(--bg-muted-2, #f6f9f4)', border: '1px solid var(--border-card, #e3ebde)', borderRadius: 'var(--radius-md, 9px)', padding: '9px 11px' }}>
        {ROLE_BEHAVIOUR[form.role]}
      </div>

      {err ? <ErrorBanner message={err} /> : null}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save Changes' : 'Create User'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

// ── Role permissions reference ──────────────────────────────────────────
function PermissionsReference() {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: 12.5 }}>
        <thead>
          <tr style={{ textAlign: 'left', fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
            <th style={{ padding: '6px 12px 8px 0' }}>Page</th>
            {ROLES.map((r) => (
              <th key={r.value} style={{ padding: '6px 8px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>{r.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_ROWS.map(([page, allowed]) => (
            <tr key={page} style={{ borderTop: '1px solid #eef2ea' }}>
              <td style={{ padding: '8px 12px 8px 0', color: 'var(--text-primary, #15366a)', whiteSpace: 'nowrap' }}>{page}</td>
              {ROLES.map((r) => {
                const ok = allowed.includes(r.value);
                return (
                  <td key={r.value} style={{ padding: '8px', textAlign: 'center' }}>
                    {ok ? (
                      <Icon name="check" size={14} color="var(--status-success, #22a06b)" />
                    ) : (
                      <span style={{ color: 'var(--text-muted, #9bb4d4)' }}>—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Activity log (all users) ───────────────────────────────────────────────
function fmtTs(v) {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return String(v);
  }
}

const ACTION_COLOR = {
  INSERT: { bg: 'rgba(34,160,107,0.14)', fg: 'var(--status-success, #22a06b)' },
  UPDATE: { bg: 'rgba(45,111,181,0.14)', fg: 'var(--cycle-eat, #2d6fb5)' },
  DELETE: { bg: 'rgba(229,72,77,0.14)', fg: 'var(--status-danger, #e5484d)' },
};

/* A compact summary of what changed, from the before/after JSON. */
function summariseChange(r) {
  const after = r.after_value ?? r.after;
  const before = r.before_value ?? r.before;
  const action = String(r.action || '').toUpperCase();
  if (action === 'DELETE') return 'Removed';
  const obj = after && typeof after === 'object' ? after : null;
  if (!obj) return action === 'INSERT' ? 'Created' : '—';
  const parts = Object.entries(obj)
    .filter(([k]) => !['id', 'created_at', 'updated_at', 'password_hash'].includes(k))
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  const s = parts.join(' · ');
  return s.length > 120 ? s.slice(0, 117) + '…' : s || (action === 'INSERT' ? 'Created' : 'Updated');
}

function AuditLog() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [actors, setActors] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [table, setTable] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  // Actor list (everyone) for the filter dropdown.
  useEffect(() => {
    let live = true;
    adminApi.users().then((r) => live && setActors(r.data || [])).catch(() => {});
    return () => { live = false; };
  }, []);

  const load = useCallback(() => {
    setRows(null);
    setError(null);
    adminApi
      .auditLog({ employeeId: employeeId || undefined, table: table || undefined, from: from || undefined, to: to || undefined })
      .then((r) => setRows(Array.isArray(r.data) ? r.data : r.data?.items || []))
      .catch((e) => setError(e.message || 'Could not load the activity log.'));
  }, [employeeId, table, from, to]);

  useEffect(() => { load(); }, [load]);

  // Distinct entity (table) names for the entity filter, from what's loaded.
  const tables = useMemo(() => {
    const s = new Set();
    (rows || []).forEach((r) => r.table_name && s.add(r.table_name));
    return [...s].sort();
  }, [rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows || [];
    return (rows || []).filter((r) =>
      `${r.employee_name || ''} ${r.action || ''} ${r.table_name || ''} ${r.record_id || ''} ${summariseChange(r)}`
        .toLowerCase()
        .includes(q)
    );
  }, [rows, search]);

  const selStyle = { height: 32, fontSize: 12, padding: '0 8px' };

  return (
    <div>
      <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary, #5d7188)', marginBottom: 10 }}>
        Every recorded action across the system, by every user — newest first (latest 500).
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <select className="form-select" style={selStyle} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">All users</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>{a.full_name}{a.role ? ` (${a.role})` : ''}</option>
          ))}
        </select>
        <select className="form-select" style={selStyle} value={table} onChange={(e) => setTable(e.target.value)}>
          <option value="">All entities</option>
          {tables.map((t) => (<option key={t} value={t}>{t}</option>))}
        </select>
        <input type="date" className="form-input" style={selStyle} value={from} onChange={(e) => setFrom(e.target.value)} title="From" />
        <input type="date" className="form-input" style={selStyle} value={to} onChange={(e) => setTo(e.target.value)} title="To" />
        <input className="form-input" style={{ ...selStyle, flex: 1, minWidth: 140 }} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {(employeeId || table || from || to || search) ? (
          <button type="button" className="btn btn-sm" onClick={() => { setEmployeeId(''); setTable(''); setFrom(''); setTo(''); setSearch(''); }}>Clear</button>
        ) : null}
        <button type="button" className="btn btn-sm" onClick={load}>Refresh</button>
      </div>

      {error ? <ErrorBanner message={error} /> : rows == null ? (
        <Empty>Loading activity log…</Empty>
      ) : shown.length === 0 ? (
        <Empty>No activity matches these filters.</Empty>
      ) : (
        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)', position: 'sticky', top: 0, background: 'var(--bg-card, #fff)' }}>
                <th style={{ padding: '6px 12px 8px 0' }}>When</th>
                <th style={{ padding: '6px 12px 8px 0' }}>User</th>
                <th style={{ padding: '6px 12px 8px 0' }}>Action</th>
                <th style={{ padding: '6px 12px 8px 0' }}>Entity</th>
                <th style={{ padding: '6px 12px 8px 0' }}>Change</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const action = String(r.action || '').toUpperCase();
                const c = ACTION_COLOR[action] || { bg: 'rgba(154,160,166,0.14)', fg: 'var(--text-secondary, #5d7188)' };
                return (
                  <tr key={r.id ?? i} style={{ borderTop: '1px solid #eef2ea' }}>
                    <td style={{ padding: '8px 12px 8px 0', fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary, #5d7188)', whiteSpace: 'nowrap' }}>
                      {fmtTs(r.created_at)}
                    </td>
                    <td style={{ padding: '8px 12px 8px 0', color: 'var(--text-primary, #15366a)', whiteSpace: 'nowrap' }}>
                      {r.employee_name || (r.employee_id ? `#${r.employee_id}` : 'System')}
                    </td>
                    <td style={{ padding: '8px 12px 8px 0' }}>
                      <span className="badge" style={{ background: c.bg, color: c.fg }}>{action || '—'}</span>
                    </td>
                    <td style={{ padding: '8px 12px 8px 0', fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary, #5d7188)', whiteSpace: 'nowrap' }}>
                      {r.table_name || '—'}{r.record_id ? ` #${r.record_id}` : ''}
                    </td>
                    <td style={{ padding: '8px 12px 8px 0', color: 'var(--text-secondary, #5d7188)' }}>
                      {summariseChange(r)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function UsersRoles() {
  const { isAdmin } = useAuth();

  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [panel, setPanel] = useState(null); // null | { mode:'create' } | { mode:'edit', user }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return adminApi
      .users()
      .then((r) => r.data)
      .then((data) => setUsers(Array.isArray(data) ? data : data?.items || []))
      .catch((e) => setLoadError(e.message || 'Could not load users.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  // create/update/archive go through the sanctioned generic client against
  // the /admin/users contract (resources.js exposes only the list helper).
  async function saveUser(payload, id) {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      if (id) {
        await api.patch(`/admin/users/${id}`, payload);
        setNotice(`Updated ${payload.username}.`);
      } else {
        await api.post('/admin/users', payload);
        setNotice(`Created ${payload.username}.`);
      }
      setPanel(null);
      await load();
      return null;
    } catch (e) {
      return e.message || 'Could not save the user.';
    } finally {
      setBusy(false);
    }
  }

  async function archiveUser(u) {
    const name = userName(u) || userFull(u);
    if (!window.confirm(`Archive ${name}? They will be deactivated but never deleted.`)) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      // Soft-delete only — DELETE on the admin contract archives, it does not hard delete.
      await api.delete(`/admin/users/${userId(u)}`);
      setNotice(`${name} archived.`);
      await load();
    } catch (e) {
      setActionError(e.message || 'Could not archive the user.');
    } finally {
      setBusy(false);
    }
  }

  // ── Non-admin gate ──
  if (!isAdmin) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
        <div className="card" style={{ padding: '40px 28px', textAlign: 'center', maxWidth: 520, margin: '40px auto' }}>
          <Icon name="lock" size={28} color="var(--text-muted, #9bb4d4)" />
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, color: 'var(--text-primary, #15366a)', marginTop: 12 }}>
            Admin access required
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 6 }}>
            Users and Roles can only be managed by an administrator.
          </div>
        </div>
      </div>
    );
  }

  const list = (users || []).filter((u) => showArchived || !userArchived(u));
  const activeCount = (users || []).filter((u) => !userArchived(u)).length;

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
            Users &amp; Roles
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
            Manage system users, their roles and location assignments{loading ? ' · loading…' : ''}
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setPanel({ mode: 'create' });
            setNotice(null);
            setActionError(null);
          }}
        >
          <Icon name="plus" size={15} color="currentColor" /> New User
        </button>
      </div>

      {notice ? <div style={{ marginTop: 16 }}><SuccessBanner message={notice} /></div> : null}
      {actionError ? <div style={{ marginTop: 16 }}><ErrorBanner message={actionError} /></div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: panel ? '1fr 380px' : '1fr', gap: 16, marginTop: 18, alignItems: 'start' }}>
        {/* ── User list ── */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionTitle
            right={
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary, #5d7188)', cursor: 'pointer' }}>
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                Show archived
              </label>
            }
          >
            System Users · {activeCount} active
          </SectionTitle>

          {loadError ? (
            <ErrorBanner message={loadError} />
          ) : loading && users == null ? (
            <Empty>Loading users…</Empty>
          ) : list.length === 0 ? (
            <Empty>No users to show. Create the first user to get started.</Empty>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
                    <th style={{ padding: '6px 12px 8px 0' }}>Name</th>
                    <th style={{ padding: '6px 12px 8px 0' }}>Username</th>
                    <th style={{ padding: '6px 12px 8px 0' }}>Role</th>
                    <th style={{ padding: '6px 12px 8px 0' }}>Location</th>
                    <th style={{ padding: '6px 12px 8px 0' }}>Status</th>
                    <th style={{ padding: '6px 0 8px 0', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((u, i) => {
                    const archived = userArchived(u);
                    const loc = userLoc(u);
                    const scoped = ROLE_MAP[userRole(u)]?.scoped;
                    return (
                      <tr key={userId(u) ?? userName(u) ?? i} style={{ borderTop: '1px solid #eef2ea', opacity: archived ? 0.6 : 1 }}>
                        <td style={{ padding: '9px 12px 9px 0', color: 'var(--text-primary, #15366a)', fontWeight: 600 }}>{userFull(u) || '—'}</td>
                        <td style={{ padding: '9px 12px 9px 0', fontFamily: MONO, fontSize: 11.5, color: 'var(--text-secondary, #5d7188)' }}>{userName(u) || '—'}</td>
                        <td style={{ padding: '9px 12px 9px 0' }}><RoleBadge role={userRole(u)} /></td>
                        <td style={{ padding: '9px 12px 9px 0' }}>
                          {scoped && loc ? <LocationBadge location={loc} /> : <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--text-muted-2, #7d96bb)' }}>ALL</span>}
                        </td>
                        <td style={{ padding: '9px 12px 9px 0' }}><StatusDot archived={archived} /></td>
                        <td style={{ padding: '9px 0 9px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button
                            className="btn btn-sm"
                            onClick={() => {
                              setPanel({ mode: 'edit', user: u });
                              setNotice(null);
                              setActionError(null);
                            }}
                          >
                            Edit
                          </button>{' '}
                          {!archived ? (
                            <button className="btn btn-sm" style={{ color: 'var(--status-danger, #e5484d)' }} disabled={busy} onClick={() => archiveUser(u)}>
                              Archive
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Create / edit panel ── */}
        {panel ? (
          <div className="card cp-fade-in" style={{ padding: '18px 20px', position: 'sticky', top: 16 }}>
            <SectionTitle>{panel.mode === 'edit' ? 'Edit User' : 'New User'}</SectionTitle>
            <UserForm
              key={panel.mode === 'edit' ? userId(panel.user) : 'create'}
              initial={panel.mode === 'edit' ? panel.user : null}
              busy={busy}
              onCancel={() => setPanel(null)}
              onSubmit={saveUser}
            />
          </div>
        ) : null}
      </div>

      {/* ── Role permissions reference ── */}
      <div className="card" style={{ marginTop: 16, padding: '18px 20px' }}>
        <SectionTitle>Role Permissions Reference</SectionTitle>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {ROLES.map((r) => (
            <div key={r.value} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--bg-muted-2, #f6f9f4)', border: '1px solid var(--border-card, #e3ebde)', borderRadius: 'var(--radius-md, 9px)', padding: '7px 10px', flex: '1 1 320px', minWidth: 280 }}>
              <RoleBadge role={r.value} />
              <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-secondary, #5d7188)' }}>{ROLE_BEHAVIOUR[r.value]}</span>
            </div>
          ))}
        </div>
        <PermissionsReference />
      </div>

      {/* ── Activity log (all users) ── */}
      <div className="card" style={{ marginTop: 16, padding: '18px 20px' }}>
        <SectionTitle>Activity Log — all users</SectionTitle>
        <AuditLog />
      </div>
    </div>
  );
}
