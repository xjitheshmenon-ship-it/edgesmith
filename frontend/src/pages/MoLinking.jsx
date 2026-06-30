import { useState, useCallback, useEffect, useRef } from 'react';
import { usePolling } from '../hooks/usePolling';
import { mosApi, masterApi } from '../api/resources';
import { uidsApi } from '../api/uids';
import { useAuth } from '../store/AuthContext';
import { StatusPill, PriorityBadge } from '../components/common/Badges';
import Icon from '../components/common/Icon';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

const PICKER_LIMIT = 25;

// ── small presentational helpers (match QC.jsx conventions) ──
function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
        {children}
      </div>
      {right}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', padding: '6px 0' }}>
      {children}
    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-danger, #e5484d)', background: 'rgba(229,72,77,0.08)', border: '1px solid rgba(229,72,77,0.25)', borderRadius: 'var(--radius-md, 9px)', padding: '10px 12px' }}>
      <Icon name="alert" size={15} color="var(--status-danger, #e5484d)" />
      <span>{message}</span>
    </div>
  );
}

function SuccessBanner({ message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: SANS, fontSize: 13, color: 'var(--status-success-dark, #1c7a52)', background: 'rgba(34,160,107,0.1)', border: '1px solid rgba(34,160,107,0.25)', borderRadius: 'var(--radius-md, 9px)', padding: '10px 12px' }}>
      <Icon name="check" size={15} color="var(--status-success-dark, #1c7a52)" />
      <span>{message}</span>
    </div>
  );
}

// ── field accessors (tolerate snake/camel from API) ──
const moNumber = (m) => m.moNumber || m.mo_number || m.number || m.code || '—';
const moCustomer = (m) => m.customer || m.customerName || m.customer_name || '—';
const moQty = (m) => m.quantityRequired ?? m.quantity_required ?? m.qtyRequired ?? m.qty_required ?? m.quantity ?? m.qty ?? 0;
const moSize = (m) => m.size || m.sizeMm || m.size_mm || '—';
const moDesign = (m) => m.design || m.designCode || m.design_code || '—';
const moPriority = (m) => m.priority || 'Normal';
const moLinked = (m) => m.uidsLinked ?? m.uids_linked ?? m.linkedCount ?? m.linked ?? (Array.isArray(m.uids) ? m.uids.length : 0) ?? 0;
const moDispatched = (m) => m.uidsDispatched ?? m.uids_dispatched ?? m.dispatchedCount ?? m.dispatched ?? 0;
const moId = (m) => m.id ?? m.moId ?? m.mo_id ?? moNumber(m);

function deriveStatus(m) {
  const explicit = m.status || m.state;
  if (explicit) return String(explicit);
  const qty = Number(moQty(m)) || 0;
  const linked = Number(moLinked(m)) || 0;
  const dispatched = Number(moDispatched(m)) || 0;
  if (linked === 0) return 'Open';
  if (qty > 0 && dispatched >= qty) return 'Fully dispatched';
  if (dispatched > 0) return 'Partially dispatched';
  return 'In progress';
}

// Map MO status text → StatusPill semantic status (drives colour)
function statusKey(label) {
  const s = String(label).toLowerCase();
  if (s.includes('fully')) return 'done';
  if (s.includes('partial')) return 'pending';
  if (s.includes('progress')) return 'in_progress';
  if (s.includes('open')) return 'queued';
  return s;
}

// ── fulfilment tracker: dispatched vs required qty ──
function FulfilmentBar({ dispatched, required }) {
  const req = Number(required) || 0;
  const dis = Number(dispatched) || 0;
  const pct = req > 0 ? Math.min(100, Math.round((dis / req) * 100)) : 0;
  // colour: complete / on track / behind
  let color = 'var(--status-success, #22a06b)';
  let label = 'On track';
  if (req > 0 && dis >= req) {
    color = 'var(--status-success-dark, #1c7a52)';
    label = 'Complete';
  } else if (pct < 50) {
    color = 'var(--status-warning, #d97a2b)';
    label = 'Behind';
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted-2, #7d96bb)' }}>{dis} / {req || '—'} dispatched</span>
        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, color }}>{label}</span>
      </div>
      <div style={{ height: 7, borderRadius: 'var(--radius-pill, 20px)', background: 'var(--bg-soft-green, #e7ece4)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 'var(--radius-pill, 20px)', transition: 'width 0.2s' }} />
      </div>
    </div>
  );
}

// ── UID search picker: server-capped, search-driven (NOT a dump) ──
function UidPicker({ selected, onToggle, mo }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [result, setResult] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);

  const runSearch = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const filters = { limit: PICKER_LIMIT };
      if (search.trim()) filters.search = search.trim();
      if (statusFilter) filters.status = statusFilter;
      if (mo && moSize(mo) !== '—') filters.size = moSize(mo);
      if (mo && moDesign(mo) !== '—') filters.design = moDesign(mo);
      const r = await uidsApi.list(filters);
      if (myReq !== reqIdRef.current) return; // stale response, ignore
      const items = Array.isArray(r.data) ? r.data : r.data?.items || [];
      const total = r.meta?.total ?? r.meta?.count ?? items.length;
      setResult({ items, total });
    } catch (err) {
      if (myReq !== reqIdRef.current) return;
      setError(err.message || 'Could not search UIDs.');
      setResult({ items: [], total: 0 });
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }, [search, statusFilter, mo]);

  // debounce search input
  useEffect(() => {
    const t = setTimeout(runSearch, 250);
    return () => clearTimeout(t);
  }, [runSearch]);

  const { items, total } = result;

  return (
    <div>
      <div style={{ display: 'flex', gap: 9, marginBottom: 11 }}>
        <div style={{ flex: 2, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <Icon name="search" size={14} color="var(--text-muted, #9bb4d4)" />
          </span>
          <input
            className="form-input"
            style={{ height: 38, paddingLeft: 32 }}
            placeholder="search UID by cycle, code…"
            value={search}
            autoComplete="off"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-select"
          style={{ flex: 1, height: 38 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Any status</option>
          <option value="ready">Ready</option>
          <option value="in_progress">In progress</option>
          <option value="hold">On hold</option>
          <option value="done">Done</option>
        </select>
      </div>

      {error ? (
        <ErrorBanner message={error} />
      ) : (
        <>
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted-2, #7d96bb)', marginBottom: 8 }}>
            {loading ? 'searching…' : `showing ${items.length} of ${total}`}
            {total > items.length ? ' · refine search to narrow' : ''}
          </div>

          {!loading && items.length === 0 ? (
            <Empty>No UIDs match this search.</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
              {items.map((u) => {
                const code = u.uidCode || u.uid_code || u.uid || u.code;
                const isSel = selected.includes(code);
                return (
                  <label
                    key={code}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', cursor: 'pointer',
                      border: `1px solid ${isSel ? 'var(--status-blue, #3b82f6)' : 'var(--border-input, #d6e0d2)'}`,
                      borderRadius: 'var(--radius-lg, 11px)',
                      background: isSel ? 'var(--bg-soft-blue, #eaf0f7)' : 'var(--bg-card, #fff)',
                    }}
                  >
                    <input type="checkbox" checked={isSel} onChange={() => onToggle(code)} style={{ accentColor: 'var(--ink-650, #15366a)' }} />
                    <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>{code}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontFamily: MONO, fontSize: 10, color: 'var(--text-muted-2, #7d96bb)' }}>
                      {(u.size || u.size_mm) ? <span>{u.size || u.size_mm}</span> : null}
                      {(u.design || u.design_code) ? <span>· {u.design || u.design_code}</span> : null}
                      {(u.status || u.state) ? <StatusPill status={statusKey(u.status || u.state)} label={u.status || u.state} /> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── MO detail panel: linked UIDs + fulfilment + link picker ──
function MoDetail({ mo, onClose, onLinked }) {
  const { isSupervisor, isManager, isAdmin } = useAuth();
  const canLink = isSupervisor || isManager || isAdmin;

  const [selected, setSelected] = useState([]);
  const [applyMoValues, setApplyMoValues] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [linking, setLinking] = useState(false); // showing the picker

  const linkedUids = Array.isArray(mo.uids) ? mo.uids : mo.linkedUids || mo.linked_uids || [];

  function toggle(code) {
    setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function confirmLink() {
    if (!selected.length) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await mosApi.linkUids(moId(mo), selected, applyMoValues);
      setSuccess(`${selected.length} UID${selected.length > 1 ? 's' : ''} linked to ${moNumber(mo)}.`);
      setSelected([]);
      setLinking(false);
      if (onLinked) onLinked();
    } catch (err) {
      setError(err.message || 'Could not link UIDs.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em', color: 'var(--text-primary, #15366a)' }}>
            {moNumber(mo)}
          </div>
          <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', marginTop: 2 }}>
            {moCustomer(mo)} · {moSize(mo)} · {moDesign(mo)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PriorityBadge priority={moPriority(mo)} />
          <button className="btn btn-sm" onClick={onClose} aria-label="Close detail">
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <FulfilmentBar dispatched={moDispatched(mo)} required={moQty(mo)} />
      </div>

      <div style={{ marginTop: 18 }}>
        <SectionTitle right={<span className="badge" style={{ background: 'rgba(59,130,246,0.14)', color: 'var(--status-blue, #3b82f6)' }}>{linkedUids.length} LINKED</span>}>
          Linked UIDs
        </SectionTitle>
        {linkedUids.length === 0 ? (
          <Empty>No UIDs linked to this MO yet.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
            {linkedUids.map((u, i) => {
              const code = typeof u === 'string' ? u : (u.uidCode || u.uid_code || u.uid || u.code);
              const st = typeof u === 'string' ? null : (u.status || u.state);
              return (
                <div key={code || i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 11px', border: '1px solid var(--border-card, #e3ebde)', borderRadius: 'var(--radius-lg, 11px)', background: 'var(--bg-muted-2, #f6f9f4)' }}>
                  <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>{code}</span>
                  {st ? <StatusPill status={statusKey(st)} label={st} /> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, borderTop: '1px solid var(--border-card, #e3ebde)', paddingTop: 16 }}>
        {error ? <div style={{ marginBottom: 10 }}><ErrorBanner message={error} /></div> : null}
        {success ? <div style={{ marginBottom: 10 }}><SuccessBanner message={success} /></div> : null}

        {!canLink ? (
          <Empty>Linking UIDs requires a supervisor role.</Empty>
        ) : !linking ? (
          <button className="btn btn-primary" onClick={() => { setLinking(true); setSuccess(null); }}>
            <Icon name="link" size={15} color="var(--accent-green, #d4eecb)" /> Link UIDs
          </button>
        ) : (
          <div>
            <SectionTitle>Link UIDs to {moNumber(mo)}</SectionTitle>
            <UidPicker selected={selected} onToggle={toggle} mo={mo} />

            <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 13, cursor: 'pointer', fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)' }}>
              <input type="checkbox" checked={applyMoValues} onChange={(e) => setApplyMoValues(e.target.checked)} style={{ accentColor: 'var(--ink-650, #15366a)' }} />
              Apply this MO's size &amp; design to all selected UIDs
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14 }}>
              <button className="btn btn-primary" disabled={busy || !selected.length} onClick={confirmLink}>
                {busy ? 'Linking…' : `Confirm · Link ${selected.length || ''}`.trim()}
              </button>
              <button className="btn" disabled={busy} onClick={() => { setLinking(false); setSelected([]); }}>Cancel</button>
              {selected.length ? (
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted-2, #7d96bb)' }}>{selected.length} selected</span>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Create MO form ──
function CreateMoForm({ sizes, designs, onCreated }) {
  const { isSupervisor, isManager, isAdmin } = useAuth();
  const canCreate = isSupervisor || isManager || isAdmin;

  const [form, setForm] = useState({
    moNumber: '', customer: '', quantityRequired: '', size: '', design: '',
    priority: 'Normal', deliveryDate: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v, ...(k === 'size' ? { design: '' } : {}) }));
  }

  // designs filtered by selected size
  const filteredDesigns = (designs || []).filter((d) => {
    if (!form.size) return true;
    const ds = d.size || d.sizeMm || d.size_mm;
    return ds == null || String(ds) === String(form.size);
  });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!form.moNumber.trim()) {
      setError('MO number is required.');
      return;
    }
    setBusy(true);
    try {
      await mosApi.create({
        moNumber: form.moNumber.trim(),
        customer: form.customer.trim() || undefined,
        quantityRequired: form.quantityRequired !== '' ? Number(form.quantityRequired) : undefined,
        size: form.size || undefined,
        design: form.design || undefined,
        priority: form.priority,
        deliveryDate: form.deliveryDate || undefined,
        notes: form.notes.trim() || undefined,
      });
      setSuccess(`MO ${form.moNumber.trim()} created.`);
      setForm({ moNumber: '', customer: '', quantityRequired: '', size: '', design: '', priority: 'Normal', deliveryDate: '', notes: '' });
      if (onCreated) onCreated();
    } catch (err) {
      setError(err.message || 'Could not create MO.');
    } finally {
      setBusy(false);
    }
  }

  if (!canCreate) {
    return (
      <div className="card" style={{ padding: '18px 20px' }}>
        <SectionTitle>Create New MO</SectionTitle>
        <Empty>Creating MOs requires a supervisor role.</Empty>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <SectionTitle>Create New MO</SectionTitle>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <div>
          <label className="form-label">MO number (required)</label>
          <input className="form-input" placeholder="from Odoo or manual" value={form.moNumber} autoComplete="off" onChange={(e) => set('moNumber', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Customer name</label>
          <input className="form-input" placeholder="customer" value={form.customer} onChange={(e) => set('customer', e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <div>
            <label className="form-label">Quantity required</label>
            <input className="form-input" type="number" min="0" placeholder="qty" value={form.quantityRequired} onChange={(e) => set('quantityRequired', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Priority</label>
            <select className="form-select" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
              <option value="High">High</option>
              <option value="Normal">Normal</option>
              <option value="Low">Low</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <div>
            <label className="form-label">Size (mm)</label>
            <select className="form-select" value={form.size} onChange={(e) => set('size', e.target.value)}>
              <option value="">Select size</option>
              {(sizes || []).map((s, i) => {
                const v = s.value ?? s.size ?? s.sizeMm ?? s.size_mm ?? s.code ?? s.name ?? s;
                return <option key={s.id ?? v ?? i} value={v}>{v}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="form-label">Design</label>
            <select className="form-select" value={form.design} onChange={(e) => set('design', e.target.value)} disabled={!form.size && (designs || []).length === 0}>
              <option value="">{form.size ? 'Select design' : 'Select size first'}</option>
              {filteredDesigns.map((d, i) => {
                const v = d.value ?? d.design ?? d.code ?? d.designCode ?? d.design_code ?? d.name ?? d;
                return <option key={d.id ?? v ?? i} value={v}>{v}</option>;
              })}
            </select>
          </div>
        </div>
        <div>
          <label className="form-label">Required delivery date (optional)</label>
          <input className="form-input" type="date" value={form.deliveryDate} onChange={(e) => set('deliveryDate', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Notes</label>
          <textarea className="form-input" style={{ height: 56, padding: '8px 13px', resize: 'vertical' }} placeholder="optional notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>

        {error ? <ErrorBanner message={error} /> : null}
        {success ? <SuccessBanner message={success} /> : null}

        <button type="submit" className="btn btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Creating…' : 'Create MO'}
        </button>
      </form>
    </div>
  );
}

export default function MoLinking() {
  const { data, error, loading, refetch } = usePolling(() => mosApi.list().then((r) => r.data), []);

  // master data for the create form (one-shot, not polled)
  const [sizes, setSizes] = useState([]);
  const [designs, setDesigns] = useState([]);
  useEffect(() => {
    let alive = true;
    masterApi.sizes().then((r) => { if (alive) setSizes(Array.isArray(r.data) ? r.data : r.data?.items || []); }).catch(() => {});
    masterApi.designs().then((r) => { if (alive) setDesigns(Array.isArray(r.data) ? r.data : r.data?.items || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const [selectedId, setSelectedId] = useState(null);

  const mos = Array.isArray(data) ? data : data?.items || [];
  const selectedMo = mos.find((m) => String(moId(m)) === String(selectedId)) || null;

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="link" size={22} color="var(--text-primary, #15366a)" />
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
          MO Linking
        </div>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
        Create manufacturing orders and link UIDs at any time{loading && !data ? ' · loading…' : ''}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 20, alignItems: 'start' }}>
        {/* ── LEFT: MO list ── */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionTitle right={<span className="badge" style={{ background: 'rgba(59,130,246,0.14)', color: 'var(--status-blue, #3b82f6)' }}>{mos.length} MOS</span>}>
            Manufacturing Orders
          </SectionTitle>

          {error ? (
            <ErrorBanner message="Could not load manufacturing orders." />
          ) : loading && !data ? (
            <Empty>Loading orders…</Empty>
          ) : mos.length === 0 ? (
            <Empty>No manufacturing orders yet. Create one on the right.</Empty>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', fontFamily: MONO, fontSize: 9, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
                    <th style={{ padding: '6px 8px 8px 0' }}>MO</th>
                    <th style={{ padding: '6px 8px 8px 0' }}>Customer</th>
                    <th style={{ padding: '6px 8px 8px 0', textAlign: 'right' }}>Req</th>
                    <th style={{ padding: '6px 8px 8px 0' }}>Size</th>
                    <th style={{ padding: '6px 8px 8px 0' }}>Design</th>
                    <th style={{ padding: '6px 8px 8px 0' }}>Pri</th>
                    <th style={{ padding: '6px 8px 8px 0' }}>Status</th>
                    <th style={{ padding: '6px 8px 8px 0', textAlign: 'right' }}>Link</th>
                    <th style={{ padding: '6px 8px 8px 0', textAlign: 'right' }}>Disp</th>
                    <th style={{ padding: '6px 8px 8px 0', textAlign: 'right' }}>Rem</th>
                  </tr>
                </thead>
                <tbody>
                  {mos.map((m, i) => {
                    const id = moId(m);
                    const isSel = String(id) === String(selectedId);
                    const qty = Number(moQty(m)) || 0;
                    const disp = Number(moDispatched(m)) || 0;
                    const remaining = Math.max(0, qty - disp);
                    const statusLabel = deriveStatus(m);
                    return (
                      <tr
                        key={id ?? i}
                        onClick={() => setSelectedId(id)}
                        style={{ borderTop: '1px solid #eef2ea', cursor: 'pointer', background: isSel ? 'var(--bg-soft-blue, #eaf0f7)' : 'transparent' }}
                      >
                        <td style={{ padding: '9px 8px 9px 0', fontFamily: MONO, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>{moNumber(m)}</td>
                        <td style={{ padding: '9px 8px', color: 'var(--text-secondary, #5d7188)' }}>{moCustomer(m)}</td>
                        <td style={{ padding: '9px 8px', textAlign: 'right', fontFamily: MONO }}>{qty || '—'}</td>
                        <td style={{ padding: '9px 8px', fontFamily: MONO }}>{moSize(m)}</td>
                        <td style={{ padding: '9px 8px', fontFamily: MONO }}>{moDesign(m)}</td>
                        <td style={{ padding: '9px 8px' }}><PriorityBadge priority={moPriority(m)} /></td>
                        <td style={{ padding: '9px 8px' }}><StatusPill status={statusKey(statusLabel)} label={statusLabel} /></td>
                        <td style={{ padding: '9px 8px', textAlign: 'right', fontFamily: MONO }}>{moLinked(m)}</td>
                        <td style={{ padding: '9px 8px', textAlign: 'right', fontFamily: MONO }}>{disp}</td>
                        <td style={{ padding: '9px 8px 9px 8px', textAlign: 'right', fontFamily: MONO, fontWeight: 600, color: remaining > 0 ? 'var(--text-primary, #15366a)' : 'var(--status-success, #22a06b)' }}>{remaining}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── RIGHT: detail (when MO selected) or create form ── */}
        {selectedMo ? (
          <MoDetail mo={selectedMo} onClose={() => setSelectedId(null)} onLinked={refetch} />
        ) : (
          <CreateMoForm sizes={sizes} designs={designs} onCreated={refetch} />
        )}
      </div>

      {/* When a MO is selected, still surface the create form below so both flows are reachable */}
      {selectedMo ? (
        <div style={{ marginTop: 16, maxWidth: 560 }}>
          <CreateMoForm sizes={sizes} designs={designs} onCreated={refetch} />
        </div>
      ) : null}
    </div>
  );
}
