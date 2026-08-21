"""
backend/algorithms/ma-alignment/config.py — M1 algorithm config (大少 2026-08-20 20:05 Phase 2, v2.2.0 adaptive 2026-08-21)

凡人話: M1 algorithm 嘅 default 參數, 大少可經 options 覆寫
對應 source: algorithms/AS-03-cycle-detection/modules/ma-alignment.ts 嘅 MAAlignmentV2Config
"""

# 凡人話: M1 algorithm 嘅 9 個 step 對應嘅 default config
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
    "spreadConfidenceScale": 0.10,
    "sidewaysBaseConfidence": 0.3,
}
