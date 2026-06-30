import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useApp } from '../store/AppContext';
import { useAuth } from '../store/AuthContext';
import { uidsApi } from '../api/uids';
import { shiftsApi, employeesApi, workstationAssignmentsApi } from '../api/resources';
import Icon from '../components/common/Icon';
import { StatusPill, PriorityBadge } from '../components/common/Badges';

/* ──────────────────────────────────────────────────────────────────────────
   PAGE 20 — JOB ASSIGNMENT (rebuilt model, authoritative)

   The supervisor assigns WORKSTATIONS to operators for the current shift.
   Three columns: unassigned workstations (left) → operator board (centre) →
   shift summary (right). A workstation is the draggable unit; dropping it on an
   operator card adds that station to the operator (and therefore the station's
   queued UIDs land in that operator's queue on the Production Floor).

   Furnace workstations (HT70/HT80/HT90) are supervisor-run batch steps and can
   never be allotted to an operator — the drop is blocked entirely.

   At ~12k jobs the unassigned-jobs list is search-first + server-capped, so the
   queued-UID preview inside a workstation is fetched on demand via
   uidsApi.list({ search, status:'active', order:'priority', limit:60 }) rather
   than dumping the whole floor.
   ────────────────────────────────────────────────────────────────────────── */

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";

const T_PRIMARY = 'var(--text-primary, #15366a)';
const T_SECONDARY = 'var(--text-secondary, #5d7188)';
const T_MUTED = 'var(--text-muted, #9bb4d4)';

/* Furnace workstations are supervisor-run batches, never operator-allottable. */
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

/* Which factory a workstation belongs to — FAR-* and the welding bench are
   Faridabad; everything else is Dharmapuri. */
function isFaridabadStation(code) {
  const c = String(code || '').toUpperCase();
  return c.startsWith('FAR-') || c.startsWith('WELD');
}

/* The required badge for a workstation — best-effort across field names. */
function requiredBadge(ws) {
  return pick(ws, 'required_badge', 'badge', 'badge_code', 'skill', 'required_skill', 'workstation_type_code', 'type_code');
}

/* Does this operator hold the badge a workstation needs? Tolerant of the
   several shapes employees/badges come back in. */
function operatorHoldsBadge(op, badge) {
  if (!badge) return true; // no requirement → always qualified
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

/* ── small presentational atoms ──────────────────────────────────────────── */

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

/* ── left panel: one workstation row (DROP TARGET for an operator) ───────── */

function WorkstationRow({ ws, draggingOp, onDropOperator }) {
  const furnace = isFurnace(ws.code);
  const status = queueStatus(ws.queued, ws.running);
  const [over, setOver] = useState(false);
  const canDrop = !!draggingOp && !furnace;

  return (
    <div
      onDragOver={(e) => { if (!canDrop) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (canDrop) onDropOperator(ws);
      }}
      style={{
        border: '1px solid ' + (over ? 'var(--status-success, #22a06b)' : 'var(--border-card, #e3ebde)'),
        borderRadius: 'var(--radius-lg, 11px)',
        background: over ? 'var(--bg-soft-green, #e7ece4)' : 'var(--bg-card, #fff)',
        padding: '11px 13px',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        outline: over ? '2px dashed var(--status-success, #22a06b)' : 'none',
        outlineOffset: 2,
        transition: 'background 0.1s, outline 0.1s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {!furnace && <Icon name="grid" size={13} color={T_MUTED} />}
        <Mono style={{ fontSize: 12.5, fontWeight: 700, color: T_PRIMARY }}>{ws.code}</Mono>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            fontWeight: 700,
            color: ws.queued ? 'var(--text-primary, #15366a)' : T_MUTED,
            background: 'var(--bg-muted, #f4f7f2)',
            borderRadius: 'var(--radius-sm, 5px)',
            padding: '2px 7px',
          }}
          title="Queue depth — UIDs waiting"
        >
          queue:{ws.queued}
        </span>
      </div>

      {ws.name ? (
        <div style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY, marginTop: -2 }}>{ws.name}</div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <StatusPill status={status} label={QUEUE_STATUS_LABEL[status]} />
        {ws.ops && ws.ops.length ? (
          <span className="badge" style={{ background: 'rgba(45,111,181,0.14)', color: 'var(--cycle-eat, #2d6fb5)' }}>
            {ws.ops.length} op{ws.ops.length === 1 ? '' : 's'}
          </span>
        ) : null}
        {furnace ? (
          <span className="badge" style={{ background: 'rgba(192,118,43,0.14)', color: 'var(--cycle-oven, #c0762b)' }}>
            ◍ FURNACE · SUPERVISOR
          </span>
        ) : null}
      </div>

      {ws.ops && ws.ops.length ? (
        <div style={{ fontFamily: SANS, fontSize: 11, color: T_SECONDARY }}>
          {ws.ops.map((o) => o.name).join(', ')}
        </div>
      ) : null}

      <div style={{ fontFamily: SANS, fontSize: 11, color: over ? 'var(--status-success-dark, #1c7a52)' : T_MUTED }}>
        {furnace
          ? 'Auto-assigned to the supervisor on duty.'
          : over
            ? 'Drop to assign this operator'
            : ws.ops && ws.ops.length
              ? 'Drag another operator here to add'
              : 'Drag an operator here'}
      </div>
    </div>
  );
}

/* ── centre: one operator card (DRAGGABLE; click to pick a machine) ──────── */

function OperatorCard({ op, assignments, allWorkstations, onUnassign, onPickMachine, onDragStartOp, onDragEndOp, isDragging, canAssign, pendingId }) {
  const opId = pick(op, 'id', 'employee_id', 'user_id');
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

  return (
    <div
      className="card"
      draggable={canAssign}
      onDragStart={(e) => onDragStartOp(e, op)}
      onDragEnd={onDragEndOp}
      style={{
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        cursor: canAssign ? 'grab' : 'default',
        opacity: isDragging ? 0.5 : 1,
        transition: 'opacity 0.1s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          {canAssign ? <Icon name="grid" size={13} color={T_MUTED} /> : null}
          <div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15.5, letterSpacing: '-0.02em', color: T_PRIMARY }}>
              {name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              {empId ? <Mono style={{ fontSize: 11, color: T_SECONDARY }}>{empId}</Mono> : null}
              <span className="badge" style={{ background: 'rgba(45,111,181,0.14)', color: 'var(--cycle-eat, #2d6fb5)' }}>
                {String(role).toUpperCase()}
              </span>
            </div>
          </div>
        </div>
        <StatusPill status={assignments.length ? 'active' : 'idle'} label={assignments.length ? 'WORKING' : 'IDLE'} />
      </div>

      {/* skill badges held */}
      <div>
        <Label style={{ marginBottom: 6 }}>Skill badges</Label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {heldBadges.length ? (
            heldBadges.map((b) => <BadgeChip key={b} code={b} ok />)
          ) : (
            <span style={{ fontFamily: SANS, fontSize: 12, color: T_MUTED }}>No badges on file</span>
          )}
        </div>
      </div>

      {/* assigned workstation chips */}
      <div>
        <Label style={{ marginBottom: 6 }}>
          Assigned workstations {assignments.length ? `· ${assignments.length}` : ''}
        </Label>
        {assignments.length === 0 ? (
          <div
            style={{
              border: '1.5px dashed var(--border-input, #d6e0d2)',
              borderRadius: 'var(--radius-lg, 11px)',
              padding: '14px 12px',
              textAlign: 'center',
              fontFamily: SANS,
              fontSize: 12,
              color: T_MUTED,
            }}
          >
            Not assigned to any machine yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {assignments.map((a) => {
              const ws = allWorkstations.find((w) => w.code === a.code) || { code: a.code };
              const ok = operatorHoldsBadge(op, requiredBadge(ws));
              const busy = pendingId === a.id;
              return (
                <div
                  key={a.id ?? a.code}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '6px 8px 6px 11px',
                    borderRadius: 'var(--radius-md, 9px)',
                    border: '1px solid ' + (ok ? 'rgba(34,160,107,0.4)' : 'rgba(217,122,43,0.5)'),
                    background: ok ? 'rgba(34,160,107,0.10)' : 'rgba(217,122,43,0.10)',
                  }}
                >
                  <Mono style={{ fontSize: 12, fontWeight: 700, color: T_PRIMARY }}>{a.code}</Mono>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: T_SECONDARY }}>[{a.queued ?? 0}]</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: ok ? 'var(--status-success-dark, #1c7a52)' : 'var(--status-warning, #d97a2b)' }}>
                    {ok ? '✓' : '⚠'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUnassign(a)}
                    disabled={busy}
                    aria-label={`Unassign ${a.code}`}
                    style={{ border: 'none', background: 'transparent', display: 'inline-flex', padding: 2, color: T_SECONDARY }}
                  >
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
          <Icon name="assign" size={13} />
          Assign machine…
        </button>
      ) : null}
    </div>
  );
}

/* ── machine picker: opens from an operator, shows only the machines they can
   run (badge held, or no badge requirement). The authoritative eligible list
   comes from the backend; we intersect it with the unassigned stations on the
   floor for this factory. ──────────────────────────────────────────────── */

function MachinePicker({ op, location, candidateWorkstations, onPick, onClose, busy }) {
  const opId = pick(op, 'id', 'employee_id', 'user_id');
  const opName = pick(op, 'name', 'full_name', 'username') || 'Operator';
  const [elig, setElig] = useState(null); // array of {code,name,requiresBadge,hasBadge}
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

  // Show only machines the operator can run that are still unassigned on the floor.
  const machines = useMemo(() => {
    if (!elig) return [];
    return candidateWorkstations
      .filter((w) => eligByCode[w.code])
      .map((w) => ({ ...w, ...eligByCode[w.code] }))
      .sort((a, b) => (b.hasBadge ? 1 : 0) - (a.hasBadge ? 1 : 0) || b.queued - a.queued);
  }, [elig, eligByCode, candidateWorkstations]);

  return (
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,29,58,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: 20 }}
    >
      <div onMouseDown={(e) => e.stopPropagation()} className="card cp-fade-in" style={{ width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-modal)', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-card, #e3ebde)' }}>
          <div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, color: T_PRIMARY }}>Assign {opName} to a machine</div>
            <div style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY, marginTop: 2 }}>
              Only machines this operator is badged for (or that need no badge).
            </div>
          </div>
          <button onClick={onClose} className="btn btn-sm" style={{ width: 32, padding: 0, justifyContent: 'center' }} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div style={{ padding: '14px 16px', maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loadErr ? (
            <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--status-danger, #e5484d)', padding: 12 }}>{loadErr}</div>
          ) : !elig ? (
            <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, padding: 12 }}>Loading machines…</div>
          ) : machines.length === 0 ? (
            <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, padding: 12 }}>
              No unassigned machines available for {opName} on this floor.
            </div>
          ) : (
            machines.map((w) => (
              <button
                key={w.code}
                type="button"
                disabled={busy}
                onClick={() => onPick(w)}
                className="btn"
                style={{ height: 'auto', padding: '11px 13px', justifyContent: 'flex-start', textAlign: 'left' }}
              >
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

/* ── right: shift summary ────────────────────────────────────────────────── */

function SummaryRow({ label, value, danger }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '9px 0', borderTop: '1px solid var(--bg-muted, #f4f7f2)' }}>
      <span style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY }}>{label}</span>
      <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em', color: danger ? 'var(--status-danger, #e5484d)' : T_PRIMARY }}>
        {value}
      </span>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function JobAssignment() {
  const { location, locationLabel } = useApp();
  const { isSupervisor, isAdmin, isManager } = useAuth();
  const canAssign = isSupervisor || isAdmin; // manager view is read-only

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | waiting | ready | in_progress
  const [dragging, setDragging] = useState(null); // the operator being dragged
  const [pickerOp, setPickerOp] = useState(null); // operator whose machine picker is open
  const [pendingId, setPendingId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const reqRef = useRef(0);

  // Live data: current shift, the operators on it, the station roster + queue
  // depths, and the existing workstation→operator assignments. All polled
  // together so the board stays current as UIDs advance.
  const { data, loading, error, refetch } = usePolling(
    async () => {
      const shift = await shiftsApi.current(location).then((r) => r.data).catch(() => null);
      const shiftId = pick(shift || {}, 'id', 'shift_id');

      const [stations, employees, assignments] = await Promise.all([
        uidsApi.stationSummary().then((r) => r.data).catch(() => []),
        employeesApi
          .list({ location, role: 'operator', on_shift: true, shift_id: shiftId })
          .then((r) => r.data)
          .catch(() => []),
        workstationAssignmentsApi
          .list(shiftId)
          .then((r) => r.data)
          .catch(() => []),
      ]);

      return {
        shift,
        shiftId,
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

  // Build a clean workstation list with code/name/queue/running.
  const allWorkstations = useMemo(
    () =>
      stations.map((s) => ({
        code: s.code,
        name: s.name,
        queued: Number(pick(s, 'queued', 'queue_depth', 'waiting_count')) || 0,
        running: Number(pick(s, 'active_count', 'running', 'in_progress_count')) || 0,
        required_badge: requiredBadge(s),
      })),
    [stations]
  );

  // Scope the board to the selected factory — FAR-*/WELD for Faridabad, the rest
  // for Dharmapuri. (No 'both' on this page; it follows the factory toggle.)
  const workstations = useMemo(() => {
    if (location === 'both') return allWorkstations;
    const far = location === 'faridabad';
    return allWorkstations.filter((w) => isFaridabadStation(w.code) === far);
  }, [allWorkstations, location]);

  // assignments grouped by operator id, enriched with each station's queue depth.
  const assignmentsByOperator = useMemo(() => {
    const wsByCode = {};
    for (const w of workstations) wsByCode[w.code] = w;
    const map = new Map();
    for (const a of rawAssignments) {
      const opId = pick(a, 'operator_id', 'employee_id', 'user_id', 'assigned_to');
      const code = pick(a, 'workstation_code', 'code', 'workstation', 'station_code');
      const entry = {
        id: pick(a, 'id', 'assignment_id'),
        code,
        queued: wsByCode[code]?.queued ?? Number(pick(a, 'queued', 'queue_depth')) ?? 0,
      };
      if (!map.has(opId)) map.set(opId, []);
      map.get(opId).push(entry);
    }
    return map;
  }, [rawAssignments, workstations]);

  // Operators assigned per workstation code — a workstation can be run by
  // SEVERAL operators (e.g. a two-person machine), so we track all of them.
  const opsByCode = useMemo(() => {
    const map = {};
    for (const a of rawAssignments) {
      const code = pick(a, 'workstation_code', 'code', 'workstation', 'station_code');
      const name = pick(a, 'full_name', 'name', 'employee_name') || pick(a, 'employee_code', 'emp_code') || 'Operator';
      if (!map[code]) map[code] = [];
      map[code].push({ id: pick(a, 'operator_id', 'employee_id'), name });
    }
    return map;
  }, [rawAssignments]);

  const assignedCodes = useMemo(() => new Set(Object.keys(opsByCode)), [opsByCode]);

  // The board shows EVERY factory workstation (so already-staffed machines can
  // still take another operator), search + queue-status filtered. Unstaffed
  // machines with a queue float to the top.
  const boardWorkstations = useMemo(() => {
    const q = search.trim().toUpperCase();
    return workstations
      .map((w) => ({ ...w, ops: opsByCode[w.code] || [] }))
      .filter((w) => {
        if (q && !`${w.code} ${w.name || ''}`.toUpperCase().includes(q)) return false;
        if (statusFilter !== 'all' && queueStatus(w.queued, w.running) !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => (a.ops.length === 0 ? 0 : 1) - (b.ops.length === 0 ? 0 : 1) || b.queued - a.queued);
  }, [workstations, opsByCode, search, statusFilter]);

  // ── shift summary figures (factory-scoped) ──
  const totalStations = workstations.length;
  const assignedCount = workstations.filter((w) => assignedCodes.has(w.code)).length;
  const unassignedAll = workstations.filter((w) => !assignedCodes.has(w.code));
  const unassignedWithQueue = unassignedAll.filter((w) => w.queued > 0 && !isFurnace(w.code));
  const idleOperators = operators.filter((op) => !(assignmentsByOperator.get(pick(op, 'id', 'employee_id', 'user_id')) || []).length).length;
  const totalQueued = workstations.reduce((s, w) => s + w.queued, 0);

  /* ── assign / unassign actions ── */

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
        await workstationAssignmentsApi.assign({
          shiftId,
          employeeId: opId,
          workstationCode: ws.code,
          overrideBadgeWarning: !qualified || undefined,
        });
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
      setPendingId(assignment.id);
      setActionError(null);
      try {
        await workstationAssignmentsApi.unassign(assignment.id);
        await refetch();
      } catch (err) {
        setActionError(err?.message || 'Could not unassign the workstation.');
      } finally {
        setPendingId(null);
      }
    },
    [canAssign, refetch]
  );

  // Operator is the draggable unit now — drop it on a workstation to assign.
  const onDragStartOp = (e, op) => {
    setDragging(op);
    try {
      e.dataTransfer.setData(DRAG_MIME, String(pick(op, 'id', 'employee_id', 'user_id')));
      e.dataTransfer.effectAllowed = 'move';
    } catch {
      /* some browsers restrict setData — state covers us */
    }
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
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: T_PRIMARY }}>
          Job Assignment
        </div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, marginTop: 4 }}>
          {locationLabel} · drag an operator onto a machine, or click an operator to pick a machine they're badged for
          {data?.shift ? ` · ${pick(data.shift, 'name', 'shift_name', 'label') || `Shift ${shiftId ?? ''}`}` : ''}
          {loading && !data ? ' · loading…' : ''}
          {isManager && !isAdmin ? ' · read-only' : ''}
        </div>
      </div>
      <button className="btn btn-sm" onClick={refetch} type="button">
        <Icon name="refresh" size={14} />
        Refresh
      </button>
    </div>
  );

  if (error && !data) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
        {header}
        <div className="card" style={{ marginTop: 20, padding: 32, textAlign: 'center' }}>
          <div style={{ color: 'var(--status-danger, #e5484d)', display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <Icon name="alert" size={26} />
          </div>
          <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: T_PRIMARY }}>Could not load the assignment board</div>
          <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginTop: 4 }}>{error?.message || 'Something went wrong.'}</div>
          <button className="btn btn-primary btn-sm" type="button" onClick={refetch} style={{ marginTop: 14 }}>
            <Icon name="refresh" size={14} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr) minmax(200px, 240px)', gap: 18, marginTop: 18, alignItems: 'start' }}>
        {/* ── LEFT: unassigned workstations ── */}
        <div className="card" style={{ padding: '16px 16px', position: 'sticky', top: 18 }}>
          <Label style={{ marginBottom: 10 }}>Workstations · {workstations.length}</Label>

          <div style={{ position: 'relative', marginBottom: 10 }}>
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: T_MUTED }}>
              <Icon name="search" size={14} />
            </span>
            <input
              className="form-input"
              style={{ height: 36, paddingLeft: 32, borderRadius: 'var(--radius-md, 9px)', fontSize: 12.5 }}
              placeholder="Search workstation…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
            {['all', 'waiting', 'ready', 'in_progress'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className="btn btn-sm"
                style={{
                  height: 28,
                  padding: '0 10px',
                  fontSize: 11,
                  background: statusFilter === s ? 'var(--ink-650, #15366a)' : 'var(--bg-card, #fff)',
                  color: statusFilter === s ? 'var(--text-onink, #eaf4e4)' : T_SECONDARY,
                  border: statusFilter === s ? 'none' : '1px solid var(--border-input, #d6e0d2)',
                }}
              >
                {s === 'in_progress' ? 'IN PROG' : s.toUpperCase()}
              </button>
            ))}
          </div>

          {loading && !data ? (
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, padding: '12px 4px' }}>Loading workstations…</div>
          ) : boardWorkstations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px 8px' }}>
              <Icon name="check" size={24} color="var(--status-success, #22a06b)" />
              <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginTop: 8 }}>
                {workstations.length === 0
                  ? 'No active workstations for this shift.'
                  : 'No workstations match this filter.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
              {boardWorkstations.map((ws) => (
                <WorkstationRow
                  key={ws.code}
                  ws={ws}
                  draggingOp={canAssign ? dragging : null}
                  onDropOperator={onDropOperatorOnWs}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── CENTRE: operator board ── */}
        <div>
          <Label style={{ marginBottom: 10 }}>Operator board · {operators.length} on shift</Label>
          {loading && !data ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', fontFamily: SANS, fontSize: 13, color: T_SECONDARY }}>
              Loading operators…
            </div>
          ) : operators.length === 0 ? (
            <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
              <Icon name="people" size={26} color={T_MUTED} />
              <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, color: T_PRIMARY, marginTop: 10 }}>No operators on this shift</div>
              <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginTop: 4 }}>
                Once operators are clocked in for the shift, their cards appear here.
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {operators.map((op) => {
                const opId = pick(op, 'id', 'employee_id', 'user_id');
                const dragId = dragging ? pick(dragging, 'id', 'employee_id', 'user_id') : null;
                return (
                  <OperatorCard
                    key={opId}
                    op={op}
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

        {/* ── RIGHT: shift summary ── */}
        <div className="card" style={{ padding: '16px 16px', position: 'sticky', top: 18 }}>
          <Label style={{ marginBottom: 4 }}>Shift summary</Label>
          <SummaryRow label="Workstations assigned" value={`${assignedCount} / ${totalStations}`} />
          <SummaryRow label="Unassigned" value={unassignedAll.length} danger={unassignedWithQueue.length > 0} />
          <SummaryRow label="Operators idle" value={idleOperators} />
          <SummaryRow label="Total UIDs queued" value={totalQueued} />

          {unassignedWithQueue.length > 0 ? (
            <div style={{ marginTop: 14, padding: '11px 12px', borderRadius: 'var(--radius-lg, 11px)', background: 'var(--bg-soft-amber, #fdf6ef)', borderLeft: '3px solid var(--status-warning, #d97a2b)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Icon name="alert" size={14} color="var(--status-warning, #d97a2b)" />
                <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 12, color: 'var(--status-warning, #d97a2b)' }}>
                  {unassignedWithQueue.length} workstation{unassignedWithQueue.length === 1 ? '' : 's'} with a queue unassigned
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {unassignedWithQueue.slice(0, 8).map((w) => (
                  <Mono key={w.code} style={{ fontSize: 10.5, color: 'var(--status-warning, #d97a2b)', background: 'rgba(217,122,43,0.10)', borderRadius: 5, padding: '2px 6px' }}>
                    {w.code}·{w.queued}
                  </Mono>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14, fontFamily: SANS, fontSize: 12, color: T_SECONDARY, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="check" size={14} color="var(--status-success, #22a06b)" />
              Every queued workstation has an operator.
            </div>
          )}
        </div>
      </div>

      {pickerOp && (() => {
        // Any factory machine the operator isn't already on — a machine can be
        // staffed by several operators, so already-staffed ones still qualify.
        const ownCodes = new Set(
          (assignmentsByOperator.get(pick(pickerOp, 'id', 'employee_id', 'user_id')) || []).map((a) => a.code)
        );
        const candidates = workstations
          .map((w) => ({ ...w, ops: opsByCode[w.code] || [] }))
          .filter((w) => !ownCodes.has(w.code));
        return (
          <MachinePicker
            op={pickerOp}
            location={location}
            candidateWorkstations={candidates}
            busy={!!pendingId}
            onClose={() => setPickerOp(null)}
            onPick={(ws) => {
              doAssign(pickerOp, ws, true); // picker only offers eligible machines
              setPickerOp(null);
            }}
          />
        );
      })()}
    </div>
  );
}
