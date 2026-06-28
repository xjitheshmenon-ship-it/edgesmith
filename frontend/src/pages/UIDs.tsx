import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { uidApi, factoryApi, cycleApi } from '../api/client'
import type { UID, FactoryLocation, CycleType } from '../types'
import UIDStatusBadge from '../components/UIDStatusBadge'
import PriorityBadge from '../components/PriorityBadge'
import { useAuth } from '../hooks/useAuth'
import { Plus, Search } from 'lucide-react'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'

const TH: React.CSSProperties = { padding: '10px 16px', textAlign: 'left', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--ink-2)', fontWeight: 500, background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }
const TD: React.CSSProperties = { padding: '11px 16px', fontSize: 13, color: 'var(--ink)', borderBottom: '1px solid var(--line)' }

export default function UIDs() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [locFilter, setLocFilter] = useState<number | undefined>()
  const [showBulkCreate, setShowBulkCreate] = useState(false)

  const { data: result } = useQuery({
    queryKey: ['uids', search, locFilter],
    queryFn: () => uidApi.list({ search, location_id: locFilter, limit: 200 }).then((r) => r.data),
  })

  const { data: locations } = useQuery<FactoryLocation[]>({
    queryKey: ['locations'],
    queryFn: () => factoryApi.locations().then((r) => r.data),
  })

  const uids: UID[] = result?.items ?? []

  return (
    <div style={{ padding: '24px 28px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--ink)' }}>UIDs</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-2)', marginTop: 3 }}>{result?.total?.toLocaleString() ?? 0} total</div>
        </div>
        {(user?.role === 'admin' || user?.role === 'manager') && (
          <button className="btn-primary" onClick={() => setShowBulkCreate(true)}>
            <Plus size={16} /> Bulk Create
          </button>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', pointerEvents: 'none' }} />
          <input
            className="input"
            style={{ paddingLeft: 32, width: 180 }}
            placeholder="Search UID…"
            value={search}
            onChange={(e) => setSearch(e.target.value.toUpperCase())}
          />
        </div>
        {locations && (
          <select className="input" style={{ width: 180 }} value={locFilter ?? ''} onChange={(e) => setLocFilter(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">All locations</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
      </div>

      <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={TH}>UID</th>
                <th style={TH}>Status</th>
                <th style={TH}>Priority</th>
                <th style={TH}>Cycle</th>
                <th style={TH}>Step</th>
                <th style={TH}>Storage</th>
                <th style={TH}>Size / Design</th>
                <th style={TH}>Location</th>
                <th style={TH}>MO</th>
              </tr>
            </thead>
            <tbody>
              {uids.map((u) => (
                <tr key={u.id}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  <td style={TD}>
                    <Link to="/uid-lookup" style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}>
                      {u.code}
                    </Link>
                    {u.parent_uid_code && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>↳ {u.parent_uid_code}</div>}
                  </td>
                  <td style={TD}><UIDStatusBadge status={u.status} /></td>
                  <td style={TD}><PriorityBadge priority={u.priority} /></td>
                  <td style={{ ...TD, color: 'var(--ink-2)' }}>{u.cycle_type_name}</td>
                  <td style={TD}>
                    {u.current_step_number && (
                      <div>
                        <span style={{ fontWeight: 600 }}>{u.current_step_number}</span>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{u.current_step_name}</div>
                      </div>
                    )}
                  </td>
                  <td style={{ ...TD, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>{u.current_storage_code ?? '—'}</td>
                  <td style={{ ...TD, fontSize: 12 }}>
                    {u.size_mm ? `${u.size_mm}mm` : '—'} / {u.design_code ?? 'No design'}
                    {!u.design_confirmed && <span className="badge-yellow" style={{ marginLeft: 4 }}>⚠</span>}
                  </td>
                  <td style={{ ...TD, fontSize: 12, color: 'var(--ink-2)' }}>{u.factory_location_code}</td>
                  <td style={{ ...TD, fontSize: 12, color: 'var(--ink-2)' }}>{u.mo_number ?? '—'}</td>
                </tr>
              ))}
              {uids.length === 0 && (
                <tr><td colSpan={9} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>No UIDs found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showBulkCreate && <BulkCreateModal onClose={() => { setShowBulkCreate(false); qc.invalidateQueries({ queryKey: ['uids'] }) }} />}
    </div>
  )
}

function BulkCreateModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ quantity: 1, cycle_type_id: '', factory_location_id: '', priority: 'normal' })
  const [result, setResult] = useState<{ created: number; uids: { id: number; code: string }[] } | null>(null)

  const { data: cycles } = useQuery<CycleType[]>({ queryKey: ['cycles'], queryFn: () => cycleApi.list().then((r) => r.data) })
  const { data: locations } = useQuery<FactoryLocation[]>({ queryKey: ['locations'], queryFn: () => factoryApi.locations().then((r) => r.data) })

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => uidApi.bulkCreate(data).then((r) => r.data),
    onSuccess: (data) => setResult(data),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutation.mutate({ ...form, quantity: Number(form.quantity), cycle_type_id: Number(form.cycle_type_id), factory_location_id: Number(form.factory_location_id) })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div className="card" style={{ width: '100%', maxWidth: 440, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>Bulk Create UIDs</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-2)', fontSize: 20, lineHeight: 1 }}>&times;</button>
        </div>
        <div style={{ padding: 20 }}>
          {!result ? (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><label className="label">Quantity (max 500)</label><input className="input" type="number" min={1} max={500} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} required /></div>
              <div><label className="label">Cycle Type</label><select className="input" value={form.cycle_type_id} onChange={(e) => setForm({ ...form, cycle_type_id: e.target.value })} required><option value="">Select…</option>{cycles?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="label">Factory Location</label><select className="input" value={form.factory_location_id} onChange={(e) => setForm({ ...form, factory_location_id: e.target.value })} required><option value="">Select…</option>{locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
              <div><label className="label">Priority</label><select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
              {mutation.error && <p style={{ fontSize: 13, color: 'var(--error)' }}>Failed to create UIDs</p>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Creating…' : `Create ${form.quantity} UIDs`}</button>
              </div>
            </form>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 40, color: 'var(--accent)' }}>{result.created}</div>
                <div style={{ color: 'var(--ink-2)', fontSize: 13, marginTop: 4 }}>UIDs created</div>
              </div>
              <div style={{ maxHeight: 192, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                {result.uids.map((u) => (
                  <div key={u.id} style={{ padding: '8px 12px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: 'var(--ink)', borderBottom: '1px solid var(--line)' }}>{u.code}</div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn-secondary" onClick={onClose}>Close</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
