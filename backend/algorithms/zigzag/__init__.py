"""
backend/algorithms/zigzag/ — ZigZag Algorithm 模組 (大少 2026-08-30 17:50 trigger)

凡人話: 拎 zigzag_testing/algorithm.py 嘅 1-to-1 port frontend 算法移植過嚟,
對齊 frontend testing-page.js calculateZigZagFrontend 算法,
新加 decisionDate / decisionValue / decisionType 3 個 field 畀 chart 上面嘅橙色旗仔 marker。

對應 source:
- testing-page.js:52-75 (autoThresholdVolatility)
- testing-page.js:78-91 (extractHLC)
- testing-page.js 4.9.0/4.10.0 (P 點順序號碼, 1=最新倒序排)
- testing-page.js 4.33.0 (鮮綠線 #00C853 最後 close extension)
- testing-page.js 4.15.0 (大少 fix: 之字拎 point 同 trigger 都用 high/low 對齊, 唔好用 close)
- testing-page.js 4.16.0 (direction flag refactor)
- 大少 2026-08-30 17:50 (新加 decisionDate / decisionValue / decisionType 3 個 field 畀 旗仔 marker)
- testing-page.js:61-155 (calculateZigZagFrontend 1-to-1 port)

Algorithm flow (1-to-1 對齊 frontend):
1. extractHLC 拎 high / low / close arrays (fallback chain: high/High/HIGH, low/Low/LOW, close/Close/CLOSE)
2. autoThresholdVolatility 計自動 threshold (formula: avg((high-low)/close, lookback N) × 2.5, clamp 0.5%-20%)
3. calculateZigZag 拎 ZigZag points (peak/trough, 拎 value 用 high/low, trigger 都用 high/low)
4. 每個 push point 加 decisionDate / decisionValue / decisionType (新加, 畀 旗仔 marker 用)
5. 加鮮綠線 extension_line (從最後 ZigZag point → K 線最後 close, 顏色 #00C853)
6. 加 P 點 sequence (1=最新, 倒序排, 用 testing page 4.9.0 marker 邏輯)
"""

from .algorithm import (
    ZigZagAlgorithm,
    extract_hlc,
    auto_threshold_volatility,
    calculate_zigzag,
    build_extension_line,
    assign_sequence_numbers,
    point_marker_position,
    ZIGZAG_LINE_COLOR,
    EXTENSION_LINE_COLOR,
    DECISION_FLAG_COLOR,
)

__all__ = [
    "ZigZagAlgorithm",
    "extract_hlc",
    "auto_threshold_volatility",
    "calculate_zigzag",
    "build_extension_line",
    "assign_sequence_numbers",
    "point_marker_position",
    "ZIGZAG_LINE_COLOR",
    "EXTENSION_LINE_COLOR",
    "DECISION_FLAG_COLOR",
]
