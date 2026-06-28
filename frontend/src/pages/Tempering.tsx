import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { temperingApi, cycleApi } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import { Flame, AlertTriangle, CheckCircle, Plus, X } from 'lucide-react'

type Tab = 'parameters' | 'batches'

export default function Tempering() {
  const [tab, setTab] = useState<Tab>('batches')
  const [showForm, setShowForm] = useState(false)
  const [selectedBatch, setSelectedBatch] = useState<any>(null)
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isSupervisor = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor'

  const cycles = useQuery({ queryKey: ['cycles'], queryFn: () => cycleApi.list().then(r => r.data) })
  const params = useQuery({ queryKey: ['tempering-params'], queryFn: () => temperingApi.parameters().then(r => r.data) })
  const batches = useQuery({ queryKey: ['furnace-batches'], queryFn: () => temperingApi.batches().then(r => r.data) })

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 22, color: 'var(--ink)', letterSpacing: '-0.03em', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Flame size={20} color="var(--accent)" />
          Tempering
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.1em', marginTop: 4 }}>
          FURNACE BATCH TRACKING · HT90 · TARGET vs ACTUAL PARAMETERS
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {(['batches', 'parameters'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setShowForm(false) }}
            style={{
              padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em',
              background: tab === t ? 'var(--accent)' : 'var(--surface-2)',
              color: tab === t ? 'var(--accent-ink)' : 'var(--ink-2)',
              fontWeight: tab === t ? 700 : 400,
            }}
          >
            {t.toUpperCase()}
          </button>
        ))}
        {((tab === 'batches' && isSupervisor) || (tab === 'parameters' && isAdmin)) && (
          <button onClick={() => setShowForm(s => !s)} className="btn-primary" style={{ marginLeft: 'auto', gap: 6 }}>
            {showForm ? <X size={13} /> : <Plus size={13} />}
            {showForm ? 'Cancel' : tab === 'batches' ? 'New Furnace Batch' : 'Set Parameter'}
          </button>
        )}
      </div>

      {showForm && tab === 'parameters' && isAdmin && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <ParameterForm cycles={cycles.data || []} onDone={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['tempering-params'] }) }} />
        </div>
      )}

      {showForm && tab === 'batches' && isSupervisor && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <BatchForm cycles={cycles.data || []} params={params.data || []} onDone={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['furnace-batches'] }) }} />
        </div>
      )}

      {tab === 'parameters' && (
        <ParametersTable data={params.data || []} loading={params.isLoading} />
      )}
      {tab === 'batches' && (
        <BatchesTable data={batches.data || []} loading={batches.isLoading} onSelect={setSelectedBatch} />
      )}

      {selectedBatch && (
        <BatchDrawer batchId={selectedBatch.id} onClose={() => setSelectedBatch(null)} />
      )}
    </div>
  )
}

// ── Parameter Form ────────────────────────────────────────────────────────────

function ParameterForm({ cycles, onDone }: { cycles: any[]; onDone: () => void }) {
  const [cycleId, setCycleId] = useState('')
  const [stepId, setStepId] = useState('')
  const [targetTemp, setTargetTemp] = useState('')
  const [targetSoak, setTargetSoak] = useState('')
  const [tolTemp, setTolTemp] = useState('5')
  const [tolSoak, setTolSoak] = useState('5')

  const selectedCycle = cycles.find((c: any) => c.id === parseInt(cycleId))
  const temperingSteps = (selectedCycle?.current_version?.steps || []).filter((s: any) => s.is_qc_step === false && (s.workstation_code === 'HT90' || s.operation_name?.toLowerCase().includes('temper')))

  const mut = useMutation({
    mutationFn: () => temperingApi.upsertParameter({
      cycle_type_id: parseInt(cycleId),
      cycle_step_id: parseInt(stepId),
      target_temp_c: parseFloat(targetTemp),
      target_soak_minutes: parseInt(targetSoak),
      tolerance_temp_c: parseFloat(tolTemp),
      tolerance_soak_minutes: parseInt(tolSoak),
    }),
    onSuccess: onDone,
  })

  const L = ({ children }: { children: React.ReactNode }) => (
    <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>{children}</label>
  )

  return (
    <div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)', marginBottom: 16, letterSpacing: '0.06em' }}>SET TEMPERING PARAMETERS</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <L>CYCLE TYPE</L>
          <select className="input" value={cycleId} onChange={e => { setCycleId(e.target.value); setStepId('') }}>
            <option value="">Select cycle…</option>
            {cycles.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <L>TEMPERING STEP</L>
          <select className="input" value={stepId} onChange={e => setStepId(e.target.value)} disabled={!cycleId}>
            <option value="">Select step…</option>
            {temperingSteps.map((s: any) => <option key={s.id} value={s.id}>Step {s.step_number} — {s.operation_name}</option>)}
          </select>
        </div>
        <div>
          <L>TARGET TEMPERATURE (°C)</L>
          <input className="input" type="number" value={targetTemp} onChange={e => setTargetTemp(e.target.value)} placeholder="e.g. 180" />
        </div>
        <div>
          <L>TARGET SOAK TIME (MIN)</L>
          <input className="input" type="number" value={targetSoak} onChange={e => setTargetSoak(e.target.value)} placeholder="e.g. 90" />
        </div>
        <div>
          <L>TEMP TOLERANCE (±°C)</L>
          <input className="input" type="number" value={tolTemp} onChange={e => setTolTemp(e.target.value)} />
        </div>
        <div>
          <L>SOAK TOLERANCE (±MIN)</L>
          <input className="input" type="number" value={tolSoak} onChange={e => setTolSoak(e.target.value)} />
        </div>
      </div>
      <button className="btn-primary" onClick={() => mut.mutate()} disabled={mut.isPending || !cycleId || !stepId || !targetTemp || !targetSoak}>
        {mut.isPending ? 'Saving…' : 'Save Parameters'}
      </button>
    </div>
  )
}

// ── Batch Form ────────────────────────────────────────────────────────────────

function BatchForm({ cycles, params, onDone }: { cycles: any[]; params: any[]; onDone: () => void }) {
  const [cycleId, setCycleId] = useState('')
  const [stepId, setStepId] = useState('')
  const [uidList, setUidList] = useState('')

  const selectedCycle = cycles.find((c: any) => c.id === parseInt(cycleId))
  const temperingSteps = (selectedCycle?.current_version?.steps || []).filter((s: any) =>
    s.workstation_code === 'HT90' || s.operation_name?.toLowerCase().includes('temper')
  )
  const matchingParam = params.find((p: any) => p.cycle_type_id === parseInt(cycleId) && p.cycle_step_id === parseInt(stepId))

  const mut = useMutation({
    mutationFn: () => temperingApi.createBatch({
      cycle_type_id: parseInt(cycleId),
      cycle_step_id: parseInt(stepId),
      uid_ids: uidList.split(',').map(s => parseInt(s.trim())).filter(Boolean),
    }),
    onSuccess: onDone,
  })

  const L = ({ children }: { children: React.ReactNode }) => (
    <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: 4 }}>{children}</label>
  )

  return (
    <div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)', marginBottom: 16, letterSpacing: '0.06em' }}>NEW FURNACE BATCH — HT90</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <L>CYCLE TYPE</L>
          <select className="input" value={cycleId} onChange={e => { setCycleId(e.target.value); setStepId('') }}>
            <option value="">Select cycle…</option>
            {cycles.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <L>TEMPERING STEP</L>
          <select className="input" value={stepId} onChange={e => setStepId(e.target.value)} disabled={!cycleId}>
            <option value="">Select step…</option>
            {temperingSteps.map((s: any) => <option key={s.id} value={s.id}>Step {s.step_number} — {s.operation_name}</option>)}
          </select>
        </div>
      </div>
      {matchingParam && (
        <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)' }}>
          Target: <span style={{ color: 'var(--accent)' }}>{matchingParam.target_temp_c}°C</span> for <span style={{ color: 'var(--accent)' }}>{matchingParam.target_soak_minutes} min</span>
          <span style={{ color: 'var(--ink-3)', marginLeft: 12 }}>±{matchingParam.tolerance_temp_c}°C / ±{matchingParam.tolerance_soak_minutes}min</span>
        </div>
      )}
      <div>
        <L>UID IDs (COMMA SEPARATED)</L>
        <input className="input" value={uidList} onChange={e => setUidList(e.target.value)} placeholder="e.g. 1, 2, 3, 4" />
        <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 4, fontFamily: "'IBM Plex Mono', monospace" }}>Enter UID database IDs to add to this furnace batch</div>
      </div>
      <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => mut.mutate()} disabled={mut.isPending || !cycleId || !stepId}>
        {mut.isPending ? 'Creating…' : 'Create Furnace Batch'}
      </button>
    </div>
  )
}

// ── Tables ────────────────────────────────────────────────────────────────────

const TH = ({ children }: { children: React.ReactNode }) => (
  <th style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.1em', color: 'var(--ink-3)', textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--line)', fontWeight: 500 }}>{children}</th>
)
const TD = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <td style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--ink)', padding: '9px 12px', borderBottom: '1px solid var(--line)', ...style }}>{children}</td>
)

function ParametersTable({ data, loading }: { data: any[]; loading: boolean }) {
  if (loading) return <div style={{ color: 'var(--ink-3)', padding: 16 }}>Loading…</div>
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="es-table" style={{ width: '100%' }}>
        <thead><tr>
          <TH>CYCLE TYPE</TH><TH>STEP</TH><TH>OPERATION</TH>
          <TH>TARGET TEMP</TH><TH>TARGET SOAK</TH><TH>TEMP TOL</TH><TH>SOAK TOL</TH><TH>UPDATED</TH>
        </tr></thead>
        <tbody>
          {data.map((p: any) => (
            <tr key={p.id}>
              <TD>{p.cycle_type_name}</TD>
              <TD>Step {p.step_number}</TD>
              <TD>{p.operation_name}</TD>
              <TD><span style={{ color: '#fcd34d' }}>{p.target_temp_c}°C</span></TD>
              <TD><span style={{ color: '#fcd34d' }}>{p.target_soak_minutes} min</span></TD>
              <TD>±{p.tolerance_temp_c}°C</TD>
              <TD>±{p.tolerance_soak_minutes} min</TD>
              <TD>{p.updated_at ? new Date(p.updated_at).toLocaleDateString() : '—'}</TD>
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>No parameters configured — Admin sets these</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function BatchesTable({ data, loading, onSelect }: { data: any[]; loading: boolean; onSelect: (b: any) => void }) {
  if (loading) return <div style={{ color: 'var(--ink-3)', padding: 16 }}>Loading…</div>
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="es-table" style={{ width: '100%' }}>
        <thead><tr>
          <TH>BATCH NO</TH><TH>CYCLE</TH><TH>STEP</TH><TH>TARGET</TH>
          <TH>ACTUAL</TH><TH>UIDS</TH><TH>STATUS</TH><TH>STARTED</TH>
        </tr></thead>
        <tbody>
          {data.map((b: any) => (
            <tr key={b.id} onClick={() => onSelect(b)} style={{ cursor: 'pointer' }} className="row-hover">
              <TD><span style={{ color: 'var(--accent)', fontWeight: 700 }}>{b.batch_number}</span></TD>
              <TD>{b.cycle_type_name}</TD>
              <TD>Step {b.step_number}</TD>
              <TD style={{ color: '#fcd34d' }}>{b.target_temp_c ? `${b.target_temp_c}°C / ${b.target_soak_minutes}min` : '—'}</TD>
              <TD>
                {b.actuals_recorded ? (
                  <span style={{ color: b.deviation_flagged ? 'var(--error)' : '#6ee7b7' }}>
                    {b.actual_temp_c}°C / {b.actual_soak_minutes}min
                  </span>
                ) : b.ended_at ? <span style={{ color: 'var(--ink-3)' }}>Not recorded</span> : '—'}
              </TD>
              <TD>{b.uid_count}</TD>
              <TD>
                {b.deviation_flagged ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--error)' }}>
                    <AlertTriangle size={12} /> DEVIATION
                  </span>
                ) : b.ended_at ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#6ee7b7' }}>
                    <CheckCircle size={12} /> DONE
                  </span>
                ) : (
                  <span style={{ color: '#fcd34d' }}>IN PROGRESS</span>
                )}
              </TD>
              <TD>{b.started_at ? new Date(b.started_at).toLocaleString() : '—'}</TD>
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>No furnace batches yet</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ── Batch Drawer ──────────────────────────────────────────────────────────────

function BatchDrawer({ batchId, onClose }: { batchId: number; onClose: () => void }) {
  const [actualTemp, setActualTemp] = useState('')
  const [actualSoak, setActualSoak] = useState('')
  const qc = useQueryClient()
  const { user } = useAuth()
  const isSupervisor = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor'

  const { data: batch, isLoading } = useQuery({
    queryKey: ['furnace-batch', batchId],
    queryFn: () => temperingApi.getBatch(batchId).then(r => r.data),
  })

  const complete = useMutation({
    mutationFn: () => temperingApi.completeBatch(batchId, {
      actual_temp_c: actualTemp ? parseFloat(actualTemp) : null,
      actual_soak_minutes: actualSoak ? parseInt(actualSoak) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['furnace-batches'] })
      qc.invalidateQueries({ queryKey: ['furnace-batch', batchId] })
    },
  })

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div style={{
        width: 480, height: '100%', background: 'var(--surface)',
        borderLeft: '1px solid var(--line)', overflowY: 'auto', padding: 24,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 14, color: 'var(--accent)', letterSpacing: '0.06em' }}>
              {isLoading ? '…' : batch?.batch_number}
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginTop: 4 }}>
              FURNACE BATCH
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)' }}>
            <X size={16} />
          </button>
        </div>

        {isLoading && <div style={{ color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Loading…</div>}

        {batch && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              {[
                ['Cycle', batch.cycle_type_name],
                ['Step', `Step ${batch.step_number} — ${batch.operation_name}`],
                ['Target Temp', batch.target_temp_c ? `${batch.target_temp_c}°C` : '—'],
                ['Target Soak', batch.target_soak_minutes ? `${batch.target_soak_minutes} min` : '—'],
                ['Actual Temp', batch.actual_temp_c ? `${batch.actual_temp_c}°C` : '—'],
                ['Actual Soak', batch.actual_soak_minutes != null ? `${batch.actual_soak_minutes} min` : '—'],
                ['Started', batch.started_at ? new Date(batch.started_at).toLocaleString() : '—'],
                ['Ended', batch.ended_at ? new Date(batch.ended_at).toLocaleString() : 'In progress'],
              ].map(([k, v]) => (
                <div key={k} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--ink-3)', letterSpacing: '0.1em', marginBottom: 2 }}>{k}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--ink)' }}>{v}</div>
                </div>
              ))}
            </div>

            {batch.deviation_flagged && (
              <div style={{ background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: 'var(--error)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                <div><div style={{ fontWeight: 700, marginBottom: 4 }}>DEVIATION FLAGGED</div>{batch.deviation_notes}</div>
              </div>
            )}

            {!batch.ended_at && isSupervisor && (
              <div style={{ marginBottom: 20, padding: 16, background: 'var(--surface-2)', borderRadius: 10 }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)', marginBottom: 12, letterSpacing: '0.06em' }}>COMPLETE BATCH</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginBottom: 4 }}>ACTUAL TEMP (°C)</label>
                    <input className="input" type="number" value={actualTemp} onChange={e => setActualTemp(e.target.value)} placeholder={batch.target_temp_c || ''} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', marginBottom: 4 }}>ACTUAL SOAK (MIN)</label>
                    <input className="input" type="number" value={actualSoak} onChange={e => setActualSoak(e.target.value)} placeholder={batch.target_soak_minutes || ''} />
                  </div>
                </div>
                <button className="btn-primary" onClick={() => complete.mutate()} disabled={complete.isPending} style={{ width: '100%', justifyContent: 'center' }}>
                  {complete.isPending ? 'Completing…' : 'Mark Batch Done'}
                </button>
              </div>
            )}

            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)', marginBottom: 10, letterSpacing: '0.06em' }}>
              UIDS IN THIS BATCH ({batch.uids?.length || 0})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(batch.uids || []).map((u: any) => (
                <span key={u.uid_id} style={{
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700,
                  padding: '3px 9px', borderRadius: 6,
                  background: 'var(--surface-3)', color: 'var(--accent)',
                  border: '1px solid var(--line)',
                }}>
                  {u.uid_code}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
