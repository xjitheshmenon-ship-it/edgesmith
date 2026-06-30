import { usePolling } from '../hooks/usePolling';
import { uidsApi } from '../api/uids';
import { alertsApi } from '../api/resources';

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";

function Metric({ label, value, color }) {
  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>{label}</div>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 34, letterSpacing: '-0.03em', color: color || 'var(--text-primary, #15366a)', marginTop: 6, lineHeight: 1 }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

const SEV = { critical: '#e5484d', warning: '#d97a2b', info: '#f0c674' };

export default function Dashboard() {
  const { data, loading } = usePolling(async () => {
    const [wip, alerts] = await Promise.all([
      uidsApi.wipSummary().then((r) => r.data).catch(() => ({})),
      alertsApi.list().then((r) => r.data).catch(() => []),
    ]);
    return { wip: wip || {}, alerts: alerts || [] };
  });

  const wip = data?.wip || {};
  const alerts = data?.alerts || [];
  const g = (...keys) => { for (const k of keys) if (wip[k] != null) return wip[k]; return null; };

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>Dashboard</div>
      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
        Live production overview {loading ? '· loading…' : ''}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 20 }}>
        <Metric label="Active UIDs" value={g('active', 'active_uids', 'total_active')} />
        <Metric label="On Hold" value={g('on_hold', 'hold', 'on_hold_uids')} color="#e5484d" />
        <Metric label="In Furnace" value={g('in_furnace', 'furnace', 'furnace_running')} color="#d97a2b" />
        <Metric label="Dispatched Today" value={g('dispatched_today', 'dispatched')} color="#22a06b" />
      </div>

      <div className="card" style={{ marginTop: 18, padding: '18px 20px' }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)', marginBottom: 12 }}>Alerts</div>
        {alerts.length === 0 ? (
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--text-secondary, #5d7188)' }}>No active alerts.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {alerts.slice(0, 12).map((a, i) => (
              <div key={a.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 0', borderTop: i ? '1px solid #eef2ea' : 'none' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: SEV[(a.severity || 'info').toLowerCase()] || SEV.info, flexShrink: 0 }} />
                <span style={{ flex: 1, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--text-primary, #15366a)' }}>
                  {a.message || a.text || a.title || a.code}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted, #9bb4d4)' }}>{a.location || a.type || ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
