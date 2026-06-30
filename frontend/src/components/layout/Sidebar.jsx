import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../store/AuthContext';
import { useApp } from '../../store/AppContext';
import { NAV, SECTIONS_BY_ROLE, OPERATOR_ALLOWED_ROUTES } from './nav';
import Icon from '../common/Icon';

const CHROME = '#11305f';

export default function Sidebar({ counts = {} }) {
  const navigate = useNavigate();
  const loc = useLocation();
  const { user } = useAuth();
  const { sidebarCollapsed, toggleSidebar } = useApp();
  const role = user?.role || '';
  const showLabels = !sidebarCollapsed;

  const visibleSections = SECTIONS_BY_ROLE[role] || [];
  const activeKey = loc.pathname.split('/')[1] || 'dashboard';

  const sections = NAV
    .filter(([section]) => visibleSections.includes(section))
    .map(([section, items]) => [
      section,
      items.filter(([key]) => (role === 'operator' ? OPERATOR_ALLOWED_ROUTES.includes(key) : true)),
    ])
    .filter(([, items]) => items.length > 0);

  return (
    <aside style={{
      width: sidebarCollapsed ? 56 : 220, flex: `0 0 ${sidebarCollapsed ? 56 : 220}px`,
      background: CHROME, borderRight: '1px solid #2c5191', display: 'flex', flexDirection: 'column',
      transition: 'width .15s', overflow: 'hidden',
    }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px' }}>
        {sections.map(([section, items]) => (
          <div key={section} style={{ marginBottom: 4 }}>
            {showLabels && (
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.14em', color: '#5d7fae', padding: '10px 10px 4px' }}>
                {section}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {items.map(([key, label, icon, badgeKey]) => {
                const active = activeKey === key;
                const badge = badgeKey ? counts[badgeKey] : 0;
                return (
                  <button key={key} title={label} onClick={() => navigate(`/${key}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: 'none', cursor: 'pointer',
                      padding: showLabels ? '8px 10px' : '8px 0', justifyContent: showLabels ? 'flex-start' : 'center',
                      borderRadius: 8, background: active ? 'rgba(212,238,203,.14)' : 'transparent',
                      borderLeft: active ? '2px solid #d4eecb' : '2px solid transparent',
                      color: active ? '#eaf4e4' : '#9bb4d4', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: active ? 600 : 400,
                    }}>
                    <span style={{ flexShrink: 0, display: 'flex', opacity: active ? 1 : 0.8 }}><Icon name={icon} size={16} /></span>
                    {showLabels && <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden' }}>{label}</span>}
                    {showLabels && badge > 0 && (
                      <span style={{ background: '#d97a2b', color: '#fff', fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, borderRadius: 5, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <button onClick={toggleSidebar}
        style={{ flex: '0 0 auto', height: 38, border: 'none', borderTop: '1px solid #2c5191', background: '#0c2750', color: '#9bb4d4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.08em' }}>
        <Icon name={sidebarCollapsed ? 'chevronRight' : 'chevronDown'} size={13} />
        {showLabels && <span>COLLAPSE</span>}
      </button>
    </aside>
  );
}
