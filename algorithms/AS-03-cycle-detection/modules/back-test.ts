// back-test.ts — AS-03 Module 9 v0.1.0 — Back Test Replay Engine
//
// 大少 2026-08-08 22:28 指示 (Stage 3): 用 6+ 個月歷史 K 線 replay M8 verdict,
// 對比 5/10/20 日後真實升跌, 累積 forward return record.
// 9.1 範圍: 純 Replay engine (input K 線 + config → output ReplaySummary)
// 9.2-9.6 之後 commits 加 (coarse grid + walk-forward CV + per-symbol cache + testing page + pilot)

import type { KLine } from '../types.ts';
import type { DecisionVerdict } from './decision-engine.ts';

// =============================================================
// Types
// =============================================================

export interface ReplayConfig {
  symbol: string;                    // 'HK.00700' / 'US.AAPL'
  klines: KLine[];                   // 至少 holdDays[last] + lookbackDays 對上嘅 K 線
  startDate?: string;                // ISO 'YYYY-MM-DD', default = klines[0].date
  endDate?: string;                  // ISO 'YYYY-MM-DD', default = klines[last].date
  stepDays?: number;                 // default 5 (每 5 日跑一次 verdict)
  holdDays: number[];                // [5, 10, 20] 對比 hold 5/10/20 日後升跌
  lookbackDays?: number;             // 每個 replay point 拎之前幾多日 K 線, default 60
  params?: Record<string, any>;      // optional, 9.2 將加 coarse grid override
}

export interface ReplayResult {
  date: string;                      // verdict 當日 ISO
  action: string;                    // FinalAction: BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION
  closeAtVerdict: number;            // verdict 當日 close
  forwardReturn5d: number | null;    // % (closeAfter5d - closeAt) / closeAt × 100, null if no data
  forwardReturn10d: number | null;
  forwardReturn20d: number | null;
  hit5d: boolean | null;             // forwardReturn5d > 0, null if no data
  hit10d: boolean | null;
  hit20d: boolean | null;
  verdict: DecisionVerdict;          // 完整 verdict for reference
}

export interface ReplaySummary {
  symbol: string;
  config: ReplayConfig;
  results: ReplayResult[];
  totalDays: number;                 // stepDays 內 verdict count
  actionBreakdown: Record<string, number>;  // 8 個 finalAction count
  avgForwardReturn5d: number | null;
  avgForwardReturn10d: number | null;
  avgForwardReturn20d: number | null;
  hitRate5d: number | null;          // % of hit5d === true (excluding null)
  hitRate10d: number | null;
  hitRate20d: number | null;
}

// =============================================================
// Helpers
// =============================================================

/** 將 K 線 timestamp 轉做 ISO 'YYYY-MM-DD' */
function getKlineDate(kline: KLine): string {
  return new Date(kline.timestamp).toISOString().substring(0, 10);
}

/** 揾 K 線對應 index by date (拎第一個 timestamp >= target)
 *  - 早過 klines[0] → return 0
 *  - 過 klines[last] → return klines.length - 1
 */
function findKlineIndexByDate(klines: KLine[], date: string): number {
  if (klines.length === 0) return -1;
  const target = new Date(date).getTime();
  for (let i = 0; i < klines.length; i++) {
    if (klines[i].timestamp >= target) return i;
  }
  return klines.length - 1;
}

/** 計 forward return (percentage)
 *  - null if closeAfter is null/undefined or closeAt is 0
 */
function computeForwardReturn(closeAt: number, closeAfter: number | null | undefined): number | null {
  if (closeAfter === null || closeAfter === undefined || closeAt === 0) return null;
  return ((closeAfter - closeAt) / closeAt) * 100;
}

/** Hit boolean: forward return > 0 (null if no data) */
function computeHit(forwardReturn: number | null): boolean | null {
  if (forwardReturn === null) return null;
  return forwardReturn > 0;
}

/** 計 avg, skip null */
function computeAvg(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null && !isNaN(v));
  if (valid.length === 0) return null;
  const sum = valid.reduce((acc, v) => acc + v, 0);
  return sum / valid.length;
}

/** 計 hit rate (%) — null if all null */
function computeHitRate(hits: (boolean | null)[]): number | null {
  const valid = hits.filter((h): h is boolean => h !== null);
  if (valid.length === 0) return null;
  const countTrue = valid.filter(h => h === true).length;
  return (countTrue / valid.length) * 100;
}

/** Action breakdown count */
function computeActionBreakdown(results: ReplayResult[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const r of results) {
    breakdown[r.action] = (breakdown[r.action] || 0) + 1;
  }
  return breakdown;
}

// =============================================================
// Main entry — runReplay
// =============================================================

/**
 * Replay engine — 9.1 main entry
 *
 * Algorithm:
 *   1. Filter klines by [startDate, endDate]
 *   2. Generate step points: startIdx, startIdx+stepDays, ... ≤ endIdx
 *   3. For each step point:
 *      - 拎到 historical K 線 (lookbackDays 之前到 stepIdx)
 *      - Call decisionFn(historicalKlines, params) → verdict
 *      - 拎 step point 當日 close + 5/10/20 日後 close
 *      - 計 forward return + hit boolean
 *   4. Aggregate: action breakdown + avg return + hit rate
 *
 * Edge cases (大少 22:28 確認嘅):
 *   - Empty klines → empty summary (唔 throw)
 *   - 1 kline → 1 result, 全部 forward return null
 *   - startDate 早過 klines[0] → auto-shift
 *   - endDate 過 klines[last] → auto-cap
 *   - stepDays 太大 → 1-2 results
 *   - decisionFn throw → catch + skip 嗰個 step
 *
 * @param klines - 至少 holdDays[last] + lookbackDays 對上嘅 K 線
 * @param config - ReplayConfig
 * @param decisionFn - async (klines, options) => DecisionVerdict (e.g. decisionEngineAdapter.analyze)
 * @returns ReplaySummary
 */
export async function runReplay(
  klines: KLine[],
  config: ReplayConfig,
  decisionFn: (klines: KLine[], options: any) => Promise<DecisionVerdict>,
): Promise<ReplaySummary> {
  // Defaults
  const stepDays = config.stepDays ?? 5;
  const lookbackDays = config.lookbackDays ?? 60;
  const holdDays = config.holdDays ?? [5, 10, 20];

  // Empty input → empty summary
  if (klines.length === 0) {
    return {
      symbol: config.symbol,
      config,
      results: [],
      totalDays: 0,
      actionBreakdown: {},
      avgForwardReturn5d: null,
      avgForwardReturn10d: null,
      avgForwardReturn20d: null,
      hitRate5d: null,
      hitRate10d: null,
      hitRate20d: null,
    };
  }

  // Filter klines by [startDate, endDate]
  const startDate = config.startDate ?? getKlineDate(klines[0]);
  const endDate = config.endDate ?? getKlineDate(klines[klines.length - 1]);

  const startIdx = Math.max(0, findKlineIndexByDate(klines, startDate));
  const rawEndIdx = findKlineIndexByDate(klines, endDate);
  const endIdx = Math.min(klines.length - 1, Math.max(0, rawEndIdx));

  // Generate step points
  const results: ReplayResult[] = [];

  for (let stepIdx = startIdx; stepIdx <= endIdx; stepIdx += stepDays) {
    const stepKline = klines[stepIdx];

    // Historical K 線: lookbackDays 之前到 stepIdx
    const lookbackStartIdx = Math.max(0, stepIdx - lookbackDays);
    const historicalKlines = klines.slice(lookbackStartIdx, stepIdx + 1);

    // 太短就 skip (decision engine 一般要 ≥ 60 bars, 留 buffer)
    if (historicalKlines.length < 30) {
      continue;
    }

    try {
      // 跑 decision engine
      const verdict = await decisionFn(historicalKlines, config.params ?? {});

      // 拎 verdict 當日 close
      const closeAtVerdict = stepKline.close;

      // 拎 +holdDays[i] 日後 close
      const closeAfter5d = holdDays.includes(5) && stepIdx + 5 < klines.length ? klines[stepIdx + 5].close : null;
      const closeAfter10d = holdDays.includes(10) && stepIdx + 10 < klines.length ? klines[stepIdx + 10].close : null;
      const closeAfter20d = holdDays.includes(20) && stepIdx + 20 < klines.length ? klines[stepIdx + 20].close : null;

      // 計 forward return + hit
      const forwardReturn5d = computeForwardReturn(closeAtVerdict, closeAfter5d);
      const forwardReturn10d = computeForwardReturn(closeAtVerdict, closeAfter10d);
      const forwardReturn20d = computeForwardReturn(closeAtVerdict, closeAfter20d);

      const hit5d = computeHit(forwardReturn5d);
      const hit10d = computeHit(forwardReturn10d);
      const hit20d = computeHit(forwardReturn20d);

      results.push({
        date: getKlineDate(stepKline),
        action: verdict.final_action,
        closeAtVerdict,
        forwardReturn5d,
        forwardReturn10d,
        forwardReturn20d,
        hit5d,
        hit10d,
        hit20d,
        verdict,
      });
    } catch (err) {
      // decision engine throw, skip 嗰個 step, log warning
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[back-test] Replay at ${getKlineDate(stepKline)} failed: ${errMsg}`);
      continue;
    }
  }

  // Aggregate
  const totalDays = results.length;
  const actionBreakdown = computeActionBreakdown(results);
  const avgForwardReturn5d = computeAvg(results.map(r => r.forwardReturn5d));
  const avgForwardReturn10d = computeAvg(results.map(r => r.forwardReturn10d));
  const avgForwardReturn20d = computeAvg(results.map(r => r.forwardReturn20d));
  const hitRate5d = computeHitRate(results.map(r => r.hit5d));
  const hitRate10d = computeHitRate(results.map(r => r.hit10d));
  const hitRate20d = computeHitRate(results.map(r => r.hit20d));

  return {
    symbol: config.symbol,
    config,
    results,
    totalDays,
    actionBreakdown,
    avgForwardReturn5d,
    avgForwardReturn10d,
    avgForwardReturn20d,
    hitRate5d,
    hitRate10d,
    hitRate20d,
  };
}

// =============================================================
// Convenience: 永遠 full show forward return helper (testing page 用)
// =============================================================

/** Render forward return 永遠 full show (大少 11:57 永久 rule)
 *  - 有 data → "%+1.23%" (with sign + 2 decimal)
 *  - 冇 data → "N/A" (唔好 omit)
 *  - hit boolean 同時 display
 */
export function formatForwardReturn(
  forwardReturn: number | null,
  hit: boolean | null,
): { returnText: string; hitEmoji: string } {
  if (forwardReturn === null) {
    return { returnText: 'N/A', hitEmoji: '⚫' };
  }
  const sign = forwardReturn >= 0 ? '+' : '';
  const returnText = `${sign}${forwardReturn.toFixed(2)}%`;
  const hitEmoji = hit === true ? '🟢' : hit === false ? '🔴' : '⚫';
  return { returnText, hitEmoji };
}
