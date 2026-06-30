import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePolling } from '../hooks/usePolling';
import { jobsApi, PAUSE_REASONS } from '../api/jobs';
import { uidsApi } from '../api/uids';
import { batchesApi } from '../api/batches';
import { useAuth } from '../store/AuthContext';
import Icon from '../components/common/Icon';
import { CycleBadge, StatusPill, PriorityBadge } from '../components/common/Badges';

/* ──────────────────────────────────────────────────────────────────────────
   PAGE 22 — MY WORKSTATION (Operator view, rebuilt model)
   The operator's personal view: one tab per assigned workstation, each with
   its own queue and independent job timers. Operators Start / Pause / Resume /
   Close jobs; every action is timestamped server-side. Timers tick locally and
   re-sync from server figures on each poll.
   ────────────────────────────────────────────────────────────────────────── */

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";

const T_PRIMARY = 'var(--text-primary, #15366a)';
const T_SECONDARY = 'var(--text-secondary, #5d7188)';
const T_MUTED = 'var(--text-muted, #9bb4d4)';

/* Tempering steps require actual temperature + soak time on close. */
const TEMPERING_STEPS = [9, 10, 14, 23];
const TOTAL_STEPS = 27;

/* ── helpers ─────────────────────────────────────────────────────────────── */

function fmtHMS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/* Seconds elapsed from an ISO timestamp until `nowMs`. Tolerant of nulls. */
function elapsedFrom(iso, nowMs) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (nowMs - t) / 1000);
}

/* Pull the first non-null value across a set of candidate keys. */
function pick(obj, ...keys) {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] != null) return obj[k];
  return undefined;
}

function jobId(job) {
  return pick(job, 'id', 'job_id', 'jobId', '_id');
}

function jobStatus(job) {
  return String(pick(job, 'status', 'state', 'job_status') || 'queued').toLowerCase();
}

function jobStep(job) {
  return pick(job, 'step', 'step_no', 'current_step', 'stepNumber');
}

/* Net work time the server has accumulated, in seconds (excludes pauses). */
function serverNetSeconds(job) {
  const v = pick(job, 'net_work_seconds', 'net_seconds', 'active_seconds', 'net_work_time_seconds');
  return Number(v) || 0;
}

/* ── live timer hook: one ticking clock for the whole page ────────────────── */

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/* Compute the live timer figures for a job, re-syncing from server numbers.
   - net   : net work time so far (server net + seconds since last resume if running)
   - active: time since last resume/start (running only)
   - paused: pause duration so far (paused only) */
function computeTimers(job, nowMs) {
  const status = jobStatus(job);
  const base = serverNetSeconds(job);
  if (status === 'in_progress' || status === 'running' || status === 'active') {
    const since = elapsedFrom(
      pick(job, 'resumed_at', 'last_resume_at', 'started_at', 'start_at', 'start_time'),
      nowMs
    );
    return { net: base + since, active: since, paused: 0, status };
  }
  if (status === 'paused') {
    const pausedFor = elapsedFrom(pick(job, 'paused_at', 'last_pause_at', 'pause_time'), nowMs);
    return { net: base, active: 0, paused: pausedFor, status };
  }
  return { net: base, active: 0, paused: 0, status };
}

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

function dotColor(status) {
  if (status === 'in_progress' || status === 'running' || status === 'active') return '#22a06b';
  if (status === 'paused') return '#d97a2b';
  if (status === 'ready') return '#3b82f6';
  return '#9aa0a6';
}

/* 27-node step progress track. Current step pulses. */
function StepTrack({ step }) {
  const current = Number(step) || 0;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => {
        const n = i + 1;
        const done = n < current;
        const isCurrent = n === current;
        return (
          <span
            key={n}
            title={`Step ${n}`}
            style={{
              width: 18,
              height: 18,
              borderRadius: 5,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: MONO,
              fontSize: 9,
              fontWeight: 700,
              color: isCurrent ? '#fff' : done ? '#1c7a52' : T_MUTED,
              background: isCurrent ? 'var(--status-success, #22a06b)' : done ? 'var(--accent-green, #d4eecb)' : 'var(--bg-muted, #f4f7f2)',
              border: '1px solid ' + (isCurrent ? 'var(--status-success, #22a06b)' : 'var(--border-card, #e3ebde)'),
              animation: isCurrent ? 'cp-pulse 1.6s ease-in-out infinite' : 'none',
            }}
          >
            {n}
          </span>
        );
      })}
    </div>
  );
}

/* ── modal shell ─────────────────────────────────────────────────────────── */

function Modal({ title, onClose, children, width = 520 }) {
  return (
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,29,58,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: 20 }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="card cp-fade-in"
        style={{ width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-modal)', padding: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border-card, #e3ebde)' }}>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em', color: T_PRIMARY }}>{title}</div>
          <button onClick={onClose} className="btn btn-sm" style={{ width: 32, padding: 0, justifyContent: 'center' }} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div style={{ padding: '20px 22px' }}>{children}</div>
      </div>
    </div>
  );
}

function RadioRow({ name, value, current, onChange, children }) {
  const selected = current === value;
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 13px',
        borderRadius: 'var(--radius-lg, 11px)',
        border: '1.5px solid ' + (selected ? 'var(--status-blue, #3b82f6)' : 'var(--border-input, #d6e0d2)'),
        background: selected ? 'var(--bg-soft-blue, #eaf0f7)' : 'var(--bg-card, #fff)',
        cursor: 'pointer',
        marginBottom: 8,
      }}
    >
      <input type="radio" name={name} checked={selected} onChange={() => onChange(value)} style={{ width: 17, height: 17, accentColor: '#3b82f6' }} />
      <span style={{ fontFamily: SANS, fontSize: 13.5, color: T_PRIMARY }}>{children}</span>
    </label>
  );
}

/* ── Pause modal ─────────────────────────────────────────────────────────── */

function PauseModal({ job, onCancel, onConfirm, busy }) {
  const [reason, setReason] = useState(null);
  const [notes, setNotes] = useState('');
  const needNotes = reason === 'Other';
  const valid = reason && (!needNotes || notes.trim());

  return (
    <Modal title="Pause reason — required" onClose={busy ? () => {} : onCancel}>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginBottom: 14 }}>
        {pick(job, 'uid', 'uid_code', 'code')} · Step {jobStep(job)} — the job stays running until you confirm a reason.
      </div>
      {PAUSE_REASONS.map((r) => (
        <RadioRow key={r} name="pause-reason" value={r} current={reason} onChange={setReason}>
          {r === 'Other' ? 'Other (enter reason below)' : r}
        </RadioRow>
      ))}
      <textarea
        className="form-input"
        placeholder={needNotes ? 'Reason (required for Other)' : 'Optional notes'}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        style={{ height: 'auto', padding: 11, resize: 'vertical', marginTop: 4 }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <button className="btn" style={{ height: 48, padding: '0 22px' }} onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          className="btn btn-primary"
          style={{ height: 48, padding: '0 22px' }}
          disabled={!valid || busy}
          onClick={() => onConfirm(reason, notes.trim())}
        >
          {busy ? 'Pausing…' : 'Confirm pause'}
        </button>
      </div>
    </Modal>
  );
}

/* ── Close modal ─────────────────────────────────────────────────────────── */

const QC_OPTIONS = ['No QC check for this step', 'Hardness (HRC)', 'Width (mm)', 'Straightness', 'Visual'];

function CloseModal({ job, timers, onCancel, onConfirm, busy }) {
  const step = Number(jobStep(job)) || 0;
  const isTempering = TEMPERING_STEPS.includes(step);
  const isQcStep = step === 26;

  const [qc, setQc] = useState(isQcStep ? 'Visual' : 'No QC check for this step');
  const [measured, setMeasured] = useState('');
  const [result, setResult] = useState('Pass');
  const [notes, setNotes] = useState('');
  const [temp, setTemp] = useState('');
  const [soak, setSoak] = useState('');

  const hasQc = qc !== 'No QC check for this step';
  const nextStep = step ? step + 1 : null;

  // Required readings on close:
  //  - QC step 26 cannot close without Pass/Fail (result is always set here, fine)
  //  - QC check selected → measured value required
  //  - tempering step → actual temperature + soak time required
  const valid =
    (!hasQc || measured.trim()) &&
    (!isQcStep || result) &&
    (!isTempering || (temp.trim() && soak.trim()));

  const pauses = pick(job, 'pause_count', 'pauses', 'pause_cycles');
  const totalElapsed = pick(job, 'total_elapsed_seconds', 'elapsed_seconds');

  function submit() {
    const payload = {
      qc_check: hasQc ? qc : null,
      qc_result: hasQc || isQcStep ? result : null,
      measured_value: hasQc ? measured.trim() : null,
      notes: notes.trim() || null,
    };
    if (isTempering) {
      payload.actual_temperature = temp.trim();
      payload.actual_soak_time = soak.trim();
    }
    onConfirm(payload);
  }

  return (
    <Modal title={`Close job — ${pick(job, 'uid', 'uid_code', 'code')} · Step ${step}`} onClose={busy ? () => {} : onCancel} width={560}>
      <div className="card" style={{ background: 'var(--bg-muted, #f4f7f2)', boxShadow: 'none', padding: '14px 16px', marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <Label>Net work time</Label>
          <Mono style={{ fontWeight: 700, color: T_PRIMARY }}>{fmtHMS(timers.net)}</Mono>
        </div>
        {totalElapsed != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <Label>Total elapsed (incl. pauses)</Label>
            <Mono style={{ color: T_SECONDARY }}>{fmtHMS(totalElapsed)}</Mono>
          </div>
        )}
        {pauses != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Label>Pauses</Label>
            <Mono style={{ color: T_SECONDARY }}>{pauses}</Mono>
          </div>
        )}
      </div>

      {isTempering && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 13, color: T_PRIMARY, marginBottom: 4 }}>Tempering reading — required</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Actual temperature (°C)</label>
              <input className="form-input" value={temp} onChange={(e) => setTemp(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <label className="form-label">Actual soak time (min)</label>
              <input className="form-input" value={soak} onChange={(e) => setSoak(e.target.value)} inputMode="decimal" />
            </div>
          </div>
        </div>
      )}

      <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 13, color: T_PRIMARY, marginBottom: 8 }}>
        {isQcStep ? 'QC inspection result — required' : 'QC check required at this step?'}
      </div>
      {!isQcStep &&
        QC_OPTIONS.map((o) => (
          <RadioRow key={o} name="qc-check" value={o} current={qc} onChange={setQc}>
            {o}
          </RadioRow>
        ))}

      {(hasQc || isQcStep) && (
        <div style={{ marginTop: 6 }}>
          {!isQcStep && (
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">Measured value</label>
              <input className="form-input" value={measured} onChange={(e) => setMeasured(e.target.value)} />
            </div>
          )}
          <label className="form-label">Result</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            {['Pass', 'Fail', 'Borderline'].map((r) => {
              const sel = result === r;
              const c = r === 'Pass' ? '#22a06b' : r === 'Fail' ? '#e5484d' : '#f0a020';
              return (
                <button
                  key={r}
                  onClick={() => setResult(r)}
                  className="btn"
                  style={{
                    height: 44,
                    flex: 1,
                    justifyContent: 'center',
                    border: '1.5px solid ' + (sel ? c : 'var(--border-input, #d6e0d2)'),
                    background: sel ? c + '22' : 'var(--bg-card, #fff)',
                    color: sel ? c : T_SECONDARY,
                    fontWeight: 700,
                  }}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <label className="form-label">Notes (optional)</label>
        <textarea
          className="form-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          style={{ height: 'auto', padding: 11, resize: 'vertical' }}
        />
      </div>

      {result === 'Fail' && (hasQc || isQcStep) && (
        <div style={{ marginTop: 12, padding: '10px 13px', borderRadius: 9, background: 'var(--bg-soft-amber, #fdf6ef)', color: 'var(--status-danger-dark, #c0392b)', fontFamily: SANS, fontSize: 12 }}>
          A Fail result places the UID on hold automatically and alerts the supervisor.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" style={{ height: 48, padding: '0 22px' }} onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" style={{ height: 48, padding: '0 22px' }} disabled={!valid || busy} onClick={submit}>
          <Icon name="check" size={16} />
          {busy ? 'Closing…' : nextStep ? `Confirm close — advance to step ${nextStep}` : 'Confirm close'}
        </button>
      </div>
    </Modal>
  );
}

/* ── Active job card ─────────────────────────────────────────────────────── */

function ActiveJobCard({ job, nowMs, canAct, onStart, onPause, onResume, onClose, pendingAction }) {
  const timers = computeTimers(job, nowMs);
  const status = timers.status;
  const running = status === 'in_progress' || status === 'running' || status === 'active';
  const paused = status === 'paused';
  const accent = dotColor(status);

  const uid = pick(job, 'uid', 'uid_code', 'code');
  const step = jobStep(job);
  const opName = pick(job, 'operation', 'operation_name', 'step_name');
  const station = pick(job, 'workstation_name', 'unit_name', 'workstation_code', 'unit_code', 'workstation', 'station', 'station_code', 'unit');
  const cycle = pick(job, 'cycle', 'cycle_type');
  const length = pick(job, 'length', 'length_mm');
  const finish = pick(job, 'finish', 'pattern', 'finish_type');
  const mo = pick(job, 'mo', 'mo_number', 'manufacturing_order');
  const priority = pick(job, 'priority');
  const collectFrom = pick(job, 'collect_from', 'source_storage', 'collect_storage', 'source_location');
  const deliverTo = pick(job, 'deliver_to', 'destination_storage', 'deliver_storage', 'dest_location');
  const pauseReason = pick(job, 'pause_reason', 'last_pause_reason');

  const busy = !!pendingAction;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: `4px solid ${accent}` }}>
      <div style={{ padding: '18px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <StatusPill status={paused ? 'paused' : running ? 'in_progress' : status} label={paused && pauseReason ? `PAUSED — ${pauseReason}` : undefined} />
          <Mono style={{ fontSize: 11, color: T_SECONDARY }}>
            {pick(job, 'shift', 'shift_name', 'shift_number') ? `Shift ${pick(job, 'shift', 'shift_name', 'shift_number')} · ` : ''}{station || ''}
          </Mono>
        </div>

        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 34, letterSpacing: '-0.03em', color: T_PRIMARY, marginTop: 12, lineHeight: 1 }}>
          {uid || '—'}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, marginTop: 6 }}>
          {[opName, station, step != null ? `Step ${step}` : null].filter(Boolean).join(' · ')}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {cycle && <CycleBadge cycle={cycle} />}
          {length != null && <Mono style={{ fontSize: 11, color: T_SECONDARY }}>{length}{String(length).match(/mm$/) ? '' : 'mm'}</Mono>}
          {finish && <span style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY }}>{finish}</span>}
          {mo && <Mono style={{ fontSize: 11, color: T_SECONDARY }}>{mo}</Mono>}
          {priority && <PriorityBadge priority={priority} />}
        </div>

        {(collectFrom || deliverTo) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontFamily: MONO, fontSize: 12, color: T_PRIMARY }}>
            {collectFrom && <span><span style={{ color: T_MUTED }}>Collect from </span>{collectFrom}</span>}
            {collectFrom && deliverTo && <Icon name="chevronRight" size={14} color={T_MUTED} />}
            {deliverTo && <span><span style={{ color: T_MUTED }}>Deliver to </span>{deliverTo}</span>}
          </div>
        )}
      </div>

      {/* timers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border-card, #e3ebde)' }}>
        {paused ? (
          <>
            <TimerCell label="Paused for" value={fmtHMS(timers.paused)} color="#d97a2b" />
            <TimerCell label="Net work time so far" value={fmtHMS(timers.net)} color={T_PRIMARY} />
          </>
        ) : (
          <>
            <TimerCell label="Active time (since resume)" value={fmtHMS(timers.active)} color={accent} />
            <TimerCell label="Net work time" value={fmtHMS(timers.net)} color={T_PRIMARY} />
          </>
        )}
      </div>

      {step != null && (
        <div style={{ padding: '16px 22px', borderTop: '1px solid var(--border-card, #e3ebde)' }}>
          <Label style={{ marginBottom: 8 }}>Step progress</Label>
          <StepTrack step={step} />
        </div>
      )}

      {/* actions */}
      <div style={{ padding: '16px 22px', borderTop: '1px solid var(--border-card, #e3ebde)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {!canAct ? (
          <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY }}>Read-only — you do not have permission to act on this job.</div>
        ) : running ? (
          <>
            <button className="btn" style={{ height: 56, flex: 1, minWidth: 160, justifyContent: 'center', fontSize: 14 }} disabled={busy} onClick={onPause}>
              <Icon name="pause" size={20} />{pendingAction === 'pause' ? 'Pausing…' : 'Pause'}
            </button>
            <button className="btn btn-primary" style={{ height: 56, flex: 1, minWidth: 160, justifyContent: 'center', fontSize: 14 }} disabled={busy} onClick={onClose}>
              <Icon name="check" size={20} />{pendingAction === 'close' ? 'Closing…' : 'Close job'}
            </button>
          </>
        ) : paused ? (
          <button className="btn btn-primary" style={{ height: 56, flex: 1, justifyContent: 'center', fontSize: 14 }} disabled={busy} onClick={onResume}>
            <Icon name="play" size={20} />{pendingAction === 'resume' ? 'Resuming…' : 'Resume job'}
          </button>
        ) : (
          <button className="btn btn-primary" style={{ height: 56, flex: 1, justifyContent: 'center', fontSize: 14 }} disabled={busy} onClick={onStart}>
            <Icon name="play" size={20} />{pendingAction === 'start' ? 'Starting…' : 'Start job'}
          </button>
        )}
      </div>
    </div>
  );
}

function TimerCell({ label, value, color }) {
  return (
    <div style={{ background: 'var(--bg-card, #fff)', padding: '16px 22px' }}>
      <Label>{label}</Label>
      <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 30, color, marginTop: 6, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

/* ── Bunch grinding (SG-DLT) ──────────────────────────────────────────────────
   For the SG-DLT bunch-grinding machine the operator manually LOADS several
   bars at once (a "bunch") onto the machine, runs them together, then closes
   the whole bunch. This panel REPLACES the single active-job card + queue for
   SG-DLT stations only. Bars in a single bunch must share one operation_name
   (the backend rejects mixed steps with STEP_MISMATCH).
   ──────────────────────────────────────────────────────────────────────────── */

function BunchBarRow({ uid, idx, selected, disabled, onToggle }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderTop: idx ? '1px solid var(--border-card, #e3ebde)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        background: selected ? 'var(--bg-soft-blue, #eaf0f7)' : 'transparent',
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        disabled={disabled}
        onChange={onToggle}
        style={{ width: 18, height: 18, accentColor: '#3b82f6', flex: '0 0 auto' }}
      />
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', color: T_PRIMARY, minWidth: 64 }}>
        {pick(uid, 'uid_code') || pick(uid, 'uid_id')}
      </div>
      {pick(uid, 'operation_name') && (
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: T_SECONDARY,
            background: 'var(--bg-muted, #f4f7f2)',
            border: '1px solid var(--border-card, #e3ebde)',
            borderRadius: 6,
            padding: '3px 7px',
          }}
        >
          {pick(uid, 'operation_name')}
        </span>
      )}
      <div style={{ flex: 1 }} />
      {pick(uid, 'size_mm') != null && (
        <Mono style={{ fontSize: 12, color: T_SECONDARY }}>{pick(uid, 'size_mm')}mm</Mono>
      )}
      {pick(uid, 'storage_code') && (
        <Mono style={{ fontSize: 11, color: T_MUTED }}>{pick(uid, 'storage_code')}</Mono>
      )}
    </label>
  );
}

function BunchGrindingPanel({ unitId, nowMs, canAct }) {
  const { data: activeData, refetch: refetchActive } = usePolling(
    () => (unitId == null ? Promise.resolve(null) : batchesApi.grindingActiveBatch(unitId).then((r) => r.data)),
    [unitId],
    { interval: 20000 }
  );
  const { data: queueData, refetch: refetchQueue } = usePolling(
    () => batchesApi.grindingQueue().then((r) => r.data),
    [],
    { interval: 20000 }
  );

  const activeBatch = activeData || null;
  const bedLengthMm = pick(queueData || {}, 'bedLengthMm');
  const queueUids = useMemo(() => (queueData && Array.isArray(queueData.uids) ? queueData.uids : []), [queueData]);

  const [selected, setSelected] = useState({}); // uid_id -> true
  const [selectedOp, setSelectedOp] = useState(null); // the operation_name the current selection is locked to
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState(null);

  // Clear any stale selection if the underlying queue no longer contains it.
  useEffect(() => {
    setSelected((prev) => {
      const next = {};
      for (const u of queueUids) {
        const id = String(pick(u, 'uid_id'));
        if (prev[id]) next[id] = true;
      }
      return next;
    });
  }, [queueUids]);

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const selectedCount = selectedIds.length;

  // Reset the operation lock once nothing is selected.
  useEffect(() => {
    if (selectedCount === 0 && selectedOp != null) setSelectedOp(null);
  }, [selectedCount, selectedOp]);

  const combinedLength = useMemo(() => {
    let sum = 0;
    for (const u of queueUids) {
      const id = String(pick(u, 'uid_id'));
      if (selected[id]) sum += Number(pick(u, 'size_mm')) || 0;
    }
    return sum;
  }, [queueUids, selected]);

  const overflow = bedLengthMm != null && combinedLength > Number(bedLengthMm);

  // Group queued bars by operation_name (bars in a bunch must share one step).
  const groups = useMemo(() => {
    const map = new Map();
    for (const u of queueUids) {
      const op = pick(u, 'operation_name') || 'Unspecified';
      if (!map.has(op)) map.set(op, []);
      map.get(op).push(u);
    }
    return Array.from(map.entries()); // [opName, uids[]]
  }, [queueUids]);

  function toggle(uid) {
    const id = String(pick(uid, 'uid_id'));
    const op = pick(uid, 'operation_name');
    setOpError(null);
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = true;
        if (selectedOp == null) setSelectedOp(op);
      }
      return next;
    });
  }

  async function load() {
    if (!selectedCount || overflow) return;
    setBusy(true);
    setOpError(null);
    try {
      await batchesApi.grindingLoadBatch(unitId, selectedIds);
      setSelected({});
      setSelectedOp(null);
      await Promise.all([refetchActive(), refetchQueue()]);
    } catch (err) {
      setOpError(err?.message || 'Could not load the bunch — please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function closeBunch() {
    if (!activeBatch) return;
    setBusy(true);
    setOpError(null);
    try {
      await batchesApi.grindingCloseBatch(pick(activeBatch, 'id'));
      await Promise.all([refetchActive(), refetchQueue()]);
    } catch (err) {
      setOpError(err?.message || 'Could not close the bunch — please try again.');
    } finally {
      setBusy(false);
    }
  }

  /* ── Active bunch on the machine ── */
  if (activeBatch) {
    const bars = Array.isArray(pick(activeBatch, 'uids')) ? pick(activeBatch, 'uids') : [];
    const combined = pick(activeBatch, 'combined_length_mm');
    const elapsed = elapsedFrom(pick(activeBatch, 'started_at'), nowMs);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {opError && (
          <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderLeft: '4px solid var(--status-danger, #e5484d)' }}>
            <Icon name="alert" size={18} color="#e5484d" />
            <span style={{ fontFamily: SANS, fontSize: 13, color: 'var(--status-danger-dark, #c0392b)', flex: 1 }}>{opError}</span>
          </div>
        )}
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: '4px solid #22a06b' }}>
          <div style={{ padding: '18px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <StatusPill status="in_progress" label="BUNCH RUNNING" />
              <Mono style={{ fontSize: 11, color: T_SECONDARY }}>{pick(activeBatch, 'operation_name') || ''}</Mono>
            </div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 30, letterSpacing: '-0.03em', color: T_PRIMARY, marginTop: 12, lineHeight: 1 }}>
              {pick(activeBatch, 'batch_number') || 'Bunch'}
            </div>
            <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, marginTop: 6 }}>
              {bars.length} {bars.length === 1 ? 'bar' : 'bars'} loaded
            </div>
          </div>

          {/* loaded bars */}
          <div style={{ borderTop: '1px solid var(--border-card, #e3ebde)' }}>
            {bars.map((b, i) => (
              <div
                key={pick(b, 'uid_id') ?? i}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 22px', borderTop: i ? '1px solid var(--border-card, #e3ebde)' : 'none' }}
              >
                <Mono style={{ fontSize: 12, color: T_MUTED, width: 18 }}>{i + 1}.</Mono>
                <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', color: T_PRIMARY, minWidth: 64 }}>
                  {pick(b, 'uid_code') || pick(b, 'uid_id')}
                </div>
                {pick(b, 'set_number') != null && <Mono style={{ fontSize: 11, color: T_MUTED }}>Set {pick(b, 'set_number')}</Mono>}
                <div style={{ flex: 1 }} />
                {pick(b, 'size_mm') != null && <Mono style={{ fontSize: 12, color: T_SECONDARY }}>{pick(b, 'size_mm')}mm</Mono>}
              </div>
            ))}
          </div>

          {/* timers + bed usage */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border-card, #e3ebde)', borderTop: '1px solid var(--border-card, #e3ebde)' }}>
            <TimerCell label="Running for" value={fmtHMS(elapsed)} color="#22a06b" />
            <div style={{ background: 'var(--bg-card, #fff)', padding: '16px 22px' }}>
              <Label>Bed usage</Label>
              <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 30, color: T_PRIMARY, marginTop: 6, lineHeight: 1 }}>
                {combined != null ? combined : '—'}{bedLengthMm != null ? ` / ${bedLengthMm}` : ''} mm
              </div>
            </div>
          </div>

          {/* actions */}
          <div style={{ padding: '16px 22px', borderTop: '1px solid var(--border-card, #e3ebde)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {!canAct ? (
              <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY }}>Read-only — you do not have permission to act on this machine.</div>
            ) : (
              <button className="btn btn-primary" style={{ height: 56, flex: 1, justifyContent: 'center', fontSize: 14 }} disabled={busy} onClick={closeBunch}>
                <Icon name="check" size={20} />{busy ? 'Closing…' : 'Close bunch'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ── No active bunch: load one from the queue ── */
  const empty = queueUids.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {opError && (
        <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderLeft: '4px solid var(--status-danger, #e5484d)' }}>
          <Icon name="alert" size={18} color="#e5484d" />
          <span style={{ fontFamily: SANS, fontSize: 13, color: 'var(--status-danger-dark, #c0392b)', flex: 1 }}>{opError}</span>
        </div>
      )}

      <div className="card" style={{ padding: 28, textAlign: 'center' }}>
        <StatusPill status="idle" label="MACHINE EMPTY" />
        <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, marginTop: 10 }}>
          No bunch loaded. Select bars of the same operation below and load them together.
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: empty ? 'none' : '1px solid var(--border-card, #e3ebde)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="list" size={16} color={T_SECONDARY} />
          <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 14, letterSpacing: '-0.02em', color: T_PRIMARY }}>
            Bars waiting for bunch grinding
          </span>
          <Mono style={{ fontSize: 11, color: T_MUTED }}>
            ({queueUids.length} {queueUids.length === 1 ? 'bar' : 'bars'})
          </Mono>
        </div>

        {empty ? (
          <div style={{ padding: '24px 18px', fontFamily: SANS, fontSize: 13, color: T_SECONDARY, textAlign: 'center' }}>
            No bars waiting for bunch grinding.
          </div>
        ) : (
          groups.map(([opName, uids], gi) => {
            // Once a selection has started, lock to that operation; others disabled.
            const opLocked = selectedOp != null && opName !== selectedOp;
            return (
              <div key={opName} style={{ borderTop: gi ? '4px solid var(--bg-muted, #f4f7f2)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: 'var(--bg-muted, #f4f7f2)' }}>
                  <Label style={{ color: T_SECONDARY }}>{opName}</Label>
                  <Mono style={{ fontSize: 10.5, color: T_MUTED }}>· {uids.length}</Mono>
                  {opLocked && (
                    <Mono style={{ fontSize: 10, color: T_MUTED, marginLeft: 'auto' }}>locked — different step</Mono>
                  )}
                </div>
                {uids.map((u, i) => {
                  const id = String(pick(u, 'uid_id'));
                  return (
                    <BunchBarRow
                      key={id ?? i}
                      uid={u}
                      idx={i}
                      selected={!!selected[id]}
                      disabled={!canAct || busy || (opLocked && !selected[id])}
                      onToggle={() => toggle(u)}
                    />
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* tally + load action */}
      {!empty && (
        <div className="card" style={{ padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <Label>Selected</Label>
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 16, color: overflow ? 'var(--status-danger, #e5484d)' : T_PRIMARY, marginTop: 4 }}>
              {selectedCount} {selectedCount === 1 ? 'bar' : 'bars'} · {combinedLength}{bedLengthMm != null ? ` / ${bedLengthMm}` : ''} mm
            </div>
            {overflow && (
              <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--status-danger-dark, #c0392b)', marginTop: 4 }}>
                Exceeds bed length — remove a bar before loading.
              </div>
            )}
          </div>
          <div style={{ flex: 1 }} />
          {canAct && (
            <button
              className="btn btn-primary"
              style={{ height: 52, minWidth: 220, justifyContent: 'center', fontSize: 14 }}
              disabled={busy || selectedCount === 0 || overflow}
              onClick={load}
            >
              <Icon name="play" size={18} />
              {busy ? 'Loading…' : `Load bunch (${selectedCount} ${selectedCount === 1 ? 'bar' : 'bars'} · ${combinedLength} mm)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Queue ───────────────────────────────────────────────────────────────── */

function QueueRow({ job, idx, nowMs, canAct, onStart, pending }) {
  const uid = pick(job, 'uid', 'uid_code', 'code');
  const length = pick(job, 'length', 'length_mm');
  const priority = pick(job, 'priority') || 'Normal';
  const waitSince = pick(job, 'queued_at', 'assigned_at', 'wait_since', 'created_at');
  const waitSecondsField = pick(job, 'wait_seconds', 'waiting_seconds');
  const wait = waitSecondsField != null ? Number(waitSecondsField) : elapsedFrom(waitSince, nowMs);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderTop: idx ? '1px solid var(--border-card, #e3ebde)' : 'none' }}>
      <Mono style={{ fontSize: 12, color: T_MUTED, width: 18 }}>{idx + 1}.</Mono>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', color: T_PRIMARY, minWidth: 56 }}>{uid}</div>
      {length != null && <Mono style={{ fontSize: 11, color: T_SECONDARY }}>{length}{String(length).match(/mm$/) ? '' : 'mm'}</Mono>}
      <PriorityBadge priority={priority} />
      <div style={{ flex: 1 }} />
      <Mono style={{ fontSize: 12, color: T_SECONDARY }} title="Waiting">{fmtHMS(wait)}</Mono>
      {canAct && (
        <button className="btn btn-sm" style={{ height: 40 }} disabled={!!pending} onClick={onStart}>
          <Icon name="play" size={15} />{pending ? 'Starting…' : 'Start'}
        </button>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

const ACTIVE_STATUSES = ['in_progress', 'running', 'active', 'paused'];

export default function MyWorkstation() {
  const { user, isOperator, isSupervisor, isAdmin, isManager } = useAuth();
  const canAct = isOperator || isSupervisor || isAdmin; // Manager view is read-only
  const nowMs = useNow(true);

  const operatorId = pick(user || {}, 'id', 'user_id', 'operator_id');

  const { data, error, loading, refetch } = usePolling(
    () => jobsApi.list({ assignedTo: operatorId, operator: operatorId }).then((r) => r.data),
    [operatorId]
  );

  // Normalise to a flat job array regardless of envelope shape.
  const jobs = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.jobs || data.items || data.results || [];
  }, [data]);

  // Group jobs into workstations (an operator can run several this shift).
  const stations = useMemo(() => {
    const map = new Map();
    for (const job of jobs) {
      const code = pick(job, 'workstation_code', 'unit_code', 'workstation', 'station', 'station_code') || 'Unassigned';
      const name = pick(job, 'workstation_name', 'unit_name', 'workstation_type_code') || code;
      if (!map.has(code)) map.set(code, { code, name, jobs: [] });
      map.get(code).jobs.push(job);
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [jobs]);

  const [activeStation, setActiveStation] = useState(null);
  useEffect(() => {
    if (stations.length && (!activeStation || !stations.find((s) => s.code === activeStation))) {
      setActiveStation(stations[0].code);
    }
  }, [stations, activeStation]);

  const station = stations.find((s) => s.code === activeStation) || stations[0] || null;

  // SG-DLT bunch-grinding stations use a different model: the operator loads
  // several bars at once. Detect by the jobs' workstation type.
  const isBunch = (station?.jobs || []).some((j) => pick(j, 'workstation_type_code') === 'SG-DLT');
  const unitId = pick(station?.jobs?.[0] || {}, 'workstation_unit_id');

  // Within a station: the active (in-progress/paused) job vs. queued jobs.
  const activeJob = useMemo(
    () => (station ? station.jobs.find((j) => ACTIVE_STATUSES.includes(jobStatus(j))) : null),
    [station]
  );
  const queue = useMemo(
    () => (station ? station.jobs.filter((j) => !ACTIVE_STATUSES.includes(jobStatus(j))) : []),
    [station]
  );

  const [pending, setPending] = useState(null); // { id, action }
  const [pauseFor, setPauseFor] = useState(null); // job
  const [closeFor, setCloseFor] = useState(null); // job
  const [actionError, setActionError] = useState(null);

  const runAction = useCallback(
    async (job, action, fn) => {
      setActionError(null);
      setPending({ id: jobId(job), action });
      try {
        await fn();
        await refetch();
      } catch (err) {
        setActionError(err?.message || 'Action failed — please try again.');
      } finally {
        setPending(null);
      }
    },
    [refetch]
  );

  const pendingFor = (job, action) => {
    if (!pending || pending.id !== jobId(job)) return null;
    return action ? (pending.action === action ? action : null) : pending.action;
  };

  const handleStart = (job) => runAction(job, 'start', () => jobsApi.start(jobId(job)));
  const handleResume = (job) => runAction(job, 'resume', () => jobsApi.resume(jobId(job)));

  const handlePauseConfirm = (job) => (reason, notes) =>
    runAction(job, 'pause', () => jobsApi.pause(jobId(job), reason, notes)).then(() => setPauseFor(null));

  const handleCloseConfirm = (job) => async (payload) => {
    await runAction(job, 'close', async () => {
      await jobsApi.close(jobId(job), payload);
      // Advance the UID to its next step on successful close.
      const code = pick(job, 'uid', 'uid_code', 'code');
      if (code) {
        try {
          await uidsApi.advance(code, { from_step: jobStep(job) });
        } catch {
          // The close endpoint may already advance server-side; ignore a
          // duplicate-advance error rather than blocking the operator.
        }
      }
    });
    setCloseFor(null);
  };

  /* ── render states ── */

  const header = (
    <>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: T_PRIMARY }}>My Workstation</div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, marginTop: 4 }}>
        {pick(user || {}, 'name', 'full_name', 'username') || 'Operator'} · your assigned workstations this shift{loading ? ' · loading…' : ''}
        {(isManager && !isAdmin) ? ' · read-only' : ''}
      </div>
    </>
  );

  if (error) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
        {header}
        <div className="card" style={{ marginTop: 20, padding: 28, textAlign: 'center' }}>
          <div style={{ fontFamily: SANS, fontSize: 14, color: 'var(--status-danger-dark, #c0392b)' }}>
            {error.message || 'Could not load your queue.'}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={refetch}>
            <Icon name="refresh" size={16} />Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
        {header}
        <div className="card" style={{ marginTop: 20, padding: 40, textAlign: 'center', fontFamily: SANS, fontSize: 13, color: T_SECONDARY }}>
          Loading your workstations…
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

      {stations.length === 0 ? (
        <div className="card" style={{ marginTop: 20, padding: 40, textAlign: 'center' }}>
          <Icon name="monitor" size={28} color={T_MUTED} />
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 16, color: T_PRIMARY, marginTop: 10 }}>No workstations assigned</div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, marginTop: 4 }}>
            You have no jobs allotted to you this shift. Your supervisor assigns work here.
          </div>
        </div>
      ) : (
        <>
          {/* workstation tab strip */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>
            {stations.map((s) => {
              const sActive = s.jobs.find((j) => ACTIVE_STATUSES.includes(jobStatus(j)));
              const sStatus = sActive ? jobStatus(sActive) : 'idle';
              const sel = s.code === activeStation;
              return (
                <button
                  key={s.code}
                  onClick={() => setActiveStation(s.code)}
                  className="btn"
                  style={{
                    height: 48,
                    padding: '0 18px',
                    background: sel ? 'var(--ink-650, #15366a)' : 'var(--bg-card, #fff)',
                    color: sel ? 'var(--text-onink, #eaf4e4)' : T_PRIMARY,
                    border: sel ? 'none' : '1px solid var(--border-input, #d6e0d2)',
                  }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor(sStatus), display: 'inline-block' }} />
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
                    <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700 }}>{s.name}</span>
                    {s.name !== s.code && <span style={{ fontFamily: MONO, fontSize: 10, opacity: 0.7 }}>{s.code}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          {station && (
            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* station heading */}
              <div>
                <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em', color: T_PRIMARY }}>
                  {station.name}
                  {station.name !== station.code && <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 13, color: T_MUTED }}>{' '}· {station.code}</span>}
                  {isBunch && (
                    <span style={{ fontFamily: SANS, fontWeight: 500, fontSize: 14, color: T_SECONDARY }}>
                      {' '}— Bunch grinding
                    </span>
                  )}
                  {!isBunch && activeJob && (
                    <span style={{ fontFamily: SANS, fontWeight: 500, fontSize: 14, color: T_SECONDARY }}>
                      {' '}— {pick(activeJob, 'operation', 'operation_name', 'step_name') || 'Active job'}
                      {jobStep(activeJob) != null ? ` · Step ${jobStep(activeJob)}` : ''}
                    </span>
                  )}
                </div>
              </div>

              {isBunch ? (
                <BunchGrindingPanel unitId={unitId} nowMs={nowMs} canAct={canAct} />
              ) : (
                <>
                  {activeJob ? (
                    <ActiveJobCard
                      job={activeJob}
                      nowMs={nowMs}
                      canAct={canAct}
                      pendingAction={pendingFor(activeJob)}
                      onStart={() => handleStart(activeJob)}
                      onResume={() => handleResume(activeJob)}
                      onPause={() => setPauseFor(activeJob)}
                      onClose={() => setCloseFor(activeJob)}
                    />
                  ) : (
                    <div className="card" style={{ padding: 28, textAlign: 'center' }}>
                      <StatusPill status="idle" />
                      <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, marginTop: 10 }}>
                        No active job at this workstation. Start the next job from the queue below.
                      </div>
                    </div>
                  )}

                  {/* queue */}
                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '14px 18px', borderBottom: queue.length ? '1px solid var(--border-card, #e3ebde)' : 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon name="list" size={16} color={T_SECONDARY} />
                      <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 14, letterSpacing: '-0.02em', color: T_PRIMARY }}>
                        Queue — {station.name}
                      </span>
                      <Mono style={{ fontSize: 11, color: T_MUTED }}>
                        ({queue.length} {queue.length === 1 ? 'UID' : 'UIDs'} waiting)
                      </Mono>
                    </div>
                    {queue.length === 0 ? (
                      <div style={{ padding: '20px 18px', fontFamily: SANS, fontSize: 13, color: T_SECONDARY }}>
                        Queue is clear — no UIDs waiting at this workstation.
                      </div>
                    ) : (
                      queue.map((job, i) => (
                        <QueueRow
                          key={jobId(job) ?? i}
                          job={job}
                          idx={i}
                          nowMs={nowMs}
                          canAct={canAct && !activeJob}
                          pending={pendingFor(job, 'start')}
                          onStart={() => handleStart(job)}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {pauseFor && (
        <PauseModal
          job={pauseFor}
          busy={pendingFor(pauseFor, 'pause') === 'pause'}
          onCancel={() => setPauseFor(null)}
          onConfirm={handlePauseConfirm(pauseFor)}
        />
      )}
      {closeFor && (
        <CloseModal
          job={closeFor}
          timers={computeTimers(closeFor, nowMs)}
          busy={pendingFor(closeFor, 'close') === 'close'}
          onCancel={() => setCloseFor(null)}
          onConfirm={handleCloseConfirm(closeFor)}
        />
      )}
    </div>
  );
}
