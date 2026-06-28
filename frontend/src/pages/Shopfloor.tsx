import { useQuery } from '@tanstack/react-query'
import { shopfloorApi, factoryApi } from '../api/client'
import type { ShopfloorStatus, FactoryLocation } from '../types'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { format } from 'date-fns'

const CATEGORY_COLORS: Record<string, string> = {
  'Cutting': 'bg-red-50 border-red-200',
  'Heat Treatment': 'bg-orange-50 border-orange-200',
  'Machining': 'bg-blue-50 border-blue-200',
  'Grinding': 'bg-purple-50 border-purple-200',
  'Coating': 'bg-teal-50 border-teal-200',
  'QC': 'bg-green-50 border-green-200',
  'Packing': 'bg-gray-50 border-gray-200',
  'Other': 'bg-gray-50 border-gray-200',
}

export default function Shopfloor() {
  const [selectedLoc, setSelectedLoc] = useState<number | undefined>()
  const [now, setNow] = useState(new Date())

  const { data: locations } = useQuery<FactoryLocation[]>({
    queryKey: ['locations'],
    queryFn: () => factoryApi.locations().then((r) => r.data),
  })

  const { data: status, refetch, isFetching } = useQuery<ShopfloorStatus[]>({
    queryKey: ['shopfloor-full', selectedLoc],
    queryFn: () => shopfloorApi.status(selectedLoc).then((r) => r.data),
    refetchInterval: 20_000,
    onSuccess: () => setNow(new Date()),
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shopfloor Live View</h1>
          <p className="text-xs text-gray-400">Last updated: {format(now, 'HH:mm:ss')}</p>
        </div>
        <div className="flex items-center gap-3">
          {locations && (
            <select
              className="input w-48"
              value={selectedLoc ?? ''}
              onChange={(e) => setSelectedLoc(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">All locations</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <button className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {status && status.map((loc) => (
        <div key={loc.location_id} className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="font-bold text-lg text-gray-900">{loc.location_name}</h2>
            <div className="flex gap-2">
              <span className="badge-blue">{loc.total_active_uids} active</span>
              {loc.on_hold > 0 && <span className="badge-yellow flex items-center gap-1"><AlertTriangle size={12} />{loc.on_hold} on hold</span>}
            </div>
          </div>

          {/* Storage grid */}
          <div className="card p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Storage Locations</h3>
            <div className="grid grid-cols-5 sm:grid-cols-10 gap-3">
              {loc.storage_locations.map((s) => (
                <div key={s.storage_id} className="text-center p-2 rounded-lg bg-gray-50 border border-gray-200">
                  <div className={`text-xl font-bold ${s.uid_count > 0 ? 'text-brand-600' : 'text-gray-300'}`}>
                    {s.uid_count}
                  </div>
                  <div className="text-xs text-gray-500 font-medium">{s.code}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Workstations grouped by category */}
          {(() => {
            const grouped: Record<string, typeof loc.workstations> = {}
            loc.workstations.forEach((w) => {
              if (!grouped[w.category]) grouped[w.category] = []
              grouped[w.category].push(w)
            })
            return Object.entries(grouped).map(([cat, wsList]) => (
              <div key={cat} className="card p-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{cat}</h3>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {wsList.map((w) => (
                    <div
                      key={w.workstation_id}
                      className={`p-3 rounded-lg border ${CATEGORY_COLORS[cat] ?? 'bg-gray-50 border-gray-200'} ${w.uid_count > 0 ? 'shadow-sm' : 'opacity-50'}`}
                    >
                      <div className={`text-2xl font-bold ${w.uid_count > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                        {w.uid_count}
                      </div>
                      <div className="text-xs font-medium text-gray-700">{w.code}</div>
                      <div className="text-xs text-gray-400 truncate">{w.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          })()}
        </div>
      ))}
    </div>
  )
}
