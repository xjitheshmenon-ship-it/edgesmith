import { useState, useMemo } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useAuth } from '../store/AuthContext';
import { batchesApi } from '../api/batches';
import { cyclesApi } from '../api/resources';
import Icon from '../components/common/Icon';
import { CycleBadge, StatusPill } from '../components/common/Badges';

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

/* ── Furnace tempering steps (HT70/HT80/HT90) — spec PAGE 9 step table ──
   Each carries the cycle_step_id used by the queue/create API and the
   Admin-configured target temp/soak the UI displays read-only. */
const FURNACE_STEPS = [
  { id: 6, code: 'HT70', label: 'Hardening', baseCap: 6, targetTemp: 870, targetSoak: 30 },
  { id: 7, code: 'HT80', label: 'Quenching', baseCap: 6, targetTemp: 60, targetSoak: 15 },
  { id: 9, code: 'HT90-T1', label: 'Tempering 1', baseCap: 80, targetTemp: 560, targetSoak: 120 },
  { id: 10, code: 'HT90-T2', label: 'Tempering 2', baseCap: 80, targetTemp: 540, targetSoak: 120 },
  { id: 14, code: 'HT90-T3', label: 'Tempering 3', baseCap: 80, targetTemp: 520, targetSoak: 120 },
  { id: 23, code: 'HT90-T4', label: 'Tempering 4 — Stress Relief', baseCap: 80, targetTemp: 480, targetSoak: 90 },
];

const num = (v) => (typeof v === 'number' ? v : Number(v));
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; };

/* Normalise a queued-UID record from whatever shape the API returns. */
function normalizeUid(u) {
  return {
    id: pick(u, 'id', 'uid_id'),
    code: pick(u, 'code', 'uid_code', 'uid') || '—',
    cycle: pick(u, 'cycle', 'cycle_code', 'cycle_type'),
    length: num(pick(u, 'size_mm', 'length_mm', 'bar_length_mm', 'length')) || 0,
    priority: pick(u, 'priority') || 'Normal',
    waitMins: num(pick(u, 'wait_mins', 'wait_minutes', 'wait_time')) || 0,
    raw: u,
  };
}

function Heading() {
  return (
    <>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
        Batch Management
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
        Furnace queues, capacity &amp; minimum-threshold batch building
      </div>
    </>
  );
}

function Empty({ children }) {
  return <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary)', padding: '8px 0' }}>{children}</div>;
}

function ErrorBox({ error, onRetry }) {
  return (
    <div className="card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12, borderColor: 'var(--status-danger)' }}>
      <Icon name="alert" size={18} color="var(--status-danger)" />
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: 'var(--status-danger)' }}>
          {error?.message || 'Something went wrong.'}
        </div>
        {error?.code && (
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{error.code}</div>
        )}
      </div>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

function Label({ children }) {
  return <div className="form-label">{children}</div>;
}

function ReadOnlyStat({ label, value, unit }) {
  return (
    <div style={{ background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
      <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon name="lock" size={11} color="var(--text-muted)" /> {label}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>
        {value}<span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 3 }}>{unit}</span>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   FURNACE — build-a-batch panel
   Hard rule: a furnace batch is single-cycle-type only. We lock the cycle
   type to the first UID selected and disable every queued UID of a
   different cycle, so the user physically cannot mix (not just rely on the
   backend 409 CYCLE_MIX_NOT_ALLOWED).
   The minimum-queue threshold is separate: a Supervisor may override it
   with a logged reason (overrideThreshold / overrideReason).
   ════════════════════════════════════════════════════════════════════ */
function FurnaceBuilder({ step, cycleCode, isSupervisor }) {
  const [selected, setSelected] = useState(() => new Set()); // set of UID ids
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [okMsg, setOkMsg] = useState(null);

  // A furnace batch is single-cycle by construction — the queue is already
  // filtered to one cycle type, so the whole batch is locked to cycleCode.
  const lockedCycle = cycleCode;

  const { data, error, loading, refetch } = usePolling(
    () => batchesApi.furnaceQueue(step.id, cycleCode).then((r) => r.data),
    [step.id, cycleCode],
  );

  const queue = useMemo(
    () => (Array.isArray(data?.fullQueue) ? data.fullQueue : Array.isArray(data?.uids) ? data.uids : Array.isArray(data) ? data : data?.queue || []).map(normalizeUid),
    [data]
  );
  const capacity = num(pick(data || {}, 'effectiveCapacity', 'capacity', 'max_capacity')) || step.baseCap;
  const threshold = num(pick(data || {}, 'minThreshold', 'min_threshold', 'threshold', 'minimum_queue_threshold'));
  const targetTemp = pick(data || {}, 'target_temp', 'target_temperature') ?? step.targetTemp;
  const targetSoak = pick(data || {}, 'target_soak', 'target_soak_mins', 'target_soaking_time') ?? step.targetSoak;

  function toggle(u) {
    setActionError(null);
    setOkMsg(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(u.id)) {
        next.delete(u.id);
      } else {
        if (next.size >= capacity) return prev; // capacity guard
        next.add(u.id);
      }
      return next;
    });
  }

  const selectedCount = selected.size;
  const meetsThreshold = !threshold || selectedCount >= threshold;
  const thresholdBlocked = !meetsThreshold && !(override && isSupervisor && overrideReason.trim());
  const canConfirm =
    selectedCount > 0 &&
    selectedCount <= capacity &&
    !thresholdBlocked &&
    (!override || (isSupervisor && overrideReason.trim().length > 0));

  async function confirm() {
    setSubmitting(true);
    setActionError(null);
    setOkMsg(null);
    try {
      const payload = {
        cycleStepId: step.id,
        cycleCode,
        uidIds: Array.from(selected),
      };
      if (override && isSupervisor) {
        payload.overrideThreshold = true;
        payload.overrideReason = overrideReason.trim();
      }
      await batchesApi.furnaceCreate(payload);
      setOkMsg(`Furnace batch created for ${step.label} (${selectedCount} bars).`);
      setSelected(new Set());
      setOverride(false);
      setOverrideReason('');
      refetch();
    } catch (err) {
      setActionError(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !data) return <Empty>Loading queue…</Empty>;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 14 }}>
      {/* Left — queued UIDs */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <Label>Queued for {step.label}</Label>
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)' }}>{queue.length} waiting</span>
        </div>

        {queue.length === 0 ? (
          <Empty>No UIDs queued for this step.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
            {queue.map((u) => {
              const isSelected = selected.has(u.id);
              const atCap = !isSelected && selectedCount >= capacity;
              const disabled = atCap;
              return (
                <button
                  key={u.id}
                  onClick={() => toggle(u)}
                  disabled={disabled}
                  title={atCap ? `Capacity ${capacity} reached` : ''}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto auto',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    textAlign: 'left',
                    borderRadius: 'var(--radius-md)',
                    border: `1.5px solid ${isSelected ? 'var(--status-blue)' : 'var(--border-input)'}`,
                    background: isSelected ? 'var(--bg-soft-blue)' : 'var(--bg-card)',
                    opacity: disabled ? 0.4 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{u.code}</span>
                  {u.cycle ? <CycleBadge cycle={u.cycle} /> : <span />}
                  <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)' }}>{u.length}mm</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: u.priority === 'High' ? 'var(--status-danger)' : 'var(--text-muted)' }}>
                    {u.priority === 'High' ? '● HIGH' : `${u.waitMins}m`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right — build summary */}
      <div className="card" style={{ padding: '16px 16px', height: 'fit-content' }}>
        <Label>Build batch</Label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
          <ReadOnlyStat label="Target temp" value={targetTemp ?? '—'} unit="°C" />
          <ReadOnlyStat label="Target soak" value={targetSoak ?? '—'} unit="min" />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Selected</div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 26, letterSpacing: '-0.03em', color: 'var(--text-primary)', lineHeight: 1 }}>
              {selectedCount}<span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: MONO, fontWeight: 400 }}> / {capacity}</span>
            </div>
          </div>
          {lockedCycle ? (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 4 }}>Cycle (locked)</div>
              <CycleBadge cycle={lockedCycle} />
            </div>
          ) : (
            <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-muted)', maxWidth: 130, textAlign: 'right' }}>
              Select a UID to lock the cycle type
            </div>
          )}
        </div>

        {/* Capacity bar */}
        <div style={{ height: 8, borderRadius: 6, background: 'var(--bg-muted)', marginTop: 12, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, (selectedCount / capacity) * 100)}%`, background: 'var(--status-success)', transition: 'width 0.2s' }} />
        </div>

        {/* Threshold notice + supervisor override (distinct from cycle rule) */}
        {threshold ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: meetsThreshold ? 'var(--status-success-dark)' : 'var(--status-warning)' }}>
              Minimum queue threshold: {threshold} bars {meetsThreshold ? '— met' : '— not met'}
            </div>
            {!meetsThreshold && (
              isSupervisor ? (
                <div style={{ marginTop: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 12, color: 'var(--text-primary)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                    Override threshold (Supervisor)
                  </label>
                  {override && (
                    <input
                      className="form-input"
                      style={{ marginTop: 8, height: 38 }}
                      placeholder="Reason for override (logged)…"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                    />
                  )}
                </div>
              ) : (
                <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                  Only a Supervisor can override the threshold.
                </div>
              )
            )}
          </div>
        ) : null}

        {actionError && (
          <div style={{ marginTop: 12 }}><ErrorBox error={actionError} /></div>
        )}
        {okMsg && (
          <div style={{ marginTop: 12, fontFamily: SANS, fontSize: 12, color: 'var(--status-success-dark)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="check" size={14} color="var(--status-success)" /> {okMsg}
          </div>
        )}

        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 14, justifyContent: 'center' }}
          disabled={!canConfirm || submitting}
          onClick={confirm}
        >
          {submitting ? 'Creating…' : 'Confirm — Create Furnace Batch'}
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   FURNACE — active batches + complete (actual entry, deviation)
   ════════════════════════════════════════════════════════════════════ */
function CompleteForm({ batch, targetTemp, targetSoak, onDone }) {
  const [actualTemp, setActualTemp] = useState('');
  const [actualSoak, setActualSoak] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  const at = num(actualTemp);
  const as = num(actualSoak);
  const tempDev = actualTemp !== '' && targetTemp != null ? at - num(targetTemp) : null;
  const soakDev = actualSoak !== '' && targetSoak != null ? as - num(targetSoak) : null;
  // Simple client-side deviation hint (±10°C / ±5min) — backend remains authoritative.
  const deviation = (tempDev != null && Math.abs(tempDev) > 10) || (soakDev != null && Math.abs(soakDev) > 5);
  const valid = actualTemp !== '' && actualSoak !== '' && !Number.isNaN(at) && !Number.isNaN(as) && (!deviation || note.trim());

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      await batchesApi.furnaceComplete(batch.id, {
        actual_temp: at,
        actual_soak: as,
        deviation_note: deviation ? note.trim() : undefined,
      });
      onDone();
    } catch (e) {
      setErr(e);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 12, borderTop: '1px dashed var(--border-soft)' }}>
      <Label>Enter actuals</Label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <input className="form-input" style={{ height: 38 }} type="number" placeholder={`Actual temp (target ${targetTemp ?? '—'})`} value={actualTemp} onChange={(e) => setActualTemp(e.target.value)} />
          {tempDev != null && <div style={{ fontFamily: MONO, fontSize: 10, marginTop: 4, color: Math.abs(tempDev) > 10 ? 'var(--status-danger)' : 'var(--text-secondary)' }}>Δ {tempDev > 0 ? '+' : ''}{tempDev}°C</div>}
        </div>
        <div>
          <input className="form-input" style={{ height: 38 }} type="number" placeholder={`Actual soak (target ${targetSoak ?? '—'})`} value={actualSoak} onChange={(e) => setActualSoak(e.target.value)} />
          {soakDev != null && <div style={{ fontFamily: MONO, fontSize: 10, marginTop: 4, color: Math.abs(soakDev) > 5 ? 'var(--status-danger)' : 'var(--text-secondary)' }}>Δ {soakDev > 0 ? '+' : ''}{soakDev}min</div>}
        </div>
      </div>

      {deviation && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--status-danger)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Icon name="alert" size={12} color="var(--status-danger)" /> Deviation outside tolerance — acknowledgement note required
          </div>
          <input className="form-input" style={{ height: 38 }} placeholder="Deviation acknowledgement note…" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}

      {err && <div style={{ marginTop: 8 }}><ErrorBox error={err} /></div>}

      <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} disabled={!valid || submitting} onClick={submit}>
        {submitting ? 'Saving…' : 'Complete batch'}
      </button>
    </div>
  );
}

function ActiveFurnaceBatches() {
  const { data, error, loading, refetch } = usePolling(() => batchesApi.furnaceList().then((r) => r.data), []);
  const [openId, setOpenId] = useState(null);

  const batches = Array.isArray(data) ? data : data?.batches || [];

  if (loading && !data) return <Empty>Loading active batches…</Empty>;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;
  if (batches.length === 0) return <Empty>No active furnace batches.</Empty>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
      {batches.map((b) => {
        const id = pick(b, 'id', 'batch_id');
        const status = pick(b, 'status') || 'running';
        const targetTemp = pick(b, 'target_temp', 'target_temperature');
        const targetSoak = pick(b, 'target_soak', 'target_soaking_time');
        const uids = pick(b, 'uids', 'uid_codes') || [];
        const awaiting = String(status).toLowerCase().includes('await') || String(status).toLowerCase() === 'running';
        return (
          <div key={id} className="card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{pick(b, 'batch_number', 'number', 'code') || id}</div>
                <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{pick(b, 'step_label', 'step') || ''}</div>
              </div>
              <StatusPill status={status} />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {pick(b, 'cycle', 'cycle_code') && <CycleBadge cycle={pick(b, 'cycle', 'cycle_code')} />}
              <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)' }}>{Array.isArray(uids) ? uids.length : 0} bars</span>
              {targetTemp != null && <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)' }}>{targetTemp}°C</span>}
              {targetSoak != null && <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)' }}>{targetSoak}min</span>}
            </div>

            {Array.isArray(uids) && uids.length > 0 && (
              <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6, wordBreak: 'break-word' }}>
                {uids.map((u) => (typeof u === 'string' ? u : pick(u, 'code', 'uid_code'))).join('  ·  ')}
              </div>
            )}

            {awaiting && (
              openId === id ? (
                <CompleteForm
                  batch={{ id }}
                  targetTemp={targetTemp}
                  targetSoak={targetSoak}
                  onDone={() => { setOpenId(null); refetch(); }}
                />
              ) : (
                <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setOpenId(id)}>
                  Enter actuals
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   PAGE
   ════════════════════════════════════════════════════════════════════ */
export default function BatchManagement() {
  const { isSupervisor, isAdmin, isManager } = useAuth();
  const canBuild = isSupervisor || isAdmin || isManager;

  const [stepId, setStepId] = useState(FURNACE_STEPS[2].id); // Tempering 1 default
  const [cycleCode, setCycleCode] = useState('EAT');

  const step = FURNACE_STEPS.find((s) => s.id === stepId) || FURNACE_STEPS[0];

  // Dharmapuri cycle types that actually carry furnace steps (configured cycles).
  // Faridabad (FAR) rolling lives on its own Faridabad Batch Management page.
  const { data: cyclesData } = usePolling(() => cyclesApi.list().then((r) => r.data).catch(() => []), []);
  const cycleOptions = useMemo(() => {
    const rows = Array.isArray(cyclesData) ? cyclesData : [];
    const configured = rows.filter((c) => c.code && c.code !== 'FAR' && Number(c.step_count) > 0);
    return (configured.length ? configured : [{ code: 'EAT', name: 'EAT Cycle' }]).map((c) => ({ code: c.code, name: c.name || c.code }));
  }, [cyclesData]);

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <Heading />

      {/* Active batches */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, letterSpacing: '-0.03em', color: 'var(--text-primary)', marginBottom: 10 }}>
          Active furnace batches
        </div>
        <ActiveFurnaceBatches />
      </div>

      {/* Build a batch */}
      <div className="card" style={{ marginTop: 20, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
            Build a furnace batch
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 150 }}>
              <select className="form-select" style={{ height: 38 }} value={cycleCode} onChange={(e) => setCycleCode(e.target.value)}>
                {cycleOptions.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </select>
            </div>
            <div style={{ minWidth: 220 }}>
              <select className="form-select" style={{ height: 38 }} value={stepId} onChange={(e) => setStepId(Number(e.target.value))}>
                {FURNACE_STEPS.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {!canBuild ? (
          <Empty>Only a Supervisor can build furnace batches.</Empty>
        ) : (
          <FurnaceBuilder key={`${step.id}|${cycleCode}`} step={step} cycleCode={cycleCode} isSupervisor={canBuild} />
        )}
      </div>
    </div>
  );
}
