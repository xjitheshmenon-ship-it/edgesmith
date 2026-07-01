import { useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { activityApi } from '../api/resources';
import Icon from '../components/common/Icon';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

const TH = { fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)', textAlign: 'left', padding: '0 12px 10px 0', whiteSpace: 'nowrap' };
const TD = { padding: '10px 12px 10px 0', fontFamily: SANS, fontSize: 12.5, color: 'var(--text-primary, #15366a)', borderTop: '1px solid #eef2ea', verticalAlign: 'top' };

function fmtWhen(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}
function fmtDur(s) {
  const n = Number(s);
  if (!n || Number.isNaN(n)) return '—';
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), ss = n % 60;
  return `${h ? h + 'h ' : ''}${m}m ${ss}s`;
}

export default function ActivityLog() {
  const [factory, setFactory] = useState('');
  const [search, setSearch] = useState('');

  const { data, loading, error, refetch } = usePolling(
    () => activityApi.list({ factory: factory || undefined, ref: search.trim() || undefined, limit: 200 }).then((r) => r.data),
    [factory, search]
  );
  const rows = Array.isArray(data) ? data : [];

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>Activity Log</div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
            Who closed each operation, on which piece, with what inputs{loading && !data ? ' · loading…' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="form-select" style={{ height: 36 }} value={factory} onChange={(e) => setFactory(e.target.value)}>
            <option value="">Both factories</option>
            <option value="dharmapuri">Dharmapuri</option>
            <option value="faridabad">Faridabad</option>
          </select>
          <input className="form-input" style={{ height: 36, width: 200 }} placeholder="Search UID / #item" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn btn-sm" onClick={refetch}><Icon name="refresh" size={14} />Refresh</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18, padding: '16px 18px', overflowX: 'auto' }}>
        {error ? (
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--status-danger, #e5484d)' }}>Could not load the activity log.</div>
        ) : rows.length === 0 ? (
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', padding: '14px 0' }}>
            {loading ? 'Loading…' : 'No operations closed yet for this filter.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>When</th>
                <th style={TH}>Who</th>
                <th style={TH}>Factory</th>
                <th style={TH}>Piece</th>
                <th style={TH}>Step · Operation</th>
                <th style={TH}>Inputs</th>
                <th style={{ ...TH, textAlign: 'right' }}>Work time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...TD, fontFamily: MONO, fontSize: 11.5, whiteSpace: 'nowrap' }}>{fmtWhen(r.closed_at)}</td>
                  <td style={{ ...TD, fontWeight: 600 }}>{r.actor || 'Unknown'}</td>
                  <td style={TD}>
                    <span className="badge" style={{ background: r.factory === 'faridabad' ? 'rgba(217,122,43,0.14)' : 'rgba(59,130,246,0.12)', color: r.factory === 'faridabad' ? '#c0762b' : '#2563eb' }}>
                      {r.factory === 'faridabad' ? 'Faridabad' : 'Dharmapuri'}
                    </span>
                  </td>
                  <td style={{ ...TD, fontFamily: MONO, fontSize: 11.5 }}>{r.ref || '—'}</td>
                  <td style={TD}>{r.step_number != null ? `${r.step_number} · ` : ''}{r.operation_name || '—'}</td>
                  <td style={{ ...TD, fontFamily: MONO, fontSize: 11.5, color: 'var(--text-secondary, #5d7188)' }}>{r.inputs || '—'}</td>
                  <td style={{ ...TD, fontFamily: MONO, fontSize: 11.5, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtDur(r.net_work_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
