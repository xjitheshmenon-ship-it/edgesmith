import { useState, useEffect, useCallback } from 'react';
import { adminApi } from '../api/resources';
import { useAuth } from '../store/AuthContext';
import { hexToRgba } from '../components/common/Badges';
import Icon from '../components/common/Icon';

const ARCHIVO = "'Archivo', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', sans-serif";

// ── Field accessors (tolerate snake_case or camelCase from any future API) ──
const f = (o, ...keys) => {
  for (const k of keys) if (o != null && o[k] != null && o[k] !== '') return o[k];
  return undefined;
};

// ── Small presentational helpers (consistent with the rest of the app) ─────
function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
        {children}
      </div>
      {right}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', padding: '14px 0' }}>
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

// Honest, reusable "no endpoint yet" notice for the parts of this page that
// have no API in resources.js. We do NOT invent endpoints — these surfaces
// describe the intended action and stay disabled until the backend lands.
function NotAvailable({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontFamily: SANS, fontSize: 12.5, color: 'var(--status-warning, #d97a2b)', background: 'var(--bg-soft-amber, #fdf6ef)', border: '1px solid var(--bg-soft-amber-2, #f0e2d0)', borderRadius: 'var(--radius-md, 9px)', padding: '10px 12px' }}>
      <Icon name="alert" size={15} color="var(--status-warning, #d97a2b)" />
      <span>{children}</span>
    </div>
  );
}

function Pill({ color, children }) {
  return (
    <span className="badge" style={{ background: hexToRgba(color, 0.14), color }}>
      {children}
    </span>
  );
}

// ── Audit log (REAL — backed by adminApi.auditLog) ─────────────────────────
function AuditLog() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    setRows(null);
    let live = true;
    adminApi
      .auditLog()
      .then((r) => r.data)
      .then((data) => {
        if (!live) return;
        setRows(Array.isArray(data) ? data : data?.items || []);
      })
      .catch((e) => live && setError(e.message || 'Could not load the audit log.'));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  return (
    <>
      <SectionTitle
        right={
          <button className="btn btn-sm" onClick={load} disabled={rows == null && !error}>
            <Icon name="refresh" size={13} color="currentColor" /> Refresh
          </button>
        }
      >
        Recent System Activity
      </SectionTitle>

      {error ? (
        <ErrorBanner message={error} />
      ) : rows == null ? (
        <Empty>Loading audit log…</Empty>
      ) : rows.length === 0 ? (
        <Empty>No audit entries recorded yet.</Empty>
      ) : (
        <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
                <th style={{ padding: '6px 12px 8px 0' }}>When</th>
                <th style={{ padding: '6px 12px 8px 0' }}>Actor</th>
                <th style={{ padding: '6px 12px 8px 0' }}>Action</th>
                <th style={{ padding: '6px 12px 8px 0' }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={f(r, 'id') ?? i} style={{ borderTop: '1px solid #eef2ea' }}>
                  <td style={{ padding: '8px 12px 8px 0', fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary, #5d7188)', whiteSpace: 'nowrap' }}>
                    {f(r, 'created_at', 'createdAt', 'timestamp', 'time') || '—'}
                  </td>
                  <td style={{ padding: '8px 12px 8px 0', color: 'var(--text-primary, #15366a)' }}>
                    {f(r, 'actor', 'username', 'user', 'actor_name') || '—'}
                  </td>
                  <td style={{ padding: '8px 12px 8px 0', fontFamily: MONO, fontSize: 11 }}>
                    {f(r, 'action', 'event', 'type') || '—'}
                  </td>
                  <td style={{ padding: '8px 12px 8px 0', color: 'var(--text-secondary, #5d7188)' }}>
                    {(() => {
                      const d = f(r, 'detail', 'details', 'description', 'message', 'summary');
                      if (d == null) return '—';
                      return typeof d === 'string' ? d : JSON.stringify(d);
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Restore confirmation modal (strong, type-to-confirm) ───────────────────
function RestoreModal({ onClose }) {
  const [phrase, setPhrase] = useState('');
  const ok = phrase.trim().toUpperCase() === 'RESTORE';

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,29,58,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card cp-fade-in"
        style={{ width: '100%', maxWidth: 460, padding: '22px 24px', boxShadow: 'var(--shadow-modal)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ display: 'inline-flex', width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', background: 'rgba(229,72,77,0.12)' }}>
            <Icon name="alert" size={18} color="var(--status-danger, #e5484d)" />
          </span>
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 17, color: 'var(--text-primary, #15366a)' }}>
            Restore from backup
          </div>
        </div>

        <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary, #5d7188)', marginBottom: 14 }}>
          Restoring overwrites the <strong>entire live database</strong> with the contents of the selected
          backup. All UIDs, batches, QC sign-offs and dispatches recorded since that backup will be lost.
          This action cannot be undone.
        </p>

        <NotAvailable>
          Restore endpoint not yet available. Once the backend exposes a restore route, this is where it will be wired in. No data has been changed.
        </NotAvailable>

        <div style={{ marginTop: 14 }}>
          <label className="form-label">Type RESTORE to confirm</label>
          <input
            className="form-input"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="RESTORE"
            autoComplete="off"
            autoFocus
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          {/* Permanently disabled: no restore endpoint exists, and we never invent one. */}
          <button className="btn btn-danger" disabled={!ok} title="Restore endpoint not yet available">
            <Icon name="refresh" size={14} color="currentColor" /> Restore
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function BackupRestore() {
  const { isAdmin } = useAuth();
  const [showRestore, setShowRestore] = useState(false);

  // ── Non-admin gate ──
  if (!isAdmin) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
        <div className="card" style={{ padding: '40px 28px', textAlign: 'center', maxWidth: 520, margin: '40px auto' }}>
          <Icon name="lock" size={28} color="var(--text-muted, #9bb4d4)" />
          <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 18, color: 'var(--text-primary, #15366a)', marginTop: 12 }}>
            Admin access required
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 6 }}>
            Backup &amp; Restore can only be accessed by an administrator.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'inline-flex', width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center', background: 'var(--bg-soft-green, #e7ece4)' }}>
            <Icon name="db" size={20} color="var(--text-primary, #15366a)" />
          </span>
          <div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
              Backup &amp; Restore
            </div>
            <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-secondary, #5d7188)', marginTop: 4 }}>
              Snapshot the system database, restore from a snapshot, and export operational data
            </div>
          </div>
        </div>
        <Pill color="#7a4fc0">ADMIN ONLY</Pill>
      </div>

      {/* Top row: Create backup + Restore */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 18, alignItems: 'start' }}>
        {/* Create backup */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionTitle>Create Backup</SectionTitle>
          <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary, #5d7188)', marginBottom: 14 }}>
            Take a full, point-in-time snapshot of the live database. Snapshots are stored server-side and
            listed below so they can be downloaded or used to restore.
          </p>
          <NotAvailable>
            Backup endpoint not yet available — there is no snapshot route in the API yet. This button stays disabled until the backend exposes one.
          </NotAvailable>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary" disabled title="Backup endpoint not yet available">
              <Icon name="db" size={15} color="currentColor" /> Create Backup Now
            </button>
          </div>
        </div>

        {/* Restore */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionTitle>Restore</SectionTitle>
          <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary, #5d7188)', marginBottom: 14 }}>
            Roll the entire database back to a previous snapshot. This is a destructive, irreversible
            operation and is gated behind an explicit type-to-confirm step.
          </p>
          <NotAvailable>
            Restore endpoint not yet available. The confirmation flow is built and ready to wire in once the backend route exists.
          </NotAvailable>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-danger" onClick={() => setShowRestore(true)}>
              <Icon name="refresh" size={15} color="currentColor" /> Restore from Backup…
            </button>
          </div>
        </div>
      </div>

      {/* Backup history */}
      <div className="card" style={{ marginTop: 16, padding: '18px 20px' }}>
        <SectionTitle>Backup History</SectionTitle>
        {/* No backup-listing endpoint exists in resources.js, so there is nothing
            real to fetch. We show the intended table shape with an honest empty state. */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)' }}>
                <th style={{ padding: '6px 12px 8px 0' }}>Created</th>
                <th style={{ padding: '6px 12px 8px 0' }}>Size</th>
                <th style={{ padding: '6px 12px 8px 0' }}>Created By</th>
                <th style={{ padding: '6px 12px 8px 0' }}>Type</th>
                <th style={{ padding: '6px 0 8px 0', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderTop: '1px solid #eef2ea' }}>
                <td colSpan={5} style={{ padding: '4px 0' }}>
                  <NotAvailable>
                    Backup listing endpoint not yet available. When the backend exposes a backups route, snapshots
                    will appear here with their timestamp, size and download / restore actions.
                  </NotAvailable>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Export data */}
      <div className="card" style={{ marginTop: 16, padding: '18px 20px' }}>
        <SectionTitle>Export Data</SectionTitle>
        <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary, #5d7188)', marginBottom: 14 }}>
          Download operational data as a portable file for archival or external analysis. A dedicated
          system-wide export route is not part of the API yet, so these actions are disabled.
        </p>
        <NotAvailable>
          System export endpoint not yet available. (Note: per-cycle export already exists on the Cycle Builder
          page — this card is for a full operational data export, which has no route yet.)
        </NotAvailable>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          <button className="btn" disabled title="Export endpoint not yet available">
            <Icon name="download" size={15} color="currentColor" /> Export Production Data
          </button>
          <button className="btn" disabled title="Export endpoint not yet available">
            <Icon name="download" size={15} color="currentColor" /> Export Full Database
          </button>
        </div>
      </div>

      {/* Audit log (REAL) */}
      <div className="card" style={{ marginTop: 16, padding: '18px 20px' }}>
        <AuditLog />
      </div>

      {showRestore ? <RestoreModal onClose={() => setShowRestore(false)} /> : null}
    </div>
  );
}
