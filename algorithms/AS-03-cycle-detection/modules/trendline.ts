// modules/trendline.ts — AS-03 · 點 3: 趨勢線法 v0.1.0 (Trendline Cycle Detector)
//
// 對應 spec: `docs/research/AS-03-cycle-detection/MODULE-03-TRENDLINE.md`
//
// 從 docx `docs/演算法概念SPECS/3趨勢線法.docx` v2.0 (Kimi statistical model) 簡化:
// - 移除: RANSAC / 成交量加權 / ATR 歸一化 / 假突破 multiplier / %B 指標
// - 改用: 簡單 OLS 線性回歸 + 10 條 rule (A-J), additive confidence
// - 跟 ma-alignment.ts / hl-structure.ts style 一致
//
// 10 條 Rule (A-J):
//   A. 支撐線上升 (slope > 0 + R² ≥ minR2)                → UP
//   B. 壓力線下降 (slope < 0 + R² ≥ minR2)                → DOWN
//   C. 通道窄 (< 3%) + 中位 (%B 0.4-0.6)                  → SIDEWAYS
//   D. 收斂三角形 (支撐升 + 壓力跌)                       → SIDEWAYS
//   E. 上升楔形 (支撐升 + 壓力平)                          → UP
//   F. 下降楔形 (支撐平 + 壓力跌)                          → DOWN
//   G. 真跌破支撐 (最近 5 日內 close 穿越 + stay ≥ 2 日)   → DOWN
//   H. 真突破壓力 (最近 5 日內 close 穿越 + stay ≥ 2 日)   → UP
//   I. 支撐有效 (觸線 ≥ 2 次 + 反彈 ≥ 1%)                 → +0.10 conf
//   J. 壓力有效 (觸線 ≥ 2 次 + 反彈 ≥ 1%)                 → +0.10 conf
//
// State derivation priority: H > A > B > F > G > C > D > default SIDEWAYS
// (H + G 同時 fire → TRANSITION)

import type {
  CycleContext, CycleModule, CycleVerdict, Evidence, KLine, CycleState, ModuleStandardVerdict,
} from '../types.ts';
import { DEFAULT_TRENDLINE_CONFIG, type TrendlineConfig } from '../config.ts';
import { runAndStandardize } from '../std-verdict.ts';

// ============ Internal types ============

interface ExtremePoint {
  index: number;
  date: string;
  high: number;
  low: number;
  close: number;
  volume: number;
  type: 'peak' | 'trough';
}

interface FittedLine {
  slope: number;
  intercept: number;
  r2: number;
  numPoints: number;
  usedPoints: ExtremePoint[];
}

interface TouchResult {
  touches: number;
  avgBouncePct: number;
  bounceScores: number[];
}

interface BreakoutResult {
  isBreakout: boolean;
  direction: 'support' | 'resistance' | 'none';
  type: 'true' | 'false' | 'unknown';
  daysSince: number;
  breakoutIdx: number;
}

interface Rule {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';
  label: string;
  strength: 'strong' | 'medium' | 'weak';
}

function round(n: number, decimals: number = 4): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

// ============ Main module ============

export class TrendlineModule implements CycleModule<KLine[]> {
  readonly id = 'trendline' as const;
  readonly version = '0.1.0';

  private readonly cfg: TrendlineConfig;

  constructor(config: TrendlineConfig = DEFAULT_TRENDLINE_CONFIG) {
    this.cfg = config;
  }

  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    const cfg = this.cfg;
    const n = klines.length;

    // ============ Step 0: 輸入驗證 ============
    // 基本需要 30 條 (跟 ma-alignment minDataDays 一致)
    const minRequired = 30;
    if (n < minRequired) {
      throw new Error(
        `[Trendline] Insufficient data: need ≥ ${minRequired} bars, got ${n}`,
      );
    }

    // 取最後 dataWindowDays 條 (跟其他 module 一致)
    const dataWindowDays = (ctx.config as any)?.dataWindowDays ?? n;
    const recent = klines.slice(-Math.min(dataWindowDays, n));
    const recentN = recent.length;

    // ============ Step 1: 識別極值點 (peaks + troughs) ============
    const peaks: ExtremePoint[] = [];
    const troughs: ExtremePoint[] = [];
    const halfWindow = cfg.extremeWindow;

    for (let i = halfWindow; i < recentN - halfWindow; i++) {
      const curr = recent[i];
      let isPeak = true;
      let isTrough = true;

      for (let j = i - halfWindow; j <= i + halfWindow; j++) {
        if (j === i) continue;
        if (curr.high <= recent[j].high) isPeak = false;
        if (curr.low >= recent[j].low) isTrough = false;
        if (!isPeak && !isTrough) break;
      }

      if (isPeak) {
        peaks.push({
          index: i,
          date: String(curr.timestamp),
          high: curr.high,
          low: curr.low,
          close: curr.close,
          volume: curr.volume,
          type: 'peak',
        });
      }
      if (isTrough) {
        troughs.push({
          index: i,
          date: String(curr.timestamp),
          high: curr.high,
          low: curr.low,
          close: curr.close,
          volume: curr.volume,
          type: 'trough',
        });
      }
    }

    // 極值點不足 → fallback SIDEWAYS
    if (peaks.length < cfg.minLinePoints || troughs.length < cfg.minLinePoints) {
      return this.fallbackVerdict(
        ctx,
        recent,
        `極值點不足 (peaks=${peaks.length}, troughs=${troughs.length}, 需要 ≥ ${cfg.minLinePoints} 個)`,
      );
    }

    // ============ Step 2: 動態最優點數 + 簡單 OLS 擬合 ============
    const supportFit = this.fitLine(troughs, 'support');
    const resistanceFit = this.fitLine(peaks, 'resistance');

    // ============ Step 3: Channel + %B ============
    const latestIdx = recentN - 1;
    const supportVal = supportFit.intercept + supportFit.slope * latestIdx;
    const resistanceVal = resistanceFit.intercept + resistanceFit.slope * latestIdx;
    const latestClose = recent[latestIdx].close;
    const channelWidth = resistanceVal - supportVal;
    const mid = (supportVal + resistanceVal) / 2;
    const channelWidthPct = mid > 0 ? channelWidth / mid : 0;
    const percentB = channelWidth > 0 ? (latestClose - supportVal) / channelWidth : 0.5;

    // ============ Step 4: 觸線統計 (touches) ============
    const supportTouch = this.analyzeTouches(supportFit, 'support', recent);
    const resistanceTouch = this.analyzeTouches(resistanceFit, 'resistance', recent);

    // ============ Step 5: 突破判定 (breakout) ============
    const supportBreakout = this.detectBreakout(supportFit, 'support', recent);
    const resistanceBreakout = this.detectBreakout(resistanceFit, 'resistance', recent);

    // ============ Step 6: 投影 (projection) ============
    const futureIdx = latestIdx + cfg.projectionDays;
    const supportFuture = supportFit.intercept + supportFit.slope * futureIdx;
    const resistanceFuture = resistanceFit.intercept + resistanceFit.slope * futureIdx;
    const midFuture = (supportFuture + resistanceFuture) / 2;

    // ============ Step 7: 觸發 10 條 Rule (A-J) ============
    const matchedRules: Rule[] = [];
    const adjustmentLog: string[] = [];

    // A: 支撐線上升 + R² ≥ minR2
    if (supportFit.slope > 0 && supportFit.r2 >= cfg.minR2) {
      matchedRules.push({ id: 'A', label: '支撐線上升', strength: 'strong' });
    }
    // B: 壓力線下降 + R² ≥ minR2
    if (resistanceFit.slope < 0 && resistanceFit.r2 >= cfg.minR2) {
      matchedRules.push({ id: 'B', label: '壓力線下降', strength: 'strong' });
    }
    // C: 通道窄 + 中位
    if (channelWidthPct < 0.03 && percentB >= 0.4 && percentB <= 0.6) {
      matchedRules.push({ id: 'C', label: '通道窄 + 中位', strength: 'medium' });
    }
    // D: 收斂三角形 (支撐升 + 壓力跌)
    if (supportFit.slope > 0 && resistanceFit.slope < 0) {
      matchedRules.push({ id: 'D', label: '收斂三角形', strength: 'medium' });
    }
    // E: 上升楔形 (支撐升 + 壓力平)
    if (supportFit.slope > 0 && Math.abs(resistanceFit.slope) <= cfg.flatSlopeThreshold) {
      matchedRules.push({ id: 'E', label: '上升楔形', strength: 'medium' });
    }
    // F: 下降楔形 (支撐平 + 壓力跌)
    if (Math.abs(supportFit.slope) <= cfg.flatSlopeThreshold && resistanceFit.slope < 0) {
      matchedRules.push({ id: 'F', label: '下降楔形', strength: 'medium' });
    }
    // G: 真跌破支撐
    if (supportBreakout.isBreakout && supportBreakout.type === 'true') {
      matchedRules.push({ id: 'G', label: '真跌破支撐', strength: 'strong' });
    }
    // H: 真突破壓力
    if (resistanceBreakout.isBreakout && resistanceBreakout.type === 'true') {
      matchedRules.push({ id: 'H', label: '真突破壓力', strength: 'strong' });
    }
    // I: 支撐有效 (weak — 唔 trigger state, 淨係 +0.10 conf)
    if (supportTouch.touches >= 2 && supportTouch.avgBouncePct >= 0.01) {
      matchedRules.push({ id: 'I', label: '支撐有效', strength: 'weak' });
    }
    // J: 壓力有效 (weak)
    if (resistanceTouch.touches >= 2 && resistanceTouch.avgBouncePct >= 0.01) {
      matchedRules.push({ id: 'J', label: '壓力有效', strength: 'weak' });
    }

    // ============ Step 8: State derivation ============
    const state = this.deriveState(matchedRules, supportBreakout, resistanceBreakout);

    // ============ Step 9: Confidence derivation ============
    const { baseConfidence, confidence, adjustmentLog: confidenceLog } = this.deriveConfidence(
      matchedRules, supportFit, resistanceFit, latestIdx, recentN,
    );
    // 將 confidence 計算過程嘅 log 全部 push 入主 log
    adjustmentLog.push(...confidenceLog);

    // 計算 latest extreme age
    const allExtrema = [...peaks, ...troughs];
    const lastExtremeIdx = allExtrema.length > 0
      ? Math.max(...allExtrema.map(p => p.index))
      : 0;
    const latestExtremeAge = allExtrema.length > 0 ? recentN - 1 - lastExtremeIdx : -1;

    // ============ Step 10: Evidence (debug + UI 用) ============
    const evidence: Evidence[] = [
      {
        type: 'support-slope',
        label: `支撐線斜率: ${supportFit.slope.toFixed(4)}`,
        value: supportFit.slope,
        threshold: 0,
        passed: supportFit.slope > 0,
      },
      {
        type: 'support-r2',
        label: `支撐線 R²: ${supportFit.r2.toFixed(3)}`,
        value: supportFit.r2,
        threshold: cfg.minR2,
        passed: supportFit.r2 >= cfg.minR2,
      },
      {
        type: 'resistance-slope',
        label: `壓力線斜率: ${resistanceFit.slope.toFixed(4)}`,
        value: resistanceFit.slope,
        threshold: 0,
        passed: resistanceFit.slope < 0,
      },
      {
        type: 'resistance-r2',
        label: `壓力線 R²: ${resistanceFit.r2.toFixed(3)}`,
        value: resistanceFit.r2,
        threshold: cfg.minR2,
        passed: resistanceFit.r2 >= cfg.minR2,
      },
      {
        type: 'channel',
        label: `通道寬度: ${(channelWidthPct * 100).toFixed(2)}% (%B = ${percentB.toFixed(3)})`,
        value: channelWidthPct,
        threshold: 0.03,
        passed: channelWidthPct < 0.03,
      },
      {
        type: 'support-breakout',
        label: supportBreakout.isBreakout
          ? `支撐突破: ${supportBreakout.type} (${supportBreakout.daysSince} 日前)`
          : '支撐線: 無突破',
        value: supportBreakout.isBreakout,
        passed: !supportBreakout.isBreakout,
      },
      {
        type: 'resistance-breakout',
        label: resistanceBreakout.isBreakout
          ? `壓力突破: ${resistanceBreakout.type} (${resistanceBreakout.daysSince} 日前)`
          : '壓力線: 無突破',
        value: resistanceBreakout.isBreakout,
        passed: !resistanceBreakout.isBreakout,
      },
      {
        type: 'matched-rules',
        label: `觸發 rules: ${matchedRules.map(r => r.id).join(', ') || '無'}`,
        value: matchedRules.map(r => r.id).join(','),
        passed: matchedRules.length > 0,
      },
    ];

    // Reason (plain language)
    const reason = this.buildReason(
      state, matchedRules, supportFit, resistanceFit,
      channelWidthPct, percentB, supportBreakout, resistanceBreakout,
    );

    return {
      moduleId: this.id,
      timeframe: ctx.ltf,
      state,
      confidence: round(confidence),
      interpretation: reason,
      evidence,
      warnings: [],
      meta: {
        matchedRules: matchedRules.map(r => r.id),
        ruleLabels: matchedRules.map(r => r.label),
        baseConfidence: round(baseConfidence),
        supportLine: {
          slope: round(supportFit.slope, 6),
          r2: round(supportFit.r2),
          numPoints: supportFit.numPoints,
          intercept: round(supportFit.intercept, 2),
          currentValue: round(supportVal, 2),
          touches: supportTouch.touches,
          avgBouncePct: round(supportTouch.avgBouncePct),
        },
        resistanceLine: {
          slope: round(resistanceFit.slope, 6),
          r2: round(resistanceFit.r2),
          numPoints: resistanceFit.numPoints,
          intercept: round(resistanceFit.intercept, 2),
          currentValue: round(resistanceVal, 2),
          touches: resistanceTouch.touches,
          avgBouncePct: round(resistanceTouch.avgBouncePct),
        },
        channel: {
          widthPct: round(channelWidthPct),
          percentB: round(percentB),
        },
        breakout: {
          support: supportBreakout.isBreakout
            ? { type: supportBreakout.type, daysSince: supportBreakout.daysSince }
            : { type: 'none', daysSince: -1 },
          resistance: resistanceBreakout.isBreakout
            ? { type: resistanceBreakout.type, daysSince: resistanceBreakout.daysSince }
            : { type: 'none', daysSince: -1 },
        },
        latestClose: round(latestClose, 2),
        latestExtremeAge,
        projection: {
          days: cfg.projectionDays,
          supportFuture: round(supportFuture, 2),
          resistanceFuture: round(resistanceFuture, 2),
          midFuture: round(midFuture, 2),
        },
        adjustmentLog,
        dataDays: recentN,
        configUsed: cfg,
      },
      timestamp: Date.now(),
    };
  }

  // ============ Helpers ============

  /**
   * 動態最優點數選擇 + 簡單 OLS 線性回歸
   * 試 minLinePoints 到 maxLinePoints 個 points, 揀 R² 最高嗰個
   */
  private fitLine(points: ExtremePoint[], lineType: 'support' | 'resistance'): FittedLine {
    const cfg = this.cfg;
    const ys = lineType === 'support' ? points.map(p => p.low) : points.map(p => p.high);
    const xs = points.map(p => p.index);

    let bestFit: FittedLine | null = null;
    let bestR2 = -Infinity;

    const maxN = Math.min(cfg.maxLinePoints, points.length);
    for (let n = cfg.minLinePoints; n <= maxN; n++) {
      // 取最後 n 個 points
      const xSubset = xs.slice(-n);
      const ySubset = ys.slice(-n);
      const pointsSubset = points.slice(-n);

      const { slope, intercept, r2 } = this.linearRegression(xSubset, ySubset);

      if (r2 > bestR2) {
        bestR2 = r2;
        bestFit = { slope, intercept, r2, numPoints: n, usedPoints: pointsSubset };
      }
    }

    if (!bestFit) {
      return { slope: 0, intercept: 0, r2: 0, numPoints: 0, usedPoints: [] };
    }
    return bestFit;
  }

  /**
   * 簡單 OLS 線性回歸
   * y = slope * x + intercept
   * R² = 1 - SS_res / SS_tot
   */
  private linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
    const n = xs.length;
    if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

    const xMean = xs.reduce((a, b) => a + b, 0) / n;
    const yMean = ys.reduce((a, b) => a + b, 0) / n;

    let num = 0;
    let denom = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - xMean) * (ys[i] - yMean);
      denom += (xs[i] - xMean) ** 2;
    }

    const slope = denom === 0 ? 0 : num / denom;
    const intercept = yMean - slope * xMean;

    // R²
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < n; i++) {
      const yPred = slope * xs[i] + intercept;
      ssRes += (ys[i] - yPred) ** 2;
      ssTot += (ys[i] - yMean) ** 2;
    }
    const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

    return { slope, intercept, r2: Math.max(0, r2) }; // R² 唔可以負
  }

  /**
   * 觸線統計
   * 對每個非 fit 點, 檢查 low/high 接近 support/resistance line
   * 反彈幅度 = 觸線後 4 日內 max high (support) 或 min low (resistance) vs 觸線日 close
   */
  private analyzeTouches(
    fit: FittedLine,
    lineType: 'support' | 'resistance',
    recent: KLine[],
  ): TouchResult {
    const cfg = this.cfg;
    const fittedIndices = new Set(fit.usedPoints.map(p => p.index));
    const n = recent.length;
    let touches = 0;
    const bounces: number[] = [];

    for (let i = 0; i < n - 4; i++) { // skip last 4 days (no bounce data)
      if (fittedIndices.has(i)) continue;

      const lineValue = fit.intercept + fit.slope * i;
      const tolerance = lineValue * cfg.touchTolerancePct;
      const bar = recent[i];

      let isTouch = false;
      let bouncePct = 0;

      if (lineType === 'support') {
        // 觸及支撐線: low 接近 line value
        if (
          bar.low <= lineValue * (1 + cfg.touchTolerancePct) ||
          Math.abs(bar.low - lineValue) <= tolerance
        ) {
          isTouch = true;
          // 反彈 = 觸線後 4 日內 max high vs 觸線日 close
          let futureHigh = 0;
          for (let j = i + 1; j < Math.min(n, i + 5); j++) {
            futureHigh = Math.max(futureHigh, recent[j].high);
          }
          if (futureHigh > 0 && bar.close > 0) {
            bouncePct = (futureHigh - bar.close) / bar.close;
          }
        }
      } else {
        // 觸及壓力線: high 接近 line value
        if (
          bar.high >= lineValue * (1 - cfg.touchTolerancePct) ||
          Math.abs(bar.high - lineValue) <= tolerance
        ) {
          isTouch = true;
          // 反彈 = 觸線日 close vs 後 4 日內 min low
          let futureLow = Infinity;
          for (let j = i + 1; j < Math.min(n, i + 5); j++) {
            futureLow = Math.min(futureLow, recent[j].low);
          }
          if (futureLow < Infinity && bar.close > 0) {
            bouncePct = (bar.close - futureLow) / bar.close;
          }
        }
      }

      if (isTouch) {
        touches++;
        bounces.push(bouncePct);
      }
    }

    const avgBouncePct = bounces.length > 0
      ? bounces.reduce((a, b) => a + b, 0) / bounces.length
      : 0;

    return { touches, avgBouncePct, bounceScores: bounces };
  }

  /**
   * 突破判定
   * 過去 breakoutWindow 個 bar 內, 偵測 close 穿越 trend line
   * 真突破 = 穿越後 stay on other side 至少 breakoutConfirmDays
   */
  private detectBreakout(
    fit: FittedLine,
    lineType: 'support' | 'resistance',
    recent: KLine[],
  ): BreakoutResult {
    const cfg = this.cfg;
    const n = recent.length;
    const latestIdx = n - 1;
    const windowStart = Math.max(0, latestIdx - cfg.breakoutWindow);

    let isBreakout = false;
    let direction: 'support' | 'resistance' | 'none' = 'none';
    let breakoutType: 'true' | 'false' | 'unknown' = 'unknown';
    let breakoutIdx = -1;

    // 從 breakoutWindow 內最後一個 bar 倒返搵最近 crossover
    for (let i = windowStart + 1; i <= latestIdx; i++) {
      const lineCurr = fit.intercept + fit.slope * i;
      const linePrev = fit.intercept + fit.slope * (i - 1);
      const prevClose = recent[i - 1].close;
      const currClose = recent[i].close;

      if (lineType === 'support') {
        // 跌破支撐: 之前 close ≥ line, 而家 close < line
        if (prevClose >= linePrev && currClose < lineCurr) {
          isBreakout = true;
          direction = 'support';
          breakoutIdx = i;
          // 真突破: 之後 breakoutConfirmDays 日都 close < line
          let daysBelow = 0;
          for (let j = i + 1; j <= Math.min(latestIdx, i + cfg.breakoutConfirmDays); j++) {
            const lineJ = fit.intercept + fit.slope * j;
            if (recent[j].close < lineJ) daysBelow++;
          }
          breakoutType = daysBelow >= cfg.breakoutConfirmDays ? 'true' : 'false';
          break;
        }
      } else {
        // 突破壓力: 之前 close ≤ line, 而家 close > line
        if (prevClose <= linePrev && currClose > lineCurr) {
          isBreakout = true;
          direction = 'resistance';
          breakoutIdx = i;
          // 真突破: 之後 breakoutConfirmDays 日都 close > line
          let daysAbove = 0;
          for (let j = i + 1; j <= Math.min(latestIdx, i + cfg.breakoutConfirmDays); j++) {
            const lineJ = fit.intercept + fit.slope * j;
            if (recent[j].close > lineJ) daysAbove++;
          }
          breakoutType = daysAbove >= cfg.breakoutConfirmDays ? 'true' : 'false';
          break;
        }
      }
    }

    const daysSince = breakoutIdx >= 0 ? latestIdx - breakoutIdx : -1;

    return { isBreakout, direction, type: breakoutType, daysSince, breakoutIdx };
  }

  /**
   * State derivation: priority H > A > B > F > G > C > D > default SIDEWAYS
   * H + G 同時 fire → TRANSITION
   */
  private deriveState(
    rules: Rule[],
    supportBreakout: BreakoutResult,
    resistanceBreakout: BreakoutResult,
  ): CycleState {
    const ids = new Set(rules.map(r => r.id));

    // H + G 同時 = 短線反轉
    if (ids.has('H') && ids.has('G')) return 'TRANSITION';

    if (ids.has('H')) return 'UP';
    if (ids.has('A')) return 'UP';
    if (ids.has('B')) return 'DOWN';
    if (ids.has('F')) return 'DOWN';
    if (ids.has('G')) return 'DOWN';
    if (ids.has('C') || ids.has('D')) return 'SIDEWAYS';

    return 'SIDEWAYS'; // default (只有 I/J 或無 match)
  }

  /**
   * Confidence derivation:
   *   strong rule (A/B/G/H) → base 0.7
   *   medium rule (C/D/E/F) → base 0.5
   *   weak rule (I/J) → +0.10 bonus each
   *   -0.05 if R² < minR2 (one or both)
   *   -0.10 if latest extreme > maxExtremeAgeDays
   *   cap at 1.0
   */
  private deriveConfidence(
    rules: Rule[],
    supportFit: FittedLine,
    resistanceFit: FittedLine,
    latestIdx: number,
    recentN: number,
  ): { baseConfidence: number; confidence: number; adjustmentLog: string[] } {
    const cfg = this.cfg;
    const adjustmentLog: string[] = [];

    let base = 0.5;
    if (rules.some(r => r.strength === 'strong')) base = 0.7;
    // medium 同 weak 都係 0.5 base

    let conf = base;
    for (const r of rules) {
      if (r.strength === 'weak') conf += 0.10;
    }

    // Adjustment 1: R² < minR2 對其中一條
    if (supportFit.r2 < cfg.minR2 && resistanceFit.r2 < cfg.minR2) {
      conf -= 0.10;
      adjustmentLog.push('兩條趨勢線 R² 均低於 minR2, 信心 -0.10');
    } else if (supportFit.r2 < cfg.minR2) {
      conf -= 0.05;
      adjustmentLog.push('支撐線 R² 偏低, 信心 -0.05');
    } else if (resistanceFit.r2 < cfg.minR2) {
      conf -= 0.05;
      adjustmentLog.push('壓力線 R² 偏低, 信心 -0.05');
    }

    // Adjustment 2: latest extreme 太舊
    // (由 caller 計算 actualExtremeAge, 喺呢度粗略估計)
    // 喺真實 implementation 我哋靠 fittedPoints 嘅最新 index
    const lastFitIdx = Math.max(...supportFit.usedPoints.map(p => p.index), 0);
    const latestExtremeAge = recentN - 1 - lastFitIdx;
    if (latestExtremeAge > cfg.maxExtremeAgeDays) {
      conf -= 0.10;
      adjustmentLog.push(`趨勢線最舊極值點距今 ${latestExtremeAge} 日, 信號老化, 信心 -0.10`);
    }

    const clamped = Math.max(0, Math.min(1, conf));
    return { baseConfidence: base, confidence: clamped, adjustmentLog };
  }

  /**
   * Reason (plain language 解讀)
   */
  private buildReason(
    state: CycleState,
    rules: Rule[],
    supportFit: FittedLine,
    resistanceFit: FittedLine,
    channelWidthPct: number,
    percentB: number,
    supportBreakout: BreakoutResult,
    resistanceBreakout: BreakoutResult,
  ): string {
    if (rules.length === 0) {
      return '趨勢線信號唔清晰, 預設橫行';
    }
    const stateText: Record<CycleState, string> = {
      UP: '上升趨勢',
      DOWN: '下跌趨勢',
      SIDEWAYS: '橫行',
      TRANSITION: '短線反轉',
    };
    const ruleStr = rules.map(r => r.id).join('+');
    const channelStr = channelWidthPct < 0.03 ? '窄通道' : channelWidthPct < 0.10 ? '中等通道' : '寬通道';

    if (state === 'TRANSITION') {
      return `短線反轉: 支撐同壓力線都出現真突破訊號 (${ruleStr}), 趨勢可能反轉`;
    }

    return `${stateText[state]}: 觸發 ${ruleStr} rules, 支撐 R²=${supportFit.r2.toFixed(2)}, 壓力 R²=${resistanceFit.r2.toFixed(2)}, ${channelStr}, %B=${percentB.toFixed(2)}`;
  }

  /**
   * Fallback verdict (極值點不足 或 其他 edge case)
   */
  private fallbackVerdict(
    ctx: CycleContext,
    recent: KLine[],
    reason: string,
  ): CycleVerdict {
    const cfg = this.cfg;
    return {
      moduleId: this.id,
      timeframe: ctx.ltf,
      state: 'SIDEWAYS',
      confidence: 0.3,
      interpretation: `${reason}, 預設橫行 (信心 0.3)`,
      evidence: [
        {
          type: 'insufficient-data',
          label: reason,
          value: recent.length,
          threshold: cfg.minLinePoints,
          passed: false,
        },
      ],
      warnings: [reason],
      meta: {
        matchedRules: [],
        ruleLabels: [],
        baseConfidence: 0.3,
        dataDays: recent.length,
        configUsed: cfg,
      },
      timestamp: Date.now(),
    };
  }
}

export default TrendlineModule;

// =============================================================
// 大少 2026-08-08 12:00 — Sprint 1 sub-task 1.1 — M7 standard verdict wrapper
// =============================================================
/** M3 Trendline 嘅 standard verdict wrapper
 *  @example
 *    const sv = await toStandardVerdictTL(klines, { symbol: 'HK.00700', ltf: '1d' });
 *    console.log(sv.base_weight);  // 0.20
 */
export async function toStandardVerdictTL(
  klines: KLine[],
  ctx: CycleContext,
  config: TrendlineConfig = DEFAULT_TRENDLINE_CONFIG,
): Promise<ModuleStandardVerdict> {
  return runAndStandardize(new TrendlineModule(config), klines, ctx, 'trendline');
}
