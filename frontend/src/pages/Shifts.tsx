import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { shiftApi, factoryApi, userApi } from '../api/client'
import { format } from 'date-fns'
import { Plus, Trash2, CheckCircle, X, User, Zap, ChevronDown, ChevronRight, ArrowRight, Users, Clock } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

/* ── Design tokens (Lapis theme — matches CSS variables) ─────────────────── */
const T = {
  bg:        '#11305f',
  surface:   '#173a70',
  s2:        '#21498a',
  s3:        '#2a5aa0',
  line:      '#2c5191',
  ink:       '#eaf4e4',
  ink2:      '#9bb4d4',
  ink3:      '#5a7aaa',
  accent:    '#d4eecb',
  accentInk: '#143160',
  green:     '#22a06b',
  amber:     '#f59e0b',
  red:       '#e5484d',
  blue:      '#3b82f6',
}

/* ── Animation ───────────────────────────────────────────────────────────── */
const DRAWER_ANIM = `
  @keyframes es-drawer { from { transform: translateX(24px); opacity: 0 } to { transform: none; opacity: 1 } }
  @keyframes es-fade   { from { opacity: 0 } to { opacity: 1 } }
`

/* ── Shared micro-styles ─────────────────────────────────────────────────── */
const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }
const arch: React.CSSProperties = { fontFamily: "'Archivo', sans-serif" }
const sans: React.CSSProperties = { fontFamily: "'IBM Plex Sans', sans-serif" }

const label = (txt: string) => (
  <div style={{ ...mono, fontSize: 10, letterSpacing: '.12em', color: T.ink2, marginBottom: 8, textTransform: 'uppercase' as const }}>{txt}</div>
)

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  const hex = (c: string, a: number) => {
    const n = parseInt(c.slice(1), 16)
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 20,
      ...mono, fontSize: 11, fontWeight: 600,
      background: hex(color, 0.18), color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {children}
    </span>
  )
}

function StoragePill({ code }: { code: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 9px', borderRadius: 7,
      background: 'rgba(212,238,203,.14)', color: T.accent,
      border: `1px solid rgba(212,238,203,.22)`,
      ...mono, fontSize: 11, fontWeight: 700,
    }}>{code}</span>
  )
}

const SHIFTS = [
  { value: 'morning',   label: 'Morning',   time: '06:00 – 14:00', color: '#f59e0b' },
  { value: 'afternoon', label: 'Afternoon', time: '14:00 – 22:00', color: '#3b82f6' },
  { value: 'night',     label: 'Night',     time: '22:00 – 06:00', color: '#a78bfa' },
]

const STATUS_COLOR: Record<string, string> = {
  active: T.green, on_hold: T.amber, converting: '#a78bfa', dispatched: T.blue,
}

/* ── Drawer backdrop & shell ─────────────────────────────────────────────── */
function DrawerShell({ open, onClose, width = 480, children }: {
  open: boolean; onClose: () => void; width?: number; children: React.ReactNode
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null
  return (
    <>
      <style>{DRAWER_ANIM}</style>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,45,.52)', backdropFilter: 'blur(3px)', zIndex: 40, animation: 'es-fade .2s ease both' }}
      />
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width,
        background: T.surface, borderLeft: `1px solid ${T.line}`,
        zIndex: 41, display: 'flex', flexDirection: 'column',
        animation: 'es-drawer .28s cubic-bezier(.2,.8,.2,1) both',
        boxShadow: '-24px 0 60px rgba(0,0,0,.28)',
        maxWidth: '100vw',
      }}>
        {children}
      </aside>
    </>
  )
}

/* ── Operator Assignment Drawer ───────────────────────────────────────────── */
function AssignDrawer({ open, onClose, shiftDate, shiftPeriod, workstations, operators, assignedWsIds, onSave, saving, error }: {
  open: boolean; onClose: () => void
  shiftDate: string; shiftPeriod: string
  workstations: any[]; operators: any[]; assignedWsIds: Set<number>
  onSave: (d: any) => void; saving: boolean; error?: string
}) {
  const [form, setForm] = useState({ workstation_id: '', operator_id: '', notes: '' })
  const shiftInfo = SHIFTS.find(s => s.value === shiftPeriod)!

  return (
    <DrawerShell open={open} onClose={onClose} width={440}>
      {/* Header */}
      <div style={{ padding: '22px 24px 18px', borderBottom: `1px solid ${T.line}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ ...mono, fontSize: 10, letterSpacing: '.14em', color: T.ink2, marginBottom: 8 }}>SHIFT MANAGEMENT</div>
            <div style={{ ...arch, fontWeight: 800, fontSize: 20, letterSpacing: '-.02em', color: T.ink }}>Assign Operator</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, border: `1px solid ${T.line}`, background: 'none', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.ink2 }}>
            <X size={15} />
          </button>
        </div>
        <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 20, background: 'rgba(212,238,203,.12)', border: `1px solid rgba(212,238,203,.2)` }}>
          <Clock size={12} style={{ color: shiftInfo.color }} />
          <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: T.ink2 }}>{shiftInfo.label} · {shiftInfo.time} · {format(new Date(shiftDate + 'T00:00:00'), 'dd MMM yyyy')}</span>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            {label('Workstation')}
            <div style={{ position: 'relative' }}>
              <select
                value={form.workstation_id}
                onChange={e => setForm(f => ({ ...f, workstation_id: e.target.value }))}
                style={{ width: '100%', height: 44, padding: '0 36px 0 14px', border: `1.5px solid ${T.line}`, borderRadius: 11, ...sans, fontSize: 14, color: T.ink, background: T.s2, outline: 'none', appearance: 'none', cursor: 'pointer' }}
              >
                <option value="">Select workstation…</option>
                {workstations.filter((w: any) => !assignedWsIds.has(w.id)).map((w: any) => (
                  <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
                ))}
              </select>
              <ChevronDown size={15} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: T.ink2, pointerEvents: 'none' }} />
            </div>
          </div>

          <div>
            {label('Operator')}
            <div style={{ position: 'relative' }}>
              <select
                value={form.operator_id}
                onChange={e => setForm(f => ({ ...f, operator_id: e.target.value }))}
                style={{ width: '100%', height: 44, padding: '0 36px 0 14px', border: `1.5px solid ${T.line}`, borderRadius: 11, ...sans, fontSize: 14, color: T.ink, background: T.s2, outline: 'none', appearance: 'none', cursor: 'pointer' }}
              >
                <option value="">Select operator…</option>
                {operators.map((o: any) => (
                  <option key={o.id} value={o.id}>{o.full_name || o.username}</option>
                ))}
              </select>
              <ChevronDown size={15} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: T.ink2, pointerEvents: 'none' }} />
            </div>
            {form.operator_id && (
              <div style={{ marginTop: 10, padding: '12px 14px', borderRadius: 11, background: T.s2, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: T.s3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.accent, ...arch, fontWeight: 700, fontSize: 13 }}>
                  {(operators.find((o: any) => String(o.id) === form.operator_id)?.full_name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <div style={{ ...sans, fontSize: 13, fontWeight: 600, color: T.ink }}>{operators.find((o: any) => String(o.id) === form.operator_id)?.full_name || '—'}</div>
                  <div style={{ ...mono, fontSize: 10, color: T.ink2 }}>operator</div>
                </div>
              </div>
            )}
          </div>

          <div>
            {label('Notes (optional)')}
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. Covering for K. Osei"
              rows={3}
              style={{ width: '100%', padding: '12px 14px', border: `1.5px solid ${T.line}`, borderRadius: 11, ...sans, fontSize: 14, color: T.ink, background: T.s2, outline: 'none', resize: 'none' }}
            />
          </div>

          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(229,72,77,.14)', border: '1px solid rgba(229,72,77,.3)', color: T.red, ...sans, fontSize: 13 }}>{error}</div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '16px 24px', borderTop: `1px solid ${T.line}`, display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={{ flex: 1, height: 42, border: `1px solid ${T.line}`, background: 'none', borderRadius: 10, cursor: 'pointer', ...sans, fontWeight: 600, fontSize: 13, color: T.ink }}>Cancel</button>
        <button
          disabled={!form.workstation_id || !form.operator_id || saving}
          onClick={() => onSave({ workstation_id: Number(form.workstation_id), operator_id: Number(form.operator_id), notes: form.notes || undefined })}
          style={{ flex: 1.4, height: 42, border: 'none', background: form.workstation_id && form.operator_id ? T.accent : T.s2, color: form.workstation_id && form.operator_id ? T.accentInk : T.ink3, borderRadius: 10, cursor: form.workstation_id && form.operator_id ? 'pointer' : 'not-allowed', ...sans, fontWeight: 700, fontSize: 13 }}
        >
          {saving ? 'Saving…' : 'Assign & Confirm'}
        </button>
      </div>
    </DrawerShell>
  )
}

/* ── Job (Workstation) Drawer ─────────────────────────────────────────────── */
function JobDrawer({ ws, open, onClose, canEdit, onAllot, onRemove, allotting }: {
  ws: any; open: boolean; onClose: () => void
  canEdit: boolean; onAllot: (uid_id: number) => void; onRemove: (id: number) => void; allotting: boolean
}) {
  const [showReady, setShowReady] = useState(true)

  if (!ws) return null
  return (
    <DrawerShell open={open} onClose={onClose} width={500}>
      {/* Header */}
      <div style={{ padding: '22px 24px 18px', borderBottom: `1px solid ${T.line}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...mono, fontSize: 10, letterSpacing: '.14em', color: T.ink2, marginBottom: 6 }}>WORKSTATION</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ ...arch, fontWeight: 800, fontSize: 22, letterSpacing: '-.02em', color: T.ink }}>{ws.workstation_code}</span>
              <span style={{ ...sans, fontSize: 14, color: T.ink2 }}>{ws.workstation_name}</span>
            </div>
            {ws.from_storage?.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {ws.from_storage.map((c: string) => <StoragePill key={c} code={c} />)}
                <ArrowRight size={13} style={{ color: T.ink3 }} />
                {ws.to_storage.map((c: string) => <StoragePill key={c} code={c} />)}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, border: `1px solid ${T.line}`, background: 'none', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.ink2 }}>
            <X size={15} />
          </button>
        </div>
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: T.s3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.accent, ...arch, fontWeight: 700, fontSize: 12 }}>
            {(ws.operator_name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
          </div>
          <div>
            <div style={{ ...sans, fontWeight: 600, fontSize: 13, color: T.ink }}>{ws.operator_name}</div>
            <div style={{ ...mono, fontSize: 10, color: T.ink2 }}>assigned operator</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            {ws.confirmed
              ? <Badge color={T.green}>Confirmed</Badge>
              : <Badge color={T.amber}>Pending</Badge>}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {/* Queue section */}
        <div style={{ ...mono, fontSize: 10, letterSpacing: '.14em', color: T.ink2, marginBottom: 12 }}>
          CURRENT QUEUE · {ws.queue?.length ?? 0} knives
        </div>
        {ws.queue?.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', ...mono, fontSize: 12, color: T.ink3, background: T.s2, borderRadius: 12, border: `1px dashed ${T.line}` }}>
            Queue empty — add knives from the ready pool below
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, borderRadius: 12, overflow: 'hidden', border: `1px solid ${T.line}` }}>
            {ws.queue?.map((j: any, i: number) => (
              <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: i % 2 === 0 ? T.s2 : T.surface }}>
                <span style={{ ...mono, fontSize: 11, color: T.ink3, width: 22, textAlign: 'right', flexShrink: 0 }}>#{i + 1}</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[j.uid_status] || T.ink3, flexShrink: 0 }} />
                <span style={{ ...mono, fontWeight: 700, fontSize: 13, color: T.accent, flex: 1 }}>{j.uid_code}</span>
                <span style={{ ...mono, fontSize: 11, color: T.ink2 }}>{j.current_step_name || `Step ${j.current_step}`}</span>
                {j.from_storage_code && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <StoragePill code={j.from_storage_code} />
                    <ArrowRight size={11} style={{ color: T.ink3 }} />
                    <StoragePill code={j.to_storage_code || '?'} />
                  </div>
                )}
                {canEdit && (
                  <button onClick={() => onRemove(j.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.ink3, padding: '2px 4px', borderRadius: 5, display: 'flex', alignItems: 'center' }}>
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Ready pool */}
        {(ws.ready_count ?? 0) > 0 && (
          <div style={{ marginTop: 20 }}>
            <button
              onClick={() => setShowReady(r => !r)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 12px', width: '100%' }}
            >
              <span style={{ ...mono, fontSize: 10, letterSpacing: '.14em', color: T.ink2 }}>READY POOL</span>
              <span style={{ ...mono, fontSize: 10, fontWeight: 700, color: T.green }}>{ws.ready_count} available</span>
              {showReady ? <ChevronDown size={13} style={{ color: T.ink3, marginLeft: 'auto' }} /> : <ChevronRight size={13} style={{ color: T.ink3, marginLeft: 'auto' }} />}
            </button>
            {showReady && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {ws.ready_uids?.map((u: any) => (
                  <button
                    key={u.id}
                    onClick={() => canEdit && onAllot(u.id)}
                    disabled={allotting || !canEdit}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '10px 12px', borderRadius: 10,
                      background: T.s2, border: `1.5px dashed ${T.line}`,
                      cursor: canEdit ? 'pointer' : 'default',
                      textAlign: 'left',
                      transition: 'border-color .12s, background .12s',
                    }}
                    onMouseEnter={e => { if (canEdit) { (e.currentTarget as HTMLButtonElement).style.borderColor = T.accent; (e.currentTarget as HTMLButtonElement).style.background = T.s3 } }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = T.line; (e.currentTarget as HTMLButtonElement).style.background = T.s2 }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[u.status] || T.ink3, flexShrink: 0 }} />
                    <span style={{ ...mono, fontSize: 12, fontWeight: 600, color: T.ink }}>{u.code}</span>
                    {canEdit && <Plus size={11} style={{ marginLeft: 'auto', color: T.ink3, flexShrink: 0 }} />}
                  </button>
                ))}
                {ws.ready_count > (ws.ready_uids?.length ?? 0) && (
                  <div style={{ padding: '10px 12px', borderRadius: 10, background: T.s2, border: `1px solid ${T.line}`, ...mono, fontSize: 11, color: T.ink3, display: 'flex', alignItems: 'center' }}>
                    +{ws.ready_count - (ws.ready_uids?.length ?? 0)} more…
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {canEdit && (
        <div style={{ padding: '16px 24px', borderTop: `1px solid ${T.line}` }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: '.1em', color: T.ink2, marginBottom: 8 }}>
            {ws.ready_count} knife{ws.ready_count !== 1 ? 's' : ''} ready at this workstation
          </div>
          <button
            onClick={onClose}
            style={{ width: '100%', height: 42, border: `1px solid ${T.line}`, background: 'none', borderRadius: 10, cursor: 'pointer', ...sans, fontWeight: 600, fontSize: 13, color: T.ink }}
          >
            Done
          </button>
        </div>
      )}
    </DrawerShell>
  )
}

/* ── Workstation Queue Card ───────────────────────────────────────────────── */
function WorkstationCard({ ws, canEdit, onClick }: {
  ws: any; canEdit: boolean; onClick: () => void
}) {
  const qCount = ws.queue?.length ?? 0
  const confirmed = ws.confirmed

  return (
    <div
      onClick={onClick}
      style={{
        background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14,
        cursor: 'pointer', transition: 'transform .12s, box-shadow .12s',
        overflow: 'hidden',
      }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = `0 8px 24px rgba(0,0,0,.22)` }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = 'none'; el.style.boxShadow = 'none' }}
    >
      {/* Card header */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.line}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ ...arch, fontWeight: 800, fontSize: 15, letterSpacing: '-.01em', color: T.ink }}>{ws.workstation_code}</span>
              <span style={{ ...sans, fontSize: 12, color: T.ink2 }}>{ws.workstation_name}</span>
            </div>
            {ws.from_storage?.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                {ws.from_storage.map((c: string) => <StoragePill key={c} code={c} />)}
                <ArrowRight size={11} style={{ color: T.ink3 }} />
                {ws.to_storage.map((c: string) => <StoragePill key={c} code={c} />)}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ ...arch, fontWeight: 800, fontSize: 24, letterSpacing: '-.03em', color: T.accent, lineHeight: 1 }}>{qCount}</div>
            <div style={{ ...mono, fontSize: 10, color: T.ink2, marginTop: 2 }}>queued</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: T.s3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.accent, ...arch, fontWeight: 700, fontSize: 11, flexShrink: 0 }}>
            {(ws.operator_name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
          </div>
          <span style={{ ...sans, fontWeight: 600, fontSize: 12, color: T.ink, flex: 1 }}>{ws.operator_name}</span>
          {confirmed
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...mono, fontSize: 10, color: T.green }}><CheckCircle size={11} />Confirmed</span>
            : <span style={{ ...mono, fontSize: 10, color: T.amber }}>Pending</span>}
        </div>
      </div>

      {/* Queue preview */}
      <div style={{ padding: '10px 14px', minHeight: 44, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {qCount === 0 && (
          <span style={{ ...mono, fontSize: 11, color: T.ink3, alignSelf: 'center' }}>Queue empty</span>
        )}
        {ws.queue?.slice(0, 6).map((j: any) => (
          <span key={j.id} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '3px 8px', borderRadius: 7,
            background: T.s2, border: `1px solid ${T.line}`,
            ...mono, fontSize: 11,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[j.uid_status] || T.ink3, flexShrink: 0 }} />
            {j.uid_code}
          </span>
        ))}
        {qCount > 6 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 7, background: T.s2, ...mono, fontSize: 11, color: T.ink3 }}>
            +{qCount - 6} more
          </span>
        )}
        {ws.ready_count > 0 && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, ...mono, fontSize: 10, color: T.green }}>
            <Plus size={10} />{ws.ready_count} ready
          </span>
        )}
      </div>
    </div>
  )
}

/* ── Assignment Card ─────────────────────────────────────────────────────── */
function AssignmentCard({ a, isSupervisor, canEdit, onConfirm, onDelete }: {
  a: any; isSupervisor: boolean; canEdit: boolean; onConfirm: () => void; onDelete: () => void
}) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ ...arch, fontWeight: 700, fontSize: 14, color: T.ink }}>{a.workstation_code} — {a.workstation_name}</div>
          <div style={{ ...sans, fontSize: 13, color: T.accent, fontWeight: 600, marginTop: 3 }}>{a.operator_full_name || a.operator_username}</div>
        </div>
        {a.confirmed_by
          ? <Badge color={T.green}>Confirmed</Badge>
          : <Badge color={T.amber}>Pending</Badge>}
      </div>
      {a.notes && <p style={{ ...sans, fontSize: 12, color: T.ink2, fontStyle: 'italic', marginBottom: 8 }}>{a.notes}</p>}
      <div style={{ ...mono, fontSize: 10, color: T.ink3, marginBottom: 10 }}>Assigned by {a.assigned_by}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {!a.confirmed_by && isSupervisor && (
          <button onClick={onConfirm} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', border: 'none', borderRadius: 9, background: T.accent, color: T.accentInk, ...sans, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            <CheckCircle size={12} /> Confirm
          </button>
        )}
        {canEdit && (
          <button onClick={onDelete} style={{ width: 34, height: 34, border: `1px solid ${T.line}`, borderRadius: 9, background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.red }}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Main page ───────────────────────────────────────────────────────────── */
export default function Shifts() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isSupervisor = user?.role && ['admin', 'supervisor'].includes(user.role)
  const canEdit = user?.role && ['admin', 'manager', 'supervisor'].includes(user.role)

  const today = format(new Date(), 'yyyy-MM-dd')
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedShift, setSelectedShift] = useState('morning')
  const [activeTab, setActiveTab] = useState<'assignments' | 'queue'>('assignments')

  const [showAssignDrawer, setShowAssignDrawer] = useState(false)
  const [selectedWs, setSelectedWs] = useState<any>(null)
  const [autoAssignResult, setAutoAssignResult] = useState<{ allotted: number } | null>(null)

  const { data: assignments = [] } = useQuery({
    queryKey: ['shift-assignments', selectedDate, selectedShift],
    queryFn: () => shiftApi.listAssignments({ shift_date: selectedDate, shift_period: selectedShift }).then(r => r.data),
  })

  const { data: queueData = [], isLoading: queueLoading, isError: queueError, refetch: refetchQueue } = useQuery({
    queryKey: ['shift-queue', selectedDate, selectedShift],
    queryFn: () => shiftApi.queueView(selectedDate, selectedShift).then(r => r.data),
    enabled: activeTab === 'queue',
    refetchInterval: 30000,
    retry: 1,
  })

  const { data: workstations = [] } = useQuery({ queryKey: ['workstations'], queryFn: () => factoryApi.workstations().then(r => r.data) })
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => userApi.list().then(r => r.data) })

  const operators = (users as any[]).filter((u: any) => u.role === 'operator')
  const assignedWsIds = new Set((assignments as any[]).map((a: any) => a.workstation_id))

  const createAssignment = useMutation({
    mutationFn: (d: any) => shiftApi.createAssignment({ ...d, shift_date: selectedDate, shift_period: selectedShift }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shift-assignments'] }); setShowAssignDrawer(false) },
  })

  const confirmAssignment = useMutation({
    mutationFn: (id: number) => shiftApi.confirmAssignment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-assignments'] }),
  })

  const deleteAssignment = useMutation({
    mutationFn: (id: number) => shiftApi.deleteAssignment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-assignments'] }),
  })

  const createAllotment = useMutation({
    mutationFn: (d: any) => shiftApi.createAllotment(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shift-queue'] }); refetchQueue() },
  })

  const removeAllotment = useMutation({
    mutationFn: (id: number) => shiftApi.removeAllotment(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shift-queue'] }); refetchQueue() },
  })

  const autoAssign = useMutation({
    mutationFn: () => shiftApi.autoAssign({ shift_date: selectedDate, shift_period: selectedShift }),
    onSuccess: (r) => { setAutoAssignResult(r.data); qc.invalidateQueries({ queryKey: ['shift-queue'] }) },
  })

  const shiftInfo = SHIFTS.find(s => s.value === selectedShift)!

  // refresh drawer data when queue updates
  const drawerWsLive = selectedWs ? (queueData as any[]).find((w: any) => w.assignment_id === selectedWs.assignment_id) || selectedWs : null

  return (
    <div style={{ padding: '24px 28px 60px', minHeight: '100vh' }}>
      <style>{DRAWER_ANIM}</style>

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ ...mono, fontSize: 10, letterSpacing: '.16em', color: T.ink2, marginBottom: 8 }}>MANUFACTURING · SHIFTS</div>
          <h1 style={{ ...arch, fontWeight: 800, fontSize: 28, letterSpacing: '-.03em', color: T.ink, lineHeight: 1 }}>Shift Management</h1>
          <p style={{ ...sans, fontSize: 13, color: T.ink2, marginTop: 5 }}>Operator assignments &amp; job queue</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{ height: 42, padding: '0 14px', border: `1.5px solid ${T.line}`, borderRadius: 11, ...sans, fontSize: 14, color: T.ink, background: T.s2, outline: 'none' }}
          />
          <div style={{ display: 'flex', border: `1px solid ${T.line}`, borderRadius: 11, overflow: 'hidden' }}>
            {SHIFTS.map(s => (
              <button
                key={s.value}
                onClick={() => setSelectedShift(s.value)}
                style={{
                  padding: '0 16px', height: 42, ...sans, fontSize: 13, fontWeight: 600,
                  border: 'none', borderRight: `1px solid ${T.line}`, cursor: 'pointer',
                  background: selectedShift === s.value ? T.accent : T.s2,
                  color: selectedShift === s.value ? T.accentInk : T.ink2,
                  transition: 'background .12s, color .12s',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Shift info pill ───────────────────────────────────────────────── */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 20, background: 'rgba(212,238,203,.1)', border: `1px solid rgba(212,238,203,.18)`, marginBottom: 20 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: shiftInfo.color }} />
        <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: T.ink2 }}>{shiftInfo.label} Shift · {shiftInfo.time} · {format(new Date(selectedDate + 'T00:00:00'), 'dd MMM yyyy')}</span>
        <span style={{ ...mono, fontSize: 11, color: T.accent, fontWeight: 700 }}>{(assignments as any[]).length} workstations</span>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${T.line}`, marginBottom: 22 }}>
        {[
          { key: 'assignments', label: 'Operator Assignments', icon: <Users size={14} /> },
          { key: 'queue',       label: 'Job Queue',            icon: <Zap size={14} /> },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as any)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 18px', ...sans, fontSize: 13, fontWeight: 600,
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: activeTab === t.key ? `2px solid ${T.accent}` : '2px solid transparent',
              color: activeTab === t.key ? T.accent : T.ink2,
              marginBottom: -1, transition: 'color .12s',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ASSIGNMENTS TAB                                                   */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'assignments' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {(assignments as any[]).map((a: any) => (
              <AssignmentCard
                key={a.id}
                a={a}
                isSupervisor={!!isSupervisor}
                canEdit={!!canEdit}
                onConfirm={() => confirmAssignment.mutate(a.id)}
                onDelete={() => deleteAssignment.mutate(a.id)}
              />
            ))}

            {/* Add workstation card */}
            {canEdit && (
              <button
                onClick={() => setShowAssignDrawer(true)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                  background: 'none', border: `1.5px dashed ${T.line}`, borderRadius: 14,
                  minHeight: 120, cursor: 'pointer', color: T.ink3,
                  transition: 'border-color .14s, color .14s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = T.accent; (e.currentTarget as HTMLButtonElement).style.color = T.accent }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = T.line; (e.currentTarget as HTMLButtonElement).style.color = T.ink3 }}
              >
                <Plus size={20} />
                <span style={{ ...sans, fontSize: 13, fontWeight: 600 }}>Assign Operator</span>
              </button>
            )}
          </div>

          {assignments.length === 0 && !canEdit && (
            <div style={{ textAlign: 'center', padding: '48px 0', ...mono, fontSize: 12, color: T.ink3 }}>No assignments for this shift yet.</div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* JOB QUEUE TAB                                                     */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'queue' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {canEdit && (
              <button
                onClick={() => { setAutoAssignResult(null); autoAssign.mutate() }}
                disabled={autoAssign.isPending}
                style={{ display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 16px', border: 'none', borderRadius: 10, background: T.accent, color: T.accentInk, ...sans, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                <Zap size={14} /> {autoAssign.isPending ? 'Filling…' : 'Auto-Fill All Queues'}
              </button>
            )}
            {autoAssignResult && (
              <span style={{ ...mono, fontSize: 12, color: autoAssignResult.allotted > 0 ? T.green : T.ink3 }}>
                {autoAssignResult.allotted > 0 ? `✓ ${autoAssignResult.allotted} knives queued` : 'No matching knives found'}
              </span>
            )}
            <span style={{ marginLeft: 'auto', ...mono, fontSize: 10, color: T.ink3 }}>Auto-refreshes every 30s</span>
          </div>

          {queueLoading && (
            <div style={{ textAlign: 'center', padding: 48, ...mono, fontSize: 12, color: T.ink3 }}>Loading queue…</div>
          )}
          {!queueLoading && queueError && (
            <div style={{ textAlign: 'center', padding: 48, ...mono, fontSize: 12, color: T.red }}>Failed to load queue — please refresh.</div>
          )}
          {!queueLoading && !queueError && (queueData as any[]).length === 0 && (
            <div style={{ textAlign: 'center', padding: 48, ...mono, fontSize: 12, color: T.ink3 }}>
              No operator assignments for this shift. Set up assignments first.
            </div>
          )}

          {/* Workstation cards grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {(queueData as any[]).map((ws: any) => (
              <WorkstationCard
                key={ws.assignment_id}
                ws={ws}
                canEdit={!!canEdit}
                onClick={() => setSelectedWs(ws)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Drawers ───────────────────────────────────────────────────────── */}
      <AssignDrawer
        open={showAssignDrawer}
        onClose={() => setShowAssignDrawer(false)}
        shiftDate={selectedDate}
        shiftPeriod={selectedShift}
        workstations={workstations as any[]}
        operators={operators}
        assignedWsIds={assignedWsIds}
        onSave={(d) => createAssignment.mutate(d)}
        saving={createAssignment.isPending}
        error={(createAssignment.error as any)?.response?.data?.detail}
      />

      <JobDrawer
        ws={drawerWsLive}
        open={!!selectedWs}
        onClose={() => setSelectedWs(null)}
        canEdit={!!canEdit}
        onAllot={(uid_id) => {
          if (!selectedWs) return
          createAllotment.mutate({ uid_id, operator_id: selectedWs.operator_id, workstation_id: selectedWs.workstation_id })
        }}
        onRemove={(id) => removeAllotment.mutate(id)}
        allotting={createAllotment.isPending}
      />
    </div>
  )
}
