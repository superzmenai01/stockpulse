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
//
// **大少 2026-07-27 09:21 bug fix**:
// 1. Mount 嗰時 codes 可能為空 (async load 仲未完), 之後先 load 返 N stocks
//    → useState 嘅 lazy initial 只 first render 跑一次, 所以 selectedCodes 永遠 empty
//    → 用 useEffect auto-sync: 當 codes 變動 + user 未 touch + selectedCodes empty → 自動 fill
// 2. Caller useMemo codes 穩定 reference, 避免 useCallback 每次 render rebuild

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';

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

  // 大少 2026-07-27 09:21 fix: userTouchedRef 區分「user 沒碰過」vs「user 點空咗」
  const userTouchedRef = useRef(false);

  // 大少 2026-07-27 09:21 fix: 用 stable key 防止 codes 每次 render 嘅 reference 變動引爆 useEffect
  const codesKey = useMemo(() => codes.slice().sort().join(','), [codes]);

  // 大少 2026-07-27 10:14 fix: stable 化 codes reference 由 codesKey 決定
  // 同 caller 嘅 codes array 內容唔變時, 保持 same reference
  // 確保 useCallback 個 deps (stableCodes / onChange) stable until 真正 value 變
  const stableCodes = useMemo(() => codes, [codesKey]);

  // 抽 options.onChange 為獨立 variable, 避免 options object 每次 render rebuild 影響 useCallback
  const onChange = options?.onChange;

  // 大少 2026-07-27 09:21 fix: 當 codes 由 async load 出現 (mount 時 [] → 完載 N stocks)
  // 同時 user 仲未 touch 過, 自動 fill 全部 selected。等 useState 嘅 lazy initial 救唔到嘅 mount 時序問題
  useEffect(() => {
    if (codesKey.length > 0 && !userTouchedRef.current && selectedCodes.size === 0) {
      setSelectedCodes(new Set(stableCodes));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey]);

  // 全部已選 (用嚟畀 全選 checkbox display)
  const allSelected = useMemo(
    () => stableCodes.length > 0 && selectedCodes.size === stableCodes.length,
    [stableCodes, selectedCodes]
  );

  const toggle = useCallback((code: string) => {
    userTouchedRef.current = true;
    setSelectedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      onChange?.(next);
      return next;
    });
  }, [onChange]);

  // 2 states: all selected → 全 unselect; 有未選 → 全 select
  // 大少 reject 咗 indeterminate
  const toggleAll = useCallback(() => {
    userTouchedRef.current = true;
    setSelectedCodes(prev => {
      const allCurrentlySelected = prev.size === stableCodes.length && stableCodes.length > 0;
      const next: Set<string> = allCurrentlySelected
        ? new Set()
        : new Set(stableCodes);
      onChange?.(next);
      return next;
    });
  }, [stableCodes, onChange]);

  const setSelected = useCallback((next: Set<string>) => {
    userTouchedRef.current = true;
    setSelectedCodes(next);
    onChange?.(next);
  }, [onChange]);

  return { selectedCodes, allSelected, toggle, toggleAll, setSelected };
}
