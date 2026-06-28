import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { authStore } from '../store/auth'
import {
  LayoutDashboard, Package, Settings, Search,
  ClipboardList, Monitor, Users, LogOut,
  Hammer, Layers, CalendarClock,
} from 'lucide-react'

interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
  roles?: string[]
}

const NAV: NavItem[] = [
  { label: 'Dashboard',       to: '/',              icon: <LayoutDashboard size={16} /> },
  { label: 'Shop Floor',      to: '/shopfloor',     icon: <Monitor size={16} /> },
  { label: 'UID Lookup',      to: '/uid-lookup',    icon: <Search size={16} /> },
  { label: 'My Queue',        to: '/queue',          icon: <ClipboardList size={16} />, roles: ['operator', 'supervisor'] },
  { label: 'Shifts',          to: '/shifts',         icon: <CalendarClock size={16} />, roles: ['admin', 'manager', 'supervisor'] },
  { label: 'UIDs',            to: '/uids',           icon: <Package size={16} />,       roles: ['admin', 'manager', 'supervisor'] },
  { label: 'Mfg Orders',      to: '/manufacturing',  icon: <Hammer size={16} />,        roles: ['admin', 'manager'] },
  { label: 'Cycles',          to: '/cycles',         icon: <Layers size={16} />,        roles: ['admin', 'manager'] },
  { label: 'Config',          to: '/config',         icon: <Settings size={16} />,      roles: ['admin'] },
  { label: 'Users',           to: '/users',          icon: <Users size={16} />,         roles: ['admin'] },
]

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  admin:      { bg: 'rgba(167,139,250,.18)', color: '#a78bfa' },
  manager:    { bg: 'rgba(96,165,250,.18)',  color: '#60a5fa' },
  supervisor: { bg: 'rgba(61,214,140,.18)',  color: '#3dd68c' },
  operator:   { bg: 'rgba(251,191,36,.18)',  color: '#fbbf24' },
  service:    { bg: 'rgba(122,143,166,.18)', color: '#7a8fa6' },
  shopfloor:  { bg: 'rgba(251,146,60,.18)',  color: '#fb923c' },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()

  const visibleNav = NAV.filter(item =>
    !item.roles || (user && item.roles.includes(user.role))
  )

  const initials = user?.full_name
    ? user.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : user?.username?.slice(0, 2).toUpperCase() ?? '??'

  const roleStyle = ROLE_COLORS[user?.role ?? ''] ?? { bg: 'rgba(122,143,166,.18)', color: '#7a8fa6' }

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside style={{
        width: 232,
        flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 5,
      }}>

        {/* Logo */}
        <div style={{
          height: 60,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 20px',
          borderBottom: '1px solid var(--line)',
        }}>
          <div style={{
            fontFamily: "'Archivo', sans-serif",
            fontWeight: 800,
            fontSize: 20,
            letterSpacing: '-0.035em',
            lineHeight: 1,
            color: 'var(--ink)',
          }}>
            edgesmith<span style={{ color: 'var(--accent)' }}>.</span>
          </div>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 8.5,
            letterSpacing: '0.1em',
            color: 'var(--ink-3)',
            marginTop: 5,
          }}>
            PRECISION WORKS.
          </div>
        </div>

        {/* Section label */}
        <div style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 9.5,
          letterSpacing: '0.18em',
          color: 'var(--ink-3)',
          padding: '18px 20px 6px',
          textTransform: 'uppercase',
        }}>
          CPCMS
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 10px', flex: 1 }}>
          {visibleNav.map(item => {
            const active = item.to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.to)
            return (
              <Link
                key={item.to}
                to={item.to}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--accent)' : 'var(--ink-2)',
                  background: active ? 'rgba(212,238,203,.12)' : 'transparent',
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)' } }}
                onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--ink-2)' } }}
              >
                <span style={{ opacity: active ? 1 : 0.7, flexShrink: 0 }}>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* User footer */}
        <div style={{
          padding: '14px 16px',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'rgba(212,238,203,.15)',
            color: 'var(--accent)',
            border: '1px solid rgba(212,238,203,.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: "'Archivo', sans-serif",
            fontWeight: 700,
            fontSize: 11,
            flexShrink: 0,
          }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.full_name || user?.username}
            </div>
            <span style={{
              display: 'inline-block',
              padding: '1px 6px',
              borderRadius: 5,
              fontSize: 9.5,
              fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 600,
              letterSpacing: '0.04em',
              background: roleStyle.bg,
              color: roleStyle.color,
              marginTop: 2,
            }}>
              {user?.role}
            </span>
          </div>
          <button
            onClick={() => { authStore.clearAuth(); window.location.href = import.meta.env.BASE_URL }}
            title="Sign out"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--ink-3)',
              padding: 4,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.12s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--ink)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--ink-3)'}
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        {/* Top header */}
        <header style={{
          height: 60,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 28px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--line)',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: "'Archivo', sans-serif",
              fontWeight: 700,
              fontSize: 17,
              letterSpacing: '-0.02em',
              lineHeight: 1,
              color: 'var(--ink)',
            }}>
              {NAV.find(n => n.to !== '/' && location.pathname.startsWith(n.to))?.label
                || (location.pathname === '/' ? 'Dashboard' : '')}
            </div>
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
