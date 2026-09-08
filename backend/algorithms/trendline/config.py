"""
backend/algorithms/trendline/config.py — M3 Trendline v0.1.0 (大少 2026-08-20 20:50 Phase 4)

凡人話: M3 algorithm 嘅 default 參數, 大少可經 options 覆寫
對應 source: algorithms/AS-03-cycle-detection/modules/trendline.ts 嘅 TrendlineConfig
對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs (line 4254 嘅 DEFAULT_TRENDLINE_CONFIG)
"""

# 凡人話: M3 algorithm 10 條 rule (A-J) + 2 條新 (K/L) 對應嘅 default config
# 全部用 dict (唔用 dataclass), 因為 Algorithm contract options 入面直接拎
#
# Bulkowski 對齊 (大少 2026-09-07 Spec Sync #45, 對齊權威 source thepatternsite.com):
#   - minR2: 0.55 → 0.6 (Bulkowski trendline 標準, 學術文獻普遍 0.6-0.7)
#   - maxLineSlope: 0.05 (Bulkowski shallow trendline 標準)
#
# 大少 2026-09-09 00:42 confirm Spec Sync #51: Bulkowski 條件放寬 (對齊 Donchian 20-period standard)
#   - minLineLength: 30 → 20 (對齊 Donchian 20-period, newtrading.io 100 年 backtest 74.1% win rate)
#   - minTouchSpacing: 5 → 3 (對齊 Donchian 標準, 唔好太嚴令太多 stock 跌 fallback)
#   凡人話: 之前 30 日對 daily K 線太嚴, 改 20 日對齊 Donchian standard, 令 11+ stock 通過 check
#
# 大少 Spec Sync #51 永久 rule:
#   - donchianWindow: 20 (新加, Rule K/L 用, 對齊 Donchian 20-period standard)
DEFAULT_TRENDLINE_CONFIG: dict = {
    "extremeWindow": 3,
    "minLinePoints": 3,
    "maxLinePoints": 8,
    "minR2": 0.6,
    "minLineLength": 20,    # Spec Sync #51: 30 → 20 (對齊 Donchian standard)
    "minTouchSpacing": 3,   # Spec Sync #51: 5 → 3 (放寬觸線間距)
    "maxLineSlope": 0.05,
    "touchTolerancePct": 0.015,
    "breakoutWindow": 5,
    "breakoutConfirmDays": 2,
    "projectionDays": 5,
    "flatSlopeThreshold": 0.001,
    "maxExtremeAgeDays": 30,
    "donchianWindow": 20,   # Spec Sync #51: 新加 Rule K/L 用 (Donchian 20-period standard)
}
