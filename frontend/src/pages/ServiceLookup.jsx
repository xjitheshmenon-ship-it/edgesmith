import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { serviceApi } from '../api/resources';
import { CycleBadge, StatusPill, LocationBadge } from '../components/common/Badges';
import Icon from '../components/common/Icon';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

const HEAT_CAVEAT =
  'Traceability is best-effort. A field UID maps to a Faridabad batch that may have been ' +
  'rolled from more than one steel heat, so the exact heat number cannot be guaranteed. ' +
  'Every candidate heat for this batch is listed below — treat all of them as possible.';

// ── small presentational helpers ────────────────────────────────────────────

function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
        {children}
      </div>
      {right || null}
    </div>
  );
}

function Field({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary, #5d7188)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: mono ? MONO : SANS, fontSize: 13.5, fontWeight: mono ? 600 : 500, color: 'var(--text-primary, #15366a)' }}>
        {value == null || value === '' ? '—' : value}
      </div>
    </div>
  );
}

function FieldGrid({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px 20px' }}>
      {children}
    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-danger, #e5484d)', background: 'rgba(229,72,77,0.08)', border: '1px solid rgba(229,72,77,0.25)', borderRadius: 'var(--radius-md, 9px)', padding: '11px 13px' }}>
      <Icon name="alert" size={15} color="var(--status-danger, #e5484d)" />
      <span>{message}</span>
    </div>
  );
}

// Read multiple possible field names (camelCase / snake_case) off a record.
function pick(obj, ...keys) {
  if (!obj) return undefined;
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

// Always returns an array — honest traceability never collapses to one value.
function asHeatArray(record, ...keys) {
  for (const k of keys) {
    const v = record?.[k];
    if (Array.isArray(v) && v.length) return v;
    if (v != null && v !== '' && !Array.isArray(v)) return [v];
  }
  return [];
}

function HeatList({ heats }) {
  if (!heats.length) {
    return <span style={{ fontFamily: MONO, fontSize: 12.5, color: 'var(--text-muted-2, #7d96bb)' }}>none recorded</span>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {heats.map((h, i) => {
        const label = typeof h === 'object' ? (pick(h, 'heatNumber', 'heat_number', 'heat', 'number') ?? JSON.stringify(h)) : h;
        return (
          <span
            key={`${label}-${i}`}
            className="badge"
            style={{ background: 'var(--bg-soft-amber, #fdf6ef)', color: 'var(--location-faridabad, #d97a2b)', border: '1px solid var(--bg-soft-amber-2, #f0e2d0)', fontSize: 11, padding: '3px 9px' }}
          >
            {String(label)}
          </span>
        );
      })}
    </div>
  );
}

// ── result cards ─────────────────────────────────────────────────────────────

function IdentityCard({ record, code, onOpenFull }) {
  const cycle = pick(record, 'cycleType', 'cycle_type', 'cycle');
  const status = pick(record, 'status', 'currentStatus', 'current_status') || 'unknown';
  const currentStep = pick(record, 'currentStep', 'current_step', 'step');
  const statusLabel =
    String(status).toLowerCase() === 'dispatched'
      ? 'Dispatched'
      : currentStep != null
      ? `In production · Step ${currentStep}`
      : status;

  return (
    <div className="card" style={{ padding: '20px 22px' }}>
      <SectionTitle
        right={
          <button className="btn btn-primary btn-sm" onClick={onOpenFull}>
            <Icon name="doc" size={14} color="var(--accent-green, #d4eecb)" />
            Open full detail
          </button>
        }
      >
        Product Identity
      </SectionTitle>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--text-primary, #15366a)' }}>
          {pick(record, 'uidCode', 'uid_code', 'uid') || code}
        </span>
        {cycle ? <CycleBadge cycle={cycle} /> : null}
        <StatusPill status={String(status).toLowerCase()} label={statusLabel} />
      </div>

      <FieldGrid>
        <Field label="Product type" value={pick(record, 'productType', 'product_type', 'product')} />
        <Field label="Size" value={pick(record, 'size', 'productSize', 'product_size')} />
        <Field label="Design" value={pick(record, 'design', 'designCode', 'design_code')} />
        <Field label="Cycle type" value={cycle} />
        <Field label="Date of dispatch" value={pick(record, 'dispatchDate', 'dispatch_date', 'dispatchedAt', 'dispatched_at')} mono />
        <Field label="Current step" value={currentStep != null ? `Step ${currentStep}` : '—'} />
        <Field label="MO number" value={pick(record, 'moNumber', 'mo_number', 'mo')} mono />
        <Field label="Customer" value={pick(record, 'customerName', 'customer_name', 'customer')} />
      </FieldGrid>
    </div>
  );
}

function OriginCard({ record }) {
  const origin = pick(record, 'materialOrigin', 'material_origin', 'origin') || record || {};
  const alloy = pick(origin, 'alloySteel', 'alloy_steel', 'alloy') || {};
  const ms = pick(origin, 'ms', 'msSteel', 'ms_steel') || {};

  const alloyHeats = asHeatArray(origin, 'possibleAlloyHeats', 'possible_alloy_heats');
  const msHeats = asHeatArray(origin, 'possibleMsHeats', 'possible_ms_heats');

  return (
    <div className="card" style={{ padding: '20px 22px' }}>
      <SectionTitle right={<LocationBadge location="faridabad" />}>Material Origin</SectionTitle>

      <FieldGrid>
        <Field label="Faridabad batch ref" value={pick(origin, 'faridabadBatch', 'faridabad_batch', 'batchRef', 'batch_ref', 'batch')} mono />
        <Field label="Rolling contractor" value={pick(origin, 'rollingContractor', 'rolling_contractor', 'contractor')} />
        <Field label="Dispatched from Faridabad" value={pick(origin, 'faridabadDispatchDate', 'faridabad_dispatch_date', 'dispatchDate')} mono />
        <Field label="Received at Dharmapuri" value={pick(origin, 'dharmapuriReceivedDate', 'dharmapuri_received_date', 'receivedDate', 'received_date')} mono />
        <Field label="Alloy supplier" value={pick(alloy, 'supplier', 'supplierName', 'supplier_name')} />
        <Field label="Alloy steel grade" value={pick(alloy, 'grade', 'steelGrade', 'steel_grade')} />
        <Field label="MS supplier" value={pick(ms, 'supplier', 'supplierName', 'supplier_name')} />
        <Field label="MS steel grade" value={pick(ms, 'grade', 'steelGrade', 'steel_grade')} />
      </FieldGrid>

      {/* ── Honest traceability: heats are always arrays of candidates ── */}
      <div style={{ marginTop: 20, borderTop: '1px solid var(--border-card, #e3ebde)', paddingTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontFamily: SANS, fontSize: 12, lineHeight: 1.5, color: 'var(--status-warning, #d97a2b)', background: 'var(--bg-soft-amber, #fdf6ef)', border: '1px solid var(--bg-soft-amber-2, #f0e2d0)', borderRadius: 'var(--radius-md, 9px)', padding: '10px 12px', marginBottom: 14 }}>
          <Icon name="alert" size={15} color="var(--status-warning, #d97a2b)" />
          <span>{HEAT_CAVEAT}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary, #5d7188)', marginBottom: 7 }}>
              Possible alloy heats ({alloyHeats.length})
            </div>
            <HeatList heats={alloyHeats} />
          </div>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary, #5d7188)', marginBottom: 7 }}>
              Possible MS heats ({msHeats.length})
            </div>
            <HeatList heats={msHeats} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function ServiceLookup() {
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [code, setCode] = useState(null); // the code actually looked up
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(false);

  async function runLookup(e) {
    if (e) e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setError('Enter a UID code to search.');
      return;
    }
    setLoading(true);
    setError(null);
    setRecord(null);
    setSearched(true);
    setCode(trimmed);
    try {
      const data = await serviceApi.lookupUid(trimmed).then((r) => r.data);
      const result = data?.record || data?.uid || data || null;
      if (!result || (typeof result === 'object' && Object.keys(result).length === 0)) {
        setRecord(null);
        setError(null);
      } else {
        setRecord(result);
      }
    } catch (err) {
      if (err?.status === 404 || /not found/i.test(err?.message || '')) {
        setRecord(null);
        setError(null);
      } else {
        setError(err?.message || 'Lookup failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="search" size={22} color="var(--text-primary, #15366a)" />
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
          Service Call Lookup
        </div>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
        Enter the UID stamped on a product to retrieve its complete manufacturing and material history. Read-only.
      </div>

      {/* ── Prominent search ── */}
      <form onSubmit={runLookup} className="card" style={{ marginTop: 20, padding: '22px 24px', display: 'flex', alignItems: 'flex-end', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="form-label" htmlFor="svc-uid">UID code</label>
          <input
            id="svc-uid"
            className="form-input"
            style={{ height: 52, fontFamily: MONO, fontSize: 16, letterSpacing: '0.04em' }}
            placeholder="scan or type the UID stamped on the product"
            value={query}
            autoComplete="off"
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading} style={{ height: 52, padding: '0 22px', fontSize: 14 }}>
          <Icon name="search" size={16} color="var(--accent-green, #d4eecb)" />
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {/* ── Results region ── */}
      <div style={{ marginTop: 18 }}>
        {error ? (
          <ErrorBanner message={error} />
        ) : loading ? (
          <div className="card cp-fade-in" style={{ padding: '40px 22px', textAlign: 'center', fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)' }}>
            Retrieving record for <span style={{ fontFamily: MONO, fontWeight: 600 }}>{code}</span>…
          </div>
        ) : record ? (
          <div className="cp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <IdentityCard record={record} code={code} onOpenFull={() => navigate(`/uid/${encodeURIComponent(code)}`)} />
            <OriginCard record={record} />
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted-2, #7d96bb)', textAlign: 'center' }}>
              This record is read-only. Nothing can be modified from this page.
            </div>
          </div>
        ) : searched ? (
          <div className="card" style={{ padding: '40px 22px', textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', marginBottom: 10 }}>
              <Icon name="search" size={28} color="var(--text-muted, #9bb4d4)" />
            </div>
            <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>
              No record found for <span style={{ fontFamily: MONO }}>{code}</span>
            </div>
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', marginTop: 5 }}>
              Check the UID and try again. Stamped codes are case-sensitive.
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: '40px 22px', textAlign: 'center', fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)' }}>
            Search by UID above to retrieve a product's full history.
          </div>
        )}
      </div>
    </div>
  );
}
