import { useQuery } from '@tanstack/react-query'
import { shopfloorApi, factoryApi, temperingApi } from '../api/client'
import type { ShopfloorStatus, FactoryLocation, DashboardSummary } from '../types'
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'

const ARCHIVO = "'Archivo', sans-serif"
const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"

// Dharmapuri is the production wall display — resolved by location code 'F1'.
const DHARMAPURI_CODE = 'F1'

interface FurnaceBatch {
  id: number
  batch_number: string
  step_number: string | number | null
  cycle_type_name: string | null
  uid_count: number
  target_temp_c: number | null
  target_soak_minutes: number | null
  started_at: string | null
  ended_at: string | null
}

export default function Shopfloor() {
  const navigate = useNavigate()
  const [clock, setClock] = useState(() => new Date())

  // Live clock — ticks every second.
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const { data: locations } = useQuery<FactoryLocation[]>({
    queryKey: ['locations'],
    queryFn: () => factoryApi.locations().then((r) => r.data),
  })

  const dharmapuri = useMemo(
    () => locations?.find((l) => l.code === DHARMAPURI_CODE),
    [locations]
  )

  // Per-workstation counts for Dharmapuri only.
  const { data: statusList } = useQuery<ShopfloorStatus[]>({
    queryKey: ['shopfloor-display', dharmapuri?.id],
    queryFn: () => shopfloorApi.status(dharmapuri!.id).then((r) => r.data),
    enabled: dharmapuri?.id != null,
    refetchInterval: 30_000,
  })
  const loc = statusList?.find((s) => s.location_id === dharmapuri?.id) ?? statusList?.[0]

  // Headline stats.
  const { data: dashboard } = useQuery<DashboardSummary>({
    queryKey: ['shopfloor-display-dashboard'],
    queryFn: () => shopfloorApi.dashboard().then((r) => r.data),
    refetchInterval: 30_000,
  })

  // Running furnace batches: started, not yet ended.
  const { data: batches } = useQuery<FurnaceBatch[]>({
    queryKey: ['shopfloor-display-batches'],
    queryFn: () => temperingApi.batches().then((r) => r.data),
    refetchInterval: 30_000,
  })
  const runningBatches = useMemo(
    () => (batches ?? []).filter((b) => b.started_at && !b.ended_at),
    [batches]
  )

  const workstations = loc?.workstations ?? []
  const storage = loc?.storage_locations ?? []

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#0a1d3a',
        color: '#eaf4e4',
        zIndex: 80,
        display: 'flex',
        flexDirection: 'column',
        padding: '26px 32px',
        fontFamily: SANS,
        overflow: 'auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #1d3a63',
          paddingBottom: 18,
          marginBottom: 22,
        }}
      >
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 26, letterSpacing: '-0.02em' }}>
            EDGESMITH TOOLING — DHARMAPURI
          </div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: '#8aa0bf', marginTop: 5 }}>
            {format(clock, 'EEE d MMM yyyy')} · {format(clock, 'HH:mm:ss')} · auto-refresh 30s
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <StatBlock value={dashboard?.uid_active ?? '—'} label="ACTIVE" color="#d4eecb" />
          <StatBlock value={dashboard?.uid_on_hold ?? '—'} label="ON HOLD" color="#ff6b6b" />
          <StatBlock value={dashboard?.furnace_batches_running ?? runningBatches.length} label="IN FURNACE" color="#f0a020" />
          <button
            onClick={() => navigate('/')}
            style={{
              height: 40,
              padding: '0 18px',
              border: '1px solid #1d3a63',
              background: '#13294d',
              color: '#cfe0ee',
              borderRadius: 10,
              cursor: 'pointer',
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Exit
          </button>
        </div>
      </div>

      {/* Workstation tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        {workstations.map((w) => {
          // Running = allotted/being worked; Queued = at the station, not yet allotted.
          const running = (w as any).running_count ?? w.uid_count
          const queued = (w as any).queued_count ?? 0
          const active = w.uid_count > 0
          return (
            <div
              key={w.workstation_id}
              style={{
                background: '#0e2547',
                border: '1px solid #1d3a63',
                borderRadius: 14,
                padding: '18px 22px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 26, letterSpacing: '-0.02em' }}>
                  {w.code}
                </span>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: active ? '#d4eecb' : '#3a557e',
                    boxShadow: active ? '0 0 8px #d4eecb' : 'none',
                  }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 24 }}>
                <div>
                  <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 40, color: '#d4eecb', lineHeight: 1 }}>
                    {running}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: '#8aa0bf', marginTop: 3 }}>RUNNING</div>
                </div>
                <div>
                  <div style={{ fontFamily: ARCHIVO, fontWeight: 700, fontSize: 40, color: '#8aa0bf', lineHeight: 1 }}>
                    {queued}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: '#8aa0bf', marginTop: 3 }}>QUEUED</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Furnace strip */}
      {runningBatches.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          {runningBatches.map((f) => (
            <div
              key={f.id}
              style={{
                flex: '1 1 320px',
                background: '#1a1330',
                border: '1px solid #3a2a5a',
                borderRadius: 14,
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: 20,
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#f0a020" strokeWidth="1.8">
                <path d="M12 2c1 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3 1 2 2 2 2 2 0-3 1-5 2-8z" />
              </svg>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: '#f0c674' }}>
                  {f.batch_number} · {f.step_number != null ? `Step ${f.step_number}` : (f.cycle_type_name ?? '—')}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: '#8aa0bf', marginTop: 3 }}>
                  {f.uid_count} UIDs · target {f.target_temp_c != null ? `${f.target_temp_c}°C` : '—'} / {f.target_soak_minutes != null ? `${f.target_soak_minutes}min` : '—'} · started {f.started_at ? format(new Date(f.started_at), 'HH:mm') : '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Storage locations */}
      {storage.length > 0 && (
        <div style={{ marginTop: 'auto' }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', color: '#5d7fae', marginBottom: 10 }}>
            STORAGE LOCATIONS
          </div>
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            {storage.map((s) => {
              const has = s.uid_count > 0
              return (
                <div
                  key={s.storage_id}
                  style={{
                    flex: '1 1 0',
                    minWidth: 70,
                    textAlign: 'center',
                    padding: '10px 6px',
                    borderRadius: 10,
                    background: has ? '#13294d' : '#0e2547',
                    border: '1px solid #1d3a63',
                  }}
                >
                  <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 22, color: has ? '#d4eecb' : '#5d7fae', lineHeight: 1 }}>
                    {s.uid_count}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: '#8aa0bf', marginTop: 4 }}>{s.code}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function StatBlock({ value, label, color }: { value: number | string; label: string; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 30, color }}>{value}</div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: '#8aa0bf' }}>{label}</div>
    </div>
  )
}
