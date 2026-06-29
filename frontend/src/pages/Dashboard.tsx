import { useQuery } from '@tanstack/react-query'
import { shopfloorApi, shiftApi } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import type { DashboardSummary, ShopfloorStatus } from '../types'
import { Package, AlertTriangle, CheckCircle, ClipboardList, TrendingUp, Box, Zap, ChevronRight, FileClock, Flame, Truck } from 'lucide-react'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'

function StatCard({ label, value, icon, color }: {
  label: string; value: number | string; icon: React.ReactNode; color: string
}) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--line)',
      borderRadius: 11,
      padding: '18px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      boxShadow: 'var(--shadow-e1)',
    }}>
      <div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 32, letterSpacing: '-0.04em', color: 'var(--ink)', lineHeight: 1 }}>{value}</div>
      </div>
      <div style={{
        width: 44, height: 44, borderRadius: 11,
        background: `${color}22`, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {icon}
      </div>
    </div>
  )
}

const STATUS_DOT: Record<string, string> = {
  active: '#22a06b', on_hold: '#f59e0b', converting: '#f59e0b', dispatched: '#3b82f6',
}

function LiveShiftSection() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const hour = new Date().getHours()
  const period = hour >= 6 && hour < 14 ? 'morning' : hour >= 14 && hour < 22 ? 'afternoon' : 'night'
  const PERIOD_LABEL: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night' }

  const { data: queueData = [] } = useQuery({
    queryKey: ['dash-queue', today, period],
    queryFn: () => shiftApi.queueView(today, period).then(r => r.data),
    refetchInterval: 60_000,
    retry: false,
  })
  const { data: assignments = [] } = useQuery({
    queryKey: ['dash-assignments', today, period],
    queryFn: () => shiftApi.listAssignments({ shift_date: today, shift_period: period }).then(r => r.data),
    refetchInterval: 120_000,
    retry: false,
  })

  const ws = queueData as any[]
  const ops = assignments as any[]
  const totalQueued = ws.reduce((s: number, w: any) => s + (w.queue?.length ?? 0), 0)
  const totalReady  = ws.reduce((s: number, w: any) => s + (w.ready_count ?? 0), 0)

  if (ws.length === 0 && ops.length === 0) return null

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Zap size={14} style={{ color: 'var(--accent)' }} />
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>
          Live Shift — {PERIOD_LABEL[period]}
        </span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--accent)', fontWeight: 700 }}>{totalQueued} queued</span>
        {totalReady > 0 && <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#22a06b' }}>+{totalReady} ready</span>}
        <div style={{ flex: 1 }} />
        <Link to="/shifts" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
          Manage <ChevronRight size={11} />
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {ws.map((w: any) => (
          <div key={w.assignment_id} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 9, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>{w.workstation_code}</span>
              <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, color: 'var(--ink-2)' }}>{w.operator_name?.split(' ')[0]}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {w.queue?.slice(0, 6).map((j: any) => (
                <span key={j.id} style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[j.uid_status] || 'var(--ink-3)', flexShrink: 0, display: 'inline-block' }} />
              ))}
              {(w.queue?.length ?? 0) > 6 && <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--ink-3)' }}>+{w.queue.length - 6}</span>}
              {(w.queue?.length ?? 0) === 0 && <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)' }}>Empty queue</span>}
              {w.ready_count > 0 && <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: '#22a06b', marginLeft: 4 }}>({w.ready_count}↑ ready)</span>}
            </div>
          </div>
        ))}
        {ops.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 9, padding: '12px 14px' }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 8 }}>Operators</div>
            {ops.slice(0, 4).map((a: any) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 8, color: 'var(--accent)', flexShrink: 0 }}>
                  {(a.operator_full_name || a.operator_username || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.operator_full_name || a.operator_username}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--ink-3)' }}>{a.workstation_code}</div>
                </div>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: a.confirmed_by ? '#22a06b' : '#f59e0b', flexShrink: 0 }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StorageCell({ code, count, max = 50 }: { code: string; count: number; max?: number }) {
  const pct = Math.min(100, max > 0 ? (count / max) * 100 : 0)
  const fill = count === 0 ? 'var(--line)' : count > max * 0.8 ? '#e5484d' : count > max * 0.5 ? '#f59e0b' : '#22a06b'
  return (
    <div style={{
      background: 'var(--surface-2)',
      border: '1px solid var(--line)',
      borderRadius: 9,
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.08em' }}>{code}</span>
        <span style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 18, color: count === 0 ? 'var(--ink-3)' : 'var(--ink)', lineHeight: 1 }}>{count}</span>
      </div>
      <div style={{ height: 3, borderRadius: 2, background: 'var(--line)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: fill, borderRadius: 2, transition: 'width 300ms cubic-bezier(.2,.8,.2,1)' }} />
      </div>
    </div>
  )
}

function WorkstationCard({ code, name, count }: { code: string; name: string; count: number }) {
  const active = count > 0
  const dotColor = count > 10 ? '#f59e0b' : count > 0 ? '#22a06b' : 'var(--ink-3)'
  return (
    <div style={{
      background: active ? 'var(--surface-2)' : 'transparent',
      border: `1px solid ${active ? 'var(--surface-3)' : 'var(--line)'}`,
      borderRadius: 9,
      padding: '12px 14px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      transition: 'background 180ms cubic-bezier(.2,.8,.2,1)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: 'var(--ink)', letterSpacing: '0.06em' }}>{code}</span>
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || code}</div>
      </div>
      <div style={{
        fontFamily: "'Archivo', sans-serif",
        fontWeight: 800,
        fontSize: 22,
        letterSpacing: '-0.04em',
        color: active ? 'var(--accent)' : 'var(--ink-3)',
        lineHeight: 1,
        flexShrink: 0,
      }}>{count}</div>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const { data: summary, isError: summaryError } = useQuery<DashboardSummary>({
    queryKey: ['dashboard'],
    queryFn: () => shopfloorApi.dashboard().then((r) => r.data),
    refetchInterval: 15_000,
    retry: 1,
  })
  const { data: shopfloor, isLoading: shopfloorLoading, isError: shopfloorError } = useQuery<ShopfloorStatus[]>({
    queryKey: ['shopfloor'],
    queryFn: () => shopfloorApi.status().then((r) => r.data),
    refetchInterval: 15_000,
    retry: 1,
  })

  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 1280 }}>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--ink)' }}>Dashboard</div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink-2)', marginTop: 3 }}>Welcome back, {user?.full_name}</div>
      </div>

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
          <StatCard label="Active UIDs"                  value={summary.uid_active.toLocaleString()}        icon={<Package size={20} />}        color="#3b82f6" />
          <StatCard label="On Hold"                      value={summary.uid_on_hold}                         icon={<AlertTriangle size={20} />}  color="#f59e0b" />
          <StatCard label="Awaiting Design Confirmation" value={summary.awaiting_design_confirmation}        icon={<FileClock size={20} />}      color="#a78bfa" />
          <StatCard label="Furnace Batches Running"      value={summary.furnace_batches_running}             icon={<Flame size={20} />}          color="#ef4444" />
          <StatCard label="UIDs Dispatched Today"        value={summary.uids_dispatched_today.toLocaleString()} icon={<CheckCircle size={20} />} color="#22a06b" />
          <StatCard label="Faridabad Batches in Transit" value={summary.faridabad_batches_in_transit}        icon={<Truck size={20} />}          color="#0ea5e9" />
        </div>
      )}

      {summary && (summary.priority_urgent > 0 || summary.priority_high > 0) && (
        <div style={{
          padding: '11px 16px', borderRadius: 9,
          background: 'rgba(229,72,77,.12)', border: '1px solid rgba(229,72,77,.30)',
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20,
        }}>
          <TrendingUp size={15} style={{ color: '#e5484d', flexShrink: 0 }} />
          <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: '#e5484d', fontWeight: 500 }}>
            {summary.priority_urgent} urgent · {summary.priority_high} high-priority UIDs in production
          </span>
        </div>
      )}

      <LiveShiftSection />

      {shopfloorLoading && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--ink-3)', padding: '20px 0' }}>Loading shopfloor data…</div>
      )}
      {shopfloorError && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--error)', padding: '12px 16px', background: 'rgba(229,72,77,.10)', borderRadius: 9, border: '1px solid rgba(229,72,77,.25)' }}>
          Could not load shopfloor data. The server may be starting up — refresh in a moment.
        </div>
      )}
      {summaryError && !summary && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--error)', padding: '12px 16px', background: 'rgba(229,72,77,.10)', borderRadius: 9, border: '1px solid rgba(229,72,77,.25)', marginBottom: 20 }}>
          Could not load dashboard summary.
        </div>
      )}
      {shopfloor && shopfloor.length === 0 && !shopfloorLoading && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--ink-3)', padding: '20px 0' }}>No factory locations configured.</div>
      )}

      {shopfloor && shopfloor.map((loc) => (
        <div key={loc.location_id} style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 11,
          marginBottom: 20,
          overflow: 'hidden',
          boxShadow: 'var(--shadow-e2)',
        }}>
          <div style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--line)',
            background: 'var(--surface-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{loc.location_name}</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginTop: 3, letterSpacing: '0.06em' }}>
                {loc.total_active_uids} active · {loc.on_hold} on hold
              </div>
            </div>
            <span style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
              background: 'var(--surface-3)', color: 'var(--accent)',
              padding: '3px 10px', borderRadius: 6,
            }}>{loc.location_code}</span>
          </div>

          <div style={{ padding: '18px 20px' }}>
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Box size={13} style={{ color: 'var(--ink-3)' }} />
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>Storage Locations</span>
              </div>
              {loc.storage_locations.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
                  {loc.storage_locations.map((s) => (
                    <StorageCell key={s.storage_id} code={s.code} count={s.uid_count} />
                  ))}
                </div>
              ) : (
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>No storage locations</div>
              )}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>Workstations</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, color: 'var(--ink-3)' }}>— UIDs in queue</span>
              </div>
              {loc.workstations.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                  {loc.workstations.map((w) => (
                    <WorkstationCard key={w.workstation_id} code={w.code} name={w.name} count={w.uid_count} />
                  ))}
                </div>
              ) : (
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>No workstations</div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
