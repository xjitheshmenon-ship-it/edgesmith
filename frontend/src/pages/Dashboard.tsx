import { useQuery } from '@tanstack/react-query'
import { shopfloorApi, shiftApi } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import type { CSSProperties } from 'react'
import type { DashboardSummary, ShopfloorStatus } from '../types'
import { Package, AlertTriangle, CheckCircle, ClipboardList, TrendingUp, Box, Zap, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'

const T = {
  bg: '#11305f', surface: '#173a70', s2: '#21498a', s3: '#2a5aa0',
  line: '#2c5191', ink: '#eaf4e4', ink2: '#9bb4d4', ink3: '#5a7aaa',
  accent: '#d4eecb', accentInk: '#143160',
  green: '#22a06b', amber: '#f59e0b', red: '#e5484d', blue: '#3b82f6',
}
const mono: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }
const arch: CSSProperties = { fontFamily: "'Archivo', sans-serif" }
const sans: CSSProperties = { fontFamily: "'IBM Plex Sans', sans-serif" }

function StatCard({ label, value, icon, color }: {
  label: string; value: number | string; icon: React.ReactNode; color: string
}) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14,
      padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <div style={{ ...mono, fontSize: 10, letterSpacing: '0.1em', color: T.ink3, textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
        <div style={{ ...arch, fontWeight: 800, fontSize: 32, letterSpacing: '-0.04em', color: T.ink, lineHeight: 1 }}>{value}</div>
      </div>
      <div style={{
        width: 46, height: 46, borderRadius: 12, background: `${color}22`,
        color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {icon}
      </div>
    </div>
  )
}

const STATUS_DOT: Record<string, string> = { active: T.green, on_hold: T.amber, converting: '#a78bfa', dispatched: T.blue }

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
        <Zap size={14} style={{ color: T.accent }} />
        <span style={{ ...mono, fontSize: 10, letterSpacing: '0.14em', color: T.ink3, textTransform: 'uppercase' }}>
          Live Shift — {PERIOD_LABEL[period]}
        </span>
        <span style={{ ...mono, fontSize: 10, color: T.accent, fontWeight: 700 }}>{totalQueued} queued</span>
        {totalReady > 0 && <span style={{ ...mono, fontSize: 10, color: T.green }}>+{totalReady} ready</span>}
        <div style={{ flex: 1 }} />
        <Link to="/shifts" style={{ ...mono, fontSize: 10, color: T.accent, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
          Manage <ChevronRight size={11} />
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {ws.map((w: any) => (
          <div key={w.assignment_id} style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ ...mono, fontWeight: 700, fontSize: 13, color: T.accent }}>{w.workstation_code}</span>
              <span style={{ ...sans, fontSize: 11, color: T.ink2 }}>{w.operator_name?.split(' ')[0]}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {w.queue?.slice(0, 6).map((j: any) => (
                <span key={j.id} style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[j.uid_status] || T.ink3, flexShrink: 0, display: 'inline-block' }} />
              ))}
              {(w.queue?.length ?? 0) > 6 && <span style={{ ...mono, fontSize: 9, color: T.ink3 }}>+{w.queue.length - 6}</span>}
              {(w.queue?.length ?? 0) === 0 && <span style={{ ...mono, fontSize: 10, color: T.ink3 }}>Empty queue</span>}
              {w.ready_count > 0 && <span style={{ ...mono, fontSize: 9, color: T.green, marginLeft: 4 }}>({w.ready_count}↑ ready)</span>}
            </div>
            {w.from_storage?.length > 0 && (
              <div style={{ ...mono, fontSize: 9, color: T.ink3, marginTop: 6 }}>
                {w.from_storage.join(', ')} → {w.to_storage?.join(', ') || '—'}
              </div>
            )}
          </div>
        ))}
        {/* Operators mini-list */}
        {ops.length > 0 && (
          <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.12em', color: T.ink3, textTransform: 'uppercase', marginBottom: 8 }}>Operators</div>
            {ops.slice(0, 4).map((a: any) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: T.s3, display: 'flex', alignItems: 'center', justifyContent: 'center', ...arch, fontWeight: 700, fontSize: 8, color: T.accent, flexShrink: 0 }}>
                  {(a.operator_full_name || a.operator_username || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...sans, fontSize: 11, fontWeight: 600, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.operator_full_name || a.operator_username}</div>
                  <div style={{ ...mono, fontSize: 9, color: T.ink3 }}>{a.workstation_code}</div>
                </div>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: a.confirmed_by ? T.green : T.amber, flexShrink: 0 }} />
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
  const fill = count === 0 ? T.line : count > max * 0.8 ? T.red : count > max * 0.5 ? T.amber : T.green
  return (
    <div style={{
      background: T.s2, border: `1px solid ${T.line}`, borderRadius: 10,
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ ...mono, fontSize: 10, color: T.ink3, letterSpacing: '0.08em' }}>{code}</span>
        <span style={{ ...arch, fontWeight: 700, fontSize: 18, color: count === 0 ? T.ink3 : T.ink, lineHeight: 1 }}>{count}</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: T.line, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: fill, borderRadius: 2, transition: 'width .4s ease' }} />
      </div>
    </div>
  )
}

function WorkstationCard({ code, name, count }: { code: string; name: string; count: number }) {
  const active = count > 0
  const dotColor = count > 10 ? T.amber : count > 0 ? T.green : T.ink3
  return (
    <div style={{
      background: active ? T.s2 : 'transparent',
      border: `1px solid ${active ? T.s3 : T.line}`,
      borderRadius: 10, padding: '12px 14px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      transition: 'background .2s',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
          <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: T.ink, letterSpacing: '0.06em' }}>{code}</span>
        </div>
        <div style={{ ...sans, fontSize: 11, color: T.ink3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || code}</div>
      </div>
      <div style={{
        ...arch, fontWeight: 800, fontSize: 22, letterSpacing: '-0.04em',
        color: active ? T.accent : T.ink3, lineHeight: 1, flexShrink: 0,
      }}>{count}</div>
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
    <div style={{ padding: '24px 28px 60px', maxWidth: 1280 }}>

      <div style={{ marginBottom: 24 }}>
        <div style={{ ...arch, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: T.ink }}>Dashboard</div>
        <div style={{ ...sans, fontSize: 13, color: T.ink2, marginTop: 3 }}>Welcome back, {user?.full_name}</div>
      </div>

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
          <StatCard label="Active UIDs"   value={summary.uid_active.toLocaleString()}       icon={<Package size={20} />}      color={T.blue} />
          <StatCard label="On Hold"       value={summary.uid_on_hold}                        icon={<AlertTriangle size={20} />}  color={T.amber} />
          <StatCard label="Dispatched"    value={summary.uid_dispatched.toLocaleString()}    icon={<CheckCircle size={20} />}    color={T.green} />
          <StatCard label="Open Orders"   value={summary.open_manufacturing_orders}          icon={<ClipboardList size={20} />}  color="#c4b5fd" />
        </div>
      )}

      {summary && (summary.priority_urgent > 0 || summary.priority_high > 0) && (
        <div style={{
          padding: '11px 16px', borderRadius: 10,
          background: `${T.red}18`, border: `1px solid ${T.red}40`,
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20,
        }}>
          <TrendingUp size={15} style={{ color: T.red, flexShrink: 0 }} />
          <span style={{ ...sans, fontSize: 13, color: T.red, fontWeight: 500 }}>
            {summary.priority_urgent} urgent · {summary.priority_high} high-priority UIDs in production
          </span>
        </div>
      )}

      <LiveShiftSection />

      {shopfloor && shopfloor.map((loc) => (
        <div key={loc.location_id} style={{
          background: T.surface, border: `1px solid ${T.line}`,
          borderRadius: 16, marginBottom: 20, overflow: 'hidden',
        }}>
          {/* Location header */}
          <div style={{
            padding: '14px 20px', borderBottom: `1px solid ${T.line}`,
            background: T.s2,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ ...arch, fontWeight: 700, fontSize: 15, color: T.ink }}>{loc.location_name}</div>
              <div style={{ ...mono, fontSize: 10, color: T.ink3, marginTop: 3, letterSpacing: '0.06em' }}>
                {loc.total_active_uids} active · {loc.on_hold} on hold
              </div>
            </div>
            <span style={{
              ...mono, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
              background: T.s3, color: T.accent, padding: '3px 10px', borderRadius: 6,
            }}>{loc.location_code}</span>
          </div>

          <div style={{ padding: '18px 20px' }}>

            {/* Storage section */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Box size={13} style={{ color: T.ink3 }} />
                <span style={{ ...mono, fontSize: 9.5, letterSpacing: '0.14em', color: T.ink3, textTransform: 'uppercase' }}>Storage Locations</span>
              </div>
              {loc.storage_locations.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
                  {loc.storage_locations.map((s) => (
                    <StorageCell key={s.storage_id} code={s.code} count={s.uid_count} />
                  ))}
                </div>
              ) : (
                <div style={{ ...mono, fontSize: 11, color: T.ink3 }}>No storage locations</div>
              )}
            </div>

            {/* Workstations section */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ ...mono, fontSize: 9.5, letterSpacing: '0.14em', color: T.ink3, textTransform: 'uppercase' }}>Workstations</span>
                <span style={{ ...mono, fontSize: 9.5, color: T.ink3 }}>— UIDs in queue</span>
              </div>
              {loc.workstations.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                  {loc.workstations.map((w) => (
                    <WorkstationCard key={w.workstation_id} code={w.code} name={w.name} count={w.uid_count} />
                  ))}
                </div>
              ) : (
                <div style={{ ...mono, fontSize: 11, color: T.ink3 }}>No workstations</div>
              )}
            </div>
          </div>
        </div>
      ))}

    </div>
  )
}
