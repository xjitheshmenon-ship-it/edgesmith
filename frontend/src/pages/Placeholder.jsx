import { routeTitle } from '../components/layout/nav';

/* Temporary stand-in for content pages not yet rebuilt on the handoff
   foundation. Keeps every route navigable while the pages are built out. */
export default function Placeholder({ routeKey }) {
  const title = routeTitle(routeKey || '');
  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 720 }}>
      <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--text-primary, #15366a)' }}>
        {title}
      </div>
      <div className="card" style={{ marginTop: 22, padding: '24px 22px' }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted, #9bb4d4)', marginBottom: 8 }}>
          Building on the new foundation
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: 'var(--text-secondary, #5d7188)', lineHeight: 1.6 }}>
          This page is being rebuilt against the handoff backend and the locked design. The API client and the
          app shell are wired and live — the page content lands shortly.
        </div>
      </div>
    </div>
  );
}
