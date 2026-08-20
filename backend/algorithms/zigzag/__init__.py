"""
backend/algorithms/zigzag/ — ZigZag algorithm package (大少 2026-08-20 Phase 1)

凡人話: 第一個 algorithm 落 framework
對應舊 frontend: algorithms/AS-03-cycle-detection/adapter.mjs 嘅 calculateZigZag / calcZigZagSlope
對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs
"""

from .algorithm import ZigZagAlgorithm
from .config import DEFAULT_THRESHOLD

__all__ = ["ZigZagAlgorithm", "DEFAULT_THRESHOLD"]
