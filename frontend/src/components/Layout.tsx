import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { authStore } from '../store/auth'
import { useQuery } from '@tanstack/react-query'
import { shiftApi } from '../api/client'
import { format } from 'date-fns'
import {
  LayoutDashboard, Package, Settings, Search,
  ClipboardList, Monitor, Users, LogOut,
  Hammer, CalendarClock,
  Zap, ChevronRight,
} from 'lucide-react'

interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
  roles?: string[]
}

const NAV: NavItem[] = [
  { label: 'Dashboard',    to: '/',              icon: <LayoutDashboard size={16} /> },
  { label: 'Shop Floor',   to: '/shopfloor',     icon: <Monitor size={16} /> },
  { label: 'Job Queue',    to: '/queue',          icon: <ClipboardList size={16} />, roles: ['operator', 'supervisor'] },
  { label: 'Shifts',       to: '/shifts',         icon: <CalendarClock size={16} />, roles: ['admin', 'manager', 'supervisor'] },
  { label: 'UIDs',         to: '/uids',           icon: <Package size={16} />,       roles: ['admin', 'manager', 'supervisor'] },
  { label: 'Mfg Orders',   to: '/manufacturing',  icon: <Hammer size={16} />,        roles: ['admin', 'manager'] },
  { label: 'Config',       to: '/config',         icon: <Settings size={16} />,      roles: ['admin'] },
  { label: 'Users',        to: '/users',          icon: <Users size={16} />,         roles: ['admin'] },
]

const STATUS_COLOR: Record<string, string> = {
  active: '#22a06b', on_hold: '#f59e0b', converting: '#a78bfa', dispatched: '#3b82f6',
}

/* ── Sidebar shift/queue panel ─────────────────────────────────────────────── */
function ShiftPanel() {
  const today = format(new Date(), 'yyyy-MM-dd')

  // Detect current shift period by time
  const hour = new Date().getHours()
  const period = hour >= 6 && hour < 14 ? 'morning' : hour >= 14 && hour < 22 ? 'afternoon' : 'night'
  const PERIOD_LABEL: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night' }

  const { data: queueData = [] } = useQuery({
    queryKey: ['sidebar-queue', today, period],
    queryFn: () => shiftApi.queueView(today, period).then(r => r.data),
    refetchInterval: 60_000,
    retry: false,
  })

  const totalQueued = (queueData as any[]).reduce((s: number, w: any) => s + (w.queue?.length ?? 0), 0)
  const totalReady  = (queueData as any[]).reduce((s: number, w: any) => s + (w.ready_count ?? 0), 0)
  const wsWithWork  = (queueData as any[]).filter((w: any) => (w.queue?.length ?? 0) > 0 || w.ready_count > 0)

  if ((queueData as any[]).length === 0) return null

  return (
    <div style={{ margin: '8px 12px 0', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)', overflow: 'hidden' }}>
      {/* Panel header */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Zap size={12} style={{ color: 'var(--accent)' }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '.12em', color: 'var(--ink-2)', fontWeight: 600 }}>
            {PERIOD_LABEL[period].toUpperCase()} QUEUE
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, color: 'var(--accent)' }}>{totalQueued}</span>
          {totalReady > 0 && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#22a06b' }}>+{totalReady}</span>
          )}
        </div>
      </div>

      {/* Workstation rows */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {wsWithWork.slice(0, 4).map((ws: any) => (
          <Link
            key={ws.assignment_id}
            to="/shifts"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--line)', textDecoration: 'none', transition: 'background .1s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
          >
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: 'var(--accent)', minWidth: 40, flexShrink: 0 }}>{ws.workstation_code}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--ink)', fontWeight: 500 }}>{ws.operator_name?.split(' ')[0]}</span>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {ws.queue?.slice(0, 3).map((j: any) => (
                <span key={j.id} style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[j.uid_status] || 'var(--ink-3)', flexShrink: 0 }} />
              ))}
              {(ws.queue?.length ?? 0) > 3 && (
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--ink-3)' }}>+{ws.queue.length - 3}</span>
              )}
              {ws.ready_count > 0 && (
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: '#22a06b', marginLeft: 2 }}>({ws.ready_count}↑)</span>
              )}
            </div>
          </Link>
        ))}
        {wsWithWork.length === 0 && (queueData as any[]).length > 0 && (
          <div style={{ padding: '10px 12px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)' }}>
            {(queueData as any[]).length} stations assigned, queues empty
          </div>
        )}
      </div>

      {/* Footer link */}
      <Link to="/shifts" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', textDecoration: 'none', background: 'rgba(212,238,203,.07)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(212,238,203,.14)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(212,238,203,.07)'}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>Manage shifts</span>
        <ChevronRight size={11} style={{ color: 'var(--accent)' }} />
      </Link>
    </div>
  )
}


export default function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()

  const visibleNav = NAV.filter(item =>
    !item.roles || (user && item.roles.includes(user.role))
  )

  const isSupervisorPlus = user?.role && ['admin', 'manager', 'supervisor'].includes(user.role)

  const initials = user?.full_name
    ? user.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : user?.username?.slice(0, 2).toUpperCase() ?? '??'

  const currentPage = NAV.find(n => n.to !== '/' && location.pathname.startsWith(n.to))
    || (location.pathname === '/' ? NAV[0] : null)

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: 'var(--bg)', color: 'var(--ink)' }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside style={{
        width: 248,
        flex: '0 0 248px',
        background: 'var(--surface)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 5,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}>

        {/* Logo */}
        <div style={{
          height: 64,
          flex: '0 0 64px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 20px',
          borderBottom: '1px solid var(--line)',
        }}>
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 21, letterSpacing: '-0.035em', lineHeight: 1, color: 'var(--ink)' }}>
            edgesmith<span style={{ color: 'var(--accent)' }}>.</span>
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.1em', color: 'var(--ink-2)', marginTop: 5 }}>
            INNOVATE. ENGINEER. EXCEL.
          </div>
        </div>

        {/* Section label */}
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.16em', color: 'var(--ink-2)', padding: '16px 20px 8px' }}>
          MANUFACTURING
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 12px' }}>
          {visibleNav.map(item => {
            const active = item.to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.to)
            return (
              <Link
                key={item.to}
                to={item.to}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 9, textDecoration: 'none',
                  fontSize: 13, fontWeight: active ? 600 : 400,
                  color: active ? 'var(--accent)' : 'var(--ink)',
                  background: active ? 'rgba(212,238,203,.12)' : 'transparent',
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)' }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <span style={{ opacity: active ? 1 : 0.55, flexShrink: 0 }}>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* ── Job Queue panel (supervisor+) ─── */}
        {isSupervisorPlus && (
          <>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.16em', color: 'var(--ink-2)', padding: '16px 20px 6px' }}>
              JOB QUEUE
            </div>
            <ShiftPanel />
          </>
        )}

        {/* Spacer */}
        <div style={{ flex: 1, minHeight: 12 }} />

        {/* User footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 11, flexShrink: 0 }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.full_name || user?.username}</div>
            <div style={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--ink-2)', marginTop: 1 }}>{user?.role}</div>
          </div>
          <button
            onClick={() => { authStore.clearAuth(); window.location.href = import.meta.env.BASE_URL }}
            title="Sign out"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-2)', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center' }}
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        {/* Top header */}
        <header style={{ height: 64, flex: '0 0 64px', display: 'flex', alignItems: 'center', gap: 16, padding: '0 28px', background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
          <div>
            <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 19, letterSpacing: '-0.02em', lineHeight: 1, whiteSpace: 'nowrap', color: 'var(--ink)' }}>
              {currentPage?.label || ''}
            </div>
          </div>
          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 9, padding: '0 12px', width: 260, height: 36 }}>
            <Search size={15} style={{ color: 'var(--ink-2)', flexShrink: 0 }} />
            <input placeholder="Search orders, products…" style={{ border: 'none', background: 'none', outline: 'none', flex: 1, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink)' }} />
          </div>

          {location.pathname.startsWith('/manufacturing') && (
            <button className="btn-primary"><Plus size={15} /> New Order</button>
          )}

          <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--ink)', color: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 13, flexShrink: 0, userSelect: 'none' }}>
            {initials}
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
