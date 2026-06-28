import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { uidApi, factoryApi, cycleApi, productApi } from '../api/client'
import type { UID, FactoryLocation, CycleType, Size, Design } from '../types'
import UIDStatusBadge from '../components/UIDStatusBadge'
import PriorityBadge from '../components/PriorityBadge'
import { useAuth } from '../hooks/useAuth'
import { Plus, Search, Download } from 'lucide-react'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'

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
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">UIDs</h1>
          <p className="text-sm text-gray-500">{result?.total?.toLocaleString() ?? 0} total</p>
        </div>
        {(user?.role === 'admin' || user?.role === 'manager') && (
          <button className="btn-primary" onClick={() => setShowBulkCreate(true)}>
            <Plus size={16} /> Bulk Create
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9 w-48"
            placeholder="Search UID…"
            value={search}
            onChange={(e) => setSearch(e.target.value.toUpperCase())}
          />
        </div>
        {locations && (
          <select className="input w-48" value={locFilter ?? ''} onChange={(e) => setLocFilter(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">All locations</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">UID</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Priority</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Cycle</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Step</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Storage</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Size / Design</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Location</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">MO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {uids.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/uid-lookup`} onClick={() => {}} className="font-mono font-semibold text-brand-600 hover:underline">
                      {u.code}
                    </Link>
                    {u.parent_uid_code && <div className="text-xs text-gray-400">↳ {u.parent_uid_code}</div>}
                  </td>
                  <td className="px-4 py-3"><UIDStatusBadge status={u.status} /></td>
                  <td className="px-4 py-3"><PriorityBadge priority={u.priority} /></td>
                  <td className="px-4 py-3">{u.cycle_type_name}</td>
                  <td className="px-4 py-3">
                    {u.current_step_number && (
                      <div>
                        <span className="font-medium">{u.current_step_number}</span>
                        <div className="text-xs text-gray-400">{u.current_step_name}</div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{u.current_storage_code ?? '—'}</td>
                  <td className="px-4 py-3 text-xs">
                    {u.size_mm ? `${u.size_mm}mm` : '—'} / {u.design_code ?? 'No design'}
                    {!u.design_confirmed && <span className="ml-1 badge-yellow">⚠</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">{u.factory_location_code}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{u.mo_number ?? '—'}</td>
                </tr>
              ))}
              {uids.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No UIDs found</td></tr>
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Bulk Create UIDs</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="p-5">
          {!result ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Quantity (max 500)</label>
                <input className="input" type="number" min={1} max={500} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} required />
              </div>
              <div>
                <label className="label">Cycle Type</label>
                <select className="input" value={form.cycle_type_id} onChange={(e) => setForm({ ...form, cycle_type_id: e.target.value })} required>
                  <option value="">Select…</option>
                  {cycles?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Factory Location</label>
                <select className="input" value={form.factory_location_id} onChange={(e) => setForm({ ...form, factory_location_id: e.target.value })} required>
                  <option value="">Select…</option>
                  {locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Priority</label>
                <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              {mutation.error && <p className="text-sm text-red-600">Failed to create UIDs</p>}
              <div className="flex gap-3 justify-end">
                <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={mutation.isPending}>
                  {mutation.isPending ? 'Creating…' : `Create ${form.quantity} UIDs`}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="text-center py-4">
                <div className="text-4xl font-bold text-green-600">{result.created}</div>
                <div className="text-gray-500 text-sm mt-1">UIDs created</div>
              </div>
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {result.uids.map((u) => (
                  <div key={u.id} className="px-3 py-2 font-mono text-sm">{u.code}</div>
                ))}
              </div>
              <div className="flex gap-3 justify-end">
                <button className="btn-secondary" onClick={onClose}>Close</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
