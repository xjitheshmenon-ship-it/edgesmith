import { useQuery } from '@tanstack/react-query'
import { shopfloorApi, factoryApi } from '../api/client'
import type { ShopfloorStatus, FactoryLocation } from '../types'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import { useState, useEffect } from 'react'
import { format } from 'date-fns'

const CATEGORY_COLOR: Record<string, string> = {
  'Cutting':       'rgba(248,113,113,.15)',
  'Heat Treatment':'rgba(251,146,60,.15)',
  'Machining':     'rgba(96,165,250,.15)',
  'Grinding':      'rgba(167,139,250,.15)',
  'Coating':       'rgba(45,212,191,.15)',
  'QC':            'rgba(34,160,107,.15)',
  'Packing':       'rgba(148,163,184,.1)',
  'Other':         'rgba(148,163,184,.1)',
}

export default function Shopfloor() {
  const [selectedLoc, setSelectedLoc] = useState<number | undefined>()
  const [now, setNow] = useState(new Date())

  const { data: locations } = useQuery<FactoryLocation[]>({
    queryKey: ['locations'],
    queryFn: () => factoryApi.locations().then((r) => r.data),
  })

  const { data: status, refetch, isFetching, dataUpdatedAt } = useQuery<ShopfloorStatus[]>({
    queryKey: ['shopfloor-full', selectedLoc],
    queryFn: () => shopfloorApi.status(selectedLoc).then((r) => r.data),
    refetchInterval: 20_000,
  })

  useEffect(() => {
    if (dataUpdatedAt) setNow(new Date(dataUpdatedAt))
  }, [dataUpdatedAt])

  return (
    <div style={{ padding: '24px 28px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--ink)' }}>Shopfloor Live View</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)', marginTop: 3 }}>Last updated: {format(now, 'HH:mm:ss')}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {locations && (
            <select className="input" style={{ width: 180 }} value={selectedLoc ?? ''} onChange={(e) => setSelectedLoc(e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">All locations</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <button className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={15} style={isFetching ? { animation: 'spin 1s linear infinite' } : {}} />
            Refresh
          </button>
        </div>
      </div>

      {status && status.map((loc) => (
        <div key={loc.location_id} style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 17, color: 'var(--ink)' }}>{loc.location_name}</div>
            <span className="badge-blue">{loc.total_active_uids} active</span>
            {loc.on_hold > 0 && <span className="badge-yellow" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={11} />{loc.on_hold} on hold</span>}
          </div>

          {/* Storage grid */}
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 12 }}>Storage Locations</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 10 }}>
              {loc.storage_locations.map((s) => (
                <div key={s.storage_id} style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                  <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 18, color: s.uid_count > 0 ? 'var(--accent)' : 'var(--ink-3)' }}>{s.uid_count}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>{s.code}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Workstations grouped by category */}
          {(() => {
            const grouped: Record<string, typeof loc.workstations> = {}
            loc.workstations.forEach((w) => {
              if (!grouped[w.category]) grouped[w.category] = []
              grouped[w.category].push(w)
            })
            return Object.entries(grouped).map(([cat, wsList]) => (
              <div key={cat} className="card" style={{ padding: 16, marginBottom: 10 }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 12 }}>{cat}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 }}>
                  {wsList.map((w) => (
                    <div
                      key={w.workstation_id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 9,
                        border: '1px solid var(--line)',
                        background: w.uid_count > 0 ? CATEGORY_COLOR[cat] ?? 'var(--surface-2)' : 'var(--surface-2)',
                        opacity: w.uid_count > 0 ? 1 : 0.5,
                      }}
                    >
                      <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 22, color: w.uid_count > 0 ? 'var(--ink)' : 'var(--ink-3)' }}>{w.uid_count}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>{w.code}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          })()}
        </div>
      ))}
    </div>
  )
}
