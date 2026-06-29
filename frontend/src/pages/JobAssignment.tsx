import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { shiftApi, uidApi, userApi, factoryApi } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import { format, formatDistanceToNowStrict } from 'date-fns'
import {
  Zap,
  X,
  Plus,
  Flame,
  AlertTriangle,
  ChevronRight,
  Clock,
  Filter,
  RefreshCw,
  Users,
  ListChecks,
  CircleSlash,
} from 'lucide-react'

/* ── Micro-styles ─────────────────────────────────────────────────────────── */
const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCH = "'Archivo', sans-serif"

/* ── Shift definitions (mirror of Shifts.tsx) ─────────────────────────────── */
const SHIFTS = [
  { value: 'morning', label: 'Morning', time: '06:00 – 14:00', color: '#f59e0b' },
  { value: 'afternoon', label: 'Afternoon', time: '14:00 – 22:00', color: '#3b82f6' },
  { value: 'night', label: 'Night', time: '22:00 – 06:00', color: '#a78bfa' },
]

/* Furnace steps always go to the Supervisor on duty — never auto-assigned. */
const isFurnaceStep = (name?: string | null) => {
  const n = (name ?? '').toLowerCase()
  return n.includes('temper') || n.includes('harden') || n.includes('quench')
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2 }

/* ── Small primitives ─────────────────────────────────────────────────────── */
function PriorityPill({ priority }: { priority: string }) {
  if (priority === 'normal') return null
  const color = priority === 'urgent' ? '#e5484d' : '#d97a2b'
  const bg = priority === 'urgent' ? 'rgba(229,72,77,.13)' : 'rgba(217,122,43,.14)'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: MONO,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        padding: '2px 8px',
        borderRadius: 20,
        background: bg,
        color,
      }}
    >
      {priority}
    </span>
  )
}

function CyclePill({ name }: { name: string | null }) {
  if (!name) return null
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: MONO,
        fontSize: 9.5,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '.04em',
        padding: '2px 8px',
        borderRadius: 20,
        background: 'rgba(45,111,181,.14)',
        color: '#2d6fb5',
      }}
    >
      {name}
    </span>
  )
}

function SectionLabel({ icon, children, right }: { icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      {icon}
      <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '.12em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>
        {children}
      </span>
      <div style={{ flex: 1 }} />
      {right}
    </div>
  )
}

function waitLabel(iso?: string | null) {
  if (!iso) return '—'
  try {
    return formatDistanceToNowStrict(new Date(iso))
  } catch {
    return '—'
  }
}

function initials(name?: string | null) {
  return (name || '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function JobAssignment() {
  const { user } = useAuth()

  /* UPDATED access (spec line 1600): Operator = view own queue only (read-only).
     Supervisors/Managers/Admins get the full assignment board. */
  if (user?.role === 'operator') return <OperatorOwnQueue user={user} />

  return <SupervisorBoard />
}

function SupervisorBoard() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const canEdit = !!user?.role && ['admin', 'manager', 'supervisor'].includes(user.role)

  const today = format(new Date(), 'yyyy-MM-dd')
  const [shiftDate, setShiftDate] = useState(today)
  const [shiftPeriod, setShiftPeriod] = useState('morning')

  // Left-panel filters
  const [search, setSearch] = useState('')
  const [wsFilter, setWsFilter] = useState('')
  const [cycleFilter, setCycleFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')

  // Manual-assign selection
  const [selectedJob, setSelectedJob] = useState<any>(null)
  const [autoResult, setAutoResult] = useState<{ allotted: number } | null>(null)

  const shiftInfo = SHIFTS.find((s) => s.value === shiftPeriod)!
  const scopedLocation =
    user?.role === 'operator' || user?.role === 'supervisor' ? user?.primary_location_id ?? undefined : undefined

  /* ── Data: candidate jobs (active UIDs ready for their next step) ──────── */
  const {
    data: uidResult,
    isLoading: uidLoading,
    isError: uidError,
  } = useQuery({
    queryKey: ['ja-uids', scopedLocation],
    queryFn: () => uidApi.list({ status: 'active', location_id: scopedLocation, limit: 200 }).then((r) => r.data),
    refetchInterval: 30_000,
    retry: false,
  })
  const allUids: any[] = uidResult?.items ?? []

  /* ── Data: current allotments for this shift (already-assigned jobs) ───── */
  const { data: allotments = [] } = useQuery({
    queryKey: ['ja-allotments', shiftDate, shiftPeriod],
    queryFn: () =>
      shiftApi.listAllotments({ shift_date: shiftDate, shift_period: shiftPeriod }).then((r) => r.data),
    refetchInterval: 30_000,
    retry: false,
  })

  /* ── Data: operator assignment board (workstation/operator + queues) ───── */
  const {
    data: queueData = [],
    isLoading: queueLoading,
    isError: queueError,
    refetch: refetchQueue,
  } = useQuery({
    queryKey: ['ja-queue', shiftDate, shiftPeriod],
    queryFn: () => shiftApi.queueView(shiftDate, shiftPeriod).then((r) => r.data),
    refetchInterval: 30_000,
    retry: 1,
  })

  const { data: workstations = [] } = useQuery({
    queryKey: ['ja-workstations', scopedLocation],
    queryFn: () => factoryApi.workstations(scopedLocation).then((r) => r.data),
  })

  const { data: users = [] } = useQuery({
    queryKey: ['ja-users'],
    queryFn: () => userApi.list().then((r) => r.data),
  })

  /* ── Mutations ─────────────────────────────────────────────────────────── */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ja-queue'] })
    qc.invalidateQueries({ queryKey: ['ja-allotments'] })
    qc.invalidateQueries({ queryKey: ['ja-uids'] })
    refetchQueue()
  }

  const createAllotment = useMutation({
    mutationFn: (d: any) => shiftApi.createAllotment(d),
    onSuccess: () => {
      setSelectedJob(null)
      invalidate()
    },
  })

  const removeAllotment = useMutation({
    mutationFn: (id: number) => shiftApi.removeAllotment(id),
    onSuccess: invalidate,
  })

  const autoAssign = useMutation({
    mutationFn: () => shiftApi.autoAssign({ shift_date: shiftDate, shift_period: shiftPeriod }),
    onSuccess: (r) => {
      setAutoResult(r.data)
      invalidate()
    },
  })

  /* ── Derived: set of UID ids already allotted to an operator ───────────── */
  const allottedUidIds = useMemo(() => {
    const s = new Set<number>()
    for (const a of allotments as any[]) {
      const id = a.uid_id ?? a.uid?.id
      if (id != null) s.add(id)
    }
    // Also fold in UIDs visible in the live queue view (allotment ids may differ).
    for (const ws of queueData as any[]) {
      for (const j of ws.queue ?? []) if (j.uid_id != null) s.add(j.uid_id)
    }
    return s
  }, [allotments, queueData])

  /* ── Derived: unassigned jobs queue (left panel) ───────────────────────── */
  const unassigned = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (allUids as any[])
      .filter((u) => u.current_step_id != null) // ready for a next step
      .filter((u) => !allottedUidIds.has(u.id))
      .filter((u) => (term ? u.code.toLowerCase().includes(term) : true))
      .filter((u) => (cycleFilter ? u.cycle_type_name === cycleFilter : true))
      .filter((u) => (priorityFilter ? u.priority === priorityFilter : true))
      .filter((u) =>
        wsFilter
          ? wsFilter === 'furnace'
            ? isFurnaceStep(u.current_step_name)
            : (u.current_step_name ?? '').toLowerCase().includes(wsFilter.toLowerCase())
          : true,
      )
      .sort((a, b) => {
        const pr = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
        if (pr !== 0) return pr
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })
  }, [allUids, allottedUidIds, search, wsFilter, cycleFilter, priorityFilter])

  const cycleOptions = useMemo(
    () => Array.from(new Set((allUids as any[]).map((u) => u.cycle_type_name).filter(Boolean))).sort(),
    [allUids],
  )

  /* ── Operator board rows ───────────────────────────────────────────────── */
  const operators = (users as any[]).filter((u) => u.role === 'operator')

  /* Workstation/operator cards for the board, busiest first. */
  const boardCards = useMemo(
    () => [...(queueData as any[])].sort((a: any, b: any) => (b.queue?.length ?? 0) - (a.queue?.length ?? 0)),
    [queueData],
  )

  const totalAssigned = useMemo(
    () => (queueData as any[]).reduce((acc, ws) => acc + (ws.queue?.length ?? 0), 0),
    [queueData],
  )

  /* Furnace jobs must never be delegated to an operator (spec: always the
     Supervisor on duty). Block the manual click-to-assign for those. */
  const [furnaceBlock, setFurnaceBlock] = useState<string | null>(null)

  /* ── Manual assign: drop selected job onto a workstation/operator card ─── */
  function assignTo(ws: any) {
    if (!selectedJob || !canEdit) return
    if (isFurnaceStep(selectedJob.current_step_name) && ws.operator_id != null) {
      setFurnaceBlock(selectedJob.code)
      return
    }
    setFurnaceBlock(null)
    createAllotment.mutate({
      uid_id: selectedJob.id,
      operator_id: ws.operator_id,
      workstation_id: ws.workstation_id,
    })
  }

  const filtersActive = !!(search || wsFilter || cycleFilter || priorityFilter)

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.16em', color: 'var(--ink-2)', marginBottom: 8 }}>
            MANAGEMENT · SHIFTS
          </div>
          <h1 style={{ fontFamily: ARCH, fontWeight: 800, fontSize: 28, letterSpacing: '-.03em', color: 'var(--ink)', lineHeight: 1, margin: 0 }}>
            Job Assignment
          </h1>
          <p style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-2)', marginTop: 5 }}>
            Allot ready jobs to operators for the shift — auto or manual
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="date"
            value={shiftDate}
            onChange={(e) => setShiftDate(e.target.value)}
            style={{ height: 38, padding: '0 12px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: SANS, fontSize: 13, color: 'var(--ink)', background: 'var(--surface)', outline: 'none' }}
          />
          <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 9, overflow: 'hidden' }}>
            {SHIFTS.map((s) => (
              <button
                key={s.value}
                onClick={() => setShiftPeriod(s.value)}
                style={{
                  padding: '0 14px',
                  height: 38,
                  fontFamily: SANS,
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: 'none',
                  borderRight: '1px solid var(--line)',
                  cursor: 'pointer',
                  background: shiftPeriod === s.value ? 'var(--accent)' : 'var(--surface)',
                  color: shiftPeriod === s.value ? 'var(--accent-ink)' : 'var(--ink-2)',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Shift info + summary strip ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 20, background: 'var(--surface-3)', border: '1px solid var(--line)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: shiftInfo.color }} />
          <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: 'var(--ink-2)' }}>
            {shiftInfo.label} Shift · {shiftInfo.time} · {format(new Date(shiftDate + 'T00:00:00'), 'dd MMM yyyy')}
          </span>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-2)' }}>
          <strong style={{ color: 'var(--ink)', fontFamily: ARCH, fontWeight: 800 }}>{unassigned.length}</strong> unassigned ·{' '}
          <strong style={{ color: 'var(--ink)', fontFamily: ARCH, fontWeight: 800 }}>{totalAssigned}</strong> assigned ·{' '}
          <strong style={{ color: 'var(--ink)', fontFamily: ARCH, fontWeight: 800 }}>{(queueData as any[]).length}</strong> operators
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {autoResult && (
            <span style={{ fontFamily: MONO, fontSize: 12, color: autoResult.allotted > 0 ? '#22a06b' : 'var(--ink-3)' }}>
              {autoResult.allotted > 0 ? `✓ ${autoResult.allotted} jobs assigned` : 'No jobs matched'}
            </span>
          )}
          {canEdit && (
            <button
              className="btn-primary"
              onClick={() => {
                setAutoResult(null)
                autoAssign.mutate()
              }}
              disabled={autoAssign.isPending}
            >
              <Zap size={14} /> {autoAssign.isPending ? 'Assigning…' : 'Auto Assign'}
            </button>
          )}
        </div>
      </div>

      {/* Furnace note (spec: furnace steps go to the Supervisor on duty, never operators) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 14px',
          borderRadius: 10,
          background: 'rgba(217,122,43,.08)',
          border: '1px solid rgba(217,122,43,.22)',
          color: 'var(--warning)',
          fontFamily: SANS,
          fontSize: 12.5,
          marginBottom: 20,
        }}
      >
        <Flame size={14} />
        Furnace steps (tempering / hardening / quenching) are reserved for the Supervisor on duty and are excluded from operator auto-assignment.
      </div>

      {/* ── Two-panel body ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 0.85fr) minmax(440px, 1.4fr)', gap: 20, alignItems: 'start' }}>
        {/* ════ LEFT: Unassigned jobs queue ════════════════════════════════ */}
        <div className="card" style={{ padding: '18px 20px', position: 'sticky', top: 20 }}>
          <SectionLabel
            icon={<ListChecks size={13} style={{ color: 'var(--ink-3)' }} />}
            right={
              <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: unassigned.length ? 'var(--accent)' : 'var(--ink-3)' }}>
                {unassigned.length}
              </span>
            }
          >
            Unassigned Jobs
          </SectionLabel>

          {/* Filters */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            <input
              className="input"
              placeholder="Search UID code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <select className="input" value={cycleFilter} onChange={(e) => setCycleFilter(e.target.value)}>
                <option value="">All cycles</option>
                {cycleOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select className="input" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
                <option value="">All priorities</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
              </select>
            </div>
            <select className="input" value={wsFilter} onChange={(e) => setWsFilter(e.target.value)}>
              <option value="">All steps</option>
              <option value="furnace">Furnace steps only</option>
              <option value="grind">Grinding</option>
              <option value="vmc">VMC / machining</option>
              <option value="qc">QC</option>
            </select>
            {filtersActive && (
              <button
                onClick={() => {
                  setSearch('')
                  setWsFilter('')
                  setCycleFilter('')
                  setPriorityFilter('')
                }}
                style={{ alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontFamily: MONO, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5, padding: 0 }}
              >
                <Filter size={11} /> Clear filters
              </button>
            )}
          </div>

          {/* Job list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 360px)', overflowY: 'auto' }}>
            {uidLoading ? (
              <div style={{ padding: '28px 0', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: 'var(--ink-3)' }}>Loading jobs…</div>
            ) : uidError ? (
              <div style={{ padding: '20px 0', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: 'var(--error)' }}>
                Could not load jobs — refresh in a moment.
              </div>
            ) : unassigned.length === 0 ? (
              <div style={{ padding: '28px 12px', textAlign: 'center', fontFamily: SANS, fontSize: 13, color: 'var(--ink-3)' }}>
                {filtersActive ? 'No jobs match the current filters.' : 'No unassigned jobs — everything is allotted.'}
              </div>
            ) : (
              unassigned.map((u) => {
                const furnace = isFurnaceStep(u.current_step_name)
                const selected = selectedJob?.id === u.id
                return (
                  <button
                    key={u.id}
                    onClick={() => {
                      if (!canEdit) return
                      setFurnaceBlock(null)
                      setSelectedJob(selected ? null : u)
                    }}
                    style={{
                      textAlign: 'left',
                      width: '100%',
                      padding: '11px 13px',
                      borderRadius: 11,
                      border: `1px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
                      background: selected ? 'var(--accent-dim)' : 'var(--surface-2)',
                      cursor: canEdit ? 'pointer' : 'default',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 7,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{u.code}</span>
                      <CyclePill name={u.cycle_type_name} />
                      <PriorityPill priority={u.priority} />
                      {furnace && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: MONO, fontSize: 9.5, fontWeight: 600, color: 'var(--warning)' }}>
                          <Flame size={10} /> FURNACE
                        </span>
                      )}
                    </div>
                    <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-2)' }}>
                      <span style={{ fontFamily: MONO, color: 'var(--ink-2)', marginRight: 5 }}>{u.current_step_number ?? '—'}</span>
                      {u.current_step_name ?? '—'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)' }}>
                        <Clock size={10} /> {waitLabel(u.created_at)} waiting
                      </span>
                      {u.current_storage_code && (
                        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)' }}>{u.current_storage_code}</span>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {selectedJob && canEdit && (
            <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink)' }}>
                <strong style={{ fontFamily: MONO }}>{selectedJob.code}</strong> selected — pick an operator on the right
              </span>
              <button onClick={() => setSelectedJob(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}>
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        {/* ════ RIGHT: Operator assignment board ═══════════════════════════ */}
        <div>
          <SectionLabel
            icon={<Users size={13} style={{ color: 'var(--ink-3)' }} />}
            right={
              <button
                onClick={() => refetchQueue()}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 4, fontFamily: MONO, fontSize: 10, letterSpacing: '.06em' }}
              >
                <RefreshCw size={11} /> REFRESH
              </button>
            }
          >
            Operator Board · {shiftInfo.label} Shift
          </SectionLabel>

          {queueLoading ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', fontFamily: MONO, fontSize: 12, color: 'var(--ink-3)' }}>Loading operator board…</div>
          ) : queueError ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', fontFamily: MONO, fontSize: 12, color: 'var(--error)' }}>
              Failed to load operator board — please refresh.
            </div>
          ) : boardCards.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center' }}>
              <CircleSlash size={22} style={{ color: 'var(--ink-3)', marginBottom: 10 }} />
              <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-2)' }}>
                No operator assignments for this shift yet.
              </div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>
                Set up operator → workstation assignments in Shift Management first.
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {boardCards.map((ws: any) => (
                <OperatorCard
                  key={ws.assignment_id ?? `${ws.operator_id}-${ws.workstation_id}`}
                  ws={ws}
                  canEdit={canEdit}
                  jobSelected={!!selectedJob}
                  assigning={createAllotment.isPending}
                  onAssign={() => assignTo(ws)}
                  onRemove={(id) => removeAllotment.mutate(id)}
                  removing={removeAllotment.isPending}
                />
              ))}
            </div>
          )}

          {furnaceBlock && (
            <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(217,122,43,.1)', border: '1px solid rgba(217,122,43,.28)', color: 'var(--warning)', fontFamily: SANS, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Flame size={14} />
              <span style={{ flex: 1 }}>
                <strong style={{ fontFamily: MONO }}>{furnaceBlock}</strong> is a furnace step — it is reserved for the Supervisor on duty and cannot be delegated to an operator.
              </span>
              <button onClick={() => setFurnaceBlock(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--warning)', display: 'flex' }}>
                <X size={14} />
              </button>
            </div>
          )}

          {createAllotment.isError && (
            <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(229,72,77,.1)', border: '1px solid rgba(229,72,77,.25)', color: 'var(--error)', fontFamily: SANS, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={14} />
              {(createAllotment.error as any)?.response?.data?.detail || 'Could not assign job — the operator may not hold the required badge.'}
            </div>
          )}

          {operators.length > 0 && (queueData as any[]).length === 0 && (
            <div style={{ marginTop: 16, fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '.04em' }}>
              {operators.length} operator{operators.length === 1 ? '' : 's'} on record — assign them to workstations in Shift Management to populate this board.
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 24, fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)', letterSpacing: '.06em' }}>
        <Clock size={11} /> Live data refreshes every 30s.
      </div>
    </div>
  )
}

/* ── Operator board card ──────────────────────────────────────────────────── */
function OperatorCard({
  ws,
  canEdit,
  jobSelected,
  assigning,
  onAssign,
  onRemove,
  removing,
}: {
  ws: any
  canEdit: boolean
  jobSelected: boolean
  assigning: boolean
  onAssign: () => void
  onRemove: (id: number) => void
  removing: boolean
}) {
  const queue: any[] = ws.queue ?? []
  const qCount = queue.length
  const ready = ws.ready_count ?? 0
  const status = qCount > 0 ? 'working' : 'idle'
  const statusColor = qCount > 0 ? '#22a06b' : 'var(--ink-3)'
  const canDrop = canEdit && jobSelected

  return (
    <div
      className="card"
      style={{
        padding: 0,
        overflow: 'hidden',
        borderColor: canDrop ? 'var(--accent)' : 'var(--line)',
        boxShadow: canDrop ? '0 0 0 3px var(--accent-dim)' : 'var(--shadow-e1)',
        transition: 'box-shadow 180ms cubic-bezier(.2,.8,.2,1)',
      }}
    >
      {/* Operator header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontFamily: ARCH, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
            {initials(ws.operator_name)}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ws.operator_name ?? 'Unassigned'}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)' }}>
              {ws.workstation_code} — {ws.workstation_name}
            </div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '.04em', color: statusColor, textTransform: 'uppercase', flexShrink: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />
            {status}
          </span>
        </div>

        {/* Capacity strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <span style={{ fontFamily: ARCH, fontWeight: 800, fontSize: 18, color: 'var(--accent)', letterSpacing: '-.02em' }}>{qCount}</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)' }}>job{qCount === 1 ? '' : 's'} in queue</span>
          {ready > 0 && (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: MONO, fontSize: 10, color: '#22a06b' }}>
              <Plus size={10} /> {ready} ready
            </span>
          )}
        </div>
      </div>

      {/* Job queue */}
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 50 }}>
        {qCount === 0 ? (
          <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-3)', padding: '6px 2px' }}>Queue empty</div>
        ) : (
          queue.map((j: any, i: number) => (
            <div key={j.id ?? `${j.uid_code}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)', width: 18, textAlign: 'right', flexShrink: 0 }}>#{i + 1}</span>
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 12.5, color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.uid_code}</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
                {j.current_step_name || `Step ${j.current_step ?? ''}`}
              </span>
              {canEdit && j.id != null && (
                <button
                  onClick={() => onRemove(j.id)}
                  disabled={removing}
                  title="Return to unassigned"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: '2px 3px', borderRadius: 5, display: 'flex', flexShrink: 0 }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Assign drop zone (manual assignment of the selected job) */}
      {canDrop && (
        <button
          onClick={onAssign}
          disabled={assigning}
          style={{
            width: '100%',
            padding: '11px 14px',
            border: 'none',
            borderTop: '1px solid var(--accent)',
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: 12.5,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Plus size={14} /> {assigning ? 'Assigning…' : 'Assign selected job here'}
          <ChevronRight size={13} />
        </button>
      )}
    </div>
  )
}

/* ── Operator self-service: read-only view of own assigned queue ──────────────
   Spec (UPDATED access, line 1600): Operator = "view own queue". Operators do
   NOT see the supervisor assignment board and cannot assign — they only see the
   jobs allotted to them, ordered by priority, mirroring the Production Floor. */
function OperatorOwnQueue({ user }: { user: { primary_location_id: number | null; full_name?: string } }) {
  const { data: uids = [], isLoading, isError } = useQuery<any[]>({
    queryKey: ['ja-own-queue', user.primary_location_id],
    queryFn: () => uidApi.operatorQueue(user.primary_location_id ?? undefined).then((r) => r.data),
    refetchInterval: 30_000,
    retry: false,
  })

  const ordered = useMemo(
    () =>
      [...(uids as any[])].sort((a, b) => {
        const pr = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
        if (pr !== 0) return pr
        return new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
      }),
    [uids],
  )

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 760 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.16em', color: 'var(--ink-2)', marginBottom: 8 }}>
          MANAGEMENT · SHIFTS
        </div>
        <h1 style={{ fontFamily: ARCH, fontWeight: 800, fontSize: 28, letterSpacing: '-.03em', color: 'var(--ink)', lineHeight: 1, margin: 0 }}>
          My Job Queue
        </h1>
        <p style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-2)', marginTop: 5 }}>
          Jobs assigned to you for this shift, highest priority first — read only. Mark steps complete on the Production Floor.
        </p>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ListChecks size={13} style={{ color: 'var(--ink-3)' }} />
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '.12em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>
            My Queue
          </span>
          <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11, fontWeight: 700, color: ordered.length ? 'var(--accent)' : 'var(--ink-3)' }}>
            {ordered.length}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {isLoading ? (
            <div style={{ padding: '32px 0', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: 'var(--ink-3)' }}>Loading your queue…</div>
          ) : isError ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: 'var(--error)' }}>
              Could not load your queue — refresh in a moment.
            </div>
          ) : ordered.length === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center' }}>
              <CircleSlash size={22} style={{ color: 'var(--ink-3)', marginBottom: 10 }} />
              <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-2)' }}>No jobs assigned to you yet.</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>
                Your supervisor allots jobs at shift start — new jobs appear as UIDs advance.
              </div>
            </div>
          ) : (
            ordered.map((u: any, i: number) => {
              const furnace = isFurnaceStep(u.current_step_name)
              return (
                <div
                  key={u.id ?? i}
                  style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 18px', borderBottom: '1px solid var(--line)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)', width: 20, textAlign: 'right' }}>#{i + 1}</span>
                    <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{u.code}</span>
                    <CyclePill name={u.cycle_type_name ?? null} />
                    <PriorityPill priority={u.priority} />
                    {furnace && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: MONO, fontSize: 9.5, fontWeight: 600, color: 'var(--warning)' }}>
                        <Flame size={10} /> FURNACE
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-2)' }}>
                      <span style={{ fontFamily: MONO, color: 'var(--ink-2)', marginRight: 5 }}>{u.current_step_number ?? '—'}</span>
                      {u.current_step_name ?? '—'}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)' }}>
                      <Clock size={10} /> {waitLabel(u.created_at)} waiting
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 18, fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)', letterSpacing: '.06em' }}>
        <Clock size={11} /> Read-only view · live data refreshes every 30s.
      </div>
    </div>
  )
}
