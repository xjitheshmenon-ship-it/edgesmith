import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { shiftApi, factoryApi, userApi } from '../api/client'
import { format } from 'date-fns'
import { Plus, Trash2, CheckCircle, Clock, UserCheck, Briefcase } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

const SHIFTS = [
  { value: 'morning', label: 'Morning', time: '06:00 – 14:00' },
  { value: 'afternoon', label: 'Afternoon', time: '14:00 – 22:00' },
  { value: 'night', label: 'Night', time: '22:00 – 06:00' },
]

const SHIFT_COLORS: Record<string, string> = {
  morning: 'bg-amber-50 border-amber-200 text-amber-800',
  afternoon: 'bg-blue-50 border-blue-200 text-blue-800',
  night: 'bg-indigo-50 border-indigo-200 text-indigo-800',
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

  // Assignment form state
  const [assignForm, setAssignForm] = useState({ workstation_id: '', operator_id: '', notes: '' })
  const [showAssignForm, setShowAssignForm] = useState(false)

  // Allotment form state
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shift Management</h1>
          <p className="text-sm text-gray-500">Operator assignments & job allotments</p>
        </div>
        <div className="flex gap-3">
          <input
            type="date"
            className="input"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
          />
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {SHIFTS.map(s => (
              <button
                key={s.value}
                onClick={() => setSelectedShift(s.value)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${selectedShift === s.value ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('assignments')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'assignments' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <UserCheck size={15} /> Operator Assignments
        </button>
        <button
          onClick={() => setActiveTab('allotments')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'allotments' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <Briefcase size={15} /> Job Allotments
        </button>
      </div>

      {/* ── ASSIGNMENTS TAB ─────────────────────────────────────────────── */}
      {activeTab === 'assignments' && (
        <div className="space-y-4">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${SHIFT_COLORS[selectedShift]}`}>
            <Clock size={12} /> {shiftInfo.label} Shift · {shiftInfo.time} · {format(new Date(selectedDate + 'T00:00:00'), 'dd MMM yyyy')}
          </div>

          {/* Assignment grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(assignments as any[]).map((a: any) => (
              <div key={a.id} className="card p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-gray-900">{a.workstation_code} — {a.workstation_name}</div>
                    <div className="text-sm text-brand-600 font-medium mt-1">{a.operator_full_name || a.operator_username}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {a.confirmed_by ? (
                      <span className="flex items-center gap-1 text-xs text-green-600 font-medium"><CheckCircle size={12} /> Confirmed</span>
                    ) : (
                      <span className="text-xs text-amber-600 font-medium">Pending</span>
                    )}
                  </div>
                </div>
                {a.notes && <p className="text-xs text-gray-500 italic">{a.notes}</p>}
                <div className="text-xs text-gray-400">Assigned by {a.assigned_by}</div>
                <div className="flex gap-2 pt-1">
                  {!a.confirmed_by && isSupervisor && (
                    <button
                      onClick={() => confirmAssignment.mutate(a.id)}
                      className="btn-primary text-xs py-1 px-2"
                    >
                      <CheckCircle size={12} /> Confirm
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => deleteAssignment.mutate(a.id)}
                      className="btn-secondary text-xs py-1 px-2 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add assignment */}
          {canEdit && (
            <div>
              {!showAssignForm ? (
                <button onClick={() => setShowAssignForm(true)} className="btn-secondary">
                  <Plus size={15} /> Assign Operator
                </button>
              ) : (
                <div className="card p-4 space-y-3 max-w-md">
                  <h3 className="font-semibold text-gray-900">Assign Operator to Workstation</h3>
                  <select className="input w-full" value={assignForm.workstation_id} onChange={e => setAssignForm(f => ({ ...f, workstation_id: e.target.value }))}>
                    <option value="">Select workstation…</option>
                    {(workstations as any[])
                      .filter((w: any) => !assignedWsIds.has(w.id))
                      .map((w: any) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                  </select>
                  <select className="input w-full" value={assignForm.operator_id} onChange={e => setAssignForm(f => ({ ...f, operator_id: e.target.value }))}>
                    <option value="">Select operator…</option>
                    {operators.map((o: any) => <option key={o.id} value={o.id}>{o.full_name || o.username}</option>)}
                  </select>
                  <input className="input w-full" placeholder="Notes (optional)" value={assignForm.notes} onChange={e => setAssignForm(f => ({ ...f, notes: e.target.value }))} />
                  <div className="flex gap-2">
                    <button
                      className="btn-primary"
                      disabled={!assignForm.workstation_id || !assignForm.operator_id || createAssignment.isPending}
                      onClick={() => createAssignment.mutate({ workstation_id: Number(assignForm.workstation_id), operator_id: Number(assignForm.operator_id), notes: assignForm.notes || undefined })}
                    >
                      {createAssignment.isPending ? 'Saving…' : isSupervisor ? 'Assign & Confirm' : 'Assign (needs supervisor confirmation)'}
                    </button>
                    <button className="btn-secondary" onClick={() => setShowAssignForm(false)}>Cancel</button>
                  </div>
                  {createAssignment.isError && <p className="text-red-600 text-sm">{(createAssignment.error as any)?.response?.data?.detail || 'Error saving'}</p>}
                </div>
              )}
            </div>
          )}

          {assignments.length === 0 && !showAssignForm && (
            <div className="text-center py-12 text-gray-400">No assignments for this shift yet.</div>
          )}
        </div>
      )}

      {/* ── ALLOTMENTS TAB ──────────────────────────────────────────────── */}
      {activeTab === 'allotments' && (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="pb-2 pr-4">UID</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Step</th>
                  <th className="pb-2 pr-4">Operator</th>
                  <th className="pb-2 pr-4">Workstation</th>
                  <th className="pb-2 pr-4">Allotted By</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(allotments as any[]).map((j: any) => (
                  <tr key={j.id} className="hover:bg-gray-50">
                    <td className="py-2 pr-4 font-mono font-semibold text-brand-700">{j.uid_code}</td>
                    <td className="py-2 pr-4"><span className="badge-blue">{j.uid_status}</span></td>
                    <td className="py-2 pr-4 text-gray-600">{j.current_step || '—'}</td>
                    <td className="py-2 pr-4">{j.operator_full_name || j.operator_username}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{j.workstation_code}</td>
                    <td className="py-2 pr-4 text-gray-500">{j.allotted_by}</td>
                    <td className="py-2">
                      {canEdit && (
                        <button onClick={() => removeAllotment.mutate(j.id)} className="text-red-400 hover:text-red-600">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {allotments.length === 0 && (
              <div className="text-center py-12 text-gray-400">No active job allotments.</div>
            )}
          </div>

          {/* Allot job form */}
          {isSupervisor && (
            <div>
              {!showAllotForm ? (
                <button onClick={() => setShowAllotForm(true)} className="btn-secondary">
                  <Plus size={15} /> Allot Job to Operator
                </button>
              ) : (
                <div className="card p-4 space-y-3 max-w-md">
                  <h3 className="font-semibold text-gray-900">Allot Job</h3>
                  <div>
                    <input
                      className="input w-full"
                      placeholder="Search UID code…"
                      value={uidSearch}
                      onChange={e => setUidSearch(e.target.value.toUpperCase())}
                    />
                    {uidResult && (
                      <div
                        className="mt-1 p-2 border rounded cursor-pointer hover:bg-gray-50 text-sm"
                        onClick={() => setAllotForm(f => ({ ...f, uid_id: String(uidResult.id) }))}
                      >
                        <span className="font-mono font-bold text-brand-700">{uidResult.uid_code}</span>
                        <span className="text-gray-400 ml-2">· {uidResult.status} · Step {uidResult.current_step_number}</span>
                        {allotForm.uid_id === String(uidResult.id) && <span className="ml-2 text-green-600 text-xs">✓ selected</span>}
                      </div>
                    )}
                  </div>
                  <select className="input w-full" value={allotForm.operator_id} onChange={e => setAllotForm(f => ({ ...f, operator_id: e.target.value }))}>
                    <option value="">Select operator…</option>
                    {operators.map((o: any) => <option key={o.id} value={o.id}>{o.full_name || o.username}</option>)}
                  </select>
                  <select className="input w-full" value={allotForm.workstation_id} onChange={e => setAllotForm(f => ({ ...f, workstation_id: e.target.value }))}>
                    <option value="">Select workstation…</option>
                    {(workstations as any[]).map((w: any) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                  </select>
                  <input className="input w-full" placeholder="Notes (optional)" value={allotForm.notes} onChange={e => setAllotForm(f => ({ ...f, notes: e.target.value }))} />
                  <div className="flex gap-2">
                    <button
                      className="btn-primary"
                      disabled={!allotForm.uid_id || !allotForm.operator_id || !allotForm.workstation_id || createAllotment.isPending}
                      onClick={() => createAllotment.mutate({ uid_id: Number(allotForm.uid_id), operator_id: Number(allotForm.operator_id), workstation_id: Number(allotForm.workstation_id), notes: allotForm.notes || undefined })}
                    >
                      {createAllotment.isPending ? 'Saving…' : 'Allot Job'}
                    </button>
                    <button className="btn-secondary" onClick={() => { setShowAllotForm(false); setUidSearch('') }}>Cancel</button>
                  </div>
                  {createAllotment.isError && <p className="text-red-600 text-sm">{(createAllotment.error as any)?.response?.data?.detail || 'Error saving'}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
