import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { shopfloorApi, uidApi } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import type { DashboardSummary, ShopfloorStatus, UID } from '../types'
import {
  Package, AlertTriangle, CheckCircle, FileClock, Flame, Truck,
  ChevronRight, Box, Cpu, Bell, Clock, ArrowUpRight,
} from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { Link } from 'react-router-dom'

/* ─── design tokens (local mirrors of palette where no CSS var exists) ─────── */
const C = {
  ink: 'var(--ink)',
  ink2: 'var(--ink-2)',
  ink3: 'var(--ink-3)',
  accent: 'var(--accent)',
  line: 'var(--line)',
  surface: 'var(--surface)',
  surface2: 'var(--surface-2)',
  surface3: 'var(--surface-3)',
  red: '#e5484d',
  redText: '#c0392b',
  orange: '#d97a2b',
  amber: '#f0c674',
  green: '#22a06b',
  greenText: '#1c7a52',
}
const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"

/* canonical storage-location flow order (Dharmapuri) */
const STORAGE_ORDER = ['RM', 'RM-Q', 'RM-D', 'HT-Q', 'HT-D', 'MC-Q', 'MC-D', 'QC-Q', 'QC-D', 'FG']
const STORAGE_CAP = 50 // typical capacity reference for relative bar

/* ─── small primitives ─────────────────────────────────────────────────────── */
function SectionLabel({ icon, children, right }: { icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      {icon}
      <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: C.ink3, textTransform: 'uppercase' }}>{children}</span>
      <div style={{ flex: 1 }} />
      {right}
    </div>
  )
}

function CycleBadge({ name }: { name: string | null }) {
  if (!name) return null
  const key = name.toUpperCase()
  const map: Record<string, { bg: string; fg: string }> = {
    EAT:  { bg: 'rgba(45,111,181,.14)', fg: C.accent },
    SWAN: { bg: 'rgba(34,160,107,.14)', fg: C.greenText },
    OVEN: { bg: 'rgba(217,122,43,.14)', fg: C.orange },
  }
  const s = map[key] ?? { bg: C.surface3, fg: C.ink2 }
  return <span style={{ ...pill, background: s.bg, color: s.fg }}>{key}</span>
}

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  fontFamily: MONO, fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap',
}

/* ─── metric card ──────────────────────────────────────────────────────────── */
function StatCard({ label, value, icon, color, to }: {
  label: string; value: number | string; icon: React.ReactNode; color: string; to?: string
}) {
  const inner = (
    <div style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14,
      padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      boxShadow: 'var(--shadow-e1)', height: '100%', transition: 'box-shadow 180ms', position: 'relative',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', color: C.ink3, textTransform: 'uppercase', marginBottom: 8, lineHeight: 1.3 }}>{label}</div>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 32, letterSpacing: '-0.04em', color: C.ink, lineHeight: 1 }}>{value}</div>
      </div>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: `${color}22`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      {to && <ArrowUpRight size={13} style={{ position: 'absolute', top: 12, right: 12, color: C.ink3 }} />}
    </div>
  )
  return to ? <Link to={to} style={{ textDecoration: 'none', display: 'block' }}>{inner}</Link> : inner
}

/* ─── alerts panel ─────────────────────────────────────────────────────────── */
type Severity = 'critical' | 'warning' | 'info'
interface AlertItem { severity: Severity; text: string; sub: string; to: string }
const SEV_COLOR: Record<Severity, string> = { critical: C.red, warning: C.orange, info: C.amber }
const SEV_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

function AlertsPanel({ summary, holdUids }: { summary?: DashboardSummary; holdUids: UID[] }) {
  const alerts = useMemo<AlertItem[]>(() => {
    const out: AlertItem[] = []
    holdUids.slice(0, 6).forEach((u) => {
      out.push({
        severity: 'critical',
        text: `${u.code} on hold${u.current_step_name ? ` at ${u.current_step_name}` : ''}`,
        sub: u.notes ? u.notes.slice(0, 48) : 'Reason not recorded · Production Floor',
        to: '/uids',
      })
    })
    if (summary && summary.awaiting_design_confirmation > 0) {
      out.push({
        severity: 'warning',
        text: `${summary.awaiting_design_confirmation} UID${summary.awaiting_design_confirmation === 1 ? '' : 's'} awaiting design confirmation`,
        sub: 'Approaching design lock (Step 15/16) · UIDs',
        to: '/uids',
      })
    }
    if (summary && summary.faridabad_batches_in_transit > 0) {
      out.push({
        severity: 'info',
        text: `${summary.faridabad_batches_in_transit} Faridabad batch${summary.faridabad_batches_in_transit === 1 ? '' : 'es'} in transit`,
        sub: 'Billets expected — not yet received · Receiving',
        to: '/receiving',
      })
    }
    return out.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])
  }, [summary, holdUids])

  return (
    <div className="card" style={{ padding: '18px 20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <SectionLabel
        icon={<Bell size={13} style={{ color: C.ink3 }} />}
        right={alerts.length > 0
          ? <span style={{ ...pill, background: 'rgba(229,72,77,.13)', color: C.redText }}>{alerts.length} active</span>
          : undefined}
      >Alerts</SectionLabel>

      {alerts.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '24px 0', color: C.ink3, fontFamily: SANS, fontSize: 13 }}>
          <CheckCircle size={16} style={{ color: C.green }} />
          No active alerts. Everything is on track.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {alerts.map((a, i) => (
            <Link key={i} to={a.to} className="row-hover" style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 8px',
              borderBottom: i < alerts.length - 1 ? `1px solid var(--surface-2)` : 'none',
              textDecoration: 'none', borderRadius: 8,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: SEV_COLOR[a.severity], marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink, fontWeight: 500 }}>{a.text}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: C.ink3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.sub}</div>
              </div>
              <ChevronRight size={14} style={{ color: C.ink3, marginTop: 2, flexShrink: 0 }} />
            </Link>
          ))}
        </div>
      )}
      <div style={{ flex: 1 }} />
      <div style={{ marginTop: 12, paddingTop: 10, fontFamily: MONO, fontSize: 9.5, color: C.ink3, letterSpacing: '0.06em' }}>
        Furnace deviation & QC sign-off alerts require dedicated endpoints (not yet available).
      </div>
    </div>
  )
}

/* ─── priority queue ───────────────────────────────────────────────────────── */
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '8px 12px', fontFamily: MONO, fontSize: 9.5, fontWeight: 700,
  letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3,
  borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  padding: '11px 12px', borderBottom: `1px solid var(--surface-2)`, fontSize: 12.5, color: C.ink, verticalAlign: 'middle',
}

function waitingLabel(iso: string) {
  try { return formatDistanceToNowStrict(new Date(iso)) } catch { return '—' }
}

function PriorityQueue({ uids, loading }: { uids: UID[]; loading: boolean }) {
  // High priority (and urgent) UIDs still in production, longest-waiting first.
  const rows = useMemo(() => {
    return uids
      .filter((u) => (u.priority === 'high' || u.priority === 'urgent') && u.status !== 'dispatched' && u.status !== 'archived')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(0, 12)
  }, [uids])

  return (
    <div className="card" style={{ padding: '18px 20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <SectionLabel
        icon={<AlertTriangle size={13} style={{ color: C.red }} />}
        right={<Link to="/uids" style={{ fontFamily: MONO, fontSize: 10, color: C.accent, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>All UIDs <ChevronRight size={11} /></Link>}
      >Priority Queue — High Priority</SectionLabel>

      {loading ? (
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.ink3, padding: '20px 0' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink3, padding: '20px 0' }}>No high-priority UIDs in production.</div>
      ) : (
        <div style={{ overflowX: 'auto', margin: '0 -8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={TH}>UID</th>
                <th style={TH}>Cycle</th>
                <th style={TH}>Step</th>
                <th style={TH}>Storage</th>
                <th style={TH}>Design</th>
                <th style={TH}>MO</th>
                <th style={{ ...TH, textAlign: 'right' }}>Waiting</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="row-hover" style={{ cursor: 'pointer' }}>
                  <td style={TD}>
                    <Link to="/uids" style={{ fontFamily: MONO, fontWeight: 600, fontSize: 12.5, color: C.accent, textDecoration: 'none' }}>{u.code}</Link>
                    {u.priority === 'urgent' && <span style={{ ...pill, background: 'rgba(229,72,77,.13)', color: C.red, marginLeft: 6, fontSize: 9 }}>URGENT</span>}
                  </td>
                  <td style={TD}><CycleBadge name={u.cycle_type_name} /></td>
                  <td style={{ ...TD, fontFamily: SANS }}>
                    <span style={{ fontFamily: MONO, color: C.ink2, marginRight: 5 }}>{u.current_step_number ?? '—'}</span>
                    {u.current_step_name ?? '—'}
                  </td>
                  <td style={{ ...TD, fontFamily: MONO, color: C.ink2 }}>{u.current_storage_code ?? '—'}</td>
                  <td style={{ ...TD, fontFamily: MONO, color: u.design_code ? C.ink : C.orange }}>
                    {u.design_code ?? 'PENDING'}
                  </td>
                  <td style={{ ...TD, fontFamily: MONO, color: C.ink2 }}>{u.mo_number ?? '—'}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: C.ink2 }}>{waitingLabel(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ─── WIP by storage location ──────────────────────────────────────────────── */
function StorageTile({ code, count }: { code: string; count: number }) {
  const pct = Math.min(100, (count / STORAGE_CAP) * 100)
  const fill = count === 0 ? C.line : count > STORAGE_CAP * 0.8 ? C.red : count > STORAGE_CAP * 0.5 ? C.amber : C.green
  return (
    <Link to="/shopfloor" style={{
      textDecoration: 'none', background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10,
      padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 8,
    }} className="row-hover">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.ink3, letterSpacing: '0.08em' }}>{code}</span>
        <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 20, color: count === 0 ? C.ink3 : C.ink, lineHeight: 1 }}>{count}</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: C.line, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: fill, borderRadius: 2, transition: 'width 300ms cubic-bezier(.2,.8,.2,1)' }} />
      </div>
    </Link>
  )
}

function WIPByStorage({ shopfloor }: { shopfloor: ShopfloorStatus[] }) {
  // Merge counts per storage code across visible locations, in canonical flow order.
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    shopfloor.forEach((loc) => loc.storage_locations.forEach((s) => m.set(s.code, (m.get(s.code) ?? 0) + s.uid_count)))
    const ordered = STORAGE_ORDER.map((code) => ({ code, count: m.get(code) ?? 0 }))
    // append any extra storage codes not in canonical order
    const extra = [...m.keys()].filter((k) => !STORAGE_ORDER.includes(k)).map((code) => ({ code, count: m.get(code) ?? 0 }))
    return [...ordered, ...extra]
  }, [shopfloor])

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <SectionLabel icon={<Box size={13} style={{ color: C.ink3 }} />}>WIP by Storage Location · Flow RM → FG</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8 }}>
        {counts.map((s) => <StorageTile key={s.code} code={s.code} count={s.count} />)}
      </div>
    </div>
  )
}

/* ─── active workstation summary ───────────────────────────────────────────── */
function wsStatus(count: number): { label: string; color: string } {
  if (count === 0) return { label: 'IDLE', color: C.ink3 }
  if (count > 10) return { label: 'BUSY', color: C.amber }
  return { label: 'RUNNING', color: C.green }
}

function WorkstationSummary({ shopfloor }: { shopfloor: ShopfloorStatus[] }) {
  const rows = useMemo(() => {
    const all = shopfloor.flatMap((loc) =>
      loc.workstations.map((w) => ({ ...w, location_code: loc.location_code }))
    )
    return all.sort((a, b) => b.uid_count - a.uid_count)
  }, [shopfloor])

  const running = rows.filter((r) => r.uid_count > 0).length

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <SectionLabel
        icon={<Cpu size={13} style={{ color: C.ink3 }} />}
        right={<Link to="/shopfloor" style={{ fontFamily: MONO, fontSize: 10, color: C.accent, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>Production Floor <ChevronRight size={11} /></Link>}
      >Active Workstations · {running} running</SectionLabel>

      {rows.length === 0 ? (
        <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink3, padding: '12px 0' }}>No workstations configured.</div>
      ) : (
        <div style={{ overflowX: 'auto', margin: '0 -8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
            <thead>
              <tr>
                <th style={TH}>WS</th>
                <th style={TH}>Name</th>
                <th style={{ ...TH, textAlign: 'right' }}>Running</th>
                <th style={{ ...TH, textAlign: 'right' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const st = wsStatus(w.uid_count)
                return (
                  <tr key={w.workstation_id} className="row-hover" style={{ cursor: 'pointer' }}>
                    <td style={{ ...TD }}>
                      <Link to="/shopfloor" style={{ fontFamily: MONO, fontWeight: 600, fontSize: 12.5, color: C.accent, textDecoration: 'none', letterSpacing: '0.04em' }}>{w.code}</Link>
                    </td>
                    <td style={{ ...TD, fontFamily: SANS, color: C.ink2 }}>{w.name || w.code}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: ARCHIVO, fontWeight: 700, fontSize: 15, color: w.uid_count > 0 ? C.ink : C.ink3 }}>{w.uid_count}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: st.color }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.color, display: 'inline-block' }} />
                        {st.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ─── location filter toggle ───────────────────────────────────────────────── */
type LocFilter = 'all' | 'dharmapuri' | 'faridabad'
function LocationToggle({ value, onChange }: { value: LocFilter; onChange: (v: LocFilter) => void }) {
  const opts: { key: LocFilter; label: string; color: string }[] = [
    { key: 'dharmapuri', label: 'Dharmapuri', color: '#3b82f6' },
    { key: 'faridabad', label: 'Faridabad', color: C.orange },
    { key: 'all', label: 'Both', color: C.ink2 },
  ]
  return (
    <div style={{ display: 'inline-flex', background: C.surface3, borderRadius: 9, padding: 3, gap: 2 }}>
      {opts.map((o) => {
        const active = value === o.key
        return (
          <button key={o.key} onClick={() => onChange(o.key)} style={{
            border: 'none', cursor: 'pointer', borderRadius: 7, padding: '5px 13px',
            fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
            background: active ? (o.key === 'all' ? C.ink : o.color) : 'transparent',
            color: active ? '#fff' : C.ink2,
            transition: 'background 160ms',
          }}>{o.label}</button>
        )
      })}
    </div>
  )
}

/* ─── page ─────────────────────────────────────────────────────────────────── */
export default function Dashboard() {
  const { user } = useAuth()
  const [loc, setLoc] = useState<LocFilter>('all')

  const { data: summary, isError: summaryError } = useQuery<DashboardSummary>({
    queryKey: ['dashboard'],
    queryFn: () => shopfloorApi.dashboard().then((r) => r.data),
    refetchInterval: 20_000,
  })

  const { data: shopfloor = [], isLoading: shopfloorLoading, isError: shopfloorError } = useQuery<ShopfloorStatus[]>({
    queryKey: ['shopfloor'],
    queryFn: () => shopfloorApi.status().then((r) => r.data),
    refetchInterval: 20_000,
  })

  // High-priority UIDs for the priority queue (server-side priority filter when supported).
  const { data: highResult, isLoading: highLoading } = useQuery({
    queryKey: ['dash-high-uids'],
    queryFn: () => uidApi.list({ priority: 'high', limit: 50 }).then((r) => r.data),
    refetchInterval: 30_000,
    retry: false,
  })
  // On-hold UIDs to source the alerts panel.
  const { data: holdResult } = useQuery({
    queryKey: ['dash-hold-uids'],
    queryFn: () => uidApi.list({ status: 'on_hold', limit: 20 }).then((r) => r.data),
    refetchInterval: 30_000,
    retry: false,
  })

  const highUids: UID[] = highResult?.items ?? []
  const holdUids: UID[] = holdResult?.items ?? []

  // Filter shopfloor locations by the toggle.
  const visibleShopfloor = useMemo(() => {
    if (loc === 'all') return shopfloor
    return shopfloor.filter((l) => l.location_code?.toLowerCase().includes(loc.slice(0, 4)) || l.location_name?.toLowerCase().includes(loc))
  }, [shopfloor, loc])

  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 1320 }}>

      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: C.ink }}>Dashboard</div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, marginTop: 3 }}>
            Welcome back{user?.full_name ? `, ${user.full_name}` : ''} · single view across both locations
          </div>
        </div>
        {(user?.role === 'admin' || user?.role === 'manager') && (
          <LocationToggle value={loc} onChange={setLoc} />
        )}
      </div>

      {summaryError && !summary && (
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.red, padding: '12px 16px', background: 'rgba(229,72,77,.10)', borderRadius: 10, border: '1px solid rgba(229,72,77,.25)', marginBottom: 18 }}>
          Could not load dashboard summary. The server may be starting up — refresh in a moment.
        </div>
      )}

      {/* metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(196px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="Active UIDs"                  value={(summary?.uid_active ?? 0).toLocaleString()}             icon={<Package size={20} />}       color="#3b82f6" />
        <StatCard label="On Hold"                      value={summary?.uid_on_hold ?? 0}                                icon={<AlertTriangle size={20} />} color={C.red}    to="/uids" />
        <StatCard label="Awaiting Design Confirmation" value={summary?.awaiting_design_confirmation ?? 0}               icon={<FileClock size={20} />}     color="#a78bfa"  to="/uids" />
        <StatCard label="Furnace Batches Running"      value={summary?.furnace_batches_running ?? 0}                    icon={<Flame size={20} />}         color={C.orange} to="/tempering" />
        <StatCard label="UIDs Dispatched Today"        value={(summary?.uids_dispatched_today ?? 0).toLocaleString()}   icon={<CheckCircle size={20} />}   color={C.green} />
        <StatCard label="Faridabad Batches in Transit" value={summary?.faridabad_batches_in_transit ?? 0}               icon={<Truck size={20} />}         color="#0ea5e9"  to="/receiving" />
      </div>

      {/* alerts + priority queue */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 0.9fr) minmax(420px, 1.6fr)', gap: 16, marginBottom: 20 }}>
        <AlertsPanel summary={summary} holdUids={holdUids} />
        <PriorityQueue uids={highUids} loading={highLoading} />
      </div>

      {/* shopfloor errors */}
      {shopfloorError && (
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.red, padding: '12px 16px', background: 'rgba(229,72,77,.10)', borderRadius: 10, border: '1px solid rgba(229,72,77,.25)', marginBottom: 18 }}>
          Could not load shopfloor data. Refresh in a moment.
        </div>
      )}
      {shopfloorLoading && !shopfloor.length && (
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.ink3, padding: '20px 0' }}>Loading shopfloor data…</div>
      )}

      {/* WIP by storage + workstation summary */}
      {visibleShopfloor.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.1fr) minmax(360px, 1fr)', gap: 16 }}>
          <WIPByStorage shopfloor={visibleShopfloor} />
          <WorkstationSummary shopfloor={visibleShopfloor} />
        </div>
      )}

      {!shopfloorLoading && visibleShopfloor.length === 0 && !shopfloorError && (
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.ink3, padding: '20px 0' }}>
          {shopfloor.length === 0 ? 'No factory locations configured.' : 'No locations match the current filter.'}
        </div>
      )}

      {/* live footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22, fontFamily: MONO, fontSize: 10, color: C.ink3, letterSpacing: '0.06em' }}>
        <Clock size={11} />
        Live data refreshes every 20–30s.
      </div>
    </div>
  )
}
