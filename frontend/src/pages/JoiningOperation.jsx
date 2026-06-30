import { useState, useMemo } from 'react';
import { faridabadApi, masterApi } from '../api/resources';
import { usePolling } from '../hooks/usePolling';
import { useApp } from '../store/AppContext';
import { useAuth } from '../store/AuthContext';
import Icon from '../components/common/Icon';
import { CycleBadge } from '../components/common/Badges';

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";

const CYCLE_OPTIONS = ['EAT', 'SWAN', 'OVEN'];
const CYCLE_COLORS = { EAT: 'var(--cycle-eat)', SWAN: 'var(--cycle-swan)', OVEN: 'var(--cycle-oven)' };

// ── small shared bits ─────────────────────────────────────────────────────────

function Label({ children }) {
  return <label className="form-label">{children}</label>;
}

function SectionTitle({ icon, children, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
      {icon && <Icon name={icon} size={16} color="var(--text-secondary)" />}
      <div>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>{children}</div>
        {sub && <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function ErrorBanner({ error, onClose }) {
  if (!error) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 'var(--radius-lg)', background: 'rgba(229,72,77,0.10)', border: '1px solid rgba(229,72,77,0.30)', marginBottom: 16 }}>
      <Icon name="alert" size={16} color="var(--status-danger)" />
      <div style={{ flex: 1, fontFamily: SANS, fontSize: 12.5, color: 'var(--status-danger-dark)' }}>
        {error.message || 'Something went wrong.'}
        {error.code && <span style={{ fontFamily: MONO, fontSize: 10, marginLeft: 8, opacity: 0.7 }}>{error.code}</span>}
      </div>
      {onClose && (
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--status-danger-dark)', display: 'flex' }}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

// ── main page ───────────────────────────────────────────────────────────────

export default function JoiningOperation() {
  const { location } = useApp();
  const { isOperator, isSupervisor, isManager, isAdmin } = useAuth();
  const canLog = isOperator || isSupervisor || isManager || isAdmin;

  // Running tally per cycle type — the heart of this page. Polled live.
  const { data: tallyData, error: tallyError, loading: tallyLoading, refetch: refetchTally } = usePolling(
    () => faridabadApi.weldTally().then((r) => r.data),
    [],
    { interval: 15000 }
  );

  // Reference data for the log-weld form (intakes split by material type, truck capacity).
  const { data: ref } = usePolling(async () => {
    const [alloy, ms, capacity] = await Promise.all([
      faridabadApi.intakes({ material_type: 'alloy_steel' }).then((r) => r.data).catch(() => []),
      faridabadApi.intakes({ material_type: 'ms' }).then((r) => r.data).catch(() => []),
      masterApi.truckCapacity().then((r) => r.data).catch(() => null),
    ]);
    return { alloy: alloy || [], ms: ms || [], capacity };
  }, [], { interval: 60000 });

  const alloyIntakes = ref?.alloy || [];
  const msIntakes = ref?.ms || [];
  const truckCapacity = useMemo(() => {
    const c = ref?.capacity;
    if (c == null) return null;
    if (typeof c === 'number') return c;
    const arr = Array.isArray(c) ? c : [c];
    const blocks = arr.map((x) => Number(x.max_blocks ?? x.maxBlocks ?? x.block_count ?? x.blocks ?? x.value)).filter((n) => n > 0);
    return blocks.length ? Math.max(...blocks) : null;
  }, [ref]);

  // Normalise tally rows into a per-cycle map keyed by cycle code.
  const tallyRows = Array.isArray(tallyData) ? tallyData : (tallyData?.items || []);
  const tallyByCycle = useMemo(() => {
    const m = {};
    tallyRows.forEach((row) => {
      const code = (row.cycle_code || row.cycleCode || row.code || '').toUpperCase();
      if (!code) return;
      m[code] = {
        accumulated: Number(row.accumulated ?? row.count ?? row.tally ?? 0) || 0,
        heats: (row.alloy_heats || row.alloyHeats || []).filter(Boolean),
      };
    });
    return m;
  }, [tallyRows]);

  const totalAccumulated = CYCLE_OPTIONS.reduce((acc, c) => acc + (tallyByCycle[c]?.accumulated || 0), 0);

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="link" size={20} color="var(--text-primary)" />
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>Joining Operation</div>
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            WELD-01 · Faridabad — alloy steel + MS welded into blocks. Each weld is logged as a running tally per cycle type.
            Individual blocks are not tracked here; rolling erases block identity downstream. The batch forms later at Contractor Dispatch.
          </div>
        </div>
        <button className="btn btn-sm" onClick={refetchTally} disabled={tallyLoading}>
          <Icon name="refresh" size={14} />
          Refresh
        </button>
      </div>

      <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 0.95fr)', gap: 18, alignItems: 'start' }}>
        {/* RUNNING TALLY */}
        <TallyPanel
          tallyByCycle={tallyByCycle}
          loading={tallyLoading && !tallyData}
          error={tallyError}
          totalAccumulated={totalAccumulated}
          truckCapacity={truckCapacity}
        />

        {/* LOG WELD FORM */}
        <LogWeldPanel
          canLog={canLog}
          location={location}
          alloyIntakes={alloyIntakes}
          msIntakes={msIntakes}
          onLogged={refetchTally}
        />
      </div>
    </div>
  );
}

// ── RUNNING TALLY PANEL ────────────────────────────────────────────────────────

function TallyPanel({ tallyByCycle, loading, error, totalAccumulated, truckCapacity }) {
  return (
    <div className="card" style={{ padding: 22 }}>
      <SectionTitle icon="stack" sub="Blocks welded since the last dispatch, accumulating per cycle type. Cycle type is inherited from the alloy steel grade.">
        Running tally — blocks in holding
      </SectionTitle>

      <ErrorBanner error={error} />

      {loading ? (
        <div style={{ padding: '34px 14px', textAlign: 'center', fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          Loading tally…
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 12 }}>
            {CYCLE_OPTIONS.map((cycle) => {
              const entry = tallyByCycle[cycle] || { accumulated: 0, heats: [] };
              const color = CYCLE_COLORS[cycle];
              return (
                <div
                  key={cycle}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-lg)',
                    background: 'var(--bg-muted)',
                    border: '1px solid var(--border-card)',
                    borderLeft: `3px solid ${color}`,
                  }}
                >
                  <div style={{ minWidth: 64 }}>
                    <CycleBadge cycle={cycle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 28, letterSpacing: '-0.03em', color: 'var(--text-primary)', lineHeight: 1 }}>
                        {entry.accumulated}
                      </span>
                      <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary)' }}>
                        block{entry.accumulated === 1 ? '' : 's'} in holding
                      </span>
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-secondary)', marginTop: 5 }}>
                      {entry.heats.length
                        ? `HEATS: ${entry.heats.slice(0, 4).join(', ')}${entry.heats.length > 4 ? ` +${entry.heats.length - 4}` : ''}`
                        : 'NO ALLOY HEATS YET'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* total + progress toward dispatch */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-card)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary)' }}>Total blocks in holding</span>
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                {totalAccumulated}{truckCapacity ? ` / ${truckCapacity}` : ''}
                {truckCapacity ? <span style={{ fontFamily: SANS, fontWeight: 400, fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 }}>truck capacity</span> : null}
              </span>
            </div>
            {truckCapacity ? (
              <div style={{ marginTop: 10, height: 8, borderRadius: 999, background: 'var(--border-card)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, (totalAccumulated / truckCapacity) * 100)}%`,
                    background: totalAccumulated >= truckCapacity ? 'var(--status-success)' : 'var(--ink-650)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            ) : null}
            <div style={{ marginTop: 10, fontFamily: SANS, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {truckCapacity && totalAccumulated >= truckCapacity
                ? 'Truck capacity reached — ready to dispatch. The batch reference is generated at Contractor Dispatch.'
                : 'Blocks accumulate here individually. They become one batch only when a truck is loaded at Contractor Dispatch.'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── LOG WELD PANEL ─────────────────────────────────────────────────────────────

function LogWeldPanel({ canLog, location, alloyIntakes, msIntakes, onLogged }) {
  const [alloyId, setAlloyId] = useState('');
  const [msId, setMsId] = useState('');
  const [sizeMm, setSizeMm] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const selectedAlloy = alloyIntakes.find((a) => String(a.id) === String(alloyId));
  // Cycle type is inherited from the chosen alloy steel grade — read-only, never selected here.
  const inheritedCycle = (selectedAlloy?.cycle_code || selectedAlloy?.cycleCode || '').toUpperCase() || null;

  // MS bars are only valid when their dimensions match the selected alloy bar.
  const alloyDims = selectedAlloy?.dimensions_mm ?? selectedAlloy?.dimensionsMm ?? null;
  const msOptions = useMemo(() => {
    if (!alloyDims) return msIntakes;
    return msIntakes.filter((m) => {
      const d = m.dimensions_mm ?? m.dimensionsMm ?? null;
      return d == null || String(d) === String(alloyDims);
    });
  }, [msIntakes, alloyDims]);

  const isFaridabad = location === 'faridabad';
  const formValid = canLog && isFaridabad && alloyId && msId && inheritedCycle;

  async function logWeld() {
    setError(null);
    setSuccess(null);
    if (!formValid) {
      if (!inheritedCycle) setError({ message: 'Select an alloy steel intake whose grade maps to a cycle type.' });
      else setError({ message: 'Select both an alloy steel and an MS intake to log a weld.' });
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        cycleCode: inheritedCycle,
        alloyIntakeId: alloyId,
        msIntakeId: msId,
        sizeMm: Number(sizeMm) || undefined,
      };
      await faridabadApi.logWeld(payload);
      setSuccess({ cycle: inheritedCycle });
      // keep the alloy/MS selection so repeated welds of the same run are fast; clear size only
      setSizeMm('');
      onLogged?.();
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card" style={{ padding: 22, position: 'sticky', top: 16 }}>
      <SectionTitle icon="link" sub="Log one weld at a time. Each logged weld is one block — it increments the tally above.">
        Log a weld
      </SectionTitle>

      {!canLog && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-muted)', border: '1px solid var(--border-card)', marginBottom: 16 }}>
          <Icon name="lock" size={15} color="var(--text-secondary)" />
          <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary)' }}>
            Your role can view the tally but cannot log welds.
          </div>
        </div>
      )}

      {!isFaridabad && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-soft-amber)', border: '1px solid var(--bg-soft-amber-2)', marginBottom: 16 }}>
          <Icon name="alert" size={15} color="var(--location-faridabad)" />
          <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--location-faridabad)' }}>
            Joining is a Faridabad operation — switch location to Faridabad to log welds.
          </div>
        </div>
      )}

      <ErrorBanner error={error} onClose={() => setError(null)} />

      {success && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 'var(--radius-lg)', background: 'rgba(34,160,107,0.10)', border: '1px solid rgba(34,160,107,0.30)', marginBottom: 16 }}>
          <Icon name="check" size={16} color="var(--status-success)" />
          <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--status-success-dark)' }}>
            Weld logged — one {success.cycle} block added to holding. The tally has been updated.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <Label>Alloy steel intake</Label>
          <select className="form-select" value={alloyId} onChange={(e) => { setAlloyId(e.target.value); setMsId(''); setSuccess(null); }} disabled={!canLog || !isFaridabad}>
            <option value="">Select alloy steel intake…</option>
            {alloyIntakes.map((a) => (
              <option key={a.id} value={a.id}>
                {(a.supplier_name || a.supplier || 'Supplier')} · {a.heat_number || a.heatNumber || `#${a.id}`}
                {a.grade ? ` · ${a.grade}` : ''}
                {(a.dimensions_mm ?? a.dimensionsMm) ? ` · ${a.dimensions_mm ?? a.dimensionsMm}mm` : ''}
              </option>
            ))}
          </select>
          {alloyIntakes.length === 0 && <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>No alloy steel intakes available.</div>}
        </div>

        {/* inherited cycle type — read-only */}
        <div>
          <Label>Cycle type (inherited from alloy grade)</Label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 13px', border: '1.5px solid var(--border-input)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-muted)' }}>
            {inheritedCycle ? (
              <CycleBadge cycle={inheritedCycle} />
            ) : (
              <span style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary)' }}>Select an alloy intake to derive the cycle type</span>
            )}
          </div>
        </div>

        <div>
          <Label>MS intake (matching dimensions only)</Label>
          <select className="form-select" value={msId} onChange={(e) => { setMsId(e.target.value); setSuccess(null); }} disabled={!canLog || !isFaridabad || !alloyId}>
            <option value="">{alloyId ? 'Select MS intake…' : 'Select an alloy intake first…'}</option>
            {msOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {(m.supplier_name || m.supplier || 'Supplier')} · {m.heat_number || m.heatNumber || `#${m.id}`}
                {(m.dimensions_mm ?? m.dimensionsMm) ? ` · ${m.dimensions_mm ?? m.dimensionsMm}mm` : ''}
              </option>
            ))}
          </select>
          {alloyId && msOptions.length === 0 && (
            <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>No MS intakes match the selected alloy bar dimensions.</div>
          )}
        </div>

        <div>
          <Label>Output block size — mm (optional)</Label>
          <input
            className="form-input"
            type="number"
            min="0"
            placeholder="e.g. 3600"
            value={sizeMm}
            onChange={(e) => setSizeMm(e.target.value)}
            disabled={!canLog || !isFaridabad}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-muted)', border: '1px solid var(--border-card)' }}>
          <Icon name="alert" size={15} color="var(--text-secondary)" />
          <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            No per-block reference is created. This weld is recorded only as a tally increment — the block keeps its heat
            traceability but is never individually tracked. The batch is formed at Contractor Dispatch.
          </div>
        </div>

        <button className="btn btn-primary" onClick={logWeld} disabled={submitting || !formValid}>
          <Icon name="check" size={15} />
          {submitting ? 'Logging weld…' : 'Log weld → increment tally'}
        </button>
      </div>
    </div>
  );
}
