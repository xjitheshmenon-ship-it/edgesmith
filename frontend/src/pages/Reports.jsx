import { useMemo, useState, useCallback, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { reportsApi } from '../api/resources';
import { ApiError } from '../api/client';
import Icon from '../components/common/Icon';
import { CycleBadge, StatusPill, LocationBadge } from '../components/common/Badges';

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";

/* ──────────────────────────────────────────────────────────────────────────
   REPORTS — PAGE 13

   All nine reports are location-aware via the SHARED useApp().location. There
   is deliberately NO local location toggle on this page (explicit design
   correction): the shared location is passed into every report call that
   accepts filters. A date-range filter (and per-report secondary filters)
   drive the on-demand fetch. Visualizations are plain CSS bars/divs — no
   chart library.
   ────────────────────────────────────────────────────────────────────────── */

const REPORTS = [
  { id: 'production', name: 'Production Output', icon: 'chart', dateAware: true, desc: 'UID throughput per step / workstation over time.' },
  { id: 'wip', name: 'WIP Summary', icon: 'stack', dateAware: false, desc: 'Snapshot of work in progress across the floor.' },
  { id: 'furnace', name: 'Furnace Batch Log', icon: 'thermo', dateAware: true, desc: 'Tempering runs — target vs actual parameters.' },
  { id: 'scrap', name: 'Scrap & Yield', icon: 'flow', dateAware: false, desc: 'Material utilisation from Converting (Step 16).' },
  { id: 'moFulfilment', name: 'MO Fulfilment', icon: 'truck', dateAware: false, desc: 'Manufacturing order completion & dispatch.' },
  { id: 'quality', name: 'Quality Report', icon: 'check', dateAware: false, desc: 'QC pass / fail rates across steps.' },
  { id: 'traceability', name: 'Material Traceability', icon: 'search', dateAware: true, desc: 'UIDs made from a heat number / supplier / batch.' },
  { id: 'shift', name: 'Shift Performance', icon: 'people', dateAware: true, desc: 'Output and staffing by shift.' },
  { id: 'capacity', name: 'Capacity Utilisation', icon: 'monitor', dateAware: false, desc: 'Workstation load vs available capacity.' },
];

/* ── small presentational helpers ─────────────────────────────────────── */

function SectionLabel({ children, style }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--text-muted, #9bb4d4)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Metric({ label, value, suffix, color }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <SectionLabel>{label}</SectionLabel>
      <div
        style={{
          fontFamily: ARCHIVO,
          fontWeight: 800,
          fontSize: 26,
          letterSpacing: '-0.03em',
          color: color || 'var(--text-primary, #15366a)',
          marginTop: 4,
          lineHeight: 1.1,
        }}
      >
        {value ?? '—'}
        {value != null && suffix ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary, #5d7188)', marginLeft: 3 }}>{suffix}</span>
        ) : null}
      </div>
    </div>
  );
}

/* Horizontal CSS bar — a labelled value relative to a max. */
function Bar({ label, value, max, color = 'var(--status-success, #22a06b)', valueLabel }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0' }}>
      <div
        style={{
          width: 150,
          flexShrink: 0,
          fontFamily: SANS,
          fontSize: 12,
          color: 'var(--text-secondary, #5d7188)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={label}
      >
        {label}
      </div>
      <div style={{ flex: 1, height: 16, background: 'var(--bg-muted, #f4f7f2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.25s' }} />
      </div>
      <div style={{ width: 64, flexShrink: 0, textAlign: 'right', fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>
        {valueLabel ?? value}
      </div>
    </div>
  );
}

/* A stacked pass/fail bar (two-segment). */
function PassFailBar({ label, pass, fail }) {
  const total = pass + fail || 1;
  const passPct = Math.round((pass / total) * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0' }}>
      <div style={{ width: 150, flexShrink: 0, fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary, #5d7188)' }} title={label}>
        {label}
      </div>
      <div style={{ flex: 1, height: 16, background: 'var(--bg-muted, #f4f7f2)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: `${passPct}%`, background: 'var(--status-success, #22a06b)' }} />
        <div style={{ width: `${100 - passPct}%`, background: 'var(--status-danger, #e5484d)' }} />
      </div>
      <div style={{ width: 64, flexShrink: 0, textAlign: 'right', fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: 'var(--status-success, #22a06b)' }}>
        {passPct}%
      </div>
    </div>
  );
}

function Table({ columns, rows, renderCell, emptyMessage = 'No rows for the selected filters.' }) {
  if (!rows || rows.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: 12.5 }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{
                    textAlign: c.align || 'left',
                    padding: '11px 14px',
                    fontFamily: MONO,
                    fontSize: 9.5,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--text-secondary, #5d7188)',
                    background: 'var(--bg-muted-2, #f6f9f4)',
                    borderBottom: '1px solid var(--border-card, #e3ebde)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id ?? row.key ?? i} style={{ borderBottom: '1px solid var(--bg-muted, #f4f7f2)' }}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      textAlign: c.align || 'left',
                      padding: '10px 14px',
                      color: 'var(--text-primary, #15366a)',
                      fontFamily: c.mono ? MONO : SANS,
                      whiteSpace: c.wrap ? 'normal' : 'nowrap',
                    }}
                  >
                    {renderCell ? renderCell(c.key, row) : row[c.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Panel({ title, children, style }) {
  return (
    <div className="card" style={{ padding: '18px 20px', ...style }}>
      {title ? <SectionLabel style={{ marginBottom: 14 }}>{title}</SectionLabel> : null}
      {children}
    </div>
  );
}

/* ── value helpers (defensive against unknown backend field names) ──────── */

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asArray(v, ...keys) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    for (const k of keys) if (Array.isArray(v[k])) return v[k];
    // last resort: first array-valued property
    const arr = Object.values(v).find((x) => Array.isArray(x));
    if (arr) return arr;
  }
  return [];
}

function fmt(v) {
  if (v === undefined || v === null || v === '') return '—';
  return v;
}

/* ── page ─────────────────────────────────────────────────────────────── */

export default function Reports() {
  const { location, locationLabel } = useApp();
  const [activeId, setActiveId] = useState('production');

  // Date-range filter (default: trailing 30 days through today).
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const monthAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);
  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo, setDateTo] = useState(today);

  // Traceability secondary filter (search by heat / supplier / batch).
  const [traceField, setTraceField] = useState('heat_number');
  const [traceValue, setTraceValue] = useState('');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const activeReport = REPORTS.find((r) => r.id === activeId);

  const buildFilters = useCallback(() => {
    const f = { location };
    if (activeReport?.dateAware) {
      f.date_from = dateFrom;
      f.date_to = dateTo;
    }
    if (activeId === 'traceability' && traceValue.trim()) {
      f[traceField] = traceValue.trim();
      f.search = traceValue.trim();
    }
    return f;
  }, [location, activeReport, dateFrom, dateTo, activeId, traceField, traceValue]);

  const fetchReport = useCallback(async () => {
    // Traceability needs a search term before it returns anything meaningful.
    if (activeId === 'traceability' && !traceValue.trim()) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fn = reportsApi[activeId];
      const filters = buildFilters();
      // Pass the shared location + filters to every call. Functions that ignore
      // arguments (wip/scrap/moFulfilment/quality/capacity) still receive it
      // harmlessly; the backend independently scopes by location.
      const result = await fn(filters).then((r) => r.data);
      setData(result);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('UNKNOWN', err.message, 0));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [activeId, buildFilters, traceValue]);

  // Re-fetch when the report, shared location, or date range changes. (Not on
  // every traceValue keystroke — that report fetches on explicit search.)
  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, location, dateFrom, dateTo]);

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
            Reports
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)' }}>
              Operational & management reporting
            </span>
            <LocationBadge location={location} />
          </div>
        </div>
        <button className="btn btn-sm" type="button" onClick={fetchReport} disabled={loading}>
          <Icon name="refresh" size={14} />
          Refresh
        </button>
      </div>

      {/* Filter bar — date range + per-report secondary filters. NO location
          control: that lives in the shared topbar (useApp().location). */}
      <div className="card" style={{ padding: '14px 18px', marginTop: 18, display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ opacity: activeReport?.dateAware ? 1 : 0.45, pointerEvents: activeReport?.dateAware ? 'auto' : 'none' }}>
          <label className="form-label">From</label>
          <input
            type="date"
            className="form-input"
            style={{ height: 38, width: 170, borderRadius: 'var(--radius-md, 9px)' }}
            value={dateFrom}
            max={dateTo}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div style={{ opacity: activeReport?.dateAware ? 1 : 0.45, pointerEvents: activeReport?.dateAware ? 'auto' : 'none' }}>
          <label className="form-label">To</label>
          <input
            type="date"
            className="form-input"
            style={{ height: 38, width: 170, borderRadius: 'var(--radius-md, 9px)' }}
            value={dateTo}
            min={dateFrom}
            max={today}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        {activeId === 'traceability' ? (
          <>
            <div>
              <label className="form-label">Search by</label>
              <select
                className="form-select"
                style={{ height: 38, width: 180, borderRadius: 'var(--radius-md, 9px)' }}
                value={traceField}
                onChange={(e) => setTraceField(e.target.value)}
              >
                <option value="heat_number">Heat number</option>
                <option value="supplier">Supplier name</option>
                <option value="faridabad_batch">Faridabad batch ref</option>
                <option value="receiving_event">Receiving event</option>
              </select>
            </div>
            <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
              <label className="form-label">Value</label>
              <input
                className="form-input"
                style={{ height: 38, borderRadius: 'var(--radius-md, 9px)' }}
                placeholder="e.g. HT-2291-A"
                value={traceValue}
                onChange={(e) => setTraceValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchReport()}
              />
            </div>
            <button className="btn btn-primary btn-sm" type="button" onClick={fetchReport} disabled={!traceValue.trim()}>
              <Icon name="search" size={14} />
              Search
            </button>
          </>
        ) : null}

        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--text-muted, #9bb4d4)', alignSelf: 'center' }}>
          {locationLabel}
        </div>
      </div>

      {/* Body: report selector (left) + selected report (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '248px minmax(0, 1fr)', gap: 18, marginTop: 18, alignItems: 'start' }}>
        {/* Selector sidebar */}
        <div className="card" style={{ padding: 8, position: 'sticky', top: 18 }}>
          {REPORTS.map((r) => {
            const isActive = r.id === activeId;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setActiveId(r.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '10px 11px',
                  border: 'none',
                  borderRadius: 'var(--radius-md, 9px)',
                  background: isActive ? 'var(--ink-650, #15366a)' : 'transparent',
                  textAlign: 'left',
                  marginBottom: 2,
                }}
              >
                <span style={{ color: isActive ? 'var(--accent-green, #d4eecb)' : 'var(--text-muted-2, #7d96bb)', marginTop: 1, flexShrink: 0 }}>
                  <Icon name={r.icon} size={16} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontFamily: SANS,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: isActive ? 'var(--text-onink, #eaf4e4)' : 'var(--text-primary, #15366a)',
                    }}
                  >
                    {r.name}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontFamily: SANS,
                      fontSize: 10.5,
                      lineHeight: 1.3,
                      marginTop: 2,
                      color: isActive ? 'var(--text-onink-muted, #cfe0ee)' : 'var(--text-secondary, #5d7188)',
                    }}
                  >
                    {r.desc}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Selected report content */}
        <div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em', color: 'var(--text-primary, #15366a)' }}>
              {activeReport?.name}
            </div>
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', marginTop: 2 }}>
              {activeReport?.desc}
            </div>
          </div>

          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={fetchReport} />
          ) : (
            <ReportBody reportId={activeId} data={data} traceValue={traceValue} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── per-report rendering ───────────────────────────────────────────────── */

function ReportBody({ reportId, data, traceValue }) {
  switch (reportId) {
    case 'production':
      return <ProductionReport data={data} />;
    case 'wip':
      return <WipReport data={data} />;
    case 'furnace':
      return <FurnaceReport data={data} />;
    case 'scrap':
      return <ScrapReport data={data} />;
    case 'moFulfilment':
      return <MoFulfilmentReport data={data} />;
    case 'quality':
      return <QualityReport data={data} />;
    case 'traceability':
      return <TraceabilityReport data={data} traceValue={traceValue} />;
    case 'shift':
      return <ShiftReport data={data} />;
    case 'capacity':
      return <CapacityReport data={data} />;
    default:
      return <EmptyState message="Select a report." />;
  }
}

/* Report 1 — Production Output */
function ProductionReport({ data }) {
  const created = num(pick(data, 'uids_created', 'created', 'created_count'));
  const dispatched = num(pick(data, 'uids_dispatched', 'dispatched', 'dispatched_count'));
  const stations = asArray(pick(data, 'workstations', 'stations'), 'workstations', 'stations');
  const trend = asArray(pick(data, 'trend', 'daily', 'series'), 'trend', 'daily');
  const maxStation = Math.max(1, ...stations.map((s) => num(pick(s, 'pieces', 'count', 'throughput'))));
  const maxTrend = Math.max(1, ...trend.map((t) => num(pick(t, 'count', 'value', 'dispatched'))));

  const hasAny = created || dispatched || stations.length || trend.length;
  if (!hasAny) return <EmptyState message="No production data for the selected range." />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Metric label="UIDs created" value={created} />
        <Metric label="UIDs dispatched" value={dispatched} color="var(--status-success, #22a06b)" />
        <Metric label="Workstations" value={stations.length || '—'} />
      </div>

      {stations.length ? (
        <Panel title="Workstation throughput">
          {stations.map((s, i) => (
            <Bar
              key={pick(s, 'code', 'workstation', 'id') ?? i}
              label={pick(s, 'name', 'code', 'workstation') ?? `Station ${i + 1}`}
              value={num(pick(s, 'pieces', 'count', 'throughput'))}
              max={maxStation}
              color="var(--cycle-eat, #2d6fb5)"
            />
          ))}
        </Panel>
      ) : null}

      {trend.length ? (
        <Panel title="Output trend">
          {trend.map((t, i) => (
            <Bar
              key={pick(t, 'date', 'period', 'label') ?? i}
              label={String(pick(t, 'date', 'period', 'label') ?? i)}
              value={num(pick(t, 'count', 'value', 'dispatched'))}
              max={maxTrend}
            />
          ))}
        </Panel>
      ) : null}
    </div>
  );
}

/* Report 2 — WIP Summary */
function WipReport({ data }) {
  const byStorage = asArray(pick(data, 'by_storage', 'storage', 'locations'), 'by_storage', 'storage');
  const byStation = asArray(pick(data, 'by_station', 'stations', 'workstations'), 'by_station', 'stations');
  const ageBuckets = asArray(pick(data, 'age_distribution', 'age_buckets', 'ages'), 'age_distribution', 'age_buckets');
  const holds = asArray(pick(data, 'holds', 'on_hold', 'holds_by_reason'), 'holds', 'on_hold');
  const total = num(pick(data, 'total_wip', 'total', 'wip_count'));
  const avgCycle = pick(data, 'avg_cycle_time', 'avg_cycle_hours', 'average_cycle_time');

  const hasAny = byStorage.length || byStation.length || ageBuckets.length || holds.length || total;
  if (!hasAny) return <EmptyState message="No work in progress right now." />;

  const maxStorage = Math.max(1, ...byStorage.map((s) => num(pick(s, 'count', 'value'))));
  const maxAge = Math.max(1, ...ageBuckets.map((b) => num(pick(b, 'count', 'value'))));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Metric label="Total WIP" value={total || '—'} />
        <Metric label="Storage locations" value={byStorage.length || '—'} />
        <Metric label="Avg cycle time" value={fmt(avgCycle)} />
      </div>

      {byStorage.length ? (
        <Panel title="UIDs by storage location">
          {byStorage.map((s, i) => (
            <Bar
              key={pick(s, 'code', 'storage', 'name') ?? i}
              label={pick(s, 'name', 'code', 'storage') ?? `Loc ${i + 1}`}
              value={num(pick(s, 'count', 'value'))}
              max={maxStorage}
              color="var(--cycle-swan, #7a4fc0)"
            />
          ))}
        </Panel>
      ) : null}

      {ageBuckets.length ? (
        <Panel title="Age distribution of WIP">
          {ageBuckets.map((b, i) => (
            <Bar
              key={pick(b, 'bucket', 'label', 'range') ?? i}
              label={pick(b, 'bucket', 'label', 'range') ?? `Bucket ${i + 1}`}
              value={num(pick(b, 'count', 'value'))}
              max={maxAge}
              color="var(--status-warning, #d97a2b)"
            />
          ))}
        </Panel>
      ) : null}

      {holds.length ? (
        <Panel title="On hold by reason">
          <Table
            columns={[
              { key: 'reason', label: 'Reason', wrap: true },
              { key: 'count', label: 'UIDs', align: 'right' },
            ]}
            rows={holds.map((h, i) => ({
              id: i,
              reason: fmt(pick(h, 'reason', 'hold_reason', 'label')),
              count: num(pick(h, 'count', 'value')),
            }))}
            emptyMessage="Nothing on hold."
          />
        </Panel>
      ) : null}
    </div>
  );
}

/* Report 3 — Furnace Batch Log */
function FurnaceReport({ data }) {
  const batches = asArray(pick(data, 'batches', 'rows', 'log'), 'batches', 'rows');
  const totalBatches = num(pick(data, 'total_batches', 'count'), batches.length);
  const deviations = num(pick(data, 'deviations', 'deviation_count'), batches.filter((b) => pick(b, 'deviation_flag', 'deviation')).length);
  const utilisation = pick(data, 'utilisation', 'utilisation_pct', 'furnace_utilisation');
  const devRate = totalBatches ? Math.round((deviations / totalBatches) * 100) : 0;

  if (!batches.length && !totalBatches) return <EmptyState message="No furnace batches in the selected range." />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Metric label="Batches" value={totalBatches} />
        <Metric label="Deviations" value={deviations} color={deviations ? 'var(--status-danger, #e5484d)' : undefined} />
        <Metric label="Deviation rate" value={devRate} suffix="%" color={devRate > 10 ? 'var(--status-warning, #d97a2b)' : undefined} />
        <Metric label="Utilisation" value={utilisation != null ? num(utilisation) : '—'} suffix={utilisation != null ? '%' : undefined} />
      </div>

      <Panel title="Batch log">
        <Table
          columns={[
            { key: 'batch', label: 'Batch', mono: true },
            { key: 'step', label: 'Temper step', mono: true },
            { key: 'cycle', label: 'Cycle' },
            { key: 'uids', label: 'UIDs', align: 'right' },
            { key: 'target_temp', label: 'Tgt °C', align: 'right', mono: true },
            { key: 'actual_temp', label: 'Act °C', align: 'right', mono: true },
            { key: 'temp_dev', label: 'Δ°C', align: 'right', mono: true },
            { key: 'target_soak', label: 'Tgt soak', align: 'right', mono: true },
            { key: 'actual_soak', label: 'Act soak', align: 'right', mono: true },
            { key: 'soak_dev', label: 'Δ soak', align: 'right', mono: true },
            { key: 'flag', label: 'Flag' },
            { key: 'date', label: 'Date', mono: true },
            { key: 'operator', label: 'Operator' },
          ]}
          rows={batches.map((b, i) => ({ id: pick(b, 'batch_number', 'batch', 'id') ?? i, _b: b }))}
          renderCell={(key, row) => {
            const b = row._b;
            switch (key) {
              case 'batch': return fmt(pick(b, 'batch_number', 'batch', 'batch_no'));
              case 'step': return fmt(pick(b, 'tempering_step', 'step'));
              case 'cycle': { const c = pick(b, 'cycle_code', 'cycle'); return c ? <CycleBadge cycle={c} /> : '—'; }
              case 'uids': return fmt(pick(b, 'uid_count', 'uids'));
              case 'target_temp': return fmt(pick(b, 'target_temp', 'target_temperature'));
              case 'actual_temp': return fmt(pick(b, 'actual_temp', 'actual_temperature'));
              case 'temp_dev': return fmt(pick(b, 'temp_deviation', 'temperature_deviation'));
              case 'target_soak': return fmt(pick(b, 'target_soak', 'target_soak_time'));
              case 'actual_soak': return fmt(pick(b, 'actual_soak', 'actual_soak_time'));
              case 'soak_dev': return fmt(pick(b, 'soak_deviation'));
              case 'flag': {
                const flagged = pick(b, 'deviation_flag', 'deviation', 'out_of_tolerance');
                return flagged ? <StatusPill status="fail" label="DEVIATION" /> : <StatusPill status="pass" label="OK" />;
              }
              case 'date': return fmt(pick(b, 'date', 'run_date', 'created_at'));
              case 'operator': return fmt(pick(b, 'operator', 'operator_name'));
              default: return '—';
            }
          }}
          emptyMessage="No batches match the selected filters."
        />
      </Panel>
    </div>
  );
}

/* Report 4 — Scrap and Yield */
function ScrapReport({ data }) {
  const inputLen = num(pick(data, 'input_length_mm', 'total_input_length', 'input_length'));
  const outputLen = num(pick(data, 'output_length_mm', 'total_output_length', 'output_length'));
  const scrapLen = num(pick(data, 'scrap_length_mm', 'total_scrap_length', 'scrap_length'));
  const scrapKg = pick(data, 'scrap_weight_kg', 'scrap_kg', 'scrap_weight');
  const yieldPct = pick(data, 'yield_pct', 'yield_percentage', 'yield');
  const byReason = asArray(pick(data, 'scrap_by_reason', 'by_reason', 'reasons'), 'scrap_by_reason', 'by_reason');
  const byPattern = asArray(pick(data, 'yield_by_pattern', 'patterns', 'by_pattern'), 'yield_by_pattern', 'patterns');
  const trend = asArray(pick(data, 'scrap_trend', 'trend'), 'scrap_trend', 'trend');

  const computedYield = yieldPct != null ? num(yieldPct) : inputLen ? Math.round((outputLen / inputLen) * 100) : null;
  const hasAny = inputLen || outputLen || scrapLen || byReason.length || byPattern.length;
  if (!hasAny) return <EmptyState message="No converting / scrap data for the selected range." />;

  const maxReason = Math.max(1, ...byReason.map((r) => num(pick(r, 'length', 'count', 'value'))));
  const maxTrend = Math.max(1, ...trend.map((t) => num(pick(t, 'scrap', 'value', 'count'))));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Metric label="Input length" value={inputLen ? inputLen.toLocaleString() : '—'} suffix="mm" />
        <Metric label="Output length" value={outputLen ? outputLen.toLocaleString() : '—'} suffix="mm" />
        <Metric label="Scrap length" value={scrapLen ? scrapLen.toLocaleString() : '—'} suffix="mm" color="var(--status-danger, #e5484d)" />
        <Metric label="Scrap weight" value={scrapKg != null ? num(scrapKg) : '—'} suffix={scrapKg != null ? 'kg' : undefined} />
        <Metric label="Yield" value={computedYield ?? '—'} suffix={computedYield != null ? '%' : undefined} color="var(--status-success, #22a06b)" />
      </div>

      {byReason.length ? (
        <Panel title="Scrap by reason">
          {byReason.map((r, i) => (
            <Bar
              key={pick(r, 'reason', 'label') ?? i}
              label={fmt(pick(r, 'reason', 'label'))}
              value={num(pick(r, 'length', 'count', 'value'))}
              max={maxReason}
              color="var(--status-danger, #e5484d)"
              valueLabel={num(pick(r, 'length', 'count', 'value')).toLocaleString()}
            />
          ))}
        </Panel>
      ) : null}

      {byPattern.length ? (
        <Panel title="Yield per conversion pattern">
          <Table
            columns={[
              { key: 'pattern', label: 'Pattern' },
              { key: 'input', label: 'Input mm', align: 'right', mono: true },
              { key: 'output', label: 'Output mm', align: 'right', mono: true },
              { key: 'yield', label: 'Yield %', align: 'right', mono: true },
            ]}
            rows={byPattern.map((p, i) => ({
              id: i,
              pattern: fmt(pick(p, 'pattern', 'name', 'code')),
              input: num(pick(p, 'input_length', 'input')).toLocaleString(),
              output: num(pick(p, 'output_length', 'output')).toLocaleString(),
              yield: fmt(pick(p, 'yield_pct', 'yield')),
            }))}
          />
        </Panel>
      ) : null}

      {trend.length ? (
        <Panel title="Scrap trend">
          {trend.map((t, i) => (
            <Bar
              key={pick(t, 'date', 'period') ?? i}
              label={String(pick(t, 'date', 'period', 'label') ?? i)}
              value={num(pick(t, 'scrap', 'value', 'count'))}
              max={maxTrend}
              color="var(--status-warning, #d97a2b)"
            />
          ))}
        </Panel>
      ) : null}
    </div>
  );
}

/* Report 5 — MO Fulfilment */
function MoFulfilmentReport({ data }) {
  const mos = asArray(pick(data, 'mos', 'orders', 'rows'), 'mos', 'orders');
  const overdue = num(pick(data, 'overdue', 'overdue_count'), mos.filter((m) => pick(m, 'overdue')).length);
  const atRisk = num(pick(data, 'at_risk', 'with_holds'), mos.filter((m) => num(pick(m, 'on_hold', 'holds'))).length);
  const dispatchTrend = asArray(pick(data, 'dispatch_trend', 'trend'), 'dispatch_trend', 'trend');

  if (!mos.length && !dispatchTrend.length) return <EmptyState message="No manufacturing orders to report." />;

  const maxTrend = Math.max(1, ...dispatchTrend.map((t) => num(pick(t, 'dispatched', 'count', 'value'))));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Metric label="Open MOs" value={mos.length || '—'} />
        <Metric label="Overdue" value={overdue} color={overdue ? 'var(--status-danger, #e5484d)' : undefined} />
        <Metric label="At risk (holds)" value={atRisk} color={atRisk ? 'var(--status-warning, #d97a2b)' : undefined} />
      </div>

      <Panel title="Manufacturing orders">
        <Table
          columns={[
            { key: 'mo', label: 'MO', mono: true },
            { key: 'customer', label: 'Customer' },
            { key: 'required', label: 'Req', align: 'right', mono: true },
            { key: 'linked', label: 'Linked', align: 'right', mono: true },
            { key: 'dispatched', label: 'Dispatched', align: 'right', mono: true },
            { key: 'remaining', label: 'Remaining', align: 'right', mono: true },
            { key: 'progress', label: '% complete' },
            { key: 'status', label: 'Status' },
          ]}
          rows={mos.map((m, i) => ({ id: pick(m, 'mo_number', 'mo', 'id') ?? i, _m: m }))}
          renderCell={(key, row) => {
            const m = row._m;
            const required = num(pick(m, 'required_qty', 'required', 'qty'));
            const dispatched = num(pick(m, 'dispatched', 'uids_dispatched'));
            const remaining = pick(m, 'remaining') ?? Math.max(0, required - dispatched);
            const pct = pick(m, 'pct_complete', 'percent_complete') ?? (required ? Math.round((dispatched / required) * 100) : 0);
            switch (key) {
              case 'mo': return fmt(pick(m, 'mo_number', 'mo', 'code'));
              case 'customer': return fmt(pick(m, 'customer', 'customer_name'));
              case 'required': return required;
              case 'linked': return fmt(pick(m, 'linked_uids', 'linked'));
              case 'dispatched': return dispatched;
              case 'remaining': return remaining;
              case 'progress':
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
                    <div style={{ flex: 1, height: 8, background: 'var(--bg-muted, #f4f7f2)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, num(pct))}%`, height: '100%', background: 'var(--status-success, #22a06b)' }} />
                    </div>
                    <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--text-secondary, #5d7188)' }}>{num(pct)}%</span>
                  </div>
                );
              case 'status': {
                if (pick(m, 'overdue')) return <StatusPill status="fail" label="OVERDUE" />;
                const st = pick(m, 'status');
                return st ? <StatusPill status={st} label={st} /> : '—';
              }
              default: return '—';
            }
          }}
          emptyMessage="No MOs match the selected filters."
        />
      </Panel>

      {dispatchTrend.length ? (
        <Panel title="Dispatch trend">
          {dispatchTrend.map((t, i) => (
            <Bar
              key={pick(t, 'date', 'period') ?? i}
              label={String(pick(t, 'date', 'period', 'label') ?? i)}
              value={num(pick(t, 'dispatched', 'count', 'value'))}
              max={maxTrend}
            />
          ))}
        </Panel>
      ) : null}
    </div>
  );
}

/* Report 6 — Quality Report */
function QualityReport({ data }) {
  const steps = asArray(pick(data, 'by_step', 'steps', 'qc_steps'), 'by_step', 'steps');
  const failures = asArray(pick(data, 'failures', 'failures_by_reason', 'by_reason'), 'failures', 'failures_by_reason');
  const passRate = pick(data, 'overall_pass_rate', 'pass_rate');
  const reworkRate = pick(data, 'rework_rate', 'rework_frequency');
  const furnaceDevRate = pick(data, 'furnace_deviation_rate', 'deviation_rate');

  const hasAny = steps.length || failures.length || passRate != null;
  if (!hasAny) return <EmptyState message="No QC activity for the selected range." />;

  const maxFail = Math.max(1, ...failures.map((f) => num(pick(f, 'count', 'value'))));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Metric label="Overall pass rate" value={passRate != null ? num(passRate) : '—'} suffix={passRate != null ? '%' : undefined} color="var(--status-success, #22a06b)" />
        <Metric label="Rework rate" value={reworkRate != null ? num(reworkRate) : '—'} suffix={reworkRate != null ? '%' : undefined} color={num(reworkRate) > 5 ? 'var(--status-warning, #d97a2b)' : undefined} />
        <Metric label="Furnace deviation" value={furnaceDevRate != null ? num(furnaceDevRate) : '—'} suffix={furnaceDevRate != null ? '%' : undefined} />
      </div>

      {steps.length ? (
        <Panel title="Pass / fail rate per QC step">
          {steps.map((s, i) => (
            <PassFailBar
              key={pick(s, 'step', 'name', 'code') ?? i}
              label={fmt(pick(s, 'step_name', 'step', 'name', 'code'))}
              pass={num(pick(s, 'pass', 'passed', 'pass_count'))}
              fail={num(pick(s, 'fail', 'failed', 'fail_count'))}
            />
          ))}
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontFamily: MONO, fontSize: 10 }}>
            <Legend color="var(--status-success, #22a06b)" label="PASS" />
            <Legend color="var(--status-danger, #e5484d)" label="FAIL" />
          </div>
        </Panel>
      ) : null}

      {failures.length ? (
        <Panel title="QC failures by step / reason">
          {failures.map((f, i) => (
            <Bar
              key={pick(f, 'reason', 'step', 'label') ?? i}
              label={fmt(pick(f, 'label', 'reason', 'step'))}
              value={num(pick(f, 'count', 'value'))}
              max={maxFail}
              color="var(--status-danger, #e5484d)"
            />
          ))}
        </Panel>
      ) : null}
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-secondary, #5d7188)' }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}

/* Report 7 — Material Traceability */
function TraceabilityReport({ data, traceValue }) {
  if (!traceValue || !traceValue.trim()) {
    return (
      <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ color: 'var(--text-muted, #9bb4d4)', display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
          <Icon name="search" size={26} />
        </div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)' }}>
          Enter a heat number, supplier, Faridabad batch, or receiving event above to trace its UIDs.
        </div>
      </div>
    );
  }

  const uids = asArray(pick(data, 'uids', 'rows', 'results'), 'uids', 'rows');
  if (!uids.length) return <EmptyState message={`No UIDs found for "${traceValue}".`} />;

  const dispatched = uids.filter((u) => String(pick(u, 'status', 'current_status') || '').toLowerCase().includes('dispatch')).length;
  const scrapped = uids.filter((u) => String(pick(u, 'status', 'current_status') || '').toLowerCase().includes('scrap')).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Metric label="UIDs traced" value={uids.length} />
        <Metric label="Dispatched" value={dispatched} color="var(--status-success, #22a06b)" />
        <Metric label="Scrapped" value={scrapped} color={scrapped ? 'var(--status-danger, #e5484d)' : undefined} />
      </div>

      <Panel title={`UIDs from "${traceValue}"`}>
        <Table
          columns={[
            { key: 'uid', label: 'UID', mono: true },
            { key: 'status', label: 'Status' },
            { key: 'location', label: 'Current location' },
            { key: 'mo', label: 'MO', mono: true },
            { key: 'dispatch_date', label: 'Dispatch date', mono: true },
            { key: 'history', label: 'Step history', wrap: true },
          ]}
          rows={uids.map((u, i) => ({ id: pick(u, 'uid_code', 'uid', 'id') ?? i, _u: u }))}
          renderCell={(key, row) => {
            const u = row._u;
            switch (key) {
              case 'uid': return fmt(pick(u, 'uid_code', 'uid', 'code'));
              case 'status': { const s = pick(u, 'status', 'current_status'); return s ? <StatusPill status={s} label={s} /> : '—'; }
              case 'location': return fmt(pick(u, 'current_location', 'location', 'storage_code'));
              case 'mo': return fmt(pick(u, 'mo_number', 'mo'));
              case 'dispatch_date': return fmt(pick(u, 'dispatch_date', 'dispatched_at'));
              case 'history': return fmt(pick(u, 'step_history_summary', 'history', 'last_step'));
              default: return '—';
            }
          }}
        />
      </Panel>
    </div>
  );
}

/* Report 8 — Shift Performance */
function ShiftReport({ data }) {
  const shifts = asArray(pick(data, 'shifts', 'rows', 'by_shift'), 'shifts', 'rows');
  if (!shifts.length) return <EmptyState message="No shift data for the selected range." />;

  const maxOutput = Math.max(1, ...shifts.map((s) => num(pick(s, 'output', 'pieces', 'count'))));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Panel title="Output by shift">
        {shifts.map((s, i) => (
          <Bar
            key={pick(s, 'shift', 'name', 'id') ?? i}
            label={fmt(pick(s, 'shift_name', 'shift', 'name', 'date'))}
            value={num(pick(s, 'output', 'pieces', 'count'))}
            max={maxOutput}
            color="var(--cycle-eat, #2d6fb5)"
          />
        ))}
      </Panel>

      <Panel title="Shift detail">
        <Table
          columns={[
            { key: 'shift', label: 'Shift' },
            { key: 'date', label: 'Date', mono: true },
            { key: 'staff', label: 'Staff', align: 'right', mono: true },
            { key: 'output', label: 'Output', align: 'right', mono: true },
            { key: 'per_head', label: 'Per head', align: 'right', mono: true },
          ]}
          rows={shifts.map((s, i) => {
            const output = num(pick(s, 'output', 'pieces', 'count'));
            const staff = num(pick(s, 'staff', 'staff_count', 'headcount'));
            return {
              id: i,
              shift: fmt(pick(s, 'shift_name', 'shift', 'name')),
              date: fmt(pick(s, 'date')),
              staff: staff || '—',
              output,
              per_head: staff ? (output / staff).toFixed(1) : '—',
            };
          })}
        />
      </Panel>
    </div>
  );
}

/* Report 9 — Capacity Utilisation */
function CapacityReport({ data }) {
  const stations = asArray(pick(data, 'workstations', 'stations', 'rows'), 'workstations', 'stations');
  if (!stations.length) return <EmptyState message="No capacity data available." />;

  const overall = pick(data, 'overall_utilisation', 'utilisation_pct');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {overall != null ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <Metric label="Overall utilisation" value={num(overall)} suffix="%" />
          <Metric label="Workstations" value={stations.length} />
        </div>
      ) : null}

      <Panel title="Utilisation by workstation (% of capacity used)">
        {stations.map((s, i) => {
          const used = num(pick(s, 'used', 'used_capacity', 'load'));
          const cap = num(pick(s, 'capacity', 'total_capacity'), 0);
          const pct = pick(s, 'utilisation_pct', 'utilisation') != null
            ? num(pick(s, 'utilisation_pct', 'utilisation'))
            : cap ? Math.round((used / cap) * 100) : 0;
          const color = pct >= 90 ? 'var(--status-danger, #e5484d)' : pct >= 70 ? 'var(--status-warning, #d97a2b)' : 'var(--status-success, #22a06b)';
          return (
            <Bar
              key={pick(s, 'code', 'name', 'id') ?? i}
              label={fmt(pick(s, 'name', 'code', 'workstation'))}
              value={pct}
              max={100}
              color={color}
              valueLabel={`${pct}%`}
            />
          );
        })}
      </Panel>
    </div>
  );
}

/* ── shared states ──────────────────────────────────────────────────────── */

function LoadingState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card" style={{ padding: 18, height: 72, opacity: 0.5 }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted, #9bb4d4)' }}>loading…</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 18, height: 160, opacity: 0.5 }} />
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ color: 'var(--text-muted, #9bb4d4)', display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
        <Icon name="doc" size={26} />
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)' }}>{message}</div>
    </div>
  );
}

function ErrorState({ error, onRetry }) {
  return (
    <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
      <div style={{ color: 'var(--status-danger, #e5484d)', display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
        <Icon name="alert" size={26} />
      </div>
      <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>
        Could not load this report
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
        {error?.message || 'Something went wrong.'}
      </div>
      <button className="btn btn-primary btn-sm" type="button" onClick={onRetry} style={{ marginTop: 14 }}>
        <Icon name="refresh" size={14} />
        Retry
      </button>
    </div>
  );
}
