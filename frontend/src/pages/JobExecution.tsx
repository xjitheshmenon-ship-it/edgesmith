import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { uidApi, factoryApi, cycleApi, shiftApi, jobApi } from '../api/client'
import type { UID, Workstation, CycleType, CycleStep } from '../types'
import PriorityBadge from '../components/PriorityBadge'
import { useAuth } from '../hooks/useAuth'
import {
  Play,
  Pause,
  CheckCircle,
  Flag,
  AlertTriangle,
  Clock,
  ListChecks,
  X,
  Eye,
  Activity,
  Bell,
  Users,
  RefreshCw,
  ArrowRight,
} from 'lucide-react'
import { format, formatDistanceToNowStrict } from 'date-fns'

// ── Persisted job runtime state ──────────────────────────────────────────────
// Timing is now server-backed via jobApi.start / pause / resume / complete,
// each of which records a job_events row. jobApi.events(uid) returns the
// authoritative active_seconds / paused_seconds / status; the page keeps a
// local one-second ticker for a smooth display that re-syncs from the server
// figure on each refetch. CLOSE records the timing event AND calls the existing
// uidApi.completeStep path so the step still advances.
type JobStatus = 'running' | 'paused' | 'idle' | 'complete'
// Visual phase used by the active-job card, derived from the server status.
type JobPhase = 'queued' | 'in_progress' | 'paused'

interface JobEvent {
  event_type: 'start' | 'pause' | 'resume' | 'complete'
  reason: string | null
  operator_name: string | null
  created_at: string
}

interface JobEventsResponse {
  events: JobEvent[]
  active_seconds: number
  paused_seconds: number
  status: JobStatus
}

const PAUSE_REASONS = [
  'Break',
  'Machine issue',
  'Material not ready',
  'Waiting for supervisor',
  'Other',
]

// QC check options per the Close panel in the spec.
const QC_CHECKS = [
  { key: 'na', label: 'No QC check for this step', unit: '' },
  { key: 'hardness', label: 'Hardness (HRC)', unit: 'HRC' },
  { key: 'width', label: 'Width (mm)', unit: 'mm' },
  { key: 'straightness', label: 'Straightness', unit: '' },
  { key: 'visual', label: 'Visual', unit: '' },
]

const isTemperStep = (name?: string | null) => {
  const n = (name ?? '').toLowerCase()
  return n.includes('temper') || n.includes('harden') || n.includes('quench')
}
const isConvertingStep = (name?: string | null) =>
  (name ?? '').toLowerCase().includes('convert')
const isChildMarkingStep = (name?: string | null) =>
  (name ?? '').toLowerCase().includes('child') && (name ?? '').toLowerCase().includes('mark')
const isQcInspectionStep = (name?: string | null) => {
  const n = (name ?? '').toLowerCase()
  return n.includes('qc') && (n.includes('inspect') || n.includes('inspection'))
}

// ── Floor-wide queue-view row shape (from shiftApi.queueView) ────────────────
interface QueueViewAllotment {
  uid_id: number
  uid_code: string
  priority: string
  status: string
}
interface QueueViewRow {
  assignment_id: number
  workstation_id: number
  workstation_code: string
  workstation_name: string
  operator_id: number | null
  operator_name: string | null
  confirmed: boolean
  queue: QueueViewAllotment[]
  ready_count: number
  ready_uids: { id: number; code: string; status: string; priority: string }[]
}

// ── Time helpers ─────────────────────────────────────────────────────────────
function hhmmss(ms: number): string {
  if (ms < 0) ms = 0
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

// One-second ticker so all live timers re-render together.
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

// ── Step progress track (27-node style track from UID Detail) ────────────────
function StepTrack({ steps, currentNumber }: { steps: CycleStep[]; currentNumber?: string | null }) {
  if (steps.length === 0) return null
  return (
    <div>
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          marginBottom: 8,
        }}
      >
        Step progress
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {steps.map((st) => {
          const isCurrent = st.step_number === currentNumber
          const isDone =
            currentNumber != null && st.step_order < (steps.find((s) => s.step_number === currentNumber)?.step_order ?? -1)
          return (
            <div
              key={st.id}
              title={`Step ${st.step_number} — ${st.operation_name}`}
              style={{
                minWidth: 28,
                height: 28,
                padding: '0 6px',
                borderRadius: 7,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                fontWeight: 700,
                background: isCurrent ? 'var(--accent)' : isDone ? 'var(--accent-dim)' : 'var(--surface-3)',
                color: isCurrent ? 'var(--accent-ink)' : isDone ? 'var(--accent)' : 'var(--ink-3)',
                border: isCurrent ? '1px solid var(--accent)' : '1px solid var(--line)',
                animation: isCurrent ? 'es-fade 1.4s ease-in-out infinite alternate' : undefined,
              }}
            >
              {st.step_number}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Timer block ──────────────────────────────────────────────────────────────
function TimerCell({ value, label, sub, color }: { value: string; label: string; sub: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 9.5,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'Archivo', sans-serif",
          fontWeight: 800,
          letterSpacing: '-0.03em',
          fontSize: 30,
          lineHeight: 1.1,
          color: color ?? 'var(--ink)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, color: 'var(--ink-2)' }}>{sub}</div>
    </div>
  )
}

export default function JobExecution() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const role = user?.role ?? 'operator'
  // Supervisor / Manager / Admin get the read-only floor overview; operators get
  // the single-job active-card view of their own allotted queue.
  const isFloorView = role === 'supervisor' || role === 'manager' || role === 'admin'
  const isAdmin = role === 'admin'

  // Production, operators, workstations and job execution all happen at ONE
  // location: Dharmapuri (F1). There is no multi-location floor — the queue and
  // floor overview are always Dharmapuri. Scope queries to the user's own
  // (Dharmapuri) location; the server pins this for production roles.
  const locationId = user?.primary_location_id ?? undefined

  const [activeId, setActiveId] = useState<number | null>(null)
  const [showPause, setShowPause] = useState(false)
  const [pauseReason, setPauseReason] = useState(PAUSE_REASONS[0])
  const [pauseNotes, setPauseNotes] = useState('')
  const [showClose, setShowClose] = useState(false)
  const [selectedWS, setSelectedWS] = useState<number | undefined>()
  const [qcCheck, setQcCheck] = useState('na')
  const [qcValue, setQcValue] = useState('')
  const [qcResult, setQcResult] = useState<'pass' | 'fail' | 'borderline'>('pass')
  const [closeNotes, setCloseNotes] = useState('')
  const [actualTemp, setActualTemp] = useState('')
  const [actualTime, setActualTime] = useState('')
  const [flagged, setFlagged] = useState(false)
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  // ── Operator queue (location-scoped server-side) ──────────────────────────
  const {
    data: uids = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<UID[]>({
    queryKey: ['jobexec-queue', locationId],
    queryFn: () => uidApi.operatorQueue(locationId).then((r) => r.data),
    refetchInterval: 15_000,
  })

  const { data: workstations = [] } = useQuery<Workstation[]>({
    queryKey: ['jobexec-workstations', locationId],
    queryFn: () => factoryApi.workstations(locationId).then((r) => r.data),
  })

  // Cycle definitions → step track + default workstation for the active step.
  const { data: cycles = [] } = useQuery<CycleType[]>({
    queryKey: ['jobexec-cycles'],
    queryFn: () => cycleApi.list().then((r) => r.data),
  })

  // ── Persisted job timing for the active UID (server-authoritative) ────────
  const { data: jobEvents, dataUpdatedAt: eventsUpdatedAt } = useQuery<JobEventsResponse>({
    queryKey: ['jobexec-events', activeId],
    queryFn: () => jobApi.events(activeId as number).then((r) => r.data),
    enabled: activeId != null && !isFloorView,
    refetchInterval: 15_000,
  })

  // ── Admin pause-threshold (persisted) ─────────────────────────────────────
  const { data: pauseThreshold } = useQuery<{ max_pause_minutes: number }>({
    queryKey: ['jobexec-pause-threshold'],
    queryFn: () => jobApi.getPauseThreshold().then((r) => r.data),
    enabled: isFloorView,
  })
  const pauseThresholdMin = pauseThreshold?.max_pause_minutes ?? 30

  const setPauseThreshold = useMutation({
    mutationFn: (max_pause_minutes: number) =>
      jobApi.setPauseThreshold({ max_pause_minutes }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobexec-pause-threshold'] }),
  })

  // ── Floor-wide view data (supervisor / manager / admin) ───────────────────
  // shiftApi.queueView gives per-workstation operator + queue + ready counts.
  const today = format(new Date(), 'yyyy-MM-dd')
  const [floorShift, setFloorShift] = useState('morning')
  const {
    data: floorRows = [],
    isLoading: floorLoading,
    isError: floorError,
    refetch: refetchFloor,
  } = useQuery<QueueViewRow[]>({
    queryKey: ['jobexec-floor', today, floorShift],
    queryFn: () => shiftApi.queueView(today, floorShift).then((r) => r.data),
    enabled: isFloorView,
    refetchInterval: 20_000,
    retry: 1,
  })

  // ── Timing mutations (each records a job_events row) ──────────────────────
  const invalidateEvents = () =>
    qc.invalidateQueries({ queryKey: ['jobexec-events', activeIdRef.current] })

  const startJobMut = useMutation({
    mutationFn: () => jobApi.start(activeIdRef.current as number).then((r) => r.data),
    onSuccess: invalidateEvents,
  })
  const pauseJobMut = useMutation({
    mutationFn: (reason: string) =>
      jobApi.pause(activeIdRef.current as number, { reason }).then((r) => r.data),
    onSuccess: invalidateEvents,
  })
  const resumeJobMut = useMutation({
    mutationFn: () => jobApi.resume(activeIdRef.current as number).then((r) => r.data),
    onSuccess: invalidateEvents,
  })

  const completeStep = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const id = activeIdRef.current as number
      // Record the timing event first, then advance the step.
      await jobApi.complete(id, { reason: (data.notes as string) || undefined })
      return uidApi.completeStep(id, data).then((r) => r.data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobexec-queue'] })
      invalidateEvents()
      resetActive()
    },
  })

  // Priority ordering: urgent → high → normal, FIFO within each band.
  const ordered = useMemo(() => {
    const rank = (p: UID['priority']) => (p === 'urgent' ? 0 : p === 'high' ? 1 : 2)
    return [...uids].sort(
      (a, b) => rank(a.priority) - rank(b.priority) || +new Date(a.created_at) - +new Date(b.created_at)
    )
  }, [uids])

  // Default the active job to the top of the queue.
  useEffect(() => {
    if (activeId == null && ordered.length > 0) setActiveId(ordered[0].id)
    if (activeId != null && !ordered.some((u) => u.id === activeId)) {
      setActiveId(ordered[0]?.id ?? null)
    }
  }, [ordered, activeId])

  const active = useMemo(() => ordered.find((u) => u.id === activeId) ?? null, [ordered, activeId])
  const queue = useMemo(() => ordered.filter((u) => u.id !== activeId), [ordered, activeId])

  // Steps for the active UID's cycle version.
  const steps = useMemo<CycleStep[]>(() => {
    if (!active) return []
    const ct = cycles.find((c) => c.id === active.cycle_type_id)
    return [...(ct?.current_version?.steps ?? [])].sort((a, b) => a.step_order - b.step_order)
  }, [cycles, active])

  const currentStep = useMemo(
    () => steps.find((s) => s.step_number === active?.current_step_number) ?? null,
    [steps, active]
  )

  // Default the workstation select to the step's configured workstation.
  useEffect(() => {
    if (currentStep && selectedWS == null) {
      const match = workstations.find((w) => w.id === currentStep.workstation_id)
      if (match) setSelectedWS(match.id)
    }
  }, [currentStep, workstations, selectedWS])

  // ── Server-driven phase + live timer ──────────────────────────────────────
  // jobEvents.status is authoritative. Map it to the visual phase used by the
  // card. 'idle'/'complete'/absent → queued (Start available).
  const status: JobStatus = jobEvents?.status ?? 'idle'
  const phase: JobPhase =
    status === 'running' ? 'in_progress' : status === 'paused' ? 'paused' : 'queued'
  const now = useNow(phase === 'in_progress' || phase === 'paused')

  // Pause events recorded for this job (for the status row + pause history).
  const pauseEvents = useMemo(
    () => (jobEvents?.events ?? []).filter((e) => e.event_type === 'pause'),
    [jobEvents]
  )
  const lastPauseEvent = pauseEvents.length ? pauseEvents[pauseEvents.length - 1] : null

  // Wall-clock seconds elapsed since the server figures were last fetched; we
  // add these to the running/paused counter so the on-screen clock ticks, then
  // re-sync to the server value on every refetch.
  const sinceSyncSec = Math.max(0, Math.floor((now - eventsUpdatedAt) / 1000))
  const serverActiveSec = jobEvents?.active_seconds ?? 0
  const serverPausedSec = jobEvents?.paused_seconds ?? 0
  const activeSec = serverActiveSec + (status === 'running' ? sinceSyncSec : 0)
  const pausedSec = serverPausedSec + (status === 'paused' ? sinceSyncSec : 0)

  // Display figures (ms for the shared hhmmss helper).
  const netMs = activeSec * 1000
  const activeSinceResumeMs = netMs
  const totalElapsedMs = (activeSec + pausedSec) * 1000
  const pausedForMs = pausedSec * 1000

  function resetActive() {
    setShowClose(false)
    setShowPause(false)
    setSelectedWS(undefined)
    setQcCheck('na')
    setQcValue('')
    setQcResult('pass')
    setCloseNotes('')
    setActualTemp('')
    setActualTime('')
    setFlagged(false)
  }

  function startJob() {
    if (!active || startJobMut.isPending) return
    startJobMut.mutate()
  }

  function confirmPause() {
    if (pauseJobMut.isPending) return
    const reason = pauseNotes.trim() ? `${pauseReason} — ${pauseNotes.trim()}` : pauseReason
    pauseJobMut.mutate(reason, {
      onSuccess: () => {
        setShowPause(false)
        setPauseNotes('')
        setPauseReason(PAUSE_REASONS[0])
      },
    })
  }

  function resumeJob() {
    if (resumeJobMut.isPending) return
    resumeJobMut.mutate()
  }

  const temper = isTemperStep(active?.current_step_name)
  const converting = isConvertingStep(active?.current_step_name) || !!currentStep?.is_converting_step
  const childMarking = isChildMarkingStep(active?.current_step_name) || !!currentStep?.is_child_marking_step
  const qcInspection = isQcInspectionStep(active?.current_step_name) || !!currentStep?.is_qc_step
  // QC Inspection step (26): cannot close without an explicit Pass/Fail.
  const qcInspectionSatisfied = !qcInspection || (qcCheck !== 'na' && (qcResult === 'pass' || qcResult === 'fail'))
  const canSubmitClose =
    !!selectedWS &&
    active?.status === 'active' &&
    !converting &&
    !childMarking &&
    (!temper || (actualTemp !== '' && actualTime !== '')) &&
    (qcCheck === 'na' || qcValue.trim() !== '' || qcResult != null) &&
    qcInspectionSatisfied

  function confirmClose() {
    if (!active) return
    // Finalise net work time before submitting (best-effort, local only).
    const data: Record<string, unknown> = {
      workstation_id: selectedWS,
      qc_result: qcCheck === 'na' ? 'na' : qcResult,
      notes: closeNotes,
    }
    if (qcCheck !== 'na' && qcValue.trim() !== '') {
      data.qc_values = { [qcCheck]: qcValue.trim() }
    }
    if (temper) {
      data.actual_temp_c = actualTemp ? parseFloat(actualTemp) : null
      data.actual_soak_minutes = actualTime ? parseInt(actualTime, 10) : null
    }
    if (jobEvents && status !== 'idle') data.net_work_seconds = activeSec
    completeStep.mutate(data)
  }

  // ── Phase accent colour ───────────────────────────────────────────────────
  const phaseColor =
    phase === 'in_progress' ? 'var(--success)' : phase === 'paused' ? 'var(--warning)' : 'var(--ink-3)'
  const phaseLabel = phase === 'in_progress' ? 'IN PROGRESS' : phase === 'paused' ? 'PAUSED' : 'QUEUED'

  // ── Manager / floor summary metrics (derived from queue-view) ────────────
  const floorMetrics = useMemo(() => {
    const totalQueued = floorRows.reduce((n, r) => n + r.queue.length, 0)
    const totalReady = floorRows.reduce((n, r) => n + r.ready_count, 0)
    const stationsStaffed = floorRows.filter((r) => r.operator_id != null).length
    const idleOperators = floorRows.filter((r) => r.operator_id != null && r.queue.length === 0).length
    return {
      stations: floorRows.length,
      stationsStaffed,
      totalQueued,
      totalReady,
      idleOperators,
    }
  }, [floorRows])

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: isFloorView ? 1480 : 1280 }}>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div
            style={{
              fontFamily: "'Archivo', sans-serif",
              fontWeight: 800,
              fontSize: 24,
              letterSpacing: '-0.03em',
              color: 'var(--ink)',
            }}
          >
            Job Execution
          </div>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink-2)', marginTop: 3 }}>
            {isFloorView
              ? `Dharmapuri floor — what each operator is working (${role})`
              : `${ordered.length} job${ordered.length === 1 ? '' : 's'} allotted to you — start, pause, resume, and close your work`}
          </div>
        </div>
      </div>

      {/* ════════════════ FLOOR-WIDE VIEW (supervisor / manager / admin) ═══ */}
      {isFloorView ? (
        <FloorView
          rows={floorRows}
          loading={floorLoading}
          error={floorError}
          onRetry={() => refetchFloor()}
          floorShift={floorShift}
          setFloorShift={setFloorShift}
          role={role}
          isAdmin={isAdmin}
          metrics={floorMetrics}
          pauseThresholdMin={pauseThresholdMin}
          onSavePauseThreshold={(v) => setPauseThreshold.mutate(v)}
          savingPauseThreshold={setPauseThreshold.isPending}
        />
      ) : isLoading ? (
        <div
          className="card"
          style={{ padding: 40, textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--ink-3)' }}
        >
          Loading your queue…
        </div>
      ) : isError ? (
        <div
          className="card"
          style={{ padding: 28, display: 'flex', alignItems: 'center', gap: 12, color: 'var(--error)' }}
        >
          <AlertTriangle size={18} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Couldn't load your job queue.</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>The queue service may be unavailable.</div>
          </div>
          <button className="btn-secondary" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      ) : ordered.length === 0 ? (
        <div
          className="card"
          style={{ padding: 48, textAlign: 'center' }}
        >
          <ListChecks size={26} style={{ color: 'var(--ink-3)', marginBottom: 10 }} />
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>
            No jobs assigned
          </div>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink-2)', marginTop: 4 }}>
            Your queue is clear. New work will appear here as it's assigned.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 1fr)', gap: 20, alignItems: 'start' }}>
          {/* ── Active job card ──────────────────────────────────────────── */}
          <div className="card animate-es" style={{ padding: 22, borderLeft: `4px solid ${phaseColor}`, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {active && (
              <>
                {/* status row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: phaseColor,
                        animation: phase === 'in_progress' ? 'es-fade 1.2s ease-in-out infinite alternate' : undefined,
                      }}
                    />
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 12,
                        fontWeight: 600,
                        letterSpacing: '0.1em',
                        color: phaseColor,
                      }}
                    >
                      {phaseLabel}
                      {phase === 'paused' && lastPauseEvent?.reason ? ` — ${lastPauseEvent.reason}` : ''}
                    </span>
                  </div>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>
                    {active.factory_location_code}
                    {currentStep ? ` · ${currentStep.workstation_code}` : ''}
                  </span>
                </div>

                {/* UID identity */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontFamily: "'Archivo', sans-serif",
                        fontWeight: 800,
                        fontSize: 34,
                        letterSpacing: '-0.03em',
                        color: 'var(--ink)',
                        lineHeight: 1,
                      }}
                    >
                      {active.code}
                    </span>
                    <PriorityBadge priority={active.priority} />
                    {active.status === 'on_hold' && <span className="badge-red">ON HOLD</span>}
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: 'var(--ink-2)', marginTop: 7 }}>
                    Step <strong style={{ color: 'var(--ink)' }}>{active.current_step_number}</strong> — {active.current_step_name}
                    {' · '}
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{active.cycle_type_name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>
                    {active.size_mm != null && <span>{active.size_mm}mm</span>}
                    {active.design_code && <span>· {active.design_code}</span>}
                    {active.mo_number && <span>· {active.mo_number}</span>}
                    {active.current_storage_code && <span>· {active.current_storage_code}</span>}
                  </div>
                </div>

                {/* Design-not-confirmed warning (mirrors OperatorQueue) */}
                {!active.design_confirmed && (
                  <div
                    style={{
                      fontSize: 12.5,
                      color: 'var(--warning)',
                      background: 'rgba(217,122,43,.1)',
                      border: '1px solid rgba(217,122,43,.28)',
                      borderRadius: 9,
                      padding: '8px 12px',
                    }}
                  >
                    Design not confirmed — a manager must confirm before the converting step.
                  </div>
                )}

                {/* Timer panel */}
                <div
                  style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                    borderRadius: 12,
                    padding: '16px 18px',
                    display: 'flex',
                    gap: 18,
                  }}
                >
                  {phase === 'paused' ? (
                    <>
                      <TimerCell value={hhmmss(pausedForMs)} label="Paused for" sub="pause duration" color="var(--warning)" />
                      <TimerCell value={hhmmss(netMs)} label="Net work time" sub="active time only" />
                    </>
                  ) : phase === 'in_progress' ? (
                    <>
                      <TimerCell value={hhmmss(activeSinceResumeMs)} label="Active time" sub="since last resume" color="var(--success)" />
                      <TimerCell value={hhmmss(netMs)} label="Net work time" sub="pauses excluded" />
                      <TimerCell value={hhmmss(totalElapsedMs)} label="Total elapsed" sub="incl. pauses" />
                    </>
                  ) : (
                    <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink-2)' }}>
                      Job queued. Tap <strong>Start</strong> to begin the timer for this step.
                    </div>
                  )}
                </div>

                {/* Step progress track */}
                <StepTrack steps={steps} currentNumber={active.current_step_number} />

                {/* Pause history (from persisted job events) */}
                {pauseEvents.length > 0 && (
                  <div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
                      Pause history this job
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {pauseEvents.map((p, i) => (
                        <div key={i} style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                          {p.reason ?? 'Paused'}
                          {' — '}
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--ink-3)' }}>
                            {format(new Date(p.created_at), 'HH:mm')}
                          </span>
                          {p.operator_name ? ` · ${p.operator_name}` : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Converting hint */}
                {converting && (
                  <div style={{ fontSize: 12.5, color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={14} /> Converting step — closing opens the conversion workflow (supervisor action).
                  </div>
                )}

                {/* Action buttons — large touch targets */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {phase === 'queued' && (
                    <button
                      className="btn-primary"
                      style={{ flex: 1, minWidth: 180, height: 56, fontSize: 16, justifyContent: 'center' }}
                      disabled={active.status !== 'active' || startJobMut.isPending}
                      onClick={startJob}
                    >
                      <Play size={20} /> {startJobMut.isPending ? 'Starting…' : 'Start Job'}
                    </button>
                  )}
                  {phase === 'in_progress' && (
                    <>
                      <button
                        className="btn-secondary"
                        style={{ flex: 1, minWidth: 150, height: 56, fontSize: 15, justifyContent: 'center' }}
                        onClick={() => setShowPause(true)}
                      >
                        <Pause size={18} /> Pause
                      </button>
                      <button
                        className="btn-primary"
                        style={{ flex: 1, minWidth: 150, height: 56, fontSize: 15, justifyContent: 'center' }}
                        onClick={() => setShowClose(true)}
                      >
                        <CheckCircle size={18} /> Close Job
                      </button>
                    </>
                  )}
                  {phase === 'paused' && (
                    <button
                      className="btn-primary"
                      style={{ flex: 1, minWidth: 180, height: 56, fontSize: 16, justifyContent: 'center' }}
                      disabled={resumeJobMut.isPending}
                      onClick={resumeJob}
                    >
                      <Play size={20} /> {resumeJobMut.isPending ? 'Resuming…' : 'Resume Job'}
                    </button>
                  )}
                </div>

                {/* Flag issue (does not pause timer) */}
                {phase !== 'queued' && (
                  <button
                    onClick={() => setFlagged((f) => !f)}
                    style={{
                      alignSelf: 'flex-start',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      fontFamily: "'IBM Plex Sans', sans-serif",
                      fontSize: 12.5,
                      color: flagged ? 'var(--error)' : 'var(--ink-2)',
                    }}
                  >
                    <Flag size={14} /> {flagged ? 'Issue flagged for supervisor' : 'Flag issue (does not pause timer)'}
                  </button>
                )}
              </>
            )}
          </div>

          {/* ── Queue list ───────────────────────────────────────────────── */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Up next ({queue.length})</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.1em', color: 'var(--ink-3)' }}>PRIORITY ORDER</span>
            </div>
            <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {queue.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    setActiveId(u.id)
                    setShowClose(false)
                    setShowPause(false)
                  }}
                  className="row-hover"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '13px 16px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--line)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{u.code}</span>
                      <PriorityBadge priority={u.priority} />
                    </div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)', flexShrink: 0 }}>
                      <Clock size={11} />
                      {formatDistanceToNowStrict(new Date(u.created_at))}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4 }}>
                    Step {u.current_step_number} — {u.current_step_name}
                  </div>
                </button>
              ))}
              {queue.length === 0 && (
                <div style={{ padding: '28px 16px', textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--ink-3)' }}>
                  No further jobs queued.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Pause reason modal ───────────────────────────────────────────── */}
      {showPause && (
        <ModalShell title="Pause reason — required" onClose={() => setShowPause(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {PAUSE_REASONS.map((r) => (
              <label
                key={r}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '11px 13px',
                  borderRadius: 9,
                  border: `1px solid ${pauseReason === r ? 'var(--accent)' : 'var(--line)'}`,
                  background: pauseReason === r ? 'var(--accent-dim)' : 'var(--surface-2)',
                  cursor: 'pointer',
                  fontSize: 14,
                  color: 'var(--ink)',
                }}
              >
                <input type="radio" name="pause-reason" checked={pauseReason === r} onChange={() => setPauseReason(r)} />
                {r}
              </label>
            ))}
          </div>
          <label className="label">Notes (optional)</label>
          <textarea className="input" rows={2} value={pauseNotes} onChange={(e) => setPauseNotes(e.target.value)} placeholder="Free text…" />
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn-secondary" style={{ flex: 1, height: 48, justifyContent: 'center' }} onClick={() => setShowPause(false)}>
              Cancel
            </button>
            <button className="btn-primary" style={{ flex: 1, height: 48, justifyContent: 'center' }} disabled={pauseJobMut.isPending} onClick={confirmPause}>
              <Pause size={16} /> {pauseJobMut.isPending ? 'Pausing…' : 'Confirm Pause'}
            </button>
          </div>
        </ModalShell>
      )}

      {/* ── Close job modal ──────────────────────────────────────────────── */}
      {showClose && active && (
        <ModalShell
          title={`Close Job — ${active.code} · Step ${active.current_step_number} · ${active.current_step_name ?? ''}`}
          onClose={() => setShowClose(false)}
        >
          {/* timing summary */}
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              borderRadius: 10,
              padding: '12px 14px',
              marginBottom: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontSize: 13,
            }}
          >
            <SummaryRow label="Net work time" value={hhmmss(netMs)} />
            <SummaryRow label="Total elapsed" value={`${hhmmss(totalElapsedMs)}  (incl. pauses)`} />
            <SummaryRow
              label="Pauses"
              value={
                pauseEvents.length
                  ? `${pauseEvents.length}  (${pauseEvents.map((p) => p.reason ?? 'paused').join(' · ')})`
                  : '0'
              }
            />
          </div>

          {/* Special close-flow notices (spec: converting / child-marking / QC) */}
          {converting && (
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--warning)',
                background: 'rgba(217,122,43,.1)',
                border: '1px solid rgba(217,122,43,.28)',
                borderRadius: 9,
                padding: '10px 12px',
                marginBottom: 14,
                display: 'flex',
                gap: 8,
              }}
            >
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                <strong>Converting — Step 16.</strong> This step cannot be closed with a simple confirm. It opens the full
                Converting workflow (child UID creation, pattern selection, scrap calculation) on the Converting page.
                <em style={{ display: 'block', marginTop: 3, color: 'var(--ink-3)' }}>Conversion workflow not wired into this panel.</em>
              </span>
            </div>
          )}
          {childMarking && (
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--warning)',
                background: 'rgba(217,122,43,.1)',
                border: '1px solid rgba(217,122,43,.28)',
                borderRadius: 9,
                padding: '10px 12px',
                marginBottom: 14,
                display: 'flex',
                gap: 8,
              }}
            >
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                <strong>Step 16B — Child UID Marking.</strong> Each child UID requires physical marking confirmation before
                closing.
                <em style={{ display: 'block', marginTop: 3, color: 'var(--ink-3)' }}>Per-child confirmation not wired into this panel.</em>
              </span>
            </div>
          )}
          {qcInspection && (
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--accent)',
                background: 'var(--accent-dim)',
                border: '1px solid var(--accent)',
                borderRadius: 9,
                padding: '10px 12px',
                marginBottom: 14,
                display: 'flex',
                gap: 8,
              }}
            >
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                <strong>QC Inspection — Step 26.</strong> A Pass or Fail QC result is required — this job cannot be closed
                without selecting one below.
              </span>
            </div>
          )}

          {/* Workstation */}
          <label className="label">Workstation</label>
          <select className="input" style={{ marginBottom: 14 }} value={selectedWS ?? ''} onChange={(e) => setSelectedWS(Number(e.target.value))}>
            <option value="">Select workstation…</option>
            {workstations.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>

          {/* Tempering actuals */}
          {temper && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div>
                <label className="label">Actual Temp (°C)</label>
                <input className="input" type="number" value={actualTemp} onChange={(e) => setActualTemp(e.target.value)} placeholder="e.g. 180" />
              </div>
              <div>
                <label className="label">Actual Soak (min)</label>
                <input className="input" type="number" value={actualTime} onChange={(e) => setActualTime(e.target.value)} placeholder="e.g. 90" />
              </div>
            </div>
          )}

          {/* QC check */}
          <label className="label">QC check required at this step?</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {QC_CHECKS.map((c) => (
              <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: 'var(--ink)', cursor: 'pointer' }}>
                <input type="radio" name="qc-check" checked={qcCheck === c.key} onChange={() => setQcCheck(c.key)} />
                {c.label}
              </label>
            ))}
          </div>

          {qcCheck !== 'na' && (
            <>
              <label className="label">Measured value</label>
              <input
                className="input"
                style={{ marginBottom: 12 }}
                value={qcValue}
                onChange={(e) => setQcValue(e.target.value)}
                placeholder={QC_CHECKS.find((c) => c.key === qcCheck)?.unit || 'value'}
              />
              <label className="label">Result</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {(['pass', 'fail', 'borderline'] as const).map((r) => {
                  const on = qcResult === r
                  const col = r === 'pass' ? 'var(--success)' : r === 'fail' ? 'var(--error)' : 'var(--warning)'
                  return (
                    <button
                      key={r}
                      onClick={() => setQcResult(r)}
                      style={{
                        flex: 1,
                        height: 42,
                        borderRadius: 9,
                        border: `1px solid ${on ? col : 'var(--line)'}`,
                        background: on ? col : 'var(--surface-2)',
                        color: on ? '#fff' : 'var(--ink-2)',
                        fontFamily: "'IBM Plex Sans', sans-serif",
                        fontSize: 13,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                        cursor: 'pointer',
                      }}
                    >
                      {r}
                    </button>
                  )
                })}
              </div>
              {qcResult === 'fail' && (
                <div style={{ fontSize: 12.5, color: 'var(--error)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={14} /> A failed result places the UID on hold automatically.
                </div>
              )}
            </>
          )}

          <label className="label">Notes (optional)</label>
          <textarea className="input" rows={2} value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="Free text…" />

          {completeStep.isError && (
            <p style={{ fontSize: 13, color: 'var(--error)', marginTop: 10 }}>Failed to close job — please retry.</p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button className="btn-secondary" style={{ flex: 1, height: 52, justifyContent: 'center' }} onClick={() => setShowClose(false)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              style={{ flex: 2, height: 52, justifyContent: 'center', fontSize: 14 }}
              disabled={!canSubmitClose || completeStep.isPending}
              onClick={confirmClose}
            >
              <CheckCircle size={17} />
              {completeStep.isPending ? 'Closing…' : 'Confirm Close — Advance Step'}
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  )
}

// ── Reusable modal shell ─────────────────────────────────────────────────────
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(21,54,106,.28)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 50,
      }}
    >
      <div
        className="card animate-es"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, padding: 22, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
            {title}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 2 }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--ink-2)' }}>{label}</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--ink)', fontWeight: 600 }}>{value}</span>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// DHARMAPURI FLOOR OVERVIEW — Supervisor / Manager / Admin (read-only)
// Production happens at one location (Dharmapuri); there is no location toggle.
// Shows every Dharmapuri workstation with its operator and allotted queue — the
// execution-side complement of the Job Assignment board (where work is allotted).
// The admin pause-alert threshold is persisted via jobApi.get/setPauseThreshold.
// Acting on ANOTHER operator's job (cross-operator View/Pause/Close) and the
// aggregate live "running now / paused now" floor metrics still need a
// cross-operator job-state feed; those controls remain disabled / not yet wired.
// ════════════════════════════════════════════════════════════════════════════
const SHIFT_OPTS = [
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'night', label: 'Night' },
]

function FloorView({
  rows,
  loading,
  error,
  onRetry,
  floorShift,
  setFloorShift,
  role,
  isAdmin,
  metrics,
  pauseThresholdMin,
  onSavePauseThreshold,
  savingPauseThreshold,
}: {
  rows: QueueViewRow[]
  loading: boolean
  error: boolean
  onRetry: () => void
  floorShift: string
  setFloorShift: (v: string) => void
  role: string
  isAdmin: boolean
  metrics: { stations: number; stationsStaffed: number; totalQueued: number; totalReady: number; idleOperators: number }
  pauseThresholdMin: number
  onSavePauseThreshold: (v: number) => void
  savingPauseThreshold: boolean
}) {
  const isManagerPlus = role === 'manager' || role === 'admin'
  // Local draft synced from the persisted value; admin can save it back.
  const [thresholdDraft, setThresholdDraft] = useState(pauseThresholdMin)
  useEffect(() => setThresholdDraft(pauseThresholdMin), [pauseThresholdMin])
  const thresholdDirty = thresholdDraft !== pauseThresholdMin

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Controls: shift selector + pause-threshold config */}
      <div className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            Shift
          </span>
          {SHIFT_OPTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setFloorShift(s.value)}
              className={floorShift === s.value ? 'btn-primary' : 'btn-secondary'}
              style={{ height: 32, padding: '0 12px', fontSize: 12 }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Pause-threshold alert config — persisted (admin-editable) */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          title={isAdmin ? 'Persisted server-wide pause alert threshold.' : 'Configured by admin.'}
        >
          <Bell size={14} style={{ color: 'var(--ink-3)' }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            Pause alert threshold
          </span>
          <input
            type="number"
            min={1}
            value={thresholdDraft}
            disabled={!isAdmin}
            onChange={(e) => setThresholdDraft(Math.max(1, Number(e.target.value) || 1))}
            className="input"
            style={{ width: 70, height: 32, padding: '0 8px' }}
          />
          <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>min</span>
          {isAdmin && (
            <button
              className="btn-secondary"
              style={{ height: 32, padding: '0 12px', fontSize: 12 }}
              disabled={!thresholdDirty || savingPauseThreshold}
              onClick={() => onSavePauseThreshold(thresholdDraft)}
            >
              {savingPauseThreshold ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>

        <button className="btn-secondary" style={{ height: 32, padding: '0 12px', fontSize: 12 }} onClick={onRetry}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Read-only framing — points supervisors to Job Assignment for allotting.
          Job Assignment = allot work to operators (drag-and-drop);
          Job Execution = watch / track operators working it. */}
      <div
        className="card"
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          background: 'var(--accent-dim)',
          border: '1px solid var(--accent)',
        }}
      >
        <Eye size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: 'var(--ink-2)', flex: 1, minWidth: 220 }}>
          This is a <strong style={{ color: 'var(--ink)' }}>read-only overview</strong> of what each operator on the
          Dharmapuri floor is working. To <strong style={{ color: 'var(--ink)' }}>allot jobs</strong> to operators
          (drag-and-drop), use the Job Assignment board.
        </span>
        <Link
          to="/job-assignment"
          className="btn-secondary"
          style={{ height: 32, padding: '0 12px', fontSize: 12, textDecoration: 'none', alignItems: 'center', display: 'inline-flex', gap: 5 }}
        >
          Job Assignment <ArrowRight size={13} />
        </Link>
      </div>

      {/* Manager / Admin summary metrics */}
      {isManagerPlus && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <MetricCard icon={<Activity size={15} />} label="Workstations staffed" value={`${metrics.stationsStaffed} / ${metrics.stations}`} />
          <MetricCard icon={<ListChecks size={15} />} label="Jobs queued (allotted)" value={String(metrics.totalQueued)} />
          <MetricCard icon={<Clock size={15} />} label="Ready, unassigned" value={String(metrics.totalReady)} />
          <MetricCard icon={<Users size={15} />} label="Operators idle (no queue)" value={String(metrics.idleOperators)} accent={metrics.idleOperators > 0} />
        </div>
      )}

      {isManagerPlus && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)' }}>
          Live "running now / paused now / avg active time" metrics require a server job-state feed — not yet wired.
        </div>
      )}

      {/* Workstation grid */}
      {loading ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--ink-3)' }}>
          Loading floor…
        </div>
      ) : error ? (
        <div className="card" style={{ padding: 28, display: 'flex', alignItems: 'center', gap: 12, color: 'var(--error)' }}>
          <AlertTriangle size={18} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Couldn't load the floor view.</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>No shift assignments for this shift, or the service is unavailable.</div>
          </div>
          <button className="btn-secondary" onClick={onRetry}>Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <ListChecks size={26} style={{ color: 'var(--ink-3)', marginBottom: 10 }} />
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>
            No workstations assigned for this shift
          </div>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink-2)', marginTop: 4 }}>
            Assign operators on the Job Assignment page, then they will appear here.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {rows.map((r) => (
            <WorkstationPanel key={r.assignment_id} row={r} />
          ))}
        </div>
      )}
    </div>
  )
}

function MetricCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: accent ? 'var(--warning)' : 'var(--ink-3)', marginBottom: 6 }}>
        {icon}
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div
        style={{
          fontFamily: "'Archivo', sans-serif",
          fontWeight: 800,
          letterSpacing: '-0.03em',
          fontSize: 26,
          color: accent ? 'var(--warning)' : 'var(--ink)',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function WorkstationPanel({ row }: { row: QueueViewRow }) {
  const next = row.queue[0]
  const staffed = row.operator_id != null
  const hasWork = row.queue.length > 0
  // No live job-state feed; classify by assignment + queue only.
  const statusColor = !staffed ? 'var(--ink-3)' : hasWork ? 'var(--success)' : 'var(--warning)'
  const statusLabel = !staffed ? 'UNASSIGNED' : hasWork ? 'HAS QUEUE' : 'IDLE'

  return (
    <div className="card" style={{ padding: 16, borderLeft: `4px solid ${statusColor}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
          {row.workstation_code}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', color: statusColor }}>
            {statusLabel}
          </span>
        </span>
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{row.workstation_name}</div>

      {/* Active / next job */}
      {next ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{next.uid_code}</span>
          <PriorityBadge priority={(next.priority as UID['priority']) ?? 'normal'} />
        </div>
      ) : (
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: 'var(--ink-3)' }}>No active job</div>
      )}

      {/* Operator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-2)' }}>
        <Users size={13} style={{ color: 'var(--ink-3)' }} />
        {row.operator_name ?? 'No operator assigned'}
        {!row.confirmed && staffed && (
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, color: 'var(--warning)', marginLeft: 4 }}>unconfirmed</span>
        )}
      </div>

      {/* Counts */}
      <div style={{ display: 'flex', gap: 14, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>
        <span>Allotted: <strong style={{ color: 'var(--ink)' }}>{row.queue.length}</strong></span>
        <span>Ready: <strong style={{ color: 'var(--ink)' }}>{row.ready_count}</strong></span>
      </div>

      {/* Act-on-any-job controls — require a job-state endpoint, not yet wired */}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }} title="Acting on another operator's job requires a server job-state endpoint — not yet wired.">
        <button className="btn-secondary" style={{ flex: 1, height: 40, fontSize: 12.5, justifyContent: 'center' }} disabled>
          <Eye size={14} /> View
        </button>
        <button className="btn-secondary" style={{ flex: 1, height: 40, fontSize: 12.5, justifyContent: 'center' }} disabled>
          <Pause size={14} /> Pause
        </button>
        <button className="btn-secondary" style={{ flex: 1, height: 40, fontSize: 12.5, justifyContent: 'center' }} disabled>
          <CheckCircle size={14} /> Close
        </button>
      </div>
    </div>
  )
}
