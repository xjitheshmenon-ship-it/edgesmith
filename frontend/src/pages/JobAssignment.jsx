import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useApp } from '../store/AppContext';
import { useAuth } from '../store/AuthContext';
import { uidsApi } from '../api/uids';
import { shiftsApi, employeesApi, workstationAssignmentsApi } from '../api/resources';
import Icon from '../components/common/Icon';
import { StatusPill } from '../components/common/Badges';
import { FurnaceBatchPanel } from './BatchManagement';

/* ──────────────────────────────────────────────────────────────────────────
   PAGE 20 — JOB ASSIGNMENT (operators ← left · workstations → right)

   The supervisor staffs the shift by dragging an OPERATOR (left) onto a
   WORKSTATION (right), or by clicking an operator to pick a machine they're
   badged for. A workstation can require MORE THAN ONE operator (min_operators,
   set in Master Lists) and an operator can run MORE THAN ONE workstation, so
   assignment is many-to-many. Workstations below their minimum are highlighted
   as understaffed.

   Furnace workstations (HT70/HT80/HT90) run as supervisor batches and can never
   be allotted to an operator — the drop is blocked.
   ────────────────────────────────────────────────────────────────────────── */

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";

const T_PRIMARY = 'var(--text-primary, #15366a)';
const T_SECONDARY = 'var(--text-secondary, #5d7188)';
const T_MUTED = 'var(--text-muted, #9bb4d4)';

const FURNACE_CODES = ['HT70', 'HT80', 'HT90'];
const DRAG_MIME = 'application/cpcms-workstation';

function pick(obj, ...keys) {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] != null) return obj[k];
  return undefined;
}

function isFurnace(code) {
  const c = String(code || '').toUpperCase();
  return FURNACE_CODES.some((f) => c.startsWith(f));
}

function isFaridabadStation(code) {
  const c = String(code || '').toUpperCase();
  return c.startsWith('FAR-') || c.startsWith('WELD');
}

function requiredBadge(ws) {
  return pick(ws, 'required_badge', 'badge', 'badge_code', 'skill', 'required_skill', 'workstation_type_code', 'type_code');
}

function operatorHoldsBadge(op, badge) {
  if (!badge) return true;
  const held = pick(op, 'badges', 'skills', 'certifications', 'badge_codes') || [];
  const codes = (Array.isArray(held) ? held : []).map((b) =>
    String(typeof b === 'string' ? b : pick(b, 'code', 'badge_code', 'skill', 'name') || '').toUpperCase()
  );
  return codes.includes(String(badge).toUpperCase());
}

function queueStatus(depth, running) {
  if (running > 0) return 'in_progress';
  if (depth > 0) return 'ready';
  return 'waiting';
}
const QUEUE_STATUS_LABEL = { in_progress: 'IN PROGRESS', ready: 'READY', waiting: 'WAITING' };

/* ── atoms ───────────────────────────────────────────────────────────────── */

function Label({ children, style }) {
  return (
    <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: T_MUTED, ...style }}>
      {children}
    </div>
  );
}
function Mono({ children, style }) {
  return <span style={{ fontFamily: MONO, ...style }}>{children}</span>;
}
function BadgeChip({ code, ok }) {
  const color = ok ? 'var(--status-success, #22a06b)' : 'var(--status-neutral, #9aa0a6)';
  return (
    <span className="badge" style={{ background: ok ? 'rgba(34,160,107,0.14)' : 'rgba(154,160,166,0.14)', color }}>
      {ok ? '✓ ' : ''}{code}
    </span>
  );
}

/* Staffing meter — filled dots up to min, plus a +N pill when over-staffed. */
function StaffMeter({ count, min }) {
  const dots = Math.max(min, 1);
  const over = Math.max(0, count - min);
  const understaffed = count < min;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {Array.from({ length: dots }).map((_, i) => {
          const filled = i < count;
          return (
            <span key={i} style={{
              width: 8, height: 8, borderRadius: '50%',
              background: filled ? 'var(--status-success, #22a06b)' : 'transparent',
              border: `1.5px solid ${filled ? 'var(--status-success, #22a06b)' : (understaffed ? 'var(--status-warning, #d97a2b)' : 'var(--border-input, #d6e0d2)')}`,
              transition: 'background 0.2s, border-color 0.2s',
            }} />
          );
        })}
      </div>
      <Mono style={{ fontSize: 10.5, fontWeight: 700, color: understaffed ? 'var(--status-warning, #d97a2b)' : 'var(--status-success-dark, #1c7a52)' }}>
        {count}/{min}
      </Mono>
      {over > 0 ? <Mono style={{ fontSize: 10, color: T_MUTED }}>+{over}</Mono> : null}
    </div>
  );
}

/* ── right column: one workstation (DROP TARGET for an operator) ─────────── */

function WorkstationRow({ ws, index, draggingOp, flash, onDropOperator, onUnassignOp }) {
  const furnace = isFurnace(ws.code);
  const status = queueStatus(ws.queued, ws.running);
  const [over, setOver] = useState(false);
  const canDrop = !!draggingOp && !furnace;
  const opCount = ws.ops ? ws.ops.length : 0;
  const min = ws.min_operators || 1;
  const understaffed = !furnace && opCount < min;

  const cls = ['ja-drop', 'ja-rise'];
  if (canDrop) cls.push('ja-drop-armed');
  if (over) cls.push('ja-drop-over');
  if (understaffed && !over) cls.push('ja-understaffed');
  if (flash) cls.push('ja-flash-ok');

  return (
    <div
      className={cls.join(' ')}
      style={{ '--ja-i': index }}
      onDragOver={(e) => { if (!canDrop) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (canDrop) onDropOperator(ws); }}
    >
      <div style={{
        border: '1px solid ' + (over ? 'var(--status-success, #22a06b)' : understaffed ? 'rgba(217,122,43,0.55)' : 'var(--border-card, #e3ebde)'),
        borderRadius: 'var(--radius-lg, 11px)',
        background: over ? 'var(--bg-soft-green, #e7ece4)' : 'var(--bg-card, #fff)',
        padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!furnace && <Icon name="grid" size={13} color={T_MUTED} />}
          <Mono style={{ fontSize: 12.5, fontWeight: 700, color: T_PRIMARY }}>{ws.code}</Mono>
          <div style={{ flex: 1 }} />
          <span style={{
            fontFamily: MONO, fontSize: 10.5, fontWeight: 700,
            color: ws.queued ? T_PRIMARY : T_MUTED, background: 'var(--bg-muted, #f4f7f2)',
            borderRadius: 'var(--radius-sm, 5px)', padding: '2px 7px',
          }} title="Queue depth — UIDs waiting">queue:{ws.queued}</span>
        </div>

        {ws.name ? <div style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY, marginTop: -3 }}>{ws.name}</div> : null}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <StatusPill status={status} label={QUEUE_STATUS_LABEL[status]} />
          {furnace ? (
            <span className="badge" style={{ background: 'rgba(192,118,43,0.14)', color: 'var(--cycle-oven, #c0762b)' }}>◍ FURNACE · SUPERVISOR</span>
          ) : (
            <StaffMeter count={opCount} min={min} />
          )}
        </div>

        {/* assigned operator chips (removable) */}
        {!furnace && opCount > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ws.ops.map((o) => (
              <span key={o.id ?? o.name} className="ja-chip-in" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 9px',
                borderRadius: 'var(--radius-md, 9px)', border: '1px solid rgba(34,160,107,0.35)', background: 'rgba(34,160,107,0.10)',
                fontFamily: SANS, fontSize: 11.5, color: T_PRIMARY,
              }}>
                {o.name}
                {o.assignmentId != null && onUnassignOp ? (
                  <button type="button" onClick={() => onUnassignOp(o.assignmentId)} aria-label={`Unassign ${o.name}`}
                    style={{ border: 'none', background: 'transparent', display: 'inline-flex', padding: 1, color: T_SECONDARY, cursor: 'pointer' }}>
                    <Icon name="close" size={12} />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}

        <div style={{ fontFamily: SANS, fontSize: 11, color: over ? 'var(--status-success-dark, #1c7a52)' : understaffed ? 'var(--status-warning, #d97a2b)' : T_MUTED }}>
          {furnace ? 'Auto-assigned to the supervisor on duty.'
            : over ? 'Drop to assign this operator'
              : understaffed ? `Needs ${min - opCount} more operator${min - opCount === 1 ? '' : 's'} — drag an operator here`
                : 'Fully staffed · drag another operator to add'}
        </div>
      </div>
    </div>
  );
}

/* ── left column: one operator card (DRAGGABLE; click to pick a machine) ─── */

function OperatorCard({ op, index, assignments, allWorkstations, onUnassign, onPickMachine, onDragStartOp, onDragEndOp, isDragging, canAssign, pendingId }) {
  const name = pick(op, 'name', 'full_name', 'username') || 'Operator';
  const empId = pick(op, 'emp_code', 'employee_code', 'emp_id', 'code');
  const role = pick(op, 'role', 'role_name') || 'operator';
  const totalQueue = assignments.reduce((sum, a) => sum + (a.queued || 0), 0);

  const heldBadges = useMemo(() => {
    const held = pick(op, 'badges', 'skills', 'certifications', 'badge_codes') || [];
    return (Array.isArray(held) ? held : []).map((b) =>
      String(typeof b === 'string' ? b : pick(b, 'code', 'badge_code', 'skill', 'name') || '')
    ).filter(Boolean);
  }, [op]);

  const cls = ['card', 'ja-op', 'ja-rise'];
  if (canAssign) cls.push('ja-op-grab');
  if (isDragging) cls.push('ja-op-dragging');

  return (
    <div
      className={cls.join(' ')}
      draggable={canAssign}
      onDragStart={(e) => onDragStartOp(e, op)}
      onDragEnd={onDragEndOp}
      style={{ '--ja-i': index, padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 12, cursor: canAssign ? 'grab' : 'default' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          {canAssign ? <Icon name="grid" size={13} color={T_MUTED} /> : null}
          <div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15.5, letterSpacing: '-0.02em', color: T_PRIMARY }}>{name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              {empId ? <Mono style={{ fontSize: 11, color: T_SECONDARY }}>{empId}</Mono> : null}
              <span className="badge" style={{ background: 'rgba(45,111,181,0.14)', color: 'var(--cycle-eat, #2d6fb5)' }}>{String(role).toUpperCase()}</span>
            </div>
          </div>
        </div>
        <StatusPill status={assignments.length ? 'active' : 'idle'} label={assignments.length ? 'WORKING' : 'IDLE'} />
      </div>

      <div>
        <Label style={{ marginBottom: 6 }}>Skill badges</Label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {heldBadges.length ? heldBadges.map((b) => <BadgeChip key={b} code={b} ok />)
            : <span style={{ fontFamily: SANS, fontSize: 12, color: T_MUTED }}>No badges on file</span>}
        </div>
      </div>

      <div>
        <Label style={{ marginBottom: 6 }}>Assigned workstations {assignments.length ? `· ${assignments.length}` : ''}</Label>
        {assignments.length === 0 ? (
          <div style={{ border: '1.5px dashed var(--border-input, #d6e0d2)', borderRadius: 'var(--radius-lg, 11px)', padding: '12px', textAlign: 'center', fontFamily: SANS, fontSize: 12, color: T_MUTED }}>
            Not assigned to any machine yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {assignments.map((a) => {
              const ws = allWorkstations.find((w) => w.code === a.code) || { code: a.code };
              const ok = operatorHoldsBadge(op, requiredBadge(ws));
              const busy = pendingId === a.id;
              return (
                <div key={a.id ?? a.code} className="ja-chip-in" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 8px 6px 11px', borderRadius: 'var(--radius-md, 9px)',
                  border: '1px solid ' + (ok ? 'rgba(34,160,107,0.4)' : 'rgba(217,122,43,0.5)'),
                  background: ok ? 'rgba(34,160,107,0.10)' : 'rgba(217,122,43,0.10)',
                }}>
                  <Mono style={{ fontSize: 12, fontWeight: 700, color: T_PRIMARY }}>{a.code}</Mono>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: T_SECONDARY }}>[{a.queued ?? 0}]</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: ok ? 'var(--status-success-dark, #1c7a52)' : 'var(--status-warning, #d97a2b)' }}>{ok ? '✓' : '⚠'}</span>
                  <button type="button" onClick={() => onUnassign(a)} disabled={busy} aria-label={`Unassign ${a.code}`}
                    style={{ border: 'none', background: 'transparent', display: 'inline-flex', padding: 2, color: T_SECONDARY, cursor: 'pointer' }}>
                    <Icon name="close" size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {assignments.length ? (
        <div style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY, borderTop: '1px solid var(--border-card, #e3ebde)', paddingTop: 10 }}>
          Total queue: <strong style={{ color: T_PRIMARY }}>{totalQueue}</strong> UIDs across {assignments.length} workstation{assignments.length === 1 ? '' : 's'}
        </div>
      ) : null}

      {canAssign ? (
        <button className="btn btn-sm" type="button" onClick={() => onPickMachine(op)} style={{ justifyContent: 'center' }}>
          <Icon name="assign" size={13} />Assign machine…
        </button>
      ) : null}
    </div>
  );
}

/* ── machine picker (opens from an operator) ─────────────────────────────── */

function MachinePicker({ op, location, candidateWorkstations, onPick, onClose, busy }) {
  const opId = pick(op, 'id', 'employee_id', 'user_id');
  const opName = pick(op, 'name', 'full_name', 'username') || 'Operator';
  const [elig, setElig] = useState(null);
  const [loadErr, setLoadErr] = useState(null);

  useEffect(() => {
    let live = true;
    setElig(null); setLoadErr(null);
    workstationAssignmentsApi
      .eligibleWorkstations(opId, location)
      .then((r) => { if (live) setElig(Array.isArray(r.data) ? r.data : []); })
      .catch((e) => { if (live) setLoadErr(e.message || 'Could not load eligible machines.'); });
    return () => { live = false; };
  }, [opId, location]);

  const eligByCode = useMemo(() => {
    const m = {};
    (elig || []).forEach((w) => { m[w.code] = w; });
    return m;
  }, [elig]);

  const machines = useMemo(() => {
    if (!elig) return [];
    return candidateWorkstations
      .filter((w) => eligByCode[w.code])
      .map((w) => ({ ...w, ...eligByCode[w.code] }))
      .sort((a, b) => (b.hasBadge ? 1 : 0) - (a.hasBadge ? 1 : 0) || b.queued - a.queued);
  }, [elig, eligByCode, candidateWorkstations]);

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,29,58,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: 20 }}>
      <div onMouseDown={(e) => e.stopPropagation()} className="card cp-fade-in" style={{ width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-modal)', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-card, #e3ebde)' }}>
          <div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, color: T_PRIMARY }}>Assign {opName} to a machine</div>
            <div style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY, marginTop: 2 }}>Only machines this operator is badged for (or that need no badge).</div>
          </div>
          <button onClick={onClose} className="btn btn-sm" style={{ width: 32, padding: 0, justifyContent: 'center' }} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div style={{ padding: '14px 16px', maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loadErr ? (
            <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--status-danger, #e5484d)', padding: 12 }}>{loadErr}</div>
          ) : !elig ? (
            <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, padding: 12 }}>Loading machines…</div>
          ) : machines.length === 0 ? (
            <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, padding: 12 }}>No unassigned machines available for {opName} on this floor.</div>
          ) : (
            machines.map((w) => (
              <button key={w.code} type="button" disabled={busy} onClick={() => onPick(w)} className="btn" style={{ height: 'auto', padding: '11px 13px', justifyContent: 'flex-start', textAlign: 'left' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 13, color: T_PRIMARY }}>
                    <Mono style={{ fontSize: 12.5 }}>{w.code}</Mono>{w.name ? <span style={{ fontWeight: 500, color: T_SECONDARY }}> · {w.name}</span> : null}
                  </div>
                  <Mono style={{ fontSize: 11, color: T_SECONDARY }}>queue {w.queued ?? 0}{w.ops && w.ops.length ? ` · ${w.ops.length} on machine` : ''}</Mono>
                </div>
                {w.hasBadge ? (
                  <span className="badge" style={{ background: 'rgba(34,160,107,0.14)', color: 'var(--status-success, #22a06b)' }}>✓ BADGED</span>
                ) : (
                  <span className="badge" style={{ background: 'rgba(154,160,166,0.16)', color: 'var(--text-secondary, #5d7188)' }}>OPEN</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ── stat tile (top strip) ───────────────────────────────────────────────── */

function StatTile({ label, value, tone }) {
  const color = tone === 'danger' ? 'var(--status-danger, #e5484d)' : tone === 'warn' ? 'var(--status-warning, #d97a2b)' : tone === 'ok' ? 'var(--status-success-dark, #1c7a52)' : T_PRIMARY;
  return (
    <div className="card ja-rise" style={{ padding: '12px 15px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 130 }}>
      <Label>{label}</Label>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em', color }}>{value}</div>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function JobAssignment() {
  const { location, locationLabel } = useApp();
  const { isSupervisor, isAdmin, isManager } = useAuth();
  const canAssign = isSupervisor || isAdmin;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dragging, setDragging] = useState(null);
  const [pickerOp, setPickerOp] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [flashCode, setFlashCode] = useState(null);
  const reqRef = useRef(0);
  const flashTimer = useRef(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const { data, loading, error, refetch } = usePolling(
    async () => {
      const shift = await shiftsApi.current(location).then((r) => r.data).catch(() => null);
      const shiftId = pick(shift || {}, 'id', 'shift_id');
      const [stations, employees, assignments] = await Promise.all([
        uidsApi.stationSummary().then((r) => r.data).catch(() => []),
        employeesApi.list({ location, role: 'operator', on_shift: true, shift_id: shiftId }).then((r) => r.data).catch(() => []),
        workstationAssignmentsApi.list(shiftId).then((r) => r.data).catch(() => []),
      ]);
      return {
        shift, shiftId,
        stations: Array.isArray(stations) ? stations : stations?.items || [],
        employees: Array.isArray(employees) ? employees : employees?.items || [],
        assignments: Array.isArray(assignments) ? assignments : assignments?.items || [],
      };
    },
    [location]
  );

  const shiftId = data?.shiftId;
  const stations = data?.stations || [];
  const operators = data?.employees || [];
  const rawAssignments = data?.assignments || [];

  const allWorkstations = useMemo(
    () => stations.map((s) => ({
      code: s.code,
      name: s.name,
      queued: Number(pick(s, 'queued', 'queue_depth', 'waiting_count')) || 0,
      running: Number(pick(s, 'active_count', 'running', 'in_progress_count')) || 0,
      min_operators: Number(pick(s, 'min_operators', 'minOperators')) || 1,
      required_badge: requiredBadge(s),
    })),
    [stations]
  );

  const workstations = useMemo(() => {
    if (location === 'both') return allWorkstations;
    const far = location === 'faridabad';
    return allWorkstations.filter((w) => isFaridabadStation(w.code) === far);
  }, [allWorkstations, location]);

  const assignmentsByOperator = useMemo(() => {
    const wsByCode = {};
    for (const w of workstations) wsByCode[w.code] = w;
    const map = new Map();
    for (const a of rawAssignments) {
      const opId = pick(a, 'operator_id', 'employee_id', 'user_id', 'assigned_to');
      const code = pick(a, 'workstation_code', 'code', 'workstation', 'station_code');
      const entry = { id: pick(a, 'id', 'assignment_id'), code, queued: wsByCode[code]?.queued ?? Number(pick(a, 'queued', 'queue_depth')) ?? 0 };
      if (!map.has(opId)) map.set(opId, []);
      map.get(opId).push(entry);
    }
    return map;
  }, [rawAssignments, workstations]);

  // Operators assigned per workstation code (a workstation may have several).
  const opsByCode = useMemo(() => {
    const map = {};
    for (const a of rawAssignments) {
      const code = pick(a, 'workstation_code', 'code', 'workstation', 'station_code');
      const name = pick(a, 'full_name', 'name', 'employee_name') || pick(a, 'employee_code', 'emp_code') || 'Operator';
      if (!map[code]) map[code] = [];
      map[code].push({ id: pick(a, 'operator_id', 'employee_id'), assignmentId: pick(a, 'id', 'assignment_id'), name });
    }
    return map;
  }, [rawAssignments]);

  const boardWorkstations = useMemo(() => {
    const q = search.trim().toUpperCase();
    return workstations
      .map((w) => ({ ...w, ops: opsByCode[w.code] || [] }))
      .filter((w) => {
        if (q && !`${w.code} ${w.name || ''}`.toUpperCase().includes(q)) return false;
        if (statusFilter !== 'all' && queueStatus(w.queued, w.running) !== statusFilter) return false;
        return true;
      })
      // understaffed (below min) first, then by queue depth
      .sort((a, b) => {
        const au = !isFurnace(a.code) && a.ops.length < (a.min_operators || 1) ? 0 : 1;
        const bu = !isFurnace(b.code) && b.ops.length < (b.min_operators || 1) ? 0 : 1;
        return au - bu || b.queued - a.queued;
      });
  }, [workstations, opsByCode, search, statusFilter]);

  // ── shift summary figures (min-operator aware) ──
  const totalStations = workstations.filter((w) => !isFurnace(w.code)).length;
  const staffedOk = workstations.filter((w) => !isFurnace(w.code) && (opsByCode[w.code]?.length || 0) >= (w.min_operators || 1)).length;
  const understaffed = workstations.filter((w) => !isFurnace(w.code) && (opsByCode[w.code]?.length || 0) < (w.min_operators || 1));
  const understaffedWithQueue = understaffed.filter((w) => w.queued > 0);
  const idleOperators = operators.filter((op) => !(assignmentsByOperator.get(pick(op, 'id', 'employee_id', 'user_id')) || []).length).length;
  const totalQueued = workstations.reduce((s, w) => s + w.queued, 0);

  /* ── assign / unassign ── */

  const flashOk = (code) => {
    setFlashCode(code);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashCode(null), 750);
  };

  const doAssign = useCallback(
    async (op, ws, override) => {
      if (!canAssign) return;
      if (isFurnace(ws.code)) {
        setActionError(`${ws.code} is a furnace step — it runs as a supervisor batch and cannot be allotted to an operator.`);
        return;
      }
      const opId = pick(op, 'id', 'employee_id', 'user_id');
      const badge = requiredBadge(ws);
      const qualified = operatorHoldsBadge(op, badge);
      if (!qualified && !override) {
        const name = pick(op, 'name', 'full_name', 'username') || 'This operator';
        const ok = window.confirm(`${name} does not hold ${badge} certification. Assign anyway?`);
        if (!ok) return;
      }
      const myReq = ++reqRef.current;
      setPendingId(`assign:${opId}:${ws.code}`);
      setActionError(null);
      try {
        await workstationAssignmentsApi.assign({ shiftId, employeeId: opId, workstationCode: ws.code, overrideBadgeWarning: !qualified || undefined });
        flashOk(ws.code);
        if (myReq === reqRef.current) await refetch();
      } catch (err) {
        setActionError(err?.message || 'Could not assign the workstation.');
      } finally {
        setPendingId(null);
      }
    },
    [canAssign, shiftId, refetch]
  );

  const doUnassign = useCallback(
    async (assignment) => {
      if (!canAssign) return;
      const id = typeof assignment === 'object' ? assignment.id : assignment;
      setPendingId(id);
      setActionError(null);
      try {
        await workstationAssignmentsApi.unassign(id);
        await refetch();
      } catch (err) {
        setActionError(err?.message || 'Could not unassign the workstation.');
      } finally {
        setPendingId(null);
      }
    },
    [canAssign, refetch]
  );

  const onDragStartOp = (e, op) => {
    setDragging(op);
    try {
      e.dataTransfer.setData(DRAG_MIME, String(pick(op, 'id', 'employee_id', 'user_id')));
      e.dataTransfer.effectAllowed = 'move';
    } catch { /* some browsers restrict setData — state covers us */ }
  };
  const onDragEndOp = () => setDragging(null);
  const onDropOperatorOnWs = (ws) => {
    const op = dragging;
    setDragging(null);
    if (op) doAssign(op, ws);
  };

  /* ── render ── */

  const header = (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
      <div>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: T_PRIMARY }}>Job Assignment</div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, marginTop: 4 }}>
          {locationLabel} · drag an operator onto a workstation, or click an operator to pick a machine they're badged for
          {data?.shift ? ` · ${pick(data.shift, 'name', 'shift_name', 'label') || `Shift ${shiftId ?? ''}`}` : ''}
          {loading && !data ? ' · loading…' : ''}
          {isManager && !isAdmin ? ' · read-only' : ''}
        </div>
      </div>
      <button className="btn btn-sm" onClick={refetch} type="button"><Icon name="refresh" size={14} />Refresh</button>
    </div>
  );

  if (error && !data) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1360 }}>
        {header}
        <div className="card" style={{ marginTop: 20, padding: 32, textAlign: 'center' }}>
          <div style={{ color: 'var(--status-danger, #e5484d)', display: 'flex', justifyContent: 'center', marginBottom: 10 }}><Icon name="alert" size={26} /></div>
          <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: T_PRIMARY }}>Could not load the assignment board</div>
          <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginTop: 4 }}>{error?.message || 'Something went wrong.'}</div>
          <button className="btn btn-primary btn-sm" type="button" onClick={refetch} style={{ marginTop: 14 }}><Icon name="refresh" size={14} />Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1360 }}>
      {header}

      {actionError && (
        <div className="card" style={{ marginTop: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderLeft: '4px solid var(--status-danger, #e5484d)' }}>
          <Icon name="alert" size={18} color="#e5484d" />
          <span style={{ fontFamily: SANS, fontSize: 13, color: 'var(--status-danger-dark, #c0392b)', flex: 1 }}>{actionError}</span>
          <button className="btn btn-sm" onClick={() => setActionError(null)}>Dismiss</button>
        </div>
      )}

      {!canAssign && (
        <div className="card" style={{ marginTop: 16, padding: '11px 16px', fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, borderLeft: '4px solid var(--status-blue, #3b82f6)' }}>
          Read-only view — only the shift supervisor (or an admin) can change assignments.
        </div>
      )}

      {/* stat strip */}
      <div style={{ display: 'flex', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
        <StatTile label="Operators on shift" value={operators.length} />
        <StatTile label="Workstations staffed" value={`${staffedOk} / ${totalStations}`} tone={staffedOk >= totalStations ? 'ok' : undefined} />
        <StatTile label="Understaffed" value={understaffed.length} tone={understaffedWithQueue.length > 0 ? 'danger' : understaffed.length > 0 ? 'warn' : 'ok'} />
        <StatTile label="Operators idle" value={idleOperators} />
        <StatTile label="UIDs queued" value={totalQueued} />
      </div>

      {/* two columns: OPERATORS (left) · WORKSTATIONS (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 440px)', gap: 18, marginTop: 18, alignItems: 'start' }}>
        {/* ── LEFT: operators ── */}
        <div>
          <Label style={{ marginBottom: 10 }}>Operators · {operators.length} on shift</Label>
          {loading && !data ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', fontFamily: SANS, fontSize: 13, color: T_SECONDARY }}>Loading operators…</div>
          ) : operators.length === 0 ? (
            <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
              <Icon name="people" size={26} color={T_MUTED} />
              <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, color: T_PRIMARY, marginTop: 10 }}>No operators on this shift</div>
              <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginTop: 4 }}>Once operators are clocked in for the shift, their cards appear here.</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
              {operators.map((op, i) => {
                const opId = pick(op, 'id', 'employee_id', 'user_id');
                const dragId = dragging ? pick(dragging, 'id', 'employee_id', 'user_id') : null;
                return (
                  <OperatorCard
                    key={opId}
                    op={op}
                    index={i}
                    assignments={assignmentsByOperator.get(opId) || []}
                    allWorkstations={allWorkstations}
                    canAssign={canAssign}
                    isDragging={String(dragId) === String(opId)}
                    pendingId={pendingId}
                    onDragStartOp={onDragStartOp}
                    onDragEndOp={onDragEndOp}
                    onPickMachine={setPickerOp}
                    onUnassign={doUnassign}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* ── RIGHT: workstations ── */}
        <div className="card" style={{ padding: '16px 16px', position: 'sticky', top: 18 }}>
          <Label style={{ marginBottom: 10 }}>Workstations · {workstations.length}</Label>

          <div style={{ position: 'relative', marginBottom: 10 }}>
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: T_MUTED }}><Icon name="search" size={14} /></span>
            <input className="form-input" style={{ height: 36, paddingLeft: 32, borderRadius: 'var(--radius-md, 9px)', fontSize: 12.5 }} placeholder="Search workstation…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
            {['all', 'waiting', 'ready', 'in_progress'].map((s) => (
              <button key={s} type="button" onClick={() => setStatusFilter(s)} className="btn btn-sm" style={{
                height: 28, padding: '0 10px', fontSize: 11,
                background: statusFilter === s ? 'var(--ink-650, #15366a)' : 'var(--bg-card, #fff)',
                color: statusFilter === s ? 'var(--text-onink, #eaf4e4)' : T_SECONDARY,
                border: statusFilter === s ? 'none' : '1px solid var(--border-input, #d6e0d2)',
              }}>{s === 'in_progress' ? 'IN PROG' : s.toUpperCase()}</button>
            ))}
          </div>

          {loading && !data ? (
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, padding: '12px 4px' }}>Loading workstations…</div>
          ) : boardWorkstations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px 8px' }}>
              <Icon name="check" size={24} color="var(--status-success, #22a06b)" />
              <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginTop: 8 }}>
                {workstations.length === 0 ? 'No active workstations for this shift.' : 'No workstations match this filter.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
              {boardWorkstations.map((ws, i) => (
                <WorkstationRow
                  key={ws.code}
                  ws={ws}
                  index={i}
                  draggingOp={canAssign ? dragging : null}
                  flash={flashCode === ws.code}
                  onDropOperator={onDropOperatorOnWs}
                  onUnassignOp={canAssign ? doUnassign : null}
                />
              ))}
            </div>
          )}

          {understaffedWithQueue.length > 0 ? (
            <div style={{ marginTop: 14, padding: '11px 12px', borderRadius: 'var(--radius-lg, 11px)', background: 'var(--bg-soft-amber, #fdf6ef)', borderLeft: '3px solid var(--status-warning, #d97a2b)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Icon name="alert" size={14} color="var(--status-warning, #d97a2b)" />
                <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 12, color: 'var(--status-warning, #d97a2b)' }}>
                  {understaffedWithQueue.length} understaffed workstation{understaffedWithQueue.length === 1 ? '' : 's'} with a queue
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {understaffedWithQueue.slice(0, 8).map((w) => (
                  <Mono key={w.code} style={{ fontSize: 10.5, color: 'var(--status-warning, #d97a2b)', background: 'rgba(217,122,43,0.10)', borderRadius: 5, padding: '2px 6px' }}>
                    {w.code}·{(w.ops?.length || 0)}/{w.min_operators || 1}
                  </Mono>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14, fontFamily: SANS, fontSize: 12, color: T_SECONDARY, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="check" size={14} color="var(--status-success, #22a06b)" />Every queued workstation meets its minimum.
            </div>
          )}
        </div>
      </div>

      {/* Furnace batching — supervisor multi-selects queued furnace UIDs. */}
      {location !== 'faridabad' && canAssign && (
        <div style={{ marginTop: 26 }}>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, letterSpacing: '-0.03em', color: T_PRIMARY }}>Furnace batching</div>
          <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginTop: 3 }}>
            Furnace steps run as supervisor batches — multi-select the queued UIDs and assign them to a furnace. The batch then awaits a supervisor&apos;s verification before it starts. (History &amp; verification also on Reports → Batch Tracker.)
          </div>
          <FurnaceBatchPanel showActive={false} />
        </div>
      )}

      {pickerOp && (() => {
        const ownCodes = new Set((assignmentsByOperator.get(pick(pickerOp, 'id', 'employee_id', 'user_id')) || []).map((a) => a.code));
        const candidates = workstations.map((w) => ({ ...w, ops: opsByCode[w.code] || [] })).filter((w) => !ownCodes.has(w.code));
        return (
          <MachinePicker
            op={pickerOp}
            location={location}
            candidateWorkstations={candidates}
            busy={!!pendingId}
            onClose={() => setPickerOp(null)}
            onPick={(ws) => { doAssign(pickerOp, ws, true); setPickerOp(null); }}
          />
        );
      })()}
    </div>
  );
}
