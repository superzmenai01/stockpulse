// config.ts — AS-03 股票周期判定 · 所有 tunable thresholds
//
// 大少 #10332 決定: 全部 Kimi v0.2.0 算法刪走
//   移除: thresholdPct / baseConfidenceSpread / baseConfidenceSmallSpreadThreshold /
//         baseConfidenceDiscount / minSidewaysConfidence / MAVolumeSubConfig /
//         MASlopeSubConfig / VolumeConfig / etc.
//   保留: 大少 A-J 10 條 rule 需要嘅 fields
//
// 大少 #10809 (2026-08-06) — Option toggle design:
//   MA alignment = core mandatory (always on, 唔可以 disable)
//   VolumePrice / SlopeMomentum / HL-Structure / Trendline / Indicators = optional toggle
//   預設: VolumePrice ON, SlopeMomentum OFF (高 overlap with MA alignment)
//
// D005: 集中管理所有 threshold，calibration 改呢度唔使改 code
// D019: Option toggle design (大少 trigger #10809)

export interface MAAlignmentConfig {
  // Step 1 (data)
  dataWindowDays: number;             // 100 — 目標取 N 日數據 (大少 #10299)
  minDataDays: number;               // 90 — 少過就報錯 (大少 #10299)

  // Step 3 (rules)
  consecutiveDays: number;           // 5 — Case A/B/F/G 用嘅連續日數
  reversalWindowDays: number;        // 7 — Case H 用嘅反轉窗口

  // Step 3 rules I, J (大少 #10301 / #10317)
  chanceThresholdPct: number;        // 0.02 — 2% threshold
  chanceWindowDays: number;          // 5 — 連續日數 (同 consecutiveDays 但分開 config)
  chanceConfidenceBonus: number;     // 0.10 — I/J fire 時 conf bonus
}

export const DEFAULT_MA_ALIGNMENT_CONFIG: MAAlignmentConfig = {
  dataWindowDays: 100,
  minDataDays: 90,
  consecutiveDays: 5,
  reversalWindowDays: 7,
  chanceThresholdPct: 0.02,
  chanceWindowDays: 5,
  chanceConfidenceBonus: 0.10,
};

/**
 * VolumePrice module config (大少 #10809 — Module 5 v1.0.0)
 *
 * 跟 quick-draft-main-agent.md Section Module 5 嘅 10 rule K-T
 */
export interface VolumePriceConfig {
  consecutiveDays: number;           // 5 — K/L/M/N 連續日數
  volumeLookback: number;            // 20 — Q/R 均量比較長度
  boostThreshold: number;            // 1.2 — 放量門檻 (5日/20日 均量比)
  shrinkThreshold: number;           // 0.8 — 縮量門檻
  obvLookback: number;               // 5 — OBV 突破/跌破窗口 (O/P)
  divergenceCorrelation: number;     // -0.5 — 量能背馳 correlation 門檻 (S)
}

export const DEFAULT_VOLUME_PRICE_CONFIG: VolumePriceConfig = {
  consecutiveDays: 5,
  volumeLookback: 20,
  boostThreshold: 1.2,
  shrinkThreshold: 0.8,
  obvLookback: 5,
  divergenceCorrelation: -0.5,
};

/**
 * SlopeMomentum module config (大少 #10809 — Module 8 v1.0.0)
 *
 * 跟 quick-draft-main-agent.md Section Module 8 嘅 10 rule M1-M10
 */
export interface SlopeMomentumConfig {
  shortPeriod: number;               // 5 — MA5 slope 窗口
  midPeriod: number;                 // 10 — MA10 slope 窗口
  longPeriod: number;                // 20 — MA60 slope 窗口
  shortSlopeThreshold: number;       // 0.005 (0.5%) — 短期斜率強弱門檻 (M1/M2)
  midSlopeThreshold: number;         // 0.003 (0.3%) — 中期斜率強弱門檻 (M3/M4)
  longSlopeThreshold: number;        // 0.002 (0.2%) — 長期斜率強弱門檻 (M5/M6)
  reversalWindow: number;            // 5 — M7/M8 短期斜率反轉窗口
}

export const DEFAULT_SLOPE_MOMENTUM_CONFIG: SlopeMomentumConfig = {
  shortPeriod: 5,
  midPeriod: 10,
  longPeriod: 20,
  shortSlopeThreshold: 0.005,
  midSlopeThreshold: 0.003,
  longSlopeThreshold: 0.002,
  reversalWindow: 5,
};

/**
 * Enable flags (大少 #10809 — D019)
 *
 * maAlignment = core mandatory (always true, 唔可以 disable)
 * 其他 5 個 module 都可以 toggle
 */
export interface EnableFlags {
  maAlignment: true;                 // core — locked true
  volumePrice: boolean;
  slopeMomentum: boolean;
  hlStructure: boolean;
  trendline: boolean;
  indicators: boolean;
}

export const DEFAULT_ENABLE_FLAGS: EnableFlags = {
  maAlignment: true,
  volumePrice: true,                 // 量價預設 ON
  slopeMomentum: false,              // 斜率預設 OFF (高 overlap with MA alignment)
  hlStructure: true,
  trendline: true,
  indicators: true,
};

/**
 * CycleConfig — 全局 config container (大少 #10809 — D005)
 *
 * 將 MA + VolumePrice + SlopeMomentum + EnableFlags 集中喺一個 config object
 */
export interface CycleConfig {
  maAlignment: MAAlignmentConfig;
  volumePrice: VolumePriceConfig;
  slopeMomentum: SlopeMomentumConfig;
  enableFlags: EnableFlags;
}

export const DEFAULT_CYCLE_CONFIG: CycleConfig = {
  maAlignment: DEFAULT_MA_ALIGNMENT_CONFIG,
  volumePrice: DEFAULT_VOLUME_PRICE_CONFIG,
  slopeMomentum: DEFAULT_SLOPE_MOMENTUM_CONFIG,
  enableFlags: DEFAULT_ENABLE_FLAGS,
};