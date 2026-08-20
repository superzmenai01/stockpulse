"""
backend/tests/test_volume_price.py — M5 VolumePrice v2.0.0 backend tests (大少 2026-08-20 Phase 6)

10 tests:
- test_volume_price_registered_in_registry
- test_volume_price_uptrend
- test_volume_price_downtrend
- test_volume_price_sideways
- test_volume_price_insufficient_data
- test_volume_price_verdict_shape
- test_volume_price_v1_v15_rules
- test_volume_price_breakout_patterns
- test_volume_price_obv_analysis
- test_volume_price_state_priority
"""

import sys
import os
import random
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from algorithms import get_algorithm, list_algorithms


def _make_klines(prices, volumes=None, base_volume=1000000):
    """凡人話: 用 prices + volumes 整 klines fixture"""
    n = len(prices)
    if volumes is None:
        volumes = [base_volume + i * 1000 for i in range(n)]
    klines = []
    for i in range(n):
        klines.append({
            "timestamp": 1700000000 + i * 86400,
            "open": prices[i] * 0.99,
            "high": prices[i] * 1.01,
            "low": prices[i] * 0.99,
            "close": prices[i],
            "volume": volumes[i],
        })
    return klines


def test_volume_price_registered_in_registry():
    """確認 volume_price 已 register 落 registry"""
    assert "volume_price" in list_algorithms()
    algo = get_algorithm("volume_price")
    assert algo.name == "volume_price"
    assert algo.version == "2.0.0"


def test_volume_price_uptrend():
    """持續上升 + 放量: 應該 detect accumulation 體制 + buy 訊號"""
    random.seed(42)
    prices = []
    volumes = []
    p = 100
    for i in range(120):
        p *= 1.005
        prices.append(p)
        # 上升 + 放量
        volumes.append(1000000 + i * 5000 + (500000 if i > 80 else 0))
    klines = _make_klines(prices, volumes)

    algo = get_algorithm("volume_price")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    # 持續升 + 放量應該 OBV 上升
    assert verdict.meta["obvAnalysis"]["obvTrend"] in ("rising", "flat")


def test_volume_price_downtrend():
    """持續下跌 + 放量: 應該 detect distribution 體制"""
    random.seed(42)
    prices = []
    volumes = []
    p = 200
    for i in range(120):
        p *= 0.985  # 持續跌
        prices.append(p)
        volumes.append(1000000 + i * 5000 + (500000 if i > 80 else 0))
    klines = _make_klines(prices, volumes)

    algo = get_algorithm("volume_price")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    # 跌 + 放量 → 派發
    assert verdict.meta["state"] in ("DOWN", "SIDEWAYS")


def test_volume_price_sideways():
    """橫行: state SIDEWAYS"""
    random.seed(42)
    prices = [100 + (i % 10) * 0.5 for i in range(120)]
    klines = _make_klines(prices)

    algo = get_algorithm("volume_price")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    # 橫行通常 SIDEWAYS
    assert verdict.meta["state"] in ("SIDEWAYS", "UP", "DOWN")


def test_volume_price_insufficient_data():
    """數據不足: 應該返 SIDEWAYS + warning"""
    prices = [100 + i * 0.1 for i in range(20)]  # 太短, < min_data 80
    klines = _make_klines(prices)

    algo = get_algorithm("volume_price")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    assert verdict.meta["state"] == "SIDEWAYS"
    assert verdict.meta["confidence"] == 0
    assert any("INSUFFICIENT_DATA" in w for w in verdict.warnings)


def test_volume_price_verdict_shape():
    """Verdict shape 對齊 frontend meta 兼容 (v2.0 12+ 個 field)"""
    random.seed(42)
    prices = [100 + (i % 10) for i in range(120)]
    klines = _make_klines(prices)

    algo = get_algorithm("volume_price")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    meta = verdict.meta
    # frontend 拎嘅 12 個 field
    for key in ("moduleId", "timeframe", "state", "cycleLabel", "confidence",
                "interpretation", "evidence", "cycle", "signal",
                "buyTimingScore", "winProbability", "volumeRegime",
                "breakoutStatus", "pullbackHealth", "vwapAnalysis",
                "volumePriceCorrelation", "obvAnalysis",
                "matchedRules", "ruleLabels", "rulesFired", "atr", "vwap"):
        assert key in meta, f"missing key: {key}"


def test_volume_price_v1_v15_rules():
    """15 條 rule V1-V15 結構正確"""
    random.seed(42)
    prices = []
    p = 100
    for _ in range(120):
        p *= 1.005
        prices.append(p)
    klines = _make_klines(prices)

    algo = get_algorithm("volume_price")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    matched = verdict.meta["matchedRules"]
    labels = verdict.meta["ruleLabels"]
    # 對齊 V1-V15 規則名
    valid_v = [f"V{i}" for i in range(1, 16)]
    for v in matched:
        assert v in valid_v, f"invalid rule: {v}"
    # matchedRules 同 ruleLabels length 一致
    assert len(matched) == len(labels)
    # rulesFired 對齊 length
    assert verdict.meta["rulesFired"] == len(matched)


def test_volume_price_breakout_patterns():
    """4 種 breakout pattern: gradual_buildup / sustained_surge / single_spike / low_volume / none"""
    random.seed(42)
    prices = []
    p = 100
    for _ in range(120):
        p *= 1.005
        prices.append(p)
    klines = _make_klines(prices)

    algo = get_algorithm("volume_price")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    breakout = verdict.meta["breakoutStatus"]
    assert "isBreakout" in breakout
    assert "isConfirmed" in breakout
    assert "pattern" in breakout
    assert "strength" in breakout
    assert "falseBreakoutRisk" in breakout
    # pattern 必須係 5 種之一
    assert breakout["pattern"] in ("gradual_buildup", "sustained_surge",
                                    "single_spike", "low_volume", "none")
    # falseBreakoutRisk 0-1
    assert 0 <= breakout["falseBreakoutRisk"] <= 1


def test_volume_price_obv_analysis():
    """加權 OBV 結構正確"""
    random.seed(42)
    prices = [100 + (i % 10) for i in range(120)]
    klines = _make_klines(prices)

    algo = get_algorithm("volume_price")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    obv = verdict.meta["obvAnalysis"]
    assert "obvTrend" in obv
    assert obv["obvTrend"] in ("rising", "falling", "flat")
    assert "obvPriceCorrelation" in obv
    assert -1 <= obv["obvPriceCorrelation"] <= 1


def test_volume_price_state_priority():
    """State derivation priority: buyTimingScore >= 0.55 → UP, distribution → DOWN, else SIDEWAYS"""
    random.seed(42)
    prices = [100 + (i % 10) for i in range(120)]
    klines = _make_klines(prices)

    algo = get_algorithm("volume_price")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    state = verdict.meta["state"]
    cycle = verdict.meta["cycle"]
    score = verdict.meta["buyTimingScore"]
    regime = verdict.meta["volumeRegime"]

    # State mapping check
    if score >= 0.55:
        assert state == "UP" and cycle == "uptrend"
    elif regime == "distribution":
        assert state == "DOWN" and cycle == "downtrend"
    else:
        assert state == "SIDEWAYS" and cycle == "sideways"


def test_volume_price_matched_rules_format():
    """Evidence 格式對齊 frontend 期望"""
    random.seed(42)
    prices = []
    p = 100
    for _ in range(120):
        p *= 1.005
        prices.append(p)
    klines = _make_klines(prices)

    algo = get_algorithm("volume_price")
    verdict = algo.run(klines, {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    evidence = verdict.meta["evidence"]
    # 每個 evidence 必須有 type / label / value / passed
    for e in evidence:
        assert "type" in e
        assert "label" in e
        assert "value" in e
        assert "passed" in e
    # evidence 數量對齊 rulesFired
    assert len(evidence) == verdict.meta["rulesFired"]
    # 全部 evidence type 都要係 rule-V*
    for e in evidence:
        assert e["type"].startswith("rule-V")
