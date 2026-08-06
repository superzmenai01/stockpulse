// modules/slope-momentum.ts — AS-03 · 點 8: 斜率動能 (SlopeMomentum) (v1.0.0)
//
// 大少 #10809 (2026-08-06) — Module 8 實作
// 跟 quick-draft-main-agent.md Section Module 8 嘅 10 rule M1-M10
// D013: Slope 原本屬 MA alignment 嘅 confidence modifier，大少 #10809 改主意獨立做 peer module
//
// 算法 (10 條):
//   Step 1 — 數據驗證 (最少 30 日, 目標 100 日)
//   Step 2 — 計算 MA5/MA10/MA60 history + 各 period slope history
//   Step 3 — 10 條 rule check (M1-M10):
//     M1.  slope(MA5, shortPeriod=5) > +shortSlopeThreshold 且 連續 3 日 slope(MA5, 1) ↑ → MA5 短期加速上升 (strong)
//     M2.  slope(MA5, 5) < -shortSlopeThreshold 且 連續 3 日 slope(MA5, 1) ↓         → MA5 短期加速下跌 (strong)
//     M3.  slope(MA10, midPeriod=10) > +midSlopeThreshold                              → MA10 中期斜率上升 (medium)
//     M4.  slope(MA10, 10) < -midSlopeThreshold                                         → MA10 中期斜率下跌 (medium)
//     M5.  slope(MA60, longPeriod=20) > +longSlopeThreshold                            → MA60 長期斜率上升 (medium)
//     M6.  slope(MA60, 20) < -longSlopeThreshold                                       → MA60 長期斜率下跌 (medium)
//     M7.  MA5 斜率 5 日內由負轉正（轉折點）                                            → 短期斜率轉正（趨勢轉強）(strong)
//     M8.  MA5 斜率 5 日內由正轉負（轉折點）                                            → 短期斜率轉負（趨勢轉弱）(strong)
//     M9.  |slope(MA5, 5)| < 0.1%                                                       → 動能減弱 (weak)
//     M10. |slope(MA5, 5)| > shortSlopeThreshold                                       → 動能加強 (weak)
//
// State derivation: priority M7/M8→TRANSITION · M1/M3/M5/M10→UP · M2/M4/M6→DOWN · M9→SIDEWAYS

import type { CycleContext, CycleModule, CycleVerdict, Evidence, KLine, CycleState } from '../types.ts';
import { DEFAULT_SLOPE_MOMENTUM_CONFIG, type SlopeMomentumConfig } from '../config.ts';

interface MatchedRule {
  id: string;
  label: string;
  strength: 'strong' | 'medium' | 'weak';
}

export class SlopeMomentum implements CycleModule<KLine[]> {
  readonly id = 'slope-momentum' as const;
  readonly version = '1.0.0';  // v1.0.0 (大少 #10809 全新實作)

  private readonly cfg: SlopeMomentumConfig;

  constructor(config: SlopeMomentumConfig = DEFAULT_SLOPE_MOMENTUM_CONFIG) {
    this.cfg = config;
  }

  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    const cfg = this.cfg;

    // ============ Step 1: 數據驗證 ============
    if (klines.length < cfg.longPeriod) {
      throw new Error(
        `[SlopeMomentum] Insufficient data: need ≥ ${cfg.longPeriod} bars, got ${klines.length}`,
      );
    }
    const recent = klines.slice(-Math.max(klines.length, cfg.longPeriod * 3));

    // ============ Step 2: 計算 MA history + slope history ============
    const ma5History: number[] = [];
    const ma10History: number[] = [];
    const ma60History: number[] = [];
    for (let i = 0; i < recent.length; i++) {
      ma5History.push(this.avgClose(recent, i, 5));
      ma10History.push(this.avgClose(recent, i, 10));
      ma60History.push(this.avgClose(recent, i, cfg.longPeriod));
    }

    // Slope history = (MA[i] - MA[i-N]) / MA[i-N]
    const slopeMA5: number[] = [];   // N = shortPeriod = 5
    const slopeMA10: number[] = [];  // N = midPeriod = 10
    const slopeMA60: number[] = [];  // N = longPeriod = 20
    const slopeMA5Daily: number[] = [];  // N = 1 (daily slope, for M1/M2 consecutive check)

    for (let i = 0; i < recent.length; i++) {
      slopeMA5.push(this.slope(ma5History, i, cfg.shortPeriod));
      slopeMA10.push(this.slope(ma10History, i, cfg.midPeriod));
      slopeMA60.push(this.slope(ma60History, i, cfg.longPeriod));
      slopeMA5Daily.push(this.slope(ma5History, i, 1));
    }

    const lastIdx = recent.length - 1;
    const latestSlopeMA5 = slopeMA5[lastIdx];
    const latestSlopeMA10 = slopeMA10[lastIdx];
    const latestSlopeMA60 = slopeMA60[lastIdx];

    // ============ Step 3: 10 條 rule check ============
    const matchedRules: MatchedRule[] = [];

    // M1. slope(MA5, 5) > +shortSlopeThreshold 且 連續 3 日 slope(MA5, 1) ↑ → MA5 短期加速上升 (strong)
    if (latestSlopeMA5 > cfg.shortSlopeThreshold &&
        this.allConsecutiveIncreasing(slopeMA5Daily, Math.max(0, lastIdx - 2), 3)) {
      matchedRules.push({ id: 'M1', label: 'MA5 短期加速上升', strength: 'strong' });
    }

    // M2. slope(MA5, 5) < -shortSlopeThreshold 且 連續 3 日 slope(MA5, 1) ↓ → MA5 短期加速下跌 (strong)
    if (latestSlopeMA5 < -cfg.shortSlopeThreshold &&
        this.allConsecutiveDecreasing(slopeMA5Daily, Math.max(0, lastIdx - 2), 3)) {
      matchedRules.push({ id: 'M2', label: 'MA5 短期加速下跌', strength: 'strong' });
    }

    // M3. slope(MA10, 10) > +midSlopeThreshold → MA10 中期斜率上升 (medium)
    if (latestSlopeMA10 > cfg.midSlopeThreshold) {
      matchedRules.push({ id: 'M3', label: 'MA10 中期斜率上升', strength: 'medium' });
    }

    // M4. slope(MA10, 10) < -midSlopeThreshold → MA10 中期斜率下跌 (medium)
    if (latestSlopeMA10 < -cfg.midSlopeThreshold) {
      matchedRules.push({ id: 'M4', label: 'MA10 中期斜率下跌', strength: 'medium' });
    }

    // M5. slope(MA60, 20) > +longSlopeThreshold → MA60 長期斜率上升 (medium)
    if (latestSlopeMA60 > cfg.longSlopeThreshold) {
      matchedRules.push({ id: 'M5', label: 'MA60 長期斜率上升', strength: 'medium' });
    }

    // M6. slope(MA60, 20) < -longSlopeThreshold → MA60 長期斜率下跌 (medium)
    if (latestSlopeMA60 < -cfg.longSlopeThreshold) {
      matchedRules.push({ id: 'M6', label: 'MA60 長期斜率下跌', strength: 'medium' });
    }

    // M7. MA5 斜率 5 日內由負轉正（轉折點） → 短期斜率轉正（趨勢轉強）(strong)
    const revWin = cfg.reversalWindow;  // 5
    if (this.slopeCrossedZero(slopeMA5, lastIdx, revWin, 'positive')) {
      matchedRules.push({ id: 'M7', label: '短期斜率轉正（趨勢轉強）', strength: 'strong' });
    }

    // M8. MA5 斜率 5 日內由正轉負（轉折點） → 短期斜率轉負（趨勢轉弱）(strong)
    if (this.slopeCrossedZero(slopeMA5, lastIdx, revWin, 'negative')) {
      matchedRules.push({ id: 'M8', label: '短期斜率轉負（趨勢轉弱）', strength: 'strong' });
    }

    // M9. |slope(MA5, 5)| < 0.1% → 動能減弱 (weak)
    const weakMomentumThreshold = 0.001;  // 0.1%
    if (Math.abs(latestSlopeMA5) < weakMomentumThreshold) {
      matchedRules.push({ id: 'M9', label: '動能減弱', strength: 'weak' });
    }

    // M10. |slope(MA5, 5)| > shortSlopeThreshold → 動能加強 (weak)
    if (Math.abs(latestSlopeMA5) > cfg.shortSlopeThreshold) {
      matchedRules.push({ id: 'M10', label: '動能加強', strength: 'weak' });
    }

    // ============ Step 4: State derivation ============
    const state = this.deriveState(matchedRules);

    // ============ Step 5: Confidence derivation ============
    const confidence = this.deriveConfidence(matchedRules);

    // ============ Output ============
    const interpretation = matchedRules.length > 0
      ? matchedRules.map(r => r.label).join('；')
      : '無 match';

    const evidence: Evidence[] = matchedRules.map(r => ({
      type: `rule-${r.id}`,
      label: r.label,
      value: r.id,
      passed: true,
    }));

    return {
      moduleId: this.id,
      timeframe: ctx.ltf,
      state,
      confidence,
      interpretation,
      evidence,
      warnings: [],
      meta: {
        matchedRules: matchedRules.map(r => r.id),
        ruleLabels: matchedRules.map(r => r.label),
        latestSlopeMA5: round(latestSlopeMA5, 6),
        latestSlopeMA10: round(latestSlopeMA10, 6),
        latestSlopeMA60: round(latestSlopeMA60, 6),
        latestMA5: round(ma5History[lastIdx], 4),
        latestMA10: round(ma10History[lastIdx], 4),
        latestMA60: round(ma60History[lastIdx], 4),
        dataDays: recent.length,
        configUsed: {
          shortPeriod: cfg.shortPeriod,
          midPeriod: cfg.midPeriod,
          longPeriod: cfg.longPeriod,
          shortSlopeThreshold: cfg.shortSlopeThreshold,
          midSlopeThreshold: cfg.midSlopeThreshold,
          longSlopeThreshold: cfg.longSlopeThreshold,
          reversalWindow: cfg.reversalWindow,
        },
      },
      timestamp: Date.now(),
    };
  }

  // ============ Helpers ============

  private avgClose(klines: KLine[], endIdx: number, period: number): number {
    const startIdx = Math.max(0, endIdx - period + 1);
    const slice = klines.slice(startIdx, endIdx + 1);
    const sum = slice.reduce((acc, k) => acc + k.close, 0);
    return sum / slice.length;
  }

  /**
   * slope(history, i, N) = (history[i] - history[i-N]) / history[i-N]
   * Returns 0 if i-N < 0 or denominator is 0
   */
  private slope(history: number[], i: number, N: number): number {
    if (i - N < 0) return 0;
    const prev = history[i - N];
    if (prev === 0) return 0;
    return (history[i] - prev) / prev;
  }

  private allConsecutiveIncreasing(arr: number[], startIdx: number, length: number): boolean {
    if (startIdx - length + 1 < 0) return false;
    for (let i = startIdx - length + 1; i < startIdx; i++) {
      if (!(arr[i + 1] > arr[i])) return false;
    }
    return true;
  }

  private allConsecutiveDecreasing(arr: number[], startIdx: number, length: number): boolean {
    if (startIdx - length + 1 < 0) return false;
    for (let i = startIdx - length + 1; i < startIdx; i++) {
      if (!(arr[i + 1] < arr[i])) return false;
    }
    return true;
  }

  /**
   * Detect if slope crossed zero in the last `window` days
   * - 'positive': was negative, now positive (M7)
   * - 'negative': was positive, now negative (M8)
   */
  private slopeCrossedZero(
    slopeHistory: number[],
    endIdx: number,
    window: number,
    direction: 'positive' | 'negative',
  ): boolean {
    const startIdx = Math.max(0, endIdx - window + 1);
    if (endIdx - startIdx < 1) return false;

    const latestSlope = slopeHistory[endIdx];
    const targetSign = direction === 'positive' ? 1 : -1;

    // 當前必須係目標 sign
    if (latestSlope * targetSign <= 0) return false;

    // 喺 window 範圍內必須有對面 sign
    for (let i = startIdx; i < endIdx; i++) {
      if (slopeHistory[i] * (-targetSign) > 0) return true;
    }
    return false;
  }

  /**
   * State derivation: priority M7/M8→TRANSITION · M1/M3/M5/M10→UP · M2/M4/M6→DOWN · M9→SIDEWAYS
   */
  private deriveState(rules: MatchedRule[]): CycleState {
    const ids = new Set(rules.map(r => r.id));
    if (ids.has('M7') || ids.has('M8')) return 'TRANSITION';
    if (ids.has('M1') || ids.has('M3') || ids.has('M5')) return 'UP';
    if (ids.has('M2') || ids.has('M4') || ids.has('M6')) return 'DOWN';
    if (ids.has('M10')) return 'UP';     // 動能加強 → UP (weak)
    if (ids.has('M9')) return 'SIDEWAYS'; // 動能減弱 → SIDEWAYS
    return 'SIDEWAYS';  // default
  }

  /**
   * Confidence derivation (同 v0.3.0 ma-alignment pattern):
   *   strong rule → 0.7
   *   medium rule → 0.5
   *   weak rule → +0.10 bonus each
   *   cap at 1.0
   */
  private deriveConfidence(rules: MatchedRule[]): number {
    let base = 0.5;
    if (rules.some(r => r.strength === 'strong')) base = 0.7;
    else if (rules.some(r => r.strength === 'medium')) base = 0.5;

    let conf = base;
    for (const r of rules) {
      if (r.strength === 'weak') conf += 0.10;
    }
    return Math.min(1.0, Math.round(conf * 10000) / 10000);
  }
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export default SlopeMomentum;