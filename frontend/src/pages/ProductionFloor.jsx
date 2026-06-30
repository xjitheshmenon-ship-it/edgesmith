import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePolling } from '../hooks/usePolling';
import { useApp } from '../store/AppContext';
import { uidsApi } from '../api/uids';
import Icon from '../components/common/Icon';
import { CycleBadge, StatusPill, PriorityBadge } from '../components/common/Badges';

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";

/* Storage locations shown in the side panel (PAGE 7 spec). */
const STORAGE_ORDER = ['RM', 'RM-Q', 'RM-D', 'HT-Q', 'HT-D', 'MC-Q', 'MC-D', 'QC-Q', 'QC-D', 'FG'];

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

/* Derive a workstation's live status from its in-progress / queue counts. */
function stationStatus(running, queued) {
  if (running > 0) return 'running';
  if (queued > 0) return 'waiting';
  return 'idle';
}

const STATUS_LABEL = {
  running: 'IN PROGRESS',
  waiting: 'WAITING',
  idle: 'IDLE',
  hold: 'HOLD',
};

/* Capacity bar — visualises running vs total slots used (queued + running). */
function CapacityBar({ running, queued }) {
  const total = Math.max(running + queued, 1);
  const segments = Math.min(total, 12);
  const filled = Math.round((running / total) * segments);
  return (
    <div style={{ display: 'flex', gap: 2, marginTop: 8 }} aria-hidden>
      {Array.from({ length: segments }).map((_, i) => (
        <span
          key={i}
          style={{
            flex: 1,
            height: 6,
            borderRadius: 2,
            background: i < filled ? 'var(--status-success, #22a06b)' : 'var(--border-card, #e3ebde)',
          }}
        />
      ))}
    </div>
  );
}

function UidRow({ uid }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 0',
        borderTop: '1px solid var(--bg-muted, #f4f7f2)',
      }}
    >
      <Link
        to={`/uid/${uid.uid_code}`}
        style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: 'var(--cycle-eat, #2d6fb5)' }}
      >
        {uid.uid_code}
      </Link>
      {uid.cycle_code ? <CycleBadge cycle={uid.cycle_code} /> : null}
      {uid.priority === 'High' ? <PriorityBadge priority="High" /> : null}
      <span style={{ flex: 1 }} />
      {uid.size_mm ? (
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--text-secondary, #5d7188)' }}>{uid.size_mm}mm</span>
      ) : null}
      {uid.status === 'hold' ? <StatusPill status="hold" /> : null}
    </div>
  );
}

/* A single workstation card. */
function StationCard({ station }) {
  const { code, name, running, queued, runningUids, queuedUids } = station;
  const isIdle = running === 0 && queued === 0;
  const status = stationStatus(running, queued);

  // Idle tiles: smaller, greyed out, no queue info (per spec).
  if (isIdle) {
    return (
      <div
        className="card"
        style={{ padding: '14px 16px', opacity: 0.62, display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>{code}</div>
        <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary, #5d7188)' }}>{name}</div>
        <StatusPill status="idle" />
      </div>
    );
  }

  const restRunning = runningUids.length;
  const visibleQueue = queuedUids.slice(0, 3);
  const moreQueue = queued - visibleQueue.length;

  return (
    <div className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>{code}</div>
          <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', marginTop: 1 }}>{name}</div>
        </div>
        <StatusPill status={status} label={STATUS_LABEL[status]} />
      </div>

      <CapacityBar running={running} queued={queued} />
      <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-secondary, #5d7188)', marginTop: 5 }}>
        {running} in progress{queued ? ` · ${queued} queued` : ''}
      </div>

      {/* In-progress UIDs */}
      {restRunning > 0 ? (
        <div style={{ marginTop: 10 }}>
          <SectionLabel>In progress</SectionLabel>
          <div>
            {runningUids.map((u) => (
              <UidRow key={u.uid_code} uid={u} />
            ))}
          </div>
        </div>
      ) : null}

      {/* Queue */}
      {queued > 0 ? (
        <div style={{ marginTop: 10 }}>
          <SectionLabel>Queue · {queued} waiting</SectionLabel>
          <div>
            {visibleQueue.map((u) => (
              <UidRow key={u.uid_code} uid={u} />
            ))}
          </div>
          {moreQueue > 0 ? (
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted, #9bb4d4)', marginTop: 6 }}>
              + {moreQueue} more
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────── */

export default function ProductionFloor() {
  const { location, locationLabel } = useApp();
  const [search, setSearch] = useState('');
  const [storageFilter, setStorageFilter] = useState(null);

  // Live data. stationSummary gives the workstation roster + active counts;
  // the UID list gives the actual pieces. Both are polled together and merged
  // client-side into per-station running / queued buckets.
  const { data, loading, error, refetch } = usePolling(
    async () => {
      const [stations, active, held, wip] = await Promise.all([
        uidsApi.stationSummary().then((r) => r.data),
        uidsApi.list({ location, status: 'active', per_page: 200 }).then((r) => r.data),
        uidsApi.list({ location, status: 'hold', per_page: 200 }).then((r) => r.data),
        uidsApi.wipSummary().then((r) => r.data).catch(() => []),
      ]);
      return { stations: stations || [], uids: [...(active || []), ...(held || [])], wip: wip || [] };
    },
    [location]
  );

  const stations = data?.stations || [];
  const uids = data?.uids || [];
  const wip = data?.wip || [];

  // Filtered UID set (search + storage-location side-panel filter).
  const filteredUids = useMemo(() => {
    const q = search.trim().toUpperCase();
    return uids.filter((u) => {
      if (q && !String(u.uid_code).toUpperCase().includes(q)) return false;
      if (storageFilter && u.storage_code !== storageFilter) return false;
      return true;
    });
  }, [uids, search, storageFilter]);

  // Merge: each workstation gets its in-progress count from stationSummary
  // (active_count). The UID roster does not carry a station code, so we attach
  // the in-progress / queued UID *lists* by current_step where the summary lets
  // us — otherwise the card still shows accurate counts. We bucket queued UIDs
  // (those in a queue storage location, *-Q) versus running ones.
  const stationCards = useMemo(() => {
    const queuedAll = filteredUids.filter((u) => String(u.storage_code || '').endsWith('-Q'));
    const runningAll = filteredUids.filter((u) => !String(u.storage_code || '').endsWith('-Q'));

    return stations.map((s) => {
      const running = Number(s.active_count) || 0;
      // Best-effort: show running UIDs only on stations that have active work,
      // distributing by code prefix match against storage (degrades gracefully
      // to counts-only when no UID can be confidently attributed).
      const runningUids = runningAll
        .filter((u) => matchesStation(u, s))
        .slice(0, running || undefined);
      const queuedUids = queuedAll.filter((u) => matchesStation(u, s));
      return {
        code: s.code,
        name: s.name,
        running,
        queued: queuedUids.length,
        runningUids,
        queuedUids,
      };
    });
  }, [stations, filteredUids]);

  const totalOnFloor = filteredUids.length;
  const activeCount = filteredUids.filter((u) => u.status === 'active').length;
  const holdCount = filteredUids.filter((u) => u.status === 'hold').length;
  const runningStations = stationCards.filter((s) => s.running > 0).length;
  const idleStations = stationCards.filter((s) => s.running === 0 && s.queued === 0).length;

  const wipByCode = useMemo(() => {
    const m = {};
    for (const w of wip) m[w.code] = w.count;
    return m;
  }, [wip]);

  /* ── render ── */

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
            Production Floor
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
            {locationLabel} · live workstation view {loading && !data ? '· loading…' : ''}
          </div>
        </div>
        <button className="btn btn-sm" onClick={refetch} type="button">
          <Icon name="refresh" size={14} />
          Refresh
        </button>
      </div>

      {/* Status bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 18 }}>
        <Stat label="On floor" value={totalOnFloor} />
        <Stat label="Active" value={activeCount} color="var(--status-success, #22a06b)" />
        <Stat label="On hold" value={holdCount} color="var(--status-danger, #e5484d)" />
        <Stat label="Stations running" value={runningStations} />
        <Stat label="Stations idle" value={idleStations} color="var(--text-secondary, #5d7188)" />
      </div>

      {/* Filter controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 360 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted, #9bb4d4)' }}>
            <Icon name="search" size={15} />
          </span>
          <input
            className="form-input"
            style={{ height: 38, paddingLeft: 34, borderRadius: 'var(--radius-md, 9px)' }}
            placeholder="Search UID code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {storageFilter ? (
          <button className="btn btn-sm" type="button" onClick={() => setStorageFilter(null)}>
            <Icon name="close" size={13} />
            {storageFilter} filter
          </button>
        ) : null}
      </div>

      {/* Body */}
      {error && !data ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 220px', gap: 18, marginTop: 18, alignItems: 'start' }}>
          {/* Workstation grid */}
          <div>
            {loading && !data ? (
              <LoadingState />
            ) : stationCards.length === 0 ? (
              <EmptyState message="No workstations configured for this location." />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
                {stationCards.map((s) => (
                  <StationCard key={s.code} station={s} />
                ))}
              </div>
            )}
          </div>

          {/* Side panel — storage WIP */}
          <div className="card" style={{ padding: '16px 16px', position: 'sticky', top: 18 }}>
            <SectionLabel style={{ marginBottom: 10 }}>Storage WIP</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {STORAGE_ORDER.map((code) => {
                const count = wipByCode[code] ?? 0;
                const isActive = storageFilter === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setStorageFilter(isActive ? null : code)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 8px',
                      border: 'none',
                      borderRadius: 'var(--radius-sm, 5px)',
                      background: isActive ? 'var(--bg-soft-blue, #eaf0f7)' : 'transparent',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--text-primary, #15366a)' }}>{code}</span>
                    <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 14, color: count ? 'var(--text-primary, #15366a)' : 'var(--text-muted, #9bb4d4)' }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Best-effort attribution of a UID to a workstation. The API does not expose
   the step→workstation mapping on the UID list, so we match on storage-code
   prefix (e.g. HT-Q → HT70/HT80/HT90 hardening/tempering) as a heuristic and
   degrade to counts-only when nothing matches. */
function matchesStation(uid, station) {
  const storage = String(uid.storage_code || '');
  const code = String(station.code || '');
  if (!storage) return false;
  const prefix = storage.split('-')[0]; // RM, HT, MC, QC, FG
  return code.toUpperCase().startsWith(prefix.toUpperCase());
}

function Stat({ label, value, color }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <SectionLabel>{label}</SectionLabel>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 26, letterSpacing: '-0.03em', color: color || 'var(--text-primary, #15366a)', marginTop: 4, lineHeight: 1 }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card" style={{ padding: 18, height: 150, opacity: 0.5 }}>
          <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted, #9bb4d4)' }}>loading…</div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ color: 'var(--text-muted, #9bb4d4)', display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
        <Icon name="factory" size={26} />
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)' }}>{message}</div>
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
        Could not load the production floor
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
