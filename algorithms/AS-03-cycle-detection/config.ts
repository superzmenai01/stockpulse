// config.ts — AS-03 股票周期性判定 (umbrella) · 所有 tunable thresholds
//
// 大少 #10332 決定: 全部 Kimi v0.2.0 算法刪走
//   移除: thresholdPct / baseConfidenceSpread / baseConfidenceSmallSpreadThreshold /
//         baseConfidenceDiscount / minSidewaysConfidence / MAVolumeSubConfig /
//         MASlopeSubConfig / VolumeConfig / etc.
//   保留: 大少 A-J 10 條 rule 需要嘅 fields
//
// 大少 #10809 (2026-08-06) — Option toggle design:
//   MA alignment = core mandatory (always on, 唔可以 disable)
//   VolumePrice / HL-Structure / Trendline / Indicators = optional toggle
//   預設: VolumePrice ON (高 overlap with MA alignment 已隱藏)
//   大少 2026-08-07 23:15 — SlopeMomentum 暫時隱藏,等 Stage 1 done 最後先做返
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
 * VolumePrice module config (大少 2026-08-07 — Module 5 v2.0.0)
 *
 * 對應 docx `docs/演算法概念SPECS/05成交量價格行為確認法.docx` v2.0 spec
 * Spec doc: `docs/research/AS-03-cycle-detection/MODULE-05-VOLUME-PRICE-V2.md`
 *
 * 跟 quick-draft v1.0 嘅 10 rule K-T 比較,大少 2026-08-07 approved overwrite v1.0 → v2.0
 *   v2.0 根治 v1.0 嘅 9 個硬傷 (見 spec §1),15 條 rule V1-V15 取代 10 條 rule K-T
 */
export interface VolumePriceConfig {
  // Step 0 (data validation)
  volumePercentileLookback: number;   // 60 — 成交量歷史百分位回顧天數
  vwapPeriod: number;                 // 20 — VWAP 計算週期
  breakoutConfirmDays: number;        // 3 — 突破後回撤確認天數
  pullbackCorrelationWindow: number;   // 10 — 回調深度-量相關計算窗口

  // Step 2 (volume pattern)
  volumeSurgeMinDays: number;         // 2 — 放量最少持續日數(避免單日異常)

  // Step 4 (breakout)
  falseBreakoutRetracePct: number;    // 0.5 — 假突破回撤判定比例 (50%)

  // Step 6 (dense zones)
  denseZoneAtrMultiple: number;       // 0.5 — 密集區分箱寬度(幾倍 ATR)
}

export const DEFAULT_VOLUME_PRICE_CONFIG: VolumePriceConfig = {
  volumePercentileLookback: 60,
  vwapPeriod: 20,
  breakoutConfirmDays: 3,
  pullbackCorrelationWindow: 10,

  volumeSurgeMinDays: 2,

  falseBreakoutRetracePct: 0.5,

  denseZoneAtrMultiple: 0.5,
};

/**
 * Volatility module config (大少 2026-08-07 — Module 6 v1.0.0)
 *
 * 對應 docx `docs/演算法概念SPECS/06波動率與市場結構收縮擴張檢測法.docx` v2.0 spec
 * Spec doc: `docs/research/AS-03-cycle-detection/MODULE-06-VOLATILITY.md`
 *
 * 簡化 v1.0 (testing page 唔支援 weekly + market data, daily only):
 *   - Squeeze (BB vs KC) 為主軸
 *   - ATR 分解 (Trend + Noise)
 *   - 3 種失敗模式 (簡化 5→3 種)
 */
export interface VolatilityConfig {
  bbPeriod: number;                // 20 — Bollinger Band 週期
  bbStd: number;                   // 2.0 — BB 標準差倍數
  kcPeriod: number;                // 20 — Keltner Channel 週期
  kcAtrMult: number;               // 1.5 — KC ATR 倍數
  atrPeriod: number;               // 14 — ATR 週期
  squeezeMinDuration: number;      // 3 — Squeeze 最少持續日數
  followThroughDays: number;       // 5 — 突破後跟進檢測天數
  vcpTolerancePct: number;         // 0.02 — VCP 高低點遞減容忍度 (2%)
  vcpMinWindows: number;           // 2 — VCP 最少需要幾個高低點對
}

export const DEFAULT_VOLATILITY_CONFIG: VolatilityConfig = {
  bbPeriod: 20,
  bbStd: 2.0,
  kcPeriod: 20,
  kcAtrMult: 1.5,
  atrPeriod: 14,
  squeezeMinDuration: 3,
  followThroughDays: 5,
  vcpTolerancePct: 0.02,
  vcpMinWindows: 2,
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
  // 大少 2026-08-07 23:15 — slopeMomentum 暫時隱藏,等 Stage 1 done 最後先做返
  hlStructure: boolean;
  trendline: boolean;
  indicators: boolean;
}

export const DEFAULT_ENABLE_FLAGS: EnableFlags = {
  maAlignment: true,
  volumePrice: true,                 // 量價預設 ON
  // 大少 2026-08-07 23:15 — slopeMomentum 暫時隱藏
  hlStructure: true,
  trendline: true,                   // 趨勢線預設 ON
  indicators: true,
};

/**
 * CycleConfig — 全局 config container (大少 #10809 — D005)
 *
 * 將 MA + VolumePrice + EnableFlags 集中喺一個 config object
 * 大少 2026-08-07 23:15 — SlopeMomentum 暫時隱藏,Stage 1 done 最後先做返
 */
/**
 * HLStructure module config (大少 + MiniMax Code 2026-08-07 — Module 2 v0.1.0)
 *
 * 跟 docx `docs/演算法概念SPECS/高低點結構法.docx` v2.0 spec 嘅 13 個 tunable parameters
 * Spec doc: `docs/research/AS-03-cycle-detection/MODULE-02-HL-STRUCTURE.md`
 */
export interface HLStructureConfig {
  // Step 0 (data validation)
  minPairs: number;                    // 3 — 判斷所需最少峰谷對數
  baseWindow: number;                  // 5 — 極值識別基礎窗口 (日數)
  tolerancePct: number;                // 0.015 — 趨勢判定基礎容忍度 (1.5%)

  // Step 1 (ATR)
  enableAtrWindow: boolean;            // true — 開 ATR 自適應窗口
  atrPeriod: number;                   // 14 — ATR 計算週期

  // Step 5 (volume filter)
  enableVolumeFilter: boolean;         // true — 開量能過濾
  volumeConfirmRatio: number;          // 0.7 — 縮量門檻 (相對均量)
  volumeLookback: number;              // 20 — 量能均線長度
  volumeBoostRatio: number;            // 1.3 — 放量加成門檻
  volumeShrinkWeightMultiplier: number;// 0.5 — 縮量 weight 折扣
  volumeBoostWeightMultiplier: number; // 1.2 — 放量 weight 加成

  // Step 4 (breakout confirmation)
  breakoutConfirmDays: number;         // 2 — 突破確認延遲日數 (K)

  // Step 8 (time decay)
  timeDecayLambda: number;             // 0.03 — 指數衰減係數 (0.02~0.05 推薦)

  // Step 13 (pattern alert)
  enablePatternAlert: boolean;         // true — 開形態預警
  patternSymmetryTolerance: number;    // 2 — 對稱容忍度倍數 (effective_tolerance × N)

  // Step 15 (freshness)
  maxExtremeAgeDays: number;           // 20 — 最新極值點過咗 N 日就打折
  freshnessDecayDays: number;          // 30 — 超過 maxAge 後每 N 日線性打折
  freshnessMinMultiplier: number;      // 0.4 — 新鮮度折扣下限
}

/**
 * Trendline module config (大少 + MiniMax Code 2026-08-07 — Module 3 v0.1.0)
 *
 * 跟 docx `docs/演算法概念SPECS/3趨勢線法.docx` v2.0 spec 嘅 9 個 tunable parameters
 * Spec doc: `docs/research/AS-03-cycle-detection/MODULE-03-TRENDLINE.md`
 *
 * 從 Kimi v2.0 簡化: 移除 RANSAC / 成交量加權 / ATR normalized / 假突破 multiplier / %B 指標
 * 改用 10 條 rule-based (A-J), additive confidence, 簡單 OLS 線性回歸
 */
export interface TrendlineConfig {
  // Step 0 (extreme detection)
  extremeWindow: number;              // 3 — 識別極值點嘅左右觀察窗口
  minLinePoints: number;              // 3 — 趨勢線最少擬合點數
  maxLinePoints: number;              // 8 — 趨勢線最多擬合點數 (動態選 R² 最高)

  // Step 2 (fit quality)
  minR2: number;                      // 0.55 — 最低 R² 要求 (rule A/B 觸發條件)

  // Step 4 (touch detection)
  touchTolerancePct: number;          // 0.015 — 觸線判定容忍度 (1.5%)

  // Step 5 (breakout)
  breakoutWindow: number;             // 5 — 過去 N 日內突破先當 breakout
  breakoutConfirmDays: number;       // 2 — 突破後 stay on other side 最少日數

  // Step 6 (projection)
  projectionDays: number;             // 5 — 趨勢線目標價投影天數

  // Step 7 (rule E/F flat threshold)
  flatSlopeThreshold: number;         // 0.001 — |slope| < 0.001 視為平 (rule E/F)

  // Step 9 (freshness)
  maxExtremeAgeDays: number;          // 30 — 趨勢線最舊極值點老化門檻
}

export const DEFAULT_TRENDLINE_CONFIG: TrendlineConfig = {
  extremeWindow: 3,
  minLinePoints: 3,
  maxLinePoints: 8,

  minR2: 0.55,

  touchTolerancePct: 0.015,

  breakoutWindow: 5,
  breakoutConfirmDays: 2,

  projectionDays: 5,

  flatSlopeThreshold: 0.001,

  maxExtremeAgeDays: 30,
};

export const DEFAULT_HL_STRUCTURE_CONFIG: HLStructureConfig = {
  minPairs: 3,             // 2026-08-07 — 改返 3 (高質量,需要 6 個 alternating)
  baseWindow: 5,
  tolerancePct: 0.015,

  enableAtrWindow: true,
  atrPeriod: 14,

  enableVolumeFilter: true,
  volumeConfirmRatio: 0.7,
  volumeLookback: 20,
  volumeBoostRatio: 1.3,
  volumeShrinkWeightMultiplier: 0.5,
  volumeBoostWeightMultiplier: 1.2,

  breakoutConfirmDays: 2,

  timeDecayLambda: 0.03,

  enablePatternAlert: true,
  patternSymmetryTolerance: 2,

  maxExtremeAgeDays: 20,
  freshnessDecayDays: 30,
  freshnessMinMultiplier: 0.4,
};

export interface CycleConfig {
  maAlignment: MAAlignmentConfig;
  volumePrice: VolumePriceConfig;
  // 大少 2026-08-07 23:15 — slopeMomentum 暫時隱藏,Stage 1 done 最後先做返
  hlStructure: HLStructureConfig;
  trendline: TrendlineConfig;
  indicators: IndicatorsConfig;
  volatility: VolatilityConfig;
  enableFlags: EnableFlags;
}

/**
 * Indicators module config (大少 + MiniMax Code 2026-08-07 — Module 4 v1.0.0)
 *
 * 跟 docx `docs/演算法概念SPECS/04動能背馳與衰竭檢測法.docx` v1.0 (Kimi spec)
 * Spec doc: `docs/research/AS-03-cycle-detection/MODULE-04-MOMENTUM-DIVERGENCE.md`
 */
export interface IndicatorsConfig {
  lookbackDays: number;              // 60 — 背馳 + 歷史機會回顧天數
  rsiPeriod: number;                 // 14 — RSI Wilder smoothing period
  macdFast: number;                  // 12 — MACD 快線 EMA period
  macdSlow: number;                  // 26 — MACD 慢線 EMA period
  macdSignal: number;                // 9 — MACD 信號線 EMA period
  divergenceTolerance: number;       // 0.03 — 背馳判定容忍度 (3%)
  minSwingPct: number;               // 0.03 — 最小波動幅度 (過濾雜訊)
  signalThreshold: number;           // 0.6 — 「明確訊號」最低分 (買入/賣出)
}

export const DEFAULT_INDICATORS_CONFIG: IndicatorsConfig = {
  lookbackDays: 60,
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  divergenceTolerance: 0.03,
  minSwingPct: 0.03,
  signalThreshold: 0.6,
};

export const DEFAULT_CYCLE_CONFIG: CycleConfig = {
  maAlignment: DEFAULT_MA_ALIGNMENT_CONFIG,
  volumePrice: DEFAULT_VOLUME_PRICE_CONFIG,
  // 大少 2026-08-07 23:15 — slopeMomentum 暫時隱藏,Stage 1 done 最後先做返
  hlStructure: DEFAULT_HL_STRUCTURE_CONFIG,
  trendline: DEFAULT_TRENDLINE_CONFIG,
  indicators: DEFAULT_INDICATORS_CONFIG,
  volatility: DEFAULT_VOLATILITY_CONFIG,
  enableFlags: DEFAULT_ENABLE_FLAGS,
};