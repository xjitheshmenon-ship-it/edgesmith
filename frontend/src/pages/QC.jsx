import { useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { qcApi } from '../api/resources';
import { useAuth } from '../store/AuthContext';
import { StatusPill, PriorityBadge } from '../components/common/Badges';
import Icon from '../components/common/Icon';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

// QC happens at steps 7, 12, 26 — map current_step → the check that's due.
const STEP_CHECKS = {
  '7': 'Post-Quench Hardness',
  '12': 'Surface Grind Check',
  '26': 'Final Inspection',
};

function checkForStep(step) {
  return STEP_CHECKS[String(step)] || 'QC Check';
}

const RESULTS = ['Pass', 'Fail', 'Borderline'];

function SectionTitle({ children }) {
  return (
    <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)', marginBottom: 12 }}>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', padding: '14px 0', textAlign: 'center' }}>
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

function CheckTag({ check }) {
  return (
    <span
      className="badge"
      style={{ background: 'rgba(59,130,246,0.12)', color: 'var(--status-info, #3b82f6)', fontFamily: MONO, fontSize: 10 }}
    >
      {check}
    </span>
  );
}

// ── Inline value/result form, reused by the queue drop target and the manual entry ──
function InspectForm({ uid, check, busy, error, onSubmit, onCancel }) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState('Pass');

  function submit(e) {
    e.preventDefault();
    onSubmit({ value: value.trim(), result });
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div>
        <label className="form-label">Measured value{check ? ` · ${check}` : ''}</label>
        <input
          className="form-input"
          autoFocus
          autoComplete="off"
          placeholder="type the value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>

      <div>
        <label className="form-label">Result</label>
        <div style={{ display: 'flex', gap: 7 }}>
          {RESULTS.map((r) => {
            const active = result === r;
            const color = r === 'Pass'
              ? 'var(--status-success, #22a06b)'
              : r === 'Fail'
                ? 'var(--status-danger, #e5484d)'
                : 'var(--status-amber-2, #f0a020)';
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

      {error ? <ErrorBanner message={error} /> : null}

      <div style={{ display: 'flex', gap: 7 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !value.trim()}>
          {busy ? 'Saving…' : 'Record inspection'}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onCancel}>Cancel</button>
        ) : null}
      </div>
    </form>
  );
}

function getUid(item) {
  return item.uidCode || item.uid_code || item.uid || '—';
}
function getStep(item) {
  return item.currentStep ?? item.current_step ?? item.step;
}

// ── Random HRC inspection samples queue ──────────────────────────────────────
// Pieces the system randomly pulled for HRC after a flagged cycle step. The
// floor takes them to surface grind + the HRC table and records the reading here.
function HrcSamplesPanel() {
  const { data, loading, refetch } = usePolling(() => qcApi.hrcSamples('pending').then((r) => r.data), []);
  const samples = Array.isArray(data) ? data : [];
  const [active, setActive] = useState(null);
  const [val, setVal] = useState('');
  const [res, setRes] = useState('Pass');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function record(id) {
    setBusy(true);
    setErr(null);
    try {
      await qcApi.recordHrc(id, val.trim(), res, null);
      setActive(null); setVal(''); setRes('Pass');
      refetch();
    } catch (e) {
      setErr(e.message || 'Could not record HRC result.');
    } finally {
      setBusy(false);
    }
  }

  if ((!data && loading) || samples.length === 0) return null; // hidden until there are samples

  return (
    <div className="card" style={{ padding: '18px 20px', marginTop: 16, borderLeft: '4px solid #c0762b' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon name="thermo" size={15} color="#c0762b" />
        <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, color: 'var(--text-primary, #15366a)' }}>HRC Inspection Samples</span>
        <span className="badge" style={{ background: 'rgba(192,118,43,0.14)', color: '#c0762b' }}>{samples.length} pending</span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', marginBottom: 12 }}>
        Randomly sampled pieces — take to surface grind + HRC table, then record the reading. A Fail holds the piece.
      </div>
      {err ? <ErrorBanner message={err} /> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {samples.map((s) => (
          <div key={s.id} style={{ border: '1px solid var(--border-card, #e3ebde)', borderRadius: 9, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: 'var(--text-primary, #15366a)' }}>{s.uid_code}</span>
              <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary, #5d7188)' }}>
                from step {s.source_step_number}{s.source_operation ? ` · ${s.source_operation}` : ''}
              </span>
              <div style={{ flex: 1 }} />
              {active === s.id ? null : (
                <button className="btn btn-sm" onClick={() => { setActive(s.id); setVal(''); setRes('Pass'); setErr(null); }}>Record HRC</button>
              )}
            </div>
            {active === s.id && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
                <div>
                  <label className="form-label" style={{ marginBottom: 4 }}>HRC value</label>
                  <input className="form-input" style={{ height: 38, width: 110 }} type="number" step="any" value={val} onChange={(e) => setVal(e.target.value)} autoFocus />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {RESULTS.map((r) => {
                    const sel = res === r;
                    const c = r === 'Pass' ? '#22a06b' : r === 'Fail' ? '#e5484d' : '#f0a020';
                    return (
                      <button key={r} type="button" onClick={() => setRes(r)} className="btn btn-sm"
                        style={{ height: 38, border: '1.5px solid ' + (sel ? c : 'var(--border-input, #d6e0d2)'), background: sel ? c + '22' : '#fff', color: sel ? c : 'var(--text-secondary)', fontWeight: 700 }}>
                        {r}
                      </button>
                    );
                  })}
                </div>
                <button className="btn btn-primary btn-sm" style={{ height: 38 }} disabled={busy || val.trim() === ''} onClick={() => record(s.id)}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button className="btn btn-sm" style={{ height: 38 }} disabled={busy} onClick={() => setActive(null)}>Cancel</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function QC() {
  const { user } = useAuth();

  const { data: pending, error: pendingError, loading, refetch } = usePolling(
    () => qcApi.pending().then((r) => r.data),
    []
  );

  // UIDs inspected this shift, removed from the "to inspect" column.
  // Map keyed by uid → { uid, check, value, result }
  const [inspected, setInspected] = useState([]);
  // uid currently being inspected via inline form (drag-drop or button)
  const [activeUid, setActiveUid] = useState(null);
  const [rowBusy, setRowBusy] = useState(false);
  const [rowError, setRowError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  // Manual "type UID" entry (item not in the queue)
  const [manualUid, setManualUid] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState(null);
  const [manualSuccess, setManualSuccess] = useState(null);

  const rawList = Array.isArray(pending) ? pending : pending?.items || [];
  const inspectedUids = new Set(inspected.map((i) => i.uid));
  // Don't show items already inspected this shift, or that already carry a qc_result.
  const toInspect = rawList.filter((item) => {
    const uid = getUid(item);
    const alreadyResult = item.qcResult ?? item.qc_result;
    return !inspectedUids.has(uid) && !alreadyResult;
  });

  async function logInspection({ uid, check, value, result }) {
    await qcApi.log({ uidCode: uid, checkType: check, value, result });
  }

  async function submitQueueRow(item, { value, result }) {
    const uid = getUid(item);
    const check = checkForStep(getStep(item));
    setRowBusy(true);
    setRowError(null);
    try {
      await logInspection({ uid, check, value, result });
      setInspected((prev) => [{ uid, check, value, result }, ...prev]);
      setActiveUid(null);
      refetch();
    } catch (err) {
      setRowError(err.message || 'Could not record inspection.');
    } finally {
      setRowBusy(false);
    }
  }

  async function submitManual({ value, result }) {
    const uid = manualUid.trim();
    if (!uid) {
      setManualError('UID is required.');
      return;
    }
    setManualBusy(true);
    setManualError(null);
    setManualSuccess(null);
    try {
      await logInspection({ uid, check: 'QC Check', value, result });
      setInspected((prev) => [{ uid, check: 'QC Check', value, result }, ...prev]);
      let msg = 'Inspection recorded.';
      if (result === 'Fail') msg = 'Inspection recorded · UID placed on hold.';
      else if (result === 'Borderline') msg = 'Inspection recorded · flagged as borderline.';
      setManualSuccess(msg);
      setManualUid('');
      setManualOpen(false);
      refetch();
    } catch (err) {
      setManualError(err.message || 'Could not record inspection.');
    } finally {
      setManualBusy(false);
    }
  }

  // ── Drag and drop ──
  function onDragStart(e, item) {
    e.dataTransfer.setData('text/plain', getUid(item));
    e.dataTransfer.effectAllowed = 'move';
  }
  function onColumnDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragOver) setDragOver(true);
  }
  function onColumnDragLeave() {
    setDragOver(false);
  }
  function onColumnDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const uid = e.dataTransfer.getData('text/plain');
    if (!uid) return;
    const item = toInspect.find((it) => getUid(it) === uid);
    if (item) {
      setRowError(null);
      setActiveUid(uid);
    }
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
        Quality Control
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
        Inspect the QC queue — drag a job to “Inspected”, enter the value, and record the result{loading ? ' · loading…' : ''}
      </div>

      <HrcSamplesPanel />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          marginTop: 20,
          alignItems: 'start',
        }}
      >
        {/* ── LEFT: To inspect ── */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <SectionTitle>To Inspect</SectionTitle>
            <span className="badge" style={{ background: 'rgba(217,122,43,0.14)', color: 'var(--status-warning, #d97a2b)' }}>
              {toInspect.length} WAITING
            </span>
          </div>

          {pendingError ? (
            <ErrorBanner message="Could not load the QC queue." />
          ) : loading && !pending ? (
            <Empty>Loading queue…</Empty>
          ) : toInspect.length === 0 ? (
            <Empty>Nothing waiting for QC</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 600, overflowY: 'auto' }}>
              {toInspect.map((item, i) => {
                const uid = getUid(item);
                const check = checkForStep(getStep(item));
                const priority = item.priority || 'Normal';
                const isActive = activeUid === uid;
                return (
                  <div
                    key={uid || i}
                    draggable={!isActive}
                    onDragStart={(e) => onDragStart(e, item)}
                    style={{
                      border: isActive
                        ? '1px solid var(--status-info, #3b82f6)'
                        : '1px solid var(--border-card, #e3ebde)',
                      borderRadius: 'var(--radius-lg, 11px)',
                      padding: '12px 13px',
                      background: 'var(--bg-muted-2, #f6f9f4)',
                      cursor: isActive ? 'default' : 'grab',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>{uid}</span>
                      <PriorityBadge priority={priority} />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                      <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted-2, #7d96bb)' }}>
                        Step {getStep(item) ?? '—'}
                      </span>
                      <CheckTag check={check} />
                    </div>

                    {isActive ? (
                      <InspectForm
                        uid={uid}
                        check={check}
                        busy={rowBusy}
                        error={rowError}
                        onSubmit={(payload) => submitQueueRow(item, payload)}
                        onCancel={() => { setActiveUid(null); setRowError(null); }}
                      />
                    ) : (
                      <div style={{ marginTop: 10 }}>
                        <button
                          className="btn btn-sm"
                          onClick={() => { setRowError(null); setActiveUid(uid); }}
                        >
                          Inspect
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── RIGHT: Inspected (drop target) ── */}
        <div
          className="card"
          onDragOver={onColumnDragOver}
          onDragLeave={onColumnDragLeave}
          onDrop={onColumnDrop}
          style={{
            padding: '18px 20px',
            border: dragOver ? '2px dashed var(--status-info, #3b82f6)' : undefined,
            background: dragOver ? 'rgba(59,130,246,0.05)' : undefined,
            transition: 'background 120ms ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <SectionTitle>Inspected</SectionTitle>
            <span className="badge" style={{ background: 'rgba(34,160,107,0.14)', color: 'var(--status-success-dark, #1c7a52)' }}>
              {inspected.length} THIS SHIFT
            </span>
          </div>

          {inspected.length === 0 ? (
            <Empty>
              Nothing inspected yet
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted-2, #7d96bb)' }}>
                Drag a job here (or use “Inspect”) to record a result.
              </div>
            </Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 600, overflowY: 'auto' }}>
              {inspected.map((rec, i) => (
                <div
                  key={`${rec.uid}-${i}`}
                  style={{
                    border: '1px solid var(--border-card, #e3ebde)',
                    borderRadius: 'var(--radius-lg, 11px)',
                    padding: '12px 13px',
                    background: 'var(--bg-card, #fff)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>{rec.uid}</span>
                    <StatusPill status={rec.result.toLowerCase()} label={rec.result} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                    <CheckTag check={rec.check} />
                    <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-primary, #15366a)' }}>
                      {rec.value || '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Manual entry: type a UID not in the queue ── */}
      <div className="card" style={{ marginTop: 16, padding: '18px 20px' }}>
        <SectionTitle>Inspect a UID not in the queue</SectionTitle>

        <div style={{ display: 'flex', gap: 11, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <label className="form-label">UID</label>
            <input
              className="form-input"
              placeholder="type UID"
              value={manualUid}
              autoComplete="off"
              onChange={(e) => { setManualUid(e.target.value); setManualSuccess(null); }}
            />
          </div>
          {!manualOpen ? (
            <button
              className="btn btn-primary"
              disabled={!manualUid.trim()}
              onClick={() => { setManualError(null); setManualSuccess(null); setManualOpen(true); }}
            >
              Inspect
            </button>
          ) : null}
        </div>

        {manualOpen ? (
          <div style={{ marginTop: 4, maxWidth: 420 }}>
            <InspectForm
              uid={manualUid.trim()}
              check="QC Check"
              busy={manualBusy}
              error={manualError}
              onSubmit={submitManual}
              onCancel={() => { setManualOpen(false); setManualError(null); }}
            />
          </div>
        ) : null}

        {manualSuccess ? (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-success-dark, #1c7a52)', background: 'rgba(34,160,107,0.1)', border: '1px solid rgba(34,160,107,0.25)', borderRadius: 'var(--radius-md, 9px)', padding: '10px 12px' }}>
            <Icon name="check" size={15} color="var(--status-success-dark, #1c7a52)" />
            <span>{manualSuccess}</span>
          </div>
        ) : null}

        <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted-2, #7d96bb)', marginTop: 12 }}>
          Logged by: {user?.username || user?.name || '—'}
        </div>
      </div>
    </div>
  );
}
