import { useQuery } from '@tanstack/react-query'
import { shopfloorApi } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import type { DashboardSummary, ShopfloorStatus } from '../types'
import { Package, AlertTriangle, CheckCircle, TrendingUp, ClipboardList } from 'lucide-react'

function StatCard({ label, value, icon, color }: { label: string; value: number | string; icon: React.ReactNode; color: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const { data: summary } = useQuery<DashboardSummary>({
    queryKey: ['dashboard'],
    queryFn: () => shopfloorApi.dashboard().then((r) => r.data),
    refetchInterval: 15_000,
  })
  const { data: shopfloor } = useQuery<ShopfloorStatus[]>({
    queryKey: ['shopfloor'],
    queryFn: () => shopfloorApi.status().then((r) => r.data),
    refetchInterval: 15_000,
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Welcome back, {user?.full_name}</p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Active UIDs" value={summary.uid_active.toLocaleString()} icon={<Package size={22} className="text-blue-600" />} color="bg-blue-50" />
          <StatCard label="On Hold" value={summary.uid_on_hold} icon={<AlertTriangle size={22} className="text-yellow-600" />} color="bg-yellow-50" />
          <StatCard label="Dispatched" value={summary.uid_dispatched.toLocaleString()} icon={<CheckCircle size={22} className="text-green-600" />} color="bg-green-50" />
          <StatCard label="Open MOs" value={summary.open_manufacturing_orders} icon={<ClipboardList size={22} className="text-purple-600" />} color="bg-purple-50" />
        </div>
      )}

      {summary && (summary.priority_urgent > 0 || summary.priority_high > 0) && (
        <div className="card p-4 border-l-4 border-red-400 bg-red-50">
          <div className="flex gap-2 items-center">
            <TrendingUp size={18} className="text-red-600" />
            <span className="text-sm font-medium text-red-800">
              {summary.priority_urgent} urgent + {summary.priority_high} high-priority UIDs in production
            </span>
          </div>
        </div>
      )}

      {/* Per-location status */}
      {shopfloor && shopfloor.map((loc) => (
        <div key={loc.location_id} className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
            <div>
              <h2 className="font-semibold text-gray-900">{loc.location_name}</h2>
              <p className="text-sm text-gray-500">{loc.total_active_uids} active UIDs · {loc.on_hold} on hold</p>
            </div>
            <span className="text-xs badge badge-blue">{loc.location_code}</span>
          </div>

          <div className="p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Storage</h3>
            <div className="grid grid-cols-5 gap-2">
              {loc.storage_locations.map((s) => (
                <div key={s.storage_id} className="text-center">
                  <div className={`text-lg font-bold ${s.uid_count > 0 ? 'text-brand-600' : 'text-gray-300'}`}>
                    {s.uid_count}
                  </div>
                  <div className="text-xs text-gray-500">{s.code}</div>
                </div>
              ))}
            </div>

            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-4 mb-3">Workstations with active UIDs</h3>
            <div className="flex flex-wrap gap-2">
              {loc.workstations.filter((w) => w.uid_count > 0).map((w) => (
                <div key={w.workstation_id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <span className="text-sm font-medium text-gray-700">{w.code}</span>
                  <span className="badge-blue text-xs">{w.uid_count}</span>
                </div>
              ))}
              {loc.workstations.filter((w) => w.uid_count > 0).length === 0 && (
                <p className="text-sm text-gray-400">No UIDs currently at any workstation</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
