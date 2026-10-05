import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import { useAuth } from '../store/AuthContext';
import { uidsApi } from '../api/uids';
import { shiftsApi, employeesApi, workstationAssignmentsApi } from '../api/resources';
import Icon from '../components/common/Icon';
import { FurnaceBatchPanel } from './BatchManagement';
import { EntityLink, routes } from '../lib/wiring';

/* ──────────────────────────────────────────────────────────────────────────
   PAGE 20 — WORK ASSIGNMENT

   Three columns: OPERATOR BOARD (left) · WORKSTATION BOARD (centre) · SHIFT
   SUMMARY (right). Supervisor staffs the shift by dragging an operator onto a
   workstation, or via inline "Assign…" drawers on either card. Workstations
   carry a min (and optional max) operator count from Master Lists; the board
   enforces the minimum visually (staffing bar, UNDERSTAFFED status) and drives
   auto-assign. Operators may hold several workstations at once.
   ────────────────────────────────────────────────────────────────────────── */

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";
const T_PRIMARY = 'var(--text-primary, #15366a)';
const T_SECONDARY = 'var(--text-secondary, #5d7188)';
const T_MUTED = 'var(--text-muted, #9bb4d4)';
const OK = 'var(--status-success, #22a06b)';
const OK_D = 'var(--status-success-dark, #1c7a52)';
const WARN = 'var(--status-warning, #d97a2b)';
const DANGER = 'var(--status-danger, #e5484d)';
const BLUE = 'var(--status-blue, #2d6fb5)';

const FURNACE_CODES = ['HT70', 'HT80', 'HT90'];

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
function badgeCodesOf(op) {
  const held = pick(op, 'badges', 'skills', 'certifications', 'badge_codes') || [];
  return (Array.isArray(held) ? held : [])
    .map((b) => String(typeof b === 'string' ? b : pick(b, 'code', 'badge_code', 'skill', 'name') || ''))
    .filter(Boolean);
}
function operatorHoldsBadge(op, badge) {
  if (!badge) return true;
  return badgeCodesOf(op).map((c) => c.toUpperCase()).includes(String(badge).toUpperCase());
}
/* Workstation status from staffing + queue. */
function stationStatus(ws, opCount) {
  if (isFurnace(ws.code)) return 'furnace';
  const min = ws.min_operators || 1;
  const running = (ws.running || 0) > 0;
  const queued = (ws.queued || 0) > 0;
  if (opCount < min) return queued || running ? 'understaffed' : 'waiting';
  if (running) return 'in_progress';
  return queued ? 'ready' : 'waiting';
}
const STATUS_META = {
  in_progress: { label: 'IN PROGRESS', color: OK_D, bg: 'rgba(34,160,107,0.14)' },
  ready: { label: 'READY', color: BLUE, bg: 'rgba(45,111,181,0.14)' },
  waiting: { label: 'WAITING', color: T_SECONDARY, bg: 'rgba(154,160,166,0.16)' },
  understaffed: { label: 'UNDERSTAFFED', color: WARN, bg: 'rgba(217,122,43,0.16)' },
  furnace: { label: '◍ FURNACE · SUPERVISOR', color: 'var(--cycle-oven, #c0762b)', bg: 'rgba(192,118,43,0.14)' },
};

/* ── atoms ───────────────────────────────────────────────────────────────── */
function Label({ children, style }) {
  return <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: T_MUTED, ...style }}>{children}</div>;
}
function Mono({ children, style }) { return <span style={{ fontFamily: MONO, ...style }}>{children}</span>; }
function Pill({ status }) {
  const m = STATUS_META[status] || STATUS_META.waiting;
  return <span className="badge" style={{ background: m.bg, color: m.color, transition: 'background .2s, color .2s' }}>{m.label}</span>;
}
function FilterTabs({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} className="btn btn-sm" style={{
          height: 28, padding: '0 10px', fontSize: 10.5,
          background: value === v ? 'var(--ink-650, #15366a)' : 'var(--bg-card, #fff)',
          color: value === v ? 'var(--text-onink, #eaf4e4)' : T_SECONDARY,
          border: value === v ? 'none' : '1px solid var(--border-input, #d6e0d2)',
        }}>{l}</button>
      ))}
    </div>
  );
}
function SearchBox({ value, onChange, placeholder }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: T_MUTED }}><Icon name="search" size={14} /></span>
      <input className="form-input" style={{ height: 34, paddingLeft: 32, borderRadius: 'var(--radius-md, 9px)', fontSize: 12.5 }} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* Min-operator staffing bar: green when met, amber 1 short, red 2+ short. */
function MinBar({ count, min, max }) {
  const short = min - count;
  const barColor = count >= min ? OK : short === 1 ? WARN : DANGER;
  const pct = Math.min(100, Math.round((count / Math.max(min, 1)) * 100));
  const over = max != null && count > max;
  let text;
  if (count < min) text = `${count} / ${min} — needs ${short} more`;
  else if (count === min) text = `${count} / ${min} ✓`;
  else text = `${count} / ${min}  +${count - min} extra`;
  return (
    <div>
      <div style={{ height: 8, borderRadius: 5, background: 'var(--bg-muted, #f4f7f2)', overflow: 'hidden' }}>
        <div className="ja-bar-fill" style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 5 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <Mono style={{ fontSize: 10.5, fontWeight: 700, color: barColor }}>{text}</Mono>
        {over ? <Mono style={{ fontSize: 10, color: WARN }}>above max {max}</Mono> : null}
      </div>
    </div>
  );
}
function BadgeChip({ code, ok = true, small }) {
  return (
    <span className="badge" style={{ background: ok ? 'rgba(34,160,107,0.14)' : 'rgba(217,122,43,0.16)', color: ok ? OK : WARN, fontSize: small ? 9 : undefined }}>
      {ok ? '✓ ' : '⚠ '}{code}
    </span>
  );
}

/* ── OPERATOR CARD (left) ────────────────────────────────────────────────── */
function OperatorCard({ op, index, assignments, workstationsByCode, canAssign, isDragging, pendingId,
  onDragStartOp, onDragEndOp, onRemove, drawerOpen, onToggleDrawer, drawerContent }) {
  const name = pick(op, 'name', 'full_name', 'username') || 'Operator';
  const empId = pick(op, 'emp_code', 'employee_code', 'emp_id', 'code');
  const role = pick(op, 'role', 'role_name') || 'operator';
  const badges = badgeCodesOf(op);
  const totalQueue = assignments.reduce((s, a) => s + (a.queued || 0), 0);
  const status = assignments.length >= 2 ? 'MULTI' : assignments.length === 1 ? 'WORKING' : 'IDLE';
  const statusColor = status === 'MULTI' ? BLUE : status === 'WORKING' ? OK_D : T_SECONDARY;
  const statusBg = status === 'MULTI' ? 'rgba(45,111,181,0.14)' : status === 'WORKING' ? 'rgba(34,160,107,0.14)' : 'rgba(154,160,166,0.16)';

  const cls = ['card', 'ja-op', 'ja-rise'];
  if (canAssign) cls.push('ja-op-grab');
  if (isDragging) cls.push('ja-op-dragging');

  return (
    <div className={cls.join(' ')} draggable={canAssign} onDragStart={(e) => onDragStartOp(e, op)} onDragEnd={onDragEndOp}
      style={{ '--ja-i': index, padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 11, cursor: canAssign ? 'grab' : 'default' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          {canAssign ? <span style={{ color: T_MUTED, letterSpacing: -2, fontSize: 13, lineHeight: '15px', userSelect: 'none' }}>⣿⣿</span> : null}
          <div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', color: T_PRIMARY }}>{name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 2 }}>
              {empId ? <Mono style={{ fontSize: 10.5, color: T_SECONDARY }}>{empId}</Mono> : null}
              <span className="badge" style={{ background: 'rgba(45,111,181,0.14)', color: BLUE }}>{String(role).toUpperCase()}</span>
            </div>
          </div>
        </div>
        <span className="badge" style={{ background: statusBg, color: statusColor }}>{status === 'MULTI' ? '◎ MULTI' : status === 'WORKING' ? '● WORKING' : '○ IDLE'}</span>
      </div>

      <div>
        <Label style={{ marginBottom: 5 }}>Skill badges</Label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {badges.length ? badges.map((b) => <BadgeChip key={b} code={b} />) : <span style={{ fontFamily: SANS, fontSize: 12, color: T_MUTED }}>No badges on file</span>}
        </div>
      </div>

      <div>
        <Label style={{ marginBottom: 5 }}>Assigned workstations {assignments.length ? `· ${assignments.length}` : ''}</Label>
        {assignments.length === 0 ? (
          <div style={{ border: '1.5px dashed var(--border-input, #d6e0d2)', borderRadius: 10, padding: '10px', textAlign: 'center', fontFamily: SANS, fontSize: 12, color: T_MUTED }}>Not assigned to any machine yet</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {assignments.map((a) => {
              const ws = workstationsByCode[a.code] || { code: a.code };
              const ok = operatorHoldsBadge(op, ws.required_badge);
              return (
                <span key={a.id ?? a.code} className="ja-chip-in" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 7px 5px 10px', borderRadius: 9,
                  border: '1px solid ' + (ok ? 'rgba(34,160,107,0.4)' : 'rgba(217,122,43,0.5)'), background: ok ? 'rgba(34,160,107,0.10)' : 'rgba(217,122,43,0.10)',
                }}>
                  <Mono style={{ fontSize: 11.5, fontWeight: 700, color: T_PRIMARY }}>{a.code}</Mono>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: T_SECONDARY }}>[{a.queued ?? 0}]</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: ok ? OK_D : WARN }}>{ok ? '✓' : '⚠'}</span>
                  {canAssign ? (
                    <button type="button" onClick={() => onRemove(a, ws)} disabled={pendingId === a.id} aria-label={`Remove ${a.code}`}
                      style={{ border: 'none', background: 'transparent', display: 'inline-flex', padding: 1, color: T_SECONDARY, cursor: 'pointer' }}><Icon name="close" size={12} /></button>
                  ) : null}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {assignments.length ? (
        <div style={{ fontFamily: SANS, fontSize: 11.5, color: T_SECONDARY }}>
          Total queue: <strong style={{ color: T_PRIMARY }}>{totalQueue}</strong> UIDs across {assignments.length} station{assignments.length === 1 ? '' : 's'}
        </div>
      ) : null}

      {canAssign ? (
        <button className="btn btn-sm" type="button" onClick={onToggleDrawer} style={{ justifyContent: 'center' }}>
          <Icon name={drawerOpen ? 'close' : 'assign'} size={13} />{drawerOpen ? 'Close' : 'Assign workstation…'}
        </button>
      ) : null}

      {drawerOpen ? drawerContent : null}
    </div>
  );
}

/* Method B — inline drawer of workstations for an operator. */
function AssignWorkstationDrawer({ op, location, workstations, assignedCodes, onAssign, onClose }) {
  const opId = pick(op, 'id', 'employee_id', 'user_id');
  const [elig, setElig] = useState(null);
  useEffect(() => {
    let live = true;
    workstationAssignmentsApi.eligibleWorkstations(opId, location)
      .then((r) => { if (live) setElig(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (live) setElig([]); });
    return () => { live = false; };
  }, [opId, location]);

  const eligByCode = useMemo(() => { const m = {}; (elig || []).forEach((w) => { m[w.code] = w; }); return m; }, [elig]);
  const eligible = workstations.filter((w) => eligByCode[w.code]).sort((a, b) => (a.short === b.short ? b.queued - a.queued : b.short - a.short));
  const warnings = workstations.filter((w) => !eligByCode[w.code] && !isFurnace(w.code) && w.required_badge);

  return (
    <div className="ja-drawer-in" style={{ marginTop: 4, borderTop: '1px solid var(--border-card, #e3ebde)', paddingTop: 10 }}>
      <Label style={{ marginBottom: 6 }}>Eligible workstations</Label>
      {elig == null ? <div style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY }}>Loading…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 240, overflowY: 'auto' }}>
          {eligible.length === 0 ? <div style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY }}>No eligible workstations.</div> : eligible.map((w) => {
            const assigned = assignedCodes.has(w.code);
            return (
              <button key={w.code} type="button" disabled={assigned} onClick={() => onAssign(w, false)} style={{
                textAlign: 'left', border: '1px solid var(--border-input, #d6e0d2)', borderRadius: 8, padding: '7px 9px',
                background: assigned ? 'var(--bg-muted, #f4f7f2)' : 'var(--bg-card, #fff)', cursor: assigned ? 'default' : 'pointer', opacity: assigned ? 0.6 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <Mono style={{ fontSize: 12, fontWeight: 700, color: T_PRIMARY }}>{w.code}</Mono>
                  <Mono style={{ fontSize: 10.5, color: assigned ? T_MUTED : w.short > 0 ? WARN : T_SECONDARY }}>
                    {assigned ? 'already assigned' : w.short > 0 ? `needs ${w.short} more` : 'at minimum'}
                  </Mono>
                </div>
                <div style={{ fontFamily: SANS, fontSize: 11, color: T_SECONDARY }}>{w.name} · queue {w.queued}</div>
              </button>
            );
          })}
        </div>
      )}
      {warnings.length ? (
        <>
          <Label style={{ margin: '10px 0 6px' }}>Other workstations (badge warning)</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 140, overflowY: 'auto' }}>
            {warnings.map((w) => (
              <button key={w.code} type="button" onClick={() => onAssign(w, true)} style={{ textAlign: 'left', border: '1px solid rgba(217,122,43,0.4)', borderRadius: 8, padding: '7px 9px', background: 'rgba(217,122,43,0.06)', cursor: 'pointer' }}>
                <Mono style={{ fontSize: 12, fontWeight: 700, color: T_PRIMARY }}>△ {w.code}</Mono>
                <div style={{ fontFamily: SANS, fontSize: 11, color: WARN }}>requires {w.required_badge} badge</div>
              </button>
            ))}
          </div>
        </>
      ) : null}
      <button className="btn btn-sm" type="button" onClick={onClose} style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}>Cancel</button>
    </div>
  );
}

/* ── WORKSTATION CARD (centre) ───────────────────────────────────────────── */
function WorkstationCard({ ws, index, ops, draggingOp, flash, canAssign, operatorsById,
  onDropOperator, onRemove, drawerOpen, onToggleDrawer, drawerContent }) {
  const furnace = isFurnace(ws.code);
  const min = ws.min_operators || 1;
  const status = stationStatus(ws, ops.length);
  const [over, setOver] = useState(false);
  const [shake, setShake] = useState(false);
  const canDrop = !!draggingOp && !furnace;
  const understaffed = !furnace && ops.length < min;
  const dragOpAssigned = draggingOp && ops.some((o) => String(o.id) === String(pick(draggingOp, 'id', 'employee_id', 'user_id')));
  const dragOpBadgeOk = draggingOp ? operatorHoldsBadge(draggingOp, ws.required_badge) : true;

  const cls = ['ja-drop', 'ja-rise'];
  if (canDrop) cls.push('ja-drop-armed');
  if (over && canDrop) cls.push('ja-drop-over');
  if (understaffed && !over) cls.push('ja-understaffed');
  if (flash) cls.push('ja-flash-ok');
  if (shake) cls.push('ja-shake');

  function handleDrop(e) {
    e.preventDefault(); setOver(false);
    if (!canDrop) return;
    if (dragOpAssigned) { setShake(true); setTimeout(() => setShake(false), 320); return; }
    onDropOperator(ws, !dragOpBadgeOk);
  }

  const dropText = furnace ? 'Auto-assigned to supervisor'
    : dragOpAssigned ? 'Already assigned'
      : !dragOpBadgeOk && draggingOp ? `⚠ ${ws.required_badge} required`
        : over ? 'Release to assign →' : 'Drop operator here ↓';
  const dropColor = furnace ? T_MUTED : dragOpAssigned ? T_MUTED : !dragOpBadgeOk && draggingOp ? WARN : over ? OK_D : T_MUTED;

  return (
    <div className={cls.join(' ')} style={{ '--ja-i': index }}
      onDragOver={(e) => { if (!canDrop) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); }}
      onDragLeave={() => setOver(false)} onDrop={handleDrop}>
      <div style={{
        border: '1px solid ' + (over && canDrop ? OK : understaffed ? 'rgba(217,122,43,0.55)' : 'var(--border-card, #e3ebde)'),
        borderRadius: 'var(--radius-lg, 11px)', background: over && canDrop ? 'var(--bg-soft-green, #e7ece4)' : 'var(--bg-card, #fff)',
        padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!furnace && <span style={{ color: T_MUTED, letterSpacing: -2, fontSize: 12, userSelect: 'none' }}>⣿⣿</span>}
          <div>
            <Mono style={{ fontSize: 13, fontWeight: 700, color: T_PRIMARY }}>{ws.code}</Mono>
            {ws.name ? <div style={{ fontFamily: SANS, fontSize: 11.5, color: T_SECONDARY }}>{ws.name}</div> : null}
          </div>
          <div style={{ flex: 1 }} />
          <Mono style={{ fontSize: 10.5, fontWeight: 700, color: ws.queued ? T_PRIMARY : T_MUTED, background: 'var(--bg-muted, #f4f7f2)', borderRadius: 5, padding: '2px 7px' }}>queue: {ws.queued}</Mono>
        </div>

        {!furnace ? (
          <div>
            <Label style={{ marginBottom: 5 }}>Minimum operators</Label>
            <MinBar count={ops.length} min={min} max={ws.max_operators} />
          </div>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Pill status={status} />
          {ws.required_badge ? <span className="badge" style={{ background: 'rgba(45,111,181,0.12)', color: BLUE }}>badge: {ws.required_badge}</span> : null}
        </div>

        {!furnace ? (
          <div>
            <Label style={{ marginBottom: 6 }}>Assigned operators {ops.length ? `· ${ops.length}` : ''}</Label>
            {ops.length === 0 ? (
              <div style={{ fontFamily: SANS, fontSize: 12, color: T_MUTED }}>No operators assigned.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {ops.map((o) => {
                  const full = operatorsById[String(o.id)];
                  const badgeOk = ws.required_badge ? operatorHoldsBadge(full, ws.required_badge) : true;
                  return (
                    <div key={o.assignmentId ?? o.id} className="ja-chip-in card" style={{ padding: '7px 9px', minWidth: 118, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <EntityLink to={o.id != null ? routes.employee(o.id) : null} title="Open employee profile" style={{ fontWeight: 700, fontSize: 12, color: T_PRIMARY }}>{o.name}</EntityLink>
                        {canAssign ? <button type="button" onClick={() => onRemove(o, ws)} aria-label={`Remove ${o.name}`} style={{ border: 'none', background: 'transparent', padding: 1, color: T_SECONDARY, cursor: 'pointer', display: 'inline-flex' }}><Icon name="close" size={12} /></button> : null}
                      </div>
                      {o.empCode ? <Mono style={{ fontSize: 9.5, color: T_SECONDARY }}>{o.empCode}</Mono> : null}
                      {ws.required_badge ? <Mono style={{ fontSize: 9.5, color: badgeOk ? OK_D : WARN }}>{badgeOk ? '✓' : '⚠'} {ws.required_badge}</Mono> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontFamily: SANS, fontSize: 11.5, color: T_SECONDARY }}>Furnace steps run as supervisor batches — assign via the Furnace batching panel below.</div>
        )}

        {!furnace && canAssign ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-sm" type="button" onClick={onToggleDrawer}><Icon name={drawerOpen ? 'close' : 'assign'} size={13} />{drawerOpen ? 'Close' : 'Assign operator…'}</button>
            <span style={{ flex: 1, textAlign: 'right', fontFamily: SANS, fontSize: 11, color: dropColor }}>{dropText}</span>
          </div>
        ) : null}

        {drawerOpen ? drawerContent : null}
      </div>
    </div>
  );
}

/* Method C — inline drawer of operators for a workstation (multi-select). */
function AssignOperatorDrawer({ ws, location, operators, assignedIds, onAssign, onClose }) {
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(new Set());
  useEffect(() => {
    let live = true;
    workstationAssignmentsApi.eligibleOperators(ws.code, location)
      .then((r) => { if (live) setData(r.data || { requiresBadge: false, operators: [] }); })
      .catch(() => { if (live) setData({ requiresBadge: false, operators: [] }); });
    return () => { live = false; };
  }, [ws.code, location]);

  const eligibleIds = useMemo(() => new Set((data?.operators || []).map((o) => String(o.id))), [data]);
  const badged = (data?.operators || []).filter((o) => !assignedIds.has(String(o.id)));
  const others = operators.filter((o) => {
    const id = String(pick(o, 'id', 'employee_id', 'user_id'));
    return !eligibleIds.has(id) && !assignedIds.has(id);
  });
  const min = ws.min_operators || 1;
  const need = Math.max(0, min - (ws.opCount || 0));

  function toggle(id) { setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function commit() {
    const chosen = [];
    sel.forEach((id) => { const warn = !eligibleIds.has(String(id)); chosen.push({ id, warn }); });
    onAssign(chosen);
  }

  return (
    <div className="ja-drawer-in" style={{ marginTop: 4, borderTop: '1px solid var(--border-card, #e3ebde)', paddingTop: 10 }}>
      <div style={{ fontFamily: SANS, fontSize: 11.5, color: T_SECONDARY, marginBottom: 6 }}>
        Minimum {min} · {need > 0 ? `${need} more needed` : 'minimum met'}{ws.required_badge ? ` · requires ${ws.required_badge}` : ''}
      </div>
      {data == null ? <div style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY }}>Loading…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 260, overflowY: 'auto' }}>
          {badged.map((o) => {
            const id = String(o.id);
            return (
              <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border-input, #d6e0d2)', borderRadius: 8, padding: '7px 9px', cursor: 'pointer' }}>
                <input type="checkbox" checked={sel.has(id)} onChange={() => toggle(id)} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 12, color: T_PRIMARY }}>{o.full_name}</span>
                  <Mono style={{ fontSize: 10, color: T_SECONDARY, marginLeft: 6 }}>{o.employee_code}</Mono>
                </div>
                {ws.required_badge ? <BadgeChip code={ws.required_badge} small /> : null}
              </label>
            );
          })}
          {others.length ? <Label style={{ margin: '8px 0 4px' }}>Other operators (no {ws.required_badge || 'badge'})</Label> : null}
          {others.map((o) => {
            const id = String(pick(o, 'id', 'employee_id', 'user_id'));
            return (
              <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid rgba(217,122,43,0.35)', borderRadius: 8, padding: '7px 9px', cursor: 'pointer', background: 'rgba(217,122,43,0.05)' }}>
                <input type="checkbox" checked={sel.has(id)} onChange={() => toggle(id)} />
                <span style={{ flex: 1, fontFamily: SANS, fontWeight: 700, fontSize: 12, color: T_PRIMARY }}>△ {pick(o, 'name', 'full_name', 'username')}</span>
                <Mono style={{ fontSize: 10, color: WARN }}>no badge</Mono>
              </label>
            );
          })}
          {!badged.length && !others.length ? <div style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY }}>No available operators.</div> : null}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" type="button" disabled={!sel.size} onClick={commit} style={{ flex: 1, justifyContent: 'center' }}>Assign selected{sel.size ? ` (${sel.size})` : ''}</button>
        <button className="btn btn-sm" type="button" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/* ── modals ──────────────────────────────────────────────────────────────── */
function Overlay({ children, onClose }) {
  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,29,58,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, padding: 20 }}>
      <div onMouseDown={(e) => e.stopPropagation()} className="card ja-drawer-in" style={{ width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-modal)', padding: 20 }}>{children}</div>
    </div>
  );
}
function OverrideModal({ op, ws, onCancel, onConfirm, busy }) {
  const [reason, setReason] = useState('');
  const name = pick(op, 'name', 'full_name', 'username') || 'This operator';
  return (
    <Overlay onClose={onCancel}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icon name="alert" size={18} color={WARN} />
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 16, color: T_PRIMARY }}>Badge warning</div>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, marginBottom: 12 }}>
        {name} does not hold a valid <strong>{ws.required_badge}</strong> badge for {ws.code}. Assigning anyway requires a reason (logged to the audit trail).
      </div>
      <label className="form-label">Reason *</label>
      <textarea className="form-input" style={{ height: 60, padding: '8px 12px', resize: 'vertical' }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this override necessary?" />
      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-sm" type="button" disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim())}>Assign anyway — log reason</button>
      </div>
    </Overlay>
  );
}
function RemoveModal({ payload, onCancel, onConfirm, busy }) {
  const { opName, ws } = payload;
  return (
    <Overlay onClose={onCancel}>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 16, color: T_PRIMARY, marginBottom: 8 }}>Remove {opName} from {ws.code}?</div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY }}>
        This workstation has <strong>{ws.queued}</strong> UID{ws.queued === 1 ? '' : 's'} queued. Removing this operator may leave {ws.code} understaffed.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={onConfirm}>Remove anyway</button>
      </div>
    </Overlay>
  );
}

/* ── stat tile ───────────────────────────────────────────────────────────── */
function SummaryRow({ label, value, tone }) {
  const color = tone === 'danger' ? DANGER : tone === 'warn' ? WARN : tone === 'ok' ? OK_D : T_PRIMARY;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '9px 0', borderTop: '1px solid var(--bg-muted, #f4f7f2)' }}>
      <span style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY }}>{label}</span>
      <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em', color }}>{value}</span>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */
export default function JobAssignment() {
  const { location, locationLabel } = useApp();
  const { isSupervisor, isAdmin, isManager } = useAuth();
  const navigate = useNavigate();
  const canAssign = isSupervisor || isAdmin;

  const [opSearch, setOpSearch] = useState('');
  const [opFilter, setOpFilter] = useState('all');
  const [wsSearch, setWsSearch] = useState('');
  const [wsFilter, setWsFilter] = useState('all');
  const [dragging, setDragging] = useState(null);
  const [opDrawer, setOpDrawer] = useState(null);   // operator id whose Method-B drawer is open
  const [wsDrawer, setWsDrawer] = useState(null);   // workstation code whose Method-C drawer is open
  const [override, setOverride] = useState(null);   // { op, ws, warnOnly }
  const [removeModal, setRemoveModal] = useState(null); // { assignmentId, opName, ws }
  const [autoPreview, setAutoPreview] = useState(null); // { rows:[{opId,opName,code}], understaffed }
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
  const operators = data?.employees || [];
  const rawAssignments = data?.assignments || [];

  const allWorkstations = useMemo(() => (data?.stations || []).map((s) => ({
    code: s.code, name: s.name,
    queued: Number(pick(s, 'queued', 'queue_depth', 'waiting_count')) || 0,
    running: Number(pick(s, 'active_count', 'running', 'in_progress_count')) || 0,
    min_operators: Number(pick(s, 'min_operators', 'minOperators')) || 1,
    max_operators: pick(s, 'max_operators', 'maxOperators') != null ? Number(pick(s, 'max_operators', 'maxOperators')) : null,
    required_badge: pick(s, 'required_badge', 'required_skill_code') || null,
  })), [data]);

  const workstations = useMemo(() => {
    if (location === 'both') return allWorkstations;
    const far = location === 'faridabad';
    return allWorkstations.filter((w) => isFaridabadStation(w.code) === far);
  }, [allWorkstations, location]);

  const workstationsByCode = useMemo(() => { const m = {}; for (const w of workstations) m[w.code] = w; return m; }, [workstations]);
  const operatorsById = useMemo(() => { const m = {}; for (const o of operators) m[String(pick(o, 'id', 'employee_id', 'user_id'))] = o; return m; }, [operators]);

  const assignmentsByOperator = useMemo(() => {
    const map = new Map();
    for (const a of rawAssignments) {
      const opId = pick(a, 'operator_id', 'employee_id', 'user_id', 'assigned_to');
      const code = pick(a, 'workstation_code', 'code', 'workstation', 'station_code');
      const entry = { id: pick(a, 'id', 'assignment_id'), code, queued: workstationsByCode[code]?.queued ?? Number(pick(a, 'queued', 'queue_depth')) ?? 0 };
      if (!map.has(String(opId))) map.set(String(opId), []);
      map.get(String(opId)).push(entry);
    }
    return map;
  }, [rawAssignments, workstationsByCode]);

  const opsByCode = useMemo(() => {
    const map = {};
    for (const a of rawAssignments) {
      const code = pick(a, 'workstation_code', 'code', 'workstation', 'station_code');
      const name = pick(a, 'full_name', 'name', 'employee_name') || pick(a, 'employee_code', 'emp_code') || 'Operator';
      if (!map[code]) map[code] = [];
      map[code].push({ id: pick(a, 'operator_id', 'employee_id'), assignmentId: pick(a, 'id', 'assignment_id'), name, empCode: pick(a, 'employee_code', 'emp_code') });
    }
    return map;
  }, [rawAssignments]);

  /* filtered operators */
  const shownOperators = useMemo(() => {
    const q = opSearch.trim().toUpperCase();
    return operators.filter((op) => {
      const id = String(pick(op, 'id', 'employee_id', 'user_id'));
      const n = (assignmentsByOperator.get(id) || []).length;
      if (opFilter === 'idle' && n !== 0) return false;
      if (opFilter === 'working' && n < 1) return false;
      if (opFilter === 'multi' && n < 2) return false;
      if (q) {
        const hay = `${pick(op, 'name', 'full_name', 'username') || ''} ${pick(op, 'employee_code', 'emp_code') || ''}`.toUpperCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [operators, opFilter, opSearch, assignmentsByOperator]);

  /* filtered workstations */
  const shownWorkstations = useMemo(() => {
    const q = wsSearch.trim().toUpperCase();
    return workstations.map((w) => {
      const ops = opsByCode[w.code] || [];
      return { ...w, ops, opCount: ops.length, short: Math.max(0, (w.min_operators || 1) - ops.length), status: stationStatus(w, ops.length) };
    }).filter((w) => {
      if (q && !`${w.code} ${w.name || ''}`.toUpperCase().includes(q)) return false;
      if (wsFilter === 'understaffed') return !isFurnace(w.code) && w.short > 0;
      if (wsFilter !== 'all') return w.status === wsFilter;
      return true;
    }).sort((a, b) => (b.short - a.short) || (b.queued - a.queued));
  }, [workstations, opsByCode, wsSearch, wsFilter]);

  /* summary figures */
  const nonFurnace = workstations.filter((w) => !isFurnace(w.code));
  const staffedOk = nonFurnace.filter((w) => (opsByCode[w.code]?.length || 0) >= (w.min_operators || 1)).length;
  const understaffedList = nonFurnace.filter((w) => (opsByCode[w.code]?.length || 0) < (w.min_operators || 1));
  const idleOperators = operators.filter((op) => !(assignmentsByOperator.get(String(pick(op, 'id', 'employee_id', 'user_id'))) || []).length).length;
  const totalQueued = workstations.reduce((s, w) => s + w.queued, 0);
  const badgeWarnings = useMemo(() => {
    let n = 0;
    for (const [code, ops] of Object.entries(opsByCode)) {
      const ws = workstationsByCode[code];
      if (!ws?.required_badge) continue;
      for (const o of ops) if (!operatorHoldsBadge(operatorsById[String(o.id)], ws.required_badge)) n++;
    }
    return n;
  }, [opsByCode, workstationsByCode, operatorsById]);
  const coverage = nonFurnace.length ? Math.round((staffedOk / nonFurnace.length) * 100) : 0;

  /* ── actions ── */
  const flashOk = (code) => { setFlashCode(code); if (flashTimer.current) clearTimeout(flashTimer.current); flashTimer.current = setTimeout(() => setFlashCode(null), 750); };

  const assign = useCallback(async (opId, ws, overrideReason) => {
    if (!canAssign) return null;
    const myReq = ++reqRef.current;
    setPendingId(`assign:${opId}:${ws.code}`);
    setActionError(null);
    try {
      await workstationAssignmentsApi.assign({ shiftId, employeeId: opId, workstationCode: ws.code, overrideBadgeWarning: overrideReason ? true : undefined, overrideReason: overrideReason || undefined });
      flashOk(ws.code);
      if (myReq === reqRef.current) await refetch();
      return true;
    } catch (err) {
      setActionError(err?.message || 'Could not assign the workstation.');
      return false;
    } finally { setPendingId(null); }
  }, [canAssign, shiftId, refetch]);

  // Assign attempt with badge gate: opens override modal if the operator lacks the badge.
  const tryAssign = useCallback((op, ws, forceWarn) => {
    if (isFurnace(ws.code)) { setActionError(`${ws.code} is a furnace step — assign via Furnace batching.`); return; }
    const opId = pick(op, 'id', 'employee_id', 'user_id');
    const needsOverride = forceWarn || (ws.required_badge && !operatorHoldsBadge(op, ws.required_badge));
    if (needsOverride) { setOverride({ op, ws }); return; }
    assign(opId, ws);
  }, [assign]);

  const doUnassign = useCallback(async (assignmentId) => {
    if (!canAssign) return;
    setPendingId(assignmentId); setActionError(null);
    try { await workstationAssignmentsApi.unassign(assignmentId); await refetch(); }
    catch (err) { setActionError(err?.message || 'Could not unassign.'); }
    finally { setPendingId(null); }
  }, [canAssign, refetch]);

  // Remove with a confirm modal when the workstation has a queue.
  const requestRemove = useCallback((assignmentId, opName, ws) => {
    if (ws && ws.queued > 0) setRemoveModal({ assignmentId, opName, ws });
    else doUnassign(assignmentId);
  }, [doUnassign]);

  /* drag */
  const onDragStartOp = (e, op) => { setDragging(op); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(pick(op, 'id', 'employee_id', 'user_id'))); } catch { /* state covers us */ } };
  const onDragEndOp = () => setDragging(null);
  const onDropOperatorOnWs = (ws, warn) => { const op = dragging; setDragging(null); if (op) tryAssign(op, ws, warn); };

  /* auto-assign (client-side heuristic) */
  const buildAutoAssign = useCallback(() => {
    // load per-operator badge sets and current assignment counts
    const load = new Map(); // opId -> count
    operators.forEach((op) => { const id = String(pick(op, 'id', 'employee_id', 'user_id')); load.set(id, (assignmentsByOperator.get(id) || []).length); });
    const assignedTo = {}; // code -> Set(opId) already assigned
    for (const [code, ops] of Object.entries(opsByCode)) assignedTo[code] = new Set(ops.map((o) => String(o.id)));

    const proposals = []; // {opId, opName, code}
    // understaffed first, then highest queue
    const targets = nonFurnace
      .map((w) => ({ ...w, have: opsByCode[w.code]?.length || 0 }))
      .filter((w) => w.have < (w.min_operators || 1))
      .sort((a, b) => ((b.min_operators - b.have) - (a.min_operators - a.have)) || (b.queued - a.queued));

    for (const w of targets) {
      let need = (w.min_operators || 1) - (opsByCode[w.code]?.length || 0) - proposals.filter((p) => p.code === w.code).length;
      if (need <= 0) continue;
      // eligible operators: hold required badge (or none), not already on this ws
      const already = assignedTo[w.code] || new Set();
      const eligible = operators.filter((op) => {
        const id = String(pick(op, 'id', 'employee_id', 'user_id'));
        if (already.has(id) || proposals.some((p) => p.code === w.code && p.opId === id)) return false;
        return operatorHoldsBadge(op, w.required_badge);
      }).sort((a, b) => (load.get(String(pick(a, 'id', 'employee_id', 'user_id'))) || 0) - (load.get(String(pick(b, 'id', 'employee_id', 'user_id'))) || 0));
      for (const op of eligible) {
        if (need <= 0) break;
        const id = String(pick(op, 'id', 'employee_id', 'user_id'));
        proposals.push({ opId: id, opName: pick(op, 'name', 'full_name', 'username'), code: w.code, ws: w });
        load.set(id, (load.get(id) || 0) + 1);
        need--;
      }
    }
    // understaffed after
    const filledByCode = {};
    proposals.forEach((p) => { filledByCode[p.code] = (filledByCode[p.code] || 0) + 1; });
    const stillShort = nonFurnace.filter((w) => (opsByCode[w.code]?.length || 0) + (filledByCode[w.code] || 0) < (w.min_operators || 1)).length;
    setAutoPreview({ rows: proposals, understaffed: stillShort });
  }, [operators, nonFurnace, opsByCode, assignmentsByOperator]);

  const applyAutoAssign = useCallback(async () => {
    if (!autoPreview) return;
    setPendingId('auto'); setActionError(null);
    try {
      for (const p of autoPreview.rows) {
        // eslint-disable-next-line no-await-in-loop
        await workstationAssignmentsApi.assign({ shiftId, employeeId: p.opId, workstationCode: p.code }).catch(() => {});
      }
      await refetch();
      setAutoPreview(null);
    } finally { setPendingId(null); }
  }, [autoPreview, shiftId, refetch]);

  /* ── render ── */
  const header = (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: T_PRIMARY }}>Work Assignment</div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {canAssign ? <button className="btn btn-sm" type="button" onClick={buildAutoAssign}><Icon name="flow" size={14} />Auto-assign</button> : null}
        <button className="btn btn-sm" type="button" onClick={refetch}><Icon name="refresh" size={14} />Refresh</button>
      </div>
    </div>
  );

  if (error && !data) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1440 }}>
        {header}
        <div className="card" style={{ marginTop: 20, padding: 32, textAlign: 'center' }}>
          <div style={{ color: DANGER, display: 'flex', justifyContent: 'center', marginBottom: 10 }}><Icon name="alert" size={26} /></div>
          <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: T_PRIMARY }}>Could not load the assignment board</div>
          <button className="btn btn-primary btn-sm" type="button" onClick={refetch} style={{ marginTop: 14 }}><Icon name="refresh" size={14} />Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1440 }}>
      {header}

      {/* context strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: OK, display: 'inline-block' }} />
        <span style={{ fontWeight: 700, color: T_PRIMARY }}>VIEWING · {String(locationLabel || location).toUpperCase()}</span>
        {data?.shift ? <span>· {pick(data.shift, 'name', 'shift_name', 'label') || `Shift ${shiftId ?? ''}`}</span> : null}
        <span>· drag an operator onto a workstation, or click either to assign{isManager && !isAdmin ? ' · read-only' : ''}{loading && !data ? ' · loading…' : ''}</span>
      </div>

      {actionError && (
        <div className="card" style={{ marginTop: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderLeft: `4px solid ${DANGER}` }}>
          <Icon name="alert" size={18} color={DANGER} />
          <span style={{ fontFamily: SANS, fontSize: 13, color: 'var(--status-danger-dark, #c0392b)', flex: 1 }}>{actionError}</span>
          <button className="btn btn-sm" onClick={() => setActionError(null)}>Dismiss</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 300px) minmax(0, 1fr) minmax(210px, 250px)', gap: 16, marginTop: 16, alignItems: 'start' }}>
        {/* ── LEFT: operator board ── */}
        <div className="card" style={{ padding: '14px 14px', position: 'sticky', top: 14 }}>
          <Label style={{ marginBottom: 8 }}>Operator board · {operators.length} on shift</Label>
          <SearchBox value={opSearch} onChange={setOpSearch} placeholder="Search operator…" />
          <div style={{ margin: '10px 0 12px' }}>
            <FilterTabs value={opFilter} onChange={setOpFilter} options={[['all', 'ALL'], ['idle', 'IDLE'], ['working', 'WORKING'], ['multi', 'MULTI']]} />
          </div>
          {loading && !data ? <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, padding: '10px 2px' }}>Loading operators…</div>
            : operators.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '28px 8px' }}>
                <Icon name="people" size={24} color={T_MUTED} />
                <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginTop: 8 }}>No operators scheduled for this shift. Set up the shift in Shift Planner first.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'calc(100vh - 210px)', overflowY: 'auto', paddingRight: 2 }}>
                {shownOperators.map((op, i) => {
                  const opId = String(pick(op, 'id', 'employee_id', 'user_id'));
                  const assignments = assignmentsByOperator.get(opId) || [];
                  const assignedCodes = new Set(assignments.map((a) => a.code));
                  return (
                    <OperatorCard
                      key={opId} op={op} index={i} assignments={assignments}
                      workstationsByCode={workstationsByCode} canAssign={canAssign}
                      isDragging={dragging && String(pick(dragging, 'id', 'employee_id', 'user_id')) === opId}
                      pendingId={pendingId} onDragStartOp={onDragStartOp} onDragEndOp={onDragEndOp}
                      onRemove={(a, ws) => requestRemove(a.id, pick(op, 'name', 'full_name', 'username'), ws)}
                      drawerOpen={opDrawer === opId}
                      onToggleDrawer={() => setOpDrawer(opDrawer === opId ? null : opId)}
                      drawerContent={(
                        <AssignWorkstationDrawer
                          op={op} location={location}
                          workstations={workstations.map((w) => ({ ...w, ops: opsByCode[w.code] || [], queued: w.queued, short: Math.max(0, (w.min_operators || 1) - (opsByCode[w.code]?.length || 0)) }))}
                          assignedCodes={assignedCodes}
                          onAssign={(ws, warn) => { setOpDrawer(null); tryAssign(op, ws, warn); }}
                          onClose={() => setOpDrawer(null)}
                        />
                      )}
                    />
                  );
                })}
                {shownOperators.length === 0 ? <div style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY, padding: '8px 2px' }}>No operators match this filter.</div> : null}
              </div>
            )}
        </div>

        {/* ── CENTRE: workstation board ── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <Label>Workstations · {workstations.length}</Label>
            <div style={{ width: 220 }}><SearchBox value={wsSearch} onChange={setWsSearch} placeholder="Search workstation…" /></div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <FilterTabs value={wsFilter} onChange={setWsFilter} options={[['all', 'ALL'], ['waiting', 'WAITING'], ['ready', 'READY'], ['in_progress', 'IN PROG'], ['understaffed', 'UNDERSTAFFED']]} />
          </div>
          {loading && !data ? <div className="card" style={{ padding: 40, textAlign: 'center', fontFamily: SANS, fontSize: 13, color: T_SECONDARY }}>Loading workstations…</div>
            : shownWorkstations.length === 0 ? (
              <div className="card" style={{ padding: '32px 20px', textAlign: 'center' }}>
                <Icon name="check" size={24} color={OK} />
                <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginTop: 8 }}>{workstations.length === 0 ? 'No active workstations for this shift.' : 'No workstations match this filter.'}</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
                {shownWorkstations.map((ws, i) => (
                  <WorkstationCard
                    key={ws.code} ws={ws} index={i} ops={ws.ops} draggingOp={canAssign ? dragging : null}
                    flash={flashCode === ws.code} canAssign={canAssign} operatorsById={operatorsById}
                    onDropOperator={onDropOperatorOnWs}
                    onRemove={(o, w) => requestRemove(o.assignmentId, o.name, w)}
                    drawerOpen={wsDrawer === ws.code}
                    onToggleDrawer={() => setWsDrawer(wsDrawer === ws.code ? null : ws.code)}
                    drawerContent={(
                      <AssignOperatorDrawer
                        ws={ws} location={location} operators={operators}
                        assignedIds={new Set((opsByCode[ws.code] || []).map((o) => String(o.id)))}
                        onAssign={(chosen) => {
                          setWsDrawer(null);
                          chosen.forEach(({ id, warn }) => { const op = operatorsById[String(id)]; if (op) tryAssign(op, ws, warn); });
                        }}
                        onClose={() => setWsDrawer(null)}
                      />
                    )}
                  />
                ))}
              </div>
            )}
        </div>

        {/* ── RIGHT: shift summary ── */}
        <div className="card" style={{ padding: '14px 14px', position: 'sticky', top: 14 }}>
          <Label style={{ marginBottom: 2 }}>Shift summary</Label>
          <SummaryRow label="Workstations assigned" value={`${staffedOk} / ${nonFurnace.length}`} tone={staffedOk >= nonFurnace.length ? 'ok' : undefined} />
          <SummaryRow label="Understaffed" value={understaffedList.length} tone={understaffedList.length > 0 ? 'warn' : 'ok'} />
          <SummaryRow label="Operators idle" value={idleOperators} tone={idleOperators > 0 ? 'warn' : undefined} />
          <SummaryRow label="Total UIDs queued" value={totalQueued} />

          <Label style={{ margin: '14px 0 6px' }}>Minimum coverage</Label>
          <div style={{ height: 8, borderRadius: 5, background: 'var(--bg-muted, #f4f7f2)', overflow: 'hidden' }}>
            <div className="ja-bar-fill" style={{ width: `${coverage}%`, height: '100%', background: coverage >= 100 ? OK : coverage >= 50 ? WARN : DANGER, borderRadius: 5 }} />
          </div>
          <div style={{ fontFamily: SANS, fontSize: 11.5, color: T_SECONDARY, marginTop: 5 }}>{staffedOk} / {nonFurnace.length} workstations at or above minimum staffing</div>

          {badgeWarnings > 0 ? (
            <div style={{ marginTop: 14, padding: '10px 11px', borderRadius: 10, background: 'var(--bg-soft-amber, #fdf6ef)', borderLeft: `3px solid ${WARN}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="alert" size={14} color={WARN} />
                <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 12, color: WARN }}>{badgeWarnings} operator{badgeWarnings === 1 ? '' : 's'} without required badge</span>
              </div>
              <div style={{ fontFamily: SANS, fontSize: 11, color: T_SECONDARY, marginTop: 3 }}>Assigned with an override reason on file.</div>
            </div>
          ) : null}

          <button className="btn btn-sm" type="button" onClick={() => navigate('/reports')} style={{ marginTop: 14, width: '100%', justifyContent: 'center' }}>View coverage report</button>
        </div>
      </div>

      {/* Furnace batching */}
      {location !== 'faridabad' && canAssign && (
        <div style={{ marginTop: 26 }}>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, letterSpacing: '-0.03em', color: T_PRIMARY }}>Furnace batching</div>
          <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginTop: 3 }}>
            Furnace steps run as supervisor batches — multi-select the queued UIDs and assign them to a furnace. The batch then awaits a supervisor&apos;s verification before it starts.
          </div>
          <FurnaceBatchPanel showActive={false} />
        </div>
      )}

      {/* modals */}
      {override && (
        <OverrideModal op={override.op} ws={override.ws} busy={!!pendingId}
          onCancel={() => setOverride(null)}
          onConfirm={async (reason) => { const opId = pick(override.op, 'id', 'employee_id', 'user_id'); const ws = override.ws; setOverride(null); await assign(opId, ws, reason); }}
        />
      )}
      {removeModal && (
        <RemoveModal payload={removeModal} busy={!!pendingId}
          onCancel={() => setRemoveModal(null)}
          onConfirm={async () => { const id = removeModal.assignmentId; setRemoveModal(null); await doUnassign(id); }}
        />
      )}
      {autoPreview && (
        <Overlay onClose={() => setAutoPreview(null)}>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 16, color: T_PRIMARY, marginBottom: 4 }}>Auto-assign preview</div>
          <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginBottom: 10 }}>{autoPreview.rows.length} proposed assignment{autoPreview.rows.length === 1 ? '' : 's'}, badge-matched, filling minimums first.</div>
          <div style={{ maxHeight: '46vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {autoPreview.rows.length === 0 ? <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY }}>Nothing to propose — every workstation is at minimum, or no badge-matched operators are free.</div>
              : autoPreview.rows.map((p, i) => (
                <div key={i} className="ja-rise" style={{ '--ja-i': i, display: 'flex', justifyContent: 'space-between', gap: 8, border: '1px solid var(--border-input, #d6e0d2)', borderRadius: 8, padding: '7px 9px' }}>
                  <span style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: T_PRIMARY }}>{p.opName}</span>
                  <Mono style={{ fontSize: 12, color: BLUE }}>→ {p.code}</Mono>
                </div>
              ))}
          </div>
          {autoPreview.understaffed > 0 ? (
            <div style={{ marginTop: 10, fontFamily: SANS, fontSize: 12, color: WARN }}>⚠ {autoPreview.understaffed} workstation{autoPreview.understaffed === 1 ? '' : 's'} still understaffed (not enough badged operators on shift).</div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" type="button" onClick={() => setAutoPreview(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" type="button" disabled={!autoPreview.rows.length || pendingId === 'auto'} onClick={applyAutoAssign}>{pendingId === 'auto' ? 'Applying…' : 'Apply all'}</button>
          </div>
        </Overlay>
      )}
    </div>
  );
}
