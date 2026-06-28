import { useQuery } from '@tanstack/react-query'
import { shopfloorApi } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import type { DashboardSummary, ShopfloorStatus } from '../types'
import { Package, AlertTriangle, CheckCircle, ClipboardList, TrendingUp } from 'lucide-react'

function StatCard({ label, value, icon, iconBg, iconColor }: {
  label: string; value: number | string
  icon: React.ReactNode; iconBg: string; iconColor: string
}) {
  return (
    <div className="card" style={{ padding: '20px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--ink-2)', marginBottom: 8 }}>{label}</div>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 30, letterSpacing: '-0.03em', color: 'var(--ink)', lineHeight: 1 }}>{value}</div>
      </div>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: iconBg, color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
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
    <div style={{ padding: '24px 28px 60px' }}>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--ink)' }}>Dashboard</div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink-2)', marginTop: 3 }}>Welcome back, {user?.full_name}</div>
      </div>

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 24 }}>
          <StatCard label="Active UIDs"  value={summary.uid_active.toLocaleString()} icon={<Package size={22} />}      iconBg="#dbeafe" iconColor="#1d4ed8" />
          <StatCard label="On Hold"      value={summary.uid_on_hold}                 icon={<AlertTriangle size={22} />}  iconBg="#fef3c7" iconColor="#b45309" />
          <StatCard label="Dispatched"   value={summary.uid_dispatched.toLocaleString()} icon={<CheckCircle size={22} />} iconBg="#dcfce7" iconColor="#15803d" />
          <StatCard label="Open Orders"  value={summary.open_manufacturing_orders}   icon={<ClipboardList size={22} />}  iconBg="#f3e8ff" iconColor="#7c3aed" />
        </div>
      )}

      {summary && (summary.priority_urgent > 0 || summary.priority_high > 0) && (
        <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.25)', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <TrendingUp size={16} style={{ color: 'var(--error)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--error)', fontWeight: 500 }}>
            {summary.priority_urgent} urgent + {summary.priority_high} high-priority UIDs in production
          </span>
        </div>
      )}

      {shopfloor && shopfloor.map((loc) => (
        <div key={loc.location_id} className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
          {/* Location header */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-2)' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{loc.location_name}</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-2)', marginTop: 2 }}>
                {loc.total_active_uids} active UIDs · {loc.on_hold} on hold
              </div>
            </div>
            <span className="badge-blue">{loc.location_code}</span>
          </div>

          <div style={{ padding: '16px 20px' }}>
            {/* Storage */}
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 12 }}>Storage</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 20 }}>
              {loc.storage_locations.map((s) => (
                <div key={s.storage_id} style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 20, color: s.uid_count > 0 ? 'var(--accent)' : 'var(--ink-3)' }}>{s.uid_count}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>{s.code}</div>
                </div>
              ))}
            </div>

            {/* Workstations */}
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 10 }}>Workstations with active UIDs</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {loc.workstations.filter(w => w.uid_count > 0).map(w => (
                <div key={w.workstation_id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px' }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{w.code}</span>
                  <span className="badge-blue">{w.uid_count}</span>
                </div>
              ))}
              {loc.workstations.filter(w => w.uid_count > 0).length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace" }}>No UIDs at any workstation</div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
