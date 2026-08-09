// modules/backtest-timeline.ts — AS-03 · M11 Backtest Timeline (時光機時序圖) v0.1.0
//
// 大少 2026-08-10 00:04 — Stage 2 第三次 focus (M11 從 Stage 4 升級, 大少 21:24 重新 plan)
//
// 4 個 design decision (大少 00:04 confirm 全 A):
//   D1: 時間範圍 default 90 日 + filter chip 30/90/180/365
//   D2: 整合版 (verdict + forward return + Trade Journal 啱錯 overlay)
//   D3: Testing page 獨立 entry (id='AS-03-BTL', 跟 M9 pattern)
//   D4: Date range filter chip (client-side filter)
//
// 5 個 step algorithm:
//   1. 拎 forward return history (從 backend GET /api/adaptive-params/{symbol}/forward-return, 永久 cache)
//   2. 拎 Trade Journal records (從 backend GET /api/trade-journal?symbol={symbol}, 永久 cache)
//   3. 對齊日期 (以 forward return 為主軸, Trade Journal entry_date 對齊 verdict 嗰日)
//   4. 計算整合 view (6 色標 + golden entry detection, fwd5 ≥ 3% + hit + mark ≥ 4)
//   5. 計算 stats (hit rate, avg return, action breakdown, match breakdown)
//
// Data source:
//   - M9 forward return history (永久保留, 180 日半衰期 weighted stats, M9 spec §11)
//   - M10 Trade Journal (永久保留, Stage 1+ 永久 rule)
//
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-11-BACKTEST-TIMELINE.md

// =============================================================
// Types
// =============================================================

/** 來自 M9 forward return history (從 GET /api/adaptive-params/{symbol}/forward-return) */
export interface ForwardReturnRecord {
  date: string;                    // YYYY-MM-DD
  action: string;                  // FinalAction: BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION
  fwd5: number | null;             // 5 日後回報 %
  fwd10: number | null;            // 10 日後回報 %
  fwd20: number | null;            // 20 日後回報 %
  hit: boolean | null;             // fwd5 > 0
}

/** 來自 M10 Trade Journal (從 GET /api/trade-journal) */
export interface TradeJournalEntry {
  id: number;
  symbol: string;
  entry_date: string;              // YYYY-MM-DD
  entry_price: number;
  shares: number;
  target_price: number | null;
  stop_loss: number | null;
  notes: string;
  created_at: string;
  mark_correct: number | null;     // 1-5 scale
  mark_wrong: number | null;       // 1-5 scale
  mark_scale: number | null;       // 1-5 scale
}

/** 預測 vs 實戰對比 (M11 計算) */
export type PredictionVsActual = 'MATCH' | 'PARTIAL' | 'MISS' | 'NO_JOURNAL';

/** 對齊後嘅 timeline data point (Step 3 output) */
export interface TimelineDataPoint {
  date: string;
  // 來自 M9 forward return
  action: string;
  fwd5: number | null;
  fwd10: number | null;
  fwd20: number | null;
  hit: boolean | null;
  // 來自 Trade Journal
  journalEntry: TradeJournalEntry | null;
  markCorrect: number | null;
  markWrong: number | null;
  markScale: number | null;
  // M11 計算
  predictionVsActual: PredictionVsActual;
  color: string;                   // 6 色標
  isGoldenEntry: boolean;          // fwd5 ≥ 3% + hit + mark 4-5
}

/** Stats summary (Step 5 output) */
export interface TimelineStats {
  totalVerdicts: number;
  totalJournalEntries: number;
  hitRate5d: number | null;
  avgFwd5: number | null;
  avgFwd10: number | null;
  avgFwd20: number | null;
  actionBreakdown: Record<string, number>;
  matchBreakdown: Record<PredictionVsActual, number>;
  goldenEntries: number;
}

/** 整個 timeline result */
export interface TimelineResult {
  symbol: string;
  dateRange: { start: string; end: string; days: number };
  totalPoints: number;
  dataPoints: TimelineDataPoint[];
  stats: TimelineStats;
  meta: {
    forwardReturnCount: number;
    journalCount: number;
    dateRangeUsed: number;
    dataLimited: boolean;
  };
}

/** M11 input (測試用, 唔 fetch API) */
export interface BacktestTimelineInput {
  symbol: string;
  dateRange?: number;              // 30 / 90 / 180 / 365, default 90
  forwardReturnHistory?: ForwardReturnRecord[];
  tradeJournalEntries?: TradeJournalEntry[];
}

/** Golden entry threshold (Spec §6 Step 4) */
export const GOLDEN_ENTRY_FWD5_THRESHOLD = 3.0;   // 5 日內升 ≥ 3%
export const GOLDEN_ENTRY_MARK_THRESHOLD = 4;     // 大少 mark 4-5

/** 6 色標 (Spec §8.1) */
export const TIMELINE_COLORS = {
  GOLDEN: '#26BA75',              // 🟢 綠 deep (Golden entry)
  HIT_GENERAL: '#52C41A',         // 🟢 綠 light (一般啱)
  WAIT: '#F39C12',                // 🟡 黃 (HOLD / WAIT)
  MISS_GENERAL: '#FA8C16',        // 🟠 橙 light (一般錯)
  MISS_SEVERE: '#EE5151',         // 🟠 橙 deep (嚴重錯)
  SELL_DANGER: '#CF1322',         // 🔴 紅 (SELL/REDUCE/TRAP/TRANSITION)
  NO_JOURNAL: '#999999',          // ⚪ 灰 (大少冇 mark)
} as const;

// =============================================================
// Step 1: 拎 forward return (mock, testing 用)
// Step 2: 拎 Trade Journal (mock, testing 用)
// =============================================================
// 註: 真實 fetch 喺 adapter.mjs 嘅 analyze() 入面 (browser 環境有 fetch), pure algorithm 接受 input 已經 fetch 完嘅 data

// =============================================================
// Step 3: 對齊日期 (Date Alignment)
// =============================================================

/**
 * 以 forward return 為主軸, Trade Journal entry_date 對齊 verdict 嗰日
 * 同一日有 2 個 journal entries (理論上 UNIQUE constraint 唔應該出現, 但 defensive code 處理)
 */
function alignDates(
  forwardReturns: ForwardReturnRecord[],
  journalEntries: TradeJournalEntry[]
): TimelineDataPoint[] {
  return forwardReturns.map((fr) => {
    const journalMatch = journalEntries.find((j) => j.entry_date === fr.date) || null;
    return {
      date: fr.date,
      action: fr.action,
      fwd5: fr.fwd5,
      fwd10: fr.fwd10,
      fwd20: fr.fwd20,
      hit: fr.hit,
      journalEntry: journalMatch,
      markCorrect: journalMatch?.mark_correct ?? null,
      markWrong: journalMatch?.mark_wrong ?? null,
      markScale: journalMatch?.mark_scale ?? null,
      predictionVsActual: computeMatch(fr, journalMatch),
      color: '',                     // Step 4 set
      isGoldenEntry: false,          // Step 4 set
    };
  });
}

function computeMatch(fr: ForwardReturnRecord, j: TradeJournalEntry | null): PredictionVsActual {
  if (!j) return 'NO_JOURNAL';
  if (fr.hit === true && j.mark_correct !== null) return 'MATCH';
  if (fr.hit === false && j.mark_wrong !== null) return 'MATCH';
  if (fr.hit === true && j.mark_wrong !== null) return 'MISS';
  if (fr.hit === false && j.mark_correct !== null) return 'PARTIAL';
  return 'NO_JOURNAL';
}

// =============================================================
// Step 4: 計算整合 View (6 色標 + golden entry)
// =============================================================

/**
 * 6 色標 rule (跟 Spec §8.1):
 *   - Golden entry: BUY + hit + mark 4-5 → 深綠
 *   - 一般啱: BUY + hit + (mark 1-3 OR NO_JOURNAL) → 淺綠
 *   - 觀望: HOLD / WAIT → 黃
 *   - 一般錯: BUY + miss + mark 1-3 → 淺橙
 *   - 嚴重錯: BUY + miss + mark 4-5 → 深橙
 *   - 危險: SELL / REDUCE / TRAP / TRANSITION → 紅
 *   - 冇 mark: NO_JOURNAL (非 BUY) → 灰
 */
function getActionColor(action: string, hit: boolean | null, markCorrect: number | null, markWrong: number | null): string {
  const isBuy = action === 'BUY' || action === 'ADD';
  const isHoldOrWait = action === 'HOLD' || action === 'WAIT';
  const isDanger = action === 'SELL' || action === 'REDUCE' || action === 'TRAP' || action === 'TRANSITION';

  if (isBuy && hit === true) {
    // BUY + hit
    if (markCorrect !== null && markCorrect >= GOLDEN_ENTRY_MARK_THRESHOLD) {
      return TIMELINE_COLORS.GOLDEN;          // 深綠 golden
    }
    return TIMELINE_COLORS.HIT_GENERAL;       // 淺綠
  }
  if (isBuy && hit === false) {
    // BUY + miss
    if (markWrong !== null && markWrong >= GOLDEN_ENTRY_MARK_THRESHOLD) {
      return TIMELINE_COLORS.MISS_SEVERE;     // 深橙 嚴重錯
    }
    return TIMELINE_COLORS.MISS_GENERAL;      // 淺橙
  }
  if (isHoldOrWait) {
    return TIMELINE_COLORS.WAIT;              // 黃
  }
  if (isDanger) {
    return TIMELINE_COLORS.SELL_DANGER;       // 紅
  }
  return TIMELINE_COLORS.NO_JOURNAL;          // 灰
}

/** Golden entry: fwd5 ≥ 3% + hit + mark 4-5 */
function isGoldenEntry(dp: TimelineDataPoint): boolean {
  return (
    dp.fwd5 !== null &&
    dp.fwd5 >= GOLDEN_ENTRY_FWD5_THRESHOLD &&
    dp.hit === true &&
    dp.markCorrect !== null &&
    dp.markCorrect >= GOLDEN_ENTRY_MARK_THRESHOLD
  );
}

function computeView(dataPoints: TimelineDataPoint[]): TimelineDataPoint[] {
  return dataPoints.map((dp) => ({
    ...dp,
    color: getActionColor(dp.action, dp.hit, dp.markCorrect, dp.markWrong),
    isGoldenEntry: isGoldenEntry(dp),
  }));
}

// =============================================================
// Step 5: 計算 Stats Summary
// =============================================================

function avg(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function countBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, number> {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

function computeStats(dataPoints: TimelineDataPoint[]): TimelineStats {
  const validFwd5 = dataPoints.filter((d) => d.fwd5 !== null);
  const hits = validFwd5.filter((d) => d.hit === true);
  const validFwd10 = dataPoints.filter((d) => d.fwd10 !== null);
  const validFwd20 = dataPoints.filter((d) => d.fwd20 !== null);
  const journalEntries = dataPoints.filter((d) => d.journalEntry !== null);
  const goldenEntries = dataPoints.filter((d) => d.isGoldenEntry);

  return {
    totalVerdicts: dataPoints.length,
    totalJournalEntries: journalEntries.length,
    hitRate5d: hits.length / (validFwd5.length || 1) || (validFwd5.length === 0 ? null : 0),
    avgFwd5: avg(validFwd5.map((d) => d.fwd5!)),
    avgFwd10: avg(validFwd10.map((d) => d.fwd10!)),
    avgFwd20: avg(validFwd20.map((d) => d.fwd20!)),
    actionBreakdown: countBy(dataPoints, (d) => d.action),
    matchBreakdown: countBy(dataPoints, (d) => d.predictionVsActual) as Record<PredictionVsActual, number>,
    goldenEntries: goldenEntries.length,
  };
}

// =============================================================
// Main analyze function (pure, testing 用)
// =============================================================

/**
 * Pure algorithm 入口, testing / SSR 用
 * 真實 browser call 經 adapter.mjs 嘅 backtestTimelineAdapter.analyze() 走 fetch API
 */
export function analyzeBacktestTimeline(input: BacktestTimelineInput): TimelineResult {
  const { symbol, dateRange = 90 } = input;
  const forwardReturnHistory = input.forwardReturnHistory ?? [];
  const tradeJournalEntries = input.tradeJournalEntries ?? [];

  // Sort forward returns by date ascending
  const sortedFR = [...forwardReturnHistory].sort((a, b) => a.date.localeCompare(b.date));
  // Filter to date range
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - dateRange);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);
  const filteredFR = sortedFR.filter((r) => r.date >= cutoffStr);

  const sortedJ = [...tradeJournalEntries].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  const filteredJ = sortedJ.filter((j) => j.entry_date >= cutoffStr);

  // Step 3: 對齊日期
  const aligned = alignDates(filteredFR, filteredJ);

  // Step 4: 計算整合 view
  const viewed = computeView(aligned);

  // Step 5: 計算 stats
  const stats = computeStats(viewed);

  // 計算 date range
  const startDate = viewed.length > 0 ? viewed[0].date : cutoffStr;
  const endDate = viewed.length > 0 ? viewed[viewed.length - 1].date : new Date().toISOString().slice(0, 10);

  return {
    symbol,
    dateRange: { start: startDate, end: endDate, days: dateRange },
    totalPoints: viewed.length,
    dataPoints: viewed,
    stats,
    meta: {
      forwardReturnCount: filteredFR.length,
      journalCount: filteredJ.length,
      dateRangeUsed: dateRange,
      dataLimited: filteredFR.length < sortedFR.length,  // 有 data 被 filter 走
    },
  };
}

// =============================================================
// LLM hook interface (大少永久 rule 13:30 — 預留將來 swap LLM)
// =============================================================

/**
 * M11 render function 必須有 LLM hook interface
 * Sprint 2 用 hardcoded template, 將來 swap 落 LLM call
 * 對應: M8 永久 rule (commit 36496159) + M11 spec §8.2
 */
export async function generateTimelineInterpretation(ctx: {
  symbol: string;
  stats: TimelineStats;
  bestGolden: TimelineDataPoint | null;
  worstMiss: TimelineDataPoint | null;
}): Promise<string> {
  const { symbol, stats, bestGolden, worstMiss } = ctx;

  // Hardcoded template (Stage 2 v0.1.0, plain language + 揸車比喻)
  let interp = `「${symbol} 過去 ${stats.totalVerdicts} 個 verdict, 其中 ${stats.hitRate5d !== null ? (stats.hitRate5d * 100).toFixed(0) : 'N/A'}% 5 日內有升。`;

  if (stats.totalJournalEntries > 0) {
    interp += `大少落實咗 ${stats.totalJournalEntries} 個 trade, `;
    const matchRate = (stats.matchBreakdown.MATCH / stats.totalJournalEntries) * 100;
    interp += `match rate ${matchRate.toFixed(0)}% (預測同實戰一致)。`;
  } else {
    interp += `大少仲未 mark 任何 trade, 建議去 Trade Journal 加幾條參考。`;
  }

  if (stats.goldenEntries > 0) {
    interp += `揀到 ${stats.goldenEntries} 個黃金買點, `;
    if (bestGolden) {
      interp += `最勁係 ${bestGolden.date}: ${bestGolden.action} → 5 日後升 ${bestGolden.fwd5!.toFixed(1)}%`;
      if (bestGolden.markCorrect) {
        interp += `, 大少 mark ${bestGolden.markCorrect}/5`;
      }
    }
    interp += `。`;
  }

  if (worstMiss && worstMiss.fwd5 !== null) {
    interp += `最差係 ${worstMiss.date}: ${worstMiss.action} → 5 日後 ${worstMiss.fwd5 > 0 ? '升' : '跌'} ${Math.abs(worstMiss.fwd5).toFixed(1)}%`;
    if (worstMiss.markWrong) {
      interp += `, 大少 mark 錯 ${worstMiss.markWrong}/5`;
    }
    interp += `。`;
  }

  interp += `呢個 timeline 顯示 algorithm 對呢隻股票嘅判斷有參考價值, 建議持續累積 Trade Journal 樣本。`;

  return interp;
}

// =============================================================
// Helpers for browser/SSR (Step 1+2 fetch helpers)
// =============================================================

/** Browser-side fetch helper: 拎 forward return history */
export async function fetchForwardReturnHistory(symbol: string, limit: number = 200): Promise<ForwardReturnRecord[]> {
  try {
    const resp = await fetch(`http://localhost:18792/api/adaptive-params/${encodeURIComponent(symbol)}/forward-return?limit=${limit}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.history || [];
  } catch (e) {
    console.warn(`[backtest-timeline] fetch forward return history failed:`, e);
    return [];
  }
}

/** Browser-side fetch helper: 拎 trade journal entries */
export async function fetchTradeJournal(symbol: string, limit: number = 200): Promise<TradeJournalEntry[]> {
  try {
    const resp = await fetch(`http://localhost:18792/api/trade-journal?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.entries || [];
  } catch (e) {
    console.warn(`[backtest-timeline] fetch trade journal failed:`, e);
    return [];
  }
}
