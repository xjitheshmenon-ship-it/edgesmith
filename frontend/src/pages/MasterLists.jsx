import { useState, useMemo } from 'react';
import { usePolling } from '../hooks/usePolling';
import { masterApi } from '../api/resources';
import { useAuth } from '../store/AuthContext';
import { StatusPill, LocationBadge } from '../components/common/Badges';
import Icon from '../components/common/Icon';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

/* ───────────────────────── small shared UI ───────────────────────── */

function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
        {children}
      </div>
      {right || null}
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

const TH = { padding: '6px 12px 9px 0', textAlign: 'left', fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)', whiteSpace: 'nowrap' };
const TD = { padding: '9px 12px 9px 0', fontFamily: SANS, fontSize: 12.5, color: 'var(--text-primary, #15366a)', verticalAlign: 'top' };

function Table({ columns, rows, renderRow, empty, keyOf }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{columns.map((c) => <th key={c} style={TH}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={keyOf ? keyOf(r, i) : (r.id ?? i)} style={{ borderTop: '1px solid #eef2ea' }}>
              {renderRow(r, i)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusOf(row) {
  const archived = row.archived ?? row.is_archived ?? row.isArchived;
  if (archived) return <StatusPill status="closed" label="Archived" />;
  const s = row.status || (row.active === false ? 'idle' : 'active');
  return <StatusPill status={s} label={typeof s === 'string' ? s : 'Active'} />;
}

/* normalise a list payload that may be an array or {items:[...]} */
function asList(data) {
  if (Array.isArray(data)) return data;
  return data?.items || data?.rows || data?.data || [];
}

function pick(row, keys, fallback = '—') {
  for (const k of keys) {
    if (row[k] != null && row[k] !== '') return row[k];
  }
  return fallback;
}

/* camelCase → snake_case (sizeMm → size_mm, contactDetails → contact_details) */
function toSnake(name) {
  return name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

/* read a row value tolerating snake_case or camelCase keys */
function rowValue(row, name) {
  if (!row) return undefined;
  const snake = toSnake(name);
  if (row[name] != null) return row[name];
  if (row[snake] != null) return row[snake];
  return undefined;
}

/* build edit-form initial values from a row, reusing the tab's field defs.
   Array values (multi-select-ish, e.g. validSizes/childLengths) become
   comma-separated strings to match the create form's text inputs. */
function buildEditValues(tab, row) {
  const out = {};
  for (const f of tab.fields) {
    let v = rowValue(row, f.name);
    if (Array.isArray(v)) v = v.join(', ');
    out[f.name] = v == null ? '' : v;
  }
  return out;
}

/* generic create-form field renderer */
function Field({ field, value, onChange }) {
  const common = { value: value ?? '', onChange: (e) => onChange(field.name, e.target.value) };
  return (
    <div style={{ gridColumn: field.full ? '1 / -1' : 'auto' }}>
      <label className="form-label">{field.label}{field.required ? ' *' : ''}</label>
      {field.type === 'select' ? (
        <select className="form-select" {...common}>
          <option value="">— select —</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea className="form-input" style={{ height: 56, padding: '8px 13px', resize: 'vertical' }} placeholder={field.placeholder} {...common} />
      ) : (
        <input className="form-input" type={field.type === 'number' ? 'number' : 'text'} step={field.type === 'number' ? 'any' : undefined} placeholder={field.placeholder} {...common} />
      )}
      {field.hint ? <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--text-muted-2, #7d96bb)', marginTop: 4 }}>{field.hint}</div> : null}
    </div>
  );
}

/* ───────────────────────── tab definitions ───────────────────────── */

const LOCATION_OPTS = [
  { value: 'faridabad', label: 'Faridabad' },
  { value: 'dharmapuri', label: 'Dharmapuri' },
];

const TABS = [
  {
    key: 'workstations',
    label: 'Workstations',
    icon: 'monitor',
    fetch: () => masterApi.workstationTypes().then((r) => r.data),
    create: (p) => masterApi.createWorkstationType(p),
    update: (id, p) => masterApi.updateWorkstationType(id, p),
    archive: (id) => masterApi.archiveWorkstationType(id),
    columns: ['Code', 'Name', 'Category', 'Location', 'Status', ''],
    renderRow: (row, ctx) => (
      <>
        <td style={{ ...TD, fontFamily: MONO, fontWeight: 600 }}>{pick(row, ['code', 'workstation_code'])}</td>
        <td style={TD}>{pick(row, ['name', 'workstation_name'])}</td>
        <td style={TD}>{pick(row, ['category', 'workstation_category', 'type'])}</td>
        <td style={TD}>{row.location ? <LocationBadge location={row.location} /> : (pick(row, ['site']) === 'both' ? 'Both' : pick(row, ['site']))}</td>
        <td style={TD}>{StatusOf(row)}</td>
        <td style={{ ...TD, textAlign: 'right' }}>{ctx.rowActions(row)}</td>
      </>
    ),
    fields: [
      { name: 'code', label: 'Code', required: true, placeholder: 'WS-CODE' },
      { name: 'name', label: 'Name', required: true, placeholder: 'Workstation name' },
      { name: 'category', label: 'Category', placeholder: 'e.g. furnace, grinding' },
      { name: 'location', label: 'Location', type: 'select', options: [...LOCATION_OPTS, { value: 'both', label: 'Both' }] },
    ],
  },
  {
    key: 'badgeTypes',
    label: 'Certifications',
    icon: 'lock',
    fetch: () => masterApi.badgeTypes().then((r) => r.data),
    create: (p) => masterApi.createBadgeType(p),
    update: (id, p) => masterApi.updateBadgeType(id, p),
    archive: (id) => masterApi.archiveBadgeType(id),
    columns: ['Certification', 'Workstation', 'Validity', 'Status', ''],
    renderRow: (row, ctx) => (
      <>
        <td style={TD}>{pick(row, ['name'])}</td>
        <td style={{ ...TD, fontFamily: MONO }}>{pick(row, ['workstationCode', 'workstation_code']) || pick(row, ['workstationName', 'workstation_name']) || '—'}</td>
        <td style={TD}>{pick(row, ['validityMonths', 'validity_months']) ? `${pick(row, ['validityMonths', 'validity_months'])} mo` : '—'}</td>
        <td style={TD}>{StatusOf(row)}</td>
        <td style={{ ...TD, textAlign: 'right' }}>{ctx.rowActions(row)}</td>
      </>
    ),
    fields: [
      { name: 'name', label: 'Certification name', required: true, placeholder: 'e.g. HT90 Furnace Certified' },
      { name: 'workstationTypeId', label: 'Workstation', type: 'select', options: [], required: true },
      { name: 'validityMonths', label: 'Validity (months)', type: 'number', placeholder: 'e.g. 12' },
    ],
  },
  {
    key: 'products',
    label: 'Products',
    icon: 'stack',
    fetch: () => masterApi.products().then((r) => r.data),
    create: (p) => masterApi.createProduct(p),
    update: (id, p) => masterApi.updateProduct(id, p),
    archive: (id) => masterApi.archiveProduct(id),
    columns: ['Product Name', 'Code', 'Valid Cycle Types', 'Default Cycle', 'Status', ''],
    renderRow: (row, ctx) => {
      const valid = row.validCycleTypes || row.valid_cycle_types || row.cycleTypes;
      return (
        <>
          <td style={TD}>{pick(row, ['name', 'productName', 'product_name'])}</td>
          <td style={{ ...TD, fontFamily: MONO }}>{pick(row, ['code', 'productCode', 'product_code'])}</td>
          <td style={{ ...TD, fontFamily: MONO, fontSize: 11 }}>{Array.isArray(valid) ? valid.join(', ') : pick(row, ['validCycleTypes', 'valid_cycle_types'])}</td>
          <td style={{ ...TD, fontFamily: MONO }}>{pick(row, ['defaultCycleType', 'default_cycle_type'])}</td>
          <td style={TD}>{StatusOf(row)}</td>
          <td style={{ ...TD, textAlign: 'right' }}>{ctx.rowActions(row)}</td>
        </>
      );
    },
    fields: [
      { name: 'name', label: 'Product Name', required: true },
      { name: 'code', label: 'Product Code', required: true, placeholder: 'PROD-CODE' },
      { name: 'validCycleTypes', label: 'Valid Cycle Types', placeholder: 'EAT, SWAN, OVEN', full: true, hint: 'comma-separated cycle codes' },
      { name: 'defaultCycleType', label: 'Default Cycle Type', type: 'select', options: [{ value: 'EAT', label: 'EAT' }, { value: 'SWAN', label: 'SWAN' }, { value: 'OVEN', label: 'OVEN' }] },
    ],
    transform: (v) => ({
      ...v,
      validCycleTypes: v.validCycleTypes ? v.validCycleTypes.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    }),
  },
  {
    key: 'sizes',
    label: 'Sizes',
    icon: 'list',
    fetch: () => masterApi.sizes().then((r) => r.data),
    create: (p) => masterApi.createSize(p),
    update: (id, p) => masterApi.updateSize(id, p),
    archive: (id) => masterApi.archiveSize(id),
    columns: ['Size (mm)', 'Description', 'Status', ''],
    renderRow: (row, ctx) => (
      <>
        <td style={{ ...TD, fontFamily: MONO, fontWeight: 600 }}>{pick(row, ['sizeMm', 'size_mm', 'size', 'mm'])}</td>
        <td style={TD}>{pick(row, ['description', 'desc', 'label'])}</td>
        <td style={TD}>{StatusOf(row)}</td>
        <td style={{ ...TD, textAlign: 'right' }}>{ctx.rowActions(row)}</td>
      </>
    ),
    fields: [
      { name: 'sizeMm', label: 'Size (mm)', required: true, type: 'number', placeholder: 'e.g. 12' },
      { name: 'description', label: 'Description', full: true },
    ],
    transform: (v) => ({ ...v, sizeMm: v.sizeMm !== '' && v.sizeMm != null ? Number(v.sizeMm) : undefined }),
  },
  {
    key: 'designs',
    label: 'Designs',
    icon: 'doc',
    fetch: () => masterApi.designs().then((r) => r.data),
    create: (p) => masterApi.createDesign(p),
    update: (id, p) => masterApi.updateDesign(id, p),
    archive: (id) => masterApi.archiveDesign(id),
    extra: 'designMatrix',
    columns: ['Drawing / Code', 'Description', 'Valid Sizes', 'Status', ''],
    renderRow: (row, ctx) => {
      const sizes = row.validSizes || row.valid_sizes || row.sizes;
      return (
        <>
          <td style={{ ...TD, fontFamily: MONO, fontWeight: 600 }}>{pick(row, ['drawingNumber', 'drawing_number', 'designCode', 'design_code', 'code'])}</td>
          <td style={TD}>{pick(row, ['description', 'desc'])}</td>
          <td style={{ ...TD, fontFamily: MONO, fontSize: 11 }}>{Array.isArray(sizes) ? sizes.join(', ') : pick(row, ['validSizes', 'valid_sizes'])}</td>
          <td style={TD}>{StatusOf(row)}</td>
          <td style={{ ...TD, textAlign: 'right' }}>{ctx.rowActions(row)}</td>
        </>
      );
    },
    fields: [
      { name: 'drawingNumber', label: 'Drawing No. / Design Code', required: true, placeholder: 'DWG-1234' },
      { name: 'description', label: 'Description', full: true },
      { name: 'validSizes', label: 'Valid Sizes (mm)', placeholder: '12, 16, 20', full: true, hint: 'comma-separated sizes this design is valid for' },
    ],
    transform: (v) => ({
      ...v,
      validSizes: v.validSizes ? v.validSizes.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    }),
  },
  {
    key: 'suppliers',
    label: 'Suppliers',
    icon: 'truck',
    fetch: () => masterApi.suppliers().then((r) => r.data),
    create: (p) => masterApi.createSupplier(p),
    update: (id, p) => masterApi.updateSupplier(id, p),
    archive: (id) => masterApi.archiveSupplier(id),
    columns: ['Supplier', 'Material Type', 'Contact', 'Status', ''],
    renderRow: (row, ctx) => (
      <>
        <td style={TD}>{pick(row, ['name', 'supplierName', 'supplier_name'])}</td>
        <td style={{ ...TD, textTransform: 'capitalize' }}>{pick(row, ['materialType', 'material_type'])}</td>
        <td style={{ ...TD, fontFamily: MONO, fontSize: 11 }}>{pick(row, ['contact', 'contactDetails', 'contact_details', 'phone'])}</td>
        <td style={TD}>{StatusOf(row)}</td>
        <td style={{ ...TD, textAlign: 'right' }}>{ctx.rowActions(row)}</td>
      </>
    ),
    fields: [
      { name: 'name', label: 'Supplier Name', required: true },
      { name: 'materialType', label: 'Material Type', type: 'select', options: [{ value: 'alloy_steel', label: 'Alloy Steel' }, { value: 'ms', label: 'MS' }, { value: 'both', label: 'Both' }] },
      { name: 'contact', label: 'Contact Details', full: true, placeholder: 'phone / email' },
    ],
  },
  {
    key: 'contractors',
    label: 'Rolling Contractors',
    icon: 'people',
    fetch: () => masterApi.contractors().then((r) => r.data),
    create: (p) => masterApi.createContractor(p),
    update: (id, p) => masterApi.updateContractor(id, p),
    archive: (id) => masterApi.archiveContractor(id),
    columns: ['Contractor', 'Contact', 'Status', ''],
    renderRow: (row, ctx) => (
      <>
        <td style={TD}>{pick(row, ['name', 'contractorName', 'contractor_name'])}</td>
        <td style={{ ...TD, fontFamily: MONO, fontSize: 11 }}>{pick(row, ['contact', 'contactDetails', 'contact_details', 'phone'])}</td>
        <td style={TD}>{StatusOf(row)}</td>
        <td style={{ ...TD, textAlign: 'right' }}>{ctx.rowActions(row)}</td>
      </>
    ),
    fields: [
      { name: 'name', label: 'Contractor Name', required: true },
      { name: 'contact', label: 'Contact Details', full: true, placeholder: 'phone / email' },
    ],
  },
  {
    key: 'patterns',
    label: 'Conversion Patterns',
    icon: 'flow',
    fetch: () => masterApi.conversionPatterns().then((r) => r.data),
    create: (p) => masterApi.createConversionPattern(p),
    update: (id, p) => masterApi.updateConversionPattern(id, p),
    archive: (id) => masterApi.archiveConversionPattern(id),
    columns: ['Pattern', 'Input (mm)', 'Child Lengths', 'Cuts', 'Kerf', 'Scrap (mm)', ''],
    renderRow: (row, ctx) => {
      const children = row.childLengths || row.child_lengths || row.children;
      const childArr = Array.isArray(children) ? children : (typeof children === 'string' ? children.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) : []);
      const input = Number(pick(row, ['inputLength', 'input_length', 'input'], 0)) || 0;
      const cuts = Number(pick(row, ['cutCount', 'cut_count', 'cuts'], childArr.length)) || childArr.length;
      const kerf = pick(row, ['kerfTotal', 'kerf_total'], cuts * 3);
      const scrap = pick(row, ['scrap', 'scrapMm', 'scrap_mm'], input ? input - childArr.reduce((a, b) => a + b, 0) - cuts * 3 : '—');
      return (
        <>
          <td style={TD}>{pick(row, ['name', 'patternName', 'pattern_name'])}</td>
          <td style={{ ...TD, fontFamily: MONO }}>{input || '—'}</td>
          <td style={{ ...TD, fontFamily: MONO, fontSize: 11 }}>{childArr.length ? childArr.join(' + ') : '—'}</td>
          <td style={{ ...TD, fontFamily: MONO }}>{cuts}</td>
          <td style={{ ...TD, fontFamily: MONO }}>{kerf}</td>
          <td style={{ ...TD, fontFamily: MONO, fontWeight: 600 }}>{scrap}</td>
          <td style={{ ...TD, textAlign: 'right' }}>{ctx.rowActions(row)}</td>
        </>
      );
    },
    fields: [
      { name: 'name', label: 'Pattern Name', required: true },
      { name: 'inputLength', label: 'Input Length (mm)', type: 'number', required: true },
      { name: 'childLengths', label: 'Child Lengths (mm)', placeholder: '500, 500, 480', full: true, hint: 'comma-separated; scrap auto-calculated as input − Σchildren − (cuts × 3mm)' },
    ],
    transform: (v) => {
      const childArr = v.childLengths ? v.childLengths.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) : [];
      const input = Number(v.inputLength) || 0;
      const cutCount = childArr.length;
      const kerfTotal = cutCount * 3;
      const scrap = input - childArr.reduce((a, b) => a + b, 0) - kerfTotal;
      return {
        name: v.name,
        inputLength: input || undefined,
        childLengths: childArr,
        cutCount,
        kerfTotal,
        scrap,
      };
    },
  },
  {
    key: 'storage',
    label: 'Storage Locations',
    icon: 'db',
    fetch: () => masterApi.storageLocations().then((r) => r.data),
    create: (p) => masterApi.createStorageLocation(p),
    update: (id, p) => masterApi.updateStorageLocation(id, p),
    archive: (id) => masterApi.archiveStorageLocation(id),
    columns: ['Location Code', 'Name', 'Location', 'Status', ''],
    renderRow: (row, ctx) => (
      <>
        <td style={{ ...TD, fontFamily: MONO, fontWeight: 600 }}>{pick(row, ['code', 'locationCode', 'location_code'])}</td>
        <td style={TD}>{pick(row, ['name', 'locationName', 'location_name'])}</td>
        <td style={TD}>{row.location ? <LocationBadge location={row.location} /> : pick(row, ['site'])}</td>
        <td style={TD}>{StatusOf(row)}</td>
        <td style={{ ...TD, textAlign: 'right' }}>{ctx.rowActions(row)}</td>
      </>
    ),
    fields: [
      { name: 'code', label: 'Location Code', required: true, placeholder: 'LOC-01' },
      { name: 'name', label: 'Name', required: true },
      { name: 'location', label: 'Location', type: 'select', options: LOCATION_OPTS },
    ],
  },
];

/* ─────────────────── design validity matrix (read-only) ─────────────────── */

function DesignValidityMatrix() {
  const { data, error, loading } = usePolling(
    () => masterApi.designValidityMatrix().then((r) => r.data),
    []
  );

  if (error) return <ErrorBanner message="Could not load the validity matrix." />;
  if (loading && !data) return <Empty>Loading validity matrix…</Empty>;

  const sizes = data?.sizes || data?.columns || [];
  const designs = data?.designs || data?.rows || asList(data);
  if (!designs.length || !sizes.length) return <Empty>No validity matrix data available.</Empty>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={TH}>Design \ Size</th>
            {sizes.map((s, i) => (
              <th key={i} style={{ ...TH, textAlign: 'center', padding: '6px 8px 9px' }}>{s.sizeMm ?? s.size_mm ?? s.label ?? s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {designs.map((d, di) => {
            const valid = d.validSizes || d.valid_sizes || d.sizes || [];
            const validSet = new Set((Array.isArray(valid) ? valid : []).map(String));
            return (
              <tr key={di} style={{ borderTop: '1px solid #eef2ea' }}>
                <td style={{ ...TD, fontFamily: MONO, fontWeight: 600 }}>{d.drawingNumber || d.drawing_number || d.code || d.label || '—'}</td>
                {sizes.map((s, si) => {
                  const sv = String(s.sizeMm ?? s.size_mm ?? s.label ?? s);
                  const ok = validSet.has(sv);
                  return (
                    <td key={si} style={{ ...TD, textAlign: 'center', padding: '9px 8px' }}>
                      {ok ? <Icon name="check" size={15} color="var(--status-success, #22a06b)" /> : <span style={{ color: 'var(--border-muted, #cdd9c8)' }}>·</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────────── tab panel ───────────────────────── */

function TabPanel({ tab, canWrite }) {
  const { data, error, loading, refetch } = usePolling(tab.fetch, [tab.key]);

  const rows = useMemo(() => asList(data), [data]);

  // create form state
  const [form, setForm] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formSuccess, setFormSuccess] = useState(null);

  // archive state
  const [archivingId, setArchivingId] = useState(null);
  const [actionError, setActionError] = useState(null);

  // inline edit state (only one row editable at a time)
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);

  function setField(name, value) {
    setForm((f) => ({ ...f, [name]: value }));
  }

  function setEditField(name, value) {
    setEditForm((f) => ({ ...f, [name]: value }));
  }

  function startEdit(row) {
    const id = row.id ?? row.code ?? row.uuid;
    setActionError(null);
    setEditError(null);
    setEditingId(id);
    setEditForm(buildEditValues(tab, row));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
    setEditError(null);
  }

  async function saveEdit(e) {
    if (e) e.preventDefault();
    if (!tab.update || editingId == null) return;
    setEditError(null);
    for (const f of tab.fields) {
      if (f.required && (editForm[f.name] == null || String(editForm[f.name]).trim() === '')) {
        setEditError(`${f.label} is required.`);
        return;
      }
    }
    const payload = tab.transform ? tab.transform(editForm) : { ...editForm };
    Object.keys(payload).forEach((k) => {
      if (payload[k] === '' || payload[k] == null) delete payload[k];
    });
    setEditSaving(true);
    try {
      await tab.update(editingId, payload);
      await refetch();
      cancelEdit();
    } catch (err) {
      setEditError(err.message || 'Could not save changes. Please check the fields and try again.');
    } finally {
      setEditSaving(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    cancelEdit();
    for (const f of tab.fields) {
      if (f.required && (form[f.name] == null || String(form[f.name]).trim() === '')) {
        setFormError(`${f.label} is required.`);
        return;
      }
    }
    const payload = tab.transform ? tab.transform(form) : { ...form };
    // strip empties
    Object.keys(payload).forEach((k) => {
      if (payload[k] === '' || payload[k] == null) delete payload[k];
    });
    setSubmitting(true);
    try {
      await tab.create(payload);
      setFormSuccess(`${tab.label.replace(/s$/, '')} created.`);
      setForm({});
      await refetch();
    } catch (err) {
      setFormError(err.message || 'Could not save. Please check the fields and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function archive(row) {
    if (!tab.archive) return;
    const id = row.id ?? row.code ?? row.uuid;
    setActionError(null);
    setArchivingId(id);
    try {
      await tab.archive(id);
      await refetch();
    } catch (err) {
      setActionError(err.message || 'Archive failed. It may still be in use.');
    } finally {
      setArchivingId(null);
    }
  }

  const archiveBtn = (row) => {
    if (!tab.archive || !canWrite) return null;
    const id = row.id ?? row.code ?? row.uuid;
    const archived = row.archived ?? row.is_archived ?? row.isArchived;
    if (archived) return null;
    return (
      <button className="btn btn-danger btn-sm" disabled={archivingId === id} onClick={() => archive(row)}>
        {archivingId === id ? 'Archiving…' : 'Archive'}
      </button>
    );
  };

  const editBtn = (row) => {
    if (!tab.update || !canWrite) return null;
    const id = row.id ?? row.code ?? row.uuid;
    const archived = row.archived ?? row.is_archived ?? row.isArchived;
    if (archived) return null;
    return (
      <button className="btn btn-sm" disabled={editingId === id} onClick={() => startEdit(row)}>
        Edit
      </button>
    );
  };

  const ctx = {
    archiveBtn,
    rowActions: (row) => {
      const edit = editBtn(row);
      const arch = archiveBtn(row);
      if (!edit && !arch) return null;
      return (
        <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
          {edit}
          {arch}
        </div>
      );
    },
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16, alignItems: 'start' }}>
      {/* ── list ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionTitle right={<span className="badge" style={{ background: 'var(--bg-soft-blue, #eaf0f7)', color: 'var(--text-primary, #15366a)' }}>{rows.length} TOTAL</span>}>
            {tab.label}
          </SectionTitle>
          {actionError ? <div style={{ marginBottom: 10 }}><ErrorBanner message={actionError} /></div> : null}
          {error ? (
            <ErrorBanner message={`Could not load ${tab.label.toLowerCase()}.`} />
          ) : loading && !data ? (
            <Empty>Loading…</Empty>
          ) : (
            <Table
              columns={tab.columns}
              rows={rows}
              renderRow={(row, i) => tab.renderRow(row, ctx, i)}
              empty={`No ${tab.label.toLowerCase()} yet.`}
              keyOf={(r, i) => r.id ?? r.code ?? i}
            />
          )}

          {editingId != null && canWrite ? (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #eef2ea' }}>
              <SectionTitle>Edit {tab.label.replace(/s$/, '')}</SectionTitle>
              <form onSubmit={saveEdit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {tab.fields.map((f) => (
                  <Field key={f.name} field={f} value={editForm[f.name]} onChange={setEditField} />
                ))}
                {editError ? <div style={{ gridColumn: '1 / -1' }}><ErrorBanner message={editError} /></div> : null}
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={editSaving}>
                    <Icon name="check" size={14} color="var(--accent-green, #d4eecb)" />
                    {editSaving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button type="button" className="btn btn-sm" disabled={editSaving} onClick={cancelEdit}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          ) : null}
        </div>

        {tab.extra === 'designMatrix' ? (
          <div className="card" style={{ padding: '18px 20px' }}>
            <SectionTitle>Validity Matrix · Sizes × Designs</SectionTitle>
            <DesignValidityMatrix />
          </div>
        ) : null}
      </div>

      {/* ── create form ── */}
      <div className="card" style={{ padding: '18px 20px', position: 'sticky', top: 16 }}>
        <SectionTitle>New {tab.label.replace(/s$/, '')}</SectionTitle>
        {!canWrite ? (
          <Empty>Creating reference data requires an admin or manager role.</Empty>
        ) : (
          <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {tab.fields.map((f) => (
              <Field key={f.name} field={f} value={form[f.name]} onChange={setField} />
            ))}
            {formError ? <div style={{ gridColumn: '1 / -1' }}><ErrorBanner message={formError} /></div> : null}
            {formSuccess ? <div style={{ gridColumn: '1 / -1' }}><SuccessBanner message={formSuccess} /></div> : null}
            <div style={{ gridColumn: '1 / -1' }}>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                <Icon name="plus" size={15} color="var(--accent-green, #d4eecb)" />
                {submitting ? 'Saving…' : `Add ${tab.label.replace(/s$/, '')}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── page ───────────────────────── */

export default function MasterLists() {
  const { isAdmin, isManager } = useAuth();
  const canWrite = isAdmin || isManager;
  const [active, setActive] = useState(TABS[0].key);

  // Workstation options for the Certifications tab (dynamic FK dropdown).
  const { data: wsData } = usePolling(() => masterApi.workstationTypes().then((r) => r.data), []);
  const wsOptions = useMemo(
    () => asList(wsData).map((w) => ({ value: String(pick(w, ['id'])), label: `${pick(w, ['code', 'workstation_code'])} — ${pick(w, ['name', 'workstation_name'])}` })),
    [wsData]
  );

  const tab = useMemo(() => {
    const base = TABS.find((t) => t.key === active) || TABS[0];
    if (base.key === 'badgeTypes') {
      return { ...base, fields: base.fields.map((f) => (f.name === 'workstationTypeId' ? { ...f, options: wsOptions } : f)) };
    }
    return base;
  }, [active, wsOptions]);

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
        Master Lists
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
        Manage reference data used across the system{canWrite ? '' : ' · view only'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: 20, marginTop: 20, alignItems: 'start' }}>
        {/* left segmented control (vertical tab strip) */}
        <div className="card" style={{ padding: 8, position: 'sticky', top: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {TABS.map((t) => {
              const isActive = t.key === active;
              return (
                <button
                  key={t.key}
                  onClick={() => setActive(t.key)}
                  className="btn"
                  style={{
                    height: 40,
                    justifyContent: 'flex-start',
                    width: '100%',
                    border: 'none',
                    background: isActive ? 'var(--ink-650, #15366a)' : 'transparent',
                    color: isActive ? 'var(--text-onink, #eaf4e4)' : 'var(--text-secondary, #5d7188)',
                    fontSize: 12.5,
                  }}
                >
                  <Icon name={t.icon} size={16} color={isActive ? 'var(--accent-green, #d4eecb)' : 'var(--text-secondary, #5d7188)'} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* active panel */}
        <div className="cp-fade-in" key={tab.key}>
          <TabPanel tab={tab} canWrite={canWrite} />
        </div>
      </div>
    </div>
  );
}
