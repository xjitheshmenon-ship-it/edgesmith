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
  Flame,
  PauseCircle,
  Wrench,
  ClipboardCheck,
  History,
  CalendarRange,
  Activity,
  Send,
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
type Tab = 'schedule' | 'active' | 'history'

export default function Shifts() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const role = user?.role ?? ''
  // Updated access table: Admin/Manager fully manage the schedule (add/confirm/remove
  // assignments). Supervisor = view + handover. Operator = view only.
  const canManageSchedule = role === 'admin' || role === 'manager'
  // Handover is the supervisor's write power; Admin/Manager may also act on it.
  const canHandover = role === 'admin' || role === 'manager' || role === 'supervisor'

  const today = format(new Date(), 'yyyy-MM-dd')
  const [date, setDate] = useState<string>(today)
  const [period, setPeriod] = useState<ShiftPeriod>(currentPeriod(new Date()))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('active')

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
        {canManageSchedule && tab === 'schedule' && (
          <button className="btn-primary" onClick={() => setDrawerOpen(true)}>
            <Plus size={15} /> Add assignment
          </button>
        )}
      </div>

      {/* ── Tabs: Schedule / Active Shift / Shift History ─────────────────── */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.line}`, marginBottom: 18 }}>
        {([
          { key: 'schedule', label: 'Schedule', icon: CalendarRange },
          { key: 'active', label: 'Active Shift', icon: Activity },
          { key: 'history', label: 'Shift History', icon: History },
        ] as { key: Tab; label: string; icon: typeof Activity }[]).map((t) => {
          const on = t.key === tab
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 7, padding: '10px 14px',
                fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: on ? C.ink : C.ink3,
                borderBottom: on ? `2px solid ${C.accent}` : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              <Icon size={14} style={{ color: on ? C.accent : C.ink3 }} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ── Date + period selector (Schedule & Active tabs) ─────────────── */}
      {tab !== 'history' && (
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
      )}

      {/* ── Shift status strip (Active tab) ─────────────────────────────── */}
      {tab === 'active' && (
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
            {remaining <= 30 && <span style={{ ...pill, background: 'rgba(217,122,43,.16)', color: C.orange }}>Handover window open</span>}
          </div>
        )}
      </div>
      )}

      {/* ── SCHEDULE TAB ─────────────────────────────────────────────────── */}
      {tab === 'schedule' && (<>
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
              {canManageSchedule ? 'Use “Add assignment” to build the roster.' : 'The roster has not been published.'}
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
                  {canManageSchedule && <th style={{ ...TH, textAlign: 'right' }}>Actions</th>}
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
                    {canManageSchedule && (
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

      {/* ── Footer note on Schedule spec gaps ───────────────────────────── */}
      <div style={{ marginTop: 22, fontFamily: MONO, fontSize: 9.5, color: C.ink3, letterSpacing: '0.06em', lineHeight: 1.6 }}>
        Calendar view, copy-last-week auto-fill and the draft/publish workflow require dedicated schedule endpoints (not yet available).
      </div>
      </>)}

      {/* ── ACTIVE SHIFT TAB ─────────────────────────────────────────────── */}
      {tab === 'active' && (
        <ActiveShiftTab
          rows={rows}
          queue={queue}
          workstations={workstations}
          isLive={isLive}
          remaining={remaining}
          shiftLabel={shiftLabel}
          periodLabel={periodDef.label}
          supervisorName={supervisor?.name ?? null}
          canHandover={canHandover}
          date={date}
          period={period}
        />
      )}

      {/* ── SHIFT HISTORY TAB ────────────────────────────────────────────── */}
      {tab === 'history' && <ShiftHistoryTab />}

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
          error={createMut.isError ? ((createMut.error as any)?.response?.data?.detail ?? 'Could not create the assignment. The operator may already be assigned for this shift.') : ''}
          onClose={() => { setDrawerOpen(false); createMut.reset() }}
          onSubmit={(payload) => createMut.mutate(payload)}
        />
      )}
    </div>
  )
}

/* ── shared row shape produced by the main component ─────────────────────────── */
interface RosterRow {
  u: { name: string; sub: string } | null
  w: { code: string; name: string } | null
  confirmed: boolean
  id: number | null
}

/* ── Active Shift tab: status, workstation assignment, handover panel ────────── */
function ActiveShiftTab({
  rows,
  queue,
  workstations,
  isLive,
  remaining,
  shiftLabel,
  periodLabel,
  supervisorName,
  canHandover,
  date,
  period,
}: {
  rows: RosterRow[]
  queue: unknown
  workstations: Workstation[]
  isLive: boolean
  remaining: number | null
  shiftLabel: string
  periodLabel: string
  supervisorName: string | null
  canHandover: boolean
  date: string
  period: ShiftPeriod
}) {
  // Handover window opens within 30 minutes of shift end (spec: Page 19).
  const handoverOpen = isLive && remaining != null && remaining <= 30

  // Build the per-workstation status table. Prefer live queue rows; otherwise
  // derive from the roster so the table is never empty when a roster exists.
  const queueRows = Array.isArray(queue) ? (queue as any[]) : []
  const wsTable = useMemo(() => {
    if (queueRows.length > 0) {
      return queueRows.map((q: any) => {
        const w = pickWorkstation(q, workstations)
        const count = q?.uid_count ?? q?.queued ?? (Array.isArray(q?.uids) ? q.uids.length : 0)
        const ops: string[] = Array.isArray(q?.operators)
          ? q.operators.map((o: any) => o?.full_name ?? o?.name ?? o).filter(Boolean)
          : q?.operator_name
          ? [q.operator_name]
          : []
        const status = (q?.status as string) ?? (count > 0 ? 'running' : 'idle')
        return { code: w?.code ?? '—', name: w?.name ?? '', ops, count, status }
      })
    }
    // Roster-derived fallback: group operators by workstation.
    const byWs = new Map<string, { name: string; ops: string[] }>()
    rows.forEach((r) => {
      if (!r.w) return
      const cur = byWs.get(r.w.code) ?? { name: r.w.name, ops: [] }
      if (r.u) cur.ops.push(r.u.name)
      byWs.set(r.w.code, cur)
    })
    return Array.from(byWs.entries()).map(([code, v]) => ({
      code, name: v.name, ops: v.ops, count: 0, status: 'idle' as string,
    }))
  }, [queueRows, rows, workstations])

  return (
    <>
      {/* Handover countdown banner */}
      {handoverOpen && (
        <div className="card" style={{ padding: '14px 18px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${C.orange}`, background: 'rgba(217,122,43,.06)' }}>
          <Clock size={18} style={{ color: C.orange }} />
          <div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 700, fontSize: 15, color: C.ink }}>
              Handover window open — {remaining} min to shift end
            </div>
            <div style={{ fontFamily: SANS, fontSize: 12, color: C.ink2, marginTop: 2 }}>
              The outgoing supervisor should complete the handover before the next shift takes over.
            </div>
          </div>
        </div>
      )}

      {/* Workstation assignment for current shift */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Cpu size={14} style={{ color: C.ink3 }} />
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: C.ink3, textTransform: 'uppercase' }}>
            Workstation Assignment — Current Shift
          </span>
        </div>
        {wsTable.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', fontFamily: SANS, fontSize: 13, color: C.ink2 }}>
            No active workstations assigned for this shift.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
              <thead>
                <tr>
                  <th style={TH}>Workstation</th>
                  <th style={TH}>Assigned operator(s)</th>
                  <th style={TH}>Job status</th>
                  <th style={{ ...TH, textAlign: 'right' }}>UIDs processing</th>
                </tr>
              </thead>
              <tbody>
                {wsTable.map((q, i) => (
                  <tr key={i} className="row-hover">
                    <td style={TD}>
                      <span style={{ fontFamily: MONO, fontWeight: 600, color: C.accent }}>{q.code}</span>
                      {q.name && <span style={{ color: C.ink2, marginLeft: 8 }}>{q.name}</span>}
                    </td>
                    <td style={{ ...TD, color: C.ink2 }}>{q.ops.length ? q.ops.join(', ') : '—'}</td>
                    <td style={TD}><JobStatusPill status={q.status} /></td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: ARCHIVO, fontWeight: 700, fontSize: 15, color: q.count > 0 ? C.ink : C.ink3 }}>
                      {q.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ padding: '10px 18px', borderTop: `1px solid ${C.line}`, fontFamily: MONO, fontSize: 9.5, color: C.ink3, letterSpacing: '0.04em' }}>
          Reassigning operators within the active shift requires a dedicated endpoint (not yet available).
        </div>
      </div>

      {/* Shift handover panel */}
      <HandoverPanel
        wsTable={wsTable}
        shiftLabel={shiftLabel}
        periodLabel={periodLabel}
        outgoing={supervisorName}
        canHandover={canHandover}
        handoverOpen={handoverOpen}
        date={date}
        period={period}
      />
    </>
  )
}

function JobStatusPill({ status }: { status: string }) {
  const s = status.toLowerCase()
  if (s === 'running' || s === 'active')
    return <span style={{ ...pill, background: 'rgba(34,160,107,.14)', color: C.greenText }}>Running</span>
  if (s === 'on hold' || s === 'on_hold' || s === 'hold')
    return <span style={{ ...pill, background: 'rgba(229,72,77,.12)', color: C.redText }}>On hold</span>
  return <span style={{ ...pill, background: C.surface3, color: C.ink2 }}>Idle</span>
}

/* ── Shift handover panel ────────────────────────────────────────────────────
   Structured per spec (Page 19 / Shifts §handover). Wired to the persisted
   handover endpoints: getHandover reflects an existing record's submitted /
   acknowledged status, submitHandover captures the panel's notes + workstation
   snapshot, acknowledgeHandover lets the incoming supervisor take over. */
function safeTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), 'HH:mm, d MMM')
  } catch {
    return iso
  }
}

function HandoverPanel({
  wsTable,
  shiftLabel,
  periodLabel,
  outgoing,
  canHandover,
  handoverOpen,
  date,
  period,
}: {
  wsTable: { code: string; name: string; ops: string[]; count: number; status: string }[]
  shiftLabel: string
  periodLabel: string
  outgoing: string | null
  canHandover: boolean
  handoverOpen: boolean
  date: string
  period: ShiftPeriod
}) {
  const qc = useQueryClient()

  // Existing persisted handover for this shift (null when none submitted yet).
  const { data: handover } = useQuery<any>({
    queryKey: ['shift-handover', date, period],
    queryFn: () =>
      shiftApi.getHandover({ shift_date: date, shift_period: period }).then((r) => r.data ?? null),
    retry: false,
  })

  const submittedRow = handover ?? null
  const isAcknowledged = submittedRow?.status === 'acknowledged'

  // Outgoing supervisor confirms the auto-populated workstation statuses.
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  const [furnace, setFurnace] = useState('')
  const [onHold, setOnHold] = useState('')
  const [equipment, setEquipment] = useState('')
  const [urgent, setUrgent] = useState('')

  const allConfirmed = wsTable.length > 0 && wsTable.every((w) => confirmed[w.code])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['shift-handover', date, period] })
    qc.invalidateQueries({ queryKey: ['shift-history'] })
  }

  const submitMut = useMutation({
    mutationFn: () =>
      shiftApi
        .submitHandover({
          shift_date: date,
          shift_period: period,
          furnace_notes: furnace || undefined,
          on_hold_notes: onHold || undefined,
          equipment_issues: equipment || undefined,
          urgent_notes: urgent || undefined,
          workstation_status: wsTable.map((w) => ({
            code: w.code,
            name: w.name,
            status: w.status,
            uid_count: w.count,
            operators: w.ops,
            confirmed: !!confirmed[w.code],
          })),
        })
        .then((r) => r.data),
    onSuccess: invalidate,
  })

  const ackMut = useMutation({
    mutationFn: (id: number) => shiftApi.acknowledgeHandover(id).then((r) => r.data),
    onSuccess: invalidate,
  })

  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 20 }}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <ClipboardCheck size={14} style={{ color: C.ink3 }} />
        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: C.ink3, textTransform: 'uppercase' }}>
          Shift Handover Panel
        </span>
        {handoverOpen && (
          <span style={{ ...pill, background: 'rgba(217,122,43,.16)', color: C.orange, marginLeft: 'auto' }}>Window open</span>
        )}
      </div>

      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ fontFamily: SANS, fontSize: 12.5, color: C.ink2 }}>
          Outgoing: <strong style={{ color: C.ink, fontWeight: 600 }}>{submittedRow?.outgoing_supervisor_name ?? outgoing ?? '—'}</strong>
          {' · '}{shiftLabel} · {periodLabel}
        </div>

        {!canHandover && !submittedRow && (
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, padding: '14px 16px', background: C.surface3, borderRadius: 9 }}>
            Handover is performed by the supervisor on duty. You have view-only access to this shift.
          </div>
        )}

        {/* A handover already exists for this shift — show its persisted status. */}
        {submittedRow ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontFamily: SANS, fontSize: 13, color: C.greenText, display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'rgba(34,160,107,.1)', borderRadius: 9 }}>
              <Check size={15} /> Handover submitted by {submittedRow.outgoing_supervisor_name ?? outgoing ?? 'outgoing supervisor'} at {safeTime(submittedRow.submitted_at)}.
            </div>

            {(submittedRow.furnace_notes || submittedRow.on_hold_notes || submittedRow.equipment_issues || submittedRow.urgent_notes) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {submittedRow.furnace_notes && <ReadNote icon={Flame} label="Furnace batches" text={submittedRow.furnace_notes} />}
                {submittedRow.on_hold_notes && <ReadNote icon={PauseCircle} label="UIDs on hold" text={submittedRow.on_hold_notes} />}
                {submittedRow.equipment_issues && <ReadNote icon={Wrench} label="Equipment issues" text={submittedRow.equipment_issues} />}
                {submittedRow.urgent_notes && <ReadNote icon={AlertTriangle} label="Urgent notes" text={submittedRow.urgent_notes} />}
              </div>
            )}

            {isAcknowledged ? (
              <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink, display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: C.surface3, borderRadius: 9 }}>
                <ClipboardCheck size={15} style={{ color: C.greenText }} /> Acknowledged by {submittedRow.incoming_supervisor_name ?? 'incoming supervisor'} at {safeTime(submittedRow.acknowledged_at)}. Handover complete — both supervisors named on record.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.ink2 }}>
                  Awaiting incoming supervisor. Until acknowledged, the outgoing supervisor remains supervisor of record.
                </span>
                {canHandover && (
                  <button
                    className="btn-primary"
                    disabled={ackMut.isPending || submittedRow.id == null}
                    onClick={() => ackMut.mutate(submittedRow.id as number)}
                  >
                    <ClipboardCheck size={15} /> {ackMut.isPending ? 'Acknowledging…' : 'Acknowledge & take over'}
                  </button>
                )}
                {ackMut.isError && (
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.red }}>Could not acknowledge — retry.</span>
                )}
              </div>
            )}
          </div>
        ) : canHandover ? (
          <>
            {/* 1. Workstation status confirm */}
            <section>
              <SectionLabel icon={Cpu} text="Workstation status (confirm or edit)" />
              {wsTable.length === 0 ? (
                <EmptyLine text="No active workstations to confirm." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {wsTable.map((w) => (
                    <label key={w.code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: `1px solid ${C.line}`, borderRadius: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={!!confirmed[w.code]}
                        onChange={(e) => setConfirmed((c) => ({ ...c, [w.code]: e.target.checked }))}
                      />
                      <span style={{ fontFamily: MONO, fontWeight: 600, color: C.accent }}>{w.code}</span>
                      <span style={{ color: C.ink2, fontSize: 12.5, flex: 1 }}>{w.name}</span>
                      <JobStatusPill status={w.status} />
                      <span style={{ fontFamily: MONO, fontSize: 11, color: C.ink3 }}>{w.count} UID(s)</span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            {/* 2. Furnace batches in progress */}
            <section>
              <SectionLabel icon={Flame} text="Furnace batches in progress" />
              <textarea
                className="input"
                style={{ minHeight: 64, resize: 'vertical', marginTop: 8 }}
                placeholder="Running or mid-soak furnace batches and their state…"
                value={furnace}
                onChange={(e) => setFurnace(e.target.value)}
              />
            </section>

            {/* 3. UIDs on hold */}
            <section>
              <SectionLabel icon={PauseCircle} text="UIDs on hold" />
              <textarea
                className="input"
                style={{ minHeight: 64, resize: 'vertical', marginTop: 8 }}
                placeholder="On-hold UIDs and the reason they are held…"
                value={onHold}
                onChange={(e) => setOnHold(e.target.value)}
              />
            </section>

            {/* 4. Equipment issues (free text, optional) */}
            <section>
              <SectionLabel icon={Wrench} text="Equipment issues (optional)" />
              <textarea
                className="input"
                style={{ minHeight: 64, resize: 'vertical', marginTop: 8 }}
                placeholder="Any equipment issues or workstation problems noted during the shift…"
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
              />
            </section>

            {/* 5. Urgent notes for incoming supervisor (free text) */}
            <section>
              <SectionLabel icon={AlertTriangle} text="Urgent notes for incoming supervisor" />
              <textarea
                className="input"
                style={{ minHeight: 80, resize: 'vertical', marginTop: 8 }}
                placeholder="QC failures needing attention, general notes for the next shift…"
                value={urgent}
                onChange={(e) => setUrgent(e.target.value)}
              />
            </section>

            {/* Submit */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
              <button
                className="btn-primary"
                disabled={!allConfirmed || submitMut.isPending}
                onClick={() => submitMut.mutate()}
              >
                <Send size={15} /> {submitMut.isPending ? 'Submitting…' : 'Submit handover'}
              </button>
              {!allConfirmed && (
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.ink3 }}>
                  Confirm every workstation status to enable submit.
                </span>
              )}
              {submitMut.isError && (
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.red }}>Could not submit handover — retry.</span>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

function ReadNote({ icon: Icon, label, text }: { icon: typeof Cpu; label: string; text: string }) {
  return (
    <div style={{ padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <Icon size={13} style={{ color: C.ink3 }} />
        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.ink2 }}>{label}</span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: C.ink, whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  )
}

function SectionLabel({ icon: Icon, text }: { icon: typeof Cpu; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <Icon size={14} style={{ color: C.ink3 }} />
      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.ink2 }}>{text}</span>
    </div>
  )
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div style={{ fontFamily: SANS, fontSize: 12, color: C.ink3, marginTop: 6, padding: '10px 12px', background: C.surface3, borderRadius: 8 }}>
      {text}
    </div>
  )
}

/* ── Shift History tab ──────────────────────────────────────────────────────
   Populated from the handover-history endpoint (most recent first). */
function periodLabelOf(p: string): string {
  const def = PERIODS.find((x) => x.key === p)
  if (!def) return p
  return `${def.label}`
}

function StatusCell({ status, at, kind }: { status: string | undefined; at: string | null | undefined; kind: 'submitted' | 'acknowledged' }) {
  if (kind === 'submitted') {
    if (!at) return <span style={{ color: C.ink3 }}>—</span>
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ ...pill, background: 'rgba(34,160,107,.14)', color: C.greenText }}><Check size={11} /> Submitted</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.ink3 }}>{safeTime(at)}</span>
      </div>
    )
  }
  if (status === 'acknowledged' && at) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ ...pill, background: 'rgba(34,160,107,.14)', color: C.greenText }}><ClipboardCheck size={11} /> Acknowledged</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.ink3 }}>{safeTime(at)}</span>
      </div>
    )
  }
  return <span style={{ ...pill, background: 'rgba(217,122,43,.16)', color: C.orange }}>Pending</span>
}

function ShiftHistoryTab() {
  const cols = ['Date', 'Shift', 'Location', 'Supervisor', 'Handover submitted', 'Acknowledged']

  const { data: history = [], isLoading, isError, refetch } = useQuery<any[]>({
    queryKey: ['shift-history'],
    queryFn: () =>
      shiftApi.history().then((r) => {
        const d = r.data
        const arr = Array.isArray(d) ? d : d?.items ?? []
        return [...arr].sort((a: any, b: any) => {
          const ka = `${a?.shift_date ?? ''}`
          const kb = `${b?.shift_date ?? ''}`
          return kb.localeCompare(ka)
        })
      }),
    retry: false,
  })

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <History size={14} style={{ color: C.ink3 }} />
        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: C.ink3, textTransform: 'uppercase' }}>
          Shift History — Completed Shifts
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead>
            <tr>{cols.map((c) => <th key={c} style={TH}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {isError ? (
              <tr>
                <td colSpan={cols.length} style={{ ...TD, textAlign: 'center', padding: '36px 18px' }}>
                  <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, marginBottom: 10 }}>
                    Could not load shift history. The server may be starting up.
                  </div>
                  <button className="btn-secondary" onClick={() => refetch()}>Retry</button>
                </td>
              </tr>
            ) : isLoading ? (
              <tr>
                <td colSpan={cols.length} style={{ ...TD, textAlign: 'center', padding: '36px 18px', fontFamily: MONO, fontSize: 12, color: C.ink3 }}>
                  Loading history…
                </td>
              </tr>
            ) : history.length === 0 ? (
              <tr>
                <td colSpan={cols.length} style={{ ...TD, textAlign: 'center', padding: '40px 18px' }}>
                  <div style={{ fontFamily: SANS, fontSize: 14, color: C.ink2, marginBottom: 6 }}>
                    No completed shifts on record yet.
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.ink3, letterSpacing: '0.04em' }}>
                    Submitted handovers will appear here once shifts are handed over.
                  </div>
                </td>
              </tr>
            ) : (
              history.map((h: any, i: number) => {
                const supervisor = h?.outgoing_supervisor_name ?? h?.supervisor_name ?? '—'
                const location = h?.factory_location_name ?? h?.location_name ?? (h?.factory_location_id != null ? `Location #${h.factory_location_id}` : '—')
                let dateLabel: string = h?.shift_date ?? '—'
                try {
                  if (h?.shift_date) dateLabel = format(parseISO(h.shift_date), 'd MMM yyyy')
                } catch { /* keep raw */ }
                return (
                  <tr key={h?.id ?? `${h?.shift_date}-${h?.shift_period}-${i}`} className="row-hover">
                    <td style={{ ...TD, whiteSpace: 'nowrap' }}>{dateLabel}</td>
                    <td style={TD}>
                      <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink2 }}>{periodLabelOf(h?.shift_period ?? '')}</span>
                    </td>
                    <td style={{ ...TD, color: C.ink2 }}>{location}</td>
                    <td style={TD}>{supervisor}</td>
                    <td style={TD}><StatusCell kind="submitted" status={h?.status} at={h?.submitted_at} /></td>
                    <td style={TD}><StatusCell kind="acknowledged" status={h?.status} at={h?.acknowledged_at} /></td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
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
  error: string
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
      operator_id: Number(userId),
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
              {error}
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
