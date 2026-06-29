import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { faridabadApi } from '../api/client'
import { Plus, X, PackageCheck } from 'lucide-react'
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
}

interface Receiving {
  id: number
  batch_reference?: string
  rolling_contractor_name?: string
  date_received: string
  num_billets_received: number
  condition?: string | null
  received_by?: string | null
  notes?: string | null
}

const CONDITIONS = ['Good', 'Minor damage noted', 'Significant damage']

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

function conditionBadgeClass(condition?: string | null): string {
  if (!condition) return 'badge-gray'
  const c = condition.toLowerCase()
  if (c.includes('significant')) return 'badge-red'
  if (c.includes('minor') || c.includes('damage')) return 'badge-yellow'
  return 'badge-green'
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function Receiving() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const canWrite = user?.role === 'admin' || user?.role === 'manager'

  const [showForm, setShowForm] = useState(false)
  const [prefillId, setPrefillId] = useState<number | null>(null)

  const dispatchesQ = useQuery({
    queryKey: ['far-dispatches'],
    queryFn: () => faridabadApi.dispatches().then((r) => r.data as Dispatch[]),
  })
  const receivingsQ = useQuery({
    queryKey: ['far-receivings'],
    queryFn: () => faridabadApi.receivings().then((r) => r.data as Receiving[]),
  })

  const dispatches = dispatchesQ.data || []
  const receivings = receivingsQ.data || []

  const expected = dispatches.filter((d) => (d.total_received ?? 0) < d.num_billets_dispatched)

  const openForm = (dispatchId?: number) => {
    setPrefillId(dispatchId ?? null)
    setShowForm(true)
  }
  const closeForm = () => {
    setShowForm(false)
    setPrefillId(null)
  }

  // Newest first — sort receivings by date received then id.
  const sortedReceivings = [...receivings].sort((a, b) => {
    if (a.date_received !== b.date_received) return a.date_received < b.date_received ? 1 : -1
    return b.id - a.id
  })

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 22, color: 'var(--ink)', letterSpacing: '-0.03em' }}>
            Receiving
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-2)', marginTop: 4, maxWidth: 560 }}>
            Log arrivals of rolled composite billets from rolling contractors at Dharmapuri. One
            Faridabad dispatch can arrive across multiple receiving events.
          </div>
        </div>
        {canWrite && (
          <button
            onClick={() => (showForm ? closeForm() : openForm())}
            className="btn-primary"
            style={{ gap: 6, flexShrink: 0 }}
          >
            {showForm ? <X size={13} /> : <Plus size={13} />}
            {showForm ? 'Cancel' : 'Record receiving event'}
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && canWrite && (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <ReceivingForm
            dispatches={dispatches}
            prefillId={prefillId}
            onDone={() => {
              closeForm()
              qc.invalidateQueries({ queryKey: ['far-receivings'] })
              qc.invalidateQueries({ queryKey: ['far-dispatches'] })
            }}
          />
        </div>
      )}

      {/* Expected arrivals / in-transit */}
      <SectionTitle>
        Expected arrivals
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)', marginLeft: 8, letterSpacing: '0.08em' }}>
          IN TRANSIT · {expected.length}
        </span>
      </SectionTitle>
      <div className="card" style={{ overflow: 'hidden', marginBottom: 28 }}>
        <table className="es-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <TH>DISPATCH DATE</TH>
              <TH>CONTRACTOR</TH>
              <TH>BATCH REF</TH>
              <TH>DISPATCHED</TH>
              <TH>RECEIVED SO FAR</TH>
              <TH>REMAINING</TH>
              {canWrite && <TH>{''}</TH>}
            </tr>
          </thead>
          <tbody>
            {dispatchesQ.isLoading && (
              <tr>
                <td colSpan={canWrite ? 7 : 6} style={emptyCellStyle}>Loading…</td>
              </tr>
            )}
            {!dispatchesQ.isLoading &&
              expected.map((d) => {
                const remaining = d.num_billets_dispatched - (d.total_received ?? 0)
                return (
                  <tr
                    key={d.id}
                    onClick={canWrite ? () => openForm(d.id) : undefined}
                    style={{ cursor: canWrite ? 'pointer' : 'default' }}
                  >
                    <TD>{d.date_dispatched}</TD>
                    <TD>{d.rolling_contractor_name}</TD>
                    <TD>
                      <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{d.batch_reference}</span>
                    </TD>
                    <TD>{d.num_billets_dispatched}</TD>
                    <TD>
                      {d.total_received ?? 0}
                      {(d.receiving_count ?? 0) > 0 && (
                        <span style={{ color: 'var(--ink-3)', fontSize: 10 }}> · {d.receiving_count} run{d.receiving_count === 1 ? '' : 's'}</span>
                      )}
                    </TD>
                    <TD>
                      <span className="badge-orange">{remaining} remaining</span>
                    </TD>
                    {canWrite && (
                      <TD>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em' }}>
                          <PackageCheck size={12} /> RECEIVE
                        </span>
                      </TD>
                    )}
                  </tr>
                )
              })}
            {!dispatchesQ.isLoading && expected.length === 0 && (
              <tr>
                <td colSpan={canWrite ? 7 : 6} style={emptyCellStyle}>
                  No consignments in transit — everything dispatched has been received
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Receiving log */}
      <SectionTitle>
        Receiving log
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)', marginLeft: 8, letterSpacing: '0.08em' }}>
          {sortedReceivings.length} EVENT{sortedReceivings.length === 1 ? '' : 'S'}
        </span>
      </SectionTitle>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="es-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <TH>DATE RECEIVED</TH>
              <TH>BATCH REF</TH>
              <TH>CONTRACTOR</TH>
              <TH>BILLETS RECEIVED</TH>
              <TH>CONDITION</TH>
              <TH>RECEIVED BY</TH>
            </tr>
          </thead>
          <tbody>
            {receivingsQ.isLoading && (
              <tr>
                <td colSpan={6} style={emptyCellStyle}>Loading…</td>
              </tr>
            )}
            {!receivingsQ.isLoading &&
              sortedReceivings.map((r) => (
                <tr key={r.id}>
                  <TD>{r.date_received}</TD>
                  <TD>
                    <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{r.batch_reference || '—'}</span>
                  </TD>
                  <TD>{r.rolling_contractor_name || '—'}</TD>
                  <TD>{r.num_billets_received}</TD>
                  <TD>
                    <span className={conditionBadgeClass(r.condition)}>{r.condition || 'Good'}</span>
                  </TD>
                  <TD>{r.received_by || '—'}</TD>
                </tr>
              ))}
            {!receivingsQ.isLoading && sortedReceivings.length === 0 && (
              <tr>
                <td colSpan={6} style={emptyCellStyle}>No receiving events recorded yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Receiving form ──────────────────────────────────────────────────────────────

function ReceivingForm({
  dispatches,
  prefillId,
  onDone,
}: {
  dispatches: Dispatch[]
  prefillId: number | null
  onDone: () => void
}) {
  const [form, setForm] = useState({
    faridabad_dispatch_id: prefillId ? String(prefillId) : '',
    date_received: new Date().toISOString().slice(0, 10),
    num_billets_received: '',
    condition: 'Good',
    received_by: '',
    notes: '',
  })

  const selected = dispatches.find((d) => String(d.id) === form.faridabad_dispatch_id)
  const remaining = selected ? selected.num_billets_dispatched - (selected.total_received ?? 0) : null
  const damageRequiresNotes =
    form.condition === 'Minor damage noted' || form.condition === 'Significant damage'

  const mut = useMutation({
    mutationFn: () =>
      faridabadApi.createReceiving({
        faridabad_dispatch_id: parseInt(form.faridabad_dispatch_id),
        date_received: form.date_received,
        num_billets_received: parseInt(form.num_billets_received),
        condition: form.condition || undefined,
        received_by: form.received_by || undefined,
        notes: form.notes || undefined,
      }),
    onSuccess: onDone,
  })

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const valid =
    !!form.faridabad_dispatch_id &&
    !!form.date_received &&
    !!form.num_billets_received &&
    parseInt(form.num_billets_received) > 0 &&
    !!form.received_by &&
    (!damageRequiresNotes || !!form.notes.trim())

  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-2)', marginBottom: 16, letterSpacing: '0.06em' }}>
        NEW RECEIVING EVENT · DHARMAPURI
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {/* Dispatch */}
        <div>
          <label style={labelStyle}>FARIDABAD DISPATCH</label>
          <select
            className="input"
            value={form.faridabad_dispatch_id}
            onChange={(e) => set('faridabad_dispatch_id', e.target.value)}
          >
            <option value="">Select…</option>
            {dispatches.map((d) => {
              const rem = d.num_billets_dispatched - (d.total_received ?? 0)
              return (
                <option key={d.id} value={d.id}>
                  {d.batch_reference} — {d.rolling_contractor_name} ({rem} remaining)
                </option>
              )
            })}
          </select>
        </div>

        {/* Contractor (auto) */}
        <div>
          <label style={labelStyle}>ROLLING CONTRACTOR</label>
          <input
            className="input"
            value={selected ? selected.rolling_contractor_name : ''}
            readOnly
            placeholder="Auto-filled from dispatch"
          />
        </div>

        {/* Date */}
        <div>
          <label style={labelStyle}>DATE RECEIVED *</label>
          <input
            className="input"
            type="date"
            value={form.date_received}
            onChange={(e) => set('date_received', e.target.value)}
          />
        </div>

        {/* Billets */}
        <div>
          <label style={labelStyle}>
            BILLETS IN THIS DELIVERY *
            {remaining != null && (
              <span style={{ color: 'var(--ink-3)', marginLeft: 6 }}>({remaining} remaining)</span>
            )}
          </label>
          <input
            className="input"
            type="number"
            min={1}
            value={form.num_billets_received}
            onChange={(e) => set('num_billets_received', e.target.value)}
          />
        </div>

        {/* Condition */}
        <div>
          <label style={labelStyle}>CONDITION ON ARRIVAL</label>
          <select className="input" value={form.condition} onChange={(e) => set('condition', e.target.value)}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Received by */}
        <div>
          <label style={labelStyle}>RECEIVED BY *</label>
          <input
            className="input"
            value={form.received_by}
            onChange={(e) => set('received_by', e.target.value)}
            placeholder="Operator name"
          />
        </div>

        {/* Notes */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>
            NOTES{damageRequiresNotes ? ' * (required when damage noted)' : ' (optional)'}
          </label>
          <textarea
            className="input"
            style={{ minHeight: 56 }}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
      </div>

      {remaining != null && parseInt(form.num_billets_received || '0') > remaining && (
        <div style={{ fontFamily: SANS, color: 'var(--warning)', fontSize: 12, marginTop: 10 }}>
          Heads up: receiving {form.num_billets_received} exceeds the {remaining} still in transit for this dispatch.
        </div>
      )}

      <button
        className="btn-primary"
        style={{ marginTop: 16 }}
        onClick={() => mut.mutate()}
        disabled={mut.isPending || !valid}
      >
        {mut.isPending ? 'Saving…' : 'Save receiving event'}
      </button>
      {mut.isError && (
        <div style={{ color: 'var(--error)', fontFamily: SANS, fontSize: 12, marginTop: 8 }}>
          Failed to save receiving event
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
