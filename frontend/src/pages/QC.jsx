import { useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { qcApi } from '../api/resources';
import { useAuth } from '../store/AuthContext';
import { StatusPill } from '../components/common/Badges';
import Icon from '../components/common/Icon';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

const CHECK_TYPES = [
  { value: 'hardness_hrc', label: 'Hardness HRC', numeric: true },
  { value: 'diameter_mm', label: 'Diameter mm', numeric: true },
  { value: 'length_mm', label: 'Length mm', numeric: true },
  { value: 'straightness', label: 'Straightness', numeric: false },
  { value: 'visual', label: 'Visual', numeric: false },
  { value: 'other', label: 'Other', numeric: false },
];

function SectionTitle({ children }) {
  return (
    <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)', marginBottom: 12 }}>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', padding: '6px 0' }}>
      {children}
    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-danger, #e5484d)', background: 'rgba(229,72,77,0.08)', border: '1px solid rgba(229,72,77,0.25)', borderRadius: 'var(--radius-md, 9px)', padding: '10px 12px' }}>
      <Icon name="alert" size={15} color="var(--status-danger, #e5484d)" />
      <span>{message}</span>
    </div>
  );
}

function PendingCard({ item, onPass, onFail, onRework, busy }) {
  const [mode, setMode] = useState(null); // null | 'fail' | 'rework'
  const [reason, setReason] = useState('');
  const [targetStep, setTargetStep] = useState('');

  const uid = item.uidCode || item.uid_code || item.uid || '—';
  const stepNo = item.stepNumber ?? item.step_number ?? item.step;
  const stepName = item.stepName || item.step_name || '';
  const ws = item.workstation || item.workstation_code || item.workstationUnit || '';
  const checkType = item.qcCheckType || item.qc_check_type || item.checkType || '';
  const waiting = item.waitingFor || item.waiting || item.timeWaiting || item.time_waiting || '';
  const flagged = item.borderline || item.flagged;
  const measurements = item.measurements || item.measurement || item.loggedMeasurements;

  function reset() {
    setMode(null);
    setReason('');
    setTargetStep('');
  }

  return (
    <div style={{ border: '1px solid var(--border-card, #e3ebde)', borderRadius: 'var(--radius-lg, 11px)', padding: '12px 13px', background: 'var(--bg-muted-2, #f6f9f4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>{uid}</span>
        {flagged ? <StatusPill status="borderline" label="Flagged" /> : null}
      </div>

      <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary, #5d7188)', marginTop: 5 }}>
        {stepNo != null ? `Step ${stepNo}` : ''}{stepName ? ` · ${stepName}` : ''}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7, fontFamily: MONO, fontSize: 10, color: 'var(--text-muted-2, #7d96bb)' }}>
        {ws ? <span>WS {ws}</span> : null}
        {checkType ? <span>· {checkType}</span> : null}
        {waiting ? <span>· waiting {waiting}</span> : null}
      </div>

      {measurements ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-primary, #15366a)', marginTop: 7, background: 'var(--bg-card, #fff)', border: '1px solid var(--border-input, #d6e0d2)', borderRadius: 'var(--radius-sm, 5px)', padding: '6px 8px' }}>
          {typeof measurements === 'string' ? measurements : JSON.stringify(measurements)}
        </div>
      ) : null}

      {mode === null ? (
        <div style={{ display: 'flex', gap: 7, marginTop: 11 }}>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onPass(item)}>Pass</button>
          <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => setMode('fail')}>Fail</button>
          <button className="btn btn-sm" disabled={busy} onClick={() => setMode('rework')}>Rework</button>
        </div>
      ) : (
        <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mode === 'rework' && (
            <div>
              <label className="form-label">Target step</label>
              <input
                className="form-input"
                style={{ height: 38 }}
                placeholder="step number to send back to"
                value={targetStep}
                onChange={(e) => setTargetStep(e.target.value)}
              />
            </div>
          )}
          <div>
            <label className="form-label">{mode === 'fail' ? 'Fail reason' : 'Rework reason'} (required)</label>
            <textarea
              className="form-input"
              style={{ height: 56, padding: '8px 13px', resize: 'vertical' }}
              placeholder={mode === 'fail' ? 'why did this fail?' : 'why is rework needed?'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            {mode === 'fail' ? (
              <button
                className="btn btn-danger btn-sm"
                disabled={busy || !reason.trim()}
                onClick={() => onFail(item, reason.trim()).then((ok) => ok && reset())}
              >
                Confirm Fail · Hold
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                disabled={busy || !reason.trim() || !targetStep.trim()}
                onClick={() => onRework(item, targetStep.trim(), reason.trim()).then((ok) => ok && reset())}
              >
                Send to Rework
              </button>
            )}
            <button className="btn btn-sm" disabled={busy} onClick={reset}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function QC() {
  const { user, isSupervisor, isManager, isAdmin } = useAuth();
  const canSignOff = isSupervisor || isManager || isAdmin;

  const { data: pending, error: pendingError, loading, refetch } = usePolling(
    () => qcApi.pending().then((r) => r.data),
    []
  );

  const [actionError, setActionError] = useState(null);
  const [busyUid, setBusyUid] = useState(null);

  // ── Log measurement form state ──
  const [logUid, setLogUid] = useState('');
  const [logStep, setLogStep] = useState('');
  const [checkType, setCheckType] = useState('hardness_hrc');
  const [measuredValue, setMeasuredValue] = useState('');
  const [result, setResult] = useState('Pass');
  const [notes, setNotes] = useState('');
  const [logBusy, setLogBusy] = useState(false);
  const [logError, setLogError] = useState(null);
  const [logSuccess, setLogSuccess] = useState(null);

  const activeCheck = CHECK_TYPES.find((c) => c.value === checkType) || CHECK_TYPES[0];
  const notesRequired = result === 'Fail' || result === 'Borderline';

  async function runSignOff(item, resultStr, reasonNotes) {
    const uid = item.uidCode || item.uid_code || item.uid;
    setBusyUid(uid);
    setActionError(null);
    try {
      await qcApi.signOff(uid, resultStr, reasonNotes);
      await refetch();
      return true;
    } catch (err) {
      setActionError(err.message || 'Sign-off failed.');
      return false;
    } finally {
      setBusyUid(null);
    }
  }

  async function runRework(item, targetStep, reason) {
    const uid = item.uidCode || item.uid_code || item.uid;
    setBusyUid(uid);
    setActionError(null);
    try {
      await qcApi.rework(uid, targetStep, reason);
      await refetch();
      return true;
    } catch (err) {
      setActionError(err.message || 'Rework request failed.');
      return false;
    } finally {
      setBusyUid(null);
    }
  }

  async function submitLog(e) {
    e.preventDefault();
    setLogError(null);
    setLogSuccess(null);
    if (!logUid.trim()) {
      setLogError('UID is required.');
      return;
    }
    if (notesRequired && !notes.trim()) {
      setLogError('Notes are required for Fail or Borderline results.');
      return;
    }
    setLogBusy(true);
    try {
      await qcApi.log({
        uidCode: logUid.trim(),
        stepNumber: logStep.trim() || undefined,
        checkType,
        measuredValue: activeCheck.numeric && measuredValue !== '' ? Number(measuredValue) : measuredValue || undefined,
        result,
        notes: notes.trim() || undefined,
        loggedBy: user?.username || user?.name,
      });
      let msg = 'Measurement logged.';
      if (result === 'Fail') msg = 'Measurement logged · UID placed on hold, supervisor alerted.';
      else if (result === 'Borderline') msg = 'Measurement logged · flagged for supervisor review.';
      setLogSuccess(msg);
      setLogUid('');
      setLogStep('');
      setMeasuredValue('');
      setResult('Pass');
      setNotes('');
      refetch();
    } catch (err) {
      setLogError(err.message || 'Could not save measurement.');
    } finally {
      setLogBusy(false);
    }
  }

  const pendingList = Array.isArray(pending) ? pending : pending?.items || [];

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
        Quality Control
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
        Log QC measurements and sign off inspections{loading ? ' · loading…' : ''}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 20, alignItems: 'start' }}>
        {/* ── LEFT: Pending sign-offs ── */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <SectionTitle>Pending Sign-offs</SectionTitle>
            <span className="badge" style={{ background: 'rgba(217,122,43,0.14)', color: 'var(--status-warning, #d97a2b)' }}>
              {pendingList.length} WAITING
            </span>
          </div>

          {actionError ? <div style={{ marginBottom: 10 }}><ErrorBanner message={actionError} /></div> : null}

          {pendingError ? (
            <ErrorBanner message="Could not load the pending queue." />
          ) : loading && !pending ? (
            <Empty>Loading queue…</Empty>
          ) : !canSignOff ? (
            <Empty>Sign-off requires a supervisor role. Operators can log measurements on the right.</Empty>
          ) : pendingList.length === 0 ? (
            <Empty>No UIDs waiting for sign-off.</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 560, overflowY: 'auto' }}>
              {pendingList.map((item, i) => (
                <PendingCard
                  key={item.uidCode || item.uid_code || item.uid || i}
                  item={item}
                  busy={busyUid === (item.uidCode || item.uid_code || item.uid)}
                  onPass={(it) => runSignOff(it, 'pass', null)}
                  onFail={(it, reason) => runSignOff(it, 'fail', reason)}
                  onRework={runRework}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── RIGHT: Log measurement ── */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionTitle>Log QC Measurement</SectionTitle>

          <form onSubmit={submitLog} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <div>
              <label className="form-label">UID (scan or type)</label>
              <input
                className="form-input"
                placeholder="scan or type UID"
                value={logUid}
                autoComplete="off"
                onChange={(e) => setLogUid(e.target.value)}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
              <div>
                <label className="form-label">Step number</label>
                <input
                  className="form-input"
                  placeholder="auto / type"
                  value={logStep}
                  onChange={(e) => setLogStep(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">QC check type</label>
                <select className="form-select" value={checkType} onChange={(e) => setCheckType(e.target.value)}>
                  {CHECK_TYPES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {activeCheck.numeric && (
              <div>
                <label className="form-label">Measured value</label>
                <input
                  className="form-input"
                  type="number"
                  step="any"
                  placeholder="numeric value"
                  value={measuredValue}
                  onChange={(e) => setMeasuredValue(e.target.value)}
                />
              </div>
            )}

            <div>
              <label className="form-label">Result</label>
              <div style={{ display: 'flex', gap: 7 }}>
                {['Pass', 'Fail', 'Borderline'].map((r) => {
                  const active = result === r;
                  const color = r === 'Pass' ? 'var(--status-success, #22a06b)' : r === 'Fail' ? 'var(--status-danger, #e5484d)' : 'var(--status-amber-2, #f0a020)';
                  return (
                    <button
                      type="button"
                      key={r}
                      onClick={() => setResult(r)}
                      className="btn btn-sm"
                      style={{
                        flex: 1,
                        justifyContent: 'center',
                        background: active ? color : 'var(--bg-card, #fff)',
                        color: active ? '#fff' : 'var(--text-secondary, #5d7188)',
                        border: active ? 'none' : '1px solid var(--border-input, #d6e0d2)',
                      }}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="form-label">Notes{notesRequired ? ' (required)' : ''}</label>
              <textarea
                className="form-input"
                style={{ height: 64, padding: '8px 13px', resize: 'vertical' }}
                placeholder={notesRequired ? 'reason required for fail / borderline' : 'optional notes'}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted-2, #7d96bb)' }}>
              Logged by: {user?.username || user?.name || '—'}
            </div>

            {logError ? <ErrorBanner message={logError} /> : null}
            {logSuccess ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-success-dark, #1c7a52)', background: 'rgba(34,160,107,0.1)', border: '1px solid rgba(34,160,107,0.25)', borderRadius: 'var(--radius-md, 9px)', padding: '10px 12px' }}>
                <Icon name="check" size={15} color="var(--status-success-dark, #1c7a52)" />
                <span>{logSuccess}</span>
              </div>
            ) : null}

            <button type="submit" className="btn btn-primary" disabled={logBusy} style={{ alignSelf: 'flex-start' }}>
              {logBusy ? 'Saving…' : 'Save Measurement'}
            </button>
          </form>
        </div>
      </div>

      {/* ── BOTTOM: Recent decisions / QC history ── */}
      <div className="card" style={{ marginTop: 16, padding: '18px 20px' }}>
        <SectionTitle>Recent QC Decisions</SectionTitle>
        <RecentDecisions pending={pendingList} />
      </div>
    </div>
  );
}

function RecentDecisions({ pending }) {
  // The pending payload may carry a recent-decisions/history slice; if not,
  // we surface whatever recent records the queue exposes. Read-only.
  const recent = (Array.isArray(pending) ? [] : pending?.recent) || [];

  if (!recent.length) {
    return <Empty>No recent QC decisions to show.</Empty>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: 12.5 }}>
        <thead>
          <tr style={{ textAlign: 'left', fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
            <th style={{ padding: '6px 10px 8px 0' }}>UID</th>
            <th style={{ padding: '6px 10px 8px 0' }}>Step</th>
            <th style={{ padding: '6px 10px 8px 0' }}>Check</th>
            <th style={{ padding: '6px 10px 8px 0' }}>Value</th>
            <th style={{ padding: '6px 10px 8px 0' }}>Result</th>
            <th style={{ padding: '6px 10px 8px 0' }}>Logged by</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((r, i) => (
            <tr key={r.id ?? i} style={{ borderTop: '1px solid #eef2ea' }}>
              <td style={{ padding: '8px 10px 8px 0', fontFamily: MONO, color: 'var(--text-primary, #15366a)' }}>{r.uidCode || r.uid_code || r.uid || '—'}</td>
              <td style={{ padding: '8px 10px 8px 0' }}>{r.stepNumber ?? r.step ?? '—'}</td>
              <td style={{ padding: '8px 10px 8px 0' }}>{r.checkType || r.check_type || '—'}</td>
              <td style={{ padding: '8px 10px 8px 0', fontFamily: MONO }}>{r.measuredValue ?? r.measured_value ?? '—'}</td>
              <td style={{ padding: '8px 10px 8px 0' }}>
                <StatusPill status={(r.result || '').toLowerCase()} label={r.result} />
              </td>
              <td style={{ padding: '8px 10px 8px 0', color: 'var(--text-secondary, #5d7188)' }}>{r.loggedBy || r.logged_by || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
