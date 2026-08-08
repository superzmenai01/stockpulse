// std-verdict.ts — AS-03 · Standard Verdict 通用 helper
//
// 大少 2026-08-08 12:00 — Sprint 1 sub-task 1.1 嘅 core file
//
// 用途:
//   6 個 modules (M1-M6) 各自有自己嘅 internal output shape (e.g. ma-alignment 嘅
//   MAAlignmentV2VerdictMeta, volatility 嘅 meta), M7 Synthesizer 想 aggregate 佢哋
//   必須先有 standard format。呢個 file 提供通用 helper:
//     - computeSentiment6D(klines)   → 6 維情緒雷達
//     - computeExpectedReturn(state, confidence)  → 預期回報率
//     - computeMaxDrawdownEstimate(klines)        → 最大回撤估計
//     - toStandardVerdict(verdict, klines, moduleId, moduleSpecific, rulesFired)
//                                       → 統一標準 verdict (M7/M8 input)
//     - runAndStandardize(module, klines, ctx, moduleId, options)
//                                       → 一次過 detect() + standardize() (convenience)
//
// 設計原則:
//   - 純 math, 唔用 AI / LLM
//   - 唔改任何 module 嘅 internal logic, 只係 add wrapper
//   - sentiment_6d 6 維全部 modules 用同一個 algorithm (universal, 唔係 module-specific)
//   - expected_return / max_drawdown_estimate 全部 modules 用同一個 formula
//
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-07-08-DECISION-ENGINE.md §2

import { BASE_WEIGHTS } from './types.ts';
import type {
  CycleContext, CycleModule, CycleModuleId, CycleState, CycleVerdict, KLine,
  ModuleStandardVerdict, Sentiment6D,
} from './types.ts';

// =============================================================
// 工具函數 (技術指標純計算, 唔用任何 AI)
// =============================================================

/** Simple Moving Average */
function sma(values: number[], period: number): number {
  if (values.length < period) return values.reduce((a, b) => a + b, 0) / values.length;
  const tail = values.slice(-period);
  return tail.reduce((a, b) => a + b, 0) / period;
}

/** Standard deviation */
function stddev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sqDiff = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  return Math.sqrt(sqDiff / values.length);
}

/** Wilder's RSI(period) — 最後一個 value */
function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;  // 中性 fallback
  const tail = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < tail.length; i++) {
    const diff = tail[i] - tail[i - 1];
    if (diff > 0) gains += diff;
    else losses += -diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/** Bollinger %B 標準化 (0 = 中線, 1 = 上軌, 0 = 下軌) */
function computeBollingerPctB(closes: number[], period = 20, stdMult = 2): number {
  if (closes.length < period) return 0.5;
  const tail = closes.slice(-period);
  const mean = sma(tail, period);
  const sd = stddev(tail);
  const upper = mean + stdMult * sd;
  const lower = mean - stdMult * sd;
  const last = tail[tail.length - 1];
  if (upper === lower) return 0.5;
  return (last - lower) / (upper - lower);
}

/** 乖離率: (現價 - MA20) / MA20, return 限制 ±20% (clamp) */
function computeBiasRatio(closes: number[], period = 20): number {
  if (closes.length < period) return 0;
  const mean = sma(closes, period);
  if (mean === 0) return 0;
  const last = closes[closes.length - 1];
  return (last - mean) / mean;
}

/** Average True Range (period) — 最後一個 value */
function computeATR(klines: KLine[], period = 20): number {
  if (klines.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const high = klines[i].high;
    const low = klines[i].low;
    const prevClose = klines[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    trs.push(tr);
  }
  if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length;
  // Wilder's smoothing
  let atr = sma(trs.slice(0, period), period);
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

/** Rate of Change: % change over period */
function computeROC(closes: number[], period = 10): number {
  if (closes.length < period + 1) return 0;
  const last = closes[closes.length - 1];
  const past = closes[closes.length - 1 - period];
  if (past === 0) return 0;
  return (last - past) / past;
}

/** 換手率比: 20 日平均 volume vs 250 日 baseline
 *  返回 ratio (>1 = 近期活躍, <1 = 近期淡靜)
 */
function computeTurnoverRatio(klines: KLine[], short = 20, long = 250): number {
  if (klines.length < short) return 1.0;
  const volumes = klines.map(k => k.volume);
  const shortAvg = sma(volumes, short);
  if (klines.length < long) return 1.0;  // baseline 不足, 預設 1.0
  const longAvg = sma(volumes, long);
  if (longAvg === 0) return 1.0;
  return shortAvg / longAvg;
}

// =============================================================
// 6 維情緒雷達
// =============================================================

/** 標準化 helper: clamp 到 [-1, +1] */
function clamp(value: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

/** 標準化 helper: linear map [a, b] → [-1, +1] */
function normalize(value: number, a: number, b: number): number {
  if (a === b) return 0;
  const t = (value - a) / (b - a);
  return clamp(t * 2 - 1);
}

/** 6 維情緒雷達 — 全部 modules 通用
 *  Input: KLine array
 *  Output: Sentiment6D, 每個 field 範圍 [-1, +1]
 */
export function computeSentiment6D(klines: KLine[]): Sentiment6D {
  if (!klines || klines.length === 0) {
    // 數據不足, 全部 fallback 0 (中性)
    return { rsi: 0, bollinger_pct_b: 0, bias_ratio: 0, vol_skew: 0, turnover: 0, momentum_accel: 0 };
  }

  const closes = klines.map(k => k.close);

  // 1. RSI 標準化: (rsi - 50) / 50 → [-1, +1]
  //    RSI=30 → -0.4 (弱), RSI=70 → +0.4 (強)
  const rsiRaw = computeRSI(closes, 14);
  const rsi = clamp((rsiRaw - 50) / 50);

  // 2. Bollinger %B 標準化: %B × 2 - 1 → [-1, +1]
  //    %B=0 (下軌) → -1, %B=1 (上軌) → +1, %B=0.5 (中線) → 0
  const pctB = computeBollingerPctB(closes, 20, 2);
  const bollinger_pct_b = clamp(pctB * 2 - 1);

  // 3. 乖離率標準化: ±20% 限制, 超過就 clamp
  //    +10% → +0.5 (偏強), -10% → -0.5 (偏弱)
  const biasRaw = computeBiasRatio(closes, 20);
  const bias_ratio = clamp(biasRaw / 0.20);

  // 4. 波動偏度: 比較最近 10 日 ATR vs 之前 20 日 ATR
  //    >1 = 近期波動擴張, <1 = 收縮
  const vol_skew = klines.length < 30
    ? 0  // 數據不足
    : (() => {
        const recentATR = computeATR(klines.slice(-10), 10);
        const prevATR = computeATR(klines.slice(-30, -10), 20);
        const skewRatio = prevATR > 0 ? recentATR / prevATR : 1;
        return clamp((skewRatio - 1) * 2);  // 1.0 = 中性, 1.5 → +1, 0.5 → -1
      })();

  // 5. 換手率比: 20 日 / 250 日 baseline
  //    >2.0 = 異常活躍, <0.5 = 異常淡靜
  const turnoverRaw = computeTurnoverRatio(klines, 20, 250);
  const turnover = clamp((turnoverRaw - 1) * 1.0);  // 2.0 → +1, 0.0 → -1

  // 6. 動能加速度: 10 日 ROC vs 5 日前嘅 10 日 ROC (derivative)
  //    正值 = 動能加速上升, 負值 = 動能減速
  const momentum_accel = klines.length < 30
    ? 0  // 數據不足
    : (() => {
        const rocNow = computeROC(closes, 10);
        const closesPrev = closes.slice(0, -5);
        const rocPast = computeROC(closesPrev, 10);
        return clamp((rocNow - rocPast) * 5);  // 0.2 difference → +1
      })();

  return { rsi, bollinger_pct_b, bias_ratio, vol_skew, turnover, momentum_accel };
}

// =============================================================
// expected_return — 預期回報率 [-0.10, +0.10]
// =============================================================

/** 預期回報率 — 全部 modules 通用 formula
 *  Formula: sign(state) × confidence × 0.10
 *    UP + 0.8 confidence → +0.08 (8%)
 *    DOWN + 0.8 confidence → -0.08 (-8%)
 *    SIDEWAYS → 0
 *    TRANSITION → 0 (不確定)
 *    TRAP → -0.05 (陷阱, 預設虧損)
 */
export function computeExpectedReturn(state: CycleState, confidence: number): number {
  const c = clamp(confidence, 0, 1);
  switch (state) {
    case 'UP': return +(c * 0.10).toFixed(4);
    case 'DOWN': return -(c * 0.10).toFixed(4);
    case 'TRAP': return -0.05;  // 固定 -5%, 因為 TRAP 預設虧損
    case 'SIDEWAYS':
    case 'TRANSITION':
    default: return 0;
  }
}

// =============================================================
// max_drawdown_estimate — 最大回撤估計 [0, 0.30]
// =============================================================

/** 最大回撤估計 — 全部 modules 通用 formula
 *  Formula: clamp(ATR(20) / close × 3, 0, 0.30)
 *    ATR 5% of close → 0.15 (15%)
 *    ATR 2% of close → 0.06 (6%)
 *    ATR 12% of close → 0.30 (capped)
 */
export function computeMaxDrawdownEstimate(klines: KLine[], atrPeriod = 20): number {
  if (!klines || klines.length < atrPeriod + 1) return 0.05;  // fallback 5%
  const atr = computeATR(klines, atrPeriod);
  const lastClose = klines[klines.length - 1].close;
  if (lastClose === 0) return 0.05;
  const ratio = (atr / lastClose) * 3;
  return clamp(ratio, 0, 0.30);
}

// =============================================================
// toStandardVerdict — 統一 wrapper
// =============================================================

export interface ToStandardVerdictInput {
  verdict: CycleVerdict;
  klines: KLine[];
  moduleId: CycleModuleId;
  rulesFired?: string[];
  moduleSpecific?: Record<string, unknown>;
}

/** 統一標準 verdict — M7 Synthesizer 嘅 input
 *  將任何 module 嘅 CycleVerdict + klines 轉去 ModuleStandardVerdict
 *
 *  流程:
 *    1. base_weight 從 BASE_WEIGHTS[moduleId] 拎
 *    2. expected_return 從 state + confidence 計
 *    3. max_drawdown_estimate 從 ATR 計
 *    4. sentiment_6d 從 closes 衍生
 *    5. rules_fired 從 input rulesFired 或者 evidence 拎
 *    6. module_specific 從 input 或 verdict.meta 拎
 */
export function toStandardVerdict(input: ToStandardVerdictInput): ModuleStandardVerdict {
  const { verdict, klines, moduleId, rulesFired, moduleSpecific } = input;

  // 1. base_weight
  const base_weight = BASE_WEIGHTS[moduleId];

  // 2. expected_return
  const expected_return = computeExpectedReturn(verdict.state, verdict.confidence);

  // 3. max_drawdown_estimate
  const max_drawdown_estimate = computeMaxDrawdownEstimate(klines);

  // 4. sentiment_6d
  const sentiment_6d = computeSentiment6D(klines);

  // 5. rules_fired — priority: explicit input > evidence type > fallback
  let finalRulesFired: string[] = [];
  if (rulesFired && rulesFired.length > 0) {
    finalRulesFired = rulesFired;
  } else if (verdict.evidence && verdict.evidence.length > 0) {
    finalRulesFired = verdict.evidence.map(e => e.type);
  } else {
    finalRulesFired = [];  // empty array
  }

  // 6. module_specific — priority: explicit input > verdict.meta
  const finalModuleSpecific: Record<string, unknown> = moduleSpecific
    ?? (verdict.meta as Record<string, unknown> | undefined)
    ?? {};

  return {
    state: verdict.state,
    confidence: clamp(verdict.confidence, 0, 1),
    base_weight,
    expected_return,
    max_drawdown_estimate,
    sentiment_6d,
    rules_fired: finalRulesFired,
    module_id: moduleId,
    module_specific: finalModuleSpecific,
    timestamp: verdict.timestamp,
  };
}

// =============================================================
// runAndStandardize — 一次過 detect() + toStandardVerdict() (convenience)
// =============================================================

export interface RunAndStandardizeOptions {
  rulesFired?: string[];
  moduleSpecific?: Record<string, unknown>;
}

/** 一次過 call module.detect() + toStandardVerdict()
 *  6 個 modules 嘅 wrapper 函數內部用呢個, 避免重複 code
 */
export async function runAndStandardize(
  module: CycleModule<KLine[]>,
  klines: KLine[],
  ctx: CycleContext,
  moduleId: CycleModuleId,
  options: RunAndStandardizeOptions = {},
): Promise<ModuleStandardVerdict> {
  const verdict = await module.detect(klines, ctx);
  return toStandardVerdict({
    verdict,
    klines,
    moduleId,
    rulesFired: options.rulesFired,
    moduleSpecific: options.moduleSpecific ?? (verdict.meta as Record<string, unknown> | undefined),
  });
}
