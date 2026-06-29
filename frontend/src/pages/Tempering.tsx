import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { temperingApi, cycleApi } from '../api/client'
import type { CycleType } from '../types'
import { useAuth } from '../hooks/useAuth'
import { Flame, AlertTriangle, Lock, Check, X, Thermometer, Timer, Save, History } from 'lucide-react'
import { format } from 'date-fns'

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
  orange: '#d97a2b',
  amber: '#f0c674',
  green: '#22a06b',
}
const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"

/* A tempering parameter row as returned by GET /tempering/parameters. */
interface ParamRow {
  id: number
  cycle_type_id: number
  cycle_type_name: string
  cycle_step_id: number
  step_number: string
  operation_name: string
  target_temp_c: number | null
  target_soak_minutes: number | null
  tolerance_temp_c: number | null
  tolerance_soak_minutes: number | null
  updated_at?: string | null
  updated_by_name?: string | null
}

/* A tempering step belonging to a cycle's current version. */
interface TempStep {
  cycle_step_id: number
  step_number: string
  operation_name: string
}

/* Identify HT-furnace tempering steps within a cycle version. */
const isTemperStep = (s: { workstation_code?: string; operation_name?: string }) =>
  s.workstation_code === 'HT90' ||
  /^HT(70|80|90)/i.test(s.workstation_code ?? '') ||
  (s.operation_name ?? '').toLowerCase().includes('temper') ||
  (s.operation_name ?? '').toLowerCase().includes('stress relief')

/* ─── small primitives ─────────────────────────────────────────────────────── */
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

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  fontFamily: MONO, fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap',
}

function CycleBadge({ name }: { name: string }) {
  const key = name.toUpperCase()
  const map: Record<string, { bg: string; fg: string }> = {
    EAT: { bg: 'rgba(45,111,181,.14)', fg: C.accent },
    SWAN: { bg: 'rgba(34,160,107,.14)', fg: '#1c7a52' },
    OVEN: { bg: 'rgba(217,122,43,.14)', fg: C.orange },
  }
  const s = map[key] ?? { bg: C.surface3, fg: C.ink2 }
  return <span style={{ ...pill, background: s.bg, color: s.fg }}>{key}</span>
}

/* ─── editable parameter cell ──────────────────────────────────────────────── */
function ParamCell({
  param,
  editable,
  saving,
  onSave,
}: {
  param: ParamRow | undefined
  editable: boolean
  saving: boolean
  onSave: (vals: { target_temp_c: number; target_soak_minutes: number; tolerance_temp_c: number; tolerance_soak_minutes: number }) => void
}) {
  const [editing, setEditing] = useState(false)
  const [temp, setTemp] = useState('')
  const [soak, setSoak] = useState('')
  const [tolT, setTolT] = useState('')
  const [tolS, setTolS] = useState('')

  const begin = () => {
    if (!editable) return
    setTemp(param?.target_temp_c != null ? String(param.target_temp_c) : '')
    setSoak(param?.target_soak_minutes != null ? String(param.target_soak_minutes) : '')
    setTolT(param?.tolerance_temp_c != null ? String(param.tolerance_temp_c) : '5')
    setTolS(param?.tolerance_soak_minutes != null ? String(param.tolerance_soak_minutes) : '5')
    setEditing(true)
  }

  const commit = () => {
    const t = parseFloat(temp)
    const s = parseInt(soak, 10)
    if (Number.isNaN(t) || Number.isNaN(s)) return
    onSave({
      target_temp_c: t,
      target_soak_minutes: s,
      tolerance_temp_c: tolT === '' ? 0 : parseFloat(tolT),
      tolerance_soak_minutes: tolS === '' ? 0 : parseInt(tolS, 10),
    })
    setEditing(false)
  }

  const mini: React.CSSProperties = {
    height: 30, padding: '0 8px', width: '100%',
    fontFamily: MONO, fontSize: 12,
  }
  const fieldLabel: React.CSSProperties = { fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.1em', color: C.ink3, textTransform: 'uppercase', marginBottom: 3, display: 'block' }

  if (editing) {
    return (
      <td style={{ ...cellTd, background: C.surface2, verticalAlign: 'top' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
          <div>
            <span style={fieldLabel}>Temp °C</span>
            <input className="input" style={mini} type="number" autoFocus value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="180" />
          </div>
          <div>
            <span style={fieldLabel}>Soak min</span>
            <input className="input" style={mini} type="number" value={soak} onChange={(e) => setSoak(e.target.value)} placeholder="90" />
          </div>
          <div>
            <span style={fieldLabel}>Tol ±°C</span>
            <input className="input" style={mini} type="number" value={tolT} onChange={(e) => setTolT(e.target.value)} placeholder="5" />
          </div>
          <div>
            <span style={fieldLabel}>Tol ±min</span>
            <input className="input" style={mini} type="number" value={tolS} onChange={(e) => setTolS(e.target.value)} placeholder="5" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
          <button className="btn-primary" style={{ height: 28, padding: '0 10px', fontSize: 12 }} disabled={saving || temp === '' || soak === ''} onClick={commit}>
            <Check size={12} /> {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn-secondary" style={{ height: 28, padding: '0 10px', fontSize: 12 }} disabled={saving} onClick={() => setEditing(false)}>
            <X size={12} /> Cancel
          </button>
        </div>
      </td>
    )
  }

  const empty = !param || param.target_temp_c == null
  return (
    <td
      style={{
        ...cellTd,
        cursor: editable ? 'pointer' : 'default',
        verticalAlign: 'top',
      }}
      className={editable ? 'row-hover' : undefined}
      onClick={begin}
      title={editable ? 'Click to edit' : undefined}
    >
      {empty ? (
        <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink3 }}>
          {editable ? '+ set' : '—'}
        </span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Thermometer size={12} style={{ color: C.orange, flexShrink: 0 }} />
            <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', color: C.ink }}>{param!.target_temp_c}°C</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: C.ink3 }}>±{param!.tolerance_temp_c ?? 0}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Timer size={12} style={{ color: C.accent, flexShrink: 0 }} />
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: C.ink }}>{param!.target_soak_minutes} min</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: C.ink3 }}>±{param!.tolerance_soak_minutes ?? 0}</span>
          </div>
        </div>
      )}
    </td>
  )
}

const headTh: React.CSSProperties = {
  textAlign: 'left', padding: '12px 14px', fontFamily: MONO, fontSize: 10, fontWeight: 600,
  letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3,
  borderBottom: `1px solid ${C.line}`, verticalAlign: 'top',
}
const cellTd: React.CSSProperties = {
  padding: '12px 14px', borderBottom: `1px solid var(--surface-2)`, borderLeft: `1px solid var(--surface-2)`,
  fontSize: 12.5, color: C.ink, verticalAlign: 'middle', minWidth: 150,
}

/* ─── page ─────────────────────────────────────────────────────────────────── */
export default function Tempering() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isAdmin = user?.role === 'admin'
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const cyclesQ = useQuery<CycleType[]>({
    queryKey: ['cycles'],
    queryFn: () => cycleApi.list().then((r) => r.data),
  })

  const paramsQ = useQuery<ParamRow[]>({
    queryKey: ['tempering-params'],
    queryFn: () => temperingApi.parameters().then((r) => (Array.isArray(r.data) ? r.data : r.data?.items ?? [])),
    retry: false,
  })

  const upsert = useMutation({
    mutationFn: (data: Record<string, unknown>) => temperingApi.upsertParameter(data).then((r) => r.data),
    onMutate: (data) => setSavingKey(`${data.cycle_type_id}:${data.cycle_step_id}`),
    onSettled: () => setSavingKey(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tempering-params'] }),
  })

  const cycles = cyclesQ.data ?? []
  const params = paramsQ.data ?? []

  /* Discover the tempering steps from cycle definitions (union across cycles),
     ordered by step_order so the four temper columns line up. */
  const stepColumns = useMemo<TempStep[]>(() => {
    const m = new Map<string, TempStep & { order: number }>()
    for (const ct of cycles) {
      const steps = ct.current_version?.steps ?? []
      for (const s of steps) {
        if (!isTemperStep(s)) continue
        // Key by step_number so the same logical temper step (e.g. "9") collapses
        // into one column even though each cycle has its own step row id.
        const key = s.step_number
        if (!m.has(key)) {
          m.set(key, {
            cycle_step_id: s.id,
            step_number: s.step_number,
            operation_name: s.operation_name,
            order: s.step_order,
          })
        }
      }
    }
    return [...m.values()].sort((a, b) => a.order - b.order)
  }, [cycles])

  /* Per-cycle lookup of its own step id for a given step_number (ids differ per cycle). */
  const cycleStepId = useMemo(() => {
    const m = new Map<string, number>() // `${cycle_id}:${step_number}` → cycle_step_id
    for (const ct of cycles) {
      for (const s of ct.current_version?.steps ?? []) {
        if (isTemperStep(s)) m.set(`${ct.id}:${s.step_number}`, s.id)
      }
    }
    return m
  }, [cycles])

  /* Param lookup by cycle_type_id + cycle_step_id. */
  const paramByKey = useMemo(() => {
    const m = new Map<string, ParamRow>()
    for (const p of params) m.set(`${p.cycle_type_id}:${p.cycle_step_id}`, p)
    return m
  }, [params])

  const lastUpdated = useMemo(() => {
    const stamps = params.map((p) => p.updated_at).filter(Boolean) as string[]
    if (!stamps.length) return null
    return stamps.sort().slice(-1)[0]
  }, [params])

  const loading = cyclesQ.isLoading || paramsQ.isLoading
  const cycleRows = cycles.filter((c) => !c.is_archived)

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: C.ink, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Flame size={22} style={{ color: C.orange }} />
            Tempering Parameters
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, marginTop: 3 }}>
            Target temperatures, soak times &amp; deviation tolerances per cycle type · HT90 furnace
          </div>
        </div>
        <span style={{ ...pill, background: isAdmin ? 'rgba(34,160,107,.14)' : C.surface3, color: isAdmin ? '#1c7a52' : C.ink2, gap: 5 }}>
          <Lock size={11} /> {isAdmin ? 'Admin — editable' : 'Read only'}
        </span>
      </div>

      {/* error states */}
      {cyclesQ.isError && (
        <ErrorBanner>Could not load cycle definitions. The server may be starting up — refresh in a moment.</ErrorBanner>
      )}
      {paramsQ.isError && (
        <ErrorBanner>Tempering parameters are unavailable. This endpoint may not be deployed yet.</ErrorBanner>
      )}

      {/* matrix card */}
      <div className="card" style={{ padding: '18px 20px', marginBottom: 18 }}>
        <SectionLabel
          icon={<Thermometer size={13} style={{ color: C.ink3 }} />}
          right={
            lastUpdated ? (
              <span style={{ fontFamily: MONO, fontSize: 10, color: C.ink3, display: 'flex', alignItems: 'center', gap: 4 }}>
                <History size={11} /> Updated {format(new Date(lastUpdated), 'dd MMM yyyy HH:mm')}
              </span>
            ) : undefined
          }
        >
          Parameter Matrix — Rows: Cycle Type · Columns: Tempering Step
        </SectionLabel>

        {loading ? (
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.ink3, padding: '24px 4px' }}>Loading parameters…</div>
        ) : cycleRows.length === 0 ? (
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink3, padding: '24px 4px' }}>No cycle types configured.</div>
        ) : stepColumns.length === 0 ? (
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink3, padding: '24px 4px' }}>
            No tempering steps found in the current cycle definitions.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', margin: '0 -4px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 200 + stepColumns.length * 160 }}>
              <thead>
                <tr>
                  <th style={{ ...headTh, minWidth: 130 }}>Cycle</th>
                  {stepColumns.map((st, i) => (
                    <th key={st.step_number} style={{ ...headTh, borderLeft: `1px solid var(--surface-2)` }}>
                      <div style={{ color: C.ink, fontWeight: 700, fontSize: 11, letterSpacing: '0.06em' }}>
                        Tempering {i + 1}
                      </div>
                      <div style={{ color: C.ink3, marginTop: 3 }}>
                        Step {st.step_number}
                        {/stress relief/i.test(st.operation_name) ? ' · SR' : ''}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cycleRows.map((ct) => (
                  <tr key={ct.id}>
                    <td style={{ ...cellTd, borderLeft: 'none', minWidth: 130 }}>
                      <CycleBadge name={ct.name} />
                    </td>
                    {stepColumns.map((st) => {
                      const stepId = cycleStepId.get(`${ct.id}:${st.step_number}`)
                      // This cycle has no such temper step — render a non-editable blank.
                      if (stepId == null) {
                        return (
                          <td key={st.step_number} style={{ ...cellTd }}>
                            <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink3 }}>n/a</span>
                          </td>
                        )
                      }
                      const key = `${ct.id}:${stepId}`
                      return (
                        <ParamCell
                          key={st.step_number}
                          param={paramByKey.get(key)}
                          editable={isAdmin}
                          saving={savingKey === key}
                          onSave={(vals) =>
                            upsert.mutate({
                              cycle_type_id: ct.id,
                              cycle_step_id: stepId,
                              ...vals,
                            })
                          }
                        />
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {upsert.isError && (
          <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 11, color: C.red, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={13} /> Failed to save parameter. Try again.
          </div>
        )}
      </div>

      {/* legend / notes */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <SectionLabel icon={<Save size={13} style={{ color: C.ink3 }} />}>How parameters work</SectionLabel>
        <ul style={{ margin: 0, paddingLeft: 18, fontFamily: SANS, fontSize: 13, color: C.ink2, lineHeight: 1.7 }}>
          <li>
            Each cell holds the <strong>target temperature</strong> (°C) and <strong>soak time</strong> (minutes) for one tempering step, plus the
            <strong> ± tolerance</strong> bands that flag a furnace batch as deviating.
          </li>
          <li>All four tempering steps (Step 9, 10, 14, and 23 — Stress Relief) should be configured for every cycle type.</li>
          <li>
            {isAdmin
              ? 'Click any cell to edit. Saving creates a new parameter version with a timestamp; historical furnace batches keep the values active when they ran.'
              : 'Only Admins can edit these values. Changing a parameter creates a new timestamped version.'}
          </li>
        </ul>
      </div>
    </div>
  )
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: MONO, fontSize: 12, color: C.red,
        padding: '12px 16px', background: 'rgba(229,72,77,.10)',
        borderRadius: 10, border: '1px solid rgba(229,72,77,.25)', marginBottom: 18,
      }}
    >
      <AlertTriangle size={15} /> {children}
    </div>
  )
}
