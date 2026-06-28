import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { userApi, factoryApi } from '../api/client'
import type { FactoryLocation } from '../types'
import { Plus } from 'lucide-react'

const ROLE_BADGE: Record<string, React.CSSProperties> = {
  admin:      { background: 'rgba(167,139,250,.2)', color: '#c4b5fd', border: '1px solid rgba(167,139,250,.3)' },
  manager:    { background: 'rgba(96,165,250,.18)', color: '#93c5fd', border: '1px solid rgba(96,165,250,.3)' },
  supervisor: { background: 'rgba(34,160,107,.2)', color: '#6ee7b7', border: '1px solid rgba(34,160,107,.3)' },
  operator:   { background: 'rgba(251,191,36,.18)', color: '#fcd34d', border: '1px solid rgba(251,191,36,.3)' },
  service:    { background: 'rgba(148,163,184,.15)', color: '#94a3b8', border: '1px solid rgba(148,163,184,.3)' },
  shopfloor:  { background: 'rgba(251,146,60,.18)', color: '#fdba74', border: '1px solid rgba(251,146,60,.3)' },
}

const TH: React.CSSProperties = { padding: '10px 16px', textAlign: 'left', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--ink-2)', fontWeight: 500, background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }
const TD: React.CSSProperties = { padding: '11px 16px', fontSize: 13, color: 'var(--ink)', borderBottom: '1px solid var(--line)' }

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
    <div style={{ padding: '24px 28px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--ink)' }}>Users</div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Add User</button>
      </div>

      <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={TH}>Username</th>
              <th style={TH}>Full Name</th>
              <th style={TH}>Role</th>
              <th style={TH}>Location</th>
              <th style={TH}>Status</th>
              <th style={{ ...TH, textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {(users as { id: number; username: string; full_name: string; role: string; primary_location_id: number | null; is_active: boolean }[]).map((u) => (
              <tr key={u.id}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
              >
                <td style={{ ...TD, fontFamily: "'IBM Plex Mono', monospace" }}>{u.username}</td>
                <td style={TD}>{u.full_name}</td>
                <td style={TD}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 5, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", ...ROLE_BADGE[u.role] }}>
                    {u.role}
                  </span>
                </td>
                <td style={{ ...TD, color: 'var(--ink-2)' }}>{u.primary_location_id ? locs.find((l) => l.id === u.primary_location_id)?.name ?? `Loc ${u.primary_location_id}` : '—'}</td>
                <td style={TD}>{u.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Inactive</span>}</td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  <button style={{ fontSize: 12, color: 'var(--ink-2)', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => toggle.mutate({ id: u.id, is_active: !u.is_active })}>
                    {u.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div className="card" style={{ width: '100%', maxWidth: 440, padding: '24px 24px 20px' }}>
            <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)', marginBottom: 16 }}>Add User</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><label className="label">Username</label><input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
              <div><label className="label">Full Name</label><input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div><label className="label">Password</label><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
              <div><label className="label">Role</label><select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
              <div><label className="label">Primary Location</label><select className="input" value={form.primary_location_id} onChange={(e) => setForm({ ...form, primary_location_id: e.target.value })}><option value="">None</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
              {create.error && <p style={{ fontSize: 13, color: 'var(--error)' }}>Failed to create user</p>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate({ ...form, primary_location_id: form.primary_location_id ? Number(form.primary_location_id) : null })}>Create User</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
