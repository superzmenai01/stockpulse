"""
backend/algorithms/top_bottom_reversal/ — 到頂到底轉勢綜合評分 (大少 2026-08-23)

凡人話: 拎 K 線 + ZigZag 峰谷 → 計 MACD/RSI/KDJ → 偵測頂底背離 → 識別 6 個 K 線形態 → 評分 0-15
對應 extr_specs: docs/extr_specs/到頂轉勢/K线顶部反转判断算法.md
對應 spec doc: docs/research/AS-03-cycle-detection/MODULE-TOP-BOTTOM-REVERSAL.md (即將起)
凡人話: 用 MACD/RSI/KDJ 4 個指標 + 背離偵測 + K 線形態, 判斷股價見頂或見底嘅可能性
"""

from .algorithm import TopBottomReversalAlgorithm
from .indicators import calculate_macd, calculate_rsi, calculate_kdj
from .config import (
    SCORE_WEIGHTS,
    STRENGTH_THRESHOLDS,
    INDICATOR_PARAMS,
    DIVERGENCE_PARAMS,
    VOLUME_PARAMS,
    MA_DEVIATION_THRESHOLD,
)

__all__ = [
    "TopBottomReversalAlgorithm",
    "calculate_macd",
    "calculate_rsi",
    "calculate_kdj",
    "SCORE_WEIGHTS",
    "STRENGTH_THRESHOLDS",
    "INDICATOR_PARAMS",
    "DIVERGENCE_PARAMS",
    "VOLUME_PARAMS",
    "MA_DEVIATION_THRESHOLD",
]
