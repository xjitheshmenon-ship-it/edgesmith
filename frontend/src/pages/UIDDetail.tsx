import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Flame,
  Scissors,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react'
import { format } from 'date-fns'
import { uidApi, cycleApi } from '../api/client'
import type { UID, CycleType, CycleStep, StepHistory } from '../types'
import UIDStatusBadge from '../components/UIDStatusBadge'
import PriorityBadge from '../components/PriorityBadge'

// Tempering steps use the furnace (HT90/HT70/HT80) — flagged distinctly.
const TEMPERING_STEPS = new Set(['6', '7', '9', '10', '14', '23'])

const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"

const CYCLE_BADGE: Record<string, string> = {
  EAT: 'badge-blue',
  SWAN: 'badge-green',
  OVEN: 'badge-orange',
}

// ── Cycle-type badge ─────────────────────────────────────────────────────────
function CycleBadge({ name }: { name?: string | null }) {
  if (!name) return null
  const cls = CYCLE_BADGE[name.toUpperCase()] ?? 'badge-blue'
  return <span className={cls}>{name}</span>
}

// ── Small section label ──────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--ink-3)',
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  )
}

// ── A labelled attribute (mono label / sans value) ───────────────────────────
function Attr({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{value}</div>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 14,
  boxShadow: 'var(--shadow-e1)',
  padding: 20,
}

// ── The 27-step tracker node ─────────────────────────────────────────────────
type NodeState = 'completed' | 'current' | 'split' | 'upcoming'

interface TrackerNode {
  stepNumber: string
  workstation: string
  state: NodeState
  isTempering: boolean
  operationName: string
}

function nodeColors(state: NodeState): { bg: string; fg: string; border: string } {
  switch (state) {
    case 'completed':
      return { bg: '#2D6FB5', fg: '#ffffff', border: '#2D6FB5' }
    case 'current':
      return { bg: '#15366A', fg: '#ffffff', border: '#15366A' }
    case 'split':
      return { bg: '#D97A2B', fg: '#ffffff', border: '#D97A2B' }
    default:
      return { bg: 'var(--surface-2)', fg: 'var(--ink-3)', border: 'var(--line)' }
  }
}

function StepTracker({ nodes }: { nodes: TrackerNode[] }) {
  return (
    <div
      className="uid-tracker-scroll"
      style={{ overflowX: 'auto', overflowY: 'hidden', paddingBottom: 4 }}
    >
      <style>{`.uid-tracker-scroll::-webkit-scrollbar{height:0;width:0;display:none}.uid-tracker-scroll{scrollbar-width:none}
        @keyframes uid-node-glow{0%,100%{box-shadow:0 0 0 0 rgba(45,111,181,.45)}50%{box-shadow:0 0 0 5px rgba(45,111,181,0)}}`}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 'min-content', paddingTop: 6 }}>
        {nodes.map((n, i) => {
          const c = nodeColors(n.state)
          const prev = nodes[i - 1]
          // Connector colour: blue once we've reached this node, muted ahead.
          const reached =
            n.state === 'completed' || n.state === 'current' ||
            (n.state === 'split' && prev && (prev.state === 'completed' || prev.state === 'current' || prev.state === 'split'))
          const connectorColor = reached ? '#2D6FB5' : 'var(--line)'
          return (
            <div key={n.stepNumber} style={{ display: 'flex', alignItems: 'flex-start' }}>
              {i > 0 && (
                <div
                  style={{
                    width: 22,
                    height: 2,
                    background: connectorColor,
                    marginTop: 11,
                    flexShrink: 0,
                  }}
                />
              )}
              <div
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 52, flexShrink: 0 }}
                title={`Step ${n.stepNumber} — ${n.operationName} @ ${n.workstation}`}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: c.bg,
                    border: `1.5px solid ${c.border}`,
                    color: c.fg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: MONO,
                    fontSize: 9.5,
                    fontWeight: 600,
                    position: 'relative',
                    animation: n.state === 'current' ? 'uid-node-glow 1.8s ease-in-out infinite' : undefined,
                  }}
                >
                  {n.isTempering && (n.state === 'completed' || n.state === 'current') ? (
                    <Flame size={12} />
                  ) : (
                    n.stepNumber
                  )}
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 8,
                    color: 'var(--ink-3)',
                    marginTop: 6,
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: 50,
                  }}
                >
                  {n.workstation}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Build tracker nodes from cycle definition + UID history ──────────────────
function buildNodes(steps: CycleStep[], uid: UID): TrackerNode[] {
  const history = uid.step_history ?? []
  const completedStepNumbers = new Set(history.map((h) => h.step_number))
  const current = uid.current_step_number

  return steps.map((s) => {
    const isSplit = s.is_converting_step || s.is_child_marking_step || s.step_number === '16' || s.step_number === '16B'
    const isTempering = TEMPERING_STEPS.has(s.step_number)
    let state: NodeState
    if (s.step_number === current) state = 'current'
    else if (completedStepNumbers.has(s.step_number)) state = isSplit ? 'split' : 'completed'
    else state = 'upcoming'
    // Split steps that are current/completed stay amber.
    if (isSplit && (state === 'current' || state === 'completed')) state = 'split'
    return {
      stepNumber: s.step_number,
      workstation: s.workstation_code,
      operationName: s.operation_name,
      state,
      isTempering,
    }
  })
}

// ── QC result chip ───────────────────────────────────────────────────────────
function QcChip({ result }: { result: string | null }) {
  if (!result) return <span style={{ color: 'var(--ink-3)' }}>—</span>
  const r = result.toLowerCase()
  if (r === 'pass') return <span className="badge-green">Pass</span>
  if (r === 'fail') return <span className="badge-red">Fail</span>
  return <span className="badge-yellow">{result}</span>
}

function fmtQcValues(values: Record<string, unknown> | null): string {
  if (!values || Object.keys(values).length === 0) return ''
  return Object.entries(values)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')
}

export default function UIDDetail() {
  const { code = '' } = useParams<{ code: string }>()

  const {
    data: uid,
    isLoading,
    isError,
    error,
  } = useQuery<UID>({
    queryKey: ['uid-detail', code],
    queryFn: () => uidApi.lookup(code).then((r) => r.data),
    enabled: !!code,
  })

  // Full cycle definitions (array, not {items}). Used for the 27-step tracker.
  const { data: cycles = [] } = useQuery<CycleType[]>({
    queryKey: ['uid-detail-cycles'],
    queryFn: () => cycleApi.list().then((r) => r.data),
  })

  const cycleSteps = useMemo<CycleStep[]>(() => {
    if (!uid) return []
    const match =
      cycles.find((c) => c.id === uid.cycle_type_id) ??
      cycles.find((c) => c.name?.toUpperCase() === uid.cycle_type_name?.toUpperCase())
    const steps = match?.current_version?.steps ?? []
    return [...steps].sort((a, b) => a.step_order - b.step_order)
  }, [cycles, uid])

  const nodes = useMemo<TrackerNode[]>(() => {
    if (!uid || cycleSteps.length === 0) return []
    return buildNodes(cycleSteps, uid)
  }, [cycleSteps, uid])

  const history = useMemo<StepHistory[]>(() => {
    const h = uid?.step_history ?? []
    return [...h].sort(
      (a, b) => new Date(a.performed_at).getTime() - new Date(b.performed_at).getTime()
    )
  }, [uid])

  // Hold reason (from latest history note when on hold, if present).
  const holdReason = useMemo(() => {
    if (uid?.status !== 'on_hold') return null
    const last = [...(uid?.step_history ?? [])]
      .reverse()
      .find((h) => h.notes)
    return last?.notes ?? null
  }, [uid])

  if (isLoading) {
    return (
      <div style={{ padding: '40px 28px', color: 'var(--ink-2)', fontFamily: SANS, fontSize: 14 }}>
        Loading UID {code}…
      </div>
    )
  }

  if (isError || !uid) {
    const status = (error as { response?: { status?: number } } | undefined)?.response?.status
    return (
      <div style={{ padding: '40px 28px', maxWidth: 640 }}>
        <Link
          to="/uid-lookup"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: SANS, fontSize: 13, color: 'var(--accent)', textDecoration: 'none', marginBottom: 16 }}
        >
          <ArrowLeft size={15} /> Back to lookup
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--error)', fontFamily: SANS, fontSize: 14 }}>
          <XCircle size={17} />
          {status === 404 ? `UID "${code}" not found` : 'Failed to load UID. Please try again.'}
        </div>
      </div>
    )
  }

  const onHold = uid.status === 'on_hold'

  return (
    <div className="animate-es" style={{ padding: '24px 28px 64px', maxWidth: 1080, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 34, letterSpacing: '-0.03em', color: 'var(--ink)', lineHeight: 1 }}>
              {uid.code}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <CycleBadge name={uid.cycle_type_name} />
              <UIDStatusBadge status={uid.status} />
              <PriorityBadge priority={uid.priority} />
              {uid.factory_location_code && (
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-3)' }}>{uid.factory_location_code}</span>
              )}
            </div>
          </div>

          {uid.parent_uid_code && (
            <Link
              to={`/uid/${uid.parent_uid_code}`}
              style={{ textAlign: 'right', textDecoration: 'none' }}
            >
              <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>Split child of</div>
              <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600, color: 'var(--accent)', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {uid.parent_uid_code} <ChevronRight size={14} />
              </div>
            </Link>
          )}
        </div>

        {/* Hold alert */}
        {onHold && (
          <div
            style={{
              marginTop: 16,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '12px 14px',
              borderRadius: 11,
              background: 'rgba(229,72,77,.10)',
              border: '1px solid rgba(229,72,77,.25)',
            }}
          >
            <AlertTriangle size={17} style={{ color: 'var(--error)', flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: '#C0392B' }}>This UID is on hold</div>
              {holdReason && (
                <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2)', marginTop: 2 }}>{holdReason}</div>
              )}
            </div>
          </div>
        )}

        {/* Design-pending warning */}
        {!uid.design_confirmed && (
          <div
            style={{
              marginTop: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 14px',
              borderRadius: 11,
              background: 'rgba(217,122,43,.10)',
              border: '1px solid rgba(217,122,43,.25)',
            }}
          >
            <AlertTriangle size={17} style={{ color: 'var(--warning)', flexShrink: 0 }} />
            <div style={{ fontFamily: SANS, fontSize: 13, color: '#9A5419' }}>
              Design not confirmed — must be set before Step 16 (Converting).
            </div>
          </div>
        )}
      </div>

      {/* ── 27-STEP TRACKER ─────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
          <SectionLabel>Step Tracker · {uid.cycle_type_name} Cycle</SectionLabel>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3)' }}>
            {uid.current_step_number ? `Now at Step ${uid.current_step_number} — ${uid.current_step_name ?? ''}` : '—'}
          </span>
        </div>
        {nodes.length > 0 ? (
          <StepTracker nodes={nodes} />
        ) : (
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-3)' }}>Cycle step definition unavailable.</div>
        )}
        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16, fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-3)' }}>
          {[
            ['#2D6FB5', 'Completed'],
            ['#15366A', 'Current'],
            ['#D97A2B', 'Converting (16/16B)'],
            ['var(--surface-2)', 'Upcoming'],
          ].map(([bg, lbl]) => (
            <span key={lbl} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: bg, border: bg === 'var(--surface-2)' ? '1.5px solid var(--line)' : 'none', display: 'inline-block' }} />
              {lbl}
            </span>
          ))}
        </div>
      </div>

      {/* ── ATTRIBUTES + CURRENT STATUS ─────────────────────────────────── */}
      <div style={cardStyle}>
        <SectionLabel>Attributes &amp; Current Status</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 18 }}>
          <Attr label="SIZE" value={uid.size_mm ? `${uid.size_mm} mm` : '—'} />
          <Attr
            label="DESIGN"
            value={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: MONO }}>{uid.design_code ?? 'No design'}</span>
                {uid.design_confirmed ? (
                  <span className="badge-green" style={{ fontSize: 9.5 }}>Confirmed</span>
                ) : (
                  <span className="badge-yellow" style={{ fontSize: 9.5 }}>Pending</span>
                )}
                {uid.design_locked && <span className="badge-gray" style={{ fontSize: 9.5 }}>Locked</span>}
              </span>
            }
          />
          <Attr
            label="MO NUMBER"
            value={uid.mo_number ? <span style={{ fontFamily: MONO }}>{uid.mo_number}</span> : '—'}
          />
          <Attr label="PRIORITY" value={<PriorityBadge priority={uid.priority} />} />
          <Attr
            label="CURRENT STEP"
            value={uid.current_step_number ? `${uid.current_step_number} — ${uid.current_step_name ?? ''}` : '—'}
          />
          <Attr
            label="CURRENT WORKSTATION"
            value={
              <span style={{ fontFamily: MONO }}>
                {nodes.find((n) => n.stepNumber === uid.current_step_number)?.workstation ?? '—'}
              </span>
            }
          />
          <Attr
            label="CURRENT STORAGE"
            value={<span style={{ fontFamily: MONO }}>{uid.current_storage_code ?? '—'}</span>}
          />
          <Attr label="CREATED" value={format(new Date(uid.created_at), 'dd MMM yyyy, HH:mm')} />
        </div>
      </div>

      {/* ── MATERIAL ORIGIN ─────────────────────────────────────────────── */}
      {(uid.alloy_heat_number || uid.ms_heat_number || uid.rolling_contractor || uid.alloy_supplier || uid.ms_supplier) && (
        <div style={cardStyle}>
          <SectionLabel>Material Origin</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 18 }}>
            <Attr label="ALLOY HEAT NUMBER" value={<span style={{ fontFamily: MONO }}>{uid.alloy_heat_number ?? '—'}</span>} />
            <Attr label="ALLOY SUPPLIER" value={uid.alloy_supplier ?? '—'} />
            <Attr label="ALLOY GRADE" value={uid.alloy_grade ?? '—'} />
            <Attr label="MS HEAT NUMBER" value={<span style={{ fontFamily: MONO }}>{uid.ms_heat_number ?? '—'}</span>} />
            <Attr label="MS SUPPLIER" value={uid.ms_supplier ?? '—'} />
            <Attr label="MS GRADE" value={uid.ms_grade ?? '—'} />
            <Attr label="ROLLING CONTRACTOR" value={uid.rolling_contractor ?? '—'} />
          </div>
        </div>
      )}

      {/* ── LINEAGE ─────────────────────────────────────────────────────── */}
      {(uid.parent_uid_code || uid.children.length > 0) && (
        <div style={cardStyle}>
          <SectionLabel>Lineage</SectionLabel>

          {uid.parent_uid_code && (
            <div style={{ marginBottom: uid.children.length > 0 ? 18 : 0 }}>
              <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3)', marginBottom: 8 }}>PARENT UID</div>
              <Link
                to={`/uid/${uid.parent_uid_code}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px', textDecoration: 'none', fontFamily: MONO, fontSize: 13, color: 'var(--ink)' }}
              >
                {uid.parent_uid_code}
                <ChevronRight size={13} style={{ color: 'var(--ink-3)' }} />
              </Link>
            </div>
          )}

          {uid.children.length > 0 && (
            <div>
              <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3)', marginBottom: 8 }}>
                CHILD UIDS ({uid.children.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {uid.children.map((c) => (
                  <Link
                    key={c.id}
                    to={`/uid/${c.code}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px', textDecoration: 'none', fontFamily: MONO, fontSize: 13, color: 'var(--ink)' }}
                  >
                    <Scissors size={12} style={{ color: 'var(--warning)' }} />
                    {c.code}
                    <UIDStatusBadge status={c.status} />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── STEP HISTORY ────────────────────────────────────────────────── */}
      <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 12px' }}>
          <SectionLabel>Step History ({history.length})</SectionLabel>
        </div>
        {history.length === 0 ? (
          <div style={{ padding: '0 20px 20px', fontFamily: SANS, fontSize: 13, color: 'var(--ink-3)' }}>No steps completed yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="es-table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Operation</th>
                  <th>Workstation</th>
                  <th>Operator</th>
                  <th>Timestamp</th>
                  <th>QC</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const isTemper = TEMPERING_STEPS.has(h.step_number)
                  const qcVals = fmtQcValues(h.qc_values)
                  return (
                    <tr key={h.id}>
                      <td style={{ fontFamily: MONO, fontWeight: 600 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {isTemper && <Flame size={12} style={{ color: 'var(--warning)' }} />}
                          {h.step_number}
                        </span>
                      </td>
                      <td>
                        {h.operation_name}
                        {h.child_uids_created && h.child_uids_created.length > 0 && (
                          <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--accent)', marginTop: 3 }}>
                            → {h.child_uids_created.join(', ')}
                          </div>
                        )}
                        {(h.notes || qcVals) && (
                          <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3 }}>
                            {[qcVals, h.notes].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td style={{ fontFamily: MONO, fontSize: 12 }}>{h.workstation_code ?? '—'}</td>
                      <td>{h.performed_by ?? '—'}</td>
                      <td style={{ fontFamily: MONO, fontSize: 12, whiteSpace: 'nowrap' }}>
                        {format(new Date(h.performed_at), 'dd MMM yyyy, HH:mm')}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {h.qc_result?.toLowerCase() === 'pass' ? (
                            <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
                          ) : h.qc_result?.toLowerCase() === 'fail' ? (
                            <XCircle size={14} style={{ color: 'var(--error)' }} />
                          ) : (
                            <Clock size={14} style={{ color: 'var(--ink-3)' }} />
                          )}
                          <QcChip result={h.qc_result} />
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
