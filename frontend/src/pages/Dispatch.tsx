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
  billet_dimensions_mm?: string | null
  notes?: string | null
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
              <TH>JOINING BATCH</TH>
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
                    <TD>{d.joining_operation_id != null ? `#${d.joining_operation_id}` : '—'}</TD>
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

  const [form, setForm] = useState({
    joining_operation_id: '',
    rolling_contractor_name: '',
    num_billets_dispatched: '',
    date_dispatched: new Date().toISOString().slice(0, 10),
    expected_delivery_date: '',
    dispatch_reference: '',
    billet_dimensions_mm: '',
    notes: '',
  })

  const selected = joinings.find((j) => String(j.id) === form.joining_operation_id)

  const set = (key: string, value: string) =>
    setForm((f) => {
      const next = { ...f, [key]: value }
      // Auto-fill billet count + dimensions from the selected joining batch.
      if (key === 'joining_operation_id') {
        const j = joinings.find((x) => String(x.id) === value)
        if (j) {
          if (!f.num_billets_dispatched) next.num_billets_dispatched = String(j.num_billets_produced)
          if (!f.billet_dimensions_mm && j.output_billet_dimensions_mm)
            next.billet_dimensions_mm = j.output_billet_dimensions_mm
        }
      }
      return next
    })

  const mut = useMutation({
    mutationFn: () =>
      faridabadApi.createDispatch({
        joining_operation_id: parseInt(form.joining_operation_id),
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
  const available = selected ? selected.num_billets_produced : null
  const partial = available != null && billets > 0 && billets < available

  const valid =
    !!form.joining_operation_id &&
    !!form.rolling_contractor_name &&
    !!form.num_billets_dispatched &&
    billets > 0 &&
    !!form.date_dispatched

  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-2)', marginBottom: 16, letterSpacing: '0.06em' }}>
        NEW DISPATCH TO ROLLING CONTRACTOR
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {/* Joining batch */}
        <div>
          <label style={labelStyle}>JOINING BATCH *</label>
          <select
            className="input"
            value={form.joining_operation_id}
            onChange={(e) => set('joining_operation_id', e.target.value)}
          >
            <option value="">Select…</option>
            {joinings.map((j) => (
              <option key={j.id} value={j.id}>
                #{j.id} — {j.date_joined} ({j.num_billets_produced} billets)
              </option>
            ))}
          </select>
        </div>

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
            onChange={(e) => set('num_billets_dispatched', e.target.value)}
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
          Partial dispatch: sending {billets} of {available} billets from batch #{selected!.id}.
        </div>
      )}
      {available != null && billets > available && (
        <div style={{ fontFamily: SANS, color: 'var(--warning)', fontSize: 12, marginTop: 10 }}>
          Heads up: {billets} exceeds the {available} billets produced in batch #{selected!.id}.
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
