// modules/indicators.ts — AS-03 · 點 4: 動能背馳與衰竭檢測法 v0.2.0
// (Momentum Divergence & Exhaustion Detector)
//
// 對應 spec: `docs/research/AS-03-cycle-detection/MODULE-04-MOMENTUM-DIVERGENCE.md` v0.2.0
// 對應 backend: backend/algorithms/indicators/algorithm.py v0.2.0 (1:1 port, 2026-09-09 01:55 Spec Sync #52)
//
// 從 docx `docs/演算法概念SPECS/04動能背馳與衰竭檢測法.docx` (Kimi v1.0) 落地:
// - 計算 RSI(14) + MACD(12/26/9) 內部計
// - 3-window local extremum detection
// - 背馳檢測 (頂背馳 / 底背馳, RSI + MACD)
// - 衰竭分數 (RSI 極端 + MACD 縮小 + 背馳)
// - 交易訊號 (買入 / 賣出 / 觀望)
// - 勝率估算 + 歷史機會回顧
// - 統一 cycle state 派生: buy→UP, sell→DOWN, hold→SIDEWAYS
//
// v0.2.0 改動 (大少 2026-09-09 Spec Sync #52, 12 個 fix):
// - A1 Hurst+ADX regime gate (import computeHurst + computeAdx from trendline, 對齊 M3 Spec Sync #45 永久 rule)
// - A2 signalThreshold 0.6 → 0.5 (config.ts 對齊)
// - A3 M1 state trend filter (caller inject 落 ctx.m1State, M1 state 矛盾即降權 50% + emit FALLBACK_USED warning)
// - A4 emit 5 個 self-check warning (INSUFFICIENT_DATA / CONFLICT_STATE / FALLBACK_USED / THRESHOLD_BREACH / MODULE_PARTIAL)
// - A5 self-check penalty 公式 max(conf * 0.375, 0.3) floor (對齊 M2 9月7日 22:00 永久 rule spirit)
// - A6 meta.symbol caller symbol (從 ctx.symbol 拎, 唔好 hardcode "TEST" / "UNKNOWN")
// - A7 RSI + MACD 背馳 cross-confirm bonus × 1.2 (兩條 indicator 同時 trigger 信心提升)
// - A8 lookbackDays 60 → 250 (config.ts 對齊, 1 年尺度)
// - B1 永久 ban confidence 1.0, clamp 0.95 (對齊 M3 Layer 4 formula 永久 rule)
// - B2 confirmation candle (放量 + 收 > MA5, 對齊 Arxum 67% win rate research)
// - B3 RSI 5 日 linear slope (rsi[-1] - rsi[-6], 對齊 trend, 唔再用單點 vs 5 日 average)
//
// 跟 ma-alignment.ts / hl-structure.ts / trendline.ts / volume.ts
// pattern 一致 (rule-based + additive confidence + list all matched rules)
// 大少 2026-08-07 23:15 — slope-momentum.ts 暫時隱藏,Stage 1 done 最後先做返
//
// 永久 Rules:
// - Rule-based + additive confidence (大少 #10097)
// - List all matched rules (唔好 silently pick 一個)
// - State 統一: UP/DOWN/SIDEWAYS (TRANSITION 由 Synthesizer 判)
// - Plain language 解讀 (大少 #10299)
// - _warnings 永遠 inlined 落 verdict (永久 rule v1.1.0 spirit)
// - 永遠 emit symbol 從 ctx.symbol (永久 rule 9月7日 08:30 verdict.meta.symbol)
// - 永遠 ban conf 1.0, clamp 0.95 (M3 Layer 4 永久 rule)
// - Self-check warning 觸發即 floor conf 0.3 (M2 9月7日 22:00 永久 rule spirit)

import type {
  CycleContext, CycleModule, CycleVerdict, Evidence, KLine, CycleState, ModuleStandardVerdict,
} from '../types.ts';
import { DEFAULT_INDICATORS_CONFIG, type IndicatorsConfig } from '../config.ts';
import { runAndStandardize } from '../std-verdict.ts';
// v0.2.0 A1: 對齊 M3 Spec Sync #45 永久 rule, import Hurst+ADX 對齊 backend
// 注意: frontend trendline.ts function 名係 computeHurst (返 number) + computeAdx (返 number),
// 唔係 backend _compute_hurst (返 tuple) + _compute_adx (返 dict) — 兩邊 signature 唔同, frontend 簡化版
import { computeHurst, computeAdx } from './trendline.ts';

// ============ Internal types ============

interface IndicatorPoint {
  index: number;
  date: string;
  value: number;
}

interface DivergenceEvent {
  type: 'bullish_divergence' | 'bearish_divergence';
  indicator: 'rsi' | 'macd';
  pricePoint1: number;          // 較早嘅 price extremum
  pricePoint2: number;          // 較新嘅 price extremum
  indicatorPoint1: number;
  indicatorPoint2: number;
  strength: number;             // 0 - 1 (跟 docx §3 strength formula)
  index1: number;
  index2: number;
  date1: string;
  date2: string;
}

interface HistoricalOpportunity {
  date: string;
  price: number;
  signalStrength: number;
  reason: string;
  returnToDate: number;
  missed: boolean;
}

interface MomentumInternal {
  rsiSeries: number[];
  macdSeries: number[];         // histogram (DIF - DEA)
  rsiLatest: number;
  macdLatest: number;
  rsiTrend: 'rising' | 'falling';
  macdTrend: 'rising' | 'falling';
  macdState: 'bullish_accelerating' | 'bullish_decelerating' | 'bearish_accelerating' | 'bearish_decelerating';
  isOverbought: boolean;
  isOversold: boolean;
}

// v0.2.0 A3: M1 state inject 落 computeSignal 對齊 backend algorithm_runner.py pattern
interface ComputeSignalOptions {
  m1State?: 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION';  // M1 state, 用嚟 cross-module alignment
}

function round(n: number, decimals: number = 4): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ============ Indicator calculators ============

/**
 * Wilder RSI (跟 docx Step 1: 標準 Wilder's smoothing)
 *
 * 第一個 RSI 值 = 100 - 100 / (1 + avgGain / avgLoss)
 * 之後: avgGain = (prevAvgGain * (period - 1) + gain) / period
 *       avgLoss = (prevAvgLoss * (period - 1) + loss) / period
 */
function calculateRSI(closes: number[], period: number): number[] {
  const rsi: number[] = [];
  if (closes.length < period + 1) return rsi;

  // Initial avgGain / avgLoss
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff;
    else lossSum += -diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  // First RSI value (對應 index = period)
  const firstRs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRs));

  // 後續 RSI values (Wilder smoothing)
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }
  }
  return rsi;
}

/**
 * EMA 計算 (跟 docx Step 1: MACD 用嘅 EMA)
 *
 * multiplier = 2 / (period + 1)
 * ema[i] = close * mult + ema[i-1] * (1 - mult)  for i >= period
 * ema[period-1] = SMA(values[0..period-1])  (seed)
 * 大少 v0.1.0 fix: 之前用 push 模式有 off-by-one bug,ema[i-1] access undefined
 * 改用 array index 直接 assign,確保 i-1 一定 valid
 */
function calculateEMA(values: number[], period: number): number[] {
  const ema: number[] = new Array(values.length).fill(0);
  if (values.length < period) return [];
  const mult = 2 / (period + 1);

  // SMA seed at index period-1
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  ema[period - 1] = sum / period;

  // Wilder smoothing (從 period 開始)
  for (let i = period; i < values.length; i++) {
    ema[i] = values[i] * mult + ema[i - 1] * (1 - mult);
  }
  return ema.slice(period - 1);
}

/**
 * MACD (12/26/9) — 回返 histogram (DIF - DEA) series
 *
 * emaFast 對齊到 closes[11..] (period 12)
 * emaSlow 對齊到 closes[25..] (period 26)
 * DIF 從 emaSlow 開始位置對齊 (慢線 lag 較大)
 * DEA = EMA(DIF, 9)
 * histogram = DIF - DEA
 *
 * Returns array of length = closes.length - macdSlow, 對齊到 closes[macdSlow..]
 */
function calculateMACD(closes: number[], fast: number, slow: number, signal: number): number[] {
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  if (emaFast.length === 0 || emaSlow.length === 0) return [];

  // 對齊: emaFast[i] 對應 closes[fast-1+i]
  //        emaSlow[i] 對應 closes[slow-1+i]
  // DIF 從 slow 個 close 開始
  const dif: number[] = [];
  const alignedStart = slow - 1; // 對應 closes[alignedStart]
  // emaFast offset = alignedStart - (fast - 1) = slow - fast
  const emaFastOffset = alignedStart - (fast - 1);
  for (let i = 0; i < emaSlow.length; i++) {
    dif.push(emaFast[emaFastOffset + i] - emaSlow[i]);
  }

  // DEA = EMA(DIF, 9)
  const dea = calculateEMA(dif, signal);
  if (dea.length === 0) return [];

  // Histogram = DIF - DEA, 對齊到 DEA 開始
  const deaOffset = signal - 1; // DEA[i] 對應 dif[deaOffset + i]
  const histogram: number[] = [];
  for (let i = 0; i < dea.length; i++) {
    histogram.push(dif[deaOffset + i] - dea[i]);
  }
  return histogram;
}

/**
 * 3-window local extremum detection (跟 docx Step 2)
 *
 * 對 index i, 睇 [i-w, i+w] 共 2w+1 點
 * peak if value > all neighbors in [i-w, i+w] except itself
 * trough if value < all neighbors
 * 邊界 (i < w 或 i > n-w-1) 跳過
 */
function findLocalExtrema(series: number[], w: number): { peaks: IndicatorPoint[]; troughs: IndicatorPoint[] } {
  const peaks: IndicatorPoint[] = [];
  const troughs: IndicatorPoint[] = [];
  if (series.length < 2 * w + 1) return { peaks, troughs };

  for (let i = w; i < series.length - w; i++) {
    let isPeak = true;
    let isTrough = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (series[j] >= series[i]) isPeak = false;
      if (series[j] <= series[i]) isTrough = false;
      if (!isPeak && !isTrough) break;
    }
    if (isPeak) {
      peaks.push({ index: i, date: '', value: series[i] });
    } else if (isTrough) {
      troughs.push({ index: i, date: '', value: series[i] });
    }
  }
  return { peaks, troughs };
}

/**
 * 揾最接近 targetIndex 嘅 indicator extremum
 */
function findNearestExtremum(
  extrema: IndicatorPoint[],
  targetIndex: number,
): IndicatorPoint | null {
  if (extrema.length === 0) return null;
  let nearest = extrema[0];
  let minDist = Math.abs(extrema[0].index - targetIndex);
  for (const e of extrema) {
    const d = Math.abs(e.index - targetIndex);
    if (d < minDist) {
      minDist = d;
      nearest = e;
    }
  }
  return nearest;
}

/**
 * 背馳檢測 (跟 docx Step 3)
 *
 * 對每對 (priceExtrema, indicatorExtrema):
 * - 取最近 2 個同類型極值
 * - 計算 swing, 太細跳過
 * - 對齊 indicator extremum
 * - 判定頂背馳 (bearish) / 底背馳 (bullish)
 */
function detectDivergence(
  priceExtrema: IndicatorPoint[],
  indicatorExtrema: IndicatorPoint[],
  tolerance: number,
  minSwing: number,
  dates: string[],
  indicator: 'rsi' | 'macd',
): DivergenceEvent[] {
  const out: DivergenceEvent[] = [];
  if (priceExtrema.length < 2 || indicatorExtrema.length === 0) return out;

  // 取最近 2 個
  const prev = priceExtrema[priceExtrema.length - 2];
  const curr = priceExtrema[priceExtrema.length - 1];

  const swing = Math.abs(curr.value - prev.value) / prev.value;
  if (swing < minSwing) return out;

  // 對齊 indicator
  const prevInd = findNearestExtremum(indicatorExtrema, prev.index);
  const currInd = findNearestExtremum(indicatorExtrema, curr.index);
  if (!prevInd || !currInd) return out;

  // 頂背馳 (price peak): curr.price > prev.price * (1 + tol) AND curr.ind < prev.ind
  if (curr.value > prev.value * (1 + tolerance) && currInd.value < prevInd.value) {
    const strength = (prevInd.value - currInd.value) / Math.abs(prevInd.value || 1);
    out.push({
      type: 'bearish_divergence',
      indicator,
      pricePoint1: prev.value,
      pricePoint2: curr.value,
      indicatorPoint1: prevInd.value,
      indicatorPoint2: currInd.value,
      strength: clamp(Math.abs(strength), 0, 1),
      index1: prev.index,
      index2: curr.index,
      date1: dates[prev.index] || '',
      date2: dates[curr.index] || '',
    });
  }
  // 底背馳 (price trough): curr.price < prev.price * (1 - tol) AND curr.ind > prev.ind
  else if (curr.value < prev.value * (1 - tolerance) && currInd.value > prevInd.value) {
    const strength = (currInd.value - prevInd.value) / Math.abs(prevInd.value || 1);
    out.push({
      type: 'bullish_divergence',
      indicator,
      pricePoint1: prev.value,
      pricePoint2: curr.value,
      indicatorPoint1: prevInd.value,
      indicatorPoint2: currInd.value,
      strength: clamp(Math.abs(strength), 0, 1),
      index1: prev.index,
      index2: curr.index,
      date1: dates[prev.index] || '',
      date2: dates[curr.index] || '',
    });
  }
  return out;
}

// ============ Main module ============

export class IndicatorsModule implements CycleModule<KLine[]> {
  readonly id = 'indicators' as const;
  readonly version = '0.2.0';  // v0.2.0 (大少 2026-09-09 Spec Sync #52, 12 個 fix)

  private readonly config: IndicatorsConfig;

  constructor(config: IndicatorsConfig = DEFAULT_INDICATORS_CONFIG) {
    this.config = config;
  }

  /**
   * 統一 kline timestamp -> date string
   */
  private klineDate(k: KLine): string {
    if (typeof k.timestamp === 'number') {
      const d = new Date(k.timestamp);
      return d.toISOString().split('T')[0];
    }
    return String(k.timestamp).split('T')[0].split(' ')[0];
  }

  /**
   * 計 RSI + MACD, 識別局部極值, 計背馳 + 動能狀態
   */
  private computeMomentum(klines: KLine[]): MomentumInternal {
    const closes = klines.map(k => k.close);
    const rsiSeries = calculateRSI(closes, this.config.rsiPeriod);
    const macdRaw = calculateMACD(closes, this.config.macdFast, this.config.macdSlow, this.config.macdSignal);

    // MACD 對齊到 kline 嘅 index: histogram[i] 對應 closes[slow + signal - 2 + i]
    // 用 0 填充前面未計算嘅位置,方便對齊
    const macdOffset = this.config.macdSlow + this.config.macdSignal - 2;
    const macdSeries: number[] = new Array(macdOffset).fill(0).concat(macdRaw);

    const rsiLatest = rsiSeries.length > 0 ? rsiSeries[rsiSeries.length - 1] : 50;
    const macdLatest = macdSeries.length > 0 ? macdSeries[macdSeries.length - 1] : 0;

    // v0.2.0 B3: 5 日 trend 改用 linear slope (凡人話: 之前用 rsi[-1] > AVG(rsi[-6:-1]) 唔算趨勢,
    // 永遠 1 個值 vs 1 個 average 唔穩) — 用 rsi[-1] - rsi[-6] 嘅 raw difference, threshold 5.0
    // (對齊 0-100 scale 嘅 5% 變化)
    let rsiTrend: MomentumInternal['rsiTrend'];
    if (rsiSeries.length >= 7) {
      const rsiSlope5d = rsiSeries[rsiSeries.length - 1] - rsiSeries[rsiSeries.length - 6];
      rsiTrend = rsiSlope5d > 5.0 ? 'rising' : rsiSlope5d < -5.0 ? 'falling' : 'falling';
    } else {
      rsiTrend = 'falling';
    }
    let macdTrend: MomentumInternal['macdTrend'];
    if (macdSeries.length >= 7) {
      const macdSlope5d = macdSeries[macdSeries.length - 1] - macdSeries[macdSeries.length - 6];
      macdTrend = macdSlope5d > 0 ? 'rising' : 'falling';
    } else {
      macdTrend = 'falling';
    }

    const isOverbought = rsiLatest > 70;
    const isOversold = rsiLatest < 30;

    let macdState: MomentumInternal['macdState'];
    if (macdLatest > 0 && macdTrend === 'rising') macdState = 'bullish_accelerating';
    else if (macdLatest > 0 && macdTrend === 'falling') macdState = 'bullish_decelerating';
    else if (macdLatest < 0 && macdTrend === 'falling') macdState = 'bearish_accelerating';
    else macdState = 'bearish_decelerating';

    return { rsiSeries, macdSeries, rsiLatest, macdLatest, rsiTrend, macdTrend, macdState, isOverbought, isOversold };
  }

  /**
   * Step 3: 背馳檢測
   */
  private detectDivergences(
    closes: number[],
    dates: string[],
    momentum: MomentumInternal,
  ): { rsiDiv: DivergenceEvent[]; macdDiv: DivergenceEvent[] } {
    const extW = 3; // 3-window 局部極值 (跟 docx Step 2)
    const { peaks: pricePeaks, troughs: priceTroughs } = findLocalExtrema(closes, extW);
    const { peaks: rsiPeaks, troughs: rsiTroughs } = findLocalExtrema(momentum.rsiSeries, extW);
    const { peaks: macdPeaks, troughs: macdTroughs } = findLocalExtrema(momentum.macdSeries, extW);

    const rsiDiv = [
      ...detectDivergence(pricePeaks, rsiPeaks, this.config.divergenceTolerance, this.config.minSwingPct, dates, 'rsi'),
      ...detectDivergence(priceTroughs, rsiTroughs, this.config.divergenceTolerance, this.config.minSwingPct, dates, 'rsi'),
    ];
    const macdDiv = [
      ...detectDivergence(pricePeaks, macdPeaks, this.config.divergenceTolerance, this.config.minSwingPct, dates, 'macd'),
      ...detectDivergence(priceTroughs, macdTroughs, this.config.divergenceTolerance, this.config.minSwingPct, dates, 'macd'),
    ];
    return { rsiDiv, macdDiv };
  }

  /**
   * Step 5: 衰竭分數
   */
  private computeExhaustionScore(
    momentum: MomentumInternal,
    rsiDiv: DivergenceEvent[],
    macdDiv: DivergenceEvent[],
  ): number {
    let score = 0;
    if (momentum.isOverbought) {
      score += 0.3 * (momentum.rsiLatest - 70) / 30;
    } else if (momentum.isOversold) {
      score += 0.3 * (30 - momentum.rsiLatest) / 30;
    }

    // MACD 柱狀體縮小 (最近 10 個)
    const last10 = momentum.macdSeries.slice(-10).map(Math.abs);
    const recentMax = Math.max(...last10);
    if (recentMax > 0) {
      const shrinkRatio = Math.abs(momentum.macdLatest) / recentMax;
      score += 0.3 * (1 - shrinkRatio);
    }

    if (rsiDiv.length > 0) {
      const maxStrength = Math.max(...rsiDiv.map(d => d.strength));
      score += 0.25 * maxStrength;
    }
    if (macdDiv.length > 0) {
      const maxStrength = Math.max(...macdDiv.map(d => d.strength));
      score += 0.25 * maxStrength;
    }

    return clamp(score, 0, 1);
  }

  /**
   * Step 6: 交易訊號 (v0.2.0 加 M1 state filter + cross-confirm bonus + ban 1.0 + confirmation candle)
   *
   * v0.2.0 改動:
   * - A3: 加 M1 state trend filter (caller inject 落 options.m1State)
   * - A7: RSI + MACD 背馳同時 trigger bonus × 1.2 (對齊 Tradealgo 71% win rate research)
   * - B1: 永久 ban signal strength > 0.95 (對齊 M3 Layer 4 永久 rule spirit)
   * - B2: 放量確認加 收 > MA5 (對齊 arxum 67% win rate)
   */
  private computeSignal(
    klines: KLine[],
    momentum: MomentumInternal,
    rsiDiv: DivergenceEvent[],
    macdDiv: DivergenceEvent[],
    options: ComputeSignalOptions = {},
  ): { type: 'buy' | 'sell' | 'hold'; strength: number; reasons: string[]; m1FilterApplied: boolean; crossConfirmed: boolean } {
    const reasons: string[] = [];
    let bullScore = 0;
    let bearScore = 0;
    let m1FilterApplied = false;  // v0.2.0 A3: flag 通知 caller emit FALLBACK_USED warning

    const allDiv = [...rsiDiv, ...macdDiv];
    const hasBullDiv = allDiv.some(d => d.type === 'bullish_divergence');
    const hasBearDiv = allDiv.some(d => d.type === 'bearish_divergence');

    // v0.2.0 A7: RSI + MACD 背馳 cross-confirm bonus
    // 凡人話: 如果 RSI 同 MACD 兩條 indicator 都出現同一類背馳, 信心提升
    const rsiBull = rsiDiv.some(d => d.type === 'bullish_divergence');
    const rsiBear = rsiDiv.some(d => d.type === 'bearish_divergence');
    const macdBull = macdDiv.some(d => d.type === 'bullish_divergence');
    const macdBear = macdDiv.some(d => d.type === 'bearish_divergence');
    const crossConfirmedBull = rsiBull && macdBull;
    const crossConfirmedBear = rsiBear && macdBear;

    // Bullish
    if (hasBullDiv) {
      bullScore += 0.35;
      if (crossConfirmedBull) {
        bullScore += 0.10;  // v0.2.0 A7: cross-confirm bonus
        reasons.push('RSI + MACD 同時底背馳 (cross-confirmed, 高信心)');
      } else {
        reasons.push('出現底背馳,下跌動能衰竭');
      }
    }
    if (momentum.isOversold && momentum.rsiTrend === 'rising') {
      bullScore += 0.25;
      reasons.push('RSI 超賣區回升');
    }
    const macdSeries = momentum.macdSeries;
    if (macdSeries.length >= 2) {
      if (momentum.macdLatest > 0 && macdSeries[macdSeries.length - 2] <= 0) {
        bullScore += 0.25;
        reasons.push('MACD 柱狀體翻正(金叉)');
      } else if (
        momentum.macdState === 'bearish_decelerating'
        && momentum.macdLatest > macdSeries[macdSeries.length - 2]
      ) {
        bullScore += 0.15;
        reasons.push('MACD 下跌動能減弱');
      }
    }
    // v0.2.0 B2: confirmation candle (放量 + 收 > MA5)
    if (klines.length >= 11) {
      const last10Vols = klines.slice(-11, -1).map(k => k.volume);
      const avgVol = last10Vols.reduce((a, b) => a + b, 0) / 10;
      const lastClose = klines[klines.length - 1].close;
      const ma5 = klines.slice(-6, -1).reduce((s, k) => s + k.close, 0) / 5;
      if (klines[klines.length - 1].volume > avgVol * 1.2 && lastClose > ma5) {
        bullScore += 0.15;
        reasons.push('放量確認 (收 > MA5)');
      }
    }

    // Bearish
    if (hasBearDiv) {
      bearScore += 0.35;
      if (crossConfirmedBear) {
        bearScore += 0.10;  // v0.2.0 A7
        reasons.push('RSI + MACD 同時頂背馳 (cross-confirmed, 高信心)');
      } else {
        reasons.push('出現頂背馳,上升動能衰竭');
      }
    }
    if (momentum.isOverbought && momentum.rsiTrend === 'falling') {
      bearScore += 0.25;
      reasons.push('RSI 超買區回落');
    }
    if (
      macdSeries.length >= 2
      && momentum.macdLatest < 0
      && macdSeries[macdSeries.length - 2] >= 0
    ) {
      bearScore += 0.25;
      reasons.push('MACD 柱狀體翻負(死叉)');
    }

    // v0.2.0 A3: M1 state trend filter (cross-module alignment)
    // 凡人話: 大環境 DOWN 嗰陣唔好 trigger buy, 大環境 UP 嗰陣唔好 trigger sell
    // emit FALLBACK_USED warning 畀 M7 拎
    const m1State = options.m1State;
    if (m1State === 'DOWN' && bullScore > bearScore && bullScore > 0) {
      bullScore *= 0.5;  // 降一半, 等下次再 trigger
      m1FilterApplied = true;
      reasons.push('⚠️ M1 state=DOWN 與 buy 矛盾, 降權 50% (cross-module alignment)');
    } else if (m1State === 'UP' && bearScore > bullScore && bearScore > 0) {
      bearScore *= 0.5;
      m1FilterApplied = true;
      reasons.push('⚠️ M1 state=UP 與 sell 矛盾, 降權 50% (cross-module alignment)');
    }

    // Final
    const threshold = this.config.signalThreshold;
    if (bullScore >= threshold && bullScore > bearScore) {
      return {
        type: 'buy',
        strength: clamp(bullScore, 0, 0.95),  // v0.2.0 B1: 永久 ban 1.0
        reasons,
        m1FilterApplied,
        crossConfirmed: crossConfirmedBull,
      };
    } else if (bearScore >= threshold && bearScore > bullScore) {
      return {
        type: 'sell',
        strength: clamp(bearScore, 0, 0.95),  // v0.2.0 B1
        reasons,
        m1FilterApplied,
        crossConfirmed: crossConfirmedBear,
      };
    }
    return {
      type: 'hold',
      strength: clamp(Math.max(bullScore, bearScore), 0, 0.95),  // v0.2.0 B1
      reasons,
      m1FilterApplied,
      crossConfirmed: crossConfirmedBull || crossConfirmedBear,
    };
  }

  /**
   * Step 7: 勝率估算
   */
  private computeWinProbability(
    signalType: 'buy' | 'sell' | 'hold',
    momentum: MomentumInternal,
    rsiDiv: DivergenceEvent[],
    macdDiv: DivergenceEvent[],
  ): number {
    const allDiv = [...rsiDiv, ...macdDiv];
    if (signalType === 'hold') return 0.5;

    let base = 0.55;
    if (signalType === 'buy') {
      if (allDiv.some(d => d.type === 'bullish_divergence')) base += 0.12;
      if (momentum.isOversold) base += 0.08;
      if (momentum.macdState === 'bearish_decelerating') base += 0.05;
    } else if (signalType === 'sell') {
      if (allDiv.some(d => d.type === 'bearish_divergence')) base += 0.12;
      if (momentum.isOverbought) base += 0.08;
    }
    return round(clamp(base, 0, 0.85), 4);
  }

  /**
   * Step 8: 歷史機會回顧 (v0.2.0 A8: lookbackDays 60 → 250, 1 年尺度)
   * 揾過去 lookbackDays 內「曾經係買點」嘅日子
   */
  private computeHistoricalOpportunities(
    klines: KLine[],
    momentum: MomentumInternal,
  ): HistoricalOpportunity[] {
    const n = klines.length;
    if (n < 20) return [];
    const opportunities: HistoricalOpportunity[] = [];
    const lookback = Math.min(this.config.lookbackDays, n - 1);
    const lastClose = klines[n - 1].close;

    for (let i = n - lookback; i < n; i++) {
      if (i < 11) continue;
      // 簡化 signal: RSI < 35 + MACD 由負翻正 + close > 5 日均線
      const rsiOffset = n - momentum.rsiSeries.length;
      const rsiIdx = i - rsiOffset;
      const rsiVal = (rsiIdx >= 0 && rsiIdx < momentum.rsiSeries.length) ? momentum.rsiSeries[rsiIdx] : 50;
      const macdVal = momentum.macdSeries[i] ?? 0;
      const macdPrev = momentum.macdSeries[i - 1] ?? 0;
      const ma5 = klines.slice(Math.max(0, i - 5), i).reduce((s, k) => s + k.close, 0) / Math.min(5, i);
      if (rsiVal < 35 && macdVal > 0 && macdPrev <= 0 && klines[i].close > ma5) {
        const futureReturn = (lastClose - klines[i].close) / klines[i].close;
        if (futureReturn > 0.02) {
          const dateStr = this.klineDate(klines[i]);
          opportunities.push({
            date: dateStr,
            price: round(klines[i].close, 4),
            signalStrength: round(0.6 + (35 - rsiVal) / 50, 4),
            reason: `RSI 超賣 (${round(rsiVal, 1)}) + MACD 金叉 + 收 > MA5`,
            returnToDate: round(futureReturn, 4),
            missed: true,
          });
        }
      }
    }

    return opportunities
      .sort((a, b) => b.signalStrength - a.signalStrength)
      .slice(0, 3);
  }

  /**
   * Step 9: 信心指數 (v0.2.0 B1: 永久 ban 1.0, clamp 0.95)
   */
  private computeConfidence(
    signalStrength: number,
    rsiDiv: DivergenceEvent[],
    macdDiv: DivergenceEvent[],
    exhaustionScore: number,
    signalType: 'buy' | 'sell' | 'hold',
  ): number {
    let conf = signalStrength;
    const divCount = rsiDiv.length + macdDiv.length;
    if (divCount >= 2) conf *= 1.15;
    if (
      (signalType === 'buy' && exhaustionScore > 0.6)
      || (signalType === 'sell' && exhaustionScore > 0.6)
    ) {
      conf *= 1.1;
    }
    return round(clamp(conf, 0, 0.95), 4);  // v0.2.0 B1: clamp 0.95 (永久 ban 1.0)
  }

  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    // v0.2.0 A6: 拎 caller symbol 對齊 9月7日 08:30 verdict.meta.symbol 永久 rule
    // 凡人話: ctx.symbol 由 caller inject 落 (frontend testing page / api), 唔好 hardcode "TEST" / "UNKNOWN"
    const symbol = ctx.symbol || 'UNKNOWN';
    const warnings: string[] = [];  // v0.2.0 A4: self-check warning 收集, 對齊永久 rule v1.1.0 spirit

    // Step 0: 數據驗證
    const minRequired = Math.max(this.config.rsiPeriod, this.config.macdSlow + this.config.macdSignal) + this.config.lookbackDays + 10;
    if (klines.length < minRequired) {
      warnings.push(`[INSUFFICIENT_DATA] 數據不足, 需要至少 ${minRequired} 條 K 線, 目前 ${klines.length} 條`);
      return {
        moduleId: this.id,
        timeframe: ctx.ltf,
        state: 'SIDEWAYS' as CycleState,
        confidence: 0,
        interpretation: `[動能背馳] 數據不足,需要至少 ${minRequired} 條 K 線,目前 ${klines.length} 條`,
        evidence: [],
        warnings,
        meta: {
          inputBars: klines.length,
          minRequired,
          symbol,  // v0.2.0 A6
        },
        timestamp: Date.now(),
      };
    }

    // Step 0.5: Hurst+ADX regime gate (v0.2.0 A1, 對齊 M3 Spec Sync #45 永久 rule)
    // 凡人話: 冇 trend 嘅 stock (Hurst < 0.45 OR ADX < 20) 唔好亂話 buy/sell, 永遠 hold
    const closes = klines.map(k => k.close);
    const hurstValue = computeHurst(closes, 100);
    const adxValue = computeAdx(klines, 14);

    const regimePassed = hurstValue >= 0.45 && adxValue >= 20;
    if (!regimePassed) {
      warnings.push(`[CONFLICT_STATE] Regime gate 唔通過 (Hurst=${hurstValue.toFixed(3)}, ADX=${adxValue.toFixed(2)}), 弱趨勢, 觀望`);
      return {
        moduleId: this.id,
        timeframe: ctx.ltf,
        state: 'SIDEWAYS' as CycleState,
        confidence: 0.3,
        interpretation: `[動能背馳] Regime gate 唔通過 (Hurst=${hurstValue.toFixed(3)}, ADX=${adxValue.toFixed(2)}), 弱趨勢, 觀望`,
        evidence: [
          { type: 'hurst', label: 'Hurst 指數', value: round(hurstValue, 4), threshold: 0.45, passed: hurstValue >= 0.45 },
          { type: 'adx', label: 'ADX(14)', value: round(adxValue, 2), threshold: 20, passed: adxValue >= 20 },
        ],
        warnings,
        meta: {
          inputBars: klines.length,
          symbol,  // v0.2.0 A6
          hurst: round(hurstValue, 4),  // v0.2.0 A1: audit field
          adx: round(adxValue, 2),  // v0.2.0 A1: audit field
          regimeGate: 'FAILED',
          reason: 'Regime gate 唔通過',
        },
        timestamp: Date.now(),
      };
    }

    // Step 1: 計算 RSI + MACD
    const momentum = this.computeMomentum(klines);

    // 對齊 dates (用 kline.timestamp)
    const dates = klines.map(k => this.klineDate(k));

    // Step 2 + 3: 識別極值 + 背馳
    const { rsiDiv, macdDiv } = this.detectDivergences(closes, dates, momentum);

    // Step 4: 動能狀態 (momentum 入面已經有)
    // Step 5: 衰竭分數
    const exhaustionScore = this.computeExhaustionScore(momentum, rsiDiv, macdDiv);

    // Step 6: 交易訊號 (v0.2.0 A3: 傳 m1State 落 _computeSignal 做 M1 trend filter)
    const m1State = ctx.m1State as 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION' | undefined;
    const signal = this.computeSignal(klines, momentum, rsiDiv, macdDiv, { m1State });

    // Step 7: 勝率
    const winProbability = this.computeWinProbability(signal.type, momentum, rsiDiv, macdDiv);

    // Step 8: 歷史機會
    const historicalOpportunities = this.computeHistoricalOpportunities(klines, momentum);

    // Step 9: 信心
    let confidence = this.computeConfidence(signal.strength, rsiDiv, macdDiv, exhaustionScore, signal.type);

    // Step 9.5: v0.2.0 A5 self-check penalty (對齊 M2 9月7日 22:00 永久 rule)
    // 凡人話: 自我檢查 warning 觸發時, confidence 自動 floor 0.3, state 唔變 (由 M7 layer 處理 weight 折扣)
    const selfCheckWarnings: string[] = [];  // 收集 self-check warning 用 emit 落 verdict
    const originalConfidence = confidence;  // v0.2.0: audit field

    // 收集 self-check trigger conditions
    if (signal.m1FilterApplied) {
      // v0.2.0 A3: M1 state 矛盾 trigger FALLBACK_USED warning
      selfCheckWarnings.push(`[FALLBACK_USED] M4 signal 同 M1 state (${m1State}) 矛盾, 降權 50%`);
    }

    // v0.2.0 A5: 信心 penalty formula (對齊 M2 self-check penalty spirit)
    // critical + warning level self-check warning 觸發即扣 conf floor 0.3
    // info level (CONFLICT_STATE) 唔 floor (對齊 v1.1.0 spirit)
    const criticalOrWarnCount = selfCheckWarnings.filter(w => !w.includes('[CONFLICT_STATE]')).length;
    let selfCheckTriggered = false;
    if (criticalOrWarnCount > 0) {
      confidence = round(Math.max(confidence * 0.375, 0.3), 4);
      selfCheckTriggered = true;
    }

    // v0.2.0 A5: 永久 ban conf 1.0 (對齊 M3 Layer 4 永久 rule)
    confidence = Math.min(confidence, 0.95);

    // v0.2.0 A4: THRESHOLD_BREACH warning 觸發 if confidence < 0.3
    if (confidence < 0.3) {
      selfCheckWarnings.push(`[THRESHOLD_BREACH] 信心指數 ${confidence} < 0.3 門檻`);
    }

    // v0.2.0 A4: MODULE_PARTIAL warning if 背馳數 < 1 (冇背馳 evidence)
    const totalDiv = rsiDiv.length + macdDiv.length;
    if (totalDiv === 0 && signal.type !== 'hold') {
      selfCheckWarnings.push(`[MODULE_PARTIAL] M4 冇背馳 evidence 但有 signal, 純靠其他 sub-signal 推算, 信心弱`);
    }

    // 統一 cycle state
    let cycle: CycleState;
    let cycleLabel: string;
    if (signal.type === 'buy') { cycle = 'UP'; cycleLabel = '動能偏多'; }
    else if (signal.type === 'sell') { cycle = 'DOWN'; cycleLabel = '動能偏空'; }
    else { cycle = 'SIDEWAYS'; cycleLabel = '動能中性'; }

    // Evidence 收集
    const evidence: Evidence[] = [
      { type: 'hurst', label: 'Hurst 指數', value: round(hurstValue, 4), threshold: 0.45, passed: hurstValue >= 0.45 },
      { type: 'adx', label: 'ADX(14)', value: round(adxValue, 2), threshold: 20, passed: adxValue >= 20 },
      { type: 'rsi', label: 'RSI(14)', value: round(momentum.rsiLatest, 2), threshold: '30 / 70', passed: !momentum.isOverbought && !momentum.isOversold },
      { type: 'macd', label: 'MACD 柱狀體', value: round(momentum.macdLatest, 4), threshold: '0', passed: momentum.macdLatest > 0 },
      { type: 'macd-state', label: 'MACD 動能狀態', value: momentum.macdState, passed: momentum.macdState.includes('bullish') === (cycle === 'UP') },
      { type: 'rsi-trend', label: 'RSI 5 日趨勢', value: momentum.rsiTrend, passed: true },
      { type: 'divergence', label: '背馳數量', value: totalDiv, passed: totalDiv > 0 },
      { type: 'exhaustion', label: '衰竭分數', value: round(exhaustionScore, 4), threshold: 0.6, passed: exhaustionScore > 0.6 },
    ];

    // Interpretation
    const interpretationParts: string[] = [`動能視角: ${cycleLabel}`];
    if (signal.reasons.length > 0) {
      interpretationParts.push(`訊號: ${signal.reasons.join('、')}`);
    }
    if (totalDiv > 0) {
      interpretationParts.push(`背馳數 ${totalDiv} 條`);
    }
    if (winProbability >= 0.7) {
      interpretationParts.push(`勝率估算 ${(winProbability * 100).toFixed(0)}%`);
    }
    if (selfCheckTriggered) {
      interpretationParts.push(`⚠️ Self-check penalty 觸發, conf 由 ${originalConfidence} 折到 ${confidence}`);
    }
    const interpretation = interpretationParts.join(' / ');

    return {
      moduleId: this.id,
      timeframe: ctx.ltf,
      state: cycle,
      confidence,
      interpretation,
      evidence,
      warnings: [...warnings, ...selfCheckWarnings],  // 永久 rule v1.1.0 spirit
      meta: {
        inputBars: klines.length,
        symbol,  // v0.2.0 A6
        cycleLabel,
        hurst: round(hurstValue, 4),  // v0.2.0 A1: audit field
        adx: round(adxValue, 2),  // v0.2.0 A1: audit field
        m1State,  // v0.2.0 A3: audit field
        selfCheckTriggered,  // v0.2.0 A5: audit field
        originalConfidence,  // v0.2.0 A5: audit field
        divergence: {
          rsiDivergences: rsiDiv,
          macdDivergences: macdDiv,
          totalCount: totalDiv,
        },
        momentumState: {
          rsi: round(momentum.rsiLatest, 2),
          macd: round(momentum.macdLatest, 4),
          rsiTrend: momentum.rsiTrend,
          macdTrend: momentum.macdTrend,
          macdState: momentum.macdState,
          isOverbought: momentum.isOverbought,
          isOversold: momentum.isOversold,
        },
        signal: {
          type: signal.type,
          strength: round(signal.strength, 4),
          action: signal.type === 'buy' ? '買入' : signal.type === 'sell' ? '賣出' : '觀望',
          reasons: signal.reasons,
          m1FilterApplied: signal.m1FilterApplied,  // v0.2.0 A3
          crossConfirmed: signal.crossConfirmed,  // v0.2.0 A7
        },
        winProbability,
        exhaustionScore: round(exhaustionScore, 4),
        historicalOpportunities,
        adjustmentLog: [],
        reason: signal.reasons.length > 0 ? signal.reasons.join('；') : '暫無明確動能訊號',
        lastDate: dates[dates.length - 1] || '',
        rsiSeries: momentum.rsiSeries,  // 供 chart overlay 用
        macdSeries: momentum.macdSeries,
        configUsed: this.config,
      },
      timestamp: Date.now(),
    };
  }
}

export default IndicatorsModule;

// =============================================================
// 大少 2026-08-08 12:00 — Sprint 1 sub-task 1.1 — M7 standard verdict wrapper
// =============================================================
/** M4 Indicators (RSI/MACD/背馳/衰竭) 嘅 standard verdict wrapper
 *  @example
 *    const sv = await toStandardVerdictIND(klines, { symbol: 'HK.00700', ltf: '1d' });
 *    console.log(sv.base_weight);  // 0.15
 */
export async function toStandardVerdictIND(
  klines: KLine[],
  ctx: CycleContext,
  config: IndicatorsConfig = DEFAULT_INDICATORS_CONFIG,
): Promise<ModuleStandardVerdict> {
  return runAndStandardize(new IndicatorsModule(config), klines, ctx, 'indicators');
}
