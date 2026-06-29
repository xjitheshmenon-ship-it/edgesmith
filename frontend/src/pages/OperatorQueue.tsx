import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { uidApi, factoryApi, temperingApi } from '../api/client'
import type { UID, Workstation } from '../types'
import UIDStatusBadge from '../components/UIDStatusBadge'
import PriorityBadge from '../components/PriorityBadge'
import { useAuth } from '../hooks/useAuth'
import { CheckCircle, AlertTriangle, Flame, Layers } from 'lucide-react'

const isBatchStep = (u: any) =>
  u?.current_step_name?.toLowerCase().includes('temper') ||
  u?.current_step_name?.toLowerCase().includes('harden') ||
  u?.current_step_name?.toLowerCase().includes('quench')

export default function OperatorQueue() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [selectedUID, setSelectedUID] = useState<UID | null>(null)
  const [qcResult, setQCResult] = useState('na')
  const [notes, setNotes] = useState('')
  const [selectedWS, setSelectedWS] = useState<number | undefined>()
  const [batchMode, setBatchMode] = useState(false)
  const [batchUIDs, setBatchUIDs] = useState<number[]>([])
  const [actualTemp, setActualTemp] = useState('')
  const [actualTime, setActualTime] = useState('')
  const [batchNotes, setBatchNotes] = useState('')

  const { data: uids = [] } = useQuery<UID[]>({
    queryKey: ['queue', user?.primary_location_id],
    queryFn: () => uidApi.operatorQueue(user?.primary_location_id ?? undefined).then((r) => r.data),
    refetchInterval: 10_000,
  })

  const { data: workstations = [] } = useQuery<Workstation[]>({
    queryKey: ['workstations', user?.primary_location_id],
    queryFn: () => factoryApi.workstations(user?.primary_location_id ?? undefined).then((r) => r.data),
  })

  const completeStep = useMutation({
    mutationFn: ({ uid_id, workstation_id }: { uid_id: number; workstation_id: number }) =>
      uidApi.completeStep(uid_id, { workstation_id, qc_result: qcResult, notes }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queue'] })
      setSelectedUID(null)
      setNotes('')
      setQCResult('na')
    },
  })

  const { data: batchAvailable = [] } = useQuery({
    queryKey: ['batch-available', (selectedUID as any)?.current_step_id],
    queryFn: () => temperingApi.availableUIDs((selectedUID as any).current_step_id).then(r => r.data),
    enabled: batchMode && !!(selectedUID as any)?.current_step_id,
  })

  const startBatch = useMutation({
    mutationFn: async () => {
      const uid = selectedUID as any
      const batch = await temperingApi.createBatch({
        cycle_type_id: uid.cycle_type_id,
        cycle_step_id: uid.current_step_id,
        uid_ids: batchUIDs,
      }).then(r => r.data)
      await temperingApi.completeBatch(batch.id, {
        actual_temp_c: actualTemp ? parseFloat(actualTemp) : null,
        actual_soak_minutes: actualTime ? parseInt(actualTime) : null,
        notes: batchNotes,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queue'] })
      setSelectedUID(null)
      setBatchMode(false)
      setBatchUIDs([])
      setActualTemp('')
      setActualTime('')
      setBatchNotes('')
    },
  })

  const urgent = uids.filter((u) => u.priority === 'urgent')
  const high = uids.filter((u) => u.priority === 'high')
  const normal = uids.filter((u) => u.priority === 'normal')
  const ordered = [...urgent, ...high, ...normal]

  return (
    <div style={{ padding: '24px 28px 60px' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--ink)' }}>My Job Queue</div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink-2)', marginTop: 3 }}>{uids.length} UIDs pending — select one to mark step complete</div>
      </div>

      {urgent.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.3)', color: 'var(--error)', fontSize: 13, marginBottom: 16 }}>
          <AlertTriangle size={15} /> {urgent.length} urgent UIDs require immediate attention
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Queue list */}
        <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Queue ({ordered.length})</div>
          </div>
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {ordered.map((u) => (
              <button
                key={u.id}
                onClick={() => setSelectedUID(u)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 16px',
                  background: selectedUID?.id === u.id ? 'var(--accent-dim)' : 'transparent',
                  borderLeft: selectedUID?.id === u.id ? '2px solid var(--accent)' : '2px solid transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--line)',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { if (selectedUID?.id !== u.id) (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)' }}
                onMouseLeave={e => { if (selectedUID?.id !== u.id) (e.currentTarget as HTMLElement).style.background = '' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, color: 'var(--ink)', fontSize: 13 }}>{u.code}</span>
                    <PriorityBadge priority={u.priority} />
                    <UIDStatusBadge status={u.status} />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace" }}>{u.factory_location_code}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4 }}>
                  Step {u.current_step_number} — {u.current_step_name}
                  {u.current_storage_code && <> · <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{u.current_storage_code}</span></>}
                </div>
                {u.current_step_name?.toLowerCase().includes('converting') && (
                  <div style={{ fontSize: 11, color: '#fdba74', marginTop: 2 }}>⚠ Converting step — supervisor action required</div>
                )}
              </button>
            ))}
            {ordered.length === 0 && (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Queue is empty</div>
            )}
          </div>
        </div>

        {/* Complete step panel */}
        {selectedUID && (
          <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 20, color: 'var(--ink)' }}>{selectedUID.code}</span>
                <PriorityBadge priority={selectedUID.priority} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                Step <strong style={{ color: 'var(--ink)' }}>{selectedUID.current_step_number}</strong> — {selectedUID.current_step_name}
              </div>
              {selectedUID.current_storage_code && (
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>Current storage: <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{selectedUID.current_storage_code}</span></div>
              )}
              {!selectedUID.design_confirmed && (
                <div style={{ marginTop: 10, fontSize: 13, color: '#fcd34d', background: 'rgba(251,191,36,.12)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 8, padding: '8px 12px' }}>
                  ⚠ Design not confirmed — manager must confirm before Step 16
                </div>
              )}
            </div>

            {/* Batch mode toggle for furnace steps */}
            {isBatchStep(selectedUID) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, background: batchMode ? 'rgba(212,238,203,.1)' : 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <Flame size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1 }}>Furnace step — supports batch processing</span>
                <button
                  onClick={() => { setBatchMode(b => !b); setBatchUIDs(b => b.length ? [] : [(selectedUID as any).id]) }}
                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: batchMode ? 'var(--accent)' : 'transparent', color: batchMode ? 'var(--accent-ink)' : 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  <Layers size={11} /> BATCH
                </button>
              </div>
            )}

            {batchMode ? (
              <>
                <div>
                  <label className="label">UIDs in this batch ({batchUIDs.length} selected)</label>
                  <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)' }}>
                    {(batchAvailable as any[]).map((u: any) => (
                      <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontSize: 12 }}>
                        <input type="checkbox" checked={batchUIDs.includes(u.id)} onChange={e => setBatchUIDs(ids => e.target.checked ? [...ids, u.id] : ids.filter(i => i !== u.id))} />
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: 'var(--ink)' }}>{u.code}</span>
                        <span style={{ color: 'var(--ink-3)' }}>Step {u.current_step_number}</span>
                      </label>
                    ))}
                    {(batchAvailable as any[]).length === 0 && <div style={{ padding: '12px', fontSize: 12, color: 'var(--ink-3)' }}>No other UIDs at this step</div>}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div><label className="label">Actual Temp (°C)</label><input className="input" type="number" value={actualTemp} onChange={e => setActualTemp(e.target.value)} placeholder="e.g. 180" /></div>
                  <div><label className="label">Actual Time (min)</label><input className="input" type="number" value={actualTime} onChange={e => setActualTime(e.target.value)} placeholder="e.g. 90" /></div>
                </div>
                <div><label className="label">Notes</label><textarea className="input" rows={2} value={batchNotes} onChange={e => setBatchNotes(e.target.value)} placeholder="Optional notes…" /></div>
                {startBatch.isError && <p style={{ fontSize: 13, color: 'var(--error)' }}>Failed to complete batch</p>}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-secondary" style={{ flex: 1 }} onClick={() => { setSelectedUID(null); setBatchMode(false); setBatchUIDs([]) }}>Cancel</button>
                  <button className="btn-primary" style={{ flex: 1 }} disabled={batchUIDs.length === 0 || startBatch.isPending} onClick={() => startBatch.mutate()}>
                    <Flame size={14} />
                    {startBatch.isPending ? 'Processing…' : `Complete Batch (${batchUIDs.length})`}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div><label className="label">Workstation</label><select className="input" value={selectedWS ?? ''} onChange={(e) => setSelectedWS(Number(e.target.value))}><option value="">Select workstation…</option>{workstations.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}</select></div>
                <div><label className="label">QC Result</label><select className="input" value={qcResult} onChange={(e) => setQCResult(e.target.value)}><option value="na">N/A</option><option value="pass">Pass</option><option value="fail">Fail</option></select></div>
                <div><label className="label">Notes</label><textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" /></div>
                {completeStep.error && <p style={{ fontSize: 13, color: 'var(--error)' }}>Failed to complete step</p>}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setSelectedUID(null)}>Cancel</button>
                  <button
                    className="btn-primary"
                    style={{ flex: 1 }}
                    disabled={!selectedWS || completeStep.isPending || selectedUID.status !== 'active'}
                    onClick={() => completeStep.mutate({ uid_id: selectedUID.id, workstation_id: selectedWS! })}
                  >
                    <CheckCircle size={15} />
                    {completeStep.isPending ? 'Saving…' : 'Mark Complete'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
