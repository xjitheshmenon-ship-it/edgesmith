import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { userApi, factoryApi } from '../api/client'
import type { FactoryLocation } from '../types'
import { Plus } from 'lucide-react'

const ROLE_COLORS: Record<string, string> = {
  admin: 'badge bg-purple-100 text-purple-800',
  manager: 'badge-blue',
  supervisor: 'badge-green',
  operator: 'badge-yellow',
  service: 'badge-gray',
  shopfloor: 'badge-orange',
}

export default function Users() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ username: '', full_name: '', password: '', role: 'operator', primary_location_id: '' })
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => userApi.list().then((r) => r.data) })
  const { data: locs = [] } = useQuery<FactoryLocation[]>({ queryKey: ['locations'], queryFn: () => factoryApi.locations().then((r) => r.data) })

  const create = useMutation({
    mutationFn: (data: Record<string, unknown>) => userApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setShowCreate(false); setForm({ username: '', full_name: '', password: '', role: 'operator', primary_location_id: '' }) },
  })

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => userApi.update(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const ROLES = ['admin', 'manager', 'supervisor', 'operator', 'service', 'shopfloor']

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Add User</button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr><th className="px-4 py-3 text-left font-medium text-gray-600">Username</th><th className="px-4 py-3 text-left font-medium text-gray-600">Full Name</th><th className="px-4 py-3 text-left font-medium text-gray-600">Role</th><th className="px-4 py-3 text-left font-medium text-gray-600">Location</th><th className="px-4 py-3 text-left font-medium text-gray-600">Status</th><th className="px-4 py-3"></th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u: { id: number; username: string; full_name: string; role: string; primary_location_id: number | null; is_active: boolean }) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono">{u.username}</td>
                <td className="px-4 py-3">{u.full_name}</td>
                <td className="px-4 py-3"><span className={ROLE_COLORS[u.role] ?? 'badge-gray'}>{u.role}</span></td>
                <td className="px-4 py-3 text-xs text-gray-400">{u.primary_location_id ? locs.find((l) => l.id === u.primary_location_id)?.name ?? `Loc ${u.primary_location_id}` : '—'}</td>
                <td className="px-4 py-3">{u.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Inactive</span>}</td>
                <td className="px-4 py-3 text-right"><button className="text-xs text-gray-500 hover:text-gray-700" onClick={() => toggle.mutate({ id: u.id, is_active: !u.is_active })}>{u.is_active ? 'Deactivate' : 'Activate'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
            <h2 className="font-semibold text-gray-900">Add User</h2>
            <div><label className="label">Username</label><input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
            <div><label className="label">Full Name</label><input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
            <div><label className="label">Password</label><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <div><label className="label">Role</label><select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
            <div><label className="label">Primary Location</label><select className="input" value={form.primary_location_id} onChange={(e) => setForm({ ...form, primary_location_id: e.target.value })}><option value="">None</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            {create.error && <p className="text-sm text-red-600">Failed to create user</p>}
            <div className="flex gap-3 justify-end"><button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button><button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate({ ...form, primary_location_id: form.primary_location_id ? Number(form.primary_location_id) : null })}>Create User</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
