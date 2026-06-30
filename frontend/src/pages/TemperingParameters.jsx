import { useState, useEffect, useCallback } from 'react';
import { adminApi } from '../api/resources';
import { useAuth } from '../store/AuthContext';
import { CycleBadge, hexToRgba } from '../components/common/Badges';
import Icon from '../components/common/Icon';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

// ── Domain constants ───────────────────────────────────────────────────────
// The furnace sets the operation: HT70 = Hardening, HT80 = Quenching,
// HT90 = Tempering. Tempering parameters are per cycle type × tempering step,
// and every tempering step on the HT90 furnace is configured here.
const FURNACE = 'HT90';

// The three cycle types — rows in the matrix. Colours/badges come from Badges.jsx.
const CYCLE_TYPES = ['EAT', 'SWAN', 'OVEN'];

// The four HT90 tempering steps — columns in the matrix. `key` is the backend's
// tempering_step value (used both to match a param record and as the PATCH path
// param); `step` is only the human-facing step number shown in the subtitle.
const STEPS = [
  { key: 'tempering_1', step: 9, label: 'Tempering 1', sub: 'Step 9 · first temper' },
  { key: 'tempering_2', step: 10, label: 'Tempering 2', sub: 'Step 10 · second temper' },
  { key: 'tempering_3', step: 14, label: 'Tempering 3', sub: 'Step 14 · after machining' },
  { key: 'tempering_4', step: 23, label: 'Tempering 4', sub: 'Step 23 · stress relief' },
];

// ── Field accessors (match the backend columns; keep camelCase fallbacks) ────
const f = (o, ...keys) => {
  for (const k of keys) if (o != null && o[k] != null && o[k] !== '') return o[k];
  return undefined;
};
const num = (v) => (v == null || v === '' ? null : Number(v));

const getCycle = (p) => f(p, 'cycle_code', 'cycleCode', 'cycle_type', 'cycleType', 'cycle');
const getStepKey = (p) => f(p, 'tempering_step', 'temperingStep', 'step_key', 'stepKey');
const getTargetTemp = (p) => num(f(p, 'target_temp_c', 'targetTempC', 'target_temp', 'targetTemp', 'temp'));
const getSoak = (p) => num(f(p, 'target_soak_min', 'targetSoakMin', 'soak_time_min', 'soakTimeMin', 'soak'));
const getTempTol = (p) => num(f(p, 'tolerance_temp_c', 'toleranceTempC', 'temp_tolerance_c', 'tempToleranceC', 'temp_tol'));
const getSoakTol = (p) => num(f(p, 'tolerance_soak_min', 'toleranceSoakMin', 'soak_tolerance_min', 'soakToleranceMin', 'soak_tol'));
const getRising = (p) => num(f(p, 'rising_time_min', 'risingTimeMin', 'rising_time', 'risingTime'));
const getVersion = (p) => f(p, 'version', 'version_number', 'versionNumber');
const getUpdatedAt = (p) => f(p, 'updated_at', 'updatedAt', 'changed_at', 'changedAt', 'created_at', 'createdAt');
const getChangedBy = (p) =>
  f(p, 'changed_by', 'changedBy', 'changed_by_name', 'updated_by', 'updatedBy', 'changed_by_username');

function fmt(v, unit, tol) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${tol ? '±' : ''}${v} ${unit}`;
}

// ── Presentational helpers ──────────────────────────────────────────────────
function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
        {children}
      </div>
      {right}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', padding: '14px 0' }}>
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

function SuccessBanner({ message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-success-dark, #1c7a52)', background: 'rgba(34,160,107,0.1)', border: '1px solid rgba(34,160,107,0.25)', borderRadius: 'var(--radius-md, 9px)', padding: '10px 12px' }}>
      <Icon name="check" size={15} color="var(--status-success-dark, #1c7a52)" />
      <span>{message}</span>
    </div>
  );
}

function FurnaceTag() {
  return (
    <span className="badge" style={{ background: hexToRgba('#c0762b', 0.14), color: '#c0762b' }}>
      <Icon name="thermo" size={11} color="#c0762b" /> {FURNACE}
    </span>
  );
}

// ── A single read-only value chip in a matrix cell ──────────────────────────
function ValueChip({ label, value, unit, tol, mono }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted-2, #7d96bb)' }}>
        {label}
      </span>
      <span style={{ fontFamily: mono ? MONO : SANS, fontSize: 13, fontWeight: 600, color: value == null ? 'var(--text-muted, #9bb4d4)' : 'var(--text-primary, #15366a)' }}>
        {fmt(value, unit, tol)}
      </span>
    </div>
  );
}

// ── Inline edit form for one cell (cycle × step) ────────────────────────────
function CellEditor({ cycle, stepMeta, param, busy, onCancel, onSave }) {
  const [form, setForm] = useState(() => ({
    target_temp_c: getTargetTemp(param) ?? '',
    target_soak_min: getSoak(param) ?? '',
    rising_time_min: getRising(param) ?? '',
    temp_tolerance_c: getTempTol(param) ?? '',
    soak_tolerance_min: getSoakTol(param) ?? '',
  }));
  const [err, setErr] = useState(null);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  // Map the form fields to the exact body keys the backend PATCH expects.
  const PAYLOAD_KEYS = {
    target_temp_c: 'targetTempC',
    target_soak_min: 'targetSoakMin',
    temp_tolerance_c: 'toleranceTempC',
    soak_tolerance_min: 'toleranceSoakMin',
  };

  function submit(e) {
    e.preventDefault();
    setErr(null);
    const payload = {};
    // Target, soak and the two tolerances are required.
    for (const [k, apiKey] of Object.entries(PAYLOAD_KEYS)) {
      const v = form[k];
      if (v === '' || v == null) return setErr('Target, soak and both tolerances are required.');
      const n = Number(v);
      if (Number.isNaN(n) || n < 0) return setErr('Values must be non-negative numbers.');
      payload[apiKey] = n;
    }
    // Rising time is optional.
    if (form.rising_time_min !== '' && form.rising_time_min != null) {
      const r = Number(form.rising_time_min);
      if (Number.isNaN(r) || r < 0) return setErr('Rising time must be a non-negative number.');
      payload.risingTimeMin = r;
    } else {
      payload.risingTimeMin = null;
    }
    onSave(cycle, stepMeta.key, payload).then((apiErr) => {
      if (apiErr) setErr(apiErr);
    });
  }

  const Field = ({ k, label, unit, mono }) => (
    <div>
      <label className="form-label" style={{ marginBottom: 4 }}>{label} ({unit})</label>
      <input
        className="form-input"
        style={{ height: 36, fontFamily: mono ? MONO : SANS, fontSize: 12.5 }}
        type="number"
        min="0"
        step="any"
        value={form[k]}
        onChange={set(k)}
        autoFocus={k === 'target_temp_c'}
      />
    </div>
  );

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 9 }} className="cp-fade-in">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field k="target_temp_c" label="Target" unit="°C" mono />
        <Field k="target_soak_min" label="Soak" unit="min" />
        <Field k="rising_time_min" label="Rising time" unit="min" />
        <div />
        <Field k="temp_tolerance_c" label="Temp tol ±" unit="°C" mono />
        <Field k="soak_tolerance_min" label="Soak tol ±" unit="min" />
      </div>
      {err ? <ErrorBanner message={err} /> : null}
      <div style={{ display: 'flex', gap: 7 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

// ── A single matrix cell (read view + edit toggle) ──────────────────────────
function MatrixCell({ cycle, stepMeta, param, isAdmin, editing, busy, onEdit, onCancel, onSave }) {
  const missing = !param;

  return (
    <td style={{ padding: 8, verticalAlign: 'top', borderTop: '1px solid #eef2ea', minWidth: 168 }}>
      <div
        className="card"
        style={{
          padding: '11px 12px',
          boxShadow: 'none',
          background: editing ? 'var(--bg-muted-2, #f6f9f4)' : 'var(--bg-card, #fff)',
          borderColor: editing ? 'var(--status-blue, #3b82f6)' : 'var(--border-card, #e3ebde)',
        }}
      >
        {editing ? (
          <CellEditor cycle={cycle} stepMeta={stepMeta} param={param} busy={busy} onCancel={onCancel} onSave={onSave} />
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <ValueChip label="Target" value={getTargetTemp(param)} unit="°C" mono />
              <ValueChip label="Soak" value={getSoak(param)} unit="min" />
              <ValueChip label="Rising time" value={getRising(param)} unit="min" />
              <div style={{ borderTop: '1px dashed var(--border-input, #d6e0d2)', margin: '2px 0' }} />
              <ValueChip label="Temp tol" value={getTempTol(param)} unit="°C" tol mono />
              <ValueChip label="Soak tol" value={getSoakTol(param)} unit="min" tol />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 9, gap: 6 }}>
              <span style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--text-muted-2, #7d96bb)' }}>
                {getVersion(param) != null ? `v${getVersion(param)}` : missing ? 'not set' : ''}
              </span>
              {isAdmin ? (
                <button
                  className="btn btn-sm"
                  style={{ height: 26, padding: '0 9px', fontSize: 11 }}
                  onClick={onEdit}
                  disabled={busy}
                  title={missing ? 'Set parameters' : 'Edit parameters'}
                >
                  {missing ? 'Set' : 'Edit'}
                </button>
              ) : (
                <Icon name="lock" size={12} color="var(--text-muted, #9bb4d4)" />
              )}
            </div>
          </>
        )}
      </div>
    </td>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function TemperingParameters() {
  const { isAdmin, user } = useAuth();

  const [params, setParams] = useState(null); // array of parameter records
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [editKey, setEditKey] = useState(null); // `${cycle}:${step}`
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return adminApi
      .temperingParams()
      .then((r) => r.data)
      .then((data) => setParams(Array.isArray(data) ? data : data?.items || data?.params || []))
      .catch((e) => setLoadError(e.message || 'Could not load tempering parameters.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Index params by `${cycle}:${stepKey}` for O(1) cell lookup.
  const byKey = {};
  for (const p of params || []) {
    const c = getCycle(p);
    const s = getStepKey(p);
    if (c != null && s != null) byKey[`${c}:${s}`] = p;
  }

  // Most recently changed record drives the versioning footnote.
  const lastChanged = (params || []).reduce((acc, p) => {
    const t = getUpdatedAt(p);
    if (!t) return acc;
    if (!acc || String(t) > String(getUpdatedAt(acc))) return p;
    return acc;
  }, null);

  async function save(cycle, step, payload) {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await adminApi.updateTemperingParams(cycle, step, payload).then((r) => r.data);
      const stepLabel = STEPS.find((s) => s.key === step)?.label || step;
      setNotice(`${cycle} · ${stepLabel} updated — a new parameter version was created (${user?.full_name || user?.username || 'you'}).`);
      setEditKey(null);
      await load();
      return null;
    } catch (e) {
      return e.message || 'Could not save the parameter change.';
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
              Tempering Parameters
            </div>
            <FurnaceTag />
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
            Target temperatures, soak times and deviation tolerances for all four {FURNACE} tempering steps, per cycle type
            {loading ? ' · loading…' : ''}
          </div>
        </div>
        {isAdmin ? null : (
          <span className="status-pill" style={{ background: hexToRgba('#9aa0a6', 0.14), color: 'var(--text-secondary, #5d7188)' }}>
            <Icon name="lock" size={12} color="var(--text-secondary, #5d7188)" /> READ ONLY
          </span>
        )}
      </div>

      {notice ? <div style={{ marginTop: 16 }}><SuccessBanner message={notice} /></div> : null}
      {actionError ? <div style={{ marginTop: 16 }}><ErrorBanner message={actionError} /></div> : null}

      {/* Matrix */}
      <div className="card" style={{ marginTop: 18, padding: '18px 20px' }}>
        <SectionTitle right={<FurnaceTag />}>
          Parameter Matrix · Cycle Type × Tempering Step
        </SectionTitle>

        {loadError ? (
          <ErrorBanner message={loadError} />
        ) : loading && params == null ? (
          <Empty>Loading tempering parameters…</Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '0 12px 12px 0', minWidth: 96 }}>
                    <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
                      Cycle
                    </span>
                  </th>
                  {STEPS.map((s) => (
                    <th key={s.step} style={{ padding: '0 8px 12px', minWidth: 168 }}>
                      <div style={{ fontFamily: ARCHIVO, fontWeight: 700, fontSize: 13, color: 'var(--text-primary, #15366a)' }}>
                        {s.label}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--text-muted-2, #7d96bb)', marginTop: 2 }}>
                        {s.sub} · {FURNACE}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CYCLE_TYPES.map((cycle) => (
                  <tr key={cycle}>
                    <td style={{ padding: '8px 12px 8px 0', verticalAlign: 'top', borderTop: '1px solid #eef2ea' }}>
                      <div style={{ paddingTop: 6 }}>
                        <CycleBadge cycle={cycle} />
                      </div>
                    </td>
                    {STEPS.map((stepMeta) => {
                      const key = `${cycle}:${stepMeta.key}`;
                      return (
                        <MatrixCell
                          key={key}
                          cycle={cycle}
                          stepMeta={stepMeta}
                          param={byKey[key]}
                          isAdmin={isAdmin}
                          editing={editKey === key}
                          busy={busy && editKey === key}
                          onEdit={() => {
                            setEditKey(key);
                            setNotice(null);
                            setActionError(null);
                          }}
                          onCancel={() => setEditKey(null)}
                          onSave={save}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Versioning note */}
      <div
        className="card"
        style={{
          marginTop: 16,
          padding: '14px 16px',
          background: 'var(--bg-soft-amber, #fdf6ef)',
          borderColor: 'var(--bg-soft-amber-2, #f0e2d0)',
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <Icon name="alert" size={16} color="var(--status-warning, #d97a2b)" />
        <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--text-primary, #15366a)' }}>Changes are versioned.</strong>{' '}
          Editing any value creates a new parameter version stamped with the time and the admin who changed it.
          Historical furnace batches keep the parameter values that were active when they ran — past runs are never re-scored against new targets.
          {lastChanged ? (
            <span style={{ display: 'block', marginTop: 6, fontFamily: MONO, fontSize: 11, color: 'var(--text-muted-2, #7d96bb)' }}>
              Last change: {getUpdatedAt(lastChanged)}
              {getChangedBy(lastChanged) ? ` · by ${getChangedBy(lastChanged)}` : ''}
              {getVersion(lastChanged) != null ? ` · v${getVersion(lastChanged)}` : ''}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
