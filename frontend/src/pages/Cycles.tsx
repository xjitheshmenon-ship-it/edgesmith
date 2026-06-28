import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cycleApi } from '../api/client'
import type { CycleType, CycleStep } from '../types'
import { ChevronRight, Download, Upload } from 'lucide-react'
import { format } from 'date-fns'

const TH: React.CSSProperties = { padding: '8px 16px', textAlign: 'left', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--ink-2)', fontWeight: 500, background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }
const TD: React.CSSProperties = { padding: '9px 16px', fontSize: 13, color: 'var(--ink)', borderBottom: '1px solid var(--line)' }

export default function Cycles() {
  const [selected, setSelected] = useState<CycleType | null>(null)
  const { data: cycles = [] } = useQuery<CycleType[]>({
    queryKey: ['cycles'],
    queryFn: () => cycleApi.list().then((r) => r.data),
  })

  return (
    <div style={{ padding: '24px 28px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--ink)' }}>Production Cycles</div>
        <label className="btn-secondary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Upload size={15} /> Import
          <input type="file" style={{ display: 'none' }} accept=".json" onChange={(e) => {
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20 }}>
        {/* Cycle list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cycles.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              style={{
                width: '100%',
                background: selected?.id === c.id ? 'var(--surface-2)' : 'var(--surface)',
                border: `1px solid ${selected?.id === c.id ? 'var(--accent)' : 'var(--line)'}`,
                borderRadius: 12,
                padding: '14px 16px',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'border-color 0.12s, background 0.12s',
              }}
              onMouseEnter={e => { if (selected?.id !== c.id) (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)' }}
              onMouseLeave={e => { if (selected?.id !== c.id) (e.currentTarget as HTMLElement).style.background = 'var(--surface)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 34, height: 34, background: 'var(--accent-dim)', color: 'var(--accent)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 14 }}>
                  {c.letter_prefix}
                </span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{c.name}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-2)', marginTop: 2 }}>{c.current_version?.steps.length ?? 0} steps · v{c.version_count}</div>
                </div>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
            </button>
          ))}
        </div>

        {/* Step table */}
        {selected?.current_version && (
          <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{selected.name} — v{selected.current_version.version_number}</div>
                {selected.current_version.change_notes && (
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-2)', marginTop: 2 }}>{selected.current_version.change_notes}</div>
                )}
              </div>
              <button
                className="btn-secondary"
                style={{ fontSize: 12 }}
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
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={TH}>Step</th>
                    <th style={TH}>Operation</th>
                    <th style={TH}>Workstation</th>
                    <th style={TH}>From</th>
                    <th style={TH}>To</th>
                    <th style={TH}>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.current_version.steps.map((s: CycleStep) => (
                    <tr key={s.id}
                      style={{ background: s.is_converting_step ? 'rgba(251,146,60,.1)' : s.is_qc_step ? 'rgba(34,160,107,.08)' : 'transparent' }}
                      onMouseEnter={e => { if (!s.is_converting_step && !s.is_qc_step) (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)' }}
                      onMouseLeave={e => { if (!s.is_converting_step && !s.is_qc_step) (e.currentTarget as HTMLElement).style.background = '' }}
                    >
                      <td style={{ ...TD, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{s.step_number}</td>
                      <td style={TD}>{s.operation_name}</td>
                      <td style={{ ...TD, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--ink-2)' }}>{s.workstation_code}</td>
                      <td style={{ ...TD, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--ink-3)' }}>{s.from_storage_code ?? '—'}</td>
                      <td style={{ ...TD, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--ink-3)' }}>{s.to_storage_code ?? '—'}</td>
                      <td style={{ ...TD, display: 'flex', gap: 4 }}>
                        {s.is_converting_step && <span className="badge-orange">Convert</span>}
                        {s.is_child_marking_step && <span className="badge-blue">Child Mark</span>}
                        {s.is_qc_step && <span className="badge-green">QC</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

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
    <div style={{ padding: '14px 20px', borderTop: '1px solid var(--line)' }}>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 10 }}>Version History</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {versions.map((v: { id: number; version_number: number; is_current: boolean; created_at: string; change_notes: string | null; steps: CycleStep[] }) => (
          <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: 'var(--ink)', minWidth: 36 }}>v{v.version_number}</span>
            {v.is_current && <span className="badge-green" style={{ fontSize: 11 }}>Current</span>}
            <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{v.steps.length} steps</span>
            <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{format(new Date(v.created_at), 'dd MMM yyyy')}</span>
            {v.change_notes && <span style={{ color: 'var(--ink-3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.change_notes}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
