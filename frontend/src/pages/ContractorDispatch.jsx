import { useState, useMemo } from 'react';
import { usePolling } from '../hooks/usePolling';
import { faridabadApi, masterApi } from '../api/resources';
import { useAuth } from '../store/AuthContext';
import { CycleBadge, StatusPill, hexToRgba } from '../components/common/Badges';
import Icon from '../components/common/Icon';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

const CYCLE_OPTIONS = ['EAT', 'SWAN', 'OVEN'];

// ── tiny shared chrome (matches QC.jsx conventions) ──
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

function SuccessBanner({ message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-success-dark, #1c7a52)', background: 'rgba(34,160,107,0.1)', border: '1px solid rgba(34,160,107,0.25)', borderRadius: 'var(--radius-md, 9px)', padding: '10px 12px' }}>
      <Icon name="check" size={15} color="var(--status-success-dark, #1c7a52)" />
      <span>{message}</span>
    </div>
  );
}

// A coloured swatch for a color code value (the colour assigned to a batch).
function ColorSwatch({ hex, label }) {
  const swatch = hex || '#9bb4d4';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 11, color: 'var(--text-primary, #15366a)' }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: swatch, border: '1px solid rgba(21,54,106,0.18)', flexShrink: 0 }} />
      {label || '—'}
    </span>
  );
}

// Helpers to read possibly snake/camel-cased fields off API records.
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
  return payload.items || [];
}

// ── Possible-heats caveat block — never presents a single definitive heat ──
function PossibleHeats({ heats }) {
  const list = Array.isArray(heats) ? heats.filter(Boolean) : [];
  if (!list.length) {
    return <Empty>No candidate heat numbers recorded for this batch.</Empty>;
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--status-warning, #d97a2b)', marginBottom: 7 }}>
        <Icon name="alert" size={12} color="var(--status-warning, #d97a2b)" />
        Possible heats only — not a definitive single heat
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {list.map((h, i) => {
          const code = typeof h === 'string' ? h : pick(h, 'heatNumber', 'heat_number', 'heat', 'code') || '—';
          const kind = typeof h === 'string' ? '' : (pick(h, 'kind', 'type', 'grade') || '');
          const isAlloy = /alloy/i.test(String(kind));
          const tint = isAlloy ? '#7a4fc0' : '#5d7188';
          return (
            <span key={code + i} className="badge" style={{ background: hexToRgba(tint, 0.12), color: tint }}>
              {code}{kind ? ` · ${String(kind).toUpperCase()}` : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── A single in-transit dispatch card ──
function InTransitCard({ d }) {
  const ref = pick(d, 'dispatchRef', 'dispatch_ref', 'reference', 'ref', 'id') || '—';
  const cycle = pick(d, 'cycleType', 'cycle_type', 'cycle');
  const blocks = pick(d, 'blockCount', 'block_count', 'blocks', 'billetCount', 'billet_count');
  const color = pick(d, 'colorCode', 'color_code', 'color');
  const colorHex = pick(d, 'colorHex', 'color_hex', 'hex');
  const capacity = pick(d, 'truckCapacity', 'truck_capacity', 'capacity');
  const heats = pick(d, 'possibleHeats', 'possible_heats', 'heats', 'heatNumbers', 'heat_numbers') || [];
  const status = pick(d, 'receivedStatus', 'received_status', 'status') || 'in_transit';

  return (
    <div style={{ border: '1px solid var(--border-card, #e3ebde)', borderRadius: 'var(--radius-lg, 11px)', padding: '13px 14px', background: 'var(--bg-muted-2, #f6f9f4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="truck" size={16} color="var(--location-faridabad, #d97a2b)" />
          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>{ref}</span>
          {cycle ? <CycleBadge cycle={String(cycle).toUpperCase()} /> : null}
        </span>
        <StatusPill status={status} label={status === 'in_transit' ? 'In transit' : status} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
        <Field label="Blocks">{blocks != null ? blocks : '—'}</Field>
        <Field label="Color code"><ColorSwatch hex={colorHex} label={color} /></Field>
        <Field label="Truck capacity">{capacity != null ? capacity : '—'}</Field>
      </div>

      <div style={{ marginTop: 11, borderTop: '1px solid var(--border-card, #e3ebde)', paddingTop: 10 }}>
        <PossibleHeats heats={heats} />
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted-2, #7d96bb)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>{children}</div>
    </div>
  );
}

export default function ContractorDispatch() {
  const { user, isManager, isAdmin, isSupervisor } = useAuth();
  const canDispatch = isManager || isAdmin || isSupervisor;

  // ── Live data ──
  const { data: dispatchData, error: dispatchError, loading: dispatchLoading, refetch } = usePolling(
    () => faridabadApi.dispatches().then((r) => r.data),
    []
  );
  const { data: tallyData, error: tallyError, loading: tallyLoading } = usePolling(
    () => faridabadApi.weldTally().then((r) => r.data),
    []
  );
  const { data: colorData, error: colorError } = usePolling(
    () => masterApi.colorCodes().then((r) => r.data),
    [],
    { interval: 120000 }
  );
  const { data: capacityData, error: capacityError } = usePolling(
    () => masterApi.truckCapacity().then((r) => r.data),
    [],
    { interval: 120000 }
  );

  const dispatches = normalizeList(dispatchData, 'dispatches');
  const colorCodes = normalizeList(colorData, 'colorCodes', 'color_codes');
  const capacities = normalizeList(capacityData, 'truckCapacity', 'truck_capacity', 'capacities');
  const tally = normalizeList(tallyData, 'tally', 'rows');

  const inTransit = dispatches.filter((d) => {
    const s = String(pick(d, 'receivedStatus', 'received_status', 'status') || '').toLowerCase();
    return s !== 'fully_received' && s !== 'received';
  });

  // ── Create-dispatch form state ──
  const [cycleType, setCycleType] = useState('EAT');
  const [colorCode, setColorCode] = useState('');
  const [truckCapacity, setTruckCapacity] = useState('');
  const [blockCount, setBlockCount] = useState('');
  const [heatsInput, setHeatsInput] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formSuccess, setFormSuccess] = useState(null);

  // Running tally for the selected cycle — this is what forms the batch.
  const tallyForCycle = useMemo(() => {
    const row = tally.find((t) => String(pick(t, 'cycleType', 'cycle_type', 'cycle') || '').toUpperCase() === cycleType);
    return row ? (pick(row, 'blockCount', 'block_count', 'blocks', 'count') ?? 0) : null;
  }, [tally, cycleType]);

  function useTally() {
    if (tallyForCycle != null) setBlockCount(String(tallyForCycle));
  }

  const possibleHeats = heatsInput
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  async function submit(e) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!colorCode) {
      setFormError('A color code must be assigned to the dispatch.');
      return;
    }
    if (!truckCapacity) {
      setFormError('Select a truck capacity.');
      return;
    }
    const blocks = Number(blockCount);
    if (!blockCount || Number.isNaN(blocks) || blocks <= 0) {
      setFormError('Block count is required (formed from the running weld tally).');
      return;
    }

    setBusy(true);
    try {
      await faridabadApi.createDispatch({
        cycleType,
        colorCode,
        truckCapacity,
        blockCount: blocks,
        possibleHeats, // array — candidate heats, never a single definitive heat
        dispatchRef: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        dispatchedBy: user?.username || user?.name,
      });
      setFormSuccess(`Dispatch formed · ${blocks} blocks · color ${colorCode} · now in transit to Dharmapuri.`);
      setColorCode('');
      setTruckCapacity('');
      setBlockCount('');
      setHeatsInput('');
      setReference('');
      setNotes('');
      refetch();
    } catch (err) {
      setFormError(err.message || 'Could not create the dispatch.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
        Contractor Dispatch
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
        Form the dispatch batch from the running weld tally and hand it to the rolling contractor for Dharmapuri{dispatchLoading ? ' · loading…' : ''}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16, marginTop: 20, alignItems: 'start' }}>
        {/* ── LEFT: Create dispatch ── */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionTitle>Form Dispatch</SectionTitle>

          {!canDispatch ? (
            <Empty>Forming a dispatch requires a supervisor or manager role.</Empty>
          ) : (
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div>
                <label className="form-label">Cycle type</label>
                <div style={{ display: 'flex', gap: 7 }}>
                  {CYCLE_OPTIONS.map((c) => {
                    const active = cycleType === c;
                    return (
                      <button
                        type="button"
                        key={c}
                        onClick={() => setCycleType(c)}
                        className="btn btn-sm"
                        style={{
                          flex: 1,
                          justifyContent: 'center',
                          background: active ? 'var(--ink-650, #15366a)' : 'var(--bg-card, #fff)',
                          color: active ? 'var(--text-onink, #eaf4e4)' : 'var(--text-secondary, #5d7188)',
                          border: active ? 'none' : '1px solid var(--border-input, #d6e0d2)',
                        }}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="form-label">Block count (from weld tally)</label>
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
                    Running {cycleType} tally: {tallyForCycle} blocks
                  </div>
                ) : null}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
                <div>
                  <label className="form-label">Color code</label>
                  <select className="form-select" value={colorCode} onChange={(e) => setColorCode(e.target.value)}>
                    <option value="">select…</option>
                    {colorCodes.map((c, i) => {
                      const val = pick(c, 'code', 'name', 'colorCode', 'color_code') || (typeof c === 'string' ? c : `c${i}`);
                      return <option key={val + i} value={val}>{val}</option>;
                    })}
                  </select>
                  {colorError ? (
                    <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--status-warning, #d97a2b)', marginTop: 4 }}>
                      Color codes unavailable.
                    </div>
                  ) : null}
                </div>
                <div>
                  <label className="form-label">Truck capacity</label>
                  <select className="form-select" value={truckCapacity} onChange={(e) => setTruckCapacity(e.target.value)}>
                    <option value="">select…</option>
                    {capacities.map((c, i) => {
                      const val = pick(c, 'value', 'capacity', 'label', 'name') || (typeof c === 'string' ? c : `t${i}`);
                      return <option key={val + i} value={val}>{val}</option>;
                    })}
                  </select>
                  {capacityError ? (
                    <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--status-warning, #d97a2b)', marginTop: 4 }}>
                      Truck capacities unavailable.
                    </div>
                  ) : null}
                </div>
              </div>

              <div>
                <label className="form-label">Possible heat numbers (alloy + MS)</label>
                <textarea
                  className="form-input"
                  style={{ height: 60, padding: '8px 13px', resize: 'vertical', fontFamily: MONO, fontSize: 12 }}
                  placeholder="comma or newline separated — candidate heats only"
                  value={heatsInput}
                  onChange={(e) => setHeatsInput(e.target.value)}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 9.5, color: 'var(--status-warning, #d97a2b)', marginTop: 5 }}>
                  <Icon name="alert" size={12} color="var(--status-warning, #d97a2b)" />
                  These are heats that <em>could</em> be in the batch — not a single definitive heat.
                </div>
                {possibleHeats.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
                    {possibleHeats.map((h, i) => (
                      <span key={h + i} className="badge" style={{ background: 'var(--bg-muted, #f4f7f2)', color: 'var(--text-secondary, #5d7188)' }}>{h}</span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
                <div>
                  <label className="form-label">Dispatch ref / challan</label>
                  <input className="form-input" placeholder="optional" value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Notes</label>
                  <input className="form-input" placeholder="optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>

              <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted-2, #7d96bb)' }}>
                Dispatched by: {user?.username || user?.name || '—'}
              </div>

              {formError ? <ErrorBanner message={formError} /> : null}
              {formSuccess ? <SuccessBanner message={formSuccess} /> : null}

              <button type="submit" className="btn btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>
                <Icon name="truck" size={15} color="var(--accent-green, #d4eecb)" />
                {busy ? 'Forming…' : 'Form Dispatch'}
              </button>
            </form>
          )}
        </div>

        {/* ── RIGHT: In transit ── */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <SectionTitle>In Transit to Dharmapuri</SectionTitle>
            <span className="badge" style={{ background: hexToRgba('#d97a2b', 0.14), color: 'var(--location-faridabad, #d97a2b)' }}>
              {inTransit.length} ON THE ROAD
            </span>
          </div>

          {dispatchError ? (
            <ErrorBanner message="Could not load dispatches." />
          ) : dispatchLoading && !dispatchData ? (
            <Empty>Loading dispatches…</Empty>
          ) : inTransit.length === 0 ? (
            <Empty>Nothing in transit. Form a dispatch on the left to send a batch to Dharmapuri.</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 620, overflowY: 'auto' }}>
              {inTransit.map((d, i) => (
                <InTransitCard key={pick(d, 'id', 'dispatchRef', 'dispatch_ref') || i} d={d} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── BOTTOM: Dispatch log ── */}
      <div className="card" style={{ marginTop: 16, padding: '18px 20px' }}>
        <SectionTitle>Dispatch Log</SectionTitle>
        {dispatchError ? (
          <ErrorBanner message="Could not load the dispatch log." />
        ) : dispatchLoading && !dispatchData ? (
          <Empty>Loading…</Empty>
        ) : dispatches.length === 0 ? (
          <Empty>No dispatches recorded yet.</Empty>
        ) : (
          <DispatchLog rows={dispatches} />
        )}
      </div>
    </div>
  );
}

function DispatchLog({ rows }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: 12.5 }}>
        <thead>
          <tr style={{ textAlign: 'left', fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
            <th style={{ padding: '6px 12px 8px 0' }}>Date</th>
            <th style={{ padding: '6px 12px 8px 0' }}>Ref</th>
            <th style={{ padding: '6px 12px 8px 0' }}>Cycle</th>
            <th style={{ padding: '6px 12px 8px 0' }}>Blocks</th>
            <th style={{ padding: '6px 12px 8px 0' }}>Color</th>
            <th style={{ padding: '6px 12px 8px 0' }}>Truck cap.</th>
            <th style={{ padding: '6px 12px 8px 0' }}>Possible heats</th>
            <th style={{ padding: '6px 12px 8px 0' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d, i) => {
            const date = pick(d, 'dispatchedAt', 'dispatched_at', 'date', 'createdAt', 'created_at');
            const ref = pick(d, 'dispatchRef', 'dispatch_ref', 'reference', 'ref', 'id') || '—';
            const cycle = pick(d, 'cycleType', 'cycle_type', 'cycle');
            const blocks = pick(d, 'blockCount', 'block_count', 'blocks', 'billetCount', 'billet_count');
            const color = pick(d, 'colorCode', 'color_code', 'color');
            const colorHex = pick(d, 'colorHex', 'color_hex', 'hex');
            const cap = pick(d, 'truckCapacity', 'truck_capacity', 'capacity');
            const heats = pick(d, 'possibleHeats', 'possible_heats', 'heats', 'heatNumbers', 'heat_numbers') || [];
            const heatCount = Array.isArray(heats) ? heats.length : 0;
            const status = pick(d, 'receivedStatus', 'received_status', 'status') || 'in_transit';
            return (
              <tr key={pick(d, 'id', 'dispatchRef', 'dispatch_ref') || i} style={{ borderTop: '1px solid #eef2ea' }}>
                <td style={{ padding: '8px 12px 8px 0', fontFamily: MONO, color: 'var(--text-secondary, #5d7188)' }}>
                  {date ? new Date(date).toLocaleDateString() : '—'}
                </td>
                <td style={{ padding: '8px 12px 8px 0', fontFamily: MONO, color: 'var(--text-primary, #15366a)' }}>{ref}</td>
                <td style={{ padding: '8px 12px 8px 0' }}>{cycle ? <CycleBadge cycle={String(cycle).toUpperCase()} /> : '—'}</td>
                <td style={{ padding: '8px 12px 8px 0', fontFamily: MONO }}>{blocks != null ? blocks : '—'}</td>
                <td style={{ padding: '8px 12px 8px 0' }}><ColorSwatch hex={colorHex} label={color} /></td>
                <td style={{ padding: '8px 12px 8px 0', fontFamily: MONO }}>{cap != null ? cap : '—'}</td>
                <td style={{ padding: '8px 12px 8px 0', fontFamily: MONO, color: 'var(--text-secondary, #5d7188)' }} title={Array.isArray(heats) ? heats.map((h) => (typeof h === 'string' ? h : pick(h, 'heatNumber', 'heat_number', 'heat', 'code'))).filter(Boolean).join(', ') : ''}>
                  {heatCount ? `${heatCount} candidate${heatCount === 1 ? '' : 's'}` : '—'}
                </td>
                <td style={{ padding: '8px 12px 8px 0' }}>
                  <StatusPill status={status} label={String(status).replace(/_/g, ' ')} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
