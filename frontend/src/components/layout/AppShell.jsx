import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Topbar from './Topbar';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import { usePolling } from '../../hooks/usePolling';
import { alertsApi } from '../../api/resources';
import { uidsApi } from '../../api/uids';

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
        <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
          <Outlet />
        </main>
      </div>
      <StatusBar active={bar.active} hold={bar.hold} furnace={bar.furnace} />
    </div>
  );
}
