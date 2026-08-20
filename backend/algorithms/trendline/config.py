"""
backend/algorithms/trendline/config.py — M3 Trendline v0.1.0 (大少 2026-08-20 20:50 Phase 4)

凡人話: M3 algorithm 嘅 default 參數, 大少可經 options 覆寫
對應 source: algorithms/AS-03-cycle-detection/modules/trendline.ts 嘅 TrendlineConfig
對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs (line 4254 嘅 DEFAULT_TRENDLINE_CONFIG)
"""

# 凡人話: M3 algorithm 10 條 rule (A-J) 對應嘅 default config
# 全部用 dict (唔用 dataclass), 因為 Algorithm contract options 入面直接拎
DEFAULT_TRENDLINE_CONFIG: dict = {
    "extremeWindow": 3,
    "minLinePoints": 3,
    "maxLinePoints": 8,
    "minR2": 0.55,
    "touchTolerancePct": 0.015,
    "breakoutWindow": 5,
    "breakoutConfirmDays": 2,
    "projectionDays": 5,
    "flatSlopeThreshold": 0.001,
    "maxExtremeAgeDays": 30,
}
