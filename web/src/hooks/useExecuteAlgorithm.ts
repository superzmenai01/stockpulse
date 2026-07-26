// hooks/useExecuteAlgorithm.ts — POST execute + state management
// 大少 2026-07-24 Tier 1.3

import { useState, useCallback } from 'react';
import { message } from 'antd';
import { Leader, ExecuteApiResponse } from '../types/algorithm';

export function useExecuteAlgorithm() {
  const [results, setResults] = useState<Leader[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const handleExecute = useCallback(async (selectedPlates: string[], topN: number) => {
    if (selectedPlates.length === 0) {
      message.warning('請揀至少 1 個板塊');
      return;
    }
    setLoading(true);
    setLastError(null);
    const startTime = Date.now();
    try {
      const res = await fetch('/api/plates/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plates: selectedPlates, top_n: topN, debug: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: ExecuteApiResponse = await res.json();
      setResults(data.leaders || []);
      setHasRun(true);
      // Ensure minimum 1.2s loading (UX, 避免 fetch 太快 spin 閃一下)
      const elapsed = Date.now() - startTime;
      if (elapsed < 1200) {
        await new Promise((r) => setTimeout(r, 1200 - elapsed));
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : '未知錯誤';
      console.error('handleExecute failed:', e);
      message.error(`執行失敗: ${errMsg}`);
      setLastError(errMsg);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    results,
    loading,
    hasRun,
    lastError,
    handleExecute,
    setResults,
  };
}