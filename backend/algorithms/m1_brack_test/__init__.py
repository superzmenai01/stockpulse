"""
backend/algorithms/m1_brack_test/ — M1 Brack Test algorithm package (大少 2026-09-14 21:16 confirm)

凡人話: 將 M1 對歷史每日逐日回放, 收集每次觸發 sub_scenario 嘅 hit 記錄
對應 plan: docs/research/AS-03-cycle-detection/MODULE-BRACK-TEST.md (待新加)

Algorithm: Algorithm abstract class implementation, sub-loop 跑 M1 + 收集 hits
- start_index = max_period + 5 = 65 (對齊 M1 required_length)
- for i in range(65, len(klines)):
  - trimmed = klines[:i+1]
  - m1_verdict = MaAlignmentV2Algorithm().run(trimmed, options)
  - if m1_verdict.ok AND m1_verdict.meta.cycle != "sideways" (Q1: cycle ≠ sideways):
    - hits.append(...)
"""

from .algorithm import M1BrackTestAlgorithm
from .config import DEFAULT_M1_BRACK_TEST_CONFIG

__all__ = ["M1BrackTestAlgorithm", "DEFAULT_M1_BRACK_TEST_CONFIG"]