"""
backend/algorithms/hl-structure/config.py — M2 HL Structure v0.1.0 (大少 2026-08-20 20:35 Phase 3)

凡人話: M2 algorithm 嘅 default 參數, 大少可經 options 覆寫
對應 source: algorithms/AS-03-cycle-detection/modules/hl-structure.ts 嘅 HLStructureConfig
對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs (line 3793 嘅 DEFAULT_HL_STRUCTURE_CONFIG)
"""

# 凡人話: M2 algorithm 18 步對應嘅 default config
# 全部用 dict (唔用 dataclass), 因為 Algorithm contract options 入面直接拎
DEFAULT_HL_STRUCTURE_CONFIG: dict = {
    "minPairs": 3,             # 2026-08-07 — 改返 3 (高質量,需要 6 個 alternating)
    "baseWindow": 5,
    "tolerancePct": 0.015,
    "enableAtrWindow": True,
    "atrPeriod": 14,
    "enableVolumeFilter": True,
    "volumeConfirmRatio": 0.7,
    "volumeLookback": 20,
    "volumeBoostRatio": 1.3,
    "volumeShrinkWeightMultiplier": 0.5,
    "volumeBoostWeightMultiplier": 1.2,
    "breakoutConfirmDays": 2,
    "timeDecayLambda": 0.03,
    "enablePatternAlert": True,
    "patternSymmetryTolerance": 2,
    "maxExtremeAgeDays": 20,
    "freshnessDecayDays": 30,
    "freshnessMinMultiplier": 0.4,
}
