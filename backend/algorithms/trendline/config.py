"""
backend/algorithms/trendline/config.py — M3 Trendline v0.1.0 (大少 2026-08-20 20:50 Phase 4)

凡人話: M3 algorithm 嘅 default 參數, 大少可經 options 覆寫
對應 source: algorithms/AS-03-cycle-detection/modules/trendline.ts 嘅 TrendlineConfig
對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs (line 4254 嘅 DEFAULT_TRENDLINE_CONFIG)
"""

# 凡人話: M3 algorithm 10 條 rule (A-J) 對應嘅 default config
# 全部用 dict (唔用 dataclass), 因為 Algorithm contract options 入面直接拎
#
# Bulkowski 對齊 (大少 2026-09-07 Spec Sync #45, 對齊權威 source thepatternsite.com):
#   - minR2: 0.55 → 0.6 (Bulkowski trendline 標準, 學術文獻普遍 0.6-0.7)
#   - minLineLength: 30 日 (Bulkowski median 48 days 偏緊, 30 日做 minimum)
#   - minTouchSpacing: 5 日 (Bulkowski median 13 days 嘅 minimum floor)
#   - maxLineSlope: 0.05 (Bulkowski shallow trendline 標準)
DEFAULT_TRENDLINE_CONFIG: dict = {
    "extremeWindow": 3,
    "minLinePoints": 3,
    "maxLinePoints": 8,
    "minR2": 0.6,           # 0.55 → 0.6 (Bulkowski 2005 Encyclopedia 標準)
    "minLineLength": 30,    # 新加: 趨勢線覆蓋至少 30 日 (Bulkowski median 48)
    "minTouchSpacing": 5,   # 新加: 觸線間距至少 5 日 (Bulkowski median 13)
    "maxLineSlope": 0.05,   # 新加: slope 絕對值 ≤ 0.05 (Bulkowski shallow)
    "touchTolerancePct": 0.015,
    "breakoutWindow": 5,
    "breakoutConfirmDays": 2,
    "projectionDays": 5,
    "flatSlopeThreshold": 0.001,
    "maxExtremeAgeDays": 30,
}
