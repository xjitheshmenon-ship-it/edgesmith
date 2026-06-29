import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { faridabadApi } from '../api/client'
import { Plus, X, Truck, Calendar } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { useAuth } from '../hooks/useAuth'

// ── Types (loose — shapes mirror the Faridabad endpoints) ───────────────────────

interface Dispatch {
  id: number
  batch_reference: string
  rolling_contractor_name: string
  num_billets_dispatched: number
  total_received: number
  receiving_count: number
  date_dispatched: string
  expected_delivery_date?: string | null
  dispatch_reference?: string | null
  joining_operation_id?: number | null
  joining_operation_ids?: number[] | null
  billet_dimensions_mm?: string | null
  notes?: string | null
}

// Joining batch reference(s) for a dispatch — supports single or multi-batch.
function joiningRefs(d: Dispatch): string {
  const ids = d.joining_operation_ids && d.joining_operation_ids.length
    ? d.joining_operation_ids
    : d.joining_operation_id != null
      ? [d.joining_operation_id]
      : []
  return ids.length ? ids.map((id) => `#${id}`).join(', ') : '—'
}

interface Joining {
  id: number
  date_joined: string
  num_billets_produced: number
  alloy_heat_number?: string | null
  ms_heat_number?: string | null
  output_billet_dimensions_mm?: string | null
}

interface Contractor {
  id: number
  name: string
}

// ── Shared style helpers ────────────────────────────────────────────────────────

const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: MONO,
  fontSize: 10,
  letterSpacing: '0.08em',
  color: 'var(--ink-3)',
  marginBottom: 4,
}

// Safe date formatting — fall back to the raw string if it isn't ISO parseable.
function fmtDate(d?: string | null): string {
  if (!d) return '—'
  try {
    return format(parseISO(d), 'dd MMM yyyy')
  } catch {
    return d
  }
}

// Received status per spec: pending / partially received / fully received.
function receivedStatus(d: Dispatch): { label: string; cls: string } {
  const received = d.total_received ?? 0
  const dispatched = d.num_billets_dispatched ?? 0
  if (dispatched > 0 && received >= dispatched) return { label: 'Fully received', cls: 'badge-green' }
  if (received > 0) return { label: 'Partially received', cls: 'badge-yellow' }
  return { label: 'Pending', cls: 'badge-orange' }
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function Dispatch() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const canWrite = user?.role === 'admin' || user?.role === 'manager'

  const [showForm, setShowForm] = useState(false)

  const dispatchesQ = useQuery({
    queryKey: ['far-dispatches'],
    queryFn: () => faridabadApi.dispatches().then((r) => r.data as Dispatch[]),
  })
  const joiningsQ = useQuery({
    queryKey: ['far-joinings'],
    queryFn: () => faridabadApi.joinings().then((r) => r.data as Joining[]),
  })

  const dispatches = dispatchesQ.data || []
  const joinings = joiningsQ.data || []

  // In-transit / pending: not yet fully received at Dharmapuri.
  const pending = dispatches.filter((d) => (d.total_received ?? 0) < (d.num_billets_dispatched ?? 0))

  // Newest first — sort by dispatch date then id.
  const sorted = [...dispatches].sort((a, b) => {
    if (a.date_dispatched !== b.date_dispatched) return a.date_dispatched < b.date_dispatched ? 1 : -1
    return b.id - a.id
  })

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 22, color: 'var(--ink)', letterSpacing: '-0.03em' }}>
            Contractor Dispatch
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-2)', marginTop: 4, maxWidth: 600 }}>
            Send joined composite billets out to the rolling contractor — the last Faridabad operation.
            After dispatch the material travels to Dharmapuri, where it appears on the Receiving page as
            an expected incoming consignment.
          </div>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className="btn-primary"
            style={{ gap: 6, flexShrink: 0 }}
          >
            {showForm ? <X size={13} /> : <Plus size={13} />}
            {showForm ? 'Cancel' : 'Create dispatch'}
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && canWrite && (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <DispatchForm
            joinings={joinings}
            onDone={() => {
              setShowForm(false)
              qc.invalidateQueries({ queryKey: ['far-dispatches'] })
              qc.invalidateQueries({ queryKey: ['far-joinings'] })
            }}
          />
        </div>
      )}

      {/* In-transit / pending dispatches */}
      <SectionTitle>
        In transit
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)', marginLeft: 8, letterSpacing: '0.08em' }}>
          AWAITING RECEIPT · {pending.length}
        </span>
      </SectionTitle>
      <div className="card" style={{ overflow: 'hidden', marginBottom: 28 }}>
        <table className="es-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <TH>DISPATCH DATE</TH>
              <TH>BATCH REF</TH>
              <TH>CONTRACTOR</TH>
              <TH>BILLETS</TH>
              <TH>EXPECTED AT DHARMAPURI</TH>
              <TH>RECEIVED SO FAR</TH>
              <TH>STATUS</TH>
            </tr>
          </thead>
          <tbody>
            {dispatchesQ.isLoading && (
              <tr>
                <td colSpan={7} style={emptyCellStyle}>Loading…</td>
              </tr>
            )}
            {dispatchesQ.isError && !dispatchesQ.isLoading && (
              <tr>
                <td colSpan={7} style={{ ...emptyCellStyle, color: 'var(--error)' }}>
                  Failed to load dispatches
                </td>
              </tr>
            )}
            {!dispatchesQ.isLoading && !dispatchesQ.isError &&
              pending.map((d) => {
                const st = receivedStatus(d)
                return (
                  <tr key={d.id}>
                    <TD>{fmtDate(d.date_dispatched)}</TD>
                    <TD>
                      <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{d.batch_reference || `#${d.id}`}</span>
                    </TD>
                    <TD>{d.rolling_contractor_name || '—'}</TD>
                    <TD>{d.num_billets_dispatched}</TD>
                    <TD>{d.expected_delivery_date ? fmtDate(d.expected_delivery_date) : '—'}</TD>
                    <TD>
                      {d.total_received ?? 0} / {d.num_billets_dispatched}
                      {(d.receiving_count ?? 0) > 0 && (
                        <span style={{ color: 'var(--ink-3)', fontSize: 10 }}> · {d.receiving_count} run{d.receiving_count === 1 ? '' : 's'}</span>
                      )}
                    </TD>
                    <TD>
                      <span className={st.cls}>{st.label}</span>
                    </TD>
                  </tr>
                )
              })}
            {!dispatchesQ.isLoading && !dispatchesQ.isError && pending.length === 0 && (
              <tr>
                <td colSpan={7} style={emptyCellStyle}>
                  Nothing in transit — every dispatch has been fully received at Dharmapuri
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Dispatch log */}
      <SectionTitle>
        Dispatch log
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)', marginLeft: 8, letterSpacing: '0.08em' }}>
          {sorted.length} DISPATCH{sorted.length === 1 ? '' : 'ES'}
        </span>
      </SectionTitle>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="es-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <TH>DATE DISPATCHED</TH>
              <TH>BATCH REF</TH>
              <TH>CONTRACTOR</TH>
              <TH>JOINING BATCH REFS</TH>
              <TH>BILLETS</TH>
              <TH>EXPECTED AT DHARMAPURI</TH>
              <TH>RECEIVED STATUS</TH>
            </tr>
          </thead>
          <tbody>
            {dispatchesQ.isLoading && (
              <tr>
                <td colSpan={7} style={emptyCellStyle}>Loading…</td>
              </tr>
            )}
            {dispatchesQ.isError && !dispatchesQ.isLoading && (
              <tr>
                <td colSpan={7} style={{ ...emptyCellStyle, color: 'var(--error)' }}>
                  Failed to load dispatches
                </td>
              </tr>
            )}
            {!dispatchesQ.isLoading && !dispatchesQ.isError &&
              sorted.map((d) => {
                const st = receivedStatus(d)
                return (
                  <tr key={d.id}>
                    <TD>{fmtDate(d.date_dispatched)}</TD>
                    <TD>
                      <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{d.batch_reference || `#${d.id}`}</span>
                    </TD>
                    <TD>{d.rolling_contractor_name || '—'}</TD>
                    <TD>{joiningRefs(d)}</TD>
                    <TD>{d.num_billets_dispatched}</TD>
                    <TD>{d.expected_delivery_date ? fmtDate(d.expected_delivery_date) : '—'}</TD>
                    <TD>
                      <span className={st.cls}>{st.label}</span>
                      {(d.total_received ?? 0) > 0 && (
                        <span style={{ color: 'var(--ink-3)', fontSize: 10, marginLeft: 6 }}>
                          {d.total_received}/{d.num_billets_dispatched}
                        </span>
                      )}
                    </TD>
                  </tr>
                )
              })}
            {!dispatchesQ.isLoading && !dispatchesQ.isError && sorted.length === 0 && (
              <tr>
                <td colSpan={7} style={emptyCellStyle}>No dispatches recorded yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Dispatch form ─────────────────────────────────────────────────────────────

function DispatchForm({ joinings, onDone }: { joinings: Joining[]; onDone: () => void }) {
  const contractorsQ = useQuery({
    queryKey: ['contractors'],
    queryFn: () => faridabadApi.contractors().then((r) => r.data as Contractor[]),
  })
  const contractors = contractorsQ.data || []

  // Multi-select joining batches per spec (one or more batches per dispatch).
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [billetsTouched, setBilletsTouched] = useState(false)

  const [form, setForm] = useState({
    rolling_contractor_name: '',
    num_billets_dispatched: '',
    date_dispatched: new Date().toISOString().slice(0, 10),
    expected_delivery_date: '',
    dispatch_reference: '',
    billet_dimensions_mm: '',
    notes: '',
  })

  const selectedBatches = joinings.filter((j) => selectedIds.includes(j.id))
  // Total billets available across the selected joining batches.
  const available = selectedBatches.length
    ? selectedBatches.reduce((sum, j) => sum + (j.num_billets_produced ?? 0), 0)
    : null

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  // Toggle a joining batch in/out of the selection, auto-filling billet count
  // (sum across batches) and dimensions until the user edits them by hand.
  const toggleBatch = (id: number) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      const batches = joinings.filter((j) => next.includes(j.id))
      const total = batches.reduce((sum, j) => sum + (j.num_billets_produced ?? 0), 0)
      setForm((f) => {
        const upd = { ...f }
        if (!billetsTouched) upd.num_billets_dispatched = next.length ? String(total) : ''
        if (!f.billet_dimensions_mm) {
          const dim = batches.find((j) => j.output_billet_dimensions_mm)?.output_billet_dimensions_mm
          if (dim) upd.billet_dimensions_mm = dim
        }
        return upd
      })
      return next
    })
  }

  const mut = useMutation({
    mutationFn: () =>
      faridabadApi.createDispatch({
        // Send both the array (spec: multi-batch) and a primary id for backend
        // shapes that key off a single joining_operation_id.
        joining_operation_ids: selectedIds,
        joining_operation_id: selectedIds[0],
        rolling_contractor_name: form.rolling_contractor_name,
        num_billets_dispatched: parseInt(form.num_billets_dispatched),
        date_dispatched: form.date_dispatched,
        // Optional fields — only send when populated so unsupported keys stay absent.
        ...(form.expected_delivery_date ? { expected_delivery_date: form.expected_delivery_date } : {}),
        ...(form.dispatch_reference ? { dispatch_reference: form.dispatch_reference } : {}),
        ...(form.billet_dimensions_mm ? { billet_dimensions_mm: form.billet_dimensions_mm } : {}),
        ...(form.notes ? { notes: form.notes } : {}),
      }),
    onSuccess: onDone,
  })

  const billets = parseInt(form.num_billets_dispatched || '0')
  const partial = available != null && billets > 0 && billets < available

  const valid =
    selectedIds.length > 0 &&
    !!form.rolling_contractor_name &&
    !!form.num_billets_dispatched &&
    billets > 0 &&
    !!form.date_dispatched

  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-2)', marginBottom: 16, letterSpacing: '0.06em' }}>
        NEW DISPATCH TO ROLLING CONTRACTOR
      </div>
      {/* Joining batches — multi-select (one or more per dispatch) */}
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>
          JOINING BATCH(ES) *
          {selectedIds.length > 0 && (
            <span style={{ color: 'var(--ink-3)', marginLeft: 6 }}>({selectedIds.length} selected)</span>
          )}
        </label>
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 6,
            maxHeight: 168,
            overflowY: 'auto',
            background: 'var(--surface)',
          }}
        >
          {joinings.length === 0 && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-3)', padding: '10px 12px' }}>
              No joining batches available
            </div>
          )}
          {joinings.map((j) => {
            const checked = selectedIds.includes(j.id)
            return (
              <label
                key={j.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 12px',
                  borderBottom: '1px solid var(--line)',
                  cursor: 'pointer',
                  fontFamily: MONO,
                  fontSize: 12,
                  color: 'var(--ink)',
                  background: checked ? 'var(--surface-3)' : 'transparent',
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggleBatch(j.id)} />
                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>#{j.id}</span>
                <span>{fmtDate(j.date_joined)}</span>
                <span style={{ color: 'var(--ink-3)' }}>· {j.num_billets_produced} billets</span>
                {j.output_billet_dimensions_mm && (
                  <span style={{ color: 'var(--ink-3)' }}>· {j.output_billet_dimensions_mm}mm</span>
                )}
              </label>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {/* Contractor */}
        <div>
          <label style={labelStyle}>ROLLING CONTRACTOR *</label>
          {contractors.length > 0 ? (
            <select
              className="input"
              value={form.rolling_contractor_name}
              onChange={(e) => set('rolling_contractor_name', e.target.value)}
            >
              <option value="">Select contractor…</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              value={form.rolling_contractor_name}
              onChange={(e) => set('rolling_contractor_name', e.target.value)}
              placeholder="Add contractors in Config first"
            />
          )}
        </div>

        {/* Billets */}
        <div>
          <label style={labelStyle}>
            BILLETS IN THIS DISPATCH *
            {available != null && (
              <span style={{ color: 'var(--ink-3)', marginLeft: 6 }}>({available} available)</span>
            )}
          </label>
          <input
            className="input"
            type="number"
            min={1}
            value={form.num_billets_dispatched}
            onChange={(e) => {
              setBilletsTouched(true)
              set('num_billets_dispatched', e.target.value)
            }}
          />
        </div>

        {/* Date dispatched */}
        <div>
          <label style={labelStyle}>DATE DISPATCHED *</label>
          <input
            className="input"
            type="date"
            value={form.date_dispatched}
            onChange={(e) => set('date_dispatched', e.target.value)}
          />
        </div>

        {/* Expected delivery */}
        <div>
          <label style={labelStyle}>EXPECTED AT DHARMAPURI</label>
          <input
            className="input"
            type="date"
            value={form.expected_delivery_date}
            onChange={(e) => set('expected_delivery_date', e.target.value)}
          />
        </div>

        {/* Dispatch reference / challan */}
        <div>
          <label style={labelStyle}>DISPATCH REF / CHALLAN NO</label>
          <input
            className="input"
            value={form.dispatch_reference}
            onChange={(e) => set('dispatch_reference', e.target.value)}
            placeholder="Optional"
          />
        </div>

        {/* Billet dimensions */}
        <div>
          <label style={labelStyle}>BILLET DIMENSIONS (MM)</label>
          <input
            className="input"
            value={form.billet_dimensions_mm}
            onChange={(e) => set('billet_dimensions_mm', e.target.value)}
            placeholder="Auto-filled from batch"
          />
        </div>

        {/* Notes */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>NOTES (optional)</label>
          <textarea
            className="input"
            style={{ minHeight: 56 }}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
      </div>

      {partial && (
        <div style={{ fontFamily: SANS, color: 'var(--warning)', fontSize: 12, marginTop: 10 }}>
          Partial dispatch: sending {billets} of {available} billets available across the selected
          {selectedIds.length === 1 ? ' batch' : ` ${selectedIds.length} batches`}.
        </div>
      )}
      {available != null && billets > available && (
        <div style={{ fontFamily: SANS, color: 'var(--warning)', fontSize: 12, marginTop: 10 }}>
          Heads up: {billets} exceeds the {available} billets available across the selected
          {selectedIds.length === 1 ? ' batch' : ` ${selectedIds.length} batches`}.
        </div>
      )}

      <button
        className="btn-primary"
        style={{ marginTop: 16 }}
        onClick={() => mut.mutate()}
        disabled={mut.isPending || !valid}
      >
        <Truck size={14} />
        {mut.isPending ? 'Saving…' : 'Save dispatch'}
      </button>
      {mut.isError && (
        <div style={{ color: 'var(--error)', fontFamily: SANS, fontSize: 12, marginTop: 8 }}>
          Failed to save dispatch
        </div>
      )}
    </div>
  )
}

// ── Small presentational pieces ─────────────────────────────────────────────────

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
      <Calendar size={13} style={{ color: 'var(--ink-3)', marginRight: 6 }} />
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
