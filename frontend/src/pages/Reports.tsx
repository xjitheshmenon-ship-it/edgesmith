import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { shopfloorApi, uidApi, manufacturingApi, temperingApi } from '../api/client'
import type { DashboardSummary, ShopfloorStatus, UID, ManufacturingOrder } from '../types'
import {
  BarChart3, Boxes, Flame, Truck, ClipboardList, ShieldCheck, Search,
  AlertTriangle, CheckCircle, Clock, TrendingUp, PackageSearch,
  Users, Gauge,
} from 'lucide-react'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'

/* ─── design tokens (local mirrors) ────────────────────────────────────────── */
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
  blue: '#3b82f6',
}
const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"

const STORAGE_ORDER = ['RM', 'RM-Q', 'RM-D', 'HT-Q', 'HT-D', 'MC-Q', 'MC-D', 'QC-Q', 'QC-D', 'FG']

/* Furnace base capacity (bars per batch) @ the 1500mm reference bar size —
   mirrors BatchManagement. Used by the Capacity Utilisation report (Report 9). */
const FURNACE_CAPACITY: Record<string, number> = { HT70: 6, HT80: 6, HT90: 80 }
const furnaceCapacityFor = (wsCode?: string | null): number => {
  if (!wsCode) return 0
  return FURNACE_CAPACITY[wsCode.slice(0, 4).toUpperCase()] ?? 0
}
const isFurnaceWsCode = (code?: string | null) => /^HT(70|80|90)/i.test(code ?? '')

/* Bar sizes the furnace capacity is quoted against (updated spec — Report 9).
   1500mm is the base reference; 1424 / 2750 are the other physical bar lengths. */
const BAR_SIZES_MM = [1500, 1424, 2750]

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

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  fontFamily: MONO, fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap',
}

const TH: React.CSSProperties = {
  textAlign: 'left', padding: '8px 12px', fontFamily: MONO, fontSize: 9.5, fontWeight: 700,
  letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3,
  borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  padding: '10px 12px', borderBottom: `1px solid var(--surface-2)`, fontSize: 12.5, color: C.ink, verticalAlign: 'middle',
}

/* A report card shell with title, subtitle, and an optional right slot. */
function ReportCard({
  icon, title, subtitle, right, children,
}: {
  icon: React.ReactNode; title: string; subtitle: string; right?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: C.surface3, color: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {icon}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 17, letterSpacing: '-0.02em', color: C.ink, lineHeight: 1.15 }}>{title}</div>
          <div style={{ fontFamily: SANS, fontSize: 12, color: C.ink2, marginTop: 2 }}>{subtitle}</div>
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

/* Small metric tile used inside report cards. */
function MiniMetric({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: '11px 13px' }}>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 22, letterSpacing: '-0.03em', color: color ?? C.ink, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.ink3, marginTop: 6 }}>{label}</div>
    </div>
  )
}

/* Horizontal CSS bar row: label · bar · value. */
function BarRow({ label, value, max, color, suffix }: { label: string; value: number; max: number; color: string; suffix?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr 56px', alignItems: 'center', gap: 10 }}>
      <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.ink2, letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ height: 9, borderRadius: 5, background: C.surface3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: value === 0 ? C.line : color, borderRadius: 5, transition: 'width 300ms cubic-bezier(.2,.8,.2,1)' }} />
      </div>
      <span style={{ fontFamily: ARCHIVO, fontWeight: 700, fontSize: 13, color: value === 0 ? C.ink3 : C.ink, textAlign: 'right' }}>
        {value.toLocaleString()}{suffix ?? ''}
      </span>
    </div>
  )
}

/* Empty / no-data-source notice inside a report card. */
function NoSource({ text }: { text: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, padding: '14px 14px', borderRadius: 10,
      background: C.surface2, border: `1px dashed ${C.line}`, color: C.ink2, fontFamily: SANS, fontSize: 12.5, lineHeight: 1.5,
    }}>
      <AlertTriangle size={15} style={{ color: C.orange, flexShrink: 0, marginTop: 1 }} />
      <span>{text}</span>
    </div>
  )
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: SANS, fontSize: 12.5, color: C.ink3, padding: '14px 2px' }}>{children}</div>
}

/* ─── filter controls ──────────────────────────────────────────────────────── */
type LocFilter = 'all' | 'dharmapuri' | 'faridabad'
const RANGE_OPTS: { key: number; label: string }[] = [
  { key: 7, label: '7d' },
  { key: 30, label: '30d' },
  { key: 90, label: '90d' },
  { key: 365, label: '1y' },
]

function Segmented<T extends string | number>({ value, onChange, opts }: {
  value: T; onChange: (v: T) => void; opts: { key: T; label: string; color?: string }[]
}) {
  return (
    <div style={{ display: 'inline-flex', background: C.surface3, borderRadius: 9, padding: 3, gap: 2 }}>
      {opts.map((o) => {
        const active = value === o.key
        return (
          <button key={String(o.key)} onClick={() => onChange(o.key)} style={{
            border: 'none', cursor: 'pointer', borderRadius: 7, padding: '5px 13px',
            fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
            background: active ? (o.color ?? C.ink) : 'transparent',
            color: active ? '#fff' : C.ink2, transition: 'background 160ms',
          }}>{o.label}</button>
        )
      })}
    </div>
  )
}

/* ─── helpers ──────────────────────────────────────────────────────────────── */
function safeDate(iso?: string | null): Date | null {
  if (!iso) return null
  try { const d = parseISO(iso); return isNaN(d.getTime()) ? null : d } catch { return null }
}
function matchesLoc(code: string | null | undefined, name: string | null | undefined, loc: LocFilter): boolean {
  if (loc === 'all') return true
  const hay = `${code ?? ''} ${name ?? ''}`.toLowerCase()
  return hay.includes(loc.slice(0, 4))
}

/* ─── page ─────────────────────────────────────────────────────────────────── */
export default function Reports() {
  const [rangeDays, setRangeDays] = useState<number>(30)
  const [loc, setLoc] = useState<LocFilter>('all')

  const cutoff = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - rangeDays)
    d.setHours(0, 0, 0, 0)
    return d
  }, [rangeDays])

  /* ── data ── */
  const summaryQ = useQuery<DashboardSummary>({
    queryKey: ['rpt-dashboard'],
    queryFn: () => shopfloorApi.dashboard().then((r) => r.data),
    refetchInterval: 60_000,
  })
  const shopfloorQ = useQuery<ShopfloorStatus[]>({
    queryKey: ['rpt-shopfloor'],
    queryFn: () => shopfloorApi.status().then((r) => r.data),
    refetchInterval: 60_000,
  })
  // Pull a broad UID set to derive throughput / WIP age / on-hold reports client-side.
  const uidsQ = useQuery<UID[]>({
    queryKey: ['rpt-uids'],
    queryFn: () => uidApi.list({ limit: 1000 }).then((r) => r.data.items ?? []),
    refetchInterval: 60_000,
    retry: false,
  })
  const ordersQ = useQuery<ManufacturingOrder[]>({
    queryKey: ['rpt-orders'],
    queryFn: () => manufacturingApi.orders().then((r) => r.data ?? []),
    retry: false,
  })
  const batchesQ = useQuery<any[]>({
    queryKey: ['rpt-batches'],
    queryFn: () => temperingApi.batches().then((r) => r.data ?? []),
    retry: false,
  })

  const summary = summaryQ.data
  const shopfloor = useMemo(
    () => (shopfloorQ.data ?? []).filter((l) => matchesLoc(l.location_code, l.location_name, loc)),
    [shopfloorQ.data, loc],
  )
  const uids = uidsQ.data ?? []
  const orders = ordersQ.data ?? []
  const batches = batchesQ.data ?? []

  // Location-filtered UID set (uses factory_location_code).
  const locUids = useMemo(
    () => uids.filter((u) => matchesLoc(u.factory_location_code, null, loc)),
    [uids, loc],
  )

  /* ── Report 1: Production Output (throughput) ── */
  const output = useMemo(() => {
    const created = locUids.filter((u) => { const d = safeDate(u.created_at); return d && d >= cutoff }).length
    const dispatched = locUids.filter((u) => u.status === 'dispatched').length
    const inProd = locUids.filter((u) => u.status === 'active' || u.status === 'on_hold' || u.status === 'converting').length
    // Daily UID-creation series across the range (capped to a readable number of bars).
    const buckets = Math.min(rangeDays, 14)
    const bucketSize = Math.max(1, Math.ceil(rangeDays / buckets))
    const series: { label: string; count: number }[] = []
    for (let i = buckets - 1; i >= 0; i--) {
      const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (i + 1) * bucketSize + 1)
      const end = new Date(); end.setHours(23, 59, 59, 999); end.setDate(end.getDate() - i * bucketSize)
      const count = locUids.filter((u) => { const d = safeDate(u.created_at); return d && d >= start && d <= end }).length
      series.push({ label: format(end, 'd MMM'), count })
    }
    return { created, dispatched, inProd, series }
  }, [locUids, cutoff, rangeDays])
  const outputMax = Math.max(1, ...output.series.map((s) => s.count))

  /* ── Report 2: WIP Summary ── */
  // WIP by storage (snapshot from shopfloor status).
  const wipByStorage = useMemo(() => {
    const m = new Map<string, number>()
    shopfloor.forEach((l) => l.storage_locations.forEach((s) => m.set(s.code, (m.get(s.code) ?? 0) + s.uid_count)))
    const ordered = STORAGE_ORDER.map((code) => ({ code, count: m.get(code) ?? 0 }))
    const extra = [...m.keys()].filter((k) => !STORAGE_ORDER.includes(k)).map((code) => ({ code, count: m.get(code) ?? 0 }))
    return [...ordered, ...extra]
  }, [shopfloor])
  const wipMax = Math.max(1, ...wipByStorage.map((s) => s.count))

  // Age distribution of WIP (UIDs still in production).
  const ageBands = useMemo(() => {
    const bands = [
      { label: '0–2 days', min: 0, max: 2, count: 0 },
      { label: '3–7 days', min: 3, max: 7, count: 0 },
      { label: '8–14 days', min: 8, max: 14, count: 0 },
      { label: '15–30 days', min: 15, max: 30, count: 0 },
      { label: '30+ days', min: 31, max: Infinity, count: 0 },
    ]
    locUids
      .filter((u) => u.status !== 'dispatched' && u.status !== 'archived')
      .forEach((u) => {
        const d = safeDate(u.created_at)
        if (!d) return
        const age = differenceInCalendarDays(new Date(), d)
        const b = bands.find((x) => age >= x.min && age <= x.max)
        if (b) b.count++
      })
    return bands
  }, [locUids])
  const ageMax = Math.max(1, ...ageBands.map((b) => b.count))

  /* ── Report 3: WIP at workstations (running) ── */
  const wsLoad = useMemo(() => {
    const rows = shopfloor.flatMap((l) => l.workstations.map((w) => ({ code: w.code, name: w.name, count: w.uid_count })))
    return rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count).slice(0, 10)
  }, [shopfloor])
  const wsMax = Math.max(1, ...wsLoad.map((r) => r.count))

  /* ── Report 4: On-hold analysis ── */
  const holdRows = useMemo(() => {
    return locUids
      .filter((u) => u.status === 'on_hold')
      .map((u) => ({
        code: u.code,
        step: u.current_step_name ?? '—',
        storage: u.current_storage_code ?? '—',
        mo: u.mo_number ?? '—',
        reason: (u.notes && u.notes.trim()) ? u.notes.trim() : 'Reason not recorded',
        ageDays: (() => { const d = safeDate(u.created_at); return d ? differenceInCalendarDays(new Date(), d) : null })(),
      }))
      .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0))
  }, [locUids])
  // Group hold by current step (proxy for "by reason" until a reason field exists).
  const holdByStep = useMemo(() => {
    const m = new Map<string, number>()
    holdRows.forEach((r) => m.set(r.step, (m.get(r.step) ?? 0) + 1))
    return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  }, [holdRows])
  const holdMax = Math.max(1, ...holdByStep.map((h) => h.count))

  /* ── Report 5: Furnace batch log ── */
  const furnace = useMemo(() => {
    const inRange = batches.filter((b: any) => { const d = safeDate(b.started_at); return !d || d >= cutoff })
    const completed = inRange.filter((b: any) => b.ended_at)
    const deviations = inRange.filter((b: any) => b.deviation_flagged).length
    const uidsProcessed = inRange.reduce((s: number, b: any) => s + (b.uid_count ?? 0), 0)
    const devRate = completed.length > 0 ? Math.round((deviations / completed.length) * 100) : 0
    const rows = [...inRange]
      .sort((a: any, b: any) => (safeDate(b.started_at)?.getTime() ?? 0) - (safeDate(a.started_at)?.getTime() ?? 0))
      .slice(0, 12)
    return { total: inRange.length, completed: completed.length, deviations, devRate, uidsProcessed, rows }
  }, [batches, cutoff])

  /* ── Report 6: MO fulfilment ── */
  const moRows = useMemo(() => {
    return orders.map((o) => {
      const dispatched = locUids.filter((u) => u.mo_id === o.id && u.status === 'dispatched').length
      const linked = o.uid_count ?? 0
      const required = o.quantity ?? 0
      const pct = required > 0 ? Math.min(100, Math.round((dispatched / required) * 100)) : 0
      const remaining = Math.max(0, required - dispatched)
      const onHold = locUids.filter((u) => u.mo_id === o.id && u.status === 'on_hold').length
      return { ...o, dispatched, linked, required, pct, remaining, onHold }
    }).sort((a, b) => a.pct - b.pct)
  }, [orders, locUids])
  const moOpen = moRows.filter((m) => m.status !== 'completed' && m.status !== 'cancelled').length
  const moAtRisk = moRows.filter((m) => m.onHold > 0).length

  /* ── Report 7: Material traceability search ── */
  const [traceTerm, setTraceTerm] = useState('')
  const traceResults = useMemo(() => {
    const term = traceTerm.trim().toLowerCase()
    if (!term) return []
    return uids.filter((u) => {
      const hay = [u.alloy_heat_number, u.ms_heat_number, u.alloy_supplier, u.ms_supplier, u.rolling_contractor, u.code]
        .filter(Boolean).join(' ').toLowerCase()
      return hay.includes(term)
    }).slice(0, 50)
  }, [uids, traceTerm])

  /* ── Report 9: Capacity Utilisation — furnace capacity by bar size ── */
  // Group in-range furnace batches by their furnace (workstation) and compare
  // average bars/batch against the known max capacity (@1500mm reference).
  const capacity = useMemo(() => {
    const inRange = batches.filter((b: any) => {
      if (!isFurnaceWsCode(b.workstation_code)) return false
      const d = safeDate(b.started_at)
      return !d || d >= cutoff
    })
    const byFurnace = new Map<string, { runs: number; bars: number; full: number; partial: number; max: number }>()
    inRange.forEach((b: any) => {
      const key = (b.workstation_code ?? '').slice(0, 4).toUpperCase() || '—'
      const max = furnaceCapacityFor(b.workstation_code)
      const bars = b.uid_count ?? 0
      const cur = byFurnace.get(key) ?? { runs: 0, bars: 0, full: 0, partial: 0, max }
      cur.runs += 1
      cur.bars += bars
      cur.max = max || cur.max
      if (max > 0 && bars >= max) cur.full += 1
      else cur.partial += 1
      byFurnace.set(key, cur)
    })
    const rows = [...byFurnace.entries()].map(([furnace, v]) => {
      const avgFill = v.runs > 0 ? v.bars / v.runs : 0
      const util = v.max > 0 ? Math.round((avgFill / v.max) * 100) : 0
      return { furnace, runs: v.runs, avgFill, max: v.max, util, full: v.full, partial: v.partial }
    }).sort((a, b) => b.runs - a.runs)
    return { rows, total: inRange.length }
  }, [batches, cutoff])

  /* ── Report 8: Shift Performance ── */
  // No shift-tagged production data is exposed by the API (step_history lacks a
  // shift field on the list endpoint), so we surface the few shift-adjacent
  // signals we do have and degrade the rest gracefully.
  const shift = useMemo(() => {
    const furnaceBatches = batches.filter((b: any) => {
      const d = safeDate(b.started_at)
      return !d || d >= cutoff
    })
    const furnaceDeviations = furnaceBatches.filter((b: any) => b.deviation_flagged).length
    return {
      furnaceBatches: furnaceBatches.length,
      furnaceDeviations,
      compliance: furnaceBatches.length > 0
        ? Math.round(((furnaceBatches.length - furnaceDeviations) / furnaceBatches.length) * 100)
        : 0,
    }
  }, [batches, cutoff])

  const anyLoading = summaryQ.isLoading || shopfloorQ.isLoading || uidsQ.isLoading
  const dispatchTrendSource = summary?.uids_dispatched_today

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>

      {/* header + filters */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: C.ink }}>Reports</div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, marginTop: 3 }}>
            Operational &amp; management reporting · derived live from production data
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', color: C.ink3, textTransform: 'uppercase' }}>Date range</span>
            <Segmented value={rangeDays} onChange={setRangeDays} opts={RANGE_OPTS} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', color: C.ink3, textTransform: 'uppercase' }}>Location</span>
            <Segmented value={loc} onChange={setLoc} opts={[
              { key: 'dharmapuri', label: 'Dharmapuri', color: C.blue },
              { key: 'faridabad', label: 'Faridabad', color: C.orange },
              { key: 'all', label: 'Both' },
            ]} />
          </div>
        </div>
      </div>

      {anyLoading && (
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.ink3, padding: '8px 0 18px' }}>Loading report data…</div>
      )}
      {(summaryQ.isError || shopfloorQ.isError) && (
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.red, padding: '12px 16px', background: 'rgba(229,72,77,.10)', borderRadius: 10, border: '1px solid rgba(229,72,77,.25)', marginBottom: 18 }}>
          Could not load some report data. The server may be starting up — refresh in a moment.
        </div>
      )}

      {/* ─── Report 1: Production Output ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 1.4fr)', gap: 16, marginBottom: 16 }}>
        <ReportCard icon={<BarChart3 size={18} />} title="Production Output" subtitle={`Throughput over the last ${rangeDays} days`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 4 }}>
            <MiniMetric label={`UIDs Created (${rangeDays}d)`} value={output.created.toLocaleString()} color={C.blue} />
            <MiniMetric label="UIDs Dispatched" value={output.dispatched.toLocaleString()} color={C.green} />
            <MiniMetric label="In Production" value={output.inProd.toLocaleString()} />
          </div>
        </ReportCard>

        <ReportCard
          icon={<TrendingUp size={18} />} title="UID Creation Trend" subtitle="New UIDs generated per period"
          right={<span style={{ ...pill, background: C.surface3, color: C.ink2 }}>{output.series.reduce((s, x) => s + x.count, 0)} total</span>}
        >
          {output.series.every((s) => s.count === 0) ? (
            <EmptyLine>No UIDs created in this period.</EmptyLine>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {output.series.map((s, i) => (
                <BarRow key={i} label={s.label} value={s.count} max={outputMax} color={C.blue} />
              ))}
            </div>
          )}
          <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 9, color: C.ink3, letterSpacing: '0.05em' }}>
            Per-step throughput &amp; avg time per workstation require step-history aggregation (not yet exposed by API).
          </div>
        </ReportCard>
      </div>

      {/* ─── Report 2: WIP Summary ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.1fr) minmax(280px, 1fr)', gap: 16, marginBottom: 16 }}>
        <ReportCard icon={<Boxes size={18} />} title="WIP Summary — By Storage" subtitle="Snapshot of work-in-progress · flow RM → FG">
          {wipByStorage.every((s) => s.count === 0) ? (
            <EmptyLine>No WIP recorded across storage locations.</EmptyLine>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {wipByStorage.map((s) => (
                <BarRow key={s.code} label={s.code} value={s.count} max={wipMax} color={s.count > wipMax * 0.8 ? C.orange : C.accent} />
              ))}
            </div>
          )}
        </ReportCard>

        <ReportCard icon={<Clock size={18} />} title="WIP Age Distribution" subtitle="How long pieces have been in production">
          {ageBands.every((b) => b.count === 0) ? (
            <EmptyLine>No work-in-progress to age.</EmptyLine>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {ageBands.map((b) => (
                <BarRow key={b.label} label={b.label} value={b.count} max={ageMax}
                  color={b.min >= 15 ? C.red : b.min >= 8 ? C.orange : C.green} />
              ))}
            </div>
          )}
          <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 9, color: C.ink3, letterSpacing: '0.05em' }}>
            Avg creation→dispatch cycle time needs dispatch timestamps (not yet exposed).
          </div>
        </ReportCard>
      </div>

      {/* ─── Report 3: Workstation load + On-hold analysis ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(320px, 1.3fr)', gap: 16, marginBottom: 16 }}>
        <ReportCard icon={<BarChart3 size={18} />} title="Workstation Load" subtitle="Live UID count per active workstation (top 10)">
          {wsLoad.length === 0 ? (
            <EmptyLine>No active workstations with load.</EmptyLine>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {wsLoad.map((r) => (
                <BarRow key={r.code} label={r.code} value={r.count} max={wsMax} color={C.accent} />
              ))}
            </div>
          )}
        </ReportCard>

        <ReportCard
          icon={<AlertTriangle size={18} />} title="On-Hold Analysis" subtitle="UIDs currently on hold · grouped by step"
          right={<span style={{ ...pill, background: holdRows.length ? 'rgba(229,72,77,.13)' : C.surface3, color: holdRows.length ? C.redText : C.ink2 }}>{holdRows.length} on hold</span>}
        >
          {holdRows.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 2px', color: C.ink3, fontFamily: SANS, fontSize: 12.5 }}>
              <CheckCircle size={15} style={{ color: C.green }} /> No UIDs on hold.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 14 }}>
                {holdByStep.map((h) => (
                  <BarRow key={h.label} label={h.label} value={h.count} max={holdMax} color={C.red} />
                ))}
              </div>
              <div style={{ overflowX: 'auto', margin: '0 -8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
                  <thead><tr>
                    <th style={TH}>UID</th><th style={TH}>Step</th><th style={TH}>Storage</th>
                    <th style={TH}>Reason</th><th style={{ ...TH, textAlign: 'right' }}>Age</th>
                  </tr></thead>
                  <tbody>
                    {holdRows.slice(0, 8).map((r) => (
                      <tr key={r.code}>
                        <td style={{ ...TD, fontFamily: MONO, fontWeight: 600, color: C.accent }}>{r.code}</td>
                        <td style={{ ...TD, fontFamily: SANS, color: C.ink2 }}>{r.step}</td>
                        <td style={{ ...TD, fontFamily: MONO, color: C.ink2 }}>{r.storage}</td>
                        <td style={{ ...TD, fontFamily: SANS, color: C.ink2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: C.ink2 }}>{r.ageDays != null ? `${r.ageDays}d` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 9, color: C.ink3, letterSpacing: '0.05em' }}>
                Grouped by current step — a dedicated hold-reason field is not yet captured.
              </div>
            </>
          )}
        </ReportCard>
      </div>

      {/* ─── Report 4: Furnace Batch Log ─── */}
      <ReportCard
        icon={<Flame size={18} />} title="Furnace Batch Log" subtitle={`Tempering runs · last ${rangeDays} days · target vs actual`}
        right={furnace.total > 0 ? <span style={{ ...pill, background: furnace.deviations ? 'rgba(229,72,77,.13)' : 'rgba(34,160,107,.14)', color: furnace.deviations ? C.redText : C.greenText }}>{furnace.devRate}% deviation</span> : undefined}
      >
        {batchesQ.isError ? (
          <NoSource text="Furnace batch data source is not available right now." />
        ) : batches.length === 0 ? (
          <EmptyLine>No furnace batches recorded yet.</EmptyLine>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
              <MiniMetric label="Batches" value={furnace.total} />
              <MiniMetric label="Completed" value={furnace.completed} color={C.green} />
              <MiniMetric label="Deviations" value={furnace.deviations} color={furnace.deviations ? C.red : undefined} />
              <MiniMetric label="UIDs Processed" value={furnace.uidsProcessed} color={C.blue} />
            </div>
            <div style={{ overflowX: 'auto', margin: '0 -8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead><tr>
                  <th style={TH}>Batch</th><th style={TH}>Cycle</th><th style={TH}>Step</th>
                  <th style={{ ...TH, textAlign: 'right' }}>UIDs</th>
                  <th style={TH}>Target</th><th style={TH}>Actual</th>
                  <th style={TH}>Flag</th><th style={{ ...TH, textAlign: 'right' }}>Started</th>
                </tr></thead>
                <tbody>
                  {furnace.rows.map((b: any) => (
                    <tr key={b.id}>
                      <td style={{ ...TD, fontFamily: MONO, fontWeight: 600, color: C.accent }}>{b.batch_number}</td>
                      <td style={{ ...TD, fontFamily: SANS, color: C.ink2 }}>{b.cycle_type_name ?? '—'}</td>
                      <td style={{ ...TD, fontFamily: MONO, color: C.ink2 }}>{b.step_number != null ? `Step ${b.step_number}` : '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: ARCHIVO, fontWeight: 700 }}>{b.uid_count ?? 0}</td>
                      <td style={{ ...TD, fontFamily: MONO, color: C.ink2 }}>{b.target_temp_c ? `${b.target_temp_c}°C / ${b.target_soak_minutes}m` : '—'}</td>
                      <td style={{ ...TD, fontFamily: MONO, color: b.deviation_flagged ? C.red : C.ink }}>
                        {b.actuals_recorded ? `${b.actual_temp_c}°C / ${b.actual_soak_minutes}m` : b.ended_at ? 'Not recorded' : '—'}
                      </td>
                      <td style={{ ...TD }}>
                        {b.deviation_flagged
                          ? <span style={{ ...pill, background: 'rgba(229,72,77,.13)', color: C.red }}>Deviation</span>
                          : b.ended_at
                            ? <span style={{ ...pill, background: 'rgba(34,160,107,.14)', color: C.greenText }}>OK</span>
                            : <span style={{ ...pill, background: C.surface3, color: C.ink2 }}>Running</span>}
                      </td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: C.ink2 }}>{b.started_at ? format(new Date(b.started_at), 'd MMM HH:mm') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </ReportCard>

      {/* ─── Report 5: MO Fulfilment ─── */}
      <div style={{ marginTop: 16 }}>
        <ReportCard
          icon={<ClipboardList size={18} />} title="MO Fulfilment" subtitle="Manufacturing order completion & dispatch status"
          right={<div style={{ display: 'flex', gap: 6 }}>
            <span style={{ ...pill, background: C.surface3, color: C.ink2 }}>{moOpen} open</span>
            {moAtRisk > 0 && <span style={{ ...pill, background: 'rgba(229,72,77,.13)', color: C.redText }}>{moAtRisk} at risk</span>}
          </div>}
        >
          {ordersQ.isError ? (
            <NoSource text="Manufacturing order data source is not available right now." />
          ) : moRows.length === 0 ? (
            <EmptyLine>No manufacturing orders found.</EmptyLine>
          ) : (
            <div style={{ overflowX: 'auto', margin: '0 -8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead><tr>
                  <th style={TH}>MO</th><th style={TH}>Customer</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Required</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Linked</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Dispatched</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Remaining</th>
                  <th style={{ ...TH, width: 160 }}>Progress</th>
                </tr></thead>
                <tbody>
                  {moRows.slice(0, 14).map((m) => (
                    <tr key={m.id}>
                      <td style={{ ...TD, fontFamily: MONO, fontWeight: 600, color: C.accent }}>
                        {m.mo_number}
                        {m.onHold > 0 && <span style={{ ...pill, background: 'rgba(229,72,77,.13)', color: C.red, marginLeft: 6, fontSize: 9 }}>HOLD</span>}
                      </td>
                      <td style={{ ...TD, fontFamily: SANS, color: C.ink2 }}>{m.customer || '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: MONO }}>{m.required}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: C.ink2 }}>{m.linked}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: C.greenText }}>{m.dispatched}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: m.remaining > 0 ? C.orange : C.ink3 }}>{m.remaining}</td>
                      <td style={{ ...TD }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 8, borderRadius: 4, background: C.surface3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${m.pct}%`, background: m.pct >= 100 ? C.green : m.pct > 0 ? C.accent : C.line, borderRadius: 4, transition: 'width 300ms' }} />
                          </div>
                          <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.ink2, width: 34, textAlign: 'right' }}>{m.pct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 9, color: C.ink3, letterSpacing: '0.05em' }}>
                Overdue detection &amp; dispatch-per-day trend require MO delivery dates &amp; dispatch timestamps (not yet exposed).
                {dispatchTrendSource != null && ` Dispatched today: ${dispatchTrendSource}.`}
              </div>
            </div>
          )}
        </ReportCard>
      </div>

      {/* ─── Report 6: Quality Report ─── */}
      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(300px, 1fr)', gap: 16 }}>
        <ReportCard icon={<ShieldCheck size={18} />} title="Quality Report" subtitle="QC pass/fail rates & rework frequency">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14 }}>
            <MiniMetric label="On Hold (proxy)" value={holdRows.length} color={holdRows.length ? C.red : undefined} />
            <MiniMetric label="Furnace Deviations" value={furnace.deviations} color={furnace.deviations ? C.red : undefined} />
          </div>
          <NoSource text="QC pass/fail rates, failures by reason and rework frequency require a QC-results endpoint (step-history QC data is not yet aggregated by the API). On-hold and furnace-deviation counts are shown above as the closest available signals." />
        </ReportCard>

        {/* ─── Report 7: Material Traceability ─── */}
        <ReportCard icon={<PackageSearch size={18} />} title="Material Traceability" subtitle="Trace UIDs by heat number, supplier or contractor">
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: C.ink3 }} />
            <input
              className="input"
              style={{ paddingLeft: 32 }}
              placeholder="Heat number, supplier, contractor…"
              value={traceTerm}
              onChange={(e) => setTraceTerm(e.target.value)}
            />
          </div>
          {!traceTerm.trim() ? (
            <EmptyLine>Enter a heat number, supplier name or contractor to trace linked UIDs.</EmptyLine>
          ) : traceResults.length === 0 ? (
            <EmptyLine>No UIDs match “{traceTerm.trim()}”.</EmptyLine>
          ) : (
            <div style={{ overflowX: 'auto', margin: '0 -8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
                <thead><tr>
                  <th style={TH}>UID</th><th style={TH}>Heat No</th>
                  <th style={TH}>Status</th><th style={TH}>MO</th>
                </tr></thead>
                <tbody>
                  {traceResults.map((u) => (
                    <tr key={u.id}>
                      <td style={{ ...TD, fontFamily: MONO, fontWeight: 600, color: C.accent }}>{u.code}</td>
                      <td style={{ ...TD, fontFamily: MONO, color: C.ink2 }}>{u.alloy_heat_number || u.ms_heat_number || '—'}</td>
                      <td style={{ ...TD }}>
                        <span style={{ ...pill, background: u.status === 'dispatched' ? 'rgba(34,160,107,.14)' : u.status === 'on_hold' ? 'rgba(229,72,77,.13)' : C.surface3, color: u.status === 'dispatched' ? C.greenText : u.status === 'on_hold' ? C.redText : C.ink2 }}>
                          {u.status}
                        </span>
                      </td>
                      <td style={{ ...TD, fontFamily: MONO, color: C.ink2 }}>{u.mo_number ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ReportCard>
      </div>

      {/* Scrap & Yield note (spec Report 4) */}
      <div style={{ marginTop: 16 }}>
        <ReportCard icon={<Truck size={18} />} title="Scrap & Yield" subtitle="Material utilisation from Converting (Step 16)">
          <NoSource text="Scrap and yield reporting (input vs output length, scrap by reason, yield % per conversion pattern) requires converting-step output data, which is not yet exposed by the API. Conversion patterns define expected kerf/scrap but per-run actuals are not available." />
        </ReportCard>
      </div>

      {/* ─── Report 8: Shift Performance ─── */}
      <div style={{ marginTop: 16 }}>
        <ReportCard
          icon={<Users size={18} />} title="Shift Performance" subtitle="Production & activity by shift, supervisor and operator"
          right={shift.furnaceBatches > 0
            ? <span style={{ ...pill, background: 'rgba(34,160,107,.14)', color: C.greenText }}>{shift.compliance}% furnace compliance</span>
            : undefined}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 14 }}>
            <MiniMetric label={`Furnace Batches (${rangeDays}d)`} value={shift.furnaceBatches} color={C.blue} />
            <MiniMetric label="Parameter Deviations" value={shift.furnaceDeviations} color={shift.furnaceDeviations ? C.red : undefined} />
            <MiniMetric label="On Hold (current)" value={holdRows.length} color={holdRows.length ? C.red : undefined} />
          </div>
          <NoSource text="Per-shift breakdown — UIDs & steps per shift, jobs per operator, idle time, handover completion rate and QC pass rate per shift — requires shift-tagged step history and handover records, which the API does not yet expose on the reporting endpoints. Furnace batch volume and parameter compliance are shown above as the available shift-adjacent signals; filter by date range using the controls at the top of the page." />
        </ReportCard>
      </div>

      {/* ─── Report 9: Capacity Utilisation (furnace by bar size) ─── */}
      <div style={{ marginTop: 16 }}>
        <ReportCard
          icon={<Gauge size={18} />} title="Capacity Utilisation" subtitle={`Furnace fill vs max capacity · bar sizes ${BAR_SIZES_MM.join(' / ')}mm`}
          right={capacity.total > 0 ? <span style={{ ...pill, background: C.surface3, color: C.ink2 }}>{capacity.total} furnace runs</span> : undefined}
        >
          {batchesQ.isError ? (
            <NoSource text="Furnace batch data source is not available right now." />
          ) : capacity.rows.length === 0 ? (
            <EmptyLine>No furnace batches in this period to compute utilisation.</EmptyLine>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 14 }}>
                {capacity.rows.map((r) => (
                  <div key={r.furnace} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 120px', alignItems: 'center', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: C.ink }}>{r.furnace}</div>
                      <div style={{ fontFamily: MONO, fontSize: 9, color: C.ink3, letterSpacing: '0.04em' }}>{r.runs} batches · max {r.max} bars</div>
                    </div>
                    <BarRow label={`${r.avgFill.toFixed(1)} avg`} value={Math.round(r.util)} max={100} color={r.util >= 90 ? C.green : r.util >= 60 ? C.accent : C.orange} suffix="%" />
                    <div style={{ fontFamily: MONO, fontSize: 10, color: C.ink2, textAlign: 'right' }}>
                      <span style={{ color: C.greenText }}>{r.full} full</span> · <span style={{ color: C.orange }}>{r.partial} partial</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ overflowX: 'auto', margin: '0 -8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                  <thead><tr>
                    <th style={TH}>Furnace</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Batches</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Avg Fill</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Max (1500mm)</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Utilisation</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Full / Partial</th>
                  </tr></thead>
                  <tbody>
                    {capacity.rows.map((r) => (
                      <tr key={r.furnace}>
                        <td style={{ ...TD, fontFamily: MONO, fontWeight: 600, color: C.accent }}>{r.furnace}</td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: ARCHIVO, fontWeight: 700 }}>{r.runs}</td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: C.ink2 }}>{r.avgFill.toFixed(1)}</td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: C.ink2 }}>{r.max || '—'}</td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: r.util >= 90 ? C.greenText : r.util >= 60 ? C.ink : C.orange }}>{r.util}%</td>
                        <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: C.ink2 }}>{r.full} / {r.partial}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 9, color: C.ink3, letterSpacing: '0.05em' }}>
                Max capacity is the base @1500mm reference. Per-bar-size split ({BAR_SIZES_MM.join(' / ')}mm) and per-shift throughput
                need a bar-size / shift tag on each batch, which the API does not yet expose.
              </div>
            </>
          )}
        </ReportCard>
      </div>

      {/* footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22, fontFamily: MONO, fontSize: 10, color: C.ink3, letterSpacing: '0.06em' }}>
        <Clock size={11} />
        Reports derived live from production data · refreshes every 60s.
      </div>
    </div>
  )
}
