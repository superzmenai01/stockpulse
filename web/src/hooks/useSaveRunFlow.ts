// hooks/useSaveRunFlow.ts — Encapsulates Save Run Modal state + handlers + body construction
// 大少 2026-07-26 #7530 🥇: 抽 hook 出 page (4 inline handlers → 1 hook call)
//
// Single Responsibility: owns saveModalOpen state + provides show/hide/confirmSave API to caller.
// Composes useSaveRun for backend call.
// Caller passes dependencies (results, plates, topN, rankedAt, algorithm metadata) — hook builds body.

import { useState, useCallback } from 'react';
import { Leader } from '../types/algorithm';
import { useSaveRun } from './useSaveRun';

export interface UseSaveRunFlowParams {
  algorithmId: string;
  algorithmName: string;
  results: Leader[];
  selectedPlates: string[];
  topN: number;
  rankedAt: string | null;
  // 大少 2026-07-27 09:38 bug 3 fix: 過濾 results by selectedCodes (若 null = save 全部)
  selectedCodes?: Set<string> | null;
}

export interface UseSaveRunFlowReturn {
  /** bind to SaveRunModal.open */
  open: boolean;
  /** bind to SaveRunModal.saving (loading state on save button) */
  saving: boolean;
  /** bind to button onClick (e.g. ResultGrid.saveButton.onClick) — opens modal */
  show: () => void;
  /** bind to SaveRunModal.onCancel — closes modal */
  hide: () => void;
  /** bind to SaveRunModal.onSave — handles submit, returns true on success */
  confirmSave: (name: string, note?: string) => Promise<boolean>;
  /** filter 後嘅 stocks (大少 2026-07-27 09:44 確認 preview show selected) */
  filteredResults: Leader[];
}

export function useSaveRunFlow(params: UseSaveRunFlowParams): UseSaveRunFlowReturn {
  const { algorithmId, algorithmName, results, selectedPlates, topN, rankedAt, selectedCodes = null } = params;

  // 大少 2026-07-27 09:38 bug 3 fix: 過濾 results by selectedCodes
  // 若 selectedCodes 為 null (default) = save 全部 stocks (保持現有行為)
  const filteredResults: Leader[] = selectedCodes
    ? results.filter((r) => selectedCodes.has(r.code))
    : results;

  const [open, setOpen] = useState(false);
  const { save, saving } = useSaveRun();

  const show = useCallback(() => {
    // Defensive: 唔好喺無 results 時打開 modal
    if (results.length > 0) setOpen(true);
  }, [results.length]);

  const hide = useCallback(() => setOpen(false), []);

  const confirmSave = useCallback(
    async (name: string, note?: string): Promise<boolean> => {
      return await save({
        algorithm_id: algorithmId,
        algorithm_name: algorithmName,
        // 大少 2026-07-27 09:38 bug 3 fix: 用 filteredResults 而唔係 results
        // 若 selectedCodes 為 null = save 全部 stocks (default 行為)
        saved_stocks: filteredResults,
        stocks: filteredResults.map((l) => l.code),
        metadata: {
          plates: selectedPlates,
          top_n: topN,
          ranked_at: rankedAt,
          // 大少 2026-07-27 09:38 bug 3 fix: 記錄 selected codes 喺 metadata (for audit)
          selected_codes: selectedCodes ? Array.from(selectedCodes) : null,
        },
        name,
        note,
      });
    },
    [algorithmId, algorithmName, filteredResults, selectedPlates, topN, rankedAt, selectedCodes, save],
  );

  return { open, saving, show, hide, confirmSave, filteredResults };
}
