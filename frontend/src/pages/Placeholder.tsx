// Lightweight stand-in for pages not yet built to the full design spec.
// Keeps the navigation structure complete (matching the confirmed design) so
// every sidebar item routes somewhere instead of 404-ing.
export default function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--ink)' }}>
        {title}
      </div>
      <div style={{ marginTop: 24, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: 'var(--shadow-e1)', padding: '28px 24px', maxWidth: 560 }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>
          In progress
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          {note || `The ${title} page is being built to the CPCMS design spec. The backend endpoints and navigation are in place.`}
        </div>
      </div>
    </div>
  )
}
