import { useState, useMemo, useRef } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useAuth } from '../store/AuthContext';
import { cyclesApi, masterApi } from '../api/resources';
import { downloadJSON, downloadCSV, downloadPDF } from '../utils/exporters';
import Icon from '../components/common/Icon';
import { CycleBadge, StatusPill } from '../components/common/Badges';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

/* ════════════════════════════════════════════════════════════════════
   Capacity rule model (spec PAGE 15 + STEP CAPACITY DETAIL)
   Four variants. The furnace/bunch/grinding formulas are explicit in the
   spec, so derived figures are computed client-side and shown read-only.
   ════════════════════════════════════════════════════════════════════ */
const SIZES = [1500, 1424, 2750]; // base size first
const BASE_SIZE = 1500;

// Furnace: floor(base × 1500 / bar_length)
function furnaceDerived(base) {
  const b = Number(base) || 0;
  return SIZES.map((mm) => ({ mm, bars: Math.floor((b * BASE_SIZE) / mm) }));
}

// Bunch grinding: bed 3000mm, sets placed end-to-end, set length = bar length.
//   sets per run = floor(3000 / bar_length); bars per run = sets × barsPerSet
function bunchDerived(barsPerSet) {
  const n = Number(barsPerSet) || 0;
  return SIZES.map((mm) => {
    const sets = Math.floor(3000 / mm);
    return { mm, sets, bars: sets * n };
  });
}

/**
 * Default cycle-builder step definitions (spec PAGE 9 step table + PAGE 15
 * capacity assignment). Used as the fallback / overlay when the API's per-step
 * payload doesn't carry an explicit capacity rule, so every step renders the
 * correct CAP variant regardless of backend shape.
 */
const FIXED_STEPS = new Set([1, 2, 3, 5, 8, 11, 13, 15, 16, 16.5, 17, 18, 19, 21, 24, 25, 26, 27]);
const FURNACE_STEP = {
  6: { ws: 'HT70', base: 6 },
  7: { ws: 'HT80', base: 6 },
  9: { ws: 'HT90', base: 80 },
  10: { ws: 'HT90', base: 80 },
  14: { ws: 'HT90', base: 80 },
  23: { ws: 'HT90', base: 80 },
};
const GRINDING_STEP = {
  12: { ws: 'SG-DLT' },
  20: { ws: 'SG-DLT' },
  22: { ws: 'AG-ALP / AG-BTA / AG-GMM' },
};
const BUNCH_STEP = { 4: { ws: 'SG-DLT', barsPerSet: 5 } };

/* Bevel machine bed reference (spec STEP CAPACITY DETAIL, Step 22) */
const BEVEL_MACHINES = [
  { code: 'AG-ALP', max: 1500, note: '1 bar at a time' },
  { code: 'AG-BTA', max: 1500, note: '1 bar at a time' },
  { code: 'AG-GMM', max: 3000, note: 'combined ≤ 3000mm' },
];

const num = (v) => (typeof v === 'number' ? v : Number(v));
function pick(o, ...keys) {
  for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k];
  return undefined;
}
function asList(data) {
  if (Array.isArray(data)) return data;
  return data?.items || data?.cycles || data?.rows || data?.steps || data?.versions || [];
}

/* Classify a step's capacity rule from its number (the spec's authoritative
   assignment) falling back to any rule the API supplies. */
function classifyStep(stepNo, raw) {
  // Honour an explicit API capacity_rule if present.
  const explicit = pick(raw || {}, 'capacity_rule', 'capacityRule', 'cap_rule');
  const n = stepNo;
  if (FURNACE_STEP[n] || explicit === 'furnace_scaled') {
    const def = FURNACE_STEP[n] || {};
    const base = num(pick(raw || {}, 'capacity_base', 'base_capacity', 'cap', 'capacity')) || def.base || 6;
    return { kind: 'furnace_scaled', ws: def.ws || pick(raw, 'workstation', 'workstation_code'), base };
  }
  if (BUNCH_STEP[n] || explicit === 'bunch') {
    const def = BUNCH_STEP[n] || {};
    const barsPerSet = num(pick(raw || {}, 'bars_per_set', 'barsPerSet', 'cap', 'capacity')) || def.barsPerSet || 5;
    return { kind: 'bunch', ws: def.ws || pick(raw, 'workstation', 'workstation_code'), barsPerSet };
  }
  if (GRINDING_STEP[n] || explicit === 'length_based') {
    const def = GRINDING_STEP[n] || {};
    return { kind: 'length_based', ws: def.ws || pick(raw, 'workstation', 'workstation_code') };
  }
  // default: fixed
  const value = num(pick(raw || {}, 'cap', 'capacity', 'capacity_value')) || 1;
  return { kind: 'fixed', value };
}

/* ───────── editor: step-type vocabulary + export columns ───────── */

// Common step_type values seen in the spec data. Any distinct values found in
// the loaded steps are merged in (handled in StepsEditor) so nothing is lost.
const DEFAULT_STEP_TYPES = ['normal', 'heat_treatment', 'grinding', 'qc'];
const CAPACITY_BASES = ['fixed', 'per_unit'];

// Columns for the CSV / PDF exports of a cycle's current steps.
const EXPORT_COLUMNS = [
  { key: 'step_number', label: 'Step #' },
  { key: 'operation_name', label: 'Operation' },
  { key: 'workstation', label: 'Workstation' },
  { key: 'source_storage_code', label: 'Source' },
  { key: 'dest_storage_code', label: 'Dest' },
  { key: 'step_type', label: 'Type' },
  { key: 'capacity_1500', label: 'Cap@1500' },
  { key: 'capacity_basis', label: 'Basis' },
  { key: 'min_queue_threshold', label: 'Min Queue' },
];

// Map a raw API step into a flat row for CSV/PDF export.
function exportRow(s) {
  return {
    step_number: pick(s, 'step_number', 'stepNumber') ?? '',
    operation_name: pick(s, 'operation_name', 'operation', 'name') ?? '',
    workstation: pick(s, 'workstation_code', 'workstation', 'workstation_name') ?? '',
    source_storage_code: pick(s, 'source_storage_code', 'source_storage') ?? '',
    dest_storage_code: pick(s, 'dest_storage_code', 'dest_storage') ?? '',
    step_type: pick(s, 'step_type') ?? 'normal',
    capacity_1500: pick(s, 'capacity_1500', 'capacity') ?? '',
    capacity_basis: pick(s, 'capacity_basis') ?? 'fixed',
    min_queue_threshold: pick(s, 'min_queue_threshold') ?? 1,
  };
}

/* Map a raw (snake_case) API step into the editor's working row shape. */
let _rowSeq = 0;
function toEditorRow(s) {
  return {
    _rid: `r${_rowSeq++}`,
    operationName: pick(s, 'operation_name', 'operation', 'name') ?? '',
    workstationTypeId: pick(s, 'workstation_type_id', 'workstationTypeId') ?? '',
    sourceStorageId: pick(s, 'source_storage_id', 'sourceStorageId') ?? '',
    destStorageId: pick(s, 'dest_storage_id', 'destStorageId') ?? '',
    stepType: pick(s, 'step_type', 'stepType') ?? 'normal',
    capacity1500: pick(s, 'capacity_1500', 'capacity') ?? '',
    capacityBasis: pick(s, 'capacity_basis', 'capacityBasis') ?? 'fixed',
    minQueueThreshold: pick(s, 'min_queue_threshold', 'minQueueThreshold') ?? 1,
  };
}

function blankEditorRow() {
  return {
    _rid: `r${_rowSeq++}`,
    operationName: '',
    workstationTypeId: '',
    sourceStorageId: '',
    destStorageId: '',
    stepType: 'normal',
    capacity1500: '',
    capacityBasis: 'fixed',
    minQueueThreshold: 1,
  };
}

/* Build the camelCase payload the backend expects (1-based numbering recomputed
   from row order). */
function rowsToPayload(rows) {
  return rows.map((r, i) => ({
    stepNumber: i + 1,
    sequenceOrder: i + 1,
    operationName: r.operationName?.trim() || '',
    workstationTypeId: r.workstationTypeId || null,
    sourceStorageId: r.sourceStorageId || null,
    destStorageId: r.destStorageId || null,
    stepType: r.stepType || 'normal',
    capacity1500:
      r.capacity1500 === '' || r.capacity1500 == null ? null : Number(r.capacity1500),
    capacityBasis: r.capacityBasis || 'fixed',
    minQueueThreshold:
      r.minQueueThreshold === '' || r.minQueueThreshold == null
        ? 1
        : Number(r.minQueueThreshold),
  }));
}

/* ───────────────────────── shared UI ───────────────────────── */

function Heading() {
  return (
    <>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
        Cycle Builder
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
        Define cycle types, edit ordered step sequences, manage versions &amp; capacity rules
      </div>
    </>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
        {children}
      </div>
      {right || null}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary)', padding: '12px 0' }}>{children}</div>;
}

function ErrorBox({ error, onRetry }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: SANS, fontSize: 13, color: 'var(--status-danger)', background: 'rgba(229,72,77,0.08)', border: '1px solid rgba(229,72,77,0.25)', borderRadius: 'var(--radius-md)', padding: '11px 13px' }}>
      <Icon name="alert" size={16} color="var(--status-danger)" />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{error?.message || 'Something went wrong.'}</div>
        {error?.code ? <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{error.code}</div> : null}
      </div>
      {onRetry ? <button className="btn btn-sm" onClick={onRetry}>Retry</button> : null}
    </div>
  );
}

function SuccessBox({ message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 12.5, color: 'var(--status-success-dark)', background: 'rgba(34,160,107,0.1)', border: '1px solid rgba(34,160,107,0.25)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
      <Icon name="check" size={15} color="var(--status-success-dark)" />
      <span>{message}</span>
    </div>
  );
}

function ReadOnlyNote({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontFamily: SANS, fontSize: 11.5, color: 'var(--text-secondary)', background: 'var(--bg-soft-amber)', border: '1px solid var(--bg-soft-amber-2)', borderRadius: 'var(--radius-md)', padding: '8px 11px' }}>
      <Icon name="lock" size={13} color="var(--status-warning)" />
      <span>{children}</span>
    </div>
  );
}

const TH = { padding: '7px 10px 9px', textAlign: 'left', fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)', whiteSpace: 'nowrap' };
const TD = { padding: '9px 10px', fontFamily: SANS, fontSize: 12.5, color: 'var(--text-primary)', verticalAlign: 'middle' };

/* ───────────────────────── cycle list (left) ───────────────────────── */

function CycleList({ cycles, activeId, onSelect, canWrite, onNew }) {
  return (
    <div className="card" style={{ padding: 14, position: 'sticky', top: 16 }}>
      <SectionTitle right={canWrite ? (
        <button className="btn btn-primary btn-sm" onClick={onNew} title="Add a new cycle type">
          <Icon name="plus" size={14} color="var(--accent-green)" /> New
        </button>
      ) : null}>
        Cycle Types
      </SectionTitle>

      {cycles.length === 0 ? (
        <Empty>No cycle types defined.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cycles.map((c) => {
            const isActive = c.id === activeId;
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                style={{
                  textAlign: 'left',
                  border: `1.5px solid ${isActive ? 'var(--status-blue)' : 'var(--border-input)'}`,
                  background: isActive ? 'var(--bg-soft-blue)' : 'var(--bg-card)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '11px 13px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 7,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CycleBadge cycle={c.code} />
                    <span style={{ fontFamily: ARCHIVO, fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)' }}>{c.name}</span>
                  </span>
                  <StatusPill status={c.status === 'archived' ? 'closed' : 'active'} label={c.status === 'archived' ? 'Archived' : 'Active'} />
                </div>
                <div style={{ display: 'flex', gap: 12, fontFamily: MONO, fontSize: 10.5, color: 'var(--text-secondary)' }}>
                  <span>{c.stepCount} steps</span>
                  <span>v{c.version}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* normalise a cycle list record */
function normalizeCycle(c) {
  return {
    id: pick(c, 'id', 'cycle_id', 'code') ?? pick(c, 'code'),
    code: pick(c, 'code', 'cycle_code', 'cycle') || '—',
    name: pick(c, 'name', 'cycle_name', 'label') || pick(c, 'code', 'cycle_code') || 'Cycle',
    stepCount: num(pick(c, 'step_count', 'stepCount', 'steps_count', 'num_steps')) || (Array.isArray(c.steps) ? c.steps.length : 0),
    version: num(pick(c, 'version', 'current_version', 'version_number')) || 1,
    status: pick(c, 'status') || 'active',
    raw: c,
  };
}

/* normalise a step record */
function normalizeStep(s, i) {
  const stepNo = num(pick(s, 'step_number', 'stepNumber', 'step_no', 'seq', 'order')) ?? (i + 1);
  const sub = pick(s, 'sub_step', 'subStep', 'variant'); // e.g. '16B'
  const displayNo = sub ? `${Math.trunc(stepNo)}${sub}` : String(stepNo);
  return {
    key: pick(s, 'id', 'step_id') ?? `${stepNo}-${i}`,
    stepNo,
    displayNo,
    operation: pick(s, 'operation', 'operation_name', 'name', 'op') || '—',
    workstation: pick(s, 'workstation', 'workstation_code', 'ws') || '',
    source: pick(s, 'source_storage', 'sourceStorage', 'from_storage', 'src') || '',
    dest: pick(s, 'dest_storage', 'destStorage', 'destination_storage', 'to_storage', 'dst') || '',
    isTemper: !!(pick(s, 'is_tempering', 'isTempering') || /temper/i.test(pick(s, 'operation', 'name') || '')),
    isSplit: !!(pick(s, 'is_split', 'isSplit') || sub || Math.trunc(stepNo) === 16),
    uidsHere: num(pick(s, 'uids_at_step', 'uidsAtStep', 'in_progress_count')) || 0,
    raw: s,
  };
}

/* ───────────────── capacity cell + expandable detail ───────────────── */

function CapCell({ stepNo, raw, canWrite, draft, onDraft }) {
  const [open, setOpen] = useState(false);
  const rule = useMemo(() => classifyStep(stepNo, raw), [stepNo, raw]);

  // Live editable value comes from draft (keyed by step) if present.
  const fixedVal = draft?.value ?? (rule.kind === 'fixed' ? rule.value : null);
  const baseVal = draft?.base ?? (rule.kind === 'furnace_scaled' ? rule.base : null);
  const bunchVal = draft?.barsPerSet ?? (rule.kind === 'bunch' ? rule.barsPerSet : null);

  const summary = {
    fixed: String(fixedVal ?? 1),
    furnace_scaled: `${baseVal} @1500mm`,
    length_based: 'Length-based',
    bunch: `${bunchVal} bars / set · Length-based`,
  }[rule.kind];

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: MONO, fontSize: 11.5, fontWeight: 600,
          color: 'var(--text-primary)',
          background: 'var(--bg-muted)', border: '1px solid var(--border-input)',
          borderRadius: 'var(--radius-sm)', padding: '4px 9px',
        }}
        title="View / edit capacity rule"
      >
        {summary}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} color="var(--text-secondary)" />
      </button>

      {open ? (
        <div style={{ marginTop: 8, padding: '11px 12px', background: 'var(--bg-muted-2)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-md)', maxWidth: 360 }}>
          {rule.kind === 'fixed' ? (
            <FixedCap value={fixedVal} canWrite={canWrite} onChange={(v) => onDraft({ value: v })} />
          ) : rule.kind === 'furnace_scaled' ? (
            <FurnaceCap base={baseVal} ws={rule.ws} canWrite={canWrite} onChange={(v) => onDraft({ base: v })} />
          ) : rule.kind === 'bunch' ? (
            <BunchCap barsPerSet={bunchVal} ws={rule.ws} canWrite={canWrite} onChange={(v) => onDraft({ barsPerSet: v })} />
          ) : (
            <GrindingCap ws={rule.ws} stepNo={stepNo} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function CapLabel({ children }) {
  return <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 5 }}>{children}</div>;
}

function FixedCap({ value, canWrite, onChange }) {
  return (
    <div>
      <CapLabel>Fixed capacity · bars at a time</CapLabel>
      <input
        className="form-input"
        type="number"
        min="1"
        style={{ height: 38, width: 110 }}
        value={value ?? 1}
        disabled={!canWrite}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    </div>
  );
}

function FurnaceCap({ base, ws, canWrite, onChange }) {
  const derived = furnaceDerived(base);
  return (
    <div>
      <CapLabel>Furnace {ws ? `· ${ws}` : ''} · base @1500mm</CapLabel>
      <input
        className="form-input"
        type="number"
        min="1"
        style={{ height: 38, width: 110 }}
        value={base ?? ''}
        disabled={!canWrite}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
      <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {derived.map((d) => (
          <div key={d.mm} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 11, color: d.mm === BASE_SIZE ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            <span>{d.mm}mm</span>
            <span>{d.bars} bars{d.mm === BASE_SIZE ? ' (base)' : ' (auto)'}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 7, fontFamily: MONO, fontSize: 9.5, color: 'var(--text-muted)' }}>
        floor(base × 1500 / bar_length) · derived values read-only
      </div>
    </div>
  );
}

function BunchCap({ barsPerSet, ws, canWrite, onChange }) {
  const derived = bunchDerived(barsPerSet);
  return (
    <div>
      <CapLabel>Bunch grinding {ws ? `· ${ws}` : ''} · bars per set</CapLabel>
      <input
        className="form-input"
        type="number"
        min="1"
        style={{ height: 38, width: 110 }}
        value={barsPerSet ?? ''}
        disabled={!canWrite}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
      <div style={{ marginTop: 6, fontFamily: MONO, fontSize: 10, color: 'var(--text-secondary)' }}>Machine bed: 3000mm (fixed)</div>
      <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {derived.map((d) => (
          <div key={d.mm} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)' }}>
            <span>{d.mm}mm</span>
            <span>{d.sets} set{d.sets === 1 ? '' : 's'} × {barsPerSet || 0} = {d.bars} bars / run</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 7, fontFamily: MONO, fontSize: 9.5, color: 'var(--text-muted)' }}>
        Takes effect on next batch · derived values read-only
      </div>
    </div>
  );
}

function GrindingCap({ ws, stepNo }) {
  const isBevel = Math.trunc(stepNo) === 22;
  return (
    <div>
      <CapLabel>Length-based {ws ? `· ${ws}` : ''}</CapLabel>
      {isBevel ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {BEVEL_MACHINES.map((m) => (
            <div key={m.code} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)' }}>
              <span>{m.code}</span>
              <span>max {m.max}mm — {m.note}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <div>SG-DLT max bed: 3000mm</div>
          <div>Rule: combined bar lengths ≤ 3000mm</div>
          <div>→ 2 bars of 1500 / 1424mm per run</div>
          <div>→ 1 bar of 2750mm per run</div>
        </div>
      )}
      <div style={{ marginTop: 9 }}>
        <ReadOnlyNote>
          Governed by machine physical limits — no number to edit. Grinding rules are managed in Master Lists.
        </ReadOnlyNote>
      </div>
    </div>
  );
}

/* ───────────────────────── steps editor ───────────────────────── */

function StepsEditor({ cycle, canWrite, onSaved }) {
  const { data, error, loading, refetch } = usePolling(
    () => cyclesApi.steps(cycle.id).then((r) => r.data),
    [cycle.id],
  );

  // The /steps endpoint 404s with NO_VERSION for a cycle that has never had a
  // version published. Treat that as "empty, ready to build" rather than a hard
  // error so the admin can start adding steps.
  const noVersion = error && error.code === 'NO_VERSION';
  const hardError = error && !noVersion;

  // Raw API steps (snake_case) — used for the read-only table and exports.
  const rawSteps = useMemo(() => asList(data), [data]);
  const steps = useMemo(() => rawSteps.map(normalizeStep), [rawSteps]);
  const versionNumber = num(pick(data || {}, 'version', 'version_number')) || cycle.version;

  /* ─── read-only capacity-rule drafts (existing behaviour, preserved) ─── */
  const [capDrafts, setCapDrafts] = useState({});
  const [changeSummary, setChangeSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const [saveOk, setSaveOk] = useState(null);

  const dirty = Object.keys(capDrafts).length > 0;

  function setCapDraft(stepKey, patch) {
    setSaveOk(null);
    setCapDrafts((prev) => ({ ...prev, [stepKey]: { ...prev[stepKey], ...patch } }));
  }

  async function saveCaps() {
    setSaving(true);
    setSaveErr(null);
    setSaveOk(null);
    try {
      const merged = steps.map((s) => {
        const d = capDrafts[s.key];
        const base = { ...s.raw };
        if (d) {
          if (d.value != null) base.capacity = d.value;
          if (d.base != null) base.capacity_base = d.base;
          if (d.barsPerSet != null) base.bars_per_set = d.barsPerSet;
        }
        return base;
      });
      await cyclesApi.updateSteps(cycle.id, merged, changeSummary.trim() || 'Capacity / step edits');
      setSaveOk('Saved — a new version was created.');
      setCapDrafts({});
      setChangeSummary('');
      await refetch();
      onSaved && onSaved();
    } catch (err) {
      setSaveErr(err);
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data && !error) return <Empty>Loading steps…</Empty>;
  if (hardError) return <ErrorBox error={error} onRetry={refetch} />;

  return (
    <StepsEditorInner
      cycle={cycle}
      canWrite={canWrite}
      rawSteps={rawSteps}
      steps={steps}
      versionNumber={versionNumber}
      capDrafts={capDrafts}
      setCapDraft={setCapDraft}
      dirty={dirty}
      saving={saving}
      saveErr={saveErr}
      saveOk={saveOk}
      changeSummary={changeSummary}
      setChangeSummary={setChangeSummary}
      onSaveCaps={saveCaps}
      onSavedFull={async () => { await refetch(); onSaved && onSaved(); }}
    />
  );
}

function StepsEditorInner({
  cycle, canWrite, rawSteps, steps, versionNumber,
  capDrafts, setCapDraft, dirty, saving, saveErr, saveOk,
  changeSummary, setChangeSummary, onSaveCaps, onSavedFull,
}) {
  const [editing, setEditing] = useState(false);

  /* ─── full step editor (add / edit / reorder / delete) ─── */
  // Dropdown options for workstation type + storage location selects.
  const wsTypes = usePolling(() => masterApi.workstationTypes().then((r) => asList(r.data)), []);
  const storages = usePolling(() => masterApi.storageLocations().then((r) => asList(r.data)), []);
  const wsOptions = useMemo(
    () => asList(wsTypes.data).map((w) => ({ id: pick(w, 'id'), label: `${pick(w, 'code') || ''} — ${pick(w, 'name') || ''}`.replace(/^ — | — $/, '') })),
    [wsTypes.data],
  );
  const storageOptions = useMemo(
    () => asList(storages.data).map((s) => ({ id: pick(s, 'id'), label: `${pick(s, 'code') || ''} — ${pick(s, 'name') || ''}`.replace(/^ — | — $/, '') })),
    [storages.data],
  );

  // Step-type vocabulary: defaults plus any distinct values found in the data.
  const stepTypeOptions = useMemo(() => {
    const set = new Set(DEFAULT_STEP_TYPES);
    rawSteps.forEach((s) => { const t = pick(s, 'step_type'); if (t) set.add(t); });
    return Array.from(set);
  }, [rawSteps]);

  const [rows, setRows] = useState([]);
  const [editSummary, setEditSummary] = useState('');
  const [savingFull, setSavingFull] = useState(false);
  const [fullErr, setFullErr] = useState(null);
  const [fullOk, setFullOk] = useState(null);

  function enterEdit() {
    setRows(rawSteps.map(toEditorRow));
    setEditSummary('');
    setFullErr(null);
    setFullOk(null);
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setRows([]);
    setFullErr(null);
  }

  function patchRow(rid, patch) {
    setFullOk(null);
    setRows((prev) => prev.map((r) => (r._rid === rid ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setFullOk(null);
    setRows((prev) => [...prev, blankEditorRow()]);
  }
  function deleteRow(rid) {
    setRows((prev) => prev.filter((r) => r._rid !== rid));
  }
  function moveRow(idx, dir) {
    setRows((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  async function saveFull() {
    // Validate: workstation type is required on every row.
    const missing = rows.findIndex((r) => !r.workstationTypeId);
    if (missing !== -1) {
      setFullErr({ message: `Step ${missing + 1} needs a workstation — it is required for every step.`, code: 'WORKSTATION_REQUIRED' });
      return;
    }
    if (rows.length === 0) {
      setFullErr({ message: 'Add at least one step before saving.', code: 'NO_STEPS' });
      return;
    }
    setSavingFull(true);
    setFullErr(null);
    setFullOk(null);
    try {
      const payload = rowsToPayload(rows);
      await cyclesApi.updateSteps(cycle.id, payload, editSummary.trim() || 'Edited cycle steps');
      setFullOk('Saved — a new version was created.');
      setEditing(false);
      setRows([]);
      await onSavedFull();
    } catch (err) {
      setFullErr(err);
    } finally {
      setSavingFull(false);
    }
  }

  /* ─── exports ─── */
  function exportJSON() {
    const payload = {
      cycle: { id: cycle.id, code: cycle.code, name: cycle.name },
      version: versionNumber,
      steps: rawSteps,
    };
    downloadJSON(`cycle-${cycle.code || cycle.id}-v${versionNumber}`, payload);
  }
  function exportCSV() {
    downloadCSV(`cycle-${cycle.code || cycle.id}-v${versionNumber}`, EXPORT_COLUMNS, rawSteps.map(exportRow));
  }
  function exportPDF() {
    downloadPDF(`cycle-${cycle.code || cycle.id}-v${versionNumber}`, {
      title: `${cycle.name} — Cycle Definition (v${versionNumber})`,
      subtitle: `${cycle.code || ''} · ${rawSteps.length} step${rawSteps.length === 1 ? '' : 's'}`,
      columns: EXPORT_COLUMNS,
      rows: rawSteps.map(exportRow),
      orientation: 'landscape',
    });
  }

  const optsLoading = wsTypes.loading || storages.loading;
  const cellInput = { height: 34, fontSize: 12.5 };

  /* ════════════════════════ edit mode ════════════════════════ */
  if (editing) {
    return (
      <div>
        <SectionTitle right={<span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--status-blue)' }}>Editing — unsaved draft</span>}>
          Edit Steps · {cycle.name}
        </SectionTitle>

        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead>
              <tr>
                <th style={TH}>#</th>
                <th style={TH}>Operation</th>
                <th style={TH}>Workstation *</th>
                <th style={TH}>Source</th>
                <th style={TH}>Dest</th>
                <th style={TH}>Type</th>
                <th style={TH}>Cap@1500</th>
                <th style={TH}>Basis</th>
                <th style={TH}>Min Q</th>
                <th style={TH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r._rid} style={{ borderTop: '1px solid #eef2ea' }}>
                  <td style={{ ...TD, fontFamily: MONO, fontWeight: 700 }}>{i + 1}</td>
                  <td style={TD}>
                    <input className="form-input" style={{ ...cellInput, minWidth: 150 }} placeholder="Operation name"
                      value={r.operationName} onChange={(e) => patchRow(r._rid, { operationName: e.target.value })} />
                  </td>
                  <td style={TD}>
                    <select className="form-input" style={{ ...cellInput, minWidth: 150, borderColor: r.workstationTypeId ? undefined : 'var(--status-danger)' }}
                      value={r.workstationTypeId} onChange={(e) => patchRow(r._rid, { workstationTypeId: e.target.value })}>
                      <option value="">{optsLoading ? 'Loading…' : 'Select…'}</option>
                      {wsOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </td>
                  <td style={TD}>
                    <select className="form-input" style={{ ...cellInput, minWidth: 130 }}
                      value={r.sourceStorageId} onChange={(e) => patchRow(r._rid, { sourceStorageId: e.target.value })}>
                      <option value="">None</option>
                      {storageOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </td>
                  <td style={TD}>
                    <select className="form-input" style={{ ...cellInput, minWidth: 130 }}
                      value={r.destStorageId} onChange={(e) => patchRow(r._rid, { destStorageId: e.target.value })}>
                      <option value="">None</option>
                      {storageOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </td>
                  <td style={TD}>
                    <select className="form-input" style={{ ...cellInput, minWidth: 130 }}
                      value={r.stepType} onChange={(e) => patchRow(r._rid, { stepType: e.target.value })}>
                      {stepTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td style={TD}>
                    <input className="form-input" type="number" min="0" style={{ ...cellInput, width: 90 }} placeholder="—"
                      value={r.capacity1500} onChange={(e) => patchRow(r._rid, { capacity1500: e.target.value })} />
                  </td>
                  <td style={TD}>
                    <select className="form-input" style={{ ...cellInput, minWidth: 100 }}
                      value={r.capacityBasis} onChange={(e) => patchRow(r._rid, { capacityBasis: e.target.value })}>
                      {CAPACITY_BASES.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </td>
                  <td style={TD}>
                    <input className="form-input" type="number" min="1" style={{ ...cellInput, width: 70 }}
                      value={r.minQueueThreshold} onChange={(e) => patchRow(r._rid, { minQueueThreshold: e.target.value })} />
                  </td>
                  <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" style={{ height: 28, padding: '0 8px' }} disabled={i === 0} title="Move up" onClick={() => moveRow(i, -1)}>↑</button>{' '}
                    <button className="btn btn-sm" style={{ height: 28, padding: '0 8px' }} disabled={i === rows.length - 1} title="Move down" onClick={() => moveRow(i, 1)}>↓</button>{' '}
                    <button className="btn btn-sm" style={{ height: 28, padding: '0 9px', color: 'var(--status-danger)' }} title="Delete step" onClick={() => deleteRow(r._rid)}>
                      <Icon name="close" size={13} color="var(--status-danger)" />
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan={10} style={{ ...TD, textAlign: 'center', color: 'var(--text-secondary)' }}>No steps in the draft yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 12 }}>
          <button className="btn btn-sm" onClick={addRow}>
            <Icon name="plus" size={14} color="var(--accent-green)" /> {rows.length === 0 ? 'Add first step' : 'Add step'}
          </button>
        </div>

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--border-soft)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="form-label">What changed (saved with the new version)</label>
              <input className="form-input" style={{ height: 40 }} placeholder="e.g. Added grinding + QC steps"
                value={editSummary} onChange={(e) => setEditSummary(e.target.value)} />
            </div>
            <button className="btn btn-primary" disabled={savingFull} onClick={saveFull}>
              <Icon name="check" size={15} color="var(--accent-green)" />
              {savingFull ? 'Saving…' : 'Save — Create New Version'}
            </button>
            <button className="btn" disabled={savingFull} onClick={cancelEdit}>Cancel</button>
          </div>
          {fullErr ? <ErrorBox error={fullErr} /> : null}
        </div>
      </div>
    );
  }

  /* ════════════════════════ read-only mode ════════════════════════ */
  const isEmpty = steps.length === 0;
  return (
    <div>
      <SectionTitle right={<span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)' }}>Current version v{versionNumber}</span>}>
        Steps · {cycle.name}
      </SectionTitle>

      {/* action bar: edit + exports */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {canWrite ? (
          <button className="btn btn-primary btn-sm" onClick={enterEdit}>
            <Icon name="plus" size={14} color="var(--accent-green)" />
            {isEmpty ? 'Add first step' : 'Edit steps'}
          </button>
        ) : null}
        {!isEmpty ? (
          <>
            <span style={{ width: 1, height: 22, background: 'var(--border-soft)', margin: '0 2px' }} />
            <button className="btn btn-sm" onClick={exportJSON}><Icon name="download" size={13} color="var(--text-secondary)" /> JSON</button>
            <button className="btn btn-sm" onClick={exportCSV}><Icon name="download" size={13} color="var(--text-secondary)" /> CSV</button>
            <button className="btn btn-sm" onClick={exportPDF}><Icon name="download" size={13} color="var(--text-secondary)" /> PDF</button>
          </>
        ) : null}
      </div>

      {fullOk ? <div style={{ marginBottom: 12 }}><SuccessBox message={fullOk} /></div> : null}

      {canWrite ? (
        <ReadOnlyNote>
          Use <strong>Edit steps</strong> to add, reorder or delete steps. Capacity-rule edits in the table
          below also save through the steps endpoint — both create a new version automatically.
        </ReadOnlyNote>
      ) : null}

      {isEmpty ? (
        <Empty>This cycle has no steps yet.{canWrite ? ' Use “Add first step” to start building it.' : ''}</Empty>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>#</th>
                <th style={TH}>Operation</th>
                <th style={TH}>Workstation</th>
                <th style={TH}>Source</th>
                <th style={TH}>Dest</th>
                <th style={TH}>Capacity rule</th>
                <th style={TH}>Type</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s) => (
                <tr key={s.key} style={{ borderTop: '1px solid #eef2ea', background: s.isSplit ? 'var(--bg-soft-purple, transparent)' : undefined }}>
                  <td style={{ ...TD, fontFamily: MONO, fontWeight: 700, color: s.isSplit ? 'var(--cycle-swan)' : 'var(--text-primary)' }}>{s.displayNo}</td>
                  <td style={TD}>{s.operation}</td>
                  <td style={{ ...TD, fontFamily: MONO, fontSize: 11.5 }}>{s.workstation || '—'}</td>
                  <td style={{ ...TD, fontFamily: MONO, fontSize: 11 }}>{s.source || '—'}</td>
                  <td style={{ ...TD, fontFamily: MONO, fontSize: 11 }}>{s.dest || '—'}</td>
                  <td style={TD}>
                    <CapCell
                      stepNo={s.stepNo}
                      raw={s.raw}
                      canWrite={canWrite}
                      draft={capDrafts[s.key]}
                      onDraft={(patch) => setCapDraft(s.key, patch)}
                    />
                  </td>
                  <td style={TD}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {s.isTemper ? <span className="badge" style={{ background: 'rgba(217,122,43,0.14)', color: 'var(--status-warning)' }}>TEMPER</span> : null}
                      {s.isSplit ? <span className="badge" style={{ background: 'rgba(122,79,192,0.16)', color: 'var(--cycle-swan)' }}>SPLIT</span> : null}
                      {!s.isTemper && !s.isSplit ? <span style={{ color: 'var(--text-muted)' }}>—</span> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* capacity-rule save bar (existing behaviour) */}
      {canWrite && steps.length > 0 ? (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--border-soft)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="form-label">Change summary (saved with the new version)</label>
              <input
                className="form-input"
                style={{ height: 40 }}
                placeholder="e.g. Raised HT90 base capacity to 84"
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" disabled={!dirty || saving} onClick={onSaveCaps}>
              <Icon name="check" size={15} color="var(--accent-green)" />
              {saving ? 'Saving…' : 'Save Capacity — New Version'}
            </button>
          </div>
          {dirty ? (
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--status-warning)' }}>
              {Object.keys(capDrafts).length} step(s) with unsaved capacity changes
            </div>
          ) : null}
          {saveErr ? <ErrorBox error={saveErr} /> : null}
          {saveOk ? <SuccessBox message={saveOk} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────── version history ───────────────────────── */

function VersionHistory({ cycle, canWrite, onRolledBack }) {
  const { data, error, loading, refetch } = usePolling(
    () => cyclesApi.versions(cycle.id).then((r) => r.data),
    [cycle.id],
  );
  const [rollingId, setRollingId] = useState(null);
  const [rollErr, setRollErr] = useState(null);
  const [rollOk, setRollOk] = useState(null);

  const versions = useMemo(() => asList(data).map((v, i) => ({
    id: pick(v, 'id', 'version_id', 'version', 'version_number') ?? i,
    number: num(pick(v, 'version', 'version_number', 'number')) ?? (i + 1),
    date: pick(v, 'created_at', 'date', 'changed_at', 'timestamp'),
    by: pick(v, 'changed_by', 'changedBy', 'author', 'user', 'created_by') || '—',
    summary: pick(v, 'change_summary', 'changeSummary', 'summary', 'changes') || '—',
    steps: pick(v, 'steps'),
    raw: v,
  })), [data]);

  const current = useMemo(() => versions.reduce((m, v) => Math.max(m, v.number || 0), 0), [versions]);

  async function rollback(v) {
    // Spec PAGE 15: rollback creates a NEW version identical to the selected
    // old one (does not overwrite history). There is no dedicated rollback
    // endpoint, so we re-save that version's steps through updateSteps, which
    // creates the new version. If the version payload has no steps array, we
    // cannot reconstruct it client-side and must surface that.
    if (!Array.isArray(v.steps)) {
      setRollErr({ message: 'This version does not include its step snapshot, so it cannot be replayed from the client. A dedicated rollback endpoint is required.', code: 'NO_STEP_SNAPSHOT' });
      return;
    }
    setRollingId(v.id);
    setRollErr(null);
    setRollOk(null);
    try {
      await cyclesApi.updateSteps(cycle.id, v.steps, `Rollback to v${v.number}`);
      setRollOk(`Rolled back to v${v.number} — created a new version identical to it.`);
      await refetch();
      onRolledBack && onRolledBack();
    } catch (err) {
      setRollErr(err);
    } finally {
      setRollingId(null);
    }
  }

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <SectionTitle right={<span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)' }}>{versions.length} version{versions.length === 1 ? '' : 's'}</span>}>
        Version History
      </SectionTitle>

      {rollErr ? <div style={{ marginBottom: 10 }}><ErrorBox error={rollErr} /></div> : null}
      {rollOk ? <div style={{ marginBottom: 10 }}><SuccessBox message={rollOk} /></div> : null}

      {loading && !data ? (
        <Empty>Loading versions…</Empty>
      ) : error ? (
        <ErrorBox error={error} onRetry={refetch} />
      ) : versions.length === 0 ? (
        <Empty>No version history recorded for this cycle.</Empty>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Version</th>
                <th style={TH}>Date</th>
                <th style={TH}>Changed by</th>
                <th style={TH}>Summary</th>
                <th style={TH} />
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const isCurrent = v.number === current;
                return (
                  <tr key={v.id} style={{ borderTop: '1px solid #eef2ea' }}>
                    <td style={{ ...TD, fontFamily: MONO, fontWeight: 700 }}>
                      v{v.number}{isCurrent ? <span className="badge" style={{ marginLeft: 7, background: 'var(--bg-soft-blue)', color: 'var(--status-blue)' }}>CURRENT</span> : null}
                    </td>
                    <td style={{ ...TD, fontFamily: MONO, fontSize: 11 }}>{v.date ? new Date(v.date).toLocaleString() : '—'}</td>
                    <td style={TD}>{v.by}</td>
                    <td style={{ ...TD, maxWidth: 320 }}>{v.summary}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      {canWrite && !isCurrent ? (
                        <button className="btn btn-sm" disabled={rollingId === v.id} onClick={() => rollback(v)} title="Create a new version identical to this one">
                          <Icon name="refresh" size={13} color="var(--text-secondary)" />
                          {rollingId === v.id ? 'Rolling…' : 'Rollback'}
                        </button>
                      ) : null}
                    </td>
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

/* ───────────────────────── import / export ───────────────────────── */

function ImportExport({ cycle, canWrite, onImported }) {
  const fileRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState(null);
  const [preview, setPreview] = useState(null); // { payload, steps, fileName }
  const [importErr, setImportErr] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importOk, setImportOk] = useState(null);

  async function doExport() {
    setExporting(true);
    setExportErr(null);
    try {
      const res = await cyclesApi.export(cycle.id);
      const payload = res.data ?? res;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cycle-${cycle.code || cycle.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportErr(err);
    } finally {
      setExporting(false);
    }
  }

  function onFile(e) {
    setImportErr(null);
    setImportOk(null);
    setPreview(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        const steps = asList(payload);
        if (!steps.length && !payload.code && !payload.name) {
          setImportErr({ message: 'File parsed but contains no recognizable cycle definition (no steps / code / name).', code: 'INVALID_STRUCTURE' });
          return;
        }
        setPreview({ payload, steps: steps.map(normalizeStep), fileName: file.name });
      } catch {
        setImportErr({ message: 'Could not parse the file — it is not valid JSON.', code: 'PARSE_ERROR' });
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // allow re-selecting the same file
  }

  async function confirmImport() {
    if (!preview) return;
    setImporting(true);
    setImportErr(null);
    try {
      await cyclesApi.import(preview.payload);
      setImportOk(`Imported "${preview.fileName}" — created a new cycle or version.`);
      setPreview(null);
      onImported && onImported();
    } catch (err) {
      setImportErr(err);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <SectionTitle>Import / Export</SectionTitle>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn" disabled={exporting} onClick={doExport}>
          <Icon name="download" size={15} color="var(--text-secondary)" />
          {exporting ? 'Exporting…' : 'Export this cycle (JSON)'}
        </button>

        {canWrite ? (
          <>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onFile} />
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <Icon name="inbox" size={15} color="var(--text-secondary)" />
              Import from file…
            </button>
          </>
        ) : (
          <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>Import requires admin / manager.</span>
        )}
      </div>

      {exportErr ? <div style={{ marginTop: 12 }}><ErrorBox error={exportErr} /></div> : null}
      {importErr ? <div style={{ marginTop: 12 }}><ErrorBox error={importErr} /></div> : null}
      {importOk ? <div style={{ marginTop: 12 }}><SuccessBox message={importOk} /></div> : null}

      {/* Validated preview + confirm (never imports without confirmation) */}
      {preview ? (
        <div style={{ marginTop: 14, padding: '14px 16px', background: 'var(--bg-muted-2)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
              Preview · {preview.fileName}
            </div>
            <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)' }}>
              {pick(preview.payload, 'code', 'cycle_code') || '—'} · {preview.steps.length} steps
            </span>
          </div>

          {preview.steps.length ? (
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-md)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={TH}>#</th>
                    <th style={TH}>Operation</th>
                    <th style={TH}>Workstation</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.steps.map((s) => (
                    <tr key={s.key} style={{ borderTop: '1px solid #eef2ea' }}>
                      <td style={{ ...TD, fontFamily: MONO, fontWeight: 600 }}>{s.displayNo}</td>
                      <td style={TD}>{s.operation}</td>
                      <td style={{ ...TD, fontFamily: MONO, fontSize: 11 }}>{s.workstation || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No step rows in this file — header fields only.</Empty>
          )}

          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-primary" disabled={importing} onClick={confirmImport}>
              {importing ? 'Importing…' : 'Confirm import'}
            </button>
            <button className="btn" disabled={importing} onClick={() => setPreview(null)}>Cancel</button>
            <span style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-muted)' }}>
              Creates a new cycle or a new version — never overwrites silently.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────── new cycle (create) ───────────────────────── */

function NewCycleForm({ onClose, onCreated }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      setErr({ message: 'Code and name are required.' });
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await cyclesApi.create({ code: code.trim().toUpperCase(), name: name.trim() });
      onCreated && onCreated();
      onClose();
    } catch (e2) {
      setErr(e2);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card cp-fade-in" style={{ padding: '18px 20px', marginTop: 16 }}>
      <SectionTitle right={<button className="btn btn-sm" onClick={onClose}><Icon name="close" size={14} color="var(--text-secondary)" /></button>}>
        New Cycle Type
      </SectionTitle>
      <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '160px 1fr auto', gap: 12, alignItems: 'end' }}>
        <div>
          <label className="form-label">Code *</label>
          <input className="form-input" style={{ height: 40, fontFamily: MONO }} placeholder="EAT" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div>
          <label className="form-label">Name *</label>
          <input className="form-input" style={{ height: 40 }} placeholder="Cycle name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          <Icon name="plus" size={15} color="var(--accent-green)" />
          {submitting ? 'Creating…' : 'Create'}
        </button>
        {err ? <div style={{ gridColumn: '1 / -1' }}><ErrorBox error={err} /></div> : null}
      </form>
    </div>
  );
}

/* ───────────────────────── page ───────────────────────── */

export default function CycleBuilder() {
  const { isAdmin, isManager } = useAuth();
  const canWrite = isAdmin || isManager;

  const { data, error, loading, refetch } = usePolling(() => cyclesApi.list().then((r) => r.data), []);
  const cycles = useMemo(() => asList(data).map(normalizeCycle), [data]);

  const [activeId, setActiveId] = useState(null);
  const [showNew, setShowNew] = useState(false);

  // Default-select the first cycle once loaded.
  const effectiveActiveId = activeId ?? (cycles[0]?.id ?? null);
  const active = cycles.find((c) => c.id === effectiveActiveId) || null;

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <Heading />

      {!canWrite ? (
        <div style={{ marginTop: 16 }}>
          <ReadOnlyNote>Viewing only — editing cycle definitions, capacities and importing require an admin or manager role.</ReadOnlyNote>
        </div>
      ) : null}

      {showNew && canWrite ? (
        <NewCycleForm onClose={() => setShowNew(false)} onCreated={refetch} />
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, marginTop: 20, alignItems: 'start' }}>
        {/* left: cycle list */}
        <div>
          {error ? (
            <ErrorBox error={error} onRetry={refetch} />
          ) : loading && !data ? (
            <div className="card" style={{ padding: 14 }}><Empty>Loading cycles…</Empty></div>
          ) : (
            <CycleList
              cycles={cycles}
              activeId={effectiveActiveId}
              onSelect={setActiveId}
              canWrite={canWrite}
              onNew={() => setShowNew(true)}
            />
          )}
        </div>

        {/* right: editor / versions / import-export */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }} className="cp-fade-in" key={effectiveActiveId}>
          {!active ? (
            <div className="card" style={{ padding: '40px 20px', textAlign: 'center' }}>
              <Icon name="flow" size={26} color="var(--text-muted)" />
              <div style={{ fontFamily: SANS, fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 10 }}>
                {cycles.length ? 'Select a cycle type to view and edit its steps.' : 'No cycle types yet.'}
              </div>
            </div>
          ) : (
            <>
              <div className="card" style={{ padding: '18px 20px' }}>
                <StepsEditor cycle={active} canWrite={canWrite} onSaved={refetch} />
              </div>
              <VersionHistory cycle={active} canWrite={canWrite} onRolledBack={refetch} />
              <ImportExport cycle={active} canWrite={canWrite} onImported={refetch} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
