import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { productApi, factoryApi, faridabadApi } from '../api/client'
import type { Workstation, StorageLocation, Size, Design, FactoryLocation, CycleType } from '../types'
import { cycleApi } from '../api/client'
import {
  Cpu, Package, Ruler, PencilRuler, Boxes, HardHat, Plus, Search,
  Grid3x3, Check, X, AlertTriangle, Lock,
} from 'lucide-react'

/* ─── design tokens (local mirrors, matching Dashboard/ProductionFloor) ─────── */
const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"
const C = {
  ink: 'var(--ink)',
  ink2: 'var(--ink-2)',
  ink3: 'var(--ink-3)',
  accent: 'var(--accent)',
  line: 'var(--line)',
  surface: 'var(--surface)',
  surface2: 'var(--surface-2)',
  surface3: 'var(--surface-3)',
  red: '#e5484d',
  green: '#22a06b',
}

type Entity = 'workstations' | 'products' | 'sizes' | 'designs' | 'storage' | 'contractors'

const ENTITIES: { key: Entity; label: string; icon: React.ReactNode; sub: string }[] = [
  { key: 'workstations', label: 'Workstations', icon: <Cpu size={15} />, sub: 'Stations & categories' },
  { key: 'products', label: 'Products', icon: <Package size={15} />, sub: 'Types & cycles' },
  { key: 'sizes', label: 'Sizes', icon: <Ruler size={15} />, sub: 'Diameters (mm)' },
  { key: 'designs', label: 'Designs', icon: <PencilRuler size={15} />, sub: 'Drawings & valid sizes' },
  { key: 'storage', label: 'Storage Locations', icon: <Boxes size={15} />, sub: 'WIP buffer codes' },
  { key: 'contractors', label: 'Rolling Contractors', icon: <HardHat size={15} />, sub: 'Faridabad rolling' },
]

/* ─── shared table styles ───────────────────────────────────────────────────── */
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '10px 16px', fontFamily: MONO, fontSize: 10,
  letterSpacing: '0.12em', textTransform: 'uppercase', color: C.ink2, fontWeight: 600,
  borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  padding: '13px 16px', borderBottom: `1px solid ${C.line}`, fontSize: 13, color: C.ink, verticalAlign: 'middle',
}
const MONO_CELL: React.CSSProperties = { ...TD, fontFamily: MONO, fontWeight: 600 }

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: C.ink3, textTransform: 'uppercase' }}>
      {children}
    </span>
  )
}

/* ─── modal (mirrors Config.tsx) ────────────────────────────────────────────── */
function Modal({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,48,95,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div className="card animate-es" style={{ width: '100%', maxWidth: 460, padding: '24px 24px 20px', boxShadow: 'var(--shadow-e4)' }}>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em', color: C.ink, marginBottom: 16 }}>{title}</div>
        {children}
      </div>
    </div>
  )
}

function FormActions({ onCancel, onSubmit, submitLabel, disabled }: { onCancel: () => void; onSubmit: () => void; submitLabel: string; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
      <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      <button className="btn-primary" disabled={disabled} onClick={onSubmit}>{submitLabel}</button>
    </div>
  )
}

/* ─── reusable card wrapper for each entity panel ───────────────────────────── */
function PanelHeader({ title, count, onAdd, addLabel, search, onSearch, note }: {
  title: string; count: number; onAdd?: () => void; addLabel?: string
  search?: string; onSearch?: (v: string) => void; note?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
      <div>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 22, letterSpacing: '-0.03em', color: C.ink }}>{title}</div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, marginTop: 2 }}>
          {count} {count === 1 ? 'record' : 'records'}{note ? ` · ${note}` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {onSearch && (
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: C.ink3 }} />
            <input className="input" style={{ width: 200, paddingLeft: 32 }} placeholder="Search…" value={search ?? ''} onChange={(e) => onSearch(e.target.value)} />
          </div>
        )}
        {onAdd && <button className="btn-primary" onClick={onAdd}><Plus size={15} /> {addLabel}</button>}
      </div>
    </div>
  )
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ ...TD, textAlign: 'center', color: C.ink3, fontFamily: MONO, fontSize: 12, padding: '32px 16px', borderBottom: 'none' }}>
        {children}
      </td>
    </tr>
  )
}

function StateNote({ kind, children }: { kind: 'loading' | 'error'; children: React.ReactNode }) {
  if (kind === 'error') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 10, marginBottom: 16, background: 'rgba(229,72,77,.10)', border: '1px solid rgba(229,72,77,.25)', color: C.red, fontFamily: MONO, fontSize: 12 }}>
        <AlertTriangle size={14} /> {children}
      </div>
    )
  }
  return <div style={{ fontFamily: MONO, fontSize: 12, color: C.ink3, padding: '20px 4px' }}>{children}</div>
}

/* ───────────────────────────────────────────────────────────────────────────
   WORKSTATIONS — code, name, category, location, status. Add / archive.
   ─────────────────────────────────────────────────────────────────────────── */
const WS_CATEGORIES = ['Cutting', 'Heat Treatment', 'Machining', 'Grinding', 'Coating', 'QC', 'Packing', 'Other']

function WorkstationsPanel() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ code: '', name: '', category: 'Other', factory_location_id: '' })

  const wsQ = useQuery<Workstation[]>({ queryKey: ['ml-workstations'], queryFn: () => factoryApi.workstations().then((r) => r.data) })
  const locsQ = useQuery<FactoryLocation[]>({ queryKey: ['ml-locations'], queryFn: () => factoryApi.locations().then((r) => r.data) })
  const locs = locsQ.data ?? []

  const create = useMutation({
    mutationFn: (data: Record<string, unknown>) => factoryApi.createWorkstation(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ml-workstations'] }); setShowCreate(false); setForm({ code: '', name: '', category: 'Other', factory_location_id: '' }) },
  })
  const archive = useMutation({
    mutationFn: (id: number) => factoryApi.updateWorkstation(id, { is_active: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ml-workstations'] }),
  })

  const rows = useMemo(() => {
    const list = wsQ.data ?? []
    const t = search.trim().toLowerCase()
    if (!t) return list
    return list.filter((w: any) => `${w.code} ${w.name} ${w.category}`.toLowerCase().includes(t))
  }, [wsQ.data, search])

  const locName = (id: number | null) => (id ? (locs.find((l) => l.id === id)?.name ?? `Location ${id}`) : 'Both locations')

  return (
    <div>
      <PanelHeader title="Workstations" count={(wsQ.data ?? []).length} onAdd={() => setShowCreate(true)} addLabel="Add Workstation" search={search} onSearch={setSearch} note="archive blocked if UIDs are at the station" />
      {wsQ.isError && <StateNote kind="error">Could not load workstations — the server may be starting up.</StateNote>}
      <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={TH}>Code</th><th style={TH}>Name</th><th style={TH}>Category</th>
            <th style={TH}>Location</th><th style={TH}>Status</th><th style={{ ...TH, textAlign: 'right' }} />
          </tr></thead>
          <tbody>
            {wsQ.isLoading ? (
              <EmptyRow colSpan={6}>Loading workstations…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={6}>{search ? 'No workstations match your search.' : 'No workstations configured.'}</EmptyRow>
            ) : rows.map((w: any) => (
              <tr key={w.id} className="row-hover">
                <td style={MONO_CELL}>{w.code}</td>
                <td style={TD}>{w.name}</td>
                <td style={TD}><span className="badge-blue">{w.category}</span></td>
                <td style={{ ...TD, color: C.ink2 }}>{locName(w.factory_location_id)}</td>
                <td style={TD}>{w.is_active === false ? <span className="badge-gray">archived</span> : <span className="badge-green">active</span>}</td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  {w.is_active !== false && (
                    <button style={{ fontFamily: MONO, fontSize: 11, color: C.red, background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.04em' }}
                      disabled={archive.isPending} onClick={() => archive.mutate(w.id)}>Archive</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title="Add Workstation">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label className="label">Code</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. HT90" autoFocus /></div>
            <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label">Category</label><select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{WS_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="label">Location (blank = both)</label><select className="input" value={form.factory_location_id} onChange={(e) => setForm({ ...form, factory_location_id: e.target.value })}><option value="">Both locations</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <FormActions onCancel={() => setShowCreate(false)} submitLabel={create.isPending ? 'Adding…' : 'Add'} disabled={create.isPending || !form.code || !form.name}
              onSubmit={() => create.mutate({ ...form, factory_location_id: form.factory_location_id ? Number(form.factory_location_id) : null })} />
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   PRODUCTS — name, code, valid cycle types, default cycle type, status.
   ─────────────────────────────────────────────────────────────────────────── */
function ProductsPanel() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ code: '', name: '', valid_cycle_type_ids: [] as number[], default_cycle_type_id: '' })

  const prodQ = useQuery({ queryKey: ['ml-product-types'], queryFn: () => productApi.types().then((r) => r.data) })
  const cyclesQ = useQuery<CycleType[]>({ queryKey: ['ml-cycles'], queryFn: () => cycleApi.list().then((r) => r.data) })
  const cycles = cyclesQ.data ?? []

  const create = useMutation({
    mutationFn: () => productApi.createType({
      code: form.code, name: form.name,
      valid_cycle_type_ids: form.valid_cycle_type_ids,
      default_cycle_type_id: form.default_cycle_type_id ? Number(form.default_cycle_type_id) : null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ml-product-types'] }); setShowCreate(false); setForm({ code: '', name: '', valid_cycle_type_ids: [], default_cycle_type_id: '' }) },
  })
  const archive = useMutation({
    mutationFn: (id: number) => productApi.archiveType(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ml-product-types'] }),
  })

  const rows = useMemo(() => {
    const list = (prodQ.data as any[]) ?? []
    const t = search.trim().toLowerCase()
    if (!t) return list
    return list.filter((p) => `${p.code} ${p.name}`.toLowerCase().includes(t))
  }, [prodQ.data, search])

  const cycleName = (id: number) => cycles.find((c) => c.id === id)?.name ?? `#${id}`

  return (
    <div>
      <PanelHeader title="Products" count={((prodQ.data as any[]) ?? []).length} onAdd={() => setShowCreate(true)} addLabel="Add Product" search={search} onSearch={setSearch} />
      {prodQ.isError && <StateNote kind="error">Could not load products — the server may be starting up.</StateNote>}
      <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={TH}>Code</th><th style={TH}>Name</th><th style={TH}>Valid Cycles</th>
            <th style={TH}>Default Cycle</th><th style={TH}>Status</th><th style={{ ...TH, textAlign: 'right' }} />
          </tr></thead>
          <tbody>
            {prodQ.isLoading ? (
              <EmptyRow colSpan={6}>Loading products…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={6}>{search ? 'No products match your search.' : 'No products configured.'}</EmptyRow>
            ) : rows.map((p: any) => (
              <tr key={p.id} className="row-hover">
                <td style={MONO_CELL}>{p.code}</td>
                <td style={TD}>{p.name}</td>
                <td style={TD}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(p.valid_cycle_type_ids ?? []).length === 0
                      ? <span style={{ color: C.ink3 }}>—</span>
                      : (p.valid_cycle_type_ids as number[]).map((id) => <span key={id} className="badge-blue">{cycleName(id)}</span>)}
                  </div>
                </td>
                <td style={{ ...TD, color: C.ink2 }}>{p.default_cycle_type_id ? cycleName(p.default_cycle_type_id) : '—'}</td>
                <td style={TD}>{p.is_active === false || p.is_archived ? <span className="badge-gray">archived</span> : <span className="badge-green">active</span>}</td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  {!(p.is_active === false || p.is_archived) && (
                    <button style={{ fontFamily: MONO, fontSize: 11, color: C.red, background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.04em' }}
                      disabled={archive.isPending} onClick={() => archive.mutate(p.id)}>Archive</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title="Add Product">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label className="label">Code</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. PROD-A" autoFocus /></div>
            <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div>
              <label className="label">Valid Cycle Types</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {cycles.length === 0 && <span style={{ fontFamily: MONO, fontSize: 11, color: C.ink3 }}>No cycle types defined.</span>}
                {cycles.map((c) => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.ink, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.valid_cycle_type_ids.includes(c.id)}
                      onChange={(e) => setForm({ ...form, valid_cycle_type_ids: e.target.checked ? [...form.valid_cycle_type_ids, c.id] : form.valid_cycle_type_ids.filter((id) => id !== c.id) })} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Default Cycle</label>
              <select className="input" value={form.default_cycle_type_id} onChange={(e) => setForm({ ...form, default_cycle_type_id: e.target.value })}>
                <option value="">None</option>
                {cycles.filter((c) => form.valid_cycle_type_ids.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <FormActions onCancel={() => setShowCreate(false)} submitLabel={create.isPending ? 'Adding…' : 'Add Product'} disabled={create.isPending || !form.code || !form.name} onSubmit={() => create.mutate()} />
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   SIZES — size in mm, status. Add.
   ─────────────────────────────────────────────────────────────────────────── */
function SizesPanel() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [value, setValue] = useState('')

  const sizesQ = useQuery<Size[]>({ queryKey: ['ml-sizes'], queryFn: () => productApi.sizes().then((r) => r.data) })
  const create = useMutation({
    mutationFn: () => productApi.createSize({ value_mm: Number(value) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ml-sizes'] }); setShowCreate(false); setValue('') },
  })

  const rows = useMemo(() => [...(sizesQ.data ?? [])].sort((a, b) => a.value_mm - b.value_mm), [sizesQ.data])

  return (
    <div>
      <PanelHeader title="Sizes" count={(sizesQ.data ?? []).length} onAdd={() => setShowCreate(true)} addLabel="Add Size" note="diameter in millimetres" />
      {sizesQ.isError && <StateNote kind="error">Could not load sizes — the server may be starting up.</StateNote>}
      <div className="card" style={{ overflow: 'hidden', padding: 0, maxWidth: 520 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={TH}>Size</th><th style={TH}>Description</th><th style={{ ...TH, textAlign: 'right' }}>Status</th>
          </tr></thead>
          <tbody>
            {sizesQ.isLoading ? (
              <EmptyRow colSpan={3}>Loading sizes…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={3}>No sizes configured.</EmptyRow>
            ) : rows.map((s) => (
              <tr key={s.id} className="row-hover">
                <td style={MONO_CELL}>{s.value_mm}mm</td>
                <td style={{ ...TD, color: C.ink2 }}>{s.value_mm}mm diameter</td>
                <td style={{ ...TD, textAlign: 'right' }}>{s.is_active === false ? <span className="badge-gray">inactive</span> : <span className="badge-green">active</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title="Add Size">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label className="label">Size in mm</label><input className="input" type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 25" autoFocus /></div>
            <FormActions onCancel={() => setShowCreate(false)} submitLabel={create.isPending ? 'Adding…' : 'Add'} disabled={create.isPending || !value || Number(value) <= 0} onSubmit={() => create.mutate()} />
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   DESIGNS — drawing number, description, valid sizes, status.
   Add design + validity matrix (sizes vs designs grid; cells editable).
   ─────────────────────────────────────────────────────────────────────────── */
function DesignsPanel() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [view, setView] = useState<'list' | 'matrix'>('list')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ code: '', description: '', valid_size_ids: [] as number[] })

  const designsQ = useQuery<Design[]>({ queryKey: ['ml-designs'], queryFn: () => productApi.designs().then((r) => r.data) })
  const sizesQ = useQuery<Size[]>({ queryKey: ['ml-sizes'], queryFn: () => productApi.sizes().then((r) => r.data) })
  const sizes = useMemo(() => [...(sizesQ.data ?? [])].sort((a, b) => a.value_mm - b.value_mm), [sizesQ.data])

  const create = useMutation({
    mutationFn: () => productApi.createDesign({ code: form.code, description: form.description, valid_size_ids: form.valid_size_ids }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ml-designs'] }); setShowCreate(false); setForm({ code: '', description: '', valid_size_ids: [] }) },
  })
  // Toggle a single design↔size validity (matrix cell) via updateDesignSizes.
  const [pendingCell, setPendingCell] = useState<string | null>(null)
  const toggleValid = useMutation({
    mutationFn: ({ design, sizeId }: { design: Design; sizeId: number }) => {
      const next = design.valid_size_ids.includes(sizeId)
        ? design.valid_size_ids.filter((id) => id !== sizeId)
        : [...design.valid_size_ids, sizeId]
      return productApi.updateDesignSizes(design.id, next)
    },
    onMutate: ({ design, sizeId }) => setPendingCell(`${design.id}-${sizeId}`),
    onSettled: () => setPendingCell(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ml-designs'] }),
  })

  const rows = useMemo(() => {
    const list = designsQ.data ?? []
    const t = search.trim().toLowerCase()
    if (!t) return list
    return list.filter((d) => `${d.code} ${d.description ?? ''}`.toLowerCase().includes(t))
  }, [designsQ.data, search])

  const designs = designsQ.data ?? []

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 22, letterSpacing: '-0.03em', color: C.ink }}>Designs</div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, marginTop: 2 }}>{designs.length} {designs.length === 1 ? 'design' : 'designs'} · each shows its valid sizes</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 3, background: C.surface3, borderRadius: 9, padding: 3 }}>
            {([['list', 'List'], ['matrix', 'Matrix']] as const).map(([key, label]) => {
              const on = view === key
              return (
                <button key={key} onClick={() => setView(key)}
                  style={{ border: 'none', borderRadius: 7, padding: '6px 12px', cursor: 'pointer',
                    background: on ? C.surface : 'transparent', color: on ? C.ink : C.ink2,
                    boxShadow: on ? 'var(--shadow-e1)' : 'none', display: 'flex', alignItems: 'center', gap: 5,
                    fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>
                  {key === 'matrix' && <Grid3x3 size={12} />}{label}
                </button>
              )
            })}
          </div>
          {view === 'list' && (
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: C.ink3 }} />
              <input className="input" style={{ width: 180, paddingLeft: 32 }} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          )}
          <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Add Design</button>
        </div>
      </div>

      {designsQ.isError && <StateNote kind="error">Could not load designs — the server may be starting up.</StateNote>}

      {view === 'list' ? (
        <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Drawing / Code</th><th style={TH}>Description</th><th style={TH}>Valid Sizes</th><th style={TH}>Status</th>
            </tr></thead>
            <tbody>
              {designsQ.isLoading ? (
                <EmptyRow colSpan={4}>Loading designs…</EmptyRow>
              ) : rows.length === 0 ? (
                <EmptyRow colSpan={4}>{search ? 'No designs match your search.' : 'No designs configured.'}</EmptyRow>
              ) : rows.map((d) => (
                <tr key={d.id} className="row-hover">
                  <td style={MONO_CELL}>{d.code}</td>
                  <td style={{ ...TD, color: C.ink2 }}>{d.description || '—'}</td>
                  <td style={TD}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {d.valid_sizes_mm.length === 0
                        ? <span style={{ color: C.ink3 }}>none</span>
                        : d.valid_sizes_mm.map((mm) => <span key={mm} className="badge-blue">{mm}mm</span>)}
                    </div>
                  </td>
                  <td style={TD}>{d.is_active === false ? <span className="badge-gray">inactive</span> : <span className="badge-green">active</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ValidityMatrix designs={designs} sizes={sizes} loading={designsQ.isLoading || sizesQ.isLoading}
          pendingCell={pendingCell} onToggle={(design, sizeId) => toggleValid.mutate({ design, sizeId })} />
      )}

      {showCreate && (
        <Modal title="Add Design">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label className="label">Code / Drawing Number</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} autoFocus /></div>
            <div><label className="label">Description</label><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div>
              <label className="label">Valid Sizes</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {sizes.length === 0 && <span style={{ fontFamily: MONO, fontSize: 11, color: C.ink3 }}>No sizes defined.</span>}
                {sizes.map((s) => (
                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.ink, cursor: 'pointer', padding: '4px 8px', borderRadius: 8, border: `1px solid ${form.valid_size_ids.includes(s.id) ? C.accent : C.line}`, background: form.valid_size_ids.includes(s.id) ? 'var(--accent-dim)' : C.surface }}>
                    <input type="checkbox" checked={form.valid_size_ids.includes(s.id)}
                      onChange={(e) => setForm({ ...form, valid_size_ids: e.target.checked ? [...form.valid_size_ids, s.id] : form.valid_size_ids.filter((id) => id !== s.id) })} />
                    {s.value_mm}mm
                  </label>
                ))}
              </div>
            </div>
            <FormActions onCancel={() => setShowCreate(false)} submitLabel={create.isPending ? 'Adding…' : 'Add Design'} disabled={create.isPending || !form.code} onSubmit={() => create.mutate()} />
          </div>
        </Modal>
      )}
    </div>
  )
}

function ValidityMatrix({ designs, sizes, loading, pendingCell, onToggle }: {
  designs: Design[]; sizes: Size[]; loading: boolean
  pendingCell: string | null; onToggle: (design: Design, sizeId: number) => void
}) {
  if (loading) return <StateNote kind="loading">Loading validity matrix…</StateNote>
  if (designs.length === 0 || sizes.length === 0) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', fontFamily: MONO, fontSize: 12, color: C.ink3 }}>
        {designs.length === 0 ? 'No designs to map.' : 'No sizes to map.'} Add designs and sizes first.
      </div>
    )
  }
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <SectionLabel>Validity Matrix · sizes × designs — click a cell to toggle</SectionLabel>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...TH, position: 'sticky', left: 0, background: C.surface, zIndex: 1, minWidth: 140 }}>Design \ Size</th>
              {sizes.map((s) => (
                <th key={s.id} style={{ ...TH, textAlign: 'center', minWidth: 56 }}>{s.value_mm}mm</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {designs.map((d) => (
              <tr key={d.id} className="row-hover">
                <td style={{ ...MONO_CELL, position: 'sticky', left: 0, background: C.surface, zIndex: 1 }}>{d.code}</td>
                {sizes.map((s) => {
                  const valid = d.valid_size_ids.includes(s.id)
                  const key = `${d.id}-${s.id}`
                  const busy = pendingCell === key
                  return (
                    <td key={s.id} style={{ ...TD, textAlign: 'center', padding: '8px' }}>
                      <button onClick={() => onToggle(d, s.id)} disabled={busy} title={valid ? 'Valid — click to remove' : 'Invalid — click to add'}
                        style={{ width: 26, height: 26, borderRadius: 7, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          border: `1px solid ${valid ? 'rgba(34,160,107,.4)' : C.line}`,
                          background: valid ? 'rgba(34,160,107,.14)' : C.surface2, color: valid ? C.green : C.ink3, opacity: busy ? 0.5 : 1 }}>
                        {valid ? <Check size={14} /> : <X size={12} />}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   STORAGE LOCATIONS — code, name, location, status. Add.
   ─────────────────────────────────────────────────────────────────────────── */
function StoragePanel() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ code: '', name: '', factory_location_id: '' })

  const storageQ = useQuery<StorageLocation[]>({ queryKey: ['ml-storage'], queryFn: () => factoryApi.storage().then((r) => r.data) })
  const locsQ = useQuery<FactoryLocation[]>({ queryKey: ['ml-locations'], queryFn: () => factoryApi.locations().then((r) => r.data) })
  const locs = locsQ.data ?? []

  const create = useMutation({
    mutationFn: (data: Record<string, unknown>) => factoryApi.createStorage(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ml-storage'] }); setShowCreate(false); setForm({ code: '', name: '', factory_location_id: '' }) },
  })

  const rows = useMemo(() => {
    const list = storageQ.data ?? []
    const t = search.trim().toLowerCase()
    if (!t) return list
    return list.filter((s: any) => `${s.code} ${s.name}`.toLowerCase().includes(t))
  }, [storageQ.data, search])

  const locName = (id: number | null) => (id ? (locs.find((l) => l.id === id)?.name ?? `Location ${id}`) : 'All')

  return (
    <div>
      <PanelHeader title="Storage Locations" count={(storageQ.data ?? []).length} onAdd={() => setShowCreate(true)} addLabel="Add Storage Location" search={search} onSearch={setSearch} note="WIP buffer codes (RM → FG)" />
      {storageQ.isError && <StateNote kind="error">Could not load storage locations — the server may be starting up.</StateNote>}
      <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={TH}>Code</th><th style={TH}>Name</th><th style={TH}>Location</th>
          </tr></thead>
          <tbody>
            {storageQ.isLoading ? (
              <EmptyRow colSpan={3}>Loading storage locations…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={3}>{search ? 'No storage locations match your search.' : 'No storage locations configured.'}</EmptyRow>
            ) : rows.map((s: any) => (
              <tr key={s.id} className="row-hover">
                <td style={MONO_CELL}>{s.code}</td>
                <td style={TD}>{s.name}</td>
                <td style={{ ...TD, color: C.ink2 }}>{locName(s.factory_location_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title="Add Storage Location">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label className="label">Code</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. HT-Q" autoFocus /></div>
            <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label">Factory Location</label><select className="input" value={form.factory_location_id} onChange={(e) => setForm({ ...form, factory_location_id: e.target.value })}><option value="">All</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <FormActions onCancel={() => setShowCreate(false)} submitLabel={create.isPending ? 'Adding…' : 'Add'} disabled={create.isPending || !form.code || !form.name}
              onSubmit={() => create.mutate({ ...form, factory_location_id: form.factory_location_id ? Number(form.factory_location_id) : null })} />
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   ROLLING CONTRACTORS — name, contact, status. Add / archive.
   ─────────────────────────────────────────────────────────────────────────── */
function ContractorsPanel() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ name: '', contact_info: '' })

  const contractorsQ = useQuery({ queryKey: ['ml-contractors'], queryFn: () => faridabadApi.contractors().then((r) => r.data) })

  const create = useMutation({
    mutationFn: () => faridabadApi.createContractor({ name: form.name, contact_info: form.contact_info || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ml-contractors'] }); setShowCreate(false); setForm({ name: '', contact_info: '' }) },
  })
  const archive = useMutation({
    mutationFn: (id: number) => faridabadApi.archiveContractor(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ml-contractors'] }),
  })

  const rows = useMemo(() => {
    const list = (contractorsQ.data as any[]) ?? []
    const t = search.trim().toLowerCase()
    if (!t) return list
    return list.filter((c) => `${c.name} ${c.contact_info ?? ''}`.toLowerCase().includes(t))
  }, [contractorsQ.data, search])

  return (
    <div>
      <PanelHeader title="Rolling Contractors" count={((contractorsQ.data as any[]) ?? []).length} onAdd={() => setShowCreate(true)} addLabel="Add Contractor" search={search} onSearch={setSearch} note="used in Faridabad dispatches" />
      {contractorsQ.isError && <StateNote kind="error">Could not load contractors — the server may be starting up.</StateNote>}
      <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={TH}>Name</th><th style={TH}>Contact</th><th style={TH}>Status</th><th style={{ ...TH, textAlign: 'right' }} />
          </tr></thead>
          <tbody>
            {contractorsQ.isLoading ? (
              <EmptyRow colSpan={4}>Loading contractors…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={4}>{search ? 'No contractors match your search.' : 'No contractors added yet.'}</EmptyRow>
            ) : rows.map((c: any) => (
              <tr key={c.id} className="row-hover">
                <td style={{ ...TD, fontWeight: 600 }}>{c.name}</td>
                <td style={{ ...TD, color: C.ink2 }}>{c.contact_info || '—'}</td>
                <td style={TD}>{c.is_active === false || c.is_archived ? <span className="badge-gray">archived</span> : <span className="badge-green">active</span>}</td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  {!(c.is_active === false || c.is_archived) && (
                    <button style={{ fontFamily: MONO, fontSize: 11, color: C.red, background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.04em' }}
                      disabled={archive.isPending} onClick={() => archive.mutate(c.id)}>Archive</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title="Add Rolling Contractor">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label className="label">Contractor Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></div>
            <div><label className="label">Contact Info (optional)</label><input className="input" value={form.contact_info} onChange={(e) => setForm({ ...form, contact_info: e.target.value })} placeholder="Phone / email / address" /></div>
            <FormActions onCancel={() => setShowCreate(false)} submitLabel={create.isPending ? 'Adding…' : 'Add'} disabled={create.isPending || !form.name} onSubmit={() => create.mutate()} />
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   PAGE
   ─────────────────────────────────────────────────────────────────────────── */
export default function MasterLists() {
  const [entity, setEntity] = useState<Entity>('workstations')

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* header */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: C.ink }}>Master Lists</div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, marginTop: 3 }}>
          Manage reference data used across the system — Admin / Manager
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '232px 1fr', gap: 24, alignItems: 'start' }}>
        {/* left segmented / tab control */}
        <div className="card" style={{ padding: 8, position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ padding: '8px 10px 6px' }}><SectionLabel>Reference Data</SectionLabel></div>
          {ENTITIES.map((e) => {
            const on = entity === e.key
            return (
              <button key={e.key} onClick={() => setEntity(e.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--accent)' : 'transparent'}`,
                  background: on ? 'var(--accent-dim)' : 'transparent',
                  color: on ? C.accent : C.ink2, transition: 'background 140ms',
                }}
                onMouseEnter={(ev) => { if (!on) (ev.currentTarget as HTMLElement).style.background = C.surface2 }}
                onMouseLeave={(ev) => { if (!on) (ev.currentTarget as HTMLElement).style.background = 'transparent' }}>
                <span style={{ color: on ? C.accent : C.ink3, flexShrink: 0 }}>{e.icon}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontFamily: SANS, fontSize: 13, fontWeight: 600, color: on ? C.accent : C.ink }}>{e.label}</span>
                  <span style={{ display: 'block', fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.04em', color: C.ink3, marginTop: 1 }}>{e.sub}</span>
                </span>
              </button>
            )
          })}

          <div style={{ marginTop: 8, padding: '10px 12px', borderTop: `1px solid ${C.line}`, display: 'flex', alignItems: 'flex-start', gap: 7 }}>
            <Lock size={11} style={{ color: C.ink3, marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontFamily: MONO, fontSize: 9.5, lineHeight: 1.5, color: C.ink3, letterSpacing: '0.03em' }}>
              Suppliers & conversion patterns need dedicated endpoints (not yet available).
            </span>
          </div>
        </div>

        {/* active panel */}
        <div className="animate-es" key={entity}>
          {entity === 'workstations' && <WorkstationsPanel />}
          {entity === 'products' && <ProductsPanel />}
          {entity === 'sizes' && <SizesPanel />}
          {entity === 'designs' && <DesignsPanel />}
          {entity === 'storage' && <StoragePanel />}
          {entity === 'contractors' && <ContractorsPanel />}
        </div>
      </div>
    </div>
  )
}
