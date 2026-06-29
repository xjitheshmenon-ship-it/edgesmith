import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { userApi, factoryApi } from '../api/client'
import type { FactoryLocation, Workstation } from '../types'
import {
  Users as UsersIcon,
  Search,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Award,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Plus,
  Info,
  MapPin,
  Clock,
} from 'lucide-react'

/* ─── design tokens ─────────────────────────────────────────────────────────── */
const C = {
  ink: 'var(--ink)',
  ink2: 'var(--ink-2)',
  ink3: 'var(--ink-3)',
  accent: 'var(--accent)',
  line: 'var(--line)',
  surface: 'var(--surface)',
  surface2: 'var(--surface-2)',
  surface3: 'var(--surface-3)',
  red: '#e5484d',
  redText: '#c0392b',
  orange: '#d97a2b',
  amber: '#f0c674',
  green: '#22a06b',
  greenText: '#1c7a52',
}
const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"

/* The roster only exposes username / full_name / role / location / is_active.
   Skills & badge data (certifications, expiry, trainer) require a dedicated
   endpoint that is not yet available — badge UI is rendered as structure only. */
interface Employee {
  id: number
  username: string
  full_name: string
  role: string
  primary_location_id: number | null
  is_active: boolean
}

const ROLES = ['admin', 'manager', 'supervisor', 'operator', 'service', 'shopfloor'] as const

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  supervisor: 'Supervisor',
  operator: 'Operator',
  service: 'Service',
  shopfloor: 'Shopfloor View',
}

/* ─── small primitives ─────────────────────────────────────────────────────── */
const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  fontFamily: MONO, fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap',
}

function SectionLabel({ icon, children, right }: { icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      {icon}
      <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: C.ink3, textTransform: 'uppercase' }}>{children}</span>
      <div style={{ flex: 1 }} />
      {right}
    </div>
  )
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '–'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: '#d4eecb', color: '#11305f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: ARCHIVO, fontWeight: 700, fontSize: size * 0.38, letterSpacing: '-0.02em',
    }}>
      {initials(name)}
    </div>
  )
}

function RolePill({ role }: { role: string }) {
  return <span style={{ ...pill, background: C.surface3, color: C.ink2 }}>{ROLE_LABEL[role] ?? role}</span>
}

/* Badge data source is not available, so every employee's badge status reads as
   "unknown" — we still render the three-state structure the spec requires. */
type BadgeStatus = 'valid' | 'expiring' | 'expired' | 'unknown'
function BadgeStatusPill({ status }: { status: BadgeStatus }) {
  const map: Record<BadgeStatus, { bg: string; fg: string; label: string; icon: React.ReactNode }> = {
    valid:    { bg: 'rgba(34,160,107,.14)', fg: C.greenText, label: 'All valid',     icon: <ShieldCheck size={11} /> },
    expiring: { bg: 'rgba(217,122,43,.16)', fg: C.orange,    label: 'Expiring soon', icon: <ShieldAlert size={11} /> },
    expired:  { bg: 'rgba(229,72,77,.13)',  fg: C.redText,   label: 'Expired',       icon: <ShieldX size={11} /> },
    unknown:  { bg: C.surface3,             fg: C.ink3,      label: 'No data',       icon: <Info size={11} /> },
  }
  const s = map[status]
  return <span style={{ ...pill, background: s.bg, color: s.fg, textTransform: 'none', letterSpacing: '0.02em' }}>{s.icon}{s.label}</span>
}

/* ─── badge expiry summary strip ────────────────────────────────────────────── */
function SummaryTile({ value, label, color, icon, note }: {
  value: number | string; label: string; color: string; icon: React.ReactNode; note?: string
}) {
  return (
    <div className="card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 42, height: 42, borderRadius: 11, background: `${color}1f`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 26, letterSpacing: '-0.03em', color: C.ink, lineHeight: 1 }}>{value}</div>
        <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.08em', color: C.ink3, textTransform: 'uppercase', marginTop: 5 }}>{label}</div>
        {note && <div style={{ fontFamily: SANS, fontSize: 10.5, color: C.ink3, marginTop: 3 }}>{note}</div>}
      </div>
    </div>
  )
}

/* ─── table cell styles ─────────────────────────────────────────────────────── */
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '9px 14px', fontFamily: MONO, fontSize: 9.5, fontWeight: 700,
  letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3,
  borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  padding: '11px 14px', borderBottom: `1px solid var(--surface-2)`, fontSize: 12.5, color: C.ink, verticalAlign: 'middle',
}

/* ─── employee detail panel ─────────────────────────────────────────────────── */
function DetailPanel({
  emp, locations, onToggleActive, pending,
}: {
  emp: Employee
  locations: FactoryLocation[]
  onToggleActive: (e: Employee) => void
  pending: boolean
}) {
  const locName = emp.primary_location_id
    ? locations.find((l) => l.id === emp.primary_location_id)?.name ?? `Location ${emp.primary_location_id}`
    : 'Both / unassigned'

  return (
    <div className="card" style={{ padding: '20px 22px', position: 'sticky', top: 20 }}>
      {/* Profile header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <Avatar name={emp.full_name} size={52} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 22, letterSpacing: '-0.03em', color: C.ink, lineHeight: 1.1 }}>
            {emp.full_name || emp.username}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.ink2, letterSpacing: '0.04em' }}>{emp.username}</span>
            <RolePill role={emp.role} />
          </div>
        </div>
      </div>

      {/* Profile fields */}
      <SectionLabel icon={<UsersIcon size={13} style={{ color: C.ink3 }} />}>Profile</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 22 }}>
        <Field label="Role" value={ROLE_LABEL[emp.role] ?? emp.role} />
        <Field label="Employee ID" value={emp.username} mono />
        <Field label="Location" value={locName} icon={<MapPin size={12} style={{ color: C.ink3 }} />} />
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Status</div>
          <button
            onClick={() => onToggleActive(emp)}
            disabled={pending}
            className={emp.is_active ? 'btn-secondary' : 'btn-primary'}
            style={{ height: 30, fontSize: 12 }}
          >
            {emp.is_active ? <CheckCircle size={13} /> : <XCircle size={13} />}
            {pending ? 'Saving…' : emp.is_active ? 'Active — Deactivate' : 'Inactive — Activate'}
          </button>
        </div>
      </div>

      {/* Skill badges */}
      <SectionLabel
        icon={<Award size={13} style={{ color: C.ink3 }} />}
        right={
          <button className="btn-secondary" style={{ height: 28, fontSize: 11.5 }} disabled title="Badge data source not yet available">
            <Plus size={13} /> Assign Badge
          </button>
        }
      >
        Skill Badges
      </SectionLabel>

      <div style={{
        border: `1px dashed ${C.line}`, borderRadius: 11, padding: '20px 18px',
        background: C.surface2, display: 'flex', alignItems: 'flex-start', gap: 11,
      }}>
        <Info size={16} style={{ color: C.ink3, flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, fontWeight: 500 }}>
            Badge data source not yet available
          </div>
          <div style={{ fontFamily: SANS, fontSize: 12, color: C.ink3, marginTop: 4, lineHeight: 1.5 }}>
            Per-employee skill badges — certified workstation, date certified, certified by, expiry &amp; days
            remaining — require a dedicated badges endpoint that is not yet exposed by the API. The list and
            assignment controls will populate once that endpoint is live.
          </div>
        </div>
      </div>

      {/* Structural placeholder badge rows (the shape each badge row will take) */}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8, opacity: 0.55 }}>
        {[0, 1].map((i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px',
            border: `1px solid ${C.line}`, borderRadius: 10, background: C.surface,
          }}>
            <Award size={15} style={{ color: C.ink3, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: SANS, fontSize: 12.5, color: C.ink2, fontWeight: 500 }}>Badge name · Workstation</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.ink3, marginTop: 2 }}>Certified — · By — · Expiry —</div>
            </div>
            <BadgeStatusPill status="unknown" />
          </div>
        ))}
      </div>
    </div>
  )
}

function Field({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: mono ? MONO : SANS, fontSize: 13, color: C.ink }}>
        {icon}{value}
      </div>
    </div>
  )
}

/* ─── page ─────────────────────────────────────────────────────────────────── */
export default function Employees() {
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [locFilter, setLocFilter] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data: employees = [], isLoading, isError } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => userApi.list().then((r) => r.data),
  })

  const { data: locations = [] } = useQuery<FactoryLocation[]>({
    queryKey: ['locations'],
    queryFn: () => factoryApi.locations().then((r) => r.data),
  })

  // Workstations underpin the (future) "no qualified operator" risk surface.
  const { data: workstations = [] } = useQuery<Workstation[]>({
    queryKey: ['workstations'],
    queryFn: () => factoryApi.workstations().then((r) => r.data),
  })

  const toggleActive = useMutation({
    mutationFn: (e: Employee) => userApi.update(e.id, { is_active: !e.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  })

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return employees
      .filter((e) => roleFilter === 'all' || e.role === roleFilter)
      .filter((e) => {
        if (locFilter === 'all') return true
        if (locFilter === 'none') return e.primary_location_id == null
        return String(e.primary_location_id) === locFilter
      })
      .filter((e) => !term || e.full_name.toLowerCase().includes(term) || e.username.toLowerCase().includes(term))
      .sort((a, b) => (a.full_name || a.username).localeCompare(b.full_name || b.username))
  }, [employees, roleFilter, locFilter, search])

  const selected = useMemo(
    () => filtered.find((e) => e.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId]
  )

  const activeWorkstations = workstations.filter((w) => w.is_active).length

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: C.ink }}>
            Employee Profiles &amp; Badges
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, marginTop: 3 }}>
            {employees.length} employee{employees.length === 1 ? '' : 's'} · skill-badge assignments control workstation eligibility
          </div>
        </div>
        <button className="btn-primary" disabled title="Add via Users & Roles — employee creation handled there">
          <Plus size={15} /> Add Employee
        </button>
      </div>

      {/* ── Badge expiry summary strip ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, marginBottom: 18 }}>
        <SummaryTile value="—" label="Employees · Expired Badges" color={C.red} icon={<ShieldX size={20} />} note="Pending badge endpoint" />
        <SummaryTile value="—" label="Badges Expiring < 30 Days" color={C.orange} icon={<ShieldAlert size={20} />} note="Pending badge endpoint" />
        <SummaryTile value={activeWorkstations} label="Active Workstations" color={C.accent} icon={<ShieldCheck size={20} />} note="Qualified-operator coverage TBD" />
      </div>

      {/* ── Badge-source notice ────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', borderRadius: 10,
        background: 'rgba(217,122,43,.10)', border: '1px solid rgba(217,122,43,.25)',
        color: C.orange, fontSize: 12.5, marginBottom: 20, fontFamily: SANS,
      }}>
        <AlertTriangle size={15} style={{ flexShrink: 0 }} />
        Skill-badge data (certifications, expiry, trainer, no-qualified-operator alerts) requires a dedicated endpoint not yet
        available. Profiles below are built from the employee roster; badge management is shown as structure only.
      </div>

      {isError && (
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.red, padding: '12px 16px', background: 'rgba(229,72,77,.10)', borderRadius: 10, border: '1px solid rgba(229,72,77,.25)', marginBottom: 18 }}>
          Could not load the employee roster. The server may be starting up — refresh in a moment.
        </div>
      )}

      {/* ── Two-panel layout: list (left) + detail (right) ─────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 1.5fr) minmax(360px, 1fr)', gap: 18, alignItems: 'start' }}>

        {/* Left: employee list */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionLabel icon={<UsersIcon size={13} style={{ color: C.ink3 }} />}>Employee Roster</SectionLabel>

          {/* Filters */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 160 }}>
              <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: C.ink3 }} />
              <input
                className="input"
                style={{ paddingLeft: 32 }}
                placeholder="Search name or ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className="input" style={{ width: 'auto', minWidth: 130, flex: '0 0 auto' }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="all">All roles</option>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <select className="input" style={{ width: 'auto', minWidth: 130, flex: '0 0 auto' }} value={locFilter} onChange={(e) => setLocFilter(e.target.value)}>
              <option value="all">All locations</option>
              {locations.map((l) => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
              <option value="none">Both / unassigned</option>
            </select>
          </div>

          {isLoading ? (
            <div style={{ fontFamily: MONO, fontSize: 12, color: C.ink3, padding: '24px 0' }}>Loading roster…</div>
          ) : filtered.length === 0 ? (
            <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink3, padding: '24px 0' }}>
              {employees.length === 0 ? 'No employees on record.' : 'No employees match the current filters.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto', margin: '0 -8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 540 }}>
                <thead>
                  <tr>
                    <th style={TH}>Name</th>
                    <th style={TH}>Employee ID</th>
                    <th style={TH}>Role</th>
                    <th style={TH}>Location</th>
                    <th style={TH}>Badges</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    const isSel = selected?.id === e.id
                    const loc = e.primary_location_id
                      ? locations.find((l) => l.id === e.primary_location_id)?.name ?? `Loc ${e.primary_location_id}`
                      : 'Both'
                    return (
                      <tr
                        key={e.id}
                        className="row-hover"
                        onClick={() => setSelectedId(e.id)}
                        style={{ cursor: 'pointer', background: isSel ? 'var(--accent-dim)' : undefined }}
                      >
                        <td style={TD}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <Avatar name={e.full_name || e.username} size={28} />
                            <span style={{ fontFamily: SANS, fontWeight: 500, color: C.ink }}>{e.full_name || e.username}</span>
                          </div>
                        </td>
                        <td style={{ ...TD, fontFamily: MONO, color: C.ink2 }}>{e.username}</td>
                        <td style={TD}><RolePill role={e.role} /></td>
                        <td style={{ ...TD, fontFamily: SANS, color: C.ink2 }}>{loc}</td>
                        <td style={TD}><BadgeStatusPill status="unknown" /></td>
                        <td style={{ ...TD, textAlign: 'right' }}>
                          {e.is_active
                            ? <span style={{ ...pill, background: 'rgba(34,160,107,.14)', color: C.greenText }}>Active</span>
                            : <span style={{ ...pill, background: C.surface3, color: C.ink3 }}>Inactive</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid var(--surface-2)`, display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 9.5, color: C.ink3, letterSpacing: '0.06em' }}>
            <Clock size={11} />
            Badge-status column shows “No data” until a skills/badge endpoint is exposed.
          </div>
        </div>

        {/* Right: detail panel */}
        {selected ? (
          <DetailPanel
            emp={selected}
            locations={locations}
            onToggleActive={(e) => toggleActive.mutate(e)}
            pending={toggleActive.isPending}
          />
        ) : (
          <div className="card" style={{ padding: 32, textAlign: 'center', fontFamily: MONO, fontSize: 12, color: C.ink3 }}>
            Select an employee to view their profile and badges.
          </div>
        )}
      </div>
    </div>
  )
}
