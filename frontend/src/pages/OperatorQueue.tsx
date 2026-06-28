import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { uidApi, factoryApi } from '../api/client'
import type { UID, Workstation, FactoryLocation } from '../types'
import UIDStatusBadge from '../components/UIDStatusBadge'
import PriorityBadge from '../components/PriorityBadge'
import { useAuth } from '../hooks/useAuth'
import { CheckCircle, AlertTriangle } from 'lucide-react'

export default function OperatorQueue() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [selectedUID, setSelectedUID] = useState<UID | null>(null)
  const [qcResult, setQCResult] = useState('na')
  const [notes, setNotes] = useState('')
  const [selectedWS, setSelectedWS] = useState<number | undefined>()

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

  const urgent = uids.filter((u) => u.priority === 'urgent')
  const high = uids.filter((u) => u.priority === 'high')
  const normal = uids.filter((u) => u.priority === 'normal')
  const ordered = [...urgent, ...high, ...normal]

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Job Queue</h1>
        <p className="text-sm text-gray-500">{uids.length} UIDs pending — select one to mark step complete</p>
      </div>

      {urgent.length > 0 && (
        <div className="badge-red p-3 rounded-lg text-sm flex items-center gap-2">
          <AlertTriangle size={16} /> {urgent.length} urgent UIDs require immediate attention
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Queue list */}
        <div className="card overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
            <h2 className="font-medium text-gray-700">Queue ({ordered.length})</h2>
          </div>
          <div className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
            {ordered.map((u) => (
              <button
                key={u.id}
                onClick={() => setSelectedUID(u)}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${selectedUID?.id === u.id ? 'bg-brand-50 border-l-2 border-brand-500' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-gray-900">{u.code}</span>
                    <PriorityBadge priority={u.priority} />
                    <UIDStatusBadge status={u.status} />
                  </div>
                  <span className="text-xs text-gray-400">{u.factory_location_code}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Step {u.current_step_number} — {u.current_step_name}
                  {u.current_storage_code && <> · <span className="font-mono">{u.current_storage_code}</span></>}
                </div>
                {u.current_step_name?.toLowerCase().includes('converting') && (
                  <div className="text-xs text-orange-600 mt-0.5">⚠ Converting step — supervisor action required</div>
                )}
              </button>
            ))}
            {ordered.length === 0 && (
              <div className="px-4 py-8 text-center text-gray-400">Queue is empty</div>
            )}
          </div>
        </div>

        {/* Complete step panel */}
        {selectedUID && (
          <div className="card p-5 space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-bold text-gray-900 font-mono text-xl">{selectedUID.code}</h2>
                <PriorityBadge priority={selectedUID.priority} />
              </div>
              <p className="text-sm text-gray-600">
                Step <strong>{selectedUID.current_step_number}</strong> — {selectedUID.current_step_name}
              </p>
              {selectedUID.current_storage_code && (
                <p className="text-xs text-gray-500">Current storage: <span className="font-mono">{selectedUID.current_storage_code}</span></p>
              )}
              {!selectedUID.design_confirmed && (
                <div className="mt-2 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                  ⚠ Design not confirmed — manager must confirm before Step 16
                </div>
              )}
            </div>

            <div>
              <label className="label">Workstation</label>
              <select className="input" value={selectedWS ?? ''} onChange={(e) => setSelectedWS(Number(e.target.value))}>
                <option value="">Select workstation…</option>
                {workstations.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </div>

            <div>
              <label className="label">QC Result</label>
              <select className="input" value={qcResult} onChange={(e) => setQCResult(e.target.value)}>
                <option value="na">N/A</option>
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
              </select>
            </div>

            <div>
              <label className="label">Notes</label>
              <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" />
            </div>

            {completeStep.error && <p className="text-sm text-red-600">Failed to complete step</p>}

            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setSelectedUID(null)}>Cancel</button>
              <button
                className="btn-primary flex-1"
                disabled={!selectedWS || completeStep.isPending || selectedUID.status !== 'active'}
                onClick={() => completeStep.mutate({ uid_id: selectedUID.id, workstation_id: selectedWS! })}
              >
                <CheckCircle size={16} />
                {completeStep.isPending ? 'Saving…' : 'Mark Complete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
