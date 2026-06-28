import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { cycleApi } from '../api/client'
import type { CycleType, CycleStep } from '../types'
import { ChevronRight, Download, Upload, Plus } from 'lucide-react'
import { format } from 'date-fns'

export default function Cycles() {
  const [selected, setSelected] = useState<CycleType | null>(null)
  const { data: cycles = [] } = useQuery<CycleType[]>({
    queryKey: ['cycles'],
    queryFn: () => cycleApi.list().then((r) => r.data),
  })

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Production Cycles</h1>
        <div className="flex gap-2">
          <label className="btn-secondary cursor-pointer">
            <Upload size={15} /> Import
            <input type="file" className="hidden" accept=".json" onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = async (ev) => {
                try {
                  const data = JSON.parse(ev.target?.result as string)
                  await cycleApi.import({ data, update_existing: false })
                  alert('Cycle imported successfully')
                } catch { alert('Import failed') }
              }
              reader.readAsText(file)
            }} />
          </label>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Cycle list */}
        <div className="space-y-3">
          {cycles.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className={`w-full card p-4 text-left hover:shadow-md transition-shadow ${selected?.id === c.id ? 'border-brand-400 shadow-md' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 bg-brand-100 text-brand-700 rounded-lg flex items-center justify-center font-bold text-sm">
                    {c.letter_prefix}
                  </span>
                  <div>
                    <div className="font-semibold text-gray-900">{c.name}</div>
                    <div className="text-xs text-gray-400">{c.current_version?.steps.length ?? 0} steps · v{c.version_count}</div>
                  </div>
                </div>
                <ChevronRight size={16} className="text-gray-400" />
              </div>
            </button>
          ))}
        </div>

        {/* Step table */}
        {selected?.current_version && (
          <div className="lg:col-span-2 card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">{selected.name} — v{selected.current_version.version_number}</h2>
                {selected.current_version.change_notes && (
                  <p className="text-xs text-gray-400">{selected.current_version.change_notes}</p>
                )}
              </div>
              <button
                className="btn-secondary text-xs"
                onClick={async () => {
                  const { data } = await cycleApi.export(selected.id)
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url; a.download = `cycle_${selected.name}_v${selected.current_version!.version_number}.json`
                  a.click()
                }}
              >
                <Download size={14} /> Export JSON
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Step</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Operation</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Workstation</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">From</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">To</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selected.current_version.steps.map((s: CycleStep) => (
                    <tr key={s.id} className={s.is_converting_step ? 'bg-orange-50' : s.is_qc_step ? 'bg-green-50' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-2 font-mono font-medium">{s.step_number}</td>
                      <td className="px-4 py-2">{s.operation_name}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-700">{s.workstation_code}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-500">{s.from_storage_code ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-500">{s.to_storage_code ?? '—'}</td>
                      <td className="px-4 py-2 text-xs space-x-1">
                        {s.is_converting_step && <span className="badge-orange">Convert</span>}
                        {s.is_child_marking_step && <span className="badge-blue">Child Mark</span>}
                        {s.is_qc_step && <span className="badge-green">QC</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Version history */}
            <VersionHistory cycleId={selected.id} />
          </div>
        )}
      </div>
    </div>
  )
}

function VersionHistory({ cycleId }: { cycleId: number }) {
  const { data: versions = [] } = useQuery({
    queryKey: ['cycle-versions', cycleId],
    queryFn: () => cycleApi.versions(cycleId).then((r) => r.data),
  })

  if (versions.length <= 1) return null

  return (
    <div className="px-5 py-4 border-t border-gray-100">
      <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Version History</h3>
      <div className="space-y-1">
        {versions.map((v: { id: number; version_number: number; is_current: boolean; created_at: string; change_notes: string | null; steps: CycleStep[] }) => (
          <div key={v.id} className="flex items-center gap-3 text-sm">
            <span className="font-medium w-10">v{v.version_number}</span>
            {v.is_current && <span className="badge-green text-xs">Current</span>}
            <span className="text-gray-500 text-xs">{v.steps.length} steps</span>
            <span className="text-gray-400 text-xs">{format(new Date(v.created_at), 'dd MMM yyyy')}</span>
            {v.change_notes && <span className="text-gray-400 text-xs truncate">{v.change_notes}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
