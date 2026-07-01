import { useState, useMemo } from 'react';
import { usePolling } from '../hooks/usePolling';
import { faridabadApi, masterApi } from '../api/resources';
import { useAuth } from '../store/AuthContext';
import { StatusPill, LocationBadge } from '../components/common/Badges';
import Icon from '../components/common/Icon';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

const MATERIAL_TYPES = [
  { value: 'alloy_steel', label: 'Alloy Steel' },
  { value: 'ms', label: 'MS' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'available', label: 'Available' },
  { value: 'in_joining', label: 'In joining' },
  { value: 'used', label: 'Used' },
  { value: 'archived', label: 'Archived' },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function materialLabel(v) {
  const m = MATERIAL_TYPES.find((t) => t.value === v || t.label === v);
  if (m) return m.label;
  if (v === 'alloy' || v === 'alloy_steel') return 'Alloy Steel';
  return v || '—';
}

/* Length × width label, falling back to the legacy free-text dimensions field. */
function geomLabel(row) {
  const l = row.lengthMm ?? row.length_mm;
  const w = row.widthMm ?? row.width_mm;
  if (l != null && w != null) return `${l} × ${w}`;
  if (l != null) return `${l} × —`;
  if (w != null) return `— × ${w}`;
  return row.dimensions || row.dimension || row.dimensions_mm || '—';
}

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
}

function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
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

const ADD_NEW = '__add_new__';

const emptyForm = () => ({
  materialType: 'alloy_steel',
  supplier: '',
  newSupplier: '',
  heatNumber: '',
  steelGrade: '',
  weightKg: '',
  barCount: '',
  lengthMm: '',
  widthMm: '',
  dateReceived: todayISO(),
  poReference: '',
  notes: '',
  certName: '',
});

function IntakeForm({ suppliers, suppliersError, canCreate, onCreated }) {
  const { user } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const usingNewSupplier = form.supplier === ADD_NEW;

  function resolveSupplier() {
    if (usingNewSupplier) return form.newSupplier.trim();
    return form.supplier.trim();
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const supplier = resolveSupplier();
    if (!form.materialType) return setError('Material type is required.');
    if (!supplier) return setError('Supplier is required.');
    if (!form.heatNumber.trim()) return setError('Heat number is required (from the material test certificate).');
    if (!form.steelGrade.trim()) return setError('Steel grade is required.');
    if (form.weightKg === '' || Number(form.weightKg) <= 0) return setError('Weight received (kg) is required and must be greater than 0.');
    if (form.barCount === '' || Number(form.barCount) <= 0) return setError(`Number of ${form.materialType === 'ms' ? 'sheets/plates' : 'bars'} received is required.`);
    // MS arrives as plates — length + width are needed to estimate block yield later.
    if (form.materialType === 'ms') {
      if (form.lengthMm === '' || Number(form.lengthMm) <= 0) return setError('Sheet length (mm) is required for MS so block yield can be estimated.');
      if (form.widthMm === '' || Number(form.widthMm) <= 0) return setError('Sheet width (mm) is required for MS so block yield can be estimated.');
    }
    if (!form.dateReceived) return setError('Date received is required.');

    setBusy(true);
    try {
      await faridabadApi.createIntake({
        materialType: form.materialType,
        supplier,
        newSupplier: usingNewSupplier ? supplier : undefined,
        heatNumber: form.heatNumber.trim(),
        steelGrade: form.steelGrade.trim(),
        weightKg: Number(form.weightKg),
        barCount: Number(form.barCount),
        lengthMm: form.lengthMm !== '' ? Number(form.lengthMm) : undefined,
        widthMm: form.widthMm !== '' ? Number(form.widthMm) : undefined,
        dateReceived: form.dateReceived,
        poReference: form.poReference.trim() || undefined,
        notes: form.notes.trim() || undefined,
        certificateName: form.certName || undefined,
        recordedBy: user?.username || user?.name || undefined,
      });
      setSuccess(`Intake recorded · heat ${form.heatNumber.trim()} (${materialLabel(form.materialType)}).`);
      setForm(emptyForm());
      onCreated && onCreated();
    } catch (err) {
      setError(err.message || 'Could not save intake record.');
    } finally {
      setBusy(false);
    }
  }

  if (!canCreate) {
    return <Empty>Recording intake requires a Faridabad operator, supervisor, manager or admin role. The intake log below is read-only for your role.</Empty>;
  }

  const supplierList = Array.isArray(suppliers) ? suppliers : [];

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
        <div>
          <label className="form-label">Material type *</label>
          <select className="form-select" value={form.materialType} onChange={set('materialType')}>
            {MATERIAL_TYPES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">Supplier *</label>
          <select className="form-select" value={form.supplier} onChange={set('supplier')}>
            <option value="">Select supplier…</option>
            {supplierList.map((s) => {
              const val = s.name || s.supplierName || s.id || s;
              const id = s.id ?? val;
              return <option key={id} value={val}>{val}</option>;
            })}
            <option value={ADD_NEW}>+ Add new supplier…</option>
          </select>
          {suppliersError ? (
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--status-warning, #d97a2b)', marginTop: 5 }}>
              Supplier list unavailable — type a new supplier below.
            </div>
          ) : null}
        </div>
      </div>

      {(usingNewSupplier || suppliersError) && (
        <div>
          <label className="form-label">New supplier name {usingNewSupplier ? '*' : ''}</label>
          <input className="form-input" placeholder="supplier name" value={form.newSupplier} onChange={set('newSupplier')} autoComplete="off" />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
        <div>
          <label className="form-label">Heat number *</label>
          <input className="form-input" placeholder="from material test certificate" value={form.heatNumber} onChange={set('heatNumber')} autoComplete="off" />
        </div>
        <div>
          <label className="form-label">Steel grade *</label>
          <input className="form-input" placeholder="e.g. EN8, SAE 1018" value={form.steelGrade} onChange={set('steelGrade')} autoComplete="off" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 11 }}>
        <div>
          <label className="form-label">Weight received (kg) *</label>
          <input className="form-input" type="number" step="any" min="0" placeholder="kg" value={form.weightKg} onChange={set('weightKg')} />
        </div>
        <div>
          <label className="form-label">{form.materialType === 'ms' ? 'No. of sheets *' : 'No. of bars *'}</label>
          <input className="form-input" type="number" step="1" min="0" placeholder="count" value={form.barCount} onChange={set('barCount')} />
        </div>
        <div>
          <label className="form-label">Length (mm){form.materialType === 'ms' ? ' *' : ''}</label>
          <input className="form-input" type="number" step="any" min="0" placeholder="length" value={form.lengthMm} onChange={set('lengthMm')} />
        </div>
        <div>
          <label className="form-label">Width (mm){form.materialType === 'ms' ? ' *' : ''}</label>
          <input className="form-input" type="number" step="any" min="0" placeholder="width" value={form.widthMm} onChange={set('widthMm')} />
        </div>
      </div>
      {form.materialType === 'ms' && (
        <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-secondary, #5d7188)', marginTop: -4 }}>
          MS plates: record length × width so the floor can estimate block yield. The block length itself is chosen when MS Cutting starts.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
        <div>
          <label className="form-label">Date received *</label>
          <input className="form-input" type="date" value={form.dateReceived} onChange={set('dateReceived')} />
        </div>
        <div>
          <label className="form-label">PO reference (optional · Odoo)</label>
          <input className="form-input" placeholder="links to Odoo PO" value={form.poReference} onChange={set('poReference')} autoComplete="off" />
        </div>
      </div>

      <div>
        <label className="form-label">Notes (optional)</label>
        <textarea className="form-input" style={{ height: 56, padding: '8px 13px', resize: 'vertical' }} placeholder="optional notes" value={form.notes} onChange={set('notes')} />
      </div>

      <div>
        <label className="form-label">Material test certificate (optional, recommended)</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
            <Icon name="doc" size={14} />
            <span>{form.certName ? 'Change file' : 'Attach MTC'}</span>
            <input
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => setForm((f) => ({ ...f, certName: e.target.files?.[0]?.name || '' }))}
            />
          </label>
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted-2, #7d96bb)' }}>
            {form.certName || 'no file attached'}
          </span>
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      <button type="submit" className="btn btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>
        {busy ? 'Saving…' : 'Record Intake'}
      </button>
    </form>
  );
}

function DetailRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderTop: '1px solid #eef2ea' }}>
      <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>{label}</span>
      <span style={{ fontFamily: mono ? MONO : SANS, fontSize: 12.5, color: 'var(--text-primary, #15366a)', textAlign: 'right', maxWidth: '60%' }}>{value ?? '—'}</span>
    </div>
  );
}

function IntakeDetail({ row, onClose }) {
  const status = row.status || 'available';
  return (
    <div className="card cp-fade-in" style={{ padding: '16px 18px', background: 'var(--bg-muted-2, #f6f9f4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', color: 'var(--text-primary, #15366a)' }}>
            {materialLabel(row.materialType || row.material_type)} · {row.heatNumber || row.heat_number || '—'}
          </span>
          <StatusPill status={status} label={String(status).replace(/_/g, ' ')} />
        </div>
        <button className="btn btn-sm" onClick={onClose} aria-label="Close detail">
          <Icon name="close" size={14} />
        </button>
      </div>
      <DetailRow label="Supplier" value={row.supplier || row.supplierName || row.supplier_name} />
      <DetailRow label="Heat number" value={row.heatNumber || row.heat_number} mono />
      <DetailRow label="Steel grade" value={row.steelGrade || row.steel_grade} mono />
      <DetailRow label="Weight (kg)" value={row.weightKg ?? row.weight_kg ?? row.weight} mono />
      <DetailRow label="Count" value={row.barCount ?? row.bar_count ?? row.bars} mono />
      <DetailRow label="Size L × W (mm)" value={geomLabel(row)} mono />
      <DetailRow label="Date received" value={fmtDate(row.dateReceived || row.date_received || row.date)} mono />
      <DetailRow label="PO reference" value={row.poReference || row.po_reference} mono />
      <DetailRow label="Recorded by" value={row.recordedBy || row.recorded_by} />
      <DetailRow label="Certificate" value={row.certificateName || row.certificate_name} />
      <DetailRow label="Notes" value={row.notes} />
    </div>
  );
}

const TH = { padding: '6px 10px 8px 0', fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)', whiteSpace: 'nowrap' };
const TD = { padding: '9px 10px 9px 0', fontFamily: SANS, fontSize: 12.5, color: 'var(--text-primary, #15366a)', whiteSpace: 'nowrap' };

export default function RawMaterialIntake() {
  const { user, isOperator, isSupervisor, isManager, isAdmin } = useAuth();
  const canCreate = isOperator || isSupervisor || isManager || isAdmin;

  // ── Filters ──
  const [fMaterial, setFMaterial] = useState('');
  const [fSupplier, setFSupplier] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [selected, setSelected] = useState(null);

  const filters = useMemo(
    () => ({
      materialType: fMaterial || undefined,
      supplier: fSupplier || undefined,
      status: fStatus || undefined,
      from: fFrom || undefined,
      to: fTo || undefined,
    }),
    [fMaterial, fSupplier, fStatus, fFrom, fTo]
  );

  const filterKey = `${fMaterial}|${fSupplier}|${fStatus}|${fFrom}|${fTo}`;

  const { data: intakeData, error: intakeError, loading, refetch } = usePolling(
    () => faridabadApi.intakes(filters).then((r) => r),
    [filterKey]
  );

  const { data: suppliersData, error: suppliersError } = usePolling(
    () => masterApi.suppliers().then((r) => r.data),
    []
  );

  const rows = useMemo(() => {
    const d = intakeData?.data;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.items)) return d.items;
    if (Array.isArray(intakeData)) return intakeData;
    return [];
  }, [intakeData]);

  const meta = intakeData?.meta;
  const total = meta?.total ?? rows.length;

  const suppliers = Array.isArray(suppliersData) ? suppliersData : suppliersData?.items || [];

  function clearFilters() {
    setFMaterial('');
    setFSupplier('');
    setFStatus('');
    setFFrom('');
    setFTo('');
  }

  const anyFilter = fMaterial || fSupplier || fStatus || fFrom || fTo;

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
          Raw Material Intake
        </div>
        <LocationBadge location="faridabad" />
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
        Log incoming alloy steel and MS bar deliveries with full material traceability{loading ? ' · loading…' : ''}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 1fr) minmax(380px, 1fr)', gap: 16, marginTop: 20, alignItems: 'start' }}>
        {/* ── LEFT: New intake record form ── */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionTitle>New Intake Record</SectionTitle>
          <IntakeForm
            suppliers={suppliers}
            suppliersError={suppliersError}
            canCreate={canCreate}
            onCreated={refetch}
          />
        </div>

        {/* ── RIGHT: detail panel or guidance ── */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionTitle>Record Detail</SectionTitle>
          {selected ? (
            <IntakeDetail row={selected} onClose={() => setSelected(null)} />
          ) : (
            <Empty>Select a row in the intake log to view its full traceability detail. Intake records flow into the Joining Operation page.</Empty>
          )}
        </div>
      </div>

      {/* ── BOTTOM: Intake log ── */}
      <div className="card" style={{ marginTop: 16, padding: '18px 20px' }}>
        <SectionTitle
          right={
            <span className="badge" style={{ background: 'rgba(45,111,181,0.14)', color: 'var(--cycle-eat, #2d6fb5)' }}>
              {total} RECORD{total === 1 ? '' : 'S'}
            </span>
          }
        >
          Intake Log
        </SectionTitle>

        {/* Filters */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 11, alignItems: 'flex-end', marginBottom: 14 }}>
          <div style={{ minWidth: 150 }}>
            <label className="form-label">Material</label>
            <select className="form-select" style={{ height: 38 }} value={fMaterial} onChange={(e) => setFMaterial(e.target.value)}>
              <option value="">All materials</option>
              {MATERIAL_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 170 }}>
            <label className="form-label">Supplier</label>
            <select className="form-select" style={{ height: 38 }} value={fSupplier} onChange={(e) => setFSupplier(e.target.value)}>
              <option value="">All suppliers</option>
              {suppliers.map((s) => {
                const val = s.name || s.supplierName || s.id || s;
                return <option key={s.id ?? val} value={val}>{val}</option>;
              })}
            </select>
          </div>
          <div style={{ minWidth: 150 }}>
            <label className="form-label">Status</label>
            <select className="form-select" style={{ height: 38 }} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label className="form-label">From</label>
            <input className="form-input" style={{ height: 38 }} type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          </div>
          <div style={{ minWidth: 140 }}>
            <label className="form-label">To</label>
            <input className="form-input" style={{ height: 38 }} type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
          </div>
          {anyFilter ? (
            <button className="btn btn-sm" onClick={clearFilters}>Clear</button>
          ) : null}
        </div>

        {intakeError ? (
          <ErrorBanner message="Could not load the intake log. Retrying automatically…" />
        ) : loading && !intakeData ? (
          <Empty>Loading intake records…</Empty>
        ) : rows.length === 0 ? (
          <Empty>{anyFilter ? 'No intake records match these filters.' : 'No intake records yet. Use the form above to record the first delivery.'}</Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={TH}>Date</th>
                  <th style={TH}>Material</th>
                  <th style={TH}>Supplier</th>
                  <th style={TH}>Heat no.</th>
                  <th style={TH}>Grade</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Weight (kg)</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Count</th>
                  <th style={TH}>L × W (mm)</th>
                  <th style={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const id = r.id ?? r.intakeId ?? i;
                  const isSel = selected && (selected.id ?? selected.intakeId) === (r.id ?? r.intakeId) && selected.heatNumber === r.heatNumber;
                  const status = r.status || 'available';
                  return (
                    <tr
                      key={id}
                      onClick={() => setSelected(r)}
                      style={{ borderTop: '1px solid #eef2ea', cursor: 'pointer', background: isSel ? 'var(--bg-muted, #f4f7f2)' : 'transparent' }}
                    >
                      <td style={{ ...TD, fontFamily: MONO }}>{fmtDate(r.dateReceived || r.date_received || r.date)}</td>
                      <td style={TD}>{materialLabel(r.materialType || r.material_type)}</td>
                      <td style={TD}>{r.supplier || r.supplierName || r.supplier_name || '—'}</td>
                      <td style={{ ...TD, fontFamily: MONO }}>{r.heatNumber || r.heat_number || '—'}</td>
                      <td style={{ ...TD, fontFamily: MONO }}>{r.steelGrade || r.steel_grade || '—'}</td>
                      <td style={{ ...TD, fontFamily: MONO, textAlign: 'right' }}>{r.weightKg ?? r.weight_kg ?? r.weight ?? '—'}</td>
                      <td style={{ ...TD, fontFamily: MONO, textAlign: 'right' }}>{r.barCount ?? r.bar_count ?? r.bars ?? '—'}</td>
                      <td style={{ ...TD, fontFamily: MONO }}>{geomLabel(r)}</td>
                      <td style={TD}><StatusPill status={status} label={String(status).replace(/_/g, ' ')} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {meta?.total != null && rows.length < meta.total ? (
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted-2, #7d96bb)', marginTop: 10 }}>
            Showing {rows.length} of {meta.total} records.
          </div>
        ) : null}
      </div>
    </div>
  );
}
