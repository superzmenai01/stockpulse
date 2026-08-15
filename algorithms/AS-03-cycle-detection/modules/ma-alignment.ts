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

// 大少 2026-08-15 — M1 v2.1.0: extend 8 個 scenario (跟 CSV spec + 用 MA slope 補強)
// 凡人話: 之前只 return 3 個 state (uptrend / downtrend / sideways), 7 個 scenario 全部判錯
//   包括「強上升」、「強下跌」、「上升回調」、「下跌反彈」、「到頂轉勢」、「到底轉勢」、「弱上升」、「弱下跌」
//   而家 extend 做 8 個 sub-scenario, 每個 scenario 有 強度 (強/弱) + 位置 (mid_stage / tentative / range_bound / correction / bounce / late_stage)
export type MAAlignmentV2Cycle =
  | 'strong_uptrend'       // 強上升
  | 'weak_uptrend'         // 弱上升
  | 'sideways'             // 橫行
  | 'weak_downtrend'       // 弱下跌
  | 'strong_downtrend'     // 強下跌
  | 'uptrend_correction'   // 上升回調
  | 'downtrend_bounce'     // 下跌反彈
  | 'decelerating_up'      // 到頂轉勢 (uptrend 轉 sideways/downtrend)
  | 'decelerating_down';   // 到底轉勢 (downtrend 轉 sideways/uptrend)

export type MAAlignmentV2VolumeSignal = 'expanding' | 'shrinking' | 'neutral';
export type MAAlignmentV2Position =
  | 'mid_stage'             // 強趨勢中期
  | 'tentative_rise'        // 剛開始升
  | 'tentative_fall'       // 剛開始跌
  | 'range_bound'           // 橫行整理
  | 'correction_at_ma20'    // 上升回調到 20 日均線
  | 'bounce_in_progress'   // 下跌反彈進行中
  | 'late_stage_topping'    // 到頂轉勢中
  | 'late_stage_bottoming'; // 到底轉勢中

export interface MAAlignmentV2VerdictMeta {
  symbol: string;
  cycle: MAAlignmentV2Cycle;
  cycleLabel: string;
  cyclePosition: MAAlignmentV2Position;
  cyclePositionLabel: string;
  confidence: number;
  baseConfidence: number;
  maValues: Record<string, number>;
  maRanks: string[];
  maSlopes: Record<string, number>;
  momentumScore: number;
  volumeTrendRatio: number;
  volumeSignal: MAAlignmentV2VolumeSignal;
  maxSpreadPct: number;
  consecutiveDays: number;  // 最近連升/連跌日數 (到頂轉勢/到底轉勢用)
  adjustmentLog: string[];
  reason: string;
  lastDate: string;
}

const CYCLE_LABELS: Record<MAAlignmentV2Cycle, string> = {
  strong_uptrend:     '強上升週期',
  weak_uptrend:       '弱上升週期',
  sideways:           '橫行週期',
  weak_downtrend:     '弱下跌週期',
  strong_downtrend:   '強下跌週期',
  uptrend_correction: '上升回調中',
  downtrend_bounce:   '下跌反彈中',
  decelerating_up:    '到頂轉勢中',
  decelerating_down:  '到底轉勢中',
};

const POSITION_LABELS: Record<MAAlignmentV2Position, string> = {
  mid_stage:            '趨勢中期 (主升/主跌段)',
  tentative_rise:       '剛開始升 (起勢)',
  tentative_fall:      '剛開始跌 (起勢)',
  range_bound:          '橫行整理中',
  correction_at_ma20:   '回調到 20 日均線',
  bounce_in_progress:  '反彈進行中',
  late_stage_topping:   '到頂轉勢中 (見頂跡象)',
  late_stage_bottoming: '到底轉勢中 (見底跡象)',
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

    // Step 3.5 嘅 9 個 sub-scenario 判定已搬到 Step 5.5 (Step 5 成交量訊號之後) — 大少 2026-08-15 fix
    // 因為 Priority 2 / 3 嘅 「強上升 / 強下跌」判定需要 volumeSignal, 而 volumeSignal 喺 Step 5 先計算

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

    // ============ Step 5.5: 9 個 sub-scenario 細分判定 (大少 2026-08-15) ============
    // 凡人話: 之前只 return 3 個 state, 8 個 sub-scenario 全部 miss
    // 跟 CSV spec: 強上升 / 弱上升 / 橫行 / 弱下跌 / 強下跌 / 上升回調 / 下跌反彈 / 到頂轉勢 / 到底轉勢
    // 用 MA 排列 + MA 斜率 + 成交量 + 連續日數 細分
    //   - Priority 1 (transition, 最重要): 到頂轉勢 / 到底轉勢
    //   - Priority 2 (強趨勢): 強上升 / 強下跌
    //   - Priority 3 (弱趨勢): 弱上升 / 弱下跌
    //   - Priority 4 (過渡形態): 上升回調 / 下跌反彈
    //   - Default: 橫行
    // 排喺 Step 5 之後係因為 Priority 2 / 3 嘅 「強上升 / 強下跌」判定需要 volumeSignal
    const sortedPeriodsAsc2 = [...cfg.maPeriods].sort((a, b) => a - b);
    const sortedPeriodsDesc2 = [...sortedPeriodsAsc2].reverse();
    const isBullishArrangement = JSON.stringify(rankPeriods) === JSON.stringify(sortedPeriodsAsc2);
    const isBearishArrangement = JSON.stringify(rankPeriods) === JSON.stringify(sortedPeriodsDesc2);

    // 計最近連續跌日數 + 連續升日數 (到頂轉勢 / 到底轉勢用)
    let consecutiveDownDays = 0;
    for (let i = klines.length - 1; i > 0; i--) {
      if (klines[i].close < klines[i - 1].close) {
        consecutiveDownDays++;
      } else {
        break;
      }
    }
    let consecutiveUpDays = 0;
    for (let i = klines.length - 1; i > 0; i--) {
      if (klines[i].close > klines[i - 1].close) {
        consecutiveUpDays++;
      } else {
        break;
      }
    }

    let subScenario: MAAlignmentV2Cycle;
    let cyclePosition: MAAlignmentV2Position;

    // 拎短期 / 長期 MA 嘅 slope (用 maValues 對比 5 日前 close 平均, 唔等 Step 6 嘅 maSlopes 因為要獨立用)
    const calcSlope = (period: number) => {
      const currentMA = maValues[`MA${period}`];
      const pastSegment = klines.slice(-(period + 5), -5);
      if (pastSegment.length === 0) return 0;
      const pastMA = pastSegment.reduce((acc, k) => acc + k.close, 0) / pastSegment.length;
      return pastMA > 0 ? (currentMA - pastMA) / pastMA : 0;
    };
    const slopeMA5 = calcSlope(5);
    const slopeMA10 = calcSlope(10);
    const slopeMA60 = calcSlope(60);
    const allShortSlopeNegative = slopeMA5 < 0 && slopeMA10 < 0;
    const allShortSlopePositive = slopeMA5 > 0 && slopeMA10 > 0;
    const longSlopePositive = slopeMA60 > 0;
    const longSlopeNegative = slopeMA60 < 0;

    // Priority 1: 到頂轉勢 (uptrend → decelerating)
    //   條件: 短期急跌 (MA5 -3%+) + 長期仲升 (MA60 > 0) + 最近 4+ 日連跌
    if (slopeMA5 < -0.03 && longSlopePositive && consecutiveDownDays >= 4) {
      subScenario = 'decelerating_up';
      cyclePosition = 'late_stage_topping';
      adjustmentLog.push(`到頂轉勢跡象: 短期急跌 ${(slopeMA5 * 100).toFixed(2)}% + 長期均線仲升 + 連跌 ${consecutiveDownDays} 日`);
    }
    // Priority 1: 到底轉勢 (downtrend → decelerating)
    //   條件: 短期急升 (MA5 +3%+) + 長期仲跌 (MA60 < 0) + 最近 4+ 日連升
    else if (slopeMA5 > 0.03 && longSlopeNegative && consecutiveUpDays >= 4) {
      subScenario = 'decelerating_down';
      cyclePosition = 'late_stage_bottoming';
      adjustmentLog.push(`到底轉勢跡象: 短期急升 ${(slopeMA5 * 100).toFixed(2)}% + 長期均線仲跌 + 連升 ${consecutiveUpDays} 日`);
    }
    // Priority 2: 強上升 (排列全 bull + 全部 MA 斜率正 + 放量)
    else if (isBullishArrangement) {
      const allSlopesPositive = cfg.maPeriods.every(p => calcSlope(p) > 0);
      if (allSlopesPositive && volumeSignal === 'expanding') {
        subScenario = 'strong_uptrend';
        cyclePosition = 'mid_stage';
        adjustmentLog.push('強上升跡象: 全部均線斜率正 + 放量配合');
      } else {
        subScenario = 'weak_uptrend';
        cyclePosition = 'tentative_rise';
        adjustmentLog.push('弱上升跡象: 排列對但部分斜率 / 量能唔配合');
      }
    }
    // Priority 3: 強下跌 / 弱下跌 (排列全 bear)
    else if (isBearishArrangement) {
      const allSlopesNegative = cfg.maPeriods.every(p => calcSlope(p) < 0);
      if (allSlopesNegative && volumeSignal === 'expanding') {
        subScenario = 'strong_downtrend';
        cyclePosition = 'mid_stage';
        adjustmentLog.push('強下跌跡象: 全部均線斜率負 + 放量確認');
      } else {
        subScenario = 'weak_downtrend';
        cyclePosition = 'tentative_fall';
        adjustmentLog.push('弱下跌跡象: 排列對但部分斜率 / 量能唔配合');
      }
    }
    // Priority 4: 上升回調 (排列曾經 bull, 短期急跌但長期仲升)
    else if (allShortSlopeNegative && longSlopePositive && maxSpreadPct >= cfg.thresholdPct) {
      subScenario = 'uptrend_correction';
      cyclePosition = 'correction_at_ma20';
      adjustmentLog.push('上升回調跡象: 短期均線急跌但長期均線仲升 (回調到 20 日均線)');
    }
    // Priority 5: 下跌反彈 (排列曾經 bear, 短期急升但長期仲跌)
    else if (allShortSlopePositive && longSlopeNegative && maxSpreadPct >= cfg.thresholdPct) {
      subScenario = 'downtrend_bounce';
      cyclePosition = 'bounce_in_progress';
      adjustmentLog.push('下跌反彈跡象: 短期均線急升但長期均線仲跌 (反彈進行中)');
    }
    // Default: 橫行
    else {
      subScenario = 'sideways';
      cyclePosition = 'range_bound';
    }

    // 用 subScenario override 原本嘅 candidate (Step 3-4 嘅)
    candidate = subScenario;

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

    // ============ Step 7: 信心指數 (三階段調整, 跟 9 個 sub-scenario) ============
    // 7a. 基礎信心 (跟 sub-scenario)
    let baseConfidence: number;
    if (
      candidate === 'strong_uptrend' || candidate === 'strong_downtrend' ||
      candidate === 'uptrend_correction' || candidate === 'downtrend_bounce' ||
      candidate === 'decelerating_up' || candidate === 'decelerating_down'
    ) {
      // 強趨勢 / 過渡狀態: 用 maxSpreadPct 計
      baseConfidence = Math.min(1.0, maxSpreadPct / cfg.spreadConfidenceScale);
      if (maxSpreadPct < 0.05) baseConfidence *= 0.7;
    } else if (candidate === 'weak_uptrend' || candidate === 'weak_downtrend') {
      // 弱趨勢: 信心打折 (基礎 0.5)
      baseConfidence = Math.min(0.7, maxSpreadPct / cfg.spreadConfidenceScale * 0.7);
    } else {
      // sideways
      baseConfidence = Math.max(
        cfg.sidewaysBaseConfidence,
        1.0 - Math.abs(maxSpreadPct - cfg.thresholdPct) / cfg.thresholdPct,
      );
    }

    // 7b. 成交量加權調整 (跟 9 個 sub-scenario)
    let volMultiplier = 1.0;
    if (cfg.enableVolumeWeight) {
      if (candidate === 'strong_uptrend' || candidate === 'weak_uptrend' || candidate === 'uptrend_correction') {
        if (volumeSignal === 'expanding') {
          volMultiplier = Math.min(1.25, 1.0 + (volumeTrendRatio - 1.0) * 0.5);
          adjustmentLog.push('放量上漲，信心提升');
        } else if (volumeSignal === 'shrinking') {
          volMultiplier = Math.max(0.65, 1.0 - (1.0 - volumeTrendRatio) * 0.8);
          adjustmentLog.push('上漲縮量，信心打折');
        }
      } else if (candidate === 'strong_downtrend' || candidate === 'weak_downtrend' || candidate === 'downtrend_bounce') {
        if (volumeSignal === 'expanding') {
          volMultiplier = 1.15;
          adjustmentLog.push('放量下跌，趨勢確認');
        } else if (volumeSignal === 'shrinking') {
          volMultiplier = 0.85;
          adjustmentLog.push('下跌縮量，動能可能不足');
        }
      } else if (candidate === 'decelerating_up' || candidate === 'decelerating_down') {
        // 到頂 / 到底轉勢: 成交量訊號唔重要 (已經係 transition 狀態)
        volMultiplier = 1.0;
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

    // 7c. 斜率動能調整 (跟 9 個 sub-scenario)
    let slopeMultiplier = 1.0;
    if (cfg.enableSlopeCheck) {
      const sortedPeriods = [...cfg.maPeriods].sort((a, b) => a - b);
      const shortPeriods = sortedPeriods.slice(0, 2);
      const longPeriod = Math.max(...cfg.maPeriods);
      const negativeCount = cfg.maPeriods.filter(p => (maSlopes[`MA${p}`] || 0) < 0).length;
      const positiveCount = cfg.maPeriods.filter(p => (maSlopes[`MA${p}`] || 0) > 0).length;

      if (candidate === 'strong_uptrend' || candidate === 'weak_uptrend' || candidate === 'uptrend_correction') {
        if (shortPeriods.some(p => (maSlopes[`MA${p}`] || 0) < 0)) {
          slopeMultiplier = cfg.slopeDiscountFactor;
          adjustmentLog.push('短期均線斜率為負，上升動能減弱');
        } else if (negativeCount > 0) {
          slopeMultiplier = 0.85;
          adjustmentLog.push('部分長期均線斜率為負');
        }
      } else if (candidate === 'strong_downtrend' || candidate === 'weak_downtrend' || candidate === 'downtrend_bounce') {
        if ((maSlopes[`MA${longPeriod}`] || 0) > 0) {
          slopeMultiplier = 0.8;
          adjustmentLog.push('長期均線斜率轉正，下跌動能減弱');
        } else if (shortPeriods.some(p => (maSlopes[`MA${p}`] || 0) > 0)) {
          slopeMultiplier = 0.9;
          adjustmentLog.push('短期均線斜率轉正，可能醞釀反彈');
        }
      } else if (candidate === 'decelerating_up' || candidate === 'decelerating_down') {
        // 過渡狀態: 斜率已經反映, 唔再扣分
        slopeMultiplier = 1.0;
      } else {
        // sideways
        const avgAbsSlope = cfg.maPeriods.reduce((acc, p) => acc + Math.abs(maSlopes[`MA${p}`] || 0), 0) / cfg.maPeriods.length;
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
      cyclePosition,
      cyclePositionLabel: POSITION_LABELS[cyclePosition],
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
      consecutiveDays: candidate === 'decelerating_up' ? consecutiveDownDays : (candidate === 'decelerating_down' ? consecutiveUpDays : 0),
      adjustmentLog,
      reason: `【週期】${CYCLE_LABELS[candidate]} (${POSITION_LABELS[cyclePosition]})${adjustmentLog.length > 0 ? '；' + adjustmentLog.join('；') : ''}`,
      lastDate,
    };

    // 派生 state 給 Synthesizer (UP / DOWN / SIDEWAYS, 跟其他 module 對齊)
    // 9 個 sub-scenario map 返 3 個 high-level state
    const stateMap: Record<MAAlignmentV2Cycle, 'UP' | 'DOWN' | 'SIDEWAYS'> = {
      strong_uptrend: 'UP',
      weak_uptrend: 'UP',
      sideways: 'SIDEWAYS',
      weak_downtrend: 'DOWN',
      strong_downtrend: 'DOWN',
      uptrend_correction: 'UP',         // 上升回調中, 仍算上升
      downtrend_bounce: 'DOWN',         // 下跌反彈中, 仍算下跌
      decelerating_up: 'SIDEWAYS',      // 到頂轉勢中, 算過渡
      decelerating_down: 'SIDEWAYS',    // 到底轉勢中, 算過渡
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
