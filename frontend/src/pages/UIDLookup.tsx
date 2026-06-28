import { useState, FormEvent } from 'react'
import { Search, Clock, CheckCircle2, XCircle, ChevronRight } from 'lucide-react'
import { uidApi } from '../api/client'
import type { UID } from '../types'
import UIDStatusBadge from '../components/UIDStatusBadge'
import PriorityBadge from '../components/PriorityBadge'
import { format } from 'date-fns'

export default function UIDLookup() {
  const [query, setQuery] = useState('')
  const [uid, setUID] = useState<UID | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError('')
    setUID(null)
    try {
      const { data } = await uidApi.lookup(query.trim())
      setUID(data)
    } catch (err: unknown) {
      const e = err as { response?: { status: number } }
      setError(e.response?.status === 404 ? `UID "${query}" not found` : 'Lookup failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 860 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--ink)' }}>UID Lookup</div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink-2)', marginTop: 3 }}>Look up any piece by its UID for full manufacturing history</div>
      </div>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Enter UID (e.g. E043)" value={query} onChange={(e) => setQuery(e.target.value.toUpperCase())} autoFocus />
        <button type="submit" className="btn-primary" disabled={loading}><Search size={16} /> {loading ? 'Searching…' : 'Search'}</button>
      </form>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--error)', fontSize: 13, marginBottom: 16 }}>
          <XCircle size={15} /> {error}
        </div>
      )}

      {uid && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Header card */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 22, color: 'var(--ink)' }}>{uid.code}</span>
                  <UIDStatusBadge status={uid.status} />
                  <PriorityBadge priority={uid.priority} />
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>{uid.cycle_type_name} cycle · {uid.factory_location_code}</div>
              </div>
              {uid.parent_uid_code && (
                <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--ink-2)' }}>
                  <div style={{ fontWeight: 500 }}>Child of</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--ink)', marginTop: 2 }}>{uid.parent_uid_code}</div>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
              {[
                { label: 'Current Step', value: uid.current_step_number ? `${uid.current_step_number} — ${uid.current_step_name}` : '—' },
                { label: 'Storage', value: uid.current_storage_code ?? '—' },
                { label: 'Size / Design', value: `${uid.size_mm ? `${uid.size_mm}mm` : '—'} · ${uid.design_code ?? 'No design'}` },
                { label: 'MO Number', value: uid.mo_number ?? '—' },
                { label: 'Design Confirmed', value: uid.design_confirmed ? '✅ Yes' : '❌ No' },
                { label: 'Created', value: format(new Date(uid.created_at), 'dd MMM yyyy') },
              ].map(f => (
                <div key={f.label}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)', marginBottom: 4 }}>{f.label}</div>
                  <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{f.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Children */}
          {uid.children.length > 0 && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', marginBottom: 12 }}>Child UIDs</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {uid.children.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setQuery(c.code)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px', background: 'var(--surface-2)', cursor: 'pointer', fontSize: 13, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--ink)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)'}
                  >
                    {c.code} <UIDStatusBadge status={c.status} />
                    <ChevronRight size={13} style={{ color: 'var(--ink-3)' }} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step history */}
          {uid.step_history && uid.step_history.length > 0 && (
            <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Manufacturing History ({uid.step_history.length} steps)</div>
              </div>
              <div>
                {uid.step_history.map((h) => (
                  <div key={h.id} style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flexShrink: 0, marginTop: 2 }}>
                      {h.qc_result === 'pass' ? (
                        <CheckCircle2 size={15} style={{ color: '#22a06b' }} />
                      ) : h.qc_result === 'fail' ? (
                        <XCircle size={15} style={{ color: 'var(--error)' }} />
                      ) : (
                        <Clock size={15} style={{ color: 'var(--ink-3)' }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="badge-gray" style={{ fontSize: 11 }}>Step {h.step_number}</span>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{h.operation_name}</span>
                        {h.workstation_code && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>@ {h.workstation_code}</span>}
                        {h.qc_result && (
                          <span className={h.qc_result === 'pass' ? 'badge-green' : 'badge-red'} style={{ fontSize: 11 }}>QC: {h.qc_result}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4, fontSize: 12, color: 'var(--ink-2)' }}>
                        <span>{format(new Date(h.performed_at), 'dd MMM yyyy, HH:mm')}</span>
                        {h.performed_by && <span>by {h.performed_by}</span>}
                        {h.notes && <span style={{ color: 'var(--ink-3)' }}>{h.notes}</span>}
                      </div>
                      {h.child_uids_created && h.child_uids_created.length > 0 && (
                        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--info)' }}>Created children: {h.child_uids_created.join(', ')}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
