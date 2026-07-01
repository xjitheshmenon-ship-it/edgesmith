import { useState, useEffect, useMemo, useRef } from 'react';
import { importApi } from '../api/resources';
import { useAuth } from '../store/AuthContext';
import { useApp } from '../store/AppContext';
import Icon from '../components/common/Icon';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

// Fallback column templates (also served by GET /imports/templates).
const FALLBACK = {
  dharmapuri: {
    columns: ['uid_code', 'step_number', 'operator_username', 'started_at', 'closed_at', 'qc_result', 'qc_value', 'notes'],
    sample: ['E00042', '5', 'operator', '2026-07-01 09:05', '2026-07-01 09:35', '', '', 'logged offline'],
  },
  faridabad: {
    columns: ['item_id', 'step_number', 'operator_username', 'started_at', 'closed_at', 'notes'],
    sample: ['12', '3', 'supervisor_far', '2026-07-01 10:00', '2026-07-01 10:20', 'logged offline'],
  },
};

const FACTORY_LABEL = { dharmapuri: 'Dharmapuri (UID jobs)', faridabad: 'Faridabad (batch items)' };

/* Minimal RFC-4180-ish CSV parser: handles quotes, escaped quotes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { headers: [], objects: [] };
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const objects = rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i] !== undefined ? r[i].trim() : ''; });
    return o;
  });
  return { headers, objects };
}

function toCsv(columns, sample) {
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [columns.join(','), (sample || []).map(esc).join(',')].join('\n') + '\n';
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const STATUS_COLOR = {
  ok: { fg: 'var(--status-success-dark, #1c7a52)', bg: 'rgba(34,160,107,0.12)' },
  error: { fg: 'var(--status-danger, #e5484d)', bg: 'rgba(229,72,77,0.1)' },
};

export default function DataImport() {
  const { isSupervisor, isManager, isAdmin } = useAuth();
  const canImport = isSupervisor || isManager || isAdmin;
  const app = useApp();

  const [factory, setFactory] = useState(app?.location === 'faridabad' ? 'faridabad' : 'dharmapuri');
  const [templates, setTemplates] = useState(FALLBACK);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [preview, setPreview] = useState(null);
  const [applied, setApplied] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    importApi.templates().then((r) => { if (r?.data) setTemplates(r.data); }).catch(() => {});
  }, []);

  const tpl = templates[factory] || FALLBACK[factory];

  function reset() {
    setRows([]); setPreview(null); setApplied(null); setError(null); setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  }

  useEffect(() => { reset(); }, [factory]);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPreview(null); setApplied(null); setError(null);
    const text = await file.text();
    const { objects } = csvToObjects(text);
    if (!objects.length) { setError('No data rows found in the CSV.'); setRows([]); return; }
    setRows(objects);
    runPreview(objects);
  }

  async function runPreview(objs) {
    setBusy(true); setError(null); setApplied(null);
    try {
      const res = await importApi.preview(factory, objs);
      setPreview(res.data);
    } catch (err) {
      setError(err.message || 'Preview failed.');
    } finally { setBusy(false); }
  }

  async function runApply() {
    setBusy(true); setError(null);
    try {
      const res = await importApi.apply(factory, rows);
      setApplied(res.data);
      setPreview(res.data); // apply returns the same per-row shape
    } catch (err) {
      setError(err.message || 'Apply failed.');
    } finally { setBusy(false); }
  }

  const summary = preview?.summary;
  const okCount = summary?.ok || 0;

  if (!canImport) {
    return (
      <div style={{ padding: '28px' }}>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, color: 'var(--text-primary, #15366a)' }}>Data Import</div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 8 }}>
          Importing requires a supervisor, manager or admin role.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="download" size={22} color="var(--text-primary, #15366a)" />
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
          Offline Data Import
        </div>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4, maxWidth: 720 }}>
        When the server or internet was down, staff record completed operations on paper or a spreadsheet. Export that to CSV
        and import it here to back-fill the system — each row logs the operation and advances the job to its next step.
        Rows are validated first (preview); nothing is written until you confirm.
      </div>

      {/* Factory selector */}
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        {['dharmapuri', 'faridabad'].map((f) => (
          <button key={f} onClick={() => setFactory(f)}
            style={{
              padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontFamily: MONO, fontSize: 11, letterSpacing: '0.04em',
              border: factory === f ? '1px solid var(--accent, #15366a)' : '1px solid var(--border, #d8e0ea)',
              background: factory === f ? 'var(--accent, #15366a)' : 'transparent',
              color: factory === f ? '#fff' : 'var(--text-secondary, #5d7188)', fontWeight: factory === f ? 700 : 400,
            }}>
            {FACTORY_LABEL[f].toUpperCase()}
          </button>
        ))}
      </div>

      {/* Template + upload card */}
      <div className="card" style={{ padding: '18px 20px', marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 14, color: 'var(--text-primary, #15366a)' }}>1 · Get the template</div>
            <div style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--text-secondary, #5d7188)', marginTop: 6 }}>
              Columns: {tpl.columns.join(', ')}
            </div>
          </div>
          <button onClick={() => download(`${factory}-operations-template.csv`, toCsv(tpl.columns, tpl.sample))}
            className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Icon name="download" size={15} /> Download {factory} template
          </button>
        </div>

        <div style={{ height: 1, background: 'var(--border, #e6ecf3)', margin: '16px 0' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 14, color: 'var(--text-primary, #15366a)' }}>2 · Upload the filled CSV</div>
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
              {fileName ? `Loaded: ${fileName} — ${rows.length} row${rows.length === 1 ? '' : 's'}` : 'Choose a .csv file to validate.'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: 'none' }} id="csv-file" />
            <label htmlFor="csv-file" className="btn btn-primary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Icon name="inbox" size={15} /> Choose CSV
            </label>
            {(preview || fileName) && <button onClick={reset} className="btn btn-secondary">Clear</button>}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 16, fontFamily: SANS, fontSize: 13, color: STATUS_COLOR.error.fg, background: STATUS_COLOR.error.bg, border: '1px solid rgba(229,72,77,0.25)', borderRadius: 9, padding: '10px 12px' }}>
          {error}
        </div>
      )}

      {applied && (
        <div style={{ marginTop: 16, fontFamily: SANS, fontSize: 13, color: STATUS_COLOR.ok.fg, background: STATUS_COLOR.ok.bg, border: '1px solid rgba(34,160,107,0.25)', borderRadius: 9, padding: '10px 12px' }}>
          Applied {applied.applied} of {applied.summary.total} rows. {applied.summary.errors > 0 ? `${applied.summary.errors} row(s) skipped with errors.` : 'All valid rows imported.'}
        </div>
      )}

      {/* Preview / results */}
      {preview && (
        <div className="card" style={{ padding: 0, marginTop: 16, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', borderBottom: '1px solid var(--border, #e6ecf3)', background: 'var(--surface-2, #f5f8fc)' }}>
            <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 13, color: 'var(--text-primary, #15366a)' }}>
              {applied ? 'Import result' : 'Preview'} — {summary.total} rows
            </span>
            <Chip color={STATUS_COLOR.ok} label={`${okCount} valid`} />
            {summary.errors > 0 && <Chip color={STATUS_COLOR.error} label={`${summary.errors} error`} />}
            {summary.warnings > 0 && <span style={{ fontFamily: MONO, fontSize: 11, color: '#b7791f' }}>{summary.warnings} warning</span>}
            <div style={{ flex: 1 }} />
            {!applied && (
              <button onClick={runApply} disabled={busy || okCount === 0} className="btn btn-primary"
                style={{ opacity: busy || okCount === 0 ? 0.5 : 1 }}>
                {busy ? 'Working…' : `Apply ${okCount} valid row${okCount === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
          <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-secondary, #5d7188)', fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.06em' }}>
                  <th style={{ padding: '8px 14px', width: 50 }}>LINE</th>
                  <th style={{ padding: '8px 14px', width: 110 }}>REF</th>
                  <th style={{ padding: '8px 14px', width: 90 }}>STATUS</th>
                  <th style={{ padding: '8px 14px' }}>DETAIL</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => {
                  const c = STATUS_COLOR[r.status] || STATUS_COLOR.error;
                  return (
                    <tr key={r.line} style={{ borderTop: '1px solid var(--border, #eef2f7)' }}>
                      <td style={{ padding: '8px 14px', fontFamily: MONO, color: 'var(--text-secondary, #5d7188)' }}>{r.line}</td>
                      <td style={{ padding: '8px 14px', fontFamily: MONO, fontWeight: 600, color: 'var(--text-primary, #15366a)' }}>{r.ref || '—'}</td>
                      <td style={{ padding: '8px 14px' }}>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontFamily: MONO, fontSize: 10, fontWeight: 700, color: c.fg, background: c.bg }}>
                          {r.status === 'ok' ? (r.action || 'OK').toUpperCase() : 'ERROR'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 14px', color: r.status === 'error' ? STATUS_COLOR.error.fg : 'var(--text-secondary, #5d7188)' }}>
                        {r.message}{r.warn ? ` · ⚠ ${r.warn}` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ color, label }) {
  return (
    <span style={{ padding: '2px 9px', borderRadius: 20, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, fontWeight: 700, color: color.fg, background: color.bg }}>
      {label}
    </span>
  );
}
