// modules/indicators.ts — AS-03 · 點 4: 動能背馳與衰竭檢測法 v1.0.0
// (Momentum Divergence & Exhaustion Detector)
//
// 對應 spec: `docs/research/AS-03-cycle-detection/MODULE-04-MOMENTUM-DIVERGENCE.md`
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
// 跟 ma-alignment.ts / hl-structure.ts / trendline.ts / volume.ts / slope-momentum.ts
// pattern 一致 (rule-based + additive confidence + list all matched rules)
//
// 永久 Rules:
// - Rule-based + additive confidence (大少 #10097)
// - List all matched rules (唔好 silently pick 一個)
// - State 統一: UP/DOWN/SIDEWAYS (TRANSITION 由 Synthesizer 判)
// - Plain language 解讀 (大少 #10299)

import type {
  CycleContext, CycleModule, CycleVerdict, Evidence, KLine, CycleState,
} from '../types.ts';
import { DEFAULT_INDICATORS_CONFIG, type IndicatorsConfig } from '../config.ts';

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
  readonly version = '1.0.0';

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

    // 5 日 trend (跟 spec Step 4)
    const rsiTrend = rsiSeries.length >= 6
      ? (rsiLatest > rsiSeries.slice(-6, -1).reduce((a, b) => a + b, 0) / 5 ? 'rising' : 'falling')
      : 'falling';
    const macdTrend = macdSeries.length >= 6
      ? (macdLatest > macdSeries.slice(-6, -1).reduce((a, b) => a + b, 0) / 5 ? 'rising' : 'falling')
      : 'falling';

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
   * Step 6: 交易訊號
   */
  private computeSignal(
    klines: KLine[],
    momentum: MomentumInternal,
    rsiDiv: DivergenceEvent[],
    macdDiv: DivergenceEvent[],
  ): { type: 'buy' | 'sell' | 'hold'; strength: number; reasons: string[] } {
    const reasons: string[] = [];
    let bullScore = 0;
    let bearScore = 0;

    const allDiv = [...rsiDiv, ...macdDiv];
    const hasBullDiv = allDiv.some(d => d.type === 'bullish_divergence');
    const hasBearDiv = allDiv.some(d => d.type === 'bearish_divergence');

    // Bullish
    if (hasBullDiv) {
      bullScore += 0.35;
      reasons.push('出現底背馳,下跌動能衰竭');
    }
    if (momentum.isOversold && momentum.rsiTrend === 'rising') {
      bullScore += 0.25;
      reasons.push('RSI 超賣區回升');
    }
    if (momentum.macdLatest > 0 && momentum.macdSeries[momentum.macdSeries.length - 2] <= 0) {
      bullScore += 0.25;
      reasons.push('MACD 柱狀體翻正(金叉)');
    } else if (
      momentum.macdState === 'bearish_decelerating'
      && momentum.macdLatest > momentum.macdSeries[momentum.macdSeries.length - 2]
    ) {
      bullScore += 0.15;
      reasons.push('MACD 下跌動能減弱');
    }
    // 放量確認
    if (klines.length >= 11) {
      const last10Vols = klines.slice(-11, -1).map(k => k.volume);
      const avgVol = last10Vols.reduce((a, b) => a + b, 0) / 10;
      if (klines[klines.length - 1].volume > avgVol * 1.2) {
        bullScore += 0.15;
        reasons.push('放量確認');
      }
    }

    // Bearish
    if (hasBearDiv) {
      bearScore += 0.35;
      reasons.push('出現頂背馳,上升動能衰竭');
    }
    if (momentum.isOverbought && momentum.rsiTrend === 'falling') {
      bearScore += 0.25;
      reasons.push('RSI 超買區回落');
    }
    if (momentum.macdLatest < 0 && momentum.macdSeries[momentum.macdSeries.length - 2] >= 0) {
      bearScore += 0.25;
      reasons.push('MACD 柱狀體翻負(死叉)');
    }

    // Final
    const threshold = this.config.signalThreshold;
    if (bullScore >= threshold && bullScore > bearScore) {
      return { type: 'buy', strength: clamp(bullScore, 0, 1), reasons };
    } else if (bearScore >= threshold && bearScore > bullScore) {
      return { type: 'sell', strength: clamp(bearScore, 0, 1), reasons };
    }
    return { type: 'hold', strength: clamp(Math.max(bullScore, bearScore), 0, 1), reasons };
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
   * Step 8: 歷史機會回顧 (簡化版: 唔 re-run 完整 signal, 只檢測 RSI 超賣 + MACD 翻正)
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
      const rsiVal = momentum.rsiSeries[i - (n - momentum.rsiSeries.length)] ?? 50;
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
   * Step 9: 信心指數
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
    return round(clamp(conf, 0, 1), 4);
  }

  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    // Step 0: 輸入驗證
    const minRequired = Math.max(this.config.rsiPeriod, this.config.macdSlow + this.config.macdSignal) + this.config.lookbackDays + 10;
    if (klines.length < minRequired) {
      return {
        moduleId: this.id,
        timeframe: ctx.ltf,
        state: 'SIDEWAYS' as CycleState,
        confidence: 0,
        interpretation: `[動能背馳] 數據不足,需要至少 ${minRequired} 條 K 線,目前 ${klines.length} 條`,
        evidence: [],
        warnings: [`數據不足: ${klines.length} < ${minRequired}`],
        meta: { inputBars: klines.length, minRequired },
        timestamp: Date.now(),
      };
    }

    // Step 1: 計算 RSI + MACD
    const momentum = this.computeMomentum(klines);

    // 對齊 dates (用 kline.timestamp)
    const dates = klines.map(k => this.klineDate(k));
    const closes = klines.map(k => k.close);

    // Step 2 + 3: 識別極值 + 背馳
    const { rsiDiv, macdDiv } = this.detectDivergences(closes, dates, momentum);

    // Step 4: 動能狀態 (momentum 入面已經有)
    // Step 5: 衰竭分數
    const exhaustionScore = this.computeExhaustionScore(momentum, rsiDiv, macdDiv);

    // Step 6: 交易訊號
    const signal = this.computeSignal(klines, momentum, rsiDiv, macdDiv);

    // Step 7: 勝率
    const winProbability = this.computeWinProbability(signal.type, momentum, rsiDiv, macdDiv);

    // Step 8: 歷史機會
    const historicalOpportunities = this.computeHistoricalOpportunities(klines, momentum);

    // Step 9: 信心
    const confidence = this.computeConfidence(signal.strength, rsiDiv, macdDiv, exhaustionScore, signal.type);

    // 統一 cycle state
    let cycle: CycleState;
    let cycleLabel: string;
    if (signal.type === 'buy') { cycle = 'UP'; cycleLabel = '動能偏多'; }
    else if (signal.type === 'sell') { cycle = 'DOWN'; cycleLabel = '動能偏空'; }
    else { cycle = 'SIDEWAYS'; cycleLabel = '動能中性'; }

    // Evidence 收集 (供 frontend render)
    const evidence: Evidence[] = [
      {
        type: 'rsi',
        label: 'RSI(14)',
        value: round(momentum.rsiLatest, 2),
        threshold: '30 / 70',
        passed: !momentum.isOverbought && !momentum.isOversold,
      },
      {
        type: 'macd',
        label: 'MACD 柱狀體',
        value: round(momentum.macdLatest, 4),
        threshold: '0',
        passed: momentum.macdLatest > 0,
      },
      {
        type: 'macd-state',
        label: 'MACD 動能狀態',
        value: momentum.macdState,
        passed: momentum.macdState.includes('bullish') === (cycle === 'UP'),
      },
      {
        type: 'rsi-trend',
        label: 'RSI 5 日趨勢',
        value: momentum.rsiTrend,
        passed: true,
      },
      {
        type: 'divergence',
        label: '背馳數量',
        value: rsiDiv.length + macdDiv.length,
        passed: rsiDiv.length + macdDiv.length > 0,
      },
      {
        type: 'exhaustion',
        label: '衰竭分數',
        value: round(exhaustionScore, 4),
        threshold: 0.6,
        passed: exhaustionScore > 0.6,
      },
    ];

    // Interpretation: 綜合判斷理由
    const interpretationParts: string[] = [];
    interpretationParts.push(`動能視角: ${cycleLabel}`);
    if (signal.reasons.length > 0) {
      interpretationParts.push(`訊號: ${signal.reasons.join('、')}`);
    }
    if (rsiDiv.length + macdDiv.length > 0) {
      interpretationParts.push(`背馳數 ${rsiDiv.length + macdDiv.length} 條`);
    }
    if (winProbability >= 0.7) {
      interpretationParts.push(`勝率估算 ${(winProbability * 100).toFixed(0)}%`);
    }
    const interpretation = interpretationParts.join(' / ');

    return {
      moduleId: this.id,
      timeframe: ctx.ltf,
      state: cycle,
      confidence,
      interpretation,
      evidence,
      warnings: [],
      meta: {
        inputBars: klines.length,
        cycleLabel,
        divergence: {
          rsiDivergences: rsiDiv,
          macdDivergences: macdDiv,
          totalCount: rsiDiv.length + macdDiv.length,
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
        },
        winProbability,
        exhaustionScore: round(exhaustionScore, 4),
        historicalOpportunities,
        adjustmentLog: [],
        reason: signal.reasons.length > 0 ? signal.reasons.join('；') : '暫無明確動能訊號',
        lastDate: dates[dates.length - 1] || '',
        rsiSeries: momentum.rsiSeries,  // 供 chart overlay 用
        macdSeries: momentum.macdSeries,
      },
      timestamp: Date.now(),
    };
  }
}

export default IndicatorsModule;
