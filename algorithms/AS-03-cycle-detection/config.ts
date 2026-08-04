// config.ts — AS-03 股票周期判定 · 所有 tunable thresholds
//
// D005: 集中管理所有 threshold，calibration 改呢度唔使改 code

export interface MAAlignmentConfig {
  fastPeriods: number[];       // 短期 MA 週期 (e.g. [5, 10])
  slowPeriods: number[];       // 長期 MA 週期 (e.g. [20, 60])
  alignmentGapPct: number;     // MA 之間最小 gap % 先算「排列」(預設 0.5%)
  divergenceSlopePct: number;  // 「發散」slope 閾值 (預設 0.05%/bar)
}

export interface HLStructureConfig {
  pivotLookback: number;           // ZigZag lookback (預設 5)
  pivotThresholdPct: number;       // pivot 反轉幅度閾值 (預設 5%)
  minSwingsToConfirm: number;      // 最少 swing 數先確認趨勢 (預設 3)
  boxTolerancePct: number;         // 「箱體」震盪容忍 % (預設 3%)
}

export interface TrendlineConfig {
  fitMethod: 'ransac' | 'linear-regression';
  minTouchPoints: number;          // 至少 N 個 touch point (預設 2)
  tolerancePct: number;            // 距離 trendline 容差 (預設 2%)
  breakoutConfirmPct: number;      // 突破確認幅度 (預設 1%)
}

export interface IndicatorsConfig {
  macd: { fast: number; slow: number; signal: number };
  rsi: { period: number; overbought: number; oversold: number; midline: number };
  bollinger: { period: number; stdDev: number; squeezeThreshold: number };
}

export interface VolumeConfig {
  baselinePeriod: number;          // MA 週期 (預設 5)
  amplificationRatio: number;      // 放量倍數 (預設 1.5)
  shrinkageRatio: number;          // 縮量倍數 (預設 0.7)
}

export interface StateMachineConfig {
  alertOnlyOnRegimeChange: boolean;   // 預設 true — 只喺轉勢觸發 (D003)
  confirmationDays: number;            // 預設 5 — reminder 觀察日數
}

export interface AggregatorConfig {
  strategy: 'htf-override' | 'weighted-vote' | 'expert-rules';
  weights: Partial<Record<string, number>>;   // per-module weight
  htfOverrideConfidence: number;      // HTF override 門檻 (預設 0.7)
}

export interface CycleConfig {
  ma: MAAlignmentConfig;
  hl: HLStructureConfig;
  trendline: TrendlineConfig;
  indicators: IndicatorsConfig;
  volume: VolumeConfig;
  stateMachine: StateMachineConfig;
  aggregator: AggregatorConfig;
}

export const DEFAULT_CYCLE_CONFIG: CycleConfig = {
  ma: {
    fastPeriods: [5, 10],
    slowPeriods: [20, 60],
    alignmentGapPct: 0.5,
    divergenceSlopePct: 0.05,
  },
  hl: {
    pivotLookback: 5,
    pivotThresholdPct: 5,
    minSwingsToConfirm: 3,
    boxTolerancePct: 3,
  },
  trendline: {
    fitMethod: 'ransac',
    minTouchPoints: 2,
    tolerancePct: 2,
    breakoutConfirmPct: 1,
  },
  indicators: {
    macd: { fast: 12, slow: 26, signal: 9 },
    rsi: { period: 14, overbought: 70, oversold: 30, midline: 50 },
    bollinger: { period: 20, stdDev: 2, squeezeThreshold: 0.5 },
  },
  volume: {
    baselinePeriod: 5,
    amplificationRatio: 1.5,
    shrinkageRatio: 0.7,
  },
  stateMachine: {
    alertOnlyOnRegimeChange: true,
    confirmationDays: 5,
  },
  aggregator: {
    strategy: 'htf-override',
    weights: {},
    htfOverrideConfidence: 0.7,
  },
};