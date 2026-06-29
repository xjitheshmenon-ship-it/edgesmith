import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { faridabadApi } from '../api/client'
import { Plus, X, Link2, ChevronDown, ChevronUp, Truck } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { useAuth } from '../hooks/useAuth'

// ── Shared style helpers ────────────────────────────────────────────────────────

const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"

// Admin-configurable in the real system; sensible defaults per spec.
const JOINING_METHODS = ['Flash Welding', 'Friction Welding', 'Other']

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: MONO,
  fontSize: 10,
  letterSpacing: '0.08em',
  color: 'var(--ink-3)',
  marginBottom: 4,
}

// Normalise a date that may be ISO ("2024-04-12") or already formatted.
function fmtDate(d?: string | null): string {
  if (!d) return '—'
  try {
    return format(parseISO(d), 'dd MMM yyyy')
  } catch {
    return d
  }
}

// Dimensions of an intake record — fall back across possible field names.
function intakeDims(i: any): string {
  return i?.bar_dimensions_mm || i?.dimensions_mm || ''
}

function statusBadgeClass(status?: string | null): string {
  const s = (status || '').toLowerCase()
  if (s.includes('partial')) return 'badge-orange'
  if (s.includes('dispatch')) return 'badge-green'
  return 'badge-blue'
}

function statusLabel(status?: string | null): string {
  if (!status) return 'Joined'
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ')
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function Joining() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const canWrite = user?.role === 'admin' || user?.role === 'manager'

  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)

  const intakesQ = useQuery({
    queryKey: ['far-intakes'],
    queryFn: () => faridabadApi.intakes().then((r) => r.data as any[]),
  })
  const joiningsQ = useQuery({
    queryKey: ['far-joinings'],
    queryFn: () => faridabadApi.joinings().then((r) => r.data as any[]),
  })

  const intakes = intakesQ.data || []
  const joinings = joiningsQ.data || []

  // Newest first — by join date then id.
  const sortedJoinings = [...joinings].sort((a, b) => {
    const da = a.date_joined || ''
    const db = b.date_joined || ''
    if (da !== db) return da < db ? 1 : -1
    return (b.id ?? 0) - (a.id ?? 0)
  })

  const totalBillets = joinings.reduce((sum, j) => sum + (j.num_billets_produced ?? 0), 0)

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, color: 'var(--ink)', letterSpacing: '-0.03em' }}>
            Joining Operation
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-2)', marginTop: 4, maxWidth: 620 }}>
            In-house welding of alloy steel and MS bars into composite billets at Faridabad. Each
            joining batch is one production run, linking both source heat numbers.
          </div>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className="btn-primary"
            style={{ gap: 6, flexShrink: 0 }}
          >
            {showForm ? <X size={13} /> : <Plus size={13} />}
            {showForm ? 'Cancel' : 'New joining batch'}
          </button>
        )}
      </div>

      {/* Summary tiles */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <StatTile value={joinings.length} label="Joining batches" />
        <StatTile value={totalBillets} label="Billets joined" color="var(--success)" />
        <StatTile
          value={intakes.filter((i) => i.material_type === 'Alloy Steel').length}
          label="Alloy intakes available"
        />
        <StatTile value={intakes.filter((i) => i.material_type === 'MS').length} label="MS intakes available" />
      </div>

      {/* Form */}
      {showForm && canWrite && (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <JoiningForm
            intakes={intakes}
            intakesLoading={intakesQ.isLoading}
            onDone={() => {
              setShowForm(false)
              qc.invalidateQueries({ queryKey: ['far-joinings'] })
              qc.invalidateQueries({ queryKey: ['far-intakes'] })
            }}
          />
        </div>
      )}

      {/* Joining batch log */}
      <SectionTitle>
        Joining batch log
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)', marginLeft: 8, letterSpacing: '0.08em' }}>
          {sortedJoinings.length} BATCH{sortedJoinings.length === 1 ? '' : 'ES'}
        </span>
      </SectionTitle>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="es-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <TH>BATCH REF</TH>
              <TH>DATE</TH>
              <TH>ALLOY HEAT NO</TH>
              <TH>MS HEAT NO</TH>
              <TH>BILLETS</TH>
              <TH>DIMENSIONS</TH>
              <TH>STATUS</TH>
            </tr>
          </thead>
          <tbody>
            {joiningsQ.isLoading && (
              <tr>
                <td colSpan={7} style={emptyCellStyle}>Loading…</td>
              </tr>
            )}
            {joiningsQ.isError && !joiningsQ.isLoading && (
              <tr>
                <td colSpan={7} style={{ ...emptyCellStyle, color: 'var(--error)' }}>
                  Failed to load joining batches
                </td>
              </tr>
            )}
            {!joiningsQ.isLoading &&
              !joiningsQ.isError &&
              sortedJoinings.map((j) => {
                const ref = j.batch_reference || `JOIN #${j.id}`
                const isOpen = expanded === j.id
                return (
                  <React.Fragment key={j.id}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : j.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <TD>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{ref}</span>
                        </span>
                      </TD>
                      <TD>{fmtDate(j.date_joined)}</TD>
                      <TD>
                        <span style={{ fontWeight: 700 }}>{j.alloy_heat_number || '—'}</span>
                        {j.alloy_supplier && (
                          <div style={{ color: 'var(--ink-3)', fontSize: 10 }}>{j.alloy_supplier}</div>
                        )}
                      </TD>
                      <TD>
                        <span style={{ fontWeight: 700 }}>{j.ms_heat_number || '—'}</span>
                        {j.ms_supplier && (
                          <div style={{ color: 'var(--ink-3)', fontSize: 10 }}>{j.ms_supplier}</div>
                        )}
                      </TD>
                      <TD>{j.num_billets_produced ?? '—'}</TD>
                      <TD>{j.output_billet_dimensions_mm || '—'}</TD>
                      <TD>
                        <span className={statusBadgeClass(j.status)}>{statusLabel(j.status)}</span>
                      </TD>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0, borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
                          <JoiningDetail j={j} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            {!joiningsQ.isLoading && !joiningsQ.isError && sortedJoinings.length === 0 && (
              <tr>
                <td colSpan={7} style={emptyCellStyle}>No joining batches recorded yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Joining batch detail (expanded row) ──────────────────────────────────────────

function JoiningDetail({ j }: { j: any }) {
  return (
    <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 18 }}>
      <DetailBlock title="ALLOY STEEL">
        <DetailRow label="Heat number" value={j.alloy_heat_number} />
        <DetailRow label="Supplier" value={j.alloy_supplier} />
        <DetailRow label="Grade" value={j.alloy_steel_grade || j.alloy_grade} />
      </DetailBlock>
      <DetailBlock title="MS">
        <DetailRow label="Heat number" value={j.ms_heat_number} />
        <DetailRow label="Supplier" value={j.ms_supplier} />
        <DetailRow label="Grade" value={j.ms_steel_grade || j.ms_grade} />
      </DetailBlock>
      <DetailBlock title="BATCH">
        <DetailRow label="Billet count" value={j.num_billets_produced} />
        <DetailRow label="Dimensions" value={j.output_billet_dimensions_mm} />
        <DetailRow label="Method" value={j.joining_method} />
        <DetailRow label="Operator" value={j.operator_name} />
        <DetailRow label="Date" value={fmtDate(j.date_joined)} />
      </DetailBlock>
      <DetailBlock title="DISPATCH HISTORY">
        <DispatchHistory j={j} />
      </DetailBlock>
    </div>
  )
}

function DispatchHistory({ j }: { j: any }) {
  // Dispatch history flows from the Contractor Dispatch page; surface it if the
  // joining record carries it, otherwise show a graceful placeholder.
  const dispatches: any[] = Array.isArray(j.dispatches) ? j.dispatches : []
  const dispatched = j.total_dispatched ?? j.num_billets_dispatched

  if (dispatches.length === 0) {
    return (
      <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-3)' }}>
        {dispatched != null ? (
          <span>{dispatched} billet{dispatched === 1 ? '' : 's'} dispatched</span>
        ) : (
          <span>No dispatches yet — tracked on Contractor Dispatch</span>
        )}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {dispatches.map((d, i) => (
        <div key={d.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 11, color: 'var(--ink-2)' }}>
          <Truck size={12} style={{ color: 'var(--accent)' }} />
          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{d.batch_reference || `#${d.id}`}</span>
          <span>· {d.rolling_contractor_name || '—'}</span>
          <span>· {d.num_billets_dispatched ?? '—'} billets</span>
          <span style={{ color: 'var(--ink-3)' }}>· {fmtDate(d.date_dispatched)}</span>
        </div>
      ))}
    </div>
  )
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{children}</div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-3)' }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--ink)', fontWeight: 500, textAlign: 'right' }}>
        {value === null || value === undefined || value === '' ? '—' : value}
      </span>
    </div>
  )
}

// ── Joining form ──────────────────────────────────────────────────────────────

function JoiningForm({
  intakes,
  intakesLoading,
  onDone,
}: {
  intakes: any[]
  intakesLoading: boolean
  onDone: () => void
}) {
  const [form, setForm] = useState({
    alloy_intake_id: '',
    ms_intake_id: '',
    num_billets_produced: '',
    output_billet_dimensions_mm: '',
    operator_name: '',
    date_joined: new Date().toISOString().slice(0, 10),
    joining_method: JOINING_METHODS[0],
    notes: '',
  })

  const alloyIntakes = intakes.filter((i) => i.material_type === 'Alloy Steel')
  const allMsIntakes = intakes.filter((i) => i.material_type === 'MS')

  const selectedAlloy = alloyIntakes.find((i) => String(i.id) === form.alloy_intake_id)
  const alloyDims = selectedAlloy ? intakeDims(selectedAlloy) : ''

  // Same-size bars only — only show MS intakes matching the alloy's dimensions.
  const msIntakes = alloyDims
    ? allMsIntakes.filter((i) => intakeDims(i) === alloyDims)
    : allMsIntakes

  const selectedMs = msIntakes.find((i) => String(i.id) === form.ms_intake_id)

  const set = (key: string, value: string) =>
    setForm((f) => {
      const next = { ...f, [key]: value }
      // Reset MS selection when alloy (and thus the allowed size) changes.
      if (key === 'alloy_intake_id') next.ms_intake_id = ''
      return next
    })

  const mut = useMutation({
    mutationFn: () =>
      faridabadApi.createJoining({
        alloy_intake_id: parseInt(form.alloy_intake_id),
        ms_intake_id: parseInt(form.ms_intake_id),
        num_billets_produced: parseInt(form.num_billets_produced),
        output_billet_dimensions_mm: form.output_billet_dimensions_mm || undefined,
        operator_name: form.operator_name || undefined,
        date_joined: form.date_joined,
        joining_method: form.joining_method || undefined,
        notes: form.notes || undefined,
      }),
    onSuccess: onDone,
  })

  const valid =
    !!form.alloy_intake_id &&
    !!form.ms_intake_id &&
    !!form.num_billets_produced &&
    parseInt(form.num_billets_produced) > 0 &&
    !!form.output_billet_dimensions_mm.trim() &&
    !!form.operator_name.trim()

  // Spec: dropdowns show supplier + heat number + dimensions.
  const intakeLabel = (i: any) =>
    `${i.supplier_name} — ${i.heat_number}${intakeDims(i) ? ` · ${intakeDims(i)}` : ''}`

  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-2)', marginBottom: 16, letterSpacing: '0.06em' }}>
        <Link2 size={12} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        NEW JOINING BATCH · FARIDABAD
      </div>

      {!intakesLoading && alloyIntakes.length === 0 && (
        <div style={{ fontFamily: SANS, color: 'var(--warning)', fontSize: 12, marginBottom: 12 }}>
          No alloy steel intakes available — record raw material intake first.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {/* Alloy steel intake */}
        <div>
          <label style={labelStyle}>ALLOY STEEL INTAKE *</label>
          <select className="input" value={form.alloy_intake_id} onChange={(e) => set('alloy_intake_id', e.target.value)}>
            <option value="">Select…</option>
            {alloyIntakes.map((i) => (
              <option key={i.id} value={i.id}>{intakeLabel(i)}</option>
            ))}
          </select>
        </div>

        {/* MS intake — filtered to matching dimensions */}
        <div>
          <label style={labelStyle}>
            MS INTAKE *
            {alloyDims && <span style={{ color: 'var(--ink-3)', marginLeft: 6 }}>(matching {alloyDims})</span>}
          </label>
          <select
            className="input"
            value={form.ms_intake_id}
            onChange={(e) => set('ms_intake_id', e.target.value)}
            disabled={!form.alloy_intake_id}
          >
            <option value="">{form.alloy_intake_id ? 'Select…' : 'Select alloy first'}</option>
            {msIntakes.map((i) => (
              <option key={i.id} value={i.id}>{intakeLabel(i)}</option>
            ))}
          </select>
          {form.alloy_intake_id && alloyDims && msIntakes.length === 0 && (
            <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>
              No MS intake matches these dimensions.
            </div>
          )}
        </div>

        {/* Billets */}
        <div>
          <label style={labelStyle}>BILLETS IN THIS RUN *</label>
          <input
            className="input"
            type="number"
            min={1}
            value={form.num_billets_produced}
            onChange={(e) => set('num_billets_produced', e.target.value)}
          />
        </div>

        {/* Output dimensions */}
        <div>
          <label style={labelStyle}>OUTPUT BILLET DIMENSIONS (MM) *</label>
          <input
            className="input"
            value={form.output_billet_dimensions_mm}
            onChange={(e) => set('output_billet_dimensions_mm', e.target.value)}
            placeholder={alloyDims || 'e.g. 50 × 50 × 3000'}
          />
        </div>

        {/* Joining method */}
        <div>
          <label style={labelStyle}>JOINING METHOD</label>
          <select className="input" value={form.joining_method} onChange={(e) => set('joining_method', e.target.value)}>
            {JOINING_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Operator */}
        <div>
          <label style={labelStyle}>OPERATOR NAME *</label>
          <input
            className="input"
            value={form.operator_name}
            onChange={(e) => set('operator_name', e.target.value)}
            placeholder="Operator name"
          />
        </div>

        {/* Date */}
        <div>
          <label style={labelStyle}>DATE *</label>
          <input
            className="input"
            type="date"
            value={form.date_joined}
            onChange={(e) => set('date_joined', e.target.value)}
          />
        </div>

        {/* Notes */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>NOTES (OPTIONAL)</label>
          <textarea
            className="input"
            style={{ minHeight: 56 }}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
      </div>

      {/* Heat-number link summary */}
      {selectedAlloy && selectedMs && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontFamily: MONO, fontSize: 11, color: 'var(--ink-2)' }}>
          <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{selectedAlloy.heat_number}</span>
          <Link2 size={13} style={{ color: 'var(--accent)' }} />
          <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{selectedMs.heat_number}</span>
        </div>
      )}

      <button
        className="btn-primary"
        style={{ marginTop: 16 }}
        onClick={() => mut.mutate()}
        disabled={mut.isPending || !valid}
      >
        {mut.isPending ? 'Saving…' : 'Save joining batch'}
      </button>
      {mut.isError && (
        <div style={{ color: 'var(--error)', fontFamily: SANS, fontSize: 12, marginTop: 8 }}>
          Failed to save joining batch
        </div>
      )}
    </div>
  )
}

// ── Small presentational pieces ─────────────────────────────────────────────────

function StatTile({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '14px 18px', minWidth: 0 }}>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 700, fontSize: 26, letterSpacing: '-0.03em', lineHeight: 1, color: color ?? 'var(--ink)' }}>
        {value}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 5 }}>
        {label}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: ARCHIVO,
        fontWeight: 700,
        fontSize: 14,
        color: 'var(--ink)',
        letterSpacing: '-0.01em',
        marginBottom: 10,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {children}
    </div>
  )
}

const TH = ({ children }: { children: React.ReactNode }) => (
  <th
    style={{
      fontFamily: MONO,
      fontSize: 10,
      letterSpacing: '0.1em',
      color: 'var(--ink-3)',
      textAlign: 'left',
      padding: '8px 12px',
      borderBottom: '1px solid var(--line)',
      fontWeight: 500,
    }}
  >
    {children}
  </th>
)

const TD = ({ children }: { children: React.ReactNode }) => (
  <td
    style={{
      fontFamily: MONO,
      fontSize: 12,
      color: 'var(--ink)',
      padding: '9px 12px',
      borderBottom: '1px solid var(--line)',
    }}
  >
    {children}
  </td>
)

const emptyCellStyle: React.CSSProperties = {
  textAlign: 'center',
  color: 'var(--ink-3)',
  padding: 24,
  fontFamily: MONO,
  fontSize: 11,
}
