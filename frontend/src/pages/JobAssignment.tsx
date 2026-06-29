import { useEffect, useMemo, useState } from 'react'
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
  RefreshCw,
  Users,
  ListChecks,
  CircleSlash,
  Search,
} from 'lucide-react'

/* ── Micro-styles ─────────────────────────────────────────────────────────── */
const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCH = "'Archivo', sans-serif"

/* ── Shift definitions (mirror of Shifts.tsx) ─────────────────────────────── */
const SHIFTS = [
  { value: 'morning', label: 'Morning', n: 1, time: '06:00 – 14:00', color: '#f59e0b' },
  { value: 'afternoon', label: 'Afternoon', n: 2, time: '14:00 – 22:00', color: '#3b82f6' },
  { value: 'night', label: 'Night', n: 3, time: '22:00 – 06:00', color: '#a78bfa' },
]

/* CORRECTED MODEL: all production / operators / workstations / job queues / shifts
   live at ONE location — Dharmapuri (location code F1). Faridabad (F2) only does
   intake / joining / dispatch and has NO operator job queues. This page is therefore
   inherently Dharmapuri; we scope all data to that location and never offer a split. */
const DHARMAPURI_CODE = 'F1'

/* Furnace steps are supervisor-run BATCHES (workstation codes HT70/HT80/HT90) —
   they are built in Batch Management and are NEVER allottable to an operator. We
   detect them primarily by the job's required workstation code, falling back to the
   step name for older rows that don't carry a workstation. */
const FURNACE_WS_CODES = new Set(['HT70', 'HT80', 'HT90'])
const isFurnaceWorkstation = (code?: string | null) =>
  !!code && FURNACE_WS_CODES.has(code.toUpperCase())
const isFurnaceStep = (name?: string | null) => {
  const n = (name ?? '').toLowerCase()
  return n.includes('temper') || n.includes('harden') || n.includes('quench')
}
/* A job (= UID at its current step) is furnace work if its required workstation is a
   furnace, or — for legacy rows lacking a workstation — its step name reads furnace. */
const isFurnaceJob = (u: any) =>
  isFurnaceWorkstation(u?.current_step_workstation_code) || isFurnaceStep(u?.current_step_name)

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2 }

const fmtInt = (n: number) => n.toLocaleString('en-US')

/* Filter chips — applied to the capped, server-paged result set. The list is
   already search-first + priority-ordered server-side; chips refine the page. */
const JOB_CHIPS: { key: string; label: string; match: (u: any) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'urgent', label: 'Urgent', match: (u) => u.priority === 'urgent' },
  { key: 'furnace', label: 'Furnace', match: (u) => isFurnaceJob(u) },
  { key: 'grinding', label: 'Grinding', match: (u) => (u.current_step_name ?? '').toLowerCase().includes('grind') },
  { key: 'qc', label: 'QC', match: (u) => (u.current_step_name ?? '').toLowerCase().includes('qc') },
]

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

/* Debounce a fast-changing value (search box → server query). */
function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
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

  /* Left-panel: search-first + a single active chip (capped page). */
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 300)
  const [chip, setChip] = useState('all')

  // Manual-assign selection
  const [selectedJob, setSelectedJob] = useState<any>(null)
  const [autoResult, setAutoResult] = useState<{ allotted: number } | null>(null)

  const shiftInfo = SHIFTS.find((s) => s.value === shiftPeriod)!

  /* ── Dharmapuri scoping (CORRECTED MODEL) ─────────────────────────────────
     This page is inherently Dharmapuri (F1) — there is no location split. We
     resolve its id once so the unassigned list is scoped to F1 production only;
     the operator board / queues are already Dharmapuri by nature. */
  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ['ja-locations'],
    queryFn: () => factoryApi.locations().then((r) => r.data),
    staleTime: 5 * 60_000,
  })
  const dharmapuriId: number | undefined = useMemo(
    () => (locations as any[]).find((l) => l.code === DHARMAPURI_CODE)?.id,
    [locations],
  )

  /* ── Data: unassigned jobs — SERVER-side search + cap + total ─────────────
     NEVER fetches all 12,000 jobs. Drives the list from a capped, priority-
     ordered, server-searched page, scoped to Dharmapuri (F1). The badge/caption
     use the server `total`. */
  const {
    data: uidResult,
    isLoading: uidLoading,
    isFetching: uidFetching,
    isError: uidError,
  } = useQuery({
    queryKey: ['ja-uids', dharmapuriId, debouncedSearch],
    queryFn: () =>
      uidApi
        .list({
          status: 'active',
          order: 'priority',
          search: debouncedSearch.trim() || undefined,
          location_id: dharmapuriId,
          limit: 60,
        })
        .then((r) => r.data),
    enabled: dharmapuriId != null,
    refetchInterval: 30_000,
    retry: false,
  })
  const total: number = uidResult?.total ?? 0
  const pageItems: any[] = uidResult?.items ?? []

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
      setMismatch(null)
      setFurnaceBlock(null)
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

  /* ── Derived: the capped page, minus already-allotted jobs, chip-filtered ─
     The server already applied: status=active, search, priority order, cap.
     We only drop jobs that are already on the board and apply the active chip
     client-side (priority/step-type chips the list endpoint doesn't take). */
  const chipDef = JOB_CHIPS.find((c) => c.key === chip) ?? JOB_CHIPS[0]
  const unassigned = useMemo(() => {
    return (pageItems as any[])
      .filter((u) => u.current_step_id != null) // ready for a next step
      .filter((u) => !allottedUidIds.has(u.id))
      .filter((u) => chipDef.match(u))
  }, [pageItems, allottedUidIds, chipDef])

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

  /* Furnace jobs must never be delegated to an operator (corrected model:
     furnace = supervisor-run batches built in Batch Management). Block them. */
  const [furnaceBlock, setFurnaceBlock] = useState<string | null>(null)
  /* Soft rejection note when a job is dropped on a non-matching workstation. */
  const [mismatch, setMismatch] = useState<{ code: string; needs: string } | null>(null)

  /* The job currently being dragged (HTML5 DnD). Held in state so operator cards
     can compute whether they are a valid target during the drag. */
  const [dragJob, setDragJob] = useState<any>(null)

  /* ── Core validation: can `job` be allotted to operator card `ws`? ─────────
     A job can ONLY land on an operator whose workstation === the job's required
     workstation (current_step_workstation_id), and furnace steps are never
     operator-allottable. Returns a discriminated result for UI + the action. */
  function validateDrop(
    job: any,
    ws: any,
  ): { ok: true } | { ok: false; reason: 'furnace' | 'mismatch' | 'no-operator' } {
    if (isFurnaceJob(job)) return { ok: false, reason: 'furnace' }
    if (ws.operator_id == null) return { ok: false, reason: 'no-operator' }
    if (job.current_step_workstation_id == null || ws.workstation_id == null)
      return { ok: false, reason: 'mismatch' }
    if (job.current_step_workstation_id !== ws.workstation_id) return { ok: false, reason: 'mismatch' }
    return { ok: true }
  }

  /* ── Assign: shared by click-to-assign (fallback) and drag-drop ──────────── */
  function assignJobTo(job: any, ws: any) {
    if (!job || !canEdit) return
    const v = validateDrop(job, ws)
    if (!v.ok) {
      if (v.reason === 'furnace') {
        setMismatch(null)
        setFurnaceBlock(job.code)
      } else if (v.reason === 'mismatch') {
        setFurnaceBlock(null)
        setMismatch({ code: job.code, needs: job.current_step_workstation_code ?? job.current_step_name ?? '—' })
      }
      return
    }
    setFurnaceBlock(null)
    setMismatch(null)
    createAllotment.mutate({
      uid_id: job.id,
      operator_id: ws.operator_id,
      workstation_id: ws.workstation_id,
    })
  }

  /* Click-to-assign fallback (touch / non-drag) uses the current selection. */
  function assignTo(ws: any) {
    assignJobTo(selectedJob, ws)
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1320 }}>
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
            Dharmapuri (F1) · drag a ready job onto the operator holding its workstation
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

      {/* ── Shift info strip ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 20, background: 'var(--surface-3)', border: '1px solid var(--line)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: shiftInfo.color }} />
          <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: 'var(--ink-2)' }}>
            {shiftInfo.label} Shift · {shiftInfo.time} · {format(new Date(shiftDate + 'T00:00:00'), 'dd MMM yyyy')}
          </span>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-2)' }}>
          <strong style={{ color: 'var(--ink)', fontFamily: ARCH, fontWeight: 800 }}>{fmtInt(total)}</strong> queued ·{' '}
          <strong style={{ color: 'var(--ink)', fontFamily: ARCH, fontWeight: 800 }}>{totalAssigned}</strong> assigned ·{' '}
          <strong style={{ color: 'var(--ink)', fontFamily: ARCH, fontWeight: 800 }}>{(queueData as any[]).length}</strong> operators
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
        Furnace steps (workstations HT70 / HT80 / HT90) are supervisor-run batches built in Batch Management — they are not operator-allottable and cannot be dropped on an operator here.
      </div>

      {/* ── Two-panel body: 380px left · fluid right ───────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 18, alignItems: 'start' }}>
        {/* ════ LEFT: Unassigned jobs — search-first, capped ═══════════════ */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'sticky', top: 20 }}>
          {/* Card header: title + QUEUED badge */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px 11px' }}>
            <div style={{ fontFamily: ARCH, fontWeight: 800, fontSize: 16, letterSpacing: '-.01em', color: 'var(--ink)' }}>
              Unassigned Jobs
            </div>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--warning)',
                background: 'rgba(217,122,43,.12)',
                padding: '3px 9px',
                borderRadius: 20,
              }}
            >
              {fmtInt(total)} QUEUED
            </span>
          </div>

          {/* Search + chips */}
          <div style={{ padding: '0 18px 12px', display: 'flex', flexDirection: 'column', gap: 9, borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px' }}>
              <Search size={15} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search UID, step or workstation…"
                style={{ border: 'none', outline: 'none', flex: 1, fontFamily: SANS, fontSize: 12.5, color: 'var(--ink)', background: 'none' }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  title="Clear search"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 0, flexShrink: 0 }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {JOB_CHIPS.map((c) => {
                const active = chip === c.key
                return (
                  <button
                    key={c.key}
                    onClick={() => setChip(c.key)}
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '.04em',
                      padding: '4px 10px',
                      borderRadius: 20,
                      cursor: 'pointer',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                      background: active ? 'var(--accent)' : 'var(--surface)',
                      color: active ? 'var(--accent-ink)' : 'var(--ink-2)',
                    }}
                  >
                    {c.label}
                  </button>
                )
              })}
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)' }}>
                showing {unassigned.length} of {fmtInt(total)} · priority order
              </span>
            </div>
          </div>

          {/* Compact job list (capped page) */}
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
            {uidLoading ? (
              <div style={{ padding: '28px 0', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: 'var(--ink-3)' }}>Loading jobs…</div>
            ) : uidError ? (
              <div style={{ padding: '20px 0', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: 'var(--error)' }}>
                Could not load jobs — refresh in a moment.
              </div>
            ) : unassigned.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', fontFamily: SANS, fontSize: 13, color: 'var(--ink-3)' }}>
                {debouncedSearch || chip !== 'all'
                  ? 'No jobs match this search/filter.'
                  : 'No unassigned jobs — everything is allotted.'}
              </div>
            ) : (
              unassigned.map((u) => {
                const furnace = isFurnaceJob(u)
                const selected = selectedJob?.id === u.id
                const dragging = dragJob?.id === u.id
                /* Furnace jobs are not operator-allottable, so they are not draggable
                   onto operators (no valid target exists). Everything else drags. */
                const canDrag = canEdit && !furnace
                return (
                  <button
                    key={u.id}
                    draggable={canDrag}
                    onDragStart={(e) => {
                      if (!canDrag) return
                      setSelectedJob(u)
                      setDragJob(u)
                      setFurnaceBlock(null)
                      setMismatch(null)
                      e.dataTransfer.effectAllowed = 'move'
                      /* Payload: the UID id + its required workstation, per spec. */
                      try {
                        e.dataTransfer.setData(
                          'application/json',
                          JSON.stringify({
                            uid_id: u.id,
                            current_step_workstation_id: u.current_step_workstation_id ?? null,
                          }),
                        )
                      } catch {
                        /* setData can throw in some browsers during dragstart — the
                           authoritative payload is dragJob in state; this is a hint. */
                      }
                    }}
                    onDragEnd={() => setDragJob(null)}
                    onClick={() => {
                      if (!canEdit) return
                      setFurnaceBlock(null)
                      setMismatch(null)
                      setSelectedJob(selected ? null : u)
                    }}
                    style={{
                      textAlign: 'left',
                      width: '100%',
                      padding: '13px 18px',
                      border: 'none',
                      borderBottom: '1px solid var(--line)',
                      background: selected ? 'var(--accent-dim)' : 'transparent',
                      boxShadow: selected ? 'inset 3px 0 0 var(--accent)' : 'none',
                      opacity: dragging ? 0.5 : 1,
                      cursor: canDrag ? 'grab' : canEdit ? 'pointer' : 'default',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {/* row 1: UID + cycle · spacer · priority */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
                      <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: 'var(--accent)' }}>{u.code}</span>
                      <CyclePill name={u.cycle_type_name} />
                      <span style={{ flex: 1 }} />
                      <PriorityPill priority={u.priority} />
                    </div>
                    {/* row 2: step name */}
                    <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>
                      <span style={{ fontFamily: MONO, color: 'var(--ink-3)', marginRight: 6 }}>{u.current_step_number ?? '—'}</span>
                      {u.current_step_name ?? '—'}
                    </div>
                    {/* row 3: required workstation · furnace/cycle · spacer · wait */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)' }}>
                      <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>
                        {u.current_step_workstation_code ?? u.current_storage_code ?? '—'}
                      </span>
                      {furnace ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--warning)', fontWeight: 600 }}>
                          <Flame size={10} /> FURNACE
                        </span>
                      ) : (
                        <span>· {u.cycle_type_name ?? 'job'}</span>
                      )}
                      <span style={{ flex: 1 }} />
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={10} /> {waitLabel(u.created_at)}
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* Footer hint: searching at scale */}
          <div style={{ padding: '10px 18px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-3)', letterSpacing: '.04em' }}>
            {uidFetching ? <RefreshCw size={11} className="" /> : <Search size={11} />}
            {total > unassigned.length
              ? `Search to narrow ${fmtInt(total)} jobs — showing top ${unassigned.length} by priority`
              : 'All queued jobs shown'}
          </div>

          {selectedJob && canEdit && (
            <div style={{ margin: 14, padding: '10px 12px', borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', gap: 8 }}>
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
          {/* Board header: title + Auto Assign */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Users size={15} style={{ color: 'var(--ink-3)' }} />
              <span style={{ fontFamily: ARCH, fontWeight: 800, fontSize: 16, letterSpacing: '-.01em', color: 'var(--ink)' }}>
                Operator Board · Shift {shiftInfo.n}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {autoResult && (
                <span style={{ fontFamily: MONO, fontSize: 12, color: autoResult.allotted > 0 ? '#22a06b' : 'var(--ink-3)' }}>
                  {autoResult.allotted > 0 ? `✓ ${autoResult.allotted} jobs assigned` : 'No jobs matched'}
                </span>
              )}
              <button
                onClick={() => refetchQueue()}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 4, fontFamily: MONO, fontSize: 10, letterSpacing: '.06em' }}
              >
                <RefreshCw size={11} /> REFRESH
              </button>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              {boardCards.map((ws: any) => {
                /* The job being considered for this card: the live drag, else the
                   click-selected job (fallback). Drives valid/invalid styling. */
                const candidate = dragJob ?? selectedJob
                const validity = candidate ? validateDrop(candidate, ws) : null
                return (
                  <OperatorCard
                    key={ws.assignment_id ?? `${ws.operator_id}-${ws.workstation_id}`}
                    ws={ws}
                    canEdit={canEdit}
                    jobSelected={!!selectedJob}
                    dragActive={!!dragJob}
                    /* during drag, only matching cards are valid targets */
                    validTarget={validity?.ok === true}
                    rejectReason={validity && !validity.ok ? validity.reason : null}
                    assigning={createAllotment.isPending}
                    onAssign={() => assignTo(ws)}
                    onDropJob={() => {
                      const job = dragJob
                      setDragJob(null)
                      if (job) assignJobTo(job, ws)
                    }}
                    onRemove={(id) => removeAllotment.mutate(id)}
                    removing={removeAllotment.isPending}
                  />
                )
              })}
            </div>
          )}

          {furnaceBlock && (
            <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(217,122,43,.1)', border: '1px solid rgba(217,122,43,.28)', color: 'var(--warning)', fontFamily: SANS, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Flame size={14} />
              <span style={{ flex: 1 }}>
                <strong style={{ fontFamily: MONO }}>{furnaceBlock}</strong> is a furnace step (HT70 / HT80 / HT90) — it is a supervisor-run batch built in Batch Management and cannot be allotted to an operator.
              </span>
              <button onClick={() => setFurnaceBlock(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--warning)', display: 'flex' }}>
                <X size={14} />
              </button>
            </div>
          )}

          {mismatch && (
            <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(229,72,77,.1)', border: '1px solid rgba(229,72,77,.25)', color: 'var(--error)', fontFamily: SANS, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={14} />
              <span style={{ flex: 1 }}>
                <strong style={{ fontFamily: MONO }}>{mismatch.code}</strong> needs workstation{' '}
                <strong style={{ fontFamily: MONO }}>{mismatch.needs}</strong> — drop it on an operator assigned to that workstation.
              </span>
              <button onClick={() => setMismatch(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)', display: 'flex' }}>
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
        <Clock size={11} /> Live data refreshes every 30s · unassigned list is search-first (capped at 60 by priority).
      </div>
    </div>
  )
}

/* ── Operator board card ──────────────────────────────────────────────────── */
function OperatorCard({
  ws,
  canEdit,
  jobSelected,
  dragActive,
  validTarget,
  rejectReason,
  assigning,
  onAssign,
  onDropJob,
  onRemove,
  removing,
}: {
  ws: any
  canEdit: boolean
  jobSelected: boolean
  dragActive: boolean
  validTarget: boolean
  rejectReason: 'furnace' | 'mismatch' | 'no-operator' | null
  assigning: boolean
  onAssign: () => void
  onDropJob: () => void
  onRemove: (id: number) => void
  removing: boolean
}) {
  const queue: any[] = ws.queue ?? []
  const qCount = queue.length
  const ready = ws.ready_count ?? 0
  const status = qCount > 0 ? 'working' : 'idle'
  const statusColor = qCount > 0 ? '#22a06b' : 'var(--ink-3)'
  /* click-to-assign fallback affordance: a job is selected (but not dragging) */
  const canDrop = canEdit && jobSelected && !dragActive

  /* Is the pointer currently over THIS card mid-drag? Used for the strongest
     highlight (dashed accent ring on a valid target / red on an invalid one). */
  const [over, setOver] = useState(false)

  /* During a drag, valid targets get a dashed accent ring; invalid ones (wrong
     workstation / furnace) are dimmed and show what they "need". */
  const dragValid = canEdit && dragActive && validTarget
  const dragInvalid = canEdit && dragActive && !validTarget

  const borderColor = dragValid
    ? 'var(--accent)'
    : dragInvalid
      ? 'rgba(229,72,77,.4)'
      : canDrop
        ? 'var(--accent)'
        : 'var(--line)'
  const boxShadow = over && dragValid
    ? '0 0 0 3px var(--accent-dim)'
    : canDrop
      ? '0 0 0 3px var(--accent-dim)'
      : 'var(--shadow-e1)'

  return (
    <div
      className="card"
      onDragOver={(e) => {
        if (!canEdit || !dragActive) return
        /* Only valid (matching-workstation, non-furnace) cards accept the drop. */
        if (!validTarget) {
          e.dataTransfer.dropEffect = 'none'
          return
        }
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      }}
      onDragLeave={() => over && setOver(false)}
      onDrop={(e) => {
        if (!canEdit || !dragActive) return
        e.preventDefault()
        setOver(false)
        if (validTarget) onDropJob()
      }}
      style={{
        padding: 0,
        overflow: 'hidden',
        position: 'relative',
        borderColor,
        borderStyle: dragValid ? 'dashed' : 'solid',
        opacity: dragInvalid ? 0.6 : 1,
        boxShadow,
        transition: 'box-shadow 180ms cubic-bezier(.2,.8,.2,1), opacity 140ms',
      }}
    >
      {/* Invalid-target hint shown over a card during a drag (wrong WS / furnace). */}
      {dragInvalid && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 2,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontFamily: MONO,
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '.04em',
            textTransform: 'uppercase',
            padding: '3px 8px',
            borderRadius: 20,
            background: 'rgba(229,72,77,.12)',
            color: 'var(--error)',
            pointerEvents: 'none',
          }}
        >
          {rejectReason === 'furnace' ? (
            <>
              <Flame size={9} /> batch only
            </>
          ) : rejectReason === 'no-operator' ? (
            'no operator'
          ) : (
            <>wrong workstation</>
          )}
        </div>
      )}
      {/* Operator header */}
      <div style={{ padding: '17px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#eaf0f7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontFamily: ARCH, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
              {initials(ws.operator_name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ws.operator_name ?? 'Unassigned'}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)' }}>
                {ws.operator_id != null ? `OP-${ws.operator_id}` : '—'} · {qCount} job{qCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '.04em', color: statusColor, textTransform: 'uppercase', flexShrink: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />
            {status}
          </span>
        </div>

        {/* Workstation info block */}
        <div style={{ background: 'var(--surface-2)', borderRadius: 9, padding: '11px 13px', marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-3)' }}>WORKSTATION</span>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{ws.workstation_code ?? '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
            <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ws.workstation_name ?? '—'}
            </span>
            {ready > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: MONO, fontSize: 10, color: '#22a06b', flexShrink: 0, marginLeft: 8 }}>
                <Plus size={10} /> {ready} ready
              </span>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: 7 }}>
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-3)' }}>JOB QUEUE</span>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: qCount > 0 ? 'var(--accent)' : 'var(--ink-3)' }}>
              {qCount} job{qCount === 1 ? '' : 's'}
            </span>
          </div>
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

      {/* Drag drop-zone affordance: shown on a valid target while dragging. */}
      {dragValid && (
        <div
          style={{
            width: '100%',
            padding: '11px 14px',
            borderTop: '1px dashed var(--accent)',
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: 12.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <ChevronRight size={13} /> Drop to allot here
        </div>
      )}

      {/* Assign drop zone (click-to-assign fallback for the selected job) */}
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
