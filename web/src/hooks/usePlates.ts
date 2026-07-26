// hooks/usePlates.ts — Fetch plates + includeNonStock toggle
// 大少 2026-07-24 Tier 1.3
// 大少 2026-07-26 08:36: 加 restoreDefault() + isDefault (一鍵還原 UI support)

import { useState, useEffect, useCallback } from 'react';
import { message } from 'antd';
import {
  Plate,
  PlatesApiResponse,
  DEFAULT_TOP_N_LIMIT,
} from '../types/algorithm';

// 大少 2026-07-26 08:36: restore-default endpoint response
export interface RestoreDefaultResponse {
  status: 'restored' | 'no-op' | 'error';
  message: string;
  is_default: boolean;
  restored_count?: number;
  backup?: string | null;
}

export function usePlates(initialIncludeNonStock = true) {
  const [plates, setPlates] = useState<Plate[]>([]);
  const [platesLoading, setPlatesLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<Plate[]>([]);
  const [searching, setSearching] = useState(false);
  const [includeNonStock, setIncludeNonStock] = useState(initialIncludeNonStock);
  // 大少 2026-07-26 08:36: 記住 current order 係咪 = default (disable reset button 用)
  const [isDefault, setIsDefault] = useState<boolean>(true);
  // 大少 2026-07-26 08:36: restore 進行中狀態 (disable button 防雙重 click)
  const [restoring, setRestoring] = useState<boolean>(false);

  // 攝 top N plates (default view)
  const fetchTopPlates = useCallback(async () => {
    setPlatesLoading(true);
    try {
      const res = await fetch(
        `/api/plates?limit=${DEFAULT_TOP_N_LIMIT}&include_non_stock=${includeNonStock}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PlatesApiResponse = await res.json();
      setPlates(data.plates || []);
      // 大少 2026-07-26 08:36: update is_default flag
      setIsDefault(data.is_default ?? true);
    } catch (e) {
      console.error('fetchTopPlates failed:', e);
      message.error('載入板塊列表失敗');
    } finally {
      setPlatesLoading(false);
    }
  }, [includeNonStock]);

  // Server-side search
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/plates?q=${encodeURIComponent(query)}&limit=${DEFAULT_TOP_N_LIMIT}&include_non_stock=${includeNonStock}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PlatesApiResponse = await res.json();
      setSearchResults(data.plates || []);
      // 大少 2026-07-26 08:36: search response 都有 is_default
      setIsDefault(data.is_default ?? true);
    } catch (e) {
      console.error('search failed:', e);
    } finally {
      setSearching(false);
    }
  }, [includeNonStock]);

  // Toggle handler (clears search results when switching)
  const handleIncludeNonStockChange = useCallback((checked: boolean) => {
    setIncludeNonStock(checked);
    setSearchResults([]);
  }, []);

  // 大少 2026-07-26 08:36: 一鍵還原 = call /api/plates/restore-default + reload list
  const restoreDefault = useCallback(async (): Promise<boolean> => {
    setRestoring(true);
    try {
      const res = await fetch('/api/plates/restore-default', { method: 'POST' });
      const data: RestoreDefaultResponse = await res.json();
      if (!res.ok) {
        message.error(`還原失敗: ${data.message || res.statusText}`);
        return false;
      }
      if (data.status === 'no-op') {
        message.info(data.message);
      } else {
        message.success(data.message);
      }
      // Reload plates list (新 order 生效)
      await fetchTopPlates();
      setSearchResults([]);
      // Backend 會返 is_default=true (restored 或者 no-op 都係)
      setIsDefault(true);
      return true;
    } catch (e) {
      console.error('restoreDefault failed:', e);
      message.error('還原失敗, 請檢查網絡');
      return false;
    } finally {
      setRestoring(false);
    }
  }, [fetchTopPlates]);

  // Initial fetch + re-fetch on toggle
  useEffect(() => {
    void fetchTopPlates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeNonStock]);

  // Display: 有 search results 就用 search results, 否則 top N
  const displayPlates = searchResults.length > 0 ? searchResults : plates;

  return {
    plates: displayPlates,
    platesLoading,
    searching,
    includeNonStock,
    setIncludeNonStock: handleIncludeNonStockChange,
    handleSearch,
    fetchTopPlates,
    // 大少 2026-07-26 08:36: 一鍵還原 props
    isDefault,
    restoring,
    restoreDefault,
  };
}