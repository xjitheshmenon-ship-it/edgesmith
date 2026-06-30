import { useMemo, useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useApp } from '../store/AppContext';
import { useAuth } from '../store/AuthContext';
import { shiftsApi, employeesApi, workstationAssignmentsApi } from '../api/resources';
import Icon from '../components/common/Icon';
import { StatusPill, LocationBadge } from '../components/common/Badges';

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";

/* Shift windows mirror the backend config (config/shifts.js). Used only for
   display + the time-remaining countdown — the server is the source of truth
   for which shift is actually running. */
const SHIFT_WINDOWS = {
  1: { start: '06:00', end: '14:00' },
  2: { start: '14:00', end: '22:00' },
  3: { start: '22:00', end: '06:00' },
};

const HANDOVER_WINDOW_MIN = 30; // panel appears 30 min before shift end (per spec)

/* ── small presentational helpers ─────────────────────────────────────── */

function SectionLabel({ children, style }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--text-muted, #9bb4d4)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <SectionLabel style={{ marginBottom: 6 }}>{label}</SectionLabel>
      <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>
        {children ?? '—'}
      </div>
    </div>
  );
}

/* Map an active-shift workstation row to a UI job status. The assignment board
   gives us queue_depth; running ⇒ work in progress, idle ⇒ nothing queued. */
function rowStatus(queueDepth) {
  return Number(queueDepth) > 0 ? 'running' : 'idle';
}

/* Compute minutes remaining until a shift's window end, given the shift number.
   Handles the shift-3 midnight crossing. Returns null when window is unknown. */
function minutesRemaining(shiftNumber) {
  const win = SHIFT_WINDOWS[shiftNumber];
  if (!win) return null;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [eh, em] = win.end.split(':').map(Number);
  let endMin = eh * 60 + em;
  let diff = endMin - nowMin;
  if (diff <= 0) diff += 24 * 60; // window end already passed today → next occurrence (shift 3)
  return diff;
}

function formatRemaining(mins) {
  if (mins == null) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return String(d);
  }
}

function fmtDateTime(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(d);
  }
}

/* ── shared states ────────────────────────────────────────────────────── */

function LoadingCard({ height = 120 }) {
  return (
    <div className="card" style={{ padding: 18, height, opacity: 0.5, display: 'flex', alignItems: 'center' }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted, #9bb4d4)' }}>loading…</div>
    </div>
  );
}

function EmptyState({ icon = 'calendar', message }) {
  return (
    <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ color: 'var(--text-muted, #9bb4d4)', display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
        <Icon name={icon} size={26} />
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)' }}>{message}</div>
    </div>
  );
}

function ErrorState({ error, onRetry }) {
  return (
    <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
      <div style={{ color: 'var(--status-danger, #e5484d)', display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
        <Icon name="alert" size={26} />
      </div>
      <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>
        Could not load shift data
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
        {error?.message || 'Something went wrong.'}
      </div>
      {onRetry ? (
        <button className="btn btn-primary btn-sm" type="button" onClick={onRetry} style={{ marginTop: 14 }}>
          <Icon name="refresh" size={14} />
          Retry
        </button>
      ) : null}
    </div>
  );
}

/* ── Active Shift tab ─────────────────────────────────────────────────── */

function ActiveShiftTab({ location, locationLabel, canSupervise, supervisors }) {
  const { data, error, loading, refetch } = usePolling(
    async () => {
      const shift = await shiftsApi.current(location === 'both' ? 'dharmapuri' : location).then((r) => r.data);
      const assignments = shift?.id
        ? await workstationAssignmentsApi.list(shift.id).then((r) => r.data).catch(() => [])
        : [];
      return { shift, assignments: assignments || [] };
    },
    [location]
  );

  const shift = data?.shift || null;
  const assignments = data?.assignments || [];
  const remaining = shift ? minutesRemaining(shift.shift_number) : null;
  const inHandoverWindow = remaining != null && remaining <= HANDOVER_WINDOW_MIN;
  const win = shift ? SHIFT_WINDOWS[shift.shift_number] : null;

  if (loading && !data) return <LoadingCard height={180} />;
  if (error && !data) return <ErrorState error={error} onRetry={refetch} />;
  if (!shift) return <EmptyState icon="timer" message="No active shift at this location." />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── Current Shift card ── */}
      <div className="card" style={{ padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                fontFamily: ARCHIVO,
                fontWeight: 800,
                fontSize: 20,
                letterSpacing: '-0.03em',
                color: 'var(--text-primary, #15366a)',
              }}
            >
              Shift {shift.shift_number}
            </div>
            <LocationBadge location={shift.location_code || location} />
            {shift.ended_at ? (
              <StatusPill status="done" label="ENDED" />
            ) : (
              <StatusPill status="running" label="ACTIVE" />
            )}
          </div>
          <button className="btn btn-sm" type="button" onClick={refetch}>
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 18,
            marginTop: 18,
          }}
        >
          <Field label="Window">
            {win ? `${win.start} – ${win.end}` : '—'}
          </Field>
          <Field label="Date">{fmtDate(shift.shift_date)}</Field>
          <Field label="Location">{locationLabel}</Field>
          <Field label="Supervisor on duty">{shift.supervisor_name || 'Unassigned'}</Field>
          <Field label="Time remaining">
            <span style={{ color: inHandoverWindow ? 'var(--status-warning, #d97a2b)' : undefined }}>
              {shift.ended_at ? 'Shift ended' : formatRemaining(remaining)}
            </span>
          </Field>
          <Field label="Operators clocked in">{shift.operators_clocked_in ?? 0}</Field>
        </div>

        {inHandoverWindow && !shift.ended_at ? (
          <div
            style={{
              marginTop: 18,
              padding: '10px 14px',
              borderRadius: 'var(--radius-md, 9px)',
              background: 'var(--bg-soft-amber, #fdf6ef)',
              border: '1px solid var(--status-amber, #f0c674)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--status-warning, #d97a2b)',
              fontFamily: SANS,
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            <Icon name="timer" size={15} />
            Handover countdown — shift ends in {formatRemaining(remaining)}.
          </div>
        ) : null}
      </div>

      {/* ── Workstation assignment table ── */}
      <div className="card" style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <SectionLabel>Workstation assignment · current shift</SectionLabel>
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted, #9bb4d4)' }}>
            {assignments.length} active
          </span>
        </div>
        {assignments.length === 0 ? (
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', padding: '12px 0' }}>
            No workstations assigned for this shift yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Workstation', 'Operator', 'Queue / UIDs', 'Status'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      fontFamily: MONO,
                      fontSize: 9.5,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'var(--text-secondary, #5d7188)',
                      padding: '0 10px 10px 0',
                      borderBottom: '1px solid var(--border-card, #e3ebde)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--bg-muted, #f4f7f2)' }}>
                  <td style={{ padding: '11px 10px 11px 0' }}>
                    <div style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>
                      {a.workstation_code || '—'}
                    </div>
                    {a.category ? (
                      <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-secondary, #5d7188)' }}>
                        {String(a.category).replace(/_/g, ' ')}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: '11px 10px 11px 0' }}>
                    <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>
                      {a.full_name || '—'}
                    </div>
                    {a.employee_code ? (
                      <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--text-muted, #9bb4d4)' }}>
                        {a.employee_code}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: '11px 10px 11px 0', fontFamily: MONO, fontSize: 12, color: 'var(--text-secondary, #5d7188)' }}>
                    {Number(a.queue_depth) > 0 ? `${a.queue_depth} in queue` : 'none'}
                  </td>
                  <td style={{ padding: '11px 0' }}>
                    <StatusPill status={rowStatus(a.queue_depth)} label={rowStatus(a.queue_depth) === 'running' ? 'RUNNING' : 'IDLE'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Handover panel (supervisors only, within window) ── */}
      {canSupervise && !shift.ended_at ? (
        <HandoverPanel
          shift={shift}
          active={inHandoverWindow}
          supervisors={supervisors}
          onDone={refetch}
        />
      ) : null}
    </div>
  );
}

/* Handover panel — outgoing supervisor submits; incoming acknowledges. */
function HandoverPanel({ shift, active, supervisors, onDone }) {
  const [equipmentIssues, setEquipmentIssues] = useState('');
  const [urgentNotes, setUrgentNotes] = useState('');
  const [incomingSupervisorId, setIncomingSupervisorId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [acking, setAcking] = useState(false);
  const [msg, setMsg] = useState(null); // { kind: 'ok'|'err', text }

  async function submit() {
    setSubmitting(true);
    setMsg(null);
    try {
      await shiftsApi.handover(shift.id, {
        equipmentIssues: equipmentIssues.trim() || null,
        urgentNotes: urgentNotes.trim() || null,
        incomingSupervisorId: incomingSupervisorId || null,
      });
      setMsg({ kind: 'ok', text: 'Handover submitted. Waiting for incoming supervisor to acknowledge.' });
      setEquipmentIssues('');
      setUrgentNotes('');
      onDone?.();
    } catch (err) {
      setMsg({ kind: 'err', text: err?.message || 'Could not submit handover.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function acknowledge() {
    setAcking(true);
    setMsg(null);
    try {
      await shiftsApi.acknowledge(shift.id);
      setMsg({ kind: 'ok', text: 'Handover acknowledged — you have taken over the shift.' });
      onDone?.();
    } catch (err) {
      setMsg({ kind: 'err', text: err?.message || 'No pending handover to acknowledge.' });
    } finally {
      setAcking(false);
    }
  }

  return (
    <div
      className="card"
      style={{
        padding: '20px 22px',
        ...(active ? { border: '1px solid var(--status-amber, #f0c674)' } : { opacity: 0.92 }),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon name="assign" size={18} color="var(--text-primary, #15366a)" />
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 16, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
          Shift handover
        </div>
        {active ? <StatusPill status="pending" label="HANDOVER WINDOW" /> : null}
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', marginBottom: 16 }}>
        {active
          ? 'Workstation status, furnace batches and held UIDs are snapshotted server-side on submit. Add equipment issues and urgent notes for the incoming supervisor.'
          : 'The handover panel becomes active 30 minutes before shift end. You can still pre-fill notes and submit early if required.'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <div>
          <label className="form-label" htmlFor="ho-incoming">Incoming supervisor</label>
          <select
            id="ho-incoming"
            className="form-select"
            value={incomingSupervisorId}
            onChange={(e) => setIncomingSupervisorId(e.target.value)}
          >
            <option value="">— select (optional) —</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name} {s.employee_code ? `(${s.employee_code})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label" htmlFor="ho-equip">Equipment issues</label>
          <textarea
            id="ho-equip"
            className="form-input"
            style={{ height: 90, padding: 10, resize: 'vertical' }}
            placeholder="Optional — any equipment faults or maintenance notes"
            value={equipmentIssues}
            onChange={(e) => setEquipmentIssues(e.target.value)}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="ho-notes">Urgent notes for incoming supervisor</label>
          <textarea
            id="ho-notes"
            className="form-input"
            style={{ height: 90, padding: 10, resize: 'vertical' }}
            placeholder="Optional — anything the next shift must know"
            value={urgentNotes}
            onChange={(e) => setUrgentNotes(e.target.value)}
          />
        </div>
      </div>

      {msg ? (
        <div
          style={{
            marginTop: 14,
            fontFamily: SANS,
            fontSize: 12.5,
            fontWeight: 600,
            color: msg.kind === 'ok' ? 'var(--status-success, #22a06b)' : 'var(--status-danger, #e5484d)',
          }}
        >
          {msg.text}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" type="button" onClick={submit} disabled={submitting}>
          <Icon name="check" size={15} />
          {submitting ? 'Submitting…' : 'Submit handover'}
        </button>
        <button className="btn" type="button" onClick={acknowledge} disabled={acking}>
          <Icon name="assign" size={15} />
          {acking ? 'Acknowledging…' : 'Acknowledge & take over'}
        </button>
      </div>
    </div>
  );
}

/* ── Schedule tab ─────────────────────────────────────────────────────── */

function weekStart(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0 Sun..6 Sat
  const diff = (day + 6) % 7; // back to Monday
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function ScheduleTab({ location, canManage }) {
  const [anchor, setAnchor] = useState(() => weekStart(new Date()));
  const [publishing, setPublishing] = useState(false);
  const [pubMsg, setPubMsg] = useState(null);
  const [editing, setEditing] = useState(null); // { date: Date, shiftNumber, cell }

  const singleLocation = location !== 'both';
  const canEdit = canManage && singleLocation;

  const days = useMemo(() => {
    const start = weekStart(anchor);
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [anchor]);

  const from = isoDate(days[0]);
  const to = isoDate(days[6]);

  const { data, error, loading, refetch } = usePolling(
    async () =>
      shiftsApi
        .schedule({ location: location === 'both' ? undefined : location, from, to })
        .then((r) => r.data),
    [location, from, to],
    { interval: 60000 }
  );

  // Roster for the cell editor — supervisors + operators at this location.
  const { data: rosterData } = usePolling(
    async () => {
      if (!canEdit) return { supervisors: [], operators: [] };
      const loc = location === 'both' ? undefined : location;
      const [sup, ops] = await Promise.all([
        employeesApi.list({ role: 'supervisor', location: loc }).then((r) => r.data).catch(() => []),
        employeesApi.list({ role: 'operator', location: loc }).then((r) => r.data).catch(() => []),
      ]);
      return { supervisors: sup || [], operators: ops || [] };
    },
    [location, canEdit],
    { interval: 300000 }
  );
  const supervisors = rosterData?.supervisors || [];
  const operators = rosterData?.operators || [];

  const rows = data || [];

  // index by `${date}|${shiftNumber}` for the calendar grid
  const byCell = useMemo(() => {
    const m = {};
    for (const r of rows) {
      m[`${isoDate(r.shift_date)}|${r.shift_number}`] = r;
    }
    return m;
  }, [rows]);

  const anyDraft = rows.some((r) => !r.published);

  async function publish() {
    if (location === 'both') {
      setPubMsg({ kind: 'err', text: 'Select a single location to publish its schedule.' });
      return;
    }
    setPublishing(true);
    setPubMsg(null);
    try {
      const res = await shiftsApi.publishSchedule({ from, to, locationCode: location });
      setPubMsg({ kind: 'ok', text: `Published ${res.data?.publishedCount ?? 0} schedule entries.` });
      refetch();
    } catch (err) {
      setPubMsg({ kind: 'err', text: err?.message || 'Could not publish schedule.' });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => setAnchor((a) => { const d = new Date(a); d.setDate(d.getDate() - 7); return d; })}
          >
            ‹ Prev
          </button>
          <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>
            {fmtDate(days[0])} – {fmtDate(days[6])}
          </div>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => setAnchor((a) => { const d = new Date(a); d.setDate(d.getDate() + 7); return d; })}
          >
            Next ›
          </button>
          <button className="btn btn-sm" type="button" onClick={() => setAnchor(weekStart(new Date()))}>
            This week
          </button>
        </div>
        {canManage ? (
          <button className="btn btn-primary btn-sm" type="button" onClick={publish} disabled={publishing || !anyDraft}>
            <Icon name="check" size={14} />
            {publishing ? 'Publishing…' : 'Publish schedule'}
          </button>
        ) : null}
      </div>

      {pubMsg ? (
        <div
          style={{
            fontFamily: SANS,
            fontSize: 12.5,
            fontWeight: 600,
            color: pubMsg.kind === 'ok' ? 'var(--status-success, #22a06b)' : 'var(--status-danger, #e5484d)',
          }}
        >
          {pubMsg.text}
        </div>
      ) : null}

      {loading && !data ? (
        <LoadingCard height={220} />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={cellHeadStyle()}>Shift</th>
                {days.map((d) => (
                  <th key={isoDate(d)} style={cellHeadStyle()}>
                    {d.toLocaleDateString(undefined, { weekday: 'short' })}
                    <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted, #9bb4d4)', fontWeight: 400 }}>
                      {d.getDate()}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((sn) => (
                <tr key={sn}>
                  <td style={{ ...cellStyle(), fontFamily: MONO, fontSize: 11.5, fontWeight: 600 }}>
                    Shift {sn}
                    <div style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--text-muted, #9bb4d4)', fontWeight: 400 }}>
                      {SHIFT_WINDOWS[sn].start}–{SHIFT_WINDOWS[sn].end}
                    </div>
                  </td>
                  {days.map((d) => {
                    const cell = byCell[`${isoDate(d)}|${sn}`];
                    const clickable = canEdit;
                    return (
                      <td
                        key={isoDate(d)}
                        style={{ ...cellStyle(), cursor: clickable ? 'pointer' : 'default' }}
                        onClick={clickable ? () => setEditing({ date: d, shiftNumber: sn, cell: cell || null }) : undefined}
                        title={clickable ? (cell ? 'Edit shift assignment' : 'Add shift assignment') : undefined}
                      >
                        {cell ? (
                          <div
                            style={{
                              padding: '7px 9px',
                              borderRadius: 'var(--radius-sm, 5px)',
                              background: cell.published ? 'var(--bg-soft-green, #e7ece4)' : 'var(--bg-soft-amber, #fdf6ef)',
                              border: cell.published ? 'none' : '1px dashed var(--status-amber, #f0c674)',
                            }}
                          >
                            <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>
                              {cell.supervisor_name || 'No supervisor'}
                            </div>
                            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-secondary, #5d7188)', marginTop: 2 }}>
                              {Array.isArray(cell.operator_ids) ? cell.operator_ids.length : 0} ops
                              {cell.published ? '' : ' · draft'}
                            </div>
                          </div>
                        ) : clickable ? (
                          <div style={{ fontFamily: MONO, fontSize: 16, color: 'var(--text-muted, #9bb4d4)', textAlign: 'center', lineHeight: 1 }}>+</div>
                        ) : (
                          <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted, #9bb4d4)', textAlign: 'center' }}>—</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canManage ? (
        <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary, #5d7188)' }}>
          Published schedule only. Editing and publishing are restricted to Manager / Admin.
        </div>
      ) : !singleLocation ? (
        <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary, #5d7188)' }}>
          Select a single factory (Dharmapuri or Faridabad) in the top bar to edit and publish its schedule.
        </div>
      ) : (
        <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary, #5d7188)' }}>
          Click any cell to assign a supervisor and operators. New entries stay as drafts until you publish.
        </div>
      )}

      {editing ? (
        <ScheduleCellEditor
          key={`${isoDate(editing.date)}|${editing.shiftNumber}`}
          date={editing.date}
          shiftNumber={editing.shiftNumber}
          cell={editing.cell}
          locationCode={location}
          supervisors={supervisors}
          operators={operators}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refetch(); }}
        />
      ) : null}
    </div>
  );
}

/* Editor modal — upserts one schedule cell (supervisor + operators). */
function ScheduleCellEditor({ date, shiftNumber, cell, locationCode, supervisors, operators, onClose, onSaved }) {
  const [supervisorId, setSupervisorId] = useState(cell?.supervisor_id || '');
  const [operatorIds, setOperatorIds] = useState(() =>
    Array.isArray(cell?.operator_ids) ? cell.operator_ids.map(String) : []
  );
  const [opFilter, setOpFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const win = SHIFT_WINDOWS[shiftNumber];
  const filteredOps = useMemo(() => {
    const q = opFilter.trim().toLowerCase();
    if (!q) return operators;
    return operators.filter(
      (o) => (o.full_name || '').toLowerCase().includes(q) || (o.employee_code || '').toLowerCase().includes(q)
    );
  }, [operators, opFilter]);

  function toggleOp(id) {
    const sid = String(id);
    setOperatorIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await shiftsApi.setSchedule({
        shiftDate: isoDate(date),
        shiftNumber,
        locationCode,
        supervisorId: supervisorId || null,
        operatorIds,
      });
      onSaved?.();
    } catch (e) {
      setErr(e?.message || 'Could not save the schedule entry.');
      setSaving(false);
    }
  }

  async function clearEntry() {
    setSaving(true);
    setErr(null);
    try {
      await shiftsApi.setSchedule({
        shiftDate: isoDate(date),
        shiftNumber,
        locationCode,
        supervisorId: null,
        operatorIds: [],
      });
      onSaved?.();
    } catch (e) {
      setErr(e?.message || 'Could not clear the schedule entry.');
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,29,58,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}
      className="cp-fade-in"
    >
      <div className="card" style={{ width: 'min(520px, 100%)', maxHeight: '88vh', overflowY: 'auto', padding: 24, boxShadow: 'var(--shadow-modal)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 17, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Shift {shiftNumber} · {fmtDate(date)}
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', display: 'flex', cursor: 'pointer' }}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 16 }}>
          {win ? `${win.start}–${win.end}` : ''}{cell?.published ? ' · published' : cell ? ' · draft' : ''}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label className="form-label" htmlFor="sched-sup">Supervisor on duty</label>
          <select id="sched-sup" className="form-select" value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
            <option value="">— unassigned —</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name} {s.employee_code ? `(${s.employee_code})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <SectionLabel>Operators ({operatorIds.length} selected)</SectionLabel>
          {operatorIds.length ? (
            <button type="button" onClick={() => setOperatorIds([])} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: 10.5, color: 'var(--text-secondary)' }}>
              clear all
            </button>
          ) : null}
        </div>
        <input
          className="form-input"
          style={{ height: 36, marginBottom: 8 }}
          placeholder="Filter operators…"
          value={opFilter}
          onChange={(e) => setOpFilter(e.target.value)}
        />
        <div style={{ border: '1px solid var(--border-card, #e3ebde)', borderRadius: 'var(--radius-md, 9px)', maxHeight: 240, overflowY: 'auto' }}>
          {filteredOps.length === 0 ? (
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary)', padding: '14px 12px' }}>
              No operators found.
            </div>
          ) : (
            filteredOps.map((o) => {
              const checked = operatorIds.includes(String(o.id));
              return (
                <label
                  key={o.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--bg-muted, #f4f7f2)', cursor: 'pointer' }}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleOp(o.id)} />
                  <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{o.full_name}</span>
                  {o.employee_code ? (
                    <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--text-muted, #9bb4d4)' }}>{o.employee_code}</span>
                  ) : null}
                </label>
              );
            })
          )}
        </div>

        {err ? (
          <div style={{ marginTop: 12, fontFamily: SANS, fontSize: 12.5, fontWeight: 600, color: 'var(--status-danger, #e5484d)' }}>{err}</div>
        ) : null}

        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" type="button" onClick={save} disabled={saving}>
            <Icon name="check" size={15} />
            {saving ? 'Saving…' : 'Save assignment'}
          </button>
          <button className="btn" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          {cell ? (
            <button className="btn" type="button" onClick={clearEntry} disabled={saving} style={{ marginLeft: 'auto', color: 'var(--status-danger, #e5484d)' }}>
              <Icon name="close" size={14} />
              Clear cell
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function cellHeadStyle() {
  return {
    textAlign: 'left',
    fontFamily: MONO,
    fontSize: 9.5,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-secondary, #5d7188)',
    padding: '12px 12px',
    borderBottom: '1px solid var(--border-card, #e3ebde)',
    background: 'var(--bg-muted-2, #f6f9f4)',
    whiteSpace: 'nowrap',
  };
}

function cellStyle() {
  return {
    padding: '8px 12px',
    borderBottom: '1px solid var(--bg-muted, #f4f7f2)',
    borderRight: '1px solid var(--bg-muted, #f4f7f2)',
    verticalAlign: 'top',
    color: 'var(--text-primary, #15366a)',
  };
}

/* ── Shift History tab ────────────────────────────────────────────────── */

function HistoryTab({ location }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, error, loading, refetch } = usePolling(
    async () =>
      shiftsApi
        .list({ location: location === 'both' ? undefined : location, from: from || undefined, to: to || undefined })
        .then((r) => r.data),
    [location, from, to],
    { interval: 60000 }
  );

  const rows = data || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <label className="form-label" htmlFor="hist-from">From</label>
          <input id="hist-from" className="form-input" style={{ height: 38, width: 170 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="form-label" htmlFor="hist-to">To</label>
          <input id="hist-to" className="form-input" style={{ height: 38, width: 170 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {(from || to) ? (
          <button className="btn btn-sm" type="button" onClick={() => { setFrom(''); setTo(''); }}>
            <Icon name="close" size={13} />
            Clear
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" type="button" onClick={refetch}>
          <Icon name="refresh" size={14} />
          Refresh
        </button>
      </div>

      {loading && !data ? (
        <LoadingCard height={200} />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyState icon="list" message="No shifts found for the selected range." />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr>
                {['Date', 'Shift', 'Location', 'Supervisor', 'Jobs completed', 'Handover submitted', 'Acknowledged'].map((h) => (
                  <th key={h} style={cellHeadStyle()}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={cellStyle()}>
                    <span style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-primary, #15366a)' }}>{fmtDate(r.shift_date)}</span>
                  </td>
                  <td style={{ ...cellStyle(), fontFamily: MONO, fontSize: 12 }}>Shift {r.shift_number}</td>
                  <td style={cellStyle()}><LocationBadge location={r.location_code} /></td>
                  <td style={{ ...cellStyle(), fontFamily: SANS, fontSize: 12.5 }}>{r.supervisor_name || '—'}</td>
                  <td style={{ ...cellStyle(), fontFamily: MONO, fontSize: 12 }}>{r.jobs_completed ?? 0}</td>
                  <td style={cellStyle()}>
                    {r.handover_submitted
                      ? <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary, #5d7188)' }}>{fmtDateTime(r.handover_submitted)}</span>
                      : <StatusPill status="pending" label="NONE" />}
                  </td>
                  <td style={cellStyle()}>
                    {r.handover_acknowledged
                      ? <StatusPill status="done" label="ACKNOWLEDGED" />
                      : r.handover_submitted
                        ? <StatusPill status="pending" label="PENDING" />
                        : <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted, #9bb4d4)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────── */

const TABS = [
  { key: 'active', label: 'Active Shift' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'history', label: 'Shift History' },
];

export default function ShiftManagement() {
  const { location, locationLabel } = useApp();
  const { isAdmin, isManager, isSupervisor } = useAuth();
  const canManage = isAdmin || isManager;
  const canSupervise = isAdmin || isManager || isSupervisor;
  const [tab, setTab] = useState('active');

  // Supervisor roster for the handover "incoming supervisor" picker. Loaded
  // once (not polled) — the roster rarely changes within a session.
  const { data: supData } = usePolling(
    async () =>
      employeesApi
        .list({ role: 'supervisor', location: location === 'both' ? undefined : location })
        .then((r) => r.data)
        .catch(() => []),
    [location],
    { interval: 300000 }
  );
  const supervisors = supData || [];

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
            Shift Management
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)' }}>
              Plan schedules, run active shifts, perform handovers
            </div>
            <LocationBadge location={location} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-strip" style={{ marginTop: 18 }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} type="button" onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 18 }}>
        {tab === 'active' ? (
          <ActiveShiftTab
            location={location}
            locationLabel={locationLabel}
            canSupervise={canSupervise}
            supervisors={supervisors}
          />
        ) : null}
        {tab === 'schedule' ? <ScheduleTab location={location} canManage={canManage} /> : null}
        {tab === 'history' ? <HistoryTab location={location} /> : null}
      </div>
    </div>
  );
}
