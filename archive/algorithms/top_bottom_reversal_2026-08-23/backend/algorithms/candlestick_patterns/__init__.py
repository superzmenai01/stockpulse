"""
backend/algorithms/candlestick_patterns/ — K 線形態識別 (大少 2026-08-23)

凡人話: 識別見頂 / 見底嘅 K 線形態, 用嚟做 top_bottom_reversal 評分
- top_patterns.py: 烏雲蓋頂 / 看跌吞沒 / 黃昏之星 (3 個見頂形態)
- bottom_patterns.py: 晨星 / 看漲吞沒 / 曙光初現 (3 個見底形態)

對應 source: docs/extr_specs/到頂轉勢/top_reversal.py (大少 2026-08-23 畀嘅 reference)
對應 spec: MODULE-TOP-BOTTOM-REVERSAL.md (即將起)
凡人話: 3 個見頂 K 線形態 (預警股價見頂) + 3 個見底 K 線形態 (預警股價見底)
"""

from .top_patterns import (
    detect_dark_cloud_cover,
    detect_bearish_engulfing,
    detect_evening_star,
    detect_all_top_patterns,
)
from .bottom_patterns import (
    detect_morning_star,
    detect_bullish_engulfing,
    detect_piercing_pattern,
    detect_all_bottom_patterns,
)

__all__ = [
    "detect_dark_cloud_cover",
    "detect_bearish_engulfing",
    "detect_evening_star",
    "detect_all_top_patterns",
    "detect_morning_star",
    "detect_bullish_engulfing",
    "detect_piercing_pattern",
    "detect_all_bottom_patterns",
]
