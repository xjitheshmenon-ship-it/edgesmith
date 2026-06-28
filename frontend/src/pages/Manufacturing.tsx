import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { manufacturingApi, productApi } from '../api/client'
import type { ManufacturingOrder, ConversionPattern, Size, Design } from '../types'
import { Plus, Scissors, List, Columns } from 'lucide-react'
import { format } from 'date-fns'

type StatusFilter = 'all' | 'in_progress' | 'completed' | 'open' | 'cancelled'
type ViewMode = 'list' | 'kanban'

const STATUS_META: Record<string, { label: string; dot: string; bg: string; color: string }> = {
  open:        { label: 'Draft',       dot: '#9c9080', bg: '#f0ece5', color: '#6b6358' },
  in_progress: { label: 'In Progress', dot: '#d97706', bg: '#fef3c7', color: '#b45309' },
  completed:   { label: 'Done',        dot: '#15803d', bg: '#dcfce7', color: '#15803d' },
  cancelled:   { label: 'Cancelled',   dot: '#b91c1c', bg: '#fee2e2', color: '#b91c1c' },
}

function statusMeta(s: string) {
  return STATUS_META[s] ?? STATUS_META['open']
}

const FILTER_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all',         label: 'All' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed',   label: 'Done' },
  { key: 'open',        label: 'Draft' },
  { key: 'cancelled',   label: 'Cancelled' },
]

export default function Manufacturing() {
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('all')
  const [view, setView] = useState<ViewMode>('list')
  const [showCreateMO, setShowCreateMO] = useState(false)
  const [showCreatePattern, setShowCreatePattern] = useState(false)
  const [tab, setTab] = useState<'orders' | 'patterns'>('orders')
  const qc = useQueryClient()

  const { data: orders = [] } = useQuery<ManufacturingOrder[]>({
    queryKey: ['mo-orders'],
    queryFn: () => manufacturingApi.orders().then((r) => r.data),
  })

  const { data: patterns = [] } = useQuery<ConversionPattern[]>({
    queryKey: ['patterns'],
    queryFn: () => manufacturingApi.patterns().then((r) => r.data),
  })

  const archivePattern = useMutation({
    mutationFn: (id: number) => manufacturingApi.archivePattern(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patterns'] }),
  })

  const filtered = activeFilter === 'all' ? orders : orders.filter(o => o.status === activeFilter)

  const countFor = (key: StatusFilter) =>
    key === 'all' ? orders.length : orders.filter(o => o.status === key).length

  return (
    <div style={{ padding: '24px 28px 60px', minHeight: '100%' }}>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--line)', paddingBottom: 0 }}>
        {(['orders', 'patterns'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t ? 'var(--accent)' : 'var(--ink-2)',
              fontFamily: "'IBM Plex Sans', sans-serif",
              fontSize: 13,
              fontWeight: tab === t ? 600 : 400,
              cursor: 'pointer',
              marginBottom: -1,
              transition: 'color 0.12s',
            }}
          >
            {t === 'orders' ? `Manufacturing Orders (${orders.length})` : `Conversion Patterns (${patterns.length})`}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn-primary" style={{ marginBottom: 8 }} onClick={() => tab === 'orders' ? setShowCreateMO(true) : setShowCreatePattern(true)}>
          <Plus size={15} /> {tab === 'orders' ? 'New Order' : 'New Pattern'}
        </button>
      </div>

      {tab === 'orders' && (
        <>
          {/* Filters + view toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {FILTER_OPTIONS.map(f => {
                const count = countFor(f.key)
                const active = activeFilter === f.key
                return (
                  <button
                    key={f.key}
                    onClick={() => setActiveFilter(f.key)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '5px 12px',
                      borderRadius: 20,
                      border: '1px solid',
                      borderColor: active ? 'var(--accent)' : 'var(--line)',
                      background: active ? 'rgba(212,238,203,.12)' : 'var(--surface)',
                      color: active ? 'var(--accent)' : 'var(--ink-2)',
                      fontFamily: "'IBM Plex Sans', sans-serif",
                      fontSize: 13,
                      fontWeight: active ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.12s',
                    }}
                  >
                    {f.label}
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, fontWeight: 600, opacity: 0.7 }}>{count}</span>
                  </button>
                )
              })}
            </div>
            <div style={{ flex: 1 }} />
            {/* List / Kanban toggle */}
            <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 9, padding: 3, gap: 2 }}>
              {([['list', <List size={13} />, 'List'], ['kanban', <Columns size={13} />, 'Kanban']] as const).map(([v, icon, lbl]) => (
                <button
                  key={v}
                  onClick={() => setView(v as ViewMode)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 10px',
                    borderRadius: 7,
                    border: 'none',
                    background: view === v ? 'var(--surface)' : 'transparent',
                    color: view === v ? 'var(--ink)' : 'var(--ink-2)',
                    fontFamily: "'IBM Plex Sans', sans-serif",
                    fontSize: 12,
                    fontWeight: view === v ? 600 : 400,
                    cursor: 'pointer',
                    boxShadow: view === v ? '0 1px 4px rgba(0,0,0,.15)' : 'none',
                    transition: 'all 0.12s',
                  }}
                >
                  {icon}{lbl}
                </button>
              ))}
            </div>
          </div>

          {view === 'list' ? (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
              {/* Header row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '148px 1fr 90px 104px 150px 120px',
                gap: 16,
                padding: '12px 22px',
                borderBottom: '1px solid var(--line)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.12em',
                color: 'var(--ink-3)',
              }}>
                <div>REFERENCE</div><div>PRODUCT / NOTES</div><div>QTY</div><div>CREATED</div><div>PROGRESS</div><div>STATUS</div>
              </div>
              {filtered.map((m, i) => {
                const meta = statusMeta(m.status)
                const progress = m.uid_count > 0 ? Math.round((m.uid_count / m.quantity) * 100) : 0
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '148px 1fr 90px 104px 150px 120px',
                      gap: 16,
                      padding: '14px 22px',
                      borderBottom: i < filtered.length - 1 ? '1px solid var(--line)' : 'none',
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                  >
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, fontWeight: 600, color: 'var(--accent)' }}>{m.mo_number}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{m.customer || '—'}</div>
                      {m.notes && <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-2)', marginTop: 2 }}>{m.notes}</div>}
                    </div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{m.quantity} <span style={{ fontWeight: 400, color: 'var(--ink-2)' }}>pc</span></div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--ink-2)' }}>{format(new Date(m.created_at), 'MMM dd')}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 6, background: 'var(--surface-2)', overflow: 'hidden' }}>
                        <div style={{ width: `${progress}%`, height: '100%', borderRadius: 6, background: meta.dot, transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', width: 32, textAlign: 'right' }}>{progress}%</span>
                    </div>
                    <div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 6, background: meta.bg, color: meta.color, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.dot, flexShrink: 0 }} />
                        {meta.label}
                      </span>
                    </div>
                  </div>
                )
              })}
              {filtered.length === 0 && (
                <div style={{ padding: '40px 22px', textAlign: 'center', color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                  No orders
                </div>
              )}
            </div>
          ) : (
            /* Kanban view */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, alignItems: 'start' }}>
              {(['open', 'in_progress', 'completed', 'cancelled'] as const).map(status => {
                const col = orders.filter(o => o.status === status)
                const meta = statusMeta(status)
                return (
                  <div key={status} style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '4px 4px 8px', borderBottom: '1px solid var(--line)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.dot }} />
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, fontWeight: 600, color: 'var(--ink-2)', letterSpacing: '0.08em' }}>{meta.label.toUpperCase()}</span>
                      <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)' }}>{col.length}</span>
                    </div>
                    {col.map(m => (
                      <div key={m.id} className="card" style={{ padding: '12px 14px', marginBottom: 8, cursor: 'pointer' }}>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>{m.mo_number}</div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{m.customer || '—'}</div>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-2)', marginTop: 2 }}>{m.quantity} pc</div>
                      </div>
                    ))}
                    {col.length === 0 && <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--ink-3)', fontSize: 12 }}>Empty</div>}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'patterns' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {patterns.map((p) => (
            <div key={p.id} className="card" style={{ padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Scissors size={15} style={{ color: 'var(--ink-3)' }} />
                <span style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14 }}>{p.name}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                {[
                  ['Input', `${p.input_length_mm} mm`],
                  ['Outputs', `${p.output_lengths_mm.join(' + ')} mm`],
                  ['Cuts × Kerf', `${p.num_cuts} × ${p.kerf_mm} mm`],
                  ['Scrap', `${p.scrap_mm} mm`],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--ink-2)' }}>{label}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: Number(p.scrap_mm) < 0 && label === 'Scrap' ? 'var(--error)' : 'var(--ink)' }}>{value}</span>
                  </div>
                ))}
              </div>
              <button
                style={{ marginTop: 12, fontSize: 12, color: 'var(--error)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onClick={() => archivePattern.mutate(p.id)}
              >
                Archive
              </button>
            </div>
          ))}
          {patterns.length === 0 && <div style={{ color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>No patterns</div>}
        </div>
      )}

      {showCreateMO && <CreateMOModal onClose={() => { setShowCreateMO(false); qc.invalidateQueries({ queryKey: ['mo-orders'] }) }} />}
      {showCreatePattern && <CreatePatternModal onClose={() => { setShowCreatePattern(false); qc.invalidateQueries({ queryKey: ['patterns'] }) }} />}
    </div>
  )
}

function CreateMOModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ mo_number: '', customer: '', quantity: 1, notes: '' })
  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => manufacturingApi.createOrder(data).then((r) => r.data),
    onSuccess: onClose,
  })
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div className="card" style={{ width: '100%', maxWidth: 440, padding: '24px 24px 20px' }}>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--ink)', marginBottom: 18 }}>New Manufacturing Order</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><label className="label-caps" style={{ display: 'block', marginBottom: 5 }}>MO Number</label><input className="input" style={{ width: '100%' }} value={form.mo_number} onChange={e => setForm({ ...form, mo_number: e.target.value })} /></div>
          <div><label className="label-caps" style={{ display: 'block', marginBottom: 5 }}>Customer</label><input className="input" style={{ width: '100%' }} value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })} /></div>
          <div><label className="label-caps" style={{ display: 'block', marginBottom: 5 }}>Quantity</label><input className="input" style={{ width: '100%' }} type="number" min={1} value={form.quantity} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })} /></div>
          <div><label className="label-caps" style={{ display: 'block', marginBottom: 5 }}>Notes</label><textarea className="input" style={{ width: '100%' }} rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          {mutation.error && <p style={{ color: 'var(--error)', fontSize: 13 }}>Failed to create order</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={mutation.isPending} onClick={() => mutation.mutate({ ...form, quantity: Number(form.quantity) })}>Create</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CreatePatternModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [inputLen, setInputLen] = useState(4500)
  const [outputs, setOutputs] = useState('1500,1500,1424')
  const [kerf, setKerf] = useState(3)

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => manufacturingApi.createPattern(data).then((r) => r.data),
    onSuccess: onClose,
  })

  const parsedOutputs = outputs.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean)
  const numCuts = parsedOutputs.length - 1
  const scrap = inputLen - parsedOutputs.reduce((a, b) => a + b, 0) - numCuts * kerf

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div className="card" style={{ width: '100%', maxWidth: 440, padding: '24px 24px 20px' }}>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--ink)', marginBottom: 18 }}>New Conversion Pattern</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><label className="label-caps" style={{ display: 'block', marginBottom: 5 }}>Pattern Name</label><input className="input" style={{ width: '100%' }} value={name} onChange={e => setName(e.target.value)} /></div>
          <div><label className="label-caps" style={{ display: 'block', marginBottom: 5 }}>Input Length (mm)</label><input className="input" style={{ width: '100%' }} type="number" value={inputLen} onChange={e => setInputLen(Number(e.target.value))} /></div>
          <div><label className="label-caps" style={{ display: 'block', marginBottom: 5 }}>Output Lengths (comma-separated mm)</label><input className="input" style={{ width: '100%' }} value={outputs} onChange={e => setOutputs(e.target.value)} /></div>
          <div><label className="label-caps" style={{ display: 'block', marginBottom: 5 }}>Kerf per cut (mm)</label><input className="input" style={{ width: '100%' }} type="number" value={kerf} onChange={e => setKerf(Number(e.target.value))} /></div>
          <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-2)' }}>Cuts</span><span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{numCuts}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-2)' }}>Scrap</span><span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: scrap < 0 ? 'var(--error)' : 'var(--ink)' }}>{scrap} mm</span></div>
          </div>
          {mutation.error && <p style={{ color: 'var(--error)', fontSize: 13 }}>Failed to create pattern</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={mutation.isPending || scrap < 0} onClick={() => mutation.mutate({ name, input_length_mm: inputLen, output_lengths_mm: parsedOutputs, kerf_mm: kerf })}>Create</button>
          </div>
        </div>
      </div>
    </div>
  )
}
