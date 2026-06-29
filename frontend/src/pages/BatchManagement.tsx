import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { temperingApi, cycleApi, uidApi } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import {
  Flame,
  AlertTriangle,
  CheckCircle,
  Plus,
  X,
  Layers,
  RefreshCw,
  Search,
  Clock,
  Ruler,
  Wrench,
  Sparkles,
} from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'

// ── Furnace capacity model (per spec lines 538–557) ───────────────────────────
// Base capacity is defined at 1500mm. Capacity for other bar lengths is derived
// from the proportion of bed/rack length a longer bar consumes. The spec gives
// explicit base (1500mm) and 2750mm figures; 1424mm shares the 1500mm slot count.
//   Step      Furnace  1500mm   2750mm
//   Hardening HT70     6        3
//   Quenching HT80     6        3
//   Tempering HT90     80       43
const FURNACE_CAPACITY_BY_SIZE: Record<string, { 1500: number; 1424: number; 2750: number }> = {
  HT70: { 1500: 6, 1424: 6, 2750: 3 },
  HT80: { 1500: 6, 1424: 6, 2750: 3 },
  HT90: { 1500: 80, 1424: 80, 2750: 43 },
}
const isFurnaceWsCode = (code?: string | null) => /^HT(70|80|90)/i.test(code ?? '')
const isFurnaceStepName = (name?: string | null) => {
  const n = (name ?? '').toLowerCase()
  return n.includes('temper') || n.includes('harden') || n.includes('quench') || n.includes('stress')
}
// Grinding workstation prefixes (per spec — SG/AG machines).
const isGrindingWsCode = (code?: string | null) => /^(SG|AG)/i.test(code ?? '')

const furnaceKey = (wsCode?: string | null) => (wsCode ? wsCode.slice(0, 4).toUpperCase() : '')

// Base capacity (1500mm) — used when bar size is unknown.
const furnaceCapacityFor = (wsCode?: string | null) => {
  const tier = FURNACE_CAPACITY_BY_SIZE[furnaceKey(wsCode)]
  return tier ? tier[1500] : 0
}

// Size-aware capacity. 2750mm bars derive a smaller capacity; 1500/1424mm share base.
const furnaceCapacityForSize = (wsCode: string | null | undefined, sizeMm?: number | null) => {
  const tier = FURNACE_CAPACITY_BY_SIZE[furnaceKey(wsCode)]
  if (!tier) return 0
  if (sizeMm == null) return tier[1500]
  if (sizeMm >= 2750) return tier[2750]
  if (sizeMm >= 1424 && sizeMm < 1500) return tier[1424]
  return tier[1500]
}

// ── Grinding machine rules (per spec lines 2279–2539) ─────────────────────────
const MACHINE_BED_MM = 3000
const BUNCH_BARS_PER_SET_DEFAULT = 5 // Admin-configurable via Master Lists

interface GrindMachine {
  unit: string // display name (Delta / Gamma / Beta / Alpha)
  code: string // SG-DLT / AG-GMM / AG-BTA / AG-ALP
  maxMm: number
  maxBars: number
}
// Surface grinding (Steps 12, 20) — SG-DLT, single 3000mm bed, up to 2 bars.
const SURFACE_MACHINE: GrindMachine = { unit: 'Delta', code: 'SG-DLT', maxMm: 3000, maxBars: 2 }
// Bevel grinding (Step 22) — four-machine assignment board.
const BEVEL_MACHINES: GrindMachine[] = [
  { unit: 'Alpha', code: 'AG-ALP', maxMm: 1500, maxBars: 1 },
  { unit: 'Beta', code: 'AG-BTA', maxMm: 1500, maxBars: 1 },
  { unit: 'Gamma', code: 'AG-GMM', maxMm: 3000, maxBars: 2 },
]
// Valid surface/angle pairings illustrated in the spec.
const PAIRING_RULES: { combo: string; total: number; ok: boolean }[] = [
  { combo: '1500 + 1500', total: 3000, ok: true },
  { combo: '1500 + 1424', total: 2924, ok: true },
  { combo: '1424 + 1424', total: 2848, ok: true },
  { combo: '2750 alone', total: 2750, ok: true },
  { combo: '> 3000 combined', total: 3001, ok: false },
]
// Classify a grinding step from its number / operation name.
type GrindKind = 'bunch' | 'surface' | 'bevel' | 'other'
const grindKindFor = (step: { step_number?: string; operation_name?: string; workstation_code?: string }): GrindKind => {
  const n = (step.operation_name ?? '').toLowerCase()
  const sn = String(step.step_number ?? '')
  if (n.includes('bunch') || sn === '4') return 'bunch'
  if (n.includes('bevel') || n.includes('angle') || sn === '22' || /^AG/i.test(step.workstation_code ?? '')) return 'bevel'
  if (n.includes('surface') || sn === '12' || sn === '20') return 'surface'
  return 'other'
}

type Tab = 'furnace' | 'grinding' | 'production'

// A flattened "furnace step" derived from cycle definitions: every step on an
// HT-series workstation across all current cycle versions.
interface FurnaceStepRef {
  cycle_type_id: number
  cycle_type_name: string
  cycle_step_id: number
  step_number: string
  operation_name: string
  workstation_code: string
}

// A non-furnace (production / grinding) workstation step with a queue.
interface ProductionStepRef {
  cycle_type_id: number
  cycle_type_name: string
  cycle_step_id: number
  step_number: string
  operation_name: string
  workstation_code: string
  workstation_name: string
  grinding: boolean
}

export default function BatchManagement() {
  const [tab, setTab] = useState<Tab>('furnace')
  const [showForm, setShowForm] = useState(false)
  const [selectedBatch, setSelectedBatch] = useState<any>(null)
  const [search, setSearch] = useState('')
  const qc = useQueryClient()
  const { user } = useAuth()
  const isSupervisor =
    user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor'

  const cyclesQ = useQuery({ queryKey: ['cycles'], queryFn: () => cycleApi.list().then((r) => r.data) })
  const paramsQ = useQuery({
    queryKey: ['tempering-params'],
    queryFn: () => temperingApi.parameters().then((r) => r.data),
  })
  const batchesQ = useQuery({
    queryKey: ['furnace-batches'],
    queryFn: () => temperingApi.batches().then((r) => r.data),
    refetchInterval: 30_000,
  })

  const cycles: any[] = cyclesQ.data ?? []

  // ── Derive furnace step references from cycle definitions ──────────────────
  const furnaceSteps = useMemo<FurnaceStepRef[]>(() => {
    const out: FurnaceStepRef[] = []
    for (const ct of cycles) {
      for (const s of ct.current_version?.steps ?? []) {
        if (isFurnaceWsCode(s.workstation_code) || isFurnaceStepName(s.operation_name)) {
          out.push({
            cycle_type_id: ct.id,
            cycle_type_name: ct.name,
            cycle_step_id: s.id,
            step_number: s.step_number,
            operation_name: s.operation_name,
            workstation_code: s.workstation_code,
          })
        }
      }
    }
    return out
  }, [cycles])

  // ── Derive non-furnace step references (production / grinding queues) ──────
  const productionSteps = useMemo<ProductionStepRef[]>(() => {
    const out: ProductionStepRef[] = []
    for (const ct of cycles) {
      for (const s of ct.current_version?.steps ?? []) {
        if (isFurnaceWsCode(s.workstation_code) || isFurnaceStepName(s.operation_name)) continue
        if (s.is_qc_step) continue
        out.push({
          cycle_type_id: ct.id,
          cycle_type_name: ct.name,
          cycle_step_id: s.id,
          step_number: s.step_number,
          operation_name: s.operation_name,
          workstation_code: s.workstation_code,
          workstation_name: s.workstation_name,
          grinding: isGrindingWsCode(s.workstation_code),
        })
      }
    }
    return out
  }, [cycles])

  const batches: any[] = batchesQ.data ?? []
  const activeBatches = batches.filter((b: any) => !b.ended_at)
  const term = search.trim().toLowerCase()
  const filteredBatches = term
    ? batches.filter(
        (b: any) =>
          (b.batch_number ?? '').toLowerCase().includes(term) ||
          (b.cycle_type_name ?? '').toLowerCase().includes(term)
      )
    : batches

  const summary = {
    active: activeBatches.length,
    awaiting: batches.filter((b: any) => !b.ended_at).length,
    deviations: batches.filter((b: any) => b.deviation_flagged).length,
    total: batches.length,
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 18,
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "'Archivo', sans-serif",
              fontWeight: 800,
              fontSize: 24,
              letterSpacing: '-0.03em',
              color: 'var(--ink)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Layers size={20} color="var(--accent)" />
            Batch Management
          </div>
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: 'var(--ink-3)',
              letterSpacing: '0.1em',
              marginTop: 4,
              textTransform: 'uppercase',
            }}
          >
            FURNACE (HT70/80/90) · GRINDING (BUNCH/SURFACE/BEVEL) · CAPACITY · DEVIATION CONTROL
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--ink-3)' }} />
            <input
              className="input"
              style={{ width: 200, paddingLeft: 32 }}
              placeholder="Search batch / cycle…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="btn-secondary" onClick={() => batchesQ.refetch()} title="Refresh">
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Summary stat tiles ──────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <StatTile value={summary.active} label="Active furnace batches" color="var(--warning)" />
        <StatTile value={summary.deviations} label="Flagged deviations" color={summary.deviations > 0 ? 'var(--error)' : undefined} />
        <StatTile value={summary.total} label="Total batches" />
        <StatTile value={productionSteps.filter((s) => s.grinding).length} label="Grinding steps" />
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, alignItems: 'center' }}>
        {(
          [
            ['furnace', 'Furnace Batches'],
            ['grinding', 'Grinding Batches'],
            ['production', 'Production Batches'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => {
              setTab(t)
              setShowForm(false)
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10.5,
              letterSpacing: '0.08em',
              background: tab === t ? 'var(--accent)' : 'var(--surface-2)',
              color: tab === t ? 'var(--accent-ink)' : 'var(--ink-2)',
              fontWeight: tab === t ? 700 : 400,
              textTransform: 'uppercase',
            }}
          >
            {label}
          </button>
        ))}
        {tab === 'furnace' && isSupervisor && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className="btn-primary"
            style={{ marginLeft: 'auto', gap: 6 }}
          >
            {showForm ? <X size={13} /> : <Plus size={13} />}
            {showForm ? 'Cancel' : 'Build Furnace Batch'}
          </button>
        )}
      </div>

      {/* ── Build-a-batch flow ──────────────────────────────────────────────── */}
      {tab === 'furnace' && showForm && isSupervisor && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <BuildBatchForm
            steps={furnaceSteps}
            params={paramsQ.data ?? []}
            onDone={() => {
              setShowForm(false)
              qc.invalidateQueries({ queryKey: ['furnace-batches'] })
            }}
          />
        </div>
      )}

      {/* ── Furnace tab body ────────────────────────────────────────────────── */}
      {tab === 'furnace' && (
        <>
          {/* Active furnace batch cards */}
          <SectionLabel>Active Furnace Batches</SectionLabel>
          {batchesQ.isLoading ? (
            <LoadingCard />
          ) : batchesQ.isError ? (
            <ErrorCard onRetry={() => batchesQ.refetch()} />
          ) : activeBatches.length === 0 ? (
            <EmptyCard text="No active furnace batches running." />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: 14,
                marginBottom: 26,
              }}
            >
              {activeBatches.map((b: any) => (
                <FurnaceBatchCard key={b.id} batch={b} onOpen={() => setSelectedBatch(b)} />
              ))}
            </div>
          )}

          {/* Furnace batch log */}
          <SectionLabel>Furnace Batch Log</SectionLabel>
          <FurnaceBatchLog
            data={filteredBatches}
            loading={batchesQ.isLoading}
            error={batchesQ.isError}
            onRetry={() => batchesQ.refetch()}
            onSelect={setSelectedBatch}
          />
        </>
      )}

      {/* ── Grinding tab body ───────────────────────────────────────────────── */}
      {tab === 'grinding' && (
        <GrindingBatches
          steps={productionSteps.filter((s) => s.grinding)}
          loading={cyclesQ.isLoading}
          error={cyclesQ.isError}
          onRetry={() => cyclesQ.refetch()}
        />
      )}

      {/* ── Production tab body ─────────────────────────────────────────────── */}
      {tab === 'production' && (
        <ProductionBatches
          steps={productionSteps.filter((s) => !s.grinding)}
          loading={cyclesQ.isLoading}
          error={cyclesQ.isError}
          onRetry={() => cyclesQ.refetch()}
        />
      )}

      {/* ── Batch detail drawer ─────────────────────────────────────────────── */}
      {selectedBatch && (
        <BatchDrawer batchId={selectedBatch.id} onClose={() => setSelectedBatch(null)} />
      )}
    </div>
  )
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function StatTile({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '14px 18px', minWidth: 0 }}>
      <div
        style={{
          fontFamily: "'Archivo', sans-serif",
          fontWeight: 700,
          fontSize: 26,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          color: color ?? 'var(--ink)',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          marginTop: 5,
        }}
      >
        {label}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--ink-2)',
        fontWeight: 600,
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  )
}

function LoadingCard() {
  return (
    <div
      className="card"
      style={{
        padding: 32,
        textAlign: 'center',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 12,
        color: 'var(--ink-3)',
        marginBottom: 26,
      }}
    >
      Loading…
    </div>
  )
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div
      className="card"
      style={{
        padding: 32,
        textAlign: 'center',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 12,
        color: 'var(--ink-3)',
        marginBottom: 26,
      }}
    >
      {text}
    </div>
  )
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="card"
      style={{
        padding: 24,
        textAlign: 'center',
        marginBottom: 26,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--error)', fontSize: 13 }}>
        <AlertTriangle size={15} /> Failed to load — check connection.
      </div>
      <button className="btn-secondary" onClick={onRetry}>
        <RefreshCw size={14} /> Retry
      </button>
    </div>
  )
}

function StatusBadge({ batch }: { batch: any }) {
  if (batch.deviation_flagged) {
    return (
      <span className="badge-red">
        <AlertTriangle size={11} /> DEVIATION
      </span>
    )
  }
  if (batch.ended_at) {
    return (
      <span className="badge-green">
        <CheckCircle size={11} /> COMPLETE
      </span>
    )
  }
  if (batch.actuals_recorded) {
    return <span className="badge-yellow">AWAITING ACK</span>
  }
  return <span className="badge-blue">RUNNING</span>
}

// ── Capacity fill bar ─────────────────────────────────────────────────────────
function CapacityBar({ used, total }: { used: number; total: number }) {
  const safeTotal = Math.max(total, 1)
  const segs = 12
  const filled = Math.min(Math.round((used / safeTotal) * segs), segs)
  const pct = Math.round((used / safeTotal) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {Array.from({ length: segs }).map((_, i) => (
          <span
            key={i}
            style={{
              width: 7,
              height: 12,
              borderRadius: 2,
              background: i < filled ? 'var(--accent)' : 'var(--surface-3)',
            }}
          />
        ))}
      </div>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-2)' }}>
        {used}/{total} bars · {pct}%
      </span>
    </div>
  )
}

// ── Active furnace batch card ───────────────────────────────────────────────────
function FurnaceBatchCard({ batch, onOpen }: { batch: any; onOpen: () => void }) {
  // Bar size drives capacity (1500 base, 2750 derived). Infer from the batch's
  // representative size or its member UIDs.
  const barSize: number | null =
    batch.size_mm ?? (batch.uids ?? []).find((u: any) => u.size_mm != null)?.size_mm ?? null
  const capacity = furnaceCapacityForSize(batch.workstation_code, barSize) || batch.uid_count || 1
  const uidCodes: string[] = (batch.uids ?? []).map((u: any) => u.uid_code)
  return (
    <div
      className="card row-hover"
      style={{ padding: 16, borderLeft: '3px solid var(--warning)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12 }}
      onClick={onOpen}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Flame size={14} style={{ color: 'var(--warning)' }} />
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
          {batch.batch_number}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <StatusBadge batch={batch} />
        </span>
      </div>

      <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
        {batch.cycle_type_name} · Step {batch.step_number}
        {batch.operation_name ? ` — ${batch.operation_name}` : ''}
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <Metric label="Target" value={batch.target_temp_c ? `${batch.target_temp_c}°C / ${batch.target_soak_minutes}min` : '—'} />
        <Metric label="UIDs" value={String(batch.uid_count ?? uidCodes.length)} />
        <Metric label="Bar size" value={barSize ? `${barSize}mm` : '—'} />
      </div>

      <CapacityBar used={batch.uid_count ?? uidCodes.length} total={capacity} />

      {uidCodes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {uidCodes.slice(0, 10).map((c) => (
            <span
              key={c}
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10.5,
                fontWeight: 600,
                padding: '2px 7px',
                borderRadius: 6,
                background: 'var(--surface-3)',
                color: 'var(--ink)',
              }}
            >
              {c}
            </span>
          ))}
          {uidCodes.length > 10 && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)', alignSelf: 'center' }}>
              +{uidCodes.length - 10} more
            </span>
          )}
        </div>
      )}

      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        <Clock size={11} />
        {batch.started_at ? `Started ${formatDistanceToNowStrict(new Date(batch.started_at))} ago` : 'Not started'}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.1em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', color: 'var(--ink)', marginTop: 2 }}>
        {value}
      </div>
    </div>
  )
}

// ── Furnace batch log table ─────────────────────────────────────────────────────
function FurnaceBatchLog({
  data,
  loading,
  error,
  onRetry,
  onSelect,
}: {
  data: any[]
  loading: boolean
  error: boolean
  onRetry: () => void
  onSelect: (b: any) => void
}) {
  if (loading) return <LoadingCard />
  if (error) return <ErrorCard onRetry={onRetry} />
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="es-table">
        <thead>
          <tr>
            <th>Batch No</th>
            <th>Step</th>
            <th>Cycle</th>
            <th>UIDs</th>
            <th>Target</th>
            <th>Actual</th>
            <th>Status</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {data.map((b: any) => (
            <tr key={b.id} onClick={() => onSelect(b)} style={{ cursor: 'pointer' }} className="row-hover">
              <td>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--accent)', fontWeight: 700 }}>
                  {b.batch_number}
                </span>
              </td>
              <td>Step {b.step_number}</td>
              <td>{b.cycle_type_name}</td>
              <td>{b.uid_count}</td>
              <td style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                {b.target_temp_c ? `${b.target_temp_c}°C / ${b.target_soak_minutes}min` : '—'}
              </td>
              <td style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                {b.actuals_recorded ? (
                  <span style={{ color: b.deviation_flagged ? 'var(--error)' : 'var(--success)' }}>
                    {b.actual_temp_c}°C / {b.actual_soak_minutes}min
                  </span>
                ) : b.ended_at ? (
                  <span style={{ color: 'var(--ink-3)' }}>Not recorded</span>
                ) : (
                  '—'
                )}
              </td>
              <td>
                <StatusBadge batch={b} />
              </td>
              <td style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: 'var(--ink-2)' }}>
                {b.started_at ? new Date(b.started_at).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td
                colSpan={8}
                style={{
                  textAlign: 'center',
                  color: 'var(--ink-3)',
                  padding: 24,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                }}
              >
                No furnace batches yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Build-a-batch flow ──────────────────────────────────────────────────────────
function BuildBatchForm({
  steps,
  params,
  onDone,
}: {
  steps: FurnaceStepRef[]
  params: any[]
  onDone: () => void
}) {
  const [stepKey, setStepKey] = useState('') // `${cycle_step_id}` (stable per step)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [uidSearch, setUidSearch] = useState('')

  const step = steps.find((s) => String(s.cycle_step_id) === stepKey)
  const matchingParam = step
    ? params.find(
        (p: any) => p.cycle_type_id === step.cycle_type_id && p.cycle_step_id === step.cycle_step_id
      )
    : undefined

  const { data: available, isLoading: loadingUIDs, isError: availErr } = useQuery({
    queryKey: ['batch-available', stepKey],
    queryFn: () => temperingApi.availableUIDs(Number(stepKey)).then((r) => r.data),
    enabled: !!stepKey,
  })

  const availableUIDs: any[] = available ?? []
  const availableCount = availableUIDs.length

  // ── Search-driven, capped picker (12k-scale safe) ───────────────────────────
  // Never render the whole eligible list as one block. Filter client-side on the
  // server-scoped available set, then cap the rendered rows to a fixed window.
  const UID_RENDER_CAP = 50
  const uidTerm = uidSearch.trim().toLowerCase()
  const filteredUIDs = uidTerm
    ? availableUIDs.filter((u: any) => {
        const code = String(u.uid_code ?? u.code ?? '').toLowerCase()
        const sz = u.size_mm != null ? String(u.size_mm) : ''
        return code.includes(uidTerm) || sz.includes(uidTerm)
      })
    : availableUIDs
  const filteredCount = filteredUIDs.length
  const renderedUIDs = filteredUIDs.slice(0, UID_RENDER_CAP)

  // ── Capacity depends on bar size (1500 base, 2750 derived) ──────────────────
  // Determine the dominant bar size among the queued UIDs to size the furnace.
  const sizes = availableUIDs.map((u: any) => u.size_mm).filter((v: any) => v != null) as number[]
  const dominantSize = sizes.length
    ? sizes.sort(
        (a, b) =>
          sizes.filter((v) => v === b).length - sizes.filter((v) => v === a).length
      )[0]
    : null
  const mixedSizes = new Set(sizes).size > 1
  const capacity = step ? furnaceCapacityForSize(step.workstation_code, dominantSize) : 0
  // Default to capacity-limited FIFO selection when nothing chosen yet.
  const effectiveCount = selected.size > 0 ? selected.size : Math.min(availableCount, capacity || availableCount)
  const overCapacity = capacity > 0 && selected.size > capacity

  const atCapacity = capacity > 0 && selected.size >= capacity
  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      // Respect the furnace capacity cap: block adding beyond capacity.
      else if (!(capacity > 0 && next.size >= capacity)) next.add(id)
      return next
    })
  }

  const mut = useMutation({
    mutationFn: () =>
      temperingApi.createBatch({
        cycle_type_id: step!.cycle_type_id,
        cycle_step_id: step!.cycle_step_id,
        // The API does FIFO intake by count. If the supervisor hand-picked a
        // subset we pass that count; otherwise we cap at furnace capacity.
        intake_count: selected.size > 0 ? selected.size : capacity > 0 ? Math.min(availableCount, capacity) : null,
      }),
    onSuccess: onDone,
  })

  const L = ({ children }: { children: React.ReactNode }) => (
    <label
      style={{
        display: 'block',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
        letterSpacing: '0.08em',
        color: 'var(--ink-3)',
        marginBottom: 4,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </label>
  )

  return (
    <div>
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          color: 'var(--ink-2)',
          marginBottom: 16,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        Build Furnace Batch
      </div>

      <div style={{ marginBottom: 14, maxWidth: 480 }}>
        <L>Furnace Step</L>
        <select
          className="input"
          value={stepKey}
          onChange={(e) => {
            setStepKey(e.target.value)
            setSelected(new Set())
            setUidSearch('')
          }}
        >
          <option value="">Select tempering / furnace step…</option>
          {steps.map((s) => (
            <option key={s.cycle_step_id} value={s.cycle_step_id}>
              {s.workstation_code} · {s.cycle_type_name} · Step {s.step_number} — {s.operation_name}
            </option>
          ))}
        </select>
      </div>

      {step && (
        <>
          {/* Target params (read-only, Admin-configured) */}
          {matchingParam ? (
            <div
              style={{
                background: 'var(--surface-2)',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 14,
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: 'var(--ink-2)',
              }}
            >
              Target:{' '}
              <span style={{ color: 'var(--accent)' }}>{matchingParam.target_temp_c}°C</span> for{' '}
              <span style={{ color: 'var(--accent)' }}>{matchingParam.target_soak_minutes} min</span>
              <span style={{ color: 'var(--ink-3)', marginLeft: 12 }}>
                ±{matchingParam.tolerance_temp_c}°C / ±{matchingParam.tolerance_soak_minutes}min
              </span>
            </div>
          ) : (
            <div
              style={{
                background: 'rgba(217,122,43,.1)',
                border: '1px solid rgba(217,122,43,.25)',
                borderRadius: 8,
                padding: '8px 14px',
                marginBottom: 14,
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: 'var(--warning)',
              }}
            >
              No Admin target configured for this step — deviation check may not run.
            </div>
          )}

          {/* Capacity readout — size-aware (1500mm base, 2750mm derived) */}
          <div style={{ marginBottom: 12 }}>
            <L>
              Furnace Capacity ({step.workstation_code})
              {dominantSize ? ` @ ${dominantSize}mm` : ' @ 1500mm base'}
              {capacity ? ` — ${capacity} bars` : ''}
            </L>
            <CapacityBar used={effectiveCount} total={capacity || Math.max(availableCount, 1)} />
            {dominantSize === 2750 && (
              <div style={{ color: 'var(--ink-3)', fontSize: 10.5, marginTop: 6, fontFamily: "'IBM Plex Mono', monospace" }}>
                2750mm bars — reduced capacity vs 1500mm base.
              </div>
            )}
            {mixedSizes && (
              <div style={{ color: 'var(--warning)', fontSize: 10.5, marginTop: 6, fontFamily: "'IBM Plex Mono', monospace" }}>
                Mixed bar sizes queued — capacity shown for dominant size ({dominantSize}mm).
              </div>
            )}
            {overCapacity && (
              <div style={{ color: 'var(--error)', fontSize: 11, marginTop: 6, fontFamily: "'IBM Plex Mono', monospace" }}>
                Over capacity — remove {selected.size - capacity} bar(s).
              </div>
            )}
          </div>

          {/* Available UID picker */}
          <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
            {loadingUIDs ? (
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>
                Checking availability…
              </div>
            ) : availErr ? (
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--error)' }}>
                Failed to load available UIDs.
              </div>
            ) : availableCount === 0 ? (
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--error)' }}>
                No UIDs queued at source for this step.
              </div>
            ) : (
              <>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    color: 'var(--ink-2)',
                    marginBottom: 10,
                  }}
                >
                  <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: 16 }}>{availableCount}</span>
                  <span style={{ marginLeft: 8 }}>
                    queued (FIFO). Click to hand-pick, or leave none selected to auto-fill to capacity.
                  </span>
                </div>

                {/* Search-driven picker — never an unbounded UID block at 12k scale */}
                <div style={{ position: 'relative', marginBottom: 8, maxWidth: 280 }}>
                  <Search size={13} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--ink-3)' }} />
                  <input
                    className="input"
                    style={{ paddingLeft: 30 }}
                    placeholder="Search UID…"
                    value={uidSearch}
                    onChange={(e) => setUidSearch(e.target.value)}
                  />
                </div>

                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-3)',
                    marginBottom: 8,
                  }}
                >
                  Showing {Math.min(renderedUIDs.length, filteredCount)} of {filteredCount}
                  {uidTerm ? ` matching (${availableCount} available)` : ' available'}
                  {selected.size > 0 ? ` · ${selected.size} selected` : ''}
                  {atCapacity ? ' · at capacity' : ''}
                </div>

                {filteredCount === 0 ? (
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>
                    No queued UIDs match “{uidSearch.trim()}”.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                    {renderedUIDs.map((u: any) => {
                      const id = u.uid_id ?? u.id
                      const code = u.uid_code ?? u.code
                      const on = selected.has(id)
                      const priority = (u.priority ?? 'normal') as string
                      const sz = u.size_mm as number | null | undefined
                      const blocked = !on && atCapacity
                      return (
                        <button
                          key={id}
                          onClick={() => toggle(id)}
                          disabled={blocked}
                          title={
                            blocked
                              ? 'Furnace at capacity — deselect a bar first'
                              : priority !== 'normal'
                                ? priority.toUpperCase()
                                : undefined
                          }
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '4px 9px',
                            borderRadius: 7,
                            cursor: blocked ? 'not-allowed' : 'pointer',
                            opacity: blocked ? 0.5 : 1,
                            background: on ? 'var(--accent-dim)' : 'var(--surface)',
                            border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                            color: on ? 'var(--accent)' : 'var(--ink)',
                          }}
                        >
                          {on && <CheckCircle size={11} />}
                          {code}
                          {sz != null && (
                            <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>{sz}mm</span>
                          )}
                          {priority !== 'normal' && (
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: priority === 'urgent' ? 'var(--error)' : 'var(--warning)' }} />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
                {filteredCount > renderedUIDs.length && (
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginTop: 8 }}>
                    +{filteredCount - renderedUIDs.length} more — refine the search to narrow the list.
                  </div>
                )}
              </>
            )}
          </div>

          <button
            className="btn-primary"
            onClick={() => mut.mutate()}
            disabled={mut.isPending || availableCount === 0 || overCapacity}
          >
            <Flame size={14} />
            {mut.isPending ? 'Loading furnace…' : `Load ${effectiveCount} Bar${effectiveCount === 1 ? '' : 's'} into Furnace`}
          </button>
          {mut.isError && (
            <div style={{ color: 'var(--error)', fontSize: 12, marginTop: 8, fontFamily: "'IBM Plex Mono', monospace" }}>
              Failed to create batch — no UIDs available at this step.
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Production batches (queue view — non-grinding workstations) ─────────────────
function ProductionBatches({
  steps,
  loading,
  error,
  onRetry,
}: {
  steps: ProductionStepRef[]
  loading: boolean
  error: boolean
  onRetry: () => void
}) {
  // Exact active-UID counts per step (server-side aggregate — accurate at 12k scale,
  // not derived from a capped page).
  const { data: stepCounts = [], isLoading: uidsLoading } = useQuery({
    queryKey: ['batch-step-counts'],
    queryFn: () => uidApi.stepCounts({ status: 'active' }).then((r) => r.data ?? []),
    refetchInterval: 30_000,
  })

  const queueByStep = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of stepCounts as any[]) m.set(r.cycle_step_id, r.count)
    return m
  }, [stepCounts])

  // Collapse duplicates by step; sort by queue depth.
  const rows = useMemo(() => {
    const seen = new Set<number>()
    const out: (ProductionStepRef & { queued: number })[] = []
    for (const s of steps) {
      if (seen.has(s.cycle_step_id)) continue
      seen.add(s.cycle_step_id)
      const queued = queueByStep.get(s.cycle_step_id) ?? 0
      out.push({ ...s, queued })
    }
    return out.filter((r) => r.queued > 0).sort((a, b) => b.queued - a.queued)
  }, [steps, queueByStep])

  if (loading) return <LoadingCard />
  if (error) return <ErrorCard onRetry={onRetry} />

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          padding: '10px 14px',
          borderRadius: 10,
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
          color: 'var(--ink-2)',
          fontSize: 12.5,
          marginBottom: 18,
          fontFamily: "'IBM Plex Sans', sans-serif",
        }}
      >
        <AlertTriangle size={15} style={{ color: 'var(--warning)', marginTop: 1, flexShrink: 0 }} />
        <div>
          Manual production-batch creation (select workstation → pick queued UIDs up to capacity) has no
          dedicated backend endpoint yet. This is a read-only queue view; furnace batches are built on the
          Furnace tab.
        </div>
      </div>

      <SectionLabel>Production Queues</SectionLabel>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="es-table">
          <thead>
            <tr>
              <th>Workstation</th>
              <th>Cycle</th>
              <th>Step</th>
              <th>Operation</th>
              <th>Queued UIDs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cycle_step_id}>
                <td style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{r.workstation_code}</td>
                <td>{r.cycle_type_name}</td>
                <td>Step {r.step_number}</td>
                <td>{r.operation_name}</td>
                <td>
                  <span
                    style={{
                      fontFamily: "'Archivo', sans-serif",
                      fontWeight: 700,
                      fontSize: 14,
                      color: r.queued > 0 ? 'var(--accent)' : 'var(--ink-3)',
                    }}
                  >
                    {uidsLoading ? '…' : r.queued}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    textAlign: 'center',
                    color: 'var(--ink-3)',
                    padding: 24,
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                  }}
                >
                  No production queues found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Grinding batches (rule-driven panels — Bunch / Surface / Bevel) ─────────────
// Spec lines 560–646, 2279–2539. Grinding batches are decided dynamically just
// before the run based on bar lengths. No dedicated backend endpoint exists yet,
// so this renders the rule-driven structure populated from the live queue (active
// UIDs at each grinding step) with clear "endpoint not yet available" states for
// the assign / confirm / mark-run-complete actions.
function GrindingBatches({
  steps,
  loading,
  error,
  onRetry,
}: {
  steps: ProductionStepRef[]
  loading: boolean
  error: boolean
  onRetry: () => void
}) {
  // Rows for set-building come from a capped page (max 500); exact per-step
  // totals come from the server aggregate so captions are accurate at 12k scale.
  const { data: uids = [], isLoading: uidsLoading } = useQuery({
    queryKey: ['batch-grinding-uids'],
    queryFn: () => uidApi.list({ status: 'active', limit: 500 }).then((r) => r.data.items ?? []),
    refetchInterval: 30_000,
  })
  const { data: stepCounts = [] } = useQuery({
    queryKey: ['batch-step-counts'],
    queryFn: () => uidApi.stepCounts({ status: 'active' }).then((r) => r.data ?? []),
    refetchInterval: 30_000,
  })
  const totalByStep = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of stepCounts as any[]) m.set(r.cycle_step_id, r.count)
    return m
  }, [stepCounts])

  // Queued UIDs (with bar length) per grinding step.
  const queuedByStep = useMemo(() => {
    const m = new Map<number, any[]>()
    for (const u of uids as any[]) {
      if (u.current_step_id == null) continue
      const arr = m.get(u.current_step_id) ?? []
      arr.push(u)
      m.set(u.current_step_id, arr)
    }
    return m
  }, [uids])

  // Collapse duplicate steps, classify each into a grinding kind.
  const grindSteps = useMemo(() => {
    const seen = new Set<number>()
    const out: (ProductionStepRef & { kind: GrindKind; queued: any[]; total: number })[] = []
    for (const s of steps) {
      if (seen.has(s.cycle_step_id)) continue
      seen.add(s.cycle_step_id)
      const queued = queuedByStep.get(s.cycle_step_id) ?? []
      out.push({ ...s, kind: grindKindFor(s), queued, total: totalByStep.get(s.cycle_step_id) ?? queued.length })
    }
    return out
  }, [steps, queuedByStep, totalByStep])

  if (loading) return <LoadingCard />
  if (error) return <ErrorCard onRetry={onRetry} />

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          padding: '10px 14px',
          borderRadius: 10,
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
          color: 'var(--ink-2)',
          fontSize: 12.5,
          marginBottom: 18,
          fontFamily: "'IBM Plex Sans', sans-serif",
        }}
      >
        <Ruler size={15} style={{ color: 'var(--accent)', marginTop: 1, flexShrink: 0 }} />
        <div>
          Grinding batches are decided dynamically just before the run from bar lengths — not a fixed count.
          The panels below enforce the spec rules (set sizing, machine-length pairing). Assign / Confirm /
          Mark&nbsp;Run&nbsp;Complete have no backend endpoint yet; those actions are disabled with a clear
          state until the grinding-batch API is available.
        </div>
      </div>

      {/* Pairing reference (Surface / Bevel length rules) */}
      <PairingReference />

      {grindSteps.length === 0 ? (
        <EmptyCard text="No grinding steps (Bunch / Surface / Bevel) found in current cycle definitions." />
      ) : (
        grindSteps.map((s) => {
          if (s.kind === 'bunch')
            return <BunchGrindingPanel key={s.cycle_step_id} step={s} queued={s.queued} />
          if (s.kind === 'surface')
            return <SurfaceGrindingPanel key={s.cycle_step_id} step={s} queued={s.queued} loading={uidsLoading} />
          if (s.kind === 'bevel')
            return <BevelGrindingPanel key={s.cycle_step_id} step={s} queued={s.queued} loading={uidsLoading} />
          return (
            <div key={s.cycle_step_id} style={{ marginBottom: 16 }}>
              <GrindHeader code={s.workstation_code} title={`${s.operation_name} — Step ${s.step_number}`} cycle={s.cycle_type_name} />
              <EmptyCard text={`${s.queued.length} bar(s) queued. Generic grinding step — no specialised panel.`} />
            </div>
          )
        })
      )}
    </>
  )
}

const barLen = (u: any): number | null => (u?.size_mm ?? null)
const priorityRank = (p?: string) => (p === 'urgent' ? 0 : p === 'high' ? 1 : 2)
const sortQueue = (a: any, b: any) =>
  priorityRank(a.priority) - priorityRank(b.priority) ||
  (a.waiting_since && b.waiting_since ? +new Date(a.waiting_since) - +new Date(b.waiting_since) : 0)

function GrindHeader({ code, title, cycle }: { code: string; title: string; cycle: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <Wrench size={15} style={{ color: 'var(--accent)' }} />
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>
        {code}
      </span>
      <span style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{title}</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)' }}>{cycle}</span>
    </div>
  )
}

// Reusable horizontal bed/length fill bar (mm-based).
function BedBar({ used, total }: { used: number; total: number }) {
  const pct = Math.min(Math.round((used / Math.max(total, 1)) * 100), 100)
  const over = used > total
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 12, borderRadius: 6, background: 'var(--surface-3)', overflow: 'hidden', minWidth: 120 }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: over ? 'var(--error)' : pct >= 100 ? 'var(--success)' : 'var(--accent)',
          }}
        />
      </div>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: over ? 'var(--error)' : 'var(--ink-2)', whiteSpace: 'nowrap' }}>
        {used} / {total}mm · {pct}%
      </span>
    </div>
  )
}

function PriorityDot({ priority }: { priority?: string }) {
  const p = priority ?? 'normal'
  if (p === 'normal') return <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ink-3)' }} />
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: p === 'urgent' ? 'var(--error)' : 'var(--warning)' }} />
}

function QueuedBarRow({ u }: { u: any }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 9px', borderRadius: 7, background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <PriorityDot priority={u.priority} />
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, fontWeight: 700, color: 'var(--accent)' }}>
        {u.uid_code ?? u.code}
      </span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)' }}>
        {barLen(u) != null ? `${barLen(u)}mm` : '—'}
      </span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginLeft: 'auto' }}>
        {u.cycle_type_name ?? ''}
      </span>
    </div>
  )
}

// Render cap for grinding queue columns — never map over the whole active-UID
// set (12k scale). Show the top-N by priority/wait with a "showing N of total".
const QUEUE_RENDER_CAP = 50
function QueuedColumn({ queued, loading, total }: { queued: any[]; loading?: boolean; total?: number }) {
  const sorted = [...queued].sort(sortQueue)
  const rendered = sorted.slice(0, QUEUE_RENDER_CAP)
  // Exact server-side total when provided; else the (capped) loaded length.
  const queuedTotal = total ?? sorted.length
  return (
    <div style={{ minWidth: 230 }}>
      <SectionLabel>Queued Bars ({queuedTotal.toLocaleString()})</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 320, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>Loading queue…</div>
        ) : sorted.length === 0 ? (
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>No bars queued at this step.</div>
        ) : (
          rendered.map((u) => <QueuedBarRow key={u.uid_id ?? u.id} u={u} />)
        )}
      </div>
      {!loading && queuedTotal > rendered.length && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginTop: 6 }}>
          Showing top {rendered.length} of {queuedTotal.toLocaleString()} by priority.
        </div>
      )}
    </div>
  )
}

// Disabled action footer (endpoint-not-available state).
function GrindActions({ note }: { note: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
      <button className="btn-secondary" disabled title="Grinding-batch API not yet available" style={{ opacity: 0.55, cursor: 'not-allowed' }}>
        <Sparkles size={14} /> Auto-suggest
      </button>
      <button className="btn-primary" disabled title="Grinding-batch API not yet available" style={{ opacity: 0.55, cursor: 'not-allowed' }}>
        <CheckCircle size={14} /> Confirm run
      </button>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)' }}>{note}</span>
    </div>
  )
}

// Length-pairing reference card (spec valid pairings).
function PairingReference() {
  return (
    <div className="card" style={{ padding: 14, marginBottom: 18 }}>
      <SectionLabel>Length Pairing Rules · Machine bed {MACHINE_BED_MM}mm</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {PAIRING_RULES.map((r) => (
          <span
            key={r.combo}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              padding: '4px 9px',
              borderRadius: 7,
              background: r.ok ? 'rgba(34,160,107,.1)' : 'rgba(229,72,77,.1)',
              color: r.ok ? 'var(--success)' : 'var(--error)',
              border: `1px solid ${r.ok ? 'rgba(34,160,107,.25)' : 'rgba(229,72,77,.25)'}`,
            }}
          >
            {r.ok ? '✓' : '✗'} {r.combo} {r.ok && r.total <= MACHINE_BED_MM ? `= ${r.total}mm` : ''}
          </span>
        ))}
      </div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginTop: 8 }}>
        2750mm bars run alone on Delta/Gamma (3000mm) — blocked on Alpha/Beta (1500mm max).
      </div>
    </div>
  )
}

// ── Bunch Grinding (Step 4 — SG-DLT): length-based dynamic set sizing ───────────
function BunchGrindingPanel({ step, queued }: { step: ProductionStepRef; queued: any[] }) {
  const barsPerSet = BUNCH_BARS_PER_SET_DEFAULT // Admin-configurable via Master Lists
  // Determine sets-per-run from dominant bar length: 1500/1424 → 2 sets, 2750 → 1.
  const sorted = [...queued].sort(sortQueue)
  const sizes = sorted.map(barLen).filter((v): v is number => v != null)
  const dominant = sizes.length
    ? sizes.sort((a, b) => sizes.filter((v) => v === b).length - sizes.filter((v) => v === a).length)[0]
    : 1500
  const setsPerRun = dominant >= 2750 ? 1 : 2

  // Build sets greedily from same-length bars (each set = same length).
  const pool = sorted.filter((u) => barLen(u) === dominant)
  const sets: any[][] = []
  for (let i = 0; i < setsPerRun; i++) {
    sets.push(pool.slice(i * barsPerSet, i * barsPerSet + barsPerSet))
  }
  const bedUsed = setsPerRun * dominant
  const offLength = sorted.filter((u) => barLen(u) != null && barLen(u) !== dominant).length

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <GrindHeader code={step.workstation_code} title={`Bunch Grinding — Step ${step.step_number}`} cycle={step.cycle_type_name} />
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
        <Metric label="Bars per set" value={`${barsPerSet}`} />
        <Metric label="Sets per run" value={`${setsPerRun}`} />
        <Metric label="Machine bed" value={`${MACHINE_BED_MM}mm`} />
        <Metric label="Bar length" value={`${dominant}mm`} />
        <Metric label="Max bars/run" value={`${setsPerRun * barsPerSet}`} />
      </div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginBottom: 12 }}>
        Bars per set is Admin-configurable in Master Lists. Each set must be one length; two sets must fit within {MACHINE_BED_MM}mm.
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <QueuedColumn queued={queued} total={(step as any).total} />
        <div style={{ flex: 1, minWidth: 280 }}>
          <SectionLabel>Set Builder</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sets.map((bars, i) => {
              const complete = bars.length === barsPerSet
              return (
                <div key={i}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-2)', marginBottom: 4 }}>
                    Set {i + 1} — Position {i + 1} ({i * dominant}–{(i + 1) * dominant}mm)
                  </div>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {Array.from({ length: barsPerSet }).map((_, slot) => {
                      const u = bars[slot]
                      return u ? (
                        <QueuedBarRow key={u.uid_id ?? u.id} u={u} />
                      ) : (
                        <div key={`empty-${slot}`} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)', padding: '5px 9px' }}>
                          — empty slot —
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, marginTop: 4, color: complete ? 'var(--success)' : 'var(--warning)' }}>
                    {bars.length} / {barsPerSet} bars {complete ? '✓ Set complete' : '⚠ Partial set — Supervisor decides wait or run'}
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 12 }}>
            <SectionLabel>Total Bed</SectionLabel>
            <BedBar used={bedUsed} total={MACHINE_BED_MM} />
          </div>
          {offLength > 0 && (
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--warning)', marginTop: 8 }}>
              {offLength} queued bar(s) of a different length excluded — a set cannot mix lengths.
            </div>
          )}
          <GrindActions note="Confirm run & Mark Run Complete (all bars at once) require the grinding-batch endpoint." />
        </div>
      </div>
    </div>
  )
}

// ── Surface Grinding (Steps 12, 20 — SG-DLT): machine-bed pairing ───────────────
function SurfaceGrindingPanel({ step, queued, loading }: { step: ProductionStepRef; queued: any[]; loading?: boolean }) {
  const sorted = [...queued].sort(sortQueue)
  // Suggested pairing: try to pair the two highest-priority bars whose combined
  // length fits the 3000mm bed; a 2750mm bar runs alone.
  const suggestion = suggestPair(sorted, SURFACE_MACHINE.maxMm)

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <GrindHeader code={step.workstation_code} title={`Surface Grinding — Step ${step.step_number}`} cycle={step.cycle_type_name} />
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <QueuedColumn queued={queued} total={(step as any).total} loading={loading} />
        <div style={{ flex: 1, minWidth: 280 }}>
          <SectionLabel>Machine — {SURFACE_MACHINE.code} ({SURFACE_MACHINE.unit}) · max {SURFACE_MACHINE.maxMm}mm</SectionLabel>
          <MachineBatchBox machine={SURFACE_MACHINE} bars={suggestion} />
          <GrindActions note="Assign / Confirm batch require the grinding-batch endpoint." />
        </div>
      </div>
    </div>
  )
}

// ── Bevel Grinding (Step 22 — AG-ALP / AG-BTA / AG-GMM): four-machine board ──────
function BevelGrindingPanel({ step, queued, loading }: { step: ProductionStepRef; queued: any[]; loading?: boolean }) {
  const sorted = [...queued].sort(sortQueue)
  // Greedily assign suggested bars across machines respecting length limits.
  const used = new Set<number>()
  const assignment = BEVEL_MACHINES.map((m) => {
    const bars: any[] = []
    let total = 0
    for (const u of sorted) {
      const id = u.uid_id ?? u.id
      const len = barLen(u)
      if (used.has(id) || len == null) continue
      if (len > m.maxMm) continue
      if (bars.length >= m.maxBars) break
      if (total + len > m.maxMm) continue
      bars.push(u)
      total += len
      used.add(id)
    }
    return { machine: m, bars }
  })
  const queuedRemaining = sorted.filter((u) => !used.has(u.uid_id ?? u.id)).length

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <GrindHeader code="AG-ALP / AG-BTA / AG-GMM" title={`Bevel Grinding — Step ${step.step_number}`} cycle={step.cycle_type_name} />
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <QueuedColumn queued={queued} total={(step as any).total} loading={loading} />
        <div style={{ flex: 1, minWidth: 300 }}>
          <SectionLabel>Machine Assignment Board</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {assignment.map(({ machine, bars }) => (
              <div key={machine.code}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)', marginBottom: 4 }}>
                  {machine.code} ({machine.unit}) · max {machine.maxMm}mm
                </div>
                <MachineBatchBox machine={machine} bars={bars} />
              </div>
            ))}
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)', marginTop: 8 }}>
            Queued: {queuedRemaining} bar(s) waiting. 2750mm bars route to AG-GMM only.
          </div>
          <GrindActions note="Confirm all & Mark done (whole batch) require the grinding-batch endpoint." />
        </div>
      </div>
    </div>
  )
}

// Suggest a fitting set of bars for one machine (length-limited, by priority).
function suggestPair(sorted: any[], maxMm: number): any[] {
  const bars: any[] = []
  let total = 0
  for (const u of sorted) {
    const len = barLen(u)
    if (len == null || len > maxMm) continue
    if (bars.length >= 2) break
    if (total + len > maxMm) continue
    bars.push(u)
    total += len
  }
  return bars
}

function MachineBatchBox({ machine, bars }: { machine: GrindMachine; bars: any[] }) {
  const total = bars.reduce((acc, u) => acc + (barLen(u) ?? 0), 0)
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: 'var(--surface-2)' }}>
      <BedBar used={total} total={machine.maxMm} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
        {bars.length === 0 ? (
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>— no suggested bars —</div>
        ) : (
          bars.map((u) => (
            <div key={u.uid_id ?? u.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <PriorityDot priority={u.priority} />
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, fontWeight: 700, color: 'var(--accent)' }}>
                {u.uid_code ?? u.code}
              </span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)' }}>
                ({barLen(u)}mm)
              </span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginLeft: 'auto' }}>
                suggested
              </span>
            </div>
          ))
        )}
      </div>
      {bars.length > 1 && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginTop: 6 }}>
          Combined {total}mm ≤ {machine.maxMm}mm ✓
        </div>
      )}
    </div>
  )
}

// ── Batch detail drawer (member UIDs + complete-batch action) ──────────────────
function BatchDrawer({ batchId, onClose }: { batchId: number; onClose: () => void }) {
  const [actualTemp, setActualTemp] = useState('')
  const [actualSoak, setActualSoak] = useState('')
  const [heatNumber, setHeatNumber] = useState('')
  const [notes, setNotes] = useState('')
  const qc = useQueryClient()
  const { user } = useAuth()
  const isSupervisor =
    user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor'

  const { data: batch, isLoading, isError, refetch } = useQuery({
    queryKey: ['furnace-batch', batchId],
    queryFn: () => temperingApi.getBatch(batchId).then((r) => r.data),
  })

  const complete = useMutation({
    mutationFn: () =>
      temperingApi.completeBatch(batchId, {
        actual_temp_c: actualTemp ? parseFloat(actualTemp) : null,
        actual_soak_minutes: actualSoak ? parseInt(actualSoak) : null,
        // heat_number / notes passed best-effort; backend ignores unknown keys.
        heat_number: heatNumber || null,
        deviation_notes: notes || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['furnace-batches'] })
      qc.invalidateQueries({ queryKey: ['furnace-batch', batchId] })
    },
  })

  const uidList: any[] = batch?.uids ?? []

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(21,54,106,0.4)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        className="animate-es"
        style={{
          width: 500,
          maxWidth: '100%',
          height: '100%',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--line)',
          overflowY: 'auto',
          padding: 24,
          boxShadow: 'var(--shadow-e5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontWeight: 700,
                fontSize: 14,
                color: 'var(--accent)',
                letterSpacing: '0.06em',
              }}
            >
              {isLoading ? '…' : batch?.batch_number}
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginTop: 4, letterSpacing: '0.1em' }}>
              FURNACE BATCH DETAIL
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)' }}>
            <X size={16} />
          </button>
        </div>

        {isLoading && (
          <div style={{ color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Loading…</div>
        )}
        {isError && <ErrorCard onRetry={() => refetch()} />}

        {batch && (
          <>
            <div style={{ marginBottom: 16 }}>
              <StatusBadge batch={batch} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              {(
                [
                  ['Cycle', batch.cycle_type_name],
                  ['Step', `Step ${batch.step_number}${batch.operation_name ? ` — ${batch.operation_name}` : ''}`],
                  ['Furnace', batch.workstation_code ?? '—'],
                  ['UIDs', String(batch.uid_count ?? uidList.length)],
                  ['Target Temp', batch.target_temp_c ? `${batch.target_temp_c}°C` : '—'],
                  ['Target Soak', batch.target_soak_minutes ? `${batch.target_soak_minutes} min` : '—'],
                  ['Actual Temp', batch.actual_temp_c ? `${batch.actual_temp_c}°C` : '—'],
                  ['Actual Soak', batch.actual_soak_minutes != null ? `${batch.actual_soak_minutes} min` : '—'],
                  ['Started', batch.started_at ? new Date(batch.started_at).toLocaleString() : '—'],
                  ['Ended', batch.ended_at ? new Date(batch.ended_at).toLocaleString() : 'In progress'],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--ink-3)', letterSpacing: '0.1em', marginBottom: 2, textTransform: 'uppercase' }}>
                    {k}
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--ink)' }}>{v}</div>
                </div>
              ))}
            </div>

            {batch.deviation_flagged && (
              <div
                style={{
                  background: 'rgba(229,72,77,.1)',
                  border: '1px solid rgba(229,72,77,.3)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  marginBottom: 16,
                  color: 'var(--error)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                }}
              >
                <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>DEVIATION FLAGGED</div>
                  {batch.deviation_notes}
                </div>
              </div>
            )}

            {/* Complete-batch action (heat number + actual readings) */}
            {!batch.ended_at && isSupervisor && (
              <div style={{ marginBottom: 20, padding: 16, background: 'var(--surface-2)', borderRadius: 10 }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)', marginBottom: 12, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Complete Batch — Record Actuals
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginBottom: 4, textTransform: 'uppercase' }}>
                      Actual Temp (°C)
                    </label>
                    <input className="input" type="number" value={actualTemp} onChange={(e) => setActualTemp(e.target.value)} placeholder={batch.target_temp_c ?? ''} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginBottom: 4, textTransform: 'uppercase' }}>
                      Actual Soak (min)
                    </label>
                    <input className="input" type="number" value={actualSoak} onChange={(e) => setActualSoak(e.target.value)} placeholder={batch.target_soak_minutes ?? ''} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginBottom: 4, textTransform: 'uppercase' }}>
                      Heat Number
                    </label>
                    <input className="input" value={heatNumber} onChange={(e) => setHeatNumber(e.target.value)} placeholder="e.g. H-2024-441" />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginBottom: 4, textTransform: 'uppercase' }}>
                      Deviation Note (if any)
                    </label>
                    <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                  </div>
                </div>
                <button
                  className="btn-primary"
                  onClick={() => complete.mutate()}
                  disabled={complete.isPending}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  <CheckCircle size={14} />
                  {complete.isPending ? 'Completing…' : 'Mark Batch Done'}
                </button>
                {complete.isError && (
                  <div style={{ color: 'var(--error)', fontSize: 12, marginTop: 8, fontFamily: "'IBM Plex Mono', monospace" }}>
                    Failed to complete batch.
                  </div>
                )}
              </div>
            )}

            {/* Member UIDs */}
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)', marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              UIDs in this Batch ({uidList.length})
            </div>
            {uidList.length === 0 ? (
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>No member UIDs.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {uidList.map((u: any) => (
                  <div
                    key={u.uid_id ?? u.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--line)',
                    }}
                  >
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                      {u.uid_code ?? u.code}
                    </span>
                    {u.status && <span className="badge-gray">{String(u.status).toUpperCase()}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
