// hooks/useExecuteAS02.ts — POST /api/as02/run + state management
// 大少 2026-08-01 Phase 5 (AS-02 Frontend)
// Follows useExecuteAlgorithm.ts pattern (大少 2026-07-24 Tier 1.3)
//
// Adds qualified/disqualified split (大少 AS-02 spec):
// - Both groups stored separately for UI display
// - Qualified count drives save flow

import { useState, useCallback } from 'react';
import { message } from 'antd';
import { AS02Stock, AS02ApiResponse } from '../types/algorithm';

export function useExecuteAS02() {
  const [results, setResults] = useState<AS02Stock[]>([]);
  const [qualifiedResults, setQualifiedResults] = useState<AS02Stock[]>([]);
  const [disqualifiedResults, setDisqualifiedResults] = useState<AS02Stock[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [rankedAt, setRankedAt] = useState<string | null>(null);

  const handleExecute = useCallback(async (stocks: string[]) => {
    if (stocks.length === 0) {
      message.warning('請輸入至少 1 隻股票代碼 (e.g. HK.00981)');
      return;
    }
    if (stocks.length > 10) {
      message.warning('最多 10 隻股票, 已自動 trim');
      stocks = stocks.slice(0, 10);
    }
    setLoading(true);
    setLastError(null);
    const startTime = Date.now();
    try {
      const res = await fetch('/api/as02/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stocks }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: AS02ApiResponse = await res.json();
      const allStocks = data.stocks || [];
      const qualified = allStocks.filter((s) => s.classification === 'qualified');
      const disqualified = allStocks.filter((s) => s.classification === 'disqualified');
      setResults(allStocks);
      setQualifiedResults(qualified);
      setDisqualifiedResults(disqualified);
      setRankedAt(data.ranked_at || null);
      setHasRun(true);
      // Ensure minimum 1.2s loading (UX, 避免 fetch 太快 spin 閃一下)
      const elapsed = Date.now() - startTime;
      if (elapsed < 1200) {
        await new Promise((r) => setTimeout(r, 1200 - elapsed));
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : '未知錯誤';
      console.error('AS-02 handleExecute failed:', e);
      message.error(`執行失敗: ${errMsg}`);
      setLastError(errMsg);
      setResults([]);
      setQualifiedResults([]);
      setDisqualifiedResults([]);
      setRankedAt(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    results,
    qualifiedResults,
    disqualifiedResults,
    loading,
    hasRun,
    lastError,
    rankedAt,
    handleExecute,
    setResults,
  };
}