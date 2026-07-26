// hooks/useSavedRuns.ts — Saved Runs Library data hook (大少 2026-07-24)
//
// Modular hook — single responsibility:
// - List saved runs (filter by algorithm_id optional)
// - Save new run (POST)
// - Update name/note (PUT)
// - Delete run (DELETE)
// - Get single run detail (GET by id)

import { useState, useEffect, useCallback } from 'react';

const API_BASE = 'http://localhost:18792';

export interface SavedRun {
  id: number;
  algorithm_id: string;
  algorithm_name: string;
  name: string;
  note: string | null;
  saved_at: string;
  updated_at: string;
  stocks: string[];
  metadata: Record<string, unknown>;
}

export interface SaveRunInput {
  algorithm_id: string;
  algorithm_name: string;
  stocks: string[];
  metadata: Record<string, unknown>;
  name?: string;
  note?: string;
}

export interface UpdateRunInput {
  name?: string;
  note?: string;
}

interface UseSavedRunsResult {
  runs: SavedRun[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveRun: (input: SaveRunInput) => Promise<SavedRun>;
  updateRun: (id: number, input: UpdateRunInput) => Promise<SavedRun>;
  deleteRun: (id: number) => Promise<void>;
  getRun: (id: number) => Promise<SavedRun | null>;
}

export function useSavedRuns(algorithmId?: string): UseSavedRunsResult {
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = algorithmId
    ? `${API_BASE}/api/saved-runs?algorithm_id=${encodeURIComponent(algorithmId)}`
    : `${API_BASE}/api/saved-runs`;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { runs: SavedRun[] };
      setRuns(data.runs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveRun = useCallback(async (input: SaveRunInput): Promise<SavedRun> => {
    const resp = await fetch(`${API_BASE}/api/saved-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Save failed: ${err}`);
    }
    const saved = (await resp.json()) as SavedRun;
    setRuns((prev) => [saved, ...prev]);  // 樂觀更新
    return saved;
  }, []);

  const updateRun = useCallback(async (id: number, input: UpdateRunInput): Promise<SavedRun> => {
    const resp = await fetch(`${API_BASE}/api/saved-runs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Update failed: ${err}`);
    }
    const updated = (await resp.json()) as SavedRun;
    setRuns((prev) => prev.map((r) => (r.id === id ? updated : r)));
    return updated;
  }, []);

  const deleteRun = useCallback(async (id: number): Promise<void> => {
    const resp = await fetch(`${API_BASE}/api/saved-runs/${id}`, {
      method: 'DELETE',
    });
    if (!resp.ok) throw new Error(`Delete failed: HTTP ${resp.status}`);
    setRuns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const getRun = useCallback(async (id: number): Promise<SavedRun | null> => {
    const resp = await fetch(`${API_BASE}/api/saved-runs/${id}`);
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`Get failed: HTTP ${resp.status}`);
    return (await resp.json()) as SavedRun;
  }, []);

  return { runs, loading, error, refresh, saveRun, updateRun, deleteRun, getRun };
}