import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { uidApi, factoryApi, shopfloorApi, cycleApi } from '../api/client'
import type { UID, Workstation, ShopfloorStatus, CycleType } from '../types'
import UIDStatusBadge from '../components/UIDStatusBadge'
import PriorityBadge from '../components/PriorityBadge'
import { useAuth } from '../hooks/useAuth'
import {
  CheckCircle,
  RefreshCw,
  AlertTriangle,
  Search,
  PanelRightClose,
  PanelRightOpen,
  Flame,
  Clock,
} from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'

// ── Roles permitted to mark a step complete from the floor ──────────────────
const COMPLETE_ROLES = new Set(['admin', 'manager', 'supervisor', 'operator'])

// ── Workstation run-state colours (status dots / left border) ───────────────
type RunState = 'running' | 'idle' | 'hold'
const STATE_COLOR: Record<RunState, string> = {
  running: '#22a06b',
  idle: '#9bb4d4',
  hold: '#e5484d',
}
const STATE_LABEL: Record<RunState, string> = {
  running: 'Running',
  idle: 'Idle',
  hold: 'Hold',
}

const isFurnaceWs = (code: string) => /^HT(70|80|90)/i.test(code)
const isFurnaceStep = (name?: string | null) => {
  const n = (name ?? '').toLowerCase()
  return n.includes('temper') || n.includes('harden') || n.includes('quench')
}

// ── Capacity bar (workstation-card capacity display per spec) ───────────────
function CapacityBar({ used, total }: { used: number; total: number }) {
  const safeTotal = Math.max(total, 1)
  const segs = Math.min(safeTotal, 12)
  const filled = Math.round((used / safeTotal) * segs)
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
        {used}/{total} slot{total === 1 ? '' : 's'} used
      </span>
    </div>
  )
}

// ── Status summary stat tile ────────────────────────────────────────────────
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

interface WsCard {
  ws: Workstation
  uids: UID[]
  state: RunState
  queued: number // UIDs waiting in the source storage for this step
}

export default function ProductionFloor() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const role = user?.role ?? ''
  const canComplete = COMPLETE_ROLES.has(role)
  // Operators / supervisors are scoped to their own location.
  const scopedLocation =
    role === 'operator' || role === 'supervisor' ? user?.primary_location_id ?? undefined : undefined

  const [search, setSearch] = useState('')
  const [storageFilter, setStorageFilter] = useState<string | null>(null)
  const [sidePanelOpen, setSidePanelOpen] = useState(true)
  const [pendingUid, setPendingUid] = useState<number | null>(null)

  // ── Live data ──────────────────────────────────────────────────────────────
  const { data: uids = [] } = useQuery<UID[]>({
    queryKey: ['floor-uids', scopedLocation],
    queryFn: () =>
      uidApi
        .list({ status: 'active', location_id: scopedLocation })
        .then((r) => r.data.items ?? []),
    refetchInterval: 30_000,
  })

  // On-hold UIDs are excluded from the active list above, so fetch them too.
  const { data: heldUids = [] } = useQuery<UID[]>({
    queryKey: ['floor-uids-hold', scopedLocation],
    queryFn: () =>
      uidApi
        .list({ status: 'on_hold', location_id: scopedLocation })
        .then((r) => r.data.items ?? []),
    refetchInterval: 30_000,
  })

  const { data: workstations = [] } = useQuery<Workstation[]>({
    queryKey: ['floor-workstations', scopedLocation],
    queryFn: () => factoryApi.workstations(scopedLocation).then((r) => r.data),
  })

  const { data: shopfloor = [] } = useQuery<ShopfloorStatus[]>({
    queryKey: ['floor-shopfloor', scopedLocation],
    queryFn: () => shopfloorApi.status(scopedLocation).then((r) => r.data),
    refetchInterval: 30_000,
  })

  // Cycle definitions give us step_id → workstation_id (UIDs carry no ws id).
  const { data: cycles = [] } = useQuery<CycleType[]>({
    queryKey: ['floor-cycles'],
    queryFn: () => cycleApi.list().then((r) => r.data),
  })

  const completeStep = useMutation({
    mutationFn: ({ uid_id, workstation_id }: { uid_id: number; workstation_id: number }) =>
      uidApi.completeStep(uid_id, { workstation_id }).then((r) => r.data),
    onMutate: ({ uid_id }) => setPendingUid(uid_id),
    onSettled: () => setPendingUid(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['floor-uids'] })
      qc.invalidateQueries({ queryKey: ['floor-uids-hold'] })
      qc.invalidateQueries({ queryKey: ['floor-shopfloor'] })
    },
  })

  // step_id → workstation_id map across all current cycle versions.
  const stepToWs = useMemo(() => {
    const m = new Map<number, number>()
    for (const ct of cycles) {
      for (const step of ct.current_version?.steps ?? []) {
        m.set(step.id, step.workstation_id)
      }
    }
    return m
  }, [cycles])

  // Per-workstation queued counts and storage counts from shopfloor status.
  const wsUidCount = useMemo(() => {
    const m = new Map<number, number>()
    for (const loc of shopfloor) {
      for (const w of loc.workstations) m.set(w.workstation_id, w.uid_count)
    }
    return m
  }, [shopfloor])

  const storageCounts = useMemo(() => {
    const list: { code: string; name: string; count: number }[] = []
    const seen = new Map<string, number>()
    for (const loc of shopfloor) {
      for (const s of loc.storage_locations) {
        if (seen.has(s.code)) {
          list[seen.get(s.code)!].count += s.uid_count
        } else {
          seen.set(s.code, list.length)
          list.push({ code: s.code, name: s.name, count: s.uid_count })
        }
      }
    }
    return list
  }, [shopfloor])

  // ── Build workstation cards (UIDs grouped by their current step's ws) ───────
  const cards = useMemo<WsCard[]>(() => {
    const term = search.trim().toLowerCase()
    const allUids = [...uids, ...heldUids]

    const byWs = new Map<number, UID[]>()
    for (const u of allUids) {
      if (term && !u.code.toLowerCase().includes(term)) continue
      if (storageFilter && u.current_storage_code !== storageFilter) continue
      const wsId = u.current_step_id != null ? stepToWs.get(u.current_step_id) : undefined
      if (wsId == null) continue
      const arr = byWs.get(wsId)
      if (arr) arr.push(u)
      else byWs.set(wsId, [u])
    }

    return workstations
      .map((ws) => {
        const wsUids = byWs.get(ws.id) ?? []
        const anyHold = wsUids.some((u) => u.status === 'on_hold')
        const active = wsUids.filter((u) => u.status !== 'on_hold')
        const state: RunState = anyHold && active.length === 0 ? 'hold' : active.length > 0 ? 'running' : 'idle'
        // Queued = total UIDs the shopfloor counts at this ws, minus the ones
        // we can place on the card (best-effort source-storage backlog signal).
        const counted = wsUidCount.get(ws.id) ?? 0
        const queued = Math.max(counted - wsUids.length, 0)
        return { ws, uids: wsUids, state, queued }
      })
      // When a storage filter or search is active, hide empty cards entirely.
      .filter((c) => {
        if (storageFilter || search.trim()) return c.uids.length > 0
        return true
      })
      // Active cards first (running/hold), idle tiles last.
      .sort((a, b) => {
        const rank = (s: RunState) => (s === 'running' ? 0 : s === 'hold' ? 1 : 2)
        return rank(a.state) - rank(b.state) || a.ws.code.localeCompare(b.ws.code)
      })
  }, [workstations, uids, heldUids, stepToWs, wsUidCount, search, storageFilter])

  // ── Status-bar summary ───────────────────────────────────────────────────
  const summary = useMemo(() => {
    const totalActive = uids.length
    const onHold = heldUids.length
    const inBatch = uids.filter((u) => isFurnaceStep(u.current_step_name)).length
    const running = cards.filter((c) => c.state === 'running').length
    const idle = cards.filter((c) => c.state === 'idle').length
    const hold = cards.filter((c) => c.state === 'hold').length
    return { totalActive, onHold, inBatch, running, idle, hold, total: totalActive + onHold }
  }, [uids, heldUids, cards])

  return (
    <div style={{ padding: '24px 28px 60px' }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
            Production Floor
          </div>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink-2)', marginTop: 3 }}>
            {summary.total} UIDs on floor · Dharmapuri{scopedLocation ? ' (your location)' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--ink-3)' }} />
            <input
              className="input"
              style={{ width: 200, paddingLeft: 32 }}
              placeholder="Search UID code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="btn-secondary" onClick={() => setSidePanelOpen((o) => !o)}>
            {sidePanelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            Storage
          </button>
        </div>
      </div>

      {/* ── Status summary bar ───────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <StatTile value={summary.totalActive} label="Active UIDs" color="var(--success)" />
        <StatTile value={summary.onHold} label="On hold" color={summary.onHold > 0 ? 'var(--error)' : undefined} />
        <StatTile value={summary.inBatch} label="In furnace batch" color="var(--warning)" />
        <StatTile value={summary.running} label="Stations running" color="var(--success)" />
        <StatTile value={summary.idle} label="Stations idle" />
        <StatTile value={summary.hold} label="Stations on hold" color={summary.hold > 0 ? 'var(--error)' : undefined} />
      </div>

      {summary.onHold > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(229,72,77,.1)',
            border: '1px solid rgba(229,72,77,.25)',
            color: 'var(--error)',
            fontSize: 13,
            marginBottom: 18,
            fontFamily: "'IBM Plex Sans', sans-serif",
          }}
        >
          <AlertTriangle size={15} /> {summary.onHold} UID{summary.onHold === 1 ? '' : 's'} on hold — release required before they can advance
        </div>
      )}

      {/* ── Body: cards grid + storage side panel ────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: sidePanelOpen ? '1fr 220px' : '1fr', gap: 20, alignItems: 'start' }}>
        {/* Workstation cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {cards.map((card) => (
            <WorkstationCard
              key={card.ws.id}
              card={card}
              canComplete={canComplete}
              pendingUid={pendingUid}
              onComplete={(uid_id, workstation_id) => completeStep.mutate({ uid_id, workstation_id })}
            />
          ))}
          {cards.length === 0 && (
            <div
              className="card"
              style={{ padding: 32, textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--ink-3)' }}
            >
              {search.trim() || storageFilter ? 'No UIDs match the current filter.' : 'No workstations found.'}
            </div>
          )}
        </div>

        {/* Storage side panel */}
        {sidePanelOpen && (
          <div className="card" style={{ padding: 14, position: 'sticky', top: 20 }}>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 9.5,
                letterSpacing: '0.14em',
                color: 'var(--ink-3)',
                textTransform: 'uppercase',
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>Storage WIP</span>
              {storageFilter && (
                <button
                  onClick={() => setStorageFilter(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 9.5, fontFamily: 'inherit', letterSpacing: '0.1em' }}
                >
                  CLEAR
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {storageCounts.map((s) => {
                const selected = storageFilter === s.code
                return (
                  <button
                    key={s.code}
                    onClick={() => setStorageFilter(selected ? null : s.code)}
                    title={s.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: selected ? '1px solid var(--accent)' : '1px solid var(--line)',
                      background: selected ? 'var(--accent-dim)' : 'var(--surface-2)',
                      cursor: 'pointer',
                      width: '100%',
                    }}
                  >
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink)' }}>{s.code}</span>
                    <span
                      style={{
                        fontFamily: "'Archivo', sans-serif",
                        fontWeight: 700,
                        fontSize: 14,
                        color: s.count > 0 ? 'var(--accent)' : 'var(--ink-3)',
                      }}
                    >
                      {s.count}
                    </span>
                  </button>
                )
              })}
              {storageCounts.length === 0 && (
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>No storage data.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Single workstation card ─────────────────────────────────────────────────
function WorkstationCard({
  card,
  canComplete,
  pendingUid,
  onComplete,
}: {
  card: WsCard
  canComplete: boolean
  pendingUid: number | null
  onComplete: (uid_id: number, workstation_id: number) => void
}) {
  const { ws, uids, state, queued } = card
  const isIdle = uids.length === 0
  const furnace = isFurnaceWs(ws.code)

  // Idle tile — smaller, greyed, no queue info (per spec).
  if (isIdle) {
    return (
      <div
        className="card"
        style={{
          padding: '12px 14px',
          opacity: 0.6,
          borderLeft: `3px solid ${STATE_COLOR.idle}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATE_COLOR.idle, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>{ws.code}</span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ws.name}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 16, borderLeft: `3px solid ${STATE_COLOR[state]}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header: code + name + status dot */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATE_COLOR[state], flexShrink: 0 }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{ws.code}</span>
          {furnace && <Flame size={13} style={{ color: 'var(--warning)' }} />}
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: STATE_COLOR[state],
            }}
          >
            {STATE_LABEL[state]}
          </span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>{ws.name}</div>
      </div>

      {/* Capacity bar — slots = UIDs in progress (1 per UID; furnace = batch) */}
      <CapacityBar used={uids.length} total={Math.max(uids.length, 1)} />

      {/* UID list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {uids.map((u) => {
          const onHold = u.status === 'on_hold'
          const isPending = pendingUid === u.id
          return (
            <div
              key={u.id}
              style={{
                padding: '9px 11px',
                borderRadius: 9,
                background: onHold ? 'rgba(229,72,77,.07)' : 'var(--surface-2)',
                border: `1px solid ${onHold ? 'rgba(229,72,77,.25)' : 'var(--line)'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{u.code}</span>
                <span className="badge-blue">{u.cycle_type_name}</span>
                {u.priority !== 'normal' && <PriorityBadge priority={u.priority} />}
                <UIDStatusBadge status={u.status} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, fontSize: 12, color: 'var(--ink-2)' }}>
                <span>
                  Step {u.current_step_number} — {u.current_step_name}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)' }}>
                  <Clock size={11} />
                  {formatDistanceToNowStrict(new Date(u.created_at))} at step
                </span>
                {onHold ? (
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--error)' }}>HOLD — action blocked</span>
                ) : (
                  canComplete && (
                    <button
                      className="btn-primary"
                      style={{ height: 28, padding: '0 12px', fontSize: 12 }}
                      disabled={isPending}
                      onClick={() => onComplete(u.id, ws.id)}
                    >
                      <CheckCircle size={13} />
                      {isPending ? 'Saving…' : 'Mark Complete'}
                    </button>
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Queued count */}
      {queued > 0 && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-3)', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          Queued: {queued} UID{queued === 1 ? '' : 's'} waiting
        </div>
      )}
    </div>
  )
}
