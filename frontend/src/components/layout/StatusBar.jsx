import { useApp } from '../../store/AppContext';

const CHROME = '#11305f';

export default function StatusBar({ active = '—', hold = '—', furnace = '—' }) {
  const { lastRefreshSeconds, online, locationLabel } = useApp();
  return (
    <footer style={{ height: 30, flex: '0 0 30px', display: 'flex', alignItems: 'center', gap: 20, padding: '0 20px', background: CHROME, color: '#9bb4d4', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: '#cfe0ee', fontWeight: 600 }}>{active}</span> active UIDs</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: '#ff9b9b', fontWeight: 600 }}>{hold}</span> on hold</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: '#f0c674', fontWeight: 600 }}>{furnace}</span> in furnace</div>
      <div style={{ flex: 1, textAlign: 'center', color: '#5d7fae' }}>{locationLabel}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span>Updated {lastRefreshSeconds}s ago</span>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: online ? '#22a06b' : '#e5484d' }} />
      </div>
    </footer>
  );
}
