import { useState, FormEvent } from 'react'
import { Search, Clock, CheckCircle2, XCircle, AlertCircle, ChevronRight } from 'lucide-react'
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
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">UID Lookup</h1>
        <p className="text-sm text-gray-500">Look up any piece by its UID for full manufacturing history</p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3">
        <input
          className="input max-w-xs"
          placeholder="Enter UID (e.g. E043)"
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          autoFocus
        />
        <button type="submit" className="btn-primary" disabled={loading}>
          <Search size={16} /> {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm">
          <XCircle size={16} /> {error}
        </div>
      )}

      {uid && (
        <div className="space-y-4">
          {/* Header card */}
          <div className="card p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold font-mono text-gray-900">{uid.code}</h2>
                  <UIDStatusBadge status={uid.status} />
                  <PriorityBadge priority={uid.priority} />
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {uid.cycle_type_name} cycle · {uid.factory_location_code}
                </p>
              </div>
              {uid.parent_uid_code && (
                <div className="text-right text-sm text-gray-500">
                  <p className="font-medium">Child of</p>
                  <p className="font-mono text-gray-700">{uid.parent_uid_code}</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t border-gray-100">
              <div>
                <p className="text-xs text-gray-400">Current Step</p>
                <p className="text-sm font-medium">{uid.current_step_number ? `${uid.current_step_number} — ${uid.current_step_name}` : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Storage</p>
                <p className="text-sm font-medium">{uid.current_storage_code ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Size / Design</p>
                <p className="text-sm font-medium">{uid.size_mm ? `${uid.size_mm}mm` : '—'} · {uid.design_code ?? 'No design'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">MO Number</p>
                <p className="text-sm font-medium">{uid.mo_number ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Design Confirmed</p>
                <p className="text-sm font-medium">{uid.design_confirmed ? '✅ Yes' : '❌ No'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Created</p>
                <p className="text-sm font-medium">{format(new Date(uid.created_at), 'dd MMM yyyy')}</p>
              </div>
            </div>
          </div>

          {/* Children */}
          {uid.children.length > 0 && (
            <div className="card p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Child UIDs</h3>
              <div className="flex flex-wrap gap-2">
                {uid.children.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setQuery(c.code)}
                    className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 text-sm font-mono"
                  >
                    {c.code} <UIDStatusBadge status={c.status} />
                    <ChevronRight size={14} className="text-gray-400" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step history */}
          {uid.step_history && uid.step_history.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
                <h3 className="font-semibold text-gray-900">Manufacturing History ({uid.step_history.length} steps)</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {uid.step_history.map((h) => (
                  <div key={h.id} className="px-5 py-3 flex items-start gap-4">
                    <div className="flex-shrink-0 mt-0.5">
                      {h.qc_result === 'pass' ? (
                        <CheckCircle2 size={16} className="text-green-500" />
                      ) : h.qc_result === 'fail' ? (
                        <XCircle size={16} className="text-red-500" />
                      ) : (
                        <Clock size={16} className="text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs badge-gray">Step {h.step_number}</span>
                        <span className="text-sm font-medium">{h.operation_name}</span>
                        {h.workstation_code && <span className="text-xs text-gray-400">@ {h.workstation_code}</span>}
                        {h.qc_result && (
                          <span className={h.qc_result === 'pass' ? 'badge-green text-xs' : 'badge-red text-xs'}>
                            QC: {h.qc_result}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                        <span>{format(new Date(h.performed_at), 'dd MMM yyyy, HH:mm')}</span>
                        {h.performed_by && <span>by {h.performed_by}</span>}
                        {h.notes && <span className="text-gray-400">{h.notes}</span>}
                      </div>
                      {h.child_uids_created && h.child_uids_created.length > 0 && (
                        <div className="mt-1 text-xs text-blue-600">Created children: {h.child_uids_created.join(', ')}</div>
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
