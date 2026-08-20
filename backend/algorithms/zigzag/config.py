"""
backend/algorithms/zigzag/config.py — ZigZag 默認配置 (大少 2026-08-20 Phase 1)

凡人話: ZigZag 嘅 default 參數集中喺度, 之後改 threshold / 加新 config 唔使入 algorithm core
"""

# 凡人話: 5% 默認 threshold (即 ref code 嘅 0.05)
# 大少 2026-08-19 trigger: 5% threshold 過濾 noise 拎有意義峰谷
DEFAULT_THRESHOLD: float = 5.0

# 凡人話: 大少 testing page 默認 zoom 落半年 (126 trading days)
# 但 algorithm 計算用 5 年 (1260 days) 全 data, 大少人手 pan/zoom 返去
DEFAULT_DATA_WINDOW_DAYS: int = 1260  # 5 年 (大少 2026-08-14 23:15 永久 rule)
