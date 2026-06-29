import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  uidApi,
  factoryApi,
  cycleApi,
  productApi,
  manufacturingApi,
  faridabadApi,
} from '../api/client'
import type { UID, FactoryLocation, CycleType, Size, Design, ManufacturingOrder } from '../types'
import { useAuth } from '../hooks/useAuth'
import {
  Plus,
  Hammer,
  CheckCircle2,
  AlertTriangle,
  Printer,
  RotateCcw,
  Package,
  FileClock,
  Layers,
} from 'lucide-react'
import { format } from 'date-fns'

const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"

/* ── small primitives ──────────────────────────────────────────────────────── */
function SectionLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      {icon}
      <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>{children}</span>
    </div>
  )
}

const TH: React.CSSProperties = {
  textAlign: 'left', padding: '10px 16px', fontFamily: MONO, fontSize: 10,
  letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-2)',
  fontWeight: 600, borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  padding: '12px 16px', borderBottom: '1px solid var(--line)', fontSize: 13, color: 'var(--ink)',
}

const cyclePillStyle = (name: string | null | undefined): React.CSSProperties => {
  const key = (name ?? '').toUpperCase()
  const map: Record<string, { bg: string; fg: string }> = {
    EAT: { bg: 'rgba(45,111,181,.14)', fg: '#2d6fb5' },
    SWAN: { bg: 'rgba(34,160,107,.14)', fg: '#1c7a52' },
    OVEN: { bg: 'rgba(217,122,43,.14)', fg: '#d97a2b' },
  }
  const s = map[key] ?? { bg: 'var(--surface-3)', fg: 'var(--ink-2)' }
  return {
    display: 'inline-flex', alignItems: 'center', fontFamily: MONO, fontSize: 10, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.04em', padding: '3px 9px', borderRadius: 20,
    background: s.bg, color: s.fg, whiteSpace: 'nowrap',
  }
}

/* ── page ──────────────────────────────────────────────────────────────────── */
export default function UIDs() {
  const { user } = useAuth()
  const qc = useQueryClient()

  // ── Form state (BSW-01 UID generation) ────────────────────────────────────
  const [cycleTypeId, setCycleTypeId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [sizeId, setSizeId] = useState('')
  const [designId, setDesignId] = useState('')
  const [priority, setPriority] = useState('normal')
  const [moId, setMoId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [receivingId, setReceivingId] = useState('')
  const [created, setCreated] = useState<{ id: number; code: string }[] | null>(null)

  // ── Reference data ─────────────────────────────────────────────────────────
  const { data: cycles = [] } = useQuery<CycleType[]>({
    queryKey: ['uidc-cycles'],
    queryFn: () => cycleApi.list().then((r) => r.data),
  })
  const { data: locations = [] } = useQuery<FactoryLocation[]>({
    queryKey: ['uidc-locations'],
    queryFn: () => factoryApi.locations().then((r) => r.data),
  })
  const { data: sizes = [] } = useQuery<Size[]>({
    queryKey: ['uidc-sizes'],
    queryFn: () => productApi.sizes().then((r) => r.data),
    retry: false,
  })
  const { data: designs = [] } = useQuery<Design[]>({
    queryKey: ['uidc-designs'],
    queryFn: () => productApi.designs().then((r) => r.data),
    retry: false,
  })
  const { data: orders = [] } = useQuery<ManufacturingOrder[]>({
    queryKey: ['uidc-orders'],
    queryFn: () => manufacturingApi.orders().then((r) => r.data),
    retry: false,
  })
  // Receiving events carry the Faridabad material traceability for created UIDs.
  const { data: receivings = [] } = useQuery<any[]>({
    queryKey: ['uidc-receivings'],
    queryFn: () => faridabadApi.receivings().then((r) => r.data),
    retry: false,
  })

  // Default the location to the operator's primary location once loaded.
  const effLocationId = locationId || (user?.primary_location_id ? String(user.primary_location_id) : '')

  // ── Recently created UIDs (today) ──────────────────────────────────────────
  const { data: recentResult, isLoading: recentLoading, isError: recentError } = useQuery({
    queryKey: ['uidc-recent'],
    queryFn: () => uidApi.list({ limit: 100, sort: 'created_at', order: 'desc' }).then((r) => r.data),
    refetchInterval: 30_000,
    retry: false,
  })
  const recentToday: UID[] = useMemo(() => {
    const all: UID[] = recentResult?.items ?? []
    const today = new Date().toDateString()
    return all
      .filter((u: any) => {
        try {
          return new Date(u.created_at).toDateString() === today
        } catch {
          return false
        }
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [recentResult])

  // Design-confirmation backlog (carried-over UIDs awaiting design before Step 16).
  const awaitingDesign = useMemo(
    () => (recentResult?.items ?? []).filter((u: any) => u.design_id && !u.design_confirmed).length,
    [recentResult]
  )

  // ── Selected entities for the preview ──────────────────────────────────────
  const selectedCycle = cycles.find((c) => String(c.id) === cycleTypeId)
  const selectedSize = sizes.find((s) => String(s.id) === sizeId)
  const selectedDesign = designs.find((d) => String(d.id) === designId)
  const selectedReceiving = receivings.find((r: any) => String(r.id) === receivingId)
  const qty = Math.max(0, Math.min(500, Number(quantity) || 0))

  // Map receiving-event id → human batch reference for the recent-UIDs table.
  const receivingRefById = useMemo(() => {
    const m = new Map<number, string>()
    receivings.forEach((r: any) => { if (r?.id != null) m.set(Number(r.id), r.batch_reference || `#${r.id}`) })
    return m
  }, [receivings])

  // Designs valid for the chosen size (per product design/size constraints).
  const validDesigns = useMemo(() => {
    if (!sizeId) return designs
    const sid = Number(sizeId)
    return designs.filter((d) => !d.valid_size_ids?.length || d.valid_size_ids.includes(sid))
  }, [designs, sizeId])

  // ── Create mutation ────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => uidApi.bulkCreate(data).then((r) => r.data),
    onSuccess: (data) => {
      setCreated(data.uids ?? [])
      qc.invalidateQueries({ queryKey: ['uidc-recent'] })
    },
  })

  const canCreate =
    !!cycleTypeId && !!effLocationId && qty > 0 && qty <= 500 && !createMut.isPending

  const resetForm = () => {
    setCreated(null)
    setQuantity('1')
    setSizeId('')
    setDesignId('')
    setPriority('normal')
    setMoId('')
    setReceivingId('')
    createMut.reset()
  }

  const handleCreate = () => {
    const payload: Record<string, unknown> = {
      quantity: qty,
      cycle_type_id: Number(cycleTypeId),
      factory_location_id: Number(effLocationId),
      priority,
    }
    if (sizeId) payload.size_id = Number(sizeId)
    if (designId) payload.design_id = Number(designId)
    if (moId) payload.mo_id = Number(moId)
    if (receivingId) payload.receiving_event_id = Number(receivingId)
    createMut.mutate(payload)
  }

  const isManager = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor'

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--ink)' }}>UID Creation</div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-2)', marginTop: 3 }}>
            Raw material birth point · workstation <span style={{ fontFamily: MONO, color: 'var(--ink)' }}>BSW-01</span> · Dharmapuri
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            {recentToday.length} created today
          </span>
        </div>
      </div>

      {!isManager && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10,
          background: 'rgba(217,122,43,.10)', border: '1px solid rgba(217,122,43,.25)',
          color: 'var(--warning)', fontSize: 13, marginBottom: 18, fontFamily: SANS,
        }}>
          <AlertTriangle size={15} /> UID generation is limited to supervisors and managers.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1fr) minmax(300px, 0.85fr)', gap: 16, alignItems: 'start', marginBottom: 20 }}>
        {/* ── Generation form ───────────────────────────────────────────────── */}
        <div className="card" style={{ padding: '20px 22px' }}>
          <SectionLabel icon={<Hammer size={13} style={{ color: 'var(--ink-3)' }} />}>Generate UIDs from raw material</SectionLabel>

          {created ? (
            <CreatedResult
              uids={created}
              onReset={resetForm}
              meta={{
                cycle: selectedCycle?.name ?? null,
                size: selectedSize ? `${selectedSize.value_mm} mm` : null,
                design: selectedDesign?.code ?? null,
                priority: priority.charAt(0).toUpperCase() + priority.slice(1),
                batch: selectedReceiving?.batch_reference ?? null,
              }}
            />
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label className="label">Cycle Type</label>
                  <select className="input" value={cycleTypeId} onChange={(e) => setCycleTypeId(e.target.value)}>
                    <option value="">Select cycle…</option>
                    {cycles.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.letter_prefix ? ` (${c.letter_prefix})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Quantity (max 500)</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={500}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Size (mm)</label>
                  <select className="input" value={sizeId} onChange={(e) => { setSizeId(e.target.value); setDesignId('') }}>
                    <option value="">Unset · suggest later</option>
                    {sizes.filter((s) => s.is_active !== false).map((s) => (
                      <option key={s.id} value={s.id}>{s.value_mm} mm</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Design (optional)</label>
                  <select className="input" value={designId} onChange={(e) => setDesignId(e.target.value)}>
                    <option value="">Confirm later (before Step 16)</option>
                    {validDesigns.filter((d) => d.is_active !== false).map((d) => (
                      <option key={d.id} value={d.id}>{d.code}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="label">Location</label>
                  <select className="input" value={effLocationId} onChange={(e) => setLocationId(e.target.value)}>
                    <option value="">Select location…</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">MO Number (optional)</label>
                  <select className="input" value={moId} onChange={(e) => setMoId(e.target.value)}>
                    <option value="">Link later</option>
                    {orders.map((o) => (
                      <option key={o.id} value={o.id}>{o.mo_number}{o.customer ? ` · ${o.customer}` : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Receiving Event (traceability)</label>
                  <select className="input" value={receivingId} onChange={(e) => setReceivingId(e.target.value)}>
                    <option value="">None · link later</option>
                    {receivings.map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.batch_reference}{r.rolling_contractor_name ? ` · ${r.rolling_contractor_name}` : ''}
                        {r.num_billets_received != null ? ` · ${r.num_billets_received} billets` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {createMut.isError && (
                <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 9, background: 'rgba(229,72,77,.10)', border: '1px solid rgba(229,72,77,.25)', color: 'var(--error)', fontSize: 13, fontFamily: SANS }}>
                  Could not generate UIDs. Check the cycle, quantity and location, then retry.
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button className="btn-primary" disabled={!canCreate} onClick={handleCreate}>
                  <Plus size={15} /> {createMut.isPending ? 'Generating…' : `Generate ${qty || 0} UID${qty === 1 ? '' : 's'}`}
                </button>
                <button className="btn-secondary" onClick={resetForm} disabled={createMut.isPending}>
                  <RotateCcw size={14} /> Reset
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── Generation preview ────────────────────────────────────────────── */}
        <div className="card" style={{ padding: '20px 22px' }}>
          <SectionLabel icon={<Layers size={13} style={{ color: 'var(--ink-3)' }} />}>Generation preview</SectionLabel>

          <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 48, letterSpacing: '-0.04em', color: qty > 0 ? 'var(--accent)' : 'var(--ink-3)', lineHeight: 1 }}>
              {qty}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 6 }}>
              UID{qty === 1 ? '' : 's'} will be created
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, borderTop: '1px solid var(--line)' }}>
            {([
              ['Cycle', selectedCycle ? selectedCycle.name : '—'],
              ['Size', selectedSize ? `${selectedSize.value_mm} mm` : 'Unset'],
              ['Design', selectedDesign ? selectedDesign.code : 'Pending'],
              ['Priority', priority.charAt(0).toUpperCase() + priority.slice(1)],
              ['MO', orders.find((o) => String(o.id) === moId)?.mo_number ?? '—'],
              ['Storage', 'RM-Q'],
              ['Status', 'Active · Step 1 (BSW-01)'],
            ] as const).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--surface-2)' }}>
                <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{k}</span>
                <span style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink)', fontWeight: 500, textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Inherited material traceability from the receiving event */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>
              Inherited material
            </div>
            {selectedReceiving ? (
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {[
                  ['Batch ref', selectedReceiving.batch_reference],
                  ['Rolling contractor', selectedReceiving.rolling_contractor_name],
                  ['Date received', selectedReceiving.date_received ? format(new Date(selectedReceiving.date_received), 'dd MMM yyyy') : null],
                  ['Billets received', selectedReceiving.num_billets_received != null ? String(selectedReceiving.num_billets_received) : null],
                  ['Condition', selectedReceiving.condition],
                ].map(([k, v]) => v ? (
                  <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)' }}>{k}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink)', textAlign: 'right' }}>{String(v)}</span>
                  </div>
                ) : null)}
                <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-2)', marginTop: 2, lineHeight: 1.45 }}>
                  Faridabad batch, alloy/MS heat numbers and grades are traced through this receiving event. Full
                  material linkage onto each UID is finalised when the receiving-link endpoint is available.
                </div>
              </div>
            ) : (
              <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-3)' }}>
                No receiving event selected. Material traceability will be blank and can be linked later.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Spec note: per-piece billet cut flow ──────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '11px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 20 }}>
        <FileClock size={14} style={{ color: 'var(--ink-3)', marginTop: 1, flexShrink: 0 }} />
        <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Per-billet cut planning (2–3 pieces with individual cycle/size and kerf-based scrap calculation) requires a
          dedicated billet-cut endpoint that is not yet available. UIDs are generated in bulk against a shared cycle,
          size and receiving event; cut details can be captured at Step 2 (RCV-01).
        </div>
      </div>

      {/* ── Recently created UIDs (today) ─────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Package size={14} style={{ color: 'var(--ink-3)' }} />
            <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>
              Recently created UIDs · today
            </span>
          </div>
          {awaitingDesign > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: 'rgba(217,122,43,.14)', color: '#d97a2b' }}>
              <FileClock size={11} /> {awaitingDesign} awaiting design confirmation
            </span>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>UID</th>
                <th style={TH}>Cycle</th>
                <th style={TH}>Size</th>
                <th style={TH}>Design</th>
                <th style={TH}>Priority</th>
                <th style={TH}>MO</th>
                <th style={TH}>Receiving Event</th>
                <th style={{ ...TH, textAlign: 'right' }}>Created At</th>
              </tr>
            </thead>
            <tbody>
              {recentLoading && (
                <tr><td colSpan={8} style={{ ...TD, textAlign: 'center', fontFamily: MONO, fontSize: 12, color: 'var(--ink-3)' }}>Loading…</td></tr>
              )}
              {recentError && !recentLoading && (
                <tr><td colSpan={8} style={{ ...TD, textAlign: 'center', fontFamily: MONO, fontSize: 12, color: 'var(--error)' }}>Could not load recent UIDs. Refresh in a moment.</td></tr>
              )}
              {!recentLoading && !recentError && recentToday.map((u: any) => (
                <tr key={u.id} className="row-hover">
                  <td style={TD}>
                    <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>{u.code}</span>
                  </td>
                  <td style={TD}><span style={cyclePillStyle(u.cycle_type_name)}>{u.cycle_type_name ?? '—'}</span></td>
                  <td style={{ ...TD, fontFamily: MONO, color: 'var(--ink-2)' }}>{u.size_mm ? `${u.size_mm} mm` : '—'}</td>
                  <td style={{ ...TD, fontFamily: MONO }}>
                    {u.design_code
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--ink)' }}>
                          {u.design_code}
                          {u.design_confirmed
                            ? <CheckCircle2 size={12} style={{ color: '#22a06b' }} />
                            : <AlertTriangle size={12} style={{ color: '#d97a2b' }} />}
                        </span>
                      : <span style={{ color: '#d97a2b' }}>PENDING</span>}
                  </td>
                  <td style={TD}>
                    {u.priority && u.priority !== 'normal'
                      ? <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', padding: '3px 9px', borderRadius: 20, background: u.priority === 'urgent' ? 'rgba(229,72,77,.13)' : 'rgba(245,158,11,.14)', color: u.priority === 'urgent' ? '#e5484d' : '#d97a2b' }}>{u.priority}</span>
                      : <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--ink-3)' }}>Normal</span>}
                  </td>
                  <td style={{ ...TD, fontFamily: MONO, color: 'var(--ink-2)' }}>{u.mo_number ?? '—'}</td>
                  <td style={{ ...TD, fontFamily: MONO, color: 'var(--ink-2)' }}>
                    {u.receiving_event_id
                      ? (receivingRefById.get(Number(u.receiving_event_id)) ?? u.rolling_contractor ?? `#${u.receiving_event_id}`)
                      : '—'}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, fontSize: 12, color: 'var(--ink-2)' }}>
                    {u.created_at ? format(new Date(u.created_at), 'HH:mm · dd MMM') : '—'}
                  </td>
                </tr>
              ))}
              {!recentLoading && !recentError && recentToday.length === 0 && (
                <tr><td colSpan={8} style={{ ...TD, textAlign: 'center', padding: '36px 16px', fontFamily: MONO, fontSize: 12, color: 'var(--ink-3)' }}>No UIDs created today yet. Generate some above.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ── Result panel after a successful generation ────────────────────────────── */
type CreatedMeta = {
  cycle: string | null
  size: string | null
  design: string | null
  priority: string | null
  batch: string | null
}
function CreatedResult({ uids, onReset, meta }: { uids: { id: number; code: string }[]; onReset: () => void; meta: CreatedMeta }) {
  const handlePrint = () => {
    const w = window.open('', '_blank', 'width=480,height=640')
    if (!w) return
    const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] as string))
    const stamp = new Date().toLocaleString()
    const metaRows = ([
      ['Cycle', meta.cycle],
      ['Size', meta.size],
      ['Design', meta.design ?? 'Pending'],
      ['Priority', meta.priority],
      ['Receiving batch', meta.batch],
    ] as [string, string | null][])
      .filter(([, v]) => v)
      .map(([k, v]) => `<tr><td style="padding:2px 14px 2px 0;color:#666">${k}</td><td>${esc(String(v))}</td></tr>`)
      .join('')
    const rows = uids
      .map((u) => `<div style="font-family:'IBM Plex Mono',monospace;font-size:15px;padding:7px 0;border-bottom:1px solid #ddd">☐&nbsp;&nbsp;${esc(u.code)}</div>`)
      .join('')
    w.document.write(
      `<html><head><title>UID Tagging List · BSW-01</title></head>` +
      `<body style="padding:24px;font-family:Arial">` +
      `<h2 style="margin:0 0 2px">UID Tagging List · BSW-01 · Dharmapuri</h2>` +
      `<div style="color:#666;font-size:12px;margin-bottom:12px">${uids.length} UID${uids.length === 1 ? '' : 's'} · generated ${stamp} · stamp at Step 2 (RCV-01)</div>` +
      (metaRows ? `<table style="font-size:12px;margin-bottom:14px;border-collapse:collapse">${metaRows}</table>` : '') +
      `<div>${rows}</div>` +
      `</body></html>`
    )
    w.document.close()
    w.print()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ textAlign: 'center', padding: '12px 0' }}>
        <CheckCircle2 size={32} style={{ color: '#22a06b' }} />
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 40, letterSpacing: '-0.04em', color: 'var(--ink)', lineHeight: 1, marginTop: 8 }}>{uids.length}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 6 }}>
          UID{uids.length === 1 ? '' : 's'} created · status active · RM-Q
        </div>
      </div>

      <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
        {uids.map((u) => (
          <div key={u.id} style={{ padding: '9px 14px', fontFamily: MONO, fontSize: 13, color: 'var(--ink)', borderBottom: '1px solid var(--surface-2)' }}>{u.code}</div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn-secondary" onClick={handlePrint}>
          <Printer size={14} /> Print tagging list
        </button>
        <button className="btn-primary" onClick={onReset}>
          <Plus size={15} /> Create more
        </button>
      </div>
    </div>
  )
}
