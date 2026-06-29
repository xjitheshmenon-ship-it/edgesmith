import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { factoryApi, productApi, cycleApi } from '../api/client'
import type { Workstation, StorageLocation, Size, Design, FactoryLocation, CycleType, CycleStep } from '../types'
import { Plus, Download, Upload, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'

type Tab = 'workstations' | 'storage' | 'sizes' | 'designs' | 'cycles'

const TH: React.CSSProperties = { padding: '10px 16px', textAlign: 'left', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--ink-2)', fontWeight: 500, background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }
const TD: React.CSSProperties = { padding: '11px 16px', fontSize: 13, color: 'var(--ink)', borderBottom: '1px solid var(--line)' }

export default function Config() {
  const [tab, setTab] = useState<Tab>('workstations')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'workstations', label: 'Workstations' },
    { key: 'storage', label: 'Storage Locations' },
    { key: 'sizes', label: 'Sizes' },
    { key: 'designs', label: 'Designs' },
    { key: 'cycles', label: 'Production Cycles' },
  ]

  return (
    <div style={{ padding: '24px 28px 60px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--ink)' }}>System Configuration</div>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', marginBottom: 20 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: 500,
              background: 'none',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t.key ? 'var(--accent)' : 'var(--ink-2)',
              cursor: 'pointer',
              marginBottom: -1,
              transition: 'color 0.12s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'workstations' && <WorkstationsConfig />}
      {tab === 'storage' && <StorageConfig />}
      {tab === 'sizes' && <SizesConfig />}
      {tab === 'designs' && <DesignsConfig />}
      {tab === 'cycles' && <CyclesConfig />}
    </div>
  )
}

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div className="card" style={{ width: '100%', maxWidth: 440, padding: '24px 24px 20px' }}>
        {children}
      </div>
    </div>
  )
}

function WorkstationsConfig() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ code: '', name: '', category: 'Other', factory_location_id: '' })
  const { data: ws = [] } = useQuery<Workstation[]>({ queryKey: ['workstations'], queryFn: () => factoryApi.workstations().then((r) => r.data) })
  const { data: locs = [] } = useQuery<FactoryLocation[]>({ queryKey: ['locations'], queryFn: () => factoryApi.locations().then((r) => r.data) })

  const create = useMutation({
    mutationFn: (data: Record<string, unknown>) => factoryApi.createWorkstation(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workstations'] }); setShowCreate(false); setForm({ code: '', name: '', category: 'Other', factory_location_id: '' }) },
  })
  const archive = useMutation({
    mutationFn: (id: number) => factoryApi.updateWorkstation(id, { is_active: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workstations'] }),
  })

  const CATEGORIES = ['Cutting', 'Heat Treatment', 'Machining', 'Grinding', 'Coating', 'QC', 'Packing', 'Other']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Add Workstation</button>
      </div>
      <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={TH}>Code</th>
              <th style={TH}>Name</th>
              <th style={TH}>Category</th>
              <th style={TH}>Location</th>
              <th style={{ ...TH, textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {ws.map((w) => (
              <tr key={w.id}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
              >
                <td style={{ ...TD, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{w.code}</td>
                <td style={TD}>{w.name}</td>
                <td style={TD}><span className="badge-blue">{w.category}</span></td>
                <td style={{ ...TD, color: 'var(--ink-2)' }}>{w.factory_location_id ? `Location ${w.factory_location_id}` : 'All locations'}</td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  <button style={{ fontSize: 12, color: 'var(--error)', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => archive.mutate(w.id)}>Archive</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal>
          <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)', marginBottom: 16 }}>Add Workstation</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label className="label">Code</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label">Category</label><select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="label">Location (blank = both)</label><select className="input" value={form.factory_location_id} onChange={(e) => setForm({ ...form, factory_location_id: e.target.value })}><option value="">All locations</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate({ ...form, factory_location_id: form.factory_location_id ? Number(form.factory_location_id) : null })}>Add</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function StorageConfig() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ code: '', name: '', factory_location_id: '' })
  const { data: storage = [] } = useQuery<StorageLocation[]>({ queryKey: ['storage'], queryFn: () => factoryApi.storage().then((r) => r.data) })
  const { data: locs = [] } = useQuery<FactoryLocation[]>({ queryKey: ['locations'], queryFn: () => factoryApi.locations().then((r) => r.data) })
  const create = useMutation({
    mutationFn: (data: Record<string, unknown>) => factoryApi.createStorage(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['storage'] }); setShowCreate(false) },
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Add Storage Location</button>
      </div>
      <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={TH}>Code</th>
              <th style={TH}>Name</th>
              <th style={TH}>Location</th>
            </tr>
          </thead>
          <tbody>
            {storage.map((s) => (
              <tr key={s.id}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
              >
                <td style={{ ...TD, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{s.code}</td>
                <td style={TD}>{s.name}</td>
                <td style={{ ...TD, color: 'var(--ink-2)' }}>{s.factory_location_id ? `Location ${s.factory_location_id}` : 'All'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showCreate && (
        <Modal>
          <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)', marginBottom: 16 }}>Add Storage Location</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label className="label">Code</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label">Factory Location</label><select className="input" value={form.factory_location_id} onChange={(e) => setForm({ ...form, factory_location_id: e.target.value })}><option value="">All</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => create.mutate({ ...form, factory_location_id: form.factory_location_id ? Number(form.factory_location_id) : null })}>Add</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function SizesConfig() {
  const qc = useQueryClient()
  const [value, setValue] = useState('')
  const { data: sizes = [] } = useQuery<Size[]>({ queryKey: ['sizes'], queryFn: () => productApi.sizes().then((r) => r.data) })
  const create = useMutation({
    mutationFn: (data: Record<string, unknown>) => productApi.createSize(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sizes'] }); setValue('') },
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 360 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <input className="input" placeholder="Size in mm" type="number" value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="btn-primary" onClick={() => create.mutate({ value_mm: Number(value) })}><Plus size={15} /> Add</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {sizes.map((s) => (
          <div key={s.id} style={{ padding: '11px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, borderBottom: '1px solid var(--line)' }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: 'var(--ink)' }}>{s.value_mm}mm</span>
            <span className="badge-green">active</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CycleVersionHistory({ cycleId }: { cycleId: number }) {
  const { data: versions = [] } = useQuery({
    queryKey: ['cycle-versions', cycleId],
    queryFn: () => cycleApi.versions(cycleId).then((r) => r.data),
  })
  if (versions.length <= 1) return null
  return (
    <div style={{ padding: '14px 18px', borderTop: '1px solid var(--line)' }}>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 10 }}>Version History</div>
      {versions.map((v: any) => (
        <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, marginBottom: 5 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: 'var(--ink)', minWidth: 36 }}>v{v.version_number}</span>
          {v.is_current && <span className="badge-green" style={{ fontSize: 11 }}>Current</span>}
          <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{v.steps.length} steps</span>
          <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{format(new Date(v.created_at), 'dd MMM yyyy')}</span>
        </div>
      ))}
    </div>
  )
}

function CyclesConfig() {
  const [selected, setSelected] = useState<CycleType | null>(null)
  const { data: cycles = [] } = useQuery<CycleType[]>({
    queryKey: ['cycles'],
    queryFn: () => cycleApi.list().then((r) => r.data),
  })

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label className="btn-secondary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, justifyContent: 'center' }}>
          <Upload size={14} /> Import Cycle
          <input type="file" style={{ display: 'none' }} accept=".json" onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = async (ev) => {
              try { await cycleApi.import({ data: JSON.parse(ev.target?.result as string), update_existing: false }); alert('Imported') }
              catch { alert('Import failed') }
            }
            reader.readAsText(file)
          }} />
        </label>
        {cycles.map((c) => (
          <button key={c.id} onClick={() => setSelected(c)} style={{
            width: '100%', textAlign: 'left', cursor: 'pointer', padding: '11px 14px', borderRadius: 10,
            background: selected?.id === c.id ? 'var(--surface-2)' : 'var(--surface)',
            border: `1px solid ${selected?.id === c.id ? 'var(--accent)' : 'var(--line)'}`,
            display: 'flex', alignItems: 'center', gap: 10, transition: 'all .12s',
          }}
            onMouseEnter={e => { if (selected?.id !== c.id) (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)' }}
            onMouseLeave={e => { if (selected?.id !== c.id) (e.currentTarget as HTMLElement).style.background = 'var(--surface)' }}
          >
            <span style={{ width: 30, height: 30, background: 'var(--accent-dim)', color: 'var(--accent)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{c.letter_prefix}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{c.name}</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--ink-2)', marginTop: 1 }}>{c.current_version?.steps.length ?? 0} steps · v{c.version_count}</div>
            </div>
            <ChevronRight size={14} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
          </button>
        ))}
      </div>

      {selected?.current_version ? (
        <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
          <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{selected.name} — v{selected.current_version.version_number}</div>
              {selected.current_version.change_notes && <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-2)', marginTop: 2 }}>{selected.current_version.change_notes}</div>}
            </div>
            <button className="btn-secondary" style={{ fontSize: 12 }} onClick={async () => {
              const { data } = await cycleApi.export(selected.id)
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a'); a.href = url; a.download = `cycle_${selected.name}_v${selected.current_version!.version_number}.json`; a.click()
            }}><Download size={14} /> Export JSON</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>
                <th style={TH}>Step</th><th style={TH}>Operation</th><th style={TH}>Workstation</th>
                <th style={TH}>From</th><th style={TH}>To</th><th style={TH}>Flags</th>
              </tr></thead>
              <tbody>
                {selected.current_version.steps.map((s: CycleStep) => (
                  <tr key={s.id} style={{ background: s.is_converting_step ? 'rgba(251,146,60,.1)' : s.is_qc_step ? 'rgba(34,160,107,.08)' : '' }}>
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
          <CycleVersionHistory cycleId={selected.id} />
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
          Select a cycle to view steps
        </div>
      )}
    </div>
  )
}

function DesignsConfig() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ code: '', description: '', valid_size_ids: [] as number[] })
  const { data: designs = [] } = useQuery<Design[]>({ queryKey: ['designs'], queryFn: () => productApi.designs().then((r) => r.data) })
  const { data: sizes = [] } = useQuery<Size[]>({ queryKey: ['sizes'], queryFn: () => productApi.sizes().then((r) => r.data) })
  const create = useMutation({
    mutationFn: (data: Record<string, unknown>) => productApi.createDesign(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['designs'] }); setShowCreate(false) },
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Add Design</button>
      </div>
      <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={TH}>Code</th>
              <th style={TH}>Description</th>
              <th style={TH}>Valid Sizes</th>
            </tr>
          </thead>
          <tbody>
            {designs.map((d) => (
              <tr key={d.id}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
              >
                <td style={{ ...TD, fontWeight: 600 }}>{d.code}</td>
                <td style={{ ...TD, color: 'var(--ink-2)' }}>{d.description}</td>
                <td style={TD}>{d.valid_sizes_mm.join('mm, ')}mm</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showCreate && (
        <Modal>
          <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)', marginBottom: 16 }}>Add Design</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label className="label">Code / Drawing Number</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div><label className="label">Description</label><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div>
              <label className="label">Valid Sizes</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                {sizes.map((s) => (
                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.valid_size_ids.includes(s.id)} onChange={(e) => setForm({ ...form, valid_size_ids: e.target.checked ? [...form.valid_size_ids, s.id] : form.valid_size_ids.filter((id) => id !== s.id) })} />
                    {s.value_mm}mm
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate(form)}>Add Design</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
