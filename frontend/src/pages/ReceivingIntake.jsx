import { useState, useMemo } from 'react';
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
  const profilesRef = usePolling(() => masterApi.barProfiles().then((r) => r.data).catch(() => []), []);
  const lengthsRef = usePolling(() => masterApi.barLengths().then((r) => r.data).catch(() => []), []);
  const logRef = usePolling(() => faridabadApi.intakes({ material_type: 'alloy_steel' }).then((r) => r.data), []);

  const suppliers = asList(suppliersRef.data).filter((s) => (s.status ?? 'active') !== 'archived');
  const grades = asList(gradesRef.data).filter((g) => (g.status ?? 'active') !== 'archived');
  const profiles = asList(profilesRef.data).filter((p) => (p.status ?? 'active') !== 'archived');
  const lengths = asList(lengthsRef.data).filter((l) => (l.status ?? 'active') !== 'archived');
  const log = asList(logRef.data);

  const [supplier, setSupplier] = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  const [heatNumber, setHeatNumber] = useState('');
  const [dateReceived, setDateReceived] = useState(todayISO);
  const [poReference, setPoReference] = useState('');
  const [grade, setGrade] = useState('');
  const [profileId, setProfileId] = useState('');
  const [entries, setEntries] = useState([{ lengthId: '', qty: '' }]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const cycleCode = useMemo(() => {
    const g = grades.find((x) => (x.alloy_grade ?? x.alloyGrade) === grade);
    return g ? (g.cycle_type_code ?? g.cycleTypeCode) : null;
  }, [grades, grade]);

  const profile = useMemo(() => profiles.find((p) => String(p.id) === String(profileId)) || null, [profiles, profileId]);
  const width = profile ? num(profile.width_mm ?? profile.widthMm) : 0;
  const thickness = profile ? num(profile.thickness_mm ?? profile.thicknessMm) : 0;

  function lengthMmOf(lengthId) {
    const l = lengths.find((x) => String(x.id) === String(lengthId));
    return l ? num(l.length_mm ?? l.lengthMm) : 0;
  }
  function entryWeight(e) {
    return STEEL_DENSITY * width * lengthMmOf(e.lengthId) * thickness * num(e.qty);
  }
  const totalBars = entries.reduce((s, e) => s + num(e.qty), 0);
  const totalWeight = entries.reduce((s, e) => s + entryWeight(e), 0);

  const setEntry = (i, k, v) => setEntries((es) => es.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  const addEntry = () => setEntries((es) => [...es, { lengthId: '', qty: '' }]);
  const removeEntry = (i) => setEntries((es) => (es.length > 1 ? es.filter((_, j) => j !== i) : es));

  function resolveSupplier() { return supplier === ADD_NEW ? newSupplier.trim() : supplier.trim(); }

  async function submit(e) {
    e.preventDefault();
    setError(null); setSuccess(null);
    const sup = resolveSupplier();
    if (!sup) return setError('Supplier is required.');
    if (!heatNumber.trim()) return setError('Heat number is required.');
    if (!grade) return setError('Grade is required — it determines the cycle type.');
    if (!profileId) return setError('Bar profile is required.');
    const valid = entries.filter((en) => en.lengthId && num(en.qty) > 0);
    if (!valid.length) return setError('Add at least one bar entry with a length and quantity.');

    setBusy(true);
    try {
      await faridabadApi.createIntake({
        materialType: 'alloy_steel',
        supplier: sup,
        newSupplier: supplier === ADD_NEW ? sup : undefined,
        heatNumber: heatNumber.trim(),
        grade,
        profileId: Number(profileId),
        dateReceived,
        poReference: poReference.trim() || undefined,
        notes: notes.trim() || undefined,
        entries: valid.map((en) => ({
          length_mm: lengthMmOf(en.lengthId),
          width_mm: width,
          thickness_mm: thickness,
          quantity: num(en.qty),
        })),
      });
      setSuccess(`Intake recorded · heat ${heatNumber.trim()} · ${totalBars} bars, ${totalWeight.toFixed(1)} kg.`);
      setHeatNumber(''); setPoReference(''); setNotes('');
      setEntries([{ lengthId: '', qty: '' }]);
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

        <div>
          <label className="form-label">Bar profile *</label>
          <select className="form-select" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            <option value="">Select a profile from Master Lists…</option>
            {profiles.map((p) => {
              const w = p.width_mm ?? p.widthMm; const t = p.thickness_mm ?? p.thicknessMm;
              return <option key={p.id} value={p.id}>{p.label || `${w}mm × ${t}mm`}</option>;
            })}
          </select>
          {profile && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: T_SECONDARY, marginTop: 6 }}>
              Width: {width}mm · Thickness: {thickness}mm <span style={{ color: T_MUTED }}>(read-only, from Master List)</span>
            </div>
          )}
          {!profiles.length && (
            <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--status-warning, #d97a2b)', marginTop: 6 }}>
              No bar profiles configured — an admin must add one under Master Lists · Bar Profiles.
            </div>
          )}
        </div>

        {/* BAR ENTRIES */}
        <div>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: T_MUTED, marginBottom: 6 }}>Bar entries</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={ENTRY_TH}>Length</th><th style={ENTRY_TH}>Quantity</th><th style={{ ...ENTRY_TH, textAlign: 'right' }}>Weight</th><th style={ENTRY_TH} /></tr>
            </thead>
            <tbody>
              {entries.map((en, i) => (
                <tr key={i}>
                  <td style={ENTRY_TD}>
                    <select className="form-select" style={{ height: 34 }} value={en.lengthId} onChange={(e) => setEntry(i, 'lengthId', e.target.value)}>
                      <option value="">Length…</option>
                      {lengths.map((l) => <option key={l.id} value={l.id}>{l.label || `${l.length_mm ?? l.lengthMm}mm`}</option>)}
                    </select>
                  </td>
                  <td style={{ ...ENTRY_TD, width: 90 }}>
                    <input className="form-input" style={{ height: 34 }} type="number" min="0" step="1" placeholder="qty" value={en.qty} onChange={(e) => setEntry(i, 'qty', e.target.value)} />
                  </td>
                  <td style={{ ...ENTRY_TD, textAlign: 'right', fontFamily: MONO, fontSize: 12, color: T_PRIMARY, whiteSpace: 'nowrap' }}>
                    {(profile && en.lengthId && num(en.qty) > 0) ? `${entryWeight(en).toFixed(1)} kg` : '—'}
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
            <Icon name="plus" size={13} /> Add length
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
  const sheetRef = usePolling(() => masterApi.sheetSizes().then((r) => r.data).catch(() => []), []);
  const logRef = usePolling(() => faridabadApi.intakes({ material_type: 'ms' }).then((r) => r.data), []);

  const suppliers = asList(suppliersRef.data).filter((s) => (s.status ?? 'active') !== 'archived');
  const sheets = asList(sheetRef.data).filter((s) => (s.status ?? 'active') !== 'archived');
  const log = asList(logRef.data);

  const [supplier, setSupplier] = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  const [heatNumber, setHeatNumber] = useState('');
  const [dateReceived, setDateReceived] = useState(todayISO);
  const [poReference, setPoReference] = useState('');
  const [entries, setEntries] = useState([{ sheetId: '', qty: '' }]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  function sheetOf(id) { return sheets.find((s) => String(s.id) === String(id)) || null; }
  function dims(id) {
    const s = sheetOf(id);
    return s ? { l: num(s.length_mm ?? s.lengthMm), w: num(s.width_mm ?? s.widthMm), h: num(s.height_mm ?? s.heightMm) } : { l: 0, w: 0, h: 0 };
  }
  function entryWeight(e) { const d = dims(e.sheetId); return STEEL_DENSITY * d.w * d.l * d.h * num(e.qty); }
  const totalSheets = entries.reduce((s, e) => s + num(e.qty), 0);
  const totalWeight = entries.reduce((s, e) => s + entryWeight(e), 0);

  const setEntry = (i, k, v) => setEntries((es) => es.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  const addEntry = () => setEntries((es) => [...es, { sheetId: '', qty: '' }]);
  const removeEntry = (i) => setEntries((es) => (es.length > 1 ? es.filter((_, j) => j !== i) : es));
  function resolveSupplier() { return supplier === ADD_NEW ? newSupplier.trim() : supplier.trim(); }

  async function submit(e) {
    e.preventDefault();
    setError(null); setSuccess(null);
    const sup = resolveSupplier();
    if (!sup) return setError('Supplier is required.');
    if (!heatNumber.trim()) return setError('Heat number is required.');
    const valid = entries.filter((en) => en.sheetId && num(en.qty) > 0);
    if (!valid.length) return setError('Add at least one sheet entry with a size and quantity.');

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
        entries: valid.map((en) => { const d = dims(en.sheetId); return { length_mm: d.l, width_mm: d.w, height_mm: d.h, quantity: num(en.qty) }; }),
      });
      setSuccess(`Intake recorded · heat ${heatNumber.trim()} · ${totalSheets} sheets, ${totalWeight.toFixed(1)} kg.`);
      setHeatNumber(''); setPoReference(''); setNotes('');
      setEntries([{ sheetId: '', qty: '' }]);
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
              <tr><th style={ENTRY_TH}>Sheet size (L × W × H)</th><th style={ENTRY_TH}>Qty</th><th style={{ ...ENTRY_TH, textAlign: 'right' }}>Weight</th><th style={ENTRY_TH} /></tr>
            </thead>
            <tbody>
              {entries.map((en, i) => {
                const d = dims(en.sheetId);
                return (
                  <tr key={i}>
                    <td style={ENTRY_TD}>
                      <select className="form-select" style={{ height: 34 }} value={en.sheetId} onChange={(e) => setEntry(i, 'sheetId', e.target.value)}>
                        <option value="">Sheet size…</option>
                        {sheets.map((s) => <option key={s.id} value={s.id}>{s.label || `${s.length_mm ?? s.lengthMm} × ${s.width_mm ?? s.widthMm} × ${s.height_mm ?? s.heightMm}`}</option>)}
                      </select>
                      {en.sheetId ? <div style={{ fontFamily: MONO, fontSize: 10, color: T_MUTED, marginTop: 3 }}>height {d.h}mm (from Master List)</div> : null}
                    </td>
                    <td style={{ ...ENTRY_TD, width: 80 }}>
                      <input className="form-input" style={{ height: 34 }} type="number" min="0" step="1" placeholder="qty" value={en.qty} onChange={(e) => setEntry(i, 'qty', e.target.value)} />
                    </td>
                    <td style={{ ...ENTRY_TD, textAlign: 'right', fontFamily: MONO, fontSize: 12, color: T_PRIMARY, whiteSpace: 'nowrap' }}>
                      {(en.sheetId && num(en.qty) > 0) ? `${entryWeight(en).toFixed(1)} kg` : '—'}
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
          <button type="button" className="btn btn-sm" onClick={addEntry} style={{ marginTop: 8 }}>
            <Icon name="plus" size={13} /> Add sheet size
          </button>
          {!sheets.length && (
            <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--status-warning, #d97a2b)', marginTop: 6 }}>
              No sheet sizes configured — an admin must add them under Master Lists · Sheet Sizes.
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
