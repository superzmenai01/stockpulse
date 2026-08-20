"""
backend/algorithms/ma-alignment/config.py — M1 algorithm config (大少 2026-08-20 20:05 Phase 2)

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
    "thresholdPct": 0.02,  # max spread < 2% 強制覆寫做橫行
    "spreadConfidenceScale": 0.10,
    "sidewaysBaseConfidence": 0.3,
}
