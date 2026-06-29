import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { faridabadApi } from '../api/client'
import { Plus, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

type Tab = 'intakes' | 'joinings' | 'dispatches' | 'receivings'

const LABEL: Record<string, string> = {
  'Alloy Steel': 'ALLOY STEEL',
  'MS': 'MS',
}

const LABEL_COLOR: Record<string, string> = {
  'Alloy Steel': '#c4b5fd',
  'MS': '#6ee7b7',
}

export default function Faridabad() {
  const [tab, setTab] = useState<Tab>('intakes')
  const [showForm, setShowForm] = useState(false)
  const qc = useQueryClient()
  const { user } = useAuth()
  const canWrite = user?.role === 'admin' || user?.role === 'manager'

  const intakes = useQuery({ queryKey: ['far-intakes'], queryFn: () => faridabadApi.intakes().then(r => r.data) })
  const joinings = useQuery({ queryKey: ['far-joinings'], queryFn: () => faridabadApi.joinings().then(r => r.data) })
  const dispatches = useQuery({ queryKey: ['far-dispatches'], queryFn: () => faridabadApi.dispatches().then(r => r.data) })
  const receivings = useQuery({ queryKey: ['far-receivings'], queryFn: () => faridabadApi.receivings().then(r => r.data) })

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 22, color: 'var(--ink)', letterSpacing: '-0.03em' }}>
          Faridabad
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.1em', marginTop: 4 }}>
          RAW MATERIAL INTAKE · JOINING · DISPATCH · RECEIVING
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {(['intakes', 'joinings', 'dispatches', 'receivings'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setShowForm(false) }}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10.5,
              letterSpacing: '0.08em',
              background: tab === t ? 'var(--accent)' : 'var(--surface-2)',
              color: tab === t ? 'var(--accent-ink)' : 'var(--ink-2)',
              fontWeight: tab === t ? 700 : 400,
            }}
          >
            {t.toUpperCase()}
          </button>
        ))}
        {canWrite && (
          <button
            onClick={() => setShowForm(s => !s)}
            className="btn-primary"
            style={{ marginLeft: 'auto', gap: 6 }}
          >
            {showForm ? <X size={13} /> : <Plus size={13} />}
            {showForm ? 'Cancel' : `Add ${tab.slice(0, -1)}`}
          </button>
        )}
      </div>

      {showForm && canWrite && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          {tab === 'intakes' && (
            <IntakeForm onDone={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['far-intakes'] }) }} />
          )}
          {tab === 'joinings' && (
            <JoiningForm intakes={intakes.data || []} onDone={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['far-joinings'] }) }} />
          )}
          {tab === 'dispatches' && (
            <DispatchForm joinings={joinings.data || []} onDone={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['far-dispatches'] }) }} />
          )}
          {tab === 'receivings' && (
            <ReceivingForm dispatches={dispatches.data || []} onDone={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['far-receivings'] }) }} />
          )}
        </div>
      )}

      {tab === 'intakes' && <IntakesTable data={intakes.data || []} loading={intakes.isLoading} />}
      {tab === 'joinings' && <JoiningsTable data={joinings.data || []} loading={joinings.isLoading} />}
      {tab === 'dispatches' && <DispatchesTable data={dispatches.data || []} loading={dispatches.isLoading} />}
      {tab === 'receivings' && <ReceivingsTable data={receivings.data || []} loading={receivings.isLoading} />}
    </div>
  )
}

// ── Intake Form ───────────────────────────────────────────────────────────────

function IntakeForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    material_type: 'Alloy Steel',
    supplier_name: '',
    heat_number: '',
    steel_grade: '',
    weight_kg: '',
    date_received: new Date().toISOString().slice(0, 10),
    num_bars: '',
    bar_dimensions_mm: '',
    notes: '',
  })
  const mut = useMutation({
    mutationFn: () => faridabadApi.createIntake({
      ...form,
      weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
      num_bars: form.num_bars ? parseInt(form.num_bars) : null,
    }),
    onSuccess: onDone,
  })

  const field = (label: string, key: string, type = 'text', opts?: string[]) => (
    <div>
      <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>{label}</label>
      {opts ? (
        <select className="input" value={(form as Record<string, string>)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}>
          {opts.map(o => <option key={o}>{o}</option>)}
        </select>
      ) : (
        <input className="input" type={type} value={(form as Record<string, string>)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
      )}
    </div>
  )

  return (
    <div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)', marginBottom: 16, letterSpacing: '0.06em' }}>NEW RAW MATERIAL INTAKE</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {field('MATERIAL TYPE', 'material_type', 'text', ['Alloy Steel', 'MS'])}
        {field('SUPPLIER NAME', 'supplier_name')}
        {field('HEAT NUMBER', 'heat_number')}
        {field('STEEL GRADE', 'steel_grade')}
        {field('DATE RECEIVED', 'date_received', 'date')}
        {field('WEIGHT (KG)', 'weight_kg', 'number')}
        {field('NUM BARS', 'num_bars', 'number')}
        {field('BAR DIMENSIONS (MM)', 'bar_dimensions_mm')}
        {field('NOTES', 'notes')}
      </div>
      <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => mut.mutate()} disabled={mut.isPending || !form.supplier_name || !form.heat_number || !form.steel_grade}>
        {mut.isPending ? 'Saving…' : 'Save Intake'}
      </button>
      {mut.isError && <div style={{ color: 'var(--error)', fontSize: 12, marginTop: 8 }}>Failed to save</div>}
    </div>
  )
}

// ── Joining Form ──────────────────────────────────────────────────────────────

function JoiningForm({ intakes, onDone }: { intakes: any[]; onDone: () => void }) {
  const alloyIntakes = intakes.filter((i: any) => i.material_type === 'Alloy Steel')
  const msIntakes = intakes.filter((i: any) => i.material_type === 'MS')
  const [form, setForm] = useState({
    alloy_intake_id: '',
    ms_intake_id: '',
    num_billets_produced: '',
    output_billet_dimensions_mm: '',
    operator_name: '',
    date_joined: new Date().toISOString().slice(0, 10),
    notes: '',
  })
  const mut = useMutation({
    mutationFn: () => faridabadApi.createJoining({
      ...form,
      alloy_intake_id: parseInt(form.alloy_intake_id),
      ms_intake_id: parseInt(form.ms_intake_id),
      num_billets_produced: parseInt(form.num_billets_produced),
    }),
    onSuccess: onDone,
  })

  return (
    <div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)', marginBottom: 16, letterSpacing: '0.06em' }}>NEW JOINING OPERATION</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>ALLOY STEEL INTAKE</label>
          <select className="input" value={form.alloy_intake_id} onChange={e => setForm(f => ({ ...f, alloy_intake_id: e.target.value }))}>
            <option value="">Select…</option>
            {alloyIntakes.map((i: any) => <option key={i.id} value={i.id}>{i.heat_number} — {i.supplier_name} ({i.date_received})</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>MS INTAKE</label>
          <select className="input" value={form.ms_intake_id} onChange={e => setForm(f => ({ ...f, ms_intake_id: e.target.value }))}>
            <option value="">Select…</option>
            {msIntakes.map((i: any) => <option key={i.id} value={i.id}>{i.heat_number} — {i.supplier_name} ({i.date_received})</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>BILLETS PRODUCED</label>
          <input className="input" type="number" value={form.num_billets_produced} onChange={e => setForm(f => ({ ...f, num_billets_produced: e.target.value }))} />
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>BILLET DIMENSIONS (MM)</label>
          <input className="input" value={form.output_billet_dimensions_mm} onChange={e => setForm(f => ({ ...f, output_billet_dimensions_mm: e.target.value }))} />
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>OPERATOR</label>
          <input className="input" value={form.operator_name} onChange={e => setForm(f => ({ ...f, operator_name: e.target.value }))} />
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>DATE</label>
          <input className="input" type="date" value={form.date_joined} onChange={e => setForm(f => ({ ...f, date_joined: e.target.value }))} />
        </div>
      </div>
      <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => mut.mutate()} disabled={mut.isPending || !form.alloy_intake_id || !form.ms_intake_id || !form.num_billets_produced}>
        {mut.isPending ? 'Saving…' : 'Save Joining'}
      </button>
    </div>
  )
}

// ── Dispatch Form ─────────────────────────────────────────────────────────────

function DispatchForm({ joinings, onDone }: { joinings: any[]; onDone: () => void }) {
  const { data: contractors = [] } = useQuery({ queryKey: ['contractors'], queryFn: () => faridabadApi.contractors().then(r => r.data) })
  const [form, setForm] = useState({
    joining_operation_id: '',
    rolling_contractor_name: '',
    num_billets_dispatched: '',
    date_dispatched: new Date().toISOString().slice(0, 10),
    billet_dimensions_mm: '',
    notes: '',
  })
  const mut = useMutation({
    mutationFn: () => faridabadApi.createDispatch({
      ...form,
      joining_operation_id: parseInt(form.joining_operation_id),
      num_billets_dispatched: parseInt(form.num_billets_dispatched),
    }),
    onSuccess: onDone,
  })

  return (
    <div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)', marginBottom: 16, letterSpacing: '0.06em' }}>NEW DISPATCH TO ROLLING CONTRACTOR</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>JOINING OPERATION</label>
          <select className="input" value={form.joining_operation_id} onChange={e => setForm(f => ({ ...f, joining_operation_id: e.target.value }))}>
            <option value="">Select…</option>
            {joinings.map((j: any) => <option key={j.id} value={j.id}>#{j.id} — {j.date_joined} ({j.num_billets_produced} billets)</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>ROLLING CONTRACTOR</label>
          {(contractors as any[]).length > 0 ? (
            <select className="input" value={form.rolling_contractor_name} onChange={e => setForm(f => ({ ...f, rolling_contractor_name: e.target.value }))}>
              <option value="">Select contractor…</option>
              {(contractors as any[]).map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          ) : (
            <input className="input" value={form.rolling_contractor_name} onChange={e => setForm(f => ({ ...f, rolling_contractor_name: e.target.value }))} placeholder="Add contractors in Config first" />
          )}
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>BILLETS DISPATCHED</label>
          <input className="input" type="number" value={form.num_billets_dispatched} onChange={e => setForm(f => ({ ...f, num_billets_dispatched: e.target.value }))} />
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>DATE DISPATCHED</label>
          <input className="input" type="date" value={form.date_dispatched} onChange={e => setForm(f => ({ ...f, date_dispatched: e.target.value }))} />
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>BILLET DIMENSIONS (MM)</label>
          <input className="input" value={form.billet_dimensions_mm} onChange={e => setForm(f => ({ ...f, billet_dimensions_mm: e.target.value }))} />
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>NOTES</label>
          <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
      </div>
      <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => mut.mutate()} disabled={mut.isPending || !form.joining_operation_id || !form.rolling_contractor_name || !form.num_billets_dispatched}>
        {mut.isPending ? 'Saving…' : 'Save Dispatch'}
      </button>
    </div>
  )
}

// ── Receiving Form ────────────────────────────────────────────────────────────

function ReceivingForm({ dispatches, onDone }: { dispatches: any[]; onDone: () => void }) {
  const [form, setForm] = useState({
    faridabad_dispatch_id: '',
    date_received: new Date().toISOString().slice(0, 10),
    num_billets_received: '',
    condition: '',
    received_by: '',
    notes: '',
  })
  const mut = useMutation({
    mutationFn: () => faridabadApi.createReceiving({
      ...form,
      faridabad_dispatch_id: parseInt(form.faridabad_dispatch_id),
      num_billets_received: parseInt(form.num_billets_received),
    }),
    onSuccess: onDone,
  })

  return (
    <div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)', marginBottom: 16, letterSpacing: '0.06em' }}>NEW RECEIVING EVENT (DHARMAPURI)</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>FARIDABAD BATCH</label>
          <select className="input" value={form.faridabad_dispatch_id} onChange={e => setForm(f => ({ ...f, faridabad_dispatch_id: e.target.value }))}>
            <option value="">Select…</option>
            {dispatches.map((d: any) => <option key={d.id} value={d.id}>{d.batch_reference} — {d.rolling_contractor_name} ({d.num_billets_dispatched} dispatched)</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>DATE RECEIVED</label>
          <input className="input" type="date" value={form.date_received} onChange={e => setForm(f => ({ ...f, date_received: e.target.value }))} />
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>BILLETS RECEIVED</label>
          <input className="input" type="number" value={form.num_billets_received} onChange={e => setForm(f => ({ ...f, num_billets_received: e.target.value }))} />
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>CONDITION</label>
          <input className="input" value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))} placeholder="Good / Damaged / etc." />
        </div>
        <div>
          <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>RECEIVED BY</label>
          <input className="input" value={form.received_by} onChange={e => setForm(f => ({ ...f, received_by: e.target.value }))} />
        </div>
      </div>
      <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => mut.mutate()} disabled={mut.isPending || !form.faridabad_dispatch_id || !form.num_billets_received}>
        {mut.isPending ? 'Saving…' : 'Save Receiving Event'}
      </button>
    </div>
  )
}

// ── Tables ────────────────────────────────────────────────────────────────────

const TH = ({ children }: { children: React.ReactNode }) => (
  <th style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.1em', color: 'var(--ink-3)', textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--line)', fontWeight: 500 }}>{children}</th>
)
const TD = ({ children }: { children: React.ReactNode }) => (
  <td style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--ink)', padding: '9px 12px', borderBottom: '1px solid var(--line)' }}>{children}</td>
)

function IntakesTable({ data, loading }: { data: any[]; loading: boolean }) {
  if (loading) return <div style={{ color: 'var(--ink-3)', padding: 16 }}>Loading…</div>
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="es-table" style={{ width: '100%' }}>
        <thead><tr>
          <TH>TYPE</TH><TH>SUPPLIER</TH><TH>HEAT NUMBER</TH><TH>GRADE</TH>
          <TH>DATE</TH><TH>BARS</TH><TH>WEIGHT KG</TH><TH>DIMENSIONS</TH>
        </tr></thead>
        <tbody>
          {data.map((r: any) => (
            <tr key={r.id}>
              <TD><span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, fontWeight: 700, color: LABEL_COLOR[r.material_type] || 'var(--ink-2)', letterSpacing: '0.08em' }}>{LABEL[r.material_type] || r.material_type}</span></TD>
              <TD>{r.supplier_name}</TD>
              <TD>{r.heat_number}</TD>
              <TD>{r.steel_grade}</TD>
              <TD>{r.date_received}</TD>
              <TD>{r.num_bars ?? '—'}</TD>
              <TD>{r.weight_kg ?? '—'}</TD>
              <TD>{r.bar_dimensions_mm || '—'}</TD>
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>No intakes recorded</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function JoiningsTable({ data, loading }: { data: any[]; loading: boolean }) {
  if (loading) return <div style={{ color: 'var(--ink-3)', padding: 16 }}>Loading…</div>
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="es-table" style={{ width: '100%' }}>
        <thead><tr>
          <TH>#</TH><TH>ALLOY HEAT NO</TH><TH>MS HEAT NO</TH><TH>BILLETS</TH>
          <TH>DIMENSIONS</TH><TH>OPERATOR</TH><TH>DATE</TH>
        </tr></thead>
        <tbody>
          {data.map((j: any) => (
            <tr key={j.id}>
              <TD>#{j.id}</TD>
              <TD><span style={{ color: '#c4b5fd' }}>{j.alloy_heat_number}</span><br /><span style={{ color: 'var(--ink-3)', fontSize: 10 }}>{j.alloy_supplier}</span></TD>
              <TD><span style={{ color: '#6ee7b7' }}>{j.ms_heat_number}</span><br /><span style={{ color: 'var(--ink-3)', fontSize: 10 }}>{j.ms_supplier}</span></TD>
              <TD>{j.num_billets_produced}</TD>
              <TD>{j.output_billet_dimensions_mm || '—'}</TD>
              <TD>{j.operator_name || '—'}</TD>
              <TD>{j.date_joined}</TD>
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>No joining operations recorded</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function DispatchesTable({ data, loading }: { data: any[]; loading: boolean }) {
  if (loading) return <div style={{ color: 'var(--ink-3)', padding: 16 }}>Loading…</div>
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="es-table" style={{ width: '100%' }}>
        <thead><tr>
          <TH>BATCH REF</TH><TH>CONTRACTOR</TH><TH>BILLETS</TH><TH>DATE</TH>
          <TH>RECEIVED</TH><TH>RECEIVING RUNS</TH>
        </tr></thead>
        <tbody>
          {data.map((d: any) => (
            <tr key={d.id}>
              <TD><span style={{ color: 'var(--accent)', fontWeight: 700 }}>{d.batch_reference}</span></TD>
              <TD>{d.rolling_contractor_name}</TD>
              <TD>{d.num_billets_dispatched}</TD>
              <TD>{d.date_dispatched}</TD>
              <TD>{d.total_received} / {d.num_billets_dispatched}</TD>
              <TD>{d.receiving_count}</TD>
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>No dispatches recorded</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function ReceivingsTable({ data, loading }: { data: any[]; loading: boolean }) {
  if (loading) return <div style={{ color: 'var(--ink-3)', padding: 16 }}>Loading…</div>
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="es-table" style={{ width: '100%' }}>
        <thead><tr>
          <TH>BATCH REF</TH><TH>CONTRACTOR</TH><TH>DATE RECEIVED</TH>
          <TH>BILLETS</TH><TH>CONDITION</TH><TH>RECEIVED BY</TH>
        </tr></thead>
        <tbody>
          {data.map((r: any) => (
            <tr key={r.id}>
              <TD><span style={{ color: 'var(--accent)', fontWeight: 700 }}>{r.batch_reference}</span></TD>
              <TD>{r.rolling_contractor_name}</TD>
              <TD>{r.date_received}</TD>
              <TD>{r.num_billets_received}</TD>
              <TD>{r.condition || '—'}</TD>
              <TD>{r.received_by || '—'}</TD>
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>No receiving events recorded</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
