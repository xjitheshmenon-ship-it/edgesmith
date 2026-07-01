import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Topbar from './Topbar';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import { usePolling } from '../../hooks/usePolling';
import { alertsApi } from '../../api/resources';
import { uidsApi } from '../../api/uids';
import { useApp } from '../../store/AppContext';

const MONO = "'IBM Plex Mono', monospace";
const FACTORY_STYLE = {
  faridabad: { color: '#d97a2b', label: 'Faridabad' },
  dharmapuri: { color: '#3b82f6', label: 'Dharmapuri' },
};

/* Always-visible indicator of which factory the (global) toggle is showing.
   The factory toggle re-scopes every Overview page at once, so this makes the
   active factory unmistakable regardless of which page you're on. */
function FactoryBanner() {
  const { location } = useApp();
  const f = FACTORY_STYLE[location] || FACTORY_STYLE.dharmapuri;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0,
      padding: '6px 20px', borderBottom: `1px solid ${f.color}33`,
      borderLeft: `4px solid ${f.color}`, background: `${f.color}14`,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.color, boxShadow: `0 0 0 3px ${f.color}22` }} />
      <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em', color: f.color, fontWeight: 700 }}>
        VIEWING · {f.label.toUpperCase()}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.04em', color: 'var(--text-secondary, #5d7188)' }}>
        — the factory toggle scopes all Overview pages to this factory
      </span>
    </div>
  );
}

/* Maps alert codes/types → the nav badge-count keys used in nav.js. Best-effort:
   unknown alert types simply don't increment a badge. */
function deriveCounts(alerts) {
  const c = {};
  const bump = (k) => { c[k] = (c[k] || 0) + 1; };
  for (const a of alerts) {
    const t = (a.type || a.code || a.category || '').toLowerCase();
    if (t.includes('hold')) bump('onHoldUids');
    if (t.includes('dispatch')) bump('pendingDispatch');
    if (t.includes('arrival') || t.includes('receiv')) bump('expectedArrivals');
    if (t.includes('qc')) bump('pendingQc');
    if (t.includes('badge') || t.includes('expir')) bump('expiringBadges');
    if (t.includes('mo')) bump('openMos');
    if (t.includes('batch')) bump('activeBatches');
    if (t.includes('unassigned') || t.includes('job')) bump('unassignedJobs');
  }
  c.dashboardAlerts = alerts.length;
  return c;
}

const pick = (obj, ...keys) => {
  for (const k of keys) if (obj && obj[k] != null) return obj[k];
  return '—';
};

export default function AppShell() {
  const [counts, setCounts] = useState({});
  const [bar, setBar] = useState({ active: '—', hold: '—', furnace: '—' });
  const [alertCount, setAlertCount] = useState(0);

  usePolling(async () => {
    try {
      const res = await alertsApi.list();
      const alerts = res.data || [];
      setCounts(deriveCounts(alerts));
      setAlertCount(alerts.length);
    } catch { /* keep last values on a transient error */ }
    try {
      const w = (await uidsApi.wipSummary()).data || {};
      setBar({
        active: pick(w, 'active', 'active_uids', 'total_active'),
        hold: pick(w, 'on_hold', 'hold', 'on_hold_uids'),
        furnace: pick(w, 'in_furnace', 'furnace', 'furnace_running'),
      });
    } catch { /* leave bar as-is */ }
    return null;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', overflow: 'hidden', background: 'var(--bg-page, #eef2ec)', color: 'var(--text-primary, #15366a)' }}>
      <Topbar alertCount={alertCount} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <Sidebar counts={counts} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          <FactoryBanner />
          <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
            <Outlet />
          </main>
        </div>
      </div>
      <StatusBar active={bar.active} hold={bar.hold} furnace={bar.furnace} />
    </div>
  );
}
