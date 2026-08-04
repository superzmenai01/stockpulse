// config.ts — AS-03 股票周期判定 · 所有 tunable thresholds
//
// 大少 #10332 決定: 全部 Kimi v0.2.0 算法刪走
//   移除: thresholdPct / baseConfidenceSpread / baseConfidenceSmallSpreadThreshold /
//         baseConfidenceDiscount / minSidewaysConfidence / MAVolumeSubConfig /
//         MASlopeSubConfig / VolumeConfig / etc.
//   保留: 大少 A-J 10 條 rule 需要嘅 fields
//
// D005: 集中管理所有 threshold，calibration 改呢度唔使改 code

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