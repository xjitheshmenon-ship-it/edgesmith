/**
 * Shared badge/pill components, matching the locked design's cycleBadge()
 * and statusPill() helpers exactly (same colors, same shape).
 */

const CYCLE_COLORS = { EAT: '#2d6fb5', SWAN: '#7a4fc0', OVEN: '#c0762b' };

const STATUS_COLORS = {
  active: '#22a06b',
  running: '#22a06b',
  in_progress: '#22a06b',
  pass: '#22a06b',
  done: '#1c7a52',
  closed: '#1c7a52',
  hold: '#e5484d',
  fail: '#e5484d',
  paused: '#d97a2b',
  pending: '#d97a2b',
  waiting: '#9aa0a6',
  idle: '#9aa0a6',
  queued: '#9aa0a6',
  ready: '#3b82f6',
  borderline: '#f0a020',
};

const PRIORITY_COLORS = { High: '#e5484d', Normal: '#5d7188', Low: '#9aa0a6' };

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function CycleBadge({ cycle }) {
  const color = CYCLE_COLORS[cycle] || '#5d7188';
  return (
    <span className="badge" style={{ background: hexToRgba(color, 0.14), color }}>
      {cycle}
    </span>
  );
}

export function StatusPill({ status, label }) {
  const color = STATUS_COLORS[String(status).toLowerCase()] || '#9aa0a6';
  return (
    <span className="status-pill" style={{ background: hexToRgba(color, 0.14), color }}>
      {(label || status || '').toString().toUpperCase()}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  const color = PRIORITY_COLORS[priority] || '#5d7188';
  return (
    <span className="badge" style={{ background: hexToRgba(color, 0.14), color }}>
      {priority === 'High' ? '● HIGH' : priority?.toUpperCase()}
    </span>
  );
}

export function LocationBadge({ location }) {
  const isFaridabad = location === 'faridabad' || location === 'Faridabad';
  const color = isFaridabad ? '#d97a2b' : '#3b82f6';
  return (
    <span className="badge" style={{ background: hexToRgba(color, 0.14), color }}>
      {isFaridabad ? 'FARIDABAD' : 'DHARMAPURI'}
    </span>
  );
}

export { hexToRgba, CYCLE_COLORS, STATUS_COLORS, PRIORITY_COLORS };
