import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePolling } from '../hooks/usePolling';
import { faridabadApi } from '../api/resources';
import { useAuth } from '../store/AuthContext';
import Icon from '../components/common/Icon';
import { CycleBadge, StatusPill } from '../components/common/Badges';

/* ──────────────────────────────────────────────────────────────────────────
   PAGE 24 — FARIDABAD MY WORKSTATION (Operator view)
   The operator's personal view for Faridabad. Structurally like Dharmapuri's
   My Workstation — one tab per workstation, each with a single active item and
   a queue, with Start / Close timers — but for the 10-step FAR cycle. Faridabad
   has NO UIDs: items are identified by their size + cycle-type badge
   (e.g. "1200mm · EAT"). The MS Cutting step takes a sheet + cut-piece spec on
   close and the server returns the calculated leftover-strip balance.
   ────────────────────────────────────────────────────────────────────────── */

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";

const T_PRIMARY = 'var(--text-primary, #15366a)';
const T_SECONDARY = 'var(--text-secondary, #5d7188)';
const T_MUTED = 'var(--text-muted, #9bb4d4)';

const TOTAL_STEPS = 10;

/* ── helpers ─────────────────────────────────────────────────────────────── */

function fmtHMS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/* Seconds elapsed from an ISO timestamp until `nowMs`. Tolerant of nulls. */
function elapsedFrom(iso, nowMs) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (nowMs - t) / 1000);
}

/* Pull the first non-null value across a set of candidate keys. */
function pick(obj, ...keys) {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] != null) return obj[k];
  return undefined;
}

function itemId(item) {
  return pick(item, 'id', 'item_id', '_id');
}

function itemStatus(item) {
  return String(pick(item, 'status') || 'queued').toLowerCase();
}

/* Size + cycle label, the Faridabad way of identifying an item (no UIDs). */
function sizeLabel(item) {
  const size = pick(item, 'size_mm', 'size');
  if (size == null) return '—';
  return String(size).match(/mm$/i) ? String(size) : `${size}mm`;
}

function isMsCutting(item) {
  return /ms\s*cutting/i.test(String(pick(item, 'operation_name') || ''));
}

function isAlloyCutting(item) {
  return /alloy.*cut/i.test(String(pick(item, 'operation_name') || ''));
}

const ALLOY_SIZES = [1250, 850];

function isWelding(item) {
  return /weld|join/i.test(String(pick(item, 'operation_name') || ''));
}

/* ── live timer hook: one ticking clock for the whole page ────────────────── */

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/* ── small presentational atoms ──────────────────────────────────────────── */

function Label({ children, style }) {
  return (
    <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: T_MUTED, ...style }}>
      {children}
    </div>
  );
}

function Mono({ children, style }) {
  return <span style={{ fontFamily: MONO, ...style }}>{children}</span>;
}

function dotColor(status) {
  if (status === 'in_progress') return '#22a06b';
  if (status === 'done') return '#1c7a52';
  return '#9aa0a6';
}

/* 10-node step progress track. Current step pulses. */
function StepTrack({ step }) {
  const current = Number(step) || 0;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => {
        const n = i + 1;
        const done = n < current;
        const isCurrent = n === current;
        return (
          <span
            key={n}
            title={`Step ${n}`}
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 700,
              color: isCurrent ? '#fff' : done ? '#1c7a52' : T_MUTED,
              background: isCurrent ? 'var(--status-success, #22a06b)' : done ? 'var(--accent-green, #d4eecb)' : 'var(--bg-muted, #f4f7f2)',
              border: '1px solid ' + (isCurrent ? 'var(--status-success, #22a06b)' : 'var(--border-card, #e3ebde)'),
              animation: isCurrent ? 'cp-pulse 1.6s ease-in-out infinite' : 'none',
            }}
          >
            {n}
          </span>
        );
      })}
    </div>
  );
}

/* ── modal shell ─────────────────────────────────────────────────────────── */

function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,29,58,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: 20 }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="card cp-fade-in"
        style={{ width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-modal)', padding: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border-card, #e3ebde)' }}>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em', color: T_PRIMARY }}>{title}</div>
          <button onClick={onClose} className="btn btn-sm" style={{ width: 32, padding: 0, justifyContent: 'center' }} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div style={{ padding: '20px 22px' }}>{children}</div>
      </div>
    </div>
  );
}

/* ── MS Cutting close modal ──────────────────────────────────────────────────
   The operator confirms the sheet dimensions and one or more cut-piece specs.
   On confirm the server calculates the leftover-strip balance, which we display.
   The operator never enters leftover material — it is computed and shown.
   ──────────────────────────────────────────────────────────────────────────── */

function MsCuttingModal({ item, onCancel, onConfirm, busy, balance }) {
  const [sheet, setSheet] = useState({ length_mm: '', width_mm: '', height_mm: '' });
  const [pieces, setPieces] = useState([{ length_mm: '', width_mm: '', quantity: '' }]);

  function setSheetField(field, value) {
    setSheet((prev) => ({ ...prev, [field]: value }));
  }
  function setPieceField(idx, field, value) {
    setPieces((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  }
  function addPiece() {
    setPieces((prev) => [...prev, { length_mm: '', width_mm: '', quantity: '' }]);
  }
  function removePiece(idx) {
    setPieces((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }

  const sheetValid = ['length_mm', 'width_mm', 'height_mm'].every((k) => String(sheet[k]).trim() !== '');
  const piecesValid = pieces.every(
    (p) => String(p.length_mm).trim() && String(p.width_mm).trim() && String(p.quantity).trim()
  );
  const valid = sheetValid && piecesValid;

  function submit() {
    const payload = {
      sheet: {
        length_mm: Number(sheet.length_mm),
        width_mm: Number(sheet.width_mm),
        height_mm: Number(sheet.height_mm),
      },
      pieces: pieces.map((p) => ({
        length_mm: Number(p.length_mm),
        width_mm: Number(p.width_mm),
        quantity: Number(p.quantity),
      })),
    };
    onConfirm(payload);
  }

  const strips = Array.isArray(pick(balance || {}, 'strips')) ? balance.strips : [];
  const totalBalance = pick(balance || {}, 'totalBalanceWeightKg');

  return (
    <Modal
      title={`Close — MS Cutting · ${sizeLabel(item)}`}
      onClose={busy ? () => {} : onCancel}
      width={620}
    >
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginBottom: 16 }}>
        Confirm the sheet you cut and every cut-piece spec. The leftover material is
        calculated by the system — you do not enter it.
      </div>

      {/* Sheet dimensions */}
      <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 13, color: T_PRIMARY, marginBottom: 8 }}>Sheet dimensions (mm)</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 18 }}>
        <div>
          <label className="form-label">Length</label>
          <input className="form-input" value={sheet.length_mm} onChange={(e) => setSheetField('length_mm', e.target.value)} inputMode="decimal" disabled={busy} />
        </div>
        <div>
          <label className="form-label">Width</label>
          <input className="form-input" value={sheet.width_mm} onChange={(e) => setSheetField('width_mm', e.target.value)} inputMode="decimal" disabled={busy} />
        </div>
        <div>
          <label className="form-label">Height</label>
          <input className="form-input" value={sheet.height_mm} onChange={(e) => setSheetField('height_mm', e.target.value)} inputMode="decimal" disabled={busy} />
        </div>
      </div>

      {/* Cut piece specs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 13, color: T_PRIMARY }}>Cut pieces</span>
        <Mono style={{ fontSize: 10.5, color: T_MUTED }}>({pieces.length})</Mono>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {pieces.map((p, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
            <div>
              {i === 0 && <label className="form-label">Length (mm)</label>}
              <input className="form-input" value={p.length_mm} onChange={(e) => setPieceField(i, 'length_mm', e.target.value)} inputMode="decimal" disabled={busy} />
            </div>
            <div>
              {i === 0 && <label className="form-label">Width (mm)</label>}
              <input className="form-input" value={p.width_mm} onChange={(e) => setPieceField(i, 'width_mm', e.target.value)} inputMode="decimal" disabled={busy} />
            </div>
            <div>
              {i === 0 && <label className="form-label">Quantity</label>}
              <input className="form-input" value={p.quantity} onChange={(e) => setPieceField(i, 'quantity', e.target.value)} inputMode="numeric" disabled={busy} />
            </div>
            <button
              className="btn btn-sm"
              style={{ width: 40, height: 44, padding: 0, justifyContent: 'center' }}
              onClick={() => removePiece(i)}
              disabled={busy || pieces.length === 1}
              aria-label="Remove piece"
              title="Remove piece"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        ))}
      </div>
      <button className="btn btn-sm" onClick={addPiece} disabled={busy} style={{ marginBottom: 18 }}>
        <Icon name="plus" size={15} />Add piece
      </button>

      {/* Calculated balance result */}
      {balance && (
        <div className="card" style={{ background: 'var(--bg-muted, #f4f7f2)', boxShadow: 'none', padding: '14px 16px', marginBottom: 18 }}>
          <Label style={{ marginBottom: 10 }}>Calculated balance — leftover material</Label>
          {strips.length === 0 ? (
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY }}>No leftover strips.</div>
          ) : (
            strips.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <Mono style={{ fontSize: 12, color: T_SECONDARY }}>
                  Strip {i + 1} · {pick(s, 'width')}mm × {pick(s, 'length')}mm
                </Mono>
                <Mono style={{ fontSize: 12, fontWeight: 700, color: T_PRIMARY }}>{pick(s, 'weight')} kg</Mono>
              </div>
            ))
          )}
          {totalBalance != null && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-card, #e3ebde)' }}>
              <Label>Total balance weight</Label>
              <Mono style={{ fontSize: 14, fontWeight: 700, color: 'var(--status-success, #22a06b)' }}>{totalBalance} kg</Mono>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
        <button className="btn" style={{ height: 48, padding: '0 22px' }} onClick={onCancel} disabled={busy}>
          {balance ? 'Done' : 'Cancel'}
        </button>
        {!balance && (
          <button className="btn btn-primary" style={{ height: 48, padding: '0 22px' }} disabled={!valid || busy} onClick={submit}>
            <Icon name="check" size={16} />
            {busy ? 'Calculating…' : 'Confirm cut & calculate balance'}
          </button>
        )}
      </div>
    </Modal>
  );
}

/* ── Alloy Steel Cutting close modal ─────────────────────────────────────────
   Alloy bars arrive in assorted lengths. The operator enters each bar length
   one by one; the system plans the minimum-wastage cut into standard 1250/850
   pieces and shows the per-bar plan + rolled-up yield before the operation is
   closed. The block length itself is fixed to these standards. */
function AlloyCuttingModal({ item, onCancel, onConfirm, busy }) {
  const [bars, setBars] = useState(['']);
  const [plan, setPlan] = useState(null);      // { plans, totals } from calculate
  const [calcBusy, setCalcBusy] = useState(false);
  const [error, setError] = useState(null);

  const validLengths = bars.map((b) => Number(b)).filter((n) => n > 0);
  const canCalc = validLengths.length > 0;

  function setBar(idx, value) {
    setBars((prev) => prev.map((b, i) => (i === idx ? value.replace(/[^0-9.]/g, '') : b)));
    setPlan(null);
  }
  function addBar() { setBars((prev) => [...prev, '']); setPlan(null); }
  function removeBar(idx) { setBars((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)); setPlan(null); }

  async function calculate() {
    if (!canCalc) return;
    setCalcBusy(true);
    setError(null);
    try {
      const res = await faridabadApi.alloyCuttingCalculate(validLengths, ALLOY_SIZES);
      setPlan(res?.data || null);
    } catch (err) {
      setError(err?.message || 'Could not calculate the cut plan.');
    } finally {
      setCalcBusy(false);
    }
  }

  function submit() {
    onConfirm({ bars: validLengths, sizes: ALLOY_SIZES });
  }

  const totals = plan?.totals;

  return (
    <Modal title={`Close — Alloy Steel Cutting · ${sizeLabel(item)}`} onClose={busy ? () => {} : onCancel} width={620}>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY, marginBottom: 16 }}>
        Enter each raw bar length (mm), one by one. The system cuts every bar into standard{' '}
        <strong>1250</strong> and <strong>850&nbsp;mm</strong> pieces with the least possible wastage.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 13, color: T_PRIMARY }}>Bar lengths (mm)</span>
        <Mono style={{ fontSize: 10.5, color: T_MUTED }}>({validLengths.length})</Mono>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {bars.map((b, i) => {
          const p = plan?.plans?.[i];
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 10, alignItems: 'center' }}>
              <input
                className="form-input"
                value={b}
                onChange={(e) => setBar(i, e.target.value)}
                inputMode="decimal"
                placeholder={`bar ${i + 1} length`}
                disabled={busy}
              />
              <div style={{ fontFamily: MONO, fontSize: 12, color: p ? T_PRIMARY : T_MUTED }}>
                {p
                  ? `${p.cuts.map((c) => `${c.qty}×${c.size}`).join(' + ') || 'no full piece'} · waste ${p.wastageMm}mm (${p.wastagePct}%)`
                  : '— press Calculate to plan —'}
              </div>
              <button
                className="btn btn-sm"
                style={{ width: 40, height: 44, padding: 0, justifyContent: 'center' }}
                onClick={() => removeBar(i)}
                disabled={busy || bars.length === 1}
                aria-label="Remove bar"
                title="Remove bar"
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <button className="btn btn-sm" onClick={addBar} disabled={busy}>
          <Icon name="plus" size={15} />Add bar
        </button>
        <button className="btn btn-sm" onClick={calculate} disabled={!canCalc || calcBusy || busy}>
          <Icon name="refresh" size={15} />{calcBusy ? 'Calculating…' : 'Calculate plan'}
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 14, padding: '10px 13px', borderRadius: 9, background: 'var(--bg-soft-amber, #fdf6ef)', color: 'var(--status-danger-dark, #c0392b)', fontFamily: SANS, fontSize: 12 }}>
          {error}
        </div>
      )}

      {totals && (
        <div className="card" style={{ background: 'var(--bg-muted, #f4f7f2)', boxShadow: 'none', padding: '14px 16px', marginBottom: 18 }}>
          <Label style={{ marginBottom: 10 }}>Planned yield — {totals.bars} bar{totals.bars === 1 ? '' : 's'}</Label>
          {totals.bySize.map((s) => (
            <div key={s.size} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <Mono style={{ fontSize: 12, color: T_SECONDARY }}>{s.size}mm pieces</Mono>
              <Mono style={{ fontSize: 12, fontWeight: 700, color: T_PRIMARY }}>{s.qty}</Mono>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-card, #e3ebde)' }}>
            <Label>Total wastage</Label>
            <Mono style={{ fontSize: 14, fontWeight: 700, color: totals.totalWastageMm > 0 ? 'var(--status-warning, #d97a2b)' : 'var(--status-success, #22a06b)' }}>
              {totals.totalWastageMm}mm ({totals.wastagePct}%)
            </Mono>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
        <button className="btn" style={{ height: 48, padding: '0 22px' }} onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" style={{ height: 48, padding: '0 22px' }} disabled={!canCalc || busy} onClick={submit}>
          <Icon name="check" size={16} />
          {busy ? 'Closing…' : 'Confirm cut & close'}
        </button>
      </div>
    </Modal>
  );
}

/* ── Active item card ────────────────────────────────────────────────────── */

/* ── Welding (Joining) close modal ───────────────────────────────────────────
   The operator records the block's BOM — one alloy heat + one MS heat — as they
   close the WELD-01 operation. Replaces the standalone Joining Operation page. */
function WeldingModal({ item, onCancel, onConfirm, busy }) {
  const [alloy, setAlloy] = useState([]);
  const [ms, setMs] = useState([]);
  const [alloyId, setAlloyId] = useState('');
  const [msId, setMsId] = useState('');

  useEffect(() => {
    let alive = true;
    faridabadApi.intakes({ material_type: 'alloy_steel' }).then((r) => { if (alive) setAlloy(r.data || []); }).catch(() => {});
    faridabadApi.intakes({ material_type: 'ms' }).then((r) => { if (alive) setMs(r.data || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const heatLabel = (i) => {
    const heat = pick(i, 'heat_number', 'heatNumber') || '—';
    const grade = pick(i, 'grade', 'steel_grade') || '';
    const supplier = pick(i, 'supplier_name', 'supplier', 'supplier_id');
    return [heat, grade, supplier ? `· ${supplier}` : ''].filter(Boolean).join(' ');
  };
  const noHeats = alloy.length === 0 && ms.length === 0;

  return (
    <Modal title="Welding (Joining) — note MS + alloy" onClose={busy ? () => {} : onCancel} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY }}>
          Note the alloy steel + MS heats welded into this block. Both are optional — you can close the operation without them.
        </div>
        <div>
          <Label>Alloy steel heat</Label>
          <select className="form-select" value={alloyId} onChange={(e) => setAlloyId(e.target.value)}>
            <option value="">{alloy.length ? 'Select alloy heat…' : 'No alloy heats recorded'}</option>
            {alloy.map((i) => <option key={pick(i, 'id')} value={pick(i, 'id')}>{heatLabel(i)}</option>)}
          </select>
        </div>
        <div>
          <Label>MS heat</Label>
          <select className="form-select" value={msId} onChange={(e) => setMsId(e.target.value)}>
            <option value="">{ms.length ? 'Select MS heat…' : 'No MS heats recorded'}</option>
            {ms.map((i) => <option key={pick(i, 'id')} value={pick(i, 'id')}>{heatLabel(i)}</option>)}
          </select>
        </div>
        {noHeats && (
          <div style={{ fontFamily: SANS, fontSize: 12, color: T_MUTED }}>
            No material heats are on record yet (add them under Raw Material Intake). You can still close this operation.
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn btn-sm" onClick={onCancel} disabled={busy} type="button">Cancel</button>
          <button className="btn btn-primary" disabled={busy} type="button"
            onClick={() => onConfirm({ alloyIntakeId: alloyId ? Number(alloyId) : null, msIntakeId: msId ? Number(msId) : null })}>
            {busy ? 'Recording…' : 'Close — log operation'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ActiveItemCard({ item, nowMs, canAct, onClose, pending }) {
  const status = itemStatus(item);
  const accent = dotColor(status);

  const step = pick(item, 'current_step');
  const opName = pick(item, 'operation_name');
  const cycle = pick(item, 'cycle_code');
  const station = pick(item, 'ws_name', 'ws_code');
  const operator = pick(item, 'operator_name');
  const active = elapsedFrom(pick(item, 'started_at'), nowMs);

  const busy = !!pending;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: `4px solid ${accent}` }}>
      <div style={{ padding: '18px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <StatusPill status="in_progress" />
          <Mono style={{ fontSize: 11, color: T_SECONDARY }}>{operator ? `${operator} · ` : ''}{station || ''}</Mono>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 34, letterSpacing: '-0.03em', color: T_PRIMARY, lineHeight: 1 }}>
            {sizeLabel(item)}
          </div>
          {cycle && <CycleBadge cycle={cycle} />}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, marginTop: 8 }}>
          {[opName, step != null ? `Step ${step}` : null].filter(Boolean).join(' · ')}
        </div>
      </div>

      {/* 10-step track */}
      {step != null && (
        <div style={{ padding: '16px 22px', borderTop: '1px solid var(--border-card, #e3ebde)' }}>
          <Label style={{ marginBottom: 8 }}>Step progress — FAR cycle (1…10)</Label>
          <StepTrack step={step} />
        </div>
      )}

      {/* active time */}
      <div style={{ background: 'var(--bg-card, #fff)', padding: '16px 22px', borderTop: '1px solid var(--border-card, #e3ebde)' }}>
        <Label>Active time</Label>
        <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 30, color: accent, marginTop: 6, lineHeight: 1 }}>{fmtHMS(active)}</div>
      </div>

      {/* action */}
      <div style={{ padding: '16px 22px', borderTop: '1px solid var(--border-card, #e3ebde)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {!canAct ? (
          <div style={{ fontFamily: SANS, fontSize: 12.5, color: T_SECONDARY }}>Read-only — you do not have permission to act on this item.</div>
        ) : (
          <button className="btn btn-primary" style={{ height: 56, flex: 1, justifyContent: 'center', fontSize: 14 }} disabled={busy} onClick={onClose}>
            <Icon name="check" size={20} />
            {busy ? 'Closing…' : 'CLOSE — LOG OPERATION'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Queue ───────────────────────────────────────────────────────────────── */

function QueueRow({ item, idx, canAct, onStart, pending }) {
  const cycle = pick(item, 'cycle_code');
  const step = pick(item, 'current_step');
  const opName = pick(item, 'operation_name');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderTop: idx ? '1px solid var(--border-card, #e3ebde)' : 'none' }}>
      <Mono style={{ fontSize: 12, color: T_MUTED, width: 18 }}>{idx + 1}.</Mono>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', color: T_PRIMARY, minWidth: 72 }}>{sizeLabel(item)}</div>
      {cycle && <CycleBadge cycle={cycle} />}
      {opName && <span style={{ fontFamily: SANS, fontSize: 12, color: T_SECONDARY }}>{opName}</span>}
      {step != null && <Mono style={{ fontSize: 11, color: T_MUTED }}>Step {step}</Mono>}
      <div style={{ flex: 1 }} />
      {canAct && (
        <button className="btn btn-sm" style={{ height: 40 }} disabled={!!pending} onClick={onStart}>
          <Icon name="play" size={15} />{pending ? 'Starting…' : 'Start'}
        </button>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function FaridabadMyWorkstation() {
  const { user, isOperator, isSupervisor, isAdmin, isManager } = useAuth();
  const canAct = isOperator || isSupervisor || isAdmin; // Manager view is read-only
  const nowMs = useNow(true);

  const { data, error, loading, refetch } = usePolling(
    () => faridabadApi.floor().then((r) => r.data),
    [],
    { interval: 20000 }
  );

  // Floor groups = workstations, each with their items. Keep only those that
  // actually have items, so a tab is only shown when there is work.
  const groups = useMemo(() => {
    const raw = Array.isArray(data) ? data : pick(data || {}, 'data') || [];
    return (Array.isArray(raw) ? raw : []).filter((g) => Array.isArray(g.items) && g.items.length > 0);
  }, [data]);

  const [activeWs, setActiveWs] = useState(null);
  useEffect(() => {
    if (groups.length && (!activeWs || !groups.find((g) => g.code === activeWs))) {
      setActiveWs(groups[0].code);
    }
  }, [groups, activeWs]);

  const group = groups.find((g) => g.code === activeWs) || groups[0] || null;

  const activeItem = useMemo(
    () => (group ? group.items.find((it) => itemStatus(it) === 'in_progress') : null),
    [group]
  );
  const queue = useMemo(
    () => (group ? group.items.filter((it) => itemStatus(it) === 'queued') : []),
    [group]
  );

  const [pending, setPending] = useState(null); // item id currently acting on
  const [closeFor, setCloseFor] = useState(null); // item (MS Cutting modal)
  const [alloyFor, setAlloyFor] = useState(null); // item (Alloy Cutting modal)
  const [weldFor, setWeldFor] = useState(null);   // item (Welding/Joining modal)
  const [balance, setBalance] = useState(null); // returned MS Cutting balance
  const [actionError, setActionError] = useState(null);

  const pendingFor = (item) => (pending === itemId(item) ? true : null);

  const handleStart = useCallback(
    async (item) => {
      setActionError(null);
      setPending(itemId(item));
      try {
        await faridabadApi.startItem(itemId(item));
        await refetch();
      } catch (err) {
        setActionError(err?.message || 'Could not start the item — please try again.');
      } finally {
        setPending(null);
      }
    },
    [refetch]
  );

  // Normal-step close: no extra payload, just advance.
  const handleNormalClose = useCallback(
    async (item) => {
      setActionError(null);
      setPending(itemId(item));
      try {
        await faridabadApi.closeItem(itemId(item), {});
        await refetch();
      } catch (err) {
        setActionError(err?.message || 'Could not close the item — please try again.');
      } finally {
        setPending(null);
      }
    },
    [refetch]
  );

  // MS Cutting close: confirm sheet + pieces, show calculated balance, refetch.
  const handleMsClose = useCallback(
    async (payload) => {
      if (!closeFor) return;
      setActionError(null);
      setPending(itemId(closeFor));
      try {
        const res = await faridabadApi.closeItem(itemId(closeFor), payload);
        setBalance(pick(res?.data || {}, 'balance') ?? null);
        await refetch();
      } catch (err) {
        setActionError(err?.message || 'Could not close the MS Cutting item — please try again.');
        setCloseFor(null);
      } finally {
        setPending(null);
      }
    },
    [closeFor, refetch]
  );

  // Alloy Steel Cutting close: operator enters bar lengths; server records the
  // minimum-wastage cut plan and advances the item.
  const handleAlloyClose = useCallback(
    async (payload) => {
      if (!alloyFor) return;
      setActionError(null);
      setPending(itemId(alloyFor));
      try {
        await faridabadApi.closeItem(itemId(alloyFor), payload);
        await refetch();
        setAlloyFor(null);
      } catch (err) {
        setActionError(err?.message || 'Could not record the alloy cut — please try again.');
      } finally {
        setPending(null);
      }
    },
    [alloyFor, refetch]
  );

  // Welding (Joining) close: operator records the alloy + MS BOM, then advance.
  const handleWeldClose = useCallback(
    async (payload) => {
      if (!weldFor) return;
      setActionError(null);
      setPending(itemId(weldFor));
      try {
        await faridabadApi.closeItem(itemId(weldFor), payload);
        await refetch();
        setWeldFor(null);
      } catch (err) {
        setActionError(err?.message || 'Could not record the weld — please try again.');
      } finally {
        setPending(null);
      }
    },
    [weldFor, refetch]
  );

  function onCloseActive(item) {
    if (isWelding(item)) {
      setWeldFor(item);
    } else if (isAlloyCutting(item)) {
      setAlloyFor(item);
    } else if (isMsCutting(item)) {
      setBalance(null);
      setCloseFor(item);
    } else {
      handleNormalClose(item);
    }
  }

  function dismissMsModal() {
    setCloseFor(null);
    setBalance(null);
  }

  /* ── render states ── */

  const header = (
    <>
      <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: T_PRIMARY }}>Faridabad My Workstation</div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, marginTop: 4 }}>
        {pick(user || {}, 'name', 'full_name', 'username') || 'Operator'} · your Faridabad workstations{loading ? ' · loading…' : ''}
        {(isManager && !isAdmin) ? ' · read-only' : ''}
      </div>
    </>
  );

  if (error) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
        {header}
        <div className="card" style={{ marginTop: 20, padding: 28, textAlign: 'center' }}>
          <div style={{ fontFamily: SANS, fontSize: 14, color: 'var(--status-danger-dark, #c0392b)' }}>
            {error.message || 'Could not load the Faridabad floor.'}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={refetch}>
            <Icon name="refresh" size={16} />Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
        {header}
        <div className="card" style={{ marginTop: 20, padding: 40, textAlign: 'center', fontFamily: SANS, fontSize: 13, color: T_SECONDARY }}>
          Loading your Faridabad workstations…
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {header}

      {actionError && (
        // Fixed toast with a z-index above the modal overlay (z 80) so a failed
        // close is always visible — even while a close modal is still open.
        <div
          className="card"
          style={{
            position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 120,
            width: 'min(680px, calc(100vw - 32px))', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
            borderLeft: '4px solid var(--status-danger, #e5484d)', boxShadow: 'var(--shadow-modal, 0 10px 40px rgba(10,29,58,0.25))',
          }}
        >
          <Icon name="alert" size={18} color="#e5484d" />
          <span style={{ fontFamily: SANS, fontSize: 13, color: 'var(--status-danger-dark, #c0392b)', flex: 1 }}>{actionError}</span>
          <button className="btn btn-sm" onClick={() => setActionError(null)}>Dismiss</button>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="card" style={{ marginTop: 20, padding: 40, textAlign: 'center' }}>
          <Icon name="monitor" size={28} color={T_MUTED} />
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 16, color: T_PRIMARY, marginTop: 10 }}>No Faridabad items assigned</div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, marginTop: 4 }}>
            There are no items on your Faridabad workstations right now.
          </div>
        </div>
      ) : (
        <>
          {/* workstation tab strip */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>
            {groups.map((g) => {
              const gActive = g.items.find((it) => itemStatus(it) === 'in_progress');
              const gStatus = gActive ? 'in_progress' : 'idle';
              const sel = g.code === activeWs;
              return (
                <button
                  key={g.code}
                  onClick={() => setActiveWs(g.code)}
                  className="btn"
                  style={{
                    height: 48,
                    padding: '0 18px',
                    background: sel ? 'var(--ink-650, #15366a)' : 'var(--bg-card, #fff)',
                    color: sel ? 'var(--text-onink, #eaf4e4)' : T_PRIMARY,
                    border: sel ? 'none' : '1px solid var(--border-input, #d6e0d2)',
                  }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor(gStatus), display: 'inline-block' }} />
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
                    <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700 }}>{g.name || g.code}</span>
                    {g.name && g.name !== g.code && <span style={{ fontFamily: MONO, fontSize: 10, opacity: 0.7 }}>{g.code}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          {group && (
            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* station heading */}
              <div>
                <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em', color: T_PRIMARY }}>
                  {group.name || group.code}
                  {group.name && group.name !== group.code && <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 13, color: T_MUTED }}>{' '}· {group.code}</span>}
                  {activeItem && (
                    <span style={{ fontFamily: SANS, fontWeight: 500, fontSize: 14, color: T_SECONDARY }}>
                      {' '}— {pick(activeItem, 'operation_name') || 'Active item'}
                      {pick(activeItem, 'current_step') != null ? ` · Step ${pick(activeItem, 'current_step')}` : ''}
                    </span>
                  )}
                </div>
              </div>

              {activeItem ? (
                <ActiveItemCard
                  item={activeItem}
                  nowMs={nowMs}
                  canAct={canAct}
                  pending={pendingFor(activeItem)}
                  onClose={() => onCloseActive(activeItem)}
                />
              ) : (
                <div className="card" style={{ padding: 28, textAlign: 'center' }}>
                  <StatusPill status="idle" />
                  <div style={{ fontFamily: SANS, fontSize: 13, color: T_SECONDARY, marginTop: 10 }}>
                    No active item at this workstation. Start the next item from the queue below.
                  </div>
                </div>
              )}

              {/* queue */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: queue.length ? '1px solid var(--border-card, #e3ebde)' : 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="list" size={16} color={T_SECONDARY} />
                  <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 14, letterSpacing: '-0.02em', color: T_PRIMARY }}>
                    Queue — {group.name || group.code}
                  </span>
                  <Mono style={{ fontSize: 11, color: T_MUTED }}>
                    ({queue.length} {queue.length === 1 ? 'item' : 'items'} waiting)
                  </Mono>
                </div>
                {queue.length === 0 ? (
                  <div style={{ padding: '20px 18px', fontFamily: SANS, fontSize: 13, color: T_SECONDARY }}>
                    Queue is clear — no items waiting at this workstation.
                  </div>
                ) : (
                  queue.map((it, i) => (
                    <QueueRow
                      key={itemId(it) ?? i}
                      item={it}
                      idx={i}
                      canAct={canAct && !activeItem}
                      pending={pendingFor(it)}
                      onStart={() => handleStart(it)}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}

      {closeFor && (
        <MsCuttingModal
          item={closeFor}
          busy={pendingFor(closeFor) === true}
          balance={balance}
          onCancel={dismissMsModal}
          onConfirm={handleMsClose}
        />
      )}

      {alloyFor && (
        <AlloyCuttingModal
          item={alloyFor}
          busy={pendingFor(alloyFor) === true}
          onCancel={() => setAlloyFor(null)}
          onConfirm={handleAlloyClose}
        />
      )}

      {weldFor && (
        <WeldingModal
          item={weldFor}
          busy={pendingFor(weldFor) === true}
          onCancel={() => setWeldFor(null)}
          onConfirm={handleWeldClose}
        />
      )}
    </div>
  );
}
