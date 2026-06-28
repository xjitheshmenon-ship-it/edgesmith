import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { manufacturingApi, productApi } from '../api/client'
import type { ManufacturingOrder, ConversionPattern, Size, Design } from '../types'
import { Plus, Scissors } from 'lucide-react'
import { format } from 'date-fns'

const STATUS_BADGE: Record<string, string> = {
  open: 'badge-blue', in_progress: 'badge-yellow', completed: 'badge-green', cancelled: 'badge-gray',
}

export default function Manufacturing() {
  const [tab, setTab] = useState<'orders' | 'patterns'>('orders')
  const [showCreateMO, setShowCreateMO] = useState(false)
  const [showCreatePattern, setShowCreatePattern] = useState(false)
  const qc = useQueryClient()

  const { data: orders = [] } = useQuery<ManufacturingOrder[]>({
    queryKey: ['mo-orders'],
    queryFn: () => manufacturingApi.orders().then((r) => r.data),
  })

  const { data: patterns = [] } = useQuery<ConversionPattern[]>({
    queryKey: ['patterns'],
    queryFn: () => manufacturingApi.patterns().then((r) => r.data),
  })

  const archivePattern = useMutation({
    mutationFn: (id: number) => manufacturingApi.archivePattern(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patterns'] }),
  })

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Manufacturing</h1>
        <button className="btn-primary" onClick={() => tab === 'orders' ? setShowCreateMO(true) : setShowCreatePattern(true)}>
          <Plus size={16} /> {tab === 'orders' ? 'New MO' : 'New Pattern'}
        </button>
      </div>

      <div className="flex border-b border-gray-200">
        {(['orders', 'patterns'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'orders' ? `Manufacturing Orders (${orders.length})` : `Conversion Patterns (${patterns.length})`}
          </button>
        ))}
      </div>

      {tab === 'orders' && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">MO Number</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Qty</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Size</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Design</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">UIDs</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono font-medium text-brand-600">{m.mo_number}</td>
                  <td className="px-4 py-3">{m.customer}</td>
                  <td className="px-4 py-3">{m.quantity}</td>
                  <td className="px-4 py-3">{m.size_mm ? `${m.size_mm}mm` : '—'}</td>
                  <td className="px-4 py-3">{m.design_code ?? '—'}</td>
                  <td className="px-4 py-3">{m.uid_count}</td>
                  <td className="px-4 py-3"><span className={STATUS_BADGE[m.status] ?? 'badge-gray'}>{m.status}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-400">{format(new Date(m.created_at), 'dd MMM yyyy')}</td>
                </tr>
              ))}
              {orders.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No manufacturing orders</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'patterns' && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {patterns.map((p) => (
            <div key={p.id} className="card p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Scissors size={16} className="text-gray-400" />
                  <h3 className="font-semibold text-gray-900">{p.name}</h3>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Input</span>
                  <span className="font-medium">{p.input_length_mm}mm</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Outputs</span>
                  <span className="font-medium">{p.output_lengths_mm.join(' + ')}mm</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Cuts × Kerf</span>
                  <span className="font-medium">{p.num_cuts} × {p.kerf_mm}mm</span>
                </div>
                <div className="flex justify-between border-t border-gray-100 pt-1 mt-1">
                  <span className="text-gray-500">Scrap</span>
                  <span className={`font-medium ${p.scrap_mm < 0 ? 'text-red-600' : 'text-gray-900'}`}>{p.scrap_mm}mm</span>
                </div>
              </div>
              <button
                className="mt-3 text-xs text-red-500 hover:text-red-700"
                onClick={() => archivePattern.mutate(p.id)}
              >
                Archive
              </button>
            </div>
          ))}
        </div>
      )}

      {showCreateMO && <CreateMOModal onClose={() => { setShowCreateMO(false); qc.invalidateQueries({ queryKey: ['mo-orders'] }) }} />}
      {showCreatePattern && <CreatePatternModal onClose={() => { setShowCreatePattern(false); qc.invalidateQueries({ queryKey: ['patterns'] }) }} />}
    </div>
  )
}

function CreateMOModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ mo_number: '', customer: '', quantity: 1, notes: '' })
  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => manufacturingApi.createOrder(data).then((r) => r.data),
    onSuccess: onClose,
  })
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">New Manufacturing Order</h2>
        <div><label className="label">MO Number</label><input className="input" value={form.mo_number} onChange={(e) => setForm({ ...form, mo_number: e.target.value })} required /></div>
        <div><label className="label">Customer</label><input className="input" value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} required /></div>
        <div><label className="label">Quantity</label><input className="input" type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></div>
        <div><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        {mutation.error && <p className="text-sm text-red-600">Failed to create MO</p>}
        <div className="flex gap-3 justify-end">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={mutation.isPending} onClick={() => mutation.mutate({ ...form, quantity: Number(form.quantity) })}>Create MO</button>
        </div>
      </div>
    </div>
  )
}

function CreatePatternModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [inputLen, setInputLen] = useState(4500)
  const [outputs, setOutputs] = useState('1500,1500,1424')
  const [kerf, setKerf] = useState(3)

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => manufacturingApi.createPattern(data).then((r) => r.data),
    onSuccess: onClose,
  })

  const parsedOutputs = outputs.split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean)
  const numCuts = parsedOutputs.length - 1
  const scrap = inputLen - parsedOutputs.reduce((a, b) => a + b, 0) - numCuts * kerf

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">New Conversion Pattern</h2>
        <div><label className="label">Pattern Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label">Input Length (mm)</label><input className="input" type="number" value={inputLen} onChange={(e) => setInputLen(Number(e.target.value))} /></div>
        <div><label className="label">Output Lengths (comma-separated mm)</label><input className="input" value={outputs} onChange={(e) => setOutputs(e.target.value)} /></div>
        <div><label className="label">Kerf per cut (mm)</label><input className="input" type="number" value={kerf} onChange={(e) => setKerf(Number(e.target.value))} /></div>
        <div className="text-sm bg-gray-50 rounded-lg p-3 space-y-1">
          <div className="flex justify-between"><span>Cuts:</span><span>{numCuts}</span></div>
          <div className="flex justify-between"><span>Scrap:</span><span className={scrap < 0 ? 'text-red-600 font-bold' : ''}>{scrap}mm</span></div>
        </div>
        {mutation.error && <p className="text-sm text-red-600">Failed to create pattern</p>}
        <div className="flex gap-3 justify-end">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={mutation.isPending || scrap < 0} onClick={() => mutation.mutate({ name, input_length_mm: inputLen, output_lengths_mm: parsedOutputs, kerf_mm: kerf })}>Create Pattern</button>
        </div>
      </div>
    </div>
  )
}
