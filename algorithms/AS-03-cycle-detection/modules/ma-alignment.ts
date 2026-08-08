// modules/ma-alignment.ts — AS-03 · 點 1: 均線系統週期判斷法 v2.0 (with Volume & Slope)
//
// 大少 2026-08-08 09:13 指示: 舊 v0.3.0 嘅 M1 (10 rules A-J, 4 states H/A/B/F/G/C/D + TRANSITION)
// 抽離做獨立算法叫 zmen均算法 (file 改 zmen-ma-alignment.ts, moduleId 保留 'ma-alignment')。
//
// 新 M1 v2.0 跟 Kimi 出嘅 docx v2.0 spec 重新做, 3 個 cycle state
// (uptrend / downtrend / sideways) + 成交量加權 + 斜率動能 兩維度擴展。
//
// 算法 (跟 docx §4 7 個 Step):
//   Step 1 — 輸入驗證 (min_data = max(max(ma_periods) + 5, max(ma_periods) + slope_lookback + 5,
//                                      volume_lookback * 2 + 5))
//   Step 2 — 計算各週期 MA 最新值
//   Step 3 — 均線排序與形態判定 (排列 → uptrend / downtrend / sideways candidate)
//   Step 4 — 橫行週期精細判定 (均線粘合檢查, spread < threshold_pct → 強制 sideways)
//   Step 5 — 成交量趨勢計算 (recent vs previous avg volume ratio → expanding/shrinking/neutral)
//   Step 6 — 均線斜率與動能分數 (各 MA 嘅 slope_lookback 日前 vs 而家, 短期權重高嘅 momentum_score)
//   Step 7 — 信心指數 (base × volume × slope 三階段調整, CLAMP [0, 1])
//   Step 8 — 組裝輸出 (13 個 fields)
//
// State derivation:
//   uptrend (3 個 multiplier 都正向) / downtrend / sideways (3 個)
//
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md
// Docx: docs/演算法概念SPECS/01均線系統週期判斷法.docx (Kimi v2.0)

import type {
  CycleContext, CycleModule, CycleVerdict, KLine, ModuleStandardVerdict,
} from '../types.ts';
import { DEFAULT_MA_ALIGNMENT_V2_CONFIG, type MAAlignmentV2Config } from '../config.ts';
import { runAndStandardize } from '../std-verdict.ts';

export type MAAlignmentV2Cycle = 'uptrend' | 'downtrend' | 'sideways';
export type MAAlignmentV2VolumeSignal = 'expanding' | 'shrinking' | 'neutral';

export interface MAAlignmentV2VerdictMeta {
  symbol: string;
  cycle: MAAlignmentV2Cycle;
  cycleLabel: string;
  confidence: number;
  baseConfidence: number;
  maValues: Record<string, number>;
  maRanks: string[];
  maSlopes: Record<string, number>;
  momentumScore: number;
  volumeTrendRatio: number;
  volumeSignal: MAAlignmentV2VolumeSignal;
  maxSpreadPct: number;
  adjustmentLog: string[];
  reason: string;
  lastDate: string;
}

const CYCLE_LABELS: Record<MAAlignmentV2Cycle, string> = {
  uptrend: '上升週期',
  downtrend: '下跌週期',
  sideways: '橫行週期',
};

const VOLUME_SIGNAL_LABELS: Record<MAAlignmentV2VolumeSignal, string> = {
  expanding: '放量',
  shrinking: '縮量',
  neutral: '持平',
};

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export class MAAlignmentV2Module implements CycleModule<KLine[]> {
  readonly id = 'ma-alignment-v2' as const;
  readonly version = '2.0.0';

  private readonly cfg: MAAlignmentV2Config;

  constructor(config: MAAlignmentV2Config = DEFAULT_MA_ALIGNMENT_V2_CONFIG) {
    this.cfg = config;
  }

  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    const cfg = this.cfg;
    const adjustmentLog: string[] = [];

    // ============ Step 1: 輸入驗證 ============
    const maxPeriod = Math.max(...cfg.maPeriods);
    const minLengthForMA = maxPeriod + 5;
    const minLengthForSlope = cfg.enableSlopeCheck ? maxPeriod + cfg.slopeLookback + 5 : 0;
    const minLengthForVol = cfg.enableVolumeWeight ? cfg.volumeLookback * 2 + 5 : 0;
    const requiredLength = Math.max(minLengthForMA, minLengthForSlope, minLengthForVol);

    if (klines.length < requiredLength) {
      throw new Error(
        `[MAAlignmentV2] Insufficient data: need ≥ ${requiredLength} bars, got ${klines.length}`,
      );
    }

    // 檢查日期升序
    for (let i = 1; i < klines.length; i++) {
      if (new Date(klines[i].date) < new Date(klines[i - 1].date)) {
        throw new Error(
          `[MAAlignmentV2] price_data 必須按日期升序排列 (第 ${i - 1} → ${i} 條違反)`,
        );
      }
    }

    // 檢查 volume (若 enable)
    if (cfg.enableVolumeWeight) {
      for (let i = 0; i < klines.length; i++) {
        if (klines[i].volume === undefined || klines[i].volume === null) {
          throw new Error(
            `[MAAlignmentV2] volume field required when enable_volume_weight is true (第 ${i} 條缺失)`,
          );
        }
      }
    }

    // ============ Step 2: 計算各週期 MA 最新值 ============
    const maValues: Record<string, number> = {};
    for (const period of cfg.maPeriods) {
      const tail = klines.slice(-period);
      const sum = tail.reduce((acc, k) => acc + k.close, 0);
      maValues[`MA${period}`] = sum / period;
    }

    // ============ Step 3: 均線排序與形態判定 ============
    const maKeys = cfg.maPeriods.map(p => `MA${p}`);
    const maRanks = [...maKeys].sort((a, b) => maValues[b] - maValues[a]);
    const rankPeriods = maRanks.map(k => parseInt(k.replace('MA', ''), 10));
    const sortedPeriodsAsc = [...cfg.maPeriods].sort((a, b) => a - b);
    const sortedPeriodsDesc = [...sortedPeriodsAsc].reverse();

    let candidate: MAAlignmentV2Cycle;
    if (JSON.stringify(rankPeriods) === JSON.stringify(sortedPeriodsAsc)) {
      candidate = 'uptrend';
    } else if (JSON.stringify(rankPeriods) === JSON.stringify(sortedPeriodsDesc)) {
      candidate = 'downtrend';
    } else {
      candidate = 'sideways';
    }

    // ============ Step 4: 橫行週期精細判定 (均線粘合檢查) ============
    const maValueList = Object.values(maValues);
    const maxMA = Math.max(...maValueList);
    const minMA = Math.min(...maValueList);
    const maxSpreadPct = minMA > 0 ? (maxMA - minMA) / minMA : 0;

    if (
      (candidate === 'uptrend' || candidate === 'downtrend') &&
      maxSpreadPct < cfg.thresholdPct
    ) {
      candidate = 'sideways';
      adjustmentLog.push('均線雖有排列但過於靠近，視為橫行整理');
    }

    // ============ Step 5: 成交量趨勢計算 ============
    let volumeTrendRatio = 1.0;
    let volumeSignal: MAAlignmentV2VolumeSignal = 'neutral';

    if (cfg.enableVolumeWeight) {
      const recent = klines.slice(-cfg.volumeLookback);
      const previous = klines.slice(
        -(cfg.volumeLookback * 2),
        -cfg.volumeLookback,
      );

      const recentAvgVol = recent.reduce((acc, k) => acc + (k.volume || 0), 0) / recent.length;
      const previousAvgVol =
        previous.reduce((acc, k) => acc + (k.volume || 0), 0) / previous.length;

      if (previousAvgVol === 0) {
        volumeTrendRatio = 1.0;
        volumeSignal = 'neutral';
      } else {
        volumeTrendRatio = recentAvgVol / previousAvgVol;
        if (volumeTrendRatio >= cfg.volumeBoostThreshold) {
          volumeSignal = 'expanding';
        } else if (volumeTrendRatio <= cfg.volumeShrinkThreshold) {
          volumeSignal = 'shrinking';
        } else {
          volumeSignal = 'neutral';
        }
      }
    }

    // ============ Step 6: 均線斜率與動能分數 ============
    const maSlopes: Record<string, number> = {};
    let momentumScore = 0;

    if (cfg.enableSlopeCheck) {
      const totalWeight = cfg.maPeriods.reduce((acc, p) => acc + 1 / p, 0);

      for (const period of cfg.maPeriods) {
        const currentMA = maValues[`MA${period}`];
        // 取 price_data[-(period+slope_lookback) : -slope_lookback] 嘅 close 平均
        const pastSegment = klines.slice(
          -(period + cfg.slopeLookback),
          -cfg.slopeLookback,
        );
        if (pastSegment.length === 0) {
          maSlopes[`MA${period}`] = 0;
          continue;
        }
        const pastSum = pastSegment.reduce((acc, k) => acc + k.close, 0);
        const pastMA = pastSum / pastSegment.length;
        const slope = pastMA > 0 ? (currentMA - pastMA) / pastMA : 0;
        maSlopes[`MA${period}`] = slope;
        momentumScore += (slope * (1 / period)) / totalWeight;
      }
    }

    // ============ Step 7: 信心指數 (三階段調整) ============
    // 7a. 基礎信心
    let baseConfidence: number;
    if (candidate === 'uptrend' || candidate === 'downtrend') {
      baseConfidence = Math.min(1.0, maxSpreadPct / cfg.spreadConfidenceScale);
      if (maxSpreadPct < 0.05) baseConfidence *= 0.7;
    } else {
      // sideways
      baseConfidence = Math.max(
        cfg.sidewaysBaseConfidence,
        1.0 - Math.abs(maxSpreadPct - cfg.thresholdPct) / cfg.thresholdPct,
      );
    }

    // 7b. 成交量加權調整
    let volMultiplier = 1.0;
    if (cfg.enableVolumeWeight) {
      if (candidate === 'uptrend') {
        if (volumeSignal === 'expanding') {
          volMultiplier = Math.min(
            1.25,
            1.0 + (volumeTrendRatio - 1.0) * 0.5,
          );
          adjustmentLog.push('放量上漲，信心提升');
        } else if (volumeSignal === 'shrinking') {
          volMultiplier = Math.max(
            0.65,
            1.0 - (1.0 - volumeTrendRatio) * 0.8,
          );
          adjustmentLog.push('上漲縮量，信心打折');
        }
      } else if (candidate === 'downtrend') {
        if (volumeSignal === 'expanding') {
          volMultiplier = 1.15;
          adjustmentLog.push('放量下跌，趨勢確認');
        } else if (volumeSignal === 'shrinking') {
          volMultiplier = 0.85;
          adjustmentLog.push('下跌縮量，動能可能不足');
        }
      } else {
        // sideways
        if (volumeSignal === 'shrinking') {
          volMultiplier = 1.15;
          adjustmentLog.push('縮量整理，橫行信號增強');
        } else if (volumeSignal === 'expanding') {
          volMultiplier = 0.85;
          adjustmentLog.push('放量震盪，可能醞釀突破');
        }
      }
    }

    // 7c. 斜率動能調整
    let slopeMultiplier = 1.0;
    if (cfg.enableSlopeCheck) {
      const sortedPeriods = [...cfg.maPeriods].sort((a, b) => a - b);
      const shortPeriods = sortedPeriods.slice(0, 2);  // 最短期的兩條
      const negativeCount = cfg.maPeriods.filter(
        p => (maSlopes[`MA${p}`] || 0) < 0,
      ).length;

      if (candidate === 'uptrend') {
        if (shortPeriods.some(p => (maSlopes[`MA${p}`] || 0) < 0)) {
          slopeMultiplier = cfg.slopeDiscountFactor;
          adjustmentLog.push('短期均線斜率為負，上升動能減弱');
        } else if (negativeCount > 0) {
          slopeMultiplier = 0.85;
          adjustmentLog.push('部分長期均線斜率為負');
        }
      } else if (candidate === 'downtrend') {
        const longPeriod = Math.max(...cfg.maPeriods);
        if ((maSlopes[`MA${longPeriod}`] || 0) > 0) {
          slopeMultiplier = 0.8;
          adjustmentLog.push('長期均線斜率轉正，下跌動能減弱');
        } else if (shortPeriods.some(p => (maSlopes[`MA${p}`] || 0) > 0)) {
          slopeMultiplier = 0.9;
          adjustmentLog.push('短期均線斜率轉正，可能醞釀反彈');
        }
      } else {
        // sideways
        const avgAbsSlope =
          cfg.maPeriods.reduce((acc, p) => acc + Math.abs(maSlopes[`MA${p}`] || 0), 0) /
          cfg.maPeriods.length;
        if (avgAbsSlope > 0.005) {
          slopeMultiplier = 0.8;
          adjustmentLog.push('均線斜率過大，橫行周期可能即將結束');
        }
      }
    }

    // 7d. 綜合信心
    let confidence = baseConfidence * volMultiplier * slopeMultiplier;
    confidence = Math.max(0.0, Math.min(1.0, confidence));
    confidence = round(confidence, 4);

    // ============ Step 8: 組裝輸出 ============
    const symbol = (ctx as any).symbol || 'UNKNOWN';
    const lastDate = klines[klines.length - 1].date;

    const meta: MAAlignmentV2VerdictMeta = {
      symbol,
      cycle: candidate,
      cycleLabel: CYCLE_LABELS[candidate],
      confidence,
      baseConfidence: round(baseConfidence, 4),
      maValues: Object.fromEntries(
        Object.entries(maValues).map(([k, v]) => [k, round(v, 4)]),
      ),
      maRanks,
      maSlopes: Object.fromEntries(
        Object.entries(maSlopes).map(([k, v]) => [k, round(v, 6)]),
      ),
      momentumScore: round(momentumScore, 6),
      volumeTrendRatio: round(volumeTrendRatio, 4),
      volumeSignal,
      maxSpreadPct: round(maxSpreadPct, 6),
      adjustmentLog,
      reason: `【週期】${CYCLE_LABELS[candidate]}${adjustmentLog.length > 0 ? '；' + adjustmentLog.join('；') : ''}`,
      lastDate,
    };

    // 派生 state 給 Synthesizer (UP / DOWN / SIDEWAYS, 跟其他 module 對齊)
    const stateMap: Record<MAAlignmentV2Cycle, 'UP' | 'DOWN' | 'SIDEWAYS'> = {
      uptrend: 'UP',
      downtrend: 'DOWN',
      sideways: 'SIDEWAYS',
    };

    return {
      moduleId: this.id,
      timeframe: (ctx as any).ltf || '1d',
      state: stateMap[candidate],
      confidence,
      interpretation: meta.reason,
      evidence: adjustmentLog.map(log => ({
        type: 'adjustment',
        label: log,
        value: log,
        passed: true,
      })),
      warnings: volumeSignal === 'expanding' && candidate === 'sideways'
        ? ['放量震盪, 等待方向確認']
        : [],
      meta,
      timestamp: Date.now(),
    };
  }
}

export default MAAlignmentV2Module;

// =============================================================
// 大少 2026-08-08 12:00 — Sprint 1 sub-task 1.1 — M7 standard verdict wrapper
// =============================================================
/** M1 MA alignment v2.0 嘅 standard verdict wrapper
 *  將 CycleVerdict (含 maValues / maRanks / volumeTrendRatio / momentumScore 等)
 *  轉成 ModuleStandardVerdict (4 個 fields + sentiment_6d)
 *  @example
 *    const sv = await toStandardVerdictMA(klines, { symbol: 'HK.00700', ltf: '1d' });
 *    console.log(sv.base_weight);  // 0.25
 */
export async function toStandardVerdictMA(
  klines: KLine[],
  ctx: CycleContext,
  config: MAAlignmentV2Config = DEFAULT_MA_ALIGNMENT_V2_CONFIG,
): Promise<ModuleStandardVerdict> {
  return runAndStandardize(new MAAlignmentV2Module(config), klines, ctx, 'ma-alignment');
}
