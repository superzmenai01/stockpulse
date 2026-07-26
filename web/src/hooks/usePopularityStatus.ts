// hooks/usePopularityStatus.ts — Fetch popularity status
// 大少 2026-07-24 Tier 1.3

import { useState, useEffect, useCallback } from 'react';
import { message } from 'antd';
import { PopularityStatus } from '../types/algorithm';

export function usePopularityStatus() {
  const [status, setStatus] = useState<PopularityStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/plates/status');
      if (!res.ok) return;
      const data: PopularityStatus = await res.json();
      setStatus(data);
    } catch (e) {
      console.error('fetchStatus failed:', e);
    }
  }, []);

  // Trigger background refresh (大少個「🔄 重新計算」button)
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/plates/refresh-popularity', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      message.info({
        content: `Refresh 開始 (PID ${data.pid}, 預計 ${data.estimated_minutes} min)。完成後按 🔄 重新載入。`,
        duration: 5,
      });
      // 30s 後 poll status
      setTimeout(() => void fetchStatus(), 30_000);
    } catch (e) {
      console.error('refresh failed:', e);
      message.error('Refresh 啟動失敗');
    } finally {
      setRefreshing(false);
    }
  }, [fetchStatus]);

  // Initial fetch
  useEffect(() => {
    void fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    refreshing,
    fetchStatus,
    handleRefresh,
  };
}