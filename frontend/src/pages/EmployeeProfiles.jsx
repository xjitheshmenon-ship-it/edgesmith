import { useState, useEffect, useMemo, useCallback } from 'react';
import { employeesApi } from '../api/resources';
import { useAuth } from '../store/AuthContext';
import { usePolling } from '../hooks/usePolling';
import { LocationBadge, hexToRgba } from '../components/common/Badges';
import Icon from '../components/common/Icon';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

// ── Roles available on an employee record (mirrors Users & Roles page) ──
const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'operator', label: 'Operator' },
  { value: 'service', label: 'Service' },
  { value: 'shopfloor', label: 'Shopfloor View' },
];
const ROLE_MAP = Object.fromEntries(ROLES.map((r) => [r.value, r]));

const LOCATIONS = [
  { value: 'faridabad', label: 'Faridabad' },
  { value: 'dharmapuri', label: 'Dharmapuri' },
  { value: 'both', label: 'Both' },
];

// ── Badge expiry status thresholds ──
const EXPIRING_WINDOW_DAYS = 30;

// ── Field accessors (tolerant of snake_case / camelCase) ──
const f = (o, ...keys) => {
  for (const k of keys) if (o != null && o[k] != null && o[k] !== '') return o[k];
  return undefined;
};
const empId = (e) => f(e, 'id', 'employee_id', 'employeeId');
const empCode = (e) => f(e, 'employee_code', 'employeeCode', 'emp_code', 'code', 'employee_id', 'employeeId');
const empName = (e) => f(e, 'full_name', 'fullName', 'name');
const empRole = (e) => f(e, 'role', 'role_name');
const empLocation = (e) => f(e, 'location', 'location_id', 'locationId');
const empContact = (e) => f(e, 'contact', 'phone', 'contact_details', 'contactDetails', 'email');
const empActive = (e) => {
  const active = f(e, 'active', 'is_active', 'isActive');
  if (active === false) return false;
  const status = f(e, 'status', 'state');
  if (status === 'inactive' || status === 'archived') return false;
  return true;
};

// ── Badge field accessors ──
const badgeRowId = (b) => f(b, 'id', 'badge_id', 'badgeId', 'employee_badge_id');
const badgeName = (b) => f(b, 'badge_name', 'badgeName', 'name', 'badge_type_name', 'badgeTypeName');
const badgeWorkstation = (b) => f(b, 'workstation', 'workstation_code', 'workstationCode', 'workstation_type', 'workstationType');
const badgeCertifiedDate = (b) => f(b, 'certified_date', 'certifiedDate', 'date_certified', 'dateCertified', 'certified_at');
const badgeCertifiedBy = (b) => f(b, 'certified_by', 'certifiedBy', 'trainer', 'trainer_name');
const badgeExpiry = (b) => f(b, 'expiry_date', 'expiryDate', 'expires_at', 'expiresAt', 'expiry');

// ── Date helpers ──
function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmtDate(v) {
  const d = parseDate(v);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function daysUntil(v) {
  const d = parseDate(v);
  if (!d) return null;
  const ms = d.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

// Resolve a single badge's expiry status: valid | expiring | expired | none
function badgeStatus(b) {
  const expiry = badgeExpiry(b);
  if (!expiry) return { key: 'valid', days: null }; // no expiry → permanently valid
  const days = daysUntil(expiry);
  if (days == null) return { key: 'valid', days: null };
  if (days < 0) return { key: 'expired', days };
  if (days <= EXPIRING_WINDOW_DAYS) return { key: 'expiring', days };
  return { key: 'valid', days };
}

// Roll a list of badge rows up into the worst single status for an employee
function rollupBadgeStatus(badges) {
  if (!badges || badges.length === 0) return 'none';
  let worst = 'valid';
  for (const b of badges) {
    const s = badgeStatus(b).key;
    if (s === 'expired') return 'expired';
    if (s === 'expiring') worst = 'expiring';
  }
  return worst;
}

const STATUS_META = {
  valid: { color: '#22a06b', label: 'All valid', short: 'VALID', icon: 'check' },
  expiring: { color: '#d97a2b', label: 'Expiring soon', short: 'EXPIRING', icon: 'alert' },
  expired: { color: '#e5484d', label: 'Expired', short: 'EXPIRED', icon: 'alert' },
  none: { color: '#9aa0a6', label: 'No badges', short: 'NONE', icon: 'tag' },
};

// ── Small presentational helpers ──────────────────────────────────────────
function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
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
  const accents = { admin: '#7a4fc0', manager: '#2d6fb5', supervisor: '#22a06b', operator: '#1c7a52', service: '#d97a2b', shopfloor: '#9aa0a6' };
  const color = accents[role] || '#5d7188';
  const label = ROLE_MAP[role]?.label || role || '—';
  return (
    <span className="badge" style={{ background: hexToRgba(color, 0.14), color }}>
      {String(label).toUpperCase()}
    </span>
  );
}

function ActiveDot({ active }) {
  const color = active ? '#22a06b' : '#9aa0a6';
  return (
    <span className="status-pill" style={{ background: hexToRgba(color, 0.14), color }}>
      {active ? 'ACTIVE' : 'INACTIVE'}
    </span>
  );
}

function BadgeStatusPill({ statusKey }) {
  const meta = STATUS_META[statusKey] || STATUS_META.none;
  return (
    <span className="status-pill" style={{ background: hexToRgba(meta.color, 0.14), color: meta.color }}>
      {meta.short}
    </span>
  );
}

// ── Badge-expiry dashboard strip (top of page) ──────────────────────────────
function DashboardStrip({ summary, error }) {
  const expired = f(summary, 'expired_count', 'expiredCount', 'employees_with_expired', 'expired') ?? 0;
  const expiring = f(summary, 'expiring_count', 'expiringCount', 'employees_expiring_soon', 'expiring') ?? 0;
  const noQualified = f(summary, 'no_qualified_count', 'noQualifiedCount', 'workstations_without_operator', 'unqualified_workstations', 'noQualified') ?? 0;

  const cells = [
    { label: 'Employees with expired badges', value: expired, color: '#e5484d', icon: 'alert' },
    { label: 'Badges expiring in < 30 days', value: expiring, color: '#d97a2b', icon: 'timer' },
    { label: 'Workstations with no qualified operator', value: noQualified, color: '#e5484d', icon: 'factory', critical: true },
  ];

  return (
    <div className="card" style={{ padding: '16px 20px', marginTop: 18 }}>
      <SectionTitle>Badge Expiry Dashboard</SectionTitle>
      {error ? (
        <ErrorBanner message={error} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {cells.map((c) => (
            <div
              key={c.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: hexToRgba(c.color, 0.07),
                border: `1px solid ${hexToRgba(c.color, c.critical && Number(c.value) > 0 ? 0.45 : 0.2)}`,
                borderRadius: 'var(--radius-lg, 11px)',
                padding: '12px 14px',
              }}
            >
              <div style={{ width: 38, height: 38, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: hexToRgba(c.color, 0.14), flexShrink: 0 }}>
                <Icon name={c.icon} size={18} color={c.color} />
              </div>
              <div>
                <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 26, lineHeight: 1, color: c.color }}>
                  {summary == null ? '—' : c.value}
                </div>
                <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
                  {c.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Employee create / edit form ─────────────────────────────────────────────
const BLANK_EMP = { full_name: '', employee_code: '', role: 'operator', location: 'faridabad', contact: '', active: true };

function EmployeeForm({ initial, busy, onCancel, onSubmit }) {
  const editing = Boolean(initial && empId(initial));
  const [form, setForm] = useState(() =>
    editing
      ? {
          full_name: empName(initial) || '',
          employee_code: empCode(initial) || '',
          role: empRole(initial) || 'operator',
          location: empLocation(initial) || 'faridabad',
          contact: empContact(initial) || '',
          active: empActive(initial),
        }
      : { ...BLANK_EMP }
  );
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    setErr(null);
    if (!form.full_name.trim()) return setErr('Full name is required.');
    if (!form.employee_code.trim()) return setErr('Employee ID is required.');
    const payload = {
      full_name: form.full_name.trim(),
      employee_code: form.employee_code.trim(),
      role: form.role,
      location: form.location,
      contact: form.contact.trim() || null,
      active: form.active,
    };
    onSubmit(payload, editing ? empId(initial) : null).then((apiErr) => {
      if (apiErr) setErr(apiErr);
    });
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <div>
        <label className="form-label">Full name</label>
        <input className="form-input" value={form.full_name} onChange={set('full_name')} placeholder="e.g. Ramesh Kumar" autoComplete="off" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
        <div>
          <label className="form-label">Employee ID</label>
          <input className="form-input" value={form.employee_code} onChange={set('employee_code')} placeholder="EMP-0001" autoComplete="off" disabled={editing} />
        </div>
        <div>
          <label className="form-label">Role</label>
          <select className="form-select" value={form.role} onChange={set('role')}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
        <div>
          <label className="form-label">Location</label>
          <select className="form-select" value={form.location} onChange={set('location')}>
            {LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Contact (optional)</label>
          <input className="form-input" value={form.contact} onChange={set('contact')} placeholder="phone / email" autoComplete="off" />
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--text-primary, #15366a)', cursor: 'pointer' }}>
        <input type="checkbox" checked={form.active} onChange={(e) => setForm((s) => ({ ...s, active: e.target.checked }))} />
        Active employee
      </label>
      {err ? <ErrorBanner message={err} /> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save Changes' : 'Create Employee'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

// ── Assign-badge form ────────────────────────────────────────────────────────
const BLANK_BADGE = { badge_name: '', workstation: '', certified_date: '', certified_by: '', expiry_date: '' };

function AssignBadgeForm({ busy, onCancel, onSubmit }) {
  const [form, setForm] = useState({ ...BLANK_BADGE });
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    setErr(null);
    if (!form.badge_name.trim()) return setErr('Badge name is required.');
    if (!form.certified_date) return setErr('Certification date is required.');
    const payload = {
      badge_name: form.badge_name.trim(),
      workstation: form.workstation.trim() || null,
      certified_date: form.certified_date,
      certified_by: form.certified_by.trim() || null,
      expiry_date: form.expiry_date || null,
    };
    onSubmit(payload).then((apiErr) => {
      if (apiErr) setErr(apiErr);
      else setForm({ ...BLANK_BADGE });
    });
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 11, background: 'var(--bg-muted-2, #f6f9f4)', border: '1px solid var(--border-card, #e3ebde)', borderRadius: 'var(--radius-lg, 11px)', padding: '14px 16px', marginTop: 12 }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary, #5d7188)' }}>
        Assign new badge
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
        <div>
          <label className="form-label">Badge type</label>
          <input className="form-input" value={form.badge_name} onChange={set('badge_name')} placeholder="e.g. HT90 Furnace Certified" autoComplete="off" />
        </div>
        <div>
          <label className="form-label">Workstation</label>
          <input className="form-input" value={form.workstation} onChange={set('workstation')} placeholder="e.g. HT90" autoComplete="off" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 11 }}>
        <div>
          <label className="form-label">Date certified</label>
          <input className="form-input" type="date" value={form.certified_date} onChange={set('certified_date')} />
        </div>
        <div>
          <label className="form-label">Certified by</label>
          <input className="form-input" value={form.certified_by} onChange={set('certified_by')} placeholder="trainer name" autoComplete="off" />
        </div>
        <div>
          <label className="form-label">Expiry (optional)</label>
          <input className="form-input" type="date" value={form.expiry_date} onChange={set('expiry_date')} />
        </div>
      </div>
      {err ? <ErrorBanner message={err} /> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save Badge'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

// ── Skill badges panel (loads badges for the selected employee) ──────────────
function BadgesPanel({ employee, canManage, onChanged }) {
  const id = empId(employee);
  const [badges, setBadges] = useState(null);
  const [error, setError] = useState(null);
  const [showAssign, setShowAssign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(() => {
    if (id == null) return Promise.resolve();
    setError(null);
    return employeesApi
      .badges(id)
      .then((r) => r.data)
      .then((data) => setBadges(Array.isArray(data) ? data : data?.items || []))
      .catch((e) => setError(e.message || 'Could not load badges.'));
  }, [id]);

  useEffect(() => {
    setBadges(null);
    setShowAssign(false);
    setNotice(null);
    setActionError(null);
    load();
  }, [load]);

  async function assignBadge(payload) {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await employeesApi.addBadge(id, payload);
      setNotice(`Badge "${payload.badge_name}" assigned.`);
      setShowAssign(false);
      await load();
      onChanged && onChanged();
      return null;
    } catch (e) {
      return e.message || 'Could not assign the badge.';
    } finally {
      setBusy(false);
    }
  }

  async function removeBadge(b) {
    const name = badgeName(b) || 'this badge';
    if (!window.confirm(`Remove ${name} from ${empName(employee)}?`)) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await employeesApi.removeBadge(id, badgeRowId(b));
      setNotice(`${name} removed.`);
      await load();
      onChanged && onChanged();
    } catch (e) {
      setActionError(e.message || 'Could not remove the badge.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 18 }}>
      <SectionTitle
        right={
          canManage ? (
            <button className="btn btn-sm" onClick={() => { setShowAssign((s) => !s); setActionError(null); setNotice(null); }} disabled={busy}>
              <Icon name="plus" size={14} color="currentColor" /> Assign Badge
            </button>
          ) : null
        }
      >
        Skill Badges
      </SectionTitle>

      {notice ? <div style={{ marginBottom: 12 }}><SuccessBanner message={notice} /></div> : null}
      {actionError ? <div style={{ marginBottom: 12 }}><ErrorBanner message={actionError} /></div> : null}

      {error ? (
        <ErrorBanner message={error} />
      ) : badges == null ? (
        <Empty>Loading badges…</Empty>
      ) : badges.length === 0 ? (
        <Empty>No skill badges held by this employee yet.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {badges.map((b, i) => {
            const st = badgeStatus(b);
            const meta = STATUS_META[st.key];
            return (
              <div
                key={badgeRowId(b) ?? i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  border: `1px solid ${hexToRgba(meta.color, 0.25)}`,
                  background: hexToRgba(meta.color, 0.05),
                  borderRadius: 'var(--radius-lg, 11px)',
                  padding: '12px 14px',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 13.5, color: 'var(--text-primary, #15366a)' }}>
                      {badgeName(b) || '—'}
                    </span>
                    {badgeWorkstation(b) ? (
                      <span className="badge" style={{ background: 'var(--bg-muted, #f4f7f2)', color: 'var(--text-secondary, #5d7188)' }}>
                        {String(badgeWorkstation(b)).toUpperCase()}
                      </span>
                    ) : null}
                    <BadgeStatusPill statusKey={st.key} />
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--text-secondary, #5d7188)', marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                    <span>Certified: {fmtDate(badgeCertifiedDate(b))}</span>
                    {badgeCertifiedBy(b) ? <span>By: {badgeCertifiedBy(b)}</span> : null}
                    <span>
                      Expiry: {badgeExpiry(b) ? fmtDate(badgeExpiry(b)) : 'No expiry'}
                      {badgeExpiry(b) && st.days != null ? (
                        <span style={{ color: meta.color, marginLeft: 6 }}>
                          ({st.days < 0 ? `${Math.abs(st.days)}d ago` : `${st.days}d left`})
                        </span>
                      ) : null}
                    </span>
                  </div>
                </div>
                {canManage ? (
                  <button className="btn btn-sm" style={{ color: 'var(--status-danger, #e5484d)', flexShrink: 0 }} disabled={busy} onClick={() => removeBadge(b)}>
                    Remove
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {canManage && showAssign ? (
        <AssignBadgeForm busy={busy} onCancel={() => setShowAssign(false)} onSubmit={assignBadge} />
      ) : null}
    </div>
  );
}

// ── Employee detail (right panel) ────────────────────────────────────────────
function EmployeeDetail({ employee, canManage, busy, onEdit, onChanged }) {
  return (
    <div className="card cp-fade-in" style={{ padding: '18px 20px', position: 'sticky', top: 16 }}>
      <SectionTitle
        right={
          canManage ? (
            <button className="btn btn-sm" onClick={onEdit} disabled={busy}>Edit Profile</button>
          ) : null
        }
      >
        Employee Profile
      </SectionTitle>

      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 19, letterSpacing: '-0.02em', color: 'var(--text-primary, #15366a)' }}>
        {empName(employee) || '—'}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--text-secondary, #5d7188)', marginTop: 3 }}>
        {empCode(employee) || '—'}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <RoleBadge role={empRole(employee)} />
        {empLocation(employee) === 'both' ? (
          <span className="badge" style={{ background: hexToRgba('#5d7188', 0.14), color: '#5d7188' }}>BOTH LOCATIONS</span>
        ) : empLocation(employee) ? (
          <LocationBadge location={empLocation(employee)} />
        ) : null}
        <ActiveDot active={empActive(employee)} />
      </div>

      {empContact(employee) ? (
        <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', marginTop: 12 }}>
          <span className="form-label" style={{ marginBottom: 2 }}>Contact</span>
          {empContact(employee)}
        </div>
      ) : null}

      <BadgesPanel employee={employee} canManage={canManage} onChanged={onChanged} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function EmployeeProfiles() {
  const { user, isAdmin, isManager, isSupervisor, isOperator } = useAuth();
  const canManage = isAdmin; // admin manages; everyone else is view-only
  const canView = isAdmin || isManager || isSupervisor || isOperator;

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);

  const [panel, setPanel] = useState(null); // null | { mode:'create' } | { mode:'edit', employee }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Live roster + dashboard via polling
  const { data: employees, error: listErr, loading, refetch } = usePolling(
    () => employeesApi.list().then((r) => r.data),
    [],
    { enabled: canView }
  );
  const { data: dashboard, error: dashErr } = usePolling(
    () => employeesApi.badgeDashboard().then((r) => r.data),
    [],
    { enabled: canView }
  );

  const roster = useMemo(() => {
    const arr = Array.isArray(employees) ? employees : employees?.items || [];
    // Operators may only view their own record
    if (isOperator && !isAdmin && !isManager && !isSupervisor) {
      const me = empCode(user) || f(user, 'employee_code', 'username');
      return arr.filter((e) => empId(e) === f(user, 'id', 'employee_id') || empCode(e) === me || empName(e) === f(user, 'full_name', 'fullName', 'name'));
    }
    return arr;
  }, [employees, isOperator, isAdmin, isManager, isSupervisor, user]);

  // Per-employee rolled-up badge status needs each employee's badges. The list
  // endpoint may already include a badge summary; fall back to fields if present.
  const statusOf = useCallback((e) => {
    const explicit = f(e, 'badge_status', 'badgeStatus');
    if (explicit) return String(explicit).toLowerCase();
    const inline = f(e, 'badges', 'skill_badges', 'skillBadges');
    if (Array.isArray(inline)) return rollupBadgeStatus(inline);
    return null; // unknown until detail is opened
  }, []);

  const badgeCountOf = (e) => {
    const c = f(e, 'badge_count', 'badgeCount');
    if (c != null) return c;
    const inline = f(e, 'badges', 'skill_badges', 'skillBadges');
    return Array.isArray(inline) ? inline.length : null;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roster.filter((e) => {
      if (roleFilter !== 'all' && empRole(e) !== roleFilter) return false;
      if (locationFilter !== 'all' && empLocation(e) !== locationFilter) return false;
      if (statusFilter !== 'all') {
        const s = statusOf(e);
        if (s !== statusFilter) return false;
      }
      if (q) {
        const hay = `${empName(e) || ''} ${empCode(e) || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [roster, search, roleFilter, locationFilter, statusFilter, statusOf]);

  const selected = useMemo(
    () => roster.find((e) => empId(e) === selectedId) || null,
    [roster, selectedId]
  );

  // Auto-select the first row once data arrives (admins/managers); operators land on their own.
  useEffect(() => {
    if (selectedId == null && roster.length > 0) setSelectedId(empId(roster[0]));
  }, [roster, selectedId]);

  async function saveEmployee(payload, id) {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      if (id) {
        await employeesApi.update(id, payload);
        setNotice(`Updated ${payload.full_name}.`);
      } else {
        const res = await employeesApi.create(payload);
        setNotice(`Created ${payload.full_name}.`);
        const newId = empId(res?.data) ?? empId(res?.data?.data);
        if (newId != null) setSelectedId(newId);
      }
      setPanel(null);
      await refetch();
      return null;
    } catch (e) {
      return e.message || 'Could not save the employee.';
    } finally {
      setBusy(false);
    }
  }

  // ── View gate ──
  if (!canView) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
        <div className="card" style={{ padding: '40px 28px', textAlign: 'center', maxWidth: 520, margin: '40px auto' }}>
          <Icon name="lock" size={28} color="var(--text-muted, #9bb4d4)" />
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, color: 'var(--text-primary, #15366a)', marginTop: 12 }}>
            Access required
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 6 }}>
            Employee profiles are visible to admins, managers, supervisors and operators.
          </div>
        </div>
      </div>
    );
  }

  const listError = listErr ? (listErr.message || 'Could not load employees.') : null;
  const dashError = dashErr ? (dashErr.message || 'Could not load the badge dashboard.') : null;

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
            Employee Profiles &amp; Badges
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
            Manage employee records and skill badge certifications{loading ? ' · loading…' : ''}
          </div>
        </div>
        {canManage ? (
          <button
            className="btn btn-primary"
            onClick={() => { setPanel({ mode: 'create' }); setNotice(null); setActionError(null); }}
          >
            <Icon name="plus" size={15} color="currentColor" /> New Employee
          </button>
        ) : null}
      </div>

      {/* Badge expiry dashboard strip */}
      <DashboardStrip summary={dashboard} error={dashError} />

      {notice ? <div style={{ marginTop: 16 }}><SuccessBanner message={notice} /></div> : null}
      {actionError ? <div style={{ marginTop: 16 }}><ErrorBanner message={actionError} /></div> : null}

      {/* Roster + detail */}
      <div style={{ display: 'grid', gridTemplateColumns: panel ? '1fr 380px' : '1.4fr 1fr', gap: 16, marginTop: 18, alignItems: 'start' }}>
        {/* ── Roster (left) ── */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionTitle>Roster · {filtered.length} of {roster.length}</SectionTitle>

          {/* Filters */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 160 }}>
              <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <Icon name="search" size={15} color="var(--text-muted, #9bb4d4)" />
              </span>
              <input
                className="form-input"
                style={{ height: 38, paddingLeft: 34 }}
                placeholder="Search name or ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className="form-select" style={{ height: 38, width: 'auto', minWidth: 120 }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="all">All roles</option>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <select className="form-select" style={{ height: 38, width: 'auto', minWidth: 120 }} value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
              <option value="all">All locations</option>
              {LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <select className="form-select" style={{ height: 38, width: 'auto', minWidth: 130 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All badge status</option>
              <option value="valid">All valid</option>
              <option value="expiring">Expiring soon</option>
              <option value="expired">Expired</option>
              <option value="none">No badges</option>
            </select>
          </div>

          {listError ? (
            <ErrorBanner message={listError} />
          ) : loading && employees == null ? (
            <Empty>Loading employees…</Empty>
          ) : filtered.length === 0 ? (
            <Empty>{roster.length === 0 ? 'No employees on record yet.' : 'No employees match the current filters.'}</Empty>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
                    <th style={{ padding: '6px 12px 8px 0' }}>Name</th>
                    <th style={{ padding: '6px 12px 8px 0' }}>ID</th>
                    <th style={{ padding: '6px 12px 8px 0' }}>Role</th>
                    <th style={{ padding: '6px 12px 8px 0' }}>Location</th>
                    <th style={{ padding: '6px 12px 8px 0', textAlign: 'center' }}>Badges</th>
                    <th style={{ padding: '6px 12px 8px 0' }}>Badge status</th>
                    <th style={{ padding: '6px 0 8px 0' }}>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e, i) => {
                    const id = empId(e);
                    const isSel = id === selectedId;
                    const st = statusOf(e);
                    const count = badgeCountOf(e);
                    const loc = empLocation(e);
                    return (
                      <tr
                        key={id ?? empCode(e) ?? i}
                        onClick={() => setSelectedId(id)}
                        style={{
                          borderTop: '1px solid #eef2ea',
                          cursor: 'pointer',
                          background: isSel ? 'var(--bg-soft-green, #e7ece4)' : 'transparent',
                          opacity: empActive(e) ? 1 : 0.6,
                        }}
                      >
                        <td style={{ padding: '9px 12px 9px 0', color: 'var(--text-primary, #15366a)', fontWeight: 600 }}>{empName(e) || '—'}</td>
                        <td style={{ padding: '9px 12px 9px 0', fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary, #5d7188)' }}>{empCode(e) || '—'}</td>
                        <td style={{ padding: '9px 12px 9px 0' }}><RoleBadge role={empRole(e)} /></td>
                        <td style={{ padding: '9px 12px 9px 0' }}>
                          {loc === 'both' ? (
                            <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--text-muted-2, #7d96bb)' }}>BOTH</span>
                          ) : loc ? (
                            <LocationBadge location={loc} />
                          ) : <span style={{ color: 'var(--text-muted, #9bb4d4)' }}>—</span>}
                        </td>
                        <td style={{ padding: '9px 12px 9px 0', textAlign: 'center', fontFamily: MONO, fontSize: 11.5, color: 'var(--text-secondary, #5d7188)' }}>
                          {count == null ? '—' : count}
                        </td>
                        <td style={{ padding: '9px 12px 9px 0' }}>
                          {st ? <BadgeStatusPill statusKey={st} /> : <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted, #9bb4d4)' }}>—</span>}
                        </td>
                        <td style={{ padding: '9px 0 9px 0' }}><ActiveDot active={empActive(e)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Detail / create-edit panel (right) ── */}
        {panel ? (
          <div className="card cp-fade-in" style={{ padding: '18px 20px', position: 'sticky', top: 16 }}>
            <SectionTitle>{panel.mode === 'edit' ? 'Edit Employee' : 'New Employee'}</SectionTitle>
            <EmployeeForm
              key={panel.mode === 'edit' ? empId(panel.employee) : 'create'}
              initial={panel.mode === 'edit' ? panel.employee : null}
              busy={busy}
              onCancel={() => setPanel(null)}
              onSubmit={saveEmployee}
            />
          </div>
        ) : selected ? (
          <EmployeeDetail
            key={empId(selected)}
            employee={selected}
            canManage={canManage}
            busy={busy}
            onEdit={() => { setPanel({ mode: 'edit', employee: selected }); setNotice(null); setActionError(null); }}
            onChanged={refetch}
          />
        ) : (
          <div className="card" style={{ padding: '40px 28px', textAlign: 'center' }}>
            <Icon name="people" size={26} color="var(--text-muted, #9bb4d4)" />
            <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 10 }}>
              Select an employee to view their profile and skill badges.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
