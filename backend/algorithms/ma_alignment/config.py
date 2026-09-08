"""
backend/algorithms/ma-alignment/config.py — M1 algorithm config v2.5.0 (大少 2026-08-20 20:05 Phase 2, v2.2.0 adaptive 2026-08-21, v2.4.0 拎走強升中整固 2026-09-08, v2.5.0 confidence 增減量 2026-09-08 20:31)

凡人話: M1 algorithm 嘅 default 參數, 大少可經 options 覆寫
對應 source: algorithms/AS-03-cycle-detection/modules/ma-alignment.ts 嘅 MAAlignmentV2Config
"""

# 凡人話: M1 algorithm 嘅 8 個 step 對應嘅 default config (v2.5.0 confidence 改增減量, 對齊大少 2026-09-08 20:31 trigger Sub-Option C)
# 全部用 dict (唔用 dataclass), 因為 Algorithm contract options 入面直接拎
DEFAULT_MA_ALIGNMENT_V2_CONFIG: dict = {
    # MA 週期
    "maPeriods": [5, 10, 20, 60],

    # 成交量加權
    "enableVolumeWeight": True,
    "volumeLookback": 5,
    "volumeBoostThreshold": 1.25,
    "volumeShrinkThreshold": 0.65,

    # 斜率動能
    "enableSlopeCheck": True,
    "slopeLookback": 5,
    "slopeDiscountFactor": 0.7,

    # 信心指數
    # v2.2.0 (大少 2026-08-21 18:37): 改用 adaptive thresholdPct
    # 原本 hard-code 0.02 (2%), 而家用 None = 動態計算
    # 公式: clamp(MA20_ATR% × 1.5, 0.005, 0.05)
    # 凡人話: 根據該股票自己嘅 20 日波動率自動計 threshold
    "thresholdPct": None,  # None = 用 adaptive (ATR% × 1.5), 或傳 number = 固定 override
    "thresholdAdaptiveMultiplier": 1.5,  # ATR% 倍數
    "thresholdMinPct": 0.005,  # 0.5% floor
    "thresholdMaxPct": 0.05,   # 5% cap
    "thresholdAtrLookback": 20,  # ATR 計算回看天數
    "spreadConfidenceScale": 0.10,  # v2.5.0 仍保留 (向後相容), 算法實際改用 max_spread_pct × 4
    "sidewaysBaseConfidence": 0.3,

    # v2.5.0 (大少 2026-09-08 20:31 trigger Sub-Option C): 6 對 boost/penalty 配對
    # 凡人話: 每個 boost/penalty % 大少可手動微調 (對齊 Config UX 模式 8月19日 trigger)
    # 6 對永遠平衡: 放量 vs 縮量, 短斜正 vs 短斜負, 強升長正 vs 強跌長正, spread 闊 vs 細, 趨勢一致 vs 分裂, 橫行斜率大
    "boostVolExpanding":        0.05,   # 配對 1 boost: 放量
    "penaltyVolShrinking":      0.10,   # 配對 1 penalty: 縮量 (對沖)
    "boostShortSlopePos":       0.03,   # 配對 2 boost: 短斜率正
    "penaltyShortSlopeNeg":     0.08,   # 配對 2 penalty: 短斜率負 (對沖)
    "boostLongSlopeUptrend":    0.02,   # 配對 3 boost: 強升 + 長斜率正
    "penaltyLongSlopeDowntrend":0.05,   # 配對 3 penalty: 強跌 + 長斜率正 (對沖)
    "boostSpreadWide":          0.02,   # 配對 4 boost: spread ≥ 5%
    "penaltySpreadNarrow":      0.05,   # 配對 4 penalty: spread < 2% (對沖)
    "boostTrendConsistent":     0.04,   # 配對 5 boost: 4 條均線斜率同方向
    "penaltySlopeDiverged":     0.06,   # 配對 5 penalty: 斜率分裂 (對沖)
    "penaltySidewaysSlope":     0.04,   # 配對 6 penalty: 橫行但斜率過大 (冇對應 boost, 橫行特性)

    # v2.4.0 (大少 2026-09-08): 拎走 consolidationLookback + consolidationRangeThresholdPct
    # 原本畀「強升中整固」sub-scenario 用, 9月8日 audit 217 stock 證明 0 隻 stock 真係 hit 過
}
