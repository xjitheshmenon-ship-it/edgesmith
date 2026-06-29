import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { manufacturingApi, uidApi, productApi } from '../api/client'
import type { ManufacturingOrder, UID, Size, Design } from '../types'
import UIDStatusBadge from '../components/UIDStatusBadge'
import {
  Plus, X, Search, Link2, Link2Off, RefreshCw, AlertTriangle, Package,
  ChevronRight, CheckCircle, Clock,
} from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'

/* ─── tokens ──────────────────────────────────────────────────────────────── */
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
  redText: '#c0392b',
  orange: '#d97a2b',
  amber: '#f0c674',
  green: '#22a06b',
  greenText: '#1c7a52',
}
const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"

const PRIORITIES = ['high', 'normal', 'low'] as const
type Priority = (typeof PRIORITIES)[number]

/* ─── derived fulfilment state ─────────────────────────────────────────────── */
type Fulfil = 'open' | 'in_progress' | 'partial' | 'complete'
interface MoStats {
  linked: number
  dispatched: number
  remaining: number
  fulfil: Fulfil
}

const FULFIL_META: Record<Fulfil, { label: string; cls: string }> = {
  open:        { label: 'Open',                 cls: 'badge-gray' },
  in_progress: { label: 'In progress',          cls: 'badge-blue' },
  partial:     { label: 'Partially dispatched', cls: 'badge-yellow' },
  complete:    { label: 'Fully dispatched',     cls: 'badge-green' },
}

/* progress-bar colour: complete / behind / on-track */
function barColor(f: Fulfil, pct: number) {
  if (f === 'complete') return C.green
  if (pct < 25) return C.red       // behind
  if (pct < 75) return C.amber     // partway
  return C.accent                  // on track
}

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  fontFamily: MONO, fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap',
}

function priorityPill(p?: string | null) {
  if (!p) return null
  const k = p.toLowerCase()
  const map: Record<string, { bg: string; fg: string }> = {
    high:   { bg: 'rgba(229,72,77,.13)', fg: C.red },
    urgent: { bg: 'rgba(229,72,77,.13)', fg: C.red },
    normal: { bg: 'rgba(45,111,181,.12)', fg: C.accent },
    low:    { bg: 'var(--surface-3)', fg: C.ink2 },
  }
  const s = map[k] ?? { bg: 'var(--surface-3)', fg: C.ink2 }
  return <span style={{ ...pill, background: s.bg, color: s.fg }}>{k}</span>
}

/* ─── table cell styles ────────────────────────────────────────────────────── */
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '9px 12px', fontFamily: MONO, fontSize: 9.5, fontWeight: 700,
  letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3,
  borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  padding: '11px 12px', borderBottom: `1px solid var(--surface-2)`, fontSize: 12.5, color: C.ink, verticalAlign: 'middle',
}

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

/* compute fulfilment stats for an MO given its linked UIDs (if loaded) */
function computeStats(mo: ManufacturingOrder, uids?: UID[]): MoStats {
  const linked = uids ? uids.length : mo.uid_count ?? 0
  const dispatched = uids ? uids.filter((u) => u.status === 'dispatched').length : 0
  const remaining = Math.max((mo.quantity ?? 0) - dispatched, 0)
  let fulfil: Fulfil = 'open'
  if (linked === 0) fulfil = 'open'
  else if (dispatched === 0) fulfil = 'in_progress'
  else if (remaining === 0 && dispatched >= (mo.quantity ?? 0)) fulfil = 'complete'
  else fulfil = 'partial'
  return { linked, dispatched, remaining, fulfil }
}

/* ─── fulfilment progress bar ──────────────────────────────────────────────── */
function ProgressBar({ dispatched, quantity, fulfil }: { dispatched: number; quantity: number; fulfil: Fulfil }) {
  const pct = quantity > 0 ? Math.min(100, (dispatched / quantity) * 100) : 0
  const color = barColor(fulfil, pct)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: C.surface3, overflow: 'hidden', minWidth: 60 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 300ms cubic-bezier(.2,.8,.2,1)' }} />
      </div>
      <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.ink2, whiteSpace: 'nowrap' }}>
        {dispatched}/{quantity}
      </span>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function Manufacturing() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showLink, setShowLink] = useState(false)

  const {
    data: orders = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<ManufacturingOrder[]>({
    queryKey: ['mo-orders', statusFilter],
    queryFn: () => manufacturingApi.orders(statusFilter || undefined).then((r) => r.data ?? []),
    refetchInterval: 30_000,
  })

  const selected = useMemo(() => orders.find((o) => o.id === selectedId) ?? null, [orders, selectedId])

  // UIDs linked to the selected MO (drives the detail panel + fulfilment).
  const { data: selectedUids = [], isLoading: uidsLoading } = useQuery<UID[]>({
    queryKey: ['mo-uids', selectedId],
    queryFn: () => manufacturingApi.orderUIDs(selectedId as number).then((r) => r.data ?? []),
    enabled: selectedId != null,
    refetchInterval: selectedId != null ? 30_000 : false,
  })

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return orders
    return orders.filter(
      (o) =>
        o.mo_number?.toLowerCase().includes(term) ||
        (o.customer ?? '').toLowerCase().includes(term)
    )
  }, [orders, search])

  // Aggregate counts for the header strip.
  const summary = useMemo(() => {
    const open = orders.filter((o) => (o.uid_count ?? 0) === 0).length
    const totalQty = orders.reduce((a, o) => a + (o.quantity ?? 0), 0)
    const totalLinked = orders.reduce((a, o) => a + (o.uid_count ?? 0), 0)
    return { total: orders.length, open, totalQty, totalLinked }
  }, [orders])

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: C.ink }}>MO Linking</div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, marginTop: 3 }}>
            Create manufacturing orders and link produced UIDs · {summary.total} MO{summary.total === 1 ? '' : 's'} · {summary.open} open
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={14} style={isFetching ? { animation: 'spin 1s linear infinite' } : undefined} />
            Refresh
          </button>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> New MO
          </button>
        </div>
      </div>

      {/* ── Summary tiles ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatTile value={summary.total} label="Manufacturing orders" />
        <StatTile value={summary.open} label="Open (no UIDs)" color={summary.open > 0 ? C.orange : undefined} />
        <StatTile value={summary.totalQty} label="Total qty required" />
        <StatTile value={summary.totalLinked} label="UIDs linked" color={C.green} />
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: C.ink3 }} />
          <input
            className="input"
            style={{ width: 240, paddingLeft: 32 }}
            placeholder="Search MO number or customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input" style={{ width: 190 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="partial">Partially dispatched</option>
          <option value="complete">Fully dispatched</option>
        </select>
      </div>

      {isError && (
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.red, padding: '12px 16px', background: 'rgba(229,72,77,.10)', borderRadius: 10, border: '1px solid rgba(229,72,77,.25)', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} /> Could not load manufacturing orders. The server may be starting up — try refresh in a moment.
        </div>
      )}

      {/* ── Body: MO list (left) + detail (right) ────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedId != null ? 'minmax(440px, 1.4fr) minmax(360px, 1fr)' : '1fr', gap: 16, alignItems: 'start' }}>
        {/* Left: MO list */}
        <div className="card" style={{ overflow: 'hidden' }}>
          {isLoading ? (
            <div style={{ fontFamily: MONO, fontSize: 12, color: C.ink3, padding: '40px 20px', textAlign: 'center' }}>Loading manufacturing orders…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center' }}>
              <Package size={28} style={{ color: C.ink3, marginBottom: 10 }} />
              <div style={{ fontFamily: SANS, fontSize: 14, color: C.ink2 }}>
                {orders.length === 0 ? 'No manufacturing orders yet.' : 'No MOs match the current filter.'}
              </div>
              {orders.length === 0 && (
                <button className="btn-primary" style={{ marginTop: 14 }} onClick={() => setShowCreate(true)}>
                  <Plus size={15} /> Create the first MO
                </button>
              )}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={TH}>MO</th>
                    <th style={TH}>Customer</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Qty</th>
                    <th style={TH}>Size</th>
                    <th style={TH}>Design</th>
                    <th style={TH}>Priority</th>
                    <th style={TH}>Status</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Linked</th>
                    <th style={{ ...TH, minWidth: 130 }}>Fulfilment</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((mo) => {
                    const isSel = mo.id === selectedId
                    // For the selected row use live UID data; others fall back to uid_count.
                    const stats = computeStats(mo, isSel ? selectedUids : undefined)
                    const meta = FULFIL_META[stats.fulfil]
                    return (
                      <tr
                        key={mo.id}
                        className="row-hover"
                        onClick={() => setSelectedId(isSel ? null : mo.id)}
                        style={{ cursor: 'pointer', background: isSel ? 'var(--accent-dim)' : undefined }}
                      >
                        <td style={{ ...TD, fontFamily: MONO, fontWeight: 700, color: C.accent }}>{mo.mo_number}</td>
                        <td style={{ ...TD, fontFamily: SANS }}>{mo.customer || '—'}</td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: MONO }}>{mo.quantity ?? 0}</td>
                        <td style={{ ...TD, fontFamily: MONO, color: C.ink2 }}>{mo.size_mm != null ? `${mo.size_mm} mm` : '—'}</td>
                        <td style={{ ...TD, fontFamily: MONO, color: mo.design_code ? C.ink : C.ink3 }}>{mo.design_code ?? '—'}</td>
                        <td style={TD}>{priorityPill((mo as any).priority) ?? <span style={{ color: C.ink3 }}>—</span>}</td>
                        <td style={TD}><span className={meta.cls}>{meta.label}</span></td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: MONO }}>{stats.linked}</td>
                        <td style={TD}>
                          <ProgressBar dispatched={stats.dispatched} quantity={mo.quantity ?? 0} fulfil={stats.fulfil} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: MO detail */}
        {selected && (
          <MoDetail
            mo={selected}
            uids={selectedUids}
            loading={uidsLoading}
            onClose={() => setSelectedId(null)}
            onLink={() => setShowLink(true)}
          />
        )}
      </div>

      {/* ── Create MO drawer ─────────────────────────────────────────────── */}
      {showCreate && (
        <CreateMoDrawer
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            qc.invalidateQueries({ queryKey: ['mo-orders'] })
          }}
        />
      )}

      {/* ── Link UIDs drawer ─────────────────────────────────────────────── */}
      {showLink && selected && (
        <LinkUidsDrawer
          mo={selected}
          linkedUids={selectedUids}
          onClose={() => setShowLink(false)}
          onLinked={() => {
            qc.invalidateQueries({ queryKey: ['mo-uids', selected.id] })
            qc.invalidateQueries({ queryKey: ['mo-orders'] })
          }}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22, fontFamily: MONO, fontSize: 10, color: C.ink3, letterSpacing: '0.06em' }}>
        <Clock size={11} /> Live data refreshes every 30s.
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

/* ─── summary stat tile ────────────────────────────────────────────────────── */
function StatTile({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '14px 18px', minWidth: 0 }}>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 700, fontSize: 26, letterSpacing: '-0.03em', lineHeight: 1, color: color ?? C.ink }}>
        {value.toLocaleString()}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3, marginTop: 5 }}>{label}</div>
    </div>
  )
}

/* ─── MO detail panel ──────────────────────────────────────────────────────── */
function MoDetail({
  mo, uids, loading, onClose, onLink,
}: {
  mo: ManufacturingOrder
  uids: UID[]
  loading: boolean
  onClose: () => void
  onLink: () => void
}) {
  const qc = useQueryClient()
  const stats = computeStats(mo, uids)
  const meta = FULFIL_META[stats.fulfil]

  const unlink = useMutation({
    // Unlinking == clearing the UID's MO reference (mo_id 0 ≈ none).
    mutationFn: (uid: UID) => uidApi.linkMO(uid.id, 0).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mo-uids', mo.id] })
      qc.invalidateQueries({ queryKey: ['mo-orders'] })
    },
  })

  return (
    <div className="card animate-es" style={{ padding: '18px 20px', position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.ink3 }}>Manufacturing order</div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em', color: C.ink, marginTop: 2 }}>{mo.mo_number}</div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, marginTop: 2 }}>{mo.customer || 'No customer'}</div>
        </div>
        <button onClick={onClose} className="btn-secondary" style={{ height: 30, width: 30, padding: 0, justifyContent: 'center' }} aria-label="Close">
          <X size={15} />
        </button>
      </div>

      {/* meta grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <Field label="Required qty" value={String(mo.quantity ?? 0)} />
        <Field label="Status" value={<span className={meta.cls}>{meta.label}</span>} />
        <Field label="Size" value={mo.size_mm != null ? `${mo.size_mm} mm` : '—'} />
        <Field label="Design" value={mo.design_code ?? '—'} />
      </div>

      {/* fulfilment tracker */}
      <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3 }}>Fulfilment</span>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.ink2 }}>
            {stats.dispatched} dispatched · {stats.remaining} remaining
          </span>
        </div>
        <ProgressBar dispatched={stats.dispatched} quantity={mo.quantity ?? 0} fulfil={stats.fulfil} />
      </div>

      {mo.notes && (
        <div style={{ fontFamily: SANS, fontSize: 12.5, color: C.ink2, background: C.surface2, borderRadius: 10, padding: '10px 12px' }}>{mo.notes}</div>
      )}

      {/* linked UIDs */}
      <div>
        <SectionLabel
          icon={<Link2 size={13} style={{ color: C.ink3 }} />}
          right={<button className="btn-primary" style={{ height: 30, padding: '0 12px', fontSize: 12 }} onClick={onLink}><Plus size={13} /> Link UIDs</button>}
        >
          Linked UIDs · {uids.length}
        </SectionLabel>

        {loading ? (
          <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.ink3, padding: '14px 0' }}>Loading linked UIDs…</div>
        ) : uids.length === 0 ? (
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink3, padding: '14px 0' }}>No UIDs linked to this MO yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 360, overflowY: 'auto' }}>
            {uids.map((u) => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, background: C.surface2, border: `1px solid ${C.line}` }}>
                <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 12.5, color: C.ink }}>{u.code}</span>
                <UIDStatusBadge status={u.status} />
                <div style={{ flex: 1, minWidth: 0, fontFamily: SANS, fontSize: 11.5, color: C.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.current_step_name ? `${u.current_step_number ?? ''} ${u.current_step_name}` : '—'}
                </div>
                <button
                  className="btn-secondary"
                  style={{ height: 26, padding: '0 8px', fontSize: 11 }}
                  disabled={unlink.isPending}
                  onClick={() => unlink.mutate(u)}
                  title="Unlink from this MO"
                >
                  <Link2Off size={12} /> Unlink
                </button>
              </div>
            ))}
          </div>
        )}
        {unlink.isError && (
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.red, marginTop: 8 }}>
            Unlink may not be supported by the server. The UID reference was not changed.
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: typeof value === 'string' ? MONO : undefined, fontSize: 13, color: C.ink }}>{value}</div>
    </div>
  )
}

/* ─── drawer shell ─────────────────────────────────────────────────────────── */
function Drawer({ title, subtitle, onClose, children, footer, width = 480 }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(21,54,106,.28)' }} />
      <div
        className="animate-es"
        style={{
          position: 'relative', width, maxWidth: '94vw', height: '100%', background: C.surface,
          boxShadow: 'var(--shadow-e5)', display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '18px 22px', borderBottom: `1px solid ${C.line}` }}>
          <div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em', color: C.ink }}>{title}</div>
            {subtitle && <div style={{ fontFamily: SANS, fontSize: 12.5, color: C.ink2, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} className="btn-secondary" style={{ height: 30, width: 30, padding: 0, justifyContent: 'center' }} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>{children}</div>
        {footer && <div style={{ padding: '14px 22px', borderTop: `1px solid ${C.line}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>{footer}</div>}
      </div>
    </div>
  )
}

/* ─── create MO drawer ─────────────────────────────────────────────────────── */
function CreateMoDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [moNumber, setMoNumber] = useState('')
  const [customer, setCustomer] = useState('')
  const [quantity, setQuantity] = useState('')
  const [sizeId, setSizeId] = useState('')
  const [designId, setDesignId] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: sizes = [] } = useQuery<Size[]>({ queryKey: ['mo-sizes'], queryFn: () => productApi.sizes().then((r) => r.data ?? []) })
  const { data: designs = [] } = useQuery<Design[]>({ queryKey: ['mo-designs'], queryFn: () => productApi.designs().then((r) => r.data ?? []) })

  // Designs filtered by selected size (spec: design dropdown filtered by size).
  const sizeIdNum = sizeId ? Number(sizeId) : null
  const filteredDesigns = useMemo(() => {
    if (sizeIdNum == null) return designs
    return designs.filter((d) => !d.valid_size_ids?.length || d.valid_size_ids.includes(sizeIdNum))
  }, [designs, sizeIdNum])

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => manufacturingApi.createOrder(body).then((r) => r.data),
    onSuccess: onCreated,
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Failed to create MO. Check the fields and try again.'),
  })

  const valid = moNumber.trim() !== '' && Number(quantity) > 0

  const submit = () => {
    setError(null)
    const body: Record<string, unknown> = {
      mo_number: moNumber.trim(),
      customer: customer.trim() || null,
      quantity: Number(quantity),
      priority,
    }
    if (sizeId) body.size_id = Number(sizeId)
    if (designId) body.design_id = Number(designId)
    if (deliveryDate) body.required_delivery_date = deliveryDate
    if (notes.trim()) body.notes = notes.trim()
    create.mutate(body)
  }

  return (
    <Drawer
      title="New manufacturing order"
      subtitle="Create an MO; link UIDs to it any time."
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!valid || create.isPending} onClick={submit}>
            {create.isPending ? 'Creating…' : 'Create MO'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label className="label">MO number *</label>
          <input className="input" placeholder="e.g. MO-2026-0142 (from Odoo or manual)" value={moNumber} onChange={(e) => setMoNumber(e.target.value)} />
        </div>
        <div>
          <label className="label">Customer name</label>
          <input className="input" placeholder="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} />
        </div>
        <div>
          <label className="label">Quantity required *</label>
          <input className="input" type="number" min={1} placeholder="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label">Size (mm)</label>
            <select className="input" value={sizeId} onChange={(e) => { setSizeId(e.target.value); setDesignId('') }}>
              <option value="">—</option>
              {sizes.filter((s) => s.is_active).map((s) => (
                <option key={s.id} value={s.id}>{s.value_mm} mm</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Design</label>
            <select className="input" value={designId} onChange={(e) => setDesignId(e.target.value)}>
              <option value="">—</option>
              {filteredDesigns.filter((d) => d.is_active).map((d) => (
                <option key={d.id} value={d.id}>{d.code}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label">Priority</label>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Required delivery date</label>
            <input className="input" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={3} placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && (
          <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.red, padding: '10px 12px', background: 'rgba(229,72,77,.10)', borderRadius: 9, border: '1px solid rgba(229,72,77,.25)' }}>{error}</div>
        )}
      </div>
    </Drawer>
  )
}

/* ─── link UIDs drawer ─────────────────────────────────────────────────────── */
function LinkUidsDrawer({
  mo, linkedUids, onClose, onLinked,
}: {
  mo: ManufacturingOrder
  linkedUids: UID[]
  onClose: () => void
  onLinked: () => void
}) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(0)

  const linkedIds = useMemo(() => new Set(linkedUids.map((u) => u.id)), [linkedUids])

  // Candidate UIDs to link: filter by status, then by code/size/design client-side.
  const { data: result, isLoading } = useQuery({
    queryKey: ['link-candidates', statusFilter],
    queryFn: () => uidApi.list({ status: statusFilter || undefined, limit: 200 }).then((r) => r.data),
    retry: false,
  })
  const allUids: UID[] = result?.items ?? []

  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase()
    return allUids.filter((u) => {
      if (linkedIds.has(u.id)) return false
      if (u.mo_id != null && u.mo_id !== mo.id) return false // already on another MO
      if (term && !u.code.toLowerCase().includes(term)) return false
      // Match the MO's size / design when set (spec: filter by size/design).
      if (mo.size_id != null && u.size_id != null && u.size_id !== mo.size_id) return false
      if (mo.design_id != null && u.design_id != null && u.design_id !== mo.design_id) return false
      return true
    })
  }, [allUids, search, linkedIds, mo.size_id, mo.design_id, mo.id])

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const link = useMutation({
    mutationFn: async (ids: number[]) => {
      let count = 0
      for (const id of ids) {
        await uidApi.linkMO(id, mo.id)
        count++
        setDone(count)
      }
      return count
    },
    onSuccess: () => {
      onLinked()
      onClose()
    },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Failed to link one or more UIDs.'),
  })

  const submit = () => {
    setError(null)
    setDone(0)
    link.mutate([...selected])
  }

  return (
    <Drawer
      title="Link UIDs to MO"
      subtitle={`${mo.mo_number}${mo.customer ? ` · ${mo.customer}` : ''}`}
      width={560}
      onClose={onClose}
      footer={
        <>
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.ink2, marginRight: 'auto', alignSelf: 'center' }}>
            {selected.size} selected{link.isPending ? ` · linking ${done}/${selected.size}…` : ''}
          </span>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={selected.size === 0 || link.isPending} onClick={submit}>
            <Link2 size={14} /> {link.isPending ? 'Linking…' : `Link ${selected.size || ''} UID${selected.size === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {(mo.size_mm != null || mo.design_code) && (
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.ink2, background: C.surface2, borderRadius: 9, padding: '8px 11px' }}>
            Candidates matched to MO spec: {mo.size_mm != null ? `${mo.size_mm} mm` : 'any size'} · {mo.design_code ?? 'any design'}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: C.ink3 }} />
            <input className="input" style={{ paddingLeft: 32 }} placeholder="Search UID code…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" style={{ width: 150 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
            <option value="converted">Converted</option>
            <option value="dispatched">Dispatched</option>
          </select>
        </div>

        {isLoading ? (
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.ink3, padding: '24px 0', textAlign: 'center' }}>Loading UIDs…</div>
        ) : candidates.length === 0 ? (
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink3, padding: '24px 0', textAlign: 'center' }}>No unlinked UIDs match the filter.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {candidates.map((u) => {
              const on = selected.has(u.id)
              return (
                <button
                  key={u.id}
                  onClick={() => toggle(u.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 9, cursor: 'pointer', width: '100%', textAlign: 'left',
                    background: on ? 'var(--accent-dim)' : C.surface2,
                    border: `1px solid ${on ? C.accent : C.line}`,
                  }}
                >
                  <span style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${on ? C.accent : C.ink3}`, background: on ? C.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {on && <CheckCircle size={12} style={{ color: '#fff' }} />}
                  </span>
                  <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 12.5, color: C.ink }}>{u.code}</span>
                  <UIDStatusBadge status={u.status} />
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.ink2 }}>{u.size_mm != null ? `${u.size_mm}mm` : ''} {u.design_code ?? ''}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 10, color: C.ink3 }}>
                    {(() => { try { return formatDistanceToNowStrict(new Date(u.created_at)) } catch { return '' } })()}
                  </span>
                  <ChevronRight size={14} style={{ color: C.ink3 }} />
                </button>
              )
            })}
          </div>
        )}

        {error && (
          <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.red, padding: '10px 12px', background: 'rgba(229,72,77,.10)', borderRadius: 9, border: '1px solid rgba(229,72,77,.25)' }}>{error}</div>
        )}

        <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.ink3, letterSpacing: '0.04em' }}>
          Applying the MO's size and design to selected UIDs is not exposed by the current API; UIDs are linked with their existing attributes.
        </div>
      </div>
    </Drawer>
  )
}
