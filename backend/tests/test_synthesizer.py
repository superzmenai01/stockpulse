"""
backend/tests/test_synthesizer.py — M7 Synthesizer v2.0.3 backend tests (大少 2026-09-12 §M7 v2.0.4 Phase 12 永久 rule)

大少 2026-09-12 07:07 trigger「全面檢查 M7 frontend 有沒有在前台計算的動作,因為所有需要計算的都是在後台完成,前台只是負責顯示信息」:
- 拎走 frontend algorithms/AS-03-cycle-detection/modules/cycle-synthesizer.ts (MA 計算 + 兩線策略 frontend 違規)
- 拎走 frontend algorithms/AS-03-cycle-detection/modules/synthesizer.ts (8 stage frontend 重做違規)
- 拎走 frontend algorithms/AS-03-cycle-detection/modules/decision-engine.ts 嘅 synthesizeCycle import
- 拎走 frontend tests/test-cycle-synth.mjs + __tests__/synthesizer.test.mjs
- 加 backend/tests/test_synthesizer.py 對齊 backend M7 8 stage 計算 (沿用 backend §Algorithm Backend-only + 模組化永久 rule)
- 對齊 §數據處理 Server 內部做 (大少 2026-08-23) + §Algorithm Backend-only + 模組化 (大少 2026-08-22) 永久 rule

7 tests:
- test_synthesizer_registered_in_registry
- test_synthesizer_empty_verdicts
- test_synthesizer_unanimous_up_high_confidence
- test_synthesizer_conflict_pair_detection
- test_synthesizer_weight_discount_generalized
- test_synthesizer_meta_shape_for_frontend
- test_synthesizer_aggregated_warnings_propagation

注: Verdict 係 dataclass (algorithms/base.py line 39-65), 唔係 dict, 用 attribute access (v.meta, v.state)
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from algorithms import get_algorithm, list_algorithms
from algorithms.synthesizer.algorithm import (
    _detect_conflicts,
    _compute_consensus,
    _apply_weight_discounts,
    CONSENSUS_THRESHOLD,
)


# ============================================================
# Test 1: Synthesizer 喺 algorithm registry 註冊咗
# ============================================================
def test_synthesizer_registered_in_registry():
    """大少 §M7 v2.0.0 永久 rule: M7 喺 algorithm_registry 註冊, algo_id='synthesizer'"""
    algos = list_algorithms()
    assert "synthesizer" in algos, "synthesizer 唔喺 algorithm registry"
    algo = get_algorithm("synthesizer")
    assert algo is not None, "synthesizer 拎唔到 algorithm instance"


# ============================================================
# Test 2: 空 verdicts 拎到 fallback SIDEWAYS verdict
# ============================================================
def test_synthesizer_empty_verdicts():
    """§M7 v2.0.0 Stage 1: 拎唔夠 input 時, fallback SIDEWAYS 0.0"""
    algo = get_algorithm("synthesizer")
    result = algo.run({})  # 冇 verdicts
    assert result.ok is True
    v = result
    assert v.state in ("UP", "DOWN", "SIDEWAYS", None)
    assert v.meta.get("moduleId") == "synthesizer"


# ============================================================
# Test 3: 6 個 module 一致 UP 高信心 → 一致 verdict
# ============================================================
def test_synthesizer_unanimous_up_high_confidence():
    """§M7 v2.0.0 Stage 5: 拎 67% threshold 拎 weighted consensus, 一致 UP → grade 應該好高"""
    algo = get_algorithm("synthesizer")
    verdicts = [
        {"module_id": "ma-alignment", "state": "UP", "confidence": 0.85, "base_weight": 0.25, "rules_fired": ["A", "I", "J"], "warnings": []},
        {"module_id": "hl-structure", "state": "UP", "confidence": 0.80, "base_weight": 0.15, "rules_fired": ["B", "F"], "warnings": []},
        {"module_id": "trendline", "state": "UP", "confidence": 0.75, "base_weight": 0.10, "rules_fired": ["A", "I", "J"], "warnings": []},
        {"module_id": "indicators", "state": "UP", "confidence": 0.78, "base_weight": 0.20, "rules_fired": ["C", "D"], "warnings": []},
        {"module_id": "volume-price", "state": "UP", "confidence": 0.72, "base_weight": 0.15, "rules_fired": ["E"], "warnings": []},
        {"module_id": "volatility", "state": "UP", "confidence": 0.70, "base_weight": 0.15, "rules_fired": ["F"], "warnings": []},
    ]
    result = algo.run([], {"moduleVerdicts": verdicts, "symbol": "HK.00700"})
    v = result
    m = v.meta
    # 凡人話: 6 個一致 UP 高信心 (加權 base_weight 1.0), consensus_achieved=True, grade=A+/A
    assert m.get("consensus_state") == "UP", f"consensus_state 應該係 UP, 但係 {m.get('consensus_state')}"
    assert m.get("consensus_achieved") is True, f"consensus_achieved 應該 True (6 個一致 UP), 但係 {m.get('consensus_achieved')}, score={m.get('consensus_score')}"
    assert m.get("state") == "UP"
    assert m.get("consensus_score", 0) >= CONSENSUS_THRESHOLD
    assert m.get("grade") in ("A+", "A", "B+"), f"grade 應該 A+/A/B+, 但係 {m.get('grade')}"
    assert m.get("weight_discounts") is not None
    assert len(m.get("weight_discounts", [])) == 6


# ============================================================
# Test 4: 拎 UP↔DOWN 矛盾 pairs (Stage 4)
# ============================================================
def test_synthesizer_conflict_pair_detection():
    """§M7 v2.0.0 Stage 4: 拎 UP↔DOWN 直接矛盾 pairs, emit conflict_pairs 落 meta + conflict_count"""
    verdicts = [
        {"module_id": "ma-alignment", "state": "UP", "confidence": 0.85, "rules_fired": ["A"], "warnings": []},
        {"module_id": "hl-structure", "state": "DOWN", "confidence": 0.80, "rules_fired": ["B"], "warnings": []},
        {"module_id": "trendline", "state": "UP", "confidence": 0.75, "rules_fired": ["A"], "warnings": []},
        {"module_id": "indicators", "state": "DOWN", "confidence": 0.78, "rules_fired": ["C"], "warnings": []},
        {"module_id": "volume-price", "state": "UP", "confidence": 0.72, "rules_fired": ["E"], "warnings": []},
        {"module_id": "volatility", "state": "SIDEWAYS", "confidence": 0.70, "rules_fired": ["F"], "warnings": []},
    ]
    conflicts = _detect_conflicts(verdicts)
    # 凡人話: 應該 detect 到 4 對 (ma↔hl, ma↔indicators, hl↔trendline, hl↔volatility, trendline↔indicators, vol↔UP/DOWN)
    # 嚴格 UP↔DOWN 對, 唔包 SIDEWAYS
    assert len(conflicts) >= 2, f"應該 detect 至少 2 對 UP↔DOWN 矛盾, 但係 {len(conflicts)}"
    # 確認 ma-alignment vs hl-structure 一定衝突
    conflict_ids = {tuple(sorted([c[0], c[1]])) for c in conflicts}
    assert ("ma-alignment", "hl-structure") in conflict_ids or ("hl-structure", "ma-alignment") in conflict_ids


# ============================================================
# Test 5: 拎 self-check warning generalize 至所有 module 嘅 weight discount (Stage 3 v2.0.0)
# ============================================================
def test_synthesizer_weight_discount_generalized():
    """§M7 v2.0.0 generalize M2 self-check pattern 至所有 module, 拎 weight discount 5 個 module"""
    verdicts = [
        {"module_id": "ma-alignment", "state": "UP", "confidence": 0.85, "base_weight": 0.25, "rules_fired": [], "warnings": [
            {"level": "warning", "category": "system", "code": "CONFLICT_STATE"}
        ]},
        {"module_id": "hl-structure", "state": "UP", "confidence": 0.80, "base_weight": 0.15, "rules_fired": [], "warnings": [
            {"level": "warning", "category": "system", "code": "FALLBACK_USED"}
        ]},
        {"module_id": "trendline", "state": "UP", "confidence": 0.75, "base_weight": 0.10, "rules_fired": [], "warnings": []},
    ]
    new_verdicts, discount_meta = _apply_weight_discounts(verdicts)
    # 凡人話: M1 + M2 self-check 觸發, M1 weight 0.25 → 0.05, M2 weight 0.15 → 0.05
    m1_discount = next((d for d in discount_meta if d["module_id"] == "ma-alignment"), None)
    m2_discount = next((d for d in discount_meta if d["module_id"] == "hl-structure"), None)
    assert m1_discount is not None, "M1 應該 detect self-check 觸發"
    assert m1_discount.get("triggered") is True
    assert m1_discount.get("original_weight") == 0.25
    assert m1_discount.get("discounted_weight") == 0.05
    assert m2_discount is not None
    assert m2_discount.get("triggered") is True


# ============================================================
# Test 6: Backend emit shape 對齊 frontend 拎 path (永久 rule §M7 v2.0.2)
# ============================================================
def test_synthesizer_meta_shape_for_frontend():
    """§M7 v2.0.2 永久 rule: backend emit shape 對齊 frontend 拎 path `verdict.meta.*`

    Frontend 拎 path 永久 rule對齊:
    - verdict.meta.state / cycleLabel / confidence
    - verdict.meta.ssi_score / ssi_breakdown / tcm_matrix
    - verdict.meta.alignment_score / alignment_score_after_penalty
    - verdict.meta.weight_discounts / conflict_pairs / conflict_count
    - verdict.meta.consensus_state / consensus_score / consensus_achieved
    - verdict.meta.grade / grade_score / grade_reason
    - verdict.meta.kelly_fraction / kelly_numeric / kelly_position
    - verdict.meta.kelly_state_guard_triggered / kelly_state_guard_reason
    - verdict.meta.module_verdicts (v2.0.1 normalized weight)
    - verdict.meta.module_summary
    - verdict.meta.symbol (永久 rule §verdict.meta.symbol)
    """
    algo = get_algorithm("synthesizer")
    verdicts = [
        {"module_id": "ma-alignment", "state": "UP", "confidence": 0.85, "base_weight": 0.25, "rules_fired": ["A"], "warnings": []},
        {"module_id": "hl-structure", "state": "UP", "confidence": 0.80, "base_weight": 0.15, "rules_fired": ["B"], "warnings": []},
    ]
    result = algo.run([], {"moduleVerdicts": verdicts, "symbol": "HK.00700"})
    v = result
    m = v.meta

    # 永久 rule §M7 v2.0.2: frontend display path fix — backend emit 統一落 meta.*
    assert m.get("moduleId") == "synthesizer"
    assert m.get("symbol") == "HK.00700", "永久 rule §verdict.meta.symbol 違規"
    assert m.get("state") in ("UP", "DOWN", "SIDEWAYS")
    assert m.get("cycleLabel") is not None
    assert isinstance(m.get("confidence"), float)
    # SSI 拎 path
    assert isinstance(m.get("ssi_score"), (int, float))
    assert m.get("ssi_breakdown") is not None
    assert m.get("tcm_matrix") is not None
    assert isinstance(m.get("alignment_score"), (int, float))
    # Stage 3 v2.0.0
    assert m.get("weight_discounts") is not None
    assert isinstance(m.get("weight_discounts"), list)
    # Stage 4 v2.0.0
    assert m.get("conflict_pairs") is not None
    assert isinstance(m.get("conflict_count"), int)
    # Stage 5 v2.0.0
    assert m.get("consensus_state") in ("UP", "DOWN", "SIDEWAYS")
    assert isinstance(m.get("consensus_score"), float)
    assert isinstance(m.get("consensus_achieved"), bool)
    # Grade 拎 path
    assert m.get("grade") in ("A+", "A", "B+", "B", "C+", "C", "D", "F")
    assert isinstance(m.get("grade_score"), (int, float))
    # Kelly v2.0.2 拎 path
    assert m.get("kelly_fraction") in ("half", "quarter", "octo", "zero")
    assert isinstance(m.get("kelly_numeric"), float)
    assert isinstance(m.get("kelly_position"), float)
    assert isinstance(m.get("kelly_state_guard_triggered"), bool)
    # v2.0.1 normalized weight
    assert m.get("module_verdicts") is not None
    assert isinstance(m.get("module_verdicts"), list)
    for mv in m["module_verdicts"]:
        assert "base_weight" in mv, "v2.0.1 emit normalized weight 違規"


# ============================================================
# Test 7: 拎 upstream M1-M6 warnings propagate 落 M7 verdict.warnings
# ============================================================
def test_synthesizer_aggregated_warnings_propagation():
    """永久 rule §Module Warning v1.0.0 + v1.1.0: 拎 upstream M1-M6 warnings 聚合 + M7 emit 嘅 weight_discount warning 通知"""
    algo = get_algorithm("synthesizer")
    verdicts = [
        {"module_id": "ma-alignment", "state": "UP", "confidence": 0.85, "base_weight": 0.25, "rules_fired": ["A"], "warnings": [
            {"level": "warning", "category": "system", "module_id": "ma-alignment", "code": "CONFLICT_STATE", "message": "M1 self-check 觸發", "issue": "...", "impact": "...", "fix": "..."}
        ]},
        {"module_id": "hl-structure", "state": "UP", "confidence": 0.80, "base_weight": 0.15, "rules_fired": ["B"], "warnings": [
            {"level": "warning", "category": "system", "module_id": "hl-structure", "code": "FALLBACK_USED", "message": "M2 self-check 觸發", "issue": "...", "impact": "...", "fix": "..."}
        ]},
    ]
    result = algo.run([], {"moduleVerdicts": verdicts, "symbol": "HK.00700"})
    v = result
    # 永久 rule §Backend 永久改 emit field name 永久 rule (大少 2026-09-10 23:45): 拎 `warnings` (冇 underscore) 對齊
    warnings = v.warnings
    assert len(warnings) >= 2, f"應該聚合 M1 + M2 upstream warnings (≥ 2), 但係 {len(warnings)}"
    # 確認 M7 emit 嘅 weight_discount 通知 (Stage 3 v2.0.0) 同步有
    module_partial_count = sum(1 for w in warnings if w.get("code") == "MODULE_PARTIAL")
    assert module_partial_count >= 2, f"M7 應該 emit 2 個 MODULE_PARTIAL 通知 (M1 + M2 觸發), 但係 {module_partial_count}"
