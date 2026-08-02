// hooks/useSavedRuns.ts — Saved Runs Library data hook (大少 2026-07-24)
//
// Modular hook — single responsibility:
// - List saved runs (filter by algorithm_id optional)
// - Save new run (POST)
// - Update name/note (PUT)
// - Delete run (DELETE)
// - Get single run detail (GET by id)

import { useState, useEffect, useCallback } from 'react';
import type { Leader } from '../types/algorithm';
import { API_BASE } from '../config/api';

// 大少 2026-07-26 #7566: SavedStock = full Leader snapshot
export type SavedStock = Leader;

export interface SavedRun {
  id: number;
  algorithm_id: string;
  algorithm_name: string;
  name: string;
  note: string | null;
  saved_at: string;
  updated_at: string;
  stocks: string[];
  // 大少 #7566: full snapshot data per stock (vs `stocks: string[]` 喺 POST 自動 derived)
  saved_stocks: SavedStock[];
  metadata: Record<string, unknown>;
  // 大少 #8960 (2026-07-29): LibraryPage 排位 + 置頂
  position: number;
  is_pinned: boolean;
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
  // 大少 #8762 (2026-07-29): 結果詳情可編輯 — 提供 saved_stocks 就會 replace 整個 list
  saved_stocks?: SavedStock[];
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
  // 大少 #8960 (2026-07-29): LibraryPage 排位 + 置頂 嘅 methods
  reorderRuns: (ordered_ids: number[]) => Promise<void>;
  pinRun: (id: number, pinned: boolean) => Promise<SavedRun>;

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

  // 大少 #8960 (2026-07-29): LibraryPage 排位 + 置頂 嘅 API hooks
  // 大少 #9026 (2026-07-29): 用 inline fetch (跟 saveRun 等 pattern)，因為 helper `apiRequest` 唔存在
  const reorderRuns = async (ordered_ids: number[]) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/api/saved-runs/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordered_ids }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const pinRun = async (id: number, pinned: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/api/saved-runs/${id}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const updated = await resp.json();
      await refresh();
      return updated;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  return { runs, loading, error, refresh, saveRun, updateRun, deleteRun, getRun, reorderRuns, pinRun };
}