import { useState, useMemo, useEffect } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useApp } from '../store/AppContext';
import { useAuth } from '../store/AuthContext';
import { faridabadApi, masterApi } from '../api/resources';
import Receiving from './Receiving';
import Icon from '../components/common/Icon';
import { LocationBadge } from '../components/common/Badges';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";
const T_PRIMARY = 'var(--text-primary, #15366a)';
const T_SECONDARY = 'var(--text-secondary, #5d7188)';
const T_MUTED = 'var(--text-muted, #9bb4d4)';

// Steel density ≈ 7.9 g/cm³ = 0.0000079 kg/mm³ (matches backend intakeWeight.js).
const STEEL_DENSITY = 0.0000079;
const ADD_NEW = '__add_new__';

function todayISO() { return new Date().toISOString().slice(0, 10); }
function asList(d) { return Array.isArray(d) ? d : d?.items || d?.rows || d?.data || []; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* ── shared UI ─────────────────────────────────────────────────────────── */
function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: T_MUTED }}>{children}</div>
      {right || null}
    </div>
  );
}
function ErrorBanner({ message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-danger, #e5484d)', background: 'rgba(229,72,77,0.08)', border: '1px solid rgba(229,72,77,0.25)', borderRadius: 9, padding: '10px 12px' }}>
      <Icon name="alert" size={15} color="var(--status-danger, #e5484d)" /><span>{message}</span>
    </div>
  );
}
function SuccessBanner({ message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-success-dark, #1c7a52)', background: 'rgba(34,160,107,0.1)', border: '1px solid rgba(34,160,107,0.25)', borderRadius: 9, padding: '10px 12px' }}>
      <Icon name="check" size={15} color="var(--status-success-dark, #1c7a52)" /><span>{message}</span>
    </div>
  );
}
function ReadonlyBadge({ children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', fontFamily: MONO, fontSize: 11, fontWeight: 700, color: 'var(--cycle-eat, #2d6fb5)', background: 'rgba(45,111,181,0.12)', borderRadius: 6, padding: '4px 9px' }}>
      {children}
    </span>
  );
}

function SupplierField({ suppliers, value, newValue, onValue, onNewValue }) {
  const usingNew = value === ADD_NEW;
  return (
    <div>
      <label className="form-label">Supplier *</label>
      <select className="form-select" value={value} onChange={(e) => onValue(e.target.value)}>
        <option value="">Select supplier…</option>
        {suppliers.map((s) => {
          const val = s.name || s.supplier_name || s.id;
          return <option key={s.id ?? val} value={val}>{val}</option>;
        })}
        <option value={ADD_NEW}>+ Add new supplier…</option>
      </select>
      {usingNew && (
        <input className="form-input" style={{ marginTop: 8 }} placeholder="New supplier name" value={newValue} onChange={(e) => onNewValue(e.target.value)} autoComplete="off" />
      )}
    </div>
  );
}

const ENTRY_TH = { padding: '4px 8px 6px 0', fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: T_MUTED, textAlign: 'left', whiteSpace: 'nowrap' };
const ENTRY_TD = { padding: '5px 8px 5px 0', verticalAlign: 'middle' };

/* ── Alloy Steel Intake ────────────────────────────────────────────────── */
function AlloyIntakeTab({ canCreate }) {
  const suppliersRef = usePolling(() => masterApi.suppliers().then((r) => r.data).catch(() => []), []);
  const gradesRef = usePolling(() => masterApi.gradeCycleMap().then((r) => r.data).catch(() => []), []);
  const logRef = usePolling(() => faridabadApi.intakes({ material_type: 'alloy_steel' }).then((r) => r.data), []);

  const suppliers = asList(suppliersRef.data).filter((s) => (s.status ?? 'active') !== 'archived');
  const grades = asList(gradesRef.data).filter((g) => (g.status ?? 'active') !== 'archived');
  const log = asList(logRef.data);

  const [supplier, setSupplier] = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  const [heatNumber, setHeatNumber] = useState('');
  const [dateReceived, setDateReceived] = useState(todayISO);
  const [poReference, setPoReference] = useState('');
  const [grade, setGrade] = useState('');
  // Every bar dimension is entered at intake (length, width, thickness vary).
  const [entries, setEntries] = useState([{ length: '', width: '', thickness: '', qty: '' }]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const cycleCode = useMemo(() => {
    const g = grades.find((x) => (x.alloy_grade ?? x.alloyGrade) === grade);
    return g ? (g.cycle_type_code ?? g.cycleTypeCode) : null;
  }, [grades, grade]);

  function entryWeight(e) {
    return STEEL_DENSITY * num(e.width) * num(e.length) * num(e.thickness) * num(e.qty);
  }
  const entryReady = (e) => num(e.length) > 0 && num(e.width) > 0 && num(e.thickness) > 0 && num(e.qty) > 0;
  const totalBars = entries.reduce((s, e) => s + num(e.qty), 0);
  const totalWeight = entries.reduce((s, e) => s + entryWeight(e), 0);

  const setEntry = (i, k, v) => setEntries((es) => es.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  const addEntry = () => setEntries((es) => [...es, { length: '', width: '', thickness: '', qty: '' }]);
  const removeEntry = (i) => setEntries((es) => (es.length > 1 ? es.filter((_, j) => j !== i) : es));

  function resolveSupplier() { return supplier === ADD_NEW ? newSupplier.trim() : supplier.trim(); }

  async function submit(e) {
    e.preventDefault();
    setError(null); setSuccess(null);
    const sup = resolveSupplier();
    if (!sup) return setError('Supplier is required.');
    if (!heatNumber.trim()) return setError('Heat number is required.');
    if (!grade) return setError('Grade is required — it determines the cycle type.');
    const valid = entries.filter(entryReady);
    if (!valid.length) return setError('Add at least one bar entry with length, width, thickness and quantity.');

    setBusy(true);
    try {
      await faridabadApi.createIntake({
        materialType: 'alloy_steel',
        supplier: sup,
        newSupplier: supplier === ADD_NEW ? sup : undefined,
        heatNumber: heatNumber.trim(),
        grade,
        dateReceived,
        poReference: poReference.trim() || undefined,
        notes: notes.trim() || undefined,
        entries: valid.map((en) => ({
          length_mm: num(en.length),
          width_mm: num(en.width),
          thickness_mm: num(en.thickness),
          quantity: num(en.qty),
        })),
      });
      setSuccess(`Intake recorded · heat ${heatNumber.trim()} · ${totalBars} bars, ${totalWeight.toFixed(1)} kg.`);
      setHeatNumber(''); setPoReference(''); setNotes('');
      setEntries([{ length: '', width: '', thickness: '', qty: '' }]);
      logRef.refetch();
    } catch (err) {
      setError(err.message || 'Could not save the intake.');
    } finally {
      setBusy(false);
    }
  }

  if (!canCreate) {
    return <div className="card" style={{ padding: 20 }}><div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY }}>Recording intake requires a supervisor, manager or admin role.</div></div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(460px, 1fr) minmax(320px, 380px)', gap: 16, alignItems: 'start' }}>
      <form onSubmit={submit} className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 13 }}>
        <SectionTitle>Alloy Steel Intake</SectionTitle>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <SupplierField suppliers={suppliers} value={supplier} newValue={newSupplier} onValue={setSupplier} onNewValue={setNewSupplier} />
          <div>
            <label className="form-label">Heat number *</label>
            <input className="form-input" placeholder="from material test certificate" value={heatNumber} onChange={(e) => setHeatNumber(e.target.value)} autoComplete="off" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <div>
            <label className="form-label">Date received *</label>
            <input className="form-input" type="date" value={dateReceived} onChange={(e) => setDateReceived(e.target.value)} />
          </div>
          <div>
            <label className="form-label">PO reference (optional)</label>
            <input className="form-input" placeholder="links to Odoo PO" value={poReference} onChange={(e) => setPoReference(e.target.value)} autoComplete="off" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 11, alignItems: 'end' }}>
          <div>
            <label className="form-label">Grade *</label>
            <select className="form-select" value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">Select grade…</option>
              {grades.map((g) => {
                const gv = g.alloy_grade ?? g.alloyGrade;
                return <option key={g.id ?? gv} value={gv}>{gv}</option>;
              })}
            </select>
          </div>
          <div style={{ paddingBottom: 6 }}>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: T_MUTED, marginBottom: 5 }}>Cycle type</div>
            <ReadonlyBadge>{cycleCode || '—'}</ReadonlyBadge>
          </div>
        </div>
        {grade && !cycleCode && (
          <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--status-warning, #d97a2b)', marginTop: -6 }}>
            No cycle-type mapping for this grade — add it under Master Lists · Grades.
          </div>
        )}

        {/* BAR ENTRIES — every dimension entered per bar */}
        <div>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: T_MUTED, marginBottom: 6 }}>Bar entries</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={ENTRY_TH}>Length (mm)</th><th style={ENTRY_TH}>Width (mm)</th><th style={ENTRY_TH}>Thickness (mm)</th>
                <th style={ENTRY_TH}>Qty</th><th style={{ ...ENTRY_TH, textAlign: 'right' }}>Weight</th><th style={ENTRY_TH} />
              </tr>
            </thead>
            <tbody>
              {entries.map((en, i) => (
                <tr key={i}>
                  <td style={{ ...ENTRY_TD, width: 96 }}>
                    <input className="form-input" style={{ height: 34 }} type="number" min="0" step="any" placeholder="length" value={en.length} onChange={(e) => setEntry(i, 'length', e.target.value)} />
                  </td>
                  <td style={{ ...ENTRY_TD, width: 84 }}>
                    <input className="form-input" style={{ height: 34 }} type="number" min="0" step="any" placeholder="width" value={en.width} onChange={(e) => setEntry(i, 'width', e.target.value)} />
                  </td>
                  <td style={{ ...ENTRY_TD, width: 96 }}>
                    <input className="form-input" style={{ height: 34 }} type="number" min="0" step="any" placeholder="thick" value={en.thickness} onChange={(e) => setEntry(i, 'thickness', e.target.value)} />
                  </td>
                  <td style={{ ...ENTRY_TD, width: 70 }}>
                    <input className="form-input" style={{ height: 34 }} type="number" min="0" step="1" placeholder="qty" value={en.qty} onChange={(e) => setEntry(i, 'qty', e.target.value)} />
                  </td>
                  <td style={{ ...ENTRY_TD, textAlign: 'right', fontFamily: MONO, fontSize: 12, color: T_PRIMARY, whiteSpace: 'nowrap' }}>
                    {entryReady(en) ? `${entryWeight(en).toFixed(1)} kg` : '—'}
                  </td>
                  <td style={{ ...ENTRY_TD, width: 30, textAlign: 'right' }}>
                    {entries.length > 1 && (
                      <button type="button" className="btn btn-sm" onClick={() => removeEntry(i)} aria-label="Remove entry" style={{ padding: '4px 7px' }}>
                        <Icon name="close" size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-sm" onClick={addEntry} style={{ marginTop: 8 }}>
            <Icon name="plus" size={13} /> Add bar
          </button>
        </div>

        <div style={{ display: 'flex', gap: 24, padding: '10px 12px', background: 'var(--bg-muted, #f4f7f2)', borderRadius: 9 }}>
          <div><div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: T_MUTED }}>Total bars</div><div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: T_PRIMARY }}>{totalBars}</div></div>
          <div><div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: T_MUTED }}>Total weight</div><div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: T_PRIMARY }}>{totalWeight.toFixed(1)} kg</div></div>
        </div>

        <div>
          <label className="form-label">Notes (optional)</label>
          <textarea className="form-input" style={{ height: 52, padding: '8px 13px', resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error ? <ErrorBanner message={error} /> : null}
        {success ? <SuccessBanner message={success} /> : null}
        <button type="submit" className="btn btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>{busy ? 'Saving…' : 'Save Intake'}</button>
      </form>

      <IntakeLog rows={log} material="alloy_steel" />
    </div>
  );
}

/* ── MS Sheet Intake ───────────────────────────────────────────────────── */
function MsIntakeTab({ canCreate }) {
  const suppliersRef = usePolling(() => masterApi.suppliers().then((r) => r.data).catch(() => []), []);
  const sheetRef = usePolling(() => masterApi.sheetHeights().then((r) => r.data).catch(() => []), []);
  const logRef = usePolling(() => faridabadApi.intakes({ material_type: 'ms' }).then((r) => r.data), []);

  const suppliers = asList(suppliersRef.data).filter((s) => (s.status ?? 'active') !== 'archived');
  const sheets = asList(sheetRef.data).filter((s) => (s.status ?? 'active') !== 'archived');
  const log = asList(logRef.data);

  const [supplier, setSupplier] = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  const [heatNumber, setHeatNumber] = useState('');
  const [dateReceived, setDateReceived] = useState(todayISO);
  const [poReference, setPoReference] = useState('');
  // MS sheet length & width are input per delivery; only the height (thickness)
  // is a fixed standard pulled from the Master List. Offer the distinct heights.
  const heightStandards = useMemo(() => {
    const seen = new Map();
    for (const s of sheets) { const h = num(s.height_mm ?? s.heightMm); if (h && !seen.has(h)) seen.set(h, h); }
    return [...seen.keys()].sort((a, b) => a - b);
  }, [sheets]);
  const defaultHeight = heightStandards.length === 1 ? String(heightStandards[0]) : '';

  const [entries, setEntries] = useState([{ height: defaultHeight, length: '', width: '', qty: '' }]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // once the single-height standard loads, pre-fill any blank height cells
  useEffect(() => {
    if (defaultHeight) setEntries((es) => es.map((e) => (e.height ? e : { ...e, height: defaultHeight })));
  }, [defaultHeight]);

  function entryWeight(e) { return STEEL_DENSITY * num(e.width) * num(e.length) * num(e.height) * num(e.qty); }
  const totalSheets = entries.reduce((s, e) => s + num(e.qty), 0);
  const totalWeight = entries.reduce((s, e) => s + entryWeight(e), 0);

  const setEntry = (i, k, v) => setEntries((es) => es.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  const addEntry = () => setEntries((es) => [...es, { height: defaultHeight, length: '', width: '', qty: '' }]);
  const removeEntry = (i) => setEntries((es) => (es.length > 1 ? es.filter((_, j) => j !== i) : es));
  function resolveSupplier() { return supplier === ADD_NEW ? newSupplier.trim() : supplier.trim(); }

  async function submit(e) {
    e.preventDefault();
    setError(null); setSuccess(null);
    const sup = resolveSupplier();
    if (!sup) return setError('Supplier is required.');
    if (!heatNumber.trim()) return setError('Heat number is required.');
    const valid = entries.filter((en) => num(en.height) > 0 && num(en.length) > 0 && num(en.width) > 0 && num(en.qty) > 0);
    if (!valid.length) return setError('Add at least one sheet entry with length, width and quantity.');

    setBusy(true);
    try {
      await faridabadApi.createIntake({
        materialType: 'ms',
        supplier: sup,
        newSupplier: supplier === ADD_NEW ? sup : undefined,
        heatNumber: heatNumber.trim(),
        dateReceived,
        poReference: poReference.trim() || undefined,
        notes: notes.trim() || undefined,
        entries: valid.map((en) => ({ length_mm: num(en.length), width_mm: num(en.width), height_mm: num(en.height), quantity: num(en.qty) })),
      });
      setSuccess(`Intake recorded · heat ${heatNumber.trim()} · ${totalSheets} sheets, ${totalWeight.toFixed(1)} kg.`);
      setHeatNumber(''); setPoReference(''); setNotes('');
      setEntries([{ height: defaultHeight, length: '', width: '', qty: '' }]);
      logRef.refetch();
    } catch (err) {
      setError(err.message || 'Could not save the intake.');
    } finally {
      setBusy(false);
    }
  }

  if (!canCreate) {
    return <div className="card" style={{ padding: 20 }}><div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY }}>Recording intake requires a supervisor, manager or admin role.</div></div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(460px, 1fr) minmax(320px, 380px)', gap: 16, alignItems: 'start' }}>
      <form onSubmit={submit} className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 13 }}>
        <SectionTitle>MS Sheet Intake</SectionTitle>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <SupplierField suppliers={suppliers} value={supplier} newValue={newSupplier} onValue={setSupplier} onNewValue={setNewSupplier} />
          <div>
            <label className="form-label">Heat number *</label>
            <input className="form-input" placeholder="from material test certificate" value={heatNumber} onChange={(e) => setHeatNumber(e.target.value)} autoComplete="off" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <div>
            <label className="form-label">Date received *</label>
            <input className="form-input" type="date" value={dateReceived} onChange={(e) => setDateReceived(e.target.value)} />
          </div>
          <div>
            <label className="form-label">PO reference (optional)</label>
            <input className="form-input" placeholder="links to Odoo PO" value={poReference} onChange={(e) => setPoReference(e.target.value)} autoComplete="off" />
          </div>
        </div>

        {/* SHEET ENTRIES */}
        <div>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: T_MUTED, marginBottom: 6 }}>Sheet entries</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={ENTRY_TH}>Length (mm)</th><th style={ENTRY_TH}>Width (mm)</th>
                <th style={ENTRY_TH}>Height</th><th style={ENTRY_TH}>Qty</th>
                <th style={{ ...ENTRY_TH, textAlign: 'right' }}>Weight</th><th style={ENTRY_TH} />
              </tr>
            </thead>
            <tbody>
              {entries.map((en, i) => {
                const ready = num(en.height) > 0 && num(en.length) > 0 && num(en.width) > 0 && num(en.qty) > 0;
                return (
                  <tr key={i}>
                    <td style={{ ...ENTRY_TD, width: 90 }}>
                      <input className="form-input" style={{ height: 34 }} type="number" min="0" step="any" placeholder="length" value={en.length} onChange={(e) => setEntry(i, 'length', e.target.value)} />
                    </td>
                    <td style={{ ...ENTRY_TD, width: 90 }}>
                      <input className="form-input" style={{ height: 34 }} type="number" min="0" step="any" placeholder="width" value={en.width} onChange={(e) => setEntry(i, 'width', e.target.value)} />
                    </td>
                    <td style={{ ...ENTRY_TD, width: 96 }}>
                      <select className="form-select" style={{ height: 34 }} value={en.height} onChange={(e) => setEntry(i, 'height', e.target.value)}>
                        <option value="">height…</option>
                        {heightStandards.map((h) => <option key={h} value={h}>{h}mm</option>)}
                      </select>
                    </td>
                    <td style={{ ...ENTRY_TD, width: 70 }}>
                      <input className="form-input" style={{ height: 34 }} type="number" min="0" step="1" placeholder="qty" value={en.qty} onChange={(e) => setEntry(i, 'qty', e.target.value)} />
                    </td>
                    <td style={{ ...ENTRY_TD, textAlign: 'right', fontFamily: MONO, fontSize: 12, color: T_PRIMARY, whiteSpace: 'nowrap' }}>
                      {ready ? `${entryWeight(en).toFixed(1)} kg` : '—'}
                    </td>
                    <td style={{ ...ENTRY_TD, width: 30, textAlign: 'right' }}>
                      {entries.length > 1 && (
                        <button type="button" className="btn btn-sm" onClick={() => removeEntry(i)} aria-label="Remove entry" style={{ padding: '4px 7px' }}>
                          <Icon name="close" size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ fontFamily: SANS, fontSize: 10.5, color: T_MUTED, marginTop: 6 }}>
            Length &amp; width are entered per delivery; height/thickness is the fixed standard from Master Lists.
          </div>
          <button type="button" className="btn btn-sm" onClick={addEntry} style={{ marginTop: 8 }}>
            <Icon name="plus" size={13} /> Add sheet size
          </button>
          {!sheets.length && (
            <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--status-warning, #d97a2b)', marginTop: 6 }}>
              No sheet height standards configured — an admin must add them under Master Lists · MS Sheet Height.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 24, padding: '10px 12px', background: 'var(--bg-muted, #f4f7f2)', borderRadius: 9 }}>
          <div><div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: T_MUTED }}>Total sheets</div><div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: T_PRIMARY }}>{totalSheets}</div></div>
          <div><div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: T_MUTED }}>Total weight</div><div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: T_PRIMARY }}>{totalWeight.toFixed(1)} kg</div></div>
        </div>

        <div>
          <label className="form-label">Notes (optional)</label>
          <textarea className="form-input" style={{ height: 52, padding: '8px 13px', resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error ? <ErrorBanner message={error} /> : null}
        {success ? <SuccessBanner message={success} /> : null}
        <button type="submit" className="btn btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>{busy ? 'Saving…' : 'Save Intake'}</button>
      </form>

      <IntakeLog rows={log} material="ms" />
    </div>
  );
}

/* ── recent-intake log (right column) ──────────────────────────────────── */
function IntakeLog({ rows, material }) {
  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <SectionTitle right={<span className="badge" style={{ background: 'var(--bg-soft-blue, #eaf0f7)', color: T_PRIMARY }}>{rows.length}</span>}>Recent Intakes</SectionTitle>
      {!rows.length ? (
        <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, padding: '8px 0' }}>No {material === 'ms' ? 'MS sheet' : 'alloy steel'} intakes recorded yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.slice(0, 30).map((r) => {
            const entries = Array.isArray(r.entries) ? r.entries : [];
            return (
              <div key={r.id} style={{ padding: '9px 11px', border: '1px solid var(--border-input, #d6e0d2)', borderRadius: 9 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: T_PRIMARY }}>{r.heat_number || r.heatNumber}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: T_SECONDARY }}>{(r.date_received || r.dateReceived || '').slice(0, 10)}</span>
                </div>
                <div style={{ fontFamily: SANS, fontSize: 11.5, color: T_SECONDARY, marginTop: 3 }}>
                  {r.supplier_name || r.supplier || '—'} · {r.bar_count ?? r.barCount ?? '—'} pcs · {Number(r.weight_kg ?? r.weightKg ?? 0).toFixed(1)} kg
                  {entries.length ? ` · ${entries.length} size${entries.length === 1 ? '' : 's'}` : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── page ──────────────────────────────────────────────────────────────── */
export default function ReceivingIntake() {
  const { location } = useApp();
  const { isSupervisor, isManager, isAdmin } = useAuth();
  const canCreate = isSupervisor || isManager || isAdmin;

  // Faridabad logs raw-material intake; Dharmapuri receives rolling batches.
  // "both" (admin cross-location) shows every tab.
  const showIntake = location !== 'dharmapuri';
  const showReceiving = location !== 'faridabad';

  const TABS = [
    showIntake && { key: 'alloy', label: 'Alloy Steel Intake' },
    showIntake && { key: 'ms', label: 'MS Sheet Intake' },
    showReceiving && { key: 'receiving', label: 'Receiving Events' },
  ].filter(Boolean);

  const [active, setActive] = useState(TABS[0]?.key);
  // If the location toggle changed the available tabs, keep the active one valid.
  const activeKey = TABS.some((t) => t.key === active) ? active : TABS[0]?.key;

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="inbox" size={20} color={T_PRIMARY} />
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: T_PRIMARY }}>Receiving &amp; Intake</div>
        <LocationBadge location={location === 'faridabad' ? 'faridabad' : 'dharmapuri'} />
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, marginTop: 4 }}>
        {showIntake && showReceiving ? 'Log incoming alloy steel & MS sheet at Faridabad and receive rolling batches at Dharmapuri.'
          : showIntake ? 'Log incoming alloy steel and MS sheet deliveries from suppliers.'
            : 'Receive rolled composite blocks arriving from Faridabad.'}
      </div>

      {/* Tab strip */}
      <div style={{ display: 'flex', gap: 6, marginTop: 18, marginBottom: 18, borderBottom: '1px solid var(--border-card, #e3ebde)' }}>
        {TABS.map((t) => {
          const on = t.key === activeKey;
          return (
            <button key={t.key} onClick={() => setActive(t.key)} style={{
              border: 'none', background: 'none', cursor: 'pointer', padding: '9px 14px',
              fontFamily: SANS, fontSize: 13, fontWeight: on ? 700 : 500,
              color: on ? T_PRIMARY : T_SECONDARY,
              borderBottom: on ? '2px solid var(--status-blue, #2d6fb5)' : '2px solid transparent',
              marginBottom: -1,
            }}>{t.label}</button>
          );
        })}
      </div>

      {activeKey === 'alloy' && <AlloyIntakeTab canCreate={canCreate} />}
      {activeKey === 'ms' && <MsIntakeTab canCreate={canCreate} />}
      {activeKey === 'receiving' && <Receiving embedded />}
    </div>
  );
}
