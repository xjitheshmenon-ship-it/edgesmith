import { useState, useMemo } from 'react';
import { uidsApi } from '../api/uids';
import { cyclesApi, receivingApi, masterApi, mosApi } from '../api/resources';
import { usePolling } from '../hooks/usePolling';
import { useAuth } from '../store/AuthContext';
import Icon from '../components/common/Icon';
import { CycleBadge, PriorityBadge } from '../components/common/Badges';

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";

const KERF_MM = 3;
const CYCLE_OPTIONS = ['EAT', 'SWAN', 'OVEN'];
const PRIORITIES = ['High', 'Normal', 'Low'];

// ── small shared bits ──────────────────────────────────────────────────────

function Label({ children }) {
  return <label className="form-label">{children}</label>;
}

function SectionTitle({ icon, children, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
      {icon && <Icon name={icon} size={16} color="var(--text-secondary)" />}
      <div>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>{children}</div>
        {sub && <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function ErrorBanner({ error, onClose }) {
  if (!error) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 'var(--radius-lg)', background: 'rgba(229,72,77,0.10)', border: '1px solid rgba(229,72,77,0.30)', marginBottom: 16 }}>
      <Icon name="alert" size={16} color="var(--status-danger)" />
      <div style={{ flex: 1, fontFamily: SANS, fontSize: 12.5, color: 'var(--status-danger-dark)' }}>
        {error.message || 'Something went wrong.'}
        {error.code && <span style={{ fontFamily: MONO, fontSize: 10, marginLeft: 8, opacity: 0.7 }}>{error.code}</span>}
      </div>
      {onClose && (
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--status-danger-dark)', display: 'flex' }}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

function EmptyRow({ colSpan, children }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '26px 14px', textAlign: 'center', fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary)' }}>
        {children}
      </td>
    </tr>
  );
}

// ── main page ───────────────────────────────────────────────────────────────

export default function UidCreation() {
  const { isManager, isAdmin } = useAuth();
  const canBulk = isManager || isAdmin;

  const [mode, setMode] = useState('billet'); // 'billet' | 'bulk'

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="tag" size={20} color="var(--text-primary)" />
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>UID Creation</div>
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            BSW-01 · Dharmapuri — the UID birth point. Each billet is cut into pieces and every piece gets a UID.
          </div>
        </div>
        {canBulk && (
          <div className="tab-strip">
            <button className={mode === 'billet' ? 'active' : ''} onClick={() => setMode('billet')}>From billet</button>
            <button className={mode === 'bulk' ? 'active' : ''} onClick={() => setMode('bulk')}>Bulk create</button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 22 }}>
        {mode === 'billet'
          ? <BilletFlow />
          : <BulkFlow />}
      </div>

      <RecentlyCreated />
    </div>
  );
}

// ── BILLET FLOW ──────────────────────────────────────────────────────────────

function BilletFlow() {
  // reference data
  const { data: ref } = usePolling(async () => {
    const [events, cycles, sizes, designs, mos] = await Promise.all([
      receivingApi.list().then((r) => r.data).catch(() => []),
      cyclesApi.list().then((r) => r.data).catch(() => []),
      masterApi.sizes().then((r) => r.data).catch(() => []),
      masterApi.designs().then((r) => r.data).catch(() => []),
      mosApi.list().then((r) => r.data).catch(() => []),
    ]);
    return { events: events || [], cycles: cycles || [], sizes: sizes || [], designs: designs || [], mos: mos || [] };
  }, [], { interval: 60000 });

  const events = ref?.events || [];
  const cycles = ref?.cycles || [];
  const designs = ref?.designs || [];
  const mos = ref?.mos || [];

  const [eventId, setEventId] = useState('');
  const [billetRef, setBilletRef] = useState('');
  const [billetLength, setBilletLength] = useState('');
  const [cutCount, setCutCount] = useState(2);
  const [pieces, setPieces] = useState(() => makePieces(2));
  const [designId, setDesignId] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [moId, setMoId] = useState('');

  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const selectedEvent = events.find((e) => String(e.id ?? e.receiving_id) === String(eventId));

  function makePieces(n) {
    return Array.from({ length: n }, () => ({ cycle: 'EAT', size: '' }));
  }

  function changeCutCount(n) {
    setCutCount(n);
    setPieces((prev) => {
      const next = makePieces(n);
      for (let i = 0; i < Math.min(n, prev.length); i++) next[i] = prev[i];
      return next;
    });
    setPreview(null);
  }

  function setPiece(i, field, val) {
    setPieces((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: val } : p)));
    setPreview(null);
  }

  // scrap = billet length − sum(piece lengths) − cuts × kerf
  const sumPieces = pieces.reduce((acc, p) => acc + (Number(p.size) || 0), 0);
  const scrap = useMemo(() => {
    const len = Number(billetLength);
    if (!len) return null;
    return len - sumPieces - cutCount * KERF_MM;
  }, [billetLength, sumPieces, cutCount]);
  const scrapNegative = scrap != null && scrap < 0;

  const piecesValid = pieces.every((p) => p.cycle && Number(p.size) > 0);
  const formValid = eventId && billetRef && piecesValid && !scrapNegative;

  async function runPreview() {
    setError(null);
    setSuccess(null);
    if (!formValid) {
      setError({ message: 'Complete the cut details (each piece needs a cycle and a size, and scrap must be ≥ 0).' });
      return;
    }
    setPreviewing(true);
    try {
      // Preview every distinct cycle in the cut so we get the next codes per type.
      // uidsApi.preview takes (cycle, qty); group pieces by cycle.
      const byCycle = pieces.reduce((m, p) => ((m[p.cycle] = (m[p.cycle] || 0) + 1), m), {});
      const results = await Promise.all(
        Object.entries(byCycle).map(([cycle, qty]) =>
          uidsApi.preview(cycle, qty).then((r) => ({ cycle, codes: normalizeCodes(r.data, qty) }))
        )
      );
      // flatten codes back into per-piece order
      const pool = {};
      results.forEach(({ cycle, codes }) => { pool[cycle] = [...codes]; });
      const rows = pieces.map((p) => ({
        code: (pool[p.cycle] && pool[p.cycle].shift()) || '—',
        cycle: p.cycle,
        size: Number(p.size),
      }));
      setPreview({ rows, scrap });
    } catch (err) {
      setError(err);
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmCreate() {
    setError(null);
    if (!formValid || scrapNegative) return;
    setSubmitting(true);
    try {
      const payload = {
        location: 'dharmapuri',
        workstation: 'BSW-01',
        receiving_event_id: selectedEvent ? (selectedEvent.id ?? selectedEvent.receiving_id) : undefined,
        billet_ref: billetRef,
        billet_length_mm: Number(billetLength) || undefined,
        cut_count: cutCount,
        priority,
        design_id: designId || undefined,
        mo_id: moId || undefined,
        pieces: pieces.map((p) => ({ cycle: p.cycle, size_mm: Number(p.size) })),
      };
      const res = await uidsApi.bulkCreate(payload);
      const created = res.data;
      const count = Array.isArray(created) ? created.length : (created?.count ?? pieces.length);
      setSuccess({ count, codes: extractCreatedCodes(created) });
      setPreview(null);
      setBilletRef('');
      setBilletLength('');
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  const billetOptions = useMemo(() => {
    const total = selectedEvent?.billet_count ?? selectedEvent?.billets ?? selectedEvent?.billets_total ?? 0;
    return Array.from({ length: total }, (_, i) => i + 1);
  }, [selectedEvent]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
      {/* FORM */}
      <div className="card" style={{ padding: 22 }}>
        <SectionTitle icon="inbox" sub="Material traceability from Faridabad is carried onto every UID created here.">Create UIDs from a billet</SectionTitle>

        <ErrorBanner error={error} onClose={() => setError(null)} />
        {success && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 'var(--radius-lg)', background: 'rgba(34,160,107,0.10)', border: '1px solid rgba(34,160,107,0.30)', marginBottom: 16 }}>
            <Icon name="check" size={16} color="var(--status-success)" />
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--status-success-dark)' }}>
              Created {success.count} UID{success.count === 1 ? '' : 's'}
              {success.codes?.length ? <span style={{ fontFamily: MONO, marginLeft: 8 }}>{success.codes.join(', ')}</span> : null}
              {' — '}status active, step 1 (BSW-01), storage RM-Q. Print the list at RCV-01 for tagging.
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <Label>Receiving event</Label>
            <select className="form-select" value={eventId} onChange={(e) => { setEventId(e.target.value); setBilletRef(''); setPreview(null); }}>
              <option value="">Select a receiving event…</option>
              {events.map((ev) => {
                const id = ev.id ?? ev.receiving_id;
                const remaining = ev.billets_remaining ?? ev.remaining ?? ev.billet_count ?? ev.billets;
                return (
                  <option key={id} value={id}>
                    {(ev.ref || ev.reference || ev.event_ref || `RCV-${id}`)}
                    {ev.contractor || ev.rolling_contractor ? ` · ${ev.contractor || ev.rolling_contractor}` : ''}
                    {ev.date || ev.received_at ? ` · ${String(ev.date || ev.received_at).slice(0, 10)}` : ''}
                    {remaining != null ? ` · ${remaining} billets` : ''}
                  </option>
                );
              })}
            </select>
            {events.length === 0 && <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>No receiving events available.</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <Label>Billet within event</Label>
              <select className="form-select" value={billetRef} onChange={(e) => { setBilletRef(e.target.value); setPreview(null); }} disabled={!eventId}>
                <option value="">Select billet…</option>
                {billetOptions.map((n) => (
                  <option key={n} value={n}>Billet {n}{billetOptions.length ? ` of ${billetOptions.length}` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Billet length (mm)</Label>
              <input className="form-input" type="number" min="0" placeholder="e.g. 3600" value={billetLength} onChange={(e) => { setBilletLength(e.target.value); setPreview(null); }} />
            </div>
          </div>

          <div>
            <Label>Number of pieces (cut count)</Label>
            <div className="tab-strip">
              {[2, 3].map((n) => (
                <button key={n} className={cutCount === n ? 'active' : ''} onClick={() => changeCutCount(n)}>{n} pieces</button>
              ))}
            </div>
          </div>

          {/* per-piece cycle + size */}
          <div style={{ display: 'grid', gap: 10 }}>
            {pieces.map((p, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr', gap: 12, alignItems: 'end' }}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', color: 'var(--text-secondary)', textTransform: 'uppercase', paddingBottom: 13 }}>
                  Piece {i + 1}
                </div>
                <div>
                  {i === 0 && <Label>Cycle type</Label>}
                  <select className="form-select" value={p.cycle} onChange={(e) => setPiece(i, 'cycle', e.target.value)}>
                    {CYCLE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  {i === 0 && <Label>Size (mm)</Label>}
                  <input className="form-input" type="number" min="0" placeholder="auto" value={p.size} onChange={(e) => setPiece(i, 'size', e.target.value)} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <Label>Design (optional — can confirm later)</Label>
              <select className="form-select" value={designId} onChange={(e) => setDesignId(e.target.value)}>
                <option value="">No design yet</option>
                {designs.map((d) => <option key={d.id} value={d.id}>{d.name || d.code || d.design_code || `Design ${d.id}`}</option>)}
              </select>
            </div>
            <div>
              <Label>Priority</Label>
              <select className="form-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
              </select>
            </div>
          </div>

          <div>
            <Label>MO number (optional — can link later)</Label>
            <select className="form-select" value={moId} onChange={(e) => setMoId(e.target.value)}>
              <option value="">No MO</option>
              {mos.map((m) => <option key={m.id} value={m.id}>{m.mo_number || m.number || m.code || `MO-${m.id}`}</option>)}
            </select>
          </div>

          {/* scrap readout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 'var(--radius-lg)', background: scrapNegative ? 'rgba(229,72,77,0.10)' : 'var(--bg-muted)', border: scrapNegative ? '1px solid rgba(229,72,77,0.30)' : '1px solid var(--border-card)' }}>
            <Icon name={scrapNegative ? 'alert' : 'stack'} size={15} color={scrapNegative ? 'var(--status-danger)' : 'var(--text-secondary)'} />
            <div style={{ fontFamily: SANS, fontSize: 12, color: scrapNegative ? 'var(--status-danger-dark)' : 'var(--text-secondary)' }}>
              Scrap from this cut:&nbsp;
              <span style={{ fontFamily: MONO, fontWeight: 600 }}>{scrap == null ? '—' : `${scrap} mm`}</span>
              <span style={{ opacity: 0.65 }}>&nbsp;= {billetLength || '?'} − {sumPieces} − ({cutCount} × {KERF_MM}mm kerf)</span>
              {scrapNegative && <span style={{ fontWeight: 700, marginLeft: 8 }}>Negative scrap blocks creation.</span>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={runPreview} disabled={previewing || !formValid}>
              <Icon name="search" size={15} />
              {previewing ? 'Previewing…' : 'Preview UIDs'}
            </button>
            <button className="btn btn-primary" onClick={confirmCreate} disabled={submitting || !formValid || !preview}>
              <Icon name="check" size={15} />
              {submitting ? 'Creating…' : 'Confirm & generate'}
            </button>
          </div>
          {!preview && formValid && <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-secondary)' }}>Preview before generating.</div>}
        </div>
      </div>

      {/* PREVIEW PANEL */}
      <PreviewPanel preview={preview} designs={designs} designId={designId} priority={priority} />
    </div>
  );
}

// ── BULK FLOW (manager / planning) ───────────────────────────────────────────

function BulkFlow() {
  const { data: ref } = usePolling(async () => {
    const [designs, mos] = await Promise.all([
      masterApi.designs().then((r) => r.data).catch(() => []),
      mosApi.list().then((r) => r.data).catch(() => []),
    ]);
    return { designs: designs || [], mos: mos || [] };
  }, [], { interval: 60000 });
  const designs = ref?.designs || [];
  const mos = ref?.mos || [];

  const [cycle, setCycle] = useState('EAT');
  const [qty, setQty] = useState(1);
  const [size, setSize] = useState('');
  const [designId, setDesignId] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [moId, setMoId] = useState('');

  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const qtyNum = Number(qty);
  const valid = cycle && qtyNum > 0 && qtyNum <= 500;

  async function runPreview() {
    setError(null);
    setSuccess(null);
    if (!valid) { setError({ message: 'Enter a cycle and a quantity between 1 and 500.' }); return; }
    setPreviewing(true);
    try {
      const r = await uidsApi.preview(cycle, qtyNum);
      const codes = normalizeCodes(r.data, qtyNum);
      setPreview({ rows: codes.map((c) => ({ code: c, cycle, size: Number(size) || null })) });
    } catch (err) { setError(err); setPreview(null); }
    finally { setPreviewing(false); }
  }

  async function confirmCreate() {
    setError(null);
    if (!valid) return;
    setSubmitting(true);
    try {
      const payload = {
        location: 'dharmapuri',
        workstation: 'BSW-01',
        cycle,
        quantity: qtyNum,
        size_mm: Number(size) || undefined,
        design_id: designId || undefined,
        priority,
        mo_id: moId || undefined,
        traceability: null, // bulk planning — material fields linked to a receiving event later
      };
      const res = await uidsApi.bulkCreate(payload);
      const created = res.data;
      const count = Array.isArray(created) ? created.length : (created?.count ?? qtyNum);
      setSuccess({ count, codes: extractCreatedCodes(created) });
      setPreview(null);
    } catch (err) { setError(err); }
    finally { setSubmitting(false); }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
      <div className="card" style={{ padding: 22 }}>
        <SectionTitle icon="stack" sub="No billet reference — material traceability is left blank, to be linked to a receiving event later.">Bulk UID creation</SectionTitle>

        <ErrorBanner error={error} onClose={() => setError(null)} />
        {success && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 'var(--radius-lg)', background: 'rgba(34,160,107,0.10)', border: '1px solid rgba(34,160,107,0.30)', marginBottom: 16 }}>
            <Icon name="check" size={16} color="var(--status-success)" />
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--status-success-dark)' }}>
              Created {success.count} UID{success.count === 1 ? '' : 's'} in sequence.
              {success.codes?.length ? <span style={{ fontFamily: MONO, marginLeft: 8 }}>{success.codes.join(', ')}</span> : null}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <Label>Cycle type</Label>
              <select className="form-select" value={cycle} onChange={(e) => { setCycle(e.target.value); setPreview(null); }}>
                {CYCLE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <Label>Quantity</Label>
              <input className="form-input" type="number" min="1" max="500" value={qty} onChange={(e) => { setQty(e.target.value); setPreview(null); }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <Label>Size in mm (optional)</Label>
              <input className="form-input" type="number" min="0" placeholder="optional" value={size} onChange={(e) => setSize(e.target.value)} />
            </div>
            <div>
              <Label>Priority</Label>
              <select className="form-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <Label>Design (optional)</Label>
              <select className="form-select" value={designId} onChange={(e) => setDesignId(e.target.value)}>
                <option value="">No design yet</option>
                {designs.map((d) => <option key={d.id} value={d.id}>{d.name || d.code || d.design_code || `Design ${d.id}`}</option>)}
              </select>
            </div>
            <div>
              <Label>MO number (optional)</Label>
              <select className="form-select" value={moId} onChange={(e) => setMoId(e.target.value)}>
                <option value="">No MO</option>
                {mos.map((m) => <option key={m.id} value={m.id}>{m.mo_number || m.number || m.code || `MO-${m.id}`}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={runPreview} disabled={previewing || !valid}>
              <Icon name="search" size={15} />
              {previewing ? 'Previewing…' : 'Preview UIDs'}
            </button>
            <button className="btn btn-primary" onClick={confirmCreate} disabled={submitting || !valid || !preview}>
              <Icon name="check" size={15} />
              {submitting ? 'Creating…' : 'Confirm & generate'}
            </button>
          </div>
        </div>
      </div>

      <PreviewPanel preview={preview} designs={designs} designId={designId} priority={priority} />
    </div>
  );
}

// ── PREVIEW PANEL (shared) ────────────────────────────────────────────────────

function PreviewPanel({ preview, designs, designId, priority }) {
  const design = designs?.find((d) => String(d.id) === String(designId));
  return (
    <div className="card" style={{ padding: 22, position: 'sticky', top: 16 }}>
      <SectionTitle icon="list" sub="UIDs that will be created, with assigned cycle, size and inherited material details.">Generation preview</SectionTitle>
      {!preview ? (
        <div style={{ padding: '34px 14px', textAlign: 'center', fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          <Icon name="tag" size={26} color="var(--text-muted)" />
          <div style={{ marginTop: 10 }}>Run a preview to see the UIDs that will be generated.</div>
        </div>
      ) : (
        <div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['UID', 'Cycle', 'Size'].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border-card)' }}>
                  <td style={{ ...tdStyle, fontFamily: MONO, fontWeight: 600 }}>{row.code}</td>
                  <td style={tdStyle}><CycleBadge cycle={row.cycle} /></td>
                  <td style={{ ...tdStyle, fontFamily: MONO }}>{row.size ? `${row.size} mm` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* design confirmation + priority summary */}
          <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <PriorityBadge priority={priority} />
            <span className="badge" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>
              {design ? `DESIGN ${design.name || design.code || design.design_code}` : 'DESIGN PENDING — confirm before Step 16'}
            </span>
          </div>

          {preview.scrap != null && (
            <div style={{ marginTop: 14, fontFamily: SANS, fontSize: 11.5, color: preview.scrap < 0 ? 'var(--status-danger-dark)' : 'var(--text-secondary)' }}>
              Scrap from this cut: <span style={{ fontFamily: MONO, fontWeight: 600 }}>{preview.scrap} mm</span>
            </div>
          )}

          <div style={{ marginTop: 14, fontFamily: SANS, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            On confirm each UID inherits the Faridabad batch reference, alloy & MS supplier / heat / grade, rolling contractor, and the receiving event reference. Status → active, step 1 (BSW-01), storage RM-Q.
          </div>
        </div>
      )}
    </div>
  );
}

// ── RECENTLY CREATED (today) ──────────────────────────────────────────────────

function RecentlyCreated() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, loading, error } = usePolling(
    () => uidsApi.list({ created_from: today, workstation: 'BSW-01', location: 'dharmapuri', per_page: 50, sort: '-created_at' }).then((r) => r.data),
    [today],
    { interval: 30000 }
  );
  const rows = Array.isArray(data) ? data : (data?.items || data?.uids || []);

  const cols = ['UID', 'Cycle', 'Size', 'Design', 'Priority', 'MO', 'Receiving event', 'Created at'];

  return (
    <div className="card" style={{ padding: 22, marginTop: 18 }}>
      <SectionTitle icon="db" sub="UIDs created today at BSW-01. They appear immediately on the Production Floor at Step 1.">Recently created UIDs</SectionTitle>
      <ErrorBanner error={error} />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>{cols.map((c) => <th key={c} style={thStyle}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <EmptyRow colSpan={cols.length}>Loading…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={cols.length}>No UIDs created today yet.</EmptyRow>
            ) : (
              rows.map((u, i) => (
                <tr key={u.code || u.uid || i} style={{ borderTop: '1px solid var(--border-card)' }}>
                  <td style={{ ...tdStyle, fontFamily: MONO, fontWeight: 600 }}>{u.code || u.uid || '—'}</td>
                  <td style={tdStyle}>{u.cycle ? <CycleBadge cycle={u.cycle || u.cycle_type} /> : '—'}</td>
                  <td style={{ ...tdStyle, fontFamily: MONO }}>{(u.size_mm ?? u.size) != null ? `${u.size_mm ?? u.size} mm` : '—'}</td>
                  <td style={tdStyle}>{u.design_name || u.design || u.design_code || '—'}</td>
                  <td style={tdStyle}>{u.priority ? <PriorityBadge priority={u.priority} /> : '—'}</td>
                  <td style={{ ...tdStyle, fontFamily: MONO }}>{u.mo_number || u.mo || '—'}</td>
                  <td style={{ ...tdStyle, fontFamily: MONO }}>{u.receiving_ref || u.receiving_event || u.receiving_event_ref || '—'}</td>
                  <td style={{ ...tdStyle, fontFamily: MONO, color: 'var(--text-secondary)' }}>{formatTime(u.created_at || u.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

const thStyle = {
  textAlign: 'left',
  padding: '8px 10px',
  fontFamily: MONO,
  fontSize: 9.5,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '10px 10px',
  fontFamily: SANS,
  fontSize: 12.5,
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
};

// preview endpoint may return: an array of codes, {codes:[...]}, {next_code, qty}, etc.
function normalizeCodes(data, qty) {
  if (Array.isArray(data)) return data.map((d) => (typeof d === 'string' ? d : d.code || d.uid)).slice(0, qty);
  if (data?.codes && Array.isArray(data.codes)) return data.codes.slice(0, qty);
  if (data?.uids && Array.isArray(data.uids)) return data.uids.map((u) => u.code || u.uid).slice(0, qty);
  // derive a sequence from a starting code like "E044"
  const start = data?.next_code || data?.start || data?.first_code;
  if (typeof start === 'string') {
    const m = start.match(/^([A-Za-z]*)(\d+)$/);
    if (m) {
      const prefix = m[1];
      const width = m[2].length;
      const n0 = parseInt(m[2], 10);
      return Array.from({ length: qty }, (_, i) => prefix + String(n0 + i).padStart(width, '0'));
    }
  }
  return Array.from({ length: qty }, () => '—');
}

function extractCreatedCodes(created) {
  if (Array.isArray(created)) return created.map((c) => (typeof c === 'string' ? c : c.code || c.uid)).filter(Boolean);
  if (created?.codes) return created.codes;
  if (created?.uids) return created.uids.map((u) => u.code || u.uid).filter(Boolean);
  return [];
}

function formatTime(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    if (isNaN(d)) return String(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(ts);
  }
}
