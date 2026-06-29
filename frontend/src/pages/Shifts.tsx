import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { shiftApi, userApi, factoryApi } from '../api/client'
import type { User, Workstation } from '../types'
import { useAuth } from '../hooks/useAuth'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Check,
  Trash2,
  X,
  Clock,
  Sunrise,
  Sun,
  Moon,
  Users,
  Cpu,
  AlertTriangle,
} from 'lucide-react'
import { format, addDays, parseISO } from 'date-fns'

/* ── design tokens (local mirrors) ─────────────────────────────────────────── */
const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"
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

/* ── Three daily shift periods ──────────────────────────────────────────────── */
type ShiftPeriod = 'morning' | 'afternoon' | 'night'
interface PeriodDef {
  key: ShiftPeriod
  label: string
  window: string
  endHour: number // exclusive; night wraps past midnight (24 + 6)
  icon: typeof Sunrise
}
const PERIODS: PeriodDef[] = [
  { key: 'morning', label: 'Morning', window: '06:00 – 14:00', endHour: 14, icon: Sunrise },
  { key: 'afternoon', label: 'Afternoon', window: '14:00 – 22:00', endHour: 22, icon: Sun },
  { key: 'night', label: 'Night', window: '22:00 – 06:00', endHour: 30, icon: Moon },
]

/* Pick the period that contains "now" (used to default the selector). */
function currentPeriod(d: Date): ShiftPeriod {
  const h = d.getHours()
  if (h >= 6 && h < 14) return 'morning'
  if (h >= 14 && h < 22) return 'afternoon'
  return 'night'
}

/* Minutes remaining in the selected shift if it is the live one, else null. */
function minutesRemaining(dateStr: string, def: PeriodDef): number | null {
  const now = new Date()
  const todayStr = format(now, 'yyyy-MM-dd')
  if (dateStr !== todayStr) return null
  if (currentPeriod(now) !== def.key) return null
  const nowH = now.getHours() + now.getMinutes() / 60
  // Night shift: after midnight the clock reads 0–6 but the window ends at 30 (06+24).
  const refH = def.endHour > 24 && nowH < 6 ? nowH + 24 : nowH
  const mins = Math.round((def.endHour - refH) * 60)
  return mins > 0 ? mins : null
}

function hhmm(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

/* ── small primitives ──────────────────────────────────────────────────────── */
const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  fontFamily: MONO, fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap',
}

function StatTile({ value, label, color }: { value: number | string; label: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '14px 18px', minWidth: 0 }}>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 700, fontSize: 26, letterSpacing: '-0.03em', lineHeight: 1, color: color ?? C.ink }}>
        {value}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3, marginTop: 5 }}>
        {label}
      </div>
    </div>
  )
}

const TH: React.CSSProperties = {
  textAlign: 'left', padding: '10px 16px', fontFamily: MONO, fontSize: 10, fontWeight: 600,
  letterSpacing: '0.12em', textTransform: 'uppercase', color: C.ink2,
  borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  padding: '13px 16px', borderBottom: `1px solid ${C.line}`, fontSize: 13, color: C.ink, verticalAlign: 'middle',
}

/* ── row shape (typed as any per backend variance) ─────────────────────────── */
type AssignmentRow = any

/* Resolve a display name for an assignment field that may arrive in several
   shapes depending on the backend serializer. */
function pickUser(row: AssignmentRow, users: User[]): { name: string; sub: string } | null {
  const embedded = row?.user ?? row?.operator
  if (embedded?.full_name) return { name: embedded.full_name, sub: embedded.username ?? embedded.role ?? '' }
  const uid = row?.user_id ?? row?.operator_id ?? embedded?.id ?? null
  if (uid != null) {
    const u = users.find((x) => x.id === uid)
    if (u) return { name: u.full_name, sub: u.role }
  }
  if (row?.operator_name || row?.user_name) return { name: row.operator_name ?? row.user_name, sub: row.role ?? '' }
  return uid != null ? { name: `User #${uid}`, sub: '' } : null
}

function pickWorkstation(row: AssignmentRow, workstations: Workstation[]): { code: string; name: string } | null {
  const embedded = row?.workstation
  if (embedded?.code) return { code: embedded.code, name: embedded.name ?? '' }
  const wid = row?.workstation_id ?? embedded?.id ?? null
  if (wid != null) {
    const w = workstations.find((x) => x.id === wid)
    if (w) return { code: w.code, name: w.name }
  }
  if (row?.workstation_code) return { code: row.workstation_code, name: row.workstation_name ?? '' }
  return wid != null ? { code: `WS #${wid}`, name: '' } : null
}

function isConfirmed(row: AssignmentRow): boolean {
  return Boolean(row?.confirmed ?? row?.is_confirmed ?? row?.confirmed_at ?? row?.status === 'confirmed')
}

/* ─────────────────────────────────────────────────────────────────────────── */
export default function Shifts() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const role = user?.role ?? ''
  const canManage = role === 'admin' || role === 'manager' || role === 'supervisor'

  const today = format(new Date(), 'yyyy-MM-dd')
  const [date, setDate] = useState<string>(today)
  const [period, setPeriod] = useState<ShiftPeriod>(currentPeriod(new Date()))
  const [drawerOpen, setDrawerOpen] = useState(false)

  const periodDef = PERIODS.find((p) => p.key === period)!
  const remaining = minutesRemaining(date, periodDef)
  const isLive = remaining != null

  /* ── reference data ───────────────────────────────────────────────────── */
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['shift-users'],
    queryFn: () => userApi.list().then((r) => r.data),
  })

  const { data: workstations = [] } = useQuery<Workstation[]>({
    queryKey: ['shift-workstations'],
    queryFn: () => factoryApi.workstations().then((r) => r.data),
  })

  /* ── roster for the selected shift ────────────────────────────────────── */
  const {
    data: assignments = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<AssignmentRow[]>({
    queryKey: ['shift-assignments', date, period],
    queryFn: () =>
      shiftApi
        .listAssignments({ shift_date: date, shift_period: period })
        .then((r) => (Array.isArray(r.data) ? r.data : r.data?.items ?? [])),
    retry: false,
  })

  /* ── queue view (best-effort; degrade if endpoint missing) ────────────── */
  const { data: queue } = useQuery({
    queryKey: ['shift-queue', date, period],
    queryFn: () => shiftApi.queueView(date, period).then((r) => r.data),
    retry: false,
  })

  /* ── mutations ─────────────────────────────────────────────────────────── */
  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => shiftApi.createAssignment(data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift-assignments', date, period] })
      setDrawerOpen(false)
    },
  })
  const confirmMut = useMutation({
    mutationFn: (id: number) => shiftApi.confirmAssignment(id).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-assignments', date, period] }),
  })
  const deleteMut = useMutation({
    mutationFn: (id: number) => shiftApi.deleteAssignment(id).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-assignments', date, period] }),
  })

  /* ── derived ───────────────────────────────────────────────────────────── */
  const operators = useMemo(() => users.filter((u) => u.role === 'operator' || u.role === 'shopfloor'), [users])
  const activeWorkstations = useMemo(() => workstations.filter((w) => w.is_active), [workstations])

  const rows = useMemo(() => {
    return assignments
      .map((row) => ({
        u: pickUser(row, users),
        w: pickWorkstation(row, workstations),
        confirmed: isConfirmed(row),
        id: (row?.id ?? null) as number | null,
      }))
      .sort((a, b) => (a.w?.code ?? '').localeCompare(b.w?.code ?? ''))
  }, [assignments, users, workstations])

  const stats = useMemo(() => {
    const total = rows.length
    const confirmed = rows.filter((r) => r.confirmed).length
    const wsSet = new Set(rows.map((r) => r.w?.code).filter(Boolean))
    return { total, confirmed, pending: total - confirmed, stations: wsSet.size }
  }, [rows])

  const supervisor = useMemo(() => {
    const sup = assignments
      .map((row) => pickUser(row, users))
      .find((u) => u && /super/i.test(u.sub))
    return sup ?? null
  }, [assignments, users])

  const shiftLabel = `Shift ${PERIODS.findIndex((p) => p.key === period) + 1}`

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: C.ink }}>
            Shift Management
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, marginTop: 3 }}>
            Operator-to-workstation roster for the selected shift · {format(parseISO(date), 'EEEE, d MMM yyyy')}
          </div>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => setDrawerOpen(true)}>
            <Plus size={15} /> Add assignment
          </button>
        )}
      </div>

      {/* ── Date + period selector ──────────────────────────────────────── */}
      <div className="card" style={{ padding: '16px 18px', marginBottom: 18, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Date stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn-secondary" style={{ padding: '0 10px' }} onClick={() => setDate(format(addDays(parseISO(date), -1), 'yyyy-MM-dd'))} aria-label="Previous day">
            <ChevronLeft size={15} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarDays size={15} style={{ color: C.ink3 }} />
            <input
              type="date"
              className="input"
              style={{ width: 168 }}
              value={date}
              onChange={(e) => setDate(e.target.value || today)}
            />
          </div>
          <button className="btn-secondary" style={{ padding: '0 10px' }} onClick={() => setDate(format(addDays(parseISO(date), 1), 'yyyy-MM-dd'))} aria-label="Next day">
            <ChevronRight size={15} />
          </button>
          {date !== today && (
            <button className="btn-secondary" onClick={() => setDate(today)}>Today</button>
          )}
        </div>

        {/* Period segmented control */}
        <div style={{ display: 'flex', gap: 4, background: C.surface3, borderRadius: 10, padding: 4 }}>
          {PERIODS.map((p) => {
            const on = p.key === period
            const Icon = p.icon
            return (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                title={p.window}
                style={{
                  border: 'none', borderRadius: 7, padding: '7px 14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 7,
                  background: on ? C.surface : 'transparent', color: on ? C.ink : C.ink2,
                  boxShadow: on ? 'var(--shadow-e1)' : 'none',
                }}
              >
                <Icon size={14} style={{ color: on ? C.accent : C.ink3 }} />
                <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>{p.label}</span>
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.ink3, letterSpacing: '0.02em' }}>{p.window}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Shift status strip ──────────────────────────────────────────── */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: 18, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 18 }}>
        <span style={{ ...pill, background: isLive ? 'rgba(34,160,107,.14)' : C.surface3, color: isLive ? C.greenText : C.ink2 }}>
          {isLive && <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.green }} />}
          {isLive ? 'Live now' : 'Scheduled'}
        </span>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.ink2, letterSpacing: '0.06em' }}>
          {shiftLabel} · {periodDef.label} · {periodDef.window}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Users size={14} style={{ color: C.ink3 }} />
          Supervisor: <strong style={{ color: C.ink, fontWeight: 600 }}>{supervisor?.name ?? '—'}</strong>
        </div>
        <div style={{ flex: 1 }} />
        {isLive && remaining != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: MONO, fontSize: 12, color: remaining <= 30 ? C.orange : C.ink2, letterSpacing: '0.04em' }}>
            <Clock size={14} />
            {hhmm(remaining)} remaining
            {remaining <= 30 && <span style={{ ...pill, background: 'rgba(217,122,43,.16)', color: C.orange }}>Handover soon</span>}
          </div>
        )}
      </div>

      {/* ── Stat tiles ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatTile value={stats.total} label="Assignments" />
        <StatTile value={stats.confirmed} label="Confirmed" color={stats.confirmed > 0 ? C.green : undefined} />
        <StatTile value={stats.pending} label="Pending confirm" color={stats.pending > 0 ? C.orange : undefined} />
        <StatTile value={stats.stations} label="Active stations" color={C.accent} />
      </div>

      {/* ── Roster table ────────────────────────────────────────────────── */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={14} style={{ color: C.ink3 }} />
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: C.ink3, textTransform: 'uppercase' }}>
            Shift Roster — Operator &amp; Workstation
          </span>
        </div>

        {isError ? (
          <div style={{ padding: '28px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={20} style={{ color: C.red }} />
            <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, textAlign: 'center' }}>
              Could not load the shift roster. The server may be starting up.
            </div>
            <button className="btn-secondary" onClick={() => refetch()}>Retry</button>
          </div>
        ) : isLoading ? (
          <div style={{ padding: '28px 18px', fontFamily: MONO, fontSize: 12, color: C.ink3, textAlign: 'center' }}>
            Loading roster…
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '36px 18px', textAlign: 'center' }}>
            <div style={{ fontFamily: SANS, fontSize: 14, color: C.ink2, marginBottom: 6 }}>
              No assignments for this shift yet.
            </div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.ink3 }}>
              {canManage ? 'Use “Add assignment” to build the roster.' : 'The roster has not been published.'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={TH}>Workstation</th>
                  <th style={TH}>Operator</th>
                  <th style={TH}>Status</th>
                  {canManage && <th style={{ ...TH, textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id ?? i} className="row-hover">
                    <td style={TD}>
                      {r.w ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Cpu size={13} style={{ color: C.ink3 }} />
                          <span style={{ fontFamily: MONO, fontWeight: 600, color: C.accent }}>{r.w.code}</span>
                          <span style={{ color: C.ink2 }}>{r.w.name}</span>
                        </div>
                      ) : (
                        <span style={{ color: C.ink3 }}>—</span>
                      )}
                    </td>
                    <td style={TD}>
                      {r.u ? (
                        <div>
                          <div style={{ fontWeight: 500 }}>{r.u.name}</div>
                          {r.u.sub && <div style={{ fontFamily: MONO, fontSize: 10, color: C.ink3, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{r.u.sub}</div>}
                        </div>
                      ) : (
                        <span style={{ color: C.ink3 }}>—</span>
                      )}
                    </td>
                    <td style={TD}>
                      {r.confirmed ? (
                        <span style={{ ...pill, background: 'rgba(34,160,107,.14)', color: C.greenText }}><Check size={11} /> Confirmed</span>
                      ) : (
                        <span style={{ ...pill, background: 'rgba(217,122,43,.16)', color: C.orange }}>Pending</span>
                      )}
                    </td>
                    {canManage && (
                      <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {!r.confirmed && r.id != null && (
                          <button
                            className="btn-secondary"
                            style={{ height: 30, padding: '0 10px', marginRight: 8 }}
                            disabled={confirmMut.isPending}
                            onClick={() => confirmMut.mutate(r.id as number)}
                          >
                            <Check size={13} /> Confirm
                          </button>
                        )}
                        {r.id != null && (
                          <button
                            className="btn-secondary"
                            style={{ height: 30, padding: '0 10px', color: C.red }}
                            disabled={deleteMut.isPending}
                            onClick={() => deleteMut.mutate(r.id as number)}
                            aria-label="Remove assignment"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Queue view for the shift (best-effort) ──────────────────────── */}
      {Array.isArray(queue) && queue.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cpu size={14} style={{ color: C.ink3 }} />
            <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: C.ink3, textTransform: 'uppercase' }}>
              Workstation Queue — This Shift
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={TH}>Workstation</th>
                  <th style={TH}>Operator(s)</th>
                  <th style={{ ...TH, textAlign: 'right' }}>UIDs in queue</th>
                </tr>
              </thead>
              <tbody>
                {(queue as any[]).map((q: any, i: number) => {
                  const w = pickWorkstation(q, workstations)
                  const count = q?.uid_count ?? q?.queued ?? (Array.isArray(q?.uids) ? q.uids.length : 0)
                  const ops: string[] = Array.isArray(q?.operators)
                    ? q.operators.map((o: any) => o?.full_name ?? o?.name ?? o).filter(Boolean)
                    : q?.operator_name
                    ? [q.operator_name]
                    : []
                  return (
                    <tr key={i} className="row-hover">
                      <td style={TD}>
                        <span style={{ fontFamily: MONO, fontWeight: 600, color: C.accent }}>{w?.code ?? '—'}</span>
                        {w?.name && <span style={{ color: C.ink2, marginLeft: 8 }}>{w.name}</span>}
                      </td>
                      <td style={{ ...TD, color: C.ink2 }}>{ops.length ? ops.join(', ') : '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: ARCHIVO, fontWeight: 700, fontSize: 15, color: count > 0 ? C.ink : C.ink3 }}>
                        {count}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Footer note on spec gaps ────────────────────────────────────── */}
      <div style={{ marginTop: 22, fontFamily: MONO, fontSize: 9.5, color: C.ink3, letterSpacing: '0.06em', lineHeight: 1.6 }}>
        Schedule calendar, draft/publish workflow and the supervisor handover panel require dedicated endpoints (not yet available).
      </div>

      {/* ── Add-assignment drawer ───────────────────────────────────────── */}
      {drawerOpen && (
        <AssignmentDrawer
          operators={operators}
          allUsers={users}
          workstations={activeWorkstations}
          date={date}
          period={period}
          periodLabel={`${shiftLabel} · ${periodDef.label}`}
          submitting={createMut.isPending}
          error={createMut.isError}
          onClose={() => { setDrawerOpen(false); createMut.reset() }}
          onSubmit={(payload) => createMut.mutate(payload)}
        />
      )}
    </div>
  )
}

/* ── Add-assignment drawer ──────────────────────────────────────────────────── */
function AssignmentDrawer({
  operators,
  allUsers,
  workstations,
  date,
  period,
  periodLabel,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  operators: User[]
  allUsers: User[]
  workstations: Workstation[]
  date: string
  period: ShiftPeriod
  periodLabel: string
  submitting: boolean
  error: boolean
  onClose: () => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const [userId, setUserId] = useState<string>('')
  const [wsId, setWsId] = useState<string>('')

  // Prefer operators, but allow any user (e.g. assigning a supervisor) as fallback.
  const userOptions = operators.length > 0 ? operators : allUsers
  const valid = userId !== '' && wsId !== ''

  const submit = () => {
    if (!valid) return
    onSubmit({
      user_id: Number(userId),
      workstation_id: Number(wsId),
      shift_date: date,
      shift_period: period,
    })
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(21,54,106,.28)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}
      onClick={onClose}
    >
      <div
        className="animate-es"
        style={{ width: 'min(440px, 100%)', height: '100%', background: C.surface, boxShadow: 'var(--shadow-e5)', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em', color: C.ink }}>Add assignment</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.ink3, letterSpacing: '0.06em', marginTop: 4, textTransform: 'uppercase' }}>
              {periodLabel} · {format(parseISO(date), 'd MMM yyyy')}
            </div>
          </div>
          <button onClick={onClose} className="btn-secondary" style={{ height: 32, width: 32, padding: 0, justifyContent: 'center' }} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18, flex: 1, overflowY: 'auto' }}>
          <div>
            <label className="label">Operator</label>
            <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Select operator…</option>
              {userOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.role})
                </option>
              ))}
            </select>
            {operators.length === 0 && (
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.ink3, marginTop: 6 }}>
                No operator-role users found — showing all users.
              </div>
            )}
          </div>

          <div>
            <label className="label">Workstation</label>
            <select className="input" value={wsId} onChange={(e) => setWsId(e.target.value)}>
              <option value="">Select workstation…</option>
              {workstations.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div style={{ fontFamily: SANS, fontSize: 12, color: C.red, padding: '10px 12px', background: 'rgba(229,72,77,.1)', borderRadius: 9, border: '1px solid rgba(229,72,77,.25)' }}>
              Could not create the assignment. Check that this operator is not already assigned for this shift.
            </div>
          )}
        </div>

        <div style={{ padding: '16px 22px', borderTop: `1px solid ${C.line}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!valid || submitting} onClick={submit}>
            <Plus size={15} /> {submitting ? 'Adding…' : 'Add assignment'}
          </button>
        </div>
      </div>
    </div>
  )
}
