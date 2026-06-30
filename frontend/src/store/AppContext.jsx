import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

const AppContext = createContext(null);

/**
 * The single shared location toggle. Per the design corrections (Rounds 5-8),
 * this is the ONLY location control in the entire app — Production Floor,
 * My Workstation, Job Assignment, Shift Management, Employee Profiles,
 * Master Lists, Cycle Builder, and Reports all read this same value rather
 * than maintaining their own local toggles.
 *
 * Values: 'dharmapuri' | 'faridabad' | 'both'
 * Admin/Manager can set any value. Supervisor/Operator are locked to their
 * own location (server enforces this independently regardless of what's
 * stored here — see backend rbac.js enforceLocationScope).
 */
export function AppProvider({ children }) {
  const { user, canSwitchLocation } = useAuth();

  const [location, setLocationState] = useState(() => {
    if (user && !canSwitchLocation) {
      return user.location_id === 1 ? 'dharmapuri' : 'faridabad';
    }
    return localStorage.getItem('cpcms_location') || 'dharmapuri';
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('cpcms_sidebar_collapsed') === 'true');
  const [online, setOnline] = useState(true);
  const [lastRefreshSeconds, setLastRefreshSeconds] = useState(0);

  // Lock non-switching roles to their own location whenever user changes (e.g. after login)
  useEffect(() => {
    if (user && !canSwitchLocation) {
      setLocationState(user.location_id === 1 ? 'dharmapuri' : 'faridabad');
    }
  }, [user, canSwitchLocation]);

  const setLocation = useCallback(
    (loc) => {
      if (!canSwitchLocation) return; // server-enforced too; this is just UX — see enforceLocationScope on backend
      setLocationState(loc);
      localStorage.setItem('cpcms_location', loc);
    },
    [canSwitchLocation]
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('cpcms_sidebar_collapsed', String(next));
      return next;
    });
  }, []);

  // Connection monitoring — browser online/offline events plus periodic refresh-age ticker
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setLastRefreshSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const markRefreshed = useCallback(() => setLastRefreshSeconds(0), []);

  const value = {
    location,
    setLocation,
    canSwitchLocation,
    locationLabel: location === 'dharmapuri' ? 'Dharmapuri' : location === 'faridabad' ? 'Faridabad' : 'Both',
    sidebarCollapsed,
    toggleSidebar,
    online,
    lastRefreshSeconds,
    markRefreshed,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
