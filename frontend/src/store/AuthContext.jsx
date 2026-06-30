import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authApi } from '../api/auth';
import { ApiError, setAuthToken } from '../api/client';

const AuthContext = createContext(null);

const STORAGE_KEY = 'cpcms_user'; // non-sensitive display info only — the real session lives in the httpOnly cookie

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  const refreshTimerRef = useRef(null);

  const persistUser = useCallback((u) => {
    setUser(u);
    if (u) localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const login = useCallback(
    async (username, password) => {
      setLoading(true);
      try {
        const res = await authApi.login(username, password);
        if (res.data.token) setAuthToken(res.data.token); // Bearer fallback for the native app
        persistUser(res.data.user);
        return res.data.user;
      } finally {
        setLoading(false);
      }
    },
    [persistUser]
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore network errors on logout — clear local state regardless
    }
    setAuthToken(null);
    persistUser(null);
  }, [persistUser]);

  // Silent token refresh — fires 30 minutes before the 8h expiry.
  // Since we don't decode the JWT client-side (httpOnly, can't read it),
  // we simply refresh on a fixed interval shorter than the token lifetime.
  useEffect(() => {
    if (!user) return undefined;

    const REFRESH_INTERVAL_MS = 7.5 * 60 * 60 * 1000; // refresh every 7.5h (30min before 8h expiry)
    refreshTimerRef.current = setInterval(async () => {
      try {
        const r = await authApi.refresh();
        if (r?.data?.token) setAuthToken(r.data.token); // keep the Bearer token fresh too
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setAuthToken(null);
          persistUser(null);
        }
      }
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(refreshTimerRef.current);
  }, [user, persistUser]);

  const value = {
    user,
    loading,
    login,
    logout,
    isAuthenticated: !!user,
    // Convenience role checks used throughout the app
    isAdmin: user?.role === 'admin',
    isManager: user?.role === 'manager',
    isSupervisor: user?.role === 'supervisor',
    isOperator: user?.role === 'operator',
    isService: user?.role === 'service',
    isShopfloor: user?.role === 'shopfloor',
    canSwitchLocation: user?.role === 'admin' || user?.role === 'manager',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
