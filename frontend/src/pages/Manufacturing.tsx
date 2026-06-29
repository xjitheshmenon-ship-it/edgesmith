import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { manufacturingApi } from '../api/client'
import type { ManufacturingOrder, UID } from '../types'
import { Plus, Scissors, List, Columns, X, ChevronRight, Clock, CheckCircle2, XCircle } from 'lucide-react'
import { format } from 'date-fns'
import UIDStatusBadge from '../components/UIDStatusBadge'
import PriorityBadge from '../components/PriorityBadge'

type StatusFilter = 'all' | 'in_progress' | 'completed' | 'open' | 'cancelled'
type ViewMode = 'list' | 'kanban'

const STATUS_META: Record<string, { label: string; dot: string; bg: string; color: string }> = {
  open:        { label: 'Draft',       dot: '#9aa0a6', bg: 'rgba(154,160,166,.14)', color: '#9aa0a6' },
  in_progress: { label: 'In Progress', dot: '#f59e0b', bg: 'rgba(245,158,11,.14)',  color: '#f59e0b' },
  completed:   { label: 'Done',        dot: '#22a06b', bg: 'rgba(34,160,107,.14)',  color: '#22a06b' },
  cancelled:   { label: 'Cancelled',   dot: '#e5484d', bg: 'rgba(229,72,77,.14)',   color: '#e5484d' },
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

// ── UID Detail Panel ──────────────────────────────────────────────────────────

function UIDDetailPanel({ uid, onClose }: { uid: UID; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', padding: 4 }}>
          <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{uid.code}</span>
        <UIDStatusBadge status={uid.status} />
        <PriorityBadge priority={uid.priority} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Key fields grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: 'Cycle', value: uid.cycle_type_name ?? '—' },
            { label: 'Step', value: uid.current_step_number ? `${uid.current_step_number} — ${uid.current_step_name}` : '—' },
            { label: 'Storage', value: uid.current_storage_code ?? '—' },
            { label: 'Size / Design', value: `${uid.size_mm ? uid.size_mm + 'mm' : '—'} / ${uid.design_code ?? 'No design'}` },
            { label: 'Location', value: uid.factory_location_code ?? '—' },
            { label: 'Created', value: uid.created_at ? format(new Date(uid.created_at), 'dd MMM yyyy') : '—' },
          ].map(f => (
            <div key={f.label} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 4 }}>{f.label}</div>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>{f.value}</div>
            </div>
          ))}
        </div>

        {/* Step history */}
        {uid.step_history && uid.step_history.length > 0 && (
          <div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 10 }}>
              Manufacturing History ({uid.step_history.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {uid.step_history.map((h) => (
                <div key={h.id} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ flexShrink: 0, marginTop: 1 }}>
                    {h.qc_result === 'pass' ? (
                      <CheckCircle2 size={14} style={{ color: '#22a06b' }} />
                    ) : h.qc_result === 'fail' ? (
                      <XCircle size={14} style={{ color: 'var(--error)' }} />
                    ) : (
                      <Clock size={14} style={{ color: 'var(--ink-3)' }} />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)' }}>Step {h.step_number}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>{h.operation_name}</span>
                      {h.qc_result && (
                        <span className={h.qc_result === 'pass' ? 'badge-green' : 'badge-red'} style={{ fontSize: 10 }}>QC: {h.qc_result}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-2)', marginTop: 3 }}>
                      {format(new Date(h.performed_at), 'dd MMM yyyy, HH:mm')}
                      {h.performed_by && ` · ${h.performed_by}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── MO Drawer ─────────────────────────────────────────────────────────────────

function MODrawer({ mo, onClose }: { mo: ManufacturingOrder; onClose: () => void }) {
  const [selectedUID, setSelectedUID] = useState<UID | null>(null)
  const meta = statusMeta(mo.status)
  const progress = mo.uid_count > 0 ? Math.round((mo.uid_count / mo.quantity) * 100) : 0

  const { data: uids = [], isLoading } = useQuery<UID[]>({
    queryKey: ['mo-uids', mo.id],
    queryFn: () => manufacturingApi.orderUIDs(mo.id).then((r) => r.data),
  })

  // Status breakdown
  const statusCounts = uids.reduce((acc, u) => {
    acc[u.status] = (acc[u.status] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 40 }}
      />
      {/* Drawer */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: selectedUID ? 800 : 480,
        background: 'var(--surface)',
        borderLeft: '1px solid var(--line)',
        zIndex: 41,
        display: 'flex',
        flexDirection: 'row',
        boxShadow: '-8px 0 32px rgba(0,0,0,.35)',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
      }}>
        {/* UID detail panel (left side when open) */}
        {selectedUID && (
          <div style={{ width: 320, borderRight: '1px solid var(--line)', flexShrink: 0, overflow: 'hidden' }}>
            <UIDDetailPanel uid={selectedUID} onClose={() => setSelectedUID(null)} />
          </div>
        )}

        {/* Main drawer content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 17, color: 'var(--accent)' }}>{mo.mo_number}</div>
                <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600, marginTop: 2 }}>{mo.customer || '—'}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 6, background: meta.bg, color: meta.color, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.dot }} />
                  {meta.label}
                </span>
                <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-2)', display: 'flex', padding: 4 }}>
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                { label: 'Quantity', value: `${mo.quantity} pc` },
                { label: 'UIDs Linked', value: `${mo.uid_count}` },
                { label: 'Created', value: format(new Date(mo.created_at), 'dd MMM yyyy') },
              ].map(f => (
                <div key={f.label} style={{ background: 'var(--surface)', borderRadius: 7, padding: '8px 10px' }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.12em', color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 3 }}>{f.label}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{f.value}</div>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 5, borderRadius: 5, background: 'var(--surface)', overflow: 'hidden' }}>
                <div style={{ width: `${progress}%`, height: '100%', borderRadius: 5, background: meta.dot, transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)', width: 36, textAlign: 'right' }}>{progress}%</span>
            </div>
          </div>

          {/* UID list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Status summary chips */}
            {Object.keys(statusCounts).length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
                {Object.entries(statusCounts).map(([s, count]) => (
                  <span key={s} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, padding: '2px 8px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
                    {s}: {count}
                  </span>
                ))}
              </div>
            )}

            {isLoading && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Loading UIDs…</div>
            )}
            {!isLoading && uids.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>No UIDs linked to this order</div>
            )}
            {uids.map((u) => (
              <div
                key={u.id}
                onClick={() => setSelectedUID(u.id === selectedUID?.id ? null : u)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 16px',
                  borderBottom: '1px solid var(--line)',
                  cursor: 'pointer',
                  background: selectedUID?.id === u.id ? 'var(--surface-2)' : 'transparent',
                  transition: 'background 0.1s',
                  borderLeft: selectedUID?.id === u.id ? '3px solid var(--accent)' : '3px solid transparent',
                }}
                onMouseEnter={e => { if (selectedUID?.id !== u.id) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.04)' }}
                onMouseLeave={e => { if (selectedUID?.id !== u.id) (e.currentTarget as HTMLElement).style.background = '' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>{u.code}</span>
                    <UIDStatusBadge status={u.status} />
                    <PriorityBadge priority={u.priority} />
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
                    {u.current_step_number ? `Step ${u.current_step_number} — ${u.current_step_name}` : 'No active step'}
                    {u.current_storage_code && <span style={{ marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>{u.current_storage_code}</span>}
                  </div>
                </div>
                <ChevronRight size={14} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Manufacturing() {
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('all')
  const [view, setView] = useState<ViewMode>('list')
  const [showCreateMO, setShowCreateMO] = useState(false)
  const [showCreatePattern, setShowCreatePattern] = useState(false)
  const [tab, setTab] = useState<'orders' | 'patterns'>('orders')
  const [selectedMO, setSelectedMO] = useState<ManufacturingOrder | null>(null)
  const qc = useQueryClient()

  const { data: orders = [] } = useQuery<ManufacturingOrder[]>({
    queryKey: ['mo-orders'],
    queryFn: () => manufacturingApi.orders().then((r) => r.data),
  })

  const { data: patterns = [] } = useQuery<{ id: number; name: string; input_length_mm: number; output_lengths_mm: number[]; kerf_mm: number; num_cuts: number; scrap_mm: number; is_active: boolean }[]>({
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
                    onClick={() => setSelectedMO(m)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '148px 1fr 90px 104px 150px 120px',
                      gap: 16,
                      padding: '14px 22px',
                      borderBottom: i < filtered.length - 1 ? '1px solid var(--line)' : 'none',
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'}
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
                    {col.map(m => {
                      const progress = m.uid_count > 0 ? Math.round((m.uid_count / m.quantity) * 100) : 0
                      return (
                        <div
                          key={m.id}
                          className="card"
                          onClick={() => setSelectedMO(m)}
                          style={{ padding: '12px 14px', marginBottom: 8, cursor: 'pointer' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)'}
                        >
                          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>{m.mo_number}</div>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{m.customer || '—'}</div>
                          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-2)', marginTop: 2 }}>{m.quantity} pc · {m.uid_count} UIDs</div>
                          {m.uid_count > 0 && (
                            <div style={{ marginTop: 8, height: 3, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
                              <div style={{ width: `${progress}%`, height: '100%', borderRadius: 3, background: meta.dot }} />
                            </div>
                          )}
                        </div>
                      )
                    })}
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

      {selectedMO && <MODrawer mo={selectedMO} onClose={() => setSelectedMO(null)} />}
      {showCreateMO && <CreateMOModal onClose={() => { setShowCreateMO(false); qc.invalidateQueries({ queryKey: ['mo-orders'] }) }} />}
      {showCreatePattern && <CreatePatternModal onClose={() => { setShowCreatePattern(false); qc.invalidateQueries({ queryKey: ['patterns'] }) }} />}
    </div>
  )
}

const dinput: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, boxSizing: 'border-box',
  background: 'var(--surface-3)', border: '1px solid var(--line)', color: 'var(--ink)',
  fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, outline: 'none',
}
const dlabel: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.1em',
  color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 6, display: 'block',
}

function DrawerShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <style>{`@keyframes es-drawer { from { transform: translateX(24px); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,45,.52)', backdropFilter: 'blur(3px)', zIndex: 40 }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 460,
        background: 'var(--surface)', borderLeft: '1px solid var(--line)',
        zIndex: 41, display: 'flex', flexDirection: 'column',
        animation: 'es-drawer .28s cubic-bezier(.2,.8,.2,1) both',
      }}>
        {children}
      </aside>
    </>
  )
}

function CreateMOModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ mo_number: '', customer: '', quantity: 1, notes: '' })
  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => manufacturingApi.createOrder(data).then((r) => r.data),
    onSuccess: onClose,
  })
  const errMsg = (mutation.error as any)?.response?.data?.detail ?? 'Failed to create order'

  return (
    <DrawerShell onClose={onClose}>
      <div style={{ padding: '18px 22px', borderBottom: 'var(--line)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>New Manufacturing Order</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginTop: 3 }}>PRODUCTION RECORD</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-2)', padding: 4 }}><X size={18} /></button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div><label style={dlabel}>MO Number</label><input style={dinput} value={form.mo_number} onChange={e => setForm({ ...form, mo_number: e.target.value })} /></div>
        <div><label style={dlabel}>Customer</label><input style={dinput} value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })} /></div>
        <div><label style={dlabel}>Quantity</label><input style={dinput} type="number" min={1} value={form.quantity} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })} /></div>
        <div><label style={dlabel}>Notes</label><textarea style={{ ...dinput, resize: 'vertical' }} rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        {mutation.error && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--error)', border: 'var(--error)', color: 'var(--error)', fontSize: 13 }}>{errMsg}</div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px 0', borderRadius: 9, border: 'var(--line)', background: 'transparent', color: 'var(--ink-2)', cursor: 'pointer', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13 }}>Cancel</button>
          <button disabled={mutation.isPending} onClick={() => mutation.mutate({ ...form, quantity: Number(form.quantity) })} style={{ flex: 2, padding: '10px 0', borderRadius: 9, border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', cursor: 'pointer', fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 13 }}>
            {mutation.isPending ? 'Creating…' : 'Create Order'}
          </button>
        </div>
      </div>
    </DrawerShell>
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
    <DrawerShell onClose={onClose}>
      <div style={{ padding: '18px 22px', borderBottom: 'var(--line)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>New Conversion Pattern</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginTop: 3 }}>CUT LAYOUT</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-2)', padding: 4 }}><X size={18} /></button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div><label style={dlabel}>Pattern Name</label><input style={dinput} value={name} onChange={e => setName(e.target.value)} /></div>
        <div><label style={dlabel}>Input Length (mm)</label><input style={dinput} type="number" value={inputLen} onChange={e => setInputLen(Number(e.target.value))} /></div>
        <div><label style={dlabel}>Output Lengths (comma-separated mm)</label><input style={dinput} value={outputs} onChange={e => setOutputs(e.target.value)} placeholder="1500,1500,1424" /></div>
        <div><label style={dlabel}>Kerf per cut (mm)</label><input style={dinput} type="number" value={kerf} onChange={e => setKerf(Number(e.target.value))} /></div>

        {/* Live preview */}
        <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--surface-2)', border: 'var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 2 }}>Preview</div>
          {[
            { label: 'Cuts', value: String(numCuts), color: 'var(--ink)' },
            { label: 'Total output', value: `${parsedOutputs.reduce((a, b) => a + b, 0)} mm`, color: 'var(--ink)' },
            { label: 'Kerf loss', value: `${numCuts * kerf} mm`, color: 'var(--ink-2)' },
            { label: 'Scrap', value: `${scrap} mm`, color: scrap < 0 ? 'var(--error)' : '#22a06b' },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--ink-2)' }}>{r.label}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: r.color }}>{r.value}</span>
            </div>
          ))}
        </div>

        {mutation.error && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--error)', border: 'var(--error)', color: 'var(--error)', fontSize: 13 }}>Failed to create pattern</div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px 0', borderRadius: 9, border: 'var(--line)', background: 'transparent', color: 'var(--ink-2)', cursor: 'pointer', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13 }}>Cancel</button>
          <button disabled={mutation.isPending || scrap < 0} onClick={() => mutation.mutate({ name, input_length_mm: inputLen, output_lengths_mm: parsedOutputs, kerf_mm: kerf })} style={{ flex: 2, padding: '10px 0', borderRadius: 9, border: 'none', background: scrap < 0 ? 'var(--surface-2)' : 'var(--accent)', color: scrap < 0 ? 'var(--ink-3)' : 'var(--accent-ink)', cursor: scrap < 0 ? 'not-allowed' : 'pointer', fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 13 }}>
            {mutation.isPending ? 'Creating…' : 'Create Pattern'}
          </button>
        </div>
      </div>
    </DrawerShell>
  )
}
