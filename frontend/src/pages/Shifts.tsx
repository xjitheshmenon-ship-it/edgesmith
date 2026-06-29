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

function StoragePill({ code }: { code: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 6,
      background: 'rgba(212,238,203,.15)', color: '#a7d9a0',
      border: '1px solid rgba(212,238,203,.25)',
      fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600,
    }}>{code}</span>
  )
}

function WorkstationQueueCard({
  ws, canEdit, onAllot, onRemove,
}: {
  ws: any
  canEdit: boolean
  onAllot: (uid_id: number) => void
  onRemove: (allotment_id: number) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--line)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{ws.workstation_code}</span>
            <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{ws.workstation_name}</span>
            {ws.from_storage?.length > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {ws.from_storage.map((c: string) => <StoragePill key={c} code={c} />)}
                <ArrowRight size={12} style={{ color: 'var(--ink-3)' }} />
                {ws.to_storage.map((c: string) => <StoragePill key={c} code={c} />)}
              </span>
            )}
          </div>
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Users size={12} style={{ color: 'var(--ink-3)' }} />
            <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>{ws.operator_name}</span>
            {ws.confirmed
              ? <span style={{ fontSize: 11, color: '#22a06b', display: 'flex', alignItems: 'center', gap: 3 }}><CheckCircle size={10} /> Confirmed</span>
              : <span style={{ fontSize: 11, color: '#fbbf24' }}>Pending confirmation</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 20, color: 'var(--accent)' }}>{ws.queue?.length ?? 0}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>in queue</div>
        </div>
      </div>

      {/* Queue chips */}
      <div style={{ padding: '10px 16px', display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 44, background: 'rgba(0,0,0,.08)' }}>
        {ws.queue?.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", alignSelf: 'center' }}>Queue empty</span>
        )}
        {ws.queue?.map((j: any) => (
          <span key={j.id} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 8px', borderRadius: 8,
            background: 'var(--surface)', border: '1px solid var(--line)',
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[j.uid_status] || 'var(--ink-3)', flexShrink: 0 }} />
            {j.uid_code}
            {canEdit && (
              <button onClick={() => onRemove(j.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'var(--ink-3)', marginLeft: 2 }}>×</button>
            )}
          </span>
        ))}
      </div>

      {/* Ready pool (collapsible) */}
      {ws.ready_count > 0 && (
        <div style={{ borderTop: '1px solid var(--line)' }}>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ width: '100%', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)' }}
          >
            <ChevronRight size={13} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
            {ws.ready_count} knife{ws.ready_count !== 1 ? 's' : ''} ready to pick
          </button>
          {expanded && (
            <div style={{ padding: '0 16px 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ws.ready_uids?.map((u: any) => (
                <button
                  key={u.id}
                  onClick={() => canEdit && onAllot(u.id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 8px', borderRadius: 8,
                    background: 'none', border: '1px dashed var(--line)',
                    fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, cursor: canEdit ? 'pointer' : 'default',
                    color: 'var(--ink-2)',
                  }}
                >
                  <Plus size={11} />
                  {u.code}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
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

  const { data: queueData = [], isLoading: queueLoading, isError: queueError } = useQuery({
    queryKey: ['shift-queue', selectedDate, selectedShift],
    queryFn: () => shiftApi.queueView(selectedDate, selectedShift).then(r => r.data),
    enabled: activeTab === 'allotments',
    refetchInterval: 30000,
    retry: 1,
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
    mutationFn: () => shiftApi.autoAssign({ shift_date: selectedDate, shift_period: selectedShift }),
    onSuccess: (r) => { setAutoAssignResult(r.data); qc.invalidateQueries({ queryKey: ['shift-queue'] }) },
  })

  const shiftInfo = SHIFTS.find(s => s.value === selectedShift)!

  return (
    <div style={{ padding: '24px 28px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--ink)' }}>Shift Management</div>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink-2)', marginTop: 3 }}>Operator assignments & job queue</div>
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
        {[
          { key: 'assignments', label: 'Operator Assignments', icon: <UserCheck size={14} /> },
          { key: 'allotments', label: 'Job Queue', icon: <Briefcase size={14} /> },
        ].map(t => (
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
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", ...SHIFT_PILL[selectedShift] }}>
            <Clock size={12} /> {shiftInfo.label} Shift · {shiftInfo.time} · {format(new Date(selectedDate + 'T00:00:00'), 'dd MMM yyyy')}
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
                  <button className="btn-primary" disabled={!assignForm.workstation_id || !assignForm.operator_id || createAssignment.isPending}
                    onClick={() => createAssignment.mutate({ workstation_id: Number(assignForm.workstation_id), operator_id: Number(assignForm.operator_id), notes: assignForm.notes || undefined })}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", ...SHIFT_PILL[selectedShift] }}>
              <Clock size={12} /> {shiftInfo.label} · {format(new Date(selectedDate + 'T00:00:00'), 'dd MMM yyyy')}
            </div>
            {canEdit && (
              <button
                className="btn-primary"
                style={{ fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 5 }}
                disabled={autoAssign.isPending}
                onClick={() => { setAutoAssignResult(null); autoAssign.mutate() }}
              >
                <Zap size={13} /> {autoAssign.isPending ? 'Filling…' : 'Auto-Fill All Queues'}
              </button>
            )}
            {autoAssignResult && (
              <span style={{ fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: autoAssignResult.allotted > 0 ? '#6ee7b7' : 'var(--ink-3)' }}>
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

          {!queueLoading && queueError && (
            <div style={{ textAlign: 'center', padding: 48, color: '#f87171', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
              Failed to load queue. Please refresh the page.
            </div>
          )}

          {!queueLoading && !queueError && (queueData as any[]).length === 0 && (
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
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
