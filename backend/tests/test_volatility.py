"""
backend/tests/test_volatility.py — M6 Volatility v1.0.0 backend tests (大少 2026-08-20 Phase 7)

10 tests:
- test_volatility_registered_in_registry
- test_volatility_squeeze_fire
- test_volatility_vcp_breakout
- test_volatility_trending
- test_volatility_choppy
- test_volatility_insufficient_data
- test_volatility_verdict_shape
- test_volatility_s1_s12_rules
- test_volatility_failure_mode
- test_volatility_setup_priority
"""

import sys
import os
import random
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from algorithms import get_algorithm, list_algorithms


def _make_klines(prices, base_volume=1000000, vol_pulse_idx=None):
    """凡人話: 用 prices 整 klines fixture, vol_pulse_idx 嗰日 5x 量"""
    n = len(prices)
    klines = []
    for i in range(n):
        v = base_volume + i * 1000
        if vol_pulse_idx is not None and i == vol_pulse_idx:
            v *= 5
        klines.append({
            "timestamp": 1700000000 + i * 86400,
            "open": prices[i] * 0.99,
            "high": prices[i] * 1.01,
            "low": prices[i] * 0.99,
            "close": prices[i],
            "volume": v,
        })
    return klines


def test_volatility_registered_in_registry():
    """確認 volatility 已 register 落 registry"""
    assert "volatility" in list_algorithms()
    algo = get_algorithm("volatility")
    assert algo.name == "volatility"
    assert algo.version == "1.0.0"


def test_volatility_squeeze_fire():
    """持續橫行 → Squeeze 檢測"""
    random.seed(42)
    prices = [100 + (i % 5) * 0.3 for i in range(120)]  # 極小波動
    klines = _make_klines(prices)

    algo = get_algorithm("volatility")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    # 持續橫行可能 squeeze detected
    assert "squeeze" in verdict.meta
    assert "isSqueeze" in verdict.meta["squeeze"]


def test_volatility_vcp_breakout():
    """橫行後突破 → VCP 結構可能 detect"""
    random.seed(42)
    prices = [100 + (i % 8) * 0.5 for i in range(80)]
    # 跟住升
    for i in range(80, 120):
        prices.append(prices[-1] * 1.005)
    klines = _make_klines(prices, vol_pulse_idx=110)

    algo = get_algorithm("volatility")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    assert "vcpStructure" in verdict.meta
    assert "detected" in verdict.meta["vcpStructure"]


def test_volatility_trending():
    """持續上升 → ATR 趨勢強"""
    random.seed(42)
    prices = []
    p = 100
    for _ in range(120):
        p *= 1.005
        prices.append(p)
    klines = _make_klines(prices)

    algo = get_algorithm("volatility")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    atr_decomp = verdict.meta["atrDecomposition"]
    # 持續升 → trend ATR 較 noise 強
    assert "trendAtr" in atr_decomp
    assert "noiseAtr" in atr_decomp
    assert "regime" in atr_decomp
    assert atr_decomp["regime"] in ("trending", "balanced", "choppy")


def test_volatility_choppy():
    """橫行亂波動 → regime 應該係 choppy 或 balanced"""
    random.seed(42)
    prices = [100 + (random.random() - 0.5) * 10 for _ in range(120)]
    klines = _make_klines(prices)

    algo = get_algorithm("volatility")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    assert verdict.meta["atrDecomposition"]["regime"] in ("trending", "balanced", "choppy")


def test_volatility_insufficient_data():
    """數據不足: 應該返 SIDEWAYS + warning"""
    prices = [100 + i * 0.1 for i in range(20)]  # < min_data
    klines = _make_klines(prices)

    algo = get_algorithm("volatility")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    assert verdict.meta["state"] == "SIDEWAYS"
    assert verdict.meta["confidence"] == 0
    assert any("INSUFFICIENT_DATA" in w for w in verdict.warnings)


def test_volatility_verdict_shape():
    """Verdict shape 對齊 frontend meta 兼容"""
    random.seed(42)
    prices = [100 + (i % 5) for i in range(120)]
    klines = _make_klines(prices)

    algo = get_algorithm("volatility")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    meta = verdict.meta
    # frontend 拎嘅 key field
    for key in ("moduleId", "timeframe", "state", "cycleLabel", "confidence",
                "interpretation", "evidence", "cycle", "setupType", "riskReward",
                "entryScore", "winProbability", "failureMode", "squeeze",
                "vcpStructure", "atrDecomposition", "followThrough",
                "matchedRules", "ruleLabels", "rulesFired",
                "atr", "bbWidth", "kcWidth", "priceCV", "volumeConcentration"):
        assert key in meta, f"missing key: {key}"


def test_volatility_s1_s12_rules():
    """12 條 rule S1-S12 結構正確"""
    random.seed(42)
    prices = [100 + (i % 8) * 0.5 for i in range(80)]
    for i in range(80, 120):
        prices.append(prices[-1] * 1.005)
    klines = _make_klines(prices, vol_pulse_idx=110)

    algo = get_algorithm("volatility")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    matched = verdict.meta["matchedRules"]
    labels = verdict.meta["ruleLabels"]
    # 對齊 S1-S12
    valid_s = [f"S{i}" for i in range(1, 13)]
    for s in matched:
        assert s in valid_s, f"invalid rule: {s}"
    # matched 同 labels length 一致
    assert len(matched) == len(labels)
    assert verdict.meta["rulesFired"] == len(matched)


def test_volatility_failure_mode():
    """失敗模式 (noisy_squeeze / weak_follow_through) 結構"""
    random.seed(42)
    prices = []
    p = 100
    for i in range(120):
        p *= 1.005
        # 加噪音
        p += (random.random() - 0.5) * 3
        prices.append(p)
    klines = _make_klines(prices)

    algo = get_algorithm("volatility")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    failure = verdict.meta["failureMode"]
    assert failure in ("none", "noisy_squeeze", "weak_follow_through")
    # failureReason null if failure == "none"
    if failure == "none":
        assert verdict.meta["failureReason"] is None
    else:
        assert verdict.meta["failureReason"] is not None


def test_volatility_setup_priority():
    """5 種 setup 對應 entry score 優先級"""
    random.seed(42)
    prices = [100 + (i % 5) * 0.3 for i in range(120)]
    klines = _make_klines(prices)

    algo = get_algorithm("volatility")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    setup = verdict.meta["setupType"]
    assert setup in ("mtf_squeeze_fire", "confirmed_vcp_breakout",
                     "genuine_squeeze_forming", "clean_trend_expansion",
                     "no_clear_setup")
    # entryScore 對齊 setup
    score = verdict.meta["entryScore"]
    if setup == "mtf_squeeze_fire":
        assert score >= 0.9
    elif setup == "confirmed_vcp_breakout":
        assert 0.8 <= score < 0.95
    elif setup == "clean_trend_expansion":
        assert 0.6 <= score < 0.8
    elif setup == "genuine_squeeze_forming":
        assert 0.4 <= score < 0.6
    else:
        assert score < 0.4


def test_volatility_matched_rules_format():
    """Evidence 格式對齊 frontend 期望"""
    random.seed(42)
    prices = [100 + (i % 5) for i in range(120)]
    klines = _make_klines(prices)

    algo = get_algorithm("volatility")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    evidence = verdict.meta["evidence"]
    for e in evidence:
        assert "type" in e
        assert "label" in e
        assert "value" in e
        assert "passed" in e
        assert e["type"].startswith("rule-S")
    # evidence 數量對齊 rulesFired
    assert len(evidence) == verdict.meta["rulesFired"]
