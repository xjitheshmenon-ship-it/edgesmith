import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { authStore } from '../store/auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { shiftApi, factoryApi, userApi, shopfloorApi } from '../api/client'
import { format } from 'date-fns'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Package, Search, Monitor, Users, LogOut,
  Plus, X, Zap, ChevronRight, ChevronDown, Sun, Moon,
  Inbox, Link2, Truck, Download, Tag, Factory, Layers, CheckCircle2,
  FileText, Calendar, UserPlus, BarChart3, GitBranch, List, Thermometer, BadgeCheck, Lock,
  Bell, Clock, KeyRound, UserCircle, Hammer, ArrowLeftRight,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toggleTheme, getCurrentTheme, type Theme } from '../store/theme'

interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
  roles: string[]
}
interface NavSection { title: string; items: NavItem[]; location?: 'F1' | 'F2'; defaultCollapsed?: boolean }

const ALL = ['admin', 'manager', 'supervisor', 'operator', 'service', 'shopfloor']
const sz = 16

// Sidebar sections per the CPCMS page-instructions navigation structure.
const SECTIONS: NavSection[] = [
  { title: 'OVERVIEW', items: [
    { label: 'Dashboard', to: '/', icon: <LayoutDashboard size={sz} />, roles: ['admin', 'manager', 'supervisor'] },
    { label: 'Shopfloor Display', to: '/shopfloor', icon: <Monitor size={sz} />, roles: ALL },
  ]},
  { title: 'FARIDABAD', location: 'F2', items: [
    { label: 'Raw Material Intake', to: '/intake', icon: <Inbox size={sz} />, roles: ['admin', 'manager'] },
    { label: 'Joining Operation', to: '/joining', icon: <Link2 size={sz} />, roles: ['admin', 'manager'] },
    { label: 'Contractor Dispatch', to: '/dispatch', icon: <Truck size={sz} />, roles: ['admin', 'manager'] },
  ]},
  { title: 'DHARMAPURI', location: 'F1', items: [
    { label: 'Receiving', to: '/receiving', icon: <Download size={sz} />, roles: ['admin', 'manager', 'supervisor'] },
    { label: 'UID Creation', to: '/uids', icon: <Tag size={sz} />, roles: ['admin', 'manager', 'supervisor'] },
    { label: 'Production Floor', to: '/production', icon: <Factory size={sz} />, roles: ['admin', 'manager', 'supervisor', 'operator'] },
    { label: 'Job Execution', to: '/job-execution', icon: <Hammer size={sz} />, roles: ['admin', 'manager', 'supervisor', 'operator'] },
    { label: 'Batch Management', to: '/batches', icon: <Layers size={sz} />, roles: ['admin', 'manager', 'supervisor'] },
    { label: 'QC', to: '/qc', icon: <CheckCircle2 size={sz} />, roles: ['admin', 'manager', 'supervisor', 'operator'] },
  ]},
  { title: 'MANAGEMENT', items: [
    { label: 'MO Linking', to: '/manufacturing', icon: <FileText size={sz} />, roles: ['admin', 'manager'] },
    { label: 'Shift Management', to: '/shifts', icon: <Calendar size={sz} />, roles: ['admin', 'manager', 'supervisor'] },
    { label: 'Job Assignment', to: '/job-assignment', icon: <UserPlus size={sz} />, roles: ['admin', 'manager', 'supervisor'] },
    { label: 'Reports', to: '/reports', icon: <BarChart3 size={sz} />, roles: ['admin', 'manager', 'supervisor'] },
    { label: 'Service Lookup', to: '/uid-lookup', icon: <Search size={sz} />, roles: ['admin', 'manager', 'supervisor', 'service'] },
  ]},
  { title: 'CONFIGURATION', defaultCollapsed: true, items: [
    { label: 'Cycle Builder', to: '/config', icon: <GitBranch size={sz} />, roles: ['admin', 'manager'] },
    { label: 'Master Lists', to: '/master-lists', icon: <List size={sz} />, roles: ['admin', 'manager'] },
    { label: 'Tempering Parameters', to: '/tempering', icon: <Thermometer size={sz} />, roles: ['admin'] },
    { label: 'Employee Profiles', to: '/employees', icon: <BadgeCheck size={sz} />, roles: ['admin', 'manager'] },
    { label: 'Users and Roles', to: '/users', icon: <Lock size={sz} />, roles: ['admin'] },
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
  const navigate = useNavigate()
  const [showAssign, setShowAssign] = useState(false)
  const [showAlerts, setShowAlerts] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
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
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(SECTIONS.filter(s => s.defaultCollapsed).map(s => s.title))
  )
  const toggleSection = (title: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(title) ? next.delete(title) : next.add(title)
      return next
    })

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

  // Current shift + time remaining (morning 06–14, afternoon 14–22, night 22–06)
  const shiftInfo = (() => {
    const h = now.getHours()
    let n: number, endH: number
    if (h >= 6 && h < 14) { n = 1; endH = 14 }
    else if (h >= 14 && h < 22) { n = 2; endH = 22 }
    else { n = 3; endH = 6 }
    const end = new Date(now)
    if (n === 3 && h >= 22) end.setDate(end.getDate() + 1)
    end.setHours(endH, 0, 0, 0)
    const remMin = Math.max(0, Math.floor((end.getTime() - now.getTime()) / 60000))
    const hh = Math.floor(remMin / 60), mm = remMin % 60
    const color = remMin > 120 ? '#3fbf86' : remMin > 30 ? '#f0c674' : '#ff9b9b'
    return { n, remMin, remLabel: `${hh}:${String(mm).padStart(2, '0')}`, color }
  })()

  // Supervisor on duty sees a handover button that turns red + pulses within 30 min of shift end.
  const handoverDue = role === 'supervisor' && shiftInfo.remMin <= 30

  // Topbar alert dropdown — the seven categories from the spec, in priority order
  // (critical → warning → info). Each is driven by available live data and is
  // simply omitted when its condition can't be evaluated or is zero.
  const alerts = (() => {
    const out: { sev: 'critical' | 'warning' | 'info'; text: string; sub: string; to: string }[] = []
    const onHold = summary?.uid_on_hold ?? 0
    const furnaceDev = summary?.furnace_batches_deviation ?? 0
    const designMissing = summary?.uid_awaiting_design ?? 0
    const badgeExpiring = summary?.badges_expiring ?? 0
    const qcBorderline = summary?.qc_borderline_pending ?? 0
    const consignments = summary?.consignments_pending ?? 0
    // 🔴 critical
    if (onHold > 0) out.push({ sev: 'critical', text: `${onHold} UID${onHold > 1 ? 's' : ''} on hold`, sub: 'Production Floor', to: '/production' })
    if (furnaceDev > 0) out.push({ sev: 'critical', text: `${furnaceDev} furnace batch${furnaceDev > 1 ? 'es' : ''} with deviation`, sub: 'Batch Management', to: '/batches' })
    if (handoverDue) out.push({ sev: 'critical', text: 'Shift handover due — submit before shift ends', sub: 'Shift Management', to: '/shifts' })
    // 🟠 warning
    if (designMissing > 0) out.push({ sev: 'warning', text: `${designMissing} UID${designMissing > 1 ? 's' : ''} awaiting design (Step 15)`, sub: 'UID Creation', to: '/uids' })
    if (badgeExpiring > 0) out.push({ sev: 'warning', text: `${badgeExpiring} operator badge${badgeExpiring > 1 ? 's' : ''} expiring within 30 days`, sub: 'Employee Profiles', to: '/employees' })
    // 🟡 info
    if (qcBorderline > 0) out.push({ sev: 'info', text: `${qcBorderline} borderline QC result${qcBorderline > 1 ? 's' : ''} pending review`, sub: 'QC', to: '/qc' })
    if (consignments > 0) out.push({ sev: 'info', text: `${consignments} expected consignment${consignments > 1 ? 's' : ''} not yet received`, sub: 'Receiving', to: '/receiving' })
    return out
  })()
  const alertCount = alerts.length

  const SEV_COLOR: Record<string, string> = { critical: '#e5484d', warning: '#d97a2b', info: '#f0c674' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', overflow: 'hidden', background: 'var(--bg)', color: 'var(--ink)' }}>

      {/* ══ TOPBAR (full-width navy chrome, 58px) ═══════════════════════════ */}
      <header style={{ height: 58, flex: '0 0 58px', display: 'flex', alignItems: 'center', background: 'var(--chrome)', borderBottom: '1px solid var(--chrome-line)', paddingRight: 16, zIndex: 20 }}>

        {/* Brand block */}
        <div style={{ width: 248, flex: '0 0 248px', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 20px', height: '100%' }}>
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: '-0.035em', lineHeight: 1, color: 'var(--chrome-ink)' }}>
            edgesmith<span style={{ color: 'var(--brand-dot)' }}>.</span>
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, letterSpacing: '0.16em', color: '#7d96bb', marginTop: 4 }}>
            INNOVATE · ENGINEER · EXCEL
          </div>
        </div>

        {/* Vertical divider */}
        <div style={{ width: 1, height: 30, background: 'var(--chrome-line)', flexShrink: 0 }} />

        {/* Page context */}
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8.5, letterSpacing: '0.16em', color: '#5d7fae', whiteSpace: 'nowrap' }}>
            CPCMS · EDGESMITH TOOLING INDIA
          </div>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 600, color: 'var(--chrome-ink-2)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {currentPage?.label || 'Dashboard'}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Centre — location toggle */}
        {(() => {
          const PILLS: { key: 'F1' | 'F2' | 'both'; label: string; color: string }[] = [
            { key: 'F1', label: 'Dharmapuri', color: '#3b82f6' },
            { key: 'F2', label: 'Faridabad', color: '#d97a2b' },
            { key: 'both', label: 'Both', color: '#5d7fae' },
          ]
          return (
            <div style={{ display: 'flex', gap: 3, background: 'var(--chrome-2)', borderRadius: 9, padding: 3, flexShrink: 0 }}>
              {PILLS.map(p => {
                const on = loc === p.key
                return (
                  <button key={p.key} disabled={!canSwitchLocation}
                    onClick={() => canSwitchLocation && setLoc(p.key)}
                    style={{ border: 'none', borderRadius: 7, padding: '6px 13px', cursor: canSwitchLocation ? 'pointer' : 'default',
                      background: on ? p.color : 'transparent', color: on ? '#fff' : 'var(--chrome-muted)',
                      fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em' }}>
                    {p.label}
                  </button>
                )
              })}
            </div>
          )
        })()}

        <div style={{ flex: 1 }} />

        {/* Right — shift button */}
        <button
          onClick={() => navigate('/shifts')}
          title="Shift Management"
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--chrome-2)', border: 'none', borderRadius: 9, padding: '0 12px', height: 36, cursor: 'pointer', flexShrink: 0 }}
        >
          <Clock size={14} style={{ color: shiftInfo.color }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: 'var(--chrome-ink-2)', whiteSpace: 'nowrap' }}>
            Shift {shiftInfo.n} · <span style={{ color: shiftInfo.color }}>{shiftInfo.remLabel}</span>
          </span>
        </button>

        {/* Right — handover button (supervisor on duty, red + pulsing within 30 min of shift end) */}
        {handoverDue && (
          <button
            onClick={() => navigate('/shifts')}
            title="Shift handover due"
            className="animate-pulse-red"
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#e5484d', border: 'none', borderRadius: 9, padding: '0 12px', height: 36, cursor: 'pointer', flexShrink: 0, marginLeft: 10 }}
          >
            <ArrowLeftRight size={14} style={{ color: '#fff' }} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', letterSpacing: '0.04em' }}>
              HANDOVER
            </span>
          </button>
        )}

        {/* Right — alert bell */}
        <div style={{ position: 'relative', marginLeft: 10, flexShrink: 0 }}>
          <button
            onClick={() => { setShowAlerts(s => !s); setShowUserMenu(false) }}
            title="Alerts"
            style={{ width: 36, height: 36, background: 'var(--chrome-2)', border: 'none', borderRadius: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}
          >
            <Bell size={16} style={{ color: 'var(--chrome-ink-2)' }} />
            {alertCount > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: '#e5484d', color: '#fff', border: '2px solid var(--chrome)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {alertCount}
              </span>
            )}
          </button>
          {showAlerts && (
            <>
              <div onClick={() => setShowAlerts(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', top: 44, right: 0, width: 340, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 13, boxShadow: '0 18px 40px rgba(21,54,106,.20)', zIndex: 50, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' }}>
                  <span style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>Alerts</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)' }}>{alertCount} active</span>
                </div>
                {alerts.length === 0 ? (
                  <div style={{ padding: '8px 16px 18px', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink-2)' }}>No active alerts.</div>
                ) : alerts.map((a, i) => (
                  <button key={i} onClick={() => { setShowAlerts(false); navigate(a.to) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: '1px solid var(--line)', padding: '11px 16px', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: SEV_COLOR[a.sev], flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink)' }}>{a.text}</span>
                      <span style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginTop: 1 }}>{a.sub}</span>
                    </span>
                    <ChevronRight size={14} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right — user block */}
        <div style={{ position: 'relative', marginLeft: 14, flexShrink: 0 }}>
          <button
            onClick={() => { setShowUserMenu(s => !s); setShowAlerts(false) }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--brand-dot)', color: '#11305f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 12.5, flexShrink: 0 }}>
              {initials}
            </div>
            <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 600, color: 'var(--chrome-ink)', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{user?.full_name || user?.username}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.08em', color: 'var(--chrome-muted)', lineHeight: 1.2 }}>{user?.role?.toUpperCase()}</span>
            </div>
            <ChevronDown size={14} style={{ color: 'var(--chrome-muted)', flexShrink: 0 }} />
          </button>
          {showUserMenu && (
            <>
              <div onClick={() => setShowUserMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', top: 46, right: 0, width: 236, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 13, boxShadow: '0 18px 40px rgba(21,54,106,.20)', zIndex: 50, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--brand-dot)', color: '#11305f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{initials}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.full_name || user?.username}</div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginTop: 1 }}>{user?.role}</div>
                  </div>
                </div>
                <button onClick={() => { setShowUserMenu(false); navigate('/employees') }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 44, padding: '0 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}>
                  <UserCircle size={16} style={{ color: 'var(--ink-2)' }} /> View profile
                </button>
                <button onClick={() => { setShowUserMenu(false); navigate('/users') }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 44, padding: '0 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}>
                  <KeyRound size={16} style={{ color: 'var(--ink-2)' }} /> Change password
                </button>
                <button onClick={() => { authStore.clearAuth(); window.location.href = import.meta.env.BASE_URL }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 44, padding: '0 16px', background: 'none', border: 'none', borderTop: '1px solid var(--line)', cursor: 'pointer', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: '#e5484d' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(229,72,77,.07)'} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}>
                  <LogOut size={16} /> Logout
                </button>
              </div>
            </>
          )}
        </div>

        {/* Right — live clock */}
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 500, color: 'var(--chrome-muted)', width: 74, textAlign: 'right', flexShrink: 0, marginLeft: 14 }}>
          {format(now, 'HH:mm:ss')}
        </div>
      </header>

      {/* ══ MIDDLE ROW (sidebar + content) ══════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

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

        {/* Role pill */}
        <div style={{ padding: '12px 16px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--chrome-hover)', border: '1px solid var(--chrome-line)', borderRadius: 9, padding: '7px 11px' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--brand-dot)', flexShrink: 0 }} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.1em', color: 'var(--chrome-ink-2)', fontWeight: 600, flex: 1 }}>{user?.role?.toUpperCase()}</span>
            {canSwitchLocation && (
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--chrome-muted)' }}>{loc === 'both' ? 'ALL SITES' : loc === 'F1' ? 'DHARMAPURI' : 'FARIDABAD'}</span>
            )}
          </div>
        </div>

        {/* Sectioned nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', padding: '8px 12px 0' }}>
          {visibleSections.map(section => {
            const isCollapsed = collapsed.has(section.title)
            const sectionActive = section.items.some(it => it.to !== '/' && (location.pathname === it.to || location.pathname.startsWith(it.to + '/')))
            return (
            <div key={section.title} style={{ marginBottom: 6 }}>
              <button
                onClick={() => toggleSection(section.title)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.16em',
                  color: sectionActive && isCollapsed ? 'var(--brand-dot)' : 'var(--chrome-muted)', padding: '12px 8px 6px', textAlign: 'left' }}
              >
                <ChevronDown size={11} style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }} />
                {section.title}
              </button>
              {!isCollapsed && section.items.map((item, i) => {
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
            )
          })}
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

        {/* Shift summary strip */}
        <div style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--chrome-line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={13} style={{ color: shiftInfo.color, flexShrink: 0 }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--chrome-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Shift {shiftInfo.n} · <span style={{ color: shiftInfo.color }}>{shiftInfo.remLabel}</span> left
          </span>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
        {children}
      </main>

      </div>{/* end middle row */}

      {/* ══ STATUS BAR (full-width navy chrome, 30px) ═══════════════════════ */}
      <footer style={{ height: 30, flex: '0 0 30px', display: 'flex', alignItems: 'center', gap: 18, padding: '0 20px', background: 'var(--chrome)', borderTop: '1px solid var(--chrome-line)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--chrome-muted)' }}>
        <span>Active UIDs <b style={{ color: 'var(--chrome-ink-2)' }}>{summary?.uid_active ?? '—'}</b></span>
        <span>On hold <b style={{ color: (summary?.uid_on_hold ?? 0) > 0 ? '#ff9b9b' : 'var(--chrome-ink-2)' }}>{summary?.uid_on_hold ?? '—'}</b></span>
        <span>In furnace <b style={{ color: '#f0c674' }}>{summary?.furnace_batches_running ?? '—'}</b></span>
        <div style={{ flex: 1 }} />
        <span style={{ color: '#5d7fae' }}>Shift {shiftInfo.n} · {loc === 'both' ? 'All Sites' : loc === 'F1' ? 'Dharmapuri' : 'Faridabad'} · {shiftInfo.remLabel} remaining</span>
        <div style={{ flex: 1 }} />
        <span>Updated {format(now, 'HH:mm:ss')}</span>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: summary ? '#22a06b' : '#e5484d', display: 'inline-block' }} />
      </footer>
    </div>
  )
}
