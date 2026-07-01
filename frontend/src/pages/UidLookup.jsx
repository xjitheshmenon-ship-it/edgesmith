import { useState, useMemo } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useApp } from '../store/AppContext';
import { useAuth } from '../store/AuthContext';
import { uidsApi } from '../api/uids';
import UidDetail from './UidDetail';
import ServiceLookup from './ServiceLookup';
import Icon from '../components/common/Icon';
import { CycleBadge, StatusPill, PriorityBadge } from '../components/common/Badges';

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";
const T_PRIMARY = 'var(--text-primary, #15366a)';
const T_SECONDARY = 'var(--text-secondary, #5d7188)';
const T_MUTED = 'var(--text-muted, #9bb4d4)';

const STATUS_OPTS = [['all', 'All'], ['active', 'Active'], ['hold', 'On Hold'], ['done', 'Done'], ['scrap', 'Scrap']];
const CYCLE_OPTS = [['all', 'All cycles'], ['EAT', 'EAT'], ['SWAN', 'SWAN'], ['OVEN', 'OVEN']];
const PRIORITY_OPTS = [['all', 'All'], ['High', 'High'], ['Normal', 'Normal'], ['Low', 'Low']];

function Select({ value, onChange, options }) {
  return (
    <select className="form-select" style={{ height: 34, fontSize: 12, flex: '1 1 auto', minWidth: 96 }} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function ResultRow({ u, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 5, padding: '9px 11px',
      borderRadius: 'var(--radius-md, 9px)', border: `1.5px solid ${active ? 'var(--status-blue, #2d6fb5)' : 'var(--border-input, #d6e0d2)'}`,
      background: active ? 'var(--bg-soft-blue, #eef4fb)' : 'var(--bg-card, #fff)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: T_PRIMARY }}>{u.uid_code}</span>
        {u.cycle_code && <CycleBadge cycle={u.cycle_code} />}
        {u.priority === 'High' && <PriorityBadge priority="High" />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: T_SECONDARY }}>{u.size_mm ? `${u.size_mm}mm` : '—'} · step {u.current_step ?? '—'}</span>
        <StatusPill status={u.status} />
      </div>
    </button>
  );
}

function EmptyDetail() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: T_MUTED, padding: 40 }}>
      <Icon name="tag" size={30} color={T_MUTED} />
      <div style={{ fontFamily: SANS, fontSize: 13 }}>Search for a UID or select one from the list</div>
    </div>
  );
}

function UidLookupMain() {
  const { location } = useApp();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [cycle, setCycle] = useState('all');
  const [priority, setPriority] = useState('all');
  const [selected, setSelected] = useState(null);

  const filters = useMemo(() => {
    const f = { location, per_page: 60 };
    if (search.trim().length >= 2) f.search = search.trim();
    if (status !== 'all') f.status = status;
    if (cycle !== 'all') f.cycle = cycle;
    if (priority !== 'all') f.priority = priority;
    return f;
  }, [location, search, status, cycle, priority]);

  const { data, loading } = usePolling(() => uidsApi.list(filters).then((r) => r.data), [JSON.stringify(filters)]);
  const rows = Array.isArray(data) ? data : Array.isArray(data?.uids) ? data.uids : data?.rows || [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', minHeight: 'calc(100vh - 64px)' }}>
      {/* Left — search + filters + results */}
      <div style={{ borderRight: '1px solid var(--border-card, #e3ebde)', padding: '18px 14px', overflowY: 'auto', maxHeight: 'calc(100vh - 64px)' }}>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, letterSpacing: '-0.03em', color: T_PRIMARY, marginBottom: 12 }}>UID Lookup</div>
        <input className="form-input" placeholder="Search UID · MO · batch · heat…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          <Select value={status} onChange={setStatus} options={STATUS_OPTS} />
          <Select value={cycle} onChange={setCycle} options={CYCLE_OPTS} />
          <Select value={priority} onChange={setPriority} options={PRIORITY_OPTS} />
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: T_MUTED, margin: '12px 2px 8px' }}>{rows.length} result{rows.length === 1 ? '' : 's'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((u) => <ResultRow key={u.uid_code} u={u} active={selected === u.uid_code} onClick={() => setSelected(u.uid_code)} />)}
          {!rows.length && (
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, padding: '8px 2px' }}>
              {loading ? 'Loading…' : search.trim().length >= 2 ? `No UID found for “${search.trim()}”` : 'No UIDs match the filters.'}
            </div>
          )}
        </div>
      </div>

      {/* Right — detail (reuses the full UID detail with role-gated actions) */}
      <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 64px)' }}>
        {selected ? <UidDetail key={selected} code={selected} /> : <EmptyDetail />}
      </div>
    </div>
  );
}

export default function UidLookup() {
  const { isService } = useAuth();
  // Service role gets the search + Final Inspection Report experience only.
  if (isService) return <ServiceLookup />;
  return <UidLookupMain />;
}
