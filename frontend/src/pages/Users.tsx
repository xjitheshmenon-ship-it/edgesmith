import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { userApi, factoryApi } from '../api/client'
import type { FactoryLocation } from '../types'
import { useAuth } from '../hooks/useAuth'
import {
  Users as UsersIcon,
  Plus,
  Search,
  Pencil,
  X,
  ShieldCheck,
  KeyRound,
  AlertTriangle,
  MapPin,
  CheckCircle2,
  Lock,
} from 'lucide-react'

/* ─── design tokens (local mirrors of palette where no CSS var exists) ─────── */
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
  green: '#22a06b',
  greenText: '#1c7a52',
}
const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"

/* ─── roles ─────────────────────────────────────────────────────────────────── */
type RoleKey = 'admin' | 'manager' | 'supervisor' | 'operator' | 'service' | 'shopfloor'

const ROLES: { key: RoleKey; label: string; color: string }[] = [
  { key: 'admin', label: 'Admin', color: '#7c3aed' },
  { key: 'manager', label: 'Manager', color: '#2d6fb5' },
  { key: 'supervisor', label: 'Supervisor', color: '#0ea5e9' },
  { key: 'operator', label: 'Operator', color: C.green },
  { key: 'service', label: 'Service', color: C.orange },
  { key: 'shopfloor', label: 'Shopfloor View', color: '#6b7280' },
]
const ROLE_MAP: Record<string, { label: string; color: string }> = Object.fromEntries(
  ROLES.map((r) => [r.key, { label: r.label, color: r.color }])
)

/* Role behaviour reference (from spec — "Role behaviour" section). */
const ROLE_BEHAVIOUR: Record<RoleKey, string> = {
  admin: 'Full access. Sees both locations. Manages users, factory config and all data.',
  manager: 'Sees both locations. Plans shift schedules and oversees production.',
  supervisor: 'Sees assigned location by default, with option to view the other. Floor oversight & sign-off.',
  operator: 'Sees assigned location by default. Executes step work on the production floor.',
  service: 'Only the Service Call Lookup page. No production access.',
  shopfloor: 'Only the Shopfloor Display page. No login required (PIN or open access).',
}

/* ─── shared cell styles ───────────────────────────────────────────────────── */
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '10px 16px', fontFamily: MONO, fontSize: 10, fontWeight: 600,
  letterSpacing: '0.12em', textTransform: 'uppercase', color: C.ink2,
  borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  padding: '13px 16px', borderBottom: `1px solid ${C.line}`, fontSize: 13, color: C.ink, verticalAlign: 'middle',
}

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  fontFamily: MONO, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap',
}

function RoleBadge({ role }: { role: string }) {
  const r = ROLE_MAP[role] ?? { label: role || '—', color: C.ink2 }
  return <span style={{ ...pill, background: `${r.color}1f`, color: r.color }}>{r.label}</span>
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span style={{ ...pill, background: 'rgba(34,160,107,.14)', color: C.greenText }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green }} /> Active
    </span>
  ) : (
    <span style={{ ...pill, background: 'rgba(154,160,166,.16)', color: '#6b7280' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#9aa0a6' }} /> Inactive
    </span>
  )
}

/* A user record from the API. The `is_active` field may or may not be present;
   we treat its absence as "active" so the page degrades gracefully. */
function isActive(u: any): boolean {
  return u?.is_active !== false
}

/* ─── create / edit drawer ─────────────────────────────────────────────────── */
interface DraftForm {
  full_name: string
  username: string
  password: string
  role: RoleKey
  primary_location_id: number | null
  is_active: boolean
}

function UserDrawer({
  editing,
  locations,
  onClose,
  onSubmit,
  saving,
  error,
}: {
  editing: any | null // null = create mode
  locations: FactoryLocation[]
  onClose: () => void
  onSubmit: (data: Record<string, unknown>, isEdit: boolean) => void
  saving: boolean
  error: string | null
}) {
  const isEdit = !!editing
  const [form, setForm] = useState<DraftForm>(() => ({
    full_name: editing?.full_name ?? '',
    username: editing?.username ?? '',
    password: '',
    role: (editing?.role as RoleKey) ?? 'operator',
    primary_location_id: editing?.primary_location_id ?? null,
    is_active: isActive(editing),
  }))

  const set = <K extends keyof DraftForm>(k: K, v: DraftForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  const canSubmit = isEdit
    ? true
    : form.full_name.trim() !== '' && form.username.trim() !== '' && form.password.trim() !== ''

  function submit() {
    if (!canSubmit || saving) return
    if (isEdit) {
      // Edit: role, active, location, optional password reset.
      const payload: Record<string, unknown> = {
        role: form.role,
        is_active: form.is_active,
        primary_location_id: form.primary_location_id,
      }
      if (form.password.trim()) payload.password = form.password.trim()
      onSubmit(payload, true)
    } else {
      onSubmit(
        {
          full_name: form.full_name.trim(),
          username: form.username.trim(),
          password: form.password.trim(),
          role: form.role,
          primary_location_id: form.primary_location_id,
          is_active: form.is_active,
        },
        false
      )
    }
  }

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(21,54,106,.28)', zIndex: 40 }}
      />
      {/* drawer */}
      <div
        className="animate-es"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 100vw)',
          background: C.surface, borderLeft: `1px solid ${C.line}`, boxShadow: 'var(--shadow-e5)',
          zIndex: 41, display: 'flex', flexDirection: 'column',
        }}
      >
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px', borderBottom: `1px solid ${C.line}` }}>
          <div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 19, letterSpacing: '-0.03em', color: C.ink }}>
              {isEdit ? 'Edit User' : 'New User'}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.1em', color: C.ink3, marginTop: 3, textTransform: 'uppercase' }}>
              {isEdit ? editing.username : 'Create account'}
            </div>
          </div>
          <button onClick={onClose} className="btn-secondary" style={{ width: 36, padding: 0, justifyContent: 'center' }}>
            <X size={16} />
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="label">Full Name</label>
            <input
              className="input"
              value={form.full_name}
              disabled={isEdit}
              placeholder="e.g. Ramesh Kumar"
              onChange={(e) => set('full_name', e.target.value)}
            />
            {isEdit && <FieldNote text="Name and username are fixed after creation." />}
          </div>

          <div>
            <label className="label">Username</label>
            <input
              className="input"
              value={form.username}
              disabled={isEdit}
              placeholder="e.g. rkumar"
              onChange={(e) => set('username', e.target.value)}
            />
          </div>

          <div>
            <label className="label">{isEdit ? 'Reset Password' : 'Password'}</label>
            <input
              className="input"
              type="password"
              value={form.password}
              placeholder={isEdit ? 'Leave blank to keep current' : 'Set initial password'}
              onChange={(e) => set('password', e.target.value)}
            />
            {isEdit && <FieldNote text="Enter a new password only to reset it." />}
          </div>

          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={(e) => set('role', e.target.value as RoleKey)}>
              {ROLES.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
            <div style={{ marginTop: 8, padding: '9px 11px', background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, display: 'flex', gap: 8 }}>
              <ShieldCheck size={14} style={{ color: ROLE_MAP[form.role]?.color ?? C.ink2, flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontFamily: SANS, fontSize: 12, color: C.ink2, lineHeight: 1.45 }}>{ROLE_BEHAVIOUR[form.role]}</span>
            </div>
          </div>

          <div>
            <label className="label">Location Assignment</label>
            <select
              className="input"
              value={form.primary_location_id ?? ''}
              onChange={(e) => set('primary_location_id', e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Both / Unassigned</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            {(form.role === 'admin' || form.role === 'manager') && (
              <FieldNote text="Admin & Manager see both locations regardless of assignment." />
            )}
          </div>

          <div>
            <label className="label">Status</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {([['active', true], ['inactive', false]] as const).map(([label, val]) => {
                const on = form.is_active === val
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => set('is_active', val)}
                    style={{
                      flex: 1, height: 38, borderRadius: 9, cursor: 'pointer',
                      border: on ? `1px solid ${val ? C.green : C.red}` : `1px solid ${C.line}`,
                      background: on ? (val ? 'rgba(34,160,107,.1)' : 'rgba(229,72,77,.08)') : C.surface,
                      color: on ? (val ? C.greenText : C.redText) : C.ink2,
                      fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 12.5, color: C.redText, padding: '10px 12px', background: 'rgba(229,72,77,.1)', border: '1px solid rgba(229,72,77,.25)', borderRadius: 10 }}>
              <AlertTriangle size={15} /> {error}
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ display: 'flex', gap: 10, padding: '16px 22px', borderTop: `1px solid ${C.line}` }}>
          <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={submit} disabled={!canSubmit || saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      </div>
    </>
  )
}

function FieldNote({ text }: { text: string }) {
  return (
    <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.04em', color: C.ink3, marginTop: 5, lineHeight: 1.4 }}>
      {text}
    </div>
  )
}

/* ─── page ─────────────────────────────────────────────────────────────────── */
export default function Users() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isAdmin = user?.role === 'admin'

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleKey | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [drawer, setDrawer] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null })
  const [saveError, setSaveError] = useState<string | null>(null)

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => userApi.list().then((r) => r.data),
    enabled: isAdmin,
    retry: false,
  })

  const { data: locations = [] } = useQuery<FactoryLocation[]>({
    queryKey: ['factory-locations'],
    queryFn: () => factoryApi.locations().then((r) => r.data),
    enabled: isAdmin,
  })

  const locName = useMemo(() => {
    const m = new Map<number, string>()
    for (const l of locations) m.set(l.id, l.name)
    return m
  }, [locations])

  const users: any[] = useMemo(() => {
    const d = usersQuery.data
    if (Array.isArray(d)) return d
    if (d && Array.isArray(d.items)) return d.items
    return []
  }, [usersQuery.data])

  const saveMutation = useMutation({
    mutationFn: ({ data, isEdit, id }: { data: Record<string, unknown>; isEdit: boolean; id?: number }) =>
      isEdit ? userApi.update(id!, data).then((r) => r.data) : userApi.create(data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setDrawer({ open: false, editing: null })
      setSaveError(null)
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      setSaveError(typeof detail === 'string' ? detail : 'Could not save user. Please try again.')
    },
  })

  function handleSubmit(data: Record<string, unknown>, isEdit: boolean) {
    setSaveError(null)
    saveMutation.mutate({ data, isEdit, id: drawer.editing?.id })
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (statusFilter === 'active' && !isActive(u)) return false
      if (statusFilter === 'inactive' && isActive(u)) return false
      if (term) {
        const hay = `${u.full_name ?? ''} ${u.username ?? ''} ${u.role ?? ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [users, search, roleFilter, statusFilter])

  const counts = useMemo(() => {
    const total = users.length
    const active = users.filter(isActive).length
    const admins = users.filter((u) => u.role === 'admin').length
    return { total, active, inactive: total - active, admins }
  }, [users])

  /* ── Non-admin guard ──────────────────────────────────────────────────── */
  if (!isAdmin) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
        <div className="card" style={{ padding: 40, textAlign: 'center', maxWidth: 460, margin: '40px auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(229,72,77,.1)', color: C.red, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Lock size={24} />
          </div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 20, letterSpacing: '-0.03em', color: C.ink }}>Admin access required</div>
          <div style={{ fontFamily: SANS, fontSize: 13.5, color: C.ink2, lineHeight: 1.5 }}>
            Users &amp; Roles is restricted to administrators. Contact your system admin if you need an account change.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: C.ink }}>Users &amp; Roles</div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, marginTop: 3 }}>
            Manage system accounts, roles and location assignments
          </div>
        </div>
        <button className="btn-primary" onClick={() => { setSaveError(null); setDrawer({ open: true, editing: null }) }}>
          <Plus size={15} /> New User
        </button>
      </div>

      {/* stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatTile value={counts.total} label="Total Users" icon={<UsersIcon size={18} />} color={C.accent} />
        <StatTile value={counts.active} label="Active" icon={<CheckCircle2 size={18} />} color={C.green} />
        <StatTile value={counts.inactive} label="Inactive" icon={<X size={18} />} color="#9aa0a6" />
        <StatTile value={counts.admins} label="Administrators" icon={<ShieldCheck size={18} />} color="#7c3aed" />
      </div>

      {/* filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: C.ink3 }} />
          <input
            className="input"
            style={{ width: 240, paddingLeft: 32 }}
            placeholder="Search name or username…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input" style={{ width: 'auto', minWidth: 150 }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleKey | 'all')}>
          <option value="all">All roles</option>
          {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <select className="input" style={{ width: 'auto', minWidth: 130 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}>
          <option value="all">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.08em', color: C.ink3, textTransform: 'uppercase' }}>
          {filtered.length} of {users.length}
        </span>
      </div>

      {/* user table */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 24 }}>
        {usersQuery.isError ? (
          <ErrorState />
        ) : usersQuery.isLoading ? (
          <div style={{ padding: '40px 16px', fontFamily: MONO, fontSize: 12, color: C.ink3, textAlign: 'center' }}>Loading users…</div>
        ) : filtered.length === 0 ? (
          <EmptyState hasUsers={users.length > 0} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={TH}>Name</th>
                  <th style={TH}>Username</th>
                  <th style={TH}>Role</th>
                  <th style={TH}>Location</th>
                  <th style={TH}>Status</th>
                  <th style={{ ...TH, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const both = u.role === 'admin' || u.role === 'manager'
                  const loc = u.primary_location_id != null ? locName.get(u.primary_location_id) : null
                  return (
                    <tr key={u.id} className="row-hover">
                      <td style={TD}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{
                            width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                            background: `${ROLE_MAP[u.role]?.color ?? C.ink2}1f`,
                            color: ROLE_MAP[u.role]?.color ?? C.ink2,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontFamily: ARCHIVO, fontWeight: 700, fontSize: 12,
                          }}>
                            {initials(u.full_name || u.username)}
                          </span>
                          <span style={{ fontFamily: SANS, fontWeight: 500, color: C.ink }}>{u.full_name || '—'}</span>
                        </div>
                      </td>
                      <td style={{ ...TD, fontFamily: MONO, fontSize: 12.5, color: C.ink2 }}>{u.username}</td>
                      <td style={TD}><RoleBadge role={u.role} /></td>
                      <td style={{ ...TD, color: C.ink2 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <MapPin size={12} style={{ color: C.ink3 }} />
                          {both ? 'Both' : loc ?? 'Unassigned'}
                        </span>
                      </td>
                      <td style={TD}><StatusBadge active={isActive(u)} /></td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        <button
                          className="btn-secondary"
                          style={{ height: 30, padding: '0 11px', fontSize: 12 }}
                          onClick={() => { setSaveError(null); setDrawer({ open: true, editing: u }) }}
                        >
                          <Pencil size={13} /> Edit
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* role permissions reference */}
      <div className="card" style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <KeyRound size={13} style={{ color: C.ink3 }} />
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: C.ink3, textTransform: 'uppercase' }}>
            Role Permissions Reference
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
          {ROLES.map((r) => (
            <div key={r.key} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.color }} />
                <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.04em', color: C.ink, textTransform: 'uppercase' }}>{r.label}</span>
              </div>
              <div style={{ fontFamily: SANS, fontSize: 12.5, color: C.ink2, lineHeight: 1.5 }}>{ROLE_BEHAVIOUR[r.key]}</div>
            </div>
          ))}
        </div>
      </div>

      {drawer.open && (
        <UserDrawer
          editing={drawer.editing}
          locations={locations}
          saving={saveMutation.isPending}
          error={saveError}
          onClose={() => { if (!saveMutation.isPending) { setDrawer({ open: false, editing: null }); setSaveError(null) } }}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}

/* ─── small pieces ─────────────────────────────────────────────────────────── */
function StatTile({ value, label, icon, color }: { value: number; label: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 28, letterSpacing: '-0.03em', color: C.ink, lineHeight: 1 }}>{value}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3, marginTop: 6 }}>{label}</div>
      </div>
      <div style={{ width: 40, height: 40, borderRadius: 11, background: `${color}1f`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
    </div>
  )
}

function EmptyState({ hasUsers }: { hasUsers: boolean }) {
  return (
    <div style={{ padding: '48px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <UsersIcon size={26} style={{ color: C.ink3 }} />
      <div style={{ fontFamily: SANS, fontSize: 13.5, color: C.ink2 }}>
        {hasUsers ? 'No users match the current filter.' : 'No users yet. Create the first account.'}
      </div>
    </div>
  )
}

function ErrorState() {
  return (
    <div style={{ padding: '40px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <AlertTriangle size={24} style={{ color: C.red }} />
      <div style={{ fontFamily: SANS, fontSize: 13.5, color: C.ink2 }}>Could not load users. The server may be starting up — refresh in a moment.</div>
    </div>
  )
}

function initials(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
