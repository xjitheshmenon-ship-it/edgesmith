import { useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { qcApi } from '../api/resources';
import { batchesApi } from '../api/batches';
import { useAuth } from '../store/AuthContext';
import { useApp } from '../store/AppContext';
import { StatusPill } from '../components/common/Badges';
import Icon from '../components/common/Icon';
import { EntityLink, routes } from '../lib/wiring';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

const T_PRIMARY = 'var(--text-primary, #15366a)';
const T_SECONDARY = 'var(--text-secondary, #5d7188)';
const T_MUTED = 'var(--text-muted, #9bb4d4)';

const RESULTS = ['Pass', 'Fail', 'Borderline'];

function resultColor(r) {
  if (r === 'Pass' || r === 'Concession') return '#22a06b';
  if (r === 'Fail') return '#e5484d';
  if (r === 'Pending') return '#d97a2b';
  return '#f0a020'; // Borderline
}

function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: T_MUTED }}>{children}</div>
      {right}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, padding: '14px 0', textAlign: 'center' }}>{children}</div>;
}

function ErrorBanner({ message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-danger, #e5484d)', background: 'rgba(229,72,77,0.08)', border: '1px solid rgba(229,72,77,0.25)', borderRadius: 9, padding: '10px 12px', marginBottom: 10 }}>
      <Icon name="alert" size={15} color="var(--status-danger, #e5484d)" />
      <span>{message}</span>
    </div>
  );
}

function Modal({ title, onClose, children, width = 520 }) {
  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(12,24,44,0.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '8vh', zIndex: 200 }}>
      <div className="card" onMouseDown={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: width, maxHeight: '84vh', overflowY: 'auto', boxShadow: 'var(--shadow-modal)', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-card, #e3ebde)' }}>
          <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 16, color: T_PRIMARY }}>{title}</span>
          <button onClick={onClose} className="btn btn-sm" style={{ width: 32, padding: 0, justifyContent: 'center' }} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div style={{ padding: '18px 20px' }}>{children}</div>
      </div>
    </div>
  );
}

// ── Random HRC inspection samples queue (inspector action) ───────────────────
function HrcSamplesPanel() {
  const { data, loading, refetch } = usePolling(() => qcApi.hrcSamples('pending').then((r) => r.data), []);
  const samples = Array.isArray(data) ? data : [];
  const [active, setActive] = useState(null);
  const [val, setVal] = useState('');
  const [res, setRes] = useState('Pass');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function record(id) {
    setBusy(true); setErr(null);
    try {
      await qcApi.recordHrc(id, val.trim(), res, null);
      setActive(null); setVal(''); setRes('Pass'); refetch();
    } catch (e) { setErr(e.message || 'Could not record HRC result.'); } finally { setBusy(false); }
  }

  if ((!data && loading) || samples.length === 0) return null;

  return (
    <div className="card" style={{ padding: '18px 20px', marginTop: 16, borderLeft: '4px solid #c0762b' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon name="thermo" size={15} color="#c0762b" />
        <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, color: T_PRIMARY }}>HRC Inspection Samples</span>
        <span className="badge" style={{ background: 'rgba(192,118,43,0.14)', color: '#c0762b' }}>{samples.length} pending</span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginBottom: 12 }}>
        Pieces randomly selected for HRC sampling — record the reading (normally captured at the workstation during job close). A Fail holds the piece.
      </div>
      {err ? <ErrorBanner message={err} /> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {samples.map((s) => (
          <div key={s.id} style={{ border: '1px solid var(--border-card, #e3ebde)', borderRadius: 9, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: T_PRIMARY }}>{s.uid_code}</span>
              <span style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY }}>from step {s.source_step_number}{s.source_operation ? ` · ${s.source_operation}` : ''}</span>
              <div style={{ flex: 1 }} />
              {active === s.id ? null : <button className="btn btn-sm" onClick={() => { setActive(s.id); setVal(''); setRes('Pass'); setErr(null); }}>Record HRC</button>}
            </div>
            {active === s.id && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
                <div>
                  <label className="form-label" style={{ marginBottom: 4 }}>HRC value</label>
                  <input className="form-input" style={{ height: 38, width: 110 }} type="number" step="any" value={val} onChange={(e) => setVal(e.target.value)} autoFocus />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {RESULTS.map((r) => {
                    const sel = res === r; const c = resultColor(r);
                    return <button key={r} type="button" onClick={() => setRes(r)} className="btn btn-sm" style={{ height: 38, border: '1.5px solid ' + (sel ? c : 'var(--border-input, #d6e0d2)'), background: sel ? c + '22' : '#fff', color: sel ? c : T_SECONDARY, fontWeight: 700 }}>{r}</button>;
                  })}
                </div>
                <button className="btn btn-primary btn-sm" style={{ height: 38 }} disabled={busy || val.trim() === ''} onClick={() => record(s.id)}>{busy ? 'Saving…' : 'Save'}</button>
                <button className="btn btn-sm" style={{ height: 38 }} disabled={busy} onClick={() => setActive(null)}>Cancel</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* Batch-level HRC sampling (Type 2). */
const SCENARIO_LABEL = { all_pass: 'All pass', minority_fail: 'Minority fail', majority_fail: 'Majority fail', all_fail: 'All fail' };
const ACTION_LABEL = { continue: 'Batch continues', individual: 'Re-treat failed pieces individually', second_sample: 'Trigger a second sample', partial_warning: 'Partial failure — monitor', recall: 'Recall the whole batch' };

function BatchHrcPanel() {
  const { data: batchData } = usePolling(() => batchesApi.furnaceList().then((r) => r.data).catch(() => []), [], { interval: 60000 });
  const batches = (Array.isArray(batchData) ? batchData : batchData?.items || []).filter((b) => ['running', 'complete'].includes(b.status));
  const [batchId, setBatchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);
  const { data: status, refetch } = usePolling(() => (batchId ? qcApi.batchHrcStatus(batchId).then((r) => r.data) : Promise.resolve(null)), [batchId], { interval: 20000 });

  async function run(fn, label) {
    setBusy(true); setErr(null); setNotice(null);
    try { const r = await fn(); setNotice(label(r.data)); refetch(); }
    catch (e) { setErr(e.message || 'Action failed.'); } finally { setBusy(false); }
  }
  const rounds = status?.rounds || [];
  const rec = status?.recommended;

  return (
    <div className="card" style={{ padding: '18px 20px', marginTop: 16, borderLeft: '4px solid #2d6fb5' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon name="stack" size={15} color="#2d6fb5" />
        <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, color: T_PRIMARY }}>Batch HRC Sampling (Type 2)</span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginBottom: 12 }}>
        Take a 10% random sample of a furnace batch, record the readings, then evaluate — the whole-batch decision (second sample / recall) follows the sample results.
      </div>
      {err ? <ErrorBanner message={err} /> : null}
      {notice ? <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--status-success-dark, #1c7a52)', marginBottom: 10 }}>{notice}</div> : null}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label className="form-label" style={{ marginBottom: 4 }}>Furnace batch</label>
          <select className="form-select" style={{ height: 38, minWidth: 220 }} value={batchId} onChange={(e) => { setBatchId(e.target.value); setNotice(null); setErr(null); }}>
            <option value="">Select a running batch…</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_number}{b.recall_status ? ` · ${b.recall_status}` : ''}</option>)}
          </select>
        </div>
        {batchId && rounds.length === 0 ? <button className="btn btn-primary btn-sm" style={{ height: 38 }} disabled={busy} onClick={() => run(() => qcApi.batchHrcSample(batchId), (d) => `Round 1: ${d.count} pieces selected — record their HRC.`)}>Take 10% sample</button> : null}
        {rec ? <button className="btn btn-primary btn-sm" style={{ height: 38 }} disabled={busy} onClick={() => run(() => qcApi.batchHrcEvaluate(batchId), (d) => `${SCENARIO_LABEL[d.scenario] || d.scenario} → ${ACTION_LABEL[d.action] || d.action}${d.heldPieces ? ` (${d.heldPieces} held)` : ''}${d.selected ? ` (${d.selected.length} newly sampled)` : ''}`)}>Evaluate batch</button> : null}
      </div>
      {status ? (
        <div style={{ marginTop: 12 }}>
          {status.batch?.recall_status ? <span className="badge" style={{ background: 'rgba(229,72,77,0.14)', color: '#e5484d', marginBottom: 8 }}>⚠ {status.batch.recall_status}{status.batch.recall_reason ? ` · ${status.batch.recall_reason}` : ''}</span> : null}
          <div style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY }}>{status.totalPieces} pieces in batch</div>
          {rounds.map((r) => <div key={r.round} style={{ fontFamily: MONO, fontSize: 11.5, color: T_PRIMARY, marginTop: 4 }}>Round {r.round}: {r.pass} pass · {r.fail} fail{r.pending ? ` · ${r.pending} pending` : ''} ({r.samples.length} sampled)</div>)}
          {rec ? <div style={{ fontFamily: SANS, fontSize: 12.5, marginTop: 8, color: '#2d6fb5', fontWeight: 600 }}>Recommendation: {SCENARIO_LABEL[rec.scenario] || rec.scenario} → {ACTION_LABEL[rec.action] || rec.action}</div>
            : rounds.some((r) => r.pending) ? <div style={{ fontFamily: SANS, fontSize: 12, marginTop: 8, color: T_SECONDARY }}>Record all sampled readings, then evaluate.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/* Annealing dispatch — very-low HRC pieces sent to a third-party annealing contractor. */
function AnnealingPanel() {
  const { data: cand, refetch: refetchCand } = usePolling(() => qcApi.annealingCandidates().then((r) => r.data).catch(() => []), [], { interval: 30000 });
  const { data: list, refetch: refetchList } = usePolling(() => qcApi.annealingList('dispatched').then((r) => r.data).catch(() => []), [], { interval: 30000 });
  const candidates = Array.isArray(cand) ? cand : [];
  const outbound = Array.isArray(list) ? list : [];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [expForm, setExpForm] = useState({});

  if (!candidates.length && !outbound.length) return null;

  async function dispatch(uidCode) {
    setBusy(true); setErr(null);
    try { await qcApi.annealingDispatch({ uidCode, expectedReturnDate: expForm[uidCode] || undefined }); refetchCand(); refetchList(); }
    catch (e) { setErr(e.message || 'Dispatch failed.'); } finally { setBusy(false); }
  }
  async function ret(id) {
    setBusy(true); setErr(null);
    try { await qcApi.annealingReturn(id); refetchList(); refetchCand(); }
    catch (e) { setErr(e.message || 'Return failed.'); } finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ padding: '18px 20px', marginTop: 16, borderLeft: '4px solid #7a4fc0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon name="truck" size={15} color="#7a4fc0" />
        <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, color: T_PRIMARY }}>Annealing Dispatch</span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginBottom: 12 }}>
        Critically-soft (very-low HRC) pieces go to a third-party annealing contractor. On return they re-enter the cycle from Hardening (HT70).
      </div>
      {err ? <ErrorBanner message={err} /> : null}
      {candidates.length ? (
        <>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T_MUTED, marginBottom: 6 }}>Awaiting dispatch · {candidates.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {candidates.map((u) => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border-card, #e3ebde)', borderRadius: 9, padding: '9px 12px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: T_PRIMARY }}>{u.uid_code}</span>
                <div style={{ flex: 1 }} />
                <input className="form-input" style={{ height: 34, width: 150 }} type="date" value={expForm[u.uid_code] || ''} onChange={(e) => setExpForm((s) => ({ ...s, [u.uid_code]: e.target.value }))} title="Expected return date" />
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => dispatch(u.uid_code)}>Dispatch to annealing</button>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {outbound.length ? (
        <>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T_MUTED, marginBottom: 6 }}>At contractor · {outbound.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {outbound.map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border-card, #e3ebde)', borderRadius: 9, padding: '9px 12px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: T_PRIMARY }}>{d.uid_code}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: T_SECONDARY }}>{d.reference}</span>
                <span style={{ fontFamily: SANS, fontSize: 11.5, color: T_SECONDARY }}>sent {String(d.dispatched_at).slice(0, 10)}{d.expected_return_date ? ` · due ${String(d.expected_return_date).slice(0, 10)}` : ''}</span>
                <div style={{ flex: 1 }} />
                <button className="btn btn-sm" disabled={busy} onClick={() => ret(d.id)}>Mark returned → HT70</button>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── Admin: override a QC result ──────────────────────────────────────────────
function OverrideModal({ event, onClose, onDone }) {
  const [result, setResult] = useState(event.result === 'Fail' ? 'Pass' : 'Fail');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const short = reason.trim().length < 20;

  async function submit() {
    setBusy(true); setErr(null);
    try { await qcApi.createOverride(event.stepLogId, result, reason.trim()); onDone(); }
    catch (e) { setErr(e.message || 'Override failed.'); } finally { setBusy(false); }
  }

  return (
    <Modal title="Override QC result" onClose={busy ? () => {} : onClose}>
      <div style={{ fontFamily: MONO, fontSize: 12.5, color: T_PRIMARY, marginBottom: 14 }}>
        {event.uidCode} · Step {event.step}{event.value ? ` · ${event.checkType}: ${event.value}` : ''} · current result <b>{event.result}</b>
      </div>
      {err ? <ErrorBanner message={err} /> : null}
      <label className="form-label">Override to</label>
      <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
        {RESULTS.map((r) => {
          const sel = result === r; const c = resultColor(r);
          return <button key={r} type="button" onClick={() => setResult(r)} className="btn btn-sm" style={{ flex: 1, justifyContent: 'center', border: '1.5px solid ' + (sel ? c : 'var(--border-input, #d6e0d2)'), background: sel ? c + '22' : '#fff', color: sel ? c : T_SECONDARY, fontWeight: 700 }}>{r}</button>;
        })}
      </div>
      <label className="form-label">Reason (required — minimum 20 characters)</label>
      <textarea className="form-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this result being overridden? This is permanent and visible to all Supervisors and Managers." autoFocus />
      <div style={{ fontFamily: MONO, fontSize: 10, color: short ? '#e5484d' : T_MUTED, marginTop: 4 }}>{reason.trim().length}/20</div>
      <div style={{ fontFamily: SANS, fontSize: 11.5, color: T_SECONDARY, margin: '10px 0 14px' }}>
        This override is permanent — it can only be counter-overridden with a new reason. The author and reason are always shown in the feed, UID history and exports.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={busy || short} onClick={submit}>{busy ? 'Saving…' : 'Confirm override'}</button>
        <button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── Admin: instruction to Supervisor ─────────────────────────────────────────
function InstructionModal({ regarding, uidCode, onClose, onDone }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    setBusy(true); setErr(null);
    try { await qcApi.sendInstruction({ message: message.trim(), regarding: regarding || undefined, uidCode: uidCode || undefined }); onDone(); }
    catch (e) { setErr(e.message || 'Could not send instruction.'); } finally { setBusy(false); }
  }

  return (
    <Modal title="Instruction to Supervisor" onClose={busy ? () => {} : onClose}>
      {regarding ? <div style={{ fontFamily: MONO, fontSize: 12.5, color: T_PRIMARY, marginBottom: 12 }}>Regarding: {regarding}</div> : null}
      {err ? <ErrorBanner message={err} /> : null}
      <label className="form-label">Instruction</label>
      <textarea className="form-input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Pull 5 more pieces from this batch for thickness check before approving the concession. Check if SG-DLT-1 needs calibration." autoFocus />
      <div style={{ fontFamily: SANS, fontSize: 11.5, color: T_SECONDARY, margin: '10px 0 14px' }}>
        Delivered to the Supervisor on duty as a 📋 Admin instruction alert. The Supervisor must acknowledge it (logged).
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={busy || !message.trim()} onClick={submit}>{busy ? 'Sending…' : 'Send instruction'}</button>
        <button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── Concession requests (Requires Action) ────────────────────────────────────
function ConcessionPanel({ canDecide, onInstruct, refreshKey, onChanged }) {
  const { data, loading, refetch } = usePolling(() => qcApi.concessions('pending').then((r) => r.data).catch(() => []), [refreshKey]);
  const items = Array.isArray(data) ? data : [];
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  async function decide(id, decision) {
    setBusy(id + decision); setErr(null);
    try { await qcApi.decideConcession(id, decision, null); refetch(); onChanged && onChanged(); }
    catch (e) { setErr(e.message || 'Decision failed.'); } finally { setBusy(null); }
  }

  if ((!data && loading) || items.length === 0) return null;

  return (
    <div className="card" style={{ padding: '18px 20px', marginTop: 16, borderLeft: '4px solid #d97a2b' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon name="alert" size={15} color="#d97a2b" />
        <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, color: T_PRIMARY }}>Concession Requests</span>
        <span className="badge" style={{ background: 'rgba(217,122,43,0.14)', color: '#d97a2b' }}>{items.length} pending</span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginBottom: 12 }}>
        A dimension below the finished-good minimum. Approving releases the piece under concession (box marked in the concession colour); rejecting keeps it on hold.
      </div>
      {err ? <ErrorBanner message={err} /> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((c) => (
          <div key={c.id} style={{ border: '1px solid var(--border-card, #e3ebde)', borderRadius: 9, padding: '11px 13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <EntityLink to={routes.uid(c.uid_code)} mono title="Open UID detail" style={{ fontWeight: 700, fontSize: 13 }}>{c.uid_code}</EntityLink>
              <span style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY }}>Step {c.step_number}{c.operation_name ? ` · ${c.operation_name}` : ''}</span>
              <span style={{ fontFamily: MONO, fontSize: 12, color: '#e5484d' }}>{c.dimension}: {c.measured_value}mm (min {c.min_value}mm)</span>
              {c.color_name ? <span className="badge" style={{ background: (c.hex || '#888') + '22', color: c.hex || '#555' }}>{c.color_name} box</span> : null}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {canDecide ? (
                <>
                  <button className="btn btn-sm" style={{ background: '#22a06b', color: '#fff', border: 'none' }} disabled={busy} onClick={() => decide(c.id, 'approve')}>{busy === c.id + 'approve' ? '…' : 'Approve'}</button>
                  <button className="btn btn-sm" style={{ border: '1.5px solid #e5484d', color: '#e5484d' }} disabled={busy} onClick={() => decide(c.id, 'reject')}>{busy === c.id + 'reject' ? '…' : 'Reject'}</button>
                </>
              ) : <span style={{ fontFamily: SANS, fontSize: 11.5, color: T_MUTED }}>Awaiting Manager/Admin decision</span>}
              {onInstruct ? <button className="btn btn-sm" onClick={() => onInstruct(`${c.uid_code} · ${c.dimension} ${c.measured_value}mm`, c.uid_code)}>Give instruction →</button> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Summary counters ─────────────────────────────────────────────────────────
function Bar({ label, n, total, color }) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: SANS, fontSize: 12.5, color: T_PRIMARY, marginBottom: 3 }}>
        <span>{label}</span><span style={{ fontFamily: MONO }}>{n} · {pct}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 5, background: 'var(--bg-muted-2, #eef3ea)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 240ms ease' }} />
      </div>
    </div>
  );
}

function SummaryPanel({ summary, onView }) {
  if (!summary) return <Empty>Loading summary…</Empty>;
  const r = summary.results || {};
  const total = (r.Pass || 0) + (r.Fail || 0) + (r.Borderline || 0) + (summary.concessions?.approved || 0);
  const denom = total || 1;
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T_MUTED, marginBottom: 10 }}>Today's results</div>
      <Bar label="Pass" n={r.Pass || 0} total={denom} color="#22a06b" />
      <Bar label="Fail" n={r.Fail || 0} total={denom} color="#e5484d" />
      <Bar label="Concession" n={summary.concessions?.approved || 0} total={denom} color="#2d6fb5" />
      <Bar label="Borderline" n={r.Borderline || 0} total={denom} color="#f0a020" />

      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T_MUTED, margin: '16px 0 8px' }}>Pending QC</div>
      <Row k="Awaiting inspection" v={`${summary.pendingInspection} UIDs`} />
      <Row k="Concession requests" v={summary.concessions?.pending || 0} action={summary.concessions?.pending ? { label: 'Review →', onClick: () => onView('pending-concessions') } : null} />
      <Row k="HRC samples pending" v={`${summary.hrcSamplesPending} UIDs`} />

      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T_MUTED, margin: '16px 0 8px' }}>Active holds (QC-related)</div>
      <Row k="HRC / annealing" v={`${summary.holds?.hrc || 0} UIDs`} />
      <Row k="Concession hold" v={`${summary.holds?.concession || 0} UIDs`} />
      <Row k="Total on hold" v={`${summary.holds?.total || 0} UIDs`} strong />

      {summary.batchFlags?.length ? (
        <>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T_MUTED, margin: '16px 0 8px' }}>Batch HRC flags</div>
          {summary.batchFlags.map((b) => (
            <div key={b.id} style={{ fontFamily: MONO, fontSize: 11.5, color: '#e5484d', marginBottom: 4 }}>
              {b.batch_number} — {b.recall_status}{b.recall_reason ? ` · ${b.recall_reason}` : ''}
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

function Row({ k, v, strong, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', fontFamily: SANS, fontSize: 12.5 }}>
      <span style={{ color: T_SECONDARY }}>{k}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: MONO, color: T_PRIMARY, fontWeight: strong ? 700 : 500 }}>{v}</span>
        {action ? <button className="btn btn-sm" style={{ padding: '2px 8px' }} onClick={action.onClick}>{action.label}</button> : null}
      </span>
    </div>
  );
}

// ── Live activity feed ───────────────────────────────────────────────────────
function FeedRow({ ev, canOverride, onOverride }) {
  const [open, setOpen] = useState(false);
  const c = resultColor(ev.result);
  return (
    <div style={{ borderBottom: '1px solid var(--border-card, #eef2ea)', padding: '10px 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flexWrap: 'wrap' }} onClick={() => setOpen((o) => !o)}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: T_MUTED, width: 44 }}>{ev.at ? new Date(ev.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
        <EntityLink to={routes.uid(ev.uidCode)} mono title="Open UID detail" style={{ fontWeight: 700, fontSize: 13 }}>{ev.uidCode}</EntityLink>
        <span style={{ fontFamily: SANS, fontSize: 11.5, color: T_SECONDARY }}>Step {ev.step}{ev.operation ? ` · ${ev.operation}` : ''}</span>
        {ev.operator ? <span style={{ fontFamily: SANS, fontSize: 11, color: T_MUTED }}>{ev.operator}{ev.unit ? ` / ${ev.unit}` : ''}</span> : null}
        <div style={{ flex: 1 }} />
        {ev.checkType && ev.value != null ? <span style={{ fontFamily: MONO, fontSize: 11.5, color: T_PRIMARY }}>{ev.checkType}: {ev.value}{ev.min ? ` (min ${ev.min})` : ''}</span> : null}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: SANS, fontSize: 12, fontWeight: 700, color: c }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: c }} />{ev.result}
        </span>
        {ev.overridden ? <span className="badge" style={{ background: 'rgba(122,79,192,0.14)', color: '#7a4fc0' }}>overridden</span> : null}
      </div>
      {open ? (
        <div style={{ padding: '8px 0 4px 54px', fontFamily: SANS, fontSize: 12, color: T_SECONDARY, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {ev.kind === 'override' ? <div>Original result: <b>{ev.originalResult}</b> → {ev.result}. Reason: “{ev.reason}” — {ev.operator}</div> : null}
          {ev.originalResult && ev.kind !== 'override' ? <div style={{ color: '#7a4fc0' }}>Original result {ev.originalResult}, overridden to {ev.result}.</div> : null}
          {ev.kind === 'concession' ? <div>{ev.checkType} · measured {ev.value}mm vs min {ev.min}mm{ev.colorName ? ` · ${ev.colorName} box` : ''} · status {ev.status}</div> : null}
          {ev.notes ? <div>Notes: {ev.notes}</div> : null}
          {ev.level ? <div>Level: {ev.level}</div> : null}
          {canOverride && ev.stepLogId ? <div style={{ marginTop: 4 }}><button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); onOverride(ev); }}>Override result</button></div> : null}
        </div>
      ) : null}
    </div>
  );
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'operator', label: 'Operator' },
  { key: 'inspector', label: 'Inspector' },
  { key: 'failed', label: 'Failed' },
  { key: 'pending', label: 'Pending' },
  { key: 'overridden', label: 'Overridden' },
];

function OverriddenView() {
  const { data, loading } = usePolling(() => qcApi.overrides().then((r) => r.data).catch(() => []), []);
  const rows = Array.isArray(data) ? data : [];
  if (!data && loading) return <Empty>Loading overrides…</Empty>;
  if (rows.length === 0) return <Empty>No overrides recorded.</Empty>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: 12.5 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: T_MUTED, fontFamily: MONO, fontSize: 10, textTransform: 'uppercase' }}>
            <th style={{ padding: '6px 8px' }}>Date</th><th style={{ padding: '6px 8px' }}>UID</th><th style={{ padding: '6px 8px' }}>Step</th>
            <th style={{ padding: '6px 8px' }}>Original</th><th style={{ padding: '6px 8px' }}>Overridden to</th><th style={{ padding: '6px 8px' }}>By</th><th style={{ padding: '6px 8px' }}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} style={{ borderTop: '1px solid var(--border-card, #eef2ea)' }}>
              <td style={{ padding: '7px 8px', fontFamily: MONO, color: T_SECONDARY }}>{String(o.created_at).slice(0, 10)}</td>
              <td style={{ padding: '7px 8px', fontFamily: MONO, fontWeight: 700 }}><EntityLink to={routes.uid(o.uid_code)} mono title="Open UID detail">{o.uid_code}</EntityLink></td>
              <td style={{ padding: '7px 8px', fontFamily: MONO }}>{o.step_number}</td>
              <td style={{ padding: '7px 8px', color: resultColor(o.original_result) }}>{o.original_result || '—'}</td>
              <td style={{ padding: '7px 8px', color: resultColor(o.new_result), fontWeight: 700 }}>{o.new_result}</td>
              <td style={{ padding: '7px 8px' }}>{o.by_name || '—'}</td>
              <td style={{ padding: '7px 8px', color: T_SECONDARY, maxWidth: 320 }}>{o.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function QC() {
  const { isSupervisor, isManager, isAdmin, isDirector } = useAuth();
  const { locationLabel } = useApp();
  const canView = isSupervisor || isManager || isAdmin || isDirector; // Director: read-only oversight
  const canDecide = isManager || isAdmin;

  const [filter, setFilter] = useState('all');
  const [overrideEv, setOverrideEv] = useState(null);
  const [instruction, setInstruction] = useState(null); // { regarding, uidCode } | 'blank'
  const [flash, setFlash] = useState(null);
  const [bump, setBump] = useState(0); // force concession/summary refresh after actions

  const { data: feed, loading: feedLoading, refetch: refetchFeed } = usePolling(
    () => qcApi.activity(filter).then((r) => r.data).catch(() => []), [filter, bump], { interval: 30000 }
  );
  const { data: summary, refetch: refetchSummary } = usePolling(
    () => qcApi.summary().then((r) => r.data).catch(() => null), [bump], { interval: 30000 }
  );
  const events = Array.isArray(feed) ? feed : [];

  function afterAction(msg) {
    if (msg) setFlash(msg);
    setBump((b) => b + 1);
    refetchFeed(); refetchSummary();
  }

  if (!canView) {
    return (
      <div style={{ padding: '28px', maxWidth: 640 }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY }}>The Quality Control dashboard is available to Supervisors, Managers and Admins.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 1320 }}>
      {/* Header strip */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: T_PRIMARY }}>Quality Control</div>
        <span style={{ fontFamily: MONO, fontSize: 12, color: T_SECONDARY, textTransform: 'uppercase', letterSpacing: '0.08em' }}>· {locationLabel} ·</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 12, color: '#22a06b' }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: '#22a06b' }} /> Live
        </span>
        <div style={{ flex: 1 }} />
        {isAdmin ? <button className="btn btn-sm" onClick={() => setInstruction('blank')}><Icon name="bell" size={13} /> Instruct Supervisor</button> : null}
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, margin: '4px 0 14px' }}>
        Live QC activity across operator and inspector checks. Measurements are entered at My Workstation on job close — this dashboard aggregates results{feedLoading ? ' · loading…' : ''}. Auto-refresh 30s.
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 16 }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button key={f.key} className="btn btn-sm" onClick={() => setFilter(f.key)}
              style={{ background: active ? T_PRIMARY : 'var(--bg-card, #fff)', color: active ? '#fff' : T_SECONDARY, border: active ? 'none' : '1px solid var(--border-input, #d6e0d2)', fontWeight: active ? 700 : 500 }}>
              {f.label}
            </button>
          );
        })}
      </div>

      {flash ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-success-dark, #1c7a52)', background: 'rgba(34,160,107,0.1)', border: '1px solid rgba(34,160,107,0.25)', borderRadius: 9, padding: '10px 12px', marginBottom: 14 }}>
          <Icon name="check" size={15} color="var(--status-success-dark, #1c7a52)" /><span>{flash}</span>
          <div style={{ flex: 1 }} /><button className="btn btn-sm" onClick={() => setFlash(null)} style={{ padding: '2px 8px' }}>Dismiss</button>
        </div>
      ) : null}

      {filter === 'overridden' ? (
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionTitle>Overridden Results</SectionTitle>
          <OverriddenView />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 2fr)', gap: 16, alignItems: 'start' }}>
          {/* Panel 1 — live feed */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <SectionTitle right={<span className="badge" style={{ background: 'rgba(45,111,181,0.12)', color: '#2d6fb5' }}>{events.length}</span>}>Live QC Activity</SectionTitle>
            {feedLoading && !feed ? <Empty>Loading feed…</Empty>
              : events.length === 0 ? <Empty>No QC events{filter !== 'all' ? ' for this filter' : ' logged yet this shift'}</Empty>
                : <div style={{ maxHeight: 620, overflowY: 'auto' }}>{events.map((ev) => <FeedRow key={ev.id} ev={ev} canOverride={isAdmin} onOverride={setOverrideEv} />)}</div>}
          </div>

          {/* Panel 2 — summary */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <SectionTitle>Shift QC Summary</SectionTitle>
            <SummaryPanel summary={summary} onView={() => setFilter('all')} />
          </div>
        </div>
      )}

      {/* Panel 3 — requires action */}
      {filter !== 'overridden' ? (
        <>
          <ConcessionPanel canDecide={canDecide} onInstruct={isAdmin ? (regarding, uidCode) => setInstruction({ regarding, uidCode }) : null} refreshKey={bump} onChanged={() => afterAction('Concession decision recorded.')} />
          <HrcSamplesPanel />
          <BatchHrcPanel />
          <AnnealingPanel />
        </>
      ) : null}

      {overrideEv ? <OverrideModal event={overrideEv} onClose={() => setOverrideEv(null)} onDone={() => { setOverrideEv(null); afterAction('QC result overridden.'); }} /> : null}
      {instruction ? (
        <InstructionModal
          regarding={instruction === 'blank' ? null : instruction.regarding}
          uidCode={instruction === 'blank' ? null : instruction.uidCode}
          onClose={() => setInstruction(null)}
          onDone={() => { setInstruction(null); setFlash('Instruction sent to the Supervisor on duty.'); }}
        />
      ) : null}
    </div>
  );
}
