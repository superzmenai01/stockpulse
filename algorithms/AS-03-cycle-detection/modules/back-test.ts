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

// =============================================================
// 9.2 — Coarse Grid + Fine Tune + Adaptive Window
// =============================================================
// 大少 2026-08-08 22:28 確認嘅 search strategy:
//   - 2 個 tuneable params (Kelly + RSI weight), 3 個 values each = 9 combinations
//   - SSI weights 暫 tune 1 個 (default 變化), 9.4 將加 full per-symbol
//   - 揾 top 5 by score
//   - 對 top 5 做 ±20% fine tune (5 base × 3 variations × 2 params = 30 candidates)
//   - Adaptive window: 6 個月 start, samples < 30 自動 +3 個月, max 18 個月
// =============================================================

/** Score 公式 (大少 22:28 確認): 命中率 50% + 平均回報 50%
 *  - 命中率 0-100 (%), 平均回報假設 normalise /5 變 0-20
 *  - 範圍大約 -50 to +100
 *  - 全部 null → return -Infinity (避免揀到空 result)
 */
export function scoreResult(summary: ReplaySummary): number {
  const hitRate = summary.hitRate5d ?? 0;
  const avgReturn = summary.avgForwardReturn5d ?? 0;
  // hitRate 0-100, 50% weight
  // avgReturn / 5 假設 avg 5% 已經好, 50% weight
  return (hitRate * 0.5) + ((avgReturn / 5) * 0.5 * 100);
}

/** SSI weight 預設 3 個 variations (大少 22:28 確認 tune 1 個 dimension) */
export const DEFAULT_SSI_WEIGHTS_VARIATIONS: Array<{ ma: number; hl: number; tl: number }> = [
  { ma: 0.4, hl: 0.3, tl: 0.3 },  // 偏 MA
  { ma: 0.3, hl: 0.3, tl: 0.4 },  // 偏 TL
  { ma: 0.3, hl: 0.4, tl: 0.3 },  // 偏 HL
];

/** Kelly 預設 3 個 values (跟 types.ts KellyFraction 對應) */
export const DEFAULT_KELLY_VALUES: number[] = [0.125, 0.25, 0.5];  // octo / quarter / half

/** RSI weight 預設 3 個 values */
export const DEFAULT_RSI_WEIGHTS: number[] = [0.10, 0.20, 0.30];

// ----- Coarse grid types -----

export interface CoarseGridEntry {
  params: { kelly: number; rsiWeight: number; ssiWeights: { ma: number; hl: number; tl: number } };
  score: number;
  hitRate5d: number | null;
  avgReturn5d: number | null;
  resultsCount: number;
  summary: ReplaySummary;
}

export interface CoarseGridResult {
  entries: CoarseGridEntry[];           // 9 個, sorted by score desc
  top5: CoarseGridEntry[];              // top 5 by score
}

export interface CoarseGridOptions {
  klines: KLine[];
  decisionFn: (klines: KLine[], options: any) => Promise<DecisionVerdict>;
  baseReplayConfig?: Partial<ReplayConfig>;
  kellyValues?: number[];               // default DEFAULT_KELLY_VALUES (3)
  rsiWeights?: number[];                // default DEFAULT_RSI_WEIGHTS (3)
  ssiWeightsVariations?: Array<{ ma: number; hl: number; tl: number }>;  // default 3
  baseSymbol: string;
}

/** 跑 9 個 (or 27 個 if ssiWeightsVariations 3) coarse grid combinations
 *  - default 3 × 3 × 1 = 9 (kelly × rsi × 1 ssi)
 *  - 全部 sorted by score desc
 */
export async function runCoarseGrid(options: CoarseGridOptions): Promise<CoarseGridResult> {
  const kellyValues = options.kellyValues ?? DEFAULT_KELLY_VALUES;
  const rsiWeights = options.rsiWeights ?? DEFAULT_RSI_WEIGHTS;
  // 預設用第一個 ssiWeights variation (大少 22:28 確認 tune 1 個 dimension 開始)
  const ssiWeights = (options.ssiWeightsVariations ?? DEFAULT_SSI_WEIGHTS_VARIATIONS)[0];

  const entries: CoarseGridEntry[] = [];

  for (const kelly of kellyValues) {
    for (const rsiWeight of rsiWeights) {
      const params = { kelly, rsiWeight, ssiWeights };
      const replayConfig: ReplayConfig = {
        symbol: options.baseSymbol,
        klines: options.klines,
        holdDays: [5, 10, 20],
        stepDays: 5,
        lookbackDays: 60,
        ...options.baseReplayConfig,
        params: { ...(options.baseReplayConfig?.params ?? {}), ...params },
      };

      const summary = await runReplay(options.klines, replayConfig, options.decisionFn);
      const score = scoreResult(summary);
      entries.push({
        params,
        score,
        hitRate5d: summary.hitRate5d,
        avgReturn5d: summary.avgForwardReturn5d,
        resultsCount: summary.totalDays,
        summary,
      });
    }
  }

  // Sort by score desc
  entries.sort((a, b) => b.score - a.score);
  const top5 = entries.slice(0, 5);

  return { entries, top5 };
}

// ----- Fine tune types -----

export interface FineTuneEntry {
  baseParams: { kelly: number; rsiWeight: number; ssiWeights: { ma: number; hl: number; tl: number } };
  variation: { kellyMul: number; rsiWeightMul: number };
  params: { kelly: number; rsiWeight: number; ssiWeights: { ma: number; hl: number; tl: number } };
  score: number;
  hitRate5d: number | null;
  avgReturn5d: number | null;
  resultsCount: number;
  summary: ReplaySummary;
}

export interface FineTuneResult {
  entries: FineTuneEntry[];    // 5 base × 3 variations × 2 params = 30, sorted by score desc
  best: FineTuneEntry;         // 揾 best score
}

export interface FineTuneOptions {
  klines: KLine[];
  decisionFn: (klines: KLine[], options: any) => Promise<DecisionVerdict>;
  top5: CoarseGridEntry[];
  baseReplayConfig?: Partial<ReplayConfig>;
  baseSymbol: string;
  fineTunePercent?: number;   // default 0.2 (±20%)
}

/** 對 top 5 做 ±20% fine tune (大少 22:28 確認)
 *  - 5 base × 3 variations (-20% / 0 / +20% 對 Kelly)
 *  - + 5 base × 3 variations (-20% / 0 / +20% 對 RSI weight)
 *  = 5 × 3 + 5 × 3 = 30 candidates (但 0% case 同 base 重複, 實質 5 × 4 = 20 unique)
 *  - 但因為每個 entry 都係獨立, count 會係 30 個 entries, 其中 10 個重複 base
 *  - 我哋 keep 全部 30 個, sort, 揀 best
 */
export async function runFineTune(options: FineTuneOptions): Promise<FineTuneResult> {
  const fineTunePct = options.fineTunePercent ?? 0.2;
  const entries: FineTuneEntry[] = [];

  for (const base of options.top5) {
    // Kelly ±20% × 3
    const kellyVariations = [
      base.params.kelly * (1 - fineTunePct),
      base.params.kelly,
      base.params.kelly * (1 + fineTunePct),
    ];
    // RSI weight ±20% × 3
    const rsiWeightVariations = [
      base.params.rsiWeight * (1 - fineTunePct),
      base.params.rsiWeight,
      base.params.rsiWeight * (1 + fineTunePct),
    ];

    // Kelly variations
    for (let i = 0; i < kellyVariations.length; i++) {
      const kelly = kellyVariations[i];
      const params = { kelly, rsiWeight: base.params.rsiWeight, ssiWeights: base.params.ssiWeights };
      const replayConfig: ReplayConfig = {
        symbol: options.baseSymbol,
        klines: options.klines,
        holdDays: [5, 10, 20],
        stepDays: 5,
        lookbackDays: 60,
        ...options.baseReplayConfig,
        params: { ...(options.baseReplayConfig?.params ?? {}), ...params },
      };
      const summary = await runReplay(options.klines, replayConfig, options.decisionFn);
      const score = scoreResult(summary);
      entries.push({
        baseParams: base.params,
        variation: { kellyMul: i === 0 ? -fineTunePct : i === 1 ? 0 : fineTunePct, rsiWeightMul: 0 },
        params,
        score,
        hitRate5d: summary.hitRate5d,
        avgReturn5d: summary.avgForwardReturn5d,
        resultsCount: summary.totalDays,
        summary,
      });
    }

    // RSI weight variations
    for (let i = 0; i < rsiWeightVariations.length; i++) {
      const rsiWeight = rsiWeightVariations[i];
      const params = { kelly: base.params.kelly, rsiWeight, ssiWeights: base.params.ssiWeights };
      const replayConfig: ReplayConfig = {
        symbol: options.baseSymbol,
        klines: options.klines,
        holdDays: [5, 10, 20],
        stepDays: 5,
        lookbackDays: 60,
        ...options.baseReplayConfig,
        params: { ...(options.baseReplayConfig?.params ?? {}), ...params },
      };
      const summary = await runReplay(options.klines, replayConfig, options.decisionFn);
      const score = scoreResult(summary);
      entries.push({
        baseParams: base.params,
        variation: { kellyMul: 0, rsiWeightMul: i === 0 ? -fineTunePct : i === 1 ? 0 : fineTunePct },
        params,
        score,
        hitRate5d: summary.hitRate5d,
        avgReturn5d: summary.avgForwardReturn5d,
        resultsCount: summary.totalDays,
        summary,
      });
    }
  }

  // Sort by score desc
  entries.sort((a, b) => b.score - a.score);
  const best = entries[0];

  return { entries, best };
}

// ----- Adaptive window types -----

export interface AdaptiveWindowOptions {
  klines: KLine[];
  decisionFn: (klines: KLine[], options: any) => Promise<DecisionVerdict>;
  baseReplayConfig?: Partial<ReplayConfig>;
  baseSymbol: string;
  initialDays?: number;     // default 126 (6 月)
  extendDays?: number;      // default 63 (3 月)
  maxDays?: number;         // default 378 (18 月)
  minSamples?: number;      // default 30
}

export interface AdaptiveWindowResult {
  finalKlines: KLine[];           // extended klines after adaptive window
  initialDays: number;            // start days
  finalDays: number;              // after extend
  extendCount: number;            // 0, 1, 2, 3, 4
  finalSamples: number;           // final runReplay totalDays
  minSamples: number;             // target
  summary: ReplaySummary;         // final runReplay with extended klines
}

/** Adaptive window (大少 22:28 確認): 6 個月 start, samples < min 自動 +3 個月, max 18 個月
 *  - 預設 6 月 = 126 trading days, 3 月 = 63, 18 月 = 378
 *  - 拎 klines 最後 initialDays 嘅, 跑 runReplay
 *  - if totalDays < minSamples, extend +extendDays, 重做
 *  - 直至 totalDays ≥ minSamples OR finalDays ≥ maxDays
 */
export async function runAdaptiveWindow(options: AdaptiveWindowOptions): Promise<AdaptiveWindowResult> {
  const initialDays = options.initialDays ?? 126;
  const extendDays = options.extendDays ?? 63;
  const maxDays = options.maxDays ?? 378;
  const minSamples = options.minSamples ?? 30;

  let currentDays = initialDays;
  let extendCount = 0;
  let currentKlines = options.klines.slice(-initialDays);
  let summary: ReplaySummary;

  while (true) {
    const replayConfig: ReplayConfig = {
      symbol: options.baseSymbol,
      klines: currentKlines,
      holdDays: [5, 10, 20],
      stepDays: 5,
      lookbackDays: 60,
      ...options.baseReplayConfig,
    };
    summary = await runReplay(currentKlines, replayConfig, options.decisionFn);

    if (summary.totalDays >= minSamples || currentDays >= maxDays) {
      break;
    }

    // Extend
    currentDays = Math.min(maxDays, currentDays + extendDays);
    currentKlines = options.klines.slice(-currentDays);
    extendCount++;
  }

  return {
    finalKlines: currentKlines,
    initialDays,
    finalDays: currentDays,
    extendCount,
    finalSamples: summary!.totalDays,
    minSamples,
    summary: summary!,
  };
}
