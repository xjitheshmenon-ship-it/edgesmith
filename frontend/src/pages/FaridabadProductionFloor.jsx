import { useEffect, useMemo, useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { faridabadApi } from '../api/resources';
import Icon from '../components/common/Icon';
import { CycleBadge } from '../components/common/Badges';

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";

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

/* Faridabad items carry no UID — identity is size + cycle-type badge. */
function ItemIdentity({ item, size = 13 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontFamily: MONO, fontSize: size, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>
        {item.size_mm != null ? `${item.size_mm}mm` : '—'}
      </span>
      {item.cycle_code ? <CycleBadge cycle={item.cycle_code} /> : null}
    </span>
  );
}

/* Format an elapsed millisecond span as HH:MM:SS. */
function formatElapsed(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/* Live "running for" timer driven by the page-level 1s ticking clock. */
function RunningTimer({ startedAt, now }) {
  const start = startedAt ? new Date(startedAt).getTime() : NaN;
  const elapsed = Number.isFinite(start) ? now - start : null;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: MONO,
        fontSize: 12,
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--status-success, #22a06b)',
      }}
    >
      <Icon name="timer" size={13} />
      {elapsed != null ? formatElapsed(elapsed) : '—'}
    </span>
  );
}

function QueueRow({ item }) {
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
      <ItemIdentity item={item} size={12} />
      {item.priority === 'High' ? (
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'var(--status-danger, #e5484d)',
          }}
        >
          ● HIGH
        </span>
      ) : null}
      <span style={{ flex: 1 }} />
      {item.operation_name ? (
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted, #9bb4d4)' }}>{item.operation_name}</span>
      ) : null}
    </div>
  );
}

/* ── one workstation card ─────────────────────────────────────────────── */

function StationCard({ station, now }) {
  const { name, items } = station;
  const list = Array.isArray(items) ? items : [];
  const running = list.find((it) => it.status === 'in_progress') || null;
  const queued = list.filter((it) => it.status === 'queued');

  // Small step/operation label for the card header: prefer the running item's
  // operation, else the head of the queue, else just the station.
  const stepLabel = running?.operation_name || queued[0]?.operation_name || null;

  return (
    <div className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>
            {name}
          </div>
          {stepLabel ? (
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--text-secondary, #5d7188)', marginTop: 2 }}>
              {stepLabel}
            </div>
          ) : null}
        </div>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: '0.1em',
            padding: '3px 8px',
            borderRadius: 999,
            color: running ? 'var(--status-success, #22a06b)' : 'var(--text-muted, #9bb4d4)',
            background: running ? 'rgba(34,160,107,0.14)' : 'var(--bg-muted, #f4f7f2)',
          }}
        >
          {running ? 'IN PROGRESS' : queued.length ? 'WAITING' : 'IDLE'}
        </span>
      </div>

      {/* Current item in progress */}
      <div style={{ marginTop: 12 }}>
        <SectionLabel>Current item</SectionLabel>
        {running ? (
          <div
            style={{
              marginTop: 7,
              padding: '10px 12px',
              borderRadius: 'var(--radius-md, 9px)',
              background: 'var(--bg-soft-green, #eef7f1)',
              border: '1px solid rgba(34,160,107,0.22)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <ItemIdentity item={running} />
              <RunningTimer startedAt={running.started_at} now={now} />
            </div>
            {running.operation_name ? (
              <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary, #5d7188)', marginTop: 6 }}>
                {running.operation_name}
              </div>
            ) : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <span style={{ color: 'var(--text-muted, #9bb4d4)', display: 'inline-flex' }}>
                <Icon name="user" size={13} />
              </span>
              <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-primary, #15366a)' }}>
                {running.operator_name || 'Unassigned'}
              </span>
            </div>
          </div>
        ) : (
          <div
            style={{
              marginTop: 7,
              padding: '14px 12px',
              borderRadius: 'var(--radius-md, 9px)',
              background: 'var(--bg-muted, #f4f7f2)',
              textAlign: 'center',
              fontFamily: SANS,
              fontSize: 12,
              color: 'var(--text-muted, #9bb4d4)',
            }}
          >
            No item in progress
          </div>
        )}
      </div>

      {/* Queue */}
      <div style={{ marginTop: 12 }}>
        <SectionLabel>Queue · {queued.length} waiting</SectionLabel>
        {queued.length > 0 ? (
          <div style={{ marginTop: 2 }}>
            {queued.map((it) => (
              <QueueRow key={it.id} item={it} />
            ))}
          </div>
        ) : (
          <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-muted, #9bb4d4)', marginTop: 6 }}>
            Queue empty
          </div>
        )}
      </div>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────── */

export default function FaridabadProductionFloor() {
  const { data, loading, error, refetch } = usePolling(
    () => faridabadApi.floor().then((r) => r.data),
    [],
    { interval: 20000 }
  );

  // 1s ticking clock that drives every card's live "running for" timer.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const groups = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // Only render groups that actually have items (done items are excluded
  // server-side, so an empty `items` means an idle station with no work).
  const activeGroups = useMemo(
    () => groups.filter((g) => Array.isArray(g.items) && g.items.length > 0),
    [groups]
  );

  const totalItems = useMemo(
    () => activeGroups.reduce((sum, g) => sum + (g.items?.length || 0), 0),
    [activeGroups]
  );
  const runningCount = useMemo(
    () =>
      activeGroups.reduce(
        (sum, g) => sum + (g.items || []).filter((it) => it.status === 'in_progress').length,
        0
      ),
    [activeGroups]
  );
  const queuedCount = totalItems - runningCount;

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Header */}
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
            Faridabad Production Floor
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
            Live view · 10-step Faridabad cycle {loading && !data ? '· loading…' : ''}
          </div>
        </div>
        <button className="btn btn-sm" onClick={refetch} type="button">
          <Icon name="refresh" size={14} />
          Refresh
        </button>
      </div>

      {/* Status bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 18 }}>
        <Stat label="On floor" value={totalItems} />
        <Stat label="In progress" value={runningCount} color="var(--status-success, #22a06b)" />
        <Stat label="Queued" value={queuedCount} color="var(--text-secondary, #5d7188)" />
      </div>

      {/* Body */}
      {error && !data ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : loading && !data ? (
        <LoadingState />
      ) : activeGroups.length === 0 ? (
        <EmptyState message="No active Faridabad items" />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
            marginTop: 18,
            alignItems: 'start',
          }}
        >
          {activeGroups.map((g) => (
            <StationCard key={g.code || g.name} station={g} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── shared atoms ─────────────────────────────────────────────────────── */

function Stat({ label, value, color }) {
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
          lineHeight: 1,
        }}
      >
        {value ?? '—'}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 14,
        marginTop: 18,
      }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card" style={{ padding: 18, height: 170, opacity: 0.5 }}>
          <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted, #9bb4d4)' }}>loading…</div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="card" style={{ padding: '40px 24px', textAlign: 'center', marginTop: 18 }}>
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
        Could not load the Faridabad production floor
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
