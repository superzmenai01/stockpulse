// hooks/useSaveRun.ts — POST /api/saved-runs only (大少 2026-07-26 #7530 🥈: 拆 hook)
//
// Single Responsibility: backend API call for saving algorithm result.
// Extracted from useExecuteAlgorithm to separate "execute" + "save" concerns.
// Page composes via useSaveRunFlow if modal state needed.

import { useState, useCallback } from 'react';
import { message } from 'antd';
import { Leader } from '../types/algorithm';

// 大少 2026-07-24 saved_runs library endpoint: POST /api/saved-runs
export interface SaveRunBody {
  algorithm_id: string;
  algorithm_name: string;
  stocks: string[];
  // 大少 #7566: full Leader snapshot — backend /api/saved-runs 接受 saved_stocks,
  // 與 `stocks` (codes-only) 並存。 frontend 加返個 field 嚟呼應
  saved_stocks?: Leader[];
  metadata: Record<string, unknown>;
  name?: string;
  note?: string;
}

export interface SaveRunResponse {
  id: number;
  name: string;
}

export interface UseSaveRunReturn {
  save: (body: SaveRunBody) => Promise<boolean>;
  saving: boolean;
  lastSaved: SaveRunResponse | null;
}

export function useSaveRun(): UseSaveRunReturn {
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<SaveRunResponse | null>(null);

  const save = useCallback(async (body: SaveRunBody): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch('/api/saved-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: SaveRunResponse = await res.json();
      message.success(`已儲存結果 (#${data.id}: ${data.name})`);
      setLastSaved(data);
      return true;
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : '未知錯誤';
      console.error('useSaveRun save failed:', e);
      message.error(`儲存失敗: ${errMsg}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { save, saving, lastSaved };
}
