import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { uidApi, factoryApi, cycleApi } from '../api/client'
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
} from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'

// ── Local job runtime state ──────────────────────────────────────────────────
// NOTE: the spec describes a persisted START / PAUSE / RESUME / CLOSE timer.
// The available API only exposes uidApi.completeStep (the CLOSE → advance
// action). No start/pause/resume endpoints exist, so the timer here is driven
// client-side (resets on reload). CLOSE is wired to the real completeStep call.
type JobPhase = 'queued' | 'in_progress' | 'paused'

interface PauseLog {
  reason: string
  notes: string
  startedAt: number
  endedAt: number | null
}

interface Runtime {
  uid_id: number
  phase: JobPhase
  startedAt: number // first start (epoch ms)
  resumedAt: number // last resume/start (epoch ms)
  netBeforeResume: number // accumulated net work ms before current run
  pauses: PauseLog[]
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
  const locationId = user?.primary_location_id ?? undefined

  const [activeId, setActiveId] = useState<number | null>(null)
  const [runtime, setRuntime] = useState<Runtime | null>(null)
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
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime

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

  const completeStep = useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      const id = (runtimeRef.current?.uid_id ?? activeId) as number
      return uidApi.completeStep(id, data).then((r) => r.data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobexec-queue'] })
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

  // Is the runtime for the currently-active UID? Otherwise treat as queued.
  const liveRuntime = runtime && active && runtime.uid_id === active.id ? runtime : null
  const phase: JobPhase = liveRuntime?.phase ?? 'queued'
  const now = useNow(phase === 'in_progress' || phase === 'paused')

  function resetActive() {
    setRuntime(null)
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
    if (!active) return
    const t = Date.now()
    setRuntime({
      uid_id: active.id,
      phase: 'in_progress',
      startedAt: t,
      resumedAt: t,
      netBeforeResume: 0,
      pauses: [],
    })
  }

  function confirmPause() {
    if (!liveRuntime) return
    const t = Date.now()
    setRuntime({
      ...liveRuntime,
      phase: 'paused',
      netBeforeResume: liveRuntime.netBeforeResume + (t - liveRuntime.resumedAt),
      pauses: [...liveRuntime.pauses, { reason: pauseReason, notes: pauseNotes, startedAt: t, endedAt: null }],
    })
    setShowPause(false)
    setPauseNotes('')
    setPauseReason(PAUSE_REASONS[0])
  }

  function resumeJob() {
    if (!liveRuntime) return
    const t = Date.now()
    const pauses = liveRuntime.pauses.slice()
    const last = pauses[pauses.length - 1]
    if (last && last.endedAt == null) pauses[pauses.length - 1] = { ...last, endedAt: t }
    setRuntime({ ...liveRuntime, phase: 'in_progress', resumedAt: t, pauses })
  }

  // Derived timer figures.
  const netMs =
    liveRuntime == null
      ? 0
      : liveRuntime.phase === 'in_progress'
        ? liveRuntime.netBeforeResume + (now - liveRuntime.resumedAt)
        : liveRuntime.netBeforeResume
  const activeSinceResumeMs =
    liveRuntime && liveRuntime.phase === 'in_progress' ? now - liveRuntime.resumedAt : 0
  const totalElapsedMs = liveRuntime ? now - liveRuntime.startedAt : 0
  const lastPause = liveRuntime?.pauses[liveRuntime.pauses.length - 1]
  const pausedForMs = lastPause && lastPause.endedAt == null ? now - lastPause.startedAt : 0

  const temper = isTemperStep(active?.current_step_name)
  const converting = isConvertingStep(active?.current_step_name)
  const canSubmitClose =
    !!selectedWS &&
    active?.status === 'active' &&
    (!temper || (actualTemp !== '' && actualTime !== '')) &&
    (qcCheck === 'na' || qcValue.trim() !== '' || qcResult != null)

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
    if (liveRuntime) data.net_work_seconds = Math.round(netMs / 1000)
    completeStep.mutate(data)
  }

  // ── Phase accent colour ───────────────────────────────────────────────────
  const phaseColor =
    phase === 'in_progress' ? 'var(--success)' : phase === 'paused' ? 'var(--warning)' : 'var(--ink-3)'
  const phaseLabel = phase === 'in_progress' ? 'IN PROGRESS' : phase === 'paused' ? 'PAUSED' : 'QUEUED'

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
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
          {ordered.length} job{ordered.length === 1 ? '' : 's'} in your queue — start, pause, and close work on the floor
        </div>
      </div>

      {/* ── Loading / error / empty ──────────────────────────────────────── */}
      {isLoading ? (
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
                      {phase === 'paused' && lastPause ? ` — ${lastPause.reason}` : ''}
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

                {/* Pause history */}
                {liveRuntime && liveRuntime.pauses.length > 0 && (
                  <div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
                      Pause history this job
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {liveRuntime.pauses.map((p, i) => (
                        <div key={i} style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                          {p.reason}
                          {' — '}
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--ink-3)' }}>
                            {p.endedAt ? hhmmss(p.endedAt - p.startedAt) : 'ongoing'}
                          </span>
                          {p.notes ? ` · ${p.notes}` : ''}
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
                      disabled={active.status !== 'active'}
                      onClick={startJob}
                    >
                      <Play size={20} /> Start Job
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
                      onClick={resumeJob}
                    >
                      <Play size={20} /> Resume Job
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
            <button className="btn-primary" style={{ flex: 1, height: 48, justifyContent: 'center' }} onClick={confirmPause}>
              <Pause size={16} /> Confirm Pause
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
                liveRuntime && liveRuntime.pauses.length
                  ? `${liveRuntime.pauses.length}  (${liveRuntime.pauses.map((p) => p.reason).join(' · ')})`
                  : '0'
              }
            />
          </div>

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
