import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { usePolling } from '../hooks/usePolling';
import { useApp } from '../store/AppContext';
import { useAuth } from '../store/AuthContext';
import { uidsApi } from '../api/uids';
import { jobsApi } from '../api/jobs';
import { swapApi } from '../api/swap';
import { queueApi } from '../api/queue';
import { employeesApi } from '../api/resources';
import Icon from '../components/common/Icon';
import { CycleBadge, StatusPill, PriorityBadge } from '../components/common/Badges';

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";

const ACTIVE_JOB_STATUSES = ['in_progress', 'running', 'active', 'paused'];
function jpick(o, ...keys) { if (!o) return undefined; for (const k of keys) if (o[k] != null) return o[k]; return undefined; }
function jstatus(j) { return String(jpick(j, 'status', 'state', 'job_status') || 'queued').toLowerCase(); }
function fmtHMS(total) {
  const s = Math.max(0, Math.floor(total || 0));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
function elapsedFrom(iso, nowMs) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (nowMs - t) / 1000);
}

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
const STAFFING_LABEL = { 1: 'Peer assist', 2: 'Swap pool', 3: 'Crew' };

/* Crew bar: assigned vs minimum operators (furnace / swap-pool stations). */
function CrewBar({ assigned, min }) {
  const met = assigned >= min;
  const c = met ? '#22a06b' : '#e5484d';
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 10, color: 'var(--text-secondary, #5d7188)', marginBottom: 3 }}>
        <span>Crew</span><span style={{ color: c }}>{assigned}/{min}</span>
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {Array.from({ length: min }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: i < assigned ? c : 'var(--bg-muted-2, #e6ede2)' }} />
        ))}
      </div>
    </div>
  );
}

function fmtMMSS(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/* Swap-pool panel (Model 2): current + next operator, slot countdown, INSP
   fixed holder (HRC-01), UNDERSTAFFED state, and Supervisor rotate/override. */
function SwapPanel({ swap, onGenerate, onOverride }) {
  if (!swap) return null;
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-card, #eef2ea)' }} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <SectionLabel>Swap pool</SectionLabel>
        {swap.understaffed && <span className="badge" style={{ background: 'rgba(229,72,77,0.14)', color: '#e5484d', fontFamily: MONO, fontSize: 9 }}>UNDERSTAFFED</span>}
        <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--text-muted, #9bb4d4)' }}>{swap.interval_minutes}m</span>
      </div>
      {swap.fixed && (
        <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-secondary, #5d7188)' }}>
          <Icon name="lock" size={10} /> Fixed (INSP): <b>{String(swap.fixed.name || '').split(' ')[0]}</b>
        </div>
      )}
      {swap.current ? (
        <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-primary, #15366a)', marginTop: 2 }}>
          Now: <b>{String(swap.current.name || '').split(' ')[0]}</b> · <span style={{ fontFamily: MONO }}>{fmtMMSS(swap.current.remaining_seconds)}</span> left{swap.current.confirmed ? ' ✓' : ''}
        </div>
      ) : swap.has_schedule ? null : (
        <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-muted, #9bb4d4)', marginTop: 2 }}>No rotation generated</div>
      )}
      {swap.next && (
        <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-secondary, #5d7188)', marginTop: 2 }}>
          Next: {String(swap.next.name || '').split(' ')[0]}{swap.next.notify_soon ? ' · soon' : ''}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button className="btn btn-sm" style={{ padding: '3px 9px' }} onClick={() => onGenerate(swap)}>
          {swap.has_schedule ? 'Regenerate' : 'Generate rotation'}
        </button>
        {swap.has_schedule && <button className="btn btn-sm" style={{ padding: '3px 9px' }} onClick={() => onOverride(swap)}>Override time</button>}
      </div>
    </div>
  );
}

function StationCard({ station, onClick, onSwapGenerate, onSwapOverride, onViewQueue }) {
  const { code, name, running, queued, runningUids, queuedUids, jobs = [], category, staffingModel, minOperators, assignedOperators, shiftIssued, noDirect, swap } = station;
  const queueCount = (Number(running) || 0) + (Number(queued) || 0);
  const isIdle = running === 0 && queued === 0;
  const status = stationStatus(running, queued);
  const operators = jobs.map((j) => jpick(j, 'operator_name', 'operator')).filter(Boolean);
  const clickable = { cursor: 'pointer' };
  const isFurnace = category === 'heat_treatment';
  const showCrew = !noDirect && (isFurnace || staffingModel === 2 || minOperators > 1);

  // §7 — a furnace under its minimum crew reads "SHIFT NOT ISSUED" and blocks
  // batch/job assignment. Surface this even when the station is otherwise idle.
  if (isFurnace && !shiftIssued) {
    return (
      <div className="card" onClick={onClick} title="View workstation detail"
        style={{ padding: '16px 18px', border: '1.5px solid #e5484d', background: 'rgba(229,72,77,0.05)', display: 'flex', flexDirection: 'column', ...clickable }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>{code}</div>
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', marginTop: 1 }}>{name}</div>
          </div>
          <span className="badge" style={{ background: 'rgba(229,72,77,0.14)', color: '#e5484d', fontFamily: MONO, fontSize: 9.5 }}>SHIFT NOT ISSUED</span>
        </div>
        <CrewBar assigned={assignedOperators} min={minOperators} />
        <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--status-danger-dark, #c0392b)', marginTop: 8 }}>
          Assign {minOperators} operators (+ Supervisor) in Work Assignment before a furnace batch can run.
        </div>
      </div>
    );
  }

  // Idle tiles: smaller, greyed out, no queue info (per spec). Swap-pool stations
  // still show their rotation so a Supervisor can manage it while the queue is empty.
  if (isIdle && !(staffingModel === 2)) {
    return (
      <div
        className="card"
        onClick={onClick}
        title="View workstation detail"
        style={{ padding: '14px 16px', opacity: 0.62, display: 'flex', flexDirection: 'column', gap: 4, ...clickable }}
      >
        <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>{code}</div>
        <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary, #5d7188)' }}>{name}</div>
        <StatusPill status="idle" />
      </div>
    );
  }
  if (isIdle && staffingModel === 2) {
    return (
      <div className="card" onClick={onClick} title="View workstation detail" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', ...clickable }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>{code}</div>
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', marginTop: 1 }}>{name}</div>
          </div>
          <StatusPill status="idle" />
        </div>
        {showCrew && <CrewBar assigned={assignedOperators} min={minOperators} />}
        <SwapPanel swap={swap} onGenerate={onSwapGenerate} onOverride={onSwapOverride} />
      </div>
    );
  }

  const restRunning = runningUids.length;
  const visibleQueue = queuedUids.slice(0, 3);
  const moreQueue = queued - visibleQueue.length;

  return (
    <div className="card" onClick={onClick} title="View workstation detail" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', ...clickable }}>
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
      {showCrew && <CrewBar assigned={assignedOperators} min={minOperators} />}
      {staffingModel === 2 && <SwapPanel swap={swap} onGenerate={onSwapGenerate} onOverride={onSwapOverride} />}
      {onViewQueue && (
        <button className="btn btn-sm" style={{ marginTop: 8, justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); onViewQueue({ code, name }); }}>
          <Icon name="list" size={13} /> View queue ({queueCount})
        </button>
      )}
      {operators.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontFamily: SANS, fontSize: 11, color: 'var(--text-secondary, #5d7188)' }}>
          <Icon name="user" size={11} />
          {operators.slice(0, 2).map((o) => String(o).split(' ')[0]).join(', ')}{operators.length > 2 ? ` +${operators.length - 2}` : ''}
        </div>
      )}

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

function fmtWait(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
const NEXT_PRIORITY_UP = { Low: 'Normal', Normal: 'High', High: 'High' };
const NEXT_PRIORITY_DOWN = { High: 'Normal', Normal: 'Low', Low: 'Low' };

/* §Queue Management — right-side drawer over Production Floor: the UIDs waiting
   at a workstation with priority / wait / source, reprioritise, hold, assign, and
   furnace-batch group actions. */
function QueueDrawer({ workstation, operators, canModify, onClose, onChanged }) {
  const { data, loading, refetch } = usePolling(
    () => queueApi.get(workstation.code).then((r) => r.data).catch(() => ({ items: [] })),
    [workstation.code], { interval: 15000 }
  );
  const items = useMemo(() => (data?.items || []), [data]);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [assignFor, setAssignFor] = useState(null); // uid_code being assigned

  const run = async (fn) => {
    setBusy(true); setErr(null);
    try { await fn(); await refetch(); onChanged && onChanged(); }
    catch (e) { setErr(e?.message || 'Action failed.'); }
    finally { setBusy(false); }
  };
  const changePriority = (row, dir) => {
    const next = (dir === 'up' ? NEXT_PRIORITY_UP : NEXT_PRIORITY_DOWN)[row.priority] || 'Normal';
    if (next === row.priority) return;
    run(() => queueApi.setPriority([row.uid_code], next));
  };
  const holdRow = (row) => {
    const reason = window.prompt(`Hold ${row.uid_code} — reason:`);
    if (!reason || !reason.trim()) return;
    run(() => queueApi.hold([row.uid_code], reason.trim()));
  };
  const assignRow = (uidCode, operatorId) => run(() => queueApi.assign(uidCode, Number(operatorId))).then(() => setAssignFor(null));
  const prioritiseBatch = (ref, codes) => run(() => queueApi.setPriority(codes, 'High'));
  const holdBatch = (ref, codes) => {
    const reason = window.prompt(`Hold all of ${ref} — reason:`);
    if (!reason || !reason.trim()) return;
    run(() => queueApi.hold(codes, reason.trim()));
  };

  const active = items.filter((i) => i.status === 'active');
  const filtered = items.filter((i) => {
    if (filter === 'high') return i.priority === 'High' && i.status === 'active';
    if (filter === 'batch') return !!i.batch_ref && i.status === 'active';
    if (filter === 'hold') return i.status === 'hold';
    return i.status === 'active'; // 'all' = active queue
  });

  // Group by batch reference (batch arrivals cluster), non-batch rows loose.
  const batchGroups = {};
  const loose = [];
  for (const it of filtered) {
    if (it.batch_ref) { (batchGroups[it.batch_ref] = batchGroups[it.batch_ref] || []).push(it); }
    else loose.push(it);
  }

  const FILTERS = [['all', 'All'], ['high', 'High priority'], ['batch', 'Batch arrivals'], ['hold', 'On hold']];

  const Row = (it) => (
    <div key={it.uid_code} style={{ border: '1px solid var(--border-card, #e3ebde)', borderRadius: 9, padding: '9px 11px', marginBottom: 7, background: it.status === 'hold' ? 'rgba(229,72,77,0.04)' : '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ width: 22, height: 22, borderRadius: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 11, fontWeight: 700, color: '#fff', background: it.priority === 'High' ? '#e5484d' : '#9bb4d4' }}>{it.position}</span>
        <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: 'var(--text-primary, #15366a)' }}>{it.uid_code}</span>
        {it.size_mm ? <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary, #5d7188)' }}>{it.size_mm}mm</span> : null}
        {it.cycle_code ? <CycleBadge cycle={it.cycle_code} /> : null}
        <PriorityBadge priority={it.priority} />
        {it.status === 'hold' ? <span className="badge" style={{ background: 'rgba(229,72,77,0.14)', color: '#e5484d' }}>on hold</span> : null}
      </div>
      <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
        Wait: <span style={{ fontFamily: MONO }}>{fmtWait(it.wait_seconds)}</span>{it.source_step ? ` · From step ${it.source_step}${it.source_operation ? ` (${it.source_operation})` : ''}` : ''}
      </div>
      {canModify && it.status === 'active' && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-sm" style={{ padding: '3px 7px' }} disabled={busy} title="Raise priority" onClick={() => changePriority(it, 'up')}><Icon name="chevronRight" size={12} /> ↑</button>
          <button className="btn btn-sm" style={{ padding: '3px 7px' }} disabled={busy} title="Lower priority" onClick={() => changePriority(it, 'down')}>↓</button>
          <button className="btn btn-sm" style={{ padding: '3px 9px' }} disabled={busy} onClick={() => holdRow(it)}>Hold</button>
          {assignFor === it.uid_code ? (
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <select className="form-select" style={{ height: 30, fontSize: 12 }} disabled={busy} defaultValue="" onChange={(e) => e.target.value && assignRow(it.uid_code, e.target.value)}>
                <option value="">Operator…</option>
                {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button className="btn btn-sm" style={{ padding: '3px 7px' }} onClick={() => setAssignFor(null)}>✕</button>
            </span>
          ) : (
            <button className="btn btn-sm btn-primary" style={{ padding: '3px 9px' }} disabled={busy} onClick={() => setAssignFor(it.uid_code)}>Assign →</button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(12,24,44,0.38)', zIndex: 200, display: 'flex', justifyContent: 'flex-end' }}>
      <style>{'@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}'}</style>
      <div onMouseDown={(e) => e.stopPropagation()} className="card" style={{ width: 520, maxWidth: '95vw', height: '100%', borderRadius: 0, padding: 0, display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-modal)', animation: 'slideInRight 250ms ease-out' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-card, #e3ebde)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 17, color: 'var(--text-primary, #15366a)' }}>{workstation.code} Queue</span>
            <button className="btn btn-sm" onClick={onClose} style={{ width: 30, padding: 0, justifyContent: 'center' }}><Icon name="close" size={15} /></button>
          </div>
          <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', marginTop: 2 }}>
            {workstation.name} · {active.length} UID{active.length === 1 ? '' : 's'} waiting{loading && !data ? ' · loading…' : ''}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            {FILTERS.map(([k, label]) => (
              <button key={k} className="btn btn-sm" onClick={() => setFilter(k)}
                style={{ background: filter === k ? 'var(--text-primary, #15366a)' : '#fff', color: filter === k ? '#fff' : 'var(--text-secondary, #5d7188)', border: filter === k ? 'none' : '1px solid var(--border-input, #d6e0d2)', fontWeight: filter === k ? 700 : 500 }}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
          {err ? <div style={{ fontFamily: SANS, fontSize: 12.5, color: '#e5484d', marginBottom: 10 }}>{err}</div> : null}
          {filtered.length === 0 ? (
            <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', textAlign: 'center', padding: '30px 0' }}>
              {filter === 'hold' ? 'No held UIDs.' : 'Queue is clear — nothing waiting.'}
            </div>
          ) : (
            <>
              {Object.entries(batchGroups).map(([ref, group]) => {
                const codes = group.map((g) => g.uid_code);
                return (
                  <div key={ref} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px dashed var(--border-card, #e3ebde)', marginBottom: 8, flexWrap: 'wrap' }}>
                      <Icon name="stack" size={13} color="#2d6fb5" />
                      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: '#2d6fb5' }}>{ref}</span>
                      <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-secondary, #5d7188)' }}>{group.length} UIDs</span>
                      {canModify && (
                        <span style={{ display: 'inline-flex', gap: 6, marginLeft: 'auto' }}>
                          <button className="btn btn-sm" style={{ padding: '2px 8px' }} disabled={busy} onClick={() => prioritiseBatch(ref, codes)}>Prioritise all</button>
                          <button className="btn btn-sm" style={{ padding: '2px 8px' }} disabled={busy} onClick={() => holdBatch(ref, codes)}>Hold all</button>
                        </span>
                      )}
                    </div>
                    {group.map(Row)}
                  </div>
                );
              })}
              {loose.map(Row)}
            </>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-card, #e3ebde)', display: 'flex', alignItems: 'center', gap: 10, fontFamily: MONO, fontSize: 11.5, color: 'var(--text-secondary, #5d7188)' }}>
          <span>{active.length} UIDs</span><span>·</span>
          <span>{active.filter((i) => i.priority === 'High').length} High</span><span>·</span>
          <span>{Object.keys(batchGroups).length} batch group{Object.keys(batchGroups).length === 1 ? '' : 's'}</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function ProductionFloor() {
  const { location, locationLabel } = useApp();
  const { user, isSupervisor, isManager, isAdmin } = useAuth();
  const canModifyQueue = isSupervisor || isManager || isAdmin;
  const [search, setSearch] = useState('');
  const [storageFilter, setStorageFilter] = useState(null);
  const [selectedCode, setSelectedCode] = useState(null);
  const [queueFor, setQueueFor] = useState(null); // { code, name } → queue drawer
  const [floorOperators, setFloorOperators] = useState([]);
  useEffect(() => {
    let alive = true;
    employeesApi.list({ role: 'operator', location }).then((r) => {
      if (!alive) return;
      setFloorOperators((r.data || []).map((e) => ({ id: jpick(e, 'id'), name: jpick(e, 'full_name', 'name', 'username') || `Op ${jpick(e, 'id')}` })));
    }).catch(() => {});
    return () => { alive = false; };
  }, [location]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Live data. stationSummary gives the workstation roster + active counts;
  // the UID list gives the actual pieces. Both are polled together and merged
  // client-side into per-station running / queued buckets.
  const { data, loading, error, refetch } = usePolling(
    async () => {
      const [stations, active, held, wip, jobsRes, swapRes] = await Promise.all([
        uidsApi.stationSummary().then((r) => r.data),
        uidsApi.list({ location, status: 'active', per_page: 200 }).then((r) => r.data),
        uidsApi.list({ location, status: 'hold', per_page: 200 }).then((r) => r.data),
        uidsApi.wipSummary().then((r) => r.data).catch(() => []),
        jobsApi.list({}).then((r) => r.data).catch(() => []),
        swapApi.list().then((r) => r.data).catch(() => ({ pools: [] })),
      ]);
      const jobs = Array.isArray(jobsRes) ? jobsRes : (jobsRes?.jobs || jobsRes?.items || []);
      return { stations: stations || [], uids: [...(active || []), ...(held || [])], wip: wip || [], jobs, swap: swapRes?.pools || [] };
    },
    [location]
  );

  const stations = data?.stations || [];
  const uids = data?.uids || [];
  const wip = data?.wip || [];
  const jobs = data?.jobs || [];
  const swapByCode = useMemo(() => {
    const m = new Map();
    for (const p of data?.swap || []) m.set(p.code, p);
    return m;
  }, [data]);

  const handleSwapGenerate = async (swap) => {
    try { await swapApi.generate(swap.workstation_type_id, swap.interval_minutes || 60); await refetch(); }
    catch (e) { window.alert(e?.message || 'Could not generate the rotation.'); }
  };
  const handleSwapOverride = async (swap) => {
    const val = window.prompt(`Override swap interval for ${swap.code} (minutes, this shift only):`, String(swap.interval_minutes || 60));
    if (!val) return;
    const mins = Number(val);
    if (!mins || mins < 5 || mins > 480) { window.alert('Enter a number of minutes between 5 and 480.'); return; }
    try { await swapApi.setInterval(swap.workstation_type_id, mins); await refetch(); }
    catch (e) { window.alert(e?.message || 'Could not override the interval.'); }
  };

  const jobsByStation = useMemo(() => {
    const m = new Map();
    for (const j of jobs) {
      const code = jpick(j, 'workstation_type_code', 'workstation_code', 'unit_code') || '—';
      if (!m.has(code)) m.set(code, []);
      m.get(code).push(j);
    }
    return m;
  }, [jobs]);

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
        jobs: jobsByStation.get(s.code) || [],
        category: s.category,
        staffingModel: s.staffing_model ?? null,
        minOperators: Number(s.min_operators) || 1,
        assignedOperators: Number(s.assigned_operators) || 0,
        crewMet: s.crew_met !== false,
        shiftIssued: s.shift_issued !== false,
        noDirect: !!s.no_direct_assignment,
        swap: swapByCode.get(s.code) || null,
      };
    });
  }, [stations, filteredUids, jobsByStation, swapByCode]);

  const visibleCards = stationCards;

  const selectedStation = useMemo(() => stationCards.find((s) => s.code === selectedCode) || null, [stationCards, selectedCode]);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-sm" onClick={refetch} type="button">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        </div>
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
            ) : visibleCards.length === 0 ? (
              <EmptyState message="No workstations configured for this location." />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
                {visibleCards.map((s) => (
                  <StationCard key={s.code} station={s} onClick={() => setSelectedCode(s.code)} onSwapGenerate={handleSwapGenerate} onSwapOverride={handleSwapOverride} onViewQueue={setQueueFor} />
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

      {selectedStation && (
        <StationDrawer station={selectedStation} nowMs={nowMs} onClose={() => setSelectedCode(null)} />
      )}

      {queueFor && (
        <QueueDrawer
          workstation={queueFor}
          operators={floorOperators}
          canModify={canModifyQueue}
          onClose={() => setQueueFor(null)}
          onChanged={refetch}
        />
      )}
    </div>
  );
}

/* Right-side detail drawer: the "My Workstation" view for one station —
   live operator jobs (with timers) plus the pending-UID lists. */
function StationDrawer({ station, nowMs, onClose }) {
  const jobs = station.jobs || [];
  const active = jobs.filter((j) => ACTIVE_JOB_STATUSES.includes(jstatus(j)));
  const queued = jobs.filter((j) => !ACTIVE_JOB_STATUSES.includes(jstatus(j)));

  const JobRow = ({ j }) => {
    const running = jstatus(j) === 'in_progress';
    const secs = (Number(jpick(j, 'net_work_seconds', 'net_seconds')) || 0) + (running ? elapsedFrom(jpick(j, 'started_at'), nowMs) : 0);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: '1px solid var(--border-card, #eef2f7)', fontFamily: SANS, fontSize: 12.5 }}>
        <StatusPill status={jstatus(j)} />
        <span style={{ color: 'var(--text-primary, #15366a)', fontWeight: 600 }}>{jpick(j, 'operator_name', 'operator') || 'Unassigned'}</span>
        {jpick(j, 'uid_code', 'uid') && <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary, #5d7188)' }}>{jpick(j, 'uid_code', 'uid')}</span>}
        {jpick(j, 'step_number', 'step') != null && <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted, #9bb4d4)' }}>· Step {jpick(j, 'step_number', 'step')}</span>}
        {running && <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11, fontWeight: 700, color: 'var(--text-primary, #15366a)' }}>{fmtHMS(secs)}</span>}
      </div>
    );
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,50,0.35)', zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 92vw)', height: '100%', background: 'var(--bg-card, #fff)', borderLeft: '1px solid var(--border-card, #e6ecf3)', boxShadow: '-8px 0 30px rgba(0,0,0,0.12)', overflowY: 'auto', padding: '20px 22px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 19, color: 'var(--text-primary, #15366a)' }}>{station.name}</div>
            <div style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--text-secondary, #5d7188)', marginTop: 2 }}>{station.code}</div>
          </div>
          <button className="btn btn-sm" type="button" onClick={onClose}><Icon name="close" size={14} /></button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <Stat label="In progress" value={station.running} />
          <Stat label="Queued" value={station.queued} />
          <Stat label="Operators" value={new Set(jobs.map((j) => jpick(j, 'operator_id', 'operator_name')).filter(Boolean)).size} />
        </div>

        {/* Active now — who is working and the UID currently on the machine. */}
        {active.length > 0 && (
          <div className="card" style={{ marginTop: 16, padding: '12px 14px', boxShadow: 'none', background: 'var(--bg-muted, #f4f7f2)', borderLeft: '4px solid var(--status-success, #22a06b)' }}>
            <SectionLabel style={{ marginBottom: 8 }}>Active now</SectionLabel>
            {active.map((j) => {
              const running = jstatus(j) === 'in_progress';
              const secs = (Number(jpick(j, 'net_work_seconds', 'net_seconds')) || 0) + (running ? elapsedFrom(jpick(j, 'started_at'), nowMs) : 0);
              return (
                <div key={jpick(j, 'id', 'job_id') || jpick(j, 'uid_code')} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <Icon name="user" size={14} color="var(--text-secondary, #5d7188)" />
                  <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                    <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #15366a)' }}>{jpick(j, 'operator_name', 'operator') || 'Unassigned'}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary, #5d7188)' }}>
                      {jpick(j, 'uid_code', 'uid') || '— no UID —'}
                      {jpick(j, 'step_number', 'step') != null ? ` · Step ${jpick(j, 'step_number', 'step')}` : ''}
                      {jpick(j, 'operation_name') ? ` · ${jpick(j, 'operation_name')}` : ''}
                    </span>
                  </div>
                  {running && <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 13, fontWeight: 700, color: 'var(--status-success-dark, #1c7a52)' }}>{fmtHMS(secs)}</span>}
                </div>
              );
            })}
          </div>
        )}

        <SectionLabel style={{ marginTop: 20, marginBottom: 6 }}>Active jobs</SectionLabel>
        {active.length ? active.map((j) => <JobRow key={jpick(j, 'id', 'job_id') || jpick(j, 'uid_code')} j={j} />)
          : <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-muted, #9bb4d4)' }}>No operator job in progress.</div>}

        {queued.length > 0 && (
          <>
            <SectionLabel style={{ marginTop: 18, marginBottom: 6 }}>Assigned queue · {queued.length}</SectionLabel>
            {queued.map((j) => <JobRow key={jpick(j, 'id', 'job_id') || jpick(j, 'uid_code')} j={j} />)}
          </>
        )}

        <SectionLabel style={{ marginTop: 18, marginBottom: 6 }}>Pieces at this station</SectionLabel>
        {(station.runningUids.length + station.queuedUids.length) === 0 ? (
          <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-muted, #9bb4d4)' }}>No UID pieces attributed here.</div>
        ) : (
          <>
            {station.runningUids.map((u) => <UidRow key={u.uid_code} uid={u} />)}
            {station.queuedUids.slice(0, 12).map((u) => <UidRow key={u.uid_code} uid={u} />)}
          </>
        )}
      </div>
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
