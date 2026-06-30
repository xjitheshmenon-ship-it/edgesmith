import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../store/AppContext';
import { ApiError } from '../api/client';

const DEFAULT_INTERVAL_MS = Number(import.meta.env.VITE_POLLING_INTERVAL_MS) || 30000;

/**
 * usePolling(fetchFn, deps, options)
 *
 * Calls fetchFn() immediately and then every `interval` ms. Tracks loading/
 * error/connection state and feeds the shared "last refreshed" ticker in
 * AppContext (shown in the status bar). Pauses polling while the tab is
 * hidden (visibilitychange) to avoid hammering the API from background tabs.
 *
 * fetchFn must return the raw data (already unwrapped from the API
 * envelope) — pass e.g. () => uidsApi.list(filters).then(r => r.data)
 */
export function usePolling(fetchFn, deps = [], { interval = DEFAULT_INTERVAL_MS, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const { markRefreshed } = useApp();
  const timerRef = useRef(null);
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const load = useCallback(async () => {
    try {
      const result = await fetchFnRef.current();
      setData(result);
      setError(null);
      markRefreshed();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('UNKNOWN', err.message, 0));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markRefreshed]);

  useEffect(() => {
    if (!enabled) return undefined;
    setLoading(true);
    load();

    function tick() {
      if (document.visibilityState === 'visible') load();
    }
    timerRef.current = setInterval(tick, interval);
    document.addEventListener('visibilitychange', tick);

    return () => {
      clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, interval, ...deps]);

  return { data, error, loading, refetch: load };
}
