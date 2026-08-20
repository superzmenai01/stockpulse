"""
backend/algorithms/ — Algorithm framework (大少 2026-08-20 Phase 1)

凡人話: 所有 algorithm 住喺度, 之後 M1/M2/... 全部落 framework
新 session 接手必讀 (備份 ref: backups/zigzag-frontend-2026-08-20/)

Framework contract:
- 每個 algorithm 都要 implement `backend.algorithms.base.Algorithm` ABC
- Algorithm.run(klines, options) 收 K 線 + 自訂參數, return Verdict
- Verdict 嘅 shape 統一, frontend / 其他 module 直接用
- Registry pattern: 將 algorithm 實例 register 落 `_REGISTRY`, 之後加新 algorithm 唔使改 main.py

永久 rule (大少 2026-08-20):
- 永遠唔好將 algorithm logic 直接寫喺 endpoint, 一定要用 runner service (`backend.services.algorithm_runner`)
- 永遠唔好喺 algorithm 入面 fetch K 線, K 線由 runner service 統一拎
- 每個 algorithm 都要有對應 pytest (`backend/tests/test_<algo>.py`)
- Algorithm output 嘅 warning 跟 Module Warning System v1.1.0 (CATEGORY_DISPLAY template)
"""

from .base import Algorithm, Verdict, KLine
from .registry import register, get_algorithm, list_algorithms

# Import algorithms 觸發 register (zigzag 係第一個, M1 ma_alignment 係第二個, 之後加 M2/M3 喺呢度加)
from .zigzag import ZigZagAlgorithm  # noqa: F401  (import 觸發 register)
from .ma_alignment import MAAlignmentV2Algorithm  # noqa: F401  (Phase 2 大少 2026-08-20 20:05)

__all__ = [
    "Algorithm",
    "Verdict",
    "KLine",
    "register",
    "get_algorithm",
    "list_algorithms",
    "ZigZagAlgorithm",
    "MAAlignmentV2Algorithm",
]
