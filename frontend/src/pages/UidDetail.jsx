import { useParams, Link } from 'react-router-dom';
import { usePolling } from '../hooks/usePolling';
import { uidsApi } from '../api/uids';
import Icon from '../components/common/Icon';
import { CycleBadge, StatusPill, PriorityBadge } from '../components/common/Badges';

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";

// Total steps per cycle (per spec PAGE 11: EAT = 27 steps).
const CYCLE_TOTAL_STEPS = { EAT: 27 };

// Map backend UID status → human label shown in the header pill.
const STATUS_LABEL = {
  active: 'Active',
  hold: 'On Hold',
  done: 'Dispatched',
  scrap: 'Scrapped',
};

// ─────────────────────────────────────────────────────────────────────────────
// Small presentational helpers
// ─────────────────────────────────────────────────────────────────────────────

function SectionCard({ title, icon, children, action }) {
  return (
    <div className="card" style={{ padding: '18px 20px', marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {icon ? <Icon name={icon} size={15} color="var(--text-muted-2, #7d96bb)" /> : null}
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-muted, #9bb4d4)',
            flex: 1,
          }}
        >
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, mono, link, empty = '—' }) {
  const hasValue = value !== null && value !== undefined && value !== '';
  return (
    <div>
      <div className="form-label" style={{ marginBottom: 4 }}>{label}</div>
      <div
        style={{
          fontFamily: mono ? MONO : SANS,
          fontSize: 13,
          color: hasValue ? 'var(--text-primary, #15366a)' : 'var(--text-muted, #9bb4d4)',
        }}
      >
        {hasValue ? (link ? <Link to={link} style={{ color: 'var(--cycle-eat, #2d6fb5)' }}>{value}</Link> : value) : empty}
      </div>
    </div>
  );
}

function FieldGrid({ children, cols = 3 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '16px 20px' }}>
      {children}
    </div>
  );
}

// Format a numeric step value as a comparable sequence index. Step numbers can
// be strings like '16B', so we sort by step_history order rather than parsing.
function durationLabel(seconds) {
  if (seconds == null) return '—';
  const s = Number(seconds);
  if (Number.isNaN(s) || s <= 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function timeSince(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'just now';
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const dys = Math.floor(h / 24);
  return `${dys}d ${h % 24}h`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step progress tracker — horizontally scrollable node strip.
// We derive the ordered list of steps from step_history (completed/started)
// plus the current step. The full cycle definition is not part of the detail
// payload, so upcoming steps beyond what's known are represented by the
// cycle's total-step count (when known) as outlined placeholders.
// ─────────────────────────────────────────────────────────────────────────────

function StepTracker({ uid }) {
  const history = Array.isArray(uid.step_history) ? uid.step_history : [];
  const currentStep = uid.current_step;
  const cycle = uid.cycle_code;
  const total = CYCLE_TOTAL_STEPS[cycle] || null;

  // Build ordered nodes from history (already ordered by closed_at on backend).
  const seen = new Set();
  const nodes = [];
  for (const log of history) {
    const key = String(log.step_number);
    if (seen.has(key)) continue;
    seen.add(key);
    const isTemper = (log.operation_name || '').toLowerCase().includes('temper') || log.furnace_batch_number;
    const isSplit = key === '16' || key === '16B';
    nodes.push({
      step: key,
      name: log.operation_name,
      operator: log.operator_name,
      date: log.closed_at || log.started_at,
      furnace: log.furnace_batch_number,
      state: String(currentStep) === key ? 'current' : 'done',
      temper: isTemper,
      split: isSplit,
    });
  }

  // Ensure the current step is represented even if it has no log row yet.
  if (currentStep != null && !seen.has(String(currentStep))) {
    seen.add(String(currentStep));
    nodes.push({
      step: String(currentStep),
      name: null,
      state: 'current',
      temper: false,
      split: String(currentStep) === '16' || String(currentStep) === '16B',
    });
  }

  // Append outlined placeholders for remaining upcoming steps (when total known).
  if (total) {
    const numericCurrent = parseInt(String(currentStep), 10);
    for (let n = (Number.isNaN(numericCurrent) ? nodes.length : numericCurrent) + 1; n <= total; n += 1) {
      if (seen.has(String(n))) continue;
      nodes.push({ step: String(n), name: null, state: 'upcoming', temper: false, split: n === 16 });
    }
  }

  if (nodes.length === 0) {
    return <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-muted, #9bb4d4)' }}>No step activity recorded yet.</div>;
  }

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, minWidth: 'min-content' }}>
        {nodes.map((n, i) => {
          const done = n.state === 'done';
          const current = n.state === 'current';
          const upcoming = n.state === 'upcoming';
          const baseColor = current
            ? 'var(--cycle-eat, #2d6fb5)'
            : done
              ? 'var(--status-success, #22a06b)'
              : 'var(--border-muted, #cdd9c8)';
          const fill = upcoming ? 'transparent' : baseColor;
          const tip = [
            n.name ? `Step ${n.step} — ${n.name}` : `Step ${n.step}`,
            n.operator ? `Operator: ${n.operator}` : null,
            n.date ? `Date: ${fmtDate(n.date)}` : null,
            n.temper && n.furnace ? `Furnace batch: ${n.furnace}` : null,
            n.split ? 'Split step (Converting)' : null,
          ].filter(Boolean).join('\n');

          return (
            <div key={`${n.step}-${i}`} style={{ display: 'flex', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 56 }} title={tip}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: n.split ? 6 : '50%',
                    background: fill,
                    border: `2px solid ${upcoming ? 'var(--border-muted, #cdd9c8)' : baseColor}`,
                    boxShadow: n.temper && !upcoming ? '0 0 0 3px rgba(192,118,43,0.25)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: upcoming ? 'var(--text-muted, #9bb4d4)' : '#fff',
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 700,
                    animation: current ? 'cp-pulse 1.4s ease-in-out infinite' : 'none',
                    flexShrink: 0,
                  }}
                >
                  {n.split ? <Icon name="flow" size={14} color={upcoming ? 'var(--text-muted, #9bb4d4)' : '#fff'} /> : n.step}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontFamily: MONO,
                    fontSize: 8.5,
                    textAlign: 'center',
                    lineHeight: 1.2,
                    color: current ? 'var(--cycle-eat, #2d6fb5)' : 'var(--text-muted, #9bb4d4)',
                    maxWidth: 54,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {n.temper ? '🔥 ' : ''}{n.name || (upcoming ? '·' : `Step ${n.step}`)}
                </div>
              </div>
              {i < nodes.length - 1 ? (
                <div style={{ height: 30, display: 'flex', alignItems: 'center' }}>
                  <div style={{ width: 18, height: 2, background: done ? 'var(--status-success, #22a06b)' : 'var(--border-muted, #cdd9c8)' }} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Possible-heats list — honest traceability. Never a single definitive heat.
// ─────────────────────────────────────────────────────────────────────────────

function PossibleHeats({ label, heats }) {
  const list = Array.isArray(heats) ? heats : [];
  return (
    <div>
      <div className="form-label" style={{ marginBottom: 6 }}>{label}</div>
      {list.length === 0 ? (
        <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-muted, #9bb4d4)' }}>No heat numbers recorded</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {list.map((h, i) => (
            <span
              key={`${h}-${i}`}
              className="badge"
              style={{ background: 'rgba(217,122,43,0.12)', color: 'var(--location-faridabad, #d97a2b)', fontSize: 11, padding: '3px 9px' }}
            >
              {String(h)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function LineageChip({ code, status }) {
  return (
    <Link
      to={`/uid/${code}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 11px', borderRadius: 8,
        border: '1px solid var(--border-card, #e3ebde)', background: 'var(--bg-muted, #f4f7f2)',
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: 'var(--cycle-eat, #2d6fb5)' }}>{code}</span>
      {status ? <StatusPill status={status} label={STATUS_LABEL[status] || status} /> : null}
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function UidDetail() {
  const { code } = useParams();

  const { data, error, loading } = usePolling(
    async () => {
      const [detail, lineage] = await Promise.all([
        uidsApi.detail(code).then((r) => r.data),
        uidsApi.lineage(code).then((r) => r.data).catch(() => null),
      ]);
      return { uid: detail, lineage };
    },
    [code]
  );

  // ── Loading ──
  if (loading && !data) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
        <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)' }}>Loading UID {code}…</div>
      </div>
    );
  }

  // ── Error / not found ──
  if (error || !data?.uid) {
    const notFound = error?.code === 'UID_NOT_FOUND' || !data?.uid;
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
        <div className="card" style={{ padding: '28px 24px', textAlign: 'center' }}>
          <Icon name="alert" size={26} color="var(--status-danger, #e5484d)" />
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, letterSpacing: '-0.03em', marginTop: 10, color: 'var(--text-primary, #15366a)' }}>
            {notFound ? `UID ${code} not found` : 'Could not load this UID'}
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 6 }}>
            {error?.message || 'The requested unit identifier does not exist.'}
          </div>
        </div>
      </div>
    );
  }

  const uid = data.uid;
  const lineage = data.lineage || {};
  const onHold = uid.status === 'hold';
  const designPending = !uid.design_code;
  const children = lineage.children || uid.children || [];
  const siblings = lineage.siblings || uid.siblings || [];
  const parentCode = lineage.parent?.uid_code || uid.parent_uid_code;
  const parentStatus = lineage.parent?.status;
  const split = uid.split_event;
  const totalSteps = CYCLE_TOTAL_STEPS[uid.cycle_code] || null;
  const history = Array.isArray(uid.step_history) ? uid.step_history : [];
  const currentLog = history.find((l) => String(l.step_number) === String(uid.current_step));

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
            Unit Identifier
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 4, flexWrap: 'wrap' }}>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 38, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)', lineHeight: 1 }}>
              {uid.uid_code}
            </div>
            <StatusPill status={uid.status} label={STATUS_LABEL[uid.status] || uid.status} />
            <CycleBadge cycle={uid.cycle_code} />
            <PriorityBadge priority={uid.priority} />
          </div>
        </div>
      </div>

      {/* ── Quick actions (role-gated server-side; shown as affordances) ── */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {designPending ? (
          <button className="btn btn-primary btn-sm"><Icon name="check" size={14} color="var(--accent-green, #d4eecb)" /> Confirm design</button>
        ) : null}
        <button className="btn btn-sm"><Icon name="link" size={14} /> Link MO</button>
        <button className="btn btn-sm"><Icon name="tag" size={14} /> Change priority</button>
        {onHold ? (
          <button className="btn btn-sm"><Icon name="play" size={14} /> Release hold</button>
        ) : (
          <button className="btn btn-danger btn-sm"><Icon name="pause" size={14} color="#fff" /> Place hold</button>
        )}
      </div>

      {/* ── On-hold banner ── */}
      {onHold ? (
        <div
          className="card"
          style={{ marginTop: 16, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, borderColor: 'rgba(229,72,77,0.4)', background: 'rgba(229,72,77,0.05)' }}
        >
          <Icon name="pause" size={18} color="var(--status-danger, #e5484d)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: 'var(--status-danger, #e5484d)' }}>On hold</div>
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', marginTop: 2 }}>
              {uid.hold_reason || 'No reason recorded.'}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Design-pending warning ── */}
      {designPending ? (
        <div
          className="card"
          style={{ marginTop: 16, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, borderColor: 'rgba(217,122,43,0.4)', background: 'var(--bg-soft-amber, #fdf6ef)' }}
        >
          <Icon name="alert" size={18} color="var(--status-warning, #d97a2b)" />
          <div style={{ flex: 1, fontFamily: SANS, fontSize: 13, color: 'var(--status-warning, #d97a2b)', fontWeight: 600 }}>
            Design / drawing not yet confirmed for this UID.
          </div>
          <button className="btn btn-primary btn-sm"><Icon name="check" size={14} color="var(--accent-green, #d4eecb)" /> Confirm design (Manager)</button>
        </div>
      ) : null}

      {/* ── Current production status ── */}
      <SectionCard title="Current Production Status" icon="factory">
        <FieldGrid cols={4}>
          <Field
            label="Current step"
            mono
            value={
              uid.current_step != null
                ? `${uid.current_step}${totalSteps ? ` / ${totalSteps}` : ''}${currentLog?.operation_name ? ` — ${currentLog.operation_name}` : ''}`
                : null
            }
          />
          <Field label="Current workstation" mono value={currentLog?.unit_code} />
          <Field label="Storage location" mono value={uid.storage_code} />
          <Field label="Time at current step" value={timeSince(currentLog?.started_at) || '—'} />
        </FieldGrid>
      </SectionCard>

      {/* ── Step progress tracker ── */}
      <SectionCard
        title={`Step Progress Tracker${uid.cycle_code === 'EAT' ? ' · EAT — 27 steps' : ''}`}
        icon="flow"
      >
        <StepTracker uid={uid} />
        <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap', fontFamily: MONO, fontSize: 9.5, color: 'var(--text-muted, #9bb4d4)' }}>
          <Legend color="var(--status-success, #22a06b)" label="Completed" />
          <Legend color="var(--cycle-eat, #2d6fb5)" label="Current (pulsing)" />
          <Legend color="var(--border-muted, #cdd9c8)" label="Upcoming" outline />
          <span>Tempering (glow) · square node = Split (Step 16)</span>
        </div>
      </SectionCard>

      {/* ── Product details ── */}
      <SectionCard title="Product Details" icon="tag">
        <FieldGrid cols={4}>
          <Field label="Product type" value={uid.product_type || uid.product_name} />
          <Field label="Size (mm)" mono value={uid.size_mm} />
          <Field label="Design / drawing no." mono value={uid.design_code} empty="Pending" />
          <Field label="MO number" mono value={uid.mo_number} link={uid.mo_number ? `/mo/${uid.mo_number}` : null} />
        </FieldGrid>
      </SectionCard>

      {/* ── Material origin + honest-traceability heats ── */}
      <SectionCard title="Material Origin" icon="stack">
        <FieldGrid cols={3}>
          <Field
            label="Faridabad batch reference"
            mono
            value={uid.dispatch_batch_reference}
            link={uid.dispatch_batch_reference ? `/faridabad/dispatch/${uid.dispatch_batch_reference}` : null}
          />
          <Field label="Rolling contractor" value={uid.contractor_name} />
          <Field label="Color code" value={uid.color_name} />
          <Field label="Receiving reference (Dharmapuri)" mono value={uid.receiving_reference} />
          <Field label="Received at" value={fmtDate(uid.received_at || uid.receiving_date)} />
        </FieldGrid>

        {/* Honest-traceability caveat: heats are POSSIBLE, never definitive. */}
        <div
          style={{
            marginTop: 16, padding: '12px 14px', borderRadius: 9,
            background: 'var(--bg-soft-amber, #fdf6ef)', border: '1px solid rgba(217,122,43,0.25)',
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}
        >
          <Icon name="alert" size={15} color="var(--status-warning, #d97a2b)" />
          <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary, #5d7188)', lineHeight: 1.5 }}>
            Heat numbers below are <strong style={{ color: 'var(--status-warning, #d97a2b)' }}>possible</strong> origins for this
            piece, not a single confirmed value. A dispatch batch may mix multiple heats, so every candidate heat in the source
            batch is listed for honest traceability.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px 20px', marginTop: 14 }}>
          <PossibleHeats label="Possible alloy steel heats" heats={uid.possible_alloy_heats} />
          <PossibleHeats label="Possible MS heats" heats={uid.possible_ms_heats} />
        </div>
      </SectionCard>

      {/* ── Lineage ── */}
      <SectionCard title="Lineage" icon="flow">
        {!parentCode && children.length === 0 && siblings.length === 0 ? (
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-muted, #9bb4d4)' }}>
            No split lineage — this UID has no parent or children.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {parentCode ? (
              <div>
                <div className="form-label" style={{ marginBottom: 8 }}>Parent UID (this is a split child)</div>
                <LineageChip code={parentCode} status={parentStatus} />
              </div>
            ) : null}
            {siblings.length > 0 ? (
              <div>
                <div className="form-label" style={{ marginBottom: 8 }}>Sibling UIDs (same split)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {siblings.map((s) => <LineageChip key={s.uid_code} code={s.uid_code} status={s.status} />)}
                </div>
              </div>
            ) : null}
            {children.length > 0 ? (
              <div>
                <div className="form-label" style={{ marginBottom: 8 }}>Child UIDs (created by Converting at Step 16)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {children.map((c) => <LineageChip key={c.uid_code} code={c.uid_code} status={c.status} />)}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>

      {/* ── Split event record ── */}
      {split ? (
        <SectionCard title="Split Event Record (Converting · Step 16)" icon="flow">
          <FieldGrid cols={4}>
            <Field label="Split reference" mono value={split.id != null ? `SPLIT-${split.id}` : null} />
            <Field label="Date / time" value={fmtDate(split.created_at)} />
            <Field label="Conversion pattern" value={split.conversion_pattern_name || (split.conversion_pattern_id != null ? `Pattern #${split.conversion_pattern_id}` : 'Custom')} />
            <Field label="Input length (mm)" mono value={split.input_length_mm} />
            <Field label="Child lengths (mm)" mono value={Array.isArray(split.child_lengths_mm) ? split.child_lengths_mm.join(' · ') : null} />
            <Field label="Cuts" mono value={split.cuts} />
            <Field label="Total kerf (mm)" mono value={split.kerf_total_mm} />
            <Field label="Scrap (mm)" mono value={split.scrap_mm} />
            <Field label="Scrap reason" value={split.scrap_reason} />
            <Field label="Authorised by" value={split.authorised_by_name || (split.authorised_by != null ? `Employee #${split.authorised_by}` : null)} />
          </FieldGrid>
        </SectionCard>
      ) : null}

      {/* ── Step history table ── */}
      <SectionCard title="Step History" icon="list">
        {history.length === 0 ? (
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-muted, #9bb4d4)' }}>No completed steps logged yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: 12.5 }}>
              <thead>
                <tr>
                  {['Step', 'Operation', 'Workstation', 'Operator', 'Started', 'Completed', 'Duration', 'QC', 'QC value', 'Notes'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left', padding: '8px 10px', whiteSpace: 'nowrap',
                        fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
                        color: 'var(--text-muted, #9bb4d4)', borderBottom: '1px solid var(--border-card, #e3ebde)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((log, i) => {
                  const isTemper = (log.operation_name || '').toLowerCase().includes('temper') || log.furnace_batch_number;
                  return (
                    <tr key={log.id ?? i} style={{ borderBottom: '1px solid var(--bg-muted, #f4f7f2)' }}>
                      <td style={{ padding: '9px 10px', fontFamily: MONO, color: 'var(--text-primary, #15366a)' }}>{log.step_number}</td>
                      <td style={{ padding: '9px 10px' }}>
                        {isTemper ? '🔥 ' : ''}{log.operation_name || '—'}
                        {isTemper && log.furnace_batch_number ? (
                          <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--text-secondary, #5d7188)', marginTop: 3 }}>
                            <Link to={`/furnace/${log.furnace_batch_number}`} style={{ color: 'var(--cycle-oven, #c0762b)' }}>
                              Batch {log.furnace_batch_number}
                            </Link>
                            {' · '}
                            {`tgt ${log.target_temp_c ?? '—'}°C/${log.target_soak_min ?? '—'}m`}
                            {' · '}
                            {`act ${log.actual_temp_c ?? '—'}°C/${log.actual_soak_min ?? '—'}m`}
                            {log.deviation_flag ? <span style={{ color: 'var(--status-danger, #e5484d)', fontWeight: 700 }}> · DEVIATION</span> : null}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ padding: '9px 10px', fontFamily: MONO }}>{log.unit_code || '—'}</td>
                      <td style={{ padding: '9px 10px' }}>{log.operator_name || '—'}</td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', color: 'var(--text-secondary, #5d7188)' }}>{fmtDate(log.started_at)}</td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', color: 'var(--text-secondary, #5d7188)' }}>{fmtDate(log.closed_at)}</td>
                      <td style={{ padding: '9px 10px', fontFamily: MONO }}>{durationLabel(log.net_work_seconds ?? log.total_elapsed_seconds)}</td>
                      <td style={{ padding: '9px 10px' }}>
                        {log.qc_result ? <StatusPill status={log.qc_result} label={log.qc_result} /> : <span style={{ color: 'var(--text-muted, #9bb4d4)' }}>—</span>}
                      </td>
                      <td style={{ padding: '9px 10px', fontFamily: MONO }}>{log.qc_value || '—'}</td>
                      <td style={{ padding: '9px 10px', color: 'var(--text-secondary, #5d7188)', maxWidth: 200 }}>{log.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function Legend({ color, label, outline }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span
        style={{
          width: 10, height: 10, borderRadius: '50%',
          background: outline ? 'transparent' : color,
          border: `2px solid ${color}`,
        }}
      />
      {label}
    </span>
  );
}
