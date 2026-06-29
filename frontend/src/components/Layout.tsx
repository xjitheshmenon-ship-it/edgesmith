import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { authStore } from '../store/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { shiftApi, factoryApi, userApi, shopfloorApi } from '../api/client'
import { format } from 'date-fns'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Package, Search, Monitor, Users, LogOut,
  Plus, X, Zap, ChevronRight, Sun, Moon,
  Inbox, Link2, Truck, Download, Tag, Factory, Layers, CheckCircle2,
  FileText, Calendar, UserPlus, BarChart3, GitBranch, List, Thermometer, BadgeCheck, Lock,
} from 'lucide-react'
import { toggleTheme, getCurrentTheme, type Theme } from '../store/theme'

interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
  roles: string[]
}
interface NavSection { title: string; items: NavItem[]; location?: 'F1' | 'F2' }

const ALL = ['admin', 'manager', 'supervisor', 'operator', 'service', 'shopfloor']
const sz = 16

// Sidebar sections per the CPCMS page-instructions navigation structure.
const SECTIONS: NavSection[] = [
  { title: 'OVERVIEW', items: [
    { label: 'Dashboard', to: '/', icon: <LayoutDashboard size={sz} />, roles: ['admin', 'manager', 'supervisor'] },
  ]},
  { title: 'FARIDABAD', location: 'F2', items: [
    { label: 'Raw Material Intake', to: '/faridabad', icon: <Inbox size={sz} />, roles: ['admin', 'manager'] },
    { label: 'Joining Operation', to: '/faridabad', icon: <Link2 size={sz} />, roles: ['admin', 'manager'] },
    { label: 'Contractor Dispatch', to: '/faridabad', icon: <Truck size={sz} />, roles: ['admin', 'manager'] },
  ]},
  { title: 'DHARMAPURI', location: 'F1', items: [
    { label: 'Receiving', to: '/receiving', icon: <Download size={sz} />, roles: ['admin', 'manager', 'supervisor'] },
    { label: 'UID Creation', to: '/uids', icon: <Tag size={sz} />, roles: ['admin', 'manager', 'supervisor'] },
    { label: 'Production Floor', to: '/production', icon: <Factory size={sz} />, roles: ['admin', 'manager', 'supervisor', 'operator'] },
    { label: 'Batch Management', to: '/tempering', icon: <Layers size={sz} />, roles: ['admin', 'manager', 'supervisor'] },
    { label: 'QC', to: '/qc', icon: <CheckCircle2 size={sz} />, roles: ['admin', 'manager', 'supervisor', 'operator'] },
  ]},
  { title: 'MANAGEMENT', items: [
    { label: 'MO Linking', to: '/manufacturing', icon: <FileText size={sz} />, roles: ['admin', 'manager'] },
    { label: 'Shift Management', to: '/shifts', icon: <Calendar size={sz} />, roles: ['admin', 'manager', 'supervisor'] },
    { label: 'Job Assignment', to: '/shifts', icon: <UserPlus size={sz} />, roles: ['admin', 'manager', 'supervisor'] },
    { label: 'Reports', to: '/reports', icon: <BarChart3 size={sz} />, roles: ['admin', 'manager', 'supervisor'] },
    { label: 'Service Lookup', to: '/uid-lookup', icon: <Search size={sz} />, roles: ['admin', 'manager', 'supervisor', 'service'] },
  ]},
  { title: 'CONFIGURATION', items: [
    { label: 'Cycle Builder', to: '/config', icon: <GitBranch size={sz} />, roles: ['admin', 'manager'] },
    { label: 'Master Lists', to: '/config', icon: <List size={sz} />, roles: ['admin', 'manager'] },
    { label: 'Tempering Parameters', to: '/config', icon: <Thermometer size={sz} />, roles: ['admin'] },
    { label: 'Employee Profiles', to: '/employees', icon: <BadgeCheck size={sz} />, roles: ['admin', 'manager'] },
    { label: 'Users and Roles', to: '/users', icon: <Lock size={sz} />, roles: ['admin'] },
  ]},
  { title: 'DISPLAY', items: [
    { label: 'Shopfloor Display', to: '/shopfloor', icon: <Monitor size={sz} />, roles: ALL },
  ]},
]

const STATUS_COLOR: Record<string, string> = {
  active: '#22a06b', on_hold: '#f59e0b', converting: '#a78bfa', dispatched: '#3b82f6',
}

/* ── Quick assign modal ─────────────────────────────────────────────────────── */
function QuickAssign({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const hour = new Date().getHours()
  const period = hour >= 6 && hour < 14 ? 'morning' : hour >= 14 && hour < 22 ? 'afternoon' : 'night'
  const [form, setForm] = useState({ operator_id: '', workstation_id: '' })

  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => userApi.list().then(r => r.data) })
  const { data: workstations = [] } = useQuery({ queryKey: ['workstations'], queryFn: () => factoryApi.workstations().then(r => r.data) })
  const { data: existing = [] } = useQuery({ queryKey: ['assignments', today, period], queryFn: () => shiftApi.listAssignments({ shift_date: today, shift_period: period }).then(r => r.data) })

  const assignedWsIds = new Set((existing as any[]).map((a: any) => a.workstation_id))
  const operators = (users as any[]).filter((u: any) => u.role === 'operator')
  const freeWorkstations = (workstations as any[]).filter((w: any) => !assignedWsIds.has(w.id))

  const create = useMutation({
    mutationFn: () => shiftApi.createAssignment({ shift_date: today, shift_period: period, operator_id: Number(form.operator_id), workstation_id: Number(form.workstation_id) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sidebar-queue'] }); qc.invalidateQueries({ queryKey: ['assignments'] }); onClose() },
  })

  const PERIOD_LABEL: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, width: '100%', maxWidth: 360, padding: '20px 20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>Assign Operator</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginTop: 2, letterSpacing: '0.1em' }}>{PERIOD_LABEL[period].toUpperCase()} · {today}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-2)' }}><X size={16} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="label">Workstation</label>
            <select className="input" value={form.workstation_id} onChange={e => setForm(f => ({ ...f, workstation_id: e.target.value }))}>
              <option value="">Select workstation…</option>
              {freeWorkstations.map((w: any) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Operator</label>
            <select className="input" value={form.operator_id} onChange={e => setForm(f => ({ ...f, operator_id: e.target.value }))}>
              <option value="">Select operator…</option>
              {operators.map((o: any) => <option key={o.id} value={o.id}>{o.full_name || o.username}</option>)}
            </select>
          </div>
          {create.isError && <div style={{ fontSize: 12, color: 'var(--error)' }}>Failed to assign — workstation may already be taken.</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!form.operator_id || !form.workstation_id || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
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
    <div style={{ margin: '8px 12px 0', borderRadius: 10, background: 'var(--chrome-hover)', border: '1px solid var(--chrome-line)', overflow: 'hidden' }}>
      {/* Panel header */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--chrome-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Zap size={12} style={{ color: 'var(--brand-dot)' }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '.12em', color: 'var(--chrome-muted)', fontWeight: 600 }}>
            {PERIOD_LABEL[period].toUpperCase()} QUEUE
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, color: 'var(--brand-dot)' }}>{totalQueued}</span>
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
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--chrome-line)', textDecoration: 'none', transition: 'background .1s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--chrome-hover)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
          >
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: 'var(--brand-dot)', minWidth: 40, flexShrink: 0 }}>{ws.workstation_code}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--chrome-ink)', fontWeight: 500 }}>{ws.operator_name?.split(' ')[0]}</span>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {ws.queue?.slice(0, 3).map((j: any) => (
                <span key={j.id} style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[j.uid_status] || 'var(--chrome-muted)', flexShrink: 0 }} />
              ))}
              {(ws.queue?.length ?? 0) > 3 && (
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--chrome-muted)' }}>+{ws.queue.length - 3}</span>
              )}
              {ws.ready_count > 0 && (
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: '#22a06b', marginLeft: 2 }}>({ws.ready_count}↑)</span>
              )}
            </div>
          </Link>
        ))}
        {wsWithWork.length === 0 && (queueData as any[]).length > 0 && (
          <div style={{ padding: '10px 12px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--chrome-muted)' }}>
            {(queueData as any[]).length} stations assigned, queues empty
          </div>
        )}
      </div>

      {/* Footer link */}
      <Link to="/shifts" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', textDecoration: 'none', background: 'rgba(212,238,203,.07)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(212,238,203,.14)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(212,238,203,.07)'}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--brand-dot)', fontWeight: 600 }}>Manage shifts</span>
        <ChevronRight size={11} style={{ color: 'var(--brand-dot)' }} />
      </Link>
    </div>
  )
}


export default function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const [showAssign, setShowAssign] = useState(false)
  const [theme, setTheme] = useState<Theme>(getCurrentTheme)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const handler = (e: Event) => setTheme((e as CustomEvent<Theme>).detail)
    window.addEventListener('es-theme-change', handler)
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => { window.removeEventListener('es-theme-change', handler); clearInterval(t) }
  }, [])

  // Live cross-location summary for the status bar.
  const { data: summary } = useQuery<any>({
    queryKey: ['dashboard'],
    queryFn: () => shopfloorApi.dashboard().then(r => r.data),
    refetchInterval: 30_000,
  })
  const canSwitchLocation = ['admin', 'manager'].includes(user?.role || '')
  const [loc, setLoc] = useState<'F1' | 'F2' | 'both'>('both')

  const role = user?.role || ''
  const visibleSections = SECTIONS
    // Location-scoped sections (Faridabad / Dharmapuri) follow the topbar toggle.
    .filter(s => !s.location || loc === 'both' || s.location === loc)
    .map(s => ({ ...s, items: s.items.filter(it => it.roles.includes(role)) }))
    .filter(s => s.items.length > 0)
  const allVisibleItems = visibleSections.flatMap(s => s.items)

  const isSupervisorPlus = ['admin', 'manager', 'supervisor'].includes(role)

  const initials = user?.full_name
    ? user.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : user?.username?.slice(0, 2).toUpperCase() ?? '??'

  const currentPage = allVisibleItems.find(n => n.to !== '/' && location.pathname.startsWith(n.to))
    || (location.pathname === '/' ? allVisibleItems.find(n => n.to === '/') : null)

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: 'var(--bg)', color: 'var(--ink)' }}>

      {/* ── Sidebar (navy chrome) ───────────────────────────────────────── */}
      <aside style={{
        width: 248,
        flex: '0 0 248px',
        background: 'var(--chrome)',
        borderRight: '1px solid var(--chrome-line)',
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
          borderBottom: '1px solid var(--chrome-line)',
        }}>
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 21, letterSpacing: '-0.035em', lineHeight: 1, color: 'var(--chrome-ink)' }}>
            edgesmith<span style={{ color: 'var(--brand-dot)' }}>.</span>
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.1em', color: 'var(--chrome-muted)', marginTop: 5 }}>
            INNOVATE. ENGINEER. EXCEL.
          </div>
        </div>

        {/* Sectioned nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', padding: '8px 12px 0' }}>
          {visibleSections.map(section => (
            <div key={section.title} style={{ marginBottom: 6 }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--chrome-muted)', padding: '12px 8px 6px' }}>
                {section.title}
              </div>
              {section.items.map((item, i) => {
                const active = item.to === '/'
                  ? location.pathname === '/'
                  : location.pathname === item.to || location.pathname.startsWith(item.to + '/')
                return (
                  <Link
                    key={item.label + i}
                    to={item.to}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 10px', borderRadius: 9, textDecoration: 'none',
                      fontSize: 13, fontWeight: active ? 600 : 400,
                      color: active ? 'var(--chrome-ink)' : 'var(--chrome-ink-2)',
                      background: active ? 'var(--chrome-active)' : 'transparent',
                      borderLeft: active ? '2px solid var(--brand-dot)' : '2px solid transparent',
                      transition: 'background 0.12s, color 0.12s',
                    }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--chrome-hover)' }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    <span style={{ opacity: active ? 1 : 0.7, flexShrink: 0, display: 'flex' }}>{item.icon}</span>
                    {item.label}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {/* ── Job Queue panel (supervisor+) ─── */}
        {isSupervisorPlus && (
          <>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.16em', color: 'var(--chrome-muted)', padding: '16px 20px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              JOB QUEUE
              <button
                onClick={() => setShowAssign(true)}
                title="Assign operator"
                style={{ background: 'rgba(212,238,203,.14)', border: '1px solid rgba(212,238,203,.22)', borderRadius: 6, cursor: 'pointer', color: 'var(--brand-dot)', display: 'flex', alignItems: 'center', padding: '2px 6px', gap: 4, marginRight: 4 }}
              >
                <Plus size={11} />
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.08em' }}>ASSIGN</span>
              </button>
            </div>
            <ShiftPanel />
          </>
        )}
        {showAssign && <QuickAssign onClose={() => setShowAssign(false)} />}

        {/* Spacer */}
        <div style={{ flex: 1, minHeight: 12 }} />

        {/* APPEARANCE section */}
        <div style={{ padding: '0 12px 10px' }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.16em', color: 'var(--chrome-muted)', padding: '8px 8px 6px' }}>
            APPEARANCE
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => { if (theme !== 'daylight') toggleTheme() }}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '6px 0', borderRadius: 8, border: `1px solid ${theme === 'daylight' ? 'var(--brand-dot)' : 'var(--chrome-line)'}`, background: theme === 'daylight' ? 'var(--chrome-active)' : 'transparent', color: theme === 'daylight' ? 'var(--brand-dot)' : 'var(--chrome-muted)', cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', transition: 'all 180ms cubic-bezier(.2,.8,.2,1)' }}
            >
              <Sun size={11} /> DAYLIGHT
            </button>
            <button
              onClick={() => { if (theme !== 'lapis') toggleTheme() }}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '6px 0', borderRadius: 8, border: `1px solid ${theme === 'lapis' ? 'var(--brand-dot)' : 'var(--chrome-line)'}`, background: theme === 'lapis' ? 'var(--chrome-active)' : 'transparent', color: theme === 'lapis' ? 'var(--brand-dot)' : 'var(--chrome-muted)', cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', transition: 'all 180ms cubic-bezier(.2,.8,.2,1)' }}
            >
              <Moon size={11} /> LAPIS
            </button>
          </div>
        </div>

        {/* User footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--chrome-line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--brand-dot)', color: '#11305f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 11, flexShrink: 0 }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--chrome-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.full_name || user?.username}</div>
            <div style={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--chrome-muted)', marginTop: 1 }}>{user?.role}</div>
          </div>
          <button
            onClick={() => { authStore.clearAuth(); window.location.href = import.meta.env.BASE_URL }}
            title="Sign out"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--chrome-muted)', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center' }}
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        {/* Top header (navy chrome) */}
        <header style={{ height: 64, flex: '0 0 64px', display: 'flex', alignItems: 'center', gap: 16, padding: '0 28px', background: 'var(--chrome)', borderBottom: '1px solid var(--chrome-line)' }}>
          <div>
            <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 19, letterSpacing: '-0.02em', lineHeight: 1, whiteSpace: 'nowrap', color: 'var(--chrome-ink)' }}>
              {currentPage?.label || ''}
            </div>
          </div>
          <div style={{ flex: 1 }} />

          {/* Location toggle */}
          {(() => {
            const PILLS: { key: 'F1' | 'F2' | 'both'; label: string; color: string }[] = [
              { key: 'F1', label: 'Dharmapuri', color: '#3b82f6' },
              { key: 'F2', label: 'Faridabad', color: '#d97a2b' },
              { key: 'both', label: 'Both', color: '#5d7fae' },
            ]
            return (
              <div style={{ display: 'flex', gap: 3, background: 'var(--chrome-2)', borderRadius: 9, padding: 3 }}>
                {PILLS.map(p => {
                  const on = loc === p.key
                  return (
                    <button key={p.key} disabled={!canSwitchLocation}
                      onClick={() => canSwitchLocation && setLoc(p.key)}
                      style={{ border: 'none', borderRadius: 7, padding: '5px 11px', cursor: canSwitchLocation ? 'pointer' : 'default',
                        background: on ? p.color : 'transparent', color: on ? '#fff' : 'var(--chrome-muted)',
                        fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em' }}>
                      {p.label}
                    </button>
                  )
                })}
              </div>
            )
          })()}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--chrome-2)', border: '1px solid var(--chrome-line)', borderRadius: 9, padding: '0 12px', width: 220, height: 36 }}>
            <Search size={15} style={{ color: 'var(--chrome-muted)', flexShrink: 0 }} />
            <input placeholder="Search…" style={{ border: 'none', background: 'none', outline: 'none', flex: 1, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--chrome-ink)' }} />
          </div>

          {/* Live clock */}
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 500, color: 'var(--chrome-muted)', width: 74, textAlign: 'right', flexShrink: 0 }}>
            {format(now, 'HH:mm:ss')}
          </div>

          <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--brand-dot)', color: '#11305f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 13, flexShrink: 0, userSelect: 'none' }}>
            {initials}
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {children}
        </main>

        {/* ── Status bar (navy chrome) ───────────────────────────────────── */}
        <footer style={{ height: 30, flex: '0 0 30px', display: 'flex', alignItems: 'center', gap: 18, padding: '0 20px', background: 'var(--chrome)', borderTop: '1px solid var(--chrome-line)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--chrome-muted)' }}>
          <span>Active UIDs <b style={{ color: 'var(--chrome-ink-2)' }}>{summary?.uid_active ?? '—'}</b></span>
          <span>On hold <b style={{ color: (summary?.uid_on_hold ?? 0) > 0 ? '#ff9b9b' : 'var(--chrome-ink-2)' }}>{summary?.uid_on_hold ?? '—'}</b></span>
          <span>In furnace <b style={{ color: '#f0c674' }}>{summary?.furnace_batches_running ?? '—'}</b></span>
          <div style={{ flex: 1 }} />
          <span>Updated {format(now, 'HH:mm:ss')}</span>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: summary ? '#22a06b' : '#e5484d', display: 'inline-block' }} />
        </footer>
      </div>
    </div>
  )
}
