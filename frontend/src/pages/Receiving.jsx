import { useState, useMemo, useEffect } from 'react';
import { receivingApi, masterApi } from '../api/resources';
import { usePolling } from '../hooks/usePolling';
import { useAuth } from '../store/AuthContext';
import Icon from '../components/common/Icon';
import { StatusPill, LocationBadge } from '../components/common/Badges';

const MONO = "'IBM Plex Mono', monospace";
const ARCHIVO = "'Archivo', sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";

const CONDITIONS = [
  { value: 'good', label: 'Good' },
  { value: 'minor_damage', label: 'Minor damage noted' },
  { value: 'significant_damage', label: 'Significant damage' },
];

// ── small shared bits ──────────────────────────────────────────────────────

function Label({ children, required }) {
  return (
    <label className="form-label">
      {children}
      {required && <span style={{ color: 'var(--status-danger)', marginLeft: 4 }}>*</span>}
    </label>
  );
}

function SectionTitle({ icon, children, sub, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        {icon && <Icon name={icon} size={16} color="var(--text-secondary)" />}
        <div>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>{children}</div>
          {sub && <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>}
        </div>
      </div>
      {right}
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

// ── helpers ─────────────────────────────────────────────────────────────────

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (!data) return [];
  return data.items || data.rows || data.events || data.dispatches || [];
}

function fmtDate(ts) {
  if (!ts) return '—';
  const s = String(ts);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function dispatchId(d) {
  return d?.id ?? d?.dispatch_id ?? d?.receiving_id;
}

function dispatchRef(d) {
  return d?.faridabad_batch_ref || d?.batch_ref || d?.dispatch_ref || d?.ref || d?.reference || (dispatchId(d) != null ? `FBD-${dispatchId(d)}` : '—');
}

function expectedColor(d) {
  return d?.color_code || d?.expected_color_code || d?.colour_code || d?.color || '';
}

function dispatchTotals(d) {
  const total = d?.billets_dispatched ?? d?.total_billets ?? d?.billets_total ?? d?.billet_count ?? d?.billets ?? null;
  const received = d?.billets_received ?? d?.received_so_far ?? d?.received ?? 0;
  const remaining = d?.billets_remaining ?? d?.remaining ?? (total != null ? total - received : null);
  return { total, received, remaining };
}

function conditionLabel(v) {
  return CONDITIONS.find((c) => c.value === v)?.label || v || '—';
}

function normColor(v) {
  return String(v || '').trim().toLowerCase();
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function Receiving() {
  const { user } = useAuth();

  // Expected consignments (in-transit from Faridabad, not fully received)
  const expected = usePolling(() => receivingApi.expected().then((r) => r.data), [], { interval: 30000 });
  // Receiving log
  const log = usePolling(() => receivingApi.list().then((r) => r.data), [], { interval: 30000 });
  // Color-code master list for the received-color dropdown
  const colorRef = usePolling(() => masterApi.colorCodes().then((r) => r.data).catch(() => []), [], { interval: 120000 });

  const expectedRows = asArray(expected.data);
  const logRows = asArray(log.data);
  const colorCodes = asArray(colorRef.data);

  const [selected, setSelected] = useState(null); // selected dispatch (prefills form)
  const [detailId, setDetailId] = useState(null); // receiving event being inspected

  function selectDispatch(d) {
    setSelected(d);
    if (typeof document !== 'undefined') {
      // scroll the form into view on small screens
      const el = document.getElementById('rcv-form');
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function onSaved() {
    expected.refetch();
    log.refetch();
    setSelected(null);
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="truck" size={20} color="var(--text-primary)" />
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>Receiving</div>
            <LocationBadge location="dharmapuri" />
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            Log rolled composite billets arriving from Faridabad. Each delivery is matched to its dispatch by colour code before it is recorded.
          </div>
        </div>
      </div>

      {/* Expected consignments */}
      <div style={{ marginTop: 22 }}>
        <ExpectedPanel
          rows={expectedRows}
          loading={expected.loading && !expected.data}
          error={expected.error}
          selectedId={selected ? dispatchId(selected) : null}
          onSelect={selectDispatch}
        />
      </div>

      {/* Receiving form */}
      <div id="rcv-form" style={{ marginTop: 18 }}>
        <ReceivingForm
          dispatch={selected}
          dispatches={expectedRows}
          colorCodes={colorCodes}
          operatorName={user?.name || user?.full_name || user?.username || ''}
          onClear={() => setSelected(null)}
          onPickDispatch={(d) => setSelected(d)}
          onSaved={onSaved}
        />
      </div>

      {/* Receiving log */}
      <div style={{ marginTop: 18 }}>
        <ReceivingLog
          rows={logRows}
          loading={log.loading && !log.data}
          error={log.error}
          onOpen={(id) => setDetailId(id)}
        />
      </div>

      {detailId != null && <DetailDrawer id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

// ── EXPECTED CONSIGNMENTS PANEL ───────────────────────────────────────────────

function ExpectedPanel({ rows, loading, error, selectedId, onSelect }) {
  const cols = ['Dispatch date', 'Contractor', 'Faridabad batch refs', 'Colour code', 'Dispatched', 'Received', 'Remaining', ''];
  return (
    <div className="card" style={{ padding: 22 }}>
      <SectionTitle icon="inbox" sub="Dispatches from Faridabad still in transit or only partially received. Click a row to pre-fill the receiving form.">
        Expected consignments
      </SectionTitle>
      <ErrorBanner error={error} />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead>
            <tr>{cols.map((c, i) => <th key={i} style={thStyle}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <EmptyRow colSpan={cols.length}>Loading expected consignments…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={cols.length}>No consignments in transit — everything dispatched from Faridabad has been received.</EmptyRow>
            ) : (
              rows.map((d) => {
                const id = dispatchId(d);
                const { total, received, remaining } = dispatchTotals(d);
                const color = expectedColor(d);
                const isSel = selectedId != null && String(selectedId) === String(id);
                return (
                  <tr
                    key={id}
                    onClick={() => onSelect(d)}
                    style={{ borderTop: '1px solid var(--border-card)', cursor: 'pointer', background: isSel ? 'var(--bg-soft-blue-2)' : 'transparent' }}
                  >
                    <td style={{ ...tdStyle, fontFamily: MONO }}>{fmtDate(d.dispatch_date || d.dispatched_at || d.date)}</td>
                    <td style={tdStyle}>{d.contractor || d.rolling_contractor || d.contractor_name || '—'}</td>
                    <td style={{ ...tdStyle, fontFamily: MONO, fontWeight: 600 }}>{dispatchRef(d)}</td>
                    <td style={tdStyle}>{color ? <ColorChip code={color} /> : '—'}</td>
                    <td style={{ ...tdStyle, fontFamily: MONO }}>{total ?? '—'}</td>
                    <td style={{ ...tdStyle, fontFamily: MONO }}>{received ?? 0}</td>
                    <td style={{ ...tdStyle, fontFamily: MONO, fontWeight: 700, color: remaining > 0 ? 'var(--status-warning)' : 'var(--text-primary)' }}>
                      {remaining ?? '—'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); onSelect(d); }}>
                        <Icon name="download" size={13} /> Receive
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ColorChip({ code }) {
  const swatch = /^#|^rgb/i.test(String(code)) ? code : undefined;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 11.5, fontWeight: 600 }}>
      <span style={{ width: 11, height: 11, borderRadius: 3, border: '1px solid var(--border-muted)', background: swatch || 'var(--bg-muted)' }} />
      {code}
    </span>
  );
}

// ── RECEIVING FORM (with colour-match check + mismatch confirmation) ───────────

function ReceivingForm({ dispatch, dispatches, colorCodes, operatorName, onClear, onPickDispatch, onSaved }) {
  const expColor = expectedColor(dispatch);
  const { remaining } = dispatchTotals(dispatch || {});

  const [dateReceived, setDateReceived] = useState(() => new Date().toISOString().slice(0, 10));
  const [billets, setBillets] = useState('');
  const [receivedColor, setReceivedColor] = useState('');
  const [condition, setCondition] = useState('good');
  const [receivedBy, setReceivedBy] = useState(operatorName || '');
  const [receivedByTouched, setReceivedByTouched] = useState(false);
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // mismatch confirmation flow state
  const [mismatch, setMismatch] = useState(null); // { receivingId, expected, received }
  const [mismatchNote, setMismatchNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  // keep operator name in sync when it loads after first render, unless user typed
  useEffect(() => {
    if (!receivedByTouched && operatorName) setReceivedBy(operatorName);
  }, [operatorName, receivedByTouched]);

  const damage = condition === 'minor_damage' || condition === 'significant_damage';
  const billetsNum = Number(billets);

  const colorMatch = useMemo(() => {
    if (!expColor || !receivedColor) return null;
    return normColor(expColor) === normColor(receivedColor);
  }, [expColor, receivedColor]);

  const formValid =
    dispatch &&
    dateReceived &&
    billetsNum > 0 &&
    receivedColor &&
    receivedBy.trim() &&
    (!damage || notes.trim());

  function reset() {
    setBillets('');
    setReceivedColor('');
    setCondition('good');
    setNotes('');
    setMismatch(null);
    setMismatchNote('');
  }

  async function submit() {
    setError(null);
    setSuccess(null);
    if (!dispatch) { setError({ message: 'Select a Faridabad dispatch first.' }); return; }
    if (!formValid) {
      setError({ message: damage && !notes.trim()
        ? 'Damage was recorded — notes describing the damage are required.'
        : 'Complete all required fields (date, billet count, received colour code, received by).' });
      return;
    }
    if (remaining != null && billetsNum > remaining) {
      setError({ message: `This delivery (${billetsNum}) exceeds the ${remaining} billets still in transit for this dispatch.` });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        location: 'dharmapuri',
        dispatch_id: dispatchId(dispatch),
        faridabad_batch_ref: dispatchRef(dispatch),
        date_received: dateReceived,
        billets_received: billetsNum,
        received_color_code: receivedColor,
        expected_color_code: expColor || undefined,
        color_match: colorMatch === null ? undefined : colorMatch,
        condition,
        received_by: receivedBy.trim(),
        notes: notes.trim() || undefined,
      };
      const res = await receivingApi.create(payload);
      const event = res.data || {};
      const newId = event.id ?? event.receiving_id;

      // Colour-mismatch CONFIRMATION flow: the received colour does not match the
      // expected colour from the Faridabad dispatch → the receiver must explicitly
      // confirm the discrepancy with a note before the event is finalised.
      const serverFlagged = event.color_mismatch === true || event.status === 'mismatch_pending' || event.requires_mismatch_confirmation === true;
      if (serverFlagged || colorMatch === false) {
        setMismatch({ receivingId: newId, expected: expColor, received: receivedColor, event });
        setMismatchNote('');
        return; // stay in flow — do not reset until confirmed
      }

      setSuccess(event);
      reset();
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmMismatch() {
    if (!mismatch?.receivingId) {
      // event wasn't created (server rejected) — can't confirm
      setError({ message: 'No receiving event reference to confirm against.' });
      return;
    }
    if (!mismatchNote.trim()) {
      setError({ message: 'A note explaining the colour discrepancy is required to confirm.' });
      return;
    }
    setError(null);
    setConfirming(true);
    try {
      // NOTE: receivingApi.confirmMismatch(id) in api/resources.js currently takes
      // only the id (PATCH with no body). The discrepancy note is collected and
      // sent as a second arg so it travels the moment the api helper accepts a body;
      // until then the note is enforced client-side as a required confirmation gate.
      const res = await receivingApi.confirmMismatch(mismatch.receivingId, mismatchNote.trim());
      setSuccess(res.data || mismatch.event || { id: mismatch.receivingId });
      setMismatch(null);
      setMismatchNote('');
      reset();
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setConfirming(false);
    }
  }

  function cancelMismatch() {
    // Discard the in-flow mismatch without confirming. The receiving event was
    // already created server-side and remains pending confirmation in the log.
    setMismatch(null);
    setMismatchNote('');
    onSaved();
  }

  return (
    <div className="card" style={{ padding: 22 }}>
      <SectionTitle
        icon="download"
        sub="One Faridabad batch can arrive across several receiving events over time."
        right={dispatch ? (
          <button className="btn btn-sm" onClick={() => { onClear(); reset(); }}>
            <Icon name="close" size={13} /> Clear selection
          </button>
        ) : null}
      >
        Record receiving event
      </SectionTitle>

      <ErrorBanner error={error} onClose={() => setError(null)} />

      {success && !mismatch && (
        <SavedSummary event={success} />
      )}

      {/* dispatch picker (if nothing selected from the panel above) */}
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <Label required>Faridabad dispatch reference</Label>
          <select
            className="form-select"
            value={dispatch ? String(dispatchId(dispatch)) : ''}
            onChange={(e) => {
              const d = dispatches.find((x) => String(dispatchId(x)) === e.target.value);
              onPickDispatch(d || null);
              setSuccess(null);
            }}
          >
            <option value="">Select a dispatch in transit…</option>
            {dispatches.map((d) => {
              const id = dispatchId(d);
              const { remaining: rem } = dispatchTotals(d);
              return (
                <option key={id} value={id}>
                  {dispatchRef(d)} · {d.contractor || d.rolling_contractor || 'contractor'}{rem != null ? ` · ${rem} billets remaining` : ''}
                </option>
              );
            })}
          </select>
          {dispatches.length === 0 && (
            <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>No dispatches awaiting receipt.</div>
          )}
        </div>

        {dispatch && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, padding: 14, borderRadius: 'var(--radius-lg)', background: 'var(--bg-muted)', border: '1px solid var(--border-card)' }}>
            <Field k="Rolling contractor" v={dispatch.contractor || dispatch.rolling_contractor || dispatch.contractor_name || '—'} />
            <Field k="Faridabad batch" v={dispatchRef(dispatch)} mono />
            <Field k="Expected colour code" v={expColor || '—'} mono />
            <Field k="Remaining in transit" v={remaining != null ? `${remaining} billets` : '—'} mono />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <Label required>Date received</Label>
            <input className="form-input" type="date" value={dateReceived} onChange={(e) => setDateReceived(e.target.value)} />
          </div>
          <div>
            <Label required>Billets in this delivery</Label>
            <input className="form-input" type="number" min="1" placeholder="e.g. 12" value={billets} onChange={(e) => setBillets(e.target.value)} />
          </div>
        </div>

        {/* COLOUR-MATCH CHECK */}
        <div>
          <Label required>Received colour code</Label>
          <select className="form-select" value={receivedColor} onChange={(e) => setReceivedColor(e.target.value)}>
            <option value="">Select the colour code on the arriving billets…</option>
            {expColor && !colorCodes.some((c) => normColor(c.code || c.name || c) === normColor(expColor)) && (
              <option value={expColor}>{expColor} (expected)</option>
            )}
            {colorCodes.map((c, i) => {
              const code = c.code || c.name || c.color_code || String(c);
              return <option key={i} value={code}>{code}{normColor(code) === normColor(expColor) ? ' (expected)' : ''}</option>;
            })}
          </select>
          <ColorMatchBanner match={colorMatch} expected={expColor} received={receivedColor} />
        </div>

        <div>
          <Label required>Condition on arrival</Label>
          <select className="form-select" value={condition} onChange={(e) => setCondition(e.target.value)}>
            {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div>
          <Label required>Received by</Label>
          <input className="form-input" placeholder="Operator name" value={receivedBy} onChange={(e) => { setReceivedByTouched(true); setReceivedBy(e.target.value); }} />
        </div>

        <div>
          <Label required={damage}>{damage ? 'Notes (damage details required)' : 'Notes (optional)'}</Label>
          <textarea
            className="form-input"
            style={{ height: 76, padding: '10px 13px', resize: 'vertical' }}
            placeholder={damage ? 'Describe the damage observed on arrival…' : 'Any observations about this delivery…'}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={submit} disabled={submitting || !formValid || !!mismatch}>
            <Icon name="check" size={15} />
            {submitting ? 'Recording…' : 'Record receiving event'}
          </button>
          {colorMatch === false && !mismatch && (
            <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--status-danger-dark)' }}>
              Colour mismatch — recording will require an explicit confirmation.
            </span>
          )}
        </div>
      </div>

      {/* COLOUR-MISMATCH CONFIRMATION MODAL */}
      {mismatch && (
        <MismatchConfirm
          mismatch={mismatch}
          note={mismatchNote}
          onNote={setMismatchNote}
          confirming={confirming}
          onConfirm={confirmMismatch}
          onCancel={cancelMismatch}
        />
      )}
    </div>
  );
}

function Field({ k, v, mono }) {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 3 }}>{k}</div>
      <div style={{ fontFamily: mono ? MONO : SANS, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{v}</div>
    </div>
  );
}

function ColorMatchBanner({ match, expected, received }) {
  if (match === null) return null;
  if (match) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(34,160,107,0.10)', border: '1px solid rgba(34,160,107,0.30)' }}>
        <Icon name="check" size={14} color="var(--status-success)" />
        <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--status-success-dark)' }}>
          Colour code matches the Faridabad dispatch (<b style={{ fontFamily: MONO }}>{expected}</b>).
        </span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(229,72,77,0.10)', border: '1px solid rgba(229,72,77,0.30)' }}>
      <Icon name="alert" size={14} color="var(--status-danger)" />
      <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--status-danger-dark)' }}>
        Colour mismatch — expected <b style={{ fontFamily: MONO }}>{expected || '—'}</b>, received <b style={{ fontFamily: MONO }}>{received}</b>. This discrepancy must be confirmed.
      </span>
    </div>
  );
}

function MismatchConfirm({ mismatch, note, onNote, confirming, onConfirm, onCancel }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,29,58,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}
      className="cp-fade-in"
    >
      <div className="card" style={{ width: 'min(520px, 100%)', padding: 24, boxShadow: 'var(--shadow-modal)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Icon name="alert" size={20} color="var(--status-danger)" />
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 17, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Confirm colour discrepancy
          </div>
        </div>

        <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
          The colour code on the arriving billets does not match the Faridabad dispatch record. This indicates the wrong material may have arrived. Confirm only if you have physically verified the discrepancy.
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--bg-muted)', border: '1px solid var(--border-card)' }}>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Expected</div>
            <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginTop: 3 }}>{mismatch.expected || '—'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Icon name="chevronRight" size={16} color="var(--text-muted)" />
          </div>
          <div style={{ flex: 1, padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(229,72,77,0.08)', border: '1px solid rgba(229,72,77,0.30)' }}>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--status-danger-dark)' }}>Received</div>
            <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: 'var(--status-danger-dark)', marginTop: 3 }}>{mismatch.received || '—'}</div>
          </div>
        </div>

        {mismatch.receivingId != null && (
          <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Receiving event <span style={{ fontFamily: MONO, fontWeight: 600 }}>{mismatch.event?.ref || mismatch.event?.reference || mismatch.receivingId}</span> was created and is awaiting this confirmation.
          </div>
        )}

        <Label required>Discrepancy note</Label>
        <textarea
          className="form-input"
          style={{ height: 84, padding: '10px 13px', resize: 'vertical' }}
          placeholder="Explain the colour discrepancy and any action taken (e.g. supervisor notified, quarantined for inspection)…"
          value={note}
          onChange={(e) => onNote(e.target.value)}
          autoFocus
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button className="btn" onClick={onCancel} disabled={confirming}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={confirming || !note.trim()}>
            <Icon name="check" size={15} />
            {confirming ? 'Confirming…' : 'Confirm discrepancy'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SavedSummary({ event }) {
  const ref = event.ref || event.reference || event.receiving_ref || (event.id ?? event.receiving_id);
  const alloy = event.alloy_steel || event.alloy || {};
  const ms = event.ms || event.ms_steel || {};
  const { remaining } = dispatchTotals(event);
  return (
    <div style={{ padding: '14px 16px', borderRadius: 'var(--radius-lg)', background: 'rgba(34,160,107,0.08)', border: '1px solid rgba(34,160,107,0.30)', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <Icon name="check" size={16} color="var(--status-success)" />
        <span style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 14, color: 'var(--status-success-dark)' }}>Receiving event saved</span>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{ref}</span>
        {event.status && <StatusPill status={event.status} />}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <Field k="Faridabad batch" v={event.faridabad_batch_ref || dispatchRef(event)} mono />
        <Field k="Rolling contractor" v={event.contractor || event.rolling_contractor || '—'} />
        <Field k="Billets received" v={event.billets_received ?? event.billet_count ?? '—'} mono />
        <Field k="Condition" v={conditionLabel(event.condition)} />
        <Field k="Alloy steel" v={[alloy.supplier, alloy.heat_number || alloy.heat, alloy.grade].filter(Boolean).join(' · ') || '—'} />
        <Field k="MS" v={[ms.supplier, ms.heat_number || ms.heat, ms.grade].filter(Boolean).join(' · ') || '—'} />
        {remaining != null && <Field k="Remaining in transit" v={`${remaining} billets`} mono />}
      </div>
    </div>
  );
}

// ── RECEIVING LOG ─────────────────────────────────────────────────────────────

function ReceivingLog({ rows, loading, error, onOpen }) {
  const cols = ['Date', 'Receiving ref', 'Faridabad batch', 'Contractor', 'Billets', 'Colour', 'Condition', 'Status'];
  return (
    <div className="card" style={{ padding: 22 }}>
      <SectionTitle icon="list" sub="All receiving events. Click a row for full detail and the UIDs created from it.">
        Receiving log
      </SectionTitle>
      <ErrorBanner error={error} />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
          <thead>
            <tr>{cols.map((c) => <th key={c} style={thStyle}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <EmptyRow colSpan={cols.length}>Loading receiving log…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={cols.length}>No receiving events recorded yet.</EmptyRow>
            ) : (
              rows.map((e, i) => {
                const id = e.id ?? e.receiving_id ?? i;
                const isMismatch = e.color_mismatch === true || e.status === 'mismatch_pending';
                return (
                  <tr
                    key={id}
                    onClick={() => onOpen(id)}
                    style={{ borderTop: '1px solid var(--border-card)', cursor: 'pointer' }}
                  >
                    <td style={{ ...tdStyle, fontFamily: MONO }}>{fmtDate(e.date_received || e.date || e.received_at)}</td>
                    <td style={{ ...tdStyle, fontFamily: MONO, fontWeight: 600 }}>{e.ref || e.reference || e.receiving_ref || id}</td>
                    <td style={{ ...tdStyle, fontFamily: MONO }}>{e.faridabad_batch_ref || dispatchRef(e)}</td>
                    <td style={tdStyle}>{e.contractor || e.rolling_contractor || '—'}</td>
                    <td style={{ ...tdStyle, fontFamily: MONO }}>{e.billets_received ?? e.billet_count ?? '—'}</td>
                    <td style={tdStyle}>
                      {e.received_color_code || e.color_code ? <ColorChip code={e.received_color_code || e.color_code} /> : '—'}
                      {isMismatch && <span className="badge" style={{ background: 'rgba(229,72,77,0.14)', color: 'var(--status-danger-dark)', marginLeft: 6 }}>MISMATCH</span>}
                    </td>
                    <td style={tdStyle}>{conditionLabel(e.condition)}</td>
                    <td style={tdStyle}><StatusPill status={e.status || 'pending'} label={statusLabel(e.status)} /></td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function statusLabel(status) {
  const map = {
    awaiting_bsw01: 'Awaiting BSW-01',
    in_production: 'In production',
    complete: 'Complete',
    mismatch_pending: 'Mismatch pending',
  };
  return map[status] || undefined;
}

// ── DETAIL DRAWER ─────────────────────────────────────────────────────────────

function DetailDrawer({ id, onClose }) {
  const { data, loading, error } = usePolling(() => receivingApi.detail(id).then((r) => r.data), [id], { interval: 60000 });
  const ev = data || {};
  const alloy = ev.alloy_steel || ev.alloy || {};
  const ms = ev.ms || ev.ms_steel || {};
  const uids = asArray(ev.uids || ev.uid_codes || ev.created_uids);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(10,29,58,0.40)' }} />
      <div className="card cp-fade-in" style={{ position: 'relative', width: 'min(460px, 100%)', height: '100%', borderRadius: 0, padding: 24, overflowY: 'auto', boxShadow: 'var(--shadow-drawer)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 17, color: 'var(--text-primary)' }}>Receiving event detail</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', display: 'flex' }}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <ErrorBanner error={error} />
        {loading && !data ? (
          <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary)', padding: '20px 0' }}>Loading…</div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700 }}>{ev.ref || ev.reference || ev.receiving_ref || id}</span>
              {ev.status && <StatusPill status={ev.status} label={statusLabel(ev.status)} />}
              {(ev.color_mismatch === true || ev.status === 'mismatch_pending') && (
                <span className="badge" style={{ background: 'rgba(229,72,77,0.14)', color: 'var(--status-danger-dark)' }}>COLOUR MISMATCH</span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 14, borderRadius: 'var(--radius-lg)', background: 'var(--bg-muted)', border: '1px solid var(--border-card)' }}>
              <Field k="Date received" v={fmtDate(ev.date_received || ev.date)} mono />
              <Field k="Faridabad batch" v={ev.faridabad_batch_ref || dispatchRef(ev)} mono />
              <Field k="Rolling contractor" v={ev.contractor || ev.rolling_contractor || '—'} />
              <Field k="Billets received" v={ev.billets_received ?? ev.billet_count ?? '—'} mono />
              <Field k="Expected colour" v={ev.expected_color_code || '—'} mono />
              <Field k="Received colour" v={ev.received_color_code || ev.color_code || '—'} mono />
              <Field k="Condition" v={conditionLabel(ev.condition)} />
              <Field k="Received by" v={ev.received_by || '—'} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field k="Alloy steel" v={[alloy.supplier, alloy.heat_number || alloy.heat, alloy.grade].filter(Boolean).join(' · ') || '—'} />
              <Field k="MS" v={[ms.supplier, ms.heat_number || ms.heat, ms.grade].filter(Boolean).join(' · ') || '—'} />
            </div>

            {(ev.notes || ev.mismatch_note) && (
              <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--bg-muted)', border: '1px solid var(--border-card)' }}>
                <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 4 }}>Notes</div>
                {ev.notes && <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-primary)' }}>{ev.notes}</div>}
                {ev.mismatch_note && <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--status-danger-dark)', marginTop: 6 }}>Discrepancy: {ev.mismatch_note}</div>}
              </div>
            )}

            <div>
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8 }}>
                UIDs created from this event ({uids.length})
              </div>
              {uids.length === 0 ? (
                <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-secondary)' }}>No UIDs created yet — this event is awaiting BSW-01.</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {uids.map((u, i) => (
                    <span key={i} className="badge" style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', fontFamily: MONO }}>
                      {typeof u === 'string' ? u : (u.code || u.uid)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
