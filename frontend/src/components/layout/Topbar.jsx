import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../store/AuthContext';
import { useApp } from '../../store/AppContext';
import { routeTitle } from './nav';
import Icon from '../common/Icon';

const CHROME = '#11305f';

const LOCATIONS = [
  { key: 'dharmapuri', label: 'Dharmapuri', color: '#3b82f6' },
  { key: 'faridabad', label: 'Faridabad', color: '#d97a2b' },
];

/* Current shift number + remaining time (06–14 / 14–22 / 22–06). */
function useShift() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const h = now.getHours();
  let n, endH;
  if (h >= 6 && h < 14) { n = 1; endH = 14; }
  else if (h >= 14 && h < 22) { n = 2; endH = 22; }
  else { n = 3; endH = 6; }
  const end = new Date(now);
  if (n === 3 && h >= 22) end.setDate(end.getDate() + 1);
  end.setHours(endH, 0, 0, 0);
  const remMin = Math.max(0, Math.floor((end.getTime() - now.getTime()) / 60000));
  const color = remMin > 120 ? '#3fbf86' : remMin > 30 ? '#f0c674' : '#ff9b9b';
  return { n, remLabel: `${Math.floor(remMin / 60)}h ${String(remMin % 60).padStart(2, '0')}m`, color, clock: now };
}

export default function Topbar({ alertCount = 0 }) {
  const navigate = useNavigate();
  const loc = useLocation();
  const { user, logout } = useAuth();
  const { location, setLocation, canSwitchLocation, locationLabel } = useApp();
  const shift = useShift();
  const [menuOpen, setMenuOpen] = useState(false);

  const routeKey = loc.pathname.split('/')[1] || 'dashboard';
  const pageTitle = routeTitle(routeKey);
  const initials = (user?.full_name || user?.username || '??')
    .split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <header style={{ height: 58, flex: '0 0 58px', display: 'flex', alignItems: 'center', gap: 18, padding: '0 20px', background: CHROME, color: '#eaf4e4', zIndex: 20 }}>
      {/* Brand */}
      <div style={{ lineHeight: 1.05, flexShrink: 0 }}>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: '-0.035em' }}>
          edgesmith<span style={{ color: '#d4eecb' }}>.</span>
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, letterSpacing: '0.16em', color: '#7d96bb', marginTop: 3 }}>
          INNOVATE · ENGINEER · EXCEL
        </div>
      </div>
      <div style={{ width: 1, height: 30, background: '#2c5191', flexShrink: 0 }} />
      {/* Page context */}
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, flexShrink: 0, minWidth: 0 }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8.5, letterSpacing: '0.16em', color: '#5d7fae', whiteSpace: 'nowrap' }}>
          CPCMS · EDGESMITH TOOLING INDIA
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 600, color: '#cfe0ee', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {pageTitle}
        </div>
      </div>

      {/* Centre — location toggle (pills if can switch, else locked label) */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        {canSwitchLocation ? (
          <div style={{ display: 'flex', background: '#0c2750', borderRadius: 9, padding: 3, gap: 2 }}>
            {LOCATIONS.map((l) => {
              const on = location === l.key;
              return (
                <button key={l.key} onClick={() => setLocation(l.key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', borderRadius: 7, padding: '6px 13px', cursor: 'pointer',
                    background: on ? l.color : 'transparent', color: on ? '#fff' : '#9bb4d4',
                    fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: on ? '#fff' : l.color }} />
                  {l.label}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#0c2750', borderRadius: 9, padding: '8px 14px', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 600, color: '#cfe0ee' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6' }} />
            {locationLabel}
          </div>
        )}
      </div>

      {/* Right cluster */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        <button onClick={() => navigate('/shift')} title="Shift Planner"
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#0c2750', border: 'none', borderRadius: 9, padding: '0 12px', height: 36, cursor: 'pointer' }}>
          <Icon name="calendar" size={14} color={shift.color} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: '#cfe0ee', whiteSpace: 'nowrap' }}>
            Shift {shift.n} · <span style={{ color: shift.color }}>{shift.remLabel}</span>
          </span>
        </button>

        <button title="Alerts" onClick={() => navigate('/dashboard')}
          style={{ position: 'relative', width: 36, height: 36, border: 'none', background: '#0c2750', borderRadius: 9, color: '#cfe0ee', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bell" size={17} />
          {alertCount > 0 && (
            <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, padding: '0 4px', background: '#e5484d', color: '#fff', borderRadius: 9, border: `2px solid ${CHROME}`, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {alertCount}
            </span>
          )}
        </button>

        <div style={{ position: 'relative' }}>
          <button onClick={() => setMenuOpen((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#d4eecb', color: CHROME, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 12.5 }}>
              {initials}
            </div>
            <div style={{ textAlign: 'left', lineHeight: 1.15 }}>
              <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 600, color: '#eaf4e4', whiteSpace: 'nowrap' }}>{user?.full_name || user?.username}</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.08em', color: '#9bb4d4' }}>{user?.role?.toUpperCase()}</div>
            </div>
            <Icon name="chevronDown" size={13} color="#9bb4d4" />
          </button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', top: 46, right: 0, width: 200, background: '#fff', border: '1px solid var(--border-card, #e3ebde)', borderRadius: 13, boxShadow: '0 18px 40px rgba(21,54,106,.20)', zIndex: 50, overflow: 'hidden' }}>
                <div style={{ padding: '12px 14px', borderBottom: '1px solid #eef2ea' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#15366a' }}>{user?.full_name || user?.username}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#9bb4d4' }}>{user?.role}</div>
                </div>
                <button onClick={() => { setMenuOpen(false); logout(); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 42, padding: '0 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: '#e5484d' }}>
                  <Icon name="lock" size={15} /> Logout
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 500, color: '#9bb4d4', width: 74, textAlign: 'right' }}>
          {shift.clock.toLocaleTimeString('en-GB')}
        </div>
      </div>
    </header>
  );
}
