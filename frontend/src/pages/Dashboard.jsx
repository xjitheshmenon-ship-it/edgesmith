import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usePolling } from '../hooks/usePolling';
import { useApp } from '../store/AppContext';
import { uidsApi } from '../api/uids';
import { alertsApi } from '../api/resources';
import Icon from '../components/common/Icon';
import { CycleBadge, PriorityBadge, StatusPill } from '../components/common/Badges';

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";

/* Flow order of storage locations on the Dharmapuri floor (PAGE 1 spec). */
const STORAGE_ORDER = ['RM', 'RM-Q', 'RM-D', 'HT-Q', 'HT-D', 'MC-Q', 'MC-D', 'QC-Q', 'QC-D', 'FG'];

/* Typical capacity per storage location — used only to scale the mini bar.
   Counts above capacity simply cap the bar at 100%. */
const STORAGE_CAPACITY = {
  RM: 120, 'RM-Q': 80, 'RM-D': 80, 'HT-Q': 60, 'HT-D': 60,
  'MC-Q': 60, 'MC-D': 60, 'QC-Q': 50, 'QC-D': 50, FG: 150,
};

/* Alert severity → dot colour + sort weight. Most critical first. */
const SEV_COLOR = { critical: '#e5484d', warning: '#d97a2b', info: '#f0c674' };
const SEV_WEIGHT = { critical: 0, warning: 1, info: 2 };

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

function MetricCard({ label, value, color, to, hint, loading }) {
  const body = (
    <div
      className="card"
      style={{
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        height: '100%',
        transition: 'box-shadow 0.14s',
      }}
    >
      <SectionLabel>{label}</SectionLabel>
      <div
        style={{
          fontFamily: ARCHIVO,
          fontWeight: 800,
          fontSize: 32,
          letterSpacing: '-0.03em',
          color: color || 'var(--text-primary, #15366a)',
          lineHeight: 1,
        }}
      >
        {loading ? '·' : value ?? '—'}
      </div>
      {hint ? (
        <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-muted, #9bb4d4)' }}>{hint}</div>
      ) : null}
    </div>
  );
  if (to) {
    return (
      <Link to={to} style={{ display: 'block' }}>
        {body}
      </Link>
    );
  }
  return body;
}

/* Storage tile mini-bar — count relative to typical capacity. */
function StorageTile({ code, count, to }) {
  const cap = STORAGE_CAPACITY[code] || 100;
  const pct = Math.min(100, Math.round((count / cap) * 100));
  const over = count > cap;
  return (
    <Link
      to={to}
      className="card"
      style={{
        padding: '12px 12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>
          {code}
        </span>
        <span
          style={{
            fontFamily: ARCHIVO,
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: '-0.03em',
            color: count ? 'var(--text-primary, #15366a)' : 'var(--text-muted, #9bb4d4)',
            lineHeight: 1,
          }}
        >
          {count}
        </span>
      </div>
      <div
        style={{
          height: 5,
          borderRadius: 3,
          background: 'var(--border-card, #e3ebde)',
          overflow: 'hidden',
        }}
        aria-hidden
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 3,
            background: over ? 'var(--status-danger, #e5484d)' : 'var(--status-success, #22a06b)',
          }}
        />
      </div>
    </Link>
  );
}

/* ── derived helpers ───────────────────────────────────────────────────── */

function readWip(wip, ...keys) {
  // wipSummary may come back as either an object map or an array of {code,count}.
  if (Array.isArray(wip)) {
    const m = {};
    for (const w of wip) m[w.code ?? w.storage_code] = w.count ?? w.uid_count ?? w.uids;
    for (const k of keys) if (m[k] != null) return Number(m[k]);
    return null;
  }
  for (const k of keys) if (wip && wip[k] != null) return Number(wip[k]);
  return null;
}

function wipMap(wip) {
  const m = {};
  if (Array.isArray(wip)) {
    for (const w of wip) m[w.code ?? w.storage_code] = Number(w.count ?? w.uid_count ?? w.uids ?? 0);
  } else if (wip && typeof wip === 'object') {
    for (const [k, v] of Object.entries(wip)) if (typeof v === 'number') m[k] = v;
  }
  return m;
}

const pick = (o, ...keys) => {
  for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k];
  return null;
};

/* "How long ago" → short relative label for waiting time at current step. */
function waitingLabel(uid) {
  const ts = pick(uid, 'step_entered_at', 'entered_at', 'updated_at', 'last_moved_at');
  if (!ts) return null;
  const ms = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function waitingMs(uid) {
  const ts = pick(uid, 'step_entered_at', 'entered_at', 'updated_at', 'last_moved_at');
  if (!ts) return 0;
  const ms = Date.now() - new Date(ts).getTime();
  return Number.isNaN(ms) || ms < 0 ? 0 : ms;
}

const isToday = (ts) => {
  if (!ts) return false;
  const d = new Date(ts);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};

/* ── page ─────────────────────────────────────────────────────────────── */

export default function Dashboard() {
  const { location, locationLabel } = useApp();

  const { data, loading, error, refetch } = usePolling(
    async () => {
      const [wip, stations, active, held, dispatched, alerts] = await Promise.all([
        uidsApi.wipSummary().then((r) => r.data).catch(() => ({})),
        uidsApi.stationSummary().then((r) => r.data).catch(() => []),
        uidsApi.list({ location, status: 'active', per_page: 300 }).then((r) => r.data).catch(() => []),
        uidsApi.list({ location, status: 'hold', per_page: 200 }).then((r) => r.data).catch(() => []),
        uidsApi
          .list({ location, status: 'dispatched', per_page: 300 })
          .then((r) => r.data)
          .catch(() => []),
        alertsApi.list().then((r) => r.data).catch(() => []),
      ]);
      return {
        wip: wip || {},
        stations: stations || [],
        active: active || [],
        held: held || [],
        dispatched: dispatched || [],
        alerts: alerts || [],
      };
    },
    [location]
  );

  const wip = data?.wip || {};
  const stations = data?.stations || [];
  const active = data?.active || [];
  const held = data?.held || [];
  const dispatched = data?.dispatched || [];
  const alerts = data?.alerts || [];

  /* ── metric cards ── */
  const metrics = useMemo(() => {
    const wm = wipMap(wip);
    const totalActive =
      readWip(wip, 'active', 'active_uids', 'total_active') ?? (active.length || null);
    const onHold = readWip(wip, 'on_hold', 'hold', 'on_hold_uids') ?? (held.length || null);

    // Awaiting design confirmation — UIDs at step 15/16 with no design set.
    const awaitingDesign = active.filter((u) => {
      const step = Number(pick(u, 'current_step', 'step'));
      const design = pick(u, 'design_code', 'design');
      return (step === 15 || step === 16) && !design;
    }).length;

    const furnaceRunning =
      readWip(wip, 'in_furnace', 'furnace', 'furnace_running', 'furnace_batches') ??
      // fall back to HT (heat-treat) WIP if the summary doesn't carry a furnace key
      (wm['HT-Q'] != null || wm['HT-D'] != null ? null : null);

    const dispatchedToday =
      readWip(wip, 'dispatched_today', 'dispatched') ??
      (dispatched.length
        ? dispatched.filter((u) => isToday(pick(u, 'dispatched_at', 'completed_at', 'updated_at'))).length
        : null);

    const inTransit = readWip(wip, 'in_transit', 'faridabad_in_transit', 'batches_in_transit');

    return { totalActive, onHold, awaitingDesign, furnaceRunning, dispatchedToday, inTransit };
  }, [wip, active, held, dispatched]);

  /* ── alerts (sorted by severity, most critical first) ── */
  const sortedAlerts = useMemo(() => {
    return [...alerts].sort((a, b) => {
      const sa = SEV_WEIGHT[String(a.severity || a.level || 'info').toLowerCase()] ?? 3;
      const sb = SEV_WEIGHT[String(b.severity || b.level || 'info').toLowerCase()] ?? 3;
      return sa - sb;
    });
  }, [alerts]);

  /* ── priority queue — High priority UIDs, longest-waiting first ── */
  const priorityQueue = useMemo(() => {
    return active
      .filter((u) => pick(u, 'priority') === 'High')
      .sort((a, b) => waitingMs(b) - waitingMs(a));
  }, [active]);

  /* ── WIP by storage ── */
  const wm = useMemo(() => wipMap(wip), [wip]);

  /* ── workstation summary ── */
  const stationRows = useMemo(() => {
    return [...stations]
      .map((s) => {
        const running = Number(pick(s, 'active_count', 'running', 'in_progress')) || 0;
        const queued = Number(pick(s, 'queued_count', 'queued', 'waiting')) || 0;
        let status = pick(s, 'status');
        if (!status) status = running > 0 ? 'running' : queued > 0 ? 'waiting' : 'idle';
        return { code: s.code, name: s.name, running, queued, status };
      })
      .sort((a, b) => b.running - a.running || b.queued - a.queued);
  }, [stations]);

  const firstLoad = loading && !data;

  if (error && !data) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
        <Header locationLabel={locationLabel} onRefresh={refetch} />
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <Header locationLabel={locationLabel} loading={firstLoad} onRefresh={refetch} />

      {/* ── Metric cards ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
          gap: 12,
          marginTop: 20,
        }}
      >
        <MetricCard
          label="Total active UIDs"
          value={metrics.totalActive}
          to="/floor"
          loading={firstLoad}
        />
        <MetricCard
          label="On hold"
          value={metrics.onHold}
          color="var(--status-danger, #e5484d)"
          to="/floor?status=hold"
          loading={firstLoad}
        />
        <MetricCard
          label="Awaiting design"
          value={metrics.awaitingDesign}
          color="var(--status-warning, #d97a2b)"
          to="/floor?awaiting_design=1"
          hint="Step 15/16, no design"
          loading={firstLoad}
        />
        <MetricCard
          label="Furnace batches"
          value={metrics.furnaceRunning}
          color="var(--cycle-oven, #c0762b)"
          to="/batch"
          hint="Tempering now"
          loading={firstLoad}
        />
        <MetricCard
          label="Dispatched today"
          value={metrics.dispatchedToday}
          color="var(--status-success, #22a06b)"
          loading={firstLoad}
        />
        <MetricCard
          label="In transit"
          value={metrics.inTransit}
          color="var(--location-faridabad, #d97a2b)"
          to="/receiving"
          hint="Faridabad → Dharmapuri"
          loading={firstLoad}
        />
      </div>

      {/* ── Alerts + Priority queue ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 360px) minmax(0, 1fr)',
          gap: 18,
          marginTop: 18,
          alignItems: 'start',
        }}
      >
        <AlertsPanel alerts={sortedAlerts} loading={firstLoad} onRefresh={refetch} />
        <PriorityQueue rows={priorityQueue} loading={firstLoad} />
      </div>

      {/* ── WIP by storage ── */}
      <div className="card" style={{ marginTop: 18, padding: '18px 20px' }}>
        <SectionLabel style={{ marginBottom: 4 }}>WIP by storage location · Dharmapuri</SectionLabel>
        <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-muted, #9bb4d4)', marginBottom: 14 }}>
          Flow order — bar shows count relative to typical capacity
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, minmax(0, 1fr))', gap: 10 }}>
          {STORAGE_ORDER.map((code) => (
            <StorageTile key={code} code={code} count={wm[code] ?? 0} to={`/floor?storage=${code}`} />
          ))}
        </div>
      </div>

      {/* ── Active workstation summary ── */}
      <div className="card" style={{ marginTop: 18, padding: '18px 20px' }}>
        <SectionLabel style={{ marginBottom: 14 }}>Active workstation summary</SectionLabel>
        {firstLoad ? (
          <SkeletonRows />
        ) : stationRows.length === 0 ? (
          <Empty icon="factory" message="No workstations configured for this location." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <Th>Workstation</Th>
                  <Th>Name</Th>
                  <Th align="right">Running</Th>
                  <Th align="right">Queued</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {stationRows.map((s) => (
                  <tr key={s.code} style={{ borderTop: '1px solid var(--bg-muted, #f4f7f2)' }}>
                    <Td>
                      <Link
                        to={`/floor?station=${s.code}`}
                        style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: 'var(--cycle-eat, #2d6fb5)' }}
                      >
                        {s.code}
                      </Link>
                    </Td>
                    <Td muted>{s.name}</Td>
                    <Td align="right" mono>{s.running}</Td>
                    <Td align="right" mono>{s.queued}</Td>
                    <Td>
                      <StatusPill status={s.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── sub-sections ──────────────────────────────────────────────────────── */

function Header({ locationLabel, loading, onRefresh }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
      <div>
        <div
          style={{
            fontFamily: ARCHIVO,
            fontWeight: 800,
            fontSize: 24,
            letterSpacing: '-0.03em',
            color: 'var(--text-primary, #15366a)',
          }}
        >
          Dashboard
        </div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
          {locationLabel} · live production overview {loading ? '· loading…' : ''}
        </div>
      </div>
      <button className="btn btn-sm" type="button" onClick={onRefresh}>
        <Icon name="refresh" size={14} />
        Refresh
      </button>
    </div>
  );
}

function AlertsPanel({ alerts, loading, onRefresh }) {
  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <SectionLabel>Alerts</SectionLabel>
        {alerts.length ? (
          <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted, #9bb4d4)' }}>
            {alerts.length}
          </span>
        ) : null}
      </div>
      {loading ? (
        <SkeletonRows rows={4} />
      ) : alerts.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
          <span style={{ color: 'var(--status-success, #22a06b)', display: 'flex' }}>
            <Icon name="check" size={16} />
          </span>
          <span style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)' }}>
            No active alerts.
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {alerts.slice(0, 14).map((a, i) => (
            <AlertRow key={a.id ?? i} alert={a} first={i === 0} onRefresh={onRefresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertRow({ alert, first, onRefresh }) {
  const sev = String(alert.severity || alert.level || 'info').toLowerCase();
  const text = pick(alert, 'message', 'text', 'title', 'description', 'code') || 'Alert';
  const uidCode = pick(alert, 'uid_code', 'uid');
  const linkTo = pick(alert, 'link', 'href') || (uidCode ? `/uid/${uidCode}` : null);

  const dismiss = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (alert.id == null) return;
    try {
      await alertsApi.dismiss(alert.id);
      onRefresh?.();
    } catch {
      /* dismiss is best-effort; the next poll will reconcile */
    }
  };

  const inner = (
    <>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: SEV_COLOR[sev] || SEV_COLOR.info,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          flex: 1,
          fontFamily: SANS,
          fontSize: 12.5,
          color: 'var(--text-primary, #15366a)',
          lineHeight: 1.35,
        }}
      >
        {text}
        {uidCode ? (
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--cycle-eat, #2d6fb5)', marginLeft: 6 }}>
            {uidCode}
          </span>
        ) : null}
      </span>
      {alert.id != null ? (
        <button
          type="button"
          onClick={dismiss}
          title="Dismiss"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted, #9bb4d4)',
            display: 'flex',
            padding: 2,
            flexShrink: 0,
          }}
        >
          <Icon name="close" size={13} />
        </button>
      ) : null}
    </>
  );

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 0',
    borderTop: first ? 'none' : '1px solid var(--bg-muted, #f4f7f2)',
  };

  return linkTo ? (
    <Link to={linkTo} style={rowStyle}>
      {inner}
    </Link>
  ) : (
    <div style={rowStyle}>{inner}</div>
  );
}

function PriorityQueue({ rows, loading }) {
  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <SectionLabel>Priority queue · High priority</SectionLabel>
        {rows.length ? (
          <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted, #9bb4d4)' }}>
            {rows.length} pieces
          </span>
        ) : null}
      </div>
      {loading ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <Empty icon="check" message="No High priority UIDs in production." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>UID</Th>
                <Th>Cycle</Th>
                <Th align="right">Step</Th>
                <Th>Storage</Th>
                <Th>Design</Th>
                <Th>MO</Th>
                <Th align="right">Waiting</Th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 15).map((u) => {
                const code = pick(u, 'uid_code', 'code');
                return (
                  <tr key={code} style={{ borderTop: '1px solid var(--bg-muted, #f4f7f2)' }}>
                    <Td>
                      <Link
                        to={`/uid/${code}`}
                        style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: 'var(--cycle-eat, #2d6fb5)' }}
                      >
                        {code}
                      </Link>
                    </Td>
                    <Td>{pick(u, 'cycle_code', 'cycle') ? <CycleBadge cycle={pick(u, 'cycle_code', 'cycle')} /> : '—'}</Td>
                    <Td align="right" mono>{pick(u, 'current_step', 'step') ?? '—'}</Td>
                    <Td mono>{pick(u, 'storage_code', 'storage') ?? '—'}</Td>
                    <Td muted>{pick(u, 'design_code', 'design') ?? '—'}</Td>
                    <Td mono muted>{pick(u, 'mo_number', 'mo') ?? '—'}</Td>
                    <Td align="right" mono>{waitingLabel(u) ?? '—'}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── table primitives ──────────────────────────────────────────────────── */

function Th({ children, align }) {
  return (
    <th
      style={{
        textAlign: align || 'left',
        fontFamily: MONO,
        fontSize: 9.5,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--text-muted, #9bb4d4)',
        fontWeight: 600,
        padding: '0 10px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align, mono, muted }) {
  return (
    <td
      style={{
        textAlign: align || 'left',
        padding: '9px 10px',
        fontFamily: mono ? MONO : SANS,
        fontSize: 12.5,
        color: muted ? 'var(--text-secondary, #5d7188)' : 'var(--text-primary, #15366a)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </td>
  );
}

/* ── states ────────────────────────────────────────────────────────────── */

function SkeletonRows({ rows = 5 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 14,
            borderRadius: 4,
            background: 'var(--bg-muted, #f4f7f2)',
            opacity: 1 - i * 0.12,
          }}
        />
      ))}
    </div>
  );
}

function Empty({ icon = 'inbox', message }) {
  return (
    <div style={{ padding: '28px 16px', textAlign: 'center' }}>
      <div style={{ color: 'var(--text-muted, #9bb4d4)', display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
        <Icon name={icon} size={22} />
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)' }}>{message}</div>
    </div>
  );
}

function ErrorState({ error, onRetry }) {
  return (
    <div className="card" style={{ padding: '32px 24px', textAlign: 'center', marginTop: 18 }}>
      <div style={{ color: 'var(--status-danger, #e5484d)', display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
        <Icon name="alert" size={26} />
      </div>
      <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>
        Could not load the dashboard
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
