// hooks/useDebugContext.ts — Fetch debug data + popularity status (大少 2026-07-24 Debug Panel)
// Modular hook: separate fetch logic from UI
// 2026-08-02 #9699 QW-2a: use central API_BASE from config/api

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../config/api';

export interface DebugStep {
  step: string;
  elapsed_ms: number;
  data: Record<string, unknown>;
}

export interface DebugRun {
  run_id: string;
  trigger: string;
  start_time: number;
  end_time: number | null;
  duration_ms: number | null;
  steps: DebugStep[];
  metadata: { status?: string; final?: Record<string, unknown> };
}

export interface PopularityStatus {
  state: 'idle' | 'running' | 'completed' | 'failed' | string;
  total: number;
  completed: number;
  metric?: string;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  current_plate?: string | null;
}

export interface DebugStatus {
  popularity: PopularityStatus;
  runs_count: number;
  debug_enabled: boolean;
}

interface UseDebugContextResult {
  lastRun: DebugRun | null;
  status: DebugStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  enabled: boolean;
  toggle: () => void;
}

/**
 * useDebugContext — hook for Debug Panel
 *
 * - auto-refreshes status every 5s when enabled (for popularity progress)
 * - manual refresh() to fetch latest last_run after a new execute
 *
 * @param enabled — master toggle (when false, no polling, no fetch)
 */
export function useDebugContext(autoPollMs = 5000): UseDebugContextResult {
  const [lastRun, setLastRun] = useState<DebugRun | null>(null);
  const [status, setStatus] = useState<DebugStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/debug/status`);
      if (!resp.ok) throw new Error(`status HTTP ${resp.status}`);
      const data = (await resp.json()) as DebugStatus;
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(`status fetch failed: ${(e as Error).message}`);
    }
  }, []);

  const fetchLastRun = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/debug/last_run`);
      if (!resp.ok) throw new Error(`last_run HTTP ${resp.status}`);
      const data = (await resp.json()) as { run: DebugRun | null };
      setLastRun(data.run);
      setError(null);
    } catch (e) {
      setError(`last_run fetch failed: ${(e as Error).message}`);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchStatus(), fetchLastRun()]);
    } finally {
      setLoading(false);
    }
  }, [fetchStatus, fetchLastRun]);

  const toggle = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  // Auto-poll status when enabled
  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    // Initial fetch
    void refresh();
    // Start polling
    intervalRef.current = window.setInterval(() => {
      void fetchStatus();
    }, autoPollMs);
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, autoPollMs, fetchStatus, refresh]);

  return { lastRun, status, loading, error, refresh, enabled, toggle };
}