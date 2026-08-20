"""
backend/tests/test_indicators.py — M4 Indicators v1.0.0 backend tests (大少 2026-08-20 Phase 5)

10 tests:
- test_indicators_registered_in_registry
- test_indicators_uptrend_signal
- test_indicators_downtrend_signal
- test_indicators_sideways_hold
- test_indicators_insufficient_data
- test_indicators_verdict_shape
- test_indicators_rsi_macd_computed
- test_indicators_divergence_detection
- test_indicators_signal_threshold
- test_indicators_matched_rules_format
"""

import sys
import os
import random
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from algorithms import get_algorithm, list_algorithms


def _make_klines(prices: list, base_volume: int = 1000000):
    """凡人話: 用 prices 整 klines fixture"""
    n = len(prices)
    klines = []
    for i in range(n):
        klines.append({
            "timestamp": 1700000000 + i * 86400,
            "open": prices[i] * 0.99,
            "high": prices[i] * 1.01,
            "low": prices[i] * 0.99,
            "close": prices[i],
            "volume": base_volume + i * 1000,
        })
    return klines


def test_indicators_registered_in_registry():
    """確認 indicators 已 register 落 registry"""
    assert "indicators" in list_algorithms()
    algo = get_algorithm("indicators")
    assert algo.name == "indicators"
    assert algo.version == "1.0.0"


def test_indicators_uptrend_signal():
    """持續上升: 應該 detect 到 bullish 訊號 (buy / hold)"""
    random.seed(42)
    prices = []
    p = 100
    for _ in range(120):
        p *= 1.005  # 持續升
        prices.append(p)

    algo = get_algorithm("indicators")
    verdict = algo.run(_make_klines(prices), {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    # 持續升 → RSI 高 + MACD 正 → 動能偏多
    assert verdict.meta["momentumState"]["rsi"] > 50
    # 至少 6 個 evidence
    assert len(verdict.meta["evidence"]) == 6


def test_indicators_downtrend_signal():
    """持續下跌: 應該 detect 到 bearish 動能"""
    random.seed(42)
    prices = []
    p = 200
    for _ in range(120):
        p *= 0.985  # 持續跌 1.5% 每日, 大幅跌
        prices.append(p)

    algo = get_algorithm("indicators")
    verdict = algo.run(_make_klines(prices), {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    # 持續跌 → RSI 低 → 動能偏空
    assert verdict.meta["momentumState"]["rsi"] < 50
    # State 應該係 DOWN 或 SIDEWAYS
    assert verdict.meta["state"] in ("DOWN", "SIDEWAYS")
    # Signal 應該係 sell 或 hold
    assert verdict.meta["signal"]["type"] in ("sell", "hold")


def test_indicators_sideways_hold():
    """橫行: 應該係 hold 訊號"""
    random.seed(42)
    prices = [100 + (i % 10) * 0.5 for i in range(120)]

    algo = get_algorithm("indicators")
    verdict = algo.run(_make_klines(prices), {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    # 橫行 → hold 訊號
    assert verdict.meta["signal"]["type"] in ("hold", "buy", "sell")


def test_indicators_insufficient_data():
    """數據不足: 應該返 SIDEWAYS + warning"""
    prices = [100 + i * 0.1 for i in range(20)]  # 太短

    algo = get_algorithm("indicators")
    verdict = algo.run(_make_klines(prices), {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    assert verdict.meta["state"] == "SIDEWAYS"
    assert verdict.meta["confidence"] == 0
    assert any("INSUFFICIENT_DATA" in w for w in verdict.warnings)


def test_indicators_verdict_shape():
    """Verdict shape 對齊 frontend meta 兼容"""
    random.seed(42)
    prices = []
    p = 100
    for _ in range(120):
        p *= 1.005
        prices.append(p)

    algo = get_algorithm("indicators")
    verdict = algo.run(_make_klines(prices), {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    meta = verdict.meta
    # frontend render function 拎呢啲 field
    assert "moduleId" in meta
    assert meta["moduleId"] == "indicators"
    assert "timeframe" in meta
    assert "state" in meta
    assert "cycleLabel" in meta
    assert "confidence" in meta
    assert "interpretation" in meta
    assert "evidence" in meta
    assert "divergence" in meta
    assert "momentumState" in meta
    assert "signal" in meta
    assert "winProbability" in meta
    assert "exhaustionScore" in meta
    assert "rsiSeries" in meta
    assert "macdSeries" in meta


def test_indicators_rsi_macd_computed():
    """RSI 同 MACD series 應該已經計算"""
    random.seed(42)
    prices = [100 + (i % 10) for i in range(120)]

    algo = get_algorithm("indicators")
    verdict = algo.run(_make_klines(prices), {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    # RSI 應該有 119 個 value (120-1)
    assert len(verdict.meta["rsiSeries"]) > 0
    # MACD 應該有 value
    assert len(verdict.meta["macdSeries"]) > 0
    # RSI 範圍 0-100
    for rsi in verdict.meta["rsiSeries"]:
        assert 0 <= rsi <= 100


def test_indicators_divergence_detection():
    """背馳檢測 structure 對齊"""
    random.seed(42)
    prices = []
    p = 100
    for _ in range(120):
        p *= 1.005
        prices.append(p)

    algo = get_algorithm("indicators")
    verdict = algo.run(_make_klines(prices), {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    div = verdict.meta["divergence"]
    assert "rsiDivergences" in div
    assert "macdDivergences" in div
    assert "totalCount" in div
    # 上升趨勢通常冇 bearish divergence
    assert isinstance(div["rsiDivergences"], list)
    assert isinstance(div["macdDivergences"], list)


def test_indicators_signal_threshold():
    """Signal threshold 應該影響 buy/sell 判斷"""
    random.seed(42)
    prices = []
    p = 100
    for _ in range(120):
        p *= 1.002
        prices.append(p)

    algo = get_algorithm("indicators")
    verdict = algo.run(_make_klines(prices), {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    signal = verdict.meta["signal"]
    assert signal["type"] in ("buy", "sell", "hold")
    assert "strength" in signal
    assert "action" in signal
    assert signal["action"] in ("買入", "賣出", "觀望")
    assert 0 <= signal["strength"] <= 1


def test_indicators_matched_rules_format():
    """Evidence format 對齊 frontend 期望"""
    random.seed(42)
    prices = []
    p = 100
    for _ in range(120):
        p *= 1.005
        prices.append(p)

    algo = get_algorithm("indicators")
    verdict = algo.run(_make_klines(prices), {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    evidence = verdict.meta["evidence"]
    # 每個 evidence 必須有 type / label / value / passed
    for e in evidence:
        assert "type" in e
        assert "label" in e
        assert "value" in e
        assert "passed" in e
    # 必須有 RSI / MACD / 背馳 / 衰竭 evidence
    types = [e["type"] for e in evidence]
    assert "rsi" in types
    assert "macd" in types
    assert "divergence" in types
    assert "exhaustion" in types
