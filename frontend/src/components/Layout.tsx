import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { authStore } from '../store/auth'
import {
  LayoutDashboard, Package, Settings, Search,
  ClipboardList, Monitor, Users, LogOut,
  Hammer, Layers, CalendarClock, Plus,
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
  { label: 'UID Lookup',   to: '/uid-lookup',    icon: <Search size={16} /> },
  { label: 'My Queue',     to: '/queue',          icon: <ClipboardList size={16} />, roles: ['operator', 'supervisor'] },
  { label: 'Shifts',       to: '/shifts',         icon: <CalendarClock size={16} />, roles: ['admin', 'manager', 'supervisor'] },
  { label: 'UIDs',         to: '/uids',           icon: <Package size={16} />,       roles: ['admin', 'manager', 'supervisor'] },
  { label: 'Mfg Orders',   to: '/manufacturing',  icon: <Hammer size={16} />,        roles: ['admin', 'manager'] },
  { label: 'Cycles',       to: '/cycles',         icon: <Layers size={16} />,        roles: ['admin', 'manager'] },
  { label: 'Config',       to: '/config',         icon: <Settings size={16} />,      roles: ['admin'] },
  { label: 'Users',        to: '/users',          icon: <Users size={16} />,         roles: ['admin'] },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()

  const visibleNav = NAV.filter(item =>
    !item.roles || (user && item.roles.includes(user.role))
  )

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
          <div style={{
            fontFamily: "'Archivo', sans-serif",
            fontWeight: 800,
            fontSize: 21,
            letterSpacing: '-0.035em',
            lineHeight: 1,
            color: 'var(--ink)',
          }}>
            edgesmith<span style={{ color: 'var(--accent)' }}>.</span>
          </div>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 9,
            letterSpacing: '0.1em',
            color: 'var(--ink-2)',
            marginTop: 5,
          }}>
            INNOVATE. ENGINEER. EXCEL.
          </div>
        </div>

        {/* Section label */}
        <div style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          letterSpacing: '0.16em',
          color: 'var(--ink-2)',
          padding: '20px 20px 8px',
        }}>
          MANUFACTURING
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 12px', flex: 1 }}>
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
                  borderRadius: 9,
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--accent)' : 'var(--ink)',
                  background: active ? 'rgba(210,73,31,.08)' : 'transparent',
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)' } }}
                onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent' } }}
              >
                <span style={{ opacity: active ? 1 : 0.55, flexShrink: 0 }}>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* APPEARANCE section */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--line)' }}>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.16em',
            color: 'var(--ink-2)',
            marginBottom: 11,
          }}>
            APPEARANCE
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            {[
              { name: 'Navy', bg: '#11305f', surface: '#173a70', line: '#2c5191', ink: '#eaf4e4', accent: '#d4eecb' },
              { name: 'Cream', bg: '#f3efe6', surface: '#fbf9f4', line: '#ddd5c6', ink: '#1c1a17', accent: '#d2491f' },
              { name: 'Slate', bg: '#0f172a', surface: '#1e293b', line: '#334155', ink: '#f1f5f9', accent: '#38bdf8' },
            ].map(t => (
              <button
                key={t.name}
                title={t.name}
                onClick={() => {
                  const isNavy = t.bg === '#11305f', isCream = t.bg === '#f3efe6'
                  const r = document.documentElement.style
                  r.setProperty('--bg', t.bg)
                  r.setProperty('--surface', t.surface)
                  r.setProperty('--surface-2', isNavy ? '#21498a' : isCream ? '#efe9dc' : '#263349')
                  r.setProperty('--surface-3', isNavy ? '#2a5aa0' : isCream ? '#e5ddd0' : '#324060')
                  r.setProperty('--line', t.line)
                  r.setProperty('--ink', t.ink)
                  r.setProperty('--ink-2', isNavy ? '#9bb4d4' : isCream ? '#6b6358' : '#94a3b8')
                  r.setProperty('--ink-3', isNavy ? '#5a7aaa' : isCream ? '#9c9080' : '#64748b')
                  r.setProperty('--accent', t.accent)
                  r.setProperty('--accent-h', isNavy ? '#bde0b0' : isCream ? '#b83d18' : '#0ea5e9')
                  r.setProperty('--accent-dim', isNavy ? 'rgba(212,238,203,.12)' : isCream ? '#fdf0eb' : 'rgba(56,189,248,.12)')
                  r.setProperty('--accent-ink', isNavy ? '#143160' : '#fff')
                }}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 7,
                  border: '1.5px solid var(--line)',
                  cursor: 'pointer',
                  padding: 3,
                  background: 'var(--surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span style={{
                  display: 'block',
                  width: '100%',
                  height: '100%',
                  borderRadius: 4,
                  background: `linear-gradient(135deg, ${t.surface} 50%, ${t.accent} 50%)`,
                }} />
              </button>
            ))}
          </div>
        </div>

        {/* User footer */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
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
            <div style={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--ink-2)', marginTop: 1 }}>
              {user?.role}
            </div>
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
        <header style={{
          height: 64,
          flex: '0 0 64px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 28px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--line)',
        }}>
          <div>
            <div style={{
              fontFamily: "'Archivo', sans-serif",
              fontWeight: 700,
              fontSize: 19,
              letterSpacing: '-0.02em',
              lineHeight: 1,
              whiteSpace: 'nowrap',
              color: 'var(--ink)',
            }}>
              {currentPage?.label || ''}
            </div>
          </div>
          <div style={{ flex: 1 }} />

          {/* Search */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            borderRadius: 9,
            padding: '0 12px',
            width: 260,
            height: 36,
          }}>
            <Search size={15} style={{ color: 'var(--ink-2)', flexShrink: 0 }} />
            <input
              placeholder="Search orders, products…"
              style={{ border: 'none', background: 'none', outline: 'none', flex: 1, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink)' }}
            />
          </div>

          {/* Contextual New Order button on Mfg Orders */}
          {location.pathname.startsWith('/manufacturing') && (
            <button className="btn-primary">
              <Plus size={15} /> New Order
            </button>
          )}

          {/* Avatar */}
          <div style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: 'var(--ink)',
            color: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: "'Archivo', sans-serif",
            fontWeight: 700,
            fontSize: 13,
            flexShrink: 0,
            userSelect: 'none',
          }}>
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
