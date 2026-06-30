import { useState, useMemo, useEffect } from 'react';
import { usePolling } from '../hooks/usePolling';
import { faridabadApi, masterApi, cyclesApi } from '../api/resources';
import { useAuth } from '../store/AuthContext';
import { CycleBadge, hexToRgba } from '../components/common/Badges';
import Icon from '../components/common/Icon';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

// Status → colour map for the two-leg journey pills.
const STATUS_STYLE = {
  'at rolling': { color: '#d97a2b', label: 'At Rolling' },        // amber
  'dispatched to dharmapuri': { color: '#3b82f6', label: 'Dispatched to Dharmapuri' }, // blue
  'received at dharmapuri': { color: '#22a06b', label: 'Received at Dharmapuri' },     // green
};

// ── helpers ─────────────────────────────────────────────────────────────────

const pick = (obj, ...keys) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
};

function normalizeList(payload, ...nested) {
  if (Array.isArray(payload)) return payload;
  if (!payload) return [];
  for (const key of nested) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return payload.items || payload.rows || [];
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(ts) {
  if (!ts) return '—';
  const s = String(ts);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function statusInfo(status) {
  const key = String(status || '').trim().toLowerCase();
  return STATUS_STYLE[key] || { color: '#9aa0a6', label: status || '—' };
}

// ── small shared chrome ──────────────────────────────────────────────────────

function SectionTitle({ icon, children, sub, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        {icon && <Icon name={icon} size={16} color="var(--text-secondary)" />}
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>{children}</div>
          {sub && <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>}
        </div>
      </div>
      {right}
    </div>
  );
}

function Label({ children, required }) {
  return (
    <label className="form-label">
      {children}
      {required && <span style={{ color: 'var(--status-danger)', marginLeft: 4 }}>*</span>}
    </label>
  );
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-danger, #e5484d)', background: 'rgba(229,72,77,0.08)', border: '1px solid rgba(229,72,77,0.25)', borderRadius: 'var(--radius-md, 9px)', padding: '10px 12px' }}>
      <Icon name="alert" size={15} color="var(--status-danger, #e5484d)" />
      <span>{message}</span>
    </div>
  );
}

function SuccessBanner({ message }) {
  if (!message) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-success-dark, #1c7a52)', background: 'rgba(34,160,107,0.1)', border: '1px solid rgba(34,160,107,0.25)', borderRadius: 'var(--radius-md, 9px)', padding: '10px 12px' }}>
      <Icon name="check" size={15} color="var(--status-success-dark, #1c7a52)" />
      <span>{message}</span>
    </div>
  );
}

function BatchStatusPill({ status }) {
  const { color, label } = statusInfo(status);
  return (
    <span className="status-pill" style={{ background: hexToRgba(color, 0.14), color }}>
      {label.toUpperCase()}
    </span>
  );
}

function ColorSwatch({ hex, label }) {
  const swatch = hex || '#9bb4d4';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 11.5, color: 'var(--text-primary, #15366a)' }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: swatch, border: '1px solid rgba(21,54,106,0.18)', flexShrink: 0 }} />
      {label || '—'}
    </span>
  );
}

const thStyle = {
  textAlign: 'left',
  padding: '8px 10px',
  fontFamily: MONO,
  fontSize: 9.5,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '10px 10px',
  fontFamily: SANS,
  fontSize: 12.5,
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
};

function EmptyRow({ colSpan, children }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '26px 14px', textAlign: 'center', fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary)' }}>
        {children}
      </td>
    </tr>
  );
}

// ── ACTIVE BATCHES PANEL ──────────────────────────────────────────────────────

function DaysAtRolling({ days, overdue }) {
  if (days == null) return <span style={{ fontFamily: MONO, color: 'var(--text-secondary)' }}>—</span>;
  if (overdue) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontWeight: 700, color: 'var(--status-danger, #e5484d)' }}>
        {days}
        <span className="badge" style={{ background: hexToRgba('#e5484d', 0.14), color: 'var(--status-danger, #e5484d)' }}>⚠ &gt;15d</span>
      </span>
    );
  }
  return <span style={{ fontFamily: MONO, color: 'var(--text-primary)' }}>{days}</span>;
}

function ActiveBatchesPanel({ rows, loading, error, refetch }) {
  const cols = ['Batch ref', 'Cycle', 'Color', 'Status', 'Days at rolling', 'Blocks', 'Contractor'];
  return (
    <div className="card" style={{ padding: 22 }}>
      <SectionTitle
        icon="stack"
        sub="Every dispatch batch and where it sits on the Faridabad → Rolling Contractor → Dharmapuri journey."
        right={(
          <button className="btn btn-sm" onClick={refetch} title="Refresh batches">
            <Icon name="refresh" size={13} /> Refresh
          </button>
        )}
      >
        Active batches
      </SectionTitle>
      <ErrorBanner message={error ? 'Could not load batches.' : null} />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
          <thead>
            <tr>{cols.map((c) => <th key={c} style={thStyle}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <EmptyRow colSpan={cols.length}>Loading batches…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={cols.length}>No batches yet — create a dispatch below to start a batch on its journey.</EmptyRow>
            ) : (
              rows.map((b, i) => {
                const id = pick(b, 'id') ?? i;
                const ref = pick(b, 'batch_reference', 'batch_ref', 'reference') || `BATCH-${id}`;
                const cycle = pick(b, 'cycle_code', 'cycle');
                const colorName = pick(b, 'color_name', 'color');
                const hex = pick(b, 'hex_swatch', 'color_hex');
                const status = pick(b, 'status');
                const days = pick(b, 'days_at_rolling');
                const overdue = b?.rolling_overdue === true;
                const blocks = pick(b, 'block_count', 'blocks');
                const contractor = pick(b, 'contractor_name', 'contractor');
                const received = pick(b, 'date_received');
                return (
                  <tr key={id} style={{ borderTop: '1px solid var(--border-card)' }}>
                    <td style={{ ...tdStyle, fontFamily: MONO, fontWeight: 600 }}>{ref}</td>
                    <td style={tdStyle}>{cycle ? <CycleBadge cycle={String(cycle).toUpperCase()} /> : '—'}</td>
                    <td style={tdStyle}><ColorSwatch hex={hex} label={colorName} /></td>
                    <td style={tdStyle}>
                      <BatchStatusPill status={status} />
                      {received ? (
                        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-secondary)', marginLeft: 8 }}>
                          {fmtDate(received)}
                        </span>
                      ) : null}
                    </td>
                    <td style={tdStyle}><DaysAtRolling days={days != null ? days : null} overdue={overdue} /></td>
                    <td style={{ ...tdStyle, fontFamily: MONO }}>{blocks != null ? blocks : '—'}</td>
                    <td style={tdStyle}>{contractor || '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── CREATE DISPATCH (STEP 9 — Dispatch to Rolling) ────────────────────────────

function CreateDispatchForm({ cycles, colorCodes, contractors, tally, tallyError, tallyLoading, onCreated, canDispatch }) {
  const [cycleCode, setCycleCode] = useState('');
  const [blockCount, setBlockCount] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [colorOverride, setColorOverride] = useState(false);
  const [colorCodeId, setColorCodeId] = useState('');
  const [dateDispatched, setDateDispatched] = useState(today);
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const [challan, setChallan] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Default cycle to the first available once cycles load.
  useEffect(() => {
    if (!cycleCode && cycles.length) {
      setCycleCode(pick(cycles[0], 'code') || '');
    }
  }, [cycles, cycleCode]);

  // Auto-pick the first active colour by default (unless the user overrides).
  const autoColor = colorCodes.length ? colorCodes[0] : null;
  useEffect(() => {
    if (!colorOverride && autoColor) {
      setColorCodeId(String(pick(autoColor, 'id')));
    }
  }, [autoColor, colorOverride]);

  // Running tally available for the selected cycle (block-count hint).
  const tallyForCycle = useMemo(() => {
    if (!cycleCode) return null;
    const row = tally.find((t) => {
      const c = pick(t, 'cycle_code', 'cycleType', 'cycle_type', 'cycle');
      return String(c || '').toUpperCase() === String(cycleCode).toUpperCase();
    });
    return row ? (pick(row, 'block_count', 'blockCount', 'blocks', 'count', 'available') ?? 0) : null;
  }, [tally, cycleCode]);

  function useTally() {
    if (tallyForCycle != null) setBlockCount(String(tallyForCycle));
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!cycleCode) { setError('Select a cycle type.'); return; }
    const blocks = Number(blockCount);
    if (!blockCount || Number.isNaN(blocks) || blocks <= 0) {
      setError('Block count is required (formed from the running weld tally).');
      return;
    }
    if (!contractorId) { setError('Select a rolling contractor.'); return; }
    if (!dateDispatched) { setError('A dispatch date is required.'); return; }

    setBusy(true);
    try {
      await faridabadApi.createDispatch({
        cycleCode,
        blockCount: blocks,
        contractorId,
        colorCodeId: colorCodeId || undefined,
        dateDispatched,
        expectedDeliveryDate: expectedDelivery || undefined,
        challanReference: challan.trim() || undefined,
      });
      setSuccess(`Dispatch created · ${blocks} blocks · ${cycleCode} · now at rolling contractor.`);
      setBlockCount('');
      setChallan('');
      setExpectedDelivery('');
      onCreated();
    } catch (err) {
      setError(err?.message || 'Could not create the dispatch.');
    } finally {
      setBusy(false);
    }
  }

  if (!canDispatch) {
    return (
      <div className="card" style={{ padding: 22 }}>
        <SectionTitle icon="truck" sub="Step 9 — dispatch the batch to the rolling contractor.">Create dispatch</SectionTitle>
        <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary)' }}>
          Creating a dispatch requires a supervisor or manager role.
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 22 }}>
      <SectionTitle icon="truck" sub="Step 9 — form the batch from the weld tally and dispatch it to the rolling contractor.">
        Create dispatch
      </SectionTitle>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Label required>Cycle type</Label>
          <select className="form-select" value={cycleCode} onChange={(e) => setCycleCode(e.target.value)}>
            <option value="">select…</option>
            {cycles.map((c, i) => {
              const code = pick(c, 'code') || `c${i}`;
              const name = pick(c, 'name');
              return <option key={code} value={code}>{code}{name ? ` — ${name}` : ''}</option>;
            })}
          </select>
        </div>

        <div>
          <Label required>Block count (from weld tally)</Label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-input"
              type="number"
              min="1"
              placeholder="blocks in this batch"
              value={blockCount}
              onChange={(e) => setBlockCount(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm"
              style={{ flexShrink: 0, height: 44 }}
              disabled={tallyForCycle == null}
              onClick={useTally}
              title={tallyForCycle == null ? 'No running tally for this cycle' : 'Fill from running tally'}
            >
              {tallyLoading ? '…' : tallyForCycle != null ? `Use ${tallyForCycle}` : 'Tally n/a'}
            </button>
          </div>
          {tallyError ? (
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--status-warning, #d97a2b)', marginTop: 4 }}>
              Weld tally unavailable — enter the block count manually.
            </div>
          ) : tallyForCycle != null ? (
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted-2, #7d96bb)', marginTop: 4 }}>
              Available {String(cycleCode).toUpperCase()} tally: {tallyForCycle} blocks
            </div>
          ) : null}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Label>Color code</Label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: SANS, fontSize: 11.5, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={colorOverride}
                onChange={(e) => setColorOverride(e.target.checked)}
              />
              Override auto-pick
            </label>
          </div>
          {colorOverride ? (
            <select className="form-select" value={colorCodeId} onChange={(e) => setColorCodeId(e.target.value)}>
              <option value="">select…</option>
              {colorCodes.map((c) => (
                <option key={pick(c, 'id')} value={String(pick(c, 'id'))}>{pick(c, 'name')}</option>
              ))}
            </select>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--bg-muted)', border: '1px solid var(--border-card)' }}>
              {autoColor ? (
                <ColorSwatch hex={pick(autoColor, 'hex_swatch')} label={pick(autoColor, 'name')} />
              ) : (
                <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary)' }}>No color codes available.</span>
              )}
              <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted-2, #7d96bb)', marginLeft: 'auto' }}>
                auto-picked
              </span>
            </div>
          )}
        </div>

        <div>
          <Label required>Rolling contractor</Label>
          <select className="form-select" value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
            <option value="">select…</option>
            {contractors.map((c) => (
              <option key={pick(c, 'id')} value={String(pick(c, 'id'))}>{pick(c, 'name')}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <Label required>Date dispatched</Label>
            <input className="form-input" type="date" value={dateDispatched} onChange={(e) => setDateDispatched(e.target.value)} />
          </div>
          <div>
            <Label>Expected delivery date</Label>
            <input className="form-input" type="date" value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} />
          </div>
        </div>

        <div>
          <Label>Challan reference</Label>
          <input className="form-input" placeholder="optional" value={challan} onChange={(e) => setChallan(e.target.value)} />
        </div>

        <ErrorBanner message={error} />
        <SuccessBanner message={success} />

        <button type="submit" className="btn btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>
          <Icon name="truck" size={15} color="var(--accent-green, #d4eecb)" />
          {busy ? 'Dispatching…' : 'Dispatch to rolling'}
        </button>
      </form>
    </div>
  );
}

// ── LOG ONWARD DISPATCH (STEP 10 — Dispatch to Dharmapuri) ────────────────────

function OnwardDispatchForm({ atRolling, onDone, canDispatch }) {
  const [batchId, setBatchId] = useState('');
  const [dispatchedDate, setDispatchedDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Reset selection if the chosen batch is no longer at rolling.
  useEffect(() => {
    if (batchId && !atRolling.some((b) => String(pick(b, 'id')) === String(batchId))) {
      setBatchId('');
    }
  }, [atRolling, batchId]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!batchId) { setError('Select a batch currently at rolling.'); return; }
    if (!dispatchedDate) { setError('A dispatch date is required.'); return; }

    setBusy(true);
    try {
      await faridabadApi.dispatchOnward(batchId, {
        dispatchedDate,
        notes: notes.trim() || undefined,
      });
      const ref = (() => {
        const b = atRolling.find((x) => String(pick(x, 'id')) === String(batchId));
        return b ? (pick(b, 'batch_reference', 'batch_ref', 'reference') || batchId) : batchId;
      })();
      setSuccess(`Batch ${ref} dispatched onward to Dharmapuri.`);
      setBatchId('');
      setNotes('');
      onDone();
    } catch (err) {
      setError(err?.message || 'Could not log the onward dispatch.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 22 }}>
      <SectionTitle icon="truck" sub="Step 10 — when the rolling contractor sends a batch onward to Dharmapuri.">
        Log onward dispatch
      </SectionTitle>

      {!canDispatch ? (
        <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary)' }}>
          Logging an onward dispatch requires a supervisor or manager role.
        </div>
      ) : atRolling.length === 0 ? (
        <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary)' }}>
          No batches currently at rolling.
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <Label required>Batch at rolling</Label>
            <select className="form-select" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="">select a batch…</option>
              {atRolling.map((b) => {
                const id = pick(b, 'id');
                const ref = pick(b, 'batch_reference', 'batch_ref', 'reference') || id;
                const days = pick(b, 'days_at_rolling');
                return (
                  <option key={id} value={String(id)}>
                    {ref}{days != null ? ` · ${days}d at rolling` : ''}
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <Label required>Date dispatched onward</Label>
            <input className="form-input" type="date" value={dispatchedDate} onChange={(e) => setDispatchedDate(e.target.value)} />
          </div>

          <div>
            <Label>Notes</Label>
            <textarea
              className="form-input"
              style={{ height: 70, padding: '10px 13px', resize: 'vertical' }}
              placeholder="optional — anything to note about the onward leg…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <ErrorBanner message={error} />
          <SuccessBanner message={success} />

          <button type="submit" className="btn btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>
            <Icon name="truck" size={15} color="var(--accent-green, #d4eecb)" />
            {busy ? 'Logging…' : 'Dispatch to Dharmapuri'}
          </button>
        </form>
      )}
    </div>
  );
}

// ── PAGE ──────────────────────────────────────────────────────────────────────

export default function FaridabadBatchManagement() {
  const { isManager, isAdmin, isSupervisor } = useAuth();
  const canDispatch = isManager || isAdmin || isSupervisor;

  const { data: batchData, error: batchError, loading: batchLoading, refetch } = usePolling(
    () => faridabadApi.batches().then((r) => r.data),
    []
  );
  const { data: tallyData, error: tallyError, loading: tallyLoading } = usePolling(
    () => faridabadApi.weldTally().then((r) => r.data),
    []
  );
  const { data: cycleData } = usePolling(
    () => cyclesApi.list().then((r) => r.data),
    [],
    { interval: 120000 }
  );
  const { data: colorData } = usePolling(
    () => masterApi.colorCodes().then((r) => r.data),
    [],
    { interval: 120000 }
  );
  const { data: contractorData } = usePolling(
    () => masterApi.contractors().then((r) => r.data),
    [],
    { interval: 120000 }
  );

  const batches = normalizeList(batchData, 'batches');
  const tally = normalizeList(tallyData, 'tally', 'rows');
  const cycles = normalizeList(cycleData, 'cycles');
  const colorCodes = normalizeList(colorData, 'colorCodes', 'color_codes');
  const contractors = normalizeList(contractorData, 'contractors');

  const atRolling = useMemo(
    () => batches.filter((b) => String(pick(b, 'status') || '').trim().toLowerCase() === 'at rolling'),
    [batches]
  );

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="stack" size={20} color="var(--text-primary)" />
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
          Faridabad Batch Management
        </div>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
        Create dispatch batches and track the full two-leg journey: Faridabad → Rolling Contractor → Dharmapuri{batchLoading && !batchData ? ' · loading…' : ''}
      </div>

      {/* Active batches */}
      <div style={{ marginTop: 22 }}>
        <ActiveBatchesPanel
          rows={batches}
          loading={batchLoading && !batchData}
          error={batchError}
          refetch={refetch}
        />
      </div>

      {/* Create dispatch + onward dispatch */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 18, alignItems: 'start' }}>
        <CreateDispatchForm
          cycles={cycles}
          colorCodes={colorCodes}
          contractors={contractors}
          tally={tally}
          tallyError={tallyError}
          tallyLoading={tallyLoading}
          onCreated={refetch}
          canDispatch={canDispatch}
        />
        <OnwardDispatchForm
          atRolling={atRolling}
          onDone={refetch}
          canDispatch={canDispatch}
        />
      </div>
    </div>
  );
}
