import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { shiftApi, factoryApi, userApi } from '../api/client'
import { format } from 'date-fns'
import { Plus, Trash2, CheckCircle, Clock, UserCheck, Briefcase } from 'lucide-react'
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

const TH: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.1em', color: 'var(--ink-3)', fontWeight: 500, borderBottom: '1px solid var(--line)', textTransform: 'uppercase' }
const TD: React.CSSProperties = { padding: '10px 12px', fontSize: 13, color: 'var(--ink)', borderBottom: '1px solid var(--line)' }

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

  const [allotForm, setAllotForm] = useState({ uid_id: '', operator_id: '', workstation_id: '', notes: '' })
  const [uidSearch, setUidSearch] = useState('')
  const [showAllotForm, setShowAllotForm] = useState(false)

  const { data: assignments = [] } = useQuery({
    queryKey: ['shift-assignments', selectedDate, selectedShift],
    queryFn: () => shiftApi.listAssignments({ shift_date: selectedDate, shift_period: selectedShift }).then(r => r.data),
  })

  const { data: allotments = [] } = useQuery({
    queryKey: ['job-allotments'],
    queryFn: () => shiftApi.listAllotments({ active_only: true }).then(r => r.data),
  })

  const { data: workstations = [] } = useQuery({
    queryKey: ['workstations'],
    queryFn: () => factoryApi.workstations().then(r => r.data),
  })

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => userApi.list().then(r => r.data),
  })

  const { data: uidResult } = useQuery({
    queryKey: ['uid-lookup', uidSearch],
    queryFn: () => import('../api/client').then(m => m.uidApi.lookup(uidSearch).then(r => r.data)),
    enabled: uidSearch.length >= 3,
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['job-allotments'] }); setShowAllotForm(false); setAllotForm({ uid_id: '', operator_id: '', workstation_id: '', notes: '' }); setUidSearch('') },
  })

  const removeAllotment = useMutation({
    mutationFn: (id: number) => shiftApi.removeAllotment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-allotments'] }),
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
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 500,
                  border: 'none',
                  borderRight: '1px solid var(--line)',
                  cursor: 'pointer',
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
        {[{ key: 'assignments', label: 'Operator Assignments', icon: <UserCheck size={14} /> }, { key: 'allotments', label: 'Job Allotments', icon: <Briefcase size={14} /> }].map(t => (
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

      {/* ALLOTMENTS TAB */}
      {activeTab === 'allotments' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={TH}>UID</th>
                  <th style={TH}>Status</th>
                  <th style={TH}>Step</th>
                  <th style={TH}>Operator</th>
                  <th style={TH}>Workstation</th>
                  <th style={TH}>Allotted By</th>
                  <th style={TH}></th>
                </tr>
              </thead>
              <tbody>
                {(allotments as any[]).map((j: any) => (
                  <tr key={j.id}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <td style={{ ...TD, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: 'var(--accent)' }}>{j.uid_code}</td>
                    <td style={TD}><span className="badge-blue">{j.uid_status}</span></td>
                    <td style={{ ...TD, color: 'var(--ink-2)' }}>{j.current_step || '—'}</td>
                    <td style={TD}>{j.operator_full_name || j.operator_username}</td>
                    <td style={{ ...TD, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>{j.workstation_code}</td>
                    <td style={{ ...TD, color: 'var(--ink-2)' }}>{j.allotted_by}</td>
                    <td style={TD}>
                      {canEdit && (
                        <button onClick={() => removeAllotment.mutate(j.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)' }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {allotments.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>No active job allotments.</div>
            )}
          </div>

          {isSupervisor && (
            !showAllotForm ? (
              <button onClick={() => setShowAllotForm(true)} className="btn-secondary"><Plus size={15} /> Allot Job to Operator</button>
            ) : (
              <div className="card" style={{ padding: 16, maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Allot Job</div>
                <div>
                  <input className="input" style={{ width: '100%' }} placeholder="Search UID code…" value={uidSearch} onChange={e => setUidSearch(e.target.value.toUpperCase())} />
                  {uidResult && (
                    <div
                      onClick={() => setAllotForm(f => ({ ...f, uid_id: String(uidResult.id) }))}
                      style={{ marginTop: 4, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: allotForm.uid_id === String(uidResult.id) ? 'var(--accent-dim)' : 'var(--surface-2)' }}
                    >
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, color: 'var(--accent)' }}>{uidResult.uid_code}</span>
                      <span style={{ color: 'var(--ink-2)', marginLeft: 8 }}>· {uidResult.status} · Step {uidResult.current_step_number}</span>
                      {allotForm.uid_id === String(uidResult.id) && <span style={{ marginLeft: 8, color: '#22a06b', fontSize: 12 }}>✓ selected</span>}
                    </div>
                  )}
                </div>
                <select className="input" value={allotForm.operator_id} onChange={e => setAllotForm(f => ({ ...f, operator_id: e.target.value }))}>
                  <option value="">Select operator…</option>
                  {operators.map((o: any) => <option key={o.id} value={o.id}>{o.full_name || o.username}</option>)}
                </select>
                <select className="input" value={allotForm.workstation_id} onChange={e => setAllotForm(f => ({ ...f, workstation_id: e.target.value }))}>
                  <option value="">Select workstation…</option>
                  {(workstations as any[]).map((w: any) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </select>
                <input className="input" placeholder="Notes (optional)" value={allotForm.notes} onChange={e => setAllotForm(f => ({ ...f, notes: e.target.value }))} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary" disabled={!allotForm.uid_id || !allotForm.operator_id || !allotForm.workstation_id || createAllotment.isPending} onClick={() => createAllotment.mutate({ uid_id: Number(allotForm.uid_id), operator_id: Number(allotForm.operator_id), workstation_id: Number(allotForm.workstation_id), notes: allotForm.notes || undefined })}>
                    {createAllotment.isPending ? 'Saving…' : 'Allot Job'}
                  </button>
                  <button className="btn-secondary" onClick={() => { setShowAllotForm(false); setUidSearch('') }}>Cancel</button>
                </div>
                {createAllotment.isError && <p style={{ fontSize: 13, color: 'var(--error)' }}>{(createAllotment.error as any)?.response?.data?.detail || 'Error saving'}</p>}
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
