"""
backend/tests/test_synthesizer.py — M7 Synthesizer v1.0.0 backend tests (大少 2026-08-20 Phase 8)

10 tests:
- test_synthesizer_registered_in_registry
- test_synthesizer_strong_consensus_grade_a
- test_synthesizer_weak_consensus_grade_f
- test_synthesizer_mixed_alignment
- test_synthesizer_tcm_trap_penalty
- test_synthesizer_kelly_low_volatility
- test_synthesizer_kelly_high_volatility
- test_synthesizer_empty_input
- test_synthesizer_verdict_shape
- test_synthesizer_grade_scale
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from algorithms import get_algorithm, list_algorithms


def _make_verdicts(state_pattern):
    """凡人話: 拎 6 個 standard verdict, state_pattern 係 list of 6 個 state"""
    base_weights = {
        "ma-alignment": 0.25,
        "hl-structure": 0.15,
        "trendline": 0.10,
        "indicators": 0.10,
        "volume": 0.10,
        "volatility": 0.10,
    }
    module_ids = ["ma-alignment", "hl-structure", "trendline", "indicators", "volume", "volatility"]
    verdicts = []
    for i, state in enumerate(state_pattern):
        module_id = module_ids[i]
        verdicts.append({
            "module_id": module_id,
            "state": state,
            "confidence": 0.6 if state != "SIDEWAYS" else 0.3,
            "base_weight": base_weights[module_id],
            "max_drawdown_estimate": 0.05,
            "rules_fired": [f"R{i+1}", f"R{i+2}"],
        })
    return verdicts


def test_synthesizer_registered_in_registry():
    """確認 synthesizer 已 register 落 registry"""
    assert "synthesizer" in list_algorithms()
    algo = get_algorithm("synthesizer")
    assert algo.name == "synthesizer"
    assert algo.version == "1.0.0"


def test_synthesizer_strong_consensus_grade_a():
    """6 個 module 全部 UP + 高 confidence → Grade A 或 A+"""
    verdicts = _make_verdicts(["UP", "UP", "UP", "UP", "UP", "UP"])
    # bump confidence 高啲
    for v in verdicts:
        v["confidence"] = 0.9

    algo = get_algorithm("synthesizer")
    verdict = algo.run([], {"symbol": "TEST", "period": "1d", "moduleVerdicts": verdicts})

    assert verdict.ok
    assert verdict.meta["grade"] in ("A+", "A")
    assert verdict.meta["alignment_score"] == 1.0
    assert verdict.meta["state"] == "UP"
    assert verdict.meta["ssi_score"] >= 80


def test_synthesizer_weak_consensus_grade_f():
    """6 個 module 全部 SIDEWAYS + conf 0 + rules 0 個 → Grade ≤ B+ (frontend spec 拎 alignment 100% 但 ssi 50 → B+)"""
    verdicts = _make_verdicts(["SIDEWAYS"] * 6)
    for v in verdicts:
        v["confidence"] = 0  # 低 conf
        v["rules_fired"] = []  # 0 rules 觸發

    algo = get_algorithm("synthesizer")
    verdict = algo.run([], {"symbol": "TEST", "period": "1d", "moduleVerdicts": verdicts})

    assert verdict.ok
    # SIDEWAYS × 6 + conf 0 + rules 0 → ssi 50, alignment 1.0 → grade_score 70 → B+
    assert verdict.meta["alignment_score"] == 1.0  # 全部 SIDEWAYS 都係 1 致
    assert verdict.meta["state"] == "SIDEWAYS"
    assert verdict.meta["ssi_score"] == 50  # 1.0*50 + 0*30 + 0*20
    assert verdict.meta["grade_score"] == 70  # 50*0.6 + 100*0.4
    assert verdict.meta["grade"] == "B+"  # 70-79 B+ range


def test_synthesizer_extreme_contradiction_grade_f():
    """6 個 module 完全矛盾 (alignment 0.17) + conf 0 + rules 0 → Grade F"""
    # 6 個 module 拎 6 個唔同 state pattern (但只有 3 個 state UP/DOWN/SIDEWAYS, 用 mock 拎 2 UP + 2 DOWN + 2 SIDEWAYS → alignment 0.33)
    verdicts = _make_verdicts(["UP", "DOWN", "UP", "DOWN", "SIDEWAYS", "SIDEWAYS"])
    for v in verdicts:
        v["confidence"] = 0
        v["rules_fired"] = []

    algo = get_algorithm("synthesizer")
    verdict = algo.run([], {"symbol": "TEST", "period": "1d", "moduleVerdicts": verdicts})

    assert verdict.ok
    # 2 UP + 2 DOWN + 2 SIDEWAYS → majority 0.33 (3 way tie)
    assert abs(verdict.meta["alignment_score"] - 0.333) < 0.01
    # ssi = 0.33*50 + 0 + 0 = 16.7
    # grade_score = 16.7*0.6 + 33*0.4 = 10 + 13.3 = 23.3 → F
    assert verdict.meta["grade"] == "F"
    assert verdict.meta["grade_score"] < 30


def test_synthesizer_mixed_alignment():
    """3 UP + 3 DOWN → alignment 0.5, 3 個 TCM pair 全部對立"""
    # mock pattern: ma=UP / hl=DOWN / trend=DOWN / indic=UP / vol=UP / volat=DOWN
    # → ma-trend (UP-DOWN) 對立 / hl-vol (DOWN-UP) 對立 / indic-volat (UP-DOWN) 對立
    verdicts = _make_verdicts(["UP", "DOWN", "DOWN", "UP", "UP", "DOWN"])

    algo = get_algorithm("synthesizer")
    verdict = algo.run([], {"symbol": "TEST", "period": "1d", "moduleVerdicts": verdicts})

    assert verdict.ok
    assert verdict.meta["alignment_score"] == 0.5
    # 3 個對立 pair, tcm 應該有 3 個 alignment=-1 (opposite)
    trap_pairs = [t for t in verdict.meta["tcm_matrix"] if t["alignment"] == -1]
    assert len(trap_pairs) == 3
    # 全部 trap_penalty 0.6 (opposite)
    for t in trap_pairs:
        assert t["trap_penalty"] == 0.6


def test_synthesizer_tcm_trap_penalty():
    """TCM 3 對 pair 結構對齊"""
    verdicts = _make_verdicts(["UP", "UP", "UP", "UP", "UP", "UP"])

    algo = get_algorithm("synthesizer")
    verdict = algo.run([], {"symbol": "TEST", "period": "1d", "moduleVerdicts": verdicts})

    assert verdict.ok
    tcm = verdict.meta["tcm_matrix"]
    assert len(tcm) == 3
    pairs = [t["pair"] for t in tcm]
    assert ["ma-alignment", "trendline"] in pairs
    assert ["hl-structure", "volume"] in pairs
    assert ["indicators", "volatility"] in pairs
    # 全部 UP → alignment 全部 +1, trap_penalty 全部 0
    for t in tcm:
        assert t["alignment"] == 1.0
        assert t["trap_penalty"] == 0.0


def test_synthesizer_kelly_low_volatility():
    """avg max_drawdown_estimate < 0.05 → Kelly half (0.5)"""
    verdicts = _make_verdicts(["UP"] * 6)
    for v in verdicts:
        v["max_drawdown_estimate"] = 0.03  # 低波動

    algo = get_algorithm("synthesizer")
    verdict = algo.run([], {"symbol": "TEST", "period": "1d", "moduleVerdicts": verdicts})

    assert verdict.ok
    assert verdict.meta["kelly_fraction"] == "half"
    assert verdict.meta["kelly_numeric"] == 0.5
    assert verdict.meta["kelly_position"] == 0.5


def test_synthesizer_kelly_high_volatility():
    """avg max_drawdown_estimate >= 0.10 → Kelly octo (0.125)"""
    verdicts = _make_verdicts(["UP"] * 6)
    for v in verdicts:
        v["max_drawdown_estimate"] = 0.12  # 高波動

    algo = get_algorithm("synthesizer")
    verdict = algo.run([], {"symbol": "TEST", "period": "1d", "moduleVerdicts": verdicts})

    assert verdict.ok
    assert verdict.meta["kelly_fraction"] == "octo"
    assert verdict.meta["kelly_numeric"] == 0.125
    assert verdict.meta["kelly_position"] == 0.125


def test_synthesizer_empty_input():
    """空 input → SIDEWAYS + warning + Grade F"""
    algo = get_algorithm("synthesizer")
    verdict = algo.run([], {"symbol": "TEST", "period": "1d", "moduleVerdicts": []})

    assert verdict.ok
    assert verdict.meta["state"] == "SIDEWAYS"
    assert verdict.meta["grade"] == "F"
    assert verdict.meta["ssi_score"] == 0
    assert any("INSUFFICIENT_DATA" in w for w in verdict.warnings)


def test_synthesizer_verdict_shape():
    """Verdict shape 對齊 frontend meta 兼容 (10 個 spec 永久 rule field)"""
    verdicts = _make_verdicts(["UP"] * 6)

    algo = get_algorithm("synthesizer")
    verdict = algo.run([], {"symbol": "TEST", "period": "1d", "moduleVerdicts": verdicts})

    assert verdict.ok
    meta = verdict.meta
    # M7 7 個 spec 永久 rule field
    for key in ("ssi_score", "ssi_breakdown", "tcm_matrix", "alignment_score",
                "grade", "grade_score", "grade_reason",
                "kelly_fraction", "kelly_numeric", "kelly_position",
                "module_verdicts", "module_summary"):
        assert key in meta, f"missing key: {key}"


def test_synthesizer_grade_scale():
    """Grade scale 8 個評級對齊 (A+/A/B+/B/C+/C/D/F)"""
    verdicts = _make_verdicts(["UP"] * 6)

    algo = get_algorithm("synthesizer")
    verdict = algo.run([], {"symbol": "TEST", "period": "1d", "moduleVerdicts": verdicts})

    assert verdict.ok
    valid_grades = ["A+", "A", "B+", "B", "C+", "C", "D", "F"]
    assert verdict.meta["grade"] in valid_grades
    # grade_score 對齊 grade range
    score = verdict.meta["grade_score"]
    grade = verdict.meta["grade"]
    if grade == "A+":
        assert 90 <= score <= 100
    elif grade == "A":
        assert 80 <= score < 90
    elif grade == "B+":
        assert 70 <= score < 80
    elif grade == "B":
        assert 60 <= score < 70
    elif grade == "C+":
        assert 50 <= score < 60
    elif grade == "C":
        assert 40 <= score < 50
    elif grade == "D":
        assert 30 <= score < 40
    else:  # F
        assert score < 30
