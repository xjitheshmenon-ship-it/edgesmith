import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePolling } from '../hooks/usePolling';
import { uidsApi } from '../api/uids';
import { alertsApi } from '../api/resources';
import { batchesApi } from '../api/batches';

/* ── dark wall-display palette ─────────────────────────────────────────── */
const C = {
  bg: '#0a1d3a',
  text: '#eaf4e4',
  running: '#d4eecb', // running / active accent
  hold: '#ff6b6b',
  furnace: '#f0a020',
  muted: '#8aa0bf',
  panel: '#0e2547',
  border: '#1d3a63',
};

const ARCHIVO = "'Archivo', 'IBM Plex Sans', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; };

function pad2(n) { return String(n).padStart(2, '0'); }

/* ── live clock (1s tick) ──────────────────────────────────────────────── */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/* ── big top-of-screen stat ────────────────────────────────────────────── */
function BigStat({ label, value, color }) {
  return (
    <div
      style={{
        flex: 1,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: '20px 28px',
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 14,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: C.muted,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: ARCHIVO,
          fontWeight: 800,
          fontSize: 72,
          lineHeight: 1,
          letterSpacing: '-0.03em',
          color: color || C.text,
          marginTop: 8,
        }}
      >
        {value ?? '—'}
      </div>
    </div>
  );
}

/* ── workstation tile ──────────────────────────────────────────────────── */
function StationTile({ code, name, running, queued }) {
  // status: red = hold present (handled by caller via hold flag), green = running, amber = idle
  const idle = running === 0 && queued === 0;
  const dot = running > 0 ? C.running : idle ? C.furnace : C.muted;
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div
          style={{
            fontFamily: ARCHIVO,
            fontWeight: 800,
            fontSize: 26,
            letterSpacing: '-0.02em',
            color: C.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={name || code}
        >
          {code}
        </div>
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: dot,
            flexShrink: 0,
            boxShadow: `0 0 12px ${dot}`,
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 18 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted }}>
            Running
          </div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 48, lineHeight: 1, color: running > 0 ? C.running : C.muted }}>
            {running}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted }}>
            Queued
          </div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 48, lineHeight: 1, color: queued > 0 ? C.text : C.muted }}>
            {queued}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── furnace batch card (strip) ────────────────────────────────────────── */
function elapsedFrom(startedAt, now) {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const mins = Math.max(0, Math.floor((now.getTime() - start) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${pad2(m)}m` : `${m}m`;
}

function FurnaceCard({ batch, now }) {
  const number = pick(batch, 'batch_number', 'number', 'code') ?? pick(batch, 'id', 'batch_id');
  const step = pick(batch, 'step_label', 'step', 'tempering_step') || '';
  const targetTemp = pick(batch, 'target_temp', 'target_temperature');
  const targetSoak = pick(batch, 'target_soak', 'target_soaking_time', 'soak_minutes');
  const startedAt = pick(batch, 'started_at', 'start_time', 'created_at');
  const rawUids = pick(batch, 'uids', 'uid_codes') || [];
  const uids = (Array.isArray(rawUids) ? rawUids : []).map((u) => (typeof u === 'string' ? u : pick(u, 'code', 'uid_code'))).filter(Boolean);
  // now is passed in so elapsed recomputes on each clock tick
  const elapsed = elapsedFrom(startedAt, now);

  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${C.furnace}`,
        borderRadius: 12,
        padding: '16px 20px',
        minWidth: 320,
        flex: '1 1 320px',
        maxWidth: 480,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, color: C.furnace }}>{number}</span>
        <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: C.text }}>{step}</span>
      </div>

      <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
        {targetTemp != null && (
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted }}>Target</div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 28, lineHeight: 1.1, color: C.text }}>{targetTemp}°C</div>
          </div>
        )}
        {targetSoak != null && (
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted }}>Soak</div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 28, lineHeight: 1.1, color: C.text }}>{targetSoak}m</div>
          </div>
        )}
        {elapsed != null && (
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted }}>Started</div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 28, lineHeight: 1.1, color: C.furnace }}>{elapsed} ago</div>
          </div>
        )}
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted }}>UIDs</div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 28, lineHeight: 1.1, color: C.text }}>{uids.length}</div>
        </div>
      </div>

      {uids.length > 0 && (
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.muted, marginTop: 12, lineHeight: 1.6, wordBreak: 'break-word' }}>
          {uids.join('  ·  ')}
        </div>
      )}
    </div>
  );
}

/* ── page ──────────────────────────────────────────────────────────────── */
export default function ShopfloorDisplay() {
  const navigate = useNavigate();
  const now = useClock();

  const { data, loading } = usePolling(async () => {
    const [wip, stations, batches, alerts] = await Promise.all([
      uidsApi.wipSummary().then((r) => r.data).catch(() => ({})),
      uidsApi.stationSummary().then((r) => r.data).catch(() => []),
      batchesApi.furnaceList().then((r) => r.data).catch(() => []),
      alertsApi.list().then((r) => r.data).catch(() => []),
    ]);
    return {
      wip: wip || {},
      stations: Array.isArray(stations) ? stations : [],
      batches: Array.isArray(batches) ? batches : batches?.batches || [],
      alerts: Array.isArray(alerts) ? alerts : [],
    };
  });

  const wip = data?.wip || {};
  const stations = data?.stations || [];
  const batches = data?.batches || [];

  const g = (...keys) => { for (const k of keys) if (wip[k] != null) return wip[k]; return null; };
  const activeCount = g('active', 'active_uids', 'total_active');
  const holdCount = g('on_hold', 'hold', 'on_hold_uids');
  const furnaceCount = g('in_furnace', 'furnace', 'furnace_running');

  // Per-station running / queued counts. stationSummary carries active_count;
  // a *-Q queue count is used for queued where present.
  const stationCards = stations.map((s) => ({
    code: pick(s, 'code', 'workstation_code') || '—',
    name: pick(s, 'name', 'label') || '',
    running: Number(pick(s, 'active_count', 'running', 'in_progress')) || 0,
    queued: Number(pick(s, 'queued_count', 'queued', 'waiting')) || 0,
  }));

  // live clock parts
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: C.bg,
        color: C.text,
        overflowY: 'auto',
        overflowX: 'hidden',
        fontFamily: SANS,
      }}
    >
      <div style={{ padding: '28px 36px 48px', maxWidth: 1920, margin: '0 auto' }}>
        {/* Header bar */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 34, letterSpacing: '-0.03em', color: C.text }}>
              EDGESMITH TOOLING — DHARMAPURI
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: SANS, fontSize: 16, color: C.muted }}>{dateStr}</span>
              <span style={{ fontFamily: MONO, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: '0.04em' }}>{timeStr}</span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontFamily: MONO,
                  fontSize: 12,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: C.running,
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: C.running, boxShadow: `0 0 10px ${C.running}` }} />
                Auto-refresh 30s{loading && !data ? ' · loading…' : ''}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            style={{
              fontFamily: MONO,
              fontSize: 14,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: C.text,
              background: 'transparent',
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: '12px 22px',
              cursor: 'pointer',
            }}
          >
            Exit
          </button>
        </div>

        {/* Three big stats */}
        <div style={{ display: 'flex', gap: 18, marginTop: 24, flexWrap: 'wrap' }}>
          <BigStat label="Active" value={activeCount} color={C.running} />
          <BigStat label="On Hold" value={holdCount} color={C.hold} />
          <BigStat label="In Furnace" value={furnaceCount} color={C.furnace} />
        </div>

        {/* Workstation grid */}
        <div style={{ marginTop: 30 }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 13,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: C.muted,
              marginBottom: 14,
            }}
          >
            Workstations
          </div>
          {stationCards.length === 0 ? (
            <div style={{ fontFamily: SANS, fontSize: 16, color: C.muted }}>
              {loading && !data ? 'Loading workstations…' : 'No workstations reporting.'}
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 16,
              }}
            >
              {stationCards.map((s) => (
                <StationTile key={s.code} code={s.code} name={s.name} running={s.running} queued={s.queued} />
              ))}
            </div>
          )}
        </div>

        {/* Furnace batch strip */}
        {batches.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 13,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: C.furnace,
                marginBottom: 14,
              }}
            >
              Furnace — Active Tempering Batches
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {batches.map((b, i) => (
                <FurnaceCard key={pick(b, 'id', 'batch_id', 'batch_number') ?? i} batch={b} now={now} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
