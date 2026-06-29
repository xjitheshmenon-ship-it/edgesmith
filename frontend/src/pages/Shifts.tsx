import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { shiftApi, factoryApi, userApi } from '../api/client'
import { format } from 'date-fns'
import { Plus, Trash2, CheckCircle, Clock, UserCheck, Briefcase, Zap, ChevronRight, ArrowRight, Users } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

const SHIFTS = [
  { value: 'morning',   label: 'Morning',   time: '06:00 – 14:00' },
  { value: 'afternoon', label: 'Afternoon', time: '14:00 – 22:00' },
  { value: 'night',     label: 'Night',     time: '22:00 – 06:00' },
]

const SHIFT_PILL: Record<string, React.CSSProperties> = {
  morning:   { background: 'rgba(251,191,36,.18)', color: '#fcd34d', border: '1px solid rgba(251,191,36,.3)' },
  afternoon: { background: 'rgba(96,165,250,.18)', color: '#93c5fd', border: '1px solid rgba(96,165,250,.3)' },
  night:     { background: 'rgba(167,139,250,.2)', color: '#c4b5fd', border: '1px solid rgba(167,139,250,.3)' },
}

const STATUS_COLOR: Record<string, string> = {
  active: '#6ee7b7',
  on_hold: '#fcd34d',
  converting: '#c4b5fd',
  dispatched: '#93c5fd',
}

export default function Shifts() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isSupervisor = user?.role && ['admin', 'supervisor'].includes(user.role)
  const canEdit = user?.role && ['admin', 'manager', 'supervisor'].includes(user.role)

  const today = format(new Date(), 'yyyy-MM-dd')
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedShift, setSelectedShift] = useState('morning')
  const [activeTab, setActiveTab] = useState<'assignments' | 'allotments'>('assignments')

  const [assignForm, setAssignForm] = useState({ workstation_id: '', operator_id: '', notes: '' })
  const [showAssignForm, setShowAssignForm] = useState(false)

  const { data: assignments = [] } = useQuery({
    queryKey: ['shift-assignments', selectedDate, selectedShift],
    queryFn: () => shiftApi.listAssignments({ shift_date: selectedDate, shift_period: selectedShift }).then(r => r.data),
  })

  const { data: queueData = [], isLoading: queueLoading } = useQuery({
    queryKey: ['shift-queue', selectedDate, selectedShift],
    queryFn: () => shiftApi.queueView(selectedDate, selectedShift).then(r => r.data),
    enabled: activeTab === 'allotments',
    refetchInterval: 30000,
  })

  const { data: workstations = [] } = useQuery({
    queryKey: ['workstations'],
    queryFn: () => factoryApi.workstations().then(r => r.data),
  })

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => userApi.list().then(r => r.data),
  })

  const operators = (users as any[]).filter((u: any) => u.role === 'operator')
  const assignedWsIds = new Set((assignments as any[]).map((a: any) => a.workstation_id))

  const createAssignment = useMutation({
    mutationFn: (d: any) => shiftApi.createAssignment({ ...d, shift_date: selectedDate, shift_period: selectedShift }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shift-assignments'] }); setShowAssignForm(false); setAssignForm({ workstation_id: '', operator_id: '', notes: '' }) },
  })

  const confirmAssignment = useMutation({
    mutationFn: (id: number) => shiftApi.confirmAssignment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-assignments'] }),
  })

  const deleteAssignment = useMutation({
    mutationFn: (id: number) => shiftApi.deleteAssignment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-assignments'] }),
  })

  const createAllotment = useMutation({
    mutationFn: (d: any) => shiftApi.createAllotment(d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-queue'] }),
  })

  const removeAllotment = useMutation({
    mutationFn: (id: number) => shiftApi.removeAllotment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-queue'] }),
  })

  const [autoAssignResult, setAutoAssignResult] = useState<{ allotted: number } | null>(null)
  const autoAssign = useMutation({
    mutationFn: () => shiftApi.autoAssign({ shift_date: selectedDate, shift_period: selectedShift }).then(r => r.data),
    onSuccess: (data) => {
      setAutoAssignResult(data)
      qc.invalidateQueries({ queryKey: ['shift-queue'] })
    },
  })

  const shiftInfo = SHIFTS.find(s => s.value === selectedShift)!

  return (
    <div style={{ padding: '24px 28px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--ink)' }}>Shift Management</div>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink-2)', marginTop: 3 }}>Operator assignments & job allotments</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input type="date" className="input" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
          <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 9, overflow: 'hidden' }}>
            {SHIFTS.map(s => (
              <button
                key={s.value}
                onClick={() => setSelectedShift(s.value)}
                style={{
                  padding: '8px 14px', fontSize: 13, fontWeight: 500,
                  border: 'none', borderRight: '1px solid var(--line)', cursor: 'pointer',
                  background: selectedShift === s.value ? 'var(--accent)' : 'var(--surface)',
                  color: selectedShift === s.value ? 'var(--accent-ink)' : 'var(--ink)',
                  transition: 'background 0.12s',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 20 }}>
        {[{ key: 'assignments', label: 'Operator Assignments', icon: <UserCheck size={14} /> }, { key: 'allotments', label: 'Job Queue', icon: <Briefcase size={14} /> }].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as any)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 16px', fontSize: 13, fontWeight: 500,
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: activeTab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === t.key ? 'var(--accent)' : 'var(--ink-2)',
              marginBottom: -1, transition: 'color 0.12s',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ASSIGNMENTS TAB */}
      {activeTab === 'assignments' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", ...SHIFT_PILL[selectedShift] }}>
              <Clock size={12} /> {shiftInfo.label} Shift · {shiftInfo.time} · {format(new Date(selectedDate + 'T00:00:00'), 'dd MMM yyyy')}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {(assignments as any[]).map((a: any) => (
              <div key={a.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{a.workstation_code} — {a.workstation_name}</div>
                    <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 500, marginTop: 3 }}>{a.operator_full_name || a.operator_username}</div>
                  </div>
                  {a.confirmed_by ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#22a06b' }}><CheckCircle size={12} /> Confirmed</span>
                  ) : (
                    <span style={{ fontSize: 11, color: '#fbbf24' }}>Pending</span>
                  )}
                </div>
                {a.notes && <p style={{ fontSize: 12, color: 'var(--ink-2)', fontStyle: 'italic', marginBottom: 6 }}>{a.notes}</p>}
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8 }}>Assigned by {a.assigned_by}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {!a.confirmed_by && isSupervisor && (
                    <button onClick={() => confirmAssignment.mutate(a.id)} className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }}>
                      <CheckCircle size={12} /> Confirm
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => deleteAssignment.mutate(a.id)} className="btn-secondary" style={{ fontSize: 12, padding: '4px 8px', color: 'var(--error)' }}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {canEdit && (
            !showAssignForm ? (
              <button onClick={() => setShowAssignForm(true)} className="btn-secondary"><Plus size={15} /> Assign Operator</button>
            ) : (
              <div className="card" style={{ padding: 16, maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Assign Operator to Workstation</div>
                <select className="input" value={assignForm.workstation_id} onChange={e => setAssignForm(f => ({ ...f, workstation_id: e.target.value }))}>
                  <option value="">Select workstation…</option>
                  {(workstations as any[]).filter((w: any) => !assignedWsIds.has(w.id)).map((w: any) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </select>
                <select className="input" value={assignForm.operator_id} onChange={e => setAssignForm(f => ({ ...f, operator_id: e.target.value }))}>
                  <option value="">Select operator…</option>
                  {operators.map((o: any) => <option key={o.id} value={o.id}>{o.full_name || o.username}</option>)}
                </select>
                <input className="input" placeholder="Notes (optional)" value={assignForm.notes} onChange={e => setAssignForm(f => ({ ...f, notes: e.target.value }))} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary" disabled={!assignForm.workstation_id || !assignForm.operator_id || createAssignment.isPending} onClick={() => createAssignment.mutate({ workstation_id: Number(assignForm.workstation_id), operator_id: Number(assignForm.operator_id), notes: assignForm.notes || undefined })}>
                    {createAssignment.isPending ? 'Saving…' : isSupervisor ? 'Assign & Confirm' : 'Assign'}
                  </button>
                  <button className="btn-secondary" onClick={() => setShowAssignForm(false)}>Cancel</button>
                </div>
                {createAssignment.isError && <p style={{ fontSize: 13, color: 'var(--error)' }}>{(createAssignment.error as any)?.response?.data?.detail || 'Error saving'}</p>}
              </div>
            )
          )}

          {assignments.length === 0 && !showAssignForm && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>No assignments for this shift yet.</div>
          )}
        </div>
      )}

      {/* JOB QUEUE TAB */}
      {activeTab === 'allotments' && (
        <div>
          {/* Header bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", ...SHIFT_PILL[selectedShift] }}>
              <Clock size={12} /> {shiftInfo.label} · {format(new Date(selectedDate + 'T00:00:00'), 'dd MMM yyyy')}
            </div>
            {canEdit && (
              <button
                className="btn-secondary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                disabled={autoAssign.isPending || (assignments as any[]).length === 0}
                onClick={() => { setAutoAssignResult(null); autoAssign.mutate() }}
              >
                <Zap size={13} /> {autoAssign.isPending ? 'Assigning…' : 'Auto-Fill All Queues'}
              </button>
            )}
            {autoAssignResult && (
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: autoAssignResult.allotted > 0 ? '#22a06b' : 'var(--ink-3)' }}>
                {autoAssignResult.allotted > 0 ? `✓ ${autoAssignResult.allotted} knives queued` : 'No matching knives found'}
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)' }}>
              Refreshes every 30s
            </span>
          </div>

          {queueLoading && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Loading queue…</div>
          )}

          {!queueLoading && (queueData as any[]).length === 0 && (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
              No operator assignments for this shift. Set up assignments first.
            </div>
          )}

          {/* Workstation queue cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {(queueData as any[]).map((ws: any) => (
              <WorkstationQueueCard
                key={ws.assignment_id}
                ws={ws}
                canEdit={!!canEdit}
                onAllot={(uid_id) => createAllotment.mutate({
                  uid_id,
                  operator_id: ws.operator_id,
                  workstation_id: ws.workstation_id,
                })}
                onRemove={(allotment_id) => removeAllotment.mutate(allotment_id)}
                allotting={createAllotment.isPending}
                removing={removeAllotment.isPending}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Workstation Queue Card ────────────────────────────────────────────────────

function WorkstationQueueCard({
  ws, canEdit, onAllot, onRemove, allotting, removing,
}: {
  ws: any
  canEdit: boolean
  onAllot: (uid_id: number) => void
  onRemove: (allotment_id: number) => void
  allotting: boolean
  removing: boolean
}) {
  const [showReady, setShowReady] = useState(false)

  const fromStr = ws.from_storage?.join(', ') || '—'
  const toStr = ws.to_storage?.join(', ') || '—'

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {/* Card header */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--surface-2)',
        borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      }}>
        <div>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>{ws.workstation_code}</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--ink-2)', marginLeft: 8 }}>{ws.workstation_name}</span>
        </div>

        {/* Source → Destination */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StoragePill label={fromStr} />
          <ArrowRight size={12} color="var(--ink-3)" />
          <StoragePill label={toStr} accent />
        </div>

        {/* Operator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <Users size={13} color="var(--ink-3)" />
          <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{ws.operator_name}</span>
          {ws.confirmed && <span style={{ fontSize: 10, color: '#6ee7b7', fontFamily: "'IBM Plex Mono', monospace" }}>CONFIRMED</span>}
        </div>

        {/* Queue count */}
        <div style={{
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
          background: ws.queue.length > 0 ? 'rgba(212,238,203,.15)' : 'var(--surface-3)',
          border: `1px solid ${ws.queue.length > 0 ? 'rgba(212,238,203,.3)' : 'var(--line)'}`,
          color: ws.queue.length > 0 ? 'var(--accent)' : 'var(--ink-3)',
          padding: '3px 10px', borderRadius: 20,
        }}>
          {ws.queue.length} in queue
        </div>
      </div>

      {/* Queue list */}
      {ws.queue.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '12px 16px', borderBottom: ws.ready_count > 0 ? '1px solid var(--line)' : 'none' }}>
          {ws.queue.map((j: any) => (
            <div key={j.id} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--surface-2)', border: '1px solid var(--line)',
              borderRadius: 8, padding: '4px 10px',
            }}>
              <span style={{
                fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 12,
                color: STATUS_COLOR[j.uid_status] || 'var(--ink)',
              }}>{j.uid_code}</span>
              {canEdit && (
                <button
                  onClick={() => onRemove(j.id)}
                  disabled={removing}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 0, lineHeight: 1 }}
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: '10px 16px', color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, borderBottom: ws.ready_count > 0 ? '1px solid var(--line)' : 'none' }}>
          Queue is empty
        </div>
      )}

      {/* Ready pool */}
      {ws.ready_count > 0 && canEdit && (
        <div style={{ padding: '10px 16px', background: 'var(--surface)' }}>
          <button
            onClick={() => setShowReady(s => !s)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
              color: 'var(--ink-2)',
            }}
          >
            <ChevronRight size={12} style={{ transform: showReady ? 'rotate(90deg)' : 'none', transition: '0.15s' }} />
            {ws.ready_count} knives ready at {fromStr} — click to add to queue
          </button>

          {showReady && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {ws.ready_uids.map((u: any) => (
                <button
                  key={u.id}
                  onClick={() => onAllot(u.id)}
                  disabled={allotting}
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 12,
                    padding: '4px 10px', borderRadius: 8, cursor: allotting ? 'not-allowed' : 'pointer',
                    border: '1px dashed var(--line)',
                    background: 'var(--surface-2)',
                    color: STATUS_COLOR[u.status] || 'var(--ink)',
                    transition: 'border-color 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)'}
                >
                  + {u.code}
                </button>
              ))}
              {ws.ready_count > 50 && (
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-3)', alignSelf: 'center' }}>
                  …and {ws.ready_count - 50} more (use Auto-Fill)
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StoragePill({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span style={{
      fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600,
      padding: '2px 8px', borderRadius: 6,
      background: accent ? 'rgba(212,238,203,.12)' : 'var(--surface-3)',
      color: accent ? 'var(--accent)' : 'var(--ink-2)',
      border: `1px solid ${accent ? 'rgba(212,238,203,.25)' : 'var(--line)'}`,
      letterSpacing: '0.06em',
    }}>
      {label}
    </span>
  )
}
