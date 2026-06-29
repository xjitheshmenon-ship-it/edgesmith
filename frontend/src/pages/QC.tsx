import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { uidApi } from '../api/client'
import type { UID, StepHistory } from '../types'
import { useAuth } from '../hooks/useAuth'
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Search,
  Clock,
  ClipboardList,
  AlertTriangle,
  Ruler,
  Info,
  Factory,
  Download,
} from 'lucide-react'
import { formatDistanceToNowStrict, format } from 'date-fns'

/* ── design tokens (local mirrors per reference pages) ──────────────────────── */
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
  redText: '#c0392b',
  orange: '#d97a2b',
  amber: '#f0c674',
  green: '#22a06b',
  greenText: '#1c7a52',
}
const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"

const SIGNOFF_ROLES = new Set(['admin', 'manager', 'supervisor'])

/* QC check types per spec (PAGE 10) */
const CHECK_TYPES = [
  'Hardness HRC',
  'Diameter mm',
  'Length mm',
  'Straightness',
  'Visual',
  'Other',
] as const
type CheckType = (typeof CHECK_TYPES)[number]
const MEASURABLE = new Set<CheckType>(['Hardness HRC', 'Diameter mm', 'Length mm'])

type ResultKind = 'Pass' | 'Fail' | 'Borderline'

/* Infer the required QC check from a step's operation name. */
function inferCheckType(stepName?: string | null): string {
  const n = (stepName ?? '').toLowerCase()
  if (n.includes('hard') || n.includes('hrc')) return 'Hardness'
  if (n.includes('dimension') || n.includes('diameter') || n.includes('length')) return 'Dimensional'
  if (n.includes('straight')) return 'Straightness'
  if (n.includes('visual')) return 'Visual'
  return 'Inspection'
}

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  fontFamily: MONO, fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap',
}

function resultStyle(result?: string | null): React.CSSProperties {
  const r = (result ?? '').toLowerCase()
  if (r === 'pass') return { ...pill, background: 'rgba(34,160,107,.14)', color: C.greenText }
  if (r === 'fail') return { ...pill, background: 'rgba(229,72,77,.13)', color: C.redText }
  if (r === 'borderline') return { ...pill, background: 'rgba(245,158,11,.16)', color: C.orange }
  return { ...pill, background: C.surface3, color: C.ink2 }
}

function SectionLabel({ icon, children, right }: { icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      {icon}
      <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: C.ink3, textTransform: 'uppercase' }}>{children}</span>
      <div style={{ flex: 1 }} />
      {right}
    </div>
  )
}

/* QC measurements pulled out of a UID's step history (latest first). */
interface QcRecord {
  uid: UID
  history: StepHistory
}

export default function QC() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const role = user?.role ?? ''
  const canSignOff = SIGNOFF_ROLES.has(role)
  const scopedLocation =
    role === 'operator' || role === 'supervisor' ? user?.primary_location_id ?? undefined : undefined

  const [search, setSearch] = useState('')
  const [resultFilter, setResultFilter] = useState<'all' | 'pass' | 'fail' | 'borderline'>('all')
  const [selectedUid, setSelectedUid] = useState<number | null>(null)
  const [pendingUid, setPendingUid] = useState<number | null>(null)

  // ── Live data ──────────────────────────────────────────────────────────────
  // Pending QC queue now comes straight from the dedicated endpoint, which
  // returns the UIDs awaiting sign-off (with workstation/step already resolved).
  const { data: pendingRows, isLoading: pendingLoading, isError: pendingError } = useQuery<UID[]>({
    queryKey: ['qc-pending', scopedLocation],
    queryFn: () => uidApi.qcPending(scopedLocation).then((r) => r.data),
    refetchInterval: 30_000,
    retry: false,
  })

  // History view: step_history carrying qc_result, sourced from the UID list.
  const { data: activeResult, isError: activeError } = useQuery({
    queryKey: ['qc-uids-active', scopedLocation],
    queryFn: () => uidApi.list({ status: 'active', location_id: scopedLocation, limit: 500 }).then((r) => r.data),
    refetchInterval: 30_000,
    retry: false,
  })
  const { data: holdResult } = useQuery({
    queryKey: ['qc-uids-hold', scopedLocation],
    queryFn: () => uidApi.list({ status: 'on_hold', location_id: scopedLocation, limit: 500 }).then((r) => r.data),
    refetchInterval: 30_000,
    retry: false,
  })

  const activeUids: UID[] = activeResult?.items ?? []
  const holdUids: UID[] = holdResult?.items ?? []
  const allUids = useMemo(() => [...activeUids, ...holdUids], [activeUids, holdUids])

  // ── Pending sign-offs: live from the qc/pending endpoint ────────────────────
  const pending = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (pendingRows ?? [])
      .filter((u) => !term || u.code.toLowerCase().includes(term))
  }, [pendingRows, search])

  // ── QC history: step_history entries carrying a qc_result, newest first ─────
  const qcRecords = useMemo<QcRecord[]>(() => {
    const out: QcRecord[] = []
    for (const u of allUids) {
      for (const h of u.step_history ?? []) {
        if (h.qc_result) out.push({ uid: u, history: h })
      }
    }
    return out.sort(
      (a, b) => new Date(b.history.performed_at).getTime() - new Date(a.history.performed_at).getTime()
    )
  }, [allUids])

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase()
    return qcRecords
      .filter((r) => resultFilter === 'all' || (r.history.qc_result ?? '').toLowerCase() === resultFilter)
      .filter((r) => !term || r.uid.code.toLowerCase().includes(term))
  }, [qcRecords, resultFilter, search])

  const selected = useMemo(
    () => pending.find((u) => u.id === selectedUid) ?? null,
    [pending, selectedUid]
  )

  // ── Sign-off: dedicated QC endpoint ─────────────────────────────────────────
  //   pass       → advances the UID
  //   fail       → puts it on_hold + alerts supervisor
  //   borderline → flags for review without advancing
  const signOff = useMutation({
    mutationFn: ({ uid_id, result, values, notes }: {
      uid_id: number
      result: 'pass' | 'fail' | 'borderline'
      values?: Record<string, unknown>
      notes?: string
    }) => uidApi.qcSignoff(uid_id, { result, values, notes }).then((r) => r.data as UID),
    onMutate: ({ uid_id }) => setPendingUid(uid_id),
    onSettled: () => setPendingUid(null),
    onSuccess: () => {
      setSelectedUid(null)
      qc.invalidateQueries({ queryKey: ['qc-pending'] })
      qc.invalidateQueries({ queryKey: ['qc-uids-active'] })
      qc.invalidateQueries({ queryKey: ['qc-uids-hold'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const counts = useMemo(() => {
    const passed = qcRecords.filter((r) => (r.history.qc_result ?? '').toLowerCase() === 'pass').length
    const failed = qcRecords.filter((r) => (r.history.qc_result ?? '').toLowerCase() === 'fail').length
    const borderline = qcRecords.filter((r) => (r.history.qc_result ?? '').toLowerCase() === 'borderline').length
    return { pending: pending.length, passed, failed, borderline }
  }, [qcRecords, pending])

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: C.ink }}>
            Quality Control
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink2, marginTop: 3 }}>
            Log measurements and sign off inspections · failed UIDs go on hold
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: C.ink3 }} />
          <input
            className="input"
            style={{ width: 220, paddingLeft: 32 }}
            placeholder="Search UID code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Metric tiles ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatTile value={counts.pending} label="Pending sign-off" color={counts.pending > 0 ? C.orange : undefined} />
        <StatTile value={counts.passed} label="QC passes logged" color={C.green} />
        <StatTile value={counts.failed} label="QC fails logged" color={counts.failed > 0 ? C.red : undefined} />
        <StatTile value={counts.borderline} label="Borderline flagged" color={counts.borderline > 0 ? C.orange : undefined} />
      </div>

      {(activeError || pendingError) && (
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.red, padding: '12px 16px', background: 'rgba(229,72,77,.10)', borderRadius: 10, border: '1px solid rgba(229,72,77,.25)', marginBottom: 18 }}>
          Could not load UID data. The server may be starting up — refresh in a moment.
        </div>
      )}

      {/* ── Body: pending sign-offs (left) + log measurement (right) ──────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1.5fr) minmax(320px, 1fr)', gap: 16, marginBottom: 20, alignItems: 'start' }}>
        {/* Pending sign-offs */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionLabel
            icon={<ShieldCheck size={13} style={{ color: C.ink3 }} />}
            right={pending.length > 0
              ? <span style={{ ...pill, background: 'rgba(245,158,11,.16)', color: C.orange }}>{pending.length} waiting</span>
              : undefined}
          >Pending Sign-offs</SectionLabel>

          {pendingLoading && (pendingRows ?? []).length === 0 ? (
            <div style={{ fontFamily: MONO, fontSize: 12, color: C.ink3, padding: '20px 0' }}>Loading QC queue…</div>
          ) : pending.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '24px 0', color: C.ink3, fontFamily: SANS, fontSize: 13 }}>
              <CheckCircle2 size={16} style={{ color: C.green }} />
              No UIDs awaiting QC sign-off.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pending.map((u) => {
                const onHold = u.status === 'on_hold'
                const isSelected = selectedUid === u.id
                const isPending = pendingUid === u.id
                return (
                  <div
                    key={u.id}
                    onClick={() => setSelectedUid(isSelected ? null : u.id)}
                    className="row-hover"
                    style={{
                      padding: '12px 14px',
                      borderRadius: 11,
                      cursor: 'pointer',
                      background: isSelected ? C.surface3 : C.surface2,
                      border: `1px solid ${isSelected ? C.accent : onHold ? 'rgba(229,72,77,.25)' : C.line}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: C.ink }}>{u.code}</span>
                      <span style={{ ...pill, background: 'rgba(45,111,181,.14)', color: C.accent }}>{u.cycle_type_name}</span>
                      <span style={{ ...pill, background: C.surface3, color: C.ink2 }}>{inferCheckType(u.current_step_name)}</span>
                      {onHold && <span style={{ ...pill, background: 'rgba(229,72,77,.13)', color: C.redText }}>On Hold</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12.5, color: C.ink2 }}>
                      <span style={{ fontFamily: MONO, color: C.ink3 }}>Step {u.current_step_number ?? '—'}</span>
                      <span>{u.current_step_name ?? '—'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, fontFamily: MONO, fontSize: 10.5, color: C.ink3 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Factory size={11} />
                        {workstationFor(u)}
                      </span>
                      {u.current_storage_code && <span>· {u.current_storage_code}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: MONO, fontSize: 10.5, color: C.ink3 }}>
                        <Clock size={11} />
                        waiting {waiting(u.created_at)}
                      </span>
                    </div>

                    {/* Inline action panel for the selected pending item */}
                    {isSelected && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: 10 }}
                      >
                        <MeasurementsRecap uid={u} />
                        {canSignOff ? (
                          <>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <button
                                className="btn-primary"
                                style={{ height: 32, fontSize: 12, background: C.green }}
                                disabled={isPending}
                                onClick={() => signOff.mutate({ uid_id: u.id, result: 'pass' })}
                              >
                                <CheckCircle2 size={14} />
                                {isPending ? 'Saving…' : 'Pass'}
                              </button>
                              <button
                                className="btn-secondary"
                                style={{ height: 32, fontSize: 12, color: C.redText, borderColor: 'rgba(229,72,77,.35)' }}
                                disabled={isPending}
                                onClick={() => signOff.mutate({ uid_id: u.id, result: 'fail' })}
                                title="Fail places the UID on hold and alerts the supervisor."
                              >
                                <XCircle size={14} />
                                Fail
                              </button>
                              <button
                                className="btn-secondary"
                                style={{ height: 32, fontSize: 12, color: C.orange, borderColor: 'rgba(245,158,11,.35)' }}
                                disabled={isPending}
                                onClick={() => signOff.mutate({ uid_id: u.id, result: 'borderline' })}
                                title="Borderline flags the UID for supervisor review without advancing it."
                              >
                                <RotateCcw size={14} />
                                Borderline
                              </button>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 9.5, color: C.ink3, letterSpacing: '0.04em' }}>
                              <Info size={11} />
                              Pass advances the UID · Fail holds it &amp; alerts the supervisor · Borderline flags for review.
                            </div>
                          </>
                        ) : (
                          <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.ink3 }}>
                            Supervisor sign-off required — your role cannot pass/fail this UID.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Log QC measurement */}
        <LogMeasurementForm
          selected={selected}
          loggedBy={user?.full_name ?? user?.username ?? '—'}
          canSignOff={canSignOff}
          isPending={selected != null && pendingUid === selected.id}
          onSignOff={(result, values, notes) => {
            if (!selected) return
            signOff.mutate({ uid_id: selected.id, result, values, notes })
          }}
        />
      </div>

      {/* ── QC history log ───────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '18px 20px' }}>
        <SectionLabel
          icon={<ClipboardList size={13} style={{ color: C.ink3 }} />}
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', gap: 3, background: C.surface3, borderRadius: 9, padding: 3 }}>
                {(['all', 'pass', 'fail', 'borderline'] as const).map((k) => {
                  const on = resultFilter === k
                  return (
                    <button
                      key={k}
                      onClick={() => setResultFilter(k)}
                      style={{
                        border: 'none', borderRadius: 7, padding: '5px 11px', cursor: 'pointer',
                        background: on ? C.surface : 'transparent', color: on ? C.ink : C.ink2,
                        boxShadow: on ? 'var(--shadow-e1)' : 'none',
                        fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
                      }}
                    >
                      {k}
                    </button>
                  )
                })}
              </div>
              <button
                className="btn-secondary"
                style={{ height: 30, fontSize: 11 }}
                disabled={filteredRecords.length === 0}
                onClick={() => exportCsv(filteredRecords)}
                title="Export the filtered QC history to CSV"
              >
                <Download size={13} />
                CSV
              </button>
            </div>
          }
        >QC History Log</SectionLabel>

        {filteredRecords.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '20px 0', color: C.ink3, fontFamily: SANS, fontSize: 13 }}>
            <AlertTriangle size={15} style={{ color: C.ink3, marginTop: 1, flexShrink: 0 }} />
            <span>
              No QC records to show. QC measurements are sourced from each UID's step history (qc_result entries);
              the list endpoint may not embed history, so detailed records can be sparse until a dedicated QC-records
              endpoint is available.
            </span>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', margin: '0 -8px' }}>
            <table className="es-table" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>UID</th>
                  <th>Step</th>
                  <th>Check Type</th>
                  <th>Measured</th>
                  <th>Result</th>
                  <th>Logged By</th>
                  <th>Supervisor Sign-off</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((r) => {
                  const h = r.history
                  const measured = formatMeasured(h.qc_values)
                  return (
                    <tr key={`${r.uid.id}-${h.id}`}>
                      <td style={{ fontFamily: MONO, color: C.ink2, whiteSpace: 'nowrap' }}>{fmtDate(h.performed_at)}</td>
                      <td style={{ fontFamily: MONO, fontWeight: 600, color: C.accent }}>{r.uid.code}</td>
                      <td style={{ color: C.ink2 }}>
                        <span style={{ fontFamily: MONO, color: C.ink3, marginRight: 5 }}>{h.step_number}</span>
                        {h.operation_name}
                      </td>
                      <td style={{ color: C.ink2 }}>{inferCheckType(h.operation_name)}</td>
                      <td style={{ fontFamily: MONO, color: measured === '—' ? C.ink3 : C.ink }}>{measured}</td>
                      <td><span style={resultStyle(h.qc_result)}>{(h.qc_result ?? '—').toUpperCase()}</span></td>
                      <td style={{ color: C.ink2 }}>{h.performed_by ?? '—'}</td>
                      <td style={{ color: C.ink2, fontFamily: MONO, fontSize: 11 }}>{signOffLabel(h.qc_result)}</td>
                      <td style={{ color: C.ink2, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {h.notes ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22, fontFamily: MONO, fontSize: 10, color: C.ink3, letterSpacing: '0.06em' }}>
        <Clock size={11} />
        Live data refreshes every 30s.
      </div>
    </div>
  )
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */
function waiting(iso: string) {
  try { return formatDistanceToNowStrict(new Date(iso)) } catch { return '—' }
}
function fmtDate(iso: string) {
  try { return format(new Date(iso), 'dd MMM HH:mm') } catch { return '—' }
}
/* CSV export of the (filtered) QC history — spec PAGE 10 "Exportable to CSV". */
function exportCsv(records: QcRecord[]) {
  const headers = [
    'Date', 'UID', 'Step', 'Operation', 'Check Type',
    'Measured', 'Result', 'Logged By', 'Supervisor Sign-off', 'Notes',
  ]
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = records.map((r) => {
    const h = r.history
    return [
      fmtDate(h.performed_at),
      r.uid.code,
      h.step_number,
      h.operation_name,
      inferCheckType(h.operation_name),
      formatMeasured(h.qc_values),
      (h.qc_result ?? '').toUpperCase(),
      h.performed_by ?? '',
      signOffLabel(h.qc_result),
      h.notes ?? '',
    ].map(esc).join(',')
  })
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `qc-history-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
/* Supervisor sign-off state derived from the QC result. A recorded pass on a
   QC step advanced the UID (so it was signed off); fail/borderline reflect their
   review state. No dedicated sign-off field exists on the step-history payload. */
function signOffLabel(result?: string | null): string {
  switch ((result ?? '').toLowerCase()) {
    case 'pass': return 'Signed off'
    case 'fail': return 'Held — review'
    case 'borderline': return 'Awaiting review'
    default: return 'Pending'
  }
}
/* Workstation for a pending UID. The qc/pending payload resolves the current
   workstation directly; fall back to the most recent step-history workstation. */
function workstationFor(u: UID): string {
  const direct = (u as { workstation?: string | null }).workstation
  if (direct) return direct
  const ws = (u.step_history ?? [])
    .slice()
    .sort((a, b) => new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime())
    .find((h) => h.workstation_code)?.workstation_code
  return ws ?? '—'
}
function formatMeasured(values?: Record<string, unknown> | null): string {
  if (!values || typeof values !== 'object') return '—'
  const entries = Object.entries(values).filter(([, v]) => v != null && v !== '')
  if (entries.length === 0) return '—'
  return entries.map(([k, v]) => `${k}: ${String(v)}`).join(', ')
}

/* ── Stat tile (mirrors ProductionFloor) ────────────────────────────────────── */
function StatTile({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '14px 18px', minWidth: 0 }}>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 700, fontSize: 26, letterSpacing: '-0.03em', lineHeight: 1, color: color ?? C.ink }}>
        {value}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3, marginTop: 5 }}>
        {label}
      </div>
    </div>
  )
}

/* ── Measurements already logged by operator on the selected UID ────────────── */
function MeasurementsRecap({ uid }: { uid: UID }) {
  const latestQc = useMemo(() => {
    const withQc = (uid.step_history ?? []).filter((h) => h.qc_result || (h.qc_values && Object.keys(h.qc_values).length))
    return withQc.sort((a, b) => new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime())[0] ?? null
  }, [uid])

  if (!latestQc) {
    return (
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.ink3 }}>
        No operator measurements logged yet for this UID.
      </div>
    )
  }
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, padding: '9px 11px' }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.ink3, marginBottom: 5 }}>
        Logged measurement
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: C.ink }}>
        <Ruler size={13} style={{ color: C.ink3 }} />
        <span style={{ fontFamily: MONO }}>{formatMeasured(latestQc.qc_values)}</span>
        {latestQc.qc_result && <span style={resultStyle(latestQc.qc_result)}>{latestQc.qc_result.toUpperCase()}</span>}
      </div>
      {latestQc.notes && (
        <div style={{ fontSize: 11.5, color: C.ink2, marginTop: 4 }}>{latestQc.notes}</div>
      )}
    </div>
  )
}

/* ── Log QC measurement form (right panel, PAGE 10 spec) ─────────────────────── */
function LogMeasurementForm({
  selected,
  loggedBy,
  canSignOff,
  isPending,
  onSignOff,
}: {
  selected: UID | null
  loggedBy: string
  canSignOff: boolean
  isPending: boolean
  onSignOff: (result: 'pass' | 'fail' | 'borderline', values: Record<string, unknown>, notes?: string) => void
}) {
  const [uidCode, setUidCode] = useState('')
  const [checkType, setCheckType] = useState<CheckType>('Hardness HRC')
  const [measured, setMeasured] = useState('')
  const [result, setResult] = useState<ResultKind>('Pass')
  const [notes, setNotes] = useState('')

  const effectiveCode = selected?.code ?? uidCode
  const stepLabel = selected
    ? `${selected.current_step_number ?? '—'} — ${selected.current_step_name ?? '—'}`
    : 'Select a pending UID'
  const needsNotes = result === 'Fail' || result === 'Borderline'
  const isMeasurable = MEASURABLE.has(checkType)

  // The measured values object posted to the QC endpoint (keyed by check type).
  const buildValues = (): Record<string, unknown> => {
    const v: Record<string, unknown> = {}
    if (isMeasurable && measured.trim() !== '') {
      const num = Number(measured)
      v[checkType] = Number.isNaN(num) ? measured.trim() : num
    } else if (!isMeasurable) {
      v[checkType] = result
    }
    return v
  }

  const canSubmit =
    !!selected && canSignOff && !isPending &&
    (!needsNotes || notes.trim() !== '') &&
    (!isMeasurable || measured.trim() !== '')

  const submit = () => {
    if (!canSubmit) return
    const apiResult = result.toLowerCase() as 'pass' | 'fail' | 'borderline'
    onSignOff(apiResult, buildValues(), notes.trim() || undefined)
    setMeasured('')
    setNotes('')
    setResult('Pass')
  }

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <SectionLabel icon={<Ruler size={13} style={{ color: C.ink3 }} />}>Log QC Measurement</SectionLabel>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label className="label">UID (scan or type)</label>
          <input
            className="input"
            placeholder="UID code…"
            value={effectiveCode}
            disabled={!!selected}
            onChange={(e) => setUidCode(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Step</label>
          <input className="input" value={stepLabel} disabled />
        </div>

        <div>
          <label className="label">QC Check Type</label>
          <select className="input" value={checkType} onChange={(e) => setCheckType(e.target.value as CheckType)}>
            {CHECK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label className="label">Measured Value</label>
          <input
            className="input"
            type={isMeasurable ? 'number' : 'text'}
            placeholder={isMeasurable ? 'Numeric value' : 'N/A for non-measurable checks'}
            value={measured}
            disabled={!isMeasurable}
            onChange={(e) => setMeasured(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Result</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['Pass', 'Fail', 'Borderline'] as ResultKind[]).map((r) => {
              const on = result === r
              const color = r === 'Pass' ? C.green : r === 'Fail' ? C.red : C.orange
              return (
                <button
                  key={r}
                  onClick={() => setResult(r)}
                  style={{
                    flex: 1, height: 34, borderRadius: 9, cursor: 'pointer',
                    border: `1px solid ${on ? color : C.line}`,
                    background: on ? `${color}1f` : C.surface,
                    color: on ? color : C.ink2,
                    fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
                  }}
                >
                  {r}
                </button>
              )
            })}
          </div>
          {result === 'Fail' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontFamily: MONO, fontSize: 9.5, color: C.redText, letterSpacing: '0.03em' }}>
              <AlertTriangle size={11} />
              On save, the UID is placed on hold automatically and the supervisor is alerted.
            </div>
          )}
          {result === 'Borderline' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontFamily: MONO, fontSize: 9.5, color: C.orange, letterSpacing: '0.03em' }}>
              <Info size={11} />
              Flagged for supervisor review — not held automatically.
            </div>
          )}
        </div>

        <div>
          <label className="label">Notes {needsNotes ? '(required)' : '(optional)'}</label>
          <textarea
            className="input"
            style={{ minHeight: 62 }}
            placeholder={needsNotes ? 'Reason required for Fail / Borderline…' : 'Optional notes…'}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Logged By</label>
          <input className="input" value={loggedBy} disabled />
        </div>

        <button className="btn-primary" disabled={!canSubmit} onClick={submit}>
          <CheckCircle2 size={14} />
          {isPending ? 'Saving…' : 'Save & sign off'}
        </button>

        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontFamily: MONO, fontSize: 9.5, color: C.ink3, letterSpacing: '0.04em' }}>
            <Info size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            Select a UID from Pending Sign-offs to record its measurement and sign off.
          </div>
        ) : !canSignOff ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontFamily: MONO, fontSize: 9.5, color: C.ink3, letterSpacing: '0.04em' }}>
            <Info size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            Supervisor sign-off required — your role cannot pass/fail this UID.
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontFamily: MONO, fontSize: 9.5, color: C.ink3, letterSpacing: '0.04em' }}>
            <Info size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            Records the measured values and signs off via QC — Pass advances · Fail holds &amp; alerts · Borderline flags for review.
          </div>
        )}
      </div>
    </div>
  )
}
