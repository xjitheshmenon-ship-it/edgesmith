import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { factoryApi, productApi } from '../api/client'
import type { Workstation, StorageLocation, Size, Design, FactoryLocation } from '../types'
import { Plus } from 'lucide-react'

type Tab = 'workstations' | 'storage' | 'sizes' | 'designs'

const TH: React.CSSProperties = { padding: '10px 16px', textAlign: 'left', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--ink-2)', fontWeight: 500, background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }
const TD: React.CSSProperties = { padding: '11px 16px', fontSize: 13, color: 'var(--ink)', borderBottom: '1px solid var(--line)' }

export default function Config() {
  const [tab, setTab] = useState<Tab>('workstations')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'workstations', label: 'Workstations' },
    { key: 'storage', label: 'Storage Locations' },
    { key: 'sizes', label: 'Sizes' },
    { key: 'designs', label: 'Designs' },
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
