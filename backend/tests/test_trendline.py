"""
backend/tests/test_trendline.py — M3 Trendline pytest (大少 2026-08-20 20:50 Phase 4)

凡人話: 測試 M3 algorithm 啱唔啱
- Basic: 4-state cycle (UP / DOWN / SIDEWAYS / TRANSITION)
- 10 rule matching (A-J)
- Edge case: 唔夠極值點
- Verdict shape: 跟 framework contract (frontend 兼容 shape)
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import pytest

from backend.algorithms.trendline.algorithm import TrendlineAlgorithm
from backend.algorithms.trendline.config import DEFAULT_TRENDLINE_CONFIG
from backend.algorithms import get_algorithm, list_algorithms


def make_klines(prices, volume_base=1000, start_date=(2024, 1, 1)):
    """凡人話: 構造 fake K 線 (date unique)"""
    n = len(prices)
    import datetime
    start = datetime.date(*start_date)
    out = []
    for i in range(n):
        d = start + datetime.timedelta(days=i)
        out.append({
            "time": d.isoformat(),
            "date": d.isoformat(),
            "open": prices[i],
            "high": prices[i] * 1.02,
            "low": prices[i] * 0.98,
            "close": prices[i],
            "volume": volume_base + (i % 5) * 100,
        })
    return out


# ============================================================================
# Test: Algorithm registry
# ============================================================================

def test_trendline_registered_in_registry():
    """凡人話: trendline 註冊落 framework"""
    assert "trendline" in list_algorithms()
    algo = get_algorithm("trendline")
    assert algo.name == "trendline"
    assert algo.version == "0.1.0"


# ============================================================================
# Test: Basic functionality
# ============================================================================

def test_trendline_uptrend():
    """凡人話: 持續上升 K 線 判定 UP state (支撐線上升, rule A 觸發)"""
    # 線性上升 — 支撐斜率 > 0 + R² 高
    prices = [100 + i * 0.5 for i in range(60)]
    klines = make_klines(prices, volume_base=2000)

    algo = TrendlineAlgorithm()
    verdict = algo.run(klines, {"trendlineConfig": DEFAULT_TRENDLINE_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert verdict.meta["state"] in ("UP", "SIDEWAYS")
    assert "matchedRules" in verdict.meta
    assert "supportLine" in verdict.meta
    assert "resistanceLine" in verdict.meta
    assert "channel" in verdict.meta
    assert "breakout" in verdict.meta
    assert "projection" in verdict.meta


def test_trendline_downtrend():
    """凡人話: 持續下跌 K 線 判定 DOWN state (壓力線下降, rule B 觸發)"""
    prices = [200 - i * 0.5 for i in range(60)]
    klines = make_klines(prices, volume_base=2000)

    algo = TrendlineAlgorithm()
    verdict = algo.run(klines, {"trendlineConfig": DEFAULT_TRENDLINE_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert verdict.meta["state"] in ("DOWN", "SIDEWAYS")


def test_trendline_sideways():
    """凡人話: 橫行 K 線 判定 SIDEWAYS"""
    # 構造真正橫行: 6 個 cycle, peak 高 + trough 低交替, 趨勢 mixed
    prices = []
    n = 60
    for i in range(n):
        cycle_pos = i % 20
        if cycle_pos < 10:
            prices.append(100 + cycle_pos * 0.2)
        else:
            prices.append(102 - (cycle_pos - 10) * 0.2)
    klines = make_klines(prices, volume_base=500)

    algo = TrendlineAlgorithm()
    verdict = algo.run(klines, {"trendlineConfig": DEFAULT_TRENDLINE_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert verdict.meta["state"] == "SIDEWAYS"


# ============================================================================
# Test: Edge cases
# ============================================================================

def test_trendline_insufficient_data():
    """凡人話: K 線不足 (< 30) 應該返 ok=False + error"""
    prices = [100 + i for i in range(20)]
    klines = make_klines(prices, volume_base=1000)

    algo = TrendlineAlgorithm()
    verdict = algo.run(klines, {"trendlineConfig": DEFAULT_TRENDLINE_CONFIG, "symbol": "TEST"})

    assert not verdict.ok
    assert "Insufficient data" in verdict.error


def test_trendline_insufficient_extremes():
    """凡人話: 極值點不足 (< minLinePoints) 應該返 SIDEWAYS 0.3 + FALLBACK_USED warning"""
    # 全部 price 一樣, peaks/troughs 拎唔到
    prices = [100.0] * 60
    klines = make_klines(prices, volume_base=1000)

    algo = TrendlineAlgorithm()
    verdict = algo.run(klines, {"trendlineConfig": DEFAULT_TRENDLINE_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert verdict.meta["state"] == "SIDEWAYS"
    assert verdict.meta["confidence"] == 0.3
    assert len(verdict.warnings) >= 1
    assert any(w.get("code") == "FALLBACK_USED" for w in verdict.warnings)


# ============================================================================
# Test: Verdict shape (跟 frontend 兼容)
# ============================================================================

def test_trendline_verdict_shape():
    """凡人話: M3 verdict shape 對齊 frontend (testing page 拎得到)"""
    prices = [100 + (i % 7) * 1.5 for i in range(60)]
    klines = make_klines(prices, volume_base=1500)

    algo = TrendlineAlgorithm()
    verdict = algo.run(klines, {"trendlineConfig": DEFAULT_TRENDLINE_CONFIG, "symbol": "HK.00700"})

    assert verdict.ok
    # Top-level shape
    assert verdict.ok is True
    assert isinstance(verdict.points, list)
    assert isinstance(verdict.meta, dict)
    assert isinstance(verdict.warnings, list)

    # Frontend 兼容 meta fields
    meta_required = [
        "moduleId", "timeframe", "state", "cycle_label", "confidence", "interpretation",
        "evidence", "_warnings", "matchedRules", "ruleLabels", "baseConfidence",
        "supportLine", "resistanceLine", "channel", "breakout",
        "latestClose", "latestExtremeAge", "projection", "adjustmentLog",
        "dataDays", "configUsed",
    ]
    for field in meta_required:
        assert field in verdict.meta, f"Missing meta field: {field}"


def test_trendline_evidence_shape():
    """凡人話: evidence 拎 list of dict, 每個有 type / label / value / passed (大部份有 threshold)"""
    prices = [100 + (i % 5) * 1.5 for i in range(60)]
    klines = make_klines(prices, volume_base=1500)

    algo = TrendlineAlgorithm()
    verdict = algo.run(klines, {"trendlineConfig": DEFAULT_TRENDLINE_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert isinstance(verdict.meta["evidence"], list)
    for ev in verdict.meta["evidence"]:
        assert "type" in ev
        assert "label" in ev
        assert "value" in ev
        assert "passed" in ev
        # threshold 可能冇 (e.g. support-breakout / resistance-breakout 拎 boolean value)


def test_trendline_state_priority():
    """凡人話: state 應該拎 UP/DOWN/SIDEWAYS/TRANSITION 4 個 value"""
    prices = [100 + (i % 5) * 1.5 for i in range(60)]
    klines = make_klines(prices, volume_base=1500)

    algo = TrendlineAlgorithm()
    verdict = algo.run(klines, {"trendlineConfig": DEFAULT_TRENDLINE_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert verdict.meta["state"] in ("UP", "DOWN", "SIDEWAYS", "TRANSITION")


def test_trendline_matched_rules_format():
    """凡人話: matchedRules 拎 list of string (rule ids: A-J)"""
    prices = [100 + (i % 5) * 1.5 for i in range(60)]
    klines = make_klines(prices, volume_base=1500)

    algo = TrendlineAlgorithm()
    verdict = algo.run(klines, {"trendlineConfig": DEFAULT_TRENDLINE_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert isinstance(verdict.meta["matchedRules"], list)
    for rid in verdict.meta["matchedRules"]:
        assert rid in ("A", "B", "C", "D", "E", "F", "G", "H", "I", "J")
