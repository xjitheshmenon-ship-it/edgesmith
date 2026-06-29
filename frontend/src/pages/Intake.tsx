import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { faridabadApi } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import { Plus, X, Package, FileText, Search } from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'

// ── Types (loose — shapes mirror the Faridabad intake endpoint) ─────────────────

interface Intake {
  id: number
  material_type: string
  supplier_name: string
  heat_number: string
  steel_grade: string
  weight_kg?: number | null
  num_bars?: number | null
  bar_dimensions_mm?: string | null
  date_received: string
  po_reference?: string | null
  status?: string | null
  notes?: string | null
}

const MATERIAL_TYPES = ['Alloy Steel', 'MS']

// Material-type accent colours (mirror Faridabad page intent, light-theme safe).
const MATERIAL_BADGE: Record<string, string> = {
  'Alloy Steel': 'badge-blue',
  MS: 'badge-green',
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
  textTransform: 'uppercase',
}

function statusBadgeClass(status?: string | null): string {
  const s = (status || '').toLowerCase()
  if (s.includes('archiv')) return 'badge-gray'
  if (s.includes('used')) return 'badge-gray'
  if (s.includes('joining')) return 'badge-yellow'
  if (s.includes('avail')) return 'badge-green'
  return 'badge-green'
}

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const d = v.length <= 10 ? parseISO(v) : new Date(v)
  return isValid(d) ? format(d, 'dd MMM yyyy') : v
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function Intake() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const canWrite = user?.role === 'admin' || user?.role === 'manager'

  const [showForm, setShowForm] = useState(false)
  const [detail, setDetail] = useState<Intake | null>(null)

  // Filters
  const [fMaterial, setFMaterial] = useState('')
  const [fSupplier, setFSupplier] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')

  const intakesQ = useQuery({
    queryKey: ['far-intakes'],
    queryFn: () => faridabadApi.intakes().then((r) => r.data as Intake[]),
  })

  const intakes = intakesQ.data || []

  // Distinct suppliers/statuses for filter dropdowns (derived from data).
  const suppliers = useMemo(
    () => Array.from(new Set(intakes.map((i) => i.supplier_name).filter(Boolean))).sort(),
    [intakes]
  )
  const statuses = useMemo(
    () => Array.from(new Set(intakes.map((i) => i.status).filter(Boolean) as string[])).sort(),
    [intakes]
  )

  const filtered = useMemo(() => {
    return intakes
      .filter((i) => (fMaterial ? i.material_type === fMaterial : true))
      .filter((i) => (fSupplier ? i.supplier_name === fSupplier : true))
      .filter((i) => (fStatus ? (i.status || '') === fStatus : true))
      .filter((i) => (fFrom ? i.date_received >= fFrom : true))
      .filter((i) => (fTo ? i.date_received <= fTo : true))
      .sort((a, b) => {
        if (a.date_received !== b.date_received) return a.date_received < b.date_received ? 1 : -1
        return b.id - a.id
      })
  }, [intakes, fMaterial, fSupplier, fStatus, fFrom, fTo])

  const hasFilters = !!(fMaterial || fSupplier || fStatus || fFrom || fTo)
  const clearFilters = () => {
    setFMaterial('')
    setFSupplier('')
    setFStatus('')
    setFFrom('')
    setFTo('')
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 22, color: 'var(--ink)', letterSpacing: '-0.03em' }}>
            Raw Material Intake
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-2)', marginTop: 4, maxWidth: 620 }}>
            Log incoming alloy steel and MS bar consignments at Faridabad. Each delivery is recorded
            with full material traceability — heat number, grade, weight and bar count — before any
            joining begins.
          </div>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className="btn-primary"
            style={{ gap: 6, flexShrink: 0 }}
          >
            {showForm ? <X size={13} /> : <Plus size={13} />}
            {showForm ? 'Cancel' : 'Record intake'}
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && canWrite && (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <IntakeForm
            onDone={() => {
              setShowForm(false)
              qc.invalidateQueries({ queryKey: ['far-intakes'] })
            }}
          />
        </div>
      )}

      {/* Filters */}
      <SectionTitle>
        Intake log
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)', marginLeft: 8, letterSpacing: '0.08em' }}>
          {filtered.length} RECORD{filtered.length === 1 ? '' : 'S'}
          {hasFilters && intakes.length !== filtered.length ? ` · OF ${intakes.length}` : ''}
        </span>
      </SectionTitle>

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ minWidth: 150 }}>
            <label style={labelStyle}>Material type</label>
            <select className="input" value={fMaterial} onChange={(e) => setFMaterial(e.target.value)}>
              <option value="">All</option>
              {MATERIAL_TYPES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 170 }}>
            <label style={labelStyle}>Supplier</label>
            <select className="input" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)}>
              <option value="">All</option>
              {suppliers.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 150 }}>
            <label style={labelStyle}>Status</label>
            <select
              className="input"
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}
              disabled={statuses.length === 0}
            >
              <option value="">All</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={labelStyle}>From date</label>
            <input className="input" type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={labelStyle}>To date</label>
            <input className="input" type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
          </div>
          {hasFilters && (
            <button className="btn-secondary" onClick={clearFilters} style={{ height: 36 }}>
              <X size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="es-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <TH>DATE</TH>
              <TH>MATERIAL</TH>
              <TH>SUPPLIER</TH>
              <TH>HEAT NUMBER</TH>
              <TH>GRADE</TH>
              <TH>WEIGHT (KG)</TH>
              <TH>BARS</TH>
              <TH>DIMENSIONS</TH>
              <TH>STATUS</TH>
            </tr>
          </thead>
          <tbody>
            {intakesQ.isLoading && (
              <tr>
                <td colSpan={9} style={emptyCellStyle}>Loading…</td>
              </tr>
            )}
            {intakesQ.isError && !intakesQ.isLoading && (
              <tr>
                <td colSpan={9} style={{ ...emptyCellStyle, color: 'var(--error)' }}>
                  Failed to load intake records
                </td>
              </tr>
            )}
            {!intakesQ.isLoading && !intakesQ.isError &&
              filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setDetail(r)}
                  style={{ cursor: 'pointer' }}
                >
                  <TD>{fmtDate(r.date_received)}</TD>
                  <TD>
                    <span className={MATERIAL_BADGE[r.material_type] || 'badge-gray'}>
                      {r.material_type}
                    </span>
                  </TD>
                  <TD>{r.supplier_name || '—'}</TD>
                  <TD>
                    <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{r.heat_number || '—'}</span>
                  </TD>
                  <TD>{r.steel_grade || '—'}</TD>
                  <TD>{r.weight_kg ?? '—'}</TD>
                  <TD>{r.num_bars ?? '—'}</TD>
                  <TD>{r.bar_dimensions_mm || '—'}</TD>
                  <TD>
                    {r.status
                      ? <span className={statusBadgeClass(r.status)}>{r.status}</span>
                      : <span className="badge-green">available</span>}
                  </TD>
                </tr>
              ))}
            {!intakesQ.isLoading && !intakesQ.isError && filtered.length === 0 && (
              <tr>
                <td colSpan={9} style={emptyCellStyle}>
                  {hasFilters ? 'No intake records match the current filters' : 'No intake records yet'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && <IntakeDetail intake={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

// ── Intake form ───────────────────────────────────────────────────────────────

function IntakeForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    material_type: 'Alloy Steel',
    supplier_name: '',
    heat_number: '',
    steel_grade: '',
    weight_kg: '',
    num_bars: '',
    bar_dimensions_mm: '',
    date_received: new Date().toISOString().slice(0, 10),
    po_reference: '',
    notes: '',
  })

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const mut = useMutation({
    mutationFn: () =>
      faridabadApi.createIntake({
        material_type: form.material_type,
        supplier_name: form.supplier_name,
        heat_number: form.heat_number,
        steel_grade: form.steel_grade,
        weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
        num_bars: form.num_bars ? parseInt(form.num_bars) : null,
        bar_dimensions_mm: form.bar_dimensions_mm || null,
        date_received: form.date_received,
        po_reference: form.po_reference || null,
        notes: form.notes || null,
      }),
    onSuccess: onDone,
  })

  const valid =
    !!form.material_type &&
    !!form.supplier_name.trim() &&
    !!form.heat_number.trim() &&
    !!form.steel_grade.trim() &&
    !!form.weight_kg &&
    parseFloat(form.weight_kg) > 0 &&
    !!form.num_bars &&
    parseInt(form.num_bars) > 0 &&
    !!form.bar_dimensions_mm.trim() &&
    !!form.date_received

  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-2)', marginBottom: 16, letterSpacing: '0.06em' }}>
        NEW RAW MATERIAL INTAKE · FARIDABAD
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {/* Material type */}
        <div>
          <label style={labelStyle}>Material type *</label>
          <select className="input" value={form.material_type} onChange={(e) => set('material_type', e.target.value)}>
            {MATERIAL_TYPES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Supplier — free text (no dedicated supplier endpoint available) */}
        <div>
          <label style={labelStyle}>Supplier name *</label>
          <input
            className="input"
            value={form.supplier_name}
            onChange={(e) => set('supplier_name', e.target.value)}
            placeholder="Supplier"
          />
        </div>

        {/* Heat number */}
        <div>
          <label style={labelStyle}>Heat number *</label>
          <input
            className="input"
            value={form.heat_number}
            onChange={(e) => set('heat_number', e.target.value)}
            placeholder="From material test certificate"
          />
        </div>

        {/* Steel grade */}
        <div>
          <label style={labelStyle}>Steel grade *</label>
          <input
            className="input"
            value={form.steel_grade}
            onChange={(e) => set('steel_grade', e.target.value)}
            placeholder="e.g. EN8, 20MnCr5"
          />
        </div>

        {/* Weight */}
        <div>
          <label style={labelStyle}>Weight received (kg) *</label>
          <input
            className="input"
            type="number"
            min={0}
            value={form.weight_kg}
            onChange={(e) => set('weight_kg', e.target.value)}
          />
        </div>

        {/* Bars */}
        <div>
          <label style={labelStyle}>Number of bars *</label>
          <input
            className="input"
            type="number"
            min={1}
            value={form.num_bars}
            onChange={(e) => set('num_bars', e.target.value)}
          />
        </div>

        {/* Dimensions */}
        <div>
          <label style={labelStyle}>Bar dimensions (mm) *</label>
          <input
            className="input"
            value={form.bar_dimensions_mm}
            onChange={(e) => set('bar_dimensions_mm', e.target.value)}
            placeholder="Diameter or cross-section"
          />
        </div>

        {/* Date received */}
        <div>
          <label style={labelStyle}>Date received *</label>
          <input
            className="input"
            type="date"
            value={form.date_received}
            onChange={(e) => set('date_received', e.target.value)}
          />
        </div>

        {/* PO reference */}
        <div>
          <label style={labelStyle}>PO reference (optional)</label>
          <input
            className="input"
            value={form.po_reference}
            onChange={(e) => set('po_reference', e.target.value)}
            placeholder="Links to Odoo PO"
          />
        </div>

        {/* Notes */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Notes (optional)</label>
          <textarea
            className="input"
            style={{ minHeight: 56 }}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 12,
          fontFamily: MONO,
          fontSize: 10.5,
          color: 'var(--ink-3)',
          letterSpacing: '0.04em',
        }}
      >
        <FileText size={13} />
        Material test certificate upload is not available in this build — record the heat number above for traceability.
      </div>

      <button
        className="btn-primary"
        style={{ marginTop: 16 }}
        onClick={() => mut.mutate()}
        disabled={mut.isPending || !valid}
      >
        {mut.isPending ? 'Saving…' : 'Save intake'}
      </button>
      {mut.isError && (
        <div style={{ color: 'var(--error)', fontFamily: SANS, fontSize: 12, marginTop: 8 }}>
          Failed to save intake record
        </div>
      )}
    </div>
  )
}

// ── Intake detail drawer ────────────────────────────────────────────────────────

function IntakeDetail({ intake, onClose }: { intake: Intake; onClose: () => void }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Material type', value: intake.material_type },
    { label: 'Supplier', value: intake.supplier_name || '—' },
    { label: 'Heat number', value: intake.heat_number || '—' },
    { label: 'Steel grade', value: intake.steel_grade || '—' },
    { label: 'Weight (kg)', value: intake.weight_kg ?? '—' },
    { label: 'Number of bars', value: intake.num_bars ?? '—' },
    { label: 'Bar dimensions', value: intake.bar_dimensions_mm || '—' },
    { label: 'Date received', value: fmtDate(intake.date_received) },
    { label: 'PO reference', value: intake.po_reference || '—' },
    { label: 'Status', value: intake.status || 'available' },
    { label: 'Notes', value: intake.notes || '—' },
  ]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(21,54,106,.28)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 50,
      }}
    >
      <div
        className="animate-es"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: '92vw',
          height: '100%',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--line)',
          boxShadow: 'var(--shadow-e5)',
          padding: 24,
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Package size={18} style={{ color: 'var(--accent)' }} />
            <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, color: 'var(--ink)', letterSpacing: '-0.02em' }}>
              Intake #{intake.id}
            </span>
          </div>
          <button
            onClick={onClose}
            className="btn-secondary"
            style={{ height: 30, padding: '0 10px' }}
          >
            <X size={14} /> Close
          </button>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.1em', marginBottom: 18 }}>
          RAW MATERIAL TRACEABILITY
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {rows.map((r) => (
            <div
              key={r.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 16,
                padding: '10px 0',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>
                {r.label}
              </span>
              <span style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink)', textAlign: 'right' }}>
                {r.value}
              </span>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: SANS,
            fontSize: 12,
            color: 'var(--ink-2)',
          }}
        >
          <Search size={13} style={{ color: 'var(--ink-3)' }} />
          Selectable on the Joining Operation page when building a billet batch.
        </div>
      </div>
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
