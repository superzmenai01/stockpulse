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

# Import algorithms 觸發 register (M1 ma_alignment 係第一個, M2 hl_structure 係第二個, M3 trendline 係第三個, M4 indicators 係第四個, M5 volume_price 係第五個, M6 volatility 係第六個, M7 synthesizer 係第七個, M9 back_test 係第八個, M8 decision_engine 係第九個 — Phase 10 大少 2026-08-20 22:08)
# AS-03 chain flow: M7(綜合) → M9(回測取最佳設定) → M8(用最佳設定做最終判斷)
# 9/9 peer algorithm backend done
# 大少 2026-08-30 01:04 — 拎走 backend algorithms/zigzag/ (Phase 1 舊), 之字全部 frontend 計
# (testing page applyFrontendZigZagOverlay 自己 inject 落 verdict.meta.zigzagPoints)
# Spec Sync #46 永久 rule 改: M1 純 MA alignment, 之字 points 由 frontend inject
from .ma_alignment import MAAlignmentV2Algorithm  # noqa: F401  (Phase 2 大少 2026-08-20 20:05)
from .hl_structure import HLStructureAlgorithm  # noqa: F401  (Phase 3 大少 2026-08-20 20:35)
from .trendline import TrendlineAlgorithm  # noqa: F401  (Phase 4 大少 2026-08-20 20:50)
from .indicators import IndicatorsAlgorithm  # noqa: F401  (Phase 5 大少 2026-08-20 21:10)
from .volume_price import VolumePriceAlgorithm  # noqa: F401  (Phase 6 大少 2026-08-20 21:30)
from .volatility import VolatilityAlgorithm  # noqa: F401  (Phase 7 大少 2026-08-20 21:30)
from .synthesizer import SynthesizerAlgorithm  # noqa: F401  (Phase 8 大少 2026-08-20 21:30)
from .back_test import BackTestAlgorithm  # noqa: F401  (Phase 9 大少 2026-08-20 21:54)
from .decision_engine import DecisionEngineAlgorithm  # noqa: F401  (Phase 10 大少 2026-08-20 22:08)
from .zigzag import ZigZagAlgorithm  # noqa: F401  (大少 2026-08-30 17:50 — 重新建 + register 落 framework, 跟 ma_alignment pattern)
# 🚨 TBR algorithm 已退役 (大少 2026-08-23 18:14), 拎走 import
# TBR file 已 archive 落 archive/algorithms/top_bottom_reversal_2026-08-23/
# 之後大少人手 review 之後決定改良 / 拎 insight

__all__ = [
    "Algorithm",
    "Verdict",
    "KLine",
    "register",
    "get_algorithm",
    "list_algorithms",
    "MAAlignmentV2Algorithm",
    "HLStructureAlgorithm",
    "TrendlineAlgorithm",
    "IndicatorsAlgorithm",
    "VolumePriceAlgorithm",
    "VolatilityAlgorithm",
    "SynthesizerAlgorithm",
    "BackTestAlgorithm",
    "DecisionEngineAlgorithm",
    "ZigZagAlgorithm",  # 大少 2026-08-30 17:50 — 重新建 + register
    # 🚨 TBR algorithm 已退役 (大少 2026-08-23 18:14), 拎走 __all__ entry
]
