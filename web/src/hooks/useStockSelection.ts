// hooks/useStockSelection.ts — Reusable stock selection state (大少 2026-07-27)
//
// 用嚟畀 stock list UI (ViewRunModal, ResultGrid, etc.) 共享：
// - Set<string> 記住 selected codes
// - toggle(toggle one) / toggleAll() (2 states, 大少 reject 咗 indeterminate)
// - allSelected derived boolean (for 全選 checkbox state)
//
// 預設 initial = all codes selected
// onChange callback 觸發時機：(a) toggle 後 (b) toggleAll 後 (c) setSelected 後
//   → 將來 AS-02 落地時直接 wire onChange 接收 selectedCodes

import { useState, useCallback, useMemo } from 'react';

export interface UseStockSelectionOptions {
  /** Optional initial codes (default = all codes). 用嚟 set partial initial selection。 */
  initialCodes?: string[];
  /** 每次 selectedCodes 改變時觸發 (將來 AS-02 預備 hook) */
  onChange?: (selected: Set<string>) => void;
}

export interface UseStockSelectionReturn {
  selectedCodes: Set<string>;
  allSelected: boolean;
  toggle: (code: string) => void;
  toggleAll: () => void;
  setSelected: (codes: Set<string>) => void;
}

export function useStockSelection(
  codes: string[],
  options?: UseStockSelectionOptions
): UseStockSelectionReturn {
  // 預設全部 selected (大少 2026-07-27 confirm)
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(
    () => new Set(options?.initialCodes ?? codes)
  );

  // 全部已選 (用嚟畀 全選 checkbox display)
  const allSelected = useMemo(
    () => codes.length > 0 && selectedCodes.size === codes.length,
    [codes, selectedCodes]
  );

  const toggle = useCallback((code: string) => {
    setSelectedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      options?.onChange?.(next);
      return next;
    });
  }, [options]);

  // 2 states: all selected → 全 unselect; 有未選 → 全 select
  // 大少 reject 咗 indeterminate
  const toggleAll = useCallback(() => {
    setSelectedCodes(prev => {
      const allCurrentlySelected = prev.size === codes.length && codes.length > 0;
      const next: Set<string> = allCurrentlySelected
        ? new Set()
        : new Set(codes);
      options?.onChange?.(next);
      return next;
    });
  }, [codes, options]);

  const setSelected = useCallback((next: Set<string>) => {
    setSelectedCodes(next);
    options?.onChange?.(next);
  }, [options]);

  return { selectedCodes, allSelected, toggle, toggleAll, setSelected };
}
