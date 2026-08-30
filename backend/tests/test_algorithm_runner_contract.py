"""
backend/tests/test_algorithm_runner_contract.py — Caller Inject Contract Test (大少 2026-08-31 P0-3)

凡人話: 驗證 M1-M6 module verdict 嘅 shape 對齊 contract, 缺 required field 即刻 fail
- 之前問題: algorithm_runner.py M7 inject 嗰段用 .get("state", "SIDEWAYS") silent fall back
- 影響: M1 verdict shape 改咗, M7 silent fall back, 大少以為衡行但其實係 trend
- Fix (P0-3): pydantic BaseModel 強制 contract, 缺 field 即刻 raise ValueError

對應 spec: ARCHITECTURE.md §15.41 (Spec Sync #48 Batch 2)
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.algorithms.contract import (
    ModuleVerdictMeta,
    ModuleVerdict,
    validate_module_verdict,
)


# ============================================================
# ModuleVerdictMeta contract test
# ============================================================

def test_module_verdict_meta_valid():
    """Valid module verdict meta 通過 contract"""
    meta = ModuleVerdictMeta(state="UP", confidence=0.8, matchedRules=["R1", "R2"])
    assert meta.state == "UP"
    assert meta.confidence == 0.8
    assert meta.get_matched_rules() == ["R1", "R2"]


def test_module_verdict_meta_missing_state_raises():
    """永久 rule P0-3: state 缺 → ValueError (唔可以 silent fall back)"""
    with pytest.raises(ValueError, match="state field 缺"):
        ModuleVerdictMeta(state=None, confidence=0.8)


def test_module_verdict_meta_missing_confidence_raises():
    """永久 rule P0-3: confidence 缺 → ValueError (唔可以 silent fall back 落 0)"""
    with pytest.raises(ValueError, match="confidence field 缺"):
        ModuleVerdictMeta(state="UP", confidence=None)


def test_module_verdict_meta_invalid_confidence_range():
    """永久 rule P0-3: confidence 超出 [0, 1] → ValueError"""
    with pytest.raises(ValueError, match="超出範圍"):
        ModuleVerdictMeta(state="UP", confidence=1.5)
    with pytest.raises(ValueError, match="超出範圍"):
        ModuleVerdictMeta(state="UP", confidence=-0.1)


def test_module_verdict_meta_invalid_state():
    """永久 rule P0-3: state 唔係 valid enum → ValueError"""
    with pytest.raises(ValueError, match="state 嘅 value 唔啱"):
        ModuleVerdictMeta(state="INVALID", confidence=0.5)


def test_module_verdict_meta_matched_rules_aliases():
    """永久 rule P0-3: 3 個 alias (matchedRules / matched_rules / rules_fired) 都 work"""
    # matchedRules (frontend 標準)
    meta1 = ModuleVerdictMeta(state="UP", confidence=0.5, matchedRules=["A"])
    assert meta1.get_matched_rules() == ["A"]
    # matched_rules (snake_case 別名)
    meta2 = ModuleVerdictMeta(state="UP", confidence=0.5, matched_rules=["B"])
    assert meta2.get_matched_rules() == ["B"]
    # rules_fired (legacy 別名)
    meta3 = ModuleVerdictMeta(state="UP", confidence=0.5, rules_fired=["C"])
    assert meta3.get_matched_rules() == ["C"]
    # 都冇 → return []
    meta4 = ModuleVerdictMeta(state="UP", confidence=0.5)
    assert meta4.get_matched_rules() == []


# ============================================================
# ModuleVerdict contract test (algorithm_runner M7 inject 嗰段拎)
# ============================================================

def _make_valid_module_verdict_dict():
    """拎 valid module verdict dict (algorithm_runner M7 inject 嗰段 build 嗰個 shape)"""
    return {
        "module_id": "ma-alignment",
        "state": "UP",
        "confidence": 0.8,
        "base_weight": 0.25,
        "max_drawdown_estimate": 0.05,
        "rules_fired": ["R1", "R2"],
        "module_specific": {"zigzagSlope": {"ok": True}},
        "warnings": [],
    }


def test_validate_module_verdict_valid():
    """Valid module verdict dict 通過 contract"""
    v = validate_module_verdict(_make_valid_module_verdict_dict())
    assert v.module_id == "ma-alignment"
    assert v.state == "UP"
    assert v.confidence == 0.8
    assert v.base_weight == 0.25


def test_validate_module_verdict_missing_state_raises():
    """永久 rule P0-3: 缺 state → ValueError"""
    d = _make_valid_module_verdict_dict()
    d["state"] = None
    with pytest.raises(ValueError, match="shape 唔啱"):
        validate_module_verdict(d)


def test_validate_module_verdict_missing_confidence_raises():
    """永久 rule P0-3: 缺 confidence → ValueError"""
    d = _make_valid_module_verdict_dict()
    d["confidence"] = None
    with pytest.raises(ValueError, match="shape 唔啱"):
        validate_module_verdict(d)


def test_validate_module_verdict_missing_base_weight_raises():
    """永久 rule P0-3: 缺 base_weight → ValueError"""
    d = _make_valid_module_verdict_dict()
    d["base_weight"] = None
    with pytest.raises(ValueError, match="shape 唔啱"):
        validate_module_verdict(d)


def test_validate_module_verdict_invalid_module_id_raises():
    """永久 rule P0-3: module_id 唔係 6 個 standard ID → ValueError"""
    d = _make_valid_module_verdict_dict()
    d["module_id"] = "fake-module"
    with pytest.raises(ValueError, match="module_id 唔啱"):
        validate_module_verdict(d)


def test_validate_module_verdict_all_six_standard_ids():
    """永久 rule P0-3: 6 個 standard module_id 全部通過 contract"""
    standard_ids = ["ma-alignment", "hl-structure", "trendline", "indicators", "volume", "volatility"]
    for module_id in standard_ids:
        d = _make_valid_module_verdict_dict()
        d["module_id"] = module_id
        v = validate_module_verdict(d)
        assert v.module_id == module_id


def test_validate_module_verdict_default_values():
    """永久 rule P0-3: 缺 optional field → 用 default (唔 raise)"""
    d = {
        "module_id": "ma-alignment",
        "state": "UP",
        "confidence": 0.8,
        "base_weight": 0.25,
    }
    v = validate_module_verdict(d)
    assert v.max_drawdown_estimate == 0.05
    assert v.rules_fired == []
    assert v.module_specific == {}
    assert v.warnings == []


def test_validate_module_verdict_not_dict_raises():
    """永久 rule P0-3: verdict 唔係 dict → ValueError"""
    with pytest.raises(ValueError, match="唔係 dict"):
        validate_module_verdict("not a dict")
    with pytest.raises(ValueError, match="唔係 dict"):
        validate_module_verdict([1, 2, 3])


def test_validate_module_verdict_warnings_pass_through():
    """永久 rule: warnings 永久 pass-through (永久 rule §Module Warning v1.1.0 propagation)"""
    d = _make_valid_module_verdict_dict()
    d["warnings"] = [
        {
            "level": "warning",
            "module_id": "M1",
            "code": "THRESHOLD_BREACH",
            "message": "M1 test",
            "debug": {"issue": "test", "impact": "test", "fix": "test"},
            "timestamp": 1234567890,
        }
    ]
    v = validate_module_verdict(d)
    assert len(v.warnings) == 1
    assert v.warnings[0]["code"] == "THRESHOLD_BREACH"


# ============================================================
# Replicate algorithm_runner 6 個 hardcoded upstream algo
# 確認每個 module 嘅 build 嗰陣 shape 對齊 contract
# ============================================================

@pytest.mark.parametrize("upstream_name,module_id,base_weight", [
    ("ma_alignment", "ma-alignment", 0.25),
    ("hl_structure", "hl-structure", 0.15),
    ("trendline", "trendline", 0.10),
    ("indicators", "indicators", 0.10),
    ("volume_price", "volume", 0.10),
    ("volatility", "volatility", 0.10),
])
def test_all_six_upstream_algos_contract_valid(upstream_name, module_id, base_weight):
    """永久 rule P0-3: algorithm_runner 6 個 hardcoded upstream algo 全部 build 出嚟嘅 shape 通過 contract"""
    module_verdict_raw = {
        "module_id": module_id,
        "state": "UP",
        "confidence": 0.7,
        "base_weight": base_weight,
        "max_drawdown_estimate": 0.05,
        "rules_fired": ["R1"],
        "module_specific": {},
        "warnings": [],
    }
    v = validate_module_verdict(module_verdict_raw)
    assert v.module_id == module_id
    assert v.base_weight == base_weight
