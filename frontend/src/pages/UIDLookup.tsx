import { useState, useMemo, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Search,
  XCircle,
  ArrowRight,
  ChevronRight,
  Flame,
  Scissors,
  CheckCircle2,
  Clock,
  Package,
  History,
  Layers,
  ScanLine,
  Lock,
} from 'lucide-react'
import { format } from 'date-fns'
import { uidApi } from '../api/client'
import type { UID, StepHistory } from '../types'
import UIDStatusBadge from '../components/UIDStatusBadge'
import PriorityBadge from '../components/PriorityBadge'

const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"

// Tempering steps use the furnace (HT90/HT70/HT80) — flagged distinctly.
const TEMPERING_STEPS = new Set(['6', '7', '9', '10', '14', '23'])

const CYCLE_BADGE: Record<string, string> = {
  EAT: 'badge-blue',
  SWAN: 'badge-green',
  OVEN: 'badge-orange',
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 14,
  boxShadow: 'var(--shadow-e1)',
  padding: 20,
}

// ── Cycle-type badge ─────────────────────────────────────────────────────────
function CycleBadge({ name }: { name?: string | null }) {
  if (!name) return null
  const cls = CYCLE_BADGE[name.toUpperCase()] ?? 'badge-blue'
  return <span className={cls}>{name}</span>
}

// ── Small section label ──────────────────────────────────────────────────────
function SectionLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      {icon}
      <span
        style={{
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
        }}
      >
        {children}
      </span>
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

// ── Result card ──────────────────────────────────────────────────────────────
function ResultCard({ uid }: { uid: UID }) {
  const navigate = useNavigate()

  const history = useMemo<StepHistory[]>(() => {
    const h = uid.step_history ?? []
    return [...h].sort(
      (a, b) => new Date(a.performed_at).getTime() - new Date(b.performed_at).getTime()
    )
  }, [uid])

  const finalQc = useMemo<StepHistory | null>(() => {
    // Step 26 is final QC per the cycle definition; fall back to last QC step seen.
    const byStep = history.find((h) => h.step_number === '26' && h.qc_result)
    if (byStep) return byStep
    const withQc = [...history].reverse().find((h) => h.qc_result)
    return withQc ?? null
  }, [history])

  // Every step that logged a QC result during production — the intermediate QC trail.
  const intermediateQc = useMemo<StepHistory[]>(
    () => history.filter((h) => h.qc_result && h !== finalQc),
    [history, finalQc]
  )

  const hasOrigin =
    uid.alloy_supplier ||
    uid.alloy_grade ||
    uid.alloy_heat_number ||
    uid.ms_supplier ||
    uid.ms_grade ||
    uid.ms_heat_number ||
    uid.rolling_contractor ||
    uid.faridabad_dispatch_id != null

  const dispatched = uid.status === 'dispatched'

  // No explicit dispatch-date field on the UID record; the dispatch step's timestamp
  // is the closest available signal (last step performed once status is dispatched).
  const dispatchedAt = dispatched && history.length > 0 ? history[history.length - 1].performed_at : null

  // Customer name lives on the linked MO, not on the UID payload — surface the MO
  // number as the available reference until an MO-customer field is exposed here.
  const customerName: string | null = null

  return (
    <div className="animate-es" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── PRODUCT SUMMARY ───────────────────────────────────────────────── */}
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

          <button
            type="button"
            className="btn-primary"
            onClick={() => navigate(`/uid/${uid.code}`)}
          >
            View full detail
            <ArrowRight size={15} />
          </button>
        </div>

        <div style={{ height: 1, background: 'var(--line)', margin: '18px 0' }} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 18 }}>
          <Attr
            label="PRODUCT TYPE"
            value={uid.product_type_id != null ? `Type #${uid.product_type_id}` : '—'}
          />
          <Attr label="SIZE" value={uid.size_mm ? `${uid.size_mm} mm` : '—'} />
          <Attr
            label="DESIGN"
            value={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: MONO }}>{uid.design_code ?? 'No design'}</span>
                {uid.design_code &&
                  (uid.design_confirmed ? (
                    <span className="badge-green" style={{ fontSize: 9.5 }}>Confirmed</span>
                  ) : (
                    <span className="badge-yellow" style={{ fontSize: 9.5 }}>Pending</span>
                  ))}
              </span>
            }
          />
          <Attr label="CYCLE TYPE" value={uid.cycle_type_name ?? '—'} />
          <Attr
            label="STATUS"
            value={
              dispatched
                ? 'Dispatched'
                : uid.current_step_number
                  ? `In production — Step ${uid.current_step_number}${uid.current_step_name ? ` · ${uid.current_step_name}` : ''}`
                  : 'In production'
            }
          />
          <Attr
            label="DATE OF DISPATCH"
            value={
              dispatched
                ? dispatchedAt
                  ? format(new Date(dispatchedAt), 'dd MMM yyyy, HH:mm')
                  : 'Dispatched'
                : 'Not dispatched'
            }
          />
          <Attr
            label="MO NUMBER"
            value={uid.mo_number ? <span style={{ fontFamily: MONO }}>{uid.mo_number}</span> : '—'}
          />
          <Attr label="CUSTOMER" value={customerName ?? '—'} />
          <Attr label="CREATED" value={format(new Date(uid.created_at), 'dd MMM yyyy, HH:mm')} />
        </div>
      </div>

      {/* ── MATERIAL ORIGIN ───────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <SectionLabel icon={<Layers size={13} style={{ color: 'var(--ink-3)' }} />}>Material Origin</SectionLabel>
        {hasOrigin ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 18 }}>
            <Attr
              label="FARIDABAD BATCH REF"
              value={
                uid.faridabad_dispatch_id != null ? (
                  <span style={{ fontFamily: MONO }}>FB-{uid.faridabad_dispatch_id}</span>
                ) : (
                  '—'
                )
              }
            />
            <Attr label="ALLOY SUPPLIER" value={uid.alloy_supplier ?? '—'} />
            <Attr label="ALLOY GRADE" value={uid.alloy_grade ?? '—'} />
            <Attr label="ALLOY HEAT NUMBER" value={<span style={{ fontFamily: MONO }}>{uid.alloy_heat_number ?? '—'}</span>} />
            <Attr label="MS SUPPLIER" value={uid.ms_supplier ?? '—'} />
            <Attr label="MS GRADE" value={uid.ms_grade ?? '—'} />
            <Attr label="MS HEAT NUMBER" value={<span style={{ fontFamily: MONO }}>{uid.ms_heat_number ?? '—'}</span>} />
            <Attr label="ROLLING CONTRACTOR" value={uid.rolling_contractor ?? '—'} />
            <Attr label="FARIDABAD DISPATCH DATE" value="—" />
            <Attr label="RECEIVED AT DHARMAPURI" value={uid.receiving_event_id != null ? `Event #${uid.receiving_event_id}` : '—'} />
          </div>
        ) : (
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-3)' }}>No material origin recorded for this UID.</div>
        )}
      </div>

      {/* ── QC SUMMARY ────────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <SectionLabel icon={<CheckCircle2 size={13} style={{ color: 'var(--ink-3)' }} />}>QC Summary</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3)' }}>FINAL QC (STEP 26)</span>
          {finalQc ? (
            <>
              <QcChip result={finalQc.qc_result} />
              {fmtQcValues(finalQc.qc_values) && (
                <span style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2)' }}>{fmtQcValues(finalQc.qc_values)}</span>
              )}
            </>
          ) : (
            <span style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-3)' }}>Not yet recorded.</span>
          )}
        </div>

        {/* Intermediate QC measurements logged during production */}
        <div style={{ height: 1, background: 'var(--line)', margin: '16px 0' }} />
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3)', marginBottom: 10 }}>
          INTERMEDIATE QC ({intermediateQc.length})
        </div>
        {intermediateQc.length === 0 ? (
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-3)' }}>No intermediate QC measurements logged.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {intermediateQc.map((h) => {
              const vals = fmtQcValues(h.qc_values)
              return (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-3)', minWidth: 56 }}>
                    Step {h.step_number}
                  </span>
                  <QcChip result={h.qc_result} />
                  <span style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2)' }}>
                    {h.operation_name}
                    {vals ? ` · ${vals}` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ marginTop: 14, fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-3)', letterSpacing: '0.06em' }}>
          Furnace-batch deviation flags require dedicated tempering-batch endpoints (not yet available).
        </div>
      </div>

      {/* ── FAMILY RECORD ─────────────────────────────────────────────────── */}
      {(uid.parent_uid_code || uid.children.length > 0) && (
        <div style={cardStyle}>
          <SectionLabel icon={<Scissors size={13} style={{ color: 'var(--ink-3)' }} />}>Family Record</SectionLabel>

          {uid.parent_uid_code && (
            <div style={{ marginBottom: uid.children.length > 0 ? 18 : 0 }}>
              <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3)', marginBottom: 8 }}>PARENT UID (CONVERTED FROM)</div>
              <button
                type="button"
                onClick={() => navigate(`/uid/${uid.parent_uid_code}`)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: '6px 12px',
                  background: 'var(--surface)',
                  cursor: 'pointer',
                  fontFamily: MONO,
                  fontSize: 13,
                  color: 'var(--ink)',
                }}
              >
                {uid.parent_uid_code}
                <ChevronRight size={13} style={{ color: 'var(--ink-3)' }} />
              </button>
            </div>
          )}

          {uid.children.length > 0 && (
            <div>
              <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3)', marginBottom: 8 }}>
                CHILD UIDS ({uid.children.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {uid.children.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => navigate(`/uid/${c.code}`)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      padding: '6px 12px',
                      background: 'var(--surface)',
                      cursor: 'pointer',
                      fontFamily: MONO,
                      fontSize: 13,
                      color: 'var(--ink)',
                    }}
                  >
                    <Scissors size={12} style={{ color: 'var(--warning)' }} />
                    {c.code}
                    <UIDStatusBadge status={c.status} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── PRODUCTION HISTORY ────────────────────────────────────────────── */}
      <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '18px 20px 12px' }}>
          <SectionLabel icon={<History size={13} style={{ color: 'var(--ink-3)' }} />}>
            Production History ({history.length})
          </SectionLabel>
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
        <div style={{ padding: '12px 20px', fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-3)', letterSpacing: '0.06em', borderTop: '1px solid var(--line)' }}>
          Step duration & furnace target/actual parameters require dedicated endpoints (not yet available).
        </div>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function UIDLookup() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')

  const {
    data: uid,
    isLoading,
    isError,
    error,
    isFetching,
  } = useQuery<UID>({
    queryKey: ['service-lookup', query],
    queryFn: () => uidApi.lookup(query).then((r) => r.data),
    enabled: query.length > 0,
    retry: false,
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const code = input.trim()
    if (code) setQuery(code)
  }

  const notFound = (error as { response?: { status?: number } } | undefined)?.response?.status === 404

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--ink)' }}>
            Service Call Lookup
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-2)', marginTop: 3 }}>
            Enter a UID stamped on a product to retrieve its full manufacturing and material history. One field, one search.
          </div>
        </div>
        <span
          className="badge-gray"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          title="This record is read-only. Nothing can be modified from this page."
        >
          <Lock size={11} />
          Read-only
        </span>
      </div>

      {/* ── SEARCH BAR ─────────────────────────────────────────────────────── */}
      <div style={{ ...cardStyle, padding: 22, marginBottom: 22 }}>
        <form onSubmit={onSubmit} style={{ display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
            <Search
              size={18}
              style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}
            />
            <input
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter UID code…"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              style={{
                height: 52,
                paddingLeft: 44,
                fontFamily: MONO,
                fontSize: 18,
                letterSpacing: '0.04em',
              }}
            />
          </div>
          <button type="submit" className="btn-primary" style={{ height: 52, padding: '0 24px', fontSize: 14 }} disabled={!input.trim()}>
            <Search size={16} />
            Search
          </button>
        </form>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-3)', letterSpacing: '0.06em' }}>
          <ScanLine size={12} />
          Barcode / QR scan requires camera hardware integration (not yet available) — type or paste the UID code.
        </div>
      </div>

      {/* ── RESULTS ────────────────────────────────────────────────────────── */}
      {!query && (
        <div
          style={{
            ...cardStyle,
            padding: '48px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: 'var(--accent-dim)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Package size={26} />
          </div>
          <div style={{ fontFamily: SANS, fontSize: 14, color: 'var(--ink-2)', maxWidth: 420 }}>
            Search by UID code to view a bar's full identity, current status, material origin, and service history.
          </div>
        </div>
      )}

      {query && isLoading && (
        <div style={{ ...cardStyle, padding: '40px 24px', fontFamily: SANS, fontSize: 14, color: 'var(--ink-2)', textAlign: 'center' }}>
          Looking up {query}…
        </div>
      )}

      {query && !isLoading && (isError || !uid) && (
        <div style={{ ...cardStyle, padding: '32px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <XCircle size={18} style={{ color: 'var(--error)', flexShrink: 0 }} />
          <div style={{ fontFamily: SANS, fontSize: 14, color: 'var(--ink)' }}>
            {notFound ? (
              <>
                No UID found for <span style={{ fontFamily: MONO, fontWeight: 600 }}>{query}</span>. Check the code and try again.
              </>
            ) : (
              'Lookup failed. The server may be starting up — try again in a moment.'
            )}
          </div>
        </div>
      )}

      {query && !isLoading && !isError && uid && (
        <>
          {isFetching && (
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.06em', marginBottom: 10 }}>
              Refreshing…
            </div>
          )}
          <ResultCard uid={uid} />
        </>
      )}
    </div>
  )
}
