// hooks/useStockReasons.ts — Fetch per-stock HTML reasons (大少 2026-08-03 #9920)
//
// Calls GET /api/stock-reasons?code=*** to load all active reasons for a stock.
// Used by ReasonCell v2 to render title list + open ReasonPopUp on click.
//
// Returned reasons are sorted newest-first by backend (ORDER BY created_at DESC).

import { useState, useEffect, useCallback } from 'react';
import type { ReasonEntry } from '../types/algorithm';
import { API_BASE } from '../config/api';

interface UseStockReasonsResult {
  reasons: ReasonEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useStockReasons(
  code: string | null | undefined,
  sourceRunId?: number | null,
): UseStockReasonsResult {
  const [reasons, setReasons] = useState<ReasonEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!code) {
      setReasons([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ code });
      if (sourceRunId) {
        params.set('source_run_id', String(sourceRunId));
      }
      const resp = await fetch(`${API_BASE}/stock-reasons?${params.toString()}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { reasons: ReasonEntry[]; count: number };
      setReasons(data.reasons || []);
    } catch (e) {
      setError((e as Error).message);
      setReasons([]);
    } finally {
      setLoading(false);
    }
  }, [code, sourceRunId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { reasons, loading, error, refresh };
}