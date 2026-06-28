import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { factoryApi, productApi } from '../api/client'
import type { Workstation, StorageLocation, Size, Design, FactoryLocation } from '../types'
import { Plus } from 'lucide-react'

type Tab = 'workstations' | 'storage' | 'sizes' | 'designs'

export default function Config() {
  const [tab, setTab] = useState<Tab>('workstations')
  const qc = useQueryClient()

  const tabs: { key: Tab; label: string }[] = [
    { key: 'workstations', label: 'Workstations' },
    { key: 'storage', label: 'Storage Locations' },
    { key: 'sizes', label: 'Sizes' },
    { key: 'designs', label: 'Designs' },
  ]

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">System Configuration</h1>

      <div className="flex border-b border-gray-200">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Add Workstation</button>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr><th className="px-4 py-3 text-left font-medium text-gray-600">Code</th><th className="px-4 py-3 text-left font-medium text-gray-600">Name</th><th className="px-4 py-3 text-left font-medium text-gray-600">Category</th><th className="px-4 py-3 text-left font-medium text-gray-600">Location</th><th className="px-4 py-3"></th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ws.map((w) => (
              <tr key={w.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono font-medium">{w.code}</td>
                <td className="px-4 py-3">{w.name}</td>
                <td className="px-4 py-3 text-xs"><span className="badge-blue">{w.category}</span></td>
                <td className="px-4 py-3 text-xs text-gray-400">{w.factory_location_id ? `Location ${w.factory_location_id}` : 'All locations'}</td>
                <td className="px-4 py-3 text-right"><button className="text-xs text-red-500 hover:text-red-700" onClick={() => archive.mutate(w.id)}>Archive</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
            <h2 className="font-semibold text-gray-900">Add Workstation</h2>
            <div><label className="label">Code</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label">Category</label><select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="label">Location (leave blank for both)</label><select className="input" value={form.factory_location_id} onChange={(e) => setForm({ ...form, factory_location_id: e.target.value })}><option value="">All locations</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <div className="flex gap-3 justify-end">
              <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate({ ...form, factory_location_id: form.factory_location_id ? Number(form.factory_location_id) : null })}>Add</button>
            </div>
          </div>
        </div>
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
    <div className="space-y-4">
      <div className="flex justify-end"><button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Add Storage Location</button></div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200"><tr><th className="px-4 py-3 text-left font-medium text-gray-600">Code</th><th className="px-4 py-3 text-left font-medium text-gray-600">Name</th><th className="px-4 py-3 text-left font-medium text-gray-600">Location</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {storage.map((s) => (<tr key={s.id} className="hover:bg-gray-50"><td className="px-4 py-3 font-mono font-medium">{s.code}</td><td className="px-4 py-3">{s.name}</td><td className="px-4 py-3 text-xs text-gray-400">{s.factory_location_id ? `Location ${s.factory_location_id}` : 'All'}</td></tr>))}
          </tbody>
        </table>
      </div>
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <h2 className="font-semibold text-gray-900">Add Storage Location</h2>
            <div><label className="label">Code</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label">Factory Location</label><select className="input" value={form.factory_location_id} onChange={(e) => setForm({ ...form, factory_location_id: e.target.value })}><option value="">All</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <div className="flex gap-3 justify-end"><button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button><button className="btn-primary" onClick={() => create.mutate({ ...form, factory_location_id: form.factory_location_id ? Number(form.factory_location_id) : null })}>Add</button></div>
          </div>
        </div>
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
    <div className="space-y-4 max-w-sm">
      <div className="flex gap-2">
        <input className="input" placeholder="Size in mm" type="number" value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="btn-primary" onClick={() => create.mutate({ value_mm: Number(value) })}><Plus size={15} /> Add</button>
      </div>
      <div className="card divide-y divide-gray-100">
        {sizes.map((s) => (<div key={s.id} className="px-4 py-3 flex justify-between text-sm"><span className="font-medium">{s.value_mm}mm</span><span className="badge-green">active</span></div>))}
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
    <div className="space-y-4">
      <div className="flex justify-end"><button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Add Design</button></div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200"><tr><th className="px-4 py-3 text-left font-medium text-gray-600">Code</th><th className="px-4 py-3 text-left font-medium text-gray-600">Description</th><th className="px-4 py-3 text-left font-medium text-gray-600">Valid Sizes</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {designs.map((d) => (<tr key={d.id} className="hover:bg-gray-50"><td className="px-4 py-3 font-medium">{d.code}</td><td className="px-4 py-3 text-gray-500">{d.description}</td><td className="px-4 py-3 text-xs">{d.valid_sizes_mm.join('mm, ')}mm</td></tr>))}
          </tbody>
        </table>
      </div>
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
            <h2 className="font-semibold text-gray-900">Add Design</h2>
            <div><label className="label">Code / Drawing Number</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div><label className="label">Description</label><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div>
              <label className="label">Valid Sizes</label>
              <div className="space-y-2">
                {sizes.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={form.valid_size_ids.includes(s.id)} onChange={(e) => setForm({ ...form, valid_size_ids: e.target.checked ? [...form.valid_size_ids, s.id] : form.valid_size_ids.filter((id) => id !== s.id) })} />
                    {s.value_mm}mm
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-3 justify-end"><button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button><button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate(form)}>Add Design</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
